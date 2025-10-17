const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// --- ADMIN & SUPERADMIN ROUTES ---

// Create a new shop item
router.post('/items', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { name, details, description, price, stock, branch_id, category, image_url } = req.body;

    if (!name || !price || !branch_id || stock === undefined) {
        return res.status(400).json({ success: false, message: 'Missing required fields: name, price, stock, and branch_id are required.' });
    }

    if (stock < 0) {
        return res.status(400).json({ success: false, message: 'Stock cannot be negative.' });
    }

    try {
        const connection = await pool.getConnection();

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                connection.release();
                return res.status(403).json({ success: false, message: 'You can only create items for your own branch.' });
            }
        }

        const newItem = {
            id: uuidv4(),
            name,
            details,
            description,
            price,
            stock,
            branch_id,
            category,
            image_url
        };

        await connection.query('INSERT INTO shop_items SET ?', newItem);
        
        const [createdItem] = await connection.query('SELECT * FROM shop_items WHERE id = ?', [newItem.id]);
        connection.release();

        res.status(201).json({ success: true, message: 'Item created successfully!', data: createdItem[0] });
    } catch (error) {
        console.error('Error creating shop item:', error);
        res.status(500).json({ success: false, message: 'Server error while creating item.' });
    }
});

// Record a cash sale
router.post('/purchase/cash', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { item_id, student_id } = req.body;
    if (!item_id || !student_id) {
        return res.status(400).json({ success: false, message: 'Item ID and Student ID are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [studentRows] = await connection.query('SELECT id, branch_id FROM students WHERE id = ?', [student_id]);
        if (studentRows.length === 0) throw new Error('Student not found.');
        const student = studentRows[0];

        const [itemRows] = await connection.query('SELECT stock, price, branch_id FROM shop_items WHERE id = ? FOR UPDATE', [item_id]);
        if (itemRows.length === 0) throw new Error('Item not found.');
        const item = itemRows[0];
        
        if (item.branch_id !== student.branch_id) throw new Error('Item and student are not in the same branch.');
        if (item.stock <= 0) throw new Error('Item is out of stock.');

        await connection.query('UPDATE shop_items SET stock = stock - 1 WHERE id = ?', [item_id]);

        const newSale = {
            id: uuidv4(),
            item_id,
            student_id: student.id,
            branch_id: student.branch_id,
            price: item.price,
            purchase_method: 'Cash',
        };
        await connection.query('INSERT INTO shop_sales SET ?', newSale);
        
        await connection.commit();
        res.status(200).json({ success: true, message: 'Cash sale recorded successfully!', data: newSale });
    } catch (error) {
        await connection.rollback();
        console.error('Error with cash sale:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error during cash sale.' });
    } finally {
        connection.release();
    }
});

// Fetch all shop items for Admin
router.get('/admin/items', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        const connection = await pool.getConnection();
        let query = 'SELECT * FROM shop_items';
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                query += ' WHERE branch_id = ?';
                params.push(staff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] });
            }
        }
        const [items] = await connection.query(query, params);
        connection.release();
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Error fetching admin shop items:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Fetch all sales for Admin
router.get('/sales', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        const connection = await pool.getConnection();
        let query = `
            SELECT 
                ss.id,
                ss.price,
                ss.purchase_method,
                ss.created_at,
                si.name as item_name,
                CONCAT(s.first_name, ' ', s.last_name) as student_name
            FROM shop_sales ss
            JOIN shop_items si ON ss.item_id = si.id
            JOIN students s ON ss.student_id = s.id
        `;
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                query += ' WHERE ss.branch_id = ?';
                params.push(staff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] });
            }
        }
        query += ' ORDER BY ss.created_at DESC';

        const [sales] = await connection.query(query, params);
        connection.release();
        res.json({ success: true, data: sales });
    } catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// --- PARENT ROUTES ---

// Fetch all shop items for Parent
router.get('/parent/items', auth, authorize(['Parent']), async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [parentRows] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parentRows.length === 0) throw new Error("Parent profile not found.");
        
        const [branches] = await connection.query(
            'SELECT DISTINCT branch_id FROM students WHERE parent_id = ?',
            [parentRows[0].id]
        );
        
        if (branches.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const branchIds = branches.map(b => b.branch_id);
        const placeholders = branchIds.map(() => '?').join(',');

        const [items] = await connection.query(`SELECT * FROM shop_items WHERE branch_id IN (${placeholders})`, branchIds);
        connection.release();

        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Error fetching parent shop items:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

module.exports = router;
