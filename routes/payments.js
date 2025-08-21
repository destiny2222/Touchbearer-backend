const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

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

module.exports = router;
