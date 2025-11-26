const express = require("express");
const router = express.Router();
const { pool } = require("../database");
const { v4: uuidv4 } = require("uuid");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// @route   POST /api/exams/store
// @desc    Create a new exam with subjects and questions
// @access  Admin, SuperAdmin
router.post(
  "/store",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const {
      examType,
      assessment_type,
      subjectType,
      title,
      class_id,
      dateTime,
      duration_minutes,
      subjects, // Array of { class_subject_id, questions: [...] }
    } = req.body;

    // 1. Basic Validation
    if (
      !examType ||
      !subjectType ||
      !title ||
      !class_id ||
      !dateTime ||
      !duration_minutes ||
      !subjects ||
      !Array.isArray(subjects) ||
      subjects.length === 0
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Please provide all required fields, including at least one subject with questions.",
        });
    }

    // Validate assessment type only for Internal exams
    if (examType === "Internal" && !assessment_type) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Assessment type is required for Internal exams.",
        });
    }

    // Ensure every subject has questions
    for (const subject of subjects) {
      if (
        !subject.questions ||
        !Array.isArray(subject.questions) ||
        subject.questions.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: `Each subject must contain a non-empty 'questions' array.`,
        });
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 2. Format Date for MySQL (Handle ISO string "T" removal)
      const formattedDateTime = dateTime;

      // 3. Verify Admin Branch Permissions
      const [adminStaff] = await connection.query(
        "SELECT branch_id FROM staff WHERE user_id = ?",
        [req.user.id]
      );
      if (
        req.user.roles.includes("Admin") &&
        (!adminStaff.length || !adminStaff[0].branch_id)
      ) {
        await connection.rollback();
        return res
          .status(403)
          .json({
            success: false,
            message: "Admin not associated with a branch.",
          });
      }
      const branch_id = adminStaff[0].branch_id;

      // 4. Validate Class existence
      const [classInfo] = await connection.query(
        "SELECT id FROM classes WHERE id = ? AND branch_id = ?",
        [class_id, branch_id]
      );
      if (classInfo.length === 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({
            success: false,
            message: "Class not found for the given branch.",
          });
      }

      // 5. SMART SUBJECT RESOLUTION logic
      // We create a new array "validatedSubjects" with corrected IDs
      const validatedSubjects = [];

      for (const subject of subjects) {
        const incomingId = subject.class_subject_id;

        // Fetch details of the incoming subject ID
        const [subjectCheck] = await connection.query(
          "SELECT id, name, class_id FROM class_subjects WHERE id = ?",
          [incomingId]
        );

        if (subjectCheck.length === 0) {
          await connection.rollback();
          return res
            .status(400)
            .json({
              success: false,
              message: `Invalid class_subject_id: ${incomingId}`,
            });
        }

        const subjectData = subjectCheck[0];
        let finalSubjectId = incomingId;

        // If the subject ID belongs to a different class (Frontend Loop Issue), find the matching subject in the CURRENT class
        if (subjectData.class_id !== class_id) {
          const [matchingSubject] = await connection.query(
            "SELECT id FROM class_subjects WHERE class_id = ? AND name = ?",
            [class_id, subjectData.name]
          );

          if (matchingSubject.length > 0) {
            finalSubjectId = matchingSubject[0].id; // Swap to the correct ID
          } else {
            await connection.rollback();
            return res.status(400).json({
              success: false,
              message: `Subject '${subjectData.name}' exists in the source class but was not found in the target class (ID: ${class_id}). Please ensure subjects are synced.`,
            });
          }
        }

        validatedSubjects.push({
          ...subject,
          class_subject_id: finalSubjectId, // Use the corrected ID
        });
      }

      // 6. Check for scheduling conflicts
      // We check a window around the new exam time to be safe
      const newExamStartTime = new Date(formattedDateTime);
      const newExamEndTime = new Date(
        newExamStartTime.getTime() + duration_minutes * 60 * 1000
      );

      const [existingExams] = await connection.query(
        "SELECT exam_date_time, duration_minutes FROM exams WHERE class_id = ? AND exam_date_time BETWEEN ? AND ?",
        [
          class_id,
          new Date(newExamStartTime.getTime() - 86400000),
          new Date(newExamEndTime.getTime() + 86400000),
        ]
      );

      for (const existingExam of existingExams) {
        const existingExamStartTime = new Date(existingExam.exam_date_time);
        const existingExamEndTime = new Date(
          existingExamStartTime.getTime() +
            existingExam.duration_minutes * 60 * 1000
        );
        if (
          newExamStartTime < existingExamEndTime &&
          newExamEndTime > existingExamStartTime
        ) {
          await connection.rollback();
          return res
            .status(400)
            .json({
              success: false,
              message:
                "Schedule conflict: The new exam time overlaps with an existing one.",
            });
        }
      }

      // 7. Insert Exam
      const newExamId = uuidv4();
      const newExam = {
        id: newExamId,
        title,
        exam_type: examType,
        assessment_type: examType === "External" ? null : assessment_type,
        subject_type: subjectType,
        class_subject_id:
          subjectType === "Single-Subject"
            ? validatedSubjects[0].class_subject_id
            : null,
        class_id,
        branch_id,
        exam_date_time: formattedDateTime,
        duration_minutes,
        created_by: req.user.id,
      };
      await connection.query("INSERT INTO exams SET ?", newExam);

      // 8. Insert Questions (Using the Validated Subject IDs)
      for (const subject of validatedSubjects) {
        const questionValues = [];
        for (const question of subject.questions) {
          questionValues.push([
            uuidv4(),
            newExamId,
            subject.class_subject_id, // Corrected ID
            question.text,
            JSON.stringify(question.options),
            question.correctAnswerIndex,
          ]);
        }

        if (questionValues.length > 0) {
          await connection.query(
            "INSERT INTO questions (id, exam_id, class_subject_id, question_text, options, correct_answer_index) VALUES ?",
            [questionValues]
          );
        }
      }

      await connection.commit();
      console.log(`Exam created successfully for class ${class_id}`);
      res
        .status(201)
        .json({
          success: true,
          message: "Exam created successfully.",
          data: newExam,
        });
    } catch (err) {
      await connection.rollback();
      console.error("Error creating exam:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error while creating exam." });
    } finally {
      connection.release();
    }
  }
);

// @route   GET /api/exams
// @desc    Get all exams for a branch (Admin) or all branches (SuperAdmin)
// @access  Admin, SuperAdmin
router.get(
  "/",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    try {
      let query = `
            SELECT 
                e.id,
                e.title as exam_title,
                e.exam_type,
                c.name as exam_class,
                e.subject_type,
                CASE
                    WHEN e.subject_type = 'Single-Subject' THEN cs.name
                    ELSE (SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ') FROM questions q JOIN class_subjects cs ON q.class_subject_id = cs.id WHERE q.exam_id = e.id)
                END as subject_name,
                e.class_subject_id,
                DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i') as exam_date_time,
                b.school_name as branch,
                e.duration_minutes as exam_duration
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN class_subjects cs ON e.class_subject_id = cs.id
        `;
      const queryParams = [];

      if (req.user.roles.includes("Admin")) {
        const [adminStaff] = await pool.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );
        if (adminStaff.length > 0) {
          query += " WHERE e.branch_id = ?";
          queryParams.push(adminStaff[0].branch_id);
        } else {
          return res.json({ success: true, data: [] });
        }
      }

      query += " ORDER BY e.exam_date_time DESC";

      const [exams] = await pool.query(query, queryParams);
      console.log("Exams fetched successfully.");
      res.json({ success: true, data: exams });
    } catch (err) {
      console.error("Error fetching exams:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error while fetching exams.",
        });
    }
  }
);

// @route   PUT /api/exams/:examId
// @desc    Update an existing exam
// @access  Admin, SuperAdmin
router.put(
  "/:examId",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { examId } = req.params;
    const { title, examType, dateTime, duration_minutes } = req.body;

    // Basic validation
    if (!title || !examType || !dateTime || !duration_minutes) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Please provide all required fields for update.",
        });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [exam] = await connection.query(
        "SELECT branch_id, class_id FROM exams WHERE id = ?",
        [examId]
      );
      if (exam.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Exam not found." });
      }

      if (req.user.roles.includes("Admin")) {
        const [adminStaff] = await connection.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );
        if (
          adminStaff.length === 0 ||
          adminStaff[0].branch_id !== exam[0].branch_id
        ) {
          await connection.rollback();
          return res
            .status(403)
            .json({
              success: false,
              message: "You are not authorized to update this exam.",
            });
        }
      }

      // Check for scheduling conflicts
      const newExamStartTime = new Date(dateTime);
      const newExamEndTime = new Date(
        newExamStartTime.getTime() + duration_minutes * 60 * 1000
      );
      const [existingExams] = await connection.query(
        "SELECT exam_date_time, duration_minutes FROM exams WHERE class_id = ? AND id != ?",
        [exam[0].class_id, examId]
      );

      for (const existingExam of existingExams) {
        const existingExamStartTime = new Date(existingExam.exam_date_time);
        const existingExamEndTime = new Date(
          existingExamStartTime.getTime() +
            existingExam.duration_minutes * 60 * 1000
        );

        // Check if the time ranges overlap. Exams can be scheduled back-to-back.
        if (
          newExamStartTime < existingExamEndTime &&
          newExamEndTime > existingExamStartTime
        ) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Schedule conflict: The updated exam time overlaps with an existing one.",
          });
        }
      }

      const updatedExam = {
        title,
        exam_type: examType,
        exam_date_time: dateTime,
        duration_minutes,
      };

      await connection.query("UPDATE exams SET ? WHERE id = ?", [
        updatedExam,
        examId,
      ]);
      await connection.commit();

      res.json({
        success: true,
        message: "Exam updated successfully.",
        data: updatedExam,
      });
      console.log("Exam updated successfully.");
    } catch (err) {
      await connection.rollback();
      console.error("Error updating exam:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error while updating exam." });
    } finally {
      connection.release();
    }
  }
);

// @route   DELETE /api/exams/:examId
// @desc    Delete an exam
// @access  Admin, SuperAdmin
router.delete(
  "/:examId",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { examId } = req.params;

    try {
      const [exam] = await pool.query(
        "SELECT branch_id FROM exams WHERE id = ?",
        [examId]
      );
      if (exam.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Exam not found." });
      }

      if (req.user.roles.includes("Admin")) {
        const [adminStaff] = await pool.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );
        if (
          adminStaff.length === 0 ||
          adminStaff[0].branch_id !== exam[0].branch_id
        ) {
          return res
            .status(403)
            .json({
              success: false,
              message: "You are not authorized to delete this exam.",
            });
        }
      }

      await pool.query("DELETE FROM exams WHERE id = ?", [examId]);
      res.json({ success: true, message: "Exam deleted successfully." });
      console.log("Exam deleted successfully.");
    } catch (err) {
      console.error("Error deleting exam:", err);
      res
        .status(500)
        .json({ success: false, message: "Server error while deleting exam." });
    }
  }
);

// @route   GET /api/exams/class
// @desc    Get all exams for the authenticated teacher's class
// @access  Teacher
router.get("/class", [auth, authorize(["Teacher"])], async (req, res) => {
  try {
    const [staff] = await pool.query("SELECT id FROM staff WHERE user_id = ?", [
      req.user.id,
    ]);

    if (staff.length === 0) {
      return res
        .status(403)
        .json({
          success: false,
          message: "Authenticated user is not registered as a staff member.",
        });
    }
    const teacherId = staff[0].id;

    const [classes] = await pool.query(
      "SELECT id FROM classes WHERE teacher_id = ?",
      [teacherId]
    );

    if (classes.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Teacher is not assigned to any class.",
        });
    }

    const classIds = classes.map((c) => c.id);

    const query = `
            SELECT 
                e.id,
                e.title,
                e.exam_type,
                e.assessment_type,
                e.subject_type,
                e.class_subject_id,
                e.class_id,
                DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i') as exam_date_time,
                e.duration_minutes
            FROM exams e
            WHERE e.class_id IN (?) 
            ORDER BY e.exam_date_time DESC
        `;

    const [exams] = await pool.query(query, [classIds]);

    res.json({ success: true, data: exams });
  } catch (error) {
    console.error("Error fetching exams for teacher's class:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error while fetching exams." });
  }
});

// @route   GET /api/exams/upcoming
// @desc    Get all upcoming exams' details publicly
// @access  Public
router.get("/upcoming", async (req, res) => {
  try {
    const query = `
            SELECT
                e.title,
                DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i') AS date,
                c.name AS class,
                b.school_name as branch,
                GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ') AS subjects
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN branches b ON e.branch_id = b.id
            LEFT JOIN questions q ON e.id = q.exam_id
            LEFT JOIN class_subjects cs ON q.class_subject_id = cs.id
            WHERE e.exam_date_time > NOW()
            GROUP BY e.id, e.title, e.exam_date_time, c.name, b.school_name
            ORDER BY e.exam_date_time ASC;
        `;

    const [exams] = await pool.query(query);

    const upcomingExams = exams.map((exam) => ({
      ...exam,
      subjects: exam.subjects ? exam.subjects.split(",") : [],
    }));

    res.json({ success: true, data: upcomingExams });
  } catch (err) {
    console.error("Error fetching upcoming exams:", err);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error while fetching upcoming exams.",
      });
  }
});

// @route   GET /api/exams/me/upcoming
// @desc    Get exams that are active or past, BUT NOT taken yet
router.get('/me/upcoming', auth, authorize(['Student', 'NewStudent', 'Parent', 'Teacher']), async (req, res) => {
    const { id: userId, roles } = req.user;
    const connection = await pool.getConnection();

    try {
        // 1. Get the Student's details (Class ID)
        let dbStudentId = null; // This is the ID used in the exam_results table
        const classIds = new Set();

        if (roles.includes('Student')) {
            const [students] = await connection.query('SELECT id, class_id FROM students WHERE user_id = ?', [userId]);
            if (students.length > 0) {
                dbStudentId = students[0].id; // Use the Student Profile ID
                if (students[0].class_id) classIds.add(students[0].class_id);
            }
        } else if (roles.includes('NewStudent')) {
            // For new students, we might use the user_id or email depending on your setup
            // Assuming NewStudent results are tracked by user_id directly:
            dbStudentId = userId; 
            
            const [users] = await connection.query('SELECT email FROM users WHERE id = ?', [userId]);
            if (users.length > 0) {
                const [newStudents] = await connection.query('SELECT class_id FROM new_students WHERE student_id = ?', [users[0].email]);
                if (newStudents.length > 0) classIds.add(newStudents[0].class_id);
            }
        }

        const uniqueClassIds = [...classIds];
        if (uniqueClassIds.length === 0 || !dbStudentId) {
            return res.json({ success: true, data: [] });
        }

        // 2. The Magic Query
        // - We select exams for the class
        // - We LEFT JOIN with exam_results for THIS student
        // - We filter WHERE exam_results.id IS NULL (meaning no result exists yet)
        // - We REMOVED the "exam_date_time > NOW()" check
        
        let query = `
            SELECT 
                e.id,
                e.title,
                e.duration_minutes,
                DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i:%s') AS date,
                c.name AS class,
                b.school_name as branch,
                (
                    SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ')
                    FROM questions q 
                    JOIN class_subjects cs ON q.class_subject_id = cs.id 
                    WHERE q.exam_id = e.id
                ) AS subjects
            FROM exams e
            JOIN classes c ON e.class_id = c.id
            JOIN branches b ON e.branch_id = b.id
            
            -- This JOIN checks if the student has already submitted
            LEFT JOIN exam_results er ON e.id = er.exam_id AND er.student_id = ?
            
            WHERE e.class_id IN (?) 
            AND er.id IS NULL -- Only show exams NOT in results table
        `;

        const queryParams = [dbStudentId, uniqueClassIds];

        // 3. Apply Role Filters (Internal vs External)
        if (roles.includes('NewStudent')) {
            query += ' AND e.exam_type = ?';
            queryParams.push('External');
        } else if (roles.includes('Student')) {
            query += ' AND e.exam_type = ?';
            queryParams.push('Internal');
        }

        // 4. Sort by Date (Oldest first so they see missed exams at the top)
        query += ' ORDER BY e.exam_date_time ASC';

      const [exams] = await connection.query(query, queryParams);

        const upcomingExams = exams.map(exam => ({
            ...exam,
            subjects: exam.subjects ? exam.subjects.split(', ') : []
        }));

      res.json({ success: true, data: upcomingExams });
    } catch (err) {
        console.error('Error fetching scoped exams:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    } finally {
      connection.release();
    }
});

// --- CBT Student Facing Endpoints ---

// @route   GET /api/exams/student/current-exam
// @desc    Get details of the current exam for the logged-in student
// @access  Student, NewStudent
router.get(
  "/student/current-exam",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    try {
      let studentClassId;
      let examTypeFilter;
      const { roles } = req.user;

      if (roles.includes("NewStudent")) {
        const [newStudent] = await pool.query(
          "SELECT class_id FROM new_students WHERE student_id = (SELECT email FROM users WHERE id = ?)",
          [req.user.id]
        );
        if (newStudent.length > 0) {
          studentClassId = newStudent[0].class_id;
          examTypeFilter = "External";
        }
      } else if (roles.includes("Student")) {
        const [existingStudent] = await pool.query(
          "SELECT class_id FROM students WHERE user_id = ?",
          [req.user.id]
        );
        if (existingStudent.length > 0) {
          studentClassId = existingStudent[0].class_id;
          examTypeFilter = "Internal";
        }
      }

      if (!studentClassId) {
        return res
          .status(404)
          .json({ success: false, message: "Student class not found." });
      }

      // Find an exam that is currently active or starting within 30 minutes
      const [exam] = await pool.query(
        `
            SELECT id, title, duration_minutes, exam_date_time
            FROM exams
            WHERE class_id = ?
              AND exam_type = ?
              AND (UTC_TIMESTAMP() + INTERVAL 1 HOUR) >= exam_date_time - INTERVAL 30 MINUTE
              AND (UTC_TIMESTAMP() + INTERVAL 1 HOUR) <= exam_date_time + INTERVAL duration_minutes MINUTE
            ORDER BY exam_date_time ASC
            LIMIT 1
        `,
        [studentClassId, examTypeFilter]
      );

      if (exam.length === 0) {
        return res
          .status(404)
          .json({
            success: false,
            message: "No current exam available for you at this time.",
          });
      }

      const currentExam = exam[0];
      const examId = currentExam.id;

      // Fetch subjects and their questions for the exam
      const [questionsFromDb] = await pool.query(
        `
            SELECT q.id, q.question_text as text, q.options, q.class_subject_id, cs.name as subject_name
            FROM questions q
            JOIN class_subjects cs ON q.class_subject_id = cs.id
            WHERE q.exam_id = ?
            ORDER BY cs.name
        `,
        [examId]
      );

      const subjects = {};
      questionsFromDb.forEach((q) => {
        if (!subjects[q.class_subject_id]) {
          subjects[q.class_subject_id] = {
            id: q.class_subject_id,
            title: q.subject_name,
            questions: [],
          };
        }

        subjects[q.class_subject_id].questions.push({
          id: q.id,
          text: q.text,
          options: JSON.parse(q.options),
        });
      });

      res.json({
        success: true,
        data: {
          examId: currentExam.id,
          title: currentExam.title,
          examDuration: currentExam.duration_minutes,
          examStartTime: currentExam.exam_date_time,
          subjects: Object.values(subjects),
        },
      });
      console.log("Current exam details fetched successfully.");
    } catch (err) {
      console.error("Error fetching current exam:", err);
      res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);

// @route   GET /api/exams/subjects
// @desc    Get subjects for the logged-in student's upcoming exam
// @access  Student, NewStudent
router.get(
  "/subjects",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    try {
      let studentClassId;
      let examTypeFilter;
      const { roles } = req.user;

      if (roles.includes("NewStudent")) {
        const [newStudent] = await pool.query(
          "SELECT class_id FROM new_students WHERE student_id = (SELECT email FROM users WHERE id = ?)",
          [req.user.id]
        );
        if (newStudent.length > 0) {
          studentClassId = newStudent[0].class_id;
          examTypeFilter = "External";
        }
      } else if (roles.includes("Student")) {
        const [existingStudent] = await pool.query(
          "SELECT class_id FROM students WHERE user_id = ?",
          [req.user.id]
        );
        if (existingStudent.length > 0) {
          studentClassId = existingStudent[0].class_id;
          examTypeFilter = "Internal";
        }
      }

      if (!studentClassId) {
        return res
          .status(404)
          .json({ success: false, message: "Student class not found." });
      }

      const [exam] = await pool.query(
        "SELECT id, duration_minutes FROM exams WHERE class_id = ? AND exam_type = ? AND exam_date_time > NOW() ORDER BY exam_date_time ASC LIMIT 1",
        [studentClassId, examTypeFilter]
      );

      if (exam.length === 0) {
        return res
          .status(404)
          .json({
            success: false,
            message: "No upcoming exams found for your class.",
          });
      }

      const examId = exam[0].id;
      const examDuration = exam[0].duration_minutes;

      const [subjects] = await pool.query(
        `
            SELECT DISTINCT q.class_subject_id as id, cs.name as title
            FROM questions q
            JOIN class_subjects cs ON q.class_subject_id = cs.id
            WHERE q.exam_id = ?
        `,
        [examId]
      );

      res.json({
        success: true,
        data: {
          examId,
          examDuration,
          subjects,
        },
      });
      console.log("Subjects for exam fetched successfully.");
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);

// @route   GET /api/exams/:examId/subjects/:subjectId/questions
// @desc    Get questions for a specific subject within an exam
// @access  Student, NewStudent
router.get(
  "/:examId/subjects/:subjectId/questions",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    try {
      const { examId, subjectId } = req.params;

      // Find the exam to check the time window
      const [exams] = await pool.query(
        "SELECT exam_date_time, duration_minutes FROM exams WHERE id = ?",
        [examId]
      );
      if (exams.length === 0) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Exam not found for this subject.",
          });
      }

      const now = new Date();
      const examDateTime = new Date(exams[0].exam_date_time);

      // Allowed to fetch 30 mins before exam starts
      const allowedStartTime = new Date(
        examDateTime.getTime() - 30 * 60 * 1000
      );

      // Exam ends after its duration
      const examEndTime = new Date(
        examDateTime.getTime() + exams[0].duration_minutes * 60 * 1000
      );

      if (now < allowedStartTime) {
        return res
          .status(403)
          .json({
            success: false,
            message: "It is not yet time for the exam.",
          });
      }

      if (now > examEndTime) {
        return res
          .status(403)
          .json({
            success: false,
            message: "The time for this exam has passed.",
          });
      }

      const [questionsFromDb] = await pool.query(
        "SELECT id, question_text as text, options FROM questions WHERE exam_id = ? AND class_subject_id = ?",
        [examId, subjectId]
      );

      const questions = questionsFromDb.map((q) => ({
        id: q.id,
        text: q.text,
        options: JSON.parse(q.options),
      }));

      res.json({ success: true, data: questions });
      console.log("Questions fetched successfully with shuffled options.");
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);

// @route   POST /api/exams/answers
// @desc    Submit answers and calculate score
// @access  Student, NewStudent
router.post(
  "/answers",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    const { examId, answers } = req.body; // answers: [{ questionId: string, selectedOptionIndex: number }]
    const userId = req.user.id;

    if (!examId || !answers || !Array.isArray(answers)) {
      return res
        .status(400)
        .json({ success: false, message: "Missing examId or answers." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Fetch exam details and validate
      const [examResult] = await connection.query(
        "SELECT * FROM exams WHERE id = ?",
        [examId]
      );
      if (examResult.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Exam not found." });
      }
      const exam = examResult[0];

      // Check if exam is still active
      const now = new Date();
      const examDateTime = new Date(exam.exam_date_time);
      const examEndTime = new Date(
        examDateTime.getTime() + exam.duration_minutes * 60 * 1000
      );
      if (now > examEndTime) {
        await connection.rollback();
        return res
          .status(403)
          .json({
            success: false,
            message:
              "The time for this exam has passed. Submission is no longer accepted.",
          });
      }

      // Check for prior submissions
      const [existingResult] = await connection.query(
        "SELECT id FROM exam_results WHERE exam_id = ? AND student_id = ?",
        [examId, userId]
      );
      if (existingResult.length > 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({
            success: false,
            message: "You have already submitted answers for this exam.",
          });
      }

      // Fetch all questions for the exam to validate answers and calculate score
      const [allQuestions] = await connection.query(
        `
            SELECT q.id, q.options, q.correct_answer_index, q.class_subject_id
            FROM questions q
            WHERE q.exam_id = ?
        `,
        [examId]
      );

      if (allQuestions.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({
            success: false,
            message: "No questions found for this exam.",
          });
      }

      const totalQuestions = allQuestions.length;
      const questionMap = new Map(
        allQuestions.map((q) => {
          return [
            q.id,
            {
              options: JSON.parse(q.options),
              correctAnswerIndex: q.correct_answer_index,
              class_subject_id: q.class_subject_id,
            },
          ];
        })
      );

      const scoresBySubject = {};

      for (const answer of answers) {
        const { questionId, selectedOptionIndex } = answer;
        if (questionMap.has(questionId)) {
          const { correctAnswerIndex, class_subject_id } =
            questionMap.get(questionId);

          if (!scoresBySubject[class_subject_id]) {
            scoresBySubject[class_subject_id] = { score: 0, total: 0 };
          }
          scoresBySubject[class_subject_id].total++;

          if (selectedOptionIndex === correctAnswerIndex) {
            scoresBySubject[class_subject_id].score++;
          }
        }
      }

      // Calculate total score
      let totalCorrectAnswers = 0;
      for (const subjectId in scoresBySubject) {
        totalCorrectAnswers += scoresBySubject[subjectId].score;
      }
      const percentageScore =
        totalQuestions > 0 ? (totalCorrectAnswers / totalQuestions) * 100 : 0;

      // Get active term for the branch
      const [terms] = await connection.query(
        "SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE",
        [exam.branch_id]
      );
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

      await connection.query("INSERT INTO exam_results SET ?", result);

      // Sync scores with student_results table
      const [student] = await connection.query(
        "SELECT id FROM students WHERE user_id = ?",
        [userId]
      );
      if (student.length > 0) {
        const studentId = student[0].id;
        for (const subjectId in scoresBySubject) {
          const { score, total } = scoresBySubject[subjectId];
          const percentageScore = total > 0 ? (score / total) * 100 : 0;

          const [subject] = await connection.query(
            "SELECT teacher_id FROM class_subjects WHERE id = ?",
            [subjectId]
          );
          const teacherId = subject.length > 0 ? subject[0].teacher_id : null;

          const [existing] = await connection.query(
            "SELECT id FROM student_results WHERE student_id = ? AND subject_id = ? AND term_id = ? AND assessment_type = ?",
            [studentId, subjectId, termId, exam.assessment_type]
          );

          if (existing.length > 0) {
            await connection.query(
              "UPDATE student_results SET score = ?, teacher_id = ?, exam_id = ?, updated_at = NOW() WHERE id = ?",
              [percentageScore, teacherId, examId, existing[0].id]
            );
          } else {
            const resultId = uuidv4();
            await connection.query(
              "INSERT INTO student_results (id, student_id, class_id, subject_id, term_id, assessment_type, score, teacher_id, branch_id, exam_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                resultId,
                studentId,
                exam.class_id,
                subjectId,
                termId,
                exam.assessment_type,
                percentageScore,
                teacherId,
                exam.branch_id,
                examId,
              ]
            );
          }
        }
      }

      await connection.commit();

      res
        .status(200)
        .json({ success: true, message: "Exam submitted successfully." });
    } catch (err) {
      await connection.rollback();
      console.error("Error submitting answers:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error while submitting answers.",
        });
    } finally {
      connection.release();
    }
  }
);

// @route   GET /api/exams/:examId/results
// @desc    Get all results for a specific exam
// @access  Admin, SuperAdmin
router.get(
  "/:examId/results",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { examId } = req.params;

    try {
      const [exam] = await pool.query(
        "SELECT branch_id FROM exams WHERE id = ?",
        [examId]
      );
      if (exam.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Exam not found." });
      }

      if (req.user.roles.includes("Admin")) {
        const [adminStaff] = await pool.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );
        if (
          adminStaff.length === 0 ||
          adminStaff[0].branch_id !== exam[0].branch_id
        ) {
          return res
            .status(403)
            .json({
              success: false,
              message: "You are not authorized to view results for this exam.",
            });
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
      console.error("Error fetching exam results:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error while fetching exam results.",
        });
    }
  }
);

// @route   GET /api/exams/:examId/results/teacher
// @desc    Get all results for a specific exam for the teacher's class
// @access  Teacher
router.get(
  "/:examId/results/teacher",
  [auth, authorize(["Teacher"])],
  async (req, res) => {
    const { examId } = req.params;

    try {
      const [staff] = await pool.query(
        "SELECT id FROM staff WHERE user_id = ?",
        [req.user.id]
      );
      if (staff.length === 0) {
        return res
          .status(403)
          .json({
            success: false,
            message: "You are not registered as a staff member.",
          });
      }
      const teacherId = staff[0].id;

      const [teacherClasses] = await pool.query(
        "SELECT id FROM classes WHERE teacher_id = ?",
        [teacherId]
      );
      if (teacherClasses.length === 0) {
        return res
          .status(403)
          .json({
            success: false,
            message: "You are not assigned to any class.",
          });
      }
      const teacherClassIds = teacherClasses.map((c) => c.id);

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
      console.error("Error fetching exam results for teacher:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error while fetching exam results.",
        });
    }
  }
);

// @route   PUT /api/exams/results/publish
// @desc    Publish results for a specific exam for the teacher's class
// @access  Teacher
router.put(
  "/results/publish",
  [auth, authorize(["Teacher"])],
  async (req, res) => {
    const { exam_id, class_id } = req.body;

    try {
      const [staff] = await pool.query(
        "SELECT id FROM staff WHERE user_id = ?",
        [req.user.id]
      );
      if (staff.length === 0) {
        return res
          .status(403)
          .json({
            success: false,
            message: "You are not registered as a staff member.",
          });
      }
      const teacherId = staff[0].id;

      const [teacherClass] = await pool.query(
        "SELECT id FROM classes WHERE teacher_id = ? AND id = ?",
        [teacherId, class_id]
      );
      if (teacherClass.length === 0) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "You are not authorized to publish results for this class.",
          });
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
      res.json({ success: true, message: "Results published successfully." });
    } catch (err) {
      console.error("Error publishing exam results:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error while publishing exam results.",
        });
    }
  }
);

// @route   GET /api/exams/results/me
// @desc    Get the authenticated student's own published results for the current term
// @access  Student
router.get("/results/me", [auth, authorize(["Student"])], async (req, res) => {
  try {
    const [student] = await pool.query(
      "SELECT id, class_id, branch_id FROM students WHERE user_id = ?",
      [req.user.id]
    );
    if (student.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found." });
    }
    const { class_id, branch_id } = student[0];

    const [terms] = await pool.query(
      "SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE",
      [branch_id]
    );
    if (terms.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "No active term found for your branch.",
        });
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
    const resultsWithPosition = await Promise.all(
      results.map(async (result) => {
        const [classScores] = await pool.query(
          `
                SELECT score FROM exam_results 
                WHERE exam_id = ? AND published = TRUE AND student_id IN 
                (SELECT user_id FROM students WHERE class_id = ?)
                ORDER BY score DESC
            `,
          [result.exam_id, class_id]
        );

        const scores = classScores.map((s) => parseFloat(s.score));
        const rank = scores.indexOf(parseFloat(result.score)) + 1;

        return {
          ...result,
          position: getOrdinal(rank),
        };
      })
    );

    res.json({ success: true, data: resultsWithPosition });
  } catch (err) {
    console.error("Error fetching student exam results:", err);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error while fetching exam results.",
      });
  }
});

module.exports = router;
