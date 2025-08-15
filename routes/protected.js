const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
    if (!req.user.roles.includes('Admin')) {
        return res.status(403).json({ message: 'Access denied' });
    }
    res.json({ message: 'This is a protected route' });
});

module.exports = router;
