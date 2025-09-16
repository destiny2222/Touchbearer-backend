const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Set up storage for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/ebooks/');
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif|pdf|epub|mobi/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: File upload only supports the following filetypes - ' + filetypes));
    }
});

// @route   POST /api/library/upload
// @desc    Upload an e-book
// @access  Admin, SuperAdmin
router.post('/upload', [auth, authorize(['Admin', 'SuperAdmin'])], upload.single('ebook'), async (req, res) => {
    const { title, author, description, branch_id } = req.body;
    const { filename, path: filepath, size } = req.file;

    if (!title || !author || !branch_id) {
        return res.status(400).json({ success: false, message: 'Title, author, and branch_id are required.' });
    }

    const connection = await pool.getConnection();
    try {
        const newEbook = {
            id: uuidv4(),
            title,
            author,
            description: description || null,
            filename,
            filepath,
            filesize: size,
            branch_id,
            uploaded_by: req.user.id
        };

        await connection.query('INSERT INTO ebooks SET ?', newEbook);

        res.status(201).json({ success: true, message: 'E-book uploaded successfully.', data: newEbook });

    } catch (error) {
        console.error('E-book upload error:', error);
        res.status(500).json({ success: false, message: 'Server error while uploading e-book.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/library/ebooks
// @desc    Get all e-books for a branch (Admin) or all branches (SuperAdmin)
// @access  Admin, SuperAdmin
router.get('/ebooks', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = 'SELECT * FROM ebooks';
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0) {
                query += ' WHERE branch_id = ?';
                queryParams.push(adminStaff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] });
            }
        }

        query += ' ORDER BY created_at DESC';

        const [ebooks] = await pool.query(query, queryParams);
        res.json({ success: true, data: ebooks });

    } catch (err) {
        console.error('Error fetching e-books:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching e-books.' });
    }
});

module.exports = router;
