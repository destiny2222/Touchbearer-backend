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
        const [classRows] = await connection.query('SELECT teacher_id, branch_id FROM classes WHERE id = ?', [currentClassId]);
        if (classRows.length === 0) {
            throw new Error("The students' current class could not be found.");
        }
        
        if (classRows[0].teacher_id !== teacherStaffId) {
            throw new Error('Only the assigned class teacher can promote students from this class.');
        }

        const currentBranchId = classRows[0].branch_id;

        // 4. Verify the next class exists and get its branch
        const [nextClass] = await connection.query('SELECT id, branch_id FROM classes WHERE id = ?', [next_class_id]);
        if (nextClass.length === 0) {
            throw new Error('The specified next class does not exist.');
        }

        const nextBranchId = nextClass[0].branch_id;

        // 5. Cross-session validation: Must have Third Term results to promote
        // Get the latest Third Term result for each student
        const [thirdTermResults] = await connection.query(
            `SELECT sr.student_id, sr.class_id, t.session, t.branch_id
             FROM student_results sr
             JOIN terms t ON sr.term_id = t.id
             WHERE sr.student_id IN (?) AND t.name = 'Third Term'
             ORDER BY sr.created_at DESC`,
            [student_ids]
        );

        // Check each student has Third Term results
        const studentsWithThirdTerm = new Set(thirdTermResults.map(r => r.student_id));
        for (const studentId of student_ids) {
            if (!studentsWithThirdTerm.has(studentId)) {
                throw new Error(`Student does not have Third Term results. Cannot promote without completing the academic session.`);
            }
        }

        // Get the session from the third term results (should be the same for all)
        const currentSession = thirdTermResults[0].session;
        
        // Calculate the next session: 2025/2026 -> 2026/2027
        const sessionParts = currentSession.split('/');
        if (sessionParts.length !== 2) {
            throw new Error('Invalid session format in student results.');
        }
        
        const startYear = parseInt(sessionParts[0]);
        const endYear = parseInt(sessionParts[1]);
        const nextSession = `${startYear + 1}/${endYear + 1}`;

        // Verify the next class has terms in the next session
        const [nextSessionTerms] = await connection.query(
            "SELECT id FROM terms WHERE session = ? AND (branch_id = ? OR branch_id IS NULL) LIMIT 1",
            [nextSession, nextBranchId]
        );

        if (nextSessionTerms.length === 0) {
            throw new Error(`No terms found for session ${nextSession}. Please create the new academic session terms before promoting students.`);
        }

        // 6. Update students' class
        const [updateResult] = await connection.query(
            'UPDATE students SET class_id = ? WHERE id IN (?)',
            [next_class_id, student_ids]
        );

        await connection.commit();

        res.json({ 
            success: true, 
            message: `${updateResult.affectedRows} student(s) promoted successfully to ${nextSession} session.` 
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