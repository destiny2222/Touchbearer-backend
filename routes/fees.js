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

// POST /api/fees - Create school fees for a class
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id, class_id, term_id, name, amount, description } = req.body;

    if (!branch_id || !class_id || !term_id || !name || !amount) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    try {
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only create fees for their own branch.' });
            }
        }

        const newFee = {
            id: uuidv4(),
            branch_id,
            class_id,
            term_id,
            name,
            amount,
            description,
        };
        await pool.query('INSERT INTO fees SET ?', newFee);
        res.status(201).json({ success: true, message: 'Fee created successfully.', data: newFee });
    } catch (error) {
        console.error('Create fee error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating fee.' });
    }
});

// PUT /api/fees/:id - Update school fees for a class
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { name, amount, description } = req.body;

    try {
        const [feeRows] = await pool.query('SELECT * FROM fees WHERE id = ?', [id]);
        if (feeRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Fee not found.' });
        }
        const fee = feeRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== fee.branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only update fees for their own branch.' });
            }
        }

        const updateFields = {};
        if (name) updateFields.name = name;
        if (amount) updateFields.amount = amount;
        if (description) updateFields.description = description;

        if (Object.keys(updateFields).length > 0) {
            await pool.query('UPDATE fees SET ? WHERE id = ?', [updateFields, id]);
        }

        res.json({ success: true, message: 'Fee updated successfully.' });
    } catch (error) {
        console.error('Update fee error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating fee.' });
    }
});

// GET /api/fees/class/:classId - Retrieve fees for a specific class
router.get('/class/:classId', [auth], async (req, res) => {
    const { classId } = req.params;
    try {
        const [activeTerm] = await pool.query('SELECT id FROM terms WHERE is_active = TRUE');
        if (activeTerm.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const term_id = activeTerm[0].id;

        const [fees] = await pool.query('SELECT * FROM fees WHERE class_id = ? AND term_id = ?', [classId, term_id]);
        res.json({ success: true, data: fees });
    } catch (error) {
        console.error('Get fees by class error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching fees.' });
    }
});

// GET /api/fees/children - Show fees for each child of a parent
router.get('/children', [auth, authorize(['Parent'])], async (req, res) => {
    try {
        const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parent.length === 0) {
            return res.status(403).json({ success: false, message: 'User is not a parent.' });
        }
        const parent_id = parent[0].id;

        const [children] = await pool.query('SELECT id, class_id, first_name, last_name FROM students WHERE parent_id = ?', [parent_id]);
        if (children.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const [activeTerm] = await pool.query('SELECT id FROM terms WHERE is_active = TRUE');
        if (activeTerm.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const term_id = activeTerm[0].id;

        const feesByChild = await Promise.all(children.map(async (child) => {
            const [fees] = await pool.query('SELECT * FROM fees WHERE class_id = ? AND term_id = ?', [child.class_id, term_id]);
            const [totalFeesRow] = await pool.query('SELECT SUM(amount) as total_fees FROM fees WHERE class_id = ? AND term_id = ?', [child.class_id, term_id]);
            const total_fees = totalFeesRow[0].total_fees || 0;

            const [totalPaidRow] = await pool.query('SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?', [child.id, term_id]);
            const total_paid = totalPaidRow[0].total_paid || 0;

            const [statusRow] = await pool.query('SELECT status FROM student_payment_statuses WHERE student_id = ? AND term_id = ?', [child.id, term_id]);
            const status = statusRow.length > 0 ? statusRow[0].status : 'Not Paid';

            return {
                child_id: child.id,
                child_name: `${child.first_name} ${child.last_name}`,
                class_id: child.class_id,
                term_id,
                fees,
                total_fees,
                total_paid,
                balance: total_fees - total_paid,
                payment_status: status
            };
        }));

        res.json({ success: true, data: feesByChild });
    } catch (error) {
        console.error('Get fees for children error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching fees for children.' });
    }
});


module.exports = router;
