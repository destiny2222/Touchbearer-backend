const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');

// Get all events
router.get('/events', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM events');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create a new event
router.post('/events', async (req, res) => {
    const { name, description, branch_id, event_type, event_date } = req.body;

    if (!name || !description || !branch_id || !event_type || !event_date) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
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
router.put('/events/:eventId', async (req, res) => {
    const { eventId } = req.params;
    const { name, description, branch_id, event_type, event_date } = req.body;

    if (!name || !description || !branch_id || !event_type || !event_date) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        const updatedEvent = {
            name,
            description,
            branch_id,
            event_type,
            event_date
        };

        const [result] = await pool.query('UPDATE events SET ? WHERE id = ?', [updatedEvent, eventId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        res.json({ message: 'Event updated', event: { id: eventId, ...updatedEvent } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete an event
router.delete('/events/:eventId', async (req, res) => {
    const { eventId } = req.params;

    try {
        const [result] = await pool.query('DELETE FROM events WHERE id = ?', [eventId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Event not found' });
        }

        res.json({ message: 'Event deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
