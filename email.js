import nodemailer from 'nodemailer';
import { validEmail } from './store.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateLabel = date => new Date(date+'T12:00:00Z').toLocaleDateString('he-IL');

export function emailContent(kind, booking) {
  const received = kind === 'received';
  const subject = received ? 'בקשתכם להשאלת החופה התקבלה | לזכר ירון צ׳יטיז הי״ד' : 'בקשתכם להשאלת החופה אושרה | לזכר ירון צ׳יטיז הי״ד';
  const intro = received
    ? 'בקשתכם להשאלת החופה לזכר ירון אליעזר צ׳יטיז הי״ד התקבלה. התאריך נשמר וממתין לאישור. זו הודעת קבלת הבקשה בלבד; ניצור עמכם קשר לאחר בדיקת הפרטים.'
    : 'בקשתכם להשאלת החופה לזכר ירון אליעזר צ׳יטיז הי״ד אושרה. ניצור עמכם קשר לתיאום איסוף והחזרה.';
  const lines = [`שלום ${booking.name},`, intro, `תאריך החתונה: ${dateLabel(booking.date)}`, `מיקום החתונה: ${booking.location}`];
  if (!received) lines.push(`תאריך ההחזרה: ${dateLabel(booking.return_date)}`);
  lines.push('תודה שבחרתם לקחת חלק במיזם. מזל טוב!', 'לזכר ירון אליעזר צ׳יטיז הי״ד');
  return { subject, text: lines.join('\n\n'), html: `<html lang="he" dir="rtl"><body style="direction:rtl;text-align:right;background:#faf7f1;color:#23394e;font-family:Arial,sans-serif;padding:28px"><h1 style="font-size:24px">החופה של ירון</h1>${lines.map(line=>`<p style="line-height:1.8">${escapeHtml(line)}</p>`).join('')}</body></html>` };
}

export function createEmailSender(env = process.env, createTransport = nodemailer.createTransport) {
  if (!env.SMTP_HOST || !env.EMAIL_FROM) return null;
  if (!validEmail(env.EMAIL_FROM)) throw new Error('EMAIL_FROM must be a plain valid email address');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) throw new Error('Set both SMTP_USER and SMTP_PASS');
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid port');
  const transport = createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true
  });
  return async (job, booking) => {
    const result = await transport.sendMail({
      from: { name: 'החופה לזכר ירון צ׳יטיז הי״ד', address: env.EMAIL_FROM },
      to: { address: booking.email }, messageId: `<${job.id}@${env.EMAIL_FROM.split('@')[1]}>`,
      ...emailContent(job.kind, booking)
    });
    if (!result.accepted?.length) throw Object.assign(new Error('Recipient was not accepted'), { code: 'ERECIPIENT' });
  };
}

export function createEmailWorker(store, sender) {
  let running = false;
  return {
    configured: Boolean(sender),
    async flush() {
      if (!sender || running) return;
      running = true;
      try {
        for (const job of store.dueEmails()) {
          const current = store.get(job.booking_id);
          if (!current || ['cancelled','rejected'].includes(current.status) || (job.kind === 'approved' && current.status !== 'approved')) {
            store.emailSkipped(job.id); continue;
          }
          try {
            // Use the latest return date if the admin changes it before delivery.
            await sender(job, { ...JSON.parse(job.payload), return_date: current.return_date });
            store.emailSent(job.id);
          } catch (error) {
            // Store error codes only; SMTP errors may contain addresses or credentials.
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED';
            store.emailFailed(job, code);
          }
        }
      } finally { running = false; }
    }
  };
}
