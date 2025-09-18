const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get an Admin's branch ID
async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// @route   POST /api/inventory
// @desc    Create a new inventory item
// @access  Admin, SuperAdmin
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { name, quantity } = req.body;
    let { branch_id } = req.body;
    const added_by = req.user.id;

    if (!name || !quantity) {
        return res.status(400).json({ success: false, message: 'Name and quantity are required.' });
    }

    if (isNaN(parseInt(quantity)) || parseInt(quantity) < 0) {
        return res.status(400).json({ success: false, message: 'Quantity must be a non-negative number.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admin is not associated with any branch.' });
            }
            branch_id = adminBranchId;
        } else if (!branch_id) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'branch_id is required for SuperAdmins.' });
        }

        const newItem = {
            id: uuidv4(),
            name,
            quantity,
            branch_id,
            added_by
        };

        await connection.query('INSERT INTO inventory SET ?', newItem);
        await connection.commit();

        res.status(201).json({ success: true, message: 'Inventory item created successfully.', data: newItem });

    } catch (error) {
        await connection.rollback();
        console.error('Create inventory item error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating inventory item.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/inventory/branch
// @desc    Get all inventory items for a branch (Admin) or all branches (SuperAdmin)
// @access  Admin, SuperAdmin
router.get('/branch', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = 'SELECT i.*, u.email as added_by_email FROM inventory i JOIN users u ON i.added_by = u.id';
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' WHERE i.branch_id = ?';
                params.push(adminBranchId);
            } else {
                return res.json({ success: true, data: [] });
            }
        }

        const [rows] = await pool.query(query, params);
        res.json({ success: true, data: rows });

    } catch (error) {
        console.error('Get inventory error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching inventory.' });
    }
});

// @route   PUT /api/inventory/:id
// @desc    Update an inventory item
// @access  Admin, SuperAdmin
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { name, quantity } = req.body;

    if (!name && (quantity === undefined)) {
        return res.status(400).json({ success: false, message: 'Name or quantity is required.' });
    }

    if (quantity && (isNaN(parseInt(quantity)) || parseInt(quantity) < 0)) {
        return res.status(400).json({ success: false, message: 'Quantity must be a non-negative number.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT branch_id FROM inventory WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Inventory item not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== rows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only update inventory items for their own branch.' });
            }
        }

        const updateFields = {};
        if (name) updateFields.name = name;
        if (quantity !== undefined) updateFields.quantity = quantity;


        await connection.query('UPDATE inventory SET ? WHERE id = ?', [updateFields, id]);
        await connection.commit();

        res.json({ success: true, message: 'Inventory item updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update inventory item error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating inventory item.' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/inventory/:id
// @desc    Delete an inventory item
// @access  Admin, SuperAdmin
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT branch_id FROM inventory WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Inventory item not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== rows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only delete inventory items for their own branch.' });
            }
        }

        await connection.query('DELETE FROM inventory WHERE id = ?', [id]);
        await connection.commit();

        res.json({ success: true, message: 'Inventory item deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete inventory item error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting inventory item.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
