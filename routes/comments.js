const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get staff info
async function getStaffInfo(userId) {
    const [rows] = await pool.query('SELECT id, branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0] : null;
}

// POST /api/comments/save - Save or update report card comments
router.post('/save', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin'])], async (req, res) => {
    const { student_id, term_id, teacher_comment, principal_comment } = req.body;

    // Validation
    if (!student_id || !term_id) {
        return res.status(400).json({
            success: false,
            message: 'student_id and term_id are required.'
        });
    }

    if (teacher_comment === undefined && principal_comment === undefined) {
        return res.status(400).json({
            success: false,
            message: 'At least one comment (teacher_comment or principal_comment) must be provided.'
        });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Verify student exists
        const [student] = await connection.query('SELECT id, branch_id FROM students WHERE id = ?', [student_id]);
        if (student.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const studentBranchId = student[0].branch_id;

        // Verify term exists
        const [term] = await connection.query('SELECT id FROM terms WHERE id = ?', [term_id]);
        if (term.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }

        // Authorization checks
        const staffInfo = await getStaffInfo(req.user.id);
        if (!staffInfo && (req.user.roles.includes('Teacher') || req.user.roles.includes('Admin'))) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Staff record not found.' });
        }

        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const [studentDetails] = await connection.query('SELECT class_id FROM students WHERE id = ?', [student_id]);
            const [teacherClass] = await connection.query('SELECT id FROM classes WHERE teacher_id = ? AND id = ?', [staffInfo.id, studentDetails[0].class_id]);
            if (teacherClass.length === 0) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Only the class teacher can save comments.' });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            if (staffInfo.branch_id !== studentBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You can only manage comments for students in your own branch.' });
            }
        }

        // Check for existing comment
        const [existing] = await connection.query(
            'SELECT id FROM report_card_comments WHERE student_id = ? AND term_id = ?',
            [student_id, term_id]
        );

        if (existing.length > 0) {
            // Update existing comment
            const fieldsToUpdate = {};
            if (teacher_comment !== undefined) fieldsToUpdate.teacher_comment = teacher_comment;
            if (principal_comment !== undefined) fieldsToUpdate.principal_comment = principal_comment;

            await connection.query(
                'UPDATE report_card_comments SET ? WHERE id = ?',
                [fieldsToUpdate, existing[0].id]
            );
        } else {
            // Insert new comment
            const commentId = uuidv4();
            await connection.query(
                'INSERT INTO report_card_comments (id, student_id, term_id, teacher_comment, principal_comment) VALUES (?, ?, ?, ?, ?)',
                [commentId, student_id, term_id, teacher_comment || null, principal_comment || null]
            );
        }

        await connection.commit();

        res.status(200).json({
            success: true,
            message: 'Comments saved successfully.'
        });

    } catch (err) {
        await connection.rollback();
        console.error('Error saving comments:', err);
        res.status(500).json({ success: false, message: 'Server error while saving comments.' });
    } finally {
        connection.release();
    }
});


// POST /api/comments/principal - Save principal comments (single or bulk with personalized comments)
router.post('/principal', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { student_id, students, term_id, principal_comment } = req.body;

    // Validation
    if (!term_id) {
        return res.status(400).json({
            success: false,
            message: 'term_id is required.'
        });
    }

    // Must provide either student_id with principal_comment OR students array
    if (!student_id && (!students || !Array.isArray(students) || students.length === 0)) {
        return res.status(400).json({
            success: false,
            message: 'Either student_id (single) or students (array) must be provided.'
        });
    }

    if (student_id && (!principal_comment || principal_comment.trim() === '')) {
        return res.status(400).json({
            success: false,
            message: 'principal_comment is required when using student_id.'
        });
    }

    if (students) {
        // Validate each student object has required fields
        for (const student of students) {
            if (!student.student_id || !student.principal_comment || student.principal_comment.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Each student must have student_id and principal_comment.'
                });
            }
        }
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Verify term exists
        const [term] = await connection.query('SELECT id FROM terms WHERE id = ?', [term_id]);
        if (term.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }

        // Prepare students data
        let studentsData = [];
        if (student_id) {
            // Single student
            studentsData = [{ student_id, principal_comment }];
        } else {
            // Multiple students with personalized comments
            studentsData = students;
        }

        // Extract all student IDs for validation
        const studentIds = studentsData.map(s => s.student_id);

        // Authorization check for Admin (not SuperAdmin)
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Staff record not found.' });
            }

            // Verify all students belong to admin's branch
            const placeholders = studentIds.map(() => '?').join(',');
            const [studentsInDb] = await connection.query(
                `SELECT id, branch_id FROM students WHERE id IN (${placeholders})`,
                studentIds
            );

            if (studentsInDb.length !== studentIds.length) {
                await connection.rollback();
                return res.status(404).json({ 
                    success: false, 
                    message: 'One or more students not found.' 
                });
            }

            const unauthorizedStudents = studentsInDb.filter(s => s.branch_id !== staffInfo.branch_id);
            if (unauthorizedStudents.length > 0) {
                await connection.rollback();
                return res.status(403).json({ 
                    success: false, 
                    message: 'You can only manage comments for students in your own branch.' 
                });
            }
        } else {
            // SuperAdmin - still verify students exist
            const placeholders = studentIds.map(() => '?').join(',');
            const [studentsInDb] = await connection.query(
                `SELECT id FROM students WHERE id IN (${placeholders})`,
                studentIds
            );

            if (studentsInDb.length !== studentIds.length) {
                await connection.rollback();
                return res.status(404).json({ 
                    success: false, 
                    message: 'One or more students not found.' 
                });
            }
        }

        // Process each student with their personalized comment
        let updatedCount = 0;
        let createdCount = 0;
        const results = [];

        for (const studentData of studentsData) {
            const { student_id: studentId, principal_comment: comment } = studentData;

            // Check for existing comment
            const [existing] = await connection.query(
                'SELECT id FROM report_card_comments WHERE student_id = ? AND term_id = ?',
                [studentId, term_id]
            );

            if (existing.length > 0) {
                // Update existing comment
                await connection.query(
                    'UPDATE report_card_comments SET principal_comment = ? WHERE id = ?',
                    [comment, existing[0].id]
                );
                updatedCount++;
                results.push({ student_id: studentId, action: 'updated' });
            } else {
                // Insert new comment
                const commentId = uuidv4();
                await connection.query(
                    'INSERT INTO report_card_comments (id, student_id, term_id, teacher_comment, principal_comment) VALUES (?, ?, ?, ?, ?)',
                    [commentId, studentId, term_id, null, comment]
                );
                createdCount++;
                results.push({ student_id: studentId, action: 'created' });
            }
        }

        await connection.commit();

        res.status(200).json({
            success: true,
            message: 'Principal comments saved successfully.',
            summary: {
                total_students: studentsData.length,
                updated: updatedCount,
                created: createdCount
            },
            details: results
        });

    } catch (err) {
        await connection.rollback();
        console.error('Error saving principal comments:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error while saving principal comments.' 
        });
    } finally {
        connection.release();
    }
});

module.exports = router;
