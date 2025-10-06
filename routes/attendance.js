const express = require('express');
const router = express.Router();
const { pool } = require('../database'); const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const crypto = require('crypto');

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

// Get attendance for all staff for a particular day (joins logs for times)
router.get('/staff/day', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { date, branch_id } = req.query || {};

    if (!date) {
        return res.status(400).json({ success: false, message: 'Missing required query param: date (YYYY-MM-DD)' });
    }

    const connection = await pool.getConnection();
    try {
        let where = '';
        const params = [date, date];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                return res.status(403).json({ success: false, message: 'Admin branch not found' });
            }
            where = ' WHERE s.branch_id = ?';
            params.push(adminStaff[0].branch_id);
        } else if (branch_id) {
            where = ' WHERE s.branch_id = ?';
            params.push(branch_id);
        }

        const query = `
            SELECT s.id AS staff_id, s.name AS staff_name, s.branch_id,
                   sa.status, sa.date,
                   l.clock_in_time, l.clock_out_time
            FROM staff s
            LEFT JOIN staff_attendance sa ON sa.staff_id = s.id AND sa.date = ?
            LEFT JOIN staff_attendance_logs l ON l.staff_id = s.id AND l.date = ?
            ${where}
            ORDER BY s.name ASC
        `;

        const [rows] = await connection.query(query, params);
        return res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching day attendance:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
});

// Get monthly attendance for the authenticated staff
router.get('/staff/me/month', auth, authorize(['Teacher', 'NonTeachingStaff', 'Admin', 'SuperAdmin']), async (req, res) => {
    const year = Number(req.query.year);
    const month = Number(req.query.month); // 1-12
    if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, message: 'Provide valid year and month (1-12)' });
    }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

    const connection = await pool.getConnection();
    try {
        const [staffRows] = await connection.query('SELECT id, branch_id FROM staff WHERE user_id = ?', [req.user.id]);
        if (staffRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff profile not found' });
        }
        const staffId = staffRows[0].id;

        const query = `
            SELECT sa.date, sa.status,
                   l.clock_in_time, l.clock_out_time
            FROM staff_attendance sa
            LEFT JOIN staff_attendance_logs l ON l.staff_id = sa.staff_id AND l.date = sa.date
            WHERE sa.staff_id = ? AND sa.date BETWEEN ? AND ?
            ORDER BY sa.date ASC
        `;

        const [rows] = await connection.query(query, [staffId, startStr, endStr]);
        return res.json({ success: true, data: rows, staff_id: staffId, year, month });
    } catch (error) {
        console.error('Error fetching monthly attendance (me):', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
});

// Get monthly attendance for a specific staff (Admin/SuperAdmin)
router.get('/staff/:staffId/month', auth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
    const { staffId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month); // 1-12
    if (!staffId || !year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, message: 'Provide staffId, year and month (1-12)' });
    }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

    const connection = await pool.getConnection();
    try {
        if (req.user.roles.includes('Admin')) {
            // Ensure staff belongs to admin branch
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                return res.status(403).json({ success: false, message: 'Admin branch not found' });
            }
            const [staffBranch] = await connection.query('SELECT branch_id FROM staff WHERE id = ?', [staffId]);
            if (staffBranch.length === 0 || staffBranch[0].branch_id !== adminStaff[0].branch_id) {
                return res.status(403).json({ success: false, message: 'You can only view staff in your branch' });
            }
        }

        const query = `
            SELECT sa.date, sa.status,
                   l.clock_in_time, l.clock_out_time
            FROM staff_attendance sa
            LEFT JOIN staff_attendance_logs l ON l.staff_id = sa.staff_id AND l.date = sa.date
            WHERE sa.staff_id = ? AND sa.date BETWEEN ? AND ?
            ORDER BY sa.date ASC
        `;
        const [rows] = await connection.query(query, [staffId, startStr, endStr]);
        return res.json({ success: true, data: rows, staff_id: staffId, year, month });
    } catch (error) {
        console.error('Error fetching monthly attendance (by staff):', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
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

// Geofenced staff clock-in/out via QR validation
router.post('/staff/clock', auth, authorize(['Teacher', 'Admin', 'SuperAdmin', 'NonTeachingStaff']), async (req, res) => {
    const { action, qrCodeData, location } = req.body || {};

    if (!action || !qrCodeData || !location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
        return res.status(400).json({ success: false, message: 'Missing or invalid fields: action, qrCodeData, location{latitude,longitude}' });
    }

    const normalizedAction = String(action).toLowerCase();
    if (!['clock-in', 'clock-out'].includes(normalizedAction)) {
        return res.status(400).json({ success: false, message: 'action must be "clock-in" or "clock-out"' });
    }

    // Validate QR secret
    const expectedSecret = process.env.STAFF_QR_SECRET;
    if (!expectedSecret) {
        return res.status(500).json({ success: false, message: 'QR secret not configured' });
    }
    const secretsEqual = crypto.timingSafeEqual(Buffer.from(qrCodeData), Buffer.from(expectedSecret));
    if (!secretsEqual) {
        return res.status(401).json({ success: false, message: 'Invalid QR code' });
    }

    const connection = await pool.getConnection();
    try {
        // Find staff and branch
        const [staffRows] = await connection.query('SELECT id, branch_id FROM staff WHERE user_id = ?', [req.user.id]);
        if (staffRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff profile not found' });
        }
        const staffId = staffRows[0].id;
        const branchId = staffRows[0].branch_id;

        // Hardcoded school coordinates (geofence validation disabled)
        const schoolLat = 6.309565;
        const schoolLng = 5.602922;
        const maxRadius = 200; // meters

        // Haversine distance in meters
        function haversineMeters(lat1, lon1, lat2, lon2) {
            const R = 6371000; // meters
            const toRad = (d) => d * Math.PI / 180;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        const distance = haversineMeters(location.latitude, location.longitude, schoolLat, schoolLng);
        if (distance > maxRadius) {
            return res.status(403).json({ success: false, message: 'User not around school location', distance_m: Math.round(distance), allowed_radius_m: maxRadius });
        }

        // Determine date (server local date)
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const today = `${yyyy}-${mm}-${dd}`;

        // Upsert on staff_attendance_logs unique (staff_id, date)
        const [rows] = await connection.query('SELECT id, clock_in_time, clock_out_time FROM staff_attendance_logs WHERE staff_id = ? AND date = ?', [staffId, today]);

        if (normalizedAction === 'clock-in') {
            if (rows.length > 0 && rows[0].clock_in_time) {
                return res.status(409).json({ success: false, message: 'Already clocked in today' });
            }

            if (rows.length === 0) {
                const id = uuidv4();
                await connection.query(
                    'INSERT INTO staff_attendance_logs (id, staff_id, branch_id, date, clock_in_time, clock_in_latitude, clock_in_longitude) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
                    [id, staffId, branchId, today, location.latitude, location.longitude]
                );
            } else {
                await connection.query(
                    'UPDATE staff_attendance_logs SET clock_in_time = NOW(), clock_in_latitude = ?, clock_in_longitude = ? WHERE id = ?',
                    [location.latitude, location.longitude, rows[0].id]
                );
            }

            // Ensure a Present record in staff_attendance (idempotent per date)
            const [existingAttendance] = await connection.query('SELECT id FROM staff_attendance WHERE staff_id = ? AND date = ?', [staffId, today]);
            if (existingAttendance.length === 0) {
                await connection.query('INSERT INTO staff_attendance (id, staff_id, branch_id, date, status) VALUES (?, ?, ?, ?, ?)', [uuidv4(), staffId, branchId, today, 'Present']);
            }

            return res.json({ success: true, message: 'Clock-in recorded', date: today });
        } else {
            // clock-out
            if (rows.length === 0 || !rows[0].clock_in_time) {
                return res.status(400).json({ success: false, message: 'You must clock-in before clocking out' });
            }
            if (rows[0].clock_out_time) {
                return res.status(409).json({ success: false, message: 'Already clocked out today' });
            }

            await connection.query(
                'UPDATE staff_attendance_logs SET clock_out_time = NOW(), clock_out_latitude = ?, clock_out_longitude = ? WHERE id = ?',
                [location.latitude, location.longitude, rows[0].id]
            );

            return res.json({ success: true, message: 'Clock-out recorded', date: today });
        }
    } catch (error) {
        console.error('Error in staff clock route:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
});


module.exports = router;