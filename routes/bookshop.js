const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// --- ADMIN ROUTES ---

// Create a new book (no changes, but kept for context)
router.post('/books', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => { 
    const { title, author, description, price, cover_image_url, branch_id, amount } = req.body;

    if (!title || !author || !price || !branch_id || amount === undefined) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (amount < 0) {
        return res.status(400).json({ success: false, message: 'Amount cannot be negative' });
    }

    try {
        const connection = await pool.getConnection();

        // Admin can only create books for their own branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== branch_id) {
                connection.release();
                return res.status(403).json({ success: false, message: 'You can only create books for your own branch.' });
            }
        }

        const newBook = {
            id: uuidv4(),
            title,
            author,
            description,
            price,
            cover_image_url,
            amount,
            branch_id,
        };

        await connection.query('INSERT INTO books SET ?', newBook);
        connection.release();

        res.status(201).json({ success: true, message: 'Book created successfully', data: newBook });
    } catch (error) {
        console.error('Error creating book:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update a book (no changes, but kept for context)
router.put('/books/:id', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => { 
    const { id } = req.params;
    const { title, author, description, price, cover_image_url, amount } = req.body;

    try {
        const connection = await pool.getConnection();

        const [book] = await connection.query('SELECT * FROM books WHERE id = ?', [id]);
        if (book.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Book not found' });
        }

        // Admin can only update books in their own branch
        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== book[0].branch_id) {
                connection.release();
                return res.status(403).json({ success: false, message: 'You can only update books in your own branch.' });
            }
        }

        const updateFields = {};
        if (title) updateFields.title = title;
        if (author) updateFields.author = author;
        if (description) updateFields.description = description;
        if (price) updateFields.price = price;
        if (cover_image_url) updateFields.cover_image_url = cover_image_url;
        if (amount !== undefined) {
            if (amount < 0) {
                connection.release();
                return res.status(400).json({ success: false, message: 'Amount cannot be negative' });
            }
            updateFields.amount = amount;
        }

        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE books SET ? WHERE id = ?', [updateFields, id]);
        }

        connection.release();

        res.json({ success: true, message: 'Book updated successfully' });
    } catch (error) {
        console.error('Error updating book:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get all books for an Admin's branch (previously GET /books)
router.get('/admin/books', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        const connection = await pool.getConnection();
        let query = 'SELECT * FROM books';
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                query += ' WHERE branch_id = ?';
                params.push(staff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] }); // Admin not in a branch
            }
        }
        const [books] = await connection.query(query, params);
        connection.release();
        res.json({ success: true, data: books });
    } catch (error) {
        console.error('Error fetching admin books:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// NEW: Get all book purchases for an Admin's branch
router.get('/purchases', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        const connection = await pool.getConnection();
        let query = `
            SELECT 
                sbp.id,
                sbp.price,
                sbp.payment_status,
                sbp.purchase_method,
                sbp.created_at,
                b.title as book_title,
                CONCAT(s.first_name, ' ', s.last_name) as student_name
            FROM student_book_purchases sbp
            JOIN books b ON sbp.book_id = b.id
            JOIN students s ON sbp.student_id = s.id
        `;
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                query += ' WHERE sbp.branch_id = ?';
                params.push(staff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] });
            }
        }
        query += ' ORDER BY sbp.created_at DESC';

        const [purchases] = await connection.query(query, params);
        connection.release();
        res.json({ success: true, data: purchases });
    } catch (error) {
        console.error('Error fetching book purchases:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// NEW: Purchase a book with Cash for a student (Admin only)
router.post('/purchase/cash', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const { book_id, student_id } = req.body;
    if (!book_id || !student_id) {
        return res.status(400).json({ success: false, message: 'Book ID and Student ID are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get student and book details, ensuring they are in the same branch
        const [studentRows] = await connection.query('SELECT id, branch_id FROM students WHERE id = ?', [student_id]);
        if (studentRows.length === 0) throw new Error('Student not found.');
        const student = studentRows[0];

        const [bookRows] = await connection.query('SELECT amount, price, branch_id FROM books WHERE id = ? FOR UPDATE', [book_id]);
        if (bookRows.length === 0) throw new Error('Book not found.');
        const book = bookRows[0];
        
        if (book.branch_id !== student.branch_id) throw new Error('Book and student are not in the same branch.');

        // 2. Check stock
        if (book.amount <= 0) throw new Error('Book is out of stock.');

        // 3. Decrease stock
        await connection.query('UPDATE books SET amount = amount - 1 WHERE id = ?', [book_id]);

        // 4. Log the purchase
        const newPurchase = {
            id: uuidv4(),
            student_id: student.id,
            book_id,
            branch_id: student.branch_id,
            price: book.price,
            payment_status: 'Paid',
            purchase_method: 'Cash',
        };
        await connection.query('INSERT INTO student_book_purchases SET ?', newPurchase);
        
        // 5. Log to revenue
        await pool.query('INSERT INTO revenue SET ?', {
            id: uuidv4(),
            student_id,
            email: 'cash.sale@school.system', // Placeholder email for cash sales
            amount: book.price,
            reference: `cash_${uuidv4()}`,
            status: 'success',
            payment_for: 'book_purchase_cash',
            paid_at: new Date(),
        });
        
        await connection.commit();
        res.status(201).json({ success: true, message: 'Cash purchase recorded successfully.', data: newPurchase });
    } catch (error) {
        await connection.rollback();
        console.error('Error with cash purchase:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error during cash purchase.' });
    } finally {
        connection.release();
    }
});


// --- PARENT ROUTES ---

// NEW: Get all books available to a parent (based on all their children's branches)
router.get('/parent/books', auth, authorize(['Parent']), async (req, res) => {
    try {
        const connection = await pool.getConnection();

        // Find parent
        const [parentRows] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parentRows.length === 0) throw new Error("Parent profile not found.");
        
        // Find all distinct branches for this parent's children
        const [branches] = await connection.query(
            'SELECT DISTINCT branch_id FROM students WHERE parent_id = ?',
            [parentRows[0].id]
        );
        
        if (branches.length === 0) {
            return res.json({ success: true, data: [] }); // Parent has no enrolled children
        }

        const branchIds = branches.map(b => b.branch_id);
        const placeholders = branchIds.map(() => '?').join(',');

        const [books] = await connection.query(`SELECT * FROM books WHERE branch_id IN (${placeholders})`, branchIds);
        connection.release();

        res.json({ success: true, data: books });
    } catch (error) {
        console.error('Error fetching parent books:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

// NEW: Get a parent's children (to select for book purchase)
router.get('/parent/children', auth, authorize(['Parent']), async (req, res) => {
    try {
        const [parentRows] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parentRows.length === 0) throw new Error("Parent profile not found.");

        const [children] = await pool.query(
            'SELECT id, CONCAT(first_name, " ", last_name) as name FROM students WHERE parent_id = ?',
            [parentRows[0].id]
        );
        res.json({ success: true, data: children });
    } catch (error) {
        console.error("Error fetching parent's children:", error);
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

module.exports = router;
