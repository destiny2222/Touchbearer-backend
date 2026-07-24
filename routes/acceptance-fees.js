const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// @route   GET /api/acceptance-fees/my-branch
// @desc    Get all acceptance fees for the admin's branch
// @access  Admin
router.get('/my-branch', [auth, authorize(['Admin'])], async (req, res) => {
    try {
        const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
        if (adminStaff.length === 0) {
            return res.status(403).json({ success: false, message: 'Admin not associated with a branch.' });
        }
        const branch_id = adminStaff[0].branch_id;

        const [fees] = await pool.query('SELECT id, branch_id, program_type, amount FROM acceptance_fees WHERE branch_id = ?', [branch_id]);
        if (fees.length === 0) {
            return res.status(404).json({ success: false, message: 'No acceptance fees set for this branch.' });
        }
        res.json({ success: true, data: fees });
    } catch (error) {
        console.error('Get acceptance fee for admin branch error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching acceptance fee.' });
    }
});

// @route   GET /api/acceptance-fees
// @desc    Get acceptance fees for all branches
// @access  SuperAdmin
router.get('/', [auth, authorize(['SuperAdmin'])], async (req, res) => {
    try {
        const [fees] = await pool.query(`
            SELECT af.amount, af.branch_id, af.program_type, b.school_name as branch_name
            FROM acceptance_fees af
            JOIN branches b ON af.branch_id = b.id
        `);
        res.json({ success: true, data: fees });
    } catch (error) {
        console.error('Get all acceptance fees error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching acceptance fees.' });
    }
});

// @route   GET /api/acceptance-fees/branch/:branch_id
// @desc    Get the acceptance fees for a specific branch
// @access  Public
router.get('/branch/:branch_id', async (req, res) => {
    const { branch_id } = req.params;
    try {
        const [fees] = await pool.query('SELECT id, branch_id, program_type, amount FROM acceptance_fees WHERE branch_id = ?', [branch_id]);
        if (fees.length === 0) {
            return res.status(404).json({ success: false, message: 'No acceptance fees set for this branch.' });
        }
        res.json({ success: true, data: fees });
    } catch (error) {
        console.error('Get acceptance fee error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching acceptance fee.' });
    }
});

// @route   POST /api/acceptance-fees
// @desc    Create or update acceptance fee for a branch + program type combination
// @access  Admin (own branch), SuperAdmin (any branch)
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    let { branch_id, amount, program_type } = req.body;

    if (!branch_id || amount === undefined || amount === null) {
        return res.status(400).json({
            success: false,
            message: 'Branch ID and amount are required.'
        });
    }

    if (program_type === '') program_type = null;

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 0) {
        return res.status(400).json({
            success: false,
            message: 'Amount must be a valid non-negative number.'
        });
    }

    try {
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query(
                'SELECT branch_id FROM staff WHERE user_id = ?',
                [req.user.id]
            );
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not authorized to set the fee for this branch.'
                });
            }
        }

        const [branchCheck] = await pool.query(
            'SELECT id FROM branches WHERE id = ?',
            [branch_id]
        );
        if (branchCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found.'
            });
        }

        const insertQuery = `
            INSERT INTO acceptance_fees (branch_id, program_type, amount)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE amount = ?
        `;

        const [result] = await pool.query(insertQuery, [
            branch_id,
            program_type,
            numericAmount,
            numericAmount
        ]);

        const isNew = result.affectedRows === 1 && result.insertId;
        const statusCode = isNew ? 201 : 200;
        const action = isNew ? 'created' : 'updated';

        const [feeRows] = await pool.query(
            `SELECT id, branch_id, program_type, amount, created_at, updated_at
             FROM acceptance_fees
             WHERE branch_id = ? AND (program_type = ? OR (program_type IS NULL AND ? IS NULL))`,
            [branch_id, program_type, program_type]
        );
        const fee = feeRows[0] || null;

        res.status(statusCode).json({
            success: true,
            message: `Acceptance fee ${action} successfully.`,
            data: fee
        });

    } catch (error) {
        console.error('Set acceptance fee error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Duplicate entry conflict (should not happen with ON DUPLICATE KEY).'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Server error while setting acceptance fee.'
        });
    }
});

module.exports = router;
