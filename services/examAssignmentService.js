const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');

/**
 * Assign an exam to a single student
 * Works with both regular students and new/external students
 * Automatically determines branch from the assigner's staff record
 *
 * @param {string} studentUserId - The user ID of the student (works for both types)
 * @param {string} examId - The exam ID to assign
 * @param {string} assignedByUserId - The user ID of the person doing the assignment (teacher/admin)
 * @returns {object} Result with success status and assignment data
 */
async function assignExamToStudent(studentUserId, examId, assignedByUserId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get assigner's branch from staff table
    const [staff] = await connection.query(
      'SELECT branch_id FROM staff WHERE user_id = ?',
      [assignedByUserId]
    );

    if (staff.length === 0) {
      throw new Error(`User with ID ${assignedByUserId} is not assigned to any branch`);
    }

    const branchId = staff[0].branch_id;

    // Check if exam exists and belongs to assigner's branch
    const [exams] = await connection.query(
      'SELECT id FROM exams WHERE id = ? AND branch_id = ?',
      [examId, branchId]
    );

    if (exams.length === 0) {
      throw new Error(`Exam with ID ${examId} not found in your branch`);
    }

    // Check if student user exists (works for both regular students and new/external students)
    // Both student types have a user record, so this single check works for all cases
    const [users] = await connection.query(
      'SELECT id FROM users WHERE id = ?',
      [studentUserId]
    );

    if (users.length === 0) {
      throw new Error(`Student user with ID ${studentUserId} not found`);
    }

    // Check if assignment already exists
    const [existing] = await connection.query(
      'SELECT id FROM student_exam_assignments WHERE student_id = ? AND exam_id = ?',
      [studentUserId, examId]
    );

    if (existing.length > 0) {
      await connection.commit();
      return {
        success: false,
        message: 'Exam is already assigned to this student',
        data: { assignmentId: existing[0].id }
      };
    }

    const assignmentId = uuidv4();
    await connection.query(
      `INSERT INTO student_exam_assignments
       (id, student_id, exam_id, branch_id, assigned_by)
       VALUES (?, ?, ?, ?, ?)`,
      [assignmentId, studentUserId, examId, branchId, assignedByUserId]
    );

    await connection.commit();

    // Fetch the created assignment to return
    const [created] = await connection.query(
      `SELECT * FROM student_exam_assignments WHERE id = ?`,
      [assignmentId]
    );

    return {
      success: true,
      message: 'Exam assigned successfully',
      data: created[0]
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function removeExamAssignment(assignmentId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    // Check if assignment exists before deleting
    const [existing] = await connection.query(
      'SELECT id FROM student_exam_assignments WHERE id = ?',
      [assignmentId]
    );
    
    if (existing.length === 0) {
      return { 
        success: false, 
        message: 'Assignment not found' 
      };
    }
    
    // Check for any dependent records (if you have any)
    // For example, if there are exam attempts or results linked to this assignment
    /*
    const [attempts] = await connection.query(
      'SELECT id FROM exam_attempts WHERE assignment_id = ?',
      [assignmentId]
    );
    
    if (attempts.length > 0) {
      // Either delete them or prevent deletion
      await connection.query(
        'DELETE FROM exam_attempts WHERE assignment_id = ?',
        [assignmentId]
      );
    }
    */
    
    const [result] = await connection.query(
      'DELETE FROM student_exam_assignments WHERE id = ?',
      [assignmentId]
    );
    
    await connection.commit();
    
    return { 
      success: result.affectedRows > 0,
      message: result.affectedRows > 0 ? 'Assignment removed successfully' : 'No assignment found to remove'
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getStudentAssignedExams(studentUserId, branchId) {
  const connection = await pool.getConnection();
  try {
    // First, verify the student exists
    const [student] = await connection.query(
      'SELECT id FROM users WHERE id = ?',
      [studentUserId]
    );
    if (student.length === 0) {
      throw new Error(`Student with ID ${studentUserId} not found`);
    }

    const query = `
      SELECT
        sea.id as assignment_id,
        e.id as exam_id,
        e.title,
        e.duration_minutes,
        e.exam_type,
        e.assessment_type,
        DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i:%s') AS exam_date_time,
        DATE_FORMAT(e.exam_end_datetime, '%Y-%m-%d %H:%i:%s') AS exam_end_datetime,
        b.school_name AS branch_name,
        b.id AS branch_id,
        (
          SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ')
          FROM questions q
          JOIN class_subjects cs ON q.class_subject_id = cs.id
          WHERE q.exam_id = e.id
        ) AS subjects,
        CASE WHEN er.id IS NOT NULL THEN 1 ELSE 0 END AS is_submitted,
        er.id AS result_id,
        er.score AS result_score
      FROM student_exam_assignments sea
      JOIN exams e ON sea.exam_id = e.id
      JOIN branches b ON sea.branch_id = b.id
      LEFT JOIN exam_results er
        ON e.id = er.exam_id
        AND er.student_id = ?
        AND er.submitted_at IS NOT NULL
      WHERE sea.student_id = ?
        AND sea.branch_id = ?
        AND er.id IS NULL  -- Only return unsubmitted exams
      ORDER BY e.exam_date_time ASC
    `;

    const [exams] = await connection.query(query, [studentUserId, studentUserId, branchId]);
    
    return {
      success: true,
      data: exams,
      count: exams.length
    };
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
}

async function getStudentCompletedExams(studentUserId, branchId) {
  const connection = await pool.getConnection();
  try {
    const query = `
      SELECT
        sea.id as assignment_id,
        e.id as exam_id,
        e.title,
        e.duration_minutes,
        e.exam_type,
        e.assessment_type,
        DATE_FORMAT(e.exam_date_time, '%Y-%m-%d %H:%i:%s') AS exam_date_time,
        b.school_name AS branch_name,
        er.id AS result_id,
        er.score,
        er.total_questions,
        er.answered_questions,
        er.submitted_at,
        (
          SELECT GROUP_CONCAT(DISTINCT cs.name SEPARATOR ', ')
          FROM questions q
          JOIN class_subjects cs ON q.class_subject_id = cs.id
          WHERE q.exam_id = e.id
        ) AS subjects
      FROM student_exam_assignments sea
      JOIN exams e ON sea.exam_id = e.id
      JOIN branches b ON sea.branch_id = b.id
      JOIN exam_results er
        ON e.id = er.exam_id
        AND er.student_id = ?
        AND er.submitted_at IS NOT NULL
      WHERE sea.student_id = ?
        AND sea.branch_id = ?
      ORDER BY er.submitted_at DESC
    `;

    const [exams] = await connection.query(query, [studentUserId, studentUserId, branchId]);
    
    return {
      success: true,
      data: exams,
      count: exams.length
    };
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
}

async function bulkAssignExamToClass(examId, classId, assignedByUserId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Validate exam exists and get branch_id
    const [exam] = await connection.query('SELECT id, branch_id FROM exams WHERE id = ?', [examId]);
    if (exam.length === 0) {
      throw new Error(`Exam with ID ${examId} not found`);
    }
    const branchId = exam[0].branch_id;

    // Validate class exists
    const [classExists] = await connection.query(
      'SELECT id FROM classes WHERE id = ?',
      [classId]
    );
    if (classExists.length === 0) {
      throw new Error(`Class with ID ${classId} not found`);
    }

    // Validate assigned_by user exists
    const [assigner] = await connection.query(
      'SELECT id FROM users WHERE id = ?',
      [assignedByUserId]
    );
    if (assigner.length === 0) {
      throw new Error(`User with ID ${assignedByUserId} not found`);
    }

    // Get all students in the class
    const [classStudents] = await connection.query(
      `SELECT s.user_id, s.id as student_id 
       FROM students s 
       WHERE s.class_id = ? AND s.status_id = 1`, // Only active students
      [classId]
    );

    if (classStudents.length === 0) {
      return { 
        success: false, 
        message: 'No active students found in this class',
        assigned: 0 
      };
    }

    let assigned = 0;
    let alreadyAssigned = 0;
    const assignedIds = [];

    for (const student of classStudents) {
      const [existing] = await connection.query(
        'SELECT id FROM student_exam_assignments WHERE student_id = ? AND exam_id = ?',
        [student.user_id, examId]
      );

      if (existing.length === 0) {
        const assignmentId = uuidv4();
        await connection.query(
          `INSERT INTO student_exam_assignments 
           (id, student_id, exam_id, branch_id, assigned_by) 
           VALUES (?, ?, ?, ?, ?)`,
          [assignmentId, student.user_id, examId, branchId, assignedByUserId]
        );
        assigned++;
        assignedIds.push(assignmentId);
      } else {
        alreadyAssigned++;
      }
    }

    await connection.commit();
    
    return { 
      success: true, 
      message: `Assigned ${assigned} students, ${alreadyAssigned} already had assignments`,
      data: {
        assigned,
        alreadyAssigned,
        totalStudents: classStudents.length,
        assignedIds
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Additional utility function to get all students assigned to an exam
async function getStudentsAssignedToExam(examId) {
  const connection = await pool.getConnection();
  try {
    const query = `
      SELECT 
        sea.id as assignment_id,
        u.id as user_id,
        u.email,
        s.first_name,
        s.last_name,
        s.class_id,
        c.name as class_name,
        sea.assigned_at,
        CASE WHEN er.id IS NOT NULL THEN 1 ELSE 0 END as has_submitted
      FROM student_exam_assignments sea
      JOIN users u ON sea.student_id = u.id
      JOIN students s ON u.id = s.user_id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN exam_results er 
        ON er.exam_id = sea.exam_id 
        AND er.student_id = u.id
        AND er.submitted_at IS NOT NULL
      WHERE sea.exam_id = ?
      ORDER BY s.last_name, s.first_name
    `;

    const [students] = await connection.query(query, [examId]);
    return {
      success: true,
      data: students,
      count: students.length
    };
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Bulk assign an exam to multiple students
 * Works with any combination of regular students and new/external students
 * Automatically determines branch from the assigner's staff record
 *
 * @param {string} examId - The exam ID to assign
 * @param {array} studentUserIds - Array of student user IDs (works for both types)
 * @param {string} assignedByUserId - The user ID of the person doing the assignment (teacher/admin)
 * @returns {object} Result with assignment counts (assigned, skipped)
 */
async function bulkAssignExamToStudents(examId, studentUserIds, assignedByUserId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get assigner's branch from staff table
    const [staff] = await connection.query(
      'SELECT branch_id FROM staff WHERE user_id = ?',
      [assignedByUserId]
    );

    if (staff.length === 0) {
      throw new Error(`User with ID ${assignedByUserId} is not assigned to any branch`);
    }

    const branchId = staff[0].branch_id;

    // Validate exam exists and belongs to assigner's branch
    const [exam] = await connection.query(
      'SELECT id FROM exams WHERE id = ? AND branch_id = ?',
      [examId, branchId]
    );

    if (exam.length === 0) {
      throw new Error(`Exam with ID ${examId} not found in your branch`);
    }

    let assigned = 0;
    let skipped = 0;

    for (const studentUserId of studentUserIds) {
      try {
        // Check if student user exists - works for BOTH regular students AND new/external students
        // since both have entries in the users table
        const [userExists] = await connection.query(
          'SELECT id FROM users WHERE id = ?',
          [studentUserId]
        );

        if (userExists.length === 0) {
          skipped++;
          continue;
        }

        // Check if assignment already exists
        const [existing] = await connection.query(
          'SELECT id FROM student_exam_assignments WHERE student_id = ? AND exam_id = ?',
          [studentUserId, examId]
        );

        if (existing.length === 0) {
          const assignmentId = uuidv4();
          await connection.query(
            `INSERT INTO student_exam_assignments
             (id, student_id, exam_id, branch_id, assigned_by)
             VALUES (?, ?, ?, ?, ?)`,
            [assignmentId, studentUserId, examId, branchId, assignedByUserId]
          );
          assigned++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`Error assigning exam to student ${studentUserId}:`, error.message);
        skipped++;
      }
    }

    await connection.commit();

    return {
      success: true,
      message: `Successfully assigned to ${assigned} students (${skipped} skipped)`,
      data: {
        assigned,
        skipped,
        total: studentUserIds.length
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  assignExamToStudent,
  removeExamAssignment,
  getStudentAssignedExams,
  getStudentCompletedExams,
  bulkAssignExamToClass,
  bulkAssignExamToStudents, // Works with any student type (new or old)
  getStudentsAssignedToExam,
};