const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// @route   POST /api/graduation/graduate
// @desc    Graduate one or more students
// @access  Admin, SuperAdmin, Teacher
router.post('/graduate', [auth, authorize(['Admin', 'SuperAdmin', 'Teacher'])], async (req, res) => {
    const { student_ids } = req.body;

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({ success: false, message: 'An array of student IDs is required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the ID for the 'Graduated' status.
        const [statusRows] = await connection.query('SELECT id FROM student_statuses WHERE name = "Graduated"');
        if (statusRows.length === 0) {
            throw new Error('"Graduated" status not found in the database.');
        }
        const graduatedStatusId = statusRows[0].id;

        // 2. Get student data for authorization checks.
        const [students] = await connection.query('SELECT id, class_id, branch_id FROM students WHERE id IN (?)', [student_ids]);
        if (students.length !== student_ids.length) {
            throw new Error('One or more students not found.');
        }

        // 3. Authorization checks
        if (req.user.roles.includes('Teacher')) {
            const [staffRows] = await connection.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staffRows.length === 0) throw new Error('You are not registered as a staff member.');
            const teacherStaffId = staffRows[0].id;

            const currentClassId = students[0].class_id;
            const [classRows] = await connection.query('SELECT teacher_id FROM classes WHERE id = ?', [currentClassId]);
            if (classRows.length === 0) throw new Error("The students' current class could not be found.");
            if (classRows[0].teacher_id !== teacherStaffId) {
                throw new Error('Only the assigned class teacher can graduate students from this class.');
            }
        } else if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) throw new Error('Admin not associated with a branch.');
            const adminBranchId = adminStaff[0].branch_id;
            for (const student of students) {
                if (student.branch_id !== adminBranchId) {
                    throw new Error('You can only graduate students within your own branch.');
                }
            }
        }

        // 4. Update students' status to 'Graduated'
        const [updateResult] = await connection.query(
            'UPDATE students SET status_id = ? WHERE id IN (?)',
            [graduatedStatusId, student_ids]
        );

        await connection.commit();

        res.json({ 
            success: true, 
            message: `${updateResult.affectedRows} student(s) have been graduated successfully.` 
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error graduating students:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error while graduating students.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
