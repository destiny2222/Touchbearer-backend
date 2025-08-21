require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const pool = require('./database');

async function setup() {
    const connection = await pool.getConnection();
    try {
        console.log('Setting up test data...');
        await connection.beginTransaction();

        // 1. Create a Branch
        const branchId = uuidv4();
        await connection.query('INSERT INTO branches (id, school_name, address, email, basic_education) VALUES (?, ?, ?, ?, ?)',
            [branchId, 'Test Branch', '123 Test St', 'branch@test.com', JSON.stringify(['nursery', 'primary'])]);
        console.log('Branch created');

        // 2. Create an Admin User and Staff
        const adminUserId = uuidv4();
        const adminPassword = await bcrypt.hash('password123', 10);
        await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
            [adminUserId, 'admin@test.com', adminPassword]);
        const [adminRole] = await connection.query("SELECT id FROM roles WHERE name = 'Admin'");
        await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [adminUserId, adminRole[0].id]);
        await connection.query('INSERT INTO staff (id, user_id, name, email, phone, role_id, branch_id, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [uuidv4(), adminUserId, 'Test Admin', 'admin@test.com', '1234567890', adminRole[0].id, branchId, 'male']);
        console.log('Admin user created');

        // 3. Create a Parent User and Parent
        const parentUserId = uuidv4();
        const parentPassword = await bcrypt.hash('password123', 10);
        await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
            [parentUserId, 'parent@test.com', parentPassword]);
        const [parentRole] = await connection.query("SELECT id FROM roles WHERE name = 'Parent'");
        await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [parentUserId, parentRole[0].id]);
        const parentId = uuidv4();
        await connection.query('INSERT INTO parents (id, user_id, name, phone, email) VALUES (?, ?, ?, ?, ?)',
            [parentId, parentUserId, 'Test Parent', '0987654321', 'parent@test.com']);
        console.log('Parent user created');

        // 4. Create a Class
        const [teacherRole] = await connection.query("SELECT id FROM roles WHERE name = 'Teacher'");
        const teacherUserId = uuidv4();
        await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
            [teacherUserId, 'teacher@test.com', await bcrypt.hash('password123', 10)]);
        await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [teacherUserId, teacherRole[0].id]);
        const teacherId = uuidv4();
        await connection.query('INSERT INTO staff (id, user_id, name, email, phone, role_id, branch_id, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [teacherId, teacherUserId, 'Test Teacher', 'teacher@test.com', '1122334455', teacherRole[0].id, branchId, 'female']);
        const classId = uuidv4();
        await connection.query('INSERT INTO classes (id, name, branch_id, teacher_id) VALUES (?, ?, ?, ?)',
            [classId, 'Test Class 1', branchId, teacherId]);
        console.log('Class created');

        // 5. Create a Student
        const studentUserId = uuidv4();
        await connection.query('INSERT INTO users (id, email, password) VALUES (?, ?, ?)',
            [studentUserId, 'student@test.com', await bcrypt.hash('password123', 10)]);
        const [studentRole] = await connection.query("SELECT id FROM roles WHERE name = 'Student'");
        await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [studentUserId, studentRole[0].id]);
        const studentId = uuidv4();
        await connection.query(
            'INSERT INTO students (id, user_id, parent_id, first_name, last_name, dob, class_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [studentId, studentUserId, parentId, 'Test', 'Student', '2010-01-01', classId, branchId]
        );
        console.log('Student created');

        await connection.commit();
        console.log('Test data setup complete.');
    } catch (error) {
        await connection.rollback();
        console.error('Error setting up test data:', error);
    } finally {
        connection.release();
        pool.end();
    }
}

setup();
