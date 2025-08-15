const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');

// @route   POST /api/expenses
// @desc    Add a new expense
// @access  Admin, SuperAdmin
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { title, description, cost, due_date, branch, expense_type } = req.body;

    if (!title || !cost || !due_date || !branch || !expense_type) {
        return res.status(400).json({ message: 'Please enter all required fields' });
    }

    try {
        const newExpense = {
            id: uuidv4(),
            title,
            description,
            cost,
            due_date,
            branch,
            expense_type,
            author: req.user.email,
        };

        await pool.query('INSERT INTO expenses SET ?', newExpense);

        res.status(201).json({ message: 'Expense added successfully', expense: newExpense });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/expenses/:id/approve
// @desc    Approve an expense
// @access  Admin, SuperAdmin
router.put('/:id/approve', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        const [expense] = await pool.query('SELECT * FROM expenses WHERE id = ?', [req.params.id]);

        if (expense.length === 0) {
            return res.status(404).json({ message: 'Expense not found' });
        }

        await pool.query('UPDATE expenses SET status = ? WHERE id = ?', ['Approved', req.params.id]);

        res.json({ message: 'Expense approved successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/expenses/:id/decline
// @desc    Decline an expense
// @access  Admin, SuperAdmin
router.put('/:id/decline', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
        return res.status(400).json({ message: 'Rejection reason is required' });
    }

    try {
        const [expense] = await pool.query('SELECT * FROM expenses WHERE id = ?', [req.params.id]);

        if (expense.length === 0) {
            return res.status(404).json({ message: 'Expense not found' });
        }

        await pool.query('UPDATE expenses SET status = ?, rejection_reason = ? WHERE id = ?', ['Rejected', rejection_reason, req.params.id]);

        res.json({ message: 'Expense declined successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
