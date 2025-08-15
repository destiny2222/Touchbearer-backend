const jwt = require('jsonwebtoken');
const pool = require('../database');

module.exports = async function(req, res, next) {
    const token = req.header('x-auth-token');
    console.log("Authenticating a users...");

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
        if (users.length === 0) {
            console.log("error finding this users");
            return res.status(401).json({ message: 'User not found' });
        }
        req.user = users[0];
        const [rolesResult] = await pool.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [req.user.id]);
        req.user.roles = rolesResult.map(r => r.name);
        console.log("User authenticated successfully");
        next();
    } catch (e) {
        res.status(400).json({ message: 'Token is not valid' });
    }
};
