const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    connectionLimit: 100,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

async function runMigrations(connection) {

}

async function initializeDatabase() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log("Connected to database!");

        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createRolesTable = `
            CREATE TABLE IF NOT EXISTS roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE
            )
        `;

        const createUserRolesTable = `
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id VARCHAR(36),
                role_id INT,
                PRIMARY KEY (user_id, role_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (role_id) REFERENCES roles(id)
            )
        `;

        const createParentsTable = `
            CREATE TABLE IF NOT EXISTS parents (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(255) NOT NULL UNIQUE,
                email VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `;

        const createSuperAdminsTable = `
            CREATE TABLE IF NOT EXISTS super_admins (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(255) NOT NULL,
                image VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `;

        const createBranchesTable = `
            CREATE TABLE IF NOT EXISTS branches (
                id VARCHAR(36) PRIMARY KEY,
                school_name VARCHAR(255) NOT NULL,
                address VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                basic_education JSON NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createStaffTable = `
            CREATE TABLE IF NOT EXISTS staff (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                phone VARCHAR(255) NOT NULL,
                address VARCHAR(500),
                salary DECIMAL(10, 2) DEFAULT NULL,
                salary_type ENUM('monthly', 'hourly') DEFAULT 'monthly',
                gender ENUM('male', 'female', 'other') NOT NULL,
                description TEXT,
                role_id INT NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                class_id VARCHAR(36) DEFAULT NULL,
                image_url VARCHAR(500),
                status ENUM('Active', 'On Leave', 'Not Paid', 'Suspended', 'Terminated') NOT NULL DEFAULT 'Active',
                salary_due_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (role_id) REFERENCES roles(id),
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT
            )
        `;

        const createClassesTable = `
            CREATE TABLE IF NOT EXISTS classes (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                teacher_id VARCHAR(36) NOT NULL,
                total_student INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE RESTRICT
            )
        `;

        const addStaffClassForeignKey = `
            ALTER TABLE staff ADD CONSTRAINT fk_staff_class_id FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
        `;

        const createNewStudentTable = `
            CREATE TABLE IF NOT EXISTS new_students (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(10) NOT NULL UNIQUE,
                parent_id VARCHAR(36) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                dob DATE NOT NULL,
                passport VARCHAR(255) NOT NULL,
                address VARCHAR(255) NOT NULL,
                nationality VARCHAR(255) NOT NULL,
                state VARCHAR(255) NOT NULL,
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                previous_school VARCHAR(255),
                religion VARCHAR(255) NOT NULL,
                disability VARCHAR(255),
                score INT DEFAULT 0,
                payment_status VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
            )
        `;

        const createStudentTable = `
            CREATE TABLE IF NOT EXISTS students (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                parent_id VARCHAR(36) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                dob DATE NOT NULL,
                passport VARCHAR(255),
                address VARCHAR(255),
                nationality VARCHAR(255),
                state VARCHAR(255),
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                religion VARCHAR(255),
                disability VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE RESTRICT,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
            )
        `;

        const createEventsTable = `
            CREATE TABLE IF NOT EXISTS events (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                branch_id VARCHAR(36) NOT NULL,
                event_type VARCHAR(255) NOT NULL,
                event_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createExpensesTable = `
            CREATE TABLE IF NOT EXISTS expenses (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                cost DECIMAL(10, 2) NOT NULL,
                status ENUM('Requested', 'Pending', 'Approved', 'Overdue', 'Rejected') NOT NULL DEFAULT 'Requested',
                due_date DATE NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                author_id VARCHAR(36) NOT NULL,
                expense_type ENUM('Bill', 'Invoice', 'Repair') NOT NULL,
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        const createTermsTable = `
            CREATE TABLE IF NOT EXISTS terms (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                teacher_id VARCHAR(36) NOT NULL,
                total_student INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE RESTRICT
            )
        `;

        const createInventoryTable = `
            CREATE TABLE IF NOT EXISTS inventory (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL DEFAULT 0,
                branch_id VARCHAR(36) NOT NULL,
                added_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        const createExamsTable = `
            CREATE TABLE IF NOT EXISTS exams (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                exam_type ENUM('Internal', 'External') NOT NULL,
                subject_type ENUM('Multi-Subject', 'Single-Subject') NOT NULL,
                class_id VARCHAR(36),
                branch_id VARCHAR(36) NOT NULL,
                exam_date_time DATETIME NOT NULL,
                duration_hours DECIMAL(4, 2) NOT NULL,
                created_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        const createSubjectsTable = `
            CREATE TABLE IF NOT EXISTS subjects (
                id VARCHAR(36) PRIMARY KEY,
                exam_id VARCHAR(36) NOT NULL,
                title VARCHAR(255) NOT NULL,
                FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
            )
        `;

        const createQuestionsTable = `
            CREATE TABLE IF NOT EXISTS questions (
                id VARCHAR(36) PRIMARY KEY,
                subject_id VARCHAR(36) NOT NULL,
                question_text TEXT NOT NULL,
                options JSON NOT NULL,
                correct_answer_index INT NOT NULL,
                FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
            )
        `;

        const createExamResultsTable = `
            CREATE TABLE IF NOT EXISTS exam_results (
                id VARCHAR(36) PRIMARY KEY,
                exam_id VARCHAR(36) NOT NULL,
                student_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36),
                score DECIMAL(5, 2) NOT NULL,
                total_questions INT NOT NULL,
                answered_questions INT NOT NULL,
                answers JSON,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                published BOOLEAN DEFAULT FALSE,
                published_by VARCHAR(36),
                published_at TIMESTAMP NULL,
                FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE SET NULL,
                FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `;

        const createTimetablesTable = `
            CREATE TABLE IF NOT EXISTS timetables (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                timetable_data JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY (class_id),
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

        const createAssignmentsTable = `
            CREATE TABLE IF NOT EXISTS assignments (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                details TEXT,
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                teacher_id VARCHAR(36) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                due_date DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE CASCADE
            )
        `;

        const createBroadcastsTable = `
            CREATE TABLE IF NOT EXISTS broadcasts (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                created_by VARCHAR(36) NOT NULL,
                status ENUM('Sent', 'Draft') NOT NULL DEFAULT 'Draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                INDEX (title)
            )
        `;

        const createBroadcastTagsTable = `
            CREATE TABLE IF NOT EXISTS broadcast_tags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                broadcast_id VARCHAR(36) NOT NULL,
                tag VARCHAR(255) NOT NULL,
                FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
                INDEX (broadcast_id),
                INDEX (tag)
            )
        `;

        const createBroadcastCCTable = `
            CREATE TABLE IF NOT EXISTS broadcast_cc (
                id INT AUTO_INCREMENT PRIMARY KEY,
                broadcast_id VARCHAR(36) NOT NULL,
                role_name VARCHAR(255) NOT NULL,
                FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
                INDEX (broadcast_id),
                INDEX (role_name)
            )
        `;

        const createBroadcastReceiptsTable = `
            CREATE TABLE IF NOT EXISTS broadcast_receipts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                broadcast_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                status ENUM('Read', 'Unread') NOT NULL DEFAULT 'Unread',
                read_at TIMESTAMP NULL,
                FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY (broadcast_id, user_id),
                INDEX (broadcast_id),
                INDEX (user_id)
            )
        `;

        const createStaffAttendanceTable = `
            CREATE TABLE IF NOT EXISTS staff_attendance (
                id VARCHAR(36) PRIMARY KEY,
                staff_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                date DATE NOT NULL,
                status ENUM('Present', 'Absent', 'Leave') NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

        const createStudentAttendanceTable = `
            CREATE TABLE IF NOT EXISTS student_attendance (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                date DATE NOT NULL,
                status ENUM('Present', 'Absent', 'Late') NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_attendance (student_id, date),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

        const createBooksTable = `
            CREATE TABLE IF NOT EXISTS books (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                author VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                cover_image_url VARCHAR(255),
                amount INT NOT NULL DEFAULT 0,
                branch_id VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

        const createStudentBookPurchasesTable = `
            CREATE TABLE IF NOT EXISTS student_book_purchases (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                book_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                payment_status ENUM('Paid', 'Pending', 'Failed') NOT NULL,
                purchase_method ENUM('Online', 'Cash') NOT NULL DEFAULT 'Online',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

        const createFeesTable = `
            CREATE TABLE IF NOT EXISTS fees (
                id VARCHAR(36) PRIMARY KEY,
                branch_id VARCHAR(36) NOT NULL,
                class_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                description VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
            )
        `;

        const createPaymentsTable = `
            CREATE TABLE IF NOT EXISTS payments (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36) NOT NULL,
                amount_paid DECIMAL(10, 2) NOT NULL,
                payment_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
            )
        `;

        const createStudentPaymentStatusTable = `
            CREATE TABLE IF NOT EXISTS student_payment_statuses (
                student_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36) NOT NULL,
                status ENUM('Paid', 'Not Paid') NOT NULL DEFAULT 'Not Paid',
                PRIMARY KEY (student_id, term_id),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
            )
        `;

        const createEbooksTable = `
            CREATE TABLE IF NOT EXISTS ebooks (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                author VARCHAR(255) NOT NULL,
                description TEXT,
                cover_image_url VARCHAR(255),
                ebook_url VARCHAR(255) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                uploaded_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        const createIllnessLogsTable = `
            CREATE TABLE IF NOT EXISTS illness_logs (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                illness VARCHAR(255) NOT NULL,
                symptoms TEXT NOT NULL,
                treatment TEXT NOT NULL,
                admitted_at DATETIME NOT NULL,
                discharged_at DATETIME,
                notes TEXT,
                branch_id VARCHAR(36) NOT NULL,
                logged_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (logged_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        const createRevenueTable = `
            CREATE TABLE IF NOT EXISTS revenue (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36),
                parent_id VARCHAR(36),
                email VARCHAR(255) NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                reference VARCHAR(255) NOT NULL UNIQUE,
                status VARCHAR(50) NOT NULL,
                payment_for VARCHAR(100) NOT NULL,
                paid_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
                FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE SET NULL
            )
        `;

        // Create tables in the correct order
        await connection.query(createUsersTable);
        console.log("Users table created");
        await connection.query(createRolesTable);
        console.log("Roles table created");
        await connection.query(createUserRolesTable);
        console.log("User_roles table created");
        await connection.query(createParentsTable);
        console.log("Parents table created");
        await connection.query(createSuperAdminsTable);
        console.log("Super Admins table created");
        await connection.query(createBranchesTable);
        console.log("Branches table created");
        await connection.query(createStaffTable);
        console.log("Staff table created (without FK to classes)");
        await connection.query(createClassesTable);
        console.log("Classes table created");
        
        // Add the foreign key constraint back to staff
        try {
            await connection.query(addStaffClassForeignKey);
            console.log("Added foreign key from staff to classes");
        } catch (fkError) {
            if (fkError.code !== 'ER_FK_DUP_NAME') { // Ignore if the constraint already exists
                throw fkError;
            }
            console.log("Foreign key from staff to classes already exists.");
        }

        await connection.query(createStudentTable);
        console.log("Students table created");
        await connection.query(createNewStudentTable);
        console.log("New Students table created");
        await connection.query(createEventsTable);
        console.log("Events table created");
        await connection.query(createExpensesTable);
        console.log("Expenses table created");

        await connection.query(createStaffTable);
        console.log("Staff table created");

        await connection.query(createClassesTable);
        console.log("Classes table created");

        await connection.query(createInventoryTable);
        console.log("Inventory table created");

        await connection.query(createExamsTable);
        console.log("Exams table created");
        await connection.query(createSubjectsTable);
        console.log("Subjects table created");
        await connection.query(createQuestionsTable);
        console.log("Questions table created");
        await connection.query(createExamResultsTable);
        console.log("Exam results table created");
        await connection.query(createTimetablesTable);
        console.log("Timetables table created");
        await connection.query(createAssignmentsTable);
        console.log("Assignments table created");
        await connection.query(createBroadcastsTable);
        console.log("Broadcasts table created");
        await connection.query(createBroadcastTagsTable);
        console.log("Broadcast_tags table created");
        await connection.query(createBroadcastCCTable);
        console.log("Broadcast_cc table created");
        await connection.query(createBroadcastReceiptsTable);
        console.log("Broadcast_receipts table created");
        await connection.query(createStaffAttendanceTable);
        console.log("Staff attendance table created");
        await connection.query(createStudentAttendanceTable);
        console.log("Student attendance table created");
        await connection.query(createBooksTable);
        console.log("Books table created");
        await connection.query(createStudentBookPurchasesTable);
        console.log("Student book purchases table created");
        await connection.query(createFeesTable);
        console.log("Fees table created");
        await connection.query(createPaymentsTable);
        console.log("Payments table created");
        await connection.query(createStudentPaymentStatusTable);
        console.log("Student payment status table created");
        await connection.query(createEbooksTable);
        console.log("Ebooks table created");
        await connection.query(createIllnessLogsTable);
        console.log("Illness logs table created");
        await connection.query(createRevenueTable);
        console.log("Revenue table created");

        const roles = ['NewStudent', 'Student', 'Teacher', 'Parent', 'Admin', 'SuperAdmin', 'NonTeachingStaff'];
        for (const role of roles) {
            await connection.query('INSERT IGNORE INTO roles (name) VALUES (?)', [role]);
        }
        console.log("Roles inserted");

    } catch (err) {
        console.error("Database initialization error:", err);
        // process.exit(1);
    } finally {
        if (connection) connection.release();
    }
}

initializeDatabase();

module.exports = pool;
