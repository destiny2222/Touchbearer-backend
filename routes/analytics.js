// backend/routes/analytics.js

const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET /api/analytics/summary - Get aggregated data for all dashboard charts
router.get('/summary', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        let adminBranchId = null;

        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                adminBranchId = staff[0].branch_id;
            } else {
                // If an admin is not linked to a branch, return empty data to prevent errors
                return res.json({ success: true, data: { balanceAnalytics: { revenue: [], expenses: [] }, revenueSource: [], population: {}, recentExpenses: [] } });
            }
        }

        // --- 1. Balance Analytics (Revenue vs Expenses over last 90 days) ---
        let revenueQuery = `
            SELECT DATE(r.paid_at) as date, SUM(r.amount) as total
            FROM revenue r
            WHERE r.paid_at >= ?
        `;
        const revenueParams = [ninetyDaysAgo];

        if (adminBranchId) {
            revenueQuery += ' AND r.student_id IN (SELECT id FROM students WHERE branch_id = ?)';
            revenueParams.push(adminBranchId);
        }
        revenueQuery += ' GROUP BY DATE(r.paid_at) ORDER BY date;';
        const [revenueByDay] = await connection.query(revenueQuery, revenueParams);

        let expensesQuery = `
            SELECT DATE(created_at) as date, SUM(cost) as total
            FROM expenses
            WHERE created_at >= ?
        `;
        const expenseParams = [ninetyDaysAgo];

        if (adminBranchId) {
            expensesQuery += ' AND branch_id = ?';
            expenseParams.push(adminBranchId);
        }
        expensesQuery += ' GROUP BY DATE(created_at) ORDER BY date;';
        const [expensesByDay] = await connection.query(expensesQuery, expenseParams);


        // --- 2. Revenue Source ---
        // FIX: Added branch filtering for Admins
        let revenueSourceQuery = `
            SELECT r.payment_for, SUM(r.amount) as total
            FROM revenue r
        `;
        const revenueSourceParams = [];

        if (adminBranchId) {
            revenueSourceQuery += ' LEFT JOIN students s ON r.student_id = s.id WHERE s.branch_id = ?';
            revenueSourceParams.push(adminBranchId);
        }
        revenueSourceQuery += ' GROUP BY r.payment_for;';
        const [revenueSource] = await connection.query(revenueSourceQuery, revenueSourceParams);


        // --- 3. School Population ---
        const populationParams = adminBranchId ? [adminBranchId] : [];
        const branchFilter = adminBranchId ? 'WHERE branch_id = ?' : '';
        const studentBranchFilter = adminBranchId ? 'WHERE s.branch_id = ?' : '';

        const [[{ count: studentCount }]] = await connection.query(`SELECT COUNT(*) as count FROM students ${branchFilter}`, populationParams);
        const [[{ count: parentCount }]] = await connection.query(`SELECT COUNT(DISTINCT p.id) as count FROM parents p JOIN students s ON p.id = s.parent_id ${studentBranchFilter}`, populationParams);
        const [[{ count: newStudentCount }]] = await connection.query(`SELECT COUNT(*) as count FROM new_students ${branchFilter}`, populationParams);


        // --- 4. Recent Expenses (for the list view) ---
        const expenseBranchFilter = adminBranchId ? 'WHERE e.branch_id = ?' : '';
        const recentExpensesQuery = `
             SELECT e.*, s.name as author_name, b.school_name as branch_name
             FROM expenses e
             LEFT JOIN staff s ON e.author_id = s.user_id
             LEFT JOIN branches b ON e.branch_id = b.id
             ${expenseBranchFilter}
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
        if (connection) connection.release();
    }
});

// @route   GET /api/analytics/performance
// @desc    Get aggregated data for the performance page charts
// @access  Admin, SuperAdmin
router.get('/performance', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const { period } = req.query; // 'Daily', 'Weekly', 'Monthly'

        let adminBranchId = null;
        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                adminBranchId = staff[0].branch_id;
            }
        }

        const getDates = (period) => {
            const endDate = new Date();
            let startDate = new Date();
            switch (period) {
                case 'Daily': startDate.setDate(endDate.getDate() - 1); break;
                case 'Weekly': startDate.setDate(endDate.getDate() - 7); break;
                case 'Monthly': startDate.setMonth(endDate.getMonth() - 1); break;
                default: startDate.setDate(endDate.getDate() - 7); // Default to weekly
            }
            return { startDate, endDate };
        };

        const { startDate, endDate } = getDates(period);

        // 1. Attendance Data
        const attendanceBranchFilter = adminBranchId ? 'AND sa.branch_id = ?' : '';
        const attendanceParams = adminBranchId
            ? [startDate, endDate, adminBranchId, startDate, endDate, adminBranchId]
            : [startDate, endDate, startDate, endDate];
        const attendanceQuery = `
            SELECT b.school_name as branch, 'students' as type, COUNT(sa.id) as total, SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) as present
            FROM student_attendance sa JOIN branches b ON sa.branch_id = b.id WHERE sa.date BETWEEN ? AND ? ${attendanceBranchFilter} GROUP BY b.school_name
            UNION ALL
            SELECT b.school_name as branch, 'staffs' as type, COUNT(sa.id) as total, SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) as present
            FROM staff_attendance sa JOIN branches b ON sa.branch_id = b.id WHERE sa.date BETWEEN ? AND ? ${attendanceBranchFilter} GROUP BY b.school_name;
        `;
        const [attendanceResults] = await connection.query(attendanceQuery, attendanceParams);

        const attendanceBarData = attendanceResults.reduce((acc, row) => {
            const branch = acc.find(item => item.branch === row.branch);
            const percentage = row.total > 0 ? (row.present / row.total) * 100 : 0;
            if (branch) {
                branch[row.type] = Math.round(percentage);
            } else {
                acc.push({ branch: row.branch, [row.type]: Math.round(percentage) });
            }
            return acc;
        }, []);


        // 2. Discipline Data (Punctuality)
        const punctualityBranchFilter = adminBranchId ? 'AND sa.branch_id = ?' : '';
        const punctualityParams = adminBranchId ? [startDate, endDate, adminBranchId] : [startDate, endDate];
        const punctualityQuery = `
            SELECT b.school_name as branch, COUNT(sa.id) as total, SUM(CASE WHEN sa.status = 'Late' THEN 1 ELSE 0 END) as late
            FROM student_attendance sa JOIN branches b ON sa.branch_id = b.id WHERE sa.date BETWEEN ? AND ? ${punctualityBranchFilter} GROUP BY b.school_name;
        `;
        const [punctualityResults] = await connection.query(punctualityQuery, punctualityParams);

        const disciplineData = punctualityResults.map(row => ({
            branch: row.branch,
            punctuality: row.total > 0 ? Math.round(((row.total - row.late) / row.total) * 100) : 100,
            projectTurnOver: Math.floor(Math.random() * 51) + 50 // Mock data between 50-100
        }));


        // 3. Academics Data
        // FIX: Changed exam_type check from 'Exam'/'Test' to 'Internal'/'External' to match DB schema
        const academicsBranchFilter = adminBranchId ? 'AND e.branch_id = ?' : '';
        const academicsParams = adminBranchId ? [startDate, endDate, adminBranchId] : [startDate, endDate];
        const academicsQuery = `
            SELECT b.school_name as branch, e.exam_type, AVG(er.score) as average_score
            FROM exam_results er JOIN exams e ON er.exam_id = e.id JOIN branches b ON e.branch_id = b.id
            WHERE e.exam_date_time BETWEEN ? AND ? ${academicsBranchFilter} GROUP BY b.school_name, e.exam_type;
        `;
        const [academicsResults] = await connection.query(academicsQuery, academicsParams);

        const academicsData = academicsResults.reduce((acc, row) => {
            let branch = acc.find(item => item.branch === row.branch);
            if (!branch) {
                branch = { branch: row.branch, internal: 0, external: 0 };
                acc.push(branch);
            }
            const score = Math.round(row.average_score || 0);
            if (row.exam_type === 'Internal') {
                branch.internal = score;
            } else if (row.exam_type === 'External') {
                branch.external = score;
            }
            return acc;
        }, []);


        // 4. Line Chart Data (Last 7 days attendance)
        const lineChartBranchFilter = adminBranchId ? 'AND branch_id = ?' : '';
        const lineChartParams = adminBranchId ? [adminBranchId] : [];
        const lineChartQuery = `
            SELECT DATE_FORMAT(date, '%a') as day, (SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) / COUNT(id)) * 100 as attendance
            FROM student_attendance WHERE date BETWEEN CURDATE() - INTERVAL 6 DAY AND CURDATE() ${lineChartBranchFilter}
            GROUP BY day, date ORDER BY date;
        `;
        const [attendanceLineData] = await connection.query(lineChartQuery, lineChartParams);


        res.json({
            success: true,
            data: { attendanceLineData, attendanceBarData, disciplineData, academicsData }
        });

    } catch (error) {
        console.error('Performance Analytics Error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching performance analytics data.' });
    } finally {
        if (connection) connection.release();
    }
});

// @route   GET /api/analytics/analysis-page
// @desc    Get aggregated data for the analysis page charts
// @access  Admin, SuperAdmin
router.get('/analysis-page', [auth, authorize(['SuperAdmin', 'Admin'])], async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();

        let adminBranchId = null;
        if (req.user.roles.includes('Admin')) {
            const [staff] = await connection.query('SELECT branch_id FROM staff WHERE user_id = ?', [req.user.id]);
            if (staff.length > 0 && staff[0].branch_id) {
                adminBranchId = staff[0].branch_id;
            }
        }

        const studentBranchFilter = adminBranchId ? `WHERE s.branch_id = ?` : '';
        const branchFilter = adminBranchId ? `WHERE id = ?` : '';
        const simpleBranchFilter = adminBranchId ? `WHERE branch_id = ?` : '';
        const branchParams = adminBranchId ? [adminBranchId] : [];

        // Get active term ID
        const [activeTerm] = await connection.query('SELECT id FROM terms WHERE is_active = TRUE');
        if (activeTerm.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const activeTermId = activeTerm[0].id;

        // --- CRASH FIX: Moved fee calculations to the top ---
        const [[{ totalFeesDue }]] = await connection.query(`
            SELECT COALESCE(SUM(f.amount), 0) as totalFeesDue FROM fees f
            WHERE f.term_id = ? ${simpleBranchFilter}
        `, [activeTermId, ...branchParams]);
        const [[{ totalFeesPaid }]] = await connection.query(`
            SELECT COALESCE(SUM(p.amount_paid), 0) as totalFeesPaid
            FROM payments p
            LEFT JOIN students s ON p.student_id = s.id
            WHERE p.term_id = ? ${studentBranchFilter}
        `, [activeTermId, ...branchParams]);

        const feesPaidPercentage = totalFeesDue > 0 ? (totalFeesPaid / totalFeesDue) * 100 : 100; // Show 100% if no fees are due
        const feesOwingPercentage = 100 - feesPaidPercentage;

        // This can now be safely created
        const feesData = [
            { name: "Paid", value: Math.round(feesPaidPercentage), color: "#10b981" },
            { name: "Owing", value: Math.round(feesOwingPercentage), color: "#ef4444" }
        ];
        // --- END CRASH FIX ---


        // 1. Gross Revenue by Branch
        const grossRevenueQuery = `
            SELECT b.school_name as name, COALESCE(SUM(r.amount), 0) as value
            FROM branches b
            LEFT JOIN students s ON b.id = s.branch_id
            LEFT JOIN revenue r ON s.id = r.student_id
            ${adminBranchId ? 'WHERE b.id = ?' : ''}
            GROUP BY b.school_name ORDER BY b.school_name;
        `;
        const [grossRevenueData] = await connection.query(grossRevenueQuery, branchParams);

        // 2. Revenue Source
        const totalRevenueSubquery = `
            SELECT COALESCE(SUM(rev.amount), 1) as total_sum
            FROM revenue rev
            ${adminBranchId ? 'LEFT JOIN students stud ON rev.student_id = stud.id WHERE stud.branch_id = ?' : ''}
        `;
        const revenueSourceQuery = `
            SELECT r.payment_for as category, (SUM(r.amount) / total_revenue.total_sum) * 100 as value
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            CROSS JOIN (${totalRevenueSubquery}) as total_revenue
            ${studentBranchFilter}
            GROUP BY r.payment_for, total_revenue.total_sum ORDER BY r.payment_for;
        `;
        const [revenueSourceData] = await connection.query(revenueSourceQuery, adminBranchId ? [adminBranchId, adminBranchId] : []);

        // 3. Monthly Revenue Trend (last 12 months)
        const monthlyRevenueQuery = `
            SELECT DATE_FORMAT(r.paid_at, '%b') as month, COALESCE(SUM(r.amount), 0) as revenue
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            WHERE r.paid_at >= CURDATE() - INTERVAL 12 MONTH
            ${adminBranchId ? 'AND s.branch_id = ?' : ''}
            GROUP BY YEAR(r.paid_at), MONTH(r.paid_at) ORDER BY YEAR(r.paid_at), MONTH(r.paid_at);
        `;
        const [monthlyRevenueData] = await connection.query(monthlyRevenueQuery, branchParams);

        // 4. School Population by Branch
        const schoolPopulationQuery = `
            SELECT b.school_name as school, COUNT(DISTINCT s.id) as students, COUNT(DISTINCT p.id) as parents, COUNT(DISTINCT ns.id) as newStudents
            FROM branches b
            LEFT JOIN students s ON b.id = s.branch_id
            LEFT JOIN parents p ON s.parent_id = p.id
            LEFT JOIN new_students ns ON b.id = ns.branch_id
            ${adminBranchId ? 'WHERE b.id = ?' : ''}
            GROUP BY b.id, b.school_name ORDER BY b.school_name;
        `;
        const [schoolPopulationData] = await connection.query(schoolPopulationQuery, branchParams);

        // 5. Summary Cards Data
        const [[{ totalRevenue }]] = await connection.query(`
            SELECT COALESCE(SUM(r.amount), 0) as totalRevenue FROM revenue r LEFT JOIN students s ON r.student_id = s.id ${studentBranchFilter}`,
            branchParams
        );

        const [[{ totalBranchesCount }]] = await connection.query(`SELECT COUNT(*) as totalBranchesCount FROM branches ${branchFilter}`, branchParams);

        const avgMonthlyRevenue = monthlyRevenueData.length > 0
            ? monthlyRevenueData.reduce((sum, item) => sum + parseFloat(item.revenue), 0) / monthlyRevenueData.length
            : 0;

        res.json({
            success: true,
            data: {
                summaryCards: {
                    totalRevenue: parseFloat(totalRevenue).toFixed(2),
                    feesPaid: Math.round(feesPaidPercentage),
                    feesOwing: Math.round(feesOwingPercentage),
                    totalBranches: totalBranchesCount,
                    avgMonthlyRevenue: parseFloat(avgMonthlyRevenue).toFixed(2)
                },
                grossRevenueData,
                feesData,
                revenueSourceData,
                monthlyRevenueData,
                schoolPopulationData,
            }
        });

    } catch (error) {
        console.error('Analysis Page Error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching analytics data.' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;