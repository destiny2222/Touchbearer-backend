const express = require('express');
const router = express.Router();
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database');
const auth = require('../middleware/auth');
const { createNewStudentFromEnrollment } = require('../services/enrollmentService');

// ---------- Helper: Paystack request ----------
const paystackRequest = (options, params = null) => {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const responseData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseData);
          } else {
            reject(responseData);
          }
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (params) req.write(params);
    req.end();
  });
};

// ---------- POST /api/payment/initialize ----------
router.post('/initialize', async (req, res) => {
  const { email, amount, metadata } = req.body;

  if (!email || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Valid email and amount (in NGN) are required.' });
  }

  const amountInKobo = Math.round(amount * 100);
  const reference = uuidv4(); // optional, Paystack can also generate

  // Store expected amount inside metadata for later verification
  const enrichedMetadata = {
    ...(metadata || {}),
    expected_amount: amount,      // store NGN value
    reference                     // optional, for tracking
  };

  const params = JSON.stringify({
    email,
    amount: amountInKobo,
    reference,
    metadata: enrichedMetadata,
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
    if (data.status) {
      // Return access_code as required by inline-js resumeTransaction()
      return res.status(200).json({
        success: true,
        access_code: data.data.access_code,
        reference: data.data.reference,
      });
    } else {
      return res.status(400).json({ success: false, message: data.message });
    }
  } catch (error) {
    console.error('Paystack Init Error:', error);
    res.status(500).json({ success: false, message: 'Failed to initialize payment.' });
  }
});

// ---------- POST /api/payment/verify ----------
router.post('/verify', async (req, res) => {
  const { reference } = req.body;
  if (!reference) {
    return res.status(400).json({ success: false, message: 'Payment reference required.' });
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
    console.log(`Verifying ${reference}:`, paystackResponse.data?.status);

    if (paystackResponse.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not successful or already used.' });
    }

    const { metadata, amount, paid_at, customer } = paystackResponse.data;
    const amountInNaira = amount / 100;

    // ----- AMOUNT VERIFICATION (critical) -----
    const expectedAmount = metadata?.expected_amount;
    if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 0.01) {
      console.error(`Amount mismatch for ${reference}: expected ${expectedAmount}, got ${amountInNaira}`);
      return res.status(400).json({ success: false, message: 'Payment amount does not match expected value. Contact support.' });
    }

    // ----- Prevent double processing -----
    const [existingRevenue] = await pool.query('SELECT id FROM revenue WHERE reference = ?', [reference]);
    if (existingRevenue.length > 0) {
      return res.status(200).json({ success: true, message: 'Transaction already processed.', alreadyProcessed: true });
    }

    // ----- Log to revenue table -----
    await pool.query('INSERT INTO revenue SET ?', {
      id: uuidv4(),
      student_id: metadata?.student_id || null,
      parent_id: metadata?.parent_id || null,
      email: customer.email,
      amount: amountInNaira,
      reference: reference,
      status: 'success',
      payment_for: metadata?.payment_for || 'Uncategorized',
      paid_at: new Date(paid_at),
    });

    let actionResult = {};

    // ----- Handle different payment types -----
    if (metadata.payment_for === 'enrollment') {
      const result = await createNewStudentFromEnrollment(metadata.enrollment_data);
      if (!result.success) {
        console.error(`Enrollment failed after payment ${reference}: ${result.message}`);
        return res.status(500).json({ success: false, message: `Payment succeeded but profile creation failed. Contact admin with ref: ${reference}` });
      }
      actionResult = { message: 'Enrollment successful!', data: result.data };

    } else if (metadata.payment_for === 'school_fees') {
      const { student_id, term_id } = metadata;
      if (!student_id || !term_id) throw new Error('Missing student_id or term_id');

      // Record payment
      await pool.query('INSERT INTO payments SET ?', {
        id: uuidv4(),
        student_id,
        term_id,
        amount_paid: amountInNaira,
        payment_date: new Date(paid_at),
        reference: reference,
      });

      // Recalculate payment status for that student & term
      const [studentRows] = await pool.query('SELECT class_id FROM students WHERE id = ?', [student_id]);
      if (studentRows.length === 0) throw new Error('Student not found');
      const { class_id } = studentRows[0];

      const [[{ total_due }]] = await pool.query(
        'SELECT SUM(amount) as total_due FROM fees WHERE class_id = ? AND term_id = ?',
        [class_id, term_id]
      );
      const [[{ total_paid }]] = await pool.query(
        'SELECT SUM(amount_paid) as total_paid FROM payments WHERE student_id = ? AND term_id = ?',
        [student_id, term_id]
      );

      if (total_paid >= total_due) {
        await pool.query(
          `INSERT INTO student_payment_statuses (student_id, term_id, status)
           VALUES (?, ?, 'Paid')
           ON DUPLICATE KEY UPDATE status = 'Paid'`,
          [student_id, term_id]
        );
      }
      actionResult = { message: 'School fees recorded successfully!' };

    } else if (metadata.payment_for === 'book_purchase') {
      const { student_id, book_id, parent_id } = metadata;
      if (!student_id || !book_id || !parent_id) throw new Error('Missing book purchase metadata');

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [bookRows] = await connection.query('SELECT amount, price, branch_id FROM books WHERE id = ? FOR UPDATE', [book_id]);
        if (bookRows.length === 0) throw new Error('Book not found');
        const book = bookRows[0];
        if (book.amount <= 0) throw new Error('Book out of stock');

        await connection.query('UPDATE books SET amount = amount - 1 WHERE id = ?', [book_id]);
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
        throw err;
      } finally {
        connection.release();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Payment verified and recorded.',
      ...actionResult
    });

  } catch (error) {
    console.error('Verification Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error during verification.' });
  }
});

// ---------- OPTIONAL: Webhook (recommended for production) ----------
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const crypto = require('crypto');

  const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
  if (hash !== signature) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;
  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    // You can re-use the same verification logic, but make sure it's idempotent
    // You could call an internal function or directly process here.
    // For simplicity, we can just log and optionally queue a job.
    console.log(`Webhook: successful charge for reference ${reference}`);
    // Optionally: call your existing verification logic (but avoid duplicate responses)
  }
  res.sendStatus(200);
});

module.exports = router;