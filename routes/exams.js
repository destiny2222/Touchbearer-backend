const express = require("express");
const router = express.Router();
const { pool } = require("../database");
const { v4: uuidv4 } = require("uuid");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const examAssignmentService = require("../services/examAssignmentService");

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Helper function to sync edited scores to student_results
async function syncEditedScoreToStudentResults(connection, examResultData) {
 
  const { 
    exam_id, 
    student_id, 
    score, // This is the manually edited score we should use!
    answers, 
    branch_id, 
    class_id 
  } = examResultData;

  // Get student record
  const [student] = await connection.query(
    "SELECT id, class_id FROM students WHERE user_id = ?",
    [student_id]
  );

  if (student.length === 0) {
 
    return;
  }

  const studentId = student[0].id;
  const studentClassId = student[0].class_id || class_id;

  // Get exam details
  const [examResultFromTable] = await connection.query(
    "SELECT * FROM exams WHERE id = ?",
    [exam_id]
  );
  
  if (examResultFromTable.length === 0) {
    console.error("Exam not found for sync:", exam_id);
    return;
  }
  const exam = examResultFromTable[0];

  // Get active term
  const [terms] = await connection.query(
    "SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE",
    [branch_id || exam.branch_id]
  );
  
  const termId = terms.length > 0 ? terms[0].id : null;

  if (!termId) {
    console.error("No active term found for branch:", branch_id || exam.branch_id);
    return;
  }

  // Get all questions for the exam to determine subjects involved
  const [allQuestions] = await connection.query(
    `SELECT q.id, q.class_subject_id, q.correct_answer_index 
     FROM questions q 
     WHERE q.exam_id = ?`,
    [exam_id]
  );

  if (allQuestions.length === 0) {

    return;
  }

  // Count questions per subject
  const questionsBySubject = {};
  for (const q of allQuestions) {
    if (!questionsBySubject[q.class_subject_id]) {
      questionsBySubject[q.class_subject_id] = 0;
    }
    questionsBySubject[q.class_subject_id]++;
  }

  const subjectIds = Object.keys(questionsBySubject);
  const totalQuestions = allQuestions.length;


  // For single-subject exams, use the edited score directly
  // For multi-subject exams, we need to calculate proportional scores based on answers
  if (subjectIds.length === 1) {
    // Single subject - use the edited score directly
    const subjectId = subjectIds[0];
    
    const [subject] = await connection.query(
      "SELECT teacher_id FROM class_subjects WHERE id = ?",
      [subjectId]
    );
    const teacherId = subject.length > 0 ? subject[0].teacher_id : null;


    try {
      const resultId = uuidv4();
      const [upsertResult] = await connection.query(
        `INSERT INTO student_results 
         (id, student_id, class_id, subject_id, term_id, assessment_type, score, teacher_id, branch_id, exam_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           score = VALUES(score),
           teacher_id = VALUES(teacher_id),
           exam_id = VALUES(exam_id),
           class_id = VALUES(class_id),
           branch_id = VALUES(branch_id),
           updated_at = NOW()`,
        [
          resultId,
          studentId,
          studentClassId,
          subjectId,
          termId,
          exam.assessment_type,
          score, // Use the edited score directly!
          teacherId,
          exam.branch_id,
          exam_id,
        ]
      );
    } catch (err) {
      console.error("Error during upsert:", err);
    }
  } else {
    // Multi-subject exam - calculate proportional scores based on the edited total
    // We need to distribute the edited score proportionally based on original answer performance
    
    let answersArray = [];
    try {
      answersArray = JSON.parse(answers);
    } catch (e) {
      return;
    }

    // Build question map
    const questionMap = new Map(
      allQuestions.map(q => [q.id, {
        class_subject_id: q.class_subject_id,
        correctAnswerIndex: q.correct_answer_index
      }])
    );

    // Calculate original correct answers per subject
    const originalScoresBySubject = {};
    for (const answer of answersArray) {
      const { questionId, selectedOptionIndex } = answer;
      if (questionMap.has(questionId)) {
        const { class_subject_id, correctAnswerIndex } = questionMap.get(questionId);

        if (!originalScoresBySubject[class_subject_id]) {
          originalScoresBySubject[class_subject_id] = { correct: 0, total: questionsBySubject[class_subject_id] };
        }

        if (selectedOptionIndex === correctAnswerIndex) {
          originalScoresBySubject[class_subject_id].correct++;
        }
      }
    }

    // Calculate the original total percentage
    let originalTotalCorrect = 0;
    for (const subjectId in originalScoresBySubject) {
      originalTotalCorrect += originalScoresBySubject[subjectId].correct;
    }
    const originalPercentage = totalQuestions > 0 ? (originalTotalCorrect / totalQuestions) * 100 : 0;

    // Calculate the scaling factor (edited score / original score)
    // If original was 0, we distribute equally
    const scalingFactor = originalPercentage > 0 ? score / originalPercentage : 1;


    // Update each subject with scaled score
    for (const subjectId in questionsBySubject) {
      const subjectTotal = questionsBySubject[subjectId];
      const subjectCorrect = originalScoresBySubject[subjectId]?.correct || 0;
      const originalSubjectPercentage = subjectTotal > 0 ? (subjectCorrect / subjectTotal) * 100 : 0;
      
      // Scale the subject score proportionally
      let scaledScore = originalSubjectPercentage * scalingFactor;
      // Cap at 100%
      scaledScore = Math.min(scaledScore, 100);

      const [subject] = await connection.query(
        "SELECT teacher_id FROM class_subjects WHERE id = ?",
        [subjectId]
      );
      const teacherId = subject.length > 0 ? subject[0].teacher_id : null;


      try {
        const resultId = uuidv4();
        const [upsertResult] = await connection.query(
          `INSERT INTO student_results 
           (id, student_id, class_id, subject_id, term_id, assessment_type, score, teacher_id, branch_id, exam_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE 
             score = VALUES(score),
             teacher_id = VALUES(teacher_id),
             exam_id = VALUES(exam_id),
             class_id = VALUES(class_id),
             branch_id = VALUES(branch_id),
             updated_at = NOW()`,
          [
            resultId,
            studentId,
            studentClassId,
            subjectId,
            termId,
            exam.assessment_type,
            scaledScore,
            teacherId,
            exam.branch_id,
            exam_id,
          ]
        );
      
      } catch (err) {
        console.error("Error during upsert:", err);
      }
    }
  }


}


// Helper function to sync published results to student_results
async function syncToStudentResults(connection, examResult) {
  const { exam_id, student_id, answers } = examResult;
  
  console.log(`[SYNC] Starting sync for exam_result - exam_id: ${exam_id}, student_id: ${student_id}`);
  
  // Parse the answers to calculate subject-wise scores
  let answersArray;
  try {
    answersArray = JSON.parse(answers);
    console.log(`[SYNC] Parsed ${answersArray.length} answers from exam result`);
  } catch (e) {
    console.error("[SYNC] Error parsing answers:", e);
    return;
  }

  // Get exam details
  console.log(`[SYNC] Fetching exam details for exam_id: ${exam_id}`);
  const [examResultFromTable] = await connection.query(
    "SELECT * FROM exams WHERE id = ?",
    [exam_id]
  );
  
  if (examResultFromTable.length === 0) {
    console.error("[SYNC] Exam not found for sync:", exam_id);
    return;
  }
  const exam = examResultFromTable[0];
  console.log(`[SYNC] Exam found - type: ${exam.assessment_type}, branch_id: ${exam.branch_id}, class_id: ${exam.class_id}`);

  // Get all questions for the exam to calculate subject breakdown
  const [allQuestions] = await connection.query(
    `SELECT q.id, q.class_subject_id, q.correct_answer_index 
     FROM questions q 
     WHERE q.exam_id = ?`,
    [exam_id]
  );
  
  console.log(`[SYNC] Found ${allQuestions.length} questions for exam`);

  if (allQuestions.length === 0) {
    console.warn("[SYNC] No questions found for exam, skipping sync");
    return;
  }

  // Calculate subject-wise scores
  const scoresBySubject = {};
  const questionsBySubject = {};
  const questionMap = new Map(
    allQuestions.map(q => [q.id, {
      class_subject_id: q.class_subject_id,
      correctAnswerIndex: q.correct_answer_index
    }])
  );

  // Count questions per subject
  for (const q of allQuestions) {
    if (!questionsBySubject[q.class_subject_id]) {
      questionsBySubject[q.class_subject_id] = 0;
    }
    questionsBySubject[q.class_subject_id]++;
  }
  console.log(`[SYNC] Questions by subject:`, questionsBySubject);

  // Calculate scores per subject
  for (const answer of answersArray) {
    const { questionId, selectedOptionIndex } = answer;
    if (questionMap.has(questionId)) {
      const { class_subject_id, correctAnswerIndex } = questionMap.get(questionId);
      
      if (!scoresBySubject[class_subject_id]) {
        scoresBySubject[class_subject_id] = { score: 0, total: questionsBySubject[class_subject_id] };
      }
      
      if (selectedOptionIndex === correctAnswerIndex) {
        scoresBySubject[class_subject_id].score++;
      }
    }
  }
  console.log(`[SYNC] Scores by subject:`, scoresBySubject);

  // Get student and term details
  // student_id in exam_results can be either:
  // - internal student.id (for existing students)
  // - user_id (for new_students)
  console.log(`[SYNC] Looking up student. Trying student_id: ${student_id}`);
  
  let studentId;
  let class_id;
  
  // First try finding by internal student.id
  const [studentById] = await connection.query(
    "SELECT id, class_id FROM students WHERE id = ?",
    [student_id]
  );
  
  if (studentById.length > 0) {
    studentId = studentById[0].id;
    class_id = studentById[0].class_id;
    console.log(`[SYNC] Student found by internal id: studentId=${studentId}, class_id=${class_id}`);
  } else {
    // Try finding by user_id
    const [studentByUserId] = await connection.query(
      "SELECT id, class_id FROM students WHERE user_id = ?",
      [student_id]
    );
    
    if (studentByUserId.length > 0) {
      studentId = studentByUserId[0].id;
      class_id = studentByUserId[0].class_id;
      console.log(`[SYNC] Student found by user_id: studentId=${studentId}, class_id=${class_id}`);
    } else {
      console.error(`[SYNC] Student not found for student_id: ${student_id}`);
      return;
    }
  }

  const [terms] = await connection.query(
    "SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE",
    [exam.branch_id]
  );
  
  if (terms.length === 0) {
    console.error(`[SYNC] No active term found for branch: ${exam.branch_id}`);
    return;
  }
  
  const termId = terms[0].id;
  console.log(`[SYNC] Active term found - term_id: ${termId}`);

  // Update or insert records for each subject using UPSERT pattern
  let syncedCount = 0;
  for (const subjectId in questionsBySubject) {
    const subjectTotal = questionsBySubject[subjectId];
    const subjectScore = scoresBySubject[subjectId]?.score || 0;
    const percentageScore = subjectTotal > 0 ? (subjectScore / subjectTotal) * 100 : 0;

    const [subject] = await connection.query(
      "SELECT teacher_id FROM class_subjects WHERE id = ?",
      [subjectId]
    );
    const teacherId = subject.length > 0 ? subject[0].teacher_id : null;

    // Use INSERT ... ON DUPLICATE KEY UPDATE to handle the unique constraint
    const resultId = uuidv4();
    await connection.query(
      `INSERT INTO student_results 
       (id, student_id, class_id, subject_id, term_id, assessment_type, score, teacher_id, branch_id, exam_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         score = VALUES(score),
         teacher_id = VALUES(teacher_id),
         exam_id = VALUES(exam_id),
         class_id = VALUES(class_id),
         branch_id = VALUES(branch_id),
         updated_at = NOW()`,
      [
        resultId,
        studentId,
        class_id,
        subjectId,
        termId,
        exam.assessment_type,
        percentageScore,
        teacherId,
        exam.branch_id,
        exam_id,
      ]
    );
    syncedCount++;
    console.log(`[SYNC] Upserted result for student_id: ${studentId}, subject_id: ${subjectId}, score: ${percentageScore.toFixed(2)}%`);
  }
  console.log(`[SYNC] Completed syncing ${syncedCount} subject results for student_id: ${studentId}, exam_id: ${exam_id}`);
}


// Helper function to remove from student_results when unpublishing
async function removeFromStudentResults(connection, examResult) {
  const { exam_id, student_id } = examResult;
  
  console.log(`[REMOVE] Removing student results for exam_id: ${exam_id}, student_id: ${student_id}`);
  
  // Try to find the internal student.id first, then by user_id
  const [studentById] = await connection.query(
    "SELECT id FROM students WHERE id = ?",
    [student_id]
  );
  
  let studentDbId;
  if (studentById.length > 0) {
    studentDbId = studentById[0].id;
    console.log(`[REMOVE] Student found by internal id: ${studentDbId}`);
  } else {
    const [studentByUserId] = await connection.query(
      "SELECT id FROM students WHERE user_id = ?",
      [student_id]
    );
    
    if (studentByUserId.length > 0) {
      studentDbId = studentByUserId[0].id;
      console.log(`[REMOVE] Student found by user_id: ${studentDbId}`);
    } else {
      console.error(`[REMOVE] Student not found for student_id: ${student_id}`);
      return;
    }
  }

  // Remove all student_results entries linked to this exam for this student
  const [deleteResult] = await connection.query(
    "DELETE FROM student_results WHERE student_id = ? AND exam_id = ?",
    [studentDbId, exam_id]
  );
  
  console.log(`[REMOVE] Deleted ${deleteResult.affectedRows || 0} rows from student_results for student_db_id: ${studentDbId}, exam_id: ${exam_id}`);
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
      exam_end_datetime,
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
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required fields, including at least one subject with questions.",
      });
    }

    // Validate assessment type only for Internal exams
    if (examType === "Internal" && !assessment_type) {
      return res.status(400).json({
        success: false,
        message: "Assessment type is required for Internal exams.",
      });
    }

    // Validate exam_end_datetime if provided
    if (exam_end_datetime) {
      const startTime = new Date(dateTime);
      const endTime = new Date(exam_end_datetime);
      if (endTime <= startTime) {
        return res.status(400).json({
          success: false,
          message: "exam_end_datetime must be after exam_date_time.",
        });
      }
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
        return res.status(403).json({
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
        return res.status(400).json({
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
          return res.status(400).json({
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
          return res.status(400).json({
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
        assessment_type: examType === "External" ? 'exam' : assessment_type,
        subject_type: subjectType,
        class_subject_id:
          subjectType === "Single-Subject"
            ? validatedSubjects[0].class_subject_id
            : null,
        class_id,
        branch_id,
        exam_date_time: formattedDateTime,
        exam_end_datetime: exam_end_datetime || null,
        duration_minutes,
        created_by: req.user.id,
      };
      await connection.query("INSERT INTO exams SET ?", newExam);

      // In the POST /store route, update the question insertion section:

      // 8. Insert Questions (Using the Validated Subject IDs)
      for (const subject of validatedSubjects) {
        const questionValues = [];
        for (const question of subject.questions) {
          questionValues.push([
            uuidv4(),
            newExamId,
            subject.class_subject_id,
            question.text,
            question.question_image_url || null,
            JSON.stringify(question.options),
            question.correctAnswerIndex,
          ]);
        }

        if (questionValues.length > 0) {
          await connection.query(
            "INSERT INTO questions (id, exam_id, class_subject_id, question_text, question_image_url, options, correct_answer_index) VALUES ?",
            [questionValues]
          );
        }
      }

      await connection.commit();
      console.log(`Exam created successfully for class ${class_id}`);
      res.status(201).json({
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
                DATE_FORMAT(e.exam_end_datetime, '%Y-%m-%d %H:%i') as exam_end_datetime,
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
      res.status(500).json({
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
    const { title, examType, dateTime, duration_minutes, exam_end_datetime } = req.body;

    // Basic validation
    if (!title || !examType || !dateTime || !duration_minutes) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields for update.",
      });
    }

    // Validate exam_end_datetime if provided
    if (exam_end_datetime) {
      const startTime = new Date(dateTime);
      const endTime = new Date(exam_end_datetime);
      if (endTime <= startTime) {
        return res.status(400).json({
          success: false,
          message: "exam_end_datetime must be after exam_date_time.",
        });
      }
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
          return res.status(403).json({
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
        exam_end_datetime: exam_end_datetime || null,
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
          return res.status(403).json({
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
      return res.status(403).json({
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
      return res.status(404).json({
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
                DATE_FORMAT(e.exam_end_datetime, '%Y-%m-%d %H:%i') as exam_end_datetime,
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
    res.status(500).json({
      success: false,
      message: "Server error while fetching upcoming exams.",
    });
  }
});

// @route   GET /api/exams/me/upcoming
// @desc    Get all exams that the student has NOT yet submitted (class-based + direct assignments)
// @access  Student, NewStudent, Parent, Teacher
router.get(
  "/me/upcoming",
  auth,
  authorize(["Student", "NewStudent", "Parent", "Teacher"]),
  async (req, res) => {
    const { id: userId, roles } = req.user;
    const connection = await pool.getConnection();

    try {
      let allExams = [];
      let branchId = null;

      let studentClassId = null;
      let examTypeFilter = null;
      let studentIdParam = null;

      // Determine student's class and exam type based on role
      if (roles.includes("Student")) {
        const [students] = await connection.query(
          "SELECT class_id, branch_id FROM students WHERE user_id = ?",
          [userId]
        );
        if (students.length > 0) {
          studentClassId = students[0].class_id;
          branchId = students[0].branch_id;
          examTypeFilter = "Internal";
          const [studentProfile] = await connection.query(
            "SELECT id FROM students WHERE user_id = ?",
            [userId]
          );
          studentIdParam = studentProfile.length ? studentProfile[0].id : null;
        }
      } else if (roles.includes("NewStudent")) {
        const [users] = await connection.query(
          "SELECT email FROM users WHERE id = ?",
          [userId]
        );
        if (users.length > 0) {
          const [newStudents] = await connection.query(
            "SELECT class_id, branch_id FROM new_students WHERE student_id = ?",
            [users[0].email]
          );
          if (newStudents.length > 0) {
            studentClassId = newStudents[0].class_id;
            branchId = newStudents[0].branch_id;
            examTypeFilter = "External";
          }
        }
        studentIdParam = userId; // NewStudent uses user ID
      }

      // Get class-based exams (if student has a class)
      if (studentClassId && examTypeFilter && studentIdParam) {
        const classExamQuery = `
          SELECT
            e.id,
            e.title,
            e.duration_minutes,
            DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i:%s') AS date,
            DATE_FORMAT(e.exam_end_datetime, '%Y-%m-%d %H:%i:%s') AS exam_end_datetime,
            c.name AS class,
            b.school_name AS branch,
            'class-based' AS assignment_type,
            (
              SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ')
              FROM questions q
              JOIN class_subjects cs ON q.class_subject_id = cs.id
              WHERE q.exam_id = e.id
            ) AS subjects
          FROM exams e
          JOIN classes c ON e.class_id = c.id
          JOIN branches b ON e.branch_id = b.id
          LEFT JOIN exam_results er
            ON e.id = er.exam_id
            AND er.student_id = ?
            AND er.submitted_at IS NOT NULL
          WHERE e.class_id = ?
            AND e.exam_type = ?
            AND er.id IS NULL
        `;

        const [classExams] = await connection.query(classExamQuery, [studentIdParam, studentClassId, examTypeFilter]);
        allExams = allExams.concat(classExams);
      }

      // For new students without a class_id, show all External exams from their branch
      if (!studentClassId && examTypeFilter === "External" && branchId && studentIdParam) {
        const branchExternalQuery = `
          SELECT
            e.id,
            e.title,
            e.duration_minutes,
            DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i:%s') AS date,
            DATE_FORMAT(e.exam_end_datetime, '%Y-%m-%d %H:%i:%s') AS exam_end_datetime,
            c.name AS class,
            b.school_name AS branch,
            'branch-external' AS assignment_type,
            (
              SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ')
              FROM questions q
              JOIN class_subjects cs ON q.class_subject_id = cs.id
              WHERE q.exam_id = e.id
            ) AS subjects
          FROM exams e
          JOIN classes c ON e.class_id = c.id
          JOIN branches b ON e.branch_id = b.id
          LEFT JOIN exam_results er
            ON e.id = er.exam_id
            AND er.student_id = ?
            AND er.submitted_at IS NOT NULL
          WHERE e.branch_id = ?
            AND e.exam_type = 'External'
            AND er.id IS NULL
        `;
        const [branchExams] = await connection.query(branchExternalQuery, [studentIdParam, branchId]);
        allExams = allExams.concat(branchExams);
      }

      // Get directly assigned exams (for all students, especially those without a class)
      // Note: student_exam_assignments.student_id stores user_id (auth user ID), not internal student profile ID
      if (userId && branchId) {
        try {
          const directExamQuery = `
            SELECT
              e.id,
              e.title,
              e.duration_minutes,
              DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i:%s') AS date,
              DATE_FORMAT(e.exam_end_datetime, '%Y-%m-%d %H:%i:%s') AS exam_end_datetime,
              NULL AS class,
              b.school_name AS branch,
              'direct-assignment' AS assignment_type,
              (
                SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ')
                FROM questions q
                JOIN class_subjects cs ON q.class_subject_id = cs.id
                WHERE q.exam_id = e.id
              ) AS subjects
            FROM student_exam_assignments sea
            JOIN exams e ON sea.exam_id = e.id
            JOIN branches b ON sea.branch_id = b.id
            LEFT JOIN exam_results er
              ON e.id = er.exam_id
              AND er.student_id = ?
              AND er.submitted_at IS NOT NULL
            WHERE sea.student_id = ?
              AND sea.branch_id = ?
              AND er.id IS NULL
          `;

          const [directExams] = await connection.query(directExamQuery, [userId, userId, branchId]);
          allExams = allExams.concat(directExams);
        } catch (directExamError) {
          // Table might not exist yet - log and continue with class-based exams only
          if (directExamError.code === 'ER_NO_SUCH_TABLE') {
            console.log('Note: student_exam_assignments table not yet created. Returning class-based exams only.');
          } else {
            console.error('Error fetching direct assignments:', directExamError.message);
          }
        }
      }

      // Remove duplicates and sort by date
      const uniqueExams = {};
      allExams.forEach((exam) => {
        if (!uniqueExams[exam.id]) {
          uniqueExams[exam.id] = exam;
        }
      });

      const upcomingExams = Object.values(uniqueExams)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((exam) => ({
          ...exam,
          subjects: exam.subjects ? exam.subjects.split(", ") : [],
        }));

      res.json({ success: true, data: upcomingExams });
    } catch (err) {
      console.error("Error fetching exams:", err);
      res.status(500).json({ success: false, message: "Server error." });
    } finally {
      connection.release();
    }
  }
);
// --- CBT Student Facing Endpoints ---

// @route   GET /api/exams/student/current-exam
// @desc    Get the currently active exam for the student (resumes if already started)
// @access  Student, NewStudent
// @route   GET /api/exams/student/current-exam
// @desc    Get the currently active exam for the student (resumes if already started)
// @access  Student, NewStudent
router.get(
  "/student/current-exam",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    const connection = await pool.getConnection();
    try {
      let studentClassId, examTypeFilter, dbStudentId, branchId;
      const { roles } = req.user;
      const userId = req.user.id;

      console.log(`[Current Exam] Fetching current exam for user_id: ${userId} with roles: ${roles}`);

      console.log(`[Current Exam] Student ID: ${userId}, Roles: ${roles}`);

      if (roles.includes("NewStudent")) {
        console.log(`[Current Exam] Checking NewStudent with user_id: ${userId}`);
        const [newStudent] = await connection.query(
          "SELECT class_id, branch_id FROM new_students WHERE student_id = (SELECT email FROM users WHERE id = ?)",
          [userId]
        );
        console.log(`[Current Exam] NewStudent query result:`, newStudent);
        if (newStudent.length) {
          studentClassId = newStudent[0].class_id;
          branchId = newStudent[0].branch_id;
          examTypeFilter = "External";
          dbStudentId = userId;
          console.log(`[Current Exam] NewStudent found - class_id: ${studentClassId}, branch_id: ${branchId}, dbStudentId: ${dbStudentId}`);
        } else {
          console.log(`[Current Exam] No NewStudent record found for user_id: ${userId}`);
        }
      } else if (roles.includes("Student")) {
        console.log(`[Current Exam] Checking Student with user_id: ${userId}`);
        const [existingStudent] = await connection.query(
          "SELECT id, class_id FROM students WHERE user_id = ?",
          [userId]
        );
        console.log(`[Current Exam] Student query result:`, existingStudent);
        if (existingStudent.length) {
          studentClassId = existingStudent[0].class_id;
          examTypeFilter = "Internal";
          dbStudentId = existingStudent[0].id;
          console.log(`[Current Exam] Student found - id: ${dbStudentId}, class_id: ${studentClassId}`);
        } else {
          console.log(`[Current Exam] No Student record found for user_id: ${userId}`);
        }
      }

      if (!dbStudentId) {
        console.log(`[Current Exam] Missing student ID - dbStudentId: ${dbStudentId}`);
        return res.status(404).json({ success: false, message: "Student not found." });
      }

      const endWindow = examTypeFilter === "Internal"
        ? "COALESCE(exam_end_datetime, exam_date_time + INTERVAL 1 DAY)"
        : "COALESCE(exam_end_datetime, exam_date_time + INTERVAL duration_minutes MINUTE)";

      console.log(`[Current Exam] Looking for exam - class_id: ${studentClassId}, exam_type: ${examTypeFilter}, dbStudentId: ${dbStudentId}`);
      console.log(`[Current Exam] End window calculation: ${endWindow}`);

      let exams = [];

      // First, check for class-based exams (if student has a class)
      // Exclude exams the student has already submitted so LIMIT 1 picks the next available
      if (studentClassId) {
        const [classBasedExams] = await connection.query(
          `SELECT id, title, duration_minutes, exam_date_time, exam_end_datetime, exam_type
           FROM exams
           WHERE class_id = ? AND exam_type = ?
             AND NOW() >= exam_date_time - INTERVAL 30 MINUTE
             AND NOW() <= ${endWindow}
             AND id NOT IN (SELECT exam_id FROM exam_results WHERE student_id = ? AND submitted_at IS NOT NULL)
           ORDER BY exam_date_time ASC
           LIMIT 1`,
          [studentClassId, examTypeFilter, userId]
        );
        exams = classBasedExams;
      }

      // If no class-based exam found, check for directly assigned exams
      if (exams.length === 0) {
        console.log(`[Current Exam] No class-based exam found, checking direct assignments for user_id: ${userId}`);
        const [directExams] = await connection.query(
          `SELECT e.id, e.title, e.duration_minutes, e.exam_date_time, e.exam_end_datetime, e.exam_type
           FROM student_exam_assignments sea
           JOIN exams e ON sea.exam_id = e.id
           WHERE sea.student_id = ?
             AND NOW() >= e.exam_date_time - INTERVAL 30 MINUTE
             AND NOW() <= ${endWindow}
             AND e.id NOT IN (SELECT exam_id FROM exam_results WHERE student_id = ? AND submitted_at IS NOT NULL)
           ORDER BY e.exam_date_time ASC
           LIMIT 1`,
          [userId, userId]
        );
        exams = directExams;
      }

      // For new students without a class_id, check branch-wide External exams
      if (exams.length === 0 && !studentClassId && branchId && examTypeFilter === "External") {
        console.log(`[Current Exam] No direct assignments found, checking branch-wide External exams for branch_id: ${branchId}`);
        const [branchExams] = await connection.query(
          `SELECT e.id, e.title, e.duration_minutes, e.exam_date_time, e.exam_end_datetime, e.exam_type
           FROM exams e
           WHERE e.branch_id = ?
             AND e.exam_type = 'External'
             AND NOW() >= e.exam_date_time - INTERVAL 30 MINUTE
             AND NOW() <= ${endWindow}
             AND e.id NOT IN (SELECT exam_id FROM exam_results WHERE student_id = ? AND submitted_at IS NOT NULL)
           ORDER BY e.exam_date_time ASC
           LIMIT 1`,
          [branchId, userId]
        );
        exams = branchExams;
      }

      console.log(`[Current Exam] Exam query result:`, exams);

      if (exams.length === 0) {
        console.log(`[Current Exam] No current exam available for class_id: ${studentClassId}, exam_type: ${examTypeFilter}`);
        return res.status(404).json({ success: false, message: "No current exam available." });
      }

      const currentExam = exams[0];
      const examId = currentExam.id;
      console.log(`[Current Exam] Found exam - id: ${examId}, title: ${currentExam.title}, duration: ${currentExam.duration_minutes} minutes`);

      // Check for existing exam results
      console.log(`[Current Exam] Checking exam_results for exam_id: ${examId}, student_id: ${dbStudentId}`);
      let [existingResult] = await connection.query(
        "SELECT id, started_at, submitted_at, answers FROM exam_results WHERE exam_id = ? AND student_id = ?",
        [examId, dbStudentId]
      );

      console.log(`[Current Exam] Existing results count: ${existingResult.length}`);
      if (existingResult.length > 0) {
        console.log(`[Current Exam] Existing result details:`, {
          id: existingResult[0].id,
          started_at: existingResult[0].started_at,
          submitted_at: existingResult[0].submitted_at,
          has_answers: !!existingResult[0].answers,
          answers_preview: existingResult[0].answers ? existingResult[0].answers.substring(0, 100) : null
        });
      } else {
        console.log(`[Current Exam] No existing exam_results found for exam_id: ${examId}, student_id: ${dbStudentId}`);
      }

      let startedAt = null;
      let remainingTime = currentExam.duration_minutes;
      let savedAnswers = {};
      const GRACE_MINUTES = 0;

      if (existingResult.length > 0) {
        // Check if exam is already submitted
        if (existingResult[0].submitted_at) {
          console.log(`[Current Exam] ❌ Exam already submitted at: ${existingResult[0].submitted_at}`);
          console.log(`[Current Exam] Student attempted to access submitted exam - exam_id: ${examId}, student_id: ${dbStudentId}`);
          return res.status(403).json({ 
            success: false, 
            message: "Exam already submitted.",
            debug: {
              submitted_at: existingResult[0].submitted_at,
              exam_id: examId,
              student_id: dbStudentId
            }
          });
        }

        console.log(`[Current Exam] Exam not submitted, checking if started`);
        startedAt = existingResult[0].started_at;

        if (startedAt) {
          console.log(`[Current Exam] Exam started at: ${startedAt}`);
          const startTime = new Date(startedAt);
          const now = new Date();
          let timeSpent = Math.floor((now - startTime) / 60000);
          remainingTime = Math.max(0, currentExam.duration_minutes - timeSpent);
          console.log(`[Current Exam] Time spent: ${timeSpent} minutes, Remaining time: ${remainingTime} minutes`);

          if (currentExam.exam_end_datetime) {
            const examEnd = new Date(currentExam.exam_end_datetime);
            const hardDeadline = Math.floor((examEnd - now) / 60000);
            remainingTime = Math.min(remainingTime, Math.max(0, hardDeadline + GRACE_MINUTES));
            console.log(`[Current Exam] Hard deadline check - exam_end: ${currentExam.exam_end_datetime}, hardDeadline: ${hardDeadline} minutes, Remaining after deadline: ${remainingTime} minutes`);
          } else {
            remainingTime = Math.max(0, remainingTime + GRACE_MINUTES);
            console.log(`[Current Exam] No exam_end_datetime, remaining time with grace: ${remainingTime} minutes`);
          }

          if (remainingTime <= 0) {
            console.log(`[Current Exam] ❌ Exam time expired - remainingTime: ${remainingTime} minutes`);
            return res.status(403).json({ success: false, message: "Your exam time has expired." });
          }

          if (existingResult[0].answers) {
            try {
              const answersArray = JSON.parse(existingResult[0].answers);
              answersArray.forEach(a => { savedAnswers[a.questionId] = a.selectedOptionIndex; });
              console.log(`[Current Exam] Loaded ${answersArray.length} saved answers from previous session`);
            } catch (e) {
              console.log(`[Current Exam] Error parsing saved answers:`, e);
            }
          }
        } else {
          console.log(`[Current Exam] Exam result exists but started_at is null - updating started_at`);
          await connection.query("UPDATE exam_results SET started_at = NOW() WHERE id = ?", [existingResult[0].id]);
          startedAt = new Date();
          console.log(`[Current Exam] started_at updated to: ${startedAt}`);
        }
      } else {
        // No existing result - create one
        console.log(`[Current Exam] No exam result found - creating new exam result`);
        const [questionCount] = await connection.query(
          "SELECT COUNT(*) as total FROM questions WHERE exam_id = ?",
          [examId]
        );
        const totalQuestions = questionCount[0]?.total || 0;
        console.log(`[Current Exam] Total questions for exam: ${totalQuestions}`);
        
        const resultId = uuidv4();
        await connection.query(
          `INSERT INTO exam_results (id, exam_id, student_id, score, total_questions, answered_questions, started_at, submitted_at) VALUES (?, ?, ?, 0, ?, 0, NOW(), NULL)`,
          [resultId, examId, dbStudentId, totalQuestions]
        );
        startedAt = new Date();
        console.log(`[Current Exam] New exam result created - id: ${resultId}, started_at: ${startedAt}`);
      }

      // Fetch questions
      console.log(`[Current Exam] Fetching questions for exam_id: ${examId}`);
      const [questionsFromDb] = await connection.query(
        `SELECT q.id, q.question_text as text, q.question_image_url, q.options,
                q.class_subject_id, cs.name as subject_name
         FROM questions q
         JOIN class_subjects cs ON q.class_subject_id = cs.id
         WHERE q.exam_id = ?
         ORDER BY cs.name`,
        [examId]
      );

      console.log(`[Current Exam] Found ${questionsFromDb.length} questions`);

      const subjects = {};
      questionsFromDb.forEach((q) => {
        if (!subjects[q.class_subject_id]) {
          subjects[q.class_subject_id] = { id: q.class_subject_id, title: q.subject_name, questions: [] };
        }
        subjects[q.class_subject_id].questions.push({
          id: q.id,
          text: q.text,
          question_image_url: q.question_image_url || null,
          options: JSON.parse(q.options),
          selectedOptionIndex: savedAnswers[q.id] !== undefined ? savedAnswers[q.id] : null,
        });
      });

      console.log(`[Current Exam] ✅ Successfully returning exam data with ${Object.keys(subjects).length} subjects`);
      
      res.json({
        success: true,
        data: {
          examId: currentExam.id,
          title: currentExam.title,
          examDuration: currentExam.duration_minutes,
          examStartTime: currentExam.exam_date_time,
          examEndDatetime: currentExam.exam_end_datetime,
          startedAt: startedAt,
          remainingTime: remainingTime,
          subjects: Object.values(subjects),
        },
      });
    } catch (err) {
      console.error("Error fetching current exam:", err);
      res.status(500).json({ success: false, message: "Server Error" });
    } finally {
      connection.release();
    }
  }
);

// @route   POST /api/exams/save-progress
// @desc    Save current answers (auto‑save) without submitting the exam
// @access  Student, NewStudent
router.post(
  "/save-progress",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    const { examId, answers } = req.body;
    const userId = req.user.id;

    if (!examId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: "Missing examId or answers." });
    }

    const connection = await pool.getConnection();
    try {
      let dbStudentId = userId;
      const [roleCheck] = await connection.query(
        "SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?",
        [userId]
      );
      const roleNames = roleCheck.map(r => r.name);

      if (roleNames.includes("Student")) {
        const [studentRecord] = await connection.query(
          "SELECT id FROM students WHERE user_id = ?",
          [userId]
        );
        if (studentRecord.length > 0) {
          dbStudentId = studentRecord[0].id;
        }
      }

      const [existing] = await connection.query(
        "SELECT id, total_questions FROM exam_results WHERE exam_id = ? AND student_id = ? AND submitted_at IS NULL",
        [examId, dbStudentId]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: "No active exam session found." });
      }

      const resultId = existing[0].id;
      const totalQuestions = existing[0].total_questions;

      const [allQuestions] = await connection.query(
        "SELECT id, correct_answer_index FROM questions WHERE exam_id = ?",
        [examId]
      );
      const questionMap = new Map(allQuestions.map(q => [q.id, q.correct_answer_index]));
      let correctCount = 0;
      for (const ans of answers) {
        if (questionMap.get(ans.questionId) === ans.selectedOptionIndex) {
          correctCount++;
        }
      }
      const percentageScore = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

      await connection.query(
        `UPDATE exam_results 
         SET answers = ?, answered_questions = ?, score = ?
         WHERE id = ?`,
        [JSON.stringify(answers), answers.length, percentageScore, resultId]
      );

      await connection.commit();
      res.json({ success: true, message: "Progress saved." });
    } catch (err) {
      await connection.rollback();
      console.error("Error saving progress:", err);
      res.status(500).json({ success: false, message: "Server error while saving progress." });
    } finally {
      connection.release();
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
      let branchId;
      let dbStudentId;
      const { roles } = req.user;
      const userId = req.user.id;

      if (roles.includes("NewStudent")) {
        const [newStudent] = await pool.query(
          "SELECT class_id, branch_id FROM new_students WHERE student_id = (SELECT email FROM users WHERE id = ?)",
          [userId]
        );
        if (newStudent.length > 0) {
          studentClassId = newStudent[0].class_id;
          branchId = newStudent[0].branch_id;
          examTypeFilter = "External";
          dbStudentId = userId;
        }
      } else if (roles.includes("Student")) {
        const [existingStudent] = await pool.query(
          "SELECT id, class_id FROM students WHERE user_id = ?",
          [userId]
        );
        if (existingStudent.length > 0) {
          studentClassId = existingStudent[0].class_id;
          examTypeFilter = "Internal";
          dbStudentId = existingStudent[0].id;
        }
      }

      if (!studentClassId && !branchId) {
        return res
          .status(404)
          .json({ success: false, message: "Student class not found." });
      }

      let exam;
      if (studentClassId) {
        // Admitted students: look up by class, skip already-submitted exams
        const [classExam] = await pool.query(
          `SELECT id, duration_minutes FROM exams
           WHERE class_id = ? AND exam_type = ?
             AND exam_date_time > NOW()
             AND id NOT IN (SELECT exam_id FROM exam_results WHERE student_id = ? AND submitted_at IS NOT NULL)
           ORDER BY exam_date_time ASC LIMIT 1`,
          [studentClassId, examTypeFilter, dbStudentId]
        );
        exam = classExam;
      } else if (branchId && examTypeFilter === "External") {
        // New students without a class: look up External exams from their branch, skip already-submitted
        const [branchExam] = await pool.query(
          `SELECT id, duration_minutes FROM exams
           WHERE branch_id = ? AND exam_type = 'External'
             AND exam_date_time > NOW()
             AND id NOT IN (SELECT exam_id FROM exam_results WHERE student_id = ? AND submitted_at IS NOT NULL)
           ORDER BY exam_date_time ASC LIMIT 1`,
          [branchId, dbStudentId]
        );
        exam = branchExam;
      }

      if (exam.length === 0) {
        return res.status(404).json({
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
        return res.status(404).json({
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
        return res.status(403).json({
          success: false,
          message: "It is not yet time for the exam.",
        });
      }

      if (now > examEndTime) {
        return res.status(403).json({
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
    const { roles } = req.user;
    const userId = req.user.id;

    console.log("Received answers submission:", { examId, answers, userId });

    if (!examId || !answers || !Array.isArray(answers)) {
      return res
        .status(400)
        .json({ success: false, message: "Missing examId or answers." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let dbStudentId = userId;
      if (roles.includes("Student")) {
        const [existingStudent] = await connection.query(
          "SELECT id FROM students WHERE user_id = ?",
          [userId]
        );
        if (existingStudent.length) {
          dbStudentId = existingStudent[0].id;
        }
      }

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

      // Check for existing result and started_at
      const [existingResult] = await connection.query(
        "SELECT id, started_at FROM exam_results WHERE exam_id = ? AND student_id = ?",
        [examId, dbStudentId]
      );
      
      if (existingResult.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "You have not started this exam yet. Please access the exam first.",
        });
      }

      const resultRecord = existingResult[0];
      
      // If there's no started_at, set it now (for backward compatibility)
      let startedAt = resultRecord.started_at;
      if (!startedAt) {
        startedAt = new Date();
        await connection.query(
          "UPDATE exam_results SET started_at = NOW() WHERE id = ?",
          [resultRecord.id]
        );
      }

      // Validate time constraints
      const now = new Date();
      const startTime = new Date(startedAt);
      const gracePeriodMinutes = 5;
      const maxEndTime = new Date(startTime.getTime() + (exam.duration_minutes + gracePeriodMinutes) * 60 * 1000);
      
      // Check if exam_end_datetime is set and is earlier than calculated max time
      let submissionDeadline = maxEndTime;
      if (exam.exam_end_datetime) {
        const examEndDatetime = new Date(exam.exam_end_datetime);
        if (examEndDatetime < submissionDeadline) {
          submissionDeadline = examEndDatetime;
        }
      }

      if (now > submissionDeadline) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: "Your exam time has expired. Submission is no longer accepted.",
        });
      }

      // Calculate time_spent_minutes
      const timeSpentMinutes = Math.floor((now - startTime) / 60000);

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
        return res.status(404).json({
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

      // Update existing result with score and time_spent_minutes
      await connection.query(
        `UPDATE exam_results 
         SET score = ?, total_questions = ?, answered_questions = ?, answers = ?, 
             time_spent_minutes = ?, submitted_at = NOW()
         WHERE id = ?`,
        [
          percentageScore,
          totalQuestions,
          answers.length,
          JSON.stringify(answers),
          timeSpentMinutes,
          resultRecord.id
        ]
      );

      // FIX: NO, WE SHOULD Sync scores with student_results table
      // const [student] = await connection.query(
      //   "SELECT id FROM students WHERE user_id = ?",
      //   [userId]
      // );
      // if (student.length > 0) {
      //   const studentId = student[0].id;
      //   for (const subjectId in scoresBySubject) {
      //     const { score, total } = scoresBySubject[subjectId];
      //     const percentageScore = total > 0 ? (score / total) * 100 : 0;

      //     const [subject] = await connection.query(
      //       "SELECT teacher_id FROM class_subjects WHERE id = ?",
      //       [subjectId]
      //     );
      //     const teacherId = subject.length > 0 ? subject[0].teacher_id : null;

      //     const [existing] = await connection.query(
      //       "SELECT id FROM student_results WHERE student_id = ? AND subject_id = ? AND term_id = ? AND assessment_type = ?",
      //       [studentId, subjectId, termId, exam.assessment_type]
      //     );

      //     if (existing.length > 0) {
      //       await connection.query(
      //         "UPDATE student_results SET score = ?, teacher_id = ?, exam_id = ?, updated_at = NOW() WHERE id = ?",
      //         [percentageScore, teacherId, examId, existing[0].id]
      //       );
      //     } else {
      //       const resultId = uuidv4();
      //       await connection.query(
      //         "INSERT INTO student_results (id, student_id, class_id, subject_id, term_id, assessment_type, score, teacher_id, branch_id, exam_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      //         [
      //           resultId,
      //           studentId,
      //           exam.class_id,
      //           subjectId,
      //           termId,
      //           exam.assessment_type,
      //           percentageScore,
      //           teacherId,
      //           exam.branch_id,
      //           examId,
      //         ]
      //       );
      //     }
      //   }
      // }

      await connection.commit();

      res
        .status(200)
        .json({ success: true, message: "Exam submitted successfully." });
    } catch (err) {
      await connection.rollback();
      console.error("Error submitting answers:", err);
      res.status(500).json({
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
          return res.status(403).json({
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
                er.started_at,
                er.time_spent_minutes,
                er.submitted_at,
                er.published,
                COALESCE(s.first_name, ns.first_name) AS first_name,
                COALESCE(s.last_name, ns.last_name) AS last_name
            FROM exam_results er
            LEFT JOIN students s ON s.id = er.student_id
            LEFT JOIN new_students ns ON ns.user_id = er.student_id
            WHERE er.exam_id = ? AND er.submitted_at IS NOT NULL
        `;

      const [results] = await pool.query(query, [examId]);
      res.json({
        success: true,
        data: results,
        count: results.length
      });
    } catch (err) {
      console.error("Error fetching exam results:", err);
      res.status(500).json({
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
        return res.status(403).json({
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
        return res.status(403).json({
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
                er.started_at,
                er.time_spent_minutes,
                er.submitted_at,
                er.published,
                COALESCE(s.first_name, s2.first_name, ns.first_name) AS first_name,
                COALESCE(s.last_name, s2.last_name, ns.last_name) AS last_name
            FROM exam_results er
            LEFT JOIN students s ON s.user_id = er.student_id
            LEFT JOIN students s2 ON s2.id = er.student_id
            LEFT JOIN new_students ns ON ns.user_id = er.student_id
            WHERE er.exam_id = ?
        `;
      const [results] = await pool.query(query, [examId]);
      res.json({ success: true, data: results });
    } catch (err) {
      console.error("Error fetching exam results for teacher:", err);
      res.status(500).json({
        success: false,
        message: "Server error while fetching exam results.",
      });
    }
  }
);

// ============================================
// INDIVIDUAL EXAM RESULT MANAGEMENT ROUTES
// ============================================

// @route   PUT /api/exams/results/:resultId
// @desc    Update an individual exam result (score and answered questions)
// @access  Teacher, Admin, SuperAdmin
router.put(
  "/results/:resultId",
  [auth, authorize(["Teacher", "Admin", "SuperAdmin"])],
  async (req, res) => {
    const { resultId } = req.params;
    const { score, answered_questions } = req.body;

    // Validation
    if (score === undefined || answered_questions === undefined) {
      return res.status(400).json({
        success: false,
        message: "Both score and answered_questions are required.",
      });
    }

    if (typeof score !== "number" || score < 0 || score > 100) {
      return res.status(400).json({
        success: false,
        message: "Score must be a number between 0 and 100.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Get the exam result details
      const [result] = await connection.query(
        `SELECT er.*, e.class_id, e.branch_id 
         FROM exam_results er
         JOIN exams e ON er.exam_id = e.id
         WHERE er.id = ?`,
        [resultId]
      );

      if (result.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Exam result not found.",
        });
      }

      const examResult = result[0];

      // Authorization checks
      if (req.user.roles.includes("Teacher")) {
        const [staff] = await connection.query(
          "SELECT id FROM staff WHERE user_id = ?",
          [req.user.id]
        );

        if (staff.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Staff record not found.",
          });
        }

        const teacherId = staff[0].id;

        // Check if teacher owns this class
        const [teacherClass] = await connection.query(
          "SELECT id FROM classes WHERE id = ? AND teacher_id = ?",
          [examResult.class_id, teacherId]
        );

        if (teacherClass.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You can only edit results for your own class.",
          });
        }
      }

      if (
        req.user.roles.includes("Admin") &&
        !req.user.roles.includes("SuperAdmin")
      ) {
        const [adminStaff] = await connection.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );

        if (
          adminStaff.length === 0 ||
          adminStaff[0].branch_id !== examResult.branch_id
        ) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Admins can only edit results for their own branch.",
          });
        }
      }

      // Validate answered_questions against total_questions
      if (
        answered_questions < 0 ||
        answered_questions > examResult.total_questions
      ) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Answered questions must be between 0 and ${examResult.total_questions}.`,
        });
      }

      await connection.query(
        `UPDATE exam_results 
         SET score = ?, answered_questions = ?
         WHERE id = ?`,
        [score, answered_questions, resultId]
      );


       // If the result is published, sync to student_results
      if (examResult.published) {
        await syncEditedScoreToStudentResults(connection, {
          exam_id: examResult.exam_id,
          student_id: examResult.student_id,
          score: score,
          answers: examResult.answers,
          total_questions: examResult.total_questions,
          branch_id: examResult.branch_id,
          assessment_type: examResult.assessment_type,
          class_id: examResult.class_id,
        });
      }

      await connection.commit();




      await connection.commit();

      res.json({
        success: true,
        message: "Exam result updated successfully.",
        data: {
          id: resultId,
          score,
          answered_questions,
        },
      });

      console.log(`Exam result ${resultId} updated successfully.`);
    } catch (err) {
      await connection.rollback();
      console.error("Error updating exam result:", err);
      res.status(500).json({
        success: false,
        message: "Server error while updating exam result.",
      });
    } finally {
      connection.release();
    }
  }
);

// @route   PUT /api/exams/results/:resultId/publish
// @desc    Publish or unpublish an individual exam result
// @access  Teacher, Admin, SuperAdmin
router.put(
  "/results/:resultId/publish",
  [auth, authorize(["Teacher", "Admin", "SuperAdmin"])],
  async (req, res) => {
    const { resultId } = req.params;
    const { published } = req.body;
    
    console.log(`[PUBLISH-ENDPOINT] Request received - resultId: ${resultId}, published: ${published}, userId: ${req.user.id}, roles: ${req.user.roles.join(', ')}`);

    // Validation
    if (typeof published !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Published must be a boolean value.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Get the exam result details
      const [result] = await connection.query(
        `SELECT er.*, e.class_id, e.branch_id 
         FROM exam_results er
         JOIN exams e ON er.exam_id = e.id
         WHERE er.id = ?`,
        [resultId]
      );

      if (result.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Exam result not found.",
        });
      }

      const examResult = result[0];

      // Authorization checks
      if (req.user.roles.includes("Teacher")) {
        const [staff] = await connection.query(
          "SELECT id FROM staff WHERE user_id = ?",
          [req.user.id]
        );

        if (staff.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Staff record not found.",
          });
        }

        const teacherId = staff[0].id;

        // Check if teacher owns this class
        const [teacherClass] = await connection.query(
          "SELECT id FROM classes WHERE id = ? AND teacher_id = ?",
          [examResult.class_id, teacherId]
        );

        if (teacherClass.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You can only publish results for your own class.",
          });
        }
      }

      if (
        req.user.roles.includes("Admin") &&
        !req.user.roles.includes("SuperAdmin")
      ) {
        const [adminStaff] = await connection.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );

        if (
          adminStaff.length === 0 ||
          adminStaff[0].branch_id !== examResult.branch_id
        ) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Admins can only publish results for their own branch.",
          });
        }
      }

      
      console.log(`[PUBLISH] Exam type: ${examResult.assessment_type || 'N/A'}, about to sync to student_results`);
        
      if (published) {
        await syncToStudentResults(connection, examResult);
        
        await connection.query(
          `UPDATE exam_results 
           SET published = TRUE, published_by = ?, published_at = NOW()
           WHERE id = ?`,
          [req.user.id, resultId]
        );
      } else {
        console.log(`[PUBLISH] About to remove from student_results for unpublish`);
        
        await removeFromStudentResults(connection, examResult);
        
        await connection.query(
          `UPDATE exam_results 
           SET published = FALSE, published_by = NULL, published_at = NULL
           WHERE id = ?`,
          [resultId]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: published
          ? "Exam result published successfully."
          : "Exam result unpublished successfully.",
        data: {
          id: resultId,
          published,
        },
      });

      console.log(
        `Exam result ${resultId} ${
          published ? "published" : "unpublished"
        } successfully.`
      );
      console.log(`[PUBLISH] Request to ${published ? 'publish' : 'unpublish'} resultId: ${resultId}, exam_id: ${examResult.exam_id}, student_id: ${examResult.student_id}`);
    } catch (err) {
      await connection.rollback();
      console.error("Error updating publish status:", err);
      res.status(500).json({
        success: false,
        message: "Server error while updating publish status.",
      });
    } finally {
      connection.release();
    }
  }
);

// @route   PUT /api/exams/results/publish
// @desc    Publish or unpublish all results for a specific exam and class
// @access  Teacher, Admin, SuperAdmin
router.put(
  "/results/publish",
  [auth, authorize(["Teacher", "Admin", "SuperAdmin"])],
  async (req, res) => {
    const { exam_id, class_id, published } = req.body;

    // Validation
    if (!exam_id || !class_id) {
      return res.status(400).json({
        success: false,
        message: "exam_id and class_id are required.",
      });
    }

    if (typeof published !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Published must be a boolean value.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Get exam details
      const [exam] = await connection.query(
        "SELECT branch_id, class_id FROM exams WHERE id = ?",
        [exam_id]
      );

      if (exam.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Exam not found.",
        });
      }

      const examData = exam[0];

      // Verify class_id matches exam
      if (examData.class_id !== class_id) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Class ID does not match the exam.",
        });
      }

      // Authorization checks
      if (req.user.roles.includes("Teacher")) {
        const [staff] = await connection.query(
          "SELECT id FROM staff WHERE user_id = ?",
          [req.user.id]
        );

        if (staff.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Staff record not found.",
          });
        }

        const teacherId = staff[0].id;

        // Check if teacher owns this class
        const [teacherClass] = await connection.query(
          "SELECT id FROM classes WHERE id = ? AND teacher_id = ?",
          [class_id, teacherId]
        );

        if (teacherClass.length === 0) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You can only publish results for your own class.",
          });
        }
      }

      if (
        req.user.roles.includes("Admin") &&
        !req.user.roles.includes("SuperAdmin")
      ) {
        const [adminStaff] = await connection.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );

        if (
          adminStaff.length === 0 ||
          adminStaff[0].branch_id !== examData.branch_id
        ) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Admins can only publish results for their own branch.",
          });
        }
      }

      // Update all results for this exam and class
      let updateQuery;
      let updateParams;

      if (published) {
        updateQuery = `
          UPDATE exam_results er
          JOIN students s ON er.student_id = s.user_id
          SET er.published = TRUE, er.published_by = ?, er.published_at = NOW()
          WHERE er.exam_id = ? AND s.class_id = ?
        `;
        updateParams = [req.user.id, exam_id, class_id];
      } else {
        updateQuery = `
          UPDATE exam_results er
          JOIN students s ON er.student_id = s.user_id
          SET er.published = FALSE, er.published_by = NULL, er.published_at = NULL
          WHERE er.exam_id = ? AND s.class_id = ?
        `;
        updateParams = [exam_id, class_id];
      }

      const [updateResult] = await connection.query(updateQuery, updateParams);

      // Also publish/unpublish results for new students (not in the students table) on the same exam
      if (published) {
        const [nsUpdate] = await connection.query(
          `UPDATE exam_results er
           SET er.published = TRUE, er.published_by = ?, er.published_at = NOW()
           WHERE er.exam_id = ?
             AND er.student_id NOT IN (SELECT user_id FROM students)
             AND er.published = FALSE`,
          [req.user.id, exam_id]
        );
        updateResult.affectedRows += nsUpdate.affectedRows;
      } else {
        const [nsUpdate] = await connection.query(
          `UPDATE exam_results er
           SET er.published = FALSE, er.published_by = NULL, er.published_at = NULL
           WHERE er.exam_id = ?
             AND er.student_id NOT IN (SELECT user_id FROM students)
             AND er.published = TRUE`,
          [exam_id]
        );
        updateResult.affectedRows += nsUpdate.affectedRows;
      }

      await connection.commit();

      res.json({
        success: true,
        message: published
          ? "All results published successfully."
          : "All results unpublished successfully.",
        data: {
          affected_rows: updateResult.affectedRows,
          exam_id,
          class_id,
          published,
        },
      });

      console.log(
        `All results for exam ${exam_id} and class ${class_id} ${
          published ? "published" : "unpublished"
        } successfully.`
      );
    } catch (err) {
      await connection.rollback();
      console.error("Error publishing/unpublishing results:", err);
      res.status(500).json({
        success: false,
        message: "Server error while updating publish status.",
      });
    } finally {
      connection.release();
    }
  }
);

// @route   GET /api/exams/results/me
// @desc    Get the authenticated student's own published results for the current term
// @access  Student, NewStudent
router.get("/results/me", [auth, authorize(["Student", "NewStudent"])], async (req, res) => {
  try {
    const userId = req.user.id;
    const { roles } = req.user;
    let branch_id, class_id;

    // Get branch_id based on student type
    if (roles.includes("Student")) {
      const [student] = await pool.query(
        "SELECT id, class_id, branch_id FROM students WHERE user_id = ?",
        [userId]
      );
      if (student.length === 0) {
        return res.status(404).json({ success: false, message: "Student not found." });
      }
      class_id = student[0].class_id;
      branch_id = student[0].branch_id;
    } else if (roles.includes("NewStudent")) {
      // For new students, get branch_id from new_students table
      const [newStudent] = await pool.query(
        "SELECT branch_id FROM new_students WHERE user_id = ?",
        [userId]
      );
      if (newStudent.length === 0) {
        return res.status(404).json({ success: false, message: "Student not found." });
      }
      branch_id = newStudent[0].branch_id;
      // New students may not have a class_id, so leave it null
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const [terms] = await pool.query(
      "SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE",
      [branch_id]
    );
    if (terms.length === 0) {
      return res.status(404).json({
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

    const [results] = await pool.query(query, [userId, term_id]);

    // Calculate position for each result
    const resultsWithPosition = await Promise.all(
      results.map(async (result) => {
        let rank = 0;

        if (class_id) {
          // For class-based students, rank within their class
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
          rank = scores.indexOf(parseFloat(result.score)) + 1;
        } else {
          // For direct-assigned students, rank within their branch
          const [branchScores] = await pool.query(
            `
                SELECT score FROM exam_results
                WHERE exam_id = ? AND published = TRUE AND student_id IN
                (SELECT user_id FROM new_students WHERE branch_id = ?)
                ORDER BY score DESC
            `,
            [result.exam_id, branch_id]
          );

          const scores = branchScores.map((s) => parseFloat(s.score));
          rank = scores.indexOf(parseFloat(result.score)) + 1;
        }

        return {
          ...result,
          position: rank > 0 ? getOrdinal(rank) : "N/A",
        };
      })
    );

    res.json({ success: true, data: resultsWithPosition });
  } catch (err) {
    console.error("Error fetching student exam results:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching exam results.",
    });
  }
});

// @route   POST /api/exams/assign
// @desc    Assign an exam to a specific student (for external/new students)
// @access  Teacher, Admin
router.post("/assign", [auth, authorize(["Teacher", "Admin"])], async (req, res) => {
  const { student_id, exam_id } = req.body;
  const { id: userId } = req.user;

  try {
    if (!student_id || !exam_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: student_id, exam_id",
      });
    }

    const result = await examAssignmentService.assignExamToStudent(
      student_id,
      exam_id,
      userId
    );

    if (!result.success && result.data?.assignmentId) {
      // Exam already assigned
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("Error assigning exam:", err);

    // Handle specific error messages
    if (err.message.includes("not assigned to any branch")) {
      return res.status(403).json({
        success: false,
        message: err.message,
      });
    }

    if (err.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error while assigning exam",
    });
  }
});

// @route   POST /api/exams/bulk-assign
// @desc    Assign an exam to multiple students or a whole class
// @access  Teacher, Admin
router.post("/bulk-assign", [auth, authorize(["Teacher", "Admin"])], async (req, res) => {
  const { exam_id, student_ids } = req.body;
  const { id: userId } = req.user;

  try {
    if (!exam_id || (!student_ids || student_ids.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: exam_id, student_ids (array)",
      });
    }

    const result = await examAssignmentService.bulkAssignExamToStudents(
      exam_id,
      student_ids,
      userId
    );

    res.json(result);
  } catch (err) {
    console.error("Error in bulk assignment:", err);

    // Handle specific error messages
    if (err.message.includes("not assigned to any branch")) {
      return res.status(403).json({
        success: false,
        message: err.message,
      });
    }

    if (err.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error while bulk assigning exams",
    });
  }
});

// @route   DELETE /api/exams/assignment/:assignmentId
// @desc    Remove an exam assignment from a student
// @access  Teacher, Admin
router.delete("/assignment/:assignmentId", [auth, authorize(["Teacher", "Admin"])], async (req, res) => {
  const { assignmentId } = req.params;

  try {
    const [result] = await pool.query(
      "DELETE FROM student_exam_assignments WHERE id = ?",
      [assignmentId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
      });
    }

    res.json({
      success: true,
      message: "Assignment removed successfully",
    });
  } catch (err) {
    console.error("Error removing assignment:", err);
    res.status(500).json({
      success: false,
      message: "Server error while removing assignment",
    });
  }
});

// @route   GET /api/exams/:examId/assignments
// @desc    Get all students assigned to an exam
// @access  Teacher, Admin
router.get("/:examId/assignments", [auth, authorize(["Teacher", "Admin"])], async (req, res) => {
  const { examId } = req.params;

  try {
    const query = `
      SELECT
        sea.id as assignment_id,
        sea.student_id,
        sea.assigned_at,
        COALESCE(ns.first_name, COALESCE(s.first_name, u.email)) as first_name,
        COALESCE(ns.last_name, COALESCE(s.last_name, '')) as last_name,
        COALESCE(ns.student_id, s.id) as student_code,
        CASE WHEN er.id IS NOT NULL THEN 1 ELSE 0 END AS has_submitted,
        er.score,
        er.submitted_at
      FROM student_exam_assignments sea
      LEFT JOIN users u ON sea.student_id = u.id
      LEFT JOIN students s ON u.id = s.user_id
      LEFT JOIN new_students ns ON u.id = ns.user_id
      LEFT JOIN exam_results er ON sea.exam_id = er.exam_id AND sea.student_id = er.student_id
      WHERE sea.exam_id = ?
      ORDER BY sea.assigned_at DESC
    `;

    const [assignments] = await pool.query(query, [examId]);

    res.json({
      success: true,
      data: assignments,
    });
  } catch (err) {
    console.error("Error fetching assignments:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching assignments",
    });
  }
});

module.exports = router;
