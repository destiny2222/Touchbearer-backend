// backend/routes/analytics.js

const express = require('express');
const router = express.Router();
const pool = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET /api/analytics/summary - Get aggregated data for all dashboard charts
router.get('/summary', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        let adminBranchId = null;

        // --- FIX: Determine Admin branch ID once at the start ---
        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                adminBranchId = staff[0].branch_id;
            }
        }

        // --- 1. Balance Analytics (Revenue vs Expenses over last 90 days) ---
        
        // FIX: Build revenue query conditions dynamically
        const revenueConditions = ['paid_at >= ?'];
        const revenueParams = [ninetyDaysAgo];
        if (adminBranchId) {
            // Correctly query revenue based on the student's branch
            revenueConditions.push('student_id IN (SELECT id FROM students WHERE branch_id = ?)');
            revenueParams.push(adminBranchId);
        }
        const revenueByDayQuery = `
            SELECT DATE(paid_at) as date, SUM(amount) as total
            FROM revenue
            WHERE ${revenueConditions.join(' AND ')}
            GROUP BY DATE(paid_at)
            ORDER BY date;
        `;
        const [revenueByDay] = await connection.query(revenueByDayQuery, revenueParams);

        // FIX: Build expense query conditions dynamically
        const expenseConditions = ['created_at >= ?'];
        const expenseParams = [ninetyDaysAgo];
        if (adminBranchId) {
            expenseConditions.push('branch_id = ?');
            expenseParams.push(adminBranchId);
        }
        const expensesByDayQuery = `
            SELECT DATE(created_at) as date, SUM(cost) as total
            FROM expenses
            WHERE ${expenseConditions.join(' AND ')}
            GROUP BY DATE(created_at)
            ORDER BY date;
        `;
        const [expensesByDay] = await connection.query(expensesByDayQuery, expenseParams);

        // --- 2. Revenue Source ---
        const [revenueSource] = await connection.query(
            `SELECT payment_for, SUM(amount) as total FROM revenue GROUP BY payment_for;`
        );
        
        // --- 3. School Population ---
        const populationParams = adminBranchId ? [adminBranchId] : [];
        const branchFilter = adminBranchId ? 'WHERE branch_id = ?' : '';
        
        const [[{ count: studentCount }]] = await connection.query(`SELECT COUNT(*) as count FROM students ${branchFilter}`, populationParams);
        const [[{ count: parentCount }]] = await connection.query(
            `SELECT COUNT(DISTINCT p.id) as count FROM parents p JOIN students s ON p.id = s.parent_id ${branchFilter.replace('branch_id', 's.branch_id')}`, populationParams
        );
        const [[{ count: newStudentCount }]] = await connection.query(`SELECT COUNT(*) as count FROM new_students ${branchFilter}`, populationParams);
        
        // --- 4. Recent Expenses (for the list view) ---
        const recentExpensesQuery = `
             SELECT e.*, s.name as author_name, b.school_name as branch_name 
             FROM expenses e
             LEFT JOIN staff s ON e.author_id = s.user_id
             LEFT JOIN branches b ON e.branch_id = b.id
             ${branchFilter.replace('branch_id', 'e.branch_id')}
             ORDER BY e.created_at DESC LIMIT 100
        `;
        const [recentExpenses] = await connection.query(recentExpensesQuery, populationParams);

        res.json({
            success: true,
            data: {
                balanceAnalytics: {
                    revenue: revenueByDay,
                    expenses: expensesByDay
                },
                revenueSource,
                population: {
                    students: studentCount,
                    parents: parentCount,
                    newStudents: newStudentCount,
                },
                recentExpenses
            }
        });

    } catch (error) {
        console.error('Analytics Summary Error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching analytics data.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/analytics/performance
// @desc    Get aggregated data for the performance page charts
// @access  Admin, SuperAdmin
router.get('/performance', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    const { period } = req.query; // 'Daily', 'Weekly', 'Monthly', 'End of Term', 'Mid Term'
    const connection = await pool.getConnection();

    try {
        let adminBranchId = null;
        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                adminBranchId = staff[0].branch_id;
            }
        }

        const branchFilter = adminBranchId ? `WHERE b.id = ${connection.escape(adminBranchId)}` : '';

        // Helper function to get date ranges
        const getDates = (period) => {
            const endDate = new Date();
            let startDate = new Date();
            switch (period) {
                case 'Daily':
                    startDate.setDate(endDate.getDate() - 1);
                    break;
                case 'Weekly':
                    startDate.setDate(endDate.getDate() - 7);
                    break;
                case 'Monthly':
                    startDate.setMonth(endDate.getMonth() - 1);
                    break;
                default:
                    startDate.setDate(endDate.getDate() - 7); // Default to weekly
            }
            return { startDate, endDate };
        };

        const { startDate, endDate } = getDates(period);

        // 1. Attendance Data
        const attendanceQuery = `
            SELECT
                b.school_name as branch,
                'students' as type,
                COUNT(sa.id) as total,
                SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) as present
            FROM student_attendance sa
            JOIN branches b ON sa.branch_id = b.id
            WHERE sa.date BETWEEN ? AND ?
            ${adminBranchId ? 'AND sa.branch_id = ?' : ''}
            GROUP BY b.school_name
            UNION ALL
            SELECT
                b.school_name as branch,
                'staffs' as type,
                COUNT(sa.id) as total,
                SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) as present
            FROM staff_attendance sa
            JOIN branches b ON sa.branch_id = b.id
            WHERE sa.date BETWEEN ? AND ?
            ${adminBranchId ? 'AND sa.branch_id = ?' : ''}
            GROUP BY b.school_name;
        `;
        const attendanceParams = adminBranchId ? [startDate, endDate, adminBranchId, startDate, endDate, adminBranchId] : [startDate, endDate, startDate, endDate];
        const [attendanceResults] = await connection.query(attendanceQuery, attendanceParams);

        const attendanceBarData = attendanceResults.reduce((acc, row) => {
            const branch = acc.find(item => item.branch === row.branch);
            const percentage = row.total > 0 ? (row.present / row.total) * 100 : 0;
            if (branch) {
                branch[row.type] = Math.round(percentage);
            } else {
                acc.push({
                    branch: row.branch,
                    [row.type]: Math.round(percentage)
                });
            }
            return acc;
        }, []);


        // 2. Discipline Data (Punctuality from attendance, project turnover is mocked)
        const punctualityQuery = `
            SELECT
                b.school_name as branch,
                COUNT(sa.id) as total,
                SUM(CASE WHEN sa.status = 'Late' THEN 1 ELSE 0 END) as late
            FROM student_attendance sa
            JOIN branches b ON sa.branch_id = b.id
            WHERE sa.date BETWEEN ? AND ?
            ${adminBranchId ? 'AND sa.branch_id = ?' : ''}
            GROUP BY b.school_name;
        `;
        const punctualityParams = adminBranchId ? [startDate, endDate, adminBranchId] : [startDate, endDate];
        const [punctualityResults] = await connection.query(punctualityQuery, punctualityParams);

        const disciplineData = punctualityResults.map(row => ({
            branch: row.branch,
            punctuality: row.total > 0 ? Math.round(((row.total - row.late) / row.total) * 100) : 100,
            projectTurnOver: Math.floor(Math.random() * 101) - 50 // Mock data for project turnover
        }));


        // 3. Academics Data
        const academicsQuery = `
            SELECT
                b.school_name as branch,
                e.exam_type,
                AVG(er.score) as average_score
            FROM exam_results er
            JOIN exams e ON er.exam_id = e.id
            JOIN branches b ON e.branch_id = b.id
            WHERE e.exam_date_time BETWEEN ? AND ?
            ${adminBranchId ? 'AND e.branch_id = ?' : ''}
            GROUP BY b.school_name, e.exam_type;
        `;
        const academicsParams = adminBranchId ? [startDate, endDate, adminBranchId] : [startDate, endDate];
        const [academicsResults] = await connection.query(academicsQuery, academicsParams);

        const academicsData = academicsResults.reduce((acc, row) => {
            let branch = acc.find(item => item.branch === row.branch);
            if (!branch) {
                branch = { branch: row.branch, unmeant: 0, exams: 0, tests: 0 };
                acc.push(branch);
            }
            const score = Math.round(row.average_score);
            if (row.exam_type === 'Exam') {
                branch.exams = score;
            } else if (row.exam_type === 'Test') {
                branch.tests = score;
            } else {
                branch.unmeant += score; // Sum up other types into unmeant
            }
            return acc;
        }, []);


        // For the line chart, we need daily attendance for the last 7 days
        const lineChartQuery = `
            SELECT
                DATE_FORMAT(date, '%a') as day,
                (SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) / COUNT(id)) * 100 as attendance
            FROM student_attendance
            WHERE date BETWEEN CURDATE() - INTERVAL 6 DAY AND CURDATE()
            ${adminBranchId ? 'AND branch_id = ?' : ''}
            GROUP BY day
            ORDER BY date;
        `;
        const lineChartParams = adminBranchId ? [adminBranchId] : [];
        const [attendanceLineData] = await connection.query(lineChartQuery, lineChartParams);


        res.json({
            success: true,
            data: {
                attendanceLineData,
                attendanceBarData,
                disciplineData,
                academicsData
            }
        });

    } catch (error) {
        console.error('Performance Analytics Error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching performance analytics data.' });
    } finally {
        connection.release();
    }
});

// @route   GET /api/analytics/analysis-page
// @desc    Get aggregated data for the analysis page charts
// @access  Admin, SuperAdmin
router.get('/analysis-page', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    const connection = await pool.getConnection();
    try {
        let adminBranchId = null;
        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                adminBranchId = staff[0].branch_id;
            }
        }

        const branchFilter = adminBranchId ? `AND b.id = ${connection.escape(adminBranchId)}` : '';
        const simpleBranchFilter = adminBranchId ? `WHERE branch_id = ${connection.escape(adminBranchId)}` : '';

        // 1. Gross Revenue by Branch
        const [grossRevenueData] = await connection.query(`
            SELECT b.school_name as name, SUM(r.amount) as value
            FROM revenue r
            JOIN students s ON r.student_id = s.id
            JOIN branches b ON s.branch_id = b.id
            ${simpleBranchFilter.replace('WHERE', 'WHERE').replace('branch_id', 's.branch_id')}
            GROUP BY b.school_name;
        `);

        // 2. Fees Data (mocked as the schema is unknown)
        const feesData = [
            { name: "Owing", value: 25, color: "#1e40af" },
            { name: "Deposit", value: 35, color: "#3b82f6" },
            { name: "Paid", value: 40, color: "#60a5fa" },
        ];

        // 3. Revenue Source
        const [revenueSourceData] = await connection.query(`
            SELECT payment_for as category, (SUM(amount) / (SELECT SUM(amount) FROM revenue)) * 100 as value
            FROM revenue
            ${simpleBranchFilter.replace('WHERE', 'WHERE').replace('branch_id', 'student_id IN (SELECT id FROM students WHERE branch_id = ' + connection.escape(adminBranchId) + ')')}
            GROUP BY payment_for;
        `);

        // 4. Monthly Revenue Trend (last 6 months)
        const [monthlyRevenueData] = await connection.query(`
            SELECT DATE_FORMAT(paid_at, '%b') as month, SUM(amount) as revenue
            FROM revenue
            WHERE paid_at >= CURDATE() - INTERVAL 6 MONTH
            ${simpleBranchFilter.replace('WHERE', 'AND').replace('branch_id', 'student_id IN (SELECT id FROM students WHERE branch_id = ' + connection.escape(adminBranchId) + ')')}
            GROUP BY month
            ORDER BY paid_at;
        `);

        // 5. School Population by Branch
        const [schoolPopulationData] = await connection.query(`
            SELECT 
                b.school_name as school,
                COUNT(DISTINCT s.id) as students,
                COUNT(DISTINCT s.parent_id) as parents,
                (SELECT COUNT(*) FROM new_students ns WHERE ns.branch_id = b.id) as newStudents
            FROM branches b
            LEFT JOIN students s ON b.id = s.branch_id
            ${branchFilter.replace('AND b.id', 'WHERE b.id')}
            GROUP BY b.id;
        `);

        // 6. Summary Cards Data
        const totalRevenue = grossRevenueData.reduce((sum, item) => sum + item.value, 0);
        const feesPaid = feesData.find((f) => f.name === "Paid")?.value ?? 0;
        const feesOwing = feesData.find((f) => f.name === "Owing")?.value ?? 0;
        const [totalBranches] = await connection.query(`SELECT COUNT(*) as count FROM branches ${simpleBranchFilter}`);
        const avgMonthlyRevenue = monthlyRevenueData.length > 0 ? totalRevenue / monthlyRevenueData.length : 0;


        res.json({
            success: true,
            data: {
                summaryCards: {
                    totalRevenue,
                    feesPaid,
                    feesOwing,
                    totalBranches: totalBranches[0].count,
                    avgMonthlyRevenue
                },
                grossRevenueData,
                feesData,
                revenueSourceData,
                monthlyRevenueData,
                schoolPopulationData,
            }
        });

    } catch (error) {
        console.error('Analytics Summary Error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching analytics data.' });
    } finally {
        connection.release();
    }
});

module.exports = router;