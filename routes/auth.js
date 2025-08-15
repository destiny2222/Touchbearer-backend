const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const cache = require('memory-cache');

const auth = require('../middleware/auth');

router.post('/register/student', async (req, res) => {
    const {
        first_name,
        last_name,
        dob,
        passport,
        address,
        nationality,
        state,
        class_applying,
        branch_id,
        previous_school,
        religion,
        disability,
        parent_name,
        parent_phone,
        parent_email
    } = req.body;

    if (!first_name || !last_name || !dob || !passport || !address || !nationality || !state || !class_applying || !branch_id || !religion || !parent_name || !parent_phone || !parent_email) {
        return res.status(400).json({ message: 'Please enter all required fields' });
    }

    try {
        let [parent] = await pool.query('SELECT * FROM parents WHERE email = ?', [parent_email]);

        let parentId;
        if (parent.length === 0) {
            const password = Math.random().toString(36).slice(-8);
            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = uuidv4();
            parentId = uuidv4();

            await pool.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [userId, parent_email, hashedPassword]);

            const [roleResult] = await pool.query('SELECT id FROM roles WHERE name = ?', ['Parent']);
            const roleId = roleResult[0].id;
            await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);

            const parentData = {
                id: parentId,
                user_id: userId,
                name: parent_name,
                phone: parent_phone,
                email: parent_email
            };
            await pool.query('INSERT INTO parents SET ?', parentData);
        } else {
            parentId = parent[0].id;
        }

        const studentId = uuidv4();
        const studentData = {
            id: studentId,
            parent_id: parentId,
            first_name,
            last_name,
            dob,
            passport,
            address,
            nationality,
            state,
            class_applying,
            branch_id,
            previous_school,
            religion,
            disability,
            score: req.body.score || 0,
            payment_status: req.body.payment_status || 'pending'
        };

        await pool.query('INSERT INTO new_students SET ?', studentData);

        res.status(201).json({ message: 'Student registered successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/register', auth, async (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    if (!req.user.roles.includes('SuperAdmin')) {
        return res.status(403).json({ message: 'Access denied' });
    }

    try {
        const [existingUser] = await pool.query('SELECT email FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        await pool.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [userId, email, hashedPassword]);

        const [roleResult] = await pool.query('SELECT id FROM roles WHERE name = ?', [role]);
        if (roleResult.length === 0) {
            return res.status(400).json({ message: 'Invalid role' });
        }
        const roleId = roleResult[0].id;

        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);

        res.status(201).json({ message: 'User registered' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        let roles = cache.get(user.id);
        if (!roles) {
            const [rolesResult] = await pool.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
            roles = rolesResult.map(r => r.name);
            cache.put(user.id, roles, 6000000); // Cache for 100 minutes
        }

        const token = jwt.sign({ id: user.id, roles }, process.env.JWT_SECRET, { expiresIn: '1h' });

        if (roles.includes('SuperAdmin')) {
            const [superAdminResult] = await pool.query('SELECT * FROM super_admins WHERE user_id = ?', [user.id]);
            const superAdmin = superAdminResult[0];
            res.json({
                admin: {
                    id: superAdmin.id,
                    name: superAdmin.name,
                    email: user.email,
                    phone: superAdmin.phone,
                    image: superAdmin.image
                },
                token,
                message: 'Login successful'
            });
        } else {
            res.json({ token });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
