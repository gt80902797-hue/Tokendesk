# TokenDesk – orders, tracking, QR and manual subscription activation

This update keeps the existing shop registration/login and order system, and adds a manually verified subscription flow.

## Included features

- Shop registration and login with hashed passwords and JWT sessions.
- Separate shop data and shop-specific public order links.
- Customer order page, voice typing where supported, unique order tokens and status tracking.
- Shop dashboard with QR code, order management and status updates.
- Plans: ₹100 / 30 days, ₹270 / 90 days, ₹999 / 365 days.
- Mobile-number UPI payment instructions for each subscription request (no fabricated UPI QR or payment deep link).
- WhatsApp request link to the configured support number in `public/app.js`.
- Private owner admin page at `admin.html` to review pending payment requests.
- Random one-time activation codes. Only a SHA-256 hash is stored in PostgreSQL. Codes are bound to the requesting shop, expire after 30 minutes, and can be used once.
- Subscription expiry date is recorded on the shop account when the code is redeemed.

## File placement in GitHub

- Replace the root `server.js` with this package's `server.js`.
- Keep the root `package.json` from this package.
- Replace the contents of your existing `public/` folder with the files in this package's `public/` folder.
- Do not move `server.js` or `package.json` inside `public/`.

## Render backend settings

Web Service:
- Build command: `npm install`
- Start command: `npm start`
- Keep your existing `DATABASE_URL` and `JWT_SECRET` values unchanged.
- Add the following environment variables in Render → your backend Web Service → Environment:

| Variable | Value |
|---|---|
| `PAYMENT_PHONE` | `8090279768` (only if this number is enabled to receive UPI payments) |
| `ADMIN_SECRET` | A new long random secret, at least 32 characters |
| `FRONTEND_ORIGIN` | Optional: your exact TokenDesk Static Site origin, if you know it |

Use an adult/guardian-approved UPI account and merchant arrangement. A phone number is not itself a UPI ID. Number-based payment works only when the payer's UPI app supports lookup/payments to that mobile number and confirms the intended recipient. The website cannot guarantee every UPI app supports this route; if it does not, configure a verified UPI ID or use the account's official QR instead. Do not paste UPI IDs, bank details, `ADMIN_SECRET`, `DATABASE_URL`, `JWT_SECRET`, OTPs or payment credentials into GitHub or this chat. Add them only to Render's private Environment settings. Never commit these values into JavaScript files.

After saving environment variables, redeploy/restart the backend.

## Render frontend settings

Static Site:
- Root directory: `public`
- Build command: `echo "No build required"`
- Publish directory: `.`

The API URL is currently `https://tokendesk.onrender.com` in `public/app.js` and `public/admin.js`. Change it only if the backend URL changes.

## How the manual subscription flow works

1. A logged-in shop owner chooses a plan.
2. The backend creates a 24-hour pending payment request and returns the configured payment mobile number.
3. The dashboard displays the payment mobile number, amount and request ID. The payer must open their own UPI app and use mobile-number payment only if that app supports it. The WhatsApp link opens a message to `918090279768`.
4. The payer completes the payment and sends the request ID plus UPI transaction reference/UTR through WhatsApp.
5. The owner opens `https://YOUR-STATIC-SITE/admin.html`, enters the private `ADMIN_SECRET`, and checks the pending request.
6. The owner must independently confirm the exact credited payment in the receiving UPI/bank app. A screenshot or WhatsApp message alone is not proof.
7. Only after confirming receipt, the owner presses “Payment verified — generate code”. The server generates a random activation code. The code is shown once on the admin page; the database stores only its hash.
8. The owner sends the code to that shop owner in the same WhatsApp conversation. The shop owner enters it on the TokenDesk dashboard.
9. The backend checks the code, requesting shop, expiry and one-time-use status, then records the subscription expiry.

## Security details and limits

- There is no predictable number sequence or mathematical activation formula. The backend uses Node.js cryptographic randomness; knowing the source code does not reveal future codes.
- The raw activation code is never stored in the database and is never placed in frontend source files.
- `ADMIN_SECRET`, UPI receiving details and database/JWT secrets must stay in Render environment variables.
- The admin secret is entered at runtime on the private admin page; it is not embedded in that page's JavaScript.
- The WhatsApp number is visible in the public frontend source and on the website. Use a dedicated business/support number approved by an adult, not a private personal number without permission.
- This is a manual verification flow, not automatic UPI settlement verification. Mobile-number payment support varies by UPI app; the app must show and confirm the correct recipient before the payer proceeds. The site cannot independently prove that a screenshot or UTR is genuine; the owner must check the receiving account.
- Subscription expiry is stored and shown on the dashboard. This update does not yet block order features automatically when the subscription expires.
- The WhatsApp number in `public/app.js` is currently `918090279768`. Change it there only if the approved support number changes.

## Before real public launch

Test with two separate shop accounts and a small controlled payment only after adult review. Add stronger production protections, privacy/terms pages, support procedures and a proper payment gateway/webhook integration before scaling. Do not share activation codes between shops.
