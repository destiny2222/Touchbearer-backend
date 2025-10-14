const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get staff ID and branch from user ID
async function getStaffInfo(userId) {
    const [rows] = await pool.query('SELECT id, branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0] : null;
}

// Helper function to check if teacher teaches this subject
async function isTeacherAuthorized(userId, subjectId) {
    const [rows] = await pool.query(`
        SELECT cs.* FROM class_subjects cs
        INNER JOIN staff s ON cs.teacher_id = s.id
        WHERE s.user_id = ? AND cs.id = ?
    `, [userId, subjectId]);
    return rows.length > 0;
}

// POST /api/subjects - Create a new subject
router.post('/', [auth, authorize(['Admin', 'SuperAdmin', 'Teacher'])], async (req, res) => {
    const { name, class_id, teacher_id, description } = req.body;

    if (!name || !class_id || !teacher_id) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: name, class_id, and teacher_id are required.'
        });
    }

    try {
        // Get the branch_id from the class
        const [classRows] = await pool.query('SELECT branch_id FROM classes WHERE id = ?', [class_id]);
        if (classRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }
        const branch_id = classRows[0].branch_id;

        // Verify the teacher exists
        const [teacherRows] = await pool.query('SELECT id, branch_id FROM staff WHERE id = ?', [teacher_id]);
        if (teacherRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher not found.' });
        }

        // Authorization checks
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo || staffInfo.branch_id !== branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only create subjects for their own branch.'
                });
            }
        }

        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo) {
                return res.status(403).json({ success: false, message: 'Teacher record not found.' });
            }

            // Teachers can only create subjects for themselves
            if (staffInfo.id !== teacher_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Teachers can only create subjects for themselves.'
                });
            }

            if (staffInfo.branch_id !== branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only create subjects for your own branch.'
                });
            }
        }

        // Create the subject
        const subjectId = uuidv4();
        await pool.query(
            'INSERT INTO class_subjects (id, name, class_id, teacher_id, branch_id, description) VALUES (?, ?, ?, ?, ?, ?)',
            [subjectId, name, class_id, teacher_id, branch_id, description || null]
        );

        const [newSubject] = await pool.query(`
            SELECT cs.*, c.name as class_name, s.name as teacher_name 
            FROM class_subjects cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN staff s ON cs.teacher_id = s.id
            WHERE cs.id = ?
        `, [subjectId]);

        return res.status(201).json({
            success: true,
            message: 'Subject created successfully.',
            data: newSubject[0]
        });
    } catch (err) {
        console.error('Create subject error:', err);
        return res.status(500).json({ success: false, message: 'Server error while creating subject.' });
    }
});

// GET /api/subjects/class/:class_id - Get all subjects for a specific class
router.get('/class/:class_id', auth, async (req, res) => {
    const { class_id } = req.params;

    try {
        const [subjects] = await pool.query(`
            SELECT cs.*, c.name as class_name, s.name as teacher_name, s.email as teacher_email
            FROM class_subjects cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN staff s ON cs.teacher_id = s.id
            WHERE cs.class_id = ?
            ORDER BY cs.name ASC
        `, [class_id]);

        return res.json({
            success: true,
            count: subjects.length,
            data: subjects
        });
    } catch (err) {
        console.error('Fetch subjects by class error:', err);
        return res.status(500).json({ success: false, message: 'Server error while fetching subjects.' });
    }
});

// GET /api/subjects/teacher/:teacher_id - Get all subjects for a specific teacher
router.get('/teacher/:teacher_id', auth, async (req, res) => {
    const { teacher_id } = req.params;

    try {
        const [subjects] = await pool.query(`
            SELECT cs.*, c.name as class_name, s.name as teacher_name
            FROM class_subjects cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN staff s ON cs.teacher_id = s.id
            WHERE cs.teacher_id = ?
            ORDER BY cs.name ASC
        `, [teacher_id]);

        return res.json({
            success: true,
            count: subjects.length,
            data: subjects
        });
    } catch (err) {
        console.error('Fetch subjects by teacher error:', err);
        return res.status(500).json({ success: false, message: 'Server error while fetching subjects.' });
    }
});

// GET /api/subjects/branch/:branch_id - Get all subjects for a specific branch
router.get('/branch/:branch_id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id } = req.params;

    try {
        // Authorization check for Admins
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo || staffInfo.branch_id !== branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only view subjects for their own branch.'
                });
            }
        }

        const [subjects] = await pool.query(`
            SELECT cs.*, c.name as class_name, s.name as teacher_name, s.email as teacher_email
            FROM class_subjects cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN staff s ON cs.teacher_id = s.id
            WHERE cs.branch_id = ?
            ORDER BY cs.name ASC
        `, [branch_id]);

        return res.json({
            success: true,
            count: subjects.length,
            data: subjects
        });
    } catch (err) {
        console.error('Fetch subjects by branch error:', err);
        return res.status(500).json({ success: false, message: 'Server error while fetching subjects.' });
    }
});

// GET /api/subjects/:id - Get a single subject by ID
router.get('/:id', auth, async (req, res) => {
    const { id } = req.params;

    try {
        const [subjects] = await pool.query(`
            SELECT cs.*, c.name as class_name, s.name as teacher_name, s.email as teacher_email
            FROM class_subjects cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN staff s ON cs.teacher_id = s.id
            WHERE cs.id = ?
        `, [id]);

        if (subjects.length === 0) {
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }

        return res.json({
            success: true,
            data: subjects[0]
        });
    } catch (err) {
        console.error('Fetch subject error:', err);
        return res.status(500).json({ success: false, message: 'Server error while fetching subject.' });
    }
});

// PUT /api/subjects/:id - Update a subject
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin', 'Teacher'])], async (req, res) => {
    const { id } = req.params;
    const { name, class_id, teacher_id, description } = req.body;

    try {
        // Get the existing subject
        const [existingSubject] = await pool.query('SELECT * FROM class_subjects WHERE id = ?', [id]);
        if (existingSubject.length === 0) {
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }

        const subject = existingSubject[0];

        // Authorization checks
        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const isAuthorized = await isTeacherAuthorized(req.user.id, id);
            if (!isAuthorized) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only update subjects you teach.'
                });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo || staffInfo.branch_id !== subject.branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only update subjects in their own branch.'
                });
            }
        }

        // Build update query
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (class_id !== undefined) updates.class_id = class_id;
        if (teacher_id !== undefined) updates.teacher_id = teacher_id;
        if (description !== undefined) updates.description = description;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        await pool.query('UPDATE class_subjects SET ? WHERE id = ?', [updates, id]);

        const [updatedSubject] = await pool.query(`
            SELECT cs.*, c.name as class_name, s.name as teacher_name
            FROM class_subjects cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN staff s ON cs.teacher_id = s.id
            WHERE cs.id = ?
        `, [id]);

        return res.json({
            success: true,
            message: 'Subject updated successfully.',
            data: updatedSubject[0]
        });
    } catch (err) {
        console.error('Update subject error:', err);
        return res.status(500).json({ success: false, message: 'Server error while updating subject.' });
    }
});

// DELETE /api/subjects/:id - Delete a subject
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin', 'Teacher'])], async (req, res) => {
    const { id } = req.params;

    try {
        // Get the existing subject
        const [existingSubject] = await pool.query('SELECT * FROM class_subjects WHERE id = ?', [id]);
        if (existingSubject.length === 0) {
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }

        const subject = existingSubject[0];

        // Authorization checks
        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const isAuthorized = await isTeacherAuthorized(req.user.id, id);
            if (!isAuthorized) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only delete subjects you teach.'
                });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo || staffInfo.branch_id !== subject.branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only delete subjects in their own branch.'
                });
            }
        }

        await pool.query('DELETE FROM class_subjects WHERE id = ?', [id]);

        return res.json({
            success: true,
            message: 'Subject deleted successfully.'
        });
    } catch (err) {
        console.error('Delete subject error:', err);
        return res.status(500).json({ success: false, message: 'Server error while deleting subject.' });
    }
});

module.exports = router;

