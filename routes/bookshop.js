const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Create a new book
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

// Update a book
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

// Get all books for the user's branch
router.get('/books', auth, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        let userBranchId;

        // For students, get branch from their profile
        if (req.user.roles.includes('Student')) {
            const [student] = await connection.query('SELECT branch_id FROM students WHERE user_id = ?', [req.user.id]);
            if (student.length > 0) {
                userBranchId = student[0].branch_id;
            }
        }
        // For staff (Admin, Teacher, etc.), get branch from their profile
        else {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0) {
                userBranchId = staff[0].branch_id;
            }
        }

        if (!userBranchId) {
            connection.release();
            return res.status(404).json({ success: false, message: "User's branch not found." });
        }

        const [books] = await connection.query('SELECT * FROM books WHERE branch_id = ?', [userBranchId]);
        connection.release();

        res.json({ success: true, data: books });
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Purchase a book
router.post('/purchase', auth, authorize(['Student']), async (req, res) => {
    const { book_id, payment_status } = req.body;

    if (!book_id || !payment_status) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const validPaymentStatuses = ['Paid', 'Pending', 'Failed'];
    if (!validPaymentStatuses.includes(payment_status)) {
        return res.status(400).json({ success: false, message: 'Invalid payment status' });
    }

    try {
        const connection = await pool.getConnection();

        const [student] = await connection.query('SELECT id, branch_id FROM students WHERE user_id = ?', [req.user.id]);
        if (student.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Student profile not found.' });
        }
        const studentId = student[0].id;
        const studentBranchId = student[0].branch_id;

        const [book] = await connection.query('SELECT * FROM books WHERE id = ?', [book_id]);
        if (book.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'Book not found' });
        }

        if (book[0].branch_id !== studentBranchId) {
            connection.release();
            return res.status(403).json({ success: false, message: 'You can only purchase books from your own branch.' });
        }

        // Check if book is available
        if (book[0].amount <= 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Book is out of stock' });
        }

        const newPurchase = {
            id: uuidv4(),
            student_id: studentId,
            book_id,
            branch_id: studentBranchId,
            price: book[0].price,
            payment_status,
        };

        await connection.query('INSERT INTO student_book_purchases SET ?', newPurchase);

        // Decrease the book amount
        await connection.query('UPDATE books SET amount = amount - 1 WHERE id = ?', [book_id]);

        connection.release();

        res.status(201).json({ success: true, message: 'Book purchased successfully', data: newPurchase });
    } catch (error) {
        console.error('Error purchasing book:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
