import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const app = express();

// Frontend is hosted separately on Render Static Site.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Admin-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120 }));

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.error("Missing DATABASE_URL or JWT_SECRET environment variable");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const publicOrderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const publicTrackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const subscriptionRequestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const redeemLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const PLAN_PRICES = new Map([[30, 100], [90, 270], [365, 999]]);
const allowedStatuses = ["pending", "processing", "ready", "completed", "cancelled"];

function makePublicCode() {
  return crypto.randomBytes(6).toString("hex");
}

function makeOrderToken() {
  return `TD-${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
}

function makeRequestCode() {
  return `REQ-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function makeActivationCode() {
  return crypto.randomBytes(8).toString("hex").toUpperCase();
}

function hashActivationCode(code) {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_SECRET || "";
  const supplied = req.get("x-admin-key") || "";

  if (configured.length < 32) {
    return res.status(503).json({
      error: "Admin access is not configured. Set ADMIN_SECRET in Render."
    });
  }

  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(supplied, "utf8");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid admin key" });
  }

  next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return res.status(401).json({ error: "Login required" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "tokendesk"
    });

    if (!payload.shopId) {
      return res.status(401).json({ error: "Invalid session" });
    }

    req.shop = payload;
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired token. Please log in again."
    });
  }
}

// Subscription gate: shop owners must have an unexpired subscription
// before accessing or managing shop orders.
async function requireActiveSubscription(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT subscription_expires_at > NOW() AS active
       FROM shops
       WHERE id = $1`,
      [req.shop.shopId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Shop not found" });
    }

    if (result.rows[0].active !== true) {
      return res.status(403).json({
        error: "Active subscription required",
        subscriptionActive: false
      });
    }

    next();
  } catch (error) {
    console.error("Subscription check failed:", error.message);
    return res.status(500).json({
      error: "Subscription verification failed"
    });
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id UUID PRIMARY KEY,
      shop_name TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE shops ADD COLUMN IF NOT EXISTS public_code TEXT;
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS shop_orders (
      id UUID PRIMARY KEY,
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','ready','completed','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS order_token TEXT;

    CREATE TABLE IF NOT EXISTS subscription_requests (
      id UUID PRIMARY KEY,
      request_code TEXT NOT NULL UNIQUE,
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      plan_days INTEGER NOT NULL CHECK (plan_days IN (30,90,365)),
      amount_inr INTEGER NOT NULL CHECK (amount_inr IN (100,270,999)),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','expired')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
      approved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS subscription_activation_codes (
      id UUID PRIMARY KEY,
      request_id UUID NOT NULL UNIQUE REFERENCES subscription_requests(id) ON DELETE CASCADE,
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      plan_days INTEGER NOT NULL CHECK (plan_days IN (30,90,365)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS subscription_requests_shop_created_idx
      ON subscription_requests(shop_id, created_at DESC);
  `);

  // Give existing shops a public order-link code.
  const shopsWithoutCode = await pool.query(
    "SELECT id FROM shops WHERE public_code IS NULL"
  );

  for (const shop of shopsWithoutCode.rows) {
    await pool.query(
      "UPDATE shops SET public_code=$1 WHERE id=$2",
      [makePublicCode(), shop.id]
    );
  }

  // Give existing orders a tracking token.
  const ordersWithoutToken = await pool.query(
    "SELECT id FROM shop_orders WHERE order_token IS NULL"
  );

  for (const order of ordersWithoutToken.rows) {
    await pool.query(
      "UPDATE shop_orders SET order_token=$1 WHERE id=$2",
      [makeOrderToken(), order.id]
    );
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shops_public_code_unique_idx
      ON shops(public_code);
    CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_order_token_unique_idx
      ON shop_orders(order_token);
    CREATE INDEX IF NOT EXISTS shop_orders_shop_id_created_idx
      ON shop_orders(shop_id, created_at DESC);
  `);
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

// Shop registration
app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const { shopName, ownerName, email, password } = req.body || {};

    if (![shopName, ownerName, email, password].every(v => typeof v === "string")) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (
      shopName.trim().length < 2 || shopName.trim().length > 100 ||
      ownerName.trim().length < 2 || ownerName.trim().length > 100
    ) {
      return res.status(400).json({
        error: "Shop and owner names must be 2-100 characters"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({
        error: "Password must be 10-72 characters"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();
    const publicCode = makePublicCode();

    await pool.query(
      `INSERT INTO shops
       (id,shop_name,owner_name,email,password_hash,public_code)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        shopName.trim(),
        ownerName.trim(),
        normalizedEmail,
        passwordHash,
        publicCode
      ]
    );

    res.status(201).json({
      message: "Account created. Please log in."
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }

    console.error("Register failed:", error.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Shop login
app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    const result = await pool.query(
      `SELECT id,shop_name,owner_name,email,password_hash,public_code
       FROM shops WHERE email=$1`,
      [email.trim().toLowerCase()]
    );

    const shop = result.rows[0];
    const valid = shop
      ? await bcrypt.compare(password, shop.password_hash)
      : false;

    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { shopId: shop.id },
      process.env.JWT_SECRET,
      { expiresIn: "8h", issuer: "tokendesk" }
    );

    res.json({
      token,
      shop: {
        id: shop.id,
        shopName: shop.shop_name,
        ownerName: shop.owner_name,
        email: shop.email,
        publicCode: shop.public_code
      }
    });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// Current shop profile. This remains available without a subscription,
// so the frontend can show the subscription status and renewal option.
app.get("/api/shop/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id,shop_name,owner_name,email,public_code,created_at,
              subscription_expires_at,
              (subscription_expires_at > NOW()) AS subscription_active
       FROM shops WHERE id=$1`,
      [req.shop.shopId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Shop not found" });
    }

    res.json({ shop: result.rows[0] });
  } catch {
    res.status(500).json({ error: "Profile unavailable" });
  }
});

// Private shop orders: login AND active subscription required.
// The query is scoped to the logged-in shop ID.
app.get(
  "/api/shop/orders",
  requireAuth,
  requireActiveSubscription,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id,customer_name,description,status,order_token,created_at
         FROM shop_orders
         WHERE shop_id=$1
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.shop.shopId]
      );

      res.json({ orders: result.rows });
    } catch {
      res.status(500).json({ error: "Orders unavailable" });
    }
  }
);

// Shopkeeper-created order: active subscription required.
app.post(
  "/api/shop/orders",
  requireAuth,
  requireActiveSubscription,
  async (req, res) => {
    const { customerName, description } = req.body || {};

    if (
      typeof customerName !== "string" ||
      typeof description !== "string" ||
      customerName.trim().length < 2 ||
      customerName.length > 120 ||
      !description.trim() ||
      description.length > 2000
    ) {
      return res.status(400).json({
        error: "Enter a valid customer name and order"
      });
    }

    try {
      const id = crypto.randomUUID();
      const orderToken = makeOrderToken();

      await pool.query(
        `INSERT INTO shop_orders
         (id,shop_id,customer_name,description,order_token)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          id,
          req.shop.shopId,
          customerName.trim(),
          description.trim(),
          orderToken
        ]
      );

      res.status(201).json({
        id,
        orderToken,
        status: "pending"
      });
    } catch (error) {
      console.error("Shop order failed:", error.message);
      res.status(500).json({ error: "Order creation failed" });
    }
  }
);

// Public shop details. Only shop name and public code are exposed.
app.get("/api/public/shops/:code", async (req, res) => {
  if (!/^[a-f0-9]{12}$/i.test(req.params.code)) {
    return res.status(404).json({ error: "Shop not found" });
  }

  try {
    const result = await pool.query(
      `SELECT shop_name FROM shops
       WHERE public_code=$1 AND subscription_expires_at > NOW()`,
      [req.params.code.toLowerCase()]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Shop not found or inactive" });
    }

    res.json({ shop: result.rows[0] });
  } catch {
    res.status(500).json({ error: "Shop unavailable" });
  }
});

// Customer orders without creating an account.
// Only shops with active subscriptions can receive new orders.
app.post(
  "/api/public/shops/:code/orders",
  publicOrderLimiter,
  async (req, res) => {
    const { customerName, description } = req.body || {};

    if (!/^[a-f0-9]{12}$/i.test(req.params.code)) {
      return res.status(404).json({ error: "Shop not found" });
    }

    if (
      typeof customerName !== "string" ||
      typeof description !== "string" ||
      customerName.trim().length < 2 ||
      customerName.trim().length > 120 ||
      !description.trim() ||
      description.trim().length > 2000
    ) {
      return res.status(400).json({
        error: "Enter your name and order details"
      });
    }

    try {
      const shopResult = await pool.query(
        `SELECT id FROM shops
         WHERE public_code=$1 AND subscription_expires_at > NOW()`,
        [req.params.code.toLowerCase()]
      );

      if (!shopResult.rows[0]) {
        return res.status(404).json({
          error: "Shop not found or subscription inactive"
        });
      }

      const id = crypto.randomUUID();
      const orderToken = makeOrderToken();

      await pool.query(
        `INSERT INTO shop_orders
         (id,shop_id,customer_name,description,order_token)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          id,
          shopResult.rows[0].id,
          customerName.trim(),
          description.trim(),
          orderToken
        ]
      );

      res.status(201).json({
        message: "Order placed",
        orderToken
      });
    } catch (error) {
      console.error("Public order failed:", error.message);
      res.status(500).json({
        error: "Order could not be placed. Please try again."
      });
    }
  }
);

// Customer tracking: status only, not customer identity or order details.
// Tracking remains available even if the shop subscription later expires.
app.get(
  "/api/public/shops/:code/track/:token",
  publicTrackLimiter,
  async (req, res) => {
    const code = req.params.code;
    const orderToken = req.params.token;

    if (
      !/^[a-f0-9]{12}$/i.test(code) ||
      !/^TD-[A-Z0-9_-]{10,24}$/i.test(orderToken)
    ) {
      return res.status(404).json({ error: "Order not found" });
    }

    try {
      const result = await pool.query(
        `SELECT s.shop_name,o.order_token,o.status,o.created_at
         FROM shop_orders o
         JOIN shops s ON s.id=o.shop_id
         WHERE s.public_code=$1 AND o.order_token=$2`,
        [code.toLowerCase(), orderToken.toUpperCase()]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          error: "Order not found. Check the shop link and token."
        });
      }

      res.json({ order: result.rows[0] });
    } catch {
      res.status(500).json({
        error: "Tracking is temporarily unavailable"
      });
    }
  }
);

// Shopkeeper updates only their own orders and needs active subscription.
app.patch(
  "/api/shop/orders/:id/status",
  requireAuth,
  requireActiveSubscription,
  async (req, res) => {
    if (!allowedStatuses.includes(req.body?.status)) {
      return res.status(400).json({ error: "Invalid order status" });
    }

    try {
      const result = await pool.query(
        `UPDATE shop_orders SET status=$1
         WHERE id=$2 AND shop_id=$3
         RETURNING id,status,order_token`,
        [req.body.status, req.params.id, req.shop.shopId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: "Status update failed" });
    }
  }
);

// Create a manual-payment request.
app.post(
  "/api/subscription/requests",
  requireAuth,
  subscriptionRequestLimiter,
  async (req, res) => {
    const planDays = Number(req.body?.planDays);
    const amount = PLAN_PRICES.get(planDays);

    if (!amount) {
      return res.status(400).json({
        error: "Choose a valid subscription plan"
      });
    }

    const paymentPhone = (
      process.env.PAYMENT_PHONE || "8090279768"
    ).replace(/\D/g, "");

    if (!/^\d{10,12}$/.test(paymentPhone)) {
      return res.status(503).json({
        error: "PAYMENT_PHONE is not configured correctly in Render."
      });
    }

    try {
      const pending = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM subscription_requests
         WHERE shop_id=$1
           AND status='pending'
           AND expires_at > NOW()`,
        [req.shop.shopId]
      );

      if (pending.rows[0].count >= 3) {
        return res.status(429).json({
          error: "You already have 3 pending requests. Contact support before creating another."
        });
      }

      const id = crypto.randomUUID();
      const requestCode = makeRequestCode();

      await pool.query(
        `INSERT INTO subscription_requests
         (id,request_code,shop_id,plan_days,amount_inr)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, requestCode, req.shop.shopId, planDays, amount]
      );

      res.status(201).json({
        requestCode,
        planDays,
        amount,
        paymentPhone,
        expiresInHours: 24,
        message: "Request created. Open your UPI app, choose mobile-number payment if supported, verify the recipient name and amount, then pay. Subscription starts only after manual verification and code redemption."
      });
    } catch (error) {
      console.error("Subscription request failed:", error.message);
      res.status(500).json({
        error: "Could not create subscription request"
      });
    }
  }
);

// Redeem a one-time code. Codes are tied to the requesting shop.
app.post(
  "/api/subscription/redeem",
  requireAuth,
  redeemLimiter,
  async (req, res) => {
    const code = typeof req.body?.code === "string"
      ? req.body.code.trim().toUpperCase()
      : "";

    if (!/^[A-F0-9]{16}$/.test(code)) {
      return res.status(400).json({
        error: "Enter the 16-character activation code"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const codeHash = hashActivationCode(code);
      const found = await client.query(
        `SELECT id,request_id,plan_days
         FROM subscription_activation_codes
         WHERE code_hash=$1
           AND shop_id=$2
           AND used_at IS NULL
           AND expires_at > NOW()
         FOR UPDATE`,
        [codeHash, req.shop.shopId]
      );

      if (!found.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Code invalid, expired, already used, or belongs to another shop"
        });
      }

      const activation = found.rows[0];

      await client.query(
        `UPDATE subscription_activation_codes
         SET used_at=NOW()
         WHERE id=$1`,
        [activation.id]
      );

      const updated = await client.query(
        `UPDATE shops
         SET subscription_expires_at =
           GREATEST(COALESCE(subscription_expires_at,NOW()),NOW())
           + ($2 * INTERVAL '1 day')
         WHERE id=$1
         RETURNING subscription_expires_at`,
        [req.shop.shopId, activation.plan_days]
      );

      await client.query("COMMIT");

      res.json({
        message: "Subscription activated successfully",
        planDays: activation.plan_days,
        subscriptionExpiresAt: updated.rows[0].subscription_expires_at
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Code redemption failed:", error.message);
      res.status(500).json({
        error: "Could not activate subscription"
      });
    } finally {
      client.release();
    }
  }
);

// Admin sees pending payment requests using the private Render secret.
app.get(
  "/api/admin/subscription-requests",
  adminLimiter,
  requireAdmin,
  async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT r.request_code,r.plan_days,r.amount_inr,
                r.created_at,r.expires_at,
                s.shop_name,s.owner_name,s.email
         FROM subscription_requests r
         JOIN shops s ON s.id=r.shop_id
         WHERE r.status='pending'
           AND r.expires_at > NOW()
         ORDER BY r.created_at ASC
         LIMIT 100`
      );

      res.json({ requests: result.rows });
    } catch {
      res.status(500).json({
        error: "Could not load payment requests"
      });
    }
  }
);

// Issue activation code only after manually checking the exact payment
// in the receiving UPI/bank account. The raw code is returned once.
app.post(
  "/api/admin/subscription-requests/:requestCode/issue-code",
  adminLimiter,
  requireAdmin,
  async (req, res) => {
    const requestCode = String(
      req.params.requestCode || ""
    ).toUpperCase();

    if (!/^REQ-[A-F0-9]{10}$/.test(requestCode)) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT id,shop_id,plan_days,status,expires_at
         FROM subscription_requests
         WHERE request_code=$1
         FOR UPDATE`,
        [requestCode]
      );

      const paymentRequest = result.rows[0];

      if (
        !paymentRequest ||
        paymentRequest.status !== "pending" ||
        new Date(paymentRequest.expires_at) <= new Date()
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Request not found, expired, or already approved"
        });
      }

      const activationCode = makeActivationCode();
      const codeExpiresAt = new Date(
        Date.now() + 30 * 60 * 1000
      );

      await client.query(
        `INSERT INTO subscription_activation_codes
         (id,request_id,shop_id,code_hash,plan_days,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          crypto.randomUUID(),
          paymentRequest.id,
          paymentRequest.shop_id,
          hashActivationCode(activationCode),
          paymentRequest.plan_days,
          codeExpiresAt
        ]
      );

      await client.query(
        `UPDATE subscription_requests
         SET status='approved',approved_at=NOW()
         WHERE id=$1`,
        [paymentRequest.id]
      );

      await client.query("COMMIT");

      res.json({
        activationCode,
        planDays: paymentRequest.plan_days,
        expiresAt: codeExpiresAt.toISOString(),
        message: "Send this code to the customer once. It will expire in 30 minutes and can only be used once by the requesting shop."
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Code issue failed:", error.message);
      res.status(500).json({
        error: "Could not issue activation code"
      });
    } finally {
      client.release();
    }
  }
);

const port = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`TokenDesk API running on port ${port}`);
    });
  })
  .catch(error => {
    console.error("Database initialization failed:", error.message);
    process.exit(1);
  });
