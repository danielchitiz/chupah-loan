import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createStore, AppError } from './store.js';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const credentialPath = resolve(dataDir, 'admin-password.txt');
if (!process.env.ADMIN_PASSWORD && !existsSync(credentialPath)) writeFileSync(credentialPath, randomBytes(18).toString('base64url'), { mode: 0o600 });
const password = process.env.ADMIN_PASSWORD || readFileSync(credentialPath, 'utf8').trim();
const salt = randomBytes(32), passwordHash = scryptSync(password, salt, 64);
const store = createStore(resolve(dataDir, 'bookings.sqlite'));
const sessions = new Map(), limits = new Map();
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
const expectedOrigin = process.env.PUBLIC_ORIGIN || `http://${host}:${port}`;
const secure = expectedOrigin.startsWith('https://');
function limited(req, kind, maximum) {
  const key = `${req.socket.remoteAddress}:${kind}`, now = Date.now();
  let item = limits.get(key);
  if (!item || item.until < now) { item = { count: 0, until: now + 15 * 60000 }; limits.set(key, item); }
  if (++item.count > maximum) throw new AppError('יותר מדי ניסיונות. נסו שוב בעוד מספר דקות', 429);
}
function session(req) {
  const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const expiry = sessions.get(token);
  return token && expiry > Date.now() ? token : null;
}
async function body(req) {
  let result = '';
  for await (const chunk of req) { result += chunk; if (Buffer.byteLength(result) > 12000) throw new AppError('הבקשה גדולה מדי', 413); }
  try { const value = JSON.parse(result); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new AppError('בקשה לא תקינה'); }
}
const files = { '/': 'index.html', '/admin': 'admin.html', '/style.css': 'style.css', '/app.js': 'app.js', '/admin.js': 'admin.js', '/assets/chuppah.jpg': 'assets/chuppah.jpg', '/assets/yaron.jpg': 'assets/yaron.jpg' };
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', jpg: 'image/jpeg' };
const server = http.createServer(async (req, res) => {
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  try {
    const path = new URL(req.url, expectedOrigin).pathname;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin !== expectedOrigin) throw new AppError('מקור הבקשה אינו מורשה', 403);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('יש לשלוח JSON', 415);
    }
    if (req.method === 'GET' && files[path]) {
      res.setHeader('Content-Type', types[files[path].split('.').pop()]);
      return res.end(readFileSync(resolve(root, 'public', files[path])));
    }
    if (path === '/api/availability' && req.method === 'GET') return json({ unavailable: store.unavailable() });
    if (path === '/api/bookings' && req.method === 'POST') { limited(req, 'booking', 15); return json(store.create(await body(req)), 201); }
    if (path === '/api/login' && req.method === 'POST') {
      limited(req, 'login', 10);
      const input = await body(req);
      if (typeof input.password !== 'string' || !timingSafeEqual(scryptSync(input.password, salt, 64), passwordHash)) throw new AppError('הסיסמה אינה נכונה', 401);
      const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 8 * 3600000);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`);
      return json({ ok: true });
    }
    if (path.startsWith('/api/admin/')) {
      const token = session(req);
      if (!token) throw new AppError('יש להתחבר לניהול', 401);
      if (path === '/api/admin/logout' && req.method === 'POST') {
        sessions.delete(token); res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json({ ok: true });
      }
      if (path === '/api/admin/bookings' && req.method === 'GET') return json({ bookings: store.list(), settings: store.settings() });
      if (path === '/api/admin/settings' && req.method === 'PATCH') return json(store.saveSettings(await body(req)));
      const match = /^\/api\/admin\/bookings\/([a-f0-9-]+)(\/messages)?$/.exec(path);
      if (match && req.method === 'PATCH' && !match[2]) return json(store.update(match[1], await body(req)));
      if (match && req.method === 'POST' && match[2]) return json(store.recordMessage(match[1], (await body(req)).type));
    }
    throw new AppError('העמוד לא נמצא', 404);
  } catch (error) {
    if (!error.status) console.error(error);
    json({ error: error.status ? error.message : 'אירעה שגיאה. נסו שוב' }, error.status || 500);
  }
});
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of sessions) if (expiry < now) sessions.delete(key);
  for (const [key, value] of limits) if (value.until < now) limits.delete(key);
}, 60000).unref();
server.listen(port, host, () => {
  console.log(`Website: ${expectedOrigin}\nAdmin: ${expectedOrigin}/admin\nAdmin password: ${process.env.ADMIN_PASSWORD ? 'set through ADMIN_PASSWORD' : credentialPath}`);
});
