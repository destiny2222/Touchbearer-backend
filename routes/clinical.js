const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// @route   POST /api/clinical/log
// @desc    Log a new clinical case for a student
// @access  ClinicalStaff
router.post('/log', [auth, authorize(['ClinicalStaff'])], async (req, res) => {
    const { student_id, severity, notes } = req.body;

    if (!student_id || !severity || !notes) {
        return res.status(400).json({ success: false, message: 'student_id, severity, and notes are required.' });
    }

    const connection = await pool.getConnection();
    try {
        const [student] = await connection.query('SELECT branch_id FROM students WHERE id = ?', [student_id]);
        if (student.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const branch_id = student[0].branch_id;

        const newCase = {
            id: uuidv4(),
            student_id,
            branch_id,
            severity,
            notes,
            logged_by: req.user.id
        };

        await connection.query('INSERT INTO clinical_cases SET ?', newCase);

        res.status(201).json({ success: true, message: 'Clinical case logged successfully.', data: newCase });

    } catch (error) {
        console.error('Clinical case logging error:', error);
        res.status(500).json({ success: false, message: 'Server error while logging clinical case.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/clinical/cases/:studentId
// @desc    Get all clinical cases for a specific student
// @access  ClinicalStaff, Admin, SuperAdmin
router.get('/cases/:studentId', [auth, authorize(['ClinicalStaff', 'Admin', 'SuperAdmin'])], async (req, res) => {
    const { studentId } = req.params;

    try {
        const query = `
            SELECT cc.*, s.name as logged_by_name
            FROM clinical_cases cc
            JOIN staff s ON cc.logged_by = s.user_id
            WHERE cc.student_id = ?
            ORDER BY cc.created_at DESC
        `;
        const [cases] = await pool.query(query, [studentId]);

        res.json({ success: true, data: cases });

    } catch (err) {
        console.error('Error fetching clinical cases:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching clinical cases.' });
    }
});

module.exports = router;
