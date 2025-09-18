const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get a staff member's branch ID from their user ID
async function getStaffBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// @route   GET /api/hospital/logs
// @desc    Get all illness logs for the admin's branch
// @access  Admin, SuperAdmin
router.get('/logs', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT il.*, CONCAT(s.first_name, ' ', s.last_name) AS student_name
            FROM illness_logs il
            JOIN students s ON il.student_id = s.id
        `;
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const branchId = await getStaffBranchId(req.user.id);
            if (branchId) {
                query += ' WHERE il.branch_id = ?';
                params.push(branchId);
            } else {
                return res.json({ success: true, data: [] });
            }
        }

        query += ' ORDER BY il.admitted_at DESC';
        const [logs] = await pool.query(query, params);
        res.json({ success: true, data: logs });

    } catch (err) {
        console.error('Error fetching illness logs:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching illness logs.' });
    }
});

// @route   POST /api/hospital/logs
// @desc    Create a new illness log
// @access  Admin, SuperAdmin
router.post('/logs', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { student_id, illness, symptoms, treatment, admitted_at, notes } = req.body;

    if (!student_id || !illness || !symptoms || !treatment || !admitted_at) {
        return res.status(400).json({ success: false, message: 'student_id, illness, symptoms, treatment, and admitted_at are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [studentRows] = await connection.query('SELECT branch_id, first_name, last_name FROM students WHERE id = ?', [student_id]);
        if (studentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentRows[0];

        const newLog = {
            id: uuidv4(),
            student_id,
            illness,
            symptoms,
            treatment,
            admitted_at,
            notes: notes || null,
            branch_id: student.branch_id,
            logged_by: req.user.id
        };

        await connection.query('INSERT INTO illness_logs SET ?', newLog);
        await connection.commit();

        const responseData = {
            ...newLog,
            student_name: `${student.first_name} ${student.last_name}`,
            discharged_at: null
        };

        res.status(201).json({ success: true, message: 'Log created successfully!', data: responseData });

    } catch (error) {
        await connection.rollback();
        console.error('Create illness log error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating illness log.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   PUT /api/hospital/logs/:id
// @desc    Update an illness log
// @access  Admin, SuperAdmin
router.put('/logs/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { student_id, illness, symptoms, treatment, admitted_at, notes } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [logRows] = await connection.query('SELECT branch_id FROM illness_logs WHERE id = ?', [id]);
        if (logRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Log not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getStaffBranchId(req.user.id);
            if (adminBranchId !== logRows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to update this log.' });
            }
        }

        const updateFields = {};
        if (student_id) updateFields.student_id = student_id;
        if (illness) updateFields.illness = illness;
        if (symptoms) updateFields.symptoms = symptoms;
        if (treatment) updateFields.treatment = treatment;
        if (admitted_at) updateFields.admitted_at = admitted_at;
        if (notes) updateFields.notes = notes;

        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE illness_logs SET ? WHERE id = ?', [updateFields, id]);
        }

        await connection.commit();

        const [updatedLog] = await pool.query('SELECT * FROM illness_logs WHERE id = ?', [id]);
        res.json({ success: true, message: 'Log updated successfully!', data: updatedLog[0] });

    } catch (error) {
        await connection.rollback();
        console.error('Update illness log error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating illness log.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   DELETE /api/hospital/logs/:id
// @desc    Delete an illness log
// @access  Admin, SuperAdmin
router.delete('/logs/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [logRows] = await connection.query('SELECT branch_id FROM illness_logs WHERE id = ?', [id]);
        if (logRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Log not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getStaffBranchId(req.user.id);
            if (adminBranchId !== logRows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to delete this log.' });
            }
        }

        await connection.query('DELETE FROM illness_logs WHERE id = ?', [id]);
        await connection.commit();

        res.json({ success: true, message: 'Log deleted successfully!' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete illness log error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting illness log.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   POST /api/hospital/logs/:id/discharge
// @desc    Discharge a student
// @access  Admin, SuperAdmin
router.post('/logs/:id/discharge', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [logRows] = await connection.query('SELECT branch_id FROM illness_logs WHERE id = ?', [id]);
        if (logRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Log not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getStaffBranchId(req.user.id);
            if (adminBranchId !== logRows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to discharge this student.' });
            }
        }

        await connection.query('UPDATE illness_logs SET discharged_at = NOW() WHERE id = ?', [id]);
        await connection.commit();

        const [updatedLog] = await pool.query('SELECT * FROM illness_logs WHERE id = ?', [id]);
        res.json({ success: true, message: 'Student discharged successfully!', data: updatedLog[0] });

    } catch (error) {
        await connection.rollback();
        console.error('Discharge student error:', error);
        res.status(500).json({ success: false, message: 'Server error while discharging student.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   GET /api/hospital/logs/my-children
// @desc    Get all illness logs for the logged-in parent's children
// @access  Parent
router.get('/logs/my-children', [auth, authorize(['Parent'])], async (req, res) => {
    const { id: userId } = req.user;

    try {
        const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [userId]);
        if (parent.length === 0) {
            return res.status(403).json({ success: false, message: 'Forbidden. User is not a parent.' });
        }
        const parentId = parent[0].id;

        const [children] = await pool.query('SELECT id FROM students WHERE parent_id = ?', [parentId]);
        if (children.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const childrenIds = children.map(child => child.id);
        const [logs] = await pool.query('SELECT * FROM illness_logs WHERE student_id IN (?) ORDER BY admitted_at DESC', [childrenIds]);
        res.json({ success: true, data: logs });

    } catch (err) {
        console.error('Error fetching student illness logs:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching illness logs.' });
    }
});

module.exports = router;
