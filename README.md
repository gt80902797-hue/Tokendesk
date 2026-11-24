# TokenDesk secure subscription scaffold

This is a starter project, not a production-ready service. It demonstrates server-side shop registration/login, Razorpay order creation, payment signature verification and a signed webhook flow. It does not yet implement customer orders, shop order isolation for the order feature, rate limiting, production-grade session storage, CSRF protections, admin tooling, backups, or full operational monitoring.

## Run locally
1. Install Node.js 20+.
2. In this folder: `npm install`
3. Set environment variables (never place secrets in frontend files):
   - `SESSION_SECRET`: long random secret
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
4. `npm start`
5. Visit `http://localhost:3000`

Use gateway TEST credentials only while testing. Configure the webhook URL as `/webhook/razorpay` and subscribe to `payment.captured`. Payment activation uses a verified webhook or server-side payment fetch + signature check, validates order/shop/amount, and prevents duplicate activation.

Before production, add rate limiting, CSRF controls, HTTPS, secure session storage, database backups, logs/monitoring, privacy policy/terms, support workflows and security review. Merchant account onboarding and payment compliance may require an adult account holder/guardian.
