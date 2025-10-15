const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get staff info
async function getStaffInfo(userId) {
    const [rows] = await pool.query('SELECT id, branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0] : null;
}

// @route   GET /api/teachers/my-subjects
// @desc    Get all classes and subjects taught by the logged-in teacher
// @access  Teacher, Admin, SuperAdmin
router.get('/my-subjects', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        const staffInfo = await getStaffInfo(req.user.id);

        if (!staffInfo) {
            return res.status(404).json({ success: false, message: 'Staff profile not found for the logged-in user.' });
        }

        const teacherId = staffInfo.id;

        const query = `
            SELECT 
                cs.id as subject_id,
                cs.name as subject_name,
                c.id as class_id,
                c.name as class_name,
                c.arm as class_arm,
                b.school_name as branch_name
            FROM class_subjects cs
            JOIN classes c ON cs.class_id = c.id
            JOIN branches b ON c.branch_id = b.id
            WHERE cs.teacher_id = ?
            ORDER BY c.name, c.arm, cs.name;
        `;

        const [subjects] = await pool.query(query, [teacherId]);

        if (subjects.length === 0) {
            return res.json({ success: true, message: 'No subjects assigned to this teacher.', data: [] });
        }

        res.json({ success: true, data: subjects });

    } catch (error) {
        console.error('Error fetching teacher subjects:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching subjects.' });
    }
});

// @route   GET /api/teachers/my-classes
// @desc    Get all classes associated with the logged-in teacher
// @access  Teacher, Admin, SuperAdmin
router.get('/my-classes', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        const staffInfo = await getStaffInfo(req.user.id);

        if (!staffInfo) {
            return res.status(404).json({ success: false, message: 'Staff profile not found for the logged-in user.' });
        }

        const teacherId = staffInfo.id;

        const query = `
            SELECT DISTINCT
                c.id,
                c.name,
                c.arm,
                b.school_name as branch_name
            FROM classes c
            JOIN branches b ON c.branch_id = b.id
            LEFT JOIN class_subjects cs ON c.id = cs.class_id
            WHERE c.teacher_id = ? OR cs.teacher_id = ?
            ORDER BY c.name, c.arm;
        `;

        const [classes] = await pool.query(query, [teacherId, teacherId]);

        if (classes.length === 0) {
            return res.json({ success: true, message: 'No classes assigned to this teacher.', data: [] });
        }

        res.json({ success: true, data: classes });

    } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching classes.' });
    }
});

module.exports = router;
