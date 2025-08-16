const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Create a new class
router.post('/', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { name, branch_id, teacher_id, total_student } = req.body;

    if (!name || !branch_id || !teacher_id) {
        return res.status(400).json({ success: false, message: 'Please provide name, branch_id, and teacher_id.' });
    }

    const totalStudentValue = total_student ? parseInt(total_student, 10) : 0;
    if (isNaN(totalStudentValue) || totalStudentValue < 0) {
        return res.status(400).json({ success: false, message: 'Total students must be a non-negative number.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Admin-specific check: ensure they are creating a class for their own branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You can only create classes for your own branch.' });
            }
        }

        // Check if branch exists
        const [branchExists] = await connection.query('SELECT id FROM branches WHERE id = ?', [branch_id]);
        if (branchExists.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Branch not found.' });
        }

        // Check if teacher exists in the specified branch
        const [teacherExists] = await connection.query('SELECT id, name FROM staff WHERE id = ? AND branch_id = ?', [teacher_id, branch_id]);
        if (teacherExists.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Teacher not found in the specified branch.' });
        }

        const newClass = {
            id: uuidv4(),
            name,
            branch_id,
            teacher_id,
            total_student: totalStudentValue
        };

        await connection.query('INSERT INTO classes SET ?', newClass);
        await connection.commit();

        // Return the newly created class with teacher name for immediate UI update
        res.status(201).json({
            success: true,
            message: 'Class created successfully.',
            data: {
                ...newClass,
                teacher_name: teacherExists[0].name,
                branch_name: branchExists[0].school_name // Assuming school_name from branches table
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creating class:', error);
        res.status(500).json({ success: false, message: 'Server error while creating class.' });
    } finally {
        connection.release();
    }
});

// Get all classes
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.id,
                c.name,
                c.total_student,
                c.branch_id,
                b.school_name as branch_name,
                c.teacher_id,
                s.name as teacher_name,
                c.created_at
            FROM classes c
            JOIN branches b ON c.branch_id = b.id
            JOIN staff s ON c.teacher_id = s.id
            ORDER BY c.created_at DESC
        `;
        const [classes] = await pool.query(query);
        res.json({ success: true, data: classes });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching classes.' });
    }
});

// Update an existing class
router.put('/:id', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const classId = req.params.id;
    const { name, teacher_id, total_student } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [currentClassResult] = await connection.query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (currentClassResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }
        const currentClass = currentClassResult[0];

        // Admin-specific check: ensure they can only update classes in their branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== currentClass.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You do not have permission to update this class.' });
            }
        }

        const updateFields = {};
        if (name) updateFields.name = name;
        if (total_student !== undefined) {
            const totalStudentValue = parseInt(total_student, 10);
            if (isNaN(totalStudentValue) || totalStudentValue < 0) {
                return res.status(400).json({ success: false, message: 'Total students must be a non-negative number.' });
            }
            updateFields.total_student = totalStudentValue;
        }

        let teacherName = null;
        if (teacher_id) {
            const [teacherExists] = await connection.query('SELECT id, name FROM staff WHERE id = ? AND branch_id = ?', [teacher_id, currentClass.branch_id]);
            if (teacherExists.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Assigned teacher not found in this branch.' });
            }
            updateFields.teacher_id = teacher_id;
            teacherName = teacherExists[0].name;
        }

        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE classes SET ? WHERE id = ?', [updateFields, classId]);
        }

        await connection.commit();

        const [updatedClass] = await connection.query(`
            SELECT c.id, c.name, c.total_student, c.branch_id, b.school_name as branch_name, c.teacher_id, s.name as teacher_name
            FROM classes c
            JOIN branches b ON c.branch_id = b.id
            JOIN staff s ON c.teacher_id = s.id
            WHERE c.id = ?`, [classId]);

        res.json({ success: true, message: 'Class updated successfully.', data: updatedClass[0] });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating class:', error);
        res.status(500).json({ success: false, message: 'Server error while updating class.' });
    } finally {
        connection.release();
    }
});

// Delete a class
router.delete('/:id', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const classId = req.params.id;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [currentClass] = await connection.query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (currentClass.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }

        // Admin-specific check: ensure they can only delete classes in their branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== currentClass[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You do not have permission to delete this class.' });
            }
        }

        await connection.query('DELETE FROM classes WHERE id = ?', [classId]);
        await connection.commit();

        res.json({ success: true, message: 'Class deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleting class:', error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ success: false, message: 'Cannot delete class. It is currently in use by other records (e.g., students).' });
        }
        res.status(500).json({ success: false, message: 'Server error while deleting class.' });
    } finally {
        connection.release();
    }
});


module.exports = router;