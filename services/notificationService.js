const https = require('https');

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CONFIG = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FROM_EMAIL: process.env.FROM_EMAIL || 'Torch Bearers Academy <noreply@tbaworld.com>',
    ADMIN_EMAILS: process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [],
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    WEBSITE_URL: process.env.WEBSITE_URL || 'https://tbaworld.com',
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@tbaworld.com',
    SCHOOL_NAME: process.env.SCHOOL_NAME || 'Torch Bearers Academy',
    LOGO_URL: 'https://www.tbaworld.com/login-logo.png',
};

// ─────────────────────────────────────────────
//  TBA BRAND COLORS
//  Extracted from tbaworld.com visual identity
// ─────────────────────────────────────────────
//  Primary Deep Navy  : #0B1F3A   (trustworthy, academic)
//  Gold / Amber       : #E8A020   (torch flame, excellence)
//  Warm Red           : #C0392B   (torch bearer energy)
//  Light Gold Tint    : #FEF6E4   (soft card backgrounds)
//  Off-white          : #FAFAFA
//  Body text          : #2C2C2C
//  Muted text         : #6B7280

// ─────────────────────────────────────────────
//  EMAIL INFRASTRUCTURE
// ─────────────────────────────────────────────
async function sendEmailResend(to, subject, html) {
    return new Promise((resolve, reject) => {
        const apiKey = CONFIG.RESEND_API_KEY;
        if (!apiKey) {
            console.warn('RESEND_API_KEY not configured, skipping email send');
            resolve({ success: false, message: 'Email service not configured' });
            return;
        }

        const data = JSON.stringify({
            from: CONFIG.FROM_EMAIL,
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html,
        });

        const options = {
            hostname: 'api.resend.com',
            port: 443,
            path: '/emails',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ success: true, data: JSON.parse(body) });
                } else {
                    resolve({ success: false, message: body });
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.write(data);
        req.end();
    });
}

// ─────────────────────────────────────────────
//  TELEGRAM
// ─────────────────────────────────────────────
async function sendTelegramNotification(message) {
    const botToken = CONFIG.TELEGRAM_BOT_TOKEN;
    const chatId = CONFIG.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        console.warn('Telegram not configured, skipping notification');
        return { success: false, message: 'Telegram not configured' };
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
        });

        const result = await response.json();
        return result.ok ? { success: true, data: result } : { success: false, message: result.description };
    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
        return { success: false, message: error.message };
    }
}

function formatTelegramMessage(emoji, title, fields = []) {
    let message = `${emoji} <b>${title}</b>\n\n`;
    for (const field of fields) {
        message += `<b>${field.label}:</b> ${field.value}\n`;
    }
    message += `\n<i>${CONFIG.SCHOOL_NAME} · tbaworld.com</i>`;
    return message;
}

// ─────────────────────────────────────────────
//  EMAIL TEMPLATE COMPONENTS
//  All styled to match Torch Bearers Academy
// ─────────────────────────────────────────────

/** Full HTML wrapper with DOCTYPE and global styles */
function emailWrapper(content) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${CONFIG.SCHOOL_NAME}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F0EDE8;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td style="padding:32px 16px;">
        <!-- Outer container -->
        <table role="presentation" width="100%" style="max-width:620px;margin:0 auto;background-color:#FFFFFF;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(11,31,58,0.12);">

          ${content}

          <!-- Footer -->
          <tr>
            <td style="background-color:#0B1F3A;padding:32px 40px;text-align:center;">
              <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.SCHOOL_NAME}" width="120" style="display:block;margin:0 auto 16px auto;max-width:120px;">
              <p style="color:#E8A020;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-weight:bold;">Grooming Africa's Brightest</p>
              <p style="color:#9CA3AF;font-size:12px;margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;">
                <a href="mailto:${CONFIG.SUPPORT_EMAIL}" style="color:#E8A020;text-decoration:none;">${CONFIG.SUPPORT_EMAIL}</a>
                &nbsp;·&nbsp;
                <a href="${CONFIG.WEBSITE_URL}" style="color:#E8A020;text-decoration:none;">tbaworld.com</a>
              </p>
              <p style="color:#6B7280;font-size:11px;margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;">
                © ${new Date().getFullYear()} ${CONFIG.SCHOOL_NAME}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End outer container -->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Top header with logo on navy background */
function logoHeader() {
    return `
  <tr>
    <td style="background-color:#0B1F3A;padding:24px 40px;text-align:center;border-bottom:4px solid #E8A020;">
      <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.SCHOOL_NAME}" width="140" style="display:block;margin:0 auto;max-width:140px;">
    </td>
  </tr>`;
}

/**
 * Hero banner with gold accent stripe
 * @param {string} title
 * @param {string} subtitle
 * @param {'default'|'success'|'info'|'admin'} variant
 */
function heroBanner(title, subtitle = '', variant = 'default') {
    const gradients = {
        default: 'linear-gradient(135deg,#0B1F3A 0%,#1A3A5C 100%)',
        success: 'linear-gradient(135deg,#0B1F3A 0%,#1A3A5C 100%)',
        info:    'linear-gradient(135deg,#1A3A5C 0%,#0B2F4A 100%)',
        admin:   'linear-gradient(135deg,#2C1810 0%,#5C2D1A 100%)',
    };
    const icons = {
        default: '',
        success: '✓',
        info:    'ℹ',
        admin:   '🔔',
    };

    return `
  <tr>
    <td style="background:${gradients[variant] || gradients.default};padding:40px 40px 32px 40px;text-align:center;position:relative;">
      ${icons[variant] ? `<div style="display:inline-block;width:52px;height:52px;background-color:#E8A020;border-radius:50%;line-height:52px;font-size:22px;color:#0B1F3A;font-weight:bold;margin-bottom:16px;">${icons[variant]}</div><br>` : ''}
      <h1 style="color:#FFFFFF;font-size:24px;font-weight:bold;margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;line-height:1.3;">${title}</h1>
      ${subtitle ? `<p style="color:#E8A020;font-size:14px;margin:0;letter-spacing:1px;font-family:Arial,Helvetica,sans-serif;text-transform:uppercase;">${subtitle}</p>` : ''}
    </td>
  </tr>
  <tr>
    <td style="background-color:#E8A020;height:4px;font-size:0;line-height:0;">&nbsp;</td>
  </tr>`;
}

/** Salutation line */
function greeting(name) {
    return `
  <tr>
    <td style="padding:32px 40px 8px 40px;">
      <p style="color:#0B1F3A;font-size:16px;margin:0;font-family:Georgia,'Times New Roman',serif;">Dear <strong>${name}</strong>,</p>
    </td>
  </tr>`;
}

/** Body paragraph */
function bodyText(text) {
    return `
  <tr>
    <td style="padding:12px 40px;">
      <p style="color:#2C2C2C;font-size:15px;line-height:1.7;margin:0;font-family:Arial,Helvetica,sans-serif;">${text}</p>
    </td>
  </tr>`;
}

/**
 * Data card with label/value rows
 * @param {Array<{label:string,value:string}>} items
 */
function dataCard(items) {
    const rows = items.map((item, i) => `
    <tr style="background-color:${i % 2 === 0 ? '#FAFAF8' : '#FFFFFF'};">
      <td style="padding:12px 20px;border-bottom:1px solid #EDE9E0;width:42%;vertical-align:top;">
        <span style="color:#6B7280;font-size:12px;font-family:Arial,Helvetica,sans-serif;letter-spacing:0.5px;text-transform:uppercase;font-weight:bold;">${item.label}</span>
      </td>
      <td style="padding:12px 20px;border-bottom:1px solid #EDE9E0;vertical-align:top;">
        <span style="color:#0B1F3A;font-size:14px;font-family:Arial,Helvetica,sans-serif;font-weight:600;">${item.value}</span>
      </td>
    </tr>`).join('');

    return `
  <tr>
    <td style="padding:16px 40px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="border:1px solid #EDE9E0;border-radius:6px;overflow:hidden;">
        <tr>
          <td colspan="2" style="background-color:#0B1F3A;padding:10px 20px;">
            <span style="color:#E8A020;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Details</span>
          </td>
        </tr>
        ${rows}
      </table>
    </td>
  </tr>`;
}

/** Gold CTA button */
function ctaButton(text, url) {
    return `
  <tr>
    <td style="padding:24px 40px;text-align:center;">
      <a href="${url}" style="display:inline-block;background-color:#E8A020;color:#0B1F3A;text-decoration:none;padding:14px 40px;border-radius:4px;font-weight:bold;font-size:15px;font-family:Arial,Helvetica,sans-serif;letter-spacing:0.5px;">
        ${text}
      </a>
    </td>
  </tr>`;
}

/** Sign-off block */
function signOff() {
    return `
  <tr>
    <td style="padding:16px 40px 32px 40px;border-top:1px solid #EDE9E0;margin-top:16px;">
      <p style="color:#2C2C2C;font-size:14px;line-height:1.7;margin:0;font-family:Arial,Helvetica,sans-serif;">
        Warm regards,<br>
        <strong style="color:#0B1F3A;">The ${CONFIG.SCHOOL_NAME} Team</strong><br>
        <a href="mailto:${CONFIG.SUPPORT_EMAIL}" style="color:#E8A020;text-decoration:none;">${CONFIG.SUPPORT_EMAIL}</a>
      </p>
    </td>
  </tr>`;
}

/** Admin-only banner (amber bar) */
function adminTag() {
    return `
  <tr>
    <td style="background-color:#FEF3C7;padding:10px 40px;border-bottom:1px solid #FDE68A;text-align:center;">
      <p style="color:#92400E;font-size:12px;margin:0;font-family:Arial,Helvetica,sans-serif;">
        🔒 <strong>Admin Notification</strong> — This message is intended for school administrators only.
      </p>
    </td>
  </tr>`;
}

/** Motivational scripture/motto stripe (optional, used in welcome emails) */
function mottoStripe(text) {
    return `
  <tr>
    <td style="background-color:#FEF6E4;padding:16px 40px;text-align:center;border-top:1px solid #F5E6C8;border-bottom:1px solid #F5E6C8;">
      <p style="color:#92400E;font-size:13px;font-style:italic;margin:0;font-family:Georgia,'Times New Roman',serif;">"${text}"</p>
    </td>
  </tr>`;
}

/** Spacer row */
function spacer(px = 16) {
    return `<tr><td style="height:${px}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

// ─────────────────────────────────────────────
//  NOTIFICATION SERVICE
// ─────────────────────────────────────────────
class NotificationService {
    static async sendEmail(to, subject, html) {
        return await sendEmailResend(to, subject, html);
    }

    /** Generic payment received confirmation */
/** Generic payment received confirmation */
static async notifyPaymentReceived(data) {
    const {
        parentName,
        parentEmail,
        studentName,
        amount,
        paymentDate,
        paymentFor,
        generatedStudentId,
        password,
        paymentMethod = 'Paystack',
        reference = 'N/A'
    } = data;

    const isEnrollment = paymentFor === 'Enrollment';
    const hasCredentials = isEnrollment && generatedStudentId && password;

    // Base fields (excluding student ID for enrollment – will show in login card instead)
    const fields = [
        { label: 'Student Name', value: studentName },
        { label: 'Amount Paid', value: amount },
        { label: 'Payment For', value: paymentFor || 'Enrollment' },
        { label: 'Payment Date', value: paymentDate || new Date().toLocaleString() },
        { label: 'Payment Method', value: paymentMethod },
        { label: 'Reference ID', value: reference },
    ];

    // For non‑enrollment payments, show student ID separately if available
    if (!isEnrollment && generatedStudentId) {
        fields.push({ label: 'Student ID', value: generatedStudentId });
    }

    // Build main body
    let bodyContent = '';

    if (isEnrollment && hasCredentials) {
        bodyContent += bodyText(
            `We are delighted to confirm that your payment of <strong>${amount}</strong> has been successfully processed for <strong>${studentName}</strong>. ` +
            `Your child can now access the student portal to take the <strong>entrance examination</strong>.`
        );
        bodyContent += dataCard([
            { label: 'Student Portal Login', value: '' },
            { label: 'Student ID', value: generatedStudentId },
            { label: 'Password', value: password },
        ]);
        bodyContent += bodyText(
            'Please log in at your earliest convenience. ' +
            'Use these credentials to let your child complete the entrance examination.'
        );
        bodyContent += ctaButton('Take Entrance Examination', `${CONFIG.WEBSITE_URL}/auth/login`);
    } else {
        bodyContent += bodyText(
            `We are delighted to confirm that a payment of <strong>${amount}</strong> has been received and successfully processed for <strong>${studentName}</strong>.`
        );
        bodyContent += dataCard(fields);
        bodyContent += bodyText(
            'Should you have any questions, please do not hesitate to reach out to us.'
        );
    }

    const html = emailWrapper(
        logoHeader() +
        heroBanner(
            'Payment Received',
            isEnrollment && hasCredentials
                ? 'Your child is now ready for the entrance examination'
                : 'Thank you — your payment is confirmed',
            'success'
        ) +
        greeting(parentName) +
        bodyContent +
        spacer() +
        signOff()
    );

    const subject = isEnrollment && hasCredentials
        ? `Payment Confirmation and Entrance Exam Access — ${studentName}`
        : `Payment Confirmation — ${studentName}`;

    return await sendEmailResend(parentEmail, subject, html);
}

    /** Welcome email when a student is admitted */
    static async notifyStudentAdmitted(data) {
        const { parentName, parentEmail, studentName, studentId, branchName, className, password, parentUsername } = data;
        const html = emailWrapper(
            logoHeader() +
            heroBanner(`Welcome to ${CONFIG.SCHOOL_NAME}!`, 'Admission Confirmed', 'success') +
            mottoStripe('Grooming Africa\'s Brightest — one torch-bearer at a time.') +
            greeting(parentName) +
            bodyText(`We are thrilled to welcome <strong>${studentName}</strong> to the ${CONFIG.SCHOOL_NAME} family! 🎉 Your child has been successfully admitted, and we look forward to a wonderful journey of excellence and discovery together.`) +
            dataCard([
                { label: 'Student Name', value: studentName },
                { label: 'Student ID', value: studentId },
                { label: 'Branch', value: branchName || 'N/A' },
                { label: 'Class', value: className || 'N/A' },
                { label: 'Username', value: studentId },
                { label: 'Password', value: password },
            ]) +
            bodyText('Please log in to the student portal using the credentials above. We strongly recommend changing your password on first login for security purposes.') +
            dataCard([
                { label: 'Parent Portal Login', value: '' },
                { label: 'Email', value: parentUsername || parentEmail },
                { label: 'Password', value: 'Phone number used during registration' },
            ]) +
            bodyText('You can proceed to pay your child\'s school fees by logging into the parent portal with your email and phone number as password.') +
            ctaButton('Access Student Portal →', CONFIG.WEBSITE_URL) +
            ctaButton('Access Parent Portal →', CONFIG.WEBSITE_URL) +
            signOff()
        );

        return await sendEmailResend(parentEmail, `🎉 Welcome to ${CONFIG.SCHOOL_NAME} — ${studentName}`, html);
    }

    /** Admin notification: new enrollment */
    static async notifyAdminNewEnrollment(data) {
        const { studentName, parentName, parentEmail, parentPhone, class: className, enrollmentDate, amount, reference, branchName } = data;
        const fields = [
            { label: 'Student Name', value: studentName },
            { label: 'Branch', value: branchName || 'N/A' },
            { label: 'Parent Name', value: parentName || 'N/A' },
            { label: 'Parent Email', value: parentEmail || 'N/A' },
            { label: 'Parent Phone', value: parentPhone || 'N/A' },
            { label: 'Amount Paid', value: amount || 'N/A' },
            { label: 'Reference', value: reference || 'N/A' },
            { label: 'Enrolled On', value: enrollmentDate || new Date().toLocaleString() },
        ];

        const telegramMessage = formatTelegramMessage('📝', 'New Student Enrollment', fields);

        const adminHtml = emailWrapper(
            logoHeader() +
            adminTag() +
            heroBanner('New Student Enrollment', 'A new student has registered', 'admin') +
            dataCard(fields)
        );

        const emailPromises = CONFIG.ADMIN_EMAILS.map((email) =>
            sendEmailResend(email, `New Enrollment — ${studentName}`, adminHtml)
        );
        const [emailResults, telegramResult] = await Promise.all([
            Promise.all(emailPromises),
            sendTelegramNotification(telegramMessage),
        ]);

        return { emailResults, telegramResult };
    }

    /** Admin notification: student class migration or new admission */
    static async notifyAdminStudentMigrated(data) {
        const { studentName, studentId, oldClass, newClass, migratedBy, migrationDate, className, branchName, parentEmail, adminName } = data;
        const fields = [
            { label: 'Student Name', value: studentName },
            { label: 'Student ID', value: studentId },
        ];

        if (newClass) {
            fields.push({ label: 'From Class', value: oldClass || 'N/A' });
            fields.push({ label: 'To Class', value: newClass });
            fields.push({ label: 'Migrated By', value: migratedBy || adminName || 'N/A' });
            fields.push({ label: 'Migration Date', value: migrationDate || 'N/A' });
        } else {
            fields.push({ label: 'Branch', value: branchName || 'N/A' });
            fields.push({ label: 'Class', value: className || 'N/A' });
            fields.push({ label: 'Parent Email', value: parentEmail || 'N/A' });
        }

        const messageTitle = newClass ? 'Student Class Migration' : 'New Student Admission';
        const messageIcon = newClass ? '🔄' : '✅';

        const telegramMessage = formatTelegramMessage(messageIcon, messageTitle, fields);

        const telegramResult = await sendTelegramNotification(telegramMessage);

        return { telegramResult };
    }

    /** Parent notification: school fees payment */
    static async notifySchoolFeesPayment(data) {
        const { parentName, parentEmail, studentName, amount, paymentDate, term, academicYear, transactionId } = data;
        const html = emailWrapper(
            logoHeader() +
            heroBanner('School Fees Confirmation', 'Payment received successfully', 'success') +
            greeting(parentName) +
            bodyText(`We are pleased to confirm receipt of <strong>${amount}</strong> as school fees for <strong>${studentName}</strong>. A receipt has been recorded on your account.`) +
            dataCard([
                { label: 'Student Name',   value: studentName },
                { label: 'Amount Paid',    value: amount },
                { label: 'Term',           value: term || 'N/A' },
                { label: 'Academic Year',  value: academicYear || 'N/A' },
                { label: 'Payment Date',   value: paymentDate },
                { label: 'Transaction ID', value: transactionId || 'N/A' },
            ]) +
            bodyText('Thank you for your continued investment in your child\'s education. If you need a printed receipt or have any billing questions, please contact us.') +
            spacer() +
            signOff()
        );

        return await sendEmailResend(parentEmail, `School Fees Confirmed — ${studentName} (${term || academicYear || ''})`, html);
    }

    /** Admin notification: school fees payment (Telegram only) */
    static async notifyAdminSchoolFeesPayment(data) {
        const { studentName, parentName, amount, paymentDate, term, academicYear, transactionId } = data;
        const fields = [
            { label: 'Student Name',   value: studentName },
            { label: 'Parent Name',    value: parentName },
            { label: 'Amount Paid',    value: amount },
            { label: 'Term',           value: term || 'N/A' },
            { label: 'Academic Year',  value: academicYear || 'N/A' },
            { label: 'Payment Date',   value: paymentDate },
            { label: 'Transaction ID', value: transactionId || 'N/A' },
        ];

        const telegramMessage = formatTelegramMessage('💰', 'School Fees Payment Received', fields);
        return await sendTelegramNotification(telegramMessage);
    }

    static getConfig() {
        return { ...CONFIG };
    }
}

module.exports = NotificationService;