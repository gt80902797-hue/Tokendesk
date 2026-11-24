
# TokenDesk Backend

## Requirements
- Node.js 20+
- PostgreSQL database

## Installation

Run:

npm install

## Environment Variables

Set these environment variables in your hosting platform:

DATABASE_URL
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET

Never expose secret keys in frontend code or GitHub.

## Start Server

npm start

## Subscription Plans

- Monthly: Rs 100
- Quarterly: Rs 270
- Yearly: Rs 999

## Important

This backend is a starter scaffold.

It does not yet implement:
- Secure shop authentication
- Shop-specific authorization
- Database subscription records
- Subscription activation
- Payment status retrieval
- Idempotent webhook processing

Do not use live payments until these
security and subscription features are
implemented and reviewed.
