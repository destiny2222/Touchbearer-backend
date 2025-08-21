const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

async function generateStudentId() {
    const prefix = 'ttb';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let isUnique = false;
    let studentId = '';
    while (!isUnique) {
        let randomPart = '';
        for (let i = 0; i < 4; i++) randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
        studentId = prefix + randomPart;
        const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [studentId]);
        if (existingUser.length === 0) isUnique = true;
    }
    return studentId;
}

function generatePassword() {
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
    let password = '';
    for (let i = 0; i < length; i++) password += charset.charAt(Math.floor(Math.random() * charset.length));
    return password;
}

// POST /api/students/create - Create a student and associate to an existing parent (by email) or fail
router.post('/create', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const {
        first_name, last_name, dob, passport, address, nationality, state,
        class_id, branch_id, religion, disability,
        parent_email, parent_phone, parent_name
    } = req.body;

    if (!first_name || !last_name || !dob || !class_id || !branch_id || (!parent_email && !parent_phone)) {
        return res.status(400).json({ success: false, message: 'Missing required fields, including parent_email or parent_phone.' });
    }

    try {
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only create students for their own branch.' });
            }
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Find parent by email or phone
            let parent;
            if (parent_email) {
                const [emailParents] = await connection.query('SELECT * FROM parents WHERE email = ?', [parent_email]);
                if (emailParents.length > 0) {
                    parent = emailParents[0];
                }
            }
            if (!parent && parent_phone) {
                const [phoneParents] = await connection.query('SELECT * FROM parents WHERE phone = ?', [parent_phone]);
                if (phoneParents.length > 0) {
                    parent = phoneParents[0];
                }
            }

            if (!parent) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Parent not found by email or phone. Please create the parent first or enroll via public flow.' });
            }
            const parent_id = parent.id;

            // Optionally update parent phone/name/email if provided
            const updateParentFields = {};
            if (parent_phone && parent.phone !== parent_phone) updateParentFields.phone = parent_phone;
            if (parent_name && parent.name !== parent_name) updateParentFields.name = parent_name;

            if (parent_email && parent.email !== parent_email) {
                const [emailCheck] = await connection.query('SELECT id FROM users WHERE email = ? AND id != ?', [parent_email, parent.user_id]);
                if (emailCheck.length > 0) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'The provided parent email is already in use by another user.' });
                }
                await connection.query('UPDATE users SET email = ? WHERE id = ?', [parent_email, parent.user_id]);
                updateParentFields.email = parent_email;
            }

            if (Object.keys(updateParentFields).length > 0) {
                await connection.query('UPDATE parents SET ? WHERE id = ?', [updateParentFields, parent_id]);
            }

            // Create student user
            const studentId = await generateStudentId();
            const tempPassword = generatePassword();
            const hashed = await bcrypt.hash(tempPassword, 10);
            const studentUserId = uuidv4();
            await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [studentUserId, studentId, hashed]);

            const [studentRole] = await connection.query("SELECT id FROM roles WHERE name = 'Student'");
            if (studentRole.length === 0) {
                await connection.rollback();
                return res.status(500).json({ success: false, message: 'Student role not found.' });
            }
            await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [studentUserId, studentRole[0].id]);

            // Insert into students table
            const studentData = {
                id: uuidv4(),
                user_id: studentUserId,
                parent_id,
                first_name,
                last_name,
                dob,
                passport: passport || null,
                address,
                nationality,
                state,
                class_id,
                branch_id,
                religion,
                disability: disability || null
            };
            await connection.query('INSERT INTO students SET ?', studentData);

            // Add student to payment status table for the active term
            const [activeTerm] = await connection.query('SELECT id FROM terms WHERE is_active = TRUE AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id DESC LIMIT 1', [branch_id]);
            if (activeTerm.length > 0) {
                const term_id = activeTerm[0].id;
                await connection.query('INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES (?, ?, ?)', [studentData.id, term_id, 'Not Paid']);
            }

            await connection.commit();
            return res.status(201).json({
                success: true,
                message: 'Student created successfully.',
                data: {
                    student_login_id: studentId,
                    temporary_password: tempPassword,
                    student: { id: studentData.id, first_name, last_name, class_id, branch_id }
                }
            });
        } catch (e) {
            await pool.query('ROLLBACK');
            console.error('Create student error:', e);
            return res.status(500).json({ success: false, message: 'Server error while creating student.' });
        } finally {
            await pool.query('COMMIT');
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// PATCH /api/students/:id/associate-parent - associate existing student with parent by email or phone (and update contact)
router.patch('/:id/associate-parent', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { parent_email, parent_phone } = req.body;

    if (!parent_email && !parent_phone) {
        return res.status(400).json({ success: false, message: 'Provide parent_email or parent_phone.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch student and enforce branch scope
        const [studentRows] = await connection.query('SELECT id, branch_id, parent_id FROM students WHERE id = ?', [id]);
        if (studentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentRows[0];
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to modify this student.' });
            }
        }

        // Find parent
        let parent;
        if (parent_email) {
            const [emailParents] = await connection.query('SELECT * FROM parents WHERE email = ?', [parent_email]);
            if (emailParents.length > 0) {
                parent = emailParents[0];
            }
        }
        if (!parent && parent_phone) {
            const [phoneParents] = await connection.query('SELECT * FROM parents WHERE phone = ?', [parent_phone]);
            if (phoneParents.length > 0) {
                parent = phoneParents[0];
            }
        }

        if (!parent) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Parent not found by provided contact.' });
        }

        // Update parent contacts if provided
        const updateFields = {};
        if (parent_phone && parent.phone !== parent_phone) updateFields.phone = parent_phone;
        if (parent_email && parent.email !== parent_email) {
            // Ensure email unique and update both users and parents
            const [emailCheck] = await connection.query('SELECT id FROM users WHERE email = ? AND id != ?', [parent_email, parent.user_id]);
            if (emailCheck.length > 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Parent email already in use.' });
            }
            await connection.query('UPDATE users SET email = ? WHERE id = ?', [parent_email, parent.user_id]);
            updateFields.email = parent_email;
        }
        if (Object.keys(updateFields).length > 0) {
            await connection.query('UPDATE parents SET ? WHERE id = ?', [updateFields, parent.id]);
        }

        // Associate
        await connection.query('UPDATE students SET parent_id = ? WHERE id = ?', [parent.id, id]);

        await connection.commit();
        return res.json({ success: true, message: 'Parent associated successfully.' });
    } catch (err) {
        await connection.rollback();
        console.error('Associate parent error:', err);
        return res.status(500).json({ success: false, message: 'Server error while associating parent.' });
    } finally {
        connection.release();
    }
});

// PUT /api/students/:id - Update a student's profile
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const {
        first_name, last_name, dob, passport, address,
        nationality, state, class_id, branch_id, religion, disability
    } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [studentRows] = await connection.query('SELECT * FROM students WHERE id = ?', [id]);
        if (studentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to update this student.' });
            }
            if (branch_id && branch_id !== adminBranchId) {
                return res.status(403).json({ success: false, message: 'Admins cannot change a student\'s branch.' });
            }
        }

        const updateFields = {};
        if (first_name) updateFields.first_name = first_name;
        if (last_name) updateFields.last_name = last_name;
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
            await connection.query('UPDATE students SET ? WHERE id = ?', [updateFields, id]);
        }

        await connection.commit();
        res.json({ success: true, message: 'Student profile updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Update student error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating student profile.' });
    } finally {
        connection.release();
    }
});

// DELETE /api/students/:id - Delete a student's profile
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [studentRows] = await connection.query('SELECT * FROM students WHERE id = ?', [id]);
        if (studentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to delete this student.' });
            }
        }

        await connection.query('DELETE FROM students WHERE id = ?', [id]);
        await connection.query('DELETE FROM user_roles WHERE user_id = ?', [student.user_id]);
        await connection.query('DELETE FROM users WHERE id = ?', [student.user_id]);

        await connection.commit();
        res.json({ success: true, message: 'Student profile deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Delete student error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting student.' });
    } finally {
        connection.release();
    }
});

// GET /api/students - list students
router.get('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT s.id, s.first_name, s.last_name, s.dob, s.address, s.nationality, s.state, s.religion, s.disability, s.passport, c.name AS class_name, b.school_name AS branch,
                   p.name AS parent_name, p.email AS parent_email, p.phone AS parent_phone
            FROM students s
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN parents p ON s.parent_id = p.id
        `;
        const params = [];
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId) return res.json({ success: true, data: [] });
            query += ' WHERE s.branch_id = ?';
            params.push(adminBranchId);
        }
        query += ' ORDER BY s.first_name ASC, s.last_name ASC';
        const [rows] = await pool.query(query, params);
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('List students error:', err);
        return res.status(500).json({ success: false, message: 'Server error while fetching students.' });
    }
});

// GET /api/students/new - list new students (duplicate of enrollment listing for convenience)
router.get('/new/all', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
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
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId) return res.json({ success: true, data: [] });
            query += ' WHERE ns.branch_id = ?';
            params.push(adminBranchId);
        }
        query += ' ORDER BY ns.created_at DESC';
        const [rows] = await pool.query(query, params);
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('List new students error:', err);
        return res.status(500).json({ success: false, message: 'Server error while fetching new students.' });
    }
});

// POST /api/students/migrate/:newStudentId - migrate new_student to student
router.post('/migrate/:newStudentId', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { newStudentId } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [nsRows] = await connection.query('SELECT * FROM new_students WHERE id = ?', [newStudentId]);
        if (nsRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'New student not found.' });
        }
        const ns = nsRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== ns.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to migrate this student.' });
            }
        }

        // Fetch the user's account by student_id (stored as users.email)
        const [userRows] = await connection.query('SELECT id FROM users WHERE email = ?', [ns.student_id]);
        if (userRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student user account not found.' });
        }
        const userId = userRows[0].id;

        // Update role from NewStudent to Student
        const [studentRole] = await connection.query("SELECT id FROM roles WHERE name = 'Student'");
        const [newStudentRole] = await connection.query("SELECT id FROM roles WHERE name = 'NewStudent'");
        if (studentRole.length === 0 || newStudentRole.length === 0) {
            await connection.rollback();
            return res.status(500).json({ success: false, message: 'Required roles not found.' });
        }
        await connection.query('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [userId, newStudentRole[0].id]);
        await connection.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, studentRole[0].id]);

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
            disability: ns.disability
        };
        await connection.query('INSERT INTO students SET ?', studentData);

        // Remove from new_students
        await connection.query('DELETE FROM new_students WHERE id = ?', [newStudentId]);

        await connection.commit();
        return res.json({ success: true, message: 'Student migrated successfully.', data: { id: studentData.id } });
    } catch (err) {
        await connection.rollback();
        console.error('Migrate student error:', err);
        return res.status(500).json({ success: false, message: 'Server error while migrating student.' });
    } finally {
        connection.release();
    }
});

// GET /api/students/class - Get all students in the authenticated teacher's class
// this endpoint allow you to fetch student by class, can only use with teacher role
router.get('/class', [auth, authorize(['Teacher'])], async (req, res) => {
    try {
        // Find the teacher's class
        const [staff] = await pool.query('SELECT id FROM staff WHERE user_id = ?', [req.user.id]);
        if (staff.length === 0) {
            return res.status(403).json({ success: false, message: 'Authenticated user is not a staff member.' });
        }
        const teacherId = staff[0].id;

        const [teacherClass] = await pool.query('SELECT id FROM classes WHERE teacher_id = ?', [teacherId]);
        if (teacherClass.length === 0) {
            return res.status(404).json({ success: false, message: 'Teacher is not assigned to any class.' });
        }
        const classId = teacherClass[0].id;

        // Fetch students in that class
        const query = `
            SELECT s.id, s.first_name, s.last_name, s.dob, s.address, s.nationality, s.state, s.religion, s.disability, s.passport,
                   p.name AS parent_name, p.email AS parent_email, p.phone AS parent_phone
            FROM students s
            JOIN parents p ON s.parent_id = p.id
            WHERE s.class_id = ?
            ORDER BY s.last_name ASC, s.first_name ASC
        `;

        const [students] = await pool.query(query, [classId]);
        res.json({ success: true, data: students });

    } catch (error) {
        console.error('Error fetching students by class:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching students.' });
    }
});

// POST /api/students/:id/reset-password - Reset a student's password
router.post('/:id/reset-password', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [studentRows] = await connection.query('SELECT * FROM students WHERE id = ?', [id]);
        if (studentRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to reset this student\'s password.' });
            }
        }

        const newPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connection.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, student.user_id]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Student password has been reset successfully.',
            data: {
                student_id: student.id,
                temporary_password: newPassword
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Reset student password error:', error);
        res.status(500).json({ success: false, message: 'Server error while resetting password.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
