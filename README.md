# חופה לזכר ירון אליעזר צ׳יטיז הי״ד

Hebrew memorial homepage for Yaron, with managed initiative links and chuppah booking management, based on the family's PDF. Replaces the Google Form with persistent booking requests and a password-protected admin page.

## Run locally

Requires Node.js 24 or newer. Install the email delivery dependency before running.

```sh
npm install
npm start
```

- Website: http://127.0.0.1:3000
- Chuppah bookings: http://127.0.0.1:3000/chuppah (accessible directly)
- Admin: http://127.0.0.1:3000/admin
- First run generates an admin password in `data/admin-password.txt` (ignored by Git).
- Bookings and settings are stored in `data/bookings.sqlite` (ignored by Git).

Use `ADMIN_PASSWORD` to provide your own password. `PORT`, `HOST`, `DATA_DIR`, and `PUBLIC_ORIGIN` can also be configured. The default binds only to this computer. If hosting behind HTTPS, set `PUBLIC_ORIGIN` to the exact public origin; this also enables secure session cookies. The browser must access the configured origin, including hostname and port.

## Initial workflow

The homepage introduces Yaron and displays visible initiatives as cards. In the admin page, select **יוזמות וקישורים** to create, edit, hide, delete, or order cards, with a title, description, image URL, and destination. Each visible initiative has a direct shareable URL, `/actions/<slug>`, that redirects to its destination without requiring a homepage visit. Destinations may be HTTPS websites or the local `/chuppah` booking page. Hidden initiatives are unavailable through those share links. `/chuppah` remains independently accessible even if its homepage card is hidden. Drafts can be saved without a destination. External image URLs are optional; the supplied photo paths can also be used.

The database seeds a chuppah link and a video from the PDF once. It does not invent a YouTube channel or shirt order destination; add these when their URLs are available. Admin edits and deletions survive restarts. Existing booking data is retained during the additive database migration.

1. Couple selects an available date and submits name, wedding location, contact phone, and email address.
2. Pending requests hold their date. Another request cannot reserve it, including concurrent submissions.
3. Admin approves, rejects, or cancels requests. Rejection/cancellation releases the date.
4. Admin sets the return date (default two days after the wedding), views due/overdue returns, and marks the cloth returned.
5. Optional WhatsApp buttons open prepared confirmation, return-reminder, and donation messages for the admin to send manually. WhatsApp messages do not send automatically. Admin can record when a reminder/donation message was actually sent.
6. Donation URL is configured in the admin page. No placeholder donation destination is used.

Requests store personal information privately; the public availability endpoint exposes dates only. Sessions expire after eight hours and on server restart. Login and booking requests have basic rate limits. Local SQLite storage must be on a persistent disk when hosting, with regular backups. For multiple app instances, rate limits and sessions would need shared storage. The initial date rule blocks the wedding date only; pickup/return turnaround dates are not automatically blocked.

## Checks

```sh
npm test
```

Tests cover duplicate reservation prevention, state transitions, input validation, donation link validation, return tracking, message records, and persistence.

The photos and Hebrew memorial text were recovered from the supplied family PDF. Videos remain links to the original YouTube destinations. Email delivery requires sending-account configuration. Automatic WhatsApp delivery and deployment are future setup steps.

## Confirmation emails

New bookings require an email address. The app queues a Hebrew receipt email when the request is created and an approval email when the admin approves it. Receipts clearly state that approval is pending; approval emails include the wedding location, date, and return date. Existing bookings are preserved, with an empty email field if one was never collected. No historical emails are invented or backfilled.

Copy `.env.example` to `.env` and configure `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, and, if the provider requires authentication, both `SMTP_USER` and `SMTP_PASS`. `EMAIL_FROM` must be a plain address authorized by your email provider. `npm start` loads `.env` automatically. Restart after changing the configuration. SMTP port 465 uses TLS immediately; other ports require STARTTLS. Use your provider's SMTP credentials, which may be an app password or an SMTP-specific API key. See the [Nodemailer SMTP documentation](https://nodemailer.com/smtp). Do not commit `.env`.

If no sending account is configured, requests still succeed and their emails remain queued; the admin page says they are waiting for email setup. Queued messages are processed at startup, on submission/approval, and every 30 seconds while the server runs. Failures retry with increasing delays, up to five attempts, then appear as failed in the admin page with a retry button. SMTP acceptance is shown as acceptance by the email server, not proof of inbox delivery. Unsent messages for rejected or cancelled requests are skipped.

The queue persists in SQLite with the booking. Delivery uses one worker per app process; run only one server instance against the database. SMTP cannot guarantee exactly-once delivery: a crash after SMTP accepts a message and before its status is saved can cause a retry. Each job reuses a stable Message-ID, but recipient servers may still deliver duplicates. Tests use fake senders and never send real emails.
