const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../database');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validateStaffData = require('../middleware/validateStaff');

// Generate a random password
function generatePassword() {
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

// Calculate salary due date (30 days from creation or last payment)
function calculateSalaryDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
}

// Validate salary data
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

// Create staff member
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

        // Validate required fields
        if (!name || !email || !phone || !gender || !role_id || !branch_id) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields: name, email, phone, gender, role_id, branch_id'
            });
        }

        // Validate salary data
        const salaryError = validateSalaryData(salary, salary_type);
        if (salaryError) {
            return res.status(400).json({
                success: false,
                message: salaryError
            });
        }

        // Validate gender
        const validGenders = ['male', 'female', 'other'];
        if (!validGenders.includes(gender.toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: 'Gender must be one of: male, female, other'
            });
        }

        // Check if email already exists
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

        // Check if role exists and get role name
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

        // Check if branch exists
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

        // Generate password
        const password = generatePassword();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user account
        const userId = uuidv4();
        await connection.query(
            'INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
            [userId, email, hashedPassword]
        );

        // Assign role to user
        await connection.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
            [userId, role_id]
        );

        // Create staff record
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

// Get all staff members
router.get('/', auth, async (req, res) => {
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
            ORDER BY s.created_at DESC
        `;

        const [staff] = await pool.query(query);

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

// Get single staff member
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

// Update staff member
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

        // Check if staff exists
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

        // Validate salary data if provided
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

        // If email is being changed, check if new email is available
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

        // Validate role if provided
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

        // Validate branch if provided
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

        // Update user email if changed
        if (email && email !== currentStaff.email) {
            await connection.query(
                'UPDATE users SET email = ? WHERE id = ?',
                [email, currentStaff.user_id]
            );
        }

        // Update user role if changed
        if (role_id && role_id !== currentStaff.role_id) {
            await connection.query(
                'UPDATE user_roles SET role_id = ? WHERE user_id = ?',
                [role_id, currentStaff.user_id]
            );
        }

        // Build update query for staff table
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

        // Update salary due date if salary is being set for the first time
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

        // Fetch updated staff data
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

// Update staff status
router.patch('/:id/status', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    try {
        const { status } = req.body;
        const staffId = req.params.id;

        const validStatuses = ['Active', 'On Leave', 'Not Paid', 'Suspended', 'Terminated'];

        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be one of: Active, On Leave, Not Paid, Suspended, Terminated'
            });
        }

        // Check if staff exists
        const [existing] = await pool.query(
            'SELECT * FROM staff WHERE id = ?',
            [staffId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Staff member not found'
            });
        }

        // Update status
        await pool.query(
            'UPDATE staff SET status = ? WHERE id = ?',
            [status, staffId]
        );

        res.json({
            success: true,
            message: `Staff member ${status.toLowerCase()} successfully`,
            data: {
                id: staffId,
                status
            }
        });

    } catch (error) {
        console.error('Error updating staff status:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating staff status'
        });
    }
});

// Reset staff password
router.post('/:id/reset-password', auth, authorize(['SuperAdmin', 'Admin']), async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const staffId = req.params.id;

        // Check if staff exists
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

        // Generate new password
        const newPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password in users table
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

// Delete staff member (SuperAdmin only)
router.delete('/:id', auth, authorize(['SuperAdmin']), async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const staffId = req.params.id;

        // Check if staff exists
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

        // Delete from staff table
        await connection.query('DELETE FROM staff WHERE id = ?', [staffId]);

        // Delete user roles
        await connection.query('DELETE FROM user_roles WHERE user_id = ?', [existing[0].user_id]);

        // Delete from users table
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

// Get staff by branch
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

// Get staff by status
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

module.exports = router;