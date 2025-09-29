const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get an Admin's branch ID
async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// @route   POST /api/timetables
// @desc    Create a new timetable for a class
// @access  Admin, SuperAdmin
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { class_id, timetable_data } = req.body;

    if (!class_id || !timetable_data) {
        return res.status(400).json({ success: false, message: 'class_id and timetable_data are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Check if timetable for this class already exists
        const [existing] = await connection.query('SELECT id FROM timetables WHERE class_id = ?', [class_id]);
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ success: false, message: 'A timetable for this class already exists. Please update it instead.' });
        }

        // Get branch_id from the class
        const [classRows] = await connection.query('SELECT branch_id FROM classes WHERE id = ?', [class_id]);
        if (classRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }
        const branch_id = classRows[0].branch_id;

        // Admin scope check
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only create timetables for their own branch.' });
            }
        }

        const newTimetable = {
            id: uuidv4(),
            class_id,
            branch_id,
            timetable_data: JSON.stringify(timetable_data) // Store as a JSON string
        };

        await connection.query('INSERT INTO timetables SET ?', newTimetable);
        await connection.commit();

        res.status(201).json({ success: true, message: 'Timetable created successfully.', data: { ...newTimetable, timetable_data } });

    } catch (error) {
        await connection.rollback();
        console.error('Create timetable error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating timetable.' });
    } finally {
        connection.release();
    }
});


// @route   GET /api/timetables/class/:classId
// @desc    Get the timetable for a specific class
// @access  Admin, SuperAdmin (Could be expanded to Teacher, Student)
router.get('/class/:classId', [auth, authorize(['Admin', 'SuperAdmin', 'Teacher', 'Student'])], async (req, res) => {
    const { classId } = req.params;

    try {
        // Scope check for Admin
        if (req.user.roles.includes('Admin')) {
            const [classRows] = await pool.query('SELECT branch_id FROM classes WHERE id = ?', [classId]);
            if (classRows.length === 0) {
                return res.status(404).json({ success: false, message: 'Class not found.' });
            }
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== classRows[0].branch_id) {
                return res.status(403).json({ success: false, message: 'You are not authorized to view this timetable.' });
            }
        }

        const [rows] = await pool.query('SELECT * FROM timetables WHERE class_id = ?', [classId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No timetable found for this class.' });
        }

        const timetable = rows[0];
        const timetableData = JSON.parse(timetable.timetable_data);

        const teacherIds = new Set();
        for (const day in timetableData) {
            for (const slot of timetableData[day]) {
                if (slot.teacher_id) {
                    teacherIds.add(slot.teacher_id);
                }
            }
        }

        if (teacherIds.size > 0) {
            const [teachers] = await pool.query('SELECT id, name FROM staff WHERE id IN (?)', [Array.from(teacherIds)]);
            const teacherMap = new Map(teachers.map(t => [t.id, t.name]));

            for (const day in timetableData) {
                for (const slot of timetableData[day]) {
                    if (slot.teacher_id) {
                        slot.teacher_name = teacherMap.get(slot.teacher_id) || null;
                    }
                }
            }
        }

        timetable.timetable_data = timetableData;

        res.json({ success: true, data: timetable });

    } catch (error) {
        console.error('Get timetable error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching timetable.' });
    }
});

// @route   PUT /api/timetables/:id
// @desc    Update a timetable
// @access  Admin, SuperAdmin
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { timetable_data } = req.body;

    if (!timetable_data) {
        return res.status(400).json({ success: false, message: 'timetable_data is required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Find timetable and its branch for scope check
        const [rows] = await connection.query('SELECT branch_id FROM timetables WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Timetable not found.' });
        }

        // Admin scope check
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== rows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only update timetables for their own branch.' });
            }
        }

        await connection.query('UPDATE timetables SET timetable_data = ? WHERE id = ?', [JSON.stringify(timetable_data), id]);
        await connection.commit();

        res.json({ success: true, message: 'Timetable updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update timetable error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating timetable.' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/timetables/:id
// @desc    Delete a timetable
// @access  Admin, SuperAdmin
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT branch_id FROM timetables WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Timetable not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId !== rows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins can only delete timetables for their own branch.' });
            }
        }

        await connection.query('DELETE FROM timetables WHERE id = ?', [id]);
        await connection.commit();

        res.json({ success: true, message: 'Timetable deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete timetable error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting timetable.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
