const express = require('express');
const router = express.Router();
const { pool } = require('../database');const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// POST /api/broadcasts - Create new broadcast
router.post('/', auth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
    const { title, message, status = 'Draft', tags, cc_roles } = req.body;

    if (!title || !message) {
        return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const broadcastId = uuidv4();
        await connection.query(
            'INSERT INTO broadcasts (id, title, message, status, created_by) VALUES (?, ?, ?, ?, ?)',
            [broadcastId, title, message, status, req.user.id]
        );

        if (tags && tags.length > 0) {
            const tagValues = tags.map(tag => [broadcastId, tag]);
            await connection.query('INSERT INTO broadcast_tags (broadcast_id, tag) VALUES ?', [tagValues]);
        }

        if (cc_roles && cc_roles.length > 0) {
            const ccValues = cc_roles.map(role => [broadcastId, role]);
            await connection.query('INSERT INTO broadcast_cc (broadcast_id, role_name) VALUES ?', [ccValues]);
        }

        await connection.commit();
        res.status(201).json({ success: true, message: 'Broadcast created successfully.', data: { id: broadcastId } });

    } catch (error) {
        await connection.rollback();
        console.error('Create broadcast error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating broadcast.' });
    } finally {
        connection.release();
    }
});

// PUT /api/broadcasts/:id - Edit broadcast
router.put('/:id', auth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
    const { id } = req.params;
    const { title, message, status, tags, cc_roles } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [broadcasts] = await connection.query('SELECT * FROM broadcasts WHERE id = ?', [id]);
        if (broadcasts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Broadcast not found.' });
        }

        await connection.query(
            'UPDATE broadcasts SET title = ?, message = ?, status = ? WHERE id = ?',
            [
                title || broadcasts[0].title,
                message || broadcasts[0].message,
                status || broadcasts[0].status,
                id
            ]
        );

        if (tags) {
            await connection.query('DELETE FROM broadcast_tags WHERE broadcast_id = ?', [id]);
            if (tags.length > 0) {
                const tagValues = tags.map(tag => [id, tag]);
                await connection.query('INSERT INTO broadcast_tags (broadcast_id, tag) VALUES ?', [tagValues]);
            }
        }

        if (cc_roles) {
            await connection.query('DELETE FROM broadcast_cc WHERE broadcast_id = ?', [id]);
            if (cc_roles.length > 0) {
                const ccValues = cc_roles.map(role => [id, role]);
                await connection.query('INSERT INTO broadcast_cc (broadcast_id, role_name) VALUES ?', [ccValues]);
            }
        }

        await connection.commit();
        res.json({ success: true, message: 'Broadcast updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update broadcast error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating broadcast.' });
    } finally {
        connection.release();
    }
});

// DELETE /api/broadcasts/:id - Delete broadcast
router.delete('/:id', auth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [broadcasts] = await connection.query('SELECT * FROM broadcasts WHERE id = ?', [id]);
        if (broadcasts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Broadcast not found.' });
        }

        await connection.query('DELETE FROM broadcast_tags WHERE broadcast_id = ?', [id]);
        await connection.query('DELETE FROM broadcast_cc WHERE broadcast_id = ?', [id]);
        await connection.query('DELETE FROM broadcast_receipts WHERE broadcast_id = ?', [id]);
        await connection.query('DELETE FROM broadcasts WHERE id = ?', [id]);

        await connection.commit();
        res.json({ success: true, message: 'Broadcast deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete broadcast error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting broadcast.' });
    } finally {
        connection.release();
    }
});

// GET /api/broadcasts - Get all broadcasts
router.get('/', auth, async (req, res) => {
    const { page = 1, limit = 20, tag } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    try {
        let query = `
            SELECT 
                b.id, b.title, b.message, b.status, b.created_at, b.updated_at,
                (SELECT status FROM broadcast_receipts WHERE broadcast_id = b.id AND user_id = ?) as read_status,
                GROUP_CONCAT(DISTINCT bt.tag) as tags, 
                GROUP_CONCAT(DISTINCT bc.role_name) as cc_roles
            FROM broadcasts b
            LEFT JOIN broadcast_tags bt ON b.id = bt.broadcast_id
            LEFT JOIN broadcast_cc bc ON b.id = bc.broadcast_id
        `;
        const queryParams = [userId];

        // Role-based visibility
        const userRoles = req.user.roles;
        if (!userRoles.includes('Admin') && !userRoles.includes('SuperAdmin')) {
            query += ` WHERE b.status = 'Sent' AND b.id IN (
                SELECT broadcast_id FROM broadcast_cc WHERE role_name IN (?)
            )`;
            queryParams.push(userRoles);
        } else {
            query += ` WHERE 1=1`;
        }


        if (tag) {
            query += ` AND b.id IN (
                SELECT broadcast_id FROM broadcast_tags WHERE tag = ?
            )`;
            queryParams.push(tag);
        }

        query += ' GROUP BY b.id ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
        queryParams.push(parseInt(limit), parseInt(offset));

        const [broadcasts] = await pool.query(query, queryParams);

        const formattedBroadcasts = broadcasts.map(b => ({
            ...b,
            read_status: b.read_status || 'Unread'
        }));

        res.json({ success: true, data: formattedBroadcasts });

    } catch (error) {
        console.error('Get broadcasts error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching broadcasts.' });
    }
});

// GET /api/broadcasts/:id - Get single broadcast
router.get('/:id', auth, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRoles = req.user.roles;

    try {
        const [broadcasts] = await pool.query(`
            SELECT 
                b.*, 
                (SELECT status FROM broadcast_receipts WHERE broadcast_id = b.id AND user_id = ?) as read_status,
                GROUP_CONCAT(DISTINCT bt.tag) as tags, 
                GROUP_CONCAT(DISTINCT bc.role_name) as cc_roles
            FROM broadcasts b
            LEFT JOIN broadcast_tags bt ON b.id = bt.broadcast_id
            LEFT JOIN broadcast_cc bc ON b.id = bc.broadcast_id
            WHERE b.id = ?
            GROUP BY b.id
        `, [userId, id]);

        if (broadcasts.length === 0) {
            return res.status(404).json({ success: false, message: 'Broadcast not found.' });
        }

        const broadcast = {
            ...broadcasts[0],
            read_status: broadcasts[0].read_status || 'Unread'
        };

        // Authorization check
        const isAdmin = userRoles.includes('Admin') || userRoles.includes('SuperAdmin');
        if (!isAdmin && broadcast.status === 'Draft') {
            return res.status(403).json({ success: false, message: 'You are not authorized to view this broadcast.' });
        }

        const allowedRoles = broadcast.cc_roles ? broadcast.cc_roles.split(',') : [];
        const isAllowed = userRoles.some(role => allowedRoles.includes(role));

        if (!isAdmin && !isAllowed) {
            return res.status(403).json({ success: false, message: 'This broadcast is not intended for your role.' });
        }

        res.json({ success: true, data: broadcast });

    } catch (error) {
        console.error('Get single broadcast error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching broadcast.' });
    }
});

// POST /api/broadcasts/:id/read - Mark broadcast as read
router.post('/:id/read', auth, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        await pool.query(
            'INSERT INTO broadcast_receipts (broadcast_id, user_id, status, read_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE status = ?, read_at = NOW()',
            [id, userId, 'Read', 'Read']
        );
        res.json({ success: true, message: 'Broadcast marked as read.' });

    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ success: false, message: 'Server error while marking as read.' });
    }
});

// GET /api/broadcasts/:id/receipts - View read/unread receipts
router.get('/:id/receipts', auth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
    const { id } = req.params;
    try {
        const [receipts] = await pool.query(`
            SELECT u.id, u.email, br.status, br.read_at
            FROM users u
            LEFT JOIN broadcast_receipts br ON u.id = br.user_id AND br.broadcast_id = ?
        `, [id]);

        res.json({ success: true, data: receipts });

    } catch (error) {
        console.error('Get receipts error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching receipts.' });
    }
});

module.exports = router;
