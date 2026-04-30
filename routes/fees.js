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

        const [children] = await pool.query(`
            SELECT s.id, s.user_id, s.class_id, s.first_name, s.last_name, s.branch_id, s.passport, u.email, c.name as class_name, c.arm, b.school_name as branch_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.parent_id = ?
        `, [parent_id]);
        if (children.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Determine the current academic session
        const branchId = children.length > 0 ? children[0].branch_id : null;
        let currentSession = null;

        if (branchId) {
            const [activeTermRows] = await pool.query(
                'SELECT session FROM terms WHERE is_active = TRUE AND branch_id = ? LIMIT 1',
                [branchId]
            );
            if (activeTermRows.length > 0) {
                currentSession = activeTermRows[0].session;
            }
        }

        if (!currentSession) {
            const [globalActiveTermRows] = await pool.query(
                'SELECT session FROM terms WHERE is_active = TRUE AND branch_id IS NULL LIMIT 1'
            );
            if (globalActiveTermRows.length > 0) {
                currentSession = globalActiveTermRows[0].session;
            }
        }

        if (!currentSession) {
            return res.json({ success: true, data: [] });
        }

        // Fetch all terms for the current session
        const [sessionTerms] = await pool.query(
            'SELECT id, name, session FROM terms WHERE session = ? AND (branch_id = ? OR branch_id IS NULL) ORDER BY start_date ASC LIMIT 3',
            [currentSession, branchId]
        );

        const feesByChild = await Promise.all(children.map(async (child) => {
            const childFeesByTerm = await Promise.all(sessionTerms.map(async (term) => {
                // Get fees for this class and term, matching the arm (or fees without specific arm)
                let feesQuery = 'SELECT f.*, c.name as class_name, t.name as term_name, b.school_name as branch_name FROM fees f JOIN classes c ON f.class_id = c.id JOIN terms t ON f.term_id = t.id JOIN branches b ON f.branch_id = b.id WHERE f.class_id = ? AND f.term_id = ? AND (f.arm IS NULL OR f.arm = ?)';
                const [fees] = await pool.query(feesQuery, [child.class_id, term.id, child.arm]);

                let totalFeesQuery = 'SELECT SUM(amount) as total_fees FROM fees WHERE class_id = ? AND term_id = ? AND (arm IS NULL OR arm = ?)';
                const [totalFeesRow] = await pool.query(totalFeesQuery, [child.class_id, term.id, child.arm]);
                const total_fees = totalFeesRow[0].total_fees || 0;

                const [totalPaidRow] = await pool.query('SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?', [child.id, term.id]);
                const total_paid = totalPaidRow[0].total_paid || 0;

                const [statusRow] = await pool.query('SELECT status FROM student_payment_statuses WHERE student_id = ? AND term_id = ?', [child.id, term.id]);
                const status = statusRow.length > 0 ? statusRow[0].status : 'Not Paid';

                // Get individual payment records for payment slip generation, including gateway reference from revenue
                const [paymentRecords] = await pool.query(
                    `SELECT p.id, p.amount_paid, p.payment_date, r.reference as gateway_reference, p.created_at
                     FROM payments p
                     LEFT JOIN revenue r ON p.reference = r.reference AND r.student_id = p.student_id
                     WHERE p.student_id = ? AND p.term_id = ? ORDER BY p.payment_date DESC`,
                    [child.id, term.id]
                );

                return {
                    term_name: term.name,
                    session: term.session,
                    fees,
                    total_fees,
                    total_paid,
                    balance: total_fees - total_paid,
                    payment_status: status,
                    payment_records: paymentRecords
                };
            }));

            return {
                child_id: child.id,
                registration_id: child.email, // Using student's email as registration id
                child_name: `${child.first_name} ${child.last_name}`,
                passport_image: child.passport,
                class_name: child.class_name,
                branch_name: child.branch_name,
                class_arm: child.arm,
                terms: childFeesByTerm
            };
        }));

        res.json({ success: true, data: feesByChild });
    } catch (error) {
        console.error('Get fees for children error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching fees for children.' });
    }
});

// GET /api/fees/child/:childId/term/:termId/paid-details - Get paid fee details for a specific child and term
router.get('/child/:childId/term/:termId/paid-details', [auth, authorize(['Parent'])], async (req, res) => {
    try {
        const { childId, termId } = req.params;

        // Verify parent owns the child
        const [parent] = await pool.query('SELECT id FROM parents WHERE user_id = ?', [req.user.id]);
        if (parent.length === 0) {
            return res.status(404).json({ success: false, message: 'Parent not found.' });
        }
        const parentId = parent[0].id;

        const [child] = await pool.query(`
            SELECT s.*, u.email, c.name as class_name, c.arm, b.school_name as branch_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.id = ? AND s.parent_id = ?
        `, [childId, parentId]);

        if (child.length === 0) {
            return res.status(404).json({ success: false, message: 'Child not found.' });
        }
        const childData = child[0];

        // Check if fees are paid
        const [statusRow] = await pool.query('SELECT status FROM student_payment_statuses WHERE student_id = ? AND term_id = ?', [childId, termId]);
        if (!statusRow || statusRow[0].status !== 'Paid') {
            return res.status(400).json({ success: false, message: 'Fees not paid for this term.' });
        }

        // Get term details
        const [termDetails] = await pool.query('SELECT name, session FROM terms WHERE id = ?', [termId]);
        if (termDetails.length === 0) {
            return res.status(404).json({ success: false, message: 'Term not found.' });
        }

        // Get fee details
        const [fees] = await pool.query(
            'SELECT f.*, c.name as class_name, t.name as term_name, b.school_name as branch_name FROM fees f JOIN classes c ON f.class_id = c.id JOIN terms t ON f.term_id = t.id JOIN branches b ON f.branch_id = b.id WHERE f.class_id = ? AND f.term_id = ? AND (f.arm IS NULL OR f.arm = ?)',
            [childData.class_id, termId, childData.arm]
        );

        // Get payment records
        const [paymentRecords] = await pool.query(
            `SELECT p.id, p.amount_paid, p.payment_date, r.reference as gateway_reference, p.created_at
             FROM payments p
             LEFT JOIN revenue r ON p.reference = r.reference AND r.student_id = p.student_id
             WHERE p.student_id = ? AND p.term_id = ? ORDER BY p.payment_date DESC`,
            [childId, termId]
        );

        res.json({
            success: true,
            data: {
                child_id: childData.id,
                registration_id: childData.email,
                child_name: `${childData.first_name} ${childData.last_name}`,
                passport_image: childData.passport,
                class_name: childData.class_name,
                branch_name: childData.branch_name,
                class_arm: childData.arm,
                term_name: termDetails[0].name,
                session: termDetails[0].session,
                fees,
                payment_records: paymentRecords
            }
        });
    } catch (error) {
        console.error('Get paid fee details error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching paid fee details.' });
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

// GET /api/fees/student-statuses - Get payment status for all students in the specified term or current term
router.get('/student-statuses', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    try {
        const term_id = req.query.term_id;

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
        `;

        const queryParams = [];

        let termJoinCondition = 't.branch_id = s.branch_id';
        if (term_id) {
            termJoinCondition += ' AND t.id = ?';
            queryParams.push(term_id);
        } else {
            termJoinCondition += ' AND t.is_active = TRUE';
        }
        query += ` LEFT JOIN terms t ON ${termJoinCondition}`;
        query += ` LEFT JOIN student_payment_statuses sps ON sps.student_id = s.id AND sps.term_id = t.id`;

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId) {
                if (term_id) {
                    // Validate that the term belongs to the admin's branch
                    const [termRows] = await pool.query('SELECT id FROM terms WHERE id = ? AND branch_id = ?', [term_id, adminBranchId]);
                    if (termRows.length === 0) {
                        return res.status(400).json({ success: false, message: 'Invalid term_id or term does not belong to your branch.' });
                    }
                }
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

router.get('/class/:classId/student-statuses', [auth, authorize(['Admin', 'SuperAdmin'])], async (req, res) => {
    const { classId } = req.params;
    const { arm, term_id } = req.query;

    try {
        const [classInfo] = await pool.query('SELECT id, name, arm, branch_id FROM classes WHERE id = ?', [classId]);
        if (classInfo.length === 0) {
            return res.status(404).json({ success: false, message: 'Class not found.' });
        }

        if (req.user.roles.includes('Admin')) {
            const adminBranchId = await getAdminBranchId(req.user.id);
            if (adminBranchId && classInfo[0].branch_id !== adminBranchId) {
                return res.status(403).json({ success: false, message: 'Not authorized to view this class.' });
            }
        }

        let termQuery = 'SELECT id FROM terms WHERE branch_id = ? AND is_active = TRUE';
        const termParams = [classInfo[0].branch_id];

        if (term_id) {
            termQuery = 'SELECT id FROM terms WHERE id = ? AND branch_id = ?';
            termParams[0] = term_id;
        }

        const [activeTerms] = await pool.query(termQuery, termParams);
        if (activeTerms.length === 0) {
            return res.status(404).json({ success: false, message: 'No active term found.' });
        }
        const termId = activeTerms[0].id;

        let query = `
            SELECT 
                s.id,
                s.first_name,
                s.last_name,
                s.branch_id,
                s.class_id,
                c.name as class_name,
                c.arm,
                b.school_name as branch_name,
                t.id as term_id,
                t.name as term_name,
                IFNULL(sps.status, 'Not Paid') as payment_status,
                IFNULL(f.total_fees, 0) as total_fees,
                IFNULL(p.total_paid, 0) as total_paid,
                (IFNULL(f.total_fees, 0) - IFNULL(p.total_paid, 0)) as balance
            FROM students s
            JOIN classes c ON s.class_id = c.id
            JOIN branches b ON s.branch_id = b.id
            JOIN terms t ON t.id = ?
            LEFT JOIN student_payment_statuses sps ON sps.student_id = s.id AND sps.term_id = t.id
            LEFT JOIN (
                SELECT class_id, arm, SUM(amount) as total_fees
                FROM fees
                WHERE term_id = ?
                GROUP BY class_id, arm
            ) f ON s.class_id = f.class_id AND c.arm = f.arm
            LEFT JOIN (
                SELECT student_id, term_id, SUM(amount_paid) as total_paid
                FROM payments
                WHERE term_id = ?
                GROUP BY student_id, term_id
            ) p ON s.id = p.student_id AND p.term_id = t.id
            WHERE s.class_id = ?
        `;
        const queryParams = [termId, termId, termId, classId];

        if (arm) {
            query += ' AND c.arm = ?';
            queryParams.push(arm);
        }

        query += ' ORDER BY s.last_name, s.first_name';

        const [students] = await pool.query(query, queryParams);

        const paidCount = students.filter(s => s.payment_status === 'Paid').length;
        const notPaidCount = students.filter(s => s.payment_status === 'Not Paid').length;

        res.json({ 
            success: true, 
            data: students,
            summary: {
                class_name: classInfo[0].name,
                arm: classInfo[0].arm,
                term_name: activeTerms[0].name || 'Active Term',
                total_students: students.length,
                paid: paidCount,
                not_paid: notPaidCount
            }
        });

    } catch (error) {
        console.error('Get class student payment statuses error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching class student payment statuses.' });
    }
});


module.exports = router;
