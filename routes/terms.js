const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// POST /api/terms/new - Trigger a new term (reset payment statuses but keep history)
router.post('/new', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { name, start_date, end_date, branch_id } = req.body; // branch_id is optional

    if (!name || !start_date || !end_date) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let termBranchId = branch_id;

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admin is not associated with any branch.' });
            }
            if (branch_id && branch_id !== adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only create terms for their own branch.' });
            }
            termBranchId = adminBranchId; // Force the term to be for the admin's branch
        }

        // Deactivate all other terms in the same branch, or all global terms if this is a global term
        if (termBranchId) {
            await connection.query('UPDATE terms SET is_active = FALSE WHERE branch_id = ?', [termBranchId]);
        } else {
            await connection.query('UPDATE terms SET is_active = FALSE WHERE branch_id IS NULL');
        }

        // Create the new term
        const newTermId = uuidv4();
        const newTerm = {
            id: newTermId,
            name,
            branch_id: termBranchId || null,
            start_date,
            end_date,
            is_active: true,
        };
        await connection.query('INSERT INTO terms SET ?', newTerm);

        // Reset student payment statuses to "Not Paid" for the new term, scoped to the branch
        let studentsQuery = 'SELECT id FROM students';
        const queryParams = [];
        if (termBranchId) {
            studentsQuery += ' WHERE branch_id = ?';
            queryParams.push(termBranchId);
        }

        const [students] = await connection.query(studentsQuery, queryParams);

        if (students.length > 0) {
            const studentPaymentStatuses = students.map(student => [student.id, newTermId, 'Not Paid']);
            await connection.query('INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES ? ON DUPLICATE KEY UPDATE status = VALUES(status)', [studentPaymentStatuses]);
        }

        await connection.commit();
        res.status(201).json({ success: true, message: 'New term created successfully.', data: newTerm });
    } catch (error) {
        await connection.rollback();
        console.error('Create new term error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating new term.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
