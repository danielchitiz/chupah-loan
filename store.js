import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
export const addDays = (date, count) => new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
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
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const list = () => db.prepare('SELECT * FROM bookings ORDER BY date, created_at').all();
  const get = id => db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  return {
    db, list, get,
    unavailable: () => db.prepare("SELECT date FROM bookings WHERE status IN ('pending','approved') AND date>=? ORDER BY date").all(today()).map(r => r.date),
    settings: () => Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r => [r.key, r.value])),
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
      if (name.length < 2 || name.length > 120 || location.length < 2 || location.length > 250) throw new AppError('יש למלא שם ומיקום תקינים');
      if (!/^\+?\d{9,15}$/.test(phone)) throw new AppError('יש להזין מספר טלפון תקין, כולל קידומת מדינה למספר מחו״ל');
      if (!validDate(input.date) || input.date < today() || input.date > addDays(today(), 730)) throw new AppError('יש לבחור תאריך בשנתיים הקרובות');
      const id = randomUUID();
      try {
        db.prepare('INSERT INTO bookings (id,name,date,location,phone,return_date,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, name, input.date, location, phone, addDays(input.date, 2), new Date().toISOString());
      } catch (error) {
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
      db.prepare('UPDATE bookings SET status=?,return_date=? WHERE id=?').run(status, returnDate, id);
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
