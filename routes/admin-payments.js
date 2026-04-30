const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// GET /api/admin/payments - List all payments (with filters: class, term, branch, status)
router.get('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id, class_id, term_id, status, student_id, start_date, end_date, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT 
                p.id,
                p.student_id,
                p.term_id,
                p.amount_paid,
                p.payment_date,
                p.reference,
                p.created_at,
                s.first_name,
                s.last_name,
                s.class_id,
                c.name as class_name,
                c.arm,
                b.school_name as branch_name,
                t.name as term_name,
                t.session,
                IFNULL(sps.status, 'Not Paid') as payment_status
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN terms t ON p.term_id = t.id
            LEFT JOIN student_payment_statuses sps ON sps.student_id = s.id AND sps.term_id = p.term_id
            WHERE 1=1
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' AND s.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                return res.json({ success: true, data: [], message: 'Admin not linked to a branch' });
            }
        } else if (branch_id) {
            query += ' AND s.branch_id = ?';
            queryParams.push(branch_id);
        }

        if (class_id) {
            query += ' AND s.class_id = ?';
            queryParams.push(class_id);
        }

        if (term_id) {
            query += ' AND p.term_id = ?';
            queryParams.push(term_id);
        }

        if (student_id) {
            query += ' AND p.student_id = ?';
            queryParams.push(student_id);
        }

        if (status) {
            query += ' AND IFNULL(sps.status, ?) = ?';
            queryParams.push('Not Paid', status);
        }

        if (start_date) {
            query += ' AND p.payment_date >= ?';
            queryParams.push(start_date);
        }

        if (end_date) {
            query += ' AND p.payment_date <= ?';
            queryParams.push(end_date);
        }

        query += ' ORDER BY p.payment_date DESC, p.created_at DESC';
        query += ' LIMIT ? OFFSET ?';
        queryParams.push(parseInt(limit), parseInt(offset));

        const [payments] = await pool.query(query, queryParams);

        let countQuery = `
            SELECT COUNT(*) as total
            FROM payments p
            JOIN students s ON p.student_id = s.id
            WHERE 1=1
        `;
        const countParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                countQuery += ' AND s.branch_id = ?';
                countParams.push(adminBranchId);
            }
        } else if (branch_id) {
            countQuery += ' AND s.branch_id = ?';
            countParams.push(branch_id);
        }

        if (class_id) {
            countQuery += ' AND s.class_id = ?';
            countParams.push(class_id);
        }

        if (term_id) {
            countQuery += ' AND p.term_id = ?';
            countParams.push(term_id);
        }

        if (student_id) {
            countQuery += ' AND p.student_id = ?';
            countParams.push(student_id);
        }

        const [countResult] = await pool.query(countQuery, countParams);

        res.json({ 
            success: true, 
            data: payments,
            pagination: {
                total: countResult[0].total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Get admin payments error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching payments.' });
    }
});

// GET /api/admin/payments/:id - View payment details
router.get('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    try {
        const [payments] = await pool.query(`
            SELECT 
                p.id,
                p.student_id,
                p.term_id,
                p.amount_paid,
                p.payment_date,
                p.reference,
                p.created_at,
                s.first_name,
                s.last_name,
                s.class_id,
                c.name as class_name,
                c.arm,
                b.id as branch_id,
                b.school_name as branch_name,
                t.name as term_name,
                t.session,
                t.start_date as term_start,
                t.end_date as term_end
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN terms t ON p.term_id = t.id
            WHERE p.id = ?
        `, [id]);

        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found.' });
        }

        const payment = payments[0];

        const [feesInfo] = await pool.query(`
            SELECT 
                SUM(amount) as total_fees
            FROM fees 
            WHERE class_id = ? AND term_id = ?
        `, [payment.class_id, payment.term_id]);

        const [totalPaidInfo] = await pool.query(`
            SELECT 
                SUM(amount_paid) as total_paid
            FROM payments 
            WHERE student_id = ? AND term_id = ?
        `, [payment.student_id, payment.term_id]);

        const [statusInfo] = await pool.query(`
            SELECT status FROM student_payment_statuses 
            WHERE student_id = ? AND term_id = ?
        `, [payment.student_id, payment.term_id]);

        res.json({
            success: true,
            data: {
                ...payment,
                total_fees: feesInfo[0].total_fees || 0,
                total_paid: totalPaidInfo[0].total_paid || 0,
                balance: (feesInfo[0].total_fees || 0) - (totalPaidInfo[0].total_paid || 0),
                payment_status: statusInfo.length > 0 ? statusInfo[0].status : 'Not Paid'
            }
        });
    } catch (error) {
        console.error('Get payment details error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching payment details.' });
    }
});

// PATCH /api/admin/payments/:id - Update payment (add reference, adjust amount)
router.patch('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { amount_paid, reference, payment_date } = req.body;

    try {
        const [existingPayment] = await pool.query(`
            SELECT p.*, s.class_id, s.branch_id
            FROM payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?
        `, [id]);

        if (existingPayment.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found.' });
        }

        const payment = existingPayment[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== payment.branch_id) {
                return res.status(403).json({ success: false, message: 'You can only update payments for your branch.' });
            }
        }

        const updateFields = {};
        if (amount_paid !== undefined) updateFields.amount_paid = amount_paid;
        if (reference !== undefined) updateFields.reference = reference;
        if (payment_date) updateFields.payment_date = payment_date;

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query('UPDATE payments SET ? WHERE id = ?', [updateFields, id]);

            const [[{ total_due }]] = await connection.query(
                'SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?',
                [payment.class_id, payment.term_id]
            );

            const [[{ total_paid }]] = await connection.query(
                'SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?',
                [payment.student_id, payment.term_id]
            );

            const newStatus = total_paid >= total_due ? 'Paid' : 'Not Paid';

            await connection.query(
                'INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
                [payment.student_id, payment.term_id, newStatus, newStatus]
            );

            await connection.commit();
            res.json({ success: true, message: 'Payment updated successfully.' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Update payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating payment.' });
    }
});

// DELETE /api/admin/payments/:id - Delete a payment
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    try {
        const [existingPayment] = await pool.query(`
            SELECT p.*, s.class_id, s.branch_id
            FROM payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?
        `, [id]);

        if (existingPayment.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found.' });
        }

        const payment = existingPayment[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== payment.branch_id) {
                return res.status(403).json({ success: false, message: 'You can only delete payments for your branch.' });
            }
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query('DELETE FROM payments WHERE id = ?', [id]);

            const [[{ total_due }]] = await connection.query(
                'SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?',
                [payment.class_id, payment.term_id]
            );

            const [[{ total_paid }]] = await connection.query(
                'SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?',
                [payment.student_id, payment.term_id]
            );

            const newStatus = (!total_paid || total_paid < total_due) ? 'Not Paid' : 'Paid';

            await connection.query(
                'INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
                [payment.student_id, payment.term_id, newStatus, newStatus]
            );

            await connection.commit();
            res.json({ success: true, message: 'Payment deleted successfully.' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting payment.' });
    }
});

// POST /api/admin/payments/manual - Manually record a payment with reference
router.post('/manual', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { student_id, term_id, amount_paid, reference, payment_date } = req.body;

    if (!student_id || !term_id || !amount_paid) {
        return res.status(400).json({ success: false, message: 'Missing required fields: student_id, term_id, amount_paid.' });
    }

    try {
        const [student] = await pool.query('SELECT id, class_id, branch_id FROM students WHERE id = ?', [student_id]);
        if (student.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        const studentData = student[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== studentData.branch_id) {
                return res.status(403).json({ success: false, message: 'You can only create payments for your branch.' });
            }
        }

        const [term] = await pool.query('SELECT id FROM terms WHERE id = ?', [term_id]);
        if (term.length === 0) {
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }

        if (reference) {
            const [existingRef] = await pool.query('SELECT id FROM payments WHERE reference = ?', [reference]);
            if (existingRef.length > 0) {
                return res.status(400).json({ success: false, message: 'A payment with this reference already exists.' });
            }
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const newPayment = {
                id: uuidv4(),
                student_id,
                term_id,
                amount_paid,
                payment_date: payment_date || new Date(),
                reference: reference || null,
            };
            await connection.query('INSERT INTO payments SET ?', newPayment);

            const [[{ total_due }]] = await connection.query(
                'SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?',
                [studentData.class_id, term_id]
            );

            const [[{ total_paid }]] = await connection.query(
                'SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?',
                [student_id, term_id]
            );

            const newStatus = total_paid >= total_due ? 'Paid' : 'Not Paid';

            await connection.query(
                'INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
                [student_id, term_id, newStatus, newStatus]
            );

            await connection.commit();
            res.status(201).json({ success: true, message: 'Manual payment recorded successfully.', data: newPayment });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Create manual payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while recording manual payment.' });
    }
});

module.exports = router;