import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";
import Razorpay from "razorpay";
import crypto from "crypto";

const app = express();

app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
  })
);

app.use(express.json());

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const plans = {
  monthly: { amount: 10000, days: 30 },
  quarterly: { amount: 27000, days: 90 },
  yearly: { amount: 99900, days: 365 }
};

// Server health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Create payment order
app.post("/api/payments/create-order", async (req, res) => {
  try {
    const plan = plans[req.body?.plan];

    if (!plan) {
      return res.status(400).json({
        error: "Invalid plan"
      });
    }

    if (
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      return res.status(503).json({
        error: "Payment provider not configured"
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.create({
      amount: plan.amount,
      currency: "INR",
      receipt: `td_${Date.now()}`,
      notes: {
        plan: req.body.plan
      }
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error("Create order error:", error.message);

    res.status(500).json({
      error: "Could not create payment order"
    });
  }
});

// Verify payment signature
app.post("/api/payments/verify", (req, res) => {
  const {
    order_id,
    payment_id,
    signature
  } = req.body || {};

  if (
    !order_id ||
    !payment_id ||
    !signature ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
    return res.status(400).json({
      error: "Missing verification fields"
    });
  }

  const expected = crypto
    .createHmac(
      "sha256",
      process.env.RAZORPAY_KEY_SECRET
    )
    .update(`${order_id}|${payment_id}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(400).json({
      verified: false
    });
  }

  res.json({
    verified: true,
    message:
      "Signature verified only. Subscription not activated."
  });
});

// Razorpay webhook signature check
app.post(
  "/api/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.header(
      "x-razorpay-signature"
    );

    if (!secret || !signature) {
      return res.status(400).send(
        "Missing webhook signature"
      );
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return res.status(400).send(
        "Invalid webhook signature"
      );
    }

    // Subscription activation logic is not implemented.

    res.status(200).send(
      "Webhook signature accepted"
    );
  }
);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(
    `TokenDesk server listening on ${port}`
  );
});
