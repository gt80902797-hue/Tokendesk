import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const app=express();
app.use(helmet());
app.use(express.json({limit:"20kb"}));
app.use(rateLimit({windowMs:15*60*1000,max:100}));
if(!process.env.DATABASE_URL||!process.env.JWT_SECRET){console.error("Missing DATABASE_URL or JWT_SECRET");process.exit(1);}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const authLimiter=rateLimit({windowMs:15*60*1000,max:10});

async function initDb(){
 await pool.query(`CREATE TABLE IF NOT EXISTS shops(
 id UUID PRIMARY KEY, shop_name TEXT NOT NULL, owner_name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS shop_orders(
 id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
 customer_name TEXT NOT NULL, description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','completed','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS shop_orders_shop_id_idx ON shop_orders(shop_id);`);
}
function requireAuth(req,res,next){
 const h=req.headers.authorization||"", token=h.startsWith("Bearer ")?h.slice(7):"";
 if(!token)return res.status(401).json({error:"Login required"});
 try{req.shop=jwt.verify(token,process.env.JWT_SECRET);next();}
 catch{return res.status(401).json({error:"Invalid or expired token"});}
}
app.get("/health",async(_req,res)=>{try{await pool.query("SELECT 1");res.json({ok:true,database:"connected"});}catch{res.status(503).json({ok:false,database:"unavailable"});}});
app.post("/api/auth/register",authLimiter,async(req,res)=>{
 try{
  const {shopName,ownerName,email,password}=req.body||{};
  if(![shopName,ownerName,email,password].every(x=>typeof x==="string"))return res.status(400).json({error:"All fields required"});
  if(shopName.trim().length<2||ownerName.trim().length<2)return res.status(400).json({error:"Names too short"});
  const em=email.trim().toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))return res.status(400).json({error:"Invalid email"});
  if(password.length<10||password.length>72)return res.status(400).json({error:"Password must be 10-72 characters"});
  const hash=await bcrypt.hash(password,12), id=crypto.randomUUID();
  await pool.query("INSERT INTO shops(id,shop_name,owner_name,email,password_hash) VALUES($1,$2,$3,$4,$5)",[id,shopName.trim(),ownerName.trim(),em,hash]);
  res.status(201).json({message:"Account created. Login to continue."});
 }catch(e){if(e.code==="23505")return res.status(409).json({error:"Email already registered"});console.error("register",e.message);res.status(500).json({error:"Registration failed"});}
});
app.post("/api/auth/login",authLimiter,async(req,res)=>{
 try{
  const {email,password}=req.body||{};if(typeof email!=="string"||typeof password!=="string")return res.status(400).json({error:"Email and password required"});
  const r=await pool.query("SELECT id,shop_name,owner_name,email,password_hash FROM shops WHERE email=$1",[email.trim().toLowerCase()]);
  const s=r.rows[0], valid=s?await bcrypt.compare(password,s.password_hash):false;
  if(!valid)return res.status(401).json({error:"Invalid email or password"});
  const token=jwt.sign({shopId:s.id},process.env.JWT_SECRET,{expiresIn:"8h",issuer:"tokendesk"});
  res.json({token,shop:{id:s.id,shopName:s.shop_name,ownerName:s.owner_name,email:s.email}});
 }catch(e){console.error("login",e.message);res.status(500).json({error:"Login failed"});}
});
app.get("/api/shop/me",requireAuth,async(req,res)=>{try{const r=await pool.query("SELECT id,shop_name,owner_name,email,created_at FROM shops WHERE id=$1",[req.shop.shopId]);if(!r.rows[0])return res.status(404).json({error:"Shop not found"});res.json({shop:r.rows[0]});}catch{res.status(500).json({error:"Profile unavailable"});}});
app.get("/api/shop/orders",requireAuth,async(req,res)=>{try{const r=await pool.query("SELECT id,customer_name,description,status,created_at FROM shop_orders WHERE shop_id=$1 ORDER BY created_at DESC",[req.shop.shopId]);res.json({orders:r.rows});}catch{res.status(500).json({error:"Orders unavailable"});}});
app.post("/api/shop/orders",requireAuth,async(req,res)=>{
 const {customerName,description}=req.body||{};
 if(typeof customerName!=="string"||typeof description!=="string"||!customerName.trim()||!description.trim()||customerName.length>120||description.length>2000)return res.status(400).json({error:"Valid customer name and description required"});
 try{const id=crypto.randomUUID();await pool.query("INSERT INTO shop_orders(id,shop_id,customer_name,description) VALUES($1,$2,$3,$4)",[id,req.shop.shopId,customerName.trim(),description.trim()]);res.status(201).json({id,status:"pending"});}catch{res.status(500).json({error:"Order creation failed"});}
});
app.patch("/api/shop/orders/:id/status",requireAuth,async(req,res)=>{
 const allowed=["pending","processing","ready","completed","cancelled"];if(!allowed.includes(req.body?.status))return res.status(400).json({error:"Invalid status"});
 try{const r=await pool.query("UPDATE shop_orders SET status=$1 WHERE id=$2 AND shop_id=$3 RETURNING id,status",[req.body.status,req.params.id,req.shop.shopId]);if(!r.rows[0])return res.status(404).json({error:"Order not found"});res.json(r.rows[0]);}catch{res.status(500).json({error:"Update failed"});}
});
const port=process.env.PORT||3000;
initDb().then(()=>app.listen(port,()=>console.log("TokenDesk server running on",port))).catch(e=>{console.error("DB initialization failed",e.message);process.exit(1);});
