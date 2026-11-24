const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const path = require("path");

const app = express();
const db = new Database("tokendesk.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS shops (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 shop_name TEXT NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 plan TEXT,
 subscription_until INTEGER DEFAULT 0,
 active INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 shop_id INTEGER NOT NULL,
 gateway_order_id TEXT UNIQUE,
 gateway_payment_id TEXT UNIQUE,
 amount INTEGER NOT NULL,
 plan TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at INTEGER NOT NULL,
 FOREIGN KEY(shop_id) REFERENCES shops(id)
);
`);

const plans = { "30":10000, "90":27000, "365":99900 }; // INR in paise
const planDays = { "30":30, "90":90, "365":365 };
const secret = process.env.SESSION_SECRET;
if (!secret) console.warn("SESSION_SECRET missing: set a long random value before deployment.");

app.use(helmet());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
 secret: secret || "development-only-change-this",
 resave:false, saveUninitialized:false,
 cookie:{ httpOnly:true, sameSite:"strict", secure:process.env.NODE_ENV==="production", maxAge: 7*24*60*60*1000 }
}));

// Razorpay webhook needs raw bytes for signature validation. Keep this before JSON parser.
app.post("/webhook/razorpay", express.raw({type:"application/json"}), (req,res)=>{
 const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
 if (!webhookSecret) return res.status(503).send("Webhook not configured");
 const signature = req.headers["x-razorpay-signature"];
 if (!signature) return res.status(400).send("Missing signature");
 const expected = crypto.createHmac("sha256", webhookSecret).update(req.body).digest("hex");
 if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(400).send("Invalid signature");
 let event;
 try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).send("Bad JSON"); }
 if (event.event === "payment.captured") {
   const payment = event.payload?.payment?.entity;
   if (payment?.order_id) activateFromVerifiedPayment(payment.order_id, payment.id, payment.amount);
 }
 res.json({received:true});
});
app.use(express.json({limit:"20kb"}));

function activateFromVerifiedPayment(orderId, paymentId, amount) {
 const record = db.prepare("SELECT * FROM payments WHERE gateway_order_id=?").get(orderId);
 if (!record || record.status === "paid" || record.amount !== amount) return false;
 const tx = db.transaction(()=>{
   const changed = db.prepare("UPDATE payments SET gateway_payment_id=?, status='paid' WHERE id=? AND status='pending'").run(paymentId,record.id);
   if (changed.changes !== 1) return;
   const shop = db.prepare("SELECT subscription_until FROM shops WHERE id=?").get(record.shop_id);
   const now = Math.floor(Date.now()/1000);
   const start = Math.max(now, shop.subscription_until || 0);
   const until = start + planDays[record.plan]*86400;
   db.prepare("UPDATE shops SET plan=?, subscription_until=?, active=1 WHERE id=?").run(record.plan,until,record.shop_id);
 });
 tx();
 return true;
}

function auth(req,res,next){ if(!req.session.shopId) return res.status(401).json({error:"Login required"}); next(); }
function getRazorpay(){
 if(!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw new Error("Gateway not configured");
 return new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
}
app.get("/api/plans",(req,res)=>res.json({plans:[
 {days:30,priceINR:100},{days:90,priceINR:270},{days:365,priceINR:999}
]}));

app.post("/api/register", async(req,res)=>{
 const {shopName,username,password}=req.body||{};
 if(!shopName||!username||!password||password.length<10) return res.status(400).json({error:"Shop name, username and password (10+ characters) required"});
 try{
  const hash=await bcrypt.hash(password,12);
  const info=db.prepare("INSERT INTO shops(shop_name,username,password_hash) VALUES(?,?,?)").run(shopName.trim(),username.trim().toLowerCase(),hash);
  req.session.shopId=Number(info.lastInsertRowid);
  res.json({ok:true});
 }catch(e){res.status(409).json({error:"Username unavailable or registration failed"});}
});
app.post("/api/login",async(req,res)=>{
 const {username,password}=req.body||{};
 const shop=db.prepare("SELECT * FROM shops WHERE username=?").get((username||"").trim().toLowerCase());
 if(!shop || !await bcrypt.compare(password||"",shop.password_hash)) return res.status(401).json({error:"Invalid login"});
 req.session.shopId=shop.id; res.json({ok:true});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",auth,(req,res)=>{
 const shop=db.prepare("SELECT id,shop_name,username,plan,subscription_until,active FROM shops WHERE id=?").get(req.session.shopId);
 res.json(shop);
});
app.post("/api/payment/order",auth,async(req,res)=>{
 const {plan}=req.body||{};
 if(!plans[plan]) return res.status(400).json({error:"Invalid plan"});
 try{
  const rp=getRazorpay();
  const order=await rp.orders.create({amount:plans[plan],currency:"INR",receipt:"td_"+req.session.shopId+"_"+Date.now(),notes:{shop_id:String(req.session.shopId),plan}});
  db.prepare("INSERT INTO payments(shop_id,gateway_order_id,amount,plan,status,created_at) VALUES(?,?,?,?,?,?)")
    .run(req.session.shopId,order.id,plans[plan],plan,"pending",Math.floor(Date.now()/1000));
  res.json({orderId:order.id,amount:order.amount,currency:order.currency,keyId:process.env.RAZORPAY_KEY_ID});
 }catch(e){res.status(503).json({error:"Payment gateway unavailable or not configured. No subscription activated."});}
});
// Checkout callback signature verification; webhook is also verified independently.
app.post("/api/payment/verify",auth,(req,res)=>{
 const {orderId,paymentId,signature}=req.body||{};
 if(!orderId||!paymentId||!signature) return res.status(400).json({error:"Missing payment details"});
 const record=db.prepare("SELECT * FROM payments WHERE gateway_order_id=? AND shop_id=?").get(orderId,req.session.shopId);
 if(!record) return res.status(400).json({error:"Order not found"});
 const keySecret=process.env.RAZORPAY_KEY_SECRET;
 if(!keySecret) return res.status(503).json({error:"Payment verification not configured"});
 const expected=crypto.createHmac("sha256",keySecret).update(orderId+"|"+paymentId).digest("hex");
 const a=Buffer.from(signature),b=Buffer.from(expected);
 if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).json({error:"Signature verification failed"});
 // Fetch payment from gateway to ensure amount/status/order match before activation.
 getRazorpay().payments.fetch(paymentId).then(p=>{
  if(p.order_id!==orderId || p.amount!==record.amount || p.status!=="captured") return res.status(400).json({error:"Payment details mismatch or not captured"});
  activateFromVerifiedPayment(orderId,paymentId,p.amount);
  res.json({ok:true});
 }).catch(()=>res.status(400).json({error:"Payment could not be verified"}));
});
app.get("/api/payments",auth,(req,res)=>{
 res.json(db.prepare("SELECT amount,plan,status,created_at FROM payments WHERE shop_id=? ORDER BY id DESC LIMIT 20").all(req.session.shopId));
});
app.get("/health",(req,res)=>res.json({ok:true}));

const port=process.env.PORT||3000;
app.listen(port,()=>console.log("TokenDesk server running on port "+port));
