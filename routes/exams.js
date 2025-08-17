const express = require('express');
const router = express.Router();
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// @route   POST /api/exams/store
// @desc    Create a new exam with subjects and questions
// @access  Admin, SuperAdmin
router.post('/store', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const {
        examType,
        subjectType,
        title,
        prospectiveClass,
        dateTime,
        duration,
        subjects
    } = req.body;

    // Basic validation
    if (!examType || !subjectType || !title || !prospectiveClass || !dateTime || !duration || !subjects) {
        return res.status(400).json({ success: false, message: 'Please provide all required fields.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
        if (req.user.roles.includes('Admin') && adminStaff.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Admin not associated with a branch.' });
        }
        const branch_id = adminStaff[0].branch_id;

        const [classInfo] = await connection.query('SELECT id FROM classes WHERE name = ? AND branch_id = ?', [prospectiveClass, branch_id]);
        if (classInfo.length === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Class not found for the given branch.' });
        }
        const class_id = classInfo[0].id;

        const newExam = {
            id: uuidv4(),
            title,
            exam_type: examType,
            subject_type: subjectType,
            class_id,
            branch_id,
            exam_date_time: dateTime,
            duration_hours: duration,
            created_by: req.user.id
        };

        await connection.query('INSERT INTO exams SET ?', newExam);

        for (const subject of subjects) {
            const newSubject = {
                id: uuidv4(),
                exam_id: newExam.id,
                title: subject.title
            };
            await connection.query('INSERT INTO subjects SET ?', newSubject);

            for (const question of subject.questions) {
                const newQuestion = {
                    id: uuidv4(),
                    subject_id: newSubject.id,
                    question_text: question.text,
                    options: JSON.stringify(question.options),
                    correct_answer_index: question.correctAnswerIndex
                };
                await connection.query('INSERT INTO questions SET ?', newQuestion);
            }
        }

        await connection.commit();
        console.log('Exam created successfully.');
        res.status(201).json({ success: true, message: 'Exam created successfully.', data: newExam });

    } catch (err) {
        await connection.rollback();
        console.error('Error creating exam:', err);
        res.status(500).json({ success: false, message: 'Server error while creating exam.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/exams
// @desc    Get all exams for a branch (Admin) or all branches (SuperAdmin)
// @access  Admin, SuperAdmin
router.get('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT 
                e.id,
                e.title as exam_title,
                e.exam_type,
                c.name as exam_class,
                e.subject_type,
                e.exam_date_time,
                b.school_name as branch,
                e.duration_hours as exam_duration
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN branches b ON e.branch_id = b.id
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0) {
                query += ' WHERE e.branch_id = ?';
                queryParams.push(adminStaff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] });
            }
        }

        query += ' ORDER BY e.exam_date_time DESC';

        const [exams] = await pool.query(query, queryParams);
        console.log('Exams fetched successfully.');
        res.json({ success: true, data: exams });
    } catch (err) {
        console.error('Error fetching exams:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching exams.' });
    }
});


// --- CBT Student Facing Endpoints ---

// @route   GET /api/exams/subjects
// @desc    Get subjects for the logged-in student's exam
// @access  Student, NewStudent
router.get('/subjects', [auth, authorize(['Student', 'NewStudent'])], async (req, res) => {
    try {
        // This logic assumes a student is assigned to a single, active exam.
        // You might need a more complex lookup based on class and date.
        const [studentClass] = await pool.query('SELECT class_admitted FROM students WHERE user_id = ?', [req.user.id]);
        if (studentClass.length === 0) {
            return res.status(404).json({ success: false, message: "Student class not found." });
        }

        const [exam] = await pool.query('SELECT id FROM exams WHERE class_id = (SELECT id FROM classes WHERE name = ?) AND exam_date_time > NOW() ORDER BY exam_date_time ASC LIMIT 1', [studentClass[0].class_admitted]);

        if (exam.length === 0) {
            return res.status(404).json({ success: false, message: "No upcoming exams found for your class." });
        }

        const [subjects] = await pool.query('SELECT id, title, exam_id FROM subjects WHERE exam_id = ?', [exam[0].id]);
        res.json({ success: true, data: subjects });
        console.log('Subjects fetched successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// @route   GET /api/exams/subjects/:subjectId/questions
// @desc    Get questions for a specific subject
// @access  Student, NewStudent
router.get('/subjects/:subjectId/questions', [auth, authorize(['Student', 'NewStudent'])], async (req, res) => {
    try {
        const [questions] = await pool.query('SELECT id, question_text as text, options FROM questions WHERE subject_id = ?', [req.params.subjectId]);
        res.json({ success: true, data: questions });
        console.log('Questions fetched successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});


// @route   POST /api/exams/answers
// @desc    Submit answers and calculate score
// @access  Student, NewStudent
router.post('/answers', [auth, authorize(['Student', 'NewStudent'])], async (req, res) => {
    const { answers } = req.body; // answers: [{ question_id: int, selected_option_index: int }]
    const student_id = req.user.id;

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid answers format.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const questionIds = answers.map(a => a.question_id);
        const [questions] = await connection.query('SELECT id, correct_answer_index, subject_id FROM questions WHERE id IN (?)', [questionIds]);

        if (questions.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Associated questions not found.' });
        }

        const [subject] = await connection.query('SELECT exam_id FROM subjects WHERE id = ?', [questions[0].subject_id]);
        const exam_id = subject[0].exam_id;

        let score = 0;
        const questionMap = new Map(questions.map(q => [q.id, q.correct_answer_index]));

        for (const answer of answers) {
            if (questionMap.get(answer.question_id) === answer.selected_option_index) {
                score++;
            }
        }

        const total_questions = (await connection.query('SELECT COUNT(*) as count FROM questions q JOIN subjects s ON q.subject_id = s.id WHERE s.exam_id = ?', [exam_id]))[0][0].count;

        const result = {
            id: uuidv4(),
            exam_id,
            student_id,
            score: (score / total_questions) * 100,
            total_questions,
            answered_questions: answers.length,
            answers: JSON.stringify(answers),
        };

        await connection.query('INSERT INTO exam_results SET ?', result);
        await connection.commit();

        res.status(200).json({ success: true, message: 'Exam submitted successfully.' });

    } catch (err) {
        await connection.rollback();
        console.error('Error submitting answers:', err);
        res.status(500).json({ success: false, message: 'Server error while submitting answers.' });
    } finally {
        connection.release();
    }
});

module.exports = router;