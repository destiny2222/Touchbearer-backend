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
            await connection.query('INSERT INTO parents (id, user_id, name, phone, email, dob, residential_address, occupation, workplace_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                parent_id,
                parentUserId,
                formData.parent_name,
                formData.parent_phone,
                formData.parent_email,
                formData.father_dob || null,
                formData.parent_residential_address || null,
                formData.father_occupation || null,
                formData.father_workplace_address || null
            ]);
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
            other_names: formData.other_names || null,
            surname_name: formData.surname_name || null,
            gender: formData.gender || null,
            dob: formData.dob,
            place_of_birth: formData.place_of_birth || null,
            passport: formData.passport,
            address: formData.address,
            nationality: formData.nationality,
            state: formData.state,
            tribe: formData.tribe || null,
            lga: formData.lga || null,
            class_id: formData.class_id,
            branch_id: formData.branch_id,
            previous_school: formData.previous_school || null,
            previous_class: formData.previous_class || null,
            last_term_result: formData.last_term_result || null,
            birth_certificate: formData.birth_certificate || null,
            medical_report: formData.medical_report || null,
            religion: formData.religion,
            blood_group: formData.blood_group || null,
            genotype: formData.genotype || null,
            allergies: formData.allergies || null,
            disability: formData.disability || null,
            expelled_or_suspended: formData.expelled_or_suspended || 'no',
            offence_details: formData.offence_details || null,
            applicant_type: formData.applicant_type || 'parent',
            parent_residential_address: formData.parent_residential_address || null,
            father_name: formData.father_name || null,
            father_phone: formData.father_phone || null,
            father_dob: formData.father_dob || null,
            father_occupation: formData.father_occupation || null,
            father_workplace_address: formData.father_workplace_address || null,
            mother_name: formData.mother_name || null,
            mother_phone: formData.mother_phone || null,
            mother_dob: formData.mother_dob || null,
            mother_occupation: formData.mother_occupation || null,
            mother_workplace_address: formData.mother_workplace_address || null,
            guardian_name: formData.guardian_name || null,
            guardian_residential_address: formData.guardian_residential_address || null,
            guardian_phone: formData.guardian_phone || null,
            guardian_dob: formData.guardian_dob || null,
            guardian_occupation: formData.guardian_occupation || null,
            guardian_workplace_address: formData.guardian_workplace_address || null,
            guardian_email: formData.guardian_email || null,
            emergency_contact_name: formData.emergency_contact_name || null,
            emergency_contact_address: formData.emergency_contact_address || null,
            emergency_contact_relationship: formData.emergency_contact_relationship || null,
            emergency_contact_phone: formData.emergency_contact_phone || null,
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
