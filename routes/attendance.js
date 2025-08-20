const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Mark staff attendance
router.post('/staff', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { staff_id, branch_id, date, status } = req.body;

    if (!staff_id || !branch_id || !date || !status) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        const connection = await pool.getConnection();

        // Admin can only mark attendance for their own branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                connection.release();
                return res.status(403).json({ success: false, message: 'You can only mark attendance for your own branch.' });
            }
        }

        const newAttendance = {
            id: uuidv4(),
            staff_id,
            branch_id,
            date,
            status,
        };

        await connection.query('INSERT INTO staff_attendance SET ?', newAttendance);
        connection.release();

        res.status(201).json({ success: true, message: 'Staff attendance marked successfully', data: newAttendance });
    } catch (error) {
        console.error('Error marking staff attendance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get staff attendance
router.get('/staff', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { branch_id, date } = req.query;

    try {
        const connection = await pool.getConnection();
        let query = 'SELECT sa.*, s.name as staff_name FROM staff_attendance sa JOIN staff s ON sa.staff_id = s.id';
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0) {
                query += ' WHERE sa.branch_id = ?';
                queryParams.push(adminStaff[0].branch_id);
            }
        } else if (branch_id) {
            query += ' WHERE sa.branch_id = ?';
            queryParams.push(branch_id);
        }

        if (date) {
            query += query.includes('WHERE') ? ' AND' : ' WHERE';
            query += ' sa.date = ?';
            queryParams.push(date);
        }

        const [attendance] = await connection.query(query, queryParams);
        connection.release();

        res.json({ success: true, data: attendance });
    } catch (error) {
        console.error('Error fetching staff attendance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Mark student attendance
router.post('/student', auth, authorize(['SuperAdmin', 'Admin', 'Teacher']), async (req, res) => {
    const { student_id, class_id, branch_id, date, status } = req.body;

    if (!student_id || !class_id || !branch_id || !date || !status) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        const connection = await pool.getConnection();

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                connection.release();
                return res.status(403).json({ success: false, message: 'You can only mark attendance for your own branch.' });
            }
        } else if (req.user.roles.includes('Teacher')) {
            const [teacher] = await connection.query('SELECT class_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (teacher.length === 0 || !teacher[0].class_id || teacher[0].class_id !== class_id) {
                connection.release();
                return res.status(403).json({ success: false, message: 'You can only mark attendance for your own class.' });
            }
        }

        const newAttendance = {
            id: uuidv4(),
            student_id,
            class_id,
            branch_id,
            date,
            status,
        };

        await connection.query('INSERT INTO student_attendance SET ?', newAttendance);
        connection.release();

        res.status(201).json({ success: true, message: 'Student attendance marked successfully', data: newAttendance });
    } catch (error) {
        console.error('Error marking student attendance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get student attendance
router.get('/student', auth, authorize(['SuperAdmin', 'Admin', 'Teacher']), async (req, res) => {
    const { class_id, branch_id, date } = req.query;

    try {
        const connection = await pool.getConnection();
        let query = 'SELECT sa.*, s.first_name, s.last_name FROM student_attendance sa JOIN students s ON sa.student_id = s.id';
        const queryParams = [];
        let whereClauses = [];

        if (req.user.roles.includes('Teacher')) {
            const [teacher] = await connection.query('SELECT class_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (teacher.length > 0 && teacher[0].class_id) {
                whereClauses.push('sa.class_id = ?');
                queryParams.push(teacher[0].class_id);
            } else {
                // if a teacher is not assigned to a class, they should not see any attendance
                whereClauses.push('1=0');
            }
        } else if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0) {
                const adminBranchId = adminStaff[0].branch_id;
                whereClauses.push('sa.branch_id = ?');
                queryParams.push(adminBranchId);

                if (class_id) {
                    const [classBranch] = await connection.query('SELECT branch_id FROM classes WHERE id = ?', [class_id]);
                    if (classBranch.length > 0 && classBranch[0].branch_id === adminBranchId) {
                        whereClauses.push('sa.class_id = ?');
                        queryParams.push(class_id);
                    } else {
                        // if class_id is from another branch, return empty result
                        whereClauses.push('1=0');
                    }
                }
            } else {
                whereClauses.push('1=0');
            }
        } else { // SuperAdmin
            if (branch_id) {
                whereClauses.push('sa.branch_id = ?');
                queryParams.push(branch_id);
            }
            if (class_id) {
                whereClauses.push('sa.class_id = ?');
                queryParams.push(class_id);
            }
        }

        if (date) {
            whereClauses.push('sa.date = ?');
            queryParams.push(date);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        const [attendance] = await connection.query(query, queryParams);
        connection.release();

        res.json({ success: true, data: attendance });
    } catch (error) {
        console.error('Error fetching student attendance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
