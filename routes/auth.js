const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const cache = require('memory-cache');

const auth = require('../middleware/auth');


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

router.post('/parent/login', async (req, res) => {
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

        const [rolesResult] = await pool.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
        const userRoles = rolesResult.map(r => r.name);

        if (!userRoles.includes('Parent')) {
            return res.status(403).json({ message: 'Access denied. Not a parent account.' });
        }

        const [parentResult] = await pool.query('SELECT * FROM parents WHERE user_id = ?', [user.id]);
        if (parentResult.length === 0) {
            return res.status(404).json({ message: 'Parent details not found.' });
        }
        const parent = parentResult[0];

        const [childrenResult] = await pool.query('SELECT id, first_name, last_name FROM students WHERE parent_id = ?', [parent.id]);

        const token = jwt.sign({ id: user.id, roles: userRoles }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({
            parent: {
                id: parent.id,
                name: parent.name,
                email: parent.email,
                phone: parent.phone,
                children: childrenResult.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}` }))
            },
            token,
            message: 'Login successful'
        });

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

        let userRoles = cache.get(user.id);
        if (!userRoles || (userRoles.length > 0 && typeof userRoles[0] === 'string')) {
            const [rolesResult] = await pool.query('SELECT r.id, r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
            userRoles = rolesResult;
            cache.put(user.id, userRoles, 6000000); // Cache for 100 minutes
        }

        const roles = userRoles.map(r => r.name);
        const token = jwt.sign({ id: user.id, roles }, process.env.JWT_SECRET, { expiresIn: '7d' });

        if (roles.includes('SuperAdmin')) {
            const [superAdminResult] = await pool.query('SELECT * FROM super_admins WHERE user_id = ?', [user.id]);
            const superAdmin = superAdminResult[0];
            const superAdminRole = userRoles.find(r => r.name === 'SuperAdmin');
            res.json({
                admin: {
                    id: superAdmin.id,
                    name: superAdmin.name,
                    email: user.email,
                    phone: superAdmin.phone,
                    image: superAdmin.image,
                    roleId: superAdminRole.id
                },
                token,
                message: 'Login successful'
            });
        } else {
            return res.status(403).json({ message: 'Access denied' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/login/staff', async (req, res) => {
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

        const staffQuery = `
            SELECT 
                s.id, s.name, s.email, s.phone, s.address, s.gender,
                s.description, s.status, s.image_url as imageUrl,
                s.created_at as createdAt,
                r.id as roleId, r.name as role,
                b.id as branchId, b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.user_id = ?
        `;

        const [staffResult] = await pool.query(staffQuery, [user.id]);

        if (staffResult.length === 0) {
            return res.status(403).json({ message: 'Invalid credentials' });
        }

        let roles = cache.get(user.id);
        if (!roles) {
            const [rolesResult] = await pool.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
            roles = rolesResult.map(r => r.name);
            cache.put(user.id, roles, 6000000); // Cache for 100 minutes
        }

        const token = jwt.sign({ id: user.id, roles }, process.env.JWT_SECRET, { expiresIn: '7d' });

        const staffDetails = staffResult[0];

        res.json({
            staff: staffDetails,
            token,
            message: 'Login successful'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/login/cbt/student', async (req, res) => {
    const { student_id, password } = req.body;

    if (!student_id || !password) {
        return res.status(400).json({ success: false, message: 'Please provide student ID and password.' });
    }

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [student_id]);
        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid credentials.' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Invalid credentials.' });
        }

        const [userRoles] = await pool.query(
            'SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?',
            [user.id]
        );
        const roles = userRoles.map(r => r.name);

        if (!roles.includes('NewStudent') && !roles.includes('Student')) {
            return res.status(403).json({ success: false, message: 'Invalid credentials' });
        }

        let studentDetailsResult;
        let message;

        if (roles.includes('NewStudent')) {
            [studentDetailsResult] = await pool.query(
                `SELECT 
                    ns.id, ns.student_id, ns.first_name, ns.last_name, c.name as class_applying,
                    b.school_name as branch_name
                 FROM new_students ns
                 JOIN branches b ON ns.branch_id = b.id
                 JOIN classes c ON ns.class_id = c.id
                 WHERE ns.student_id = ?`,
                [student_id]
            );
            message = 'Login successful. Welcome to your entrance exam.';
        } else { // Student
            [studentDetailsResult] = await pool.query(
                `SELECT 
                    s.id, u.email as student_id, s.first_name, s.last_name, c.name as class_applying,
                    b.school_name as branch_name
                 FROM students s
                 JOIN users u ON s.user_id = u.id
                 JOIN branches b ON s.branch_id = b.id
                 JOIN classes c ON s.class_id = c.id
                 WHERE s.user_id = ?`,
                [user.id]
            );
            message = 'Login successful. Welcome to your exam.';
        }

        if (!studentDetailsResult || studentDetailsResult.length === 0) {
            return res.status(404).json({ success: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, roles }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.json({
            success: true,
            message: message,
            data: {
                student: studentDetailsResult[0],
                token
            }
        });

    } catch (error) {
        console.error('Student Login Error:', error);
        res.status(500).json({ success: false, message: 'An error occurred during login. Please try again.' });
    }
});

// @route   POST /api/auth/student/login
// @desc    Authenticate student & get token
// @access  Public
router.post('/student/login', async (req, res) => {
    const { student_id, password } = req.body;
    try {
        let [users] = await pool.query('SELECT * FROM users WHERE email = ?', [student_id]);

        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid credentials' });
        }
        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Invalid credentials' });
        }

        const [rolesResult] = await pool.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
        const userRoles = rolesResult.map(r => r.name);

        if (!userRoles.includes('Student') && !userRoles.includes('NewStudent')) {
            return res.status(403).json({ success: false, message: 'Invalid credentials' });
        }

        let studentData;
        if (userRoles.includes('Student')) {
            const [studentResult] = await pool.query('SELECT * FROM students WHERE user_id = ?', [user.id]);
            if (studentResult.length > 0) studentData = studentResult[0];
        } else if (userRoles.includes('NewStudent')) {
            const [newStudentResult] = await pool.query('SELECT * FROM new_students WHERE student_id = ?', [student_id]);
            if (newStudentResult.length > 0) studentData = newStudentResult[0];
        }

        if (!studentData) {
            return res.status(404).json({ success: false, message: 'Invalid credentials' });
        }

        const payload = { id: user.id, roles: userRoles };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5h' });

        res.json({
            success: true,
            token,
            student: studentData,
            message: 'Login successful'
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;
