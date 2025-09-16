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

// @route   POST /api/classrooms
// @desc    Create a new classroom
// @access  Admin, SuperAdmin
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { name, branch_id } = req.body;

    if (!name || !branch_id) {
        return res.status(400).json({ success: false, message: 'Name and branch_id are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Admin scope check
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only create classrooms for their own branch.' });
            }
        }

        const newClassroom = {
            id: uuidv4(),
            name,
            branch_id
        };

        await connection.query('INSERT INTO classrooms SET ?', newClassroom);
        await connection.commit();

        res.status(201).json({ success: true, message: 'Classroom created successfully.', data: newClassroom });

    } catch (error) {
        await connection.rollback();
        console.error('Create classroom error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating classroom.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/classrooms/branch/:branchId
// @desc    Get all classrooms for a specific branch
// @access  Admin, SuperAdmin
router.get('/branch/:branchId', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branchId } = req.params;

    try {
        // Admin scope check
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== branchId) {
                return res.status(403).json({ success: false, message: 'You are not authorized to view classrooms for this branch.' });
            }
        }

        const [rows] = await pool.query('SELECT * FROM classrooms WHERE branch_id = ?', [branchId]);
        res.json({ success: true, data: rows });

    } catch (error) {
        console.error('Get classrooms error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching classrooms.' });
    }
});

// @route   PUT /api/classrooms/:id
// @desc    Update a classroom
// @access  Admin, SuperAdmin
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, message: 'Name is required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Find classroom and its branch for scope check
        const [rows] = await connection.query('SELECT branch_id FROM classrooms WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Classroom not found.' });
        }

        // Admin scope check
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== rows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only update classrooms for their own branch.' });
            }
        }

        await connection.query('UPDATE classrooms SET name = ? WHERE id = ?', [name, id]);
        await connection.commit();

        res.json({ success: true, message: 'Classroom updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update classroom error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating classroom.' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/classrooms/:id
// @desc    Delete a classroom
// @access  Admin, SuperAdmin
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT branch_id FROM classrooms WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Classroom not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== rows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only delete classrooms for their own branch.' });
            }
        }

        await connection.query('DELETE FROM classrooms WHERE id = ?', [id]);
        await connection.commit();

        res.json({ success: true, message: 'Classroom deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete classroom error:', error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ success: false, message: 'Cannot delete classroom. It is currently in use by other records (e.g., timetables).' });
        }
        res.status(500).json({ success: false, message: 'Server error while deleting classroom.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
