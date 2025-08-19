const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// --- Helper Functions ---

/**
 * Generates a unique student ID in the format 'ttbXXXX'
 * @returns {Promise<string>} A unique student ID.
 */
async function generateStudentId() {
    const prefix = 'ttb';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let isUnique = false;
    let studentId = '';

    // Loop until a unique ID is generated to prevent rare collisions
    while (!isUnique) {
        let randomPart = '';
        for (let i = 0; i < 4; i++) {
            randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        studentId = prefix + randomPart;

        // Check for uniqueness in the users table
        const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [studentId]);
        if (existingUser.length === 0) {
            isUnique = true;
        }
    }
    return studentId;
}

/**
 * Generates a random temporary password.
 * @returns {string} A 10-character random password.
 */
function generatePassword() {
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}


// --- API Endpoint ---

// @route   POST /api/enrollment/register
// @desc    Register a new student for enrollment
// @access  Public
router.post('/register', async (req, res) => {
    const {
        first_name, last_name, dob, passport, address, nationality,
        state, class_id, branch_id, previous_school, religion,
        disability, parent_name, parent_phone, parent_email, payment_status
    } = req.body;

    // Basic validation
    if (!first_name || !last_name || !dob || !passport || !parent_name || !parent_phone || !parent_email || !class_id) {
        return res.status(400).json({ success: false, message: 'Please fill all required fields.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        let parentId;

        // Step 1: Check if parent exists, otherwise create a new parent user
        const [existingParentUser] = await connection.query('SELECT id FROM users WHERE email = ?', [parent_email]);

        if (existingParentUser.length > 0) {
            // Parent user exists, find their ID in the parents table
            const [parentRecord] = await connection.query('SELECT id FROM parents WHERE user_id = ?', [existingParentUser[0].id]);
            if (parentRecord.length > 0) {
                parentId = parentRecord[0].id;
            } else {
                // This case is unlikely but handled: user exists but no parent record
                throw new Error('Parent user exists but is not registered as a parent.');
            }
        } else {
            // Create a new user and parent record for the parent
            const parentUserId = uuidv4();
            const parentTempPassword = generatePassword(); // You can optionally email this to them
            const hashedParentPassword = await bcrypt.hash(parentTempPassword, 10);

            await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [parentUserId, parent_email, hashedParentPassword]);

            const [parentRole] = await connection.query("SELECT id FROM roles WHERE name = 'Parent'");
            if (parentRole.length === 0) throw new Error("Parent role not found in database.");

            await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [parentUserId, parentRole[0].id]);

            parentId = uuidv4();
            await connection.query('INSERT INTO parents (id, user_id, name, phone, email) VALUES (?, ?, ?, ?, ?)',
                [parentId, parentUserId, parent_name, parent_phone, parent_email]
            );
        }

        // Step 2: Generate Student ID and create a user account for the new student
        const studentId = await generateStudentId();
        const studentTempPassword = generatePassword();
        const hashedStudentPassword = await bcrypt.hash(studentTempPassword, 10);
        const studentUserId = uuidv4();

        // We use the unique student ID in the 'email' field of the users table for easy login
        await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [studentUserId, studentId, hashedStudentPassword]);

        const [newStudentRole] = await connection.query("SELECT id FROM roles WHERE name = 'NewStudent'");
        if (newStudentRole.length === 0) throw new Error("'NewStudent' role not found in database.");

        await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [studentUserId, newStudentRole[0].id]);

        // Step 3: Insert the student's data into the new_students table
        const newStudentData = {
            id: uuidv4(),
            student_id: studentId, // Storing the generated ID
            parent_id: parentId,
            first_name,
            last_name,
            dob,
            passport,
            address,
            nationality,
            state,
            class_id,
            branch_id,
            previous_school: previous_school || null,
            religion,
            disability: disability || null,
            score: 0,
            payment_status
        };

        await connection.query('INSERT INTO new_students SET ?', newStudentData);

        // If all operations are successful, commit the transaction
        await connection.commit();

        // Step 4: Send the credentials back to the frontend
        res.status(201).json({
            success: true,
            message: 'Enrollment successful! Please save these credentials for the entrance exam.',
            data: {
                student_id: studentId,
                temporary_password: studentTempPassword,
                full_name: `${first_name} ${last_name}`
            }
        });

    } catch (error) {
        // If any error occurs, rollback the entire transaction
        await connection.rollback();
        console.error('Enrollment Error:', error);
        res.status(500).json({ success: false, message: 'An error occurred during enrollment. Please try again.' });
    } finally {
        // Always release the connection back to the pool
        connection.release();
    }
});

// @route   GET /api/enrollment/students
// @desc    Get all newly enrolled students
// @access  Admin, SuperAdmin
router.get('/students', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT 
                ns.id, ns.student_id, ns.first_name, ns.last_name, ns.dob, c.name as class_applying,
                ns.payment_status, b.school_name as branch_name, p.name as parent_name, p.phone as parent_phone
            FROM new_students ns
            JOIN branches b ON ns.branch_id = b.id
            JOIN parents p ON ns.parent_id = p.id
            JOIN classes c ON ns.class_id = c.id
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0) {
                query += ' WHERE ns.branch_id = ?';
                queryParams.push(adminStaff[0].branch_id);
            } else {
                return res.json({ success: true, data: [] }); // Admin not linked to a branch
            }
        }

        query += ' ORDER BY ns.created_at DESC';

        const [students] = await pool.query(query, queryParams);
        res.json({ success: true, data: students });

    } catch (error) {
        console.error('Error fetching new students:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching new students.' });
    }
});


// @route   POST /api/enrollment/students/:id/reset-password
// @desc    Reset a new student's password
// @access  Admin, SuperAdmin
router.post('/students/:id/reset-password', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [studentResult] = await connection.query('SELECT student_id, branch_id FROM new_students WHERE id = ?', [id]);
        if (studentResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentResult[0];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to reset this student\'s password.' });
            }
        }

        const [userResult] = await connection.query('SELECT id FROM users WHERE email = ?', [student.student_id]);
        if (userResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student user account not found.' });
        }
        const userId = userResult[0].id;

        const newPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connection.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Password reset successfully.',
            data: {
                student_id: student.student_id,
                temporary_password: newPassword
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, message: 'Server error while resetting password.' });
    } finally {
        connection.release();
    }
});


// @route   DELETE /api/enrollment/students/:id
// @desc    Delete a new student record
// @access  Admin, SuperAdmin
router.delete('/students/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [studentResult] = await connection.query('SELECT student_id, branch_id FROM new_students WHERE id = ?', [id]);
        if (studentResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentResult[0];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to delete this student.' });
            }
        }

        const [userResult] = await connection.query('SELECT id FROM users WHERE email = ?', [student.student_id]);

        // Delete from new_students first
        await connection.query('DELETE FROM new_students WHERE id = ?', [id]);

        if (userResult.length > 0) {
            const userId = userResult[0].id;
            await connection.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
            await connection.query('DELETE FROM users WHERE id = ?', [userId]);
        }

        await connection.commit();

        res.json({ success: true, message: 'Student record deleted successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleting student:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting student record.' });
    } finally {
        connection.release();
    }
});


// @route   PUT /api/enrollment/students/:id
// @desc    Update a new student's details
// @access  Admin, SuperAdmin
router.put('/students/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const {
        first_name, last_name, dob, passport, address, nationality,
        state, class_id, branch_id, previous_school, religion,
        disability, parent_name, parent_phone, parent_email, payment_status
    } = req.body;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [studentResult] = await connection.query('SELECT * FROM new_students WHERE id = ?', [id]);
        if (studentResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        const student = studentResult[0];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'You are not authorized to update this student.' });
            }
            if (branch_id && branch_id !== student.branch_id) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Admins cannot change a student\'s branch.' });
            }
        }

        const [parent] = await connection.query('SELECT * FROM parents WHERE id = ?', [student.parent_id]);
        if (parent.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Associated parent not found for this student.' });
        }
        const currentParent = parent[0];

        const updateParentFields = {};
        if (parent_name && currentParent.name !== parent_name) updateParentFields.name = parent_name;
        if (parent_phone && currentParent.phone !== parent_phone) updateParentFields.phone = parent_phone;

        if (parent_email && currentParent.email !== parent_email) {
            const [emailCheck] = await connection.query('SELECT id FROM users WHERE email = ? AND id != ?', [parent_email, currentParent.user_id]);
            if (emailCheck.length > 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'The provided parent email is already in use by another user.' });
            }
            await connection.query('UPDATE users SET email = ? WHERE id = ?', [parent_email, currentParent.user_id]);
            updateParentFields.email = parent_email;
        }

        if (Object.keys(updateParentFields).length > 0) {
            await connection.query('UPDATE parents SET ? WHERE id = ?', [updateParentFields, student.parent_id]);
        }

        const updateStudentFields = {};
        if (first_name) updateStudentFields.first_name = first_name;
        if (last_name) updateStudentFields.last_name = last_name;
        if (dob) updateStudentFields.dob = dob;
        if (passport) updateStudentFields.passport = passport;
        if (address) updateStudentFields.address = address;
        if (nationality) updateStudentFields.nationality = nationality;
        if (state) updateStudentFields.state = state;
        if (class_id) updateStudentFields.class_id = class_id;
        if (branch_id) updateStudentFields.branch_id = branch_id;
        if (previous_school) updateStudentFields.previous_school = previous_school;
        if (religion) updateStudentFields.religion = religion;
        if (disability !== undefined) updateStudentFields.disability = disability;
        if (payment_status) updateStudentFields.payment_status = payment_status;

        if (Object.keys(updateStudentFields).length > 0) {
            await connection.query('UPDATE new_students SET ? WHERE id = ?', [updateStudentFields, id]);
        }

        await connection.commit();

        res.json({ success: true, message: 'New student details updated successfully.' });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating new student:', error);
        res.status(500).json({ success: false, message: 'Server error while updating student record.' });
    } finally {
        connection.release();
    }
});


module.exports = router;