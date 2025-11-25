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
    const { name, session, start_date, end_date, branch_id, next_term_begins } = req.body; // session, branch_id, and next_term_begins are optional

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
            session: session || null,
            branch_id: termBranchId || null,
            start_date,
            end_date,
            next_term_begins: next_term_begins || null,
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
        let branchId = null;
        const { roles, id: userId } = req.user;

        // Determine the branch_id based on user role
        if (roles.includes('Admin') || roles.includes('Teacher') || roles.includes('NonTeachingStaff')) {
            const [staff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
            if (staff.length > 0) {
                branchId = staff[0].branch_id;
            }
        } else if (roles.includes('Student') || roles.includes('Parent')) {
            // A parent's branch is determined by their child's branch. This assumes one child for simplicity.
            // A more complex system would need to know which child's context we are in.
            const [student] = await pool.query(`
                SELECT s.branch_id 
                FROM students s
                LEFT JOIN parents p ON s.parent_id = p.id
                WHERE s.user_id = ? OR p.user_id = ?
                LIMIT 1
            `, [userId, userId]);
            if (student.length > 0) {
                branchId = student[0].branch_id;
            }
        }
        // SuperAdmin has branchId = null, so they will check for global/most recent terms.

        let term = null;

        // 1. Try to find a branch-specific active term
        if (branchId) {
            const [terms] = await pool.query('SELECT * FROM terms WHERE is_active = TRUE AND branch_id = ?', [branchId]);
            if (terms.length > 0) {
                term = terms[0];
            }
        }

        // 2. If no branch-specific term, try to find a global active term
        if (!term) {
            const [globalTerms] = await pool.query('SELECT * FROM terms WHERE is_active = TRUE AND branch_id IS NULL ORDER BY start_date DESC');
            if (globalTerms.length > 0) {
                term = globalTerms[0];
            }
        }
        
        // 3. If still no term and user is SuperAdmin, find the most recent active term regardless of branch
        if (!term && roles.includes('SuperAdmin')) {
             const [anyActiveTerm] = await pool.query('SELECT * FROM terms WHERE is_active = TRUE ORDER BY start_date DESC');
             if (anyActiveTerm.length > 0) {
                term = anyActiveTerm[0];
             }
        }


        if (!term) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }

        res.json({
            success: true,
            data: term
        });
    } catch (error) {
        console.error('Get current term error:', error);
        res.status(500).json({ success: false, message: 'Server error while retrieving current term.' });
    }
});


// PUT /api/terms/:id - Update a term
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { name, session, start_date, end_date, next_term_begins, is_active } = req.body;

    // Basic validation
    if (!name && !session && !start_date && !end_date && !next_term_begins && is_active === undefined) {
        return res.status(400).json({ success: false, message: 'No fields to update provided.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Fetch the existing term
        const [terms] = await connection.query('SELECT * FROM terms WHERE id = ?', [id]);
        if (terms.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }
        const term = terms[0];

        // Authorization check for Admin
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (term.branch_id !== adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only edit terms for their own branch.' });
            }
        }
        
        // If is_active is being set to true, deactivate other terms in the same branch/scope
        if (is_active === true) {
            if (term.branch_id) {
                await connection.query('UPDATE terms SET is_active = FALSE WHERE branch_id = ? AND id != ?', [term.branch_id, id]);
            } else {
                await connection.query('UPDATE terms SET is_active = FALSE WHERE branch_id IS NULL AND id != ?', [id]);
            }
        }


        // Build the update query
        const fieldsToUpdate = {};
        if (name) fieldsToUpdate.name = name;
        if (session) fieldsToUpdate.session = session;
        if (start_date) fieldsToUpdate.start_date = start_date;
        if (end_date) fieldsToUpdate.end_date = end_date;
        if (next_term_begins) fieldsToUpdate.next_term_begins = next_term_begins;
        if (is_active !== undefined) fieldsToUpdate.is_active = is_active;


        if (Object.keys(fieldsToUpdate).length === 0) {
             await connection.rollback();
            return res.status(400).json({ success: false, message: 'No valid fields to update provided.' });
        }


        await connection.query('UPDATE terms SET ? WHERE id = ?', [fieldsToUpdate, id]);

        await connection.commit();

        // Fetch the updated term to return
        const [updatedTerms] = await pool.query('SELECT * FROM terms WHERE id = ?', [id]);

        res.json({ success: true, message: 'Term updated successfully.', data: updatedTerms[0] });

    } catch (error) {
        await connection.rollback();
        console.error('Update term error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating term.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
