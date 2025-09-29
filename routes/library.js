const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Helper function to get a staff member's branch ID from their user ID
async function getStaffBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// Helper function to get a student's branch ID from their user ID
async function getStudentBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM students WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// @route   POST /api/library/upload
// @desc    Upload an e-book
// @access  Admin, SuperAdmin
router.post('/upload', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { title, author, description, ebook_url, cover_image_url } = req.body;

    if (!title || !author || !ebook_url) {
        return res.status(400).json({ success: false, message: 'Title, author, and ebook_url are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        if (req.user.roles.includes('SuperAdmin')) {
            // SuperAdmin uploads to all branches
            const [branches] = await connection.query('SELECT id FROM branches');
            if (branches.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'No branches found to upload the e-book to.' });
            }

            for (const branch of branches) {
                const newEbook = {
                    id: uuidv4(),
                    title,
                    author,
                    description: description || null,
                    ebook_url,
                    cover_image_url: cover_image_url || null,
                    branch_id: branch.id,
                    uploaded_by: req.user.id
                };
                await connection.query('INSERT INTO ebooks SET ?', newEbook);
            }
        } else { // Admin uploads to their own branch
            const adminBranchId = await getStaffBranchId(req.user.id);
            if (!adminBranchId) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admin is not associated with any branch.' });
            }

            const newEbook = {
                id: uuidv4(),
                title,
                author,
                description: description || null,
                ebook_url,
                cover_image_url: cover_image_url || null,
                branch_id: adminBranchId,
                uploaded_by: req.user.id
            };
            await connection.query('INSERT INTO ebooks SET ?', newEbook);
        }

        await connection.commit();
        res.status(201).json({ success: true, message: 'E-book uploaded successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('E-book upload error:', error);
        res.status(500).json({ success: false, message: 'Server error while uploading e-book.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   GET /api/library/ebooks
// @desc    Get all e-books based on user role and branch
// @access  Authenticated Users
router.get('/ebooks', [auth], async (req, res) => {
    try {
        let query = 'SELECT id, title, author, description, ebook_url, cover_image_url, branch_id, created_at FROM ebooks';
        const params = [];

        if (req.user.roles.includes('SuperAdmin')) {
            // SuperAdmin gets all ebooks
        } else if (req.user.roles.includes('Admin') || req.user.roles.includes('Teacher') || req.user.roles.includes('NonTeachingStaff')) {
            const branchId = await getStaffBranchId(req.user.id);
            if (branchId) {
                query += ' WHERE branch_id = ?';
                params.push(branchId);
            } else {
                return res.json({ success: true, data: [] });
            }
        } else if (req.user.roles.includes('Student')) {
            const branchId = await getStudentBranchId(req.user.id);
            if (branchId) {
                query += ' WHERE branch_id = ?';
                params.push(branchId);
            } else {
                return res.json({ success: true, data: [] });
            }
        } else { // For other roles like Parent, or if no specific role logic is defined
            return res.json({ success: true, data: [] });
        }

        query += ' ORDER BY created_at DESC';
        const [ebooks] = await pool.query(query, params);
        res.json({ success: true, data: ebooks });

    } catch (err) {
        console.error('Error fetching e-books:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching e-books.' });
    }
});

// @route   PUT /api/library/ebooks/:id
// @desc    Update an e-book
// @access  Admin, SuperAdmin
router.put('/ebooks/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { title, author, description, ebook_url, cover_image_url } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [ebookRows] = await connection.query('SELECT branch_id FROM ebooks WHERE id = ?', [id]);
        if (ebookRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'E-book not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getStaffBranchId(req.user.id);
            if (adminBranchId !== ebookRows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to update this e-book.' });
            }
        }

        const updateFields = {};
        if (title) updateFields.title = title;
        if (author) updateFields.author = author;
        if (description) updateFields.description = description;
        if (ebook_url) updateFields.ebook_url = ebook_url;
        if (cover_image_url) updateFields.cover_image_url = cover_image_url;

        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE ebooks SET ? WHERE id = ?', [updateFields, id]);
        }

        await connection.commit();
        res.json({ success: true, message: 'E-book updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update e-book error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating e-book.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   DELETE /api/library/ebooks/:id
// @desc    Delete an e-book
// @access  Admin, SuperAdmin
router.delete('/ebooks/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [ebookRows] = await connection.query('SELECT branch_id FROM ebooks WHERE id = ?', [id]);
        if (ebookRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'E-book not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getStaffBranchId(req.user.id);
            if (adminBranchId !== ebookRows[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to delete this e-book.' });
            }
        }

        await connection.query('DELETE FROM ebooks WHERE id = ?', [id]);
        await connection.commit();

        res.json({ success: true, message: 'E-book deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete e-book error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting e-book.' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;
