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

module.exports = router;