const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get a teacher's staff ID from their user ID
async function getTeacherStaffId(userId) {
    const [rows] = await pool.query('SELECT id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].id : null;
}

// @route   POST /api/assignments
// @desc    Create a new assignment for a class
// @access  Teacher
router.post('/', [auth, authorize(['Teacher'])], async (req, res) => {
    const { title, details, class_id, subject, due_date } = req.body;

    if (!title || !class_id || !subject || !due_date) {
        return res.status(400).json({ success: false, message: 'Title, class_id, subject, and due_date are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const teacher_id = await getTeacherStaffId(req.user.id);
        if (!teacher_id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'User is not a teacher.' });
        }

        const [classRows] = await connection.query('SELECT branch_id, teacher_id FROM classes WHERE id = ?', [class_id]);
        if (classRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }

        // Authorization: Ensure the teacher is assigned to the class they are creating an assignment for
        if (classRows[0].teacher_id !== teacher_id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'You are not authorized to create assignments for this class.' });
        }

        const branch_id = classRows[0].branch_id;

        const newAssignment = {
            id: uuidv4(),
            title,
            details: details || null,
            class_id,
            branch_id,
            teacher_id,
            subject,
            due_date
        };

        await connection.query('INSERT INTO assignments SET ?', newAssignment);
        await connection.commit();

        res.status(201).json({ success: true, message: 'Assignment created successfully.', data: newAssignment });

    } catch (error) {
        await connection.rollback();
        console.error('Create assignment error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating assignment.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/assignments/class/:classId
// @desc    Get all assignments for a specific class
// @access  Teacher, Student
router.get('/class/:classId', [auth, authorize(['Teacher', 'Student'])], async (req, res) => {
    const { classId } = req.params;

    try {
        const query = `
            SELECT a.*, t.name as teacher_name 
            FROM assignments a
            JOIN staff t ON a.teacher_id = t.id
            WHERE a.class_id = ? 
            ORDER BY a.due_date ASC
        `;
        const [assignments] = await pool.query(query, [classId]);
        res.json({ success: true, data: assignments });

    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching assignments.' });
    }
});


// @route   PUT /api/assignments/:id
// @desc    Update an assignment
// @access  Teacher
router.put('/:id', [auth, authorize(['Teacher'])], async (req, res) => {
    const { id } = req.params;
    const { title, details, subject, due_date } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [assignmentRows] = await connection.query('SELECT teacher_id FROM assignments WHERE id = ?', [id]);
        if (assignmentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const teacher_id = await getTeacherStaffId(req.user.id);
        if (!teacher_id || assignmentRows[0].teacher_id !== teacher_id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'You are not authorized to update this assignment.' });
        }

        const updateFields = {};
        if (title) updateFields.title = title;
        if (details) updateFields.details = details;
        if (subject) updateFields.subject = subject;
        if (due_date) updateFields.due_date = due_date;

        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE assignments SET ? WHERE id = ?', [updateFields, id]);
        }

        await connection.commit();

        res.json({ success: true, message: 'Assignment updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update assignment error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating assignment.' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/assignments/:id
// @desc    Delete an assignment
// @access  Teacher
router.delete('/:id', [auth, authorize(['Teacher'])], async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [assignmentRows] = await connection.query('SELECT teacher_id FROM assignments WHERE id = ?', [id]);
        if (assignmentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const teacher_id = await getTeacherStaffId(req.user.id);
        if (!teacher_id || assignmentRows[0].teacher_id !== teacher_id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'You are not authorized to delete this assignment.' });
        }

        await connection.query('DELETE FROM assignments WHERE id = ?', [id]);
        await connection.commit();

        res.json({ success: true, message: 'Assignment deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete assignment error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting assignment.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
