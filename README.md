# חופה לזכר ירון אליעזר צ׳יטיז הי״ד

Hebrew memorial website and chuppah booking management, based on the family's PDF. Replaces the Google Form with persistent booking requests and a password-protected admin page.

## Run locally

Requires Node.js 24 or newer. No dependency installation required.

```sh
npm start
```

- Website: http://127.0.0.1:3000
- Admin: http://127.0.0.1:3000/admin
- First run generates an admin password in `data/admin-password.txt` (ignored by Git).
- Bookings and settings are stored in `data/bookings.sqlite` (ignored by Git).

Use `ADMIN_PASSWORD` to provide your own password. `PORT`, `HOST`, `DATA_DIR`, and `PUBLIC_ORIGIN` can also be configured. The default binds only to this computer. If hosting behind HTTPS, set `PUBLIC_ORIGIN` to the exact public origin; this also enables secure session cookies. The browser must access the configured origin, including hostname and port.

## Initial workflow

1. Couple selects an available date and submits name, wedding location, and contact phone.
2. Pending requests hold their date. Another request cannot reserve it, including concurrent submissions.
3. Admin approves, rejects, or cancels requests. Rejection/cancellation releases the date.
4. Admin sets the return date (default two days after the wedding), views due/overdue returns, and marks the cloth returned.
5. Optional WhatsApp buttons open prepared confirmation, return-reminder, and donation messages for the admin to send manually. Nothing sends automatically. Admin can record when a reminder/donation message was actually sent.
6. Donation URL is configured in the admin page. No placeholder donation destination is used.

Requests store personal information privately; the public availability endpoint exposes dates only. Sessions expire after eight hours and on server restart. Login and booking requests have basic rate limits. Local SQLite storage must be on a persistent disk when hosting, with regular backups. For multiple app instances, rate limits and sessions would need shared storage. The initial date rule blocks the wedding date only; pickup/return turnaround dates are not automatically blocked.

## Checks

```sh
npm test
```

Tests cover duplicate reservation prevention, state transitions, input validation, donation link validation, return tracking, message records, and persistence.

The photos and Hebrew memorial text were recovered from the supplied family PDF. Videos remain links to the original YouTube destinations. Messaging delivery integration and deployment are future setup steps.
