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
                phone VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `;

    const createNewStudentTable = `
            CREATE TABLE IF NOT EXISTS new_students (
                id VARCHAR(36) PRIMARY KEY,
                parent_id VARCHAR(36) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                dob DATE NOT NULL,
                passport VARCHAR(255) NOT NULL,
                address VARCHAR(255) NOT NULL,
                nationality VARCHAR(255) NOT NULL,
                state VARCHAR(255) NOT NULL,
                class_applying VARCHAR(255) NOT NULL,
                branch_id VARCHAR(255) NOT NULL,
                previous_school VARCHAR(255),
                religion VARCHAR(255) NOT NULL,
                disability VARCHAR(255),
                score INT DEFAULT 0,
                payment_status VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_id) REFERENCES parents(id)
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

    const createStudentTable = `
            CREATE TABLE IF NOT EXISTS students (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                parent_id VARCHAR(36) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                dob DATE NOT NULL,
                passport VARCHAR(255) NOT NULL,
                address VARCHAR(255) NOT NULL,
                nationality VARCHAR(255) NOT NULL,
                state VARCHAR(255) NOT NULL,
                class_admitted VARCHAR(255) NOT NULL,
                branch_id VARCHAR(255) NOT NULL,
                religion VARCHAR(255) NOT NULL,
                disability VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (parent_id) REFERENCES parents(id)
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

    await connection.query(createUsersTable);
    console.log("Users table created");

    await connection.query(createRolesTable);
    console.log("Roles table created");

    await connection.query(createUserRolesTable);
    console.log("User_roles table created");

    await connection.query(createParentsTable);
    console.log("Parents table created");

    await connection.query(createNewStudentTable);
    console.log("New Students table created");

    await connection.query(createSuperAdminsTable);
    console.log("Super Admins table created");

    await connection.query(createStudentTable);
    console.log("Students table created");

    await connection.query(createEventsTable);
    console.log("Events table created");

    const roles = ['NewStudent', 'Student', 'Teacher', 'Parent', 'Admin', 'SuperAdmin'];
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
