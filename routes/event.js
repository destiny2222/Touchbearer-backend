const express = require('express');
const router = express.Router();
const { pool } = require('../database');const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Get all events
router.get('/events', auth, async (req, res) => {
    try {
        let query = 'SELECT * FROM events';
        const queryParams = [];

        if (!req.user.roles.includes('SuperAdmin')) {
            const branchIds = new Set();
            const userId = req.user.id;
            const userEmail = req.user.email; // For NewStudent lookup

            // Staff (Admin, Teacher, etc.)
            if (req.user.roles.some(r => ['Admin', 'Teacher', 'NonTeachingStaff'].includes(r))) {
                const [staff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
                if (staff.length > 0) branchIds.add(staff[0].branch_id);
            }

            // Enrolled Students
            if (req.user.roles.includes('Student')) {
                const [student] = await pool.query('SELECT branch_id FROM students WHERE user_id = ?', [userId]);
                if (student.length > 0) branchIds.add(student[0].branch_id);
            }

            // New Students
            if (req.user.roles.includes('NewStudent')) {
                const [newStudent] = await pool.query('SELECT branch_id FROM new_students WHERE student_id = ?', [userEmail]);
                if (newStudent.length > 0) branchIds.add(newStudent[0].branch_id);
            }

            // Parents
            if (req.user.roles.includes('Parent')) {
                const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [userId]);
                if (parent.length > 0) {
                    const parentId = parent[0].id;
                    const [studentBranches] = await pool.query('SELECT DISTINCT branch_id FROM students WHERE parent_id = ?', [parentId]);
                    studentBranches.forEach(b => branchIds.add(b.branch_id));
                    const [newStudentBranches] = await pool.query('SELECT DISTINCT branch_id FROM new_students WHERE parent_id = ?', [parentId]);
                    newStudentBranches.forEach(b => branchIds.add(b.branch_id));
                }
            }

            const finalBranchIds = Array.from(branchIds);

            if (finalBranchIds.length > 0) {
                query += ` WHERE branch_id IN (${finalBranchIds.map(() => '?').join(',')})`;
                queryParams.push(...finalBranchIds);
            } else {
                return res.json([]);
            }
        }

        query += ' ORDER BY event_date DESC';

        const [rows] = await pool.query(query, queryParams);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create a new event
router.post('/events', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { name, description, branch_id, event_type, event_date } = req.body;

    if (!name || !description || !branch_id || !event_type || !event_date) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                return res.status(403).json({ message: 'You can only create events for your own branch.' });
            }
        }

        const newEvent = {
            id: uuidv4(),
            name,
            description,
            branch_id,
            event_type,
            event_date
        };

        await pool.query('INSERT INTO events SET ?', newEvent);
        res.status(201).json({ message: 'Event created', event: newEvent });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update an existing event
router.put('/events/:eventId', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { eventId } = req.params;
    const { name, description, branch_id, event_type, event_date } = req.body;

    try {
        const [eventResult] = await pool.query('SELECT branch_id FROM events WHERE id = ?', [eventId]);

        if (eventResult.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const currentEventBranchId = eventResult[0].branch_id;

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);

            if (adminStaff.length === 0 || adminStaff[0].branch_id !== currentEventBranchId) {
                return res.status(403).json({ message: 'You do not have permission to update this event.' });
            }
            if (branch_id && adminStaff[0].branch_id !== branch_id) {
                return res.status(403).json({ message: 'You cannot change the branch of an event.' });
            }
        }

        const updatedEvent = {};
        if (name) updatedEvent.name = name;
        if (description) updatedEvent.description = description;
        if (event_type) updatedEvent.event_type = event_type;
        if (event_date) updatedEvent.event_date = event_date;
        if (branch_id && req.user.roles.includes('SuperAdmin')) {
            updatedEvent.branch_id = branch_id;
        }

        if (Object.keys(updatedEvent).length === 0) {
            return res.status(400).json({ message: 'No fields to update provided.' });
        }

        await pool.query('UPDATE events SET ? WHERE id = ?', [updatedEvent, eventId]);

        res.json({ message: 'Event updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete an event
router.delete('/events/:eventId', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { eventId } = req.params;

    try {
        const [eventResult] = await pool.query('SELECT branch_id FROM events WHERE id = ?', [eventId]);

        if (eventResult.length === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        if (req.user.roles.includes('Admin')) {
            const currentEventBranchId = eventResult[0].branch_id;
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== currentEventBranchId) {
                return res.status(403).json({ message: 'You do not have permission to delete this event.' });
            }
        }

        await pool.query('DELETE FROM events WHERE id = ?', [eventId]);

        res.json({ message: 'Event deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
