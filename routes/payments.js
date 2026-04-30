const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getAdminBranchId(userId) {
    const [rows] = await pool.query(
        'SELECT branch_id FROM staff WHERE user_id = ? LIMIT 1',
        [userId]
    );
    return rows.length > 0 ? rows[0].branch_id : null;
}

// POST /api/payments - Parent pays fees
router.post('/', [auth, authorize(['Parent'])], async (req, res) => {
    const { student_id, term_id, amount_paid } = req.body;

    if (!student_id || !term_id || !amount_paid) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Verify that the logged-in parent is the parent of the student
        const [parent] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parent.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'User is not a parent.' });
        }
        const parent_id = parent[0].id;

        const [student] = await connection.query('SELECT id, class_id FROM students WHERE id = ? AND parent_id = ?', [student_id, parent_id]);
        if (student.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'You are not authorized to make a payment for this student.' });
        }
        const class_id = student[0].class_id;

        // Create the payment record
        const newPayment = {
            id: uuidv4(),
            student_id,
            term_id,
            amount_paid,
            payment_date: new Date(),
        };
        await connection.query('INSERT INTO payments SET ?', newPayment);

        // Update the student's payment status
        const [totalFeesRow] = await connection.query('SELECT SUM(amount) as total_fees FROM fees WHERE class_id = ? AND term_id = ?', [class_id, term_id]);
        const total_fees = totalFeesRow[0].total_fees || 0;

        const [totalPaidRow] = await connection.query('SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?', [student_id, term_id]);
        const total_paid = totalPaidRow[0].total_paid || 0;

        const newStatus = total_paid >= total_fees ? 'Paid' : 'Not Paid';

        await connection.query(
            'UPDATE student_payment_statuses SET status = ? WHERE student_id = ? AND term_id = ?',
            [newStatus, student_id, term_id]
        );

        await connection.commit();
        res.status(201).json({ success: true, message: 'Payment made successfully.', data: newPayment });
    } catch (error) {
        await connection.rollback();
        console.error('Make payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while making payment.' });
    } finally {
        connection.release();
    }
});

// GET /api/payments/history/:childId - Fetch payment history for a child
router.get('/history/:childId', [auth, authorize(['Parent'])], async (req, res) => {
    const { childId } = req.params;

    try {
        // Verify that the logged-in parent is the parent of the student
        const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parent.length === 0) {
            return res.status(403).json({ success: false, message: 'User is not a parent.' });
        }
        const parent_id = parent[0].id;

        const [student] = await pool.query('SELECT id FROM students WHERE id = ? AND parent_id = ?', [childId, parent_id]);
        if (student.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not authorized to view the payment history for this student.' });
        }

        const [payments] = await pool.query('SELECT p.*, t.name as term_name FROM payments p JOIN terms t ON p.term_id = t.id WHERE p.student_id = ? ORDER BY p.payment_date DESC', [childId]);
        res.json({ success: true, data: payments });
    } catch (error) {
        console.error('Get payment history error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching payment history.' });
    }
});

// GET /api/payments/status/:childId - Show current term payment status
router.get('/status/:childId', [auth, authorize(['Parent'])], async (req, res) => {
    const { childId } = req.params;

    try {
        // Verify that the logged-in parent is the parent of the student
        const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parent.length === 0) {
            return res.status(403).json({ success: false, message: 'User is not a parent.' });
        }
        const parent_id = parent[0].id;

        const [student] = await pool.query('SELECT id FROM students WHERE id = ? AND parent_id = ?', [childId, parent_id]);
        if (student.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not authorized to view the payment status for this student.' });
        }

        const [activeTerm] = await pool.query('SELECT id FROM terms WHERE is_active = TRUE');
        if (activeTerm.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const term_id = activeTerm[0].id;

        const [statusRow] = await pool.query('SELECT status FROM student_payment_statuses WHERE student_id = ? AND term_id = ?', [childId, term_id]);
        const status = statusRow.length > 0 ? statusRow[0].status : 'Not Paid';

        res.json({ success: true, data: { status } });
    } catch (error) {
        console.error('Get payment status error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching payment status.' });
    }
});

router.get('/admin/payments', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { class_id, term_id, branch_id, status, student_id, limit = 50, offset = 0 } = req.query;

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
                s.first_name as student_first_name,
                s.last_name as student_last_name,
                s.branch_id,
                s.class_id,
                c.name as class_name,
                c.arm,
                t.name as term_name,
                t.session,
                b.school_name as branch_name,
                IFNULL(sps.status, 'Not Paid') as payment_status
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN terms t ON p.term_id = t.id
            LEFT JOIN student_payment_statuses sps ON sps.student_id = p.student_id AND sps.term_id = p.term_id
            WHERE 1=1
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' AND s.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                return res.json({ success: true, data: [], total: 0 });
            }
        }

        if (class_id) {
            query += ' AND s.class_id = ?';
            queryParams.push(class_id);
        }

        if (term_id) {
            query += ' AND p.term_id = ?';
            queryParams.push(term_id);
        }

        if (branch_id && req.user.roles.includes('SuperAdmin')) {
            query += ' AND s.branch_id = ?';
            queryParams.push(branch_id);
        }

        if (student_id) {
            query += ' AND p.student_id = ?';
            queryParams.push(student_id);
        }

        if (status) {
            query += ' AND IFNULL(sps.status, "Not Paid") = ?';
            queryParams.push(status);
        }

        const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const [[{ total }]] = await pool.query(countQuery, queryParams);

        query += ' ORDER BY p.payment_date DESC LIMIT ? OFFSET ?';
        queryParams.push(parseInt(limit), parseInt(offset));

        const [payments] = await pool.query(query, queryParams);
        res.json({ success: true, data: payments, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
        console.error('Get admin payments error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching payments.' });
    }
});

router.get('/admin/payments/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

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
                s.first_name as student_first_name,
                s.last_name as student_last_name,
                s.branch_id,
                s.class_id,
                c.name as class_name,
                c.arm,
                t.name as term_name,
                t.session,
                b.school_name as branch_name
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN terms t ON p.term_id = t.id
            WHERE p.id = ?
        `;
        const queryParams = [id];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' AND s.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                return res.status(403).json({ success: false, message: 'Admin not linked to a branch.' });
            }
        }

        const [payments] = await pool.query(query, queryParams);

        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found.' });
        }

        res.json({ success: true, data: payments[0] });
    } catch (error) {
        console.error('Get admin payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching payment.' });
    }
});

router.patch('/admin/payments/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { amount_paid, reference, payment_date } = req.body;

    if (amount_paid === undefined && reference === undefined && payment_date === undefined) {
        return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [existingPayment] = await connection.query(
            `SELECT p.*, s.class_id FROM payments p JOIN students s ON p.student_id = s.id WHERE p.id = ?`,
            [id]
        );

        if (existingPayment.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Payment not found.' });
        }

        const payment = existingPayment[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId && payment.branch_id !== adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Not authorized to update this payment.' });
            }
        }

        const updates = {};
        if (amount_paid !== undefined) updates.amount_paid = amount_paid;
        if (reference !== undefined) updates.reference = reference;
        if (payment_date !== undefined) updates.payment_date = payment_date;

        if (Object.keys(updates).length > 0) {
            await connection.query('UPDATE payments SET ? WHERE id = ?', [updates, id]);
        }

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
            'UPDATE student_payment_statuses SET status = ? WHERE student_id = ? AND term_id = ?',
            [newStatus, payment.student_id, payment.term_id]
        );

        await connection.commit();
        res.json({ success: true, message: 'Payment updated successfully.', status: newStatus });
    } catch (error) {
        await connection.rollback();
        console.error('Update payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating payment.' });
    } finally {
        connection.release();
    }
});

router.post('/admin/payments/manual', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { student_id, term_id, amount_paid, reference, payment_date } = req.body;

    if (!student_id || !term_id || !amount_paid) {
        return res.status(400).json({ success: false, message: 'Missing required fields: student_id, term_id, amount_paid.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [student] = await connection.query('SELECT id, class_id, branch_id FROM students WHERE id = ?', [student_id]);
        if (student.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId && student[0].branch_id !== adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Not authorized to add payment for this student.' });
            }
        }

        const newPayment = {
            id: uuidv4(),
            student_id,
            term_id,
            amount_paid,
            payment_date: payment_date ? new Date(payment_date) : new Date(),
            reference: reference || null,
        };
        await connection.query('INSERT INTO payments SET ?', newPayment);

        const [[{ total_due }]] = await connection.query(
            'SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?',
            [student[0].class_id, term_id]
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
        res.status(201).json({ success: true, message: 'Manual payment recorded successfully.', data: newPayment, status: newStatus });
    } catch (error) {
        await connection.rollback();
        console.error('Manual payment error:', error);
        res.status(500).json({ success: false, message: 'Server error while recording manual payment.' });
    } finally {
        connection.release();
    }
});

router.get('/admin/revenue', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id, term_id, status, student_id, payment_for, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT 
                r.id,
                r.student_id,
                r.parent_id,
                r.email,
                r.amount,
                r.reference,
                r.status,
                r.payment_for,
                r.paid_at,
                r.created_at,
                s.first_name as student_first_name,
                s.last_name as student_last_name,
                s.branch_id,
                s.class_id,
                c.name as class_name,
                c.arm,
                b.school_name as branch_name
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN branches b ON s.branch_id = b.id
            WHERE 1=1
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' AND s.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                return res.json({ success: true, data: [], total: 0 });
            }
        }

        if (branch_id && req.user.roles.includes('SuperAdmin')) {
            query += ' AND s.branch_id = ?';
            queryParams.push(branch_id);
        }

        if (term_id) {
            const [termInfo] = await pool.query('SELECT id FROM terms WHERE id = ? OR parent_term_id = ?', [term_id, term_id]);
            const termIds = termInfo.map(t => t.id);
            if (termIds.length > 0) {
                query += ` AND r.id IN (SELECT id FROM revenue WHERE term_id IN (${termIds.map(() => '?').join(',')}))`;
                queryParams.push(...termIds);
            }
        }

        if (student_id) {
            query += ' AND r.student_id = ?';
            queryParams.push(student_id);
        }

        if (status) {
            query += ' AND r.status = ?';
            queryParams.push(status);
        }

        if (payment_for) {
            query += ' AND r.payment_for = ?';
            queryParams.push(payment_for);
        }

        const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const [[{ total }]] = await pool.query(countQuery, queryParams);

        query += ' ORDER BY r.paid_at DESC LIMIT ? OFFSET ?';
        queryParams.push(parseInt(limit), parseInt(offset));

        const [revenue] = await pool.query(query, queryParams);
        res.json({ success: true, data: revenue, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
        console.error('Get admin revenue error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching revenue.' });
    }
});

module.exports = router;
