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

// GET /api/terms - Get all terms
router.get('/', auth, async (req, res) => {
    try {
        // Scoping for Admins to see only their branch's terms
        let query = 'SELECT * FROM terms';
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0 && adminStaff[0].branch_id) {
                query += ' WHERE branch_id = ?';
                queryParams.push(adminStaff[0].branch_id);
            }
        }

        query += ' ORDER BY start_date DESC'; // Show newest first

        const [terms] = await pool.query(query, queryParams);
        res.json({ success: true, data: terms });

    } catch (error) {
        console.error('Get all terms error:', error);
        res.status(500).json({ success: false, message: 'Server error while retrieving terms.' });
    }
});

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

// GET /api/terms/current - Get the current active term
router.get('/current', auth, async (req, res) => {
    try {
        let query = 'SELECT * FROM terms WHERE is_active = TRUE';
        const queryParams = [];

        // If user is Admin, get term for their branch only
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId) {
                return res.status(403).json({ success: false, message: 'Admin is not associated with any branch.' });
            }
            query += ' AND branch_id = ?';
            queryParams.push(adminBranchId);
        } else if (req.user.roles.includes('SuperAdmin')) {
            // SuperAdmin can get any term, but prioritize global terms first
            query += ' ORDER BY CASE WHEN branch_id IS NULL THEN 0 ELSE 1 END, created_at DESC';
        } else {
            // For other roles, get the term for their associated branch
            const [userBranch] = await pool.query(`
                SELECT branch_id FROM students WHERE user_id = ?
                UNION
                SELECT branch_id FROM staff WHERE user_id = ?
            `, [req.user.id, req.user.id]);

            if (userBranch.length > 0) {
                query += ' AND branch_id = ?';
                queryParams.push(userBranch[0].branch_id);
            } else {
                // If no branch association, get global terms
                query += ' AND branch_id IS NULL';
            }
        }

        const [terms] = await pool.query(query, queryParams);

        if (terms.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }

        // Return the first (most relevant) term
        const currentTerm = terms[0];

        res.json({
            success: true,
            data: currentTerm
        });
    } catch (error) {
        console.error('Get current term error:', error);
        res.status(500).json({ success: false, message: 'Server error while retrieving current term.' });
    }
});

module.exports = router;
