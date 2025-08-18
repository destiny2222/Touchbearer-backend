const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

function generatePassword() {
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

async function isAuthorizedAdmin(adminUserId, parentId) {
    const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [adminUserId]);
    if (adminStaff.length === 0) {
        return false;
    }
    const adminBranchId = adminStaff[0].branch_id;

    const [children] = await pool.query(`
        SELECT p.id FROM parents p
        LEFT JOIN new_students ns ON p.id = ns.parent_id
        LEFT JOIN students s ON p.id = s.parent_id
        WHERE p.id = ? AND (ns.branch_id = ? OR s.branch_id = ?)
        GROUP BY p.id
    `, [parentId, adminBranchId, adminBranchId]);

    return children.length > 0;
}

router.get('/', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    try {
        let query = `
            SELECT DISTINCT p.id, p.name, p.email, p.phone, u.created_at
            FROM parents p
            JOIN users u ON p.user_id = u.id
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                return res.status(403).json({ success: false, message: 'Admin not associated with a branch.' });
            }
            const adminBranchId = adminStaff[0].branch_id;

            query += `
                LEFT JOIN new_students ns ON p.id = ns.parent_id
                LEFT JOIN students s ON p.id = s.parent_id
                WHERE ns.branch_id = ? OR s.branch_id = ?
            `;
            queryParams.push(adminBranchId, adminBranchId);
        }

        query += ' ORDER BY u.created_at DESC';

        const [parents] = await pool.query(query, queryParams);
        res.json({ success: true, data: parents });

    } catch (error) {
        console.error('Error fetching parents:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching parents.' });
    }
});

router.get('/:id', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    const { id } = req.params;
    try {
        const [parentResult] = await pool.query('SELECT * FROM parents WHERE id = ?', [id]);
        if (parentResult.length === 0) {
            return res.status(404).json({ success: false, message: 'Parent not found.' });
        }
        const parent = parentResult[0];

        if (req.user.roles.includes('Admin')) {
            const isAuthorized = await isAuthorizedAdmin(req.user.id, id);
            if (!isAuthorized) {
                return res.status(403).json({ success: false, message: 'You are not authorized to view this parent.' });
            }
        }

        const [children] = await pool.query(`
            SELECT id, first_name, last_name, 'new' as status FROM new_students WHERE parent_id = ?
            UNION ALL
            SELECT id, first_name, last_name, 'enrolled' as status FROM students WHERE parent_id = ?
        `, [id, id]);

        parent.children = children;

        res.json({ success: true, data: parent });

    } catch (error) {
        console.error('Error fetching parent:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching parent details.' });
    }
});

router.put('/:id', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    const { id } = req.params;
    const { name, phone, email } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [parentResult] = await connection.query('SELECT * FROM parents WHERE id = ?', [id]);
        if (parentResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Parent not found.' });
        }
        const parent = parentResult[0];

        if (req.user.roles.includes('Admin')) {
            const isAuthorized = await isAuthorizedAdmin(req.user.id, id);
            if (!isAuthorized) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to update this parent.' });
            }
        }

        if (email && email !== parent.email) {
            const [emailCheck] = await connection.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, parent.user_id]);
            if (emailCheck.length > 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Email already in use.' });
            }
            await connection.query('UPDATE users SET email = ? WHERE id = ?', [email, parent.user_id]);
        }

        const updateFields = {};
        if (name) updateFields.name = name;
        if (phone) updateFields.phone = phone;
        if (email) updateFields.email = email;

        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE parents SET ? WHERE id = ?', [updateFields, id]);
        }

        await connection.commit();

        res.json({ success: true, message: 'Parent details updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating parent:', error);
        res.status(500).json({ success: false, message: 'Server error while updating parent details.' });
    } finally {
        connection.release();
    }
});

router.post('/:id/reset-password', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    const { id } = req.params;

    try {
        const [parentResult] = await pool.query('SELECT user_id, email, name FROM parents WHERE id = ?', [id]);
        if (parentResult.length === 0) {
            return res.status(404).json({ success: false, message: 'Parent not found.' });
        }
        const parent = parentResult[0];

        if (req.user.roles.includes('Admin')) {
            const isAuthorized = await isAuthorizedAdmin(req.user.id, id);
            if (!isAuthorized) {
                return res.status(403).json({ success: false, message: 'You are not authorized to reset this parent\'s password.' });
            }
        }

        const newPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, parent.user_id]);

        res.json({
            success: true,
            message: 'Parent password reset successfully.',
            data: {
                parent_id: id,
                email: parent.email,
                name: parent.name,
                temporaryPassword: newPassword
            }
        });

    } catch (error) {
        console.error('Error resetting parent password:', error);
        res.status(500).json({ success: false, message: 'Server error while resetting password.' });
    }
});

router.delete('/:id', [auth, authorize(['SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [parentResult] = await connection.query('SELECT user_id FROM parents WHERE id = ?', [id]);
        if (parentResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Parent not found.' });
        }
        const parent = parentResult[0];

        const [childrenCheck] = await connection.query(
            'SELECT (SELECT COUNT(*) FROM new_students WHERE parent_id = ?) + (SELECT COUNT(*) FROM students WHERE parent_id = ?) as total_children',
            [id, id]
        );

        if (childrenCheck[0].total_children > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Cannot delete a parent who has children associated with their account.' });
        }

        await connection.query('DELETE FROM parents WHERE id = ?', [id]);
        await connection.query('DELETE FROM user_roles WHERE user_id = ?', [parent.user_id]);
        await connection.query('DELETE FROM users WHERE id = ?', [parent.user_id]);

        await connection.commit();

        res.json({ success: true, message: 'Parent deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleting parent:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting parent.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
