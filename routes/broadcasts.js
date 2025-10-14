const express = require('express');
const router = express.Router();
const { pool } = require('../database'); const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// POST /api/broadcasts - Create new broadcast
router.post('/', auth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
    const { title, message, status = 'Draft', tags, cc_roles, branch_ids } = req.body;

    if (!title || !message) {
        return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // If Admin, verify they can only broadcast to their branch
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admin not associated with a branch.' });
            }
            const adminBranchId = adminStaff[0].branch_id;

            // Verify all branch_ids belong to admin's branch
            if (branch_ids && branch_ids.length > 0) {
                if (!branch_ids.includes(adminBranchId) || branch_ids.length > 1) {
                    await connection.rollback();
                    return res.status(403).json({ success: false, message: 'Admins can only broadcast to their own branch.' });
                }
            }
        }

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

        // Handle branch_ids
        // Empty array or undefined = all branches (SuperAdmin only)
        // Specific branch_ids = only those branches
        if (branch_ids && branch_ids.length > 0) {
            const branchValues = branch_ids.map(branchId => [broadcastId, branchId]);
            await connection.query('INSERT INTO broadcast_branches (broadcast_id, branch_id) VALUES ?', [branchValues]);
        }
        // If empty array and SuperAdmin, it's a global broadcast (no entries in broadcast_branches)

        await connection.commit();
        res.status(201).json({
            success: true,
            message: 'Broadcast created successfully.',
            data: {
                id: broadcastId,
                title,
                message,
                status,
                tags: tags || [],
                cc_roles: cc_roles || [],
                branch_ids: branch_ids || [],
                is_global: !branch_ids || branch_ids.length === 0
            }
        });

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
    const { title, message, status, tags, cc_roles, branch_ids } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [broadcasts] = await connection.query('SELECT * FROM broadcasts WHERE id = ?', [id]);
        if (broadcasts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Broadcast not found.' });
        }

        // If Admin, verify they can only update broadcasts for their branch
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admin not associated with a branch.' });
            }
            const adminBranchId = adminStaff[0].branch_id;

            // Verify all branch_ids belong to admin's branch
            if (branch_ids !== undefined) {
                if (branch_ids.length > 0 && (!branch_ids.includes(adminBranchId) || branch_ids.length > 1)) {
                    await connection.rollback();
                    return res.status(403).json({ success: false, message: 'Admins can only broadcast to their own branch.' });
                }
            }
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

        if (tags !== undefined) {
            await connection.query('DELETE FROM broadcast_tags WHERE broadcast_id = ?', [id]);
            if (tags.length > 0) {
                const tagValues = tags.map(tag => [id, tag]);
                await connection.query('INSERT INTO broadcast_tags (broadcast_id, tag) VALUES ?', [tagValues]);
            }
        }

        if (cc_roles !== undefined) {
            await connection.query('DELETE FROM broadcast_cc WHERE broadcast_id = ?', [id]);
            if (cc_roles.length > 0) {
                const ccValues = cc_roles.map(role => [id, role]);
                await connection.query('INSERT INTO broadcast_cc (broadcast_id, role_name) VALUES ?', [ccValues]);
            }
        }

        if (branch_ids !== undefined) {
            await connection.query('DELETE FROM broadcast_branches WHERE broadcast_id = ?', [id]);
            if (branch_ids.length > 0) {
                const branchValues = branch_ids.map(branchId => [id, branchId]);
                await connection.query('INSERT INTO broadcast_branches (broadcast_id, branch_id) VALUES ?', [branchValues]);
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
        await connection.query('DELETE FROM broadcast_branches WHERE broadcast_id = ?', [id]);
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
                GROUP_CONCAT(DISTINCT bc.role_name) as cc_roles,
                GROUP_CONCAT(DISTINCT bb.branch_id) as branch_ids
            FROM broadcasts b
            LEFT JOIN broadcast_tags bt ON b.id = bt.broadcast_id
            LEFT JOIN broadcast_cc bc ON b.id = bc.broadcast_id
            LEFT JOIN broadcast_branches bb ON b.id = bb.broadcast_id
        `;
        const queryParams = [userId];

        // Role-based visibility and branch filtering
        const userRoles = req.user.roles;

        if (!userRoles.includes('Admin') && !userRoles.includes('SuperAdmin')) {
            // Regular users: see broadcasts for their role and their branch (or global broadcasts)
            // First, get user's branch
            const connection = await pool.getConnection();
            let userBranchId = null;

            if (userRoles.includes('Teacher') || userRoles.includes('NonTeachingStaff')) {
                const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
                if (staff.length > 0) userBranchId = staff[0].branch_id;
            } else if (userRoles.includes('Parent')) {
                const [parents] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [userId]);
                if (parents.length > 0) {
                    const [students] = await connection.query('SELECT branch_id FROM students WHERE parent_id = ? LIMIT 1', [parents[0].id]);
                    if (students.length > 0) userBranchId = students[0].branch_id;
                }
            } else if (userRoles.includes('Student')) {
                const [students] = await connection.query('SELECT branch_id FROM students WHERE user_id = ?', [userId]);
                if (students.length > 0) userBranchId = students[0].branch_id;
            }
            connection.release();

            query += ` WHERE b.status = 'Sent' 
                       AND b.id IN (SELECT broadcast_id FROM broadcast_cc WHERE role_name IN (?))
                       AND (
                           b.id NOT IN (SELECT broadcast_id FROM broadcast_branches)
                           ${userBranchId ? `OR b.id IN (SELECT broadcast_id FROM broadcast_branches WHERE branch_id = ?)` : ''}
                       )`;
            queryParams.push(userRoles);
            if (userBranchId) queryParams.push(userBranchId);
        } else {
            // Admin/SuperAdmin see all broadcasts (or filtered by their branch for Admin)
            if (userRoles.includes('Admin') && !userRoles.includes('SuperAdmin')) {
                const connection = await pool.getConnection();
                const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
                connection.release();

                if (adminStaff.length > 0) {
                    const adminBranchId = adminStaff[0].branch_id;
                    query += ` WHERE (
                        b.id NOT IN (SELECT broadcast_id FROM broadcast_branches)
                        OR b.id IN (SELECT broadcast_id FROM broadcast_branches WHERE branch_id = ?)
                    )`;
                    queryParams.push(adminBranchId);
                } else {
                    query += ` WHERE 1=1`;
                }
            } else {
                query += ` WHERE 1=1`;
            }
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
            read_status: b.read_status || 'Unread',
            is_global: !b.branch_ids
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
                GROUP_CONCAT(DISTINCT bc.role_name) as cc_roles,
                GROUP_CONCAT(DISTINCT bb.branch_id) as branch_ids
            FROM broadcasts b
            LEFT JOIN broadcast_tags bt ON b.id = bt.broadcast_id
            LEFT JOIN broadcast_cc bc ON b.id = bc.broadcast_id
            LEFT JOIN broadcast_branches bb ON b.id = bb.broadcast_id
            WHERE b.id = ?
            GROUP BY b.id
        `, [userId, id]);

        if (broadcasts.length === 0) {
            return res.status(404).json({ success: false, message: 'Broadcast not found.' });
        }

        const broadcast = {
            ...broadcasts[0],
            read_status: broadcasts[0].read_status || 'Unread',
            is_global: !broadcasts[0].branch_ids
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
