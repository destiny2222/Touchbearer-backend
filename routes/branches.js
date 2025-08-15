const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');

router.post('/store', auth, async (req, res) => {
    if (!req.user.roles.includes('SuperAdmin')) {
        return res.status(403).json({ message: 'Access denied' });
    }

    const { school_name, address, "admin-email": email, basic_education, is_active } = req.body;

    if (!school_name || !address || !email || !basic_education) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        const branchId = uuidv4();
        const branchData = {
            id: branchId,
            school_name,
            address,
            email,
            basic_education: JSON.stringify(basic_education),
            is_active: is_active || 1
        };
        await pool.query('INSERT INTO branches SET ?', branchData);
        res.status(201).json({ message: 'Branch created' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:branchId/update', auth, async (req, res) => {
    if (!req.user.roles.includes('SuperAdmin')) {
        return res.status(403).json({ message: 'Access denied' });
    }

    const { school_name, "admin-address": address, email, basic_education, is_active } = req.body;

    if (!school_name || !address || !email || !basic_education) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        await pool.query('UPDATE branches SET school_name = ?, address = ?, email = ?, basic_education = ?, is_active = ? WHERE id = ?', [school_name, address, email, JSON.stringify(basic_education), is_active, req.params.branchId]);
        res.json({ message: 'Branch updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/', async (req, res) => {
    try {
        const [branches] = await pool.query('SELECT * FROM branches');
        res.json(branches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', auth, async (req, res) => {
    if (!req.user.roles.includes('SuperAdmin')) {
        return res.status(403).json({ message: 'Access denied' });
    }

    try {
        await pool.query('DELETE FROM branches WHERE id = ?', [req.params.id]);
        res.json({ message: 'Branch deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
