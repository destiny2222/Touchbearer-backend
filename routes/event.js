const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Get all events
router.get('/events', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        let query = 'SELECT * FROM events';
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                return res.status(403).json({ message: 'Admin not associated with any branch.' });
            }
            const adminBranchId = adminStaff[0].branch_id;
            query += ' WHERE branch_id = ?';
            queryParams.push(adminBranchId);
        }

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
