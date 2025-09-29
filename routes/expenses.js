const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { pool } = require('../database');const { v4: uuidv4 } = require('uuid');

// @route   POST /api/expenses
// @desc    Add a new expense
// @access  Admin, SuperAdmin
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { title, description, cost, due_date, branch_id, expense_type } = req.body;

    // --- START: ROBUST VALIDATION ---
    if (!title || !due_date || !branch_id || !expense_type) {
        return res.status(400).json({ success: false, message: 'Please provide title, due_date, branch_id, and expense_type.' });
    }

    // 1. Check if 'cost' was provided at all (handles undefined and null)
    if (cost === undefined || cost === null) {
        return res.status(400).json({ success: false, message: 'The cost field is required.' });
    }

    // 2. Attempt to convert cost to a number and validate it
    const numericCost = parseFloat(cost);

    if (isNaN(numericCost) || numericCost < 0) {
        return res.status(400).json({ success: false, message: 'Cost must be a valid non-negative number.' });
    }
    // --- END: ROBUST VALIDATION ---

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Admin can only create expenses for their own branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || String(adminStaff[0].branch_id) !== String(branch_id)) { // Added String conversion for safety
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You can only create expenses for your own branch.' });
            }
        }

        const newExpense = {
            id: uuidv4(),
            title,
            description: description || '',
            cost: numericCost, // Use the validated numeric cost
            due_date,
            branch_id,
            expense_type,
            author_id: req.user.id,
            status: 'Requested', // Default status
        };

        await connection.query('INSERT INTO expenses SET ?', newExpense);
        await connection.commit();

        const [createdExpense] = await connection.query(`
            SELECT 
                e.*, 
                b.school_name as branch_name, 
                COALESCE(s.name, sa.name) as author_name
            FROM expenses e
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN staff s ON e.author_id = s.user_id
            LEFT JOIN super_admins sa ON e.author_id = sa.user_id
            WHERE e.id = ?
        `, [newExpense.id]);

        res.status(201).json({ success: true, message: 'Expense added successfully', data: createdExpense[0] });

    } catch (err) {
        await connection.rollback();
        console.error('Error creating expense:', err);
        res.status(500).json({ success: false, message: 'Server error while creating expense.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   GET /api/expenses
// @desc    Get all expenses
// @access  Admin, SuperAdmin
router.get('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT 
                e.*, 
                b.school_name as branch_name, 
                COALESCE(s.name, sa.name) as author_name
            FROM expenses e
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN staff s ON e.author_id = s.user_id
            LEFT JOIN super_admins sa ON e.author_id = sa.user_id
        `;
        const queryParams = [];

        // If user is an Admin, filter expenses by their branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0) {
                query += ' WHERE e.branch_id = ?';
                queryParams.push(adminStaff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] }); // Admin not linked to a branch
            }
        }

        query += ' ORDER BY e.created_at DESC';

        const [expenses] = await pool.query(query, queryParams);
        res.json({ success: true, data: expenses });
    } catch (err) {
        console.error('Error fetching expenses:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching expenses.' });
    }
});

// @route   PUT /api/expenses/:id/status
// @desc    Update an expense's status (Approve/Reject)
// @access  SuperAdmin
router.put('/:id/status', [auth, authorize(['SuperAdmin'])], async (req, res) => {
    const { status, rejection_reason } = req.body;
    const { id } = req.params;

    if (!status || !['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }

    if (status === 'Rejected' && !rejection_reason) {
        return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    try {
        const [expense] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
        if (expense.length === 0) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }

        const updatedFields = {
            status,
            rejection_reason: status === 'Rejected' ? rejection_reason : null,
        };

        await pool.query('UPDATE expenses SET ? WHERE id = ?', [updatedFields, id]);

        const [updatedExpense] = await pool.query(`
            SELECT 
                e.*, 
                b.school_name as branch_name, 
                COALESCE(s.name, sa.name) as author_name
            FROM expenses e
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN staff s ON e.author_id = s.user_id
            LEFT JOIN super_admins sa ON e.author_id = sa.user_id
            WHERE e.id = ?
        `, [id]);

        res.json({ success: true, message: `Expense has been ${status.toLowerCase()}.`, data: updatedExpense[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/expenses/:id
// @desc    Delete an expense
// @access  SuperAdmin
router.delete('/:id', [auth, authorize(['SuperAdmin'])], async (req, res) => {
    try {
        const [expense] = await pool.query('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
        if (expense.length === 0) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }

        await pool.query('DELETE FROM expenses WHERE id = ?', [req.params.id]);

        res.json({ success: true, message: 'Expense deleted successfully.' });
    } catch (err) {
        console.error('Error deleting expense:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


module.exports = router;