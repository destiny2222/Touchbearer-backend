const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { pool } = require("../database");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const { v4: uuidv4 } = require("uuid");

// @route   POST /api/parents
// @desc    Create a new parent
// @access  Admin, SuperAdmin
router.post(
  "/",
  [auth, authorize(["Admin", "SuperAdmin"])],
  async (req, res) => {
    const {
      name,
      email,
      phone,
      dob,
      residential_address,
      occupation,
      workplace_address,
      password,
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and phone are required.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Check if user already exists
      const [existingUser] = await connection.query(
        "SELECT id FROM users WHERE email = ?",
        [email]
      );
      if (existingUser.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "A user with this email already exists.",
        });
      }

      // Create a new user
      const userId = uuidv4();
      const finalPassword = password || phone; // Use phone number as password
      const hashedPassword = await bcrypt.hash(finalPassword, 10);
      await connection.query(
        "INSERT INTO users (id, email, password) VALUES (?, ?, ?)",
        [userId, email, hashedPassword]
      );

      // Assign Parent role
      const [parentRole] = await connection.query(
        "SELECT id FROM roles WHERE name = ?",
        ["Parent"]
      );
      if (parentRole.length === 0) {
        await connection.rollback();
        return res
          .status(500)
          .json({ success: false, message: "Parent role not found." });
      }
      await connection.query(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
        [userId, parentRole[0].id]
      );

      // Create the parent profile
      const parentId = uuidv4();
      const newParent = {
        id: parentId,
        user_id: userId,
        name,
        phone,
        email,
        dob: dob || null,
        residential_address: residential_address || null,
        occupation: occupation || null,
        workplace_address: workplace_address || null,
      };
      await connection.query("INSERT INTO parents SET ?", newParent);

      await connection.commit();

      res.status(201).json({
        success: true,
        message: "Parent created successfully.",
        data: {
          ...newParent,
          temporaryPassword: password ? null : finalPassword,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Create parent error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while creating parent.",
      });
    } finally {
      connection.release();
    }
  }
);

async function isAuthorizedAdmin(adminUserId, parentId) {
  const [adminStaff] = await pool.query(
    "SELECT branch_id FROM staff WHERE user_id = ?",
    [adminUserId]
  );
  if (adminStaff.length === 0) {
    return false;
  }
  const adminBranchId = adminStaff[0].branch_id;

  const [children] = await pool.query(
    `
        SELECT p.id FROM parents p
        LEFT JOIN new_students ns ON p.id = ns.parent_id
        LEFT JOIN students s ON p.id = s.parent_id
        WHERE p.id = ? AND (ns.branch_id = ? OR s.branch_id = ?)
        GROUP BY p.id
    `,
    [parentId, adminBranchId, adminBranchId]
  );

  return children.length > 0;
}

function getOrdinal(n) {
  if (n === null || n === undefined || n === 0) return null;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

router.get(
  "/",
  [auth, authorize(["SuperAdmin", "Admin"])],
  async (req, res) => {
    try {
      let query = `
            SELECT DISTINCT p.id, p.name, p.email, p.phone, u.created_at
            FROM parents p
            JOIN users u ON p.user_id = u.id
        `;
      const queryParams = [];

      if (req.user.roles.includes("Admin")) {
        const [adminStaff] = await pool.query(
          "SELECT branch_id FROM staff WHERE user_id = ?",
          [req.user.id]
        );
        if (adminStaff.length === 0) {
          return res.status(403).json({
            success: false,
            message: "Admin not associated with a branch.",
          });
        }
        const adminBranchId = adminStaff[0].branch_id;

        query += `
                LEFT JOIN new_students ns ON p.id = ns.parent_id
                LEFT JOIN students s ON p.id = s.parent_id
                WHERE ns.branch_id = ? OR s.branch_id = ?
            `;
        queryParams.push(adminBranchId, adminBranchId);
      }

      query += " ORDER BY u.created_at DESC";

      const [parents] = await pool.query(query, queryParams);
      res.json({ success: true, data: parents });
    } catch (error) {
      console.error("Error fetching parents:", error);
      res.status(500).json({
        success: false,
        message: "Server error while fetching parents.",
      });
    }
  }
);

// ===================================================================
// MOVED THIS ENTIRE BLOCK UP
// This specific route now comes BEFORE the general '/:id' route.
// ===================================================================

// GET /api/parents/fees-summary - Get a detailed list of all fees for all of a parent's children
router.get("/fees-summary", [auth, authorize(["Parent"])], async (req, res) => {
  try {
    // 1. Get Parent ID
    const [parentRows] = await pool.query(
      "SELECT id, email FROM parents WHERE user_id = ?",
      [req.user.id]
    );
    if (parentRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Parent profile not found." });
    }
    const parentId = parentRows[0].id;
    const parentEmail = parentRows[0].email; // Get email for Paystack

    // 2. Get all children for the parent
    const [children] = await pool.query(
      'SELECT id, CONCAT(first_name, " ", last_name) as name, class_id, branch_id FROM students WHERE parent_id = ?',
      [parentId]
    );

    if (children.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 3. Process fees for each child
    let allFees = [];
    const today = new Date();

    for (const child of children) {
      // Find the active term for the child's branch
      const [activeTermRows] = await pool.query(
        "SELECT id, name as term_name, end_date FROM terms WHERE is_active = TRUE AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id DESC LIMIT 1",
        [child.branch_id]
      );

      if (activeTermRows.length === 0) continue;
      const activeTerm = activeTermRows[0];

      // Get total fees due and total amount paid for the term
      const [[{ total_due }]] = await pool.query(
        "SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?",
        [child.class_id, activeTerm.id]
      );

      const [[{ total_paid }]] = await pool.query(
        "SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?",
        [child.id, activeTerm.id]
      );

      const balance = (total_due || 0) - (total_paid || 0);

      // Determine overall status for the term
      let status =
        balance <= 0
          ? "Paid"
          : new Date(activeTerm.end_date) < today
          ? "Overdue"
          : "Pending";

      // Get individual fee items for the term
      const [feeItems] = await pool.query(
        "SELECT id, name, amount, description FROM fees WHERE class_id = ? AND term_id = ?",
        [child.class_id, activeTerm.id]
      );

      feeItems.forEach((fee) => {
        allFees.push({
          id: fee.id,
          payment: fee.name,
          cost: fee.amount,
          for: child.name,
          date: activeTerm.end_date,
          status: status,
          description: fee.description || "No description provided.",
          term: activeTerm.term_name,
          totalDueForTerm: total_due || 0,
          totalPaidForTerm: total_paid || 0,
          termBalance: balance,
          studentId: child.id,
          termId: activeTerm.id,
          parentId: parentId,
          parentEmail: parentEmail,
        });
      });
    }

    allFees.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json({ success: true, data: allFees });
  } catch (error) {
    console.error("Error fetching parent's fees summary:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching payment information.",
    });
  }
});

router.get(
  "/wards-summary",
  [auth, authorize(["Parent"])],
  async (req, res) => {
    try {
      // 1. Get the logged-in parent's ID
      const [parentRows] = await pool.query(
        "SELECT id FROM parents WHERE user_id = ?",
        [req.user.id]
      );
      if (parentRows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Parent profile not found." });
      }
      const parentId = parentRows[0].id;

      // 2. Get all children associated with the parent
      const [children] = await pool.query(
        `
            SELECT
                s.id,
                s.user_id,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                s.class_id,
                s.branch_id,
                c.name as className
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.parent_id = ?
        `,
        [parentId]
      );

      if (children.length === 0) {
        return res.json({ success: true, data: [] });
      }

      // --- Optimization: Bulk fetch data for all children ---

      const childIds = children.map((c) => c.id);
      const classIds = [...new Set(children.map((c) => c.class_id))];
      const userIds = children.map((c) => c.user_id);
      const branchIds = [...new Set(children.map((c) => c.branch_id))];

      // 3. Bulk fetch all necessary data in parallel
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const [
        [branchTerms],
        [globalTermRows],
        [missedWorkRows],
        [attendanceRows],
        [userRows],
      ] = await Promise.all([
        branchIds.length > 0
          ? pool.query(
              "SELECT id, branch_id FROM terms WHERE is_active = TRUE AND branch_id IN (?)",
              [branchIds]
            )
          : Promise.resolve([[]]),
        pool.query(
          "SELECT id FROM terms WHERE is_active = TRUE AND branch_id IS NULL"
        ),
        classIds.length > 0
          ? pool.query(
              "SELECT class_id, COUNT(*) as count FROM assignments WHERE class_id IN (?) AND due_date < NOW() GROUP BY class_id",
              [classIds]
            )
          : Promise.resolve([[]]),
        childIds.length > 0
          ? pool.query(
              "SELECT student_id, status FROM student_attendance WHERE student_id IN (?) AND date = ?",
              [childIds, yesterdayStr]
            )
          : Promise.resolve([[]]),
        userIds.length > 0
          ? pool.query("SELECT id, email FROM users WHERE id IN (?)", [userIds])
          : Promise.resolve([[]]),
      ]);

      // 4. Process fetched data into maps for efficient lookup
      const globalTermId =
        globalTermRows.length > 0 ? globalTermRows[0].id : null;
      const activeTermMap = new Map(
        branchTerms.map((term) => [term.branch_id, term.id])
      );
      const missedWorkMap = new Map(
        missedWorkRows.map((row) => [row.class_id, row.count])
      );
      const attendanceMap = new Map(
        attendanceRows.map((row) => [row.student_id, row.status])
      );
      const usersMap = new Map(userRows.map((user) => [user.id, user.email]));

      // Determine term IDs for the fee status query
      const termIdsForQuery = children
        .map((child) => activeTermMap.get(child.branch_id) || globalTermId)
        .filter((id) => id);

      // Fetch fee statuses based on the determined terms
      const [paymentStatusRows] =
        termIdsForQuery.length > 0
          ? await pool.query(
              "SELECT student_id, status FROM student_payment_statuses WHERE student_id IN (?) AND term_id IN (?) AND status = 'Paid'",
              [childIds, [...new Set(termIdsForQuery)]] // Use Set to get unique term IDs
            )
          : [[]];
      const feesMap = new Map(
        paymentStatusRows.map((p) => [p.student_id, p.status])
      );

      // 5. Map the bulk data back to each child
      const wardsData = children.map((child) => {
        const studentLoginId = usersMap.get(child.user_id) || "N/A";
        const fees = feesMap.get(child.id) || "Unpaid";
        const missedWork = missedWorkMap.get(child.class_id) || 0;
        const attendance = attendanceMap.get(child.id) || "N/A";

        return {
          name: child.name,
          id: studentLoginId.toUpperCase(),
          fees: fees,
          missedWork: missedWork > 0 ? missedWork : "-",
          className: child.className,
          attendance: attendance,
        };
      });

      res.json({ success: true, data: wardsData });
    } catch (error) {
      console.error("Error fetching parent's wards summary:", error);
      res.status(500).json({
        success: false,
        message: "Server error while fetching your children's data.",
      });
    }
  }
);

// @route   GET /api/parents/wards/results
// @desc    Get all published results for all of the parent's children for the current term
// @access  Parent
router.get(
  "/wards/results",
  [auth, authorize(["Parent"])],
  async (req, res) => {
    try {
      const [parent] = await pool.query(
        "SELECT id FROM parents WHERE user_id = ?",
        [req.user.id]
      );
      if (parent.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Parent not found." });
      }
      const parentId = parent[0].id;

      const [children] = await pool.query(
        `
            SELECT s.id, s.user_id, s.first_name, s.last_name, s.class_id, s.branch_id, c.name as class_name
            FROM students s
            JOIN classes c ON s.class_id = c.id
            WHERE s.parent_id = ?
        `,
        [parentId]
      );

      if (children.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const resultsData = await Promise.all(
        children.map(async (child) => {
          const [terms] = await pool.query(
            "SELECT id, start_date, end_date FROM terms WHERE branch_id = ? AND is_active = TRUE",
            [child.branch_id]
          );
          if (terms.length === 0) {
            const [globalTerms] = await pool.query(
              "SELECT id, start_date, end_date FROM terms WHERE branch_id IS NULL AND is_active = TRUE"
            );
            if (globalTerms.length === 0) {
              return {
                child_id: child.id,
                child_name: `${child.first_name} ${child.last_name}`,
                class_name: child.class_name,
                attendance: "N/A",
                exam_results: [],
              };
            }
            terms.push(globalTerms[0]);
          }
          const term = terms[0];
          const term_id = term.id;
          const term_start_date = term.start_date;
          const term_end_date =
            new Date() < new Date(term.end_date)
              ? new Date().toISOString().split("T")[0]
              : term.end_date;

          const [[{ present_days }]] = await pool.query(
            `SELECT COUNT(*) as present_days FROM student_attendance WHERE student_id = ? AND status IN ('Present', 'Late') AND date BETWEEN ? AND ?`,
            [child.id, term_start_date, term_end_date]
          );
          const [[{ total_days }]] = await pool.query(
            `SELECT COUNT(DISTINCT date) as total_days FROM student_attendance WHERE class_id = ? AND date BETWEEN ? AND ?`,
            [child.class_id, term_start_date, term_end_date]
          );

          const attendance =
            total_days > 0 ? `${present_days}/${total_days} Days` : "N/A";

          const [examResults] = await pool.query(
            `
                SELECT
                    er.id, er.score, er.total_questions, er.answered_questions, er.submitted_at,
                    e.id as exam_id, e.title as exam_title, e.exam_date_time,
                    s.first_name, s.last_name
                FROM exam_results er
                JOIN exams e ON er.exam_id = e.id
                JOIN students s ON er.student_id = s.user_id
                WHERE er.student_id = ? AND er.published = TRUE AND er.term_id = ?
                ORDER BY e.exam_date_time DESC
            `,
            [child.user_id, term_id]
          );

          const resultsWithPosition = await Promise.all(
            examResults.map(async (result) => {
              const [classScores] = await pool.query(
                `
                    SELECT er.score FROM exam_results er
                    JOIN students s ON er.student_id = s.user_id
                    WHERE er.exam_id = ? AND s.class_id = ? AND er.published = TRUE
                    ORDER BY er.score DESC
                `,
                [result.exam_id, child.class_id]
              );

              const scores = classScores.map((s) => parseFloat(s.score));
              const rank = scores.indexOf(parseFloat(result.score)) + 1;

              result.position = getOrdinal(rank);
              return result;
            })
          );

          return {
            child_id: child.id,
            child_name: `${child.first_name} ${child.last_name}`,
            class_name: child.class_name,
            attendance,
            exam_results: resultsWithPosition,
          };
        })
      );

      res.json({ success: true, data: resultsData });
    } catch (err) {
      console.error("Error fetching children exam results:", err);
      res.status(500).json({
        success: false,
        message: "Server error while fetching exam results.",
      });
    }
  }
);

router.get(
  "/:id",
  [auth, authorize(["SuperAdmin", "Admin"])],
  async (req, res) => {
    const { id } = req.params;
    try {
      const [parentResult] = await pool.query(
        "SELECT * FROM parents WHERE id = ?",
        [id]
      );
      if (parentResult.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Parent not found." });
      }
      const parent = parentResult[0];

      if (req.user.roles.includes("Admin")) {
        const isAuthorized = await isAuthorizedAdmin(req.user.id, id);
        if (!isAuthorized) {
          return res.status(403).json({
            success: false,
            message: "You are not authorized to view this parent.",
          });
        }
      }

      const [children] = await pool.query(
        `
            SELECT id, first_name, last_name, 'new' as status FROM new_students WHERE parent_id = ?
            UNION ALL
            SELECT id, first_name, last_name, 'enrolled' as status FROM students WHERE parent_id = ?
        `,
        [id, id]
      );

      parent.children = children;

      res.json({ success: true, data: parent });
    } catch (error) {
      console.error("Error fetching parent:", error);
      res.status(500).json({
        success: false,
        message: "Server error while fetching parent details.",
      });
    }
  }
);

router.put(
  "/:id",
  [auth, authorize(["SuperAdmin", "Admin"])],
  async (req, res) => {
    const { id } = req.params;
    const {
      name,
      phone,
      email,
      dob,
      residential_address,
      occupation,
      workplace_address,
    } = req.body;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [parentResult] = await connection.query(
        "SELECT * FROM parents WHERE id = ?",
        [id]
      );
      if (parentResult.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Parent not found." });
      }
      const parent = parentResult[0];

      if (req.user.roles.includes("Admin")) {
        const isAuthorized = await isAuthorizedAdmin(req.user.id, id);
        if (!isAuthorized) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "You are not authorized to update this parent.",
          });
        }
      }

      if (email && email !== parent.email) {
        const [emailCheck] = await connection.query(
          "SELECT id FROM users WHERE email = ? AND id != ?",
          [email, parent.user_id]
        );
        if (emailCheck.length > 0) {
          await connection.rollback();
          return res
            .status(400)
            .json({ success: false, message: "Email already in use." });
        }
        await connection.query("UPDATE users SET email = ? WHERE id = ?", [
          email,
          parent.user_id,
        ]);
      }

      const updateFields = {};
      if (name) updateFields.name = name;
      if (phone) updateFields.phone = phone;
      if (email) updateFields.email = email;
      if (dob !== undefined) updateFields.dob = dob;
      if (residential_address !== undefined)
        updateFields.residential_address = residential_address;
      if (occupation !== undefined) updateFields.occupation = occupation;
      if (workplace_address !== undefined)
        updateFields.workplace_address = workplace_address;

      if (Object.keys(updateFields).length > 0) {
        await connection.query("UPDATE parents SET ? WHERE id = ?", [
          updateFields,
          id,
        ]);
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Parent details updated successfully.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Error updating parent:", error);
      res.status(500).json({
        success: false,
        message: "Server error while updating parent details.",
      });
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/:id/reset-password",
  [auth, authorize(["SuperAdmin", "Admin"])],
  async (req, res) => {
    const { id } = req.params;

    try {
      const [parentResult] = await pool.query(
        "SELECT user_id, email, name, phone FROM parents WHERE id = ?",
        [id]
      );
      if (parentResult.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Parent not found." });
      }
      const parent = parentResult[0];

      if (req.user.roles.includes("Admin")) {
        const isAuthorized = await isAuthorizedAdmin(req.user.id, id);
        if (!isAuthorized) {
          return res.status(403).json({
            success: false,
            message: "You are not authorized to reset this parent's password.",
          });
        }
      }

      const newPassword = parent.phone; // Use phone number as password
      if (!newPassword) {
        return res.status(400).json({
          success: false,
          message: "Parent phone number not found, cannot reset password.",
        });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await pool.query("UPDATE users SET password = ? WHERE id = ?", [
        hashedPassword,
        parent.user_id,
      ]);

      res.json({
        success: true,
        message: "Parent password reset successfully.",
        data: {
          parent_id: id,
          email: parent.email,
          name: parent.name,
          temporaryPassword: newPassword,
        },
      });
    } catch (error) {
      console.error("Error resetting parent password:", error);
      res.status(500).json({
        success: false,
        message: "Server error while resetting password.",
      });
    }
  }
);

router.delete("/:id", [auth, authorize(["SuperAdmin"])], async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [parentResult] = await connection.query(
      "SELECT user_id FROM parents WHERE id = ?",
      [id]
    );
    if (parentResult.length === 0) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Parent not found." });
    }
    const parent = parentResult[0];

    const [childrenCheck] = await connection.query(
      "SELECT (SELECT COUNT(*) FROM new_students WHERE parent_id = ?) + (SELECT COUNT(*) FROM students WHERE parent_id = ?) as total_children",
      [id, id]
    );

    if (childrenCheck[0].total_children > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete a parent who has children associated with their account.",
      });
    }

    await connection.query("DELETE FROM parents WHERE id = ?", [id]);
    await connection.query("DELETE FROM user_roles WHERE user_id = ?", [
      parent.user_id,
    ]);
    await connection.query("DELETE FROM users WHERE id = ?", [parent.user_id]);

    await connection.commit();

    res.json({ success: true, message: "Parent deleted successfully." });
  } catch (error) {
    await connection.rollback();
    console.error("Error deleting parent:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error while deleting parent." });
  } finally {
    connection.release();
  }
});

module.exports = router;
