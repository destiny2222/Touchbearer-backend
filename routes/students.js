const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../database");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");

async function getAdminBranchId(userId) {
  const [rows] = await pool.query(
    "SELECT branch_id FROM staff WHERE user_id = ?",
    [userId]
  );
  return rows.length > 0 ? rows[0].branch_id : null;
}

async function getTeacherClasses(userId) {
  // Get teacher's staff record
  const [staffRows] = await pool.query(
    "SELECT id, class_id, branch_id FROM staff WHERE user_id = ?",
    [userId]
  );
  if (staffRows.length === 0) return { classIds: [], branchId: null };

  const staff = staffRows[0];
  const classIds = [];

  // Add class from staff.class_id if exists
  if (staff.class_id) {
    classIds.push(staff.class_id);
  }

  // Also get all classes where this teacher is assigned as teacher_id
  const [classRows] = await pool.query(
    "SELECT id FROM classes WHERE teacher_id = ?",
    [staff.id]
  );
  classRows.forEach((row) => {
    if (!classIds.includes(row.id)) {
      classIds.push(row.id);
    }
  });

  return { classIds, branchId: staff.branch_id };
}

async function isSubjectTeacher4Class(teacherId, classId) {
  const [rows] = await pool.query(
    "SELECT * FROM class_subjects WHERE teacher_id = ? AND class_id = ?",
    [teacherId, classId]
  );
  return rows.length > 0;
}

async function generateStudentId(branch_id) {
  const [branch] = await pool.query(
    "SELECT site_name FROM branches WHERE id = ?",
    [branch_id]
  );
  if (branch.length === 0 || !branch[0].site_name) {
    throw new Error("Branch site name not found for student ID generation.");
  }
  const prefix = "T" + branch[0].site_name;
  const chars = "0123456789";
  let isUnique = false;
  let studentId = "";
  while (!isUnique) {
    let randomPart = "";
    for (let i = 0; i < 5; i++)
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    studentId = prefix + randomPart;
    const [existingUser] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [studentId]
    );
    if (existingUser.length === 0) isUnique = true;
  }
  return studentId;
}

// POST /api/students/create - Create a student and associate to an existing parent (by email) or fail
router.post(
  "/create",
  [auth, authorize(["Admin", "SuperAdmin", "Teacher"])],
  async (req, res) => {
    const {
      first_name,
      last_name,
      dob,
      passport,
      address,
      nationality,
      state,
      class_id,
      branch_id,
      religion,
      disability,
      parent_email,
      parent_phone,
      parent_name,
      password,
      surname_name,
      other_names,
      gender,
      place_of_birth,
      lga,
      tribe,
      blood_group,
      genotype,
      allergies,
      previous_class,
      last_term_result,
      birth_certificate,
      medical_report,
    } = req.body;
    // Map optional surname/other_names from frontend to required first_name/last_name
    const normalizedFirstName = first_name || other_names;
    const normalizedLastName = last_name || surname_name;

    if (
      !normalizedFirstName ||
      !normalizedLastName ||
      !dob ||
      !class_id ||
      !branch_id ||
      (!parent_email && !parent_phone)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields, including parent_email or parent_phone.",
      });
    }

    try {
      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== branch_id) {
          return res.status(403).json({
            success: false,
            message: "Admins can only create students for their own branch.",
          });
        }
      }

      if (
        req.user.roles.includes("Teacher") &&
        !req.user.roles.includes("Admin") &&
        !req.user.roles.includes("SuperAdmin")
      ) {
        const { classIds, branchId } = await getTeacherClasses(req.user.id);

        if (classIds.length === 0) {
          return res.status(403).json({
            success: false,
            message: "Teacher has no assigned classes.",
          });
        }

        if (!classIds.includes(class_id)) {
          return res.status(403).json({
            success: false,
            message:
              "Teachers can only create students for their assigned classes.",
          });
        }

        if (branchId && branchId !== branch_id) {
          return res.status(403).json({
            success: false,
            message: "Teachers can only create students for their own branch.",
          });
        }
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Find parent by email or phone
        let parent;
        if (parent_email) {
          const [emailParents] = await connection.query(
            "SELECT * FROM parents WHERE email = ?",
            [parent_email]
          );
          if (emailParents.length > 0) {
            parent = emailParents[0];
          }
        }
        if (!parent && parent_phone) {
          const [phoneParents] = await connection.query(
            "SELECT * FROM parents WHERE phone = ?",
            [parent_phone]
          );
          if (phoneParents.length > 0) {
            parent = phoneParents[0];
          }
        }

        if (!parent) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message:
              "Parent not found by email or phone. Please create the parent first or enroll via public flow.",
          });
        }
        const parent_id = parent.id;

        // Optionally update parent phone/name/email if provided
        const updateParentFields = {};
        if (parent_phone && parent.phone !== parent_phone)
          updateParentFields.phone = parent_phone;
        if (parent_name && parent.name !== parent_name)
          updateParentFields.name = parent_name;

        if (parent_email && parent.email !== parent_email) {
          const [emailCheck] = await connection.query(
            "SELECT id FROM users WHERE email = ? AND id != ?",
            [parent_email, parent.user_id]
          );
          if (emailCheck.length > 0) {
            await connection.rollback();
            return res.status(400).json({
              success: false,
              message:
                "The provided parent email is already in use by another user.",
            });
          }
          await connection.query("UPDATE users SET email = ? WHERE id = ?", [
            parent_email,
            parent.user_id,
          ]);
          updateParentFields.email = parent_email;
        }

        if (Object.keys(updateParentFields).length > 0) {
          await connection.query("UPDATE parents SET ? WHERE id = ?", [
            updateParentFields,
            parent_id,
          ]);
        }

        // Create student user
        const studentId = await generateStudentId(branch_id);
        const tempPassword = password || parent.phone; // Use parent's phone number as password
        const hashed = await bcrypt.hash(tempPassword, 10);
        const studentUserId = uuidv4();
        await connection.query(
          "INSERT INTO users (id, email, password) VALUES (?, ?, ?)",
          [studentUserId, studentId, hashed]
        );

        const [studentRole] = await connection.query(
          "SELECT id FROM roles WHERE name = 'Student'"
        );
        if (studentRole.length === 0) {
          await connection.rollback();
          return res
            .status(500)
            .json({ success: false, message: "Student role not found." });
        }
        await connection.query(
          "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
          [studentUserId, studentRole[0].id]
        );

        // Insert into students table
        const studentData = {
          id: uuidv4(),
          user_id: studentUserId,
          parent_id,
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          surname_name: surname_name || null,
          other_names: other_names || null,
          gender: gender || null,
          dob,
          place_of_birth: place_of_birth || null,
          passport: passport || null,
          address,
          nationality,
          state,
          lga: lga || null,
          tribe: tribe || null,
          class_id,
          branch_id,
          religion,
          disability: disability || null,
          blood_group: blood_group || null,
          genotype: genotype || null,
          allergies: allergies || null,
          previous_class: previous_class || null,
          last_term_result: last_term_result || null,
          birth_certificate: birth_certificate || null,
          medical_report: medical_report || null,
        };
        await connection.query("INSERT INTO students SET ?", studentData);

        // Add student to payment status table for the active term
        const [activeTerm] = await connection.query(
          "SELECT id FROM terms WHERE is_active = TRUE AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id DESC LIMIT 1",
          [branch_id]
        );
        if (activeTerm.length > 0) {
          const term_id = activeTerm[0].id;
          await connection.query(
            "INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES (?, ?, ?)",
            [studentData.id, term_id, "Not Paid"]
          );
        }

        await connection.commit();
        return res.status(201).json({
          success: true,
          message: "Student created successfully.",
          data: {
            student_login_id: studentId,
            temporary_password: password ? null : tempPassword,
            student: {
              id: studentData.id,
              first_name: normalizedFirstName,
              last_name: normalizedLastName,
              class_id,
              branch_id,
            },
          },
        });
      } catch (e) {
        await pool.query("ROLLBACK");
        console.error("Create student error:", e);
        return res.status(500).json({
          success: false,
          message: "Server error while creating student.",
        });
      } finally {
        await pool.query("COMMIT");
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);

// PATCH /api/students/:id/associate-parent - associate existing student with parent by email or phone (and update contact)
router.patch(
  "/:id/associate-parent",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { id } = req.params;
    const { parent_email, parent_phone } = req.body;

    if (!parent_email && !parent_phone) {
      return res.status(400).json({
        success: false,
        message: "Provide parent_email or parent_phone.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Fetch student and enforce branch scope
      const [studentRows] = await connection.query(
        "SELECT id, branch_id, parent_id FROM students WHERE id = ?",
        [id]
      );
      if (studentRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Student not found." });
      }
      const student = studentRows[0];
      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== student.branch_id) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You are not authorized to modify this student.",
          });
        }
      }

      // Find parent
      let parent;
      if (parent_email) {
        const [emailParents] = await connection.query(
          "SELECT * FROM parents WHERE email = ?",
          [parent_email]
        );
        if (emailParents.length > 0) {
          parent = emailParents[0];
        }
      }
      if (!parent && parent_phone) {
        const [phoneParents] = await connection.query(
          "SELECT * FROM parents WHERE phone = ?",
          [parent_phone]
        );
        if (phoneParents.length > 0) {
          parent = phoneParents[0];
        }
      }

      if (!parent) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Parent not found by provided contact.",
        });
      }

      // Update parent contacts if provided
      const updateFields = {};
      if (parent_phone && parent.phone !== parent_phone)
        updateFields.phone = parent_phone;
      if (parent_email && parent.email !== parent_email) {
        // Ensure email unique and update both users and parents
        const [emailCheck] = await connection.query(
          "SELECT id FROM users WHERE email = ? AND id != ?",
          [parent_email, parent.user_id]
        );
        if (emailCheck.length > 0) {
          await connection.rollback();
          return res
            .status(400)
            .json({ success: false, message: "Parent email already in use." });
        }
        await connection.query("UPDATE users SET email = ? WHERE id = ?", [
          parent_email,
          parent.user_id,
        ]);
        updateFields.email = parent_email;
      }
      if (Object.keys(updateFields).length > 0) {
        await connection.query("UPDATE parents SET ? WHERE id = ?", [
          updateFields,
          parent.id,
        ]);
      }

      // Associate
      await connection.query("UPDATE students SET parent_id = ? WHERE id = ?", [
        parent.id,
        id,
      ]);

      await connection.commit();
      return res.json({
        success: true,
        message: "Parent associated successfully.",
      });
    } catch (err) {
      await connection.rollback();
      console.error("Associate parent error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while associating parent.",
      });
    } finally {
      connection.release();
    }
  }
);

// PUT /api/students/:id - Update a student's profile
router.put(
  "/:id",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      dob,
      passport,
      address,
      nationality,
      state,
      class_id,
      branch_id,
      religion,
      disability,
      surname_name,
      other_names,
    } = req.body;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [studentRows] = await connection.query(
        "SELECT * FROM students WHERE id = ?",
        [id]
      );
      if (studentRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Student not found." });
      }
      const student = studentRows[0];

      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== student.branch_id) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You are not authorized to update this student.",
          });
        }
        if (branch_id && branch_id !== adminBranchId) {
          return res.status(403).json({
            success: false,
            message: "Admins cannot change a student's branch.",
          });
        }
      }

      // Normalize incoming name fields from frontend
      const normalizedFirstName = first_name || other_names;
      const normalizedLastName = last_name || surname_name;

      const updateFields = {};
      if (normalizedFirstName) updateFields.first_name = normalizedFirstName;
      if (normalizedLastName) updateFields.last_name = normalizedLastName;
      if (dob) updateFields.dob = dob;
      if (passport) updateFields.passport = passport;
      if (address) updateFields.address = address;
      if (nationality) updateFields.nationality = nationality;
      if (state) updateFields.state = state;
      if (class_id) updateFields.class_id = class_id;
      if (branch_id) updateFields.branch_id = branch_id;
      if (religion) updateFields.religion = religion;
      if (disability) updateFields.disability = disability;

      if (Object.keys(updateFields).length > 0) {
        await connection.query("UPDATE students SET ? WHERE id = ?", [
          updateFields,
          id,
        ]);
      }

      await connection.commit();
      res.json({
        success: true,
        message: "Student profile updated successfully.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Update student error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while updating student profile.",
      });
    } finally {
      connection.release();
    }
  }
);

// DELETE /api/students/:id - Delete a student's profile
router.delete(
  "/:id",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [studentRows] = await connection.query(
        "SELECT * FROM students WHERE id = ?",
        [id]
      );
      if (studentRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Student not found." });
      }
      const student = studentRows[0];

      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== student.branch_id) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You are not authorized to delete this student.",
          });
        }
      }

      await connection.query("DELETE FROM students WHERE id = ?", [id]);
      await connection.query("DELETE FROM user_roles WHERE user_id = ?", [
        student.user_id,
      ]);
      await connection.query("DELETE FROM users WHERE id = ?", [
        student.user_id,
      ]);

      await connection.commit();
      res.json({
        success: true,
        message: "Student profile deleted successfully.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Delete student error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while deleting student.",
      });
    } finally {
      connection.release();
    }
  }
);

// GET /api/students - list students
router.get(
  "/",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    try {
      let query = `
            SELECT s.id, u.email as student_id, s.first_name, s.last_name, s.dob, s.address, s.nationality, s.state, s.religion, s.disability, s.passport, c.name AS class_name, b.school_name AS branch,
                   p.name AS parent_name, p.email AS parent_email, p.phone AS parent_phone,
                   s.previous_class, s.last_term_result, s.birth_certificate, s.medical_report
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN parents p ON s.parent_id = p.id
            LEFT JOIN student_statuses ss ON s.status_id = ss.id
            WHERE (ss.name IS NULL OR ss.name = 'Active')
        `;
      const params = [];
      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId) return res.json({ success: true, data: [] });
        query += " AND s.branch_id = ?";
        params.push(adminBranchId);
      }
      query += " ORDER BY s.first_name ASC, s.last_name ASC";
      const [rows] = await pool.query(query, params);
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error("List students error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching students.",
      });
    }
  }
);

// GET /api/students/new - list new students (duplicate of enrollment listing for convenience)
router.get(
  "/new/all",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    try {
      let query = `
            SELECT 
                ns.id, ns.student_id, ns.first_name, ns.last_name, ns.dob, ns.address, ns.nationality, ns.state, ns.religion, ns.disability, ns.passport, c.name as class_applying,
                ns.payment_status, b.school_name as branch_name, p.name as parent_name, p.phone as parent_phone
            FROM new_students ns
            JOIN branches b ON ns.branch_id = b.id
            JOIN parents p ON ns.parent_id = p.id
            JOIN classes c ON ns.class_id = c.id
        `;
      const params = [];
      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId) return res.json({ success: true, data: [] });
        query += " WHERE ns.branch_id = ?";
        params.push(adminBranchId);
      }
      query += " ORDER BY ns.created_at DESC";
      const [rows] = await pool.query(query, params);
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error("List new students error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching new students.",
      });
    }
  }
);

// POST /api/students/migrate/:newStudentId - migrate new_student to student
router.post(
  "/migrate/:newStudentId",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { newStudentId } = req.params;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [nsRows] = await connection.query(
        "SELECT * FROM new_students WHERE id = ?",
        [newStudentId]
      );
      if (nsRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "New student not found." });
      }
      const ns = nsRows[0];

      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== ns.branch_id) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You are not authorized to migrate this student.",
          });
        }
      }

      // Fetch the user's account by student_id (stored as users.email)
      const [userRows] = await connection.query(
        "SELECT id FROM users WHERE email = ?",
        [ns.student_id]
      );
      if (userRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Student user account not found." });
      }
      const userId = userRows[0].id;

      // Update role from NewStudent to Student
      const [studentRole] = await connection.query(
        "SELECT id FROM roles WHERE name = 'Student'"
      );
      const [newStudentRole] = await connection.query(
        "SELECT id FROM roles WHERE name = 'NewStudent'"
      );
      if (studentRole.length === 0 || newStudentRole.length === 0) {
        await connection.rollback();
        return res
          .status(500)
          .json({ success: false, message: "Required roles not found." });
      }
      await connection.query(
        "DELETE FROM user_roles WHERE user_id = ? AND role_id = ?",
        [userId, newStudentRole[0].id]
      );
      await connection.query(
        "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
        [userId, studentRole[0].id]
      );

      // Create student row
      const studentData = {
        id: uuidv4(),
        user_id: userId,
        parent_id: ns.parent_id,
        first_name: ns.first_name,
        last_name: ns.last_name,
        dob: ns.dob,
        passport: ns.passport,
        address: ns.address,
        nationality: ns.nationality,
        state: ns.state,
        class_id: ns.class_id,
        branch_id: ns.branch_id,
        religion: ns.religion,
        disability: ns.disability,
        previous_school: ns.previous_school,
        previous_class: ns.previous_class,
        last_term_result: ns.last_term_result,
        birth_certificate: ns.birth_certificate,
        medical_report: ns.medical_report,
      };
      await connection.query("INSERT INTO students SET ?", studentData);

      // Remove from new_students
      await connection.query("DELETE FROM new_students WHERE id = ?", [
        newStudentId,
      ]);

      await connection.commit();
      return res.json({
        success: true,
        message: "Student migrated successfully.",
        data: { id: studentData.id },
      });
    } catch (err) {
      await connection.rollback();
      console.error("Migrate student error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while migrating student.",
      });
    } finally {
      connection.release();
    }
  }
);

// GET /api/students/class/:class_id - Get all students for a specific class by class_id
router.get(
  "/class/:class_id",
  [auth, authorize(["Teacher", "Admin", "SuperAdmin"])],
  async (req, res) => {
    const { class_id } = req.params;

    try {
      // Verify class exists
      const [classInfo] = await pool.query(
        "SELECT id, branch_id, name FROM classes WHERE id = ?",
        [class_id]
      );
      if (classInfo.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Class not found." });
      }
      const classData = classInfo[0];

      // Authorization checks
      if (
        req.user.roles.includes("Teacher") &&
        !req.user.roles.includes("Admin") &&
        !req.user.roles.includes("SuperAdmin")
      ) {
        const [staff] = await pool.query(
          "SELECT id FROM staff WHERE user_id = ?",
          [req.user.id]
        );
        if (staff.length === 0) {
          return res.status(403).json({
            success: false,
            message: "Authenticated user is not a staff member.",
          });
        }
        const teacherId = staff[0].id;
        const SubjectTeacher4Class = await isSubjectTeacher4Class(teacherId, class_id);

        if (!SubjectTeacher4Class) {
          return res.status(403).json({
            success: false,
            message:
              "You are not authorized to view students for this class. You can only view students from classes you teach.",
          });
        }
      }

      if (
        req.user.roles.includes("Admin") &&
        !req.user.roles.includes("SuperAdmin")
      ) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== classData.branch_id) {
          return res.status(403).json({
            success: false,
            message: "You can only view students from classes in your branch.",
          });
        }
      }

      // Fetch students in that class
      const query = `
            SELECT 
                s.id, s.user_id, s.first_name, s.last_name, s.surname_name, s.other_names,
                s.gender, s.dob, s.address, s.nationality, s.state, s.religion, 
                s.disability, s.passport, s.blood_group, s.genotype, s.allergies,
                s.previous_class, s.last_term_result, s.birth_certificate, s.medical_report,
                p.name AS parent_name, p.email AS parent_email, p.phone AS parent_phone,
                c.name AS class_name, b.school_name AS branch_name
            FROM students s
            LEFT JOIN parents p ON s.parent_id = p.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN branches b ON s.branch_id = b.id
            LEFT JOIN student_statuses ss ON s.status_id = ss.id
            WHERE s.class_id = ? AND (ss.name IS NULL OR ss.name = 'Active')
            ORDER BY s.last_name ASC, s.first_name ASC
        `;

      const [students] = await pool.query(query, [class_id]);

      res.json({
        success: true,
        count: students.length,
        class_info: {
          id: classData.id,
          name: classData.name,
          branch_id: classData.branch_id,
        },
        data: students,
      });
    } catch (error) {
      console.error("Error fetching students by class:", error);
      res.status(500).json({
        success: false,
        message: "Server error while fetching students.",
      });
    }
  }
);

// GET /api/students/class - Get all students in the authenticated teacher's class
// this endpoint allow you to fetch student by class, can only use with teacher role
router.get("/class", [auth, authorize(["Teacher"])], async (req, res) => {
  try {
    // Find the teacher's class
    const [staff] = await pool.query("SELECT id FROM staff WHERE user_id = ?", [
      req.user.id,
    ]);
    if (staff.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Authenticated user is not a staff member.",
      });
    }
    const teacherId = staff[0].id;

    const [teacherClass] = await pool.query(
      "SELECT id FROM classes WHERE teacher_id = ?",
      [teacherId]
    );
    if (teacherClass.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Teacher is not assigned to any class.",
      });
    }
    const classId = teacherClass[0].id;

    // Fetch students in that class
    const query = `
            SELECT s.id, s.first_name, s.last_name, s.dob, s.address, s.nationality, s.state, s.religion, s.disability, s.passport,
                   p.name AS parent_name, p.email AS parent_email, p.phone AS parent_phone,
                   s.previous_class, s.last_term_result, s.birth_certificate, s.medical_report
            FROM students s
            JOIN parents p ON s.parent_id = p.id
            LEFT JOIN student_statuses ss ON s.status_id = ss.id
            WHERE s.class_id = ? AND (ss.name IS NULL OR ss.name = 'Active')
            ORDER BY s.last_name ASC, s.first_name ASC
        `;

    const [students] = await pool.query(query, [classId]);
    res.json({ success: true, data: students });
  } catch (error) {
    console.error("Error fetching students by class:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching students.",
    });
  }
});

// POST /api/students/:id/reset-password - Reset a student's password
router.post(
  "/:id/reset-password",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [studentRows] = await connection.query(
        "SELECT s.*, p.phone as parent_phone FROM students s JOIN parents p ON s.parent_id = p.id WHERE s.id = ?",
        [id]
      );
      if (studentRows.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Student not found." });
      }
      const student = studentRows[0];

      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (!adminBranchId || adminBranchId !== student.branch_id) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You are not authorized to reset this student's password.",
          });
        }
      }

      const newPassword = student.parent_phone; // Use parent's phone number as password
      if (!newPassword) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Parent phone number not found, cannot reset password.",
        });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await connection.query("UPDATE users SET password = ? WHERE id = ?", [
        hashedPassword,
        student.user_id,
      ]);

      await connection.commit();

      res.json({
        success: true,
        message: "Student password has been reset successfully.",
        data: {
          student_id: student.id,
          temporary_password: newPassword,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Reset student password error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while resetting password.",
      });
    } finally {
      connection.release();
    }
  }
);

router.get(
  "/search",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] }); // Don't search for very short strings
    }

    try {
      let query = `
            SELECT id, CONCAT(first_name, ' ', last_name) as name, class_id 
            FROM students 
            WHERE first_name LIKE ? OR last_name LIKE ?
        `;
      const params = [`%${q}%`, `%${q}%`];

      if (req.user.roles.includes("Admin")) {
        const adminBranchId = await getAdminBranchId(req.user.id);
        if (adminBranchId) {
          query += " AND branch_id = ?";
          params.push(adminBranchId);
        }
      }

      query += " LIMIT 10"; // Limit results for performance

      const [students] = await pool.query(query, params);
      res.json({ success: true, data: students });
    } catch (err) {
      console.error("Search students error:", err);
      res.status(500).json({
        success: false,
        message: "Server error while searching students.",
      });
    }
  }
);

// @route   GET /api/students/me
// @desc    Get current student's profile
// @access  Student, NewStudent
router.get(
  "/me",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    try {
      let studentProfile = null;

      // First, check the main 'students' table
      const [studentRows] = await pool.query(
        `
            SELECT 
                s.id, s.user_id, s.first_name, s.last_name, s.class_id, c.name as class_name
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.user_id = ?
        `,
        [req.user.id]
      );

      if (studentRows.length > 0) {
        studentProfile = studentRows[0];
      } else {
        // If not found, check the 'new_students' table
        const [newUserRows] = await pool.query(
          `
                SELECT 
                    ns.id, u.id as user_id, ns.first_name, ns.last_name, ns.class_id, c.name as class_name
                FROM new_students ns
                JOIN users u ON ns.student_id = u.email
                LEFT JOIN classes c ON ns.class_id = c.id
                WHERE u.id = ?
            `,
          [req.user.id]
        );

        if (newUserRows.length > 0) {
          studentProfile = newUserRows[0];
        }
      }

      if (!studentProfile) {
        return res
          .status(404)
          .json({ success: false, message: "Student profile not found." });
      }

      res.json({ success: true, data: studentProfile });
    } catch (err) {
      console.error("Error fetching student profile:", err);
      res.status(500).json({
        success: false,
        message: "Server error while fetching profile.",
      });
    }
  }
);

// @route   GET /api/students/me/stats
// @desc    Get performance statistics for the currently logged-in student
// @access  Student, NewStudent
router.get(
  "/me/stats",
  [auth, authorize(["Student", "NewStudent"])],
  async (req, res) => {
    try {
      const [student] = await pool.query(
        "SELECT id, class_id, branch_id FROM students WHERE user_id = ?",
        [req.user.id]
      );

      if (student.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Student profile not found." });
      }
      const { id: studentId, class_id, branch_id } = student[0];

      // Find the active term for the student's branch
      const [terms] = await pool.query(
        "SELECT id, start_date, end_date FROM terms WHERE (branch_id = ? OR branch_id IS NULL) AND is_active = TRUE ORDER BY branch_id DESC LIMIT 1",
        [branch_id]
      );

      if (terms.length === 0) {
        return res.json({
          success: true,
          data: { attendance: "N/A", punctuality: "N/A" },
        });
      }
      const term = terms[0];

      // Ensure we don't calculate for future dates
      const today = new Date();
      const termEndDate = new Date(term.end_date);
      const effectiveEndDate =
        today < termEndDate ? today.toISOString().split("T")[0] : term.end_date;

      // Calculate attendance stats
      const [[{ present_days }]] = await pool.query(
        `SELECT COUNT(*) as present_days FROM student_attendance WHERE student_id = ? AND status = 'Present' AND date BETWEEN ? AND ?`,
        [studentId, term.start_date, effectiveEndDate]
      );
      const [[{ late_days }]] = await pool.query(
        `SELECT COUNT(*) as late_days FROM student_attendance WHERE student_id = ? AND status = 'Late' AND date BETWEEN ? AND ?`,
        [studentId, term.start_date, effectiveEndDate]
      );
      const [[{ total_school_days }]] = await pool.query(
        `SELECT COUNT(DISTINCT date) as total_days FROM student_attendance WHERE class_id = ? AND date BETWEEN ? AND ?`,
        [class_id, term.start_date, effectiveEndDate]
      );

      const attended_days = present_days + late_days;
      const attendance =
        total_school_days > 0
          ? `${attended_days}/${total_school_days} Days`
          : "N/A";

      // Calculate punctuality
      const punctuality =
        attended_days > 0
          ? `${Math.round((present_days / attended_days) * 100)}%`
          : "N/A";

      res.json({ success: true, data: { attendance, punctuality } });
    } catch (error) {
      console.error("Error fetching student stats:", error);
      res.status(500).json({
        success: false,
        message: "Server error while fetching stats.",
      });
    }
  }
);

module.exports = router;
