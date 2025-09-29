const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { pool } = require('../database');
// Helper to generate a unique student ID
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

// Helper to generate a temporary password
function generatePassword() {
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';
    let password = '';
    for (let i = 0; i < length; i++) password += charset.charAt(Math.floor(Math.random() * charset.length));
    return password;
}

// Main service function
async function createNewStudentFromEnrollment(formData) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Step 1: Find or Create Parent
        let [parent] = await connection.query('SELECT * FROM parents WHERE email = ?', [formData.parent_email]);
        let parent_id;

        if (parent.length > 0) {
            parent_id = parent[0].id;
        } else {
            const parentUserId = uuidv4();
            const tempParentPassword = generatePassword();
            const hashedParentPassword = await bcrypt.hash(tempParentPassword, 10);
            await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [parentUserId, formData.parent_email, hashedParentPassword]);
            
            const [parentRole] = await connection.query("SELECT id FROM roles WHERE name = 'Parent'");
            await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [parentUserId, parentRole[0].id]);
            
            parent_id = uuidv4();
            await connection.query('INSERT INTO parents (id, user_id, name, phone, email) VALUES (?, ?, ?, ?, ?)', [parent_id, parentUserId, formData.parent_name, formData.parent_phone, formData.parent_email]);
        }
        
        // Step 2: Create User for New Student
        const student_id = await generateStudentId();
        const temporary_password = generatePassword();
        const hashedStudentPassword = await bcrypt.hash(temporary_password, 10);
        const studentUserId = uuidv4();
        await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)', [studentUserId, student_id, hashedStudentPassword]);

        const [newStudentRole] = await connection.query("SELECT id FROM roles WHERE name = 'NewStudent'");
        await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [studentUserId, newStudentRole[0].id]);

        // Step 3: Insert into new_students table
        const newStudentData = {
            id: uuidv4(),
            student_id,
            parent_id,
            first_name: formData.first_name,
            last_name: formData.last_name,
            dob: formData.dob,
            passport: formData.passport, // This now comes from the metadata
            address: formData.address,
            nationality: formData.nationality,
            state: formData.state,
            class_id: formData.class_id,
            branch_id: formData.branch_id,
            previous_school: formData.previous_school,
            religion: formData.religion,
            disability: formData.disability || null,
            payment_status: 'paid',
        };
        await connection.query('INSERT INTO new_students SET ?', newStudentData);

        await connection.commit();

        return {
            success: true,
            data: {
                student_id,
                temporary_password,
                full_name: `${formData.first_name} ${formData.last_name}`,
            }
        };

    } catch (error) {
        await connection.rollback();
        console.error('Enrollment Service Error:', error);
        return { success: false, message: 'An internal server error occurred.' };
    } finally {
        connection.release();
    }
}

module.exports = { createNewStudentFromEnrollment };