const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
};

const dbName = process.env.DB_NAME;

// Create a connection pool with the database name.
// The pool will lazily create connections, so this is safe even if the DB doesn't exist yet.
const pool = mysql.createPool({
  connectionLimit: 10000,
  ...dbConfig,
  database: dbName,
});

async function initializeDatabase() {
  let connection;
  try {
    // First, create a temporary connection without a DB to create the database if it's missing.
    const tempConnection = await mysql.createConnection(dbConfig);
    console.log("Connected to MySQL server!");

    // Create the database if it doesn't exist
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`Database "${dbName}" created or already exists.`);
    await tempConnection.end();

    // Now, get a connection from the main pool (which now points to the correct DB) to create tables.
    connection = await pool.getConnection();
    console.log(`Connected to database "${dbName}"!`);

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
                dob VARCHAR(5),
                residential_address VARCHAR(255),
                occupation VARCHAR(255),
                workplace_address VARCHAR(255),
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
                site_name VARCHAR(255),
                address VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                basic_education JSON NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const createBranchLocationsTable = `
            CREATE TABLE IF NOT EXISTS branch_locations (
                branch_id VARCHAR(36) NOT NULL PRIMARY KEY,
                latitude DECIMAL(9,6) NOT NULL,
                longitude DECIMAL(9,6) NOT NULL,
                radius_meters INT NOT NULL DEFAULT 200,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
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
                permissions JSON DEFAULT NULL,
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
                arm VARCHAR(100),
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

    const createClassSubjectsTable = `
            CREATE TABLE IF NOT EXISTS class_subjects (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                class_id VARCHAR(36) NOT NULL,
                teacher_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE RESTRICT,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

    const createNewStudentTable = `
            CREATE TABLE IF NOT EXISTS new_students (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(10) NOT NULL UNIQUE,
                parent_id VARCHAR(36) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                other_names VARCHAR(255),
                surname_name VARCHAR(255),
                gender ENUM('male','female','other'),
                dob DATE NOT NULL,
                place_of_birth VARCHAR(255),
                passport VARCHAR(255) NOT NULL,
                address VARCHAR(255) NOT NULL,
                nationality VARCHAR(255) NOT NULL,
                state VARCHAR(255) NOT NULL,
                tribe VARCHAR(255),
                lga VARCHAR(255),
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                previous_school VARCHAR(255),
                previous_class VARCHAR(255),
                last_term_result VARCHAR(255),
                birth_certificate VARCHAR(255),
                medical_report VARCHAR(255),
                religion VARCHAR(255) NOT NULL,
                blood_group VARCHAR(5),
                genotype VARCHAR(5),
                allergies VARCHAR(255),
                disability VARCHAR(255),
                expelled_or_suspended ENUM('yes','no') DEFAULT 'no',
                offence_details TEXT,
                applicant_type ENUM('parent','guardian','self') DEFAULT 'parent',
                parent_residential_address VARCHAR(255),
                father_name VARCHAR(255),
                father_phone VARCHAR(50),
                father_dob VARCHAR(5),
                father_occupation VARCHAR(255),
                father_workplace_address VARCHAR(255),
                mother_name VARCHAR(255),
                mother_phone VARCHAR(50),
                mother_dob VARCHAR(5),
                mother_occupation VARCHAR(255),
                mother_workplace_address VARCHAR(255),
                guardian_name VARCHAR(255),
                guardian_residential_address VARCHAR(255),
                guardian_phone VARCHAR(50),
                guardian_dob DATE,
                guardian_occupation VARCHAR(255),
                guardian_workplace_address VARCHAR(255),
                guardian_email VARCHAR(255),
                emergency_contact_name VARCHAR(255),
                emergency_contact_address VARCHAR(255),
                emergency_contact_relationship VARCHAR(255),
                emergency_contact_phone VARCHAR(50),
                score INT DEFAULT 0,
                payment_status VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
            )
        `;

    const createStudentStatusesTable = `
            CREATE TABLE IF NOT EXISTS student_statuses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL UNIQUE
            )
        `;

    const createStudentTable = `
            CREATE TABLE IF NOT EXISTS students (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                parent_id VARCHAR(36) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                surname_name VARCHAR(255),
                other_names VARCHAR(255),
                gender ENUM('male','female','other'),
                dob DATE NOT NULL,
                place_of_birth VARCHAR(255),
                passport VARCHAR(255),
                address VARCHAR(255) NOT NULL,
                nationality VARCHAR(255) NOT NULL,
                state VARCHAR(255) NOT NULL,
                lga VARCHAR(255),
                tribe VARCHAR(255),
                class_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                status_id INT DEFAULT 1,
                previous_school VARCHAR(255),
                previous_class VARCHAR(255),
                last_term_result VARCHAR(255),
                birth_certificate VARCHAR(255),
                medical_report VARCHAR(255),
                religion VARCHAR(255) NOT NULL,
                disability VARCHAR(255),
                blood_group VARCHAR(5),
                genotype VARCHAR(5),
                allergies VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE RESTRICT,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (status_id) REFERENCES student_statuses(id)
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
                session VARCHAR(50),
                branch_id VARCHAR(36),
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                next_term_begins DATE NULL,
                is_active BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
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
                assessment_type ENUM('ca1', 'ca2', 'ca3', 'ca4', 'exam') NOT NULL,
                subject_type ENUM('Multi-Subject', 'Single-Subject') NOT NULL,
                class_subject_id VARCHAR(36),
                class_id VARCHAR(36),
                branch_id VARCHAR(36) NOT NULL,
                exam_date_time DATETIME NOT NULL,
                duration_minutes INT NOT NULL,
                created_by VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

    const createQuestionsTable = `
            CREATE TABLE IF NOT EXISTS questions (
                id VARCHAR(36) PRIMARY KEY,
                exam_id VARCHAR(36) NOT NULL,
                class_subject_id VARCHAR(36) NOT NULL,
                question_text TEXT NOT NULL,
                options JSON NOT NULL,
                correct_answer_index INT NOT NULL,
                FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
                FOREIGN KEY (class_subject_id) REFERENCES class_subjects(id) ON DELETE CASCADE
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

    const createBroadcastBranchesTable = `
            CREATE TABLE IF NOT EXISTS broadcast_branches (
                id INT AUTO_INCREMENT PRIMARY KEY,
                broadcast_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                UNIQUE KEY (broadcast_id, branch_id),
                INDEX (broadcast_id),
                INDEX (branch_id)
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

    const createStaffAttendanceLogsTable = `
            CREATE TABLE IF NOT EXISTS staff_attendance_logs (
                id VARCHAR(36) PRIMARY KEY,
                staff_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                date DATE NOT NULL,
                clock_in_time DATETIME NULL,
                clock_out_time DATETIME NULL,
                clock_in_latitude DECIMAL(9,6) NULL,
                clock_in_longitude DECIMAL(9,6) NULL,
                clock_out_latitude DECIMAL(9,6) NULL,
                clock_out_longitude DECIMAL(9,6) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_staff_date (staff_id, date),
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

    const createShopItemsTable = `
            CREATE TABLE IF NOT EXISTS shop_items (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                details VARCHAR(255),
                description TEXT,
                price DECIMAL(10, 2) NOT NULL,
                stock INT NOT NULL DEFAULT 0,
                branch_id VARCHAR(36) NOT NULL,
                category VARCHAR(100),
                image_url VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

    const createShopSalesTable = `
            CREATE TABLE IF NOT EXISTS shop_sales (
                id VARCHAR(36) PRIMARY KEY,
                item_id VARCHAR(36) NOT NULL,
                student_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                purchase_method ENUM('Online', 'Cash') NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `;

    const createFeesTable = `
            CREATE TABLE IF NOT EXISTS fees (
                id VARCHAR(36) PRIMARY KEY,
                branch_id VARCHAR(36) NOT NULL,
                class_id VARCHAR(36) NOT NULL,
                arm VARCHAR(100),
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

    const createStudentResultsTable = `
            CREATE TABLE IF NOT EXISTS student_results (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                class_id VARCHAR(36) NOT NULL,
                subject_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36),
                assessment_type ENUM('ca1', 'ca2', 'ca3', 'ca4', 'exam') NOT NULL,
                score DECIMAL(5, 2) NOT NULL,
                teacher_id VARCHAR(36) NOT NULL,
                branch_id VARCHAR(36) NOT NULL,
                published BOOLEAN DEFAULT FALSE,
                published_by VARCHAR(36),
                published_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_student_subject_term_assessment (student_id, subject_id, term_id, assessment_type),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (subject_id) REFERENCES class_subjects(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE SET NULL,
                FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE RESTRICT,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `;

    const createStudentSkillsTable = `
            CREATE TABLE IF NOT EXISTS student_skills (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36) NOT NULL,
                skill_type ENUM('Affective', 'Psychomotor') NOT NULL,
                skill_name VARCHAR(255) NOT NULL,
                rating INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_skill (student_id, term_id, skill_type, skill_name),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
            )
        `;

    const createReportCardCommentsTable = `
            CREATE TABLE IF NOT EXISTS report_card_comments (
                id VARCHAR(36) PRIMARY KEY,
                student_id VARCHAR(36) NOT NULL,
                term_id VARCHAR(36) NOT NULL,
                teacher_comment TEXT,
                principal_comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_comment (student_id, term_id),
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
            )
        `;

    const createEnrollmentFeesTable = `
            CREATE TABLE IF NOT EXISTS enrollment_fees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                branch_id VARCHAR(36) NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY (branch_id),
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
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

    // Add new fields to existing parents table if they don't exist
    try {
      // Check and add columns one by one for better compatibility
      const [parentColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'parents'
            `,
        [dbName]
      );

      const existingParentCols = parentColumns.map((row) => row.COLUMN_NAME);

      if (!existingParentCols.includes("dob")) {
        await connection.query("ALTER TABLE parents ADD COLUMN dob VARCHAR(5)");
        console.log("Added 'dob' column to parents table");
      }
      if (!existingParentCols.includes("residential_address")) {
        await connection.query(
          "ALTER TABLE parents ADD COLUMN residential_address VARCHAR(255)"
        );
        console.log("Added 'residential_address' column to parents table");
      }
      if (!existingParentCols.includes("occupation")) {
        await connection.query(
          "ALTER TABLE parents ADD COLUMN occupation VARCHAR(255)"
        );
        console.log("Added 'occupation' column to parents table");
      }
      if (!existingParentCols.includes("workplace_address")) {
        await connection.query(
          "ALTER TABLE parents ADD COLUMN workplace_address VARCHAR(255)"
        );
        console.log("Added 'workplace_address' column to parents table");
      }
      console.log("Parents table fields checked and updated");
    } catch (error) {
      console.log("Error updating parents table fields:", error.message);
    }
    await connection.query(createSuperAdminsTable);
    console.log("Super Admins table created");
    await connection.query(createBranchesTable);
    console.log("Branches table created");

    // Add site_name column to branches if it doesn't exist
    try {
      const [branchColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'branches'
            `,
        [dbName]
      );

      const existingBranchCols = branchColumns.map((row) => row.COLUMN_NAME);

      if (!existingBranchCols.includes("site_name")) {
        await connection.query(
          "ALTER TABLE branches ADD COLUMN site_name VARCHAR(255) AFTER school_name"
        );
        console.log("Added 'site_name' column to branches table");
      }
    } catch (error) {
      console.log("Error updating branches table:", error.message);
    }

    await connection.query(createBranchLocationsTable);
    console.log("Branch locations table created");
    await connection.query(createStaffTable);
    console.log("Staff table created (without FK to classes)");

    // Add permissions column to staff if it doesn't exist
    try {
      const [staffColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'staff'
            `,
        [dbName]
      );

      const existingStaffCols = staffColumns.map((row) => row.COLUMN_NAME);

      if (!existingStaffCols.includes("permissions")) {
        await connection.query(
          "ALTER TABLE staff ADD COLUMN permissions JSON DEFAULT NULL AFTER salary_due_date"
        );
        console.log("Added 'permissions' column to staff table");
      }
    } catch (error) {
      console.log("Error updating staff table:", error.message);
    }

    await connection.query(createClassesTable);
    console.log("Classes table created");

    // Add arm column to classes if it doesn't exist
    try {
      const [classColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'classes'
            `,
        [dbName]
      );

      const existingClassCols = classColumns.map((row) => row.COLUMN_NAME);

      if (!existingClassCols.includes("arm")) {
        await connection.query(
          "ALTER TABLE classes ADD COLUMN arm VARCHAR(100) AFTER name"
        );
        console.log("Added 'arm' column to classes table");
      }
    } catch (error) {
      console.log("Error updating classes table:", error.message);
    }

    // Add the foreign key constraint back to staff
    try {
      await connection.query(addStaffClassForeignKey);
      console.log("Added foreign key from staff to classes");
    } catch (fkError) {
      if (fkError.code !== "ER_FK_DUP_NAME") {
        // Ignore if the constraint already exists
        throw fkError;
      }
      console.log("Foreign key from staff to classes already exists.");
    }

    await connection.query(createClassSubjectsTable);
    console.log("Class subjects table created");

    await connection.query(createStudentStatusesTable);
    console.log("Student statuses table created");

    await connection.query(createStudentTable);
    console.log("Students table created");

    // Add missing columns to existing students table
    try {
      const [studentColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'students'
            `,
        [dbName]
      );

      const existingStudentCols = studentColumns.map((row) => row.COLUMN_NAME);

      if (!existingStudentCols.includes("surname_name")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN surname_name VARCHAR(255) AFTER last_name"
        );
        console.log("Added 'surname_name' column to students table");
      }
      if (!existingStudentCols.includes("other_names")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN other_names VARCHAR(255) AFTER surname_name"
        );
        console.log("Added 'other_names' column to students table");
      }
      if (!existingStudentCols.includes("gender")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN gender ENUM('male','female','other') AFTER other_names"
        );
        console.log("Added 'gender' column to students table");
      }
      if (!existingStudentCols.includes("place_of_birth")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN place_of_birth VARCHAR(255) AFTER dob"
        );
        console.log("Added 'place_of_birth' column to students table");
      }
      if (!existingStudentCols.includes("lga")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN lga VARCHAR(255) AFTER state"
        );
        console.log("Added 'lga' column to students table");
      }
      if (!existingStudentCols.includes("tribe")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN tribe VARCHAR(255) AFTER lga"
        );
        console.log("Added 'tribe' column to students table");
      }
      if (!existingStudentCols.includes("previous_school")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN previous_school VARCHAR(255) AFTER branch_id"
        );
        console.log("Added 'previous_school' column to students table");
      }
      if (!existingStudentCols.includes("previous_class")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN previous_class VARCHAR(255) AFTER previous_school"
        );
        console.log("Added 'previous_class' column to students table");
      }
      if (!existingStudentCols.includes("last_term_result")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN last_term_result VARCHAR(255) AFTER previous_class"
        );
        console.log("Added 'last_term_result' column to students table");
      }
      if (!existingStudentCols.includes("birth_certificate")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN birth_certificate VARCHAR(255) AFTER last_term_result"
        );
        console.log("Added 'birth_certificate' column to students table");
      }
      if (!existingStudentCols.includes("medical_report")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN medical_report VARCHAR(255) AFTER birth_certificate"
        );
        console.log("Added 'medical_report' column to students table");
      }
      if (!existingStudentCols.includes("blood_group")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN blood_group VARCHAR(5) AFTER disability"
        );
        console.log("Added 'blood_group' column to students table");
      }
      if (!existingStudentCols.includes("genotype")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN genotype VARCHAR(5) AFTER blood_group"
        );
        console.log("Added 'genotype' column to students table");
      }
      if (!existingStudentCols.includes("allergies")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN allergies VARCHAR(255) AFTER genotype"
        );
        console.log("Added 'allergies' column to students table");
      }

      console.log("Students table columns checked and updated");
    } catch (error) {
      console.log("Error adding columns to students table:", error.message);
    }

    // Update existing students table to ensure required fields are NOT NULL (only if columns exist)
    try {
      await connection.query(`
                ALTER TABLE students 
                MODIFY COLUMN address VARCHAR(255) NOT NULL,
                MODIFY COLUMN nationality VARCHAR(255) NOT NULL,
                MODIFY COLUMN state VARCHAR(255) NOT NULL,
                MODIFY COLUMN religion VARCHAR(255) NOT NULL
            `);
      console.log("Students table schema updated with NOT NULL constraints");
    } catch (error) {
      if (error.code !== "ER_BAD_NULL_ERROR") {
        console.log(
          "Students table schema already up to date or error:",
          error.message
        );
      } else {
        console.log(
          "Warning: Some students have NULL values in required fields. Please update data first."
        );
      }
    }

    await connection.query(createNewStudentTable);
    console.log("New Students table created");
    await connection.query(createEventsTable);
    console.log("Events table created");
    await connection.query(createExpensesTable);
    console.log("Expenses table created");
    await connection.query(createTermsTable);
    console.log("Terms table created");

    // Add session column to terms if it doesn't exist
    try {
      const [termColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'terms'
            `,
        [dbName]
      );

      const existingTermCols = termColumns.map((row) => row.COLUMN_NAME);

      if (!existingTermCols.includes("session")) {
        await connection.query(
          "ALTER TABLE terms ADD COLUMN session VARCHAR(50) AFTER name"
        );
        console.log("Added 'session' column to terms table");
      }
      if (!existingTermCols.includes("next_term_begins")) {
        await connection.query(
          "ALTER TABLE terms ADD COLUMN next_term_begins DATE NULL AFTER end_date"
        );
        console.log("Added 'next_term_begins' column to terms table");
      }
    } catch (error) {
      console.log("Error updating terms table:", error.message);
    }
    await connection.query(createExamsTable);
    console.log("Exams table created");

    // Add/update columns in the exams table
    try {
      const [examColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exams'
            `,
        [dbName]
      );

      const existingExamCols = examColumns.map((row) => row.COLUMN_NAME);

      if (!existingExamCols.includes("class_subject_id")) {
        await connection.query(
          "ALTER TABLE exams ADD COLUMN class_subject_id VARCHAR(36) AFTER subject_type"
        );
        console.log("Added 'class_subject_id' column to exams table");
      }
      if (!existingExamCols.includes("assessment_type")) {
        await connection.query(
          "ALTER TABLE exams ADD COLUMN assessment_type ENUM('ca1', 'ca2', 'ca3', 'ca4', 'exam') NOT NULL AFTER exam_type"
        );
        console.log("Added 'assessment_type' column to exams table");
      }
      // // adding ca4
      //     await connection.query(
      //           "ALTER TABLE exams MODIFY COLUMN assessment_type ENUM('ca1', 'ca2', 'ca3', 'ca4', 'exam') NOT NULL"
      //     );

      //     await connection.query(
      //           "ALTER TABLE student_results MODIFY COLUMN assessment_type ENUM('ca1', 'ca2', 'ca3', 'ca4', 'exam') NOT NULL"
      //     );
      if (existingExamCols.includes("duration_hours")) {
        await connection.query(
          "ALTER TABLE exams CHANGE COLUMN duration_hours duration_minutes INT NOT NULL"
        );
        console.log(
          "Changed 'duration_hours' to 'duration_minutes' in exams table"
        );
      } else if (!existingExamCols.includes("duration_minutes")) {
        await connection.query(
          "ALTER TABLE exams ADD COLUMN duration_minutes INT NOT NULL AFTER exam_date_time"
        );
        console.log("Added 'duration_minutes' column to exams table");
      }
    } catch (error) {
      console.log("Error updating exams table:", error.message);
    }

    // Drop the redundant subjects table if it exists
    await connection.query("DROP TABLE IF EXISTS subjects");
    console.log("Redundant 'subjects' table dropped if it existed.");

    // Drop and recreate questions table with correct foreign keys
    await connection.query(createQuestionsTable);
    console.log("Questions table recreated with correct schema.");
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
    await connection.query(createBroadcastBranchesTable);
    console.log("Broadcast_branches table created");
    await connection.query(createStaffAttendanceTable);
    console.log("Staff attendance table created");
    await connection.query(createStaffAttendanceLogsTable);
    console.log("Staff attendance logs table created");
    await connection.query(createStudentAttendanceTable);
    console.log("Student attendance table created");

    // Drop old bookshop tables if they exist
    await connection.query("DROP TABLE IF EXISTS student_book_purchases");
    await connection.query("DROP TABLE IF EXISTS books");
    console.log("Old bookshop tables dropped.");

    await connection.query(createShopItemsTable);
    console.log("Shop items table created");
    await connection.query(createShopSalesTable);
    console.log("Shop sales table created");

    await connection.query(createFeesTable);
    console.log("Fees table created");

    // Add arm column to fees if it doesn't exist
    try {
      const [feeColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'fees'
            `,
        [dbName]
      );

      const existingFeeCols = feeColumns.map((row) => row.COLUMN_NAME);

      if (!existingFeeCols.includes("arm")) {
        await connection.query(
          "ALTER TABLE fees ADD COLUMN arm VARCHAR(100) AFTER class_id"
        );
        console.log("Added 'arm' column to fees table");
      }
    } catch (error) {
      console.log("Error updating fees table:", error.message);
    }
    await connection.query(createPaymentsTable);
    console.log("Payments table created");
    await connection.query(createStudentPaymentStatusTable);
    console.log("Student payment status table created");
    await connection.query(createEbooksTable);
    console.log("Ebooks table created");
    await connection.query(createIllnessLogsTable);
    console.log("Illness logs table created");
    await connection.query(createInventoryTable);
    console.log("Inventory table created");
    await connection.query(createRevenueTable);
    console.log("Revenue table created");
    await connection.query(createStudentResultsTable);
    console.log("Student results table created");

    try {
      const [studentResultsColumns] = await connection.query(
        `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_results'
    `,
        [dbName]
      );

      const existingStudentResultsCols = studentResultsColumns.map(
        (row) => row.COLUMN_NAME
      );

      if (!existingStudentResultsCols.includes("school_type")) {
        await connection.query(
          "ALTER TABLE student_results ADD COLUMN school_type VARCHAR(100) DEFAULT 'Grade School' AFTER published_at"
        );
        console.log("Added 'school_type' column to student_results table");
      }
    } catch (error) {
      console.log("Error updating student_results table:", error.message);
    }
    await connection.query(createStudentSkillsTable);
    console.log("Student skills table created");
    await connection.query(createReportCardCommentsTable);
    console.log("Report card comments table created");

    await connection.query(createEnrollmentFeesTable);
    console.log("Enrollment fees table created");

    // Add exam_id to student_results if it doesn't exist
    try {
      const [resultColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_results'
            `,
        [dbName]
      );

      const existingResultCols = resultColumns.map((row) => row.COLUMN_NAME);

      if (!existingResultCols.includes("exam_id")) {
        await connection.query(
          "ALTER TABLE student_results ADD COLUMN exam_id VARCHAR(36) NULL AFTER branch_id"
        );
        console.log("Added 'exam_id' column to student_results table");
      }
    } catch (error) {
      console.log("Error updating student_results table:", error.message);
    }

    // Add status_id to students if it doesn't exist
    try {
      const [studentCols] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'students'
            `,
        [dbName]
      );
      const existingStudentCols = studentCols.map((c) => c.COLUMN_NAME);
      if (!existingStudentCols.includes("status_id")) {
        await connection.query(
          "ALTER TABLE students ADD COLUMN status_id INT DEFAULT 1"
        );
        await connection.query(
          "ALTER TABLE students ADD CONSTRAINT fk_status_id FOREIGN KEY (status_id) REFERENCES student_statuses(id)"
        );
        console.log(
          "Added 'status_id' column and foreign key to students table"
        );
      }
    } catch (error) {
      console.log(
        "Error updating students table for status_id:",
        error.message
      );
    }

    // Add published fields to student_results if they don't exist
    try {
      const [resultColumns] = await connection.query(
        `
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_results'
            `,
        [dbName]
      );

      const existingResultCols = resultColumns.map((row) => row.COLUMN_NAME);

      if (!existingResultCols.includes("published")) {
        await connection.query(
          "ALTER TABLE student_results ADD COLUMN published BOOLEAN DEFAULT FALSE AFTER branch_id"
        );
        console.log("Added 'published' column to student_results table");
      }
      if (!existingResultCols.includes("published_by")) {
        await connection.query(
          "ALTER TABLE student_results ADD COLUMN published_by VARCHAR(36) AFTER published"
        );
        console.log("Added 'published_by' column to student_results table");
      }
      if (!existingResultCols.includes("published_at")) {
        await connection.query(
          "ALTER TABLE student_results ADD COLUMN published_at TIMESTAMP NULL AFTER published_by"
        );
        console.log("Added 'published_at' column to student_results table");
      }

      // Add foreign key for published_by if it doesn't exist
      try {
        const [constraints] = await connection.query(
          `
                    SELECT CONSTRAINT_NAME 
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_results' AND COLUMN_NAME = 'published_by' AND CONSTRAINT_NAME LIKE 'fk_%'
                `,
          [dbName]
        );

        if (
          constraints.length === 0 &&
          existingResultCols.includes("published_by")
        ) {
          await connection.query(
            "ALTER TABLE student_results ADD CONSTRAINT fk_results_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL"
          );
          console.log(
            "Added foreign key for 'published_by' to student_results table"
          );
        }
      } catch (fkError) {
        console.log(
          "Foreign key for published_by may already exist or error:",
          fkError.message
        );
      }
    } catch (error) {
      console.log("Error updating student_results table:", error.message);
    }

    const roles = [
      "NewStudent",
      "Student",
      "Teacher",
      "Parent",
      "Admin",
      "SuperAdmin",
      "NonTeachingStaff",
    ];
    for (const role of roles) {
      await connection.query("INSERT IGNORE INTO roles (name) VALUES (?)", [
        role,
      ]);
    }
    console.log("Roles inserted");

    const statuses = ["Active", "Graduated", "Suspended", "Withdrawn"];
    for (const status of statuses) {
      await connection.query(
        "INSERT IGNORE INTO student_statuses (name) VALUES (?)",
        [status]
      );
    }
    console.log("Student statuses inserted");

    // Seed SuperAdmin
    const superAdminEmail = "gritindeveloper@gmail.com";
    const [existingSuperAdmin] = await connection.query(
      "SELECT id FROM users WHERE email = ?",
      [superAdminEmail]
    );

    if (existingSuperAdmin.length === 0) {
      const userId = uuidv4();
      const password = "torchbearer@4321";
      const hashedPassword = await bcrypt.hash(password, 10);

      await connection.query(
        "INSERT INTO users (id, email, password) VALUES (?, ?, ?)",
        [userId, superAdminEmail, hashedPassword]
      );

      const [superAdminRole] = await connection.query(
        "SELECT id FROM roles WHERE name = ?",
        ["SuperAdmin"]
      );
      if (superAdminRole.length > 0) {
        await connection.query(
          "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
          [userId, superAdminRole[0].id]
        );
      }

      const superAdminId = uuidv4();
      await connection.query(
        "INSERT INTO super_admins (id, user_id, name, phone) VALUES (?, ?, ?, ?)",
        [superAdminId, userId, "Default Super Admin", "0000000000"]
      );

      console.log("Default SuperAdmin created successfully.");
    }
  } catch (err) {
    console.error("Database initialization error:", err);
    process.exit(1); // Exit if DB initialization fails
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { pool, initializeDatabase };
