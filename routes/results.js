const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const moment = require('moment');

// Helper function to get staff info and verify teacher authorization
async function getStaffInfo(userId) {
    const [rows] = await pool.query('SELECT id, branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0] : null;
}

// Helper function to check if teacher can manage this subject
async function canTeacherManageSubject(teacherStaffId, subjectId) {
    const [rows] = await pool.query(
        'SELECT id FROM class_subjects WHERE id = ? AND teacher_id = ?',
        [subjectId, teacherStaffId]
    );
    return rows.length > 0;
}

// Helper function to format ordinal numbers (1st, 2nd, 3rd)
function getOrdinal(n) {
    if (n == null) return '';
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// POST /api/results/save - Save or update student results (Upsert)
router.post('/save', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin'])], async (req, res) => {
    const { class_id, subject_id, assessment_type, exam_id, scores } = req.body;

    // Validation
    if (!class_id || !subject_id || !assessment_type || !scores || !Array.isArray(scores)) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: class_id, subject_id, assessment_type, and scores array are required.'
        });
    }

    // Validate assessment_type
    const validAssessmentTypes = ['ca1', 'ca2', 'ca3', 'exam'];
    if (!validAssessmentTypes.includes(assessment_type)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid assessment_type. Must be one of: ca1, ca2, ca3, exam'
        });
    }

    if (scores.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Scores array cannot be empty.'
        });
    }

    // Validate each score entry
    for (const entry of scores) {
        if (!entry.student_id || entry.score === undefined || entry.score === null) {
            return res.status(400).json({
                success: false,
                message: 'Each score entry must have student_id and score.'
            });
        }
        if (typeof entry.score !== 'number' || entry.score < 0 || entry.score > 100) {
            return res.status(400).json({
                success: false,
                message: 'Score must be a number between 0 and 100.'
            });
        }
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Verify class exists and get branch_id
        const [classInfo] = await connection.query(
            'SELECT id, branch_id FROM classes WHERE id = ?',
            [class_id]
        );
        if (classInfo.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }
        const branch_id = classInfo[0].branch_id;

        // Verify subject exists and belongs to this class
        const [subjectInfo] = await connection.query(
            'SELECT id, class_id, teacher_id FROM class_subjects WHERE id = ?',
            [subject_id]
        );
        if (subjectInfo.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }
        if (subjectInfo[0].class_id !== class_id) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Subject does not belong to the specified class.'
            });
        }

        // Get teacher's staff info
        const staffInfo = await getStaffInfo(req.user.id);
        if (!staffInfo) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Staff record not found.' });
        }

        // Authorization checks
        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            // Teacher can only save results for subjects they teach
            const canManage = await canTeacherManageSubject(staffInfo.id, subject_id);
            if (!canManage) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'You can only save results for subjects you teach.'
                });
            }

            // Verify branch matches
            if (staffInfo.branch_id !== branch_id) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'You can only save results for your own branch.'
                });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            // Admin can only manage results in their branch
            if (staffInfo.branch_id !== branch_id) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only save results for their own branch.'
                });
            }
        }

        // Get active term for the branch
        const [activeTerm] = await connection.query(
            'SELECT id FROM terms WHERE is_active = TRUE AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id DESC LIMIT 1',
            [branch_id]
        );
        const term_id = activeTerm.length > 0 ? activeTerm[0].id : null;

        // Verify all students exist and belong to the class
        const studentIds = scores.map(s => s.student_id);
        const [students] = await connection.query(
            'SELECT id FROM students WHERE id IN (?) AND class_id = ?',
            [studentIds, class_id]
        );

        if (students.length !== studentIds.length) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'One or more students not found in the specified class.'
            });
        }

        // Upsert logic: Insert or update each score
        let insertedCount = 0;
        let updatedCount = 0;

        for (const scoreEntry of scores) {
            const { student_id, score } = scoreEntry;

            // Check if a record already exists
            const [existing] = await connection.query(
                'SELECT id FROM student_results WHERE student_id = ? AND subject_id = ? AND term_id = ? AND assessment_type = ?',
                [student_id, subject_id, term_id, assessment_type]
            );

            if (existing.length > 0) {
                // Update existing record
                await connection.query(
                    'UPDATE student_results SET score = ?, teacher_id = ?, exam_id = ?, updated_at = NOW() WHERE id = ?',
                    [score, staffInfo.id, exam_id || null, existing[0].id]
                );
                updatedCount++;
            } else {
                // Insert new record
                const resultId = uuidv4();
                await connection.query(
                    'INSERT INTO student_results (id, student_id, class_id, subject_id, term_id, assessment_type, score, teacher_id, branch_id, exam_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [resultId, student_id, class_id, subject_id, term_id, assessment_type, score, staffInfo.id, branch_id, exam_id || null]
                );
                insertedCount++;
            }
        }

        await connection.commit();

        res.status(200).json({
            success: true,
            message: 'Results saved successfully.',
            data: {
                inserted: insertedCount,
                updated: updatedCount,
                total: scores.length
            }
        });

    } catch (err) {
        await connection.rollback();
        console.error('Error saving results:', err);
        res.status(500).json({ success: false, message: 'Server error while saving results.' });
    } finally {
        connection.release();
    }
});

// GET /api/results/class/:class_id/subject/:subject_id - Get results for a class and subject, including students without scores
// Requires query param: assessment_type (ca1, ca2, ca3, exam)
router.get('/class/:class_id/subject/:subject_id', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin'])], async (req, res) => {
    const { class_id, subject_id } = req.params;
    const { assessment_type } = req.query;

    if (!assessment_type) {
        return res.status(400).json({ success: false, message: 'The assessment_type query parameter is required.' });
    }

    const validTypes = ['ca1', 'ca2', 'ca3', 'exam'];
    if (!validTypes.includes(assessment_type)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid assessment_type. Must be one of: ca1, ca2, ca3, exam'
        });
    }

    try {
        // Verify class and subject exist
        const [classInfo] = await pool.query('SELECT id, branch_id FROM classes WHERE id = ?', [class_id]);
        if (classInfo.length === 0) {
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }
        const branch_id = classInfo[0].branch_id;

        const [subjectInfo] = await pool.query('SELECT id FROM class_subjects WHERE id = ? AND class_id = ?', [subject_id, class_id]);
        if (subjectInfo.length === 0) {
            return res.status(404).json({ success: false, message: 'Subject not found for this class.' });
        }

        // Authorization checks
        const staffInfo = await getStaffInfo(req.user.id);
        if (!staffInfo) {
            return res.status(403).json({ success: false, message: 'Staff record not found.' });
        }

        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const canManage = await canTeacherManageSubject(staffInfo.id, subject_id);
            if (!canManage) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only view results for subjects you teach.'
                });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            if (staffInfo.branch_id !== branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only view results for their own branch.'
                });
            }
        }

        // Get active term
        const [activeTerm] = await pool.query(
            'SELECT id FROM terms WHERE is_active = TRUE AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id DESC LIMIT 1',
            [branch_id]
        );
        const term_id = activeTerm.length > 0 ? activeTerm[0].id : null;

        if (!term_id) {
            return res.status(404).json({ success: false, message: 'No active term found for this branch.' });
        }

        // Fetch all students in the class and LEFT JOIN their results for the specific assessment
        const query = `
            SELECT
                s.id as student_id,
                s.first_name,
                s.last_name,
                sr.score,
                sr.id as result_id,
                sr.exam_id
            FROM students s
            LEFT JOIN student_results sr ON s.id = sr.student_id
                AND sr.subject_id = ?
                AND sr.term_id = ?
                AND sr.assessment_type = ?
            WHERE s.class_id = ?
            ORDER BY s.last_name ASC, s.first_name ASC;
        `;

        const queryParams = [subject_id, term_id, assessment_type, class_id];
        const [results] = await pool.query(query, queryParams);

        res.json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (err) {
        console.error('Error fetching results:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching results.' });
    }
});

// GET /api/results/me/report-card - Get a formatted report card for the logged-in student
router.get('/me/report-card', [auth, authorize(['Student', 'Parent'])], async (req, res) => {
    const { term_id } = req.query;

    if (!term_id) {
        return res.status(400).json({ success: false, message: 'The term_id query parameter is required.' });
    }

    const connection = await pool.getConnection();
    try {
        // 1. Get student_id from logged-in user
        const [student] = await connection.query('SELECT id, class_id, branch_id, user_id, parent_id, first_name, last_name FROM students WHERE user_id = ?', [req.user.id]);
        if (student.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const studentData = student[0];
        const student_id = studentData.id;

        // 2. Get Term and Class Info
        const [termInfo] = await connection.query('SELECT name, session, start_date, end_date, next_term_begins FROM terms WHERE id = ?', [term_id]);
        if (termInfo.length === 0) {
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }
        const [classInfo] = await connection.query('SELECT name, arm FROM classes WHERE id = ?', [studentData.class_id]);

        // 3. Fetch results for the entire class for the specified term
        let resultsQuery = `
            SELECT sr.student_id, sr.subject_id, cs.name as subject_name, sr.assessment_type, sr.score
            FROM student_results sr
            JOIN class_subjects cs ON sr.subject_id = cs.id
            WHERE sr.class_id = ? AND sr.term_id = ? AND sr.published = TRUE
        `;
        const [allResults] = await connection.query(resultsQuery, [studentData.class_id, term_id]);

        if (allResults.length === 0) {
            return res.status(200).json({ success: true, data: { results: [] }, message: 'No published results found for this student in the selected term.' });
        }

        // 4. Process the results data
        const resultsByStudent = {};
        allResults.forEach(r => {
            const studentId = r.student_id;
            const subjectId = r.subject_id;
            if (!resultsByStudent[studentId]) {
                resultsByStudent[studentId] = { subjects: {}, total_score: 0 };
            }
            if (!resultsByStudent[studentId].subjects[subjectId]) {
                resultsByStudent[studentId].subjects[subjectId] = { subject_name: r.subject_name };
            }
            resultsByStudent[studentId].subjects[subjectId][r.assessment_type] = parseFloat(r.score);
        });

        Object.keys(resultsByStudent).forEach(studentId => {
            let studentTotalScore = 0;
            Object.values(resultsByStudent[studentId].subjects).forEach(subject => {
                const ca1 = subject.ca1 || 0;
                const ca2 = subject.ca2 || 0;
                const exam = subject.exam || 0;
                subject.total = ca1 + ca2 + exam;
                studentTotalScore += subject.total;
            });
            resultsByStudent[studentId].total_score = studentTotalScore;
        });

        // 5. Calculate stats for each subject
        const reportCard = [];
        const subjectsInClass = [...new Map(allResults.map(item => [item.subject_id, {id: item.subject_id, name: item.subject_name}])).values()];

        for (const subject of subjectsInClass) {
            const subjectScores = Object.values(resultsByStudent)
                .map(student => student.subjects[subject.id]?.total)
                .filter(total => total !== undefined && total !== null);

            if (subjectScores.length === 0) continue;

            const highest = Math.max(...subjectScores);
            const lowest = Math.min(...subjectScores);
            const average = subjectScores.reduce((a, b) => a + b, 0) / subjectScores.length;
            const sortedScores = [...subjectScores].sort((a, b) => b - a);
            const studentSubjectData = resultsByStudent[student_id]?.subjects[subject.id];
            
            if (!studentSubjectData) continue;

            const studentTotal = studentSubjectData.total;
            const rank = sortedScores.indexOf(studentTotal) + 1;

            let grade = 'F';
            if (studentTotal >= 75) grade = 'A';
            else if (studentTotal >= 65) grade = 'B';
            else if (studentTotal >= 50) grade = 'C';
            else if (studentTotal >= 45) grade = 'D';
            else if (studentTotal >= 40) grade = 'E';

            reportCard.push({
                subject: subject.name,
                ca1: studentSubjectData.ca1 || 0,
                ca2: studentSubjectData.ca2 || 0,
                exam: studentSubjectData.exam || 0,
                total: studentTotal,
                grade: grade,
                position: getOrdinal(rank),
                highest: highest,
                lowest: lowest,
                average: parseFloat(average.toFixed(2))
            });
        }

        // 6. Calculate overall position
        const allStudentTotals = Object.values(resultsByStudent).map(s => s.total_score);
        const sortedTotals = [...allStudentTotals].sort((a, b) => b - a);
        const studentRank = sortedTotals.indexOf(resultsByStudent[student_id].total_score) + 1;

        // 7. Fetch attendance data
        const [attendance] = await connection.query(
            `SELECT status, COUNT(*) as count 
             FROM student_attendance 
             WHERE student_id = ? AND date BETWEEN ? AND ? 
             GROUP BY status`,
            [student_id, termInfo[0].start_date, termInfo[0].end_date]
        );
        const attendanceData = { Present: 0, Absent: 0, Late: 0, ...Object.fromEntries(attendance.map(a => [a.status, a.count])) };
        const schoolDays = moment(termInfo[0].end_date).diff(moment(termInfo[0].start_date), 'days');

        // 8. Fetch skills data
        const [skills] = await connection.query(
            'SELECT skill_type, skill_name, rating FROM student_skills WHERE student_id = ? AND term_id = ?',
            [student_id, term_id]
        );
        const skillsData = { Affective: [], Psychomotor: [] };
        skills.forEach(skill => {
            if (skillsData[skill.skill_type]) {
                skillsData[skill.skill_type].push({ name: skill.skill_name, rating: skill.rating });
            }
        });

        // 9. Fetch comments
        const [comments] = await connection.query(
            'SELECT teacher_comment, principal_comment FROM report_card_comments WHERE student_id = ? AND term_id = ?',
            [student_id, term_id]
        );
        const commentData = comments.length > 0 ? comments[0] : { teacher_comment: '', principal_comment: '' };

        res.json({
            success: true,
            data: {
                student: { name: `${studentData.first_name} ${studentData.last_name}`, class: `${classInfo[0].name} ${classInfo[0].arm || ''}`.trim() },
                term: { name: termInfo[0].name, session: termInfo[0].session, next_term_begins: termInfo[0].next_term_begins },
                attendance: { school_opened: schoolDays, present: attendanceData.Present, absent: attendanceData.Absent },
                position: getOrdinal(studentRank),
                total_students: allStudentTotals.length,
                results: reportCard,
                skills: skillsData,
                comments: commentData
            }
        });

    } catch (err) {
        console.error('Error fetching student report card:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching report card.' });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/results/student/:student_id - Get all results for a specific student
router.get('/student/:student_id', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin', 'Student', 'Parent'])], async (req, res) => {
    const { student_id } = req.params;

    try {
        // Verify student exists
        const [student] = await pool.query('SELECT id, class_id, branch_id, user_id, parent_id FROM students WHERE id = ?', [student_id]);
        if (student.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const studentData = student[0];

        // Authorization checks
        if (req.user.roles.includes('Student')) {
            // Students can only view their own results
            if (studentData.user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'You can only view your own results.' });
            }
        }

        if (req.user.roles.includes('Parent')) {
            // Parents can only view their children's results
            const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
            if (parent.length === 0 || parent[0].id !== studentData.parent_id) {
                return res.status(403).json({ success: false, message: 'You can only view your own children\'s results.' });
            }
        }

        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            // Teachers can only view results for students in classes they teach
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo) {
                return res.status(403).json({ success: false, message: 'Staff record not found.' });
            }

            const [teacherClasses] = await pool.query('SELECT id FROM classes WHERE teacher_id = ?', [staffInfo.id]);
            const classIds = teacherClasses.map(c => c.id);

            if (!classIds.includes(studentData.class_id)) {
                return res.status(403).json({ success: false, message: 'You can only view results for students in your classes.' });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (staffInfo && staffInfo.branch_id !== studentData.branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only view results for their own branch.' });
            }
        }

        // Get active term
        const [activeTerm] = await pool.query(
            'SELECT id FROM terms WHERE is_active = TRUE AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id DESC LIMIT 1',
            [studentData.branch_id]
        );
        const term_id = activeTerm.length > 0 ? activeTerm[0].id : null;

        // Fetch results
        const query = `
            SELECT 
                sr.id,
                sr.exam_id,
                sr.assessment_type,
                sr.score,
                cs.name as subject_name,
                sr.created_at,
                sr.updated_at,
                st.name as teacher_name
            FROM student_results sr
            LEFT JOIN class_subjects cs ON sr.subject_id = cs.id
            LEFT JOIN staff st ON sr.teacher_id = st.id
            WHERE sr.student_id = ? AND sr.term_id = ?
            ORDER BY cs.name ASC, sr.assessment_type ASC
        `;

        const [results] = await pool.query(query, [student_id, term_id]);

        res.json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (err) {
        console.error('Error fetching student results:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching student results.' });
    }
});

// DELETE /api/results/:result_id - Delete a specific result
router.delete('/:result_id', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin'])], async (req, res) => {
    const { result_id } = req.params;

    try {
        // Get result info
        const [result] = await pool.query(
            'SELECT id, subject_id, branch_id, teacher_id FROM student_results WHERE id = ?',
            [result_id]
        );
        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Result not found.' });
        }
        const resultData = result[0];

        // Authorization checks
        const staffInfo = await getStaffInfo(req.user.id);
        if (!staffInfo) {
            return res.status(403).json({ success: false, message: 'Staff record not found.' });
        }

        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            // Teachers can only delete results they created for subjects they teach
            const canManage = await canTeacherManageSubject(staffInfo.id, resultData.subject_id);
            if (!canManage || resultData.teacher_id !== staffInfo.id) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only delete results you created for subjects you teach.'
                });
            }
        }

        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            if (staffInfo.branch_id !== resultData.branch_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only delete results for their own branch.'
                });
            }
        }

        // Delete the result
        await pool.query('DELETE FROM student_results WHERE id = ?', [result_id]);

        res.json({
            success: true,
            message: 'Result deleted successfully.'
        });

    } catch (err) {
        console.error('Error deleting result:', err);
        res.status(500).json({ success: false, message: 'Server error while deleting result.' });
    }
});

// POST /api/results/publish-all - Publish all results for a specific session/term/class/arm
router.post('/publish-all', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { session, term, class: className, arm } = req.body;

    // Validation
    if (!session || !term || !className) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: session, term, and class are required.'
        });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Get staff info for authorization
        const staffInfo = await getStaffInfo(req.user.id);
        if (!staffInfo && req.user.roles.includes('Admin')) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Staff record not found.' });
        }

        // Find the term by name and session
        const [terms] = await connection.query(
            'SELECT id, branch_id FROM terms WHERE name = ? AND session = ?',
            [term, session]
        );

        if (terms.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: `Term "${term}" with session "${session}" not found.`
            });
        }

        const term_id = terms[0].id;
        const term_branch_id = terms[0].branch_id;

        // Find the class by name (and optionally arm)
        let classQuery = 'SELECT id, branch_id FROM classes WHERE name = ?';
        const classParams = [className];

        if (arm) {
            classQuery += ' AND arm = ?';
            classParams.push(arm);
        }

        const [classes] = await connection.query(classQuery, classParams);

        if (classes.length === 0) {
            await connection.rollback();
            const armMsg = arm ? ` with arm "${arm}"` : '';
            return res.status(404).json({
                success: false,
                message: `Class "${className}"${armMsg} not found.`
            });
        }

        const class_id = classes[0].id;
        const class_branch_id = classes[0].branch_id;

        // Authorization check for Admin
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            if (staffInfo.branch_id !== class_branch_id) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Admins can only publish results for their own branch.'
                });
            }
        }

        // Update all unpublished results for this class and term
        const [updateResult] = await connection.query(
            `UPDATE student_results 
             SET published = TRUE, published_by = ?, published_at = NOW() 
             WHERE class_id = ? AND term_id = ? AND published = FALSE`,
            [req.user.id, class_id, term_id]
        );

        await connection.commit();

        res.status(200).json({
            success: true,
            message: 'Results published successfully.',
            data: {
                published_count: updateResult.affectedRows,
                session,
                term,
                class: className,
                arm: arm || null
            }
        });

    } catch (err) {
        await connection.rollback();
        console.error('Error publishing results:', err);
        res.status(500).json({ success: false, message: 'Server error while publishing results.' });
    } finally {
        connection.release();
    }
});

// GET /api/results - Get results with optional filters (session, term, class, arm)
router.get('/', [auth, authorize(['Admin', 'SuperAdmin', 'Teacher'])], async (req, res) => {
    const { session, term, class: className, arm, published_only, class_id, subject_id, assessment_type } = req.query;

    try {
        // Build the query dynamically based on filters
        let query = `
            SELECT 
                sr.id,
                sr.student_id,
                s.first_name,
                s.last_name,
                c.name as class_name,
                c.arm as class_arm,
                cs.name as subject_name,
                t.name as term_name,
                t.session,
                sr.assessment_type,
                sr.score,
                sr.published,
                sr.published_at,
                sr.created_at,
                sr.updated_at,
                st.name as teacher_name,
                pub_user.email as published_by_email
            FROM student_results sr
            LEFT JOIN students s ON sr.student_id = s.id
            LEFT JOIN classes c ON sr.class_id = c.id
            LEFT JOIN class_subjects cs ON sr.subject_id = cs.id
            LEFT JOIN terms t ON sr.term_id = t.id
            LEFT JOIN staff st ON sr.teacher_id = st.id
            LEFT JOIN users pub_user ON sr.published_by = pub_user.id
            WHERE 1=1
        `;

        const queryParams = [];

        // Get staff info for authorization
        const staffInfo = await getStaffInfo(req.user.id);
        if (!staffInfo) {
            return res.status(403).json({ success: false, message: 'Staff record not found.' });
        }

        // Authorization: Admin can only see their branch
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            query += ' AND sr.branch_id = ?';
            queryParams.push(staffInfo.branch_id);
        }

        // Authorization: Teacher can only see their subjects
        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            query += ' AND cs.teacher_id = ?';
            queryParams.push(staffInfo.id);
        }

        // Apply filters
        if (session) {
            query += ' AND t.session = ?';
            queryParams.push(session);
        }

        if (term) {
            query += ' AND t.name = ?';
            queryParams.push(term);
        }

        if (className) {
            query += ' AND c.name = ?';
            queryParams.push(className);
        }

        if (arm) {
            query += ' AND c.arm = ?';
            queryParams.push(arm);
        }

        if (class_id) {
            query += ' AND sr.class_id = ?';
            queryParams.push(class_id);
        }

        if (subject_id) {
            query += ' AND sr.subject_id = ?';
            queryParams.push(subject_id);
        }

        if (assessment_type) {
            query += ' AND sr.assessment_type = ?';
            queryParams.push(assessment_type);
        }

        if (published_only === 'true') {
            query += ' AND sr.published = TRUE';
        }

        query += ' ORDER BY s.last_name ASC, s.first_name ASC, cs.name ASC, sr.assessment_type ASC';

        const [results] = await pool.query(query, queryParams);

        res.json({
            success: true,
            count: results.length,
            filters: {
                session: session || null,
                term: term || null,
                class: className || null,
                arm: arm || null,
                published_only: published_only === 'true',
                class_id: class_id || null,
                subject_id: subject_id || null,
                assessment_type: assessment_type || null
            },
            data: results
        });

    } catch (err) {
        console.error('Error fetching results:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching results.' });
    }
});

// GET /api/results/student/:student_id/report-card - Get a formatted report card for a student
router.get('/student/:student_id/report-card', [auth, authorize(['Teacher', 'Admin', 'SuperAdmin', 'Student', 'Parent'])], async (req, res) => {
    const { student_id } = req.params;
    const { term_id } = req.query;

    if (!term_id) {
        return res.status(400).json({ success: false, message: 'The term_id query parameter is required.' });
    }

    const connection = await pool.getConnection();
    try {
        // 1. Verify student exists and perform authorization checks
        const [student] = await connection.query('SELECT id, class_id, branch_id, user_id, parent_id, first_name, last_name FROM students WHERE id = ?', [student_id]);
        if (student.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const studentData = student[0];

        // Authorization checks
        if (req.user.roles.includes('Student')) {
            if (studentData.user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'You can only view your own results.' });
            }
        }
        if (req.user.roles.includes('Parent')) {
            const [parent] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
            if (parent.length === 0 || parent[0].id !== studentData.parent_id) {
                return res.status(403).json({ success: false, message: 'You can only view your own children\'s results.' });
            }
        }
        if (req.user.roles.includes('Teacher') && !req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (!staffInfo) return res.status(403).json({ success: false, message: 'Staff record not found.' });
            const [teacherClasses] = await connection.query('SELECT id FROM classes WHERE teacher_id = ?', [staffInfo.id]);
            if (!teacherClasses.map(c => c.id).includes(studentData.class_id)) {
                return res.status(403).json({ success: false, message: 'You can only view results for students in your classes.' });
            }
        }
        if (req.user.roles.includes('Admin') && !req.user.roles.includes('SuperAdmin')) {
            const staffInfo = await getStaffInfo(req.user.id);
            if (staffInfo && staffInfo.branch_id !== studentData.branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only view results for their own branch.' });
            }
        }

        // 2. Get Term and Class Info
        const [termInfo] = await connection.query('SELECT name, session, start_date, end_date, next_term_begins FROM terms WHERE id = ?', [term_id]);
        if (termInfo.length === 0) {
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }
        const [classInfo] = await connection.query('SELECT name, arm FROM classes WHERE id = ?', [studentData.class_id]);

        // 3. Fetch results for the entire class for the specified term
        let resultsQuery = `
            SELECT sr.student_id, sr.subject_id, cs.name as subject_name, sr.assessment_type, sr.score
            FROM student_results sr
            JOIN class_subjects cs ON sr.subject_id = cs.id
            WHERE sr.class_id = ? AND sr.term_id = ?
        `;
        const queryParams = [studentData.class_id, term_id];

        // Only show published results to students and parents
        if (req.user.roles.includes('Student') || req.user.roles.includes('Parent')) {
            resultsQuery += ' AND sr.published = TRUE';
        }

        const [allResults] = await connection.query(resultsQuery, queryParams);

        if (allResults.length === 0) {
            return res.status(200).json({ success: true, data: { results: [] }, message: 'No published results found for this student in the selected term.' });
        }

        // 4. Process the results data into a nested structure
        const resultsByStudent = {};
        allResults.forEach(r => {
            const studentId = r.student_id;
            const subjectId = r.subject_id;
            if (!resultsByStudent[studentId]) {
                resultsByStudent[studentId] = { subjects: {}, total_score: 0 };
            }
            if (!resultsByStudent[studentId].subjects[subjectId]) {
                resultsByStudent[studentId].subjects[subjectId] = { subject_name: r.subject_name };
            }
            resultsByStudent[studentId].subjects[subjectId][r.assessment_type] = parseFloat(r.score);
        });

        // Calculate totals for each student/subject and overall total
        Object.keys(resultsByStudent).forEach(studentId => {
            let studentTotalScore = 0;
            Object.values(resultsByStudent[studentId].subjects).forEach(subject => {
                const ca1 = subject.ca1 || 0;
                const ca2 = subject.ca2 || 0;
                const exam = subject.exam || 0;
                subject.total = ca1 + ca2 + exam;
                studentTotalScore += subject.total;
            });
            resultsByStudent[studentId].total_score = studentTotalScore;
        });

        // 5. Calculate stats (average, highest, lowest, position) for each subject
        const reportCard = [];
        const subjectsInClass = [...new Map(allResults.map(item => [item.subject_id, {id: item.subject_id, name: item.subject_name}])).values()];

        for (const subject of subjectsInClass) {
            const subjectScores = Object.values(resultsByStudent)
                .map(student => student.subjects[subject.id]?.total)
                .filter(total => total !== undefined && total !== null);

            if (subjectScores.length === 0) continue;

            const highest = Math.max(...subjectScores);
            const lowest = Math.min(...subjectScores);
            const average = subjectScores.reduce((a, b) => a + b, 0) / subjectScores.length;

            const sortedScores = [...subjectScores].sort((a, b) => b - a);
            
            const studentSubjectData = resultsByStudent[student_id]?.subjects[subject.id];
            
            // If student has no result for this subject, we can't generate a row for them.
            if (!studentSubjectData) continue;

            const studentTotal = studentSubjectData.total;
            const rank = sortedScores.indexOf(studentTotal) + 1;

            let grade = 'F';
            if (studentTotal >= 75) grade = 'A';
            else if (studentTotal >= 65) grade = 'B';
            else if (studentTotal >= 50) grade = 'C';
            else if (studentTotal >= 45) grade = 'D';
            else if (studentTotal >= 40) grade = 'E';

            reportCard.push({
                subject: subject.name,
                ca1: studentSubjectData.ca1 || 0,
                ca2: studentSubjectData.ca2 || 0,
                exam: studentSubjectData.exam || 0,
                total: studentTotal,
                grade: grade,
                position: getOrdinal(rank),
                highest: highest,
                lowest: lowest,
                average: parseFloat(average.toFixed(2))
            });
        }

        // 6. Calculate student's overall position in class
        const allStudentTotals = Object.values(resultsByStudent).map(s => s.total_score);
        const sortedTotals = [...allStudentTotals].sort((a, b) => b - a);
        const studentRank = sortedTotals.indexOf(resultsByStudent[student_id].total_score) + 1;

        // 7. Fetch attendance data
        const [attendance] = await connection.query(
            `SELECT status, COUNT(*) as count 
             FROM student_attendance 
             WHERE student_id = ? AND date BETWEEN ? AND ? 
             GROUP BY status`,
            [student_id, termInfo[0].start_date, termInfo[0].end_date]
        );
        const attendanceData = {
            Present: 0,
            Absent: 0,
            Late: 0,
            ...Object.fromEntries(attendance.map(a => [a.status, a.count]))
        };
        const schoolDays = moment(termInfo[0].end_date).diff(moment(termInfo[0].start_date), 'days');

        // 8. Fetch skills data
        const [skills] = await connection.query(
            'SELECT skill_type, skill_name, rating FROM student_skills WHERE student_id = ? AND term_id = ?',
            [student_id, term_id]
        );
        const skillsData = {
            Affective: [],
            Psychomotor: []
        };
        skills.forEach(skill => {
            if (skillsData[skill.skill_type]) {
                skillsData[skill.skill_type].push({ name: skill.skill_name, rating: skill.rating });
            }
        });

        // 9. Fetch comments
        const [comments] = await connection.query(
            'SELECT teacher_comment, principal_comment FROM report_card_comments WHERE student_id = ? AND term_id = ?',
            [student_id, term_id]
        );
        const commentData = comments.length > 0 ? comments[0] : { teacher_comment: '', principal_comment: '' };

        res.json({
            success: true,
            data: {
                student: {
                    name: `${studentData.first_name} ${studentData.last_name}`,
                    class: `${classInfo[0].name} ${classInfo[0].arm || ''}`.trim(),
                },
                term: {
                    name: termInfo[0].name,
                    session: termInfo[0].session,
                    next_term_begins: termInfo[0].next_term_begins
                },
                attendance: {
                    school_opened: schoolDays,
                    present: attendanceData.Present,
                    absent: attendanceData.Absent,
                },
                position: getOrdinal(studentRank),
                total_students: allStudentTotals.length,
                results: reportCard,
                skills: skillsData,
                comments: commentData
            }
        });

    } catch (err) {
        console.error('Error fetching student report card:', err);
        res.status(500).json({ success: false, message: 'Server error while fetching report card.' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;
