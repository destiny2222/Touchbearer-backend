const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database'); const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

async function getAdminBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [userId]);
    return rows.length > 0 ? rows[0].branch_id : null;
}

// POST /api/fees - Create school fees for a class (and optionally an arm)
router.post('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { branch_id, class_id, arm, term_id, name, amount, description } = req.body;

    if (!branch_id || !class_id || !term_id || !name || !amount) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    try {
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only create fees for their own branch.' });
            }
        }

        const newFee = {
            id: uuidv4(),
            branch_id,
            class_id,
            arm: arm || null,
            term_id,
            name,
            amount,
            description,
        };
        await pool.query('INSERT INTO fees SET ?', newFee);
        res.status(201).json({ success: true, message: 'Fee created successfully.', data: newFee });
    } catch (error) {
        console.error('Create fee error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating fee.' });
    }
});

// PUT /api/fees/:id - Update school fees for a class
router.put('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;
    const { name, arm, amount, description } = req.body;

    try {
        const [feeRows] = await pool.query('SELECT * FROM fees WHERE id = ?', [id]);
        if (feeRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Fee not found.' });
        }
        const fee = feeRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== fee.branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only update fees for their own branch.' });
            }
        }

        const updateFields = {};
        if (name) updateFields.name = name;
        if (arm !== undefined) updateFields.arm = arm;
        if (amount) updateFields.amount = amount;
        if (description) updateFields.description = description;

        if (Object.keys(updateFields).length > 0) {
            await pool.query('UPDATE fees SET ? WHERE id = ?', [updateFields, id]);
        }

        res.json({ success: true, message: 'Fee updated successfully.' });
    } catch (error) {
        console.error('Update fee error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating fee.' });
    }
});

// DELETE /api/fees/:id - Delete a fee
router.delete('/:id', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { id } = req.params;

    try {
        const [feeRows] = await pool.query('SELECT * FROM fees WHERE id = ?', [id]);
        if (feeRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Fee not found.' });
        }
        const fee = feeRows[0];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (!adminBranchId || adminBranchId !== fee.branch_id) {
                return res.status(403).json({ success: false, message: 'Admins can only delete fees for their own branch.' });
            }
        }

        await pool.query('DELETE FROM fees WHERE id = ?', [id]);
        res.json({ success: true, message: 'Fee deleted successfully.' });
    } catch (error) {
        console.error('Delete fee error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting fee.' });
    }
});

// GET /api/fees/class/:classId - Retrieve fees for a specific class (optionally filter by arm)
router.get('/class/:classId', [auth], async (req, res) => {
    const { classId } = req.params;
    const { arm } = req.query; // Optional filter by arm

    try {
        const [activeTerm] = await pool.query('SELECT id FROM terms WHERE is_active = TRUE');
        if (activeTerm.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const term_id = activeTerm[0].id;

        let query = 'SELECT * FROM fees WHERE class_id = ? AND term_id = ?';
        const params = [classId, term_id];

        if (arm) {
            query += ' AND arm = ?';
            params.push(arm);
        }

        const [fees] = await pool.query(query, params);
        res.json({ success: true, data: fees });
    } catch (error) {
        console.error('Get fees by class error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching fees.' });
    }
});

// GET /api/fees/children - Show fees for each child of a parent
router.get('/children', [auth, authorize(['Parent'])], async (req, res) => {
    try {
        const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parent.length === 0) {
            return res.status(403).json({ success: false, message: 'User is not a parent.' });
        }
        const parent_id = parent[0].id;

        const [children] = await pool.query('SELECT id, class_id, first_name, last_name FROM students WHERE parent_id = ?', [parent_id]);
        if (children.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const [activeTerm] = await pool.query('SELECT id FROM terms WHERE is_active = TRUE');
        if (activeTerm.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const term_id = activeTerm[0].id;

        const feesByChild = await Promise.all(children.map(async (child) => {
            // Get the child's class arm
            const [classInfo] = await pool.query('SELECT arm FROM classes WHERE id = ?', [child.class_id]);
            const childArm = classInfo.length > 0 ? classInfo[0].arm : null;

            // Get fees for this class and term, matching the arm (or fees without specific arm)
            let feesQuery = 'SELECT * FROM fees WHERE class_id = ? AND term_id = ? AND (arm IS NULL OR arm = ?)';
            const [fees] = await pool.query(feesQuery, [child.class_id, term_id, childArm]);

            let totalFeesQuery = 'SELECT SUM(amount) as total_fees FROM fees WHERE class_id = ? AND term_id = ? AND (arm IS NULL OR arm = ?)';
            const [totalFeesRow] = await pool.query(totalFeesQuery, [child.class_id, term_id, childArm]);
            const total_fees = totalFeesRow[0].total_fees || 0;

            const [totalPaidRow] = await pool.query('SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?', [child.id, term_id]);
            const total_paid = totalPaidRow[0].total_paid || 0;

            const [statusRow] = await pool.query('SELECT status FROM student_payment_statuses WHERE student_id = ? AND term_id = ?', [child.id, term_id]);
            const status = statusRow.length > 0 ? statusRow[0].status : 'Not Paid';

            return {
                child_id: child.id,
                child_name: `${child.first_name} ${child.last_name}`,
                class_id: child.class_id,
                class_arm: childArm,
                term_id,
                fees,
                total_fees,
                total_paid,
                balance: total_fees - total_paid,
                payment_status: status
            };
        }));

        res.json({ success: true, data: feesByChild });
    } catch (error) {
        console.error('Get fees for children error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching fees for children.' });
    }
});

// GET /api/fees - Retrieve all fees (for Admin/SuperAdmin)
router.get('/', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT 
                f.id, f.name, f.amount, f.description, 
                f.branch_id, f.class_id, f.arm, f.term_id,
                b.school_name as BranchName,
                c.name as ClassName,
                c.arm as ClassArm,
                t.name as TermName
            FROM fees f
            JOIN branches b ON f.branch_id = b.id
            JOIN classes c ON f.class_id = c.id
            JOIN terms t ON f.term_id = t.id
        `;
        const queryParams = [];

        // If the user is an Admin, only show fees for their branch
        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' WHERE f.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                // If admin has no branch, return empty array
                return res.json({ success: true, data: [] });
            }
        }

        query += ' ORDER BY f.created_at DESC';

        const [fees] = await pool.query(query, queryParams);
        res.json({ success: true, data: fees });
    } catch (error) {
        console.error('Get all fees error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching fees.' });
    }
});

// GET /api/payments/student-statuses - Get payment status for all students in the current term
router.get('/student-statuses', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        let query = `
            SELECT 
                s.id,
                s.first_name,
                s.last_name,
                s.branch_id,
                s.class_id,
                c.name as ClassName,
                c.arm,
                b.school_name as BranchName,
                IFNULL(sps.status, 'Not Paid') as payment_status
            FROM students s
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            LEFT JOIN terms t ON t.branch_id = s.branch_id AND t.is_active = TRUE
            LEFT JOIN student_payment_statuses sps ON sps.student_id = s.id AND sps.term_id = t.id
        `;

        const queryParams = [];

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                query += ' WHERE s.branch_id = ?';
                queryParams.push(adminBranchId);
            } else {
                return res.json({ success: true, data: [] }); // Admin not linked to a branch
            }
        }

        query += ' ORDER BY b.school_name, c.name, s.last_name';

        const [students] = await pool.query(query, queryParams);
        res.json({ success: true, data: students });

    } catch (error) {
        console.error('Get student payment statuses error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching student payment statuses.' });
    }
});


module.exports = router;
