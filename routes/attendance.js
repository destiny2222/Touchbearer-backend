const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

router.post('/staff', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { staff_id, branch_id, date, status } = req.body;

    if (!staff_id || !branch_id || !date || !status) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const connection = await pool.getConnection();
    try {
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                return res.status(403).json({ success: false, message: 'You can only mark attendance for your own branch.' });
            }
        }

        const [existing] = await connection.query('SELECT id FROM staff_attendance WHERE staff_id = ? AND date = ?', [staff_id, date]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Attendance for this staff member has already been marked for this date.' });
        }

        const newAttendance = {
            id: uuidv4(),
            staff_id,
            branch_id,
            date,
            status,
        };

        await connection.query('INSERT INTO staff_attendance SET ?', newAttendance);

        res.status(201).json({ success: true, message: 'Staff attendance marked successfully', data: newAttendance });
    } catch (error) {
        console.error('Error marking staff attendance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
});

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

router.post('/student', auth, authorize(['SuperAdmin', 'Admin', 'Teacher']), async (req, res) => {
    const { class_id, date, records } = req.body;

    if (!class_id || !date || !records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing or invalid required fields' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [classData] = await connection.query('SELECT branch_id FROM classes WHERE id = ?', [class_id]);
        if (classData.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }
        const branch_id = classData[0].branch_id;

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You can only mark attendance for your own branch.' });
            }
        } else if (req.user.roles.includes('Teacher')) {
            const [teacherClasses] = await connection.query('SELECT 1 FROM classes WHERE id = ? AND teacher_id = (SELECT id FROM staff WHERE user_id = ?)', [class_id, req.user.id]);
            if (teacherClasses.length === 0) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You can only mark attendance for your own class.' });
            }
        }

        const studentIds = records.map(record => record.student_id);
        const [existing] = await connection.query('SELECT student_id FROM student_attendance WHERE student_id IN (?) AND date = ?', [studentIds, date]);

        if (existing.length > 0) {
            await connection.rollback();
            const existingIds = existing.map(e => e.student_id);
            return res.status(409).json({
                success: false,
                message: 'Attendance has already been marked for one or more students on this date.',
                duplicate_students: existingIds
            });
        }

        const query = `
            INSERT INTO student_attendance (id, student_id, class_id, branch_id, date, status) 
            VALUES ?
        `;

        const values = records.map(record => {
            const status = record.status.charAt(0).toUpperCase() + record.status.slice(1);
            return [uuidv4(), record.student_id, class_id, branch_id, date, status];
        });

        await connection.query(query, [values]);

        await connection.commit();

        res.status(201).json({ success: true, message: 'Student attendance marked successfully.' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error marking student attendance:', error);
        res.status(500).json({ success: false, message: 'Server error while marking attendance.' });
    } finally {
        if (connection) connection.release();
    }
});

router.get('/student', auth, authorize(['SuperAdmin', 'Admin', 'Teacher']), async (req, res) => {
    const { class_id, branch_id, date } = req.query;

    try {
        const connection = await pool.getConnection();
        let query = 'SELECT sa.student_id, sa.status, s.first_name, s.last_name FROM student_attendance sa JOIN students s ON sa.student_id = s.id';
        const queryParams = [];
        let whereClauses = [];

        if (req.user.roles.includes('Teacher')) {
            const [teacher] = await connection.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);
            if (teacher.length > 0) {
                whereClauses.push('sa.class_id IN (SELECT id FROM classes WHERE teacher_id = ?)');
                queryParams.push(teacher[0].id);

                if (class_id) {
                    whereClauses.push('sa.class_id = ?');
                    queryParams.push(class_id);
                }
            } else {
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
                        whereClauses.push('1=0');
                    }
                }
            } else {
                whereClauses.push('1=0');
            }
        } else {
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