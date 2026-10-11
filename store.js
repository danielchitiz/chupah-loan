import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
export const addDays = (date, count) => new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(email);
}
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function createStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, location TEXT NOT NULL,
      phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', return_date TEXT NOT NULL,
      created_at TEXT NOT NULL, reminder_at TEXT, donation_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_date ON bookings(date) WHERE status IN ('pending','approved');
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      description TEXT NOT NULL, destination TEXT NOT NULL, image TEXT NOT NULL,
      position INTEGER NOT NULL, visible INTEGER NOT NULL CHECK(visible IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS email_jobs (
      id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL,
      created_at TEXT NOT NULL, sent_at TEXT, last_error TEXT,
      UNIQUE(booking_id, kind)
    );`);
  if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'email')) {
    db.exec("ALTER TABLE bookings ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
  // Seed once; later admin edits and deletions must survive restarts.
  if (!db.prepare("SELECT value FROM settings WHERE key='actions_seeded'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const seed = db.prepare('INSERT OR IGNORE INTO actions VALUES (?,?,?,?,?,?,?,?)');
      seed.run(randomUUID(), 'chuppah', 'החופה של ירון', 'זיכרון, המשכיות ובניין חיים חדשים. השאלת החופה ליום החתונה שלכם.', '/chuppah', '/assets/chuppah.jpg', 0, 1);
      seed.run(randomUUID(), 'videos', 'סיפורים וסרטונים', 'הסיפור של החופה והאנשים שממשיכים את האור של ירון.', 'https://www.youtube.com/watch?v=vJeUFpcJcMI', '', 1, 1);
      db.prepare('INSERT INTO settings VALUES (?,?)').run('actions_seeded', '1');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const list = () => db.prepare('SELECT * FROM bookings ORDER BY date, created_at').all();
  const get = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  const queueEmail = (row, kind) => {
    if (!row.email) return;
    const now = new Date().toISOString();
    const payload = JSON.stringify({ name: row.name, email: row.email, date: row.date, location: row.location, return_date: row.return_date });
    db.prepare('INSERT OR IGNORE INTO email_jobs (id,booking_id,kind,payload,next_attempt,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),row.id,kind,payload,now,now);
  };
  return {
    db, list, get,
    emailStatus: () => db.prepare('SELECT id,booking_id,kind,status,attempts,sent_at,last_error FROM email_jobs ORDER BY created_at').all(),
    dueEmails: () => db.prepare("SELECT * FROM email_jobs WHERE status='pending' AND next_attempt<=? ORDER BY created_at,CASE kind WHEN 'received' THEN 0 ELSE 1 END,id LIMIT 20").all(new Date().toISOString()),
    emailSent(id) { db.prepare("UPDATE email_jobs SET status='sent',sent_at=?,attempts=attempts+1,last_error=NULL WHERE id=?").run(new Date().toISOString(),id); },
    emailSkipped(id) { db.prepare("UPDATE email_jobs SET status='cancelled' WHERE id=?").run(id); },
    emailFailed(job, code) {
      const attempts = job.attempts + 1;
      const nextAttempt = new Date(Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000).toISOString();
      db.prepare('UPDATE email_jobs SET status=?,attempts=?,next_attempt=?,last_error=? WHERE id=?').run(attempts >= 5 ? 'failed' : 'pending',attempts,nextAttempt,code,job.id);
    },
    retryEmail(id) {
      const job = db.prepare('SELECT * FROM email_jobs WHERE id=?').get(id);
      if (!job) throw new AppError('הודעת הדוא״ל לא נמצאה',404);
      if (!['pending','failed'].includes(job.status)) throw new AppError('ניתן לנסות שוב רק הודעה שלא נשלחה');
      db.prepare("UPDATE email_jobs SET status='pending',attempts=0,next_attempt=?,last_error=NULL WHERE id=?").run(new Date().toISOString(),id);
    },
    actions: (publicOnly = false) => db.prepare(`SELECT * FROM actions ${publicOnly ? 'WHERE visible=1' : ''} ORDER BY position, title, id`).all(),
    actionBySlug: slug => db.prepare('SELECT * FROM actions WHERE slug=? AND visible=1').get(slug),
    saveAction(input, id) {
      const existing = id ? db.prepare('SELECT * FROM actions WHERE id=?').get(id) : null;
      if (id && !existing) throw new AppError('היוזמה לא נמצאה', 404);
      const row = { ...existing, ...input };
      const title = String(row.title || '').trim(), description = String(row.description || '').trim();
      const slug = String(row.slug || '').trim(), destination = String(row.destination || '').trim(), image = String(row.image || '').trim();
      if (title.length < 2 || title.length > 120 || description.length > 600) throw new AppError('יש להזין כותרת תקינה ותיאור של עד 600 תווים');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) throw new AppError('כתובת היוזמה יכולה להכיל אותיות באנגלית, ספרות ומקפים בלבד');
      if (typeof row.visible !== 'boolean' && ![0,1].includes(row.visible)) throw new AppError('יש לבחור אם היוזמה מוצגת');
      const safeHttps = value => {
        try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[\r\n]/.test(value); } catch { return false; }
      };
      if (destination.length > 2000 || (destination && destination !== '/chuppah' && !safeHttps(destination)) || (row.visible && !destination)) throw new AppError('יש להזין קישור https:// תקין או /chuppah. יוזמה ללא קישור ניתן לשמור כטיוטה');
      if (image.length > 2000 || (image && !['/assets/chuppah.jpg','/assets/yaron.jpg'].includes(image) && !safeHttps(image))) throw new AppError('יש להזין כתובת תמונה תקינה שמתחילה ב־https://');
      const position = Number(row.position);
      if (!Number.isInteger(position) || position < 0 || position > 9999) throw new AppError('סדר התצוגה חייב להיות מספר בין 0 ל־9999');
      const actionId = id || randomUUID();
      try {
        db.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,description=excluded.description,destination=excluded.destination,image=excluded.image,position=excluded.position,visible=excluded.visible')
          .run(actionId, slug, title, description, destination && destination !== '/chuppah' ? new URL(destination).href : destination, image, position, Number(row.visible));
      } catch (error) {
        if (error.message.includes('UNIQUE')) throw new AppError('כתובת היוזמה כבר בשימוש', 409);
        throw error;
      }
      return db.prepare('SELECT * FROM actions WHERE id=?').get(actionId);
    },
    deleteAction(id) {
      if (!db.prepare('DELETE FROM actions WHERE id=?').run(id).changes) throw new AppError('היוזמה לא נמצאה', 404);
    },
    unavailable: () => db.prepare("SELECT date FROM bookings WHERE status IN ('pending','approved') AND date>=? ORDER BY date").all(today()).map(r => r.date),
    settings: () => Object.fromEntries(db.prepare("SELECT * FROM settings WHERE key != 'actions_seeded'").all().map(r => [r.key, r.value])),
    saveSettings(input) {
      const url = String(input.donation_url || '').trim();
      if (url) {
        try { if (new URL(url).protocol !== 'https:') throw new Error(); }
        catch { throw new AppError('יש להזין קישור תרומה תקין שמתחיל ב־https://'); }
      }
      if (url.length > 2000) throw new AppError('הקישור ארוך מדי');
      db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('donation_url', url);
      return this.settings();
    },
    create(input) {
      const name = String(input.name || '').trim(), location = String(input.location || '').trim();
      const phone = String(input.phone || '').replace(/[\s()-]/g, '');
      const email = String(input.email || '').trim();
      if (name.length < 2 || name.length > 120 || location.length < 2 || location.length > 250) throw new AppError('יש למלא שם ומיקום תקינים');
      if (!/^\+?\d{9,15}$/.test(phone)) throw new AppError('יש להזין מספר טלפון תקין, כולל קידומת מדינה למספר מחו״ל');
      if (!validEmail(email)) throw new AppError('יש להזין כתובת דוא״ל תקינה');
      if (!validDate(input.date) || input.date < today() || input.date > addDays(today(), 730)) throw new AppError('יש לבחור תאריך בשנתיים הקרובות');
      const id = randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO bookings (id,name,date,location,phone,email,return_date,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, name, input.date, location, phone, email, addDays(input.date, 2), new Date().toISOString());
        queueEmail(get(id),'received');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        if (error.message.includes('UNIQUE')) throw new AppError('התאריך כבר תפוס. אנא בחרו תאריך אחר', 409);
        throw error;
      }
      return { id, status: 'pending' };
    },
    update(id, input) {
      const row = get(id);
      if (!row) throw new AppError('הבקשה לא נמצאה', 404);
      const transitions = { pending: ['approved', 'rejected', 'cancelled'], approved: ['returned', 'cancelled'], returned: [], rejected: [], cancelled: [] };
      const status = input.status ?? row.status;
      if (status !== row.status && !transitions[row.status].includes(status)) throw new AppError('שינוי הסטטוס אינו אפשרי');
      const returnDate = input.return_date ?? row.return_date;
      if (!validDate(returnDate) || returnDate < row.date) throw new AppError('תאריך ההחזרה חייב להיות ביום החתונה או אחריו');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE bookings SET status=?,return_date=? WHERE id=?').run(status, returnDate, id);
        if (row.status !== 'approved' && status === 'approved') queueEmail(get(id),'approved');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return get(id);
    },
    recordMessage(id, type) {
      if (!get(id)) throw new AppError('הבקשה לא נמצאה', 404);
      if (!['reminder', 'donation'].includes(type)) throw new AppError('סוג הודעה לא תקין');
      db.prepare(`UPDATE bookings SET ${type}_at=? WHERE id=?`).run(new Date().toISOString(), id);
      return get(id);
    }
  };
}
