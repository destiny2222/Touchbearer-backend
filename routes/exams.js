const express = require('express');
const router = express.Router();
const { pool } = require('../database');const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');


function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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

        // Check for scheduling conflicts
        const newExamStartTime = new Date(dateTime);
        const newExamEndTime = new Date(newExamStartTime.getTime() + duration * 60 * 60 * 1000);

        const [existingExams] = await connection.query('SELECT exam_date_time, duration_hours FROM exams WHERE class_id = ?', [class_id]);

        for (const existingExam of existingExams) {
            const existingExamStartTime = new Date(existingExam.exam_date_time);
            const existingExamEndTime = new Date(existingExamStartTime.getTime() + existingExam.duration_hours * 60 * 60 * 1000);

            // Check if the time ranges overlap. Exams can be scheduled back-to-back.
            if (newExamStartTime < existingExamEndTime && newExamEndTime > existingExamStartTime) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Schedule conflict: The new exam time overlaps with an existing one.'
                });
            }
        }

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


// @route   PUT /api/exams/:examId
// @desc    Update an existing exam
// @access  Admin, SuperAdmin
router.put('/:examId', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { examId } = req.params;
    const { title, examType, dateTime, duration } = req.body;

    // Basic validation
    if (!title || !examType || !dateTime || !duration) {
        return res.status(400).json({ success: false, message: 'Please provide all required fields for update.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [exam] = await connection.query('SELECT branch_id, class_id FROM exams WHERE id = ?', [examId]);
        if (exam.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Exam not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== exam[0].branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to update this exam.' });
            }
        }

        // Check for scheduling conflicts
        const newExamStartTime = new Date(dateTime);
        const newExamEndTime = new Date(newExamStartTime.getTime() + duration * 60 * 60 * 1000);
        const [existingExams] = await connection.query('SELECT exam_date_time, duration_hours FROM exams WHERE class_id = ? AND id != ?', [exam[0].class_id, examId]);

        for (const existingExam of existingExams) {
            const existingExamStartTime = new Date(existingExam.exam_date_time);
            const existingExamEndTime = new Date(existingExamStartTime.getTime() + existingExam.duration_hours * 60 * 60 * 1000);

            // Check if the time ranges overlap. Exams can be scheduled back-to-back.
            if (newExamStartTime < existingExamEndTime && newExamEndTime > existingExamStartTime) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Schedule conflict: The updated exam time overlaps with an existing one.'
                });
            }
        }

        const updatedExam = {
            title,
            exam_type: examType,
            exam_date_time: dateTime,
            duration_hours: duration
        };

        await connection.query('UPDATE exams SET ? WHERE id = ?', [updatedExam, examId]);
        await connection.commit();

        res.json({ success: true, message: 'Exam updated successfully.', data: updatedExam });
        console.log('Exam updated successfully.');

    } catch (err) {
        await connection.rollback();
        console.error('Error updating exam:', err);
        res.status(500).json({ success: false, message: 'Server error while updating exam.' });
    } finally {
        connection.release();
    }
});

// @route   DELETE /api/exams/:examId
// @desc    Delete an exam
// @access  Admin, SuperAdmin
router.delete('/:examId', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { examId } = req.params;

    try {
        const [exam] = await pool.query('SELECT branch_id FROM exams WHERE id = ?', [examId]);
        if (exam.length === 0) {
            return res.status(404).json({ success: false, message: 'Exam not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== exam[0].branch_id) {
                return res.status(403).json({ success: false, message: 'You are not authorized to delete this exam.' });
            }
        }

        await pool.query('DELETE FROM exams WHERE id = ?', [examId]);
        res.json({ success: true, message: 'Exam deleted successfully.' });
        console.log('Exam deleted successfully.');

    } catch (err) {
        console.error('Error deleting exam:', err);
        res.status(500).json({ success: false, message: 'Server error while deleting exam.' });
    }
});

// @route   GET /api/exams/class
// @desc    Get all exams for the authenticated teacher's class
// @access  Teacher
router.get('/class', [auth, authorize(['Teacher'])], async (req, res) => {
    try {
        const [staff] = await pool.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);

        if (staff.length === 0) {
            return res.status(403).json({ success: false, message: 'Authenticated user is not registered as a staff member.' });
        }
        const teacherId = staff[0].id;

        const [classes] = await pool.query('SELECT id FROM classes WHERE teacher_id = ?', [teacherId]);

        if (classes.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher is not assigned to any class.' });
        }

        const classIds = classes.map(c => c.id);

        const [exams] = await pool.query('SELECT * FROM exams WHERE class_id IN (?) ORDER BY exam_date_time DESC', [classIds]);

        res.json({ success: true, data: exams });

    } catch (error) {
        console.error("Error fetching exams for teacher's class:", error);
        res.status(500).json({ success: false, message: 'Server error while fetching exams.' });
    }
});


// @route   GET /api/exams/upcoming
// @desc    Get all upcoming exams' details publicly
// @access  Public
router.get('/upcoming', async (req, res) => {
    try {
        const query = `
            SELECT
                e.title,
                e.exam_date_time AS date,
                c.name AS class,
                b.school_name as branch,
                GROUP_CONCAT(s.title) AS subjects
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN subjects s ON e.id = s.exam_id
            WHERE e.exam_date_time > NOW()
            GROUP BY e.id, e.title, e.exam_date_time, c.name, b.school_name
            ORDER BY e.exam_date_time ASC;
        `;

        const [exams] = await pool.query(query);

        const upcomingExams = exams.map(exam => ({
            ...exam,
            subjects: exam.subjects ? exam.subjects.split(',') : []
        }));

        res.json({ success: true, data: upcomingExams });

    } catch (err) {
        console.error('Error fetching upcoming exams:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching upcoming exams.' });
    }
});


// @route   GET /api/exams/me/upcoming
// @desc    Get upcoming exams for the authenticated user (student, parent, or teacher)
// @access  Private (Student, NewStudent, Parent, Teacher)
router.get('/me/upcoming', auth, authorize(['Student', 'NewStudent', 'Parent', 'Teacher']), async (req, res) => {
    const { id: userId, roles } = req.user;
    const connection = await pool.getConnection();

    try {
        const classIds = new Set();

        if (roles.includes('Teacher')) {
            const [staff] = await connection.query('SELECT id FROM staff WHERE user_id = ?', [userId]);
            if (staff.length > 0) {
                const teacherId = staff[0].id;
                const [classes] = await connection.query('SELECT id FROM classes WHERE teacher_id = ?', [teacherId]);
                classes.forEach(c => classIds.add(c.id));
            }
        }

        if (roles.includes('Parent')) {
            const [parents] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [userId]);
            if (parents.length > 0) {
                const parentId = parents[0].id;
                const [studentClasses] = await connection.query('SELECT class_id FROM students WHERE parent_id = ?', [parentId]);
                studentClasses.forEach(c => c.class_id && classIds.add(c.class_id));

                const [newStudentClasses] = await connection.query('SELECT class_id FROM new_students WHERE parent_id = ?', [parentId]);
                newStudentClasses.forEach(c => c.class_id && classIds.add(c.class_id));
            }
        }

        if (roles.includes('Student')) {
            const [students] = await connection.query('SELECT class_id FROM students WHERE user_id = ?', [userId]);
            if (students.length > 0 && students[0].class_id) {
                classIds.add(students[0].class_id);
            }
        }

        if (roles.includes('NewStudent')) {
            const [users] = await connection.query('SELECT email FROM users WHERE id = ?', [userId]);
            if (users.length > 0) {
                const studentId = users[0].email;
                const [newStudents] = await connection.query('SELECT class_id FROM new_students WHERE student_id = ?', [studentId]);
                if (newStudents.length > 0 && newStudents[0].class_id) {
                    classIds.add(newStudents[0].class_id);
                }
            }
        }

        const uniqueClassIds = [...classIds];

        if (uniqueClassIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        let examTypeFilter = '';
        if (roles.includes('NewStudent')) {
            examTypeFilter = 'External';
        } else if (roles.includes('Student')) {
            examTypeFilter = 'Internal';
        }

        const query = `
            SELECT
                e.title,
                e.exam_date_time AS date,
                c.name AS class,
                b.school_name as branch,
                GROUP_CONCAT(s.title) AS subjects
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN subjects s ON e.id = s.exam_id
            WHERE e.exam_date_time > NOW() AND e.class_id IN (?) AND e.exam_type = ?
            GROUP BY e.id, e.title, e.exam_date_time, c.name, b.school_name
            ORDER BY e.exam_date_time ASC;
        `;

        const [exams] = await connection.query(query, [uniqueClassIds, examTypeFilter]);

        const upcomingExams = exams.map(exam => ({
            ...exam,
            subjects: exam.subjects ? exam.subjects.split(',') : []
        }));

        res.json({ success: true, data: upcomingExams });

    } catch (err) {
        console.error('Error fetching scoped upcoming exams:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching upcoming exams.' });
    } finally {
        connection.release();
    }
});


// --- CBT Student Facing Endpoints ---

// @route   GET /api/exams/subjects
// @desc    Get subjects for the logged-in student's exam
// @access  Student, NewStudent
router.get('/subjects', [auth, authorize(['Student', 'NewStudent'])], async (req, res) => {
    try {
        let studentClassId;
        let examTypeFilter;
        const { roles } = req.user;

        if (roles.includes('NewStudent')) {
            const [newStudent] = await pool.query('SELECT class_id FROM new_students WHERE student_id = (SELECT email FROM users WHERE id = ?)', [req.user.id]);
            if (newStudent.length > 0) {
                studentClassId = newStudent[0].class_id;
                examTypeFilter = 'External';
            }
        } else if (roles.includes('Student')) {
            const [existingStudent] = await pool.query('SELECT class_id FROM students WHERE user_id = ?', [req.user.id]);
            if (existingStudent.length > 0) {
                studentClassId = existingStudent[0].class_id;
                examTypeFilter = 'Internal';
            }
        }

        if (!studentClassId) {
            return res.status(404).json({ success: false, message: "Student class not found." });
        }

        const [exam] = await pool.query('SELECT id, duration_hours FROM exams WHERE class_id = ? AND exam_type = ? AND exam_date_time > NOW() ORDER BY exam_date_time ASC LIMIT 1', [studentClassId, examTypeFilter]);

        if (exam.length === 0) {
            return res.status(404).json({ success: false, message: "No upcoming exams found for your class." });
        }

        const examId = exam[0].id;
        const examDuration = exam[0].duration_hours;

        const [subjects] = await pool.query('SELECT id, title FROM subjects WHERE exam_id = ?', [examId]);

        res.json({
            success: true,
            data: {
                examId,
                examDuration,
                subjects
            }
        });
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
        // Find the exam for the subject to check the time window
        const [subjects] = await pool.query('SELECT exam_id FROM subjects WHERE id = ?', [req.params.subjectId]);
        if (subjects.length === 0) {
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }

        const [exams] = await pool.query('SELECT exam_date_time, duration_hours FROM exams WHERE id = ?', [subjects[0].exam_id]);
        if (exams.length === 0) {
            return res.status(404).json({ success: false, message: 'Exam not found for this subject.' });
        }

        const now = new Date();
        const examDateTime = new Date(exams[0].exam_date_time);

        // Allowed to fetch 30 mins before exam starts
        const allowedStartTime = new Date(examDateTime.getTime() - 30 * 60 * 1000);

        // Exam ends after its duration
        const examEndTime = new Date(examDateTime.getTime() + exams[0].duration_hours * 60 * 60 * 1000);

        if (now < allowedStartTime) {
            return res.status(403).json({ success: false, message: 'It is not yet time for the exam.' });
        }

        if (now > examEndTime) {
            return res.status(403).json({ success: false, message: 'The time for this exam has passed.' });
        }

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
    const { examId, answers } = req.body; // answers: [{ questionId: string, selectedOptionIndex: int }]
    const userId = req.user.id;

    if (!examId || !answers || !Array.isArray(answers)) {
        return res.status(400).json({ success: false, message: 'Missing examId or answers.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch exam details and validate
        const [examResult] = await connection.query('SELECT * FROM exams WHERE id = ?', [examId]);
        if (examResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Exam not found.' });
        }
        const exam = examResult[0];

        // Check if exam is still active
        const now = new Date();
        const examDateTime = new Date(exam.exam_date_time);
        const examEndTime = new Date(examDateTime.getTime() + exam.duration_hours * 60 * 60 * 1000);
        if (now > examEndTime) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'The time for this exam has passed. Submission is no longer accepted.' });
        }

        // Check for prior submissions
        const [existingResult] = await connection.query('SELECT id FROM exam_results WHERE exam_id = ? AND student_id = ?', [examId, userId]);
        if (existingResult.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'You have already submitted answers for this exam.' });
        }

        // Fetch all questions for the exam to validate answers and calculate score
        const [allQuestions] = await connection.query(`
            SELECT q.id, q.correct_answer_index 
            FROM questions q
            JOIN subjects s ON q.subject_id = s.id
            WHERE s.exam_id = ?
        `, [examId]);

        if (allQuestions.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'No questions found for this exam.' });
        }

        const totalQuestions = allQuestions.length;
        const questionMap = new Map(allQuestions.map(q => [q.id, q.correct_answer_index]));

        let score = 0;
        for (const answer of answers) {
            const questionId = answer.questionId;
            const selectedOptionIndex = answer.selectedOptionIndex;

            if (questionMap.has(questionId)) {
                // Use non-strict equality to guard against type mismatches (e.g., '1' vs 1)
                if (questionMap.get(questionId) == selectedOptionIndex) {
                    score++;
                }
            }
        }

        // Avoid division by zero if an exam has no questions
        const percentageScore = totalQuestions > 0 ? (score / totalQuestions) * 100 : 0;

        // Get active term for the branch
        const [terms] = await connection.query('SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE', [exam.branch_id]);
        const termId = terms.length > 0 ? terms[0].id : null;

        const result = {
            id: uuidv4(),
            exam_id: examId,
            student_id: userId,
            term_id: termId,
            score: percentageScore,
            total_questions: totalQuestions,
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

// @route   GET /api/exams/:examId/results
// @desc    Get all results for a specific exam
// @access  Admin, SuperAdmin
router.get('/:examId/results', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { examId } = req.params;

    try {
        const [exam] = await pool.query('SELECT branch_id FROM exams WHERE id = ?', [examId]);
        if (exam.length === 0) {
            return res.status(404).json({ success: false, message: 'Exam not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== exam[0].branch_id) {
                return res.status(403).json({ success: false, message: 'You are not authorized to view results for this exam.' });
            }
        }

        const query = `
            SELECT
                er.id,
                er.score,
                er.total_questions,
                er.answered_questions,
                er.submitted_at,
                er.published,
                s.first_name,
                s.last_name
            FROM exam_results er
            JOIN users u ON er.student_id = u.id
            JOIN students s ON u.id = s.user_id
            WHERE er.exam_id = ?
        `;

        const [results] = await pool.query(query, [examId]);
        res.json({ success: true, data: results });

    } catch (err) {
        console.error('Error fetching exam results:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching exam results.' });
    }
});

// @route   GET /api/exams/:examId/results/teacher
// @desc    Get all results for a specific exam for the teacher's class
// @access  Teacher
router.get('/:examId/results/teacher', [auth, authorize(['Teacher'])], async (req, res) => {
    const { examId } = req.params;

    try {
        const [staff] = await pool.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);
        if (staff.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not registered as a staff member.' });
        }
        const teacherId = staff[0].id;

        const [teacherClasses] = await pool.query('SELECT id FROM classes WHERE teacher_id = ?', [teacherId]);
        if (teacherClasses.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not assigned to any class.' });
        }
        const teacherClassIds = teacherClasses.map(c => c.id);

        const query = `
            SELECT
                er.id,
                er.score,
                er.total_questions,
                er.answered_questions,
                er.submitted_at,
                er.published,
                s.first_name,
                s.last_name
            FROM exam_results er
            JOIN users u ON er.student_id = u.id
            JOIN students s ON u.id = s.user_id
            WHERE er.exam_id = ? AND s.class_id IN (?)
        `;

        const [results] = await pool.query(query, [examId, teacherClassIds]);
        res.json({ success: true, data: results });

    } catch (err) {
        console.error('Error fetching exam results for teacher:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching exam results.' });
    }
});

// @route   PUT /api/exams/results/publish
// @desc    Publish results for a specific exam for the teacher's class
// @access  Teacher
router.put('/results/publish', [auth, authorize(['Teacher'])], async (req, res) => {
    const { exam_id, class_id } = req.body;

    try {
        const [staff] = await pool.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);
        if (staff.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not registered as a staff member.' });
        }
        const teacherId = staff[0].id;

        const [teacherClass] = await pool.query('SELECT id FROM classes WHERE teacher_id = ? AND id = ?', [teacherId, class_id]);
        if (teacherClass.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not authorized to publish results for this class.' });
        }

        const updateQuery = `
            UPDATE exam_results
            SET
                published = TRUE,
                published_by = ?,
                published_at = NOW()
            WHERE exam_id = ? AND student_id IN (
                SELECT user_id FROM students WHERE class_id = ?
            )
        `;

        await pool.query(updateQuery, [req.user.id, exam_id, class_id]);
        res.json({ success: true, message: 'Results published successfully.' });

    } catch (err) {
        console.error('Error publishing exam results:', err);
        res.status(500).json({ success: false, message: 'Server error while publishing exam results.' });
    }
});

// @route   GET /api/exams/results/me
// @desc    Get the authenticated student's own published results for the current term
// @access  Student
router.get('/results/me', [auth, authorize(['Student'])], async (req, res) => {
    try {
        const [student] = await pool.query('SELECT id, class_id, branch_id FROM students WHERE user_id = ?', [req.user.id]);
        if (student.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const { class_id, branch_id } = student[0];

        const [terms] = await pool.query('SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE', [branch_id]);
        if (terms.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found for your branch.' });
        }
        const term_id = terms[0].id;

        const query = `
            SELECT
                er.id,
                er.score,
                er.exam_id,
                e.title as exam_title
            FROM exam_results er
            JOIN exams e ON er.exam_id = e.id
            WHERE er.student_id = ? AND er.published = TRUE AND er.term_id = ?
            ORDER BY e.exam_date_time DESC
        `;

        const [results] = await pool.query(query, [req.user.id, term_id]);

        // Calculate position for each result
        const resultsWithPosition = await Promise.all(results.map(async (result) => {
            const [classScores] = await pool.query(`
                SELECT score FROM exam_results 
                WHERE exam_id = ? AND published = TRUE AND student_id IN 
                (SELECT user_id FROM students WHERE class_id = ?)
                ORDER BY score DESC
            `, [result.exam_id, class_id]);

            const scores = classScores.map(s => parseFloat(s.score));
            const rank = scores.indexOf(parseFloat(result.score)) + 1;
            
            return {
                ...result,
                position: getOrdinal(rank)
            };
        }));

        res.json({ success: true, data: resultsWithPosition });

    } catch (err) {
        console.error('Error fetching student exam results:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching exam results.' });
    }
});

module.exports = router;
