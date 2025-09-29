const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../database');const { v4: uuidv4 } = require('uuid');

router.post('/register', async (req, res) => {
    const { email, password, name, phone, image } = req.body;

    if (!email || !password || !name || !phone) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        const [existingUser] = await pool.query('SELECT email FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        await pool.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [userId, email, hashedPassword]);

        const [roleResult] = await pool.query('SELECT id FROM roles WHERE name = ?', ['SuperAdmin']);
        if (roleResult.length === 0) {
            return res.status(400).json({ message: 'Invalid role' });
        }
        const roleId = roleResult[0].id;

        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);

        const superAdminId = uuidv4();
        const superAdminData = {
            id: superAdminId,
            user_id: userId,
            name,
            phone,
            image
        };
        await pool.query('INSERT INTO super_admins SET ?', superAdminData);

        res.status(201).json({ message: 'SuperAdmin registered' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
