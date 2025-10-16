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

        if (req.user.roles.includes('Teacher') || req.user.roles.includes('Admin')) {
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

module.exports = router;
