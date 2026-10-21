const nodemailer = require("nodemailer");

// Dedicated Gmail EMAIL_* settings take precedence when supplied. Older Brevo/SMTP
// configurations remain supported for registration and existing integrations.
const mailHost = process.env.EMAIL_HOST || process.env.BREVO_SMTP_HOST || process.env.SMTP_HOST;
const mailPort = Number(process.env.EMAIL_PORT || process.env.BREVO_SMTP_PORT || process.env.SMTP_PORT || 587);
const mailUser = process.env.EMAIL_USER || process.env.BREVO_SMTP_USERNAME || process.env.SMTP_USER;
const mailPass = process.env.EMAIL_PASS || process.env.BREVO_SMTP_PASSWORD || process.env.SMTP_PASS;
const smtpConfigured = Boolean(mailHost && mailUser && mailPass);
const mailFrom = process.env.EMAIL_FROM || process.env.MAIL_FROM || (process.env.BREVO_FROM_EMAIL ? `RENZ BARBERSHOP <${process.env.BREVO_FROM_EMAIL}>` : mailUser);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
    host: mailHost,
    port: mailPort,
    secure: mailPort === 465,
    auth: {
      user: mailUser,
      pass: mailPass
    }
  })
  : null;

// Appointment notifications always use the dedicated Gmail EMAIL_* account.
// Brevo sender settings must never override this account's From address.
const gmailHost = process.env.EMAIL_HOST;
const gmailPort = Number(process.env.EMAIL_PORT || 587);
const gmailUser = process.env.EMAIL_USER;
const gmailPass = process.env.EMAIL_PASS;
const gmailReady = Boolean(gmailHost && gmailUser && gmailPass && [465, 587].includes(gmailPort));
const gmailTransporter = gmailReady ? nodemailer.createTransport({
  host: gmailHost,
  port: gmailPort,
  secure: gmailPort === 465,
  requireTLS: gmailPort === 587,
  connectionTimeout: 12000,
  greetingTimeout: 12000,
  socketTimeout: 20000,
  auth: { user: gmailUser, pass: gmailPass }
}) : null;

async function send2FA(email, code) {
  if (!transporter) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured.");
    }

    // Never log verification codes or claim delivery without SMTP.
    throw new Error("SMTP is not configured.");
  }

  await transporter.sendMail({
    from: mailFrom,
    to: email,
    subject: "Barbershop Admin Login Verification Code",
    text: `Your Barbershop verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<h2>Barbershop Login Verification</h2>
           <p>Your verification code is:</p>
           <h1 style="letter-spacing:6px">${code}</h1>
           <p>This code expires in 10 minutes.</p>`
  });
}

// Email-only presentation helpers. All user-entered fields are escaped before
// inclusion in HTML; text-only notifications continue to use the original text.
function escapeEmailHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function appointmentEmailTheme(subject) {
  const s = String(subject || '').toLowerCase();
  if (s.includes('cancel')) return { label: 'APPOINTMENT CANCELLED', heading: 'Appointment Cancelled', icon: '&#10005;', accent: '#9e4a42', light: '#fcf1ef', note: 'If you need another schedule, you can book a new appointment through your customer account.' };
  if (s.includes('delay')) return { label: 'SCHEDULE UPDATE', heading: 'A Little Schedule Update', icon: '&#9200;', accent: '#9a702d', light: '#fff7e8', note: 'Your live Customer Dashboard has the most up-to-date waiting information.' };
  if (s.includes('next')) return { label: 'YOU ARE NEXT', heading: "You're Up Next!", icon: '&#9986;', accent: '#276f58', light: '#ecf8f1', note: 'Please be ready at the barbershop and wait for the cashier or barber to call you.' };
  if (s.includes('complet')) return { label: 'SERVICE COMPLETED', heading: 'Looking Sharp!', icon: '&#10003;', accent: '#276f58', light: '#ecf8f1', note: 'Thank you for visiting us. We look forward to seeing you again!' };
  if (s.includes('remind')) return { label: 'FRIENDLY REMINDER', heading: 'Your Appointment Is Coming Up', icon: '&#9200;', accent: '#9a702d', light: '#fff7e8', note: 'Please arrive on time. Your live Customer Dashboard will show any queue updates.' };
  if (s.includes('checked in')) return { label: 'CHECK-IN SUCCESSFUL', heading: "You're Checked In!", icon: '&#10003;', accent: '#276f58', light: '#ecf8f1', note: 'You can follow your queue status on the Customer Dashboard.' };
  if (s.includes('confirm')) return { label: 'BOOKING CONFIRMED', heading: 'Appointment Confirmed!', icon: '&#10003;', accent: '#276f58', light: '#ecf8f1', note: 'We will send a reminder before your appointment. See you soon!' };
  if (s.includes('received')) return { label: 'BOOKING RECEIVED', heading: 'We Received Your Booking', icon: '&#10003;', accent: '#9a702d', light: '#fff7e8', note: 'Your booking is waiting for confirmation. Please check your Customer Dashboard for the latest status.' };
  return { label: 'APPOINTMENT UPDATE', heading: 'Your Barbershop Update', icon: '&#9986;', accent: '#276f58', light: '#ecf8f1', note: 'For the latest appointment and queue status, please check your Customer Dashboard.' };
}

function appointmentEmailHTML(subject, message, appointment) {
  const theme = appointmentEmailTheme(subject);
  const safe = escapeEmailHTML;
  const details = [];
  if (appointment) {
    if (appointment.service) details.push(['Haircut / Service', appointment.service]);
    if (appointment.barberName) details.push(['Assigned Barber', appointment.barberName]);
    if (appointment.startsAt) {
      const date = new Date(appointment.startsAt);
      if (Number.isFinite(date.getTime())) {
        details.push(['Appointment Date', new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' }).format(date)]);
        details.push(['Appointment Time', new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).format(date)]);
      }
    }
    if (appointment.method) details.push(['Payment Method', ({ cash: 'Cash at Counter', gcash: 'GCash at Counter', card: 'Card at Counter', other: 'Other' })[appointment.method] || appointment.method]);
    if (typeof appointment.price === 'number' && Number.isFinite(appointment.price)) details.push(['Service Price', `PHP ${appointment.price.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]);
  }
  const detailRows = details.map(([label, value], i) => `<tr><td style="padding:11px 0;${i?'border-top:1px solid #e9e4da;':''}color:#79766f;font-size:13px;vertical-align:top;width:44%">${safe(label)}</td><td align="right" style="padding:11px 0;${i?'border-top:1px solid #e9e4da;':''}color:#24231f;font-size:13px;font-weight:700;vertical-align:top">${safe(value)}</td></tr>`).join('');
  const greet = appointment?.customerName ? `<p style="margin:0 0 12px;color:#24231f;font-size:15px;font-weight:700">Hi ${safe(appointment.customerName)},</p>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(theme.heading)} - Renz Barbershop</title></head><body style="margin:0;padding:0;background:#f1eee8;font-family:Arial,Helvetica,sans-serif;color:#282720;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${safe(message).slice(0,150)}</div><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f1eee8"><tr><td align="center" style="padding:30px 12px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:580px;background:#ffffff;border-radius:18px;overflow:hidden"><tr><td align="center" style="background:#24231f;padding:34px 24px 30px"><div style="font-size:29px;color:#d5b17a;line-height:1">&#9986;</div><div style="font-size:22px;line-height:1.3;font-weight:800;letter-spacing:2px;color:#fff;margin-top:9px">RENZ BARBERSHOP</div><div style="font-size:10px;letter-spacing:2px;color:#c9c3b8;margin-top:9px">YOUR STYLE. YOUR TURN. YOUR TIME.</div></td></tr><tr><td style="padding:32px 28px 16px"><div style="text-align:center"><div style="display:inline-block;background:${theme.light};color:${theme.accent};border-radius:50%;width:54px;height:54px;line-height:54px;font-size:27px;font-weight:bold">${theme.icon}</div><div style="font-size:10px;letter-spacing:2px;font-weight:bold;color:${theme.accent};margin-top:17px">${safe(theme.label)}</div><h1 style="margin:10px 0 24px;font-size:25px;line-height:1.3;color:#24231f">${safe(theme.heading)}</h1></div>${greet}<p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#5c5a54;white-space:pre-line">${safe(message)}</p>${details.length?`<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8f6f1;border-radius:12px"><tr><td style="padding:20px"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#24231f;padding-bottom:9px">YOUR APPOINTMENT DETAILS</div><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${detailRows}</table></td></tr></table>`:''}<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:20px;background:${theme.light};border-radius:10px"><tr><td style="padding:17px 19px;font-size:13px;line-height:1.7;color:#5a5142">${safe(theme.note)}</td></tr></table><div style="padding:28px 0 10px;text-align:center;font-weight:700;font-size:13px;color:#24231f">Thank you for choosing RENZ!</div></td></tr><tr><td style="background:#f8f6f1;padding:22px 20px;text-align:center"><div style="font-size:11px;font-weight:700;color:#77716a">RENZ BARBERSHOP</div><div style="font-size:11px;line-height:1.6;color:#8a857e;margin-top:6px">This is an automated appointment email. Please do not share personal account details in a reply.</div></td></tr></table></td></tr></table></body></html>`;
}

async function sendAppointmentEmail(email, subject, message, appointment = null) {
  if (!gmailTransporter) {
    console.error('[Appointment email] Gmail SMTP is not configured correctly. Check EMAIL_HOST, EMAIL_PORT (587/465), EMAIL_USER and EMAIL_PASS in Render.');
    const error = new Error('Gmail SMTP is not configured correctly.');
    error.code = 'GMAIL_CONFIG';
    throw error;
  }
  if (typeof email !== 'string' || !email.trim()) {
    const error = new Error('Appointment does not have a customer email address.');
    error.code = 'MISSING_RECIPIENT';
    throw error;
  }

  // Do not log email addresses, passwords, content or appointment details.
  console.info('[Appointment email] Gmail SMTP send started.');
  try {
    const info = await gmailTransporter.sendMail({
      from: { name: 'RENZ BARBERSHOP', address: gmailUser },
      to: email,
      subject,
      text: message,
      html: appointmentEmailHTML(subject, message, appointment)
    });
    if (!info.accepted?.length) {
      const error = new Error('Gmail SMTP did not accept the recipient.');
      error.code = 'GMAIL_NOT_ACCEPTED';
      throw error;
    }
    // SMTP acceptance means Gmail queued the message, not guaranteed inbox delivery.
    console.info('[Appointment email] Gmail SMTP accepted the message (inbox delivery not guaranteed).');
    return info;
  } catch (error) {
    console.error('[Appointment email] Gmail SMTP send failed:', error.code || error.message);
    throw error;
  }
}

async function sendCustomerVerification(email, code) {
  const senderEmail = process.env.BREVO_FROM_EMAIL || process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!senderEmail) throw new Error("Sender email is not configured.");
  const from = { address: senderEmail, name: process.env.BREVO_FROM_NAME || "RENZ BARBERSHOP" };
  const subject = "RENZ BARBERSHOP - Verify your email";
  const text = `Your RENZ BARBERSHOP verification code is ${code}. It expires in 5 minutes. If you did not register, ignore this email. Do not share this code.`;
  const html = `<h2>RENZ BARBERSHOP</h2><p>Your email verification code is:</p><h1 style="letter-spacing:5px">${code}</h1><p>This code expires in 5 minutes. Never share this code.</p>`;

  // Brevo's HTTPS API works on networks that block outbound SMTP (port 587).
  // Prefer the API when configured; otherwise keep the existing SMTP integration.
  const apiKey = process.env.BREVO_API_KEY;
  if (apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sender: { email: senderEmail, name: from.name }, to: [{ email }], subject, textContent: text, htmlContent: html }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      // No body logging: never risk exposing an email address or credentials.
      const error = new Error(`Brevo API rejected verification email (HTTP ${response.status}). Check API key, account status and verified sender.`);
      error.code = `BREVO_HTTP_${response.status}`;
      throw error;
    }
    return;
  }

  if (!transporter) throw new Error("Email delivery is not configured. Set BREVO_API_KEY or Brevo SMTP variables in backend/.env.");
  await transporter.sendMail({ from, to: email, subject, text, html });
}

async function sendPasswordReset(email, resetUrl) {
  // Reuse the existing Brevo API/SMTP delivery path, never exposing credentials to the browser.
  const senderEmail = process.env.BREVO_FROM_EMAIL || process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!senderEmail) throw new Error('Sender email is not configured.');
  const subject = 'RENZ BARBERSHOP - Reset your password';
  const text = `We received a request to reset your password. Open this link within 15 minutes: ${resetUrl}\n\nIf you did not request this, ignore the email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;background:#fff;padding:28px;color:#282720"><h2 style="color:#8a7652">RENZ BARBERSHOP</h2><h3>Reset your password</h3><p>We received a request to reset your account password.</p><p><a href="${escapeEmailHTML(resetUrl)}" style="display:inline-block;padding:12px 20px;background:#242522;color:white;border-radius:8px;text-decoration:none">Reset Password</a></p><p>This link expires in 15 minutes and can only be used once.</p><p>If you didn't request this, ignore this email.</p></div>`;
  if (process.env.BREVO_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method:'POST',
        headers: { 'api-key':process.env.BREVO_API_KEY, 'Content-Type':'application/json', Accept:'application/json' },
        body:JSON.stringify({ sender:{ email:senderEmail, name:process.env.BREVO_FROM_NAME || 'RENZ BARBERSHOP' }, to:[{email}], subject, textContent:text, htmlContent:html }),
        signal:controller.signal
      });
      if (!response.ok) throw new Error(`Brevo reset mail HTTP ${response.status}`);
    } finally { clearTimeout(timeout); }
    return;
  }
  if (!transporter) throw new Error('Brevo API/SMTP email delivery is not configured.');
  await transporter.sendMail({ from:mailFrom, to:email, subject, text, html });
}

module.exports = { send2FA, sendAppointmentEmail, sendCustomerVerification, sendPasswordReset };
