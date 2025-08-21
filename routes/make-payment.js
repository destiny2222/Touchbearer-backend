// backend/routes/payment.js

const express = require('express');
const router = express.Router();
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const pool = require('../database');
const auth = require('../middleware/auth'); // For fee payments
const { createNewStudentFromEnrollment } = require('../services/enrollmentService'); // We will create this service

// Helper function for making requests to Paystack
const paystackRequest = (options, params) => {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                const responseData = JSON.parse(data);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(responseData);
                } else {
                    reject(responseData);
                }
            });
        }).on('error', error => {
            reject(error);
        });

        if (params) {
            req.write(params);
        }
        req.end();
    });
};

// POST /api/payment/initialize - Initialize a payment
router.post('/initialize', async (req, res) => {
    const { email, amount, metadata } = req.body;

    if (!email || !amount) {
        return res.status(400).json({ success: false, message: 'Email and amount are required.' });
    }

    // Paystack amount is in kobo (lowest currency unit)
    const amountInKobo = Math.round(amount * 100);

    const params = JSON.stringify({
        email,
        amount: amountInKobo,
        metadata: metadata || {},
    });

    const options = {
        hostname: 'api.paystack.co',
        port: 443,
        path: '/transaction/initialize',
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
        },
    };

    try {
        const data = await paystackRequest(options, params);
        res.status(200).json(data);
    } catch (error) {
        console.error('Paystack Initialization Error:', error);
        res.status(500).json({ success: false, message: 'Failed to initialize payment.', error });
    }
});


// POST /api/payment/verify - Verify a payment and take action
router.post('/verify', async (req, res) => {
    const { reference } = req.body;
    if (!reference) {
        return res.status(400).json({ success: false, message: 'Payment reference is required.' });
    }

    const options = {
        hostname: 'api.paystack.co',
        port: 443,
        path: `/transaction/verify/${reference}`,
        method: 'GET',
        headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
    };

    try {
        const paystackResponse = await paystackRequest(options);

        if (paystackResponse.data.status !== 'success') {
            return res.status(400).json({ success: false, message: 'Payment not successful or already verified.' });
        }

        const { metadata, amount, paid_at, customer } = paystackResponse.data;
        const amountInNaira = amount / 100;

        // Check if transaction has already been logged
        const [existingRevenue] = await pool.query('SELECT id FROM revenue WHERE reference = ?', [reference]);
        if (existingRevenue.length > 0) {
            // Still return success if already processed, but indicate it to the client
            return res.status(200).json({ success: true, message: 'This transaction has already been processed.' });
        }
        
        // Log the transaction to the revenue table
        await pool.query('INSERT INTO revenue SET ?', {
            id: uuidv4(),
            student_id: metadata.student_id || null,
            parent_id: metadata.parent_id || null,
            email: customer.email,
            amount: amountInNaira,
            reference: reference,
            status: 'success',
            payment_for: metadata.payment_for || 'Uncategorized',
            paid_at: new Date(paid_at),
        });

        let actionResult = {};

        // --- Perform Actions Based on Payment Type ---
        if (metadata.payment_for === 'enrollment') {
            const enrollmentData = metadata.enrollment_data;
            const result = await createNewStudentFromEnrollment(enrollmentData);

            if (!result.success) {
                console.error(`CRITICAL: Payment ${reference} succeeded but enrollment failed for ${enrollmentData.parent_email}. Reason: ${result.message}`);
                return res.status(500).json({ success: false, message: `Payment was successful, but we couldn't create the student profile automatically. Please contact administration with reference: ${reference}.` });
            }
            actionResult = {
                message: 'Enrollment successful!',
                data: result.data,
            };

        } else if (metadata.payment_for === 'school_fees') {
            const { student_id, term_id } = metadata;
            
            // Check if student_id or term_id is missing
            if (!student_id || !term_id) {
                throw new Error(`CRITICAL: Missing student_id or term_id in metadata for reference ${reference}.`);
            }
            
            // Record this specific payment
            await pool.query('INSERT INTO payments SET ?', {
                id: uuidv4(),
                student_id,
                term_id,
                amount_paid: amountInNaira,
                payment_date: new Date(paid_at),
            });

            // --- FIX: CORRECTLY RECALCULATE PAYMENT STATUS ---
            // 1. Get student's class_id
            const [studentRows] = await pool.query('SELECT class_id FROM students WHERE id = ?', [student_id]);
            if (studentRows.length === 0) {
                 throw new Error(`Could not find student with ID ${student_id} for payment update.`);
            }
            const { class_id } = studentRows[0];

            // 2. Get total fees due for the CLASS and TERM
            const [[{ total_due }]] = await pool.query(
                'SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?', 
                [class_id, term_id]
            );

            // 3. Get total paid for the STUDENT and TERM
            const [[{ total_paid }]] = await pool.query(
                'SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?', 
                [student_id, term_id]
            );

            if (total_paid >= total_due) {
                 await pool.query(
                    'INSERT INTO student_payment_statuses (student_id, term_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
                    [student_id, term_id, 'Paid', 'Paid']
                );
            }
            actionResult = { message: 'School fees payment recorded successfully!' };
        } else if (metadata.payment_for === 'book_purchase') {
        const { student_id, book_id, parent_id } = metadata;
        if (!student_id || !book_id || !parent_id) {
            throw new Error(`CRITICAL: Missing metadata for book purchase. Ref: ${reference}`);
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Lock the book row to prevent race conditions on stock
            const [bookRows] = await connection.query('SELECT amount, price, branch_id FROM books WHERE id = ? FOR UPDATE', [book_id]);
            if (bookRows.length === 0) throw new Error('Book not found.');
            
            const book = bookRows[0];
            if (book.amount <= 0) throw new Error('Book is out of stock.');

            // 2. Decrease the book stock
            await connection.query('UPDATE books SET amount = amount - 1 WHERE id = ?', [book_id]);

            // 3. Log the purchase
            await connection.query('INSERT INTO student_book_purchases SET ?', {
                id: uuidv4(),
                student_id,
                book_id,
                branch_id: book.branch_id,
                price: book.price,
                payment_status: 'Paid',
                purchase_method: 'Online'
            });

            await connection.commit();
            actionResult = { message: 'Book purchased successfully!' };
        } catch (err) {
            await connection.rollback();
            // Re-throw the error to be caught by the outer catch block
            throw err; 
        } finally {
            connection.release();
        }
    }

        res.status(200).json({ 
            success: true, 
            message: 'Payment verified and recorded successfully.',
            ...actionResult
        });

    } catch (error) {
        console.error('Paystack Verification Error:', error);
        res.status(500).json({ success: false, message: 'An internal server error occurred during payment verification.', error });
    }
});

module.exports = router;
