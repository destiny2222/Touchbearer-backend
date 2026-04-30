const express = require('express');
const router = express.Router();
const { pool } = require('../database');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// GET /api/admin/revenue - List revenue with filters
router.get('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id, student_id, parent_id, status, payment_for, start_date, end_date, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT 
                r.id,
                r.student_id,
                r.parent_id,
                r.email,
                r.amount,
                r.reference,
                r.status,
                r.payment_for,
                r.paid_at,
                r.created_at,
                s.first_name as student_first_name,
                s.last_name as student_last_name,
                s.class_id,
                c.name as class_name,
                c.arm,
                b.school_name as branch_name,
                p.name as parent_name,
                p.phone as parent_phone
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN branches b ON s.branch_id = b.id
            LEFT JOIN parents p ON r.parent_id = p.id
            WHERE 1=1
        `;
        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' AND s.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                return res.json({ success: true, data: [], message: 'Admin not linked to a branch' });
            }
        } else if (branch_id) {
            query += ' AND s.branch_id = ?';
            queryParams.push(branch_id);
        }

        if (student_id) {
            query += ' AND r.student_id = ?';
            queryParams.push(student_id);
        }

        if (parent_id) {
            query += ' AND r.parent_id = ?';
            queryParams.push(parent_id);
        }

        if (status) {
            query += ' AND r.status = ?';
            queryParams.push(status);
        }

        if (payment_for) {
            query += ' AND r.payment_for = ?';
            queryParams.push(payment_for);
        }

        if (start_date) {
            query += ' AND r.paid_at >= ?';
            queryParams.push(start_date);
        }

        if (end_date) {
            query += ' AND r.paid_at <= ?';
            queryParams.push(end_date);
        }

        query += ' ORDER BY r.paid_at DESC, r.created_at DESC';
        query += ' LIMIT ? OFFSET ?';
        queryParams.push(parseInt(limit), parseInt(offset));

        const [revenue] = await pool.query(query, queryParams);

        let countQuery = `
            SELECT COUNT(*) as total
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            WHERE 1=1
        `;
        const countParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                countQuery += ' AND s.branch_id = ?';
                countParams.push(adminBranchId);
            }
        } else if (branch_id) {
            countQuery += ' AND s.branch_id = ?';
            countParams.push(branch_id);
        }

        if (student_id) {
            countQuery += ' AND r.student_id = ?';
            countParams.push(student_id);
        }

        if (status) {
            countQuery += ' AND r.status = ?';
            countParams.push(status);
        }

        if (payment_for) {
            countQuery += ' AND r.payment_for = ?';
            countParams.push(payment_for);
        }

        const [countResult] = await pool.query(countQuery, countParams);

        let sumQuery = `
            SELECT SUM(r.amount) as total_amount
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            WHERE r.status = 'success'
        `;
        const sumParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                sumQuery += ' AND s.branch_id = ?';
                sumParams.push(adminBranchId);
            }
        } else if (branch_id) {
            sumQuery += ' AND s.branch_id = ?';
            sumParams.push(branch_id);
        }

        if (start_date) {
            sumQuery += ' AND r.paid_at >= ?';
            sumParams.push(start_date);
        }

        if (end_date) {
            sumQuery += ' AND r.paid_at <= ?';
            sumParams.push(end_date);
        }

        const [sumResult] = await pool.query(sumQuery, sumParams);

        res.json({ 
            success: true, 
            data: revenue,
            summary: {
                total_records: countResult[0].total,
                total_revenue: sumResult[0].total_amount || 0
            },
            pagination: {
                total: countResult[0].total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Get admin revenue error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching revenue.' });
    }
});

// GET /api/admin/revenue/summary - Get revenue summary by payment type
router.get('/summary', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id, start_date, end_date } = req.query;

    try {
        let whereClause = "WHERE r.status = 'success'";
        const params = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                whereClause += ' AND s.branch_id = ?';
                params.push(adminBranchId);
            }
        } else if (branch_id) {
            whereClause += ' AND s.branch_id = ?';
            params.push(branch_id);
        }

        if (start_date) {
            whereClause += ' AND r.paid_at >= ?';
            params.push(start_date);
        }

        if (end_date) {
            whereClause += ' AND r.paid_at <= ?';
            params.push(end_date);
        }

        const [byPaymentType] = await pool.query(`
            SELECT 
                r.payment_for,
                COUNT(*) as count,
                SUM(r.amount) as total_amount
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            ${whereClause}
            GROUP BY r.payment_for
            ORDER BY total_amount DESC
        `, params);

        const [byStatus] = await pool.query(`
            SELECT 
                r.status,
                COUNT(*) as count,
                SUM(IF(r.status = 'success', r.amount, 0)) as total_amount
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            ${whereClause.includes('status') ? whereClause : whereClause.replace("WHERE r.status = 'success'", "WHERE 1=1")}
            GROUP BY r.status
        `, params);

        const [total] = await pool.query(`
            SELECT 
                COUNT(*) as total_transactions,
                SUM(r.amount) as total_amount
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            ${whereClause}
        `, params);

        res.json({
            success: true,
            data: {
                total: total[0],
                by_payment_type: byPaymentType,
                by_status: byStatus
            }
        });
    } catch (error) {
        console.error('Get revenue summary error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching revenue summary.' });
    }
});

// GET /api/admin/revenue/:id - Get revenue details by ID
router.get('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    try {
        const [revenue] = await pool.query(`
            SELECT 
                r.*,
                s.first_name as student_first_name,
                s.last_name as student_last_name,
                s.class_id,
                c.name as class_name,
                c.arm,
                b.school_name as branch_name,
                p.name as parent_name,
                p.phone as parent_phone,
                p.email as parent_email
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN branches b ON s.branch_id = b.id
            LEFT JOIN parents p ON r.parent_id = p.id
            WHERE r.id = ?
        `, [id]);

        if (revenue.length === 0) {
            return res.status(404).json({ success: false, message: 'Revenue record not found.' });
        }

        const [linkedPayment] = await pool.query(`
            SELECT id, amount_paid, payment_date, reference
            FROM payments 
            WHERE reference = ? OR student_id = ?
        `, [revenue[0].reference, revenue[0].student_id]);

        res.json({
            success: true,
            data: {
                ...revenue[0],
                linked_payments: linkedPayment
            }
        });
    } catch (error) {
        console.error('Get revenue details error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching revenue details.' });
    }
});

// GET /api/admin/revenue/reference/:reference - Get revenue by reference number
router.get('/reference/:reference', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { reference } = req.params;

    try {
        const [revenue] = await pool.query(`
            SELECT 
                r.*,
                s.first_name as student_first_name,
                s.last_name as student_last_name,
                c.name as class_name,
                b.school_name as branch_name,
                p.name as parent_name
            FROM revenue r
            LEFT JOIN students s ON r.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN branches b ON s.branch_id = b.id
            LEFT JOIN parents p ON r.parent_id = p.id
            WHERE r.reference = ?
        `, [reference]);

        if (revenue.length === 0) {
            return res.status(404).json({ success: false, message: 'Revenue record not found.' });
        }

        res.json({ success: true, data: revenue[0] });
    } catch (error) {
        console.error('Get revenue by reference error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching revenue by reference.' });
    }
});

module.exports = router;