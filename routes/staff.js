const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validateStaffData = require('../middleware/validateStaff');

async function getClassFullDetails(classId, connection) {
    // 1. Fetch basic class details and teacher info
    const [classInfo] = await connection.query(`
        SELECT c.*, s.name as teacher_name, s.email as teacher_email, s.phone as teacher_phone
        FROM classes c
        LEFT JOIN staff s ON c.teacher_id = s.id
        WHERE c.id = ?
    `, [classId]);

    if (classInfo.length === 0) {
        return null;
    }

    // 2. Fetch all students in the class
    const [students] = await connection.query(`
        SELECT id, user_id, first_name, last_name, passport
        FROM students 
        WHERE class_id = ?
    `, [classId]);

    // 3. Fetch upcoming assignments for the class
    const [assignments] = await connection.query(`
        SELECT id, title, subject, due_date
        FROM assignments 
        WHERE class_id = ? AND due_date >= CURDATE()
        ORDER BY due_date ASC
    `, [classId]);

    // 4. Fetch the timetable for the class
    const [timetable] = await connection.query(`
        SELECT timetable_data
        FROM timetables
        WHERE class_id = ?
    `, [classId]);

    const result = {
        ...classInfo[0],
        students,
        assignments,
        timetable: timetable.length > 0 ? timetable[0].timetable_data : null,
        total_student: students.length
    };

    return result;
}


function generatePassword() {
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

function calculateSalaryDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
}

function validateSalaryData(salary, salary_type) {
    if (salary !== null && salary !== undefined) {
        if (isNaN(salary) || salary < 0) {
            return 'Salary must be a positive number';
        }
        if (!['monthly', 'hourly'].includes(salary_type)) {
            return 'Salary type must be either "monthly" or "hourly"';
        }
    }
    return null;
}

router.post('/create', auth, authorize(['SuperAdmin', 'Admin']), validateStaffData, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const {
            name,
            email,
            phone,
            address,
            salary,
            salary_type = 'monthly',
            gender,
            description,
            role_id,
            branch_id,
            image
        } = req.body;

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                return res.status(403).json({ success: false, message: 'Admin not associated with a branch.' });
            }
            const adminBranchId = adminStaff[0].branch_id;
            if (branch_id !== adminBranchId) {
                return res.status(403).json({ success: false, message: 'Admins can only create staff for their own branch.' });
            }
        }

        if (!name || !email || !phone || !gender || !role_id || !branch_id) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields: name, email, phone, gender, role_id, branch_id'
            });
        }

        const salaryError = validateSalaryData(salary, salary_type);
        if (salaryError) {
            return res.status(400).json({
                success: false,
                message: salaryError
            });
        }

        const validGenders = ['male', 'female', 'other'];
        if (!validGenders.includes(gender.toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: 'Gender must be one of: male, female, other'
            });
        }

        const [existingUser] = await connection.query(
            'SELECT email FROM users WHERE email = ?',
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        const [roleData] = await connection.query(
            'SELECT id, name FROM roles WHERE id = ?',
            [role_id]
        );

        if (roleData.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role ID'
            });
        }

        const [branchData] = await connection.query(
            'SELECT id, school_name FROM branches WHERE id = ?',
            [branch_id]
        );

        if (branchData.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid branch ID'
            });
        }

        await connection.beginTransaction();

        const password = generatePassword();
        const hashedPassword = await bcrypt.hash(password, 10);

        const userId = uuidv4();
        await connection.query(
            'INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
            [userId, email, hashedPassword]
        );

        await connection.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
            [userId, role_id]
        );

        const staffId = uuidv4();
        const salaryDueDate = salary ? calculateSalaryDueDate() : null;

        const staffData = {
            id: staffId,
            user_id: userId,
            name,
            email,
            phone,
            address: address || null,
            salary: salary || null,
            salary_type,
            gender: gender.toLowerCase(),
            description: description || null,
            role_id,
            branch_id,
            image_url: image || null,
            status: 'Active',
            salary_due_date: salaryDueDate
        };

        await connection.query('INSERT INTO staff SET ?', staffData);

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Staff member created successfully',
            data: {
                id: staffId,
                name,
                email,
                phone,
                branch: branchData[0].school_name,
                branchId: branch_id,
                role: roleData[0].name,
                roleId: role_id,
                salary: salary || null,
                salary_type,
                status: 'Active',
                description: description || null,
                imageUrl: image || null,
                address: address || null,
                gender: gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase(),
                salaryDueDate,
                temporaryPassword: password
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creating staff:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while creating staff member'
        });
    } finally {
        connection.release();
    }
});

router.get('/', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        let query = `
            SELECT 
                s.id,
                s.name,
                s.email,
                s.phone,
                s.address,
                s.salary,
                s.salary_type,
                s.gender,
                s.description,
                s.status,
                s.image_url as imageUrl,
                s.salary_due_date as salaryDueDate,
                s.created_at as createdAt,
                r.id as roleId,
                r.name as role,
                b.id as branchId,
                b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0) {
                return res.status(403).json({ success: false, message: 'Admin not associated with any branch.' });
            }
            const adminBranchId = adminStaff[0].branch_id;
            query += ' WHERE s.branch_id = ?';
            queryParams.push(adminBranchId);
        }

        query += ' ORDER BY s.created_at DESC';

        const [staff] = await pool.query(query, queryParams);

        const formattedStaff = staff.map(member => ({
            id: member.id,
            name: member.name,
            email: member.email,
            phone: member.phone,
            branch: member.branch,
            branchId: member.branchId,
            role: member.role,
            roleId: member.roleId,
            salary: member.salary,
            salary_type: member.salary_type,
            status: member.status,
            description: member.description,
            imageUrl: member.imageUrl,
            address: member.address,
            gender: member.gender.charAt(0).toUpperCase() + member.gender.slice(1),
            salaryDueDate: member.salaryDueDate,
            createdAt: member.createdAt
        }));

        res.json({
            success: true,
            data: formattedStaff
        });

    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching staff members'
        });
    }
});

router.get('/:id', auth, async (req, res) => {
    try {
        const query = `
            SELECT 
                s.id,
                s.name,
                s.email,
                s.phone,
                s.address,
                s.salary,
                s.salary_type,
                s.gender,
                s.description,
                s.status,
                s.image_url as imageUrl,
                s.salary_due_date as salaryDueDate,
                s.created_at as createdAt,
                r.id as roleId,
                r.name as role,
                b.id as branchId,
                b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.id = ?
        `;

        const [staff] = await pool.query(query, [req.params.id]);

        if (staff.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        const member = staff[0];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== member.branchId) {
                return res.status(403).json({ success: false, message: 'You are not authorized to view this staff member.' });
            }
        }

        res.json({
            success: true,
            data: {
                id: member.id,
                name: member.name,
                email: member.email,
                phone: member.phone,
                branch: member.branch,
                branchId: member.branchId,
                role: member.role,
                roleId: member.roleId,
                salary: member.salary,
                salary_type: member.salary_type,
                status: member.status,
                description: member.description,
                imageUrl: member.imageUrl,
                address: member.address,
                gender: member.gender.charAt(0).toUpperCase() + member.gender.slice(1),
                salaryDueDate: member.salaryDueDate,
                createdAt: member.createdAt
            }
        });

    } catch (error) {
        console.error('Error fetching staff member:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching staff member'
        });
    }
});

router.put('/:id/update', auth, authorize(['SuperAdmin', 'Admin']), validateStaffData, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const staffId = req.params.id;
        const {
            name,
            email,
            phone,
            address,
            salary,
            salary_type,
            gender,
            description,
            role_id,
            branch_id,
            image
        } = req.body;

        const [existingStaff] = await connection.query(
            'SELECT * FROM staff WHERE id = ?',
            [staffId]
        );

        if (existingStaff.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        const currentStaff = existingStaff[0];

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length === 0 || adminStaff[0].branch_id !== currentStaff.branch_id) {
                return res.status(403).json({ success: false, message: 'You are not authorized to update this staff member.' });
            }
            if (branch_id && branch_id !== adminStaff[0].branch_id) {
                return res.status(403).json({ success: false, message: 'Admins cannot change the branch of a staff member.' });
            }
        }

        if (salary !== undefined || salary_type !== undefined) {
            const salaryError = validateSalaryData(
                salary ?? currentStaff.salary,
                salary_type ?? currentStaff.salary_type
            );
            if (salaryError) {
                return res.status(400).json({
                    success: false,
                    message: salaryError
                });
            }
        }

        if (email && email !== currentStaff.email) {
            const [emailCheck] = await connection.query(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, currentStaff.user_id]
            );

            if (emailCheck.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already in use'
                });
            }
        }

        if (role_id) {
            const [roleData] = await connection.query(
                'SELECT name FROM roles WHERE id = ?',
                [role_id]
            );

            if (roleData.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid role ID'
                });
            }
        }

        if (branch_id) {
            const [branchData] = await connection.query(
                'SELECT school_name FROM branches WHERE id = ?',
                [branch_id]
            );

            if (branchData.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid branch ID'
                });
            }
        }

        await connection.beginTransaction();

        if (email && email !== currentStaff.email) {
            await connection.query(
                'UPDATE users SET email = ? WHERE id = ?',
                [email, currentStaff.user_id]
            );
        }

        if (role_id && role_id !== currentStaff.role_id) {
            await connection.query(
                'UPDATE user_roles SET role_id = ? WHERE user_id = ?',
                [role_id, currentStaff.user_id]
            );
        }

        const updateFields = [];
        const updateValues = [];

        if (name) updateFields.push('name = ?'), updateValues.push(name);
        if (email) updateFields.push('email = ?'), updateValues.push(email);
        if (phone) updateFields.push('phone = ?'), updateValues.push(phone);
        if (address !== undefined) updateFields.push('address = ?'), updateValues.push(address);
        if (salary !== undefined) updateFields.push('salary = ?'), updateValues.push(salary);
        if (salary_type) updateFields.push('salary_type = ?'), updateValues.push(salary_type);
        if (gender) updateFields.push('gender = ?'), updateValues.push(gender.toLowerCase());
        if (description !== undefined) updateFields.push('description = ?'), updateValues.push(description);
        if (role_id) updateFields.push('role_id = ?'), updateValues.push(role_id);
        if (branch_id) updateFields.push('branch_id = ?'), updateValues.push(branch_id);
        if (image !== undefined) updateFields.push('image_url = ?'), updateValues.push(image);

        if (salary !== undefined && salary !== null && !currentStaff.salary) {
            updateFields.push('salary_due_date = ?');
            updateValues.push(calculateSalaryDueDate());
        }

        if (updateFields.length > 0) {
            updateValues.push(staffId);
            await connection.query(
                `UPDATE staff SET ${updateFields.join(', ')} WHERE id = ?`,
                updateValues
            );
        }

        await connection.commit();

        const [updatedStaff] = await connection.query(`
            SELECT 
                s.*,
                r.name as role,
                b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.id = ?
        `, [staffId]);

        const updated = updatedStaff[0];

        res.json({
            success: true,
            message: 'Staff member updated successfully',
            data: {
                id: updated.id,
                name: updated.name,
                email: updated.email,
                phone: updated.phone,
                branch: updated.branch,
                branchId: updated.branch_id,
                role: updated.role,
                roleId: updated.role_id,
                salary: updated.salary,
                salary_type: updated.salary_type,
                status: updated.status,
                description: updated.description,
                imageUrl: updated.image_url,
                address: updated.address,
                gender: updated.gender.charAt(0).toUpperCase() + updated.gender.slice(1),
                salaryDueDate: updated.salary_due_date
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating staff:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating staff member'
        });
    } finally {
        connection.release();
    }
});

router.put('/:id/status', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const staffId = req.params.id;
        const { status, reason } = req.body;

        const validStatuses = ['Active', 'On Leave', 'Not Paid', 'Suspended', 'Terminated'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }

        // Validate that the status is a string to prevent SQL injection
        if (typeof status !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Status must be a string'
            });
        }

        await connection.beginTransaction();

        const [existing] = await connection.query(
            'SELECT s.*, u.id as user_id, r.name as role_name, b.school_name as branch_name FROM staff s ' +
            'JOIN users u ON s.user_id = u.id ' +
            'JOIN roles r ON s.role_id = r.id ' +
            'JOIN branches b ON s.branch_id = b.id ' +
            'WHERE s.id = ? FOR UPDATE',
            [staffId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        const currentStaff = existing[0];

        if (currentStaff.status === status) {
            return res.status(400).json({
                success: false,
                message: `Staff is already ${status}`
            });
        }

        let updateFields = { status };

        if (status === 'Active') {
            if (currentStaff.salary) {
                updateFields.salary_due_date = calculateSalaryDueDate();
            }
        } else if (status === 'Terminated') {
            // Generate a random password that the terminated staff can't guess
            const randomPassword = require('crypto').randomBytes(32).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);

            // Update the user's password
            await connection.query(
                'UPDATE users SET password = ? WHERE id = ?',
                [hashedPassword, currentStaff.user_id]
            );
        }

        await connection.query(
            'UPDATE staff SET ? WHERE id = ?',
            [updateFields, staffId]
        );

        await connection.commit();

        let message = '';
        switch (status) {
            case 'Active':
                message = 'Staff successfully reinstated';
                break;
            case 'On Leave':
                message = 'Staff marked as on leave';
                break;
            case 'Suspended':
                message = 'Staff has been suspended';
                break;
            case 'Terminated':
                message = 'Staff has been terminated';
                break;
            case 'Not Paid':
                message = 'Staff marked as not paid';
                break;
            default:
                message = 'Staff status updated successfully';
        }

        if (reason) {
            message += `: ${reason}`;
        }

        res.json({
            success: true,
            message,
            data: {
                id: currentStaff.id,
                name: currentStaff.name,
                email: currentStaff.email,
                role: currentStaff.role_name,
                branch: currentStaff.branch_name,
                previousStatus: currentStaff.status,
                newStatus: status,
                salary_due_date: updateFields.salary_due_date || currentStaff.salary_due_date
            }
        });

    } catch (error) {
        console.error('Error updating staff status:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating staff status'
        });
    } finally {
        connection.release();
    }
});

router.post('/:id/reset-password', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const staffId = req.params.id;

        const [existing] = await connection.query(
            'SELECT user_id, email, name FROM staff WHERE id = ?',
            [staffId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        const staff = existing[0];

        const newPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connection.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, staff.user_id]
        );

        res.json({
            success: true,
            message: 'Password reset successfully',
            data: {
                id: staffId,
                email: staff.email,
                name: staff.name,
                temporaryPassword: newPassword
            }
        });

    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while resetting password'
        });
    } finally {
        connection.release();
    }
});

router.delete('/:id', auth, authorize(['SuperAdmin']), async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const staffId = req.params.id;

        const [existing] = await connection.query(
            'SELECT * FROM staff WHERE id = ?',
            [staffId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        await connection.beginTransaction();

        await connection.query('DELETE FROM staff WHERE id = ?', [staffId]);

        await connection.query('DELETE FROM user_roles WHERE user_id = ?', [existing[0].user_id]);

        await connection.query('DELETE FROM users WHERE id = ?', [existing[0].user_id]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Staff member deleted successfully'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleting staff:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while deleting staff member'
        });
    } finally {
        connection.release();
    }
});

router.get('/branch/:branchId', auth, async (req, res) => {
    try {
        const query = `
            SELECT 
                s.id,
                s.name,
                s.email,
                s.phone,
                s.address,
                s.salary,
                s.salary_type,
                s.gender,
                s.description,
                s.status,
                s.image_url as imageUrl,
                s.salary_due_date as salaryDueDate,
                r.id as roleId,
                r.name as role,
                b.id as branchId,
                b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.branch_id = ?
            ORDER BY s.created_at DESC
        `;

        const [staff] = await pool.query(query, [req.params.branchId]);

        const formattedStaff = staff.map(member => ({
            id: member.id,
            name: member.name,
            email: member.email,
            phone: member.phone,
            branch: member.branch,
            branchId: member.branchId,
            role: member.role,
            roleId: member.roleId,
            salary: member.salary,
            salary_type: member.salary_type,
            status: member.status,
            description: member.description,
            imageUrl: member.imageUrl,
            address: member.address,
            gender: member.gender.charAt(0).toUpperCase() + member.gender.slice(1),
            salaryDueDate: member.salaryDueDate
        }));

        res.json({
            success: true,
            data: formattedStaff
        });

    } catch (error) {
        console.error('Error fetching staff by branch:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching staff members'
        });
    }
});

router.get('/status/:status', auth, async (req, res) => {
    try {
        const status = req.params.status;
        const validStatuses = ['Active', 'On Leave', 'Not Paid', 'Suspended', 'Terminated'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        const query = `
            SELECT 
                s.id,
                s.name,
                s.email,
                s.phone,
                s.address,
                s.salary,
                s.salary_type,
                s.gender,
                s.description,
                s.status,
                s.image_url as imageUrl,
                s.salary_due_date as salaryDueDate,
                r.id as roleId,
                r.name as role,
                b.id as branchId,
                b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.status = ?
            ORDER BY s.created_at DESC
        `;

        const [staff] = await pool.query(query, [status]);

        const formattedStaff = staff.map(member => ({
            id: member.id,
            name: member.name,
            email: member.email,
            phone: member.phone,
            branch: member.branch,
            branchId: member.branchId,
            role: member.role,
            roleId: member.roleId,
            salary: member.salary,
            salary_type: member.salary_type,
            status: member.status,
            description: member.description,
            imageUrl: member.imageUrl,
            address: member.address,
            gender: member.gender.charAt(0).toUpperCase() + member.gender.slice(1),
            salaryDueDate: member.salaryDueDate
        }));

        res.json({
            success: true,
            data: formattedStaff
        });

    } catch (error) {
        console.error('Error fetching staff by status:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching staff members'
        });
    }
});

router.get('/:id/full-details', auth, async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [staff] = await connection.query(`
            SELECT 
                s.*,
                r.name as role,
                b.school_name as branch
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.id = ?
        `, [id]);

        if (staff.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }

        const teacher = staff[0];

        // Authorization check
        const isSuperAdmin = req.user.roles.includes('SuperAdmin');
        const isOwner = teacher.user_id === req.user.id;
        let isAdminInSameBranch = false;

        if (req.user.roles.includes('Admin')) {
            const [adminStaff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (adminStaff.length > 0 && adminStaff[0].branch_id === teacher.branch_id) {
                isAdminInSameBranch = true;
            }
        }

        if (!isSuperAdmin && !isOwner && !isAdminInSameBranch) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'You are not authorized to view these details.' });
        }


        const [classes] = await connection.query('SELECT id FROM classes WHERE teacher_id = ?', [id]);

        const classDetails = [];
        for (const c of classes) {
            const details = await getClassFullDetails(c.id, connection);
            if (details) {
                classDetails.push(details);
            }
        }

        await connection.commit();

        const result = {
            ...teacher,
            classes: classDetails
        };

        res.status(200).json({ success: true, data: result });


    } catch (error) {
        await connection.rollback();
        console.error('Error fetching full teacher details:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching teacher details.' });
    } finally {
        connection.release();
    }
});

module.exports = router;