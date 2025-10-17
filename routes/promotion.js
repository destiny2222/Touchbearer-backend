const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// @route   POST /api/promote/students
// @desc    Promote one or more students to a new class
// @access  Teacher
router.post('/students', [auth, authorize(['Teacher'])], async (req, res) => {
    const { student_ids, next_class_id } = req.body;

    if (!Array.isArray(student_ids) || student_ids.length === 0 || !next_class_id) {
        return res.status(400).json({ success: false, message: 'An array of student IDs and a next class ID are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the logged-in teacher's staff ID.
        const [staffRows] = await connection.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);
        if (staffRows.length === 0) {
            throw new Error('You are not registered as a staff member.');
        }
        const teacherStaffId = staffRows[0].id;

        // 2. Get student data and their current class.
        const [students] = await connection.query('SELECT id, class_id FROM students WHERE id IN (?)', [student_ids]);
        
        if (students.length !== student_ids.length) {
            throw new Error('One or more students not found.');
        }

        const currentClassId = students[0].class_id;

        // Verify all students are from the same class
        for (const student of students) {
            if (student.class_id !== currentClassId) {
                throw new Error('All students must be from the same class to be promoted together.');
            }
        }

        // 3. Authorization: Check if the teacher is the class teacher for the students' current class.
        const [classRows] = await connection.query('SELECT teacher_id FROM classes WHERE id = ?', [currentClassId]);
        if (classRows.length === 0) {
            throw new Error("The students' current class could not be found.");
        }
        
        if (classRows[0].teacher_id !== teacherStaffId) {
            throw new Error('Only the assigned class teacher can promote students from this class.');
        }

        // 4. Verify the next class exists
        const [nextClass] = await connection.query('SELECT id FROM classes WHERE id = ?', [next_class_id]);
        if (nextClass.length === 0) {
            throw new Error('The specified next class does not exist.');
        }

        // 5. Update students' class
        const [updateResult] = await connection.query(
            'UPDATE students SET class_id = ? WHERE id IN (?)',
            [next_class_id, student_ids]
        );

        await connection.commit();

        res.json({ 
            success: true, 
            message: `${updateResult.affectedRows} student(s) promoted successfully.` 
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error promoting students:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error while promoting students.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
