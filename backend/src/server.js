import crypto from "crypto";
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = process.env.DB_PATH || path.resolve("fiao-app.db");
// Migración de nombre: si existe la base vieja (tendero-facil.db) y todavía no existe la nueva, la renombramos para no perder la información.
const OLD_DB_PATH = path.resolve("tendero-facil.db");
if (!fs.existsSync(DB_PATH) && fs.existsSync(OLD_DB_PATH)) { try { fs.renameSync(OLD_DB_PATH, DB_PATH); } catch {} }
const app = express();
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const addColumn = (table, column, definition) => { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch {} };
const STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'General',price REAL NOT NULL DEFAULT 0,cost REAL NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0,min_stock INTEGER NOT NULL DEFAULT 5,image TEXT DEFAULT '',expiration TEXT DEFAULT '',barcode TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT DEFAULT '',balance REAL NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,type TEXT NOT NULL,quantity INTEGER NOT NULL,note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY AUTOINCREMENT,total REAL NOT NULL,payment TEXT NOT NULL,customer_id INTEGER,customer_name TEXT DEFAULT '',customer_cedula TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'completed',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(customer_id) REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS sale_items(id INTEGER PRIMARY KEY AUTOINCREMENT,sale_id INTEGER NOT NULL,product_id INTEGER NOT NULL,quantity INTEGER NOT NULL,price REAL NOT NULL,cost REAL NOT NULL DEFAULT 0,returned_quantity INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(sale_id) REFERENCES sales(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS debts(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER NOT NULL,type TEXT NOT NULL,amount REAL NOT NULL,note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(customer_id) REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT,description TEXT NOT NULL,amount REAL NOT NULL,category TEXT NOT NULL DEFAULT 'General',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reminders(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,title TEXT NOT NULL,note TEXT DEFAULT '',done INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
`;
function initStoreDatabase(database){
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(STORE_SCHEMA);
  const col=(table,column,definition)=>{try{database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)}catch{}};
  col("products","barcode","TEXT DEFAULT ''"); col("products","created_at","TEXT DEFAULT CURRENT_TIMESTAMP");
  col("sales","customer_name","TEXT DEFAULT ''"); col("sales","customer_cedula","TEXT DEFAULT ''"); col("sales","status","TEXT NOT NULL DEFAULT 'completed'");
  col("sale_items","cost","REAL NOT NULL DEFAULT 0"); col("sale_items","returned_quantity","INTEGER NOT NULL DEFAULT 0");
}
initStoreDatabase(db);

addColumn("products","barcode","TEXT DEFAULT ''"); addColumn("products","created_at","TEXT DEFAULT CURRENT_TIMESTAMP");
addColumn("sales","customer_name","TEXT DEFAULT ''"); addColumn("sales","customer_cedula","TEXT DEFAULT ''"); addColumn("sales","status","TEXT NOT NULL DEFAULT 'completed'");
addColumn("sale_items","cost","REAL NOT NULL DEFAULT 0"); addColumn("sale_items","returned_quantity","INTEGER NOT NULL DEFAULT 0");


// ---------- Fase 2: autenticación, usuarios y multi-tienda ----------
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.resolve("fiao-auth.db");
const authDb = new Database(AUTH_DB_PATH);
authDb.pragma("journal_mode = WAL");
authDb.exec(`
CREATE TABLE IF NOT EXISTS stores(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_user_id INTEGER,
  db_path TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_stores(
  user_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  PRIMARY KEY(user_id,store_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
);
`);
const sessions = new Map();
const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
};
const verifyPassword = (password, stored) => {
  try {
    const [salt,hash] = String(stored).split(":");
    const test = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(test,"hex"));
  } catch { return false; }
};
const makeToken = () => crypto.randomBytes(32).toString("hex");
const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active});
const storeDbCache = new Map();
function openStoreDb(store){
  let database=storeDbCache.get(store.id);
  if(database) return database;
  const dbPath=path.resolve(store.db_path);
  fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  database=new Database(dbPath);
  initStoreDatabase(database);
  storeDbCache.set(store.id,database);
  return database;
}
function dbFor(req){ return req.storeDb || db; }
function authRequired(req,res,next){
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();
  const session=sessions.get(token);
  if(!session) return res.status(401).json({error:"Sesión no válida o expirada"});
  const user=authDb.prepare("SELECT * FROM users WHERE id=? AND active=1").get(session.userId);
  const store=authDb.prepare("SELECT * FROM stores WHERE id=?").get(session.storeId);
  if(!user||!store) return res.status(401).json({error:"Usuario o tienda no disponibles"});
  req.user=user; req.store=store; req.storeDb=openStoreDb(store); req.storeRole=session.role;
  next();
}
// Limita una ruta a ciertos roles de la tienda (además de estar autenticado). El Vendedor solo
// puede vender/fiar; el Encargado suma inventario, caja y reportes; el Administrador ve todo.
function requireRole(...roles){
  return (req,res,next)=>{
    if(!roles.includes(req.storeRole))return res.status(403).json({error:"No tienes permiso para realizar esta acción"});
    next();
  };
}
function userStores(userId){
  return authDb.prepare(`
    SELECT s.id,s.name,s.created_at,us.role
    FROM stores s JOIN user_stores us ON us.store_id=s.id
    WHERE us.user_id=? ORDER BY s.name
  `).all(userId);
}
// Migración inicial: convierte la base local existente en la primera tienda y crea un usuario demo.
let firstStore=authDb.prepare("SELECT * FROM stores ORDER BY id LIMIT 1").get();
let firstUser=authDb.prepare("SELECT * FROM users ORDER BY id LIMIT 1").get();
if(!firstStore){
  const owner=firstUser?.id||null;
  const st=authDb.prepare("INSERT INTO stores(name,owner_user_id,db_path) VALUES(?,?,?)").run("Mi Tienda",owner,DB_PATH);
  firstStore=authDb.prepare("SELECT * FROM stores WHERE id=?").get(st.lastInsertRowid);
}
if(!firstUser){
  const u=authDb.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run("Administrador","admin@fiao.app",hashPassword("admin123"),"admin");
  firstUser=authDb.prepare("SELECT * FROM users WHERE id=?").get(u.lastInsertRowid);
}
if(!authDb.prepare("SELECT 1 FROM user_stores WHERE user_id=? AND store_id=?").get(firstUser.id,firstStore.id)){
  authDb.prepare("INSERT INTO user_stores(user_id,store_id,role) VALUES(?,?,?)").run(firstUser.id,firstStore.id,"admin");
}
if(!firstStore.owner_user_id) authDb.prepare("UPDATE stores SET owner_user_id=? WHERE id=?").run(firstUser.id,firstStore.id);

// Auth routes stay public.
app.get("/api/auth/me",(req,res)=>{
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();
  const s=sessions.get(token); if(!s) return res.status(401).json({error:"Sesión no válida"});
  const u=authDb.prepare("SELECT * FROM users WHERE id=? AND active=1").get(s.userId);
  const stores=userStores(s.userId);
  if(!u||!stores.length) return res.status(401).json({error:"Cuenta no disponible"});
  const store=stores.find(x=>x.id===s.storeId)||stores[0];
  if(store.id!==s.storeId){s.storeId=store.id;s.role=store.role;}
  return res.json({user:safeUser(u),store,stores});
});
app.post("/api/auth/login",(req,res)=>{
  const email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
  const u=authDb.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1").get(email);
  if(!u||!verifyPassword(password,u.password_hash)) return res.status(401).json({error:"Correo o contraseña incorrectos"});
  const stores=userStores(u.id); if(!stores.length)return res.status(403).json({error:"El usuario no tiene una tienda asignada"});
  const token=makeToken(), store=stores[0];
  sessions.set(token,{userId:u.id,storeId:store.id,role:store.role,createdAt:Date.now()});
  res.json({token,user:safeUser(u),store,stores});
});
app.post("/api/auth/logout",(req,res)=>{
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim(); sessions.delete(token); res.json({ok:true});
});
app.post("/api/auth/register",(req,res)=>{
  const name=String(req.body?.name||"").trim(), email=String(req.body?.email||"").trim().toLowerCase(), password=String(req.body?.password||"");
  const storeName=String(req.body?.storeName||"").trim();
  if(!name||!email||password.length<6||!storeName)return res.status(400).json({error:"Nombre, correo, contraseña (mínimo 6) y nombre de tienda son obligatorios"});
  if(authDb.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email))return res.status(409).json({error:"Ese correo ya está registrado"});
  try{
    let result;
    authDb.transaction(()=>{
      result=authDb.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run(name,email,hashPassword(password),"admin");
      const uId=result.lastInsertRowid;
      const storeDbPath=path.join("stores",`store-${uId}-${Date.now()}.db`);
      const st=authDb.prepare("INSERT INTO stores(name,owner_user_id,db_path) VALUES(?,?,?)").run(storeName,uId,storeDbPath);
      authDb.prepare("INSERT INTO user_stores(user_id,store_id,role) VALUES(?,?,?)").run(uId,st.lastInsertRowid,"admin");
      openStoreDb(authDb.prepare("SELECT * FROM stores WHERE id=?").get(st.lastInsertRowid));
    })();
    const u=authDb.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid), stores=userStores(u.id), store=stores[0], token=makeToken();
    sessions.set(token,{userId:u.id,storeId:store.id,role:"admin",createdAt:Date.now()});
    res.status(201).json({token,user:safeUser(u),store,stores});
  }catch(e){res.status(400).json({error:e.message||"No se pudo crear la cuenta"});}
});
app.post("/api/auth/switch",(req,res)=>{
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim(), s=sessions.get(token);
  if(!s)return res.status(401).json({error:"Sesión no válida"});
  const storeId=Number(req.body?.storeId), store=userStores(s.userId).find(x=>x.id===storeId);
  if(!store)return res.status(403).json({error:"No tienes acceso a esa tienda"});
  s.storeId=store.id;s.role=store.role;res.json({store,user:{...safeUser(authDb.prepare("SELECT * FROM users WHERE id=?").get(s.userId)),role:store.role}});
});
app.use("/api",authRequired);
app.get("/api/stores",(req,res)=>res.json(userStores(req.user.id)));
app.post("/api/stores",(req,res)=>{
  const name=String(req.body?.name||"").trim(); if(!name)return res.status(400).json({error:"Nombre de tienda requerido"});
  try{
    let stId;
    authDb.transaction(()=>{
      const st=authDb.prepare("INSERT INTO stores(name,owner_user_id,db_path) VALUES(?,?,?)").run(name,req.user.id,path.join("stores",`store-${req.user.id}-${Date.now()}.db`));
      stId=st.lastInsertRowid;
      authDb.prepare("INSERT INTO user_stores(user_id,store_id,role) VALUES(?,?,?)").run(req.user.id,stId,"admin");
    })();
    openStoreDb(authDb.prepare("SELECT * FROM stores WHERE id=?").get(stId));
    res.status(201).json({store:userStores(req.user.id).find(x=>x.id===stId),stores:userStores(req.user.id)});
  }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/users",requireRole("admin"),(req,res)=>{
  const rows=authDb.prepare(`
    SELECT u.id,u.name,u.email,u.active,us.role,us.store_id
    FROM users u JOIN user_stores us ON us.user_id=u.id WHERE us.store_id=? ORDER BY u.name
  `).all(req.store.id);
  res.json(rows);
});
app.post("/api/users",(req,res)=>{
  if(req.storeRole!=="admin")return res.status(403).json({error:"Solo un administrador puede agregar usuarios"});
  const name=String(req.body?.name||"").trim(),email=String(req.body?.email||"").trim().toLowerCase(),password=String(req.body?.password||""),role=String(req.body?.role||"cashier");
  if(!name||!email||password.length<6||!["admin","manager","cashier"].includes(role))return res.status(400).json({error:"Datos de usuario inválidos"});
  if(authDb.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email))return res.status(409).json({error:"Ese correo ya existe"});
  try{
    let uid;
    authDb.transaction(()=>{
      uid=authDb.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)").run(name,email,hashPassword(password),role).lastInsertRowid;
      authDb.prepare("INSERT INTO user_stores(user_id,store_id,role) VALUES(?,?,?)").run(uid,req.store.id,role);
    })();
    res.status(201).json(safeUser(authDb.prepare("SELECT * FROM users WHERE id=?").get(uid)));
  }catch(e){res.status(400).json({error:e.message});}
});
app.put("/api/users/:id",(req,res)=>{
  if(req.storeRole!=="admin")return res.status(403).json({error:"Solo un administrador puede modificar usuarios"});
  const id=Number(req.params.id), active=req.body?.active;
  if(!validId(id))return res.status(400).json({error:"ID inválido"});
  if(id===req.user.id&&active===false)return res.status(400).json({error:"No puedes desactivar tu propia cuenta"});
  const link=authDb.prepare("SELECT * FROM user_stores WHERE user_id=? AND store_id=?").get(id,req.store.id);
  if(!link)return res.status(404).json({error:"Usuario no pertenece a esta tienda"});
  if(typeof active==="boolean")authDb.prepare("UPDATE users SET active=? WHERE id=?").run(active?1:0,id);
  if(req.body?.role&&["admin","manager","cashier"].includes(req.body.role))authDb.prepare("UPDATE user_stores SET role=? WHERE user_id=? AND store_id=?").run(req.body.role,id,req.store.id);
  res.json({ok:true});
});

function seed(){
 if(db.prepare("SELECT COUNT(*) n FROM products").get().n===0){const add=db.prepare("INSERT INTO products(name,category,price,cost,stock,min_stock,image,expiration,barcode) VALUES(?,?,?,?,?,?,?,?,?)");[
 ["Coca-Cola 1.5L","Bebidas",6000,4200,18,5,"","2027-03-10","7702090029223"],["Leche Entera 1L","Lácteos",4500,3300,7,5,"","2026-09-20","7702001040012"],["Papas Margarita 105g","Mecato",3500,2200,4,5,"","2027-01-15","7702025011058"],["Galletas Festival","Mecato",2500,1500,22,6,"","2027-02-12","7702011021037"],["Arroz 1kg","Granos",4800,3600,13,4,"","2027-04-01","7702043000452"],["Agua 600ml","Bebidas",2000,1100,30,8,"","2028-01-01","7702090011020"]].forEach(x=>add.run(...x));}
 if(db.prepare("SELECT COUNT(*) n FROM customers").get().n===0){const add=db.prepare("INSERT INTO customers(name,phone,balance) VALUES(?,?,?)");add.run("Carlos Pérez","3001234567",85000);add.run("María Rodríguez","3015557788",35000);add.run("José Martínez","3158882211",0);}
}
seed();
const json=(r,x)=>r.json(x);
const moneyNum=x=>Number.isFinite(Number(x))?Number(x):0;
const validId=x=>Number.isInteger(Number(x))&&Number(x)>0;

app.get("/api/health",(q,r)=>json(r,{ok:true,service:"Fiado App API",database:path.basename(DB_PATH)}));
app.get("/api/dashboard",(q,r)=>{const products=dbFor(q).prepare("SELECT * FROM products ORDER BY name").all();const customers=dbFor(q).prepare("SELECT * FROM customers ORDER BY balance DESC,name").all();const salesToday=dbFor(q).prepare("SELECT COALESCE(SUM(total),0) total FROM sales WHERE status='completed' AND date(created_at)=date('now','-5 hours')").get().total;const weekSales=dbFor(q).prepare("SELECT COALESCE(SUM(total),0) total FROM sales WHERE status='completed' AND created_at>=datetime('now','-7 day')").get().total;const totalCredit=customers.reduce((a,c)=>a+Number(c.balance||0),0);const today=new Date();const limit=new Date(today.getTime()+90*864e5).toISOString().slice(0,10);const expensesToday=dbFor(q).prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE date(created_at)=date('now','-5 hours')").get().total;const cashToday=salesToday-expensesToday;json(r,{products,customers,salesToday,weekSales,totalCredit,expensesToday,cashToday,lowStock:products.filter(p=>p.stock<=p.min_stock),expiring:products.filter(p=>p.expiration&&p.expiration<=limit)});});

app.get("/api/products",(q,r)=>json(r,dbFor(q).prepare("SELECT * FROM products ORDER BY name").all()));
app.get("/api/products/barcode/:code",(q,r)=>{const p=dbFor(q).prepare("SELECT * FROM products WHERE barcode=?").get(q.params.code.trim());if(!p)return r.status(404).json({error:"No hay ningún producto con ese código de barras"});json(r,p);});
app.post("/api/products",requireRole("admin","manager"),(q,r)=>{const p=q.body||{};const name=String(p.name||"").trim();if(!name)return r.status(400).json({error:"Nombre requerido"});const barcode=String(p.barcode||"").trim();if(barcode&&dbFor(q).prepare("SELECT id FROM products WHERE barcode=?").get(barcode))return r.status(400).json({error:"Ese código de barras ya está asignado"});const x=dbFor(q).prepare("INSERT INTO products(name,category,price,cost,stock,min_stock,image,expiration,barcode) VALUES(?,?,?,?,?,?,?,?,?)").run(name,String(p.category||"General").trim(),Math.max(0,moneyNum(p.price)),Math.max(0,moneyNum(p.cost)),Math.max(0,Math.floor(moneyNum(p.stock))),Math.max(0,Math.floor(moneyNum(p.min_stock||5))),p.image||"",p.expiration||"",barcode);json(r,dbFor(q).prepare("SELECT * FROM products WHERE id=?").get(x.lastInsertRowid));});
app.put("/api/products/:id",requireRole("admin","manager"),(q,r)=>{if(!validId(q.params.id))return r.status(400).json({error:"ID inválido"});const old=dbFor(q).prepare("SELECT * FROM products WHERE id=?").get(q.params.id);if(!old)return r.status(404).json({error:"Producto no encontrado"});const p=q.body||{},barcode=String(p.barcode||"").trim();const dup=barcode&&dbFor(q).prepare("SELECT id FROM products WHERE barcode=? AND id!=?").get(barcode,q.params.id);if(dup)return r.status(400).json({error:"Ese código de barras ya está asignado"});const stock=Math.max(0,Math.floor(moneyNum(p.stock)));dbFor(q).prepare("UPDATE products SET name=?,category=?,price=?,cost=?,stock=?,min_stock=?,image=?,expiration=?,barcode=? WHERE id=?").run(String(p.name||old.name).trim(),String(p.category||"General").trim(),Math.max(0,moneyNum(p.price)),Math.max(0,moneyNum(p.cost)),stock,Math.max(0,Math.floor(moneyNum(p.min_stock||5))),p.image||"",p.expiration||"",barcode,q.params.id);if(stock!==old.stock)dbFor(q).prepare("INSERT INTO movements(product_id,type,quantity,note) VALUES(?,?,?,?)").run(q.params.id,stock>old.stock?"entrada":"salida",Math.abs(stock-old.stock),"Cambio de stock al editar producto");json(r,dbFor(q).prepare("SELECT * FROM products WHERE id=?").get(q.params.id));});
app.delete("/api/products/:id",requireRole("admin","manager"),(q,r)=>{const p=dbFor(q).prepare("SELECT id FROM products WHERE id=?").get(q.params.id);if(!p)return r.status(404).json({error:"Producto no encontrado"});const used=dbFor(q).prepare("SELECT COUNT(*) n FROM sale_items WHERE product_id=?").get(q.params.id).n;if(used)return r.status(409).json({error:"No se puede eliminar un producto que tiene ventas. Puedes dejar su stock en 0 o editarlo."});dbFor(q).prepare("DELETE FROM products WHERE id=?").run(q.params.id);json(r,{ok:true});});
app.post("/api/products/:id/stock",requireRole("admin","manager"),(q,r)=>{const d=Math.trunc(moneyNum(q.body?.delta));if(!d)return r.status(400).json({error:"La cantidad debe ser distinta de cero"});const p=dbFor(q).prepare("SELECT * FROM products WHERE id=?").get(q.params.id);if(!p)return r.status(404).json({error:"Producto no encontrado"});if(d<0&&p.stock+d<0)return r.status(400).json({error:`No puedes sacar ${Math.abs(d)} unidades; solo hay ${p.stock}.`});const stock=p.stock+d;dbFor(q).transaction(()=>{dbFor(q).prepare("UPDATE products SET stock=? WHERE id=?").run(stock,p.id);dbFor(q).prepare("INSERT INTO movements(product_id,type,quantity,note) VALUES(?,?,?,?)").run(p.id,d>0?"entrada":"salida",Math.abs(d),q.body.note||"Ajuste de inventario");})();json(r,dbFor(q).prepare("SELECT * FROM products WHERE id=?").get(p.id));});
app.get("/api/movements",requireRole("admin","manager"),(q,r)=>json(r,dbFor(q).prepare("SELECT m.*,p.name product_name FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC,m.id DESC LIMIT 300").all()));

app.get("/api/customers",(q,r)=>json(r,dbFor(q).prepare("SELECT * FROM customers ORDER BY balance DESC,name").all()));
app.post("/api/customers",(q,r)=>{const p=q.body||{};const name=String(p.name||"").trim();if(!name)return r.status(400).json({error:"Nombre requerido"});const x=dbFor(q).prepare("INSERT INTO customers(name,phone) VALUES(?,?)").run(name,String(p.phone||"").trim());json(r,dbFor(q).prepare("SELECT * FROM customers WHERE id=?").get(x.lastInsertRowid));});
app.put("/api/customers/:id",(q,r)=>{const p=q.body||{},c=dbFor(q).prepare("SELECT * FROM customers WHERE id=?").get(q.params.id);if(!c)return r.status(404).json({error:"Cliente no encontrado"});const name=String(p.name||"").trim();if(!name)return r.status(400).json({error:"Nombre requerido"});dbFor(q).prepare("UPDATE customers SET name=?,phone=? WHERE id=?").run(name,String(p.phone||"").trim(),q.params.id);json(r,dbFor(q).prepare("SELECT * FROM customers WHERE id=?").get(q.params.id));});
app.get("/api/customers/:id/history",(q,r)=>json(r,dbFor(q).prepare("SELECT * FROM debts WHERE customer_id=? ORDER BY created_at DESC,id DESC").all(q.params.id)));
app.post("/api/customers/:id/debt",(q,r)=>{const type=q.body?.type,amount=moneyNum(q.body?.amount),c=dbFor(q).prepare("SELECT * FROM customers WHERE id=?").get(q.params.id);if(!c||!['fiado','abono'].includes(type)||amount<=0)return r.status(400).json({error:"Movimiento inválido"});if(type==='abono'&&amount>c.balance)return r.status(400).json({error:`El abono no puede superar el saldo pendiente de ${c.balance.toLocaleString('es-CO')}.`});const balance=type==='fiado'?c.balance+amount:c.balance-amount;dbFor(q).transaction(()=>{dbFor(q).prepare("INSERT INTO debts(customer_id,type,amount,note) VALUES(?,?,?,?)").run(c.id,type,amount,q.body.note||"");dbFor(q).prepare("UPDATE customers SET balance=? WHERE id=?").run(Math.max(0,balance),c.id);})();json(r,{ok:true,balance:Math.max(0,balance)});});

app.post("/api/sales",(q,r)=>{const {items,payment="efectivo",customerId,customerName="",customerCedula=""}=q.body||{};if(!Array.isArray(items)||!items.length)return r.status(400).json({error:"Venta vacía"});if(!['efectivo','transferencia','fiado'].includes(payment))return r.status(400).json({error:"Forma de pago inválida"});const normalized=[];for(const i of items){const id=Number(i.id),qty=Math.floor(moneyNum(i.quantity));if(!validId(id)||qty<=0)return r.status(400).json({error:"Producto o cantidad inválidos"});const p=dbFor(q).prepare("SELECT * FROM products WHERE id=?").get(id);if(!p)return r.status(400).json({error:"Producto no encontrado"});if(p.stock<qty)return r.status(400).json({error:`Stock insuficiente: ${p.name}. Disponibles: ${p.stock}`});normalized.push({p,qty,price:p.price});}if(payment==='fiado'&&!validId(customerId))return r.status(400).json({error:"Selecciona un cliente para el fiado"});if(payment==='fiado'&&!dbFor(q).prepare("SELECT id FROM customers WHERE id=?").get(customerId))return r.status(400).json({error:"Cliente no encontrado"});const total=normalized.reduce((s,i)=>s+i.price*i.qty,0);let saleId;
 try{dbFor(q).transaction(()=>{const sale=dbFor(q).prepare("INSERT INTO sales(total,payment,customer_id,customer_name,customer_cedula) VALUES(?,?,?,?,?)").run(total,payment,customerId||null,String(customerName).trim(),String(customerCedula).trim());saleId=sale.lastInsertRowid;const addItem=dbFor(q).prepare("INSERT INTO sale_items(sale_id,product_id,quantity,price,cost) VALUES(?,?,?,?,?)");for(const i of normalized){dbFor(q).prepare("UPDATE products SET stock=stock-? WHERE id=?").run(i.qty,i.p.id);dbFor(q).prepare("INSERT INTO movements(product_id,type,quantity,note) VALUES(?,?,?,?)").run(i.p.id,"salida",i.qty,`Venta #${saleId}`);addItem.run(saleId,i.p.id,i.qty,i.price,i.p.cost);}if(payment==='fiado'){const c=dbFor(q).prepare("SELECT balance FROM customers WHERE id=?").get(customerId);dbFor(q).prepare("UPDATE customers SET balance=? WHERE id=?").run(c.balance+total,customerId);dbFor(q).prepare("INSERT INTO debts(customer_id,type,amount,note) VALUES(?,?,?,?)").run(customerId,"fiado",total,`Compra #${saleId}`);}})();json(r,{ok:true,id:saleId,total});}catch(e){r.status(400).json({error:e.message||"No se pudo registrar la venta"});}});

app.get("/api/sales",(q,r)=>{const limit=Math.min(500,Math.max(1,Number(q.query.limit)||100));json(r,dbFor(q).prepare(`SELECT * FROM sales ORDER BY created_at DESC,id DESC LIMIT ${limit}`).all());});
app.get("/api/sales/:id",(q,r)=>{const sale=dbFor(q).prepare("SELECT * FROM sales WHERE id=?").get(q.params.id);if(!sale)return r.status(404).json({error:"Venta no encontrada"});const items=dbFor(q).prepare("SELECT si.*,p.name FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?").all(q.params.id);json(r,{...sale,items});});
app.post("/api/sales/:id/return",requireRole("admin","manager"),(q,r)=>{const sale=dbFor(q).prepare("SELECT * FROM sales WHERE id=?").get(q.params.id);if(!sale||sale.status!=='completed')return r.status(400).json({error:"La venta no existe o ya fue cancelada"});const reqItems=Array.isArray(q.body?.items)?q.body.items:[];if(!reqItems.length)return r.status(400).json({error:"No seleccionaste productos para devolver"});try{dbFor(q).transaction(()=>{for(const req of reqItems){const si=dbFor(q).prepare("SELECT * FROM sale_items WHERE id=? AND sale_id=?").get(req.itemId,sale.id);if(!si)throw Error("Detalle de venta inválido");const qty=Math.floor(moneyNum(req.quantity));const available=si.quantity-si.returned_quantity;if(qty<=0||qty>available)throw Error(`Cantidad de devolución inválida para el producto ${si.product_id}`);dbFor(q).prepare("UPDATE sale_items SET returned_quantity=returned_quantity+? WHERE id=?").run(qty,si.id);dbFor(q).prepare("UPDATE products SET stock=stock+? WHERE id=?").run(qty,si.product_id);dbFor(q).prepare("INSERT INTO movements(product_id,type,quantity,note) VALUES(?,?,?,?)").run(si.product_id,"entrada",qty,`Devolución venta #${sale.id}`);if(sale.payment==='fiado'){const c=dbFor(q).prepare("SELECT balance FROM customers WHERE id=?").get(sale.customer_id);const amount=qty*si.price;dbFor(q).prepare("UPDATE customers SET balance=? WHERE id=?").run(Math.max(0,c.balance-amount),c.id);dbFor(q).prepare("INSERT INTO debts(customer_id,type,amount,note) VALUES(?,?,?,?)").run(c.id,"abono",amount,`Devolución venta #${sale.id}`);}}const remaining=dbFor(q).prepare("SELECT COALESCE(SUM(quantity-returned_quantity),0) n FROM sale_items WHERE sale_id=?").get(sale.id).n;if(remaining===0)dbFor(q).prepare("UPDATE sales SET status='returned' WHERE id=?").run(sale.id);})();json(r,{ok:true});}catch(e){r.status(400).json({error:e.message});}});

app.get("/api/expenses",requireRole("admin","manager"),(q,r)=>json(r,dbFor(q).prepare("SELECT * FROM expenses ORDER BY created_at DESC,id DESC LIMIT 300").all()));
app.post("/api/expenses",requireRole("admin","manager"),(q,r)=>{const description=String(q.body?.description||"").trim(),amount=moneyNum(q.body?.amount),category=String(q.body?.category||"General").trim()||"General";if(!description||amount<=0)return r.status(400).json({error:"Descripción y valor válido son obligatorios"});const x=dbFor(q).prepare("INSERT INTO expenses(description,amount,category) VALUES(?,?,?)").run(description,amount,category);json(r,dbFor(q).prepare("SELECT * FROM expenses WHERE id=?").get(x.lastInsertRowid));});
app.delete("/api/expenses/:id",requireRole("admin","manager"),(q,r)=>{if(!validId(q.params.id))return r.status(400).json({error:"ID inválido"});const x=dbFor(q).prepare("DELETE FROM expenses WHERE id=?").run(q.params.id);if(!x.changes)return r.status(404).json({error:"Gasto no encontrado"});json(r,{ok:true});});

app.get("/api/reminders",(q,r)=>json(r,dbFor(q).prepare("SELECT * FROM reminders ORDER BY date,id").all()));
app.post("/api/reminders",(q,r)=>{const p=q.body||{};const date=String(p.date||"").trim(),title=String(p.title||"").trim();if(!date||!title)return r.status(400).json({error:"Fecha y título son obligatorios"});const x=dbFor(q).prepare("INSERT INTO reminders(date,title,note) VALUES(?,?,?)").run(date,title,String(p.note||"").trim());json(r,dbFor(q).prepare("SELECT * FROM reminders WHERE id=?").get(x.lastInsertRowid));});
app.put("/api/reminders/:id",(q,r)=>{if(!validId(q.params.id))return r.status(400).json({error:"ID inválido"});const x=dbFor(q).prepare("UPDATE reminders SET done=? WHERE id=?").run(q.body?.done?1:0,q.params.id);if(!x.changes)return r.status(404).json({error:"Recordatorio no encontrado"});json(r,dbFor(q).prepare("SELECT * FROM reminders WHERE id=?").get(q.params.id));});
app.delete("/api/reminders/:id",(q,r)=>{const x=dbFor(q).prepare("DELETE FROM reminders WHERE id=?").run(q.params.id);if(!x.changes)return r.status(404).json({error:"Recordatorio no encontrado"});json(r,{ok:true});});

app.get("/api/settings",(q,r)=>json(r,Object.fromEntries(dbFor(q).prepare("SELECT key,value FROM settings").all().map(x=>[x.key,x.value]))));
app.post("/api/settings",requireRole("admin"),(q,r)=>{const set=dbFor(q).prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");dbFor(q).transaction(()=>{for(const [k,v] of Object.entries(q.body||{}))set.run(k,String(v??""));})();json(r,Object.fromEntries(dbFor(q).prepare("SELECT key,value FROM settings").all().map(x=>[x.key,x.value])));});

app.get("/api/reports",requireRole("admin","manager"),(q,r)=>{
 const days=Math.min(730,Math.max(1,Number(q.query.days)||7));
 const top=dbFor(q).prepare("SELECT p.name,SUM(si.quantity-si.returned_quantity) quantity,SUM((si.quantity-si.returned_quantity)*si.price) total,SUM((si.quantity-si.returned_quantity)*(si.price-si.cost)) profit FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id WHERE s.status='completed' AND s.created_at>=datetime('now',?,'-5 hours') GROUP BY p.id ORDER BY quantity DESC LIMIT 8").all(`-${days} day`);
 let sales, granularity;
 if(days<=31){
  // Rangos cortos (hoy/semana/mes): un punto por día.
  granularity="day";
  const rows=dbFor(q).prepare("SELECT date(created_at,'-5 hours') day,COALESCE(SUM(total),0) total FROM sales WHERE status='completed' AND created_at>=datetime('now',?,'-5 hours') GROUP BY date(created_at,'-5 hours') ORDER BY day").all(`-${days-1} day`);
  const byDay=Object.fromEntries(rows.map(x=>[x.day,x.total]));
  sales=[];for(let i=days-1;i>=0;i--){const d=new Date(Date.now()-i*86400000);const key=d.toLocaleDateString('en-CA',{timeZone:'America/Bogota'});sales.push({day:key,total:byDay[key]||0});}
 } else {
  // Rango largo (año): un punto por mes, si no la gráfica quedaría ilegible con 365 puntos.
  granularity="month";
  const months=Math.ceil(days/30);
  const rows=dbFor(q).prepare("SELECT strftime('%Y-%m',created_at,'-5 hours') month,COALESCE(SUM(total),0) total FROM sales WHERE status='completed' AND created_at>=datetime('now',?,'-5 hours') GROUP BY month ORDER BY month").all(`-${days} day`);
  const byMonth=Object.fromEntries(rows.map(x=>[x.month,x.total]));
  sales=[];for(let i=months-1;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.toISOString().slice(0,7);sales.push({day:key+"-01",total:byMonth[key]||0});}
 }
 const totals=dbFor(q).prepare("SELECT COALESCE(SUM(total),0) sales,COALESCE(SUM(total-COALESCE((SELECT SUM((si2.quantity-si2.returned_quantity)*si2.cost) FROM sale_items si2 WHERE si2.sale_id=s.id),0)),0) profit FROM sales s WHERE status='completed' AND created_at>=datetime('now',?,'-5 hours')").get(`-${days} day`);
 const totalExpenses=dbFor(q).prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE created_at>=datetime('now',?,'-5 hours')").get(`-${days} day`).total;
 json(r,{top,sales,granularity,totalSales:totals.sales,totalProfit:totals.profit,totalExpenses,days});
});

app.get("/api/export",requireRole("admin"),(q,r)=>{const payload={generatedAt:new Date().toISOString(),products:dbFor(q).prepare("SELECT * FROM products").all(),customers:dbFor(q).prepare("SELECT * FROM customers").all(),sales:dbFor(q).prepare("SELECT * FROM sales").all(),saleItems:dbFor(q).prepare("SELECT * FROM sale_items").all(),debts:dbFor(q).prepare("SELECT * FROM debts").all(),movements:dbFor(q).prepare("SELECT * FROM movements").all(),settings:dbFor(q).prepare("SELECT * FROM settings").all(),expenses:dbFor(q).prepare("SELECT * FROM expenses").all()};r.setHeader('Content-Disposition',`attachment; filename="fiao-app-backup-${new Date().toISOString().slice(0,10)}.json"`);r.json(payload);});

// Restaurar una copia de seguridad (.json exportada desde esta misma app). Reemplaza TODA la información actual.
app.post("/api/import",requireRole("admin"),(q,r)=>{
 const b=q.body||{};
 const tables=["products","customers","sales","saleItems","debts","movements","settings","expenses"];
 for(const t of tables) if(!Array.isArray(b[t])) return r.status(400).json({error:`El archivo de respaldo no es válido (falta "${t}")`});
 try{
  dbFor(q).transaction(()=>{
   dbFor(q).pragma("foreign_keys = OFF");
   dbFor(q).exec("DELETE FROM sale_items;DELETE FROM debts;DELETE FROM movements;DELETE FROM sales;DELETE FROM expenses;DELETE FROM settings;DELETE FROM customers;DELETE FROM products;");
   const insProduct=dbFor(q).prepare("INSERT INTO products(id,name,category,price,cost,stock,min_stock,image,expiration,barcode,created_at) VALUES(@id,@name,@category,@price,@cost,@stock,@min_stock,@image,@expiration,@barcode,@created_at)");
   b.products.forEach(x=>insProduct.run(x));
   const insCustomer=dbFor(q).prepare("INSERT INTO customers(id,name,phone,balance,created_at) VALUES(@id,@name,@phone,@balance,@created_at)");
   b.customers.forEach(x=>insCustomer.run(x));
   const insSale=dbFor(q).prepare("INSERT INTO sales(id,total,payment,customer_id,customer_name,customer_cedula,status,created_at) VALUES(@id,@total,@payment,@customer_id,@customer_name,@customer_cedula,@status,@created_at)");
   b.sales.forEach(x=>insSale.run(x));
   const insItem=dbFor(q).prepare("INSERT INTO sale_items(id,sale_id,product_id,quantity,price,cost,returned_quantity) VALUES(@id,@sale_id,@product_id,@quantity,@price,@cost,@returned_quantity)");
   b.saleItems.forEach(x=>insItem.run(x));
   const insDebt=dbFor(q).prepare("INSERT INTO debts(id,customer_id,type,amount,note,created_at) VALUES(@id,@customer_id,@type,@amount,@note,@created_at)");
   b.debts.forEach(x=>insDebt.run(x));
   const insMove=dbFor(q).prepare("INSERT INTO movements(id,product_id,type,quantity,note,created_at) VALUES(@id,@product_id,@type,@quantity,@note,@created_at)");
   b.movements.forEach(x=>insMove.run(x));
   const insSetting=dbFor(q).prepare("INSERT INTO settings(key,value) VALUES(@key,@value)");
   b.settings.forEach(x=>insSetting.run(x));
   const insExpense=dbFor(q).prepare("INSERT INTO expenses(id,description,amount,category,created_at) VALUES(@id,@description,@amount,@category,@created_at)");
   b.expenses.forEach(x=>insExpense.run(x));
   dbFor(q).pragma("foreign_keys = ON");
  })();
  json(r,{ok:true});
 }catch(e){ r.status(400).json({error:"No se pudo restaurar el respaldo: "+(e.message||"archivo inválido")}); }
});

// Exportar a Excel/CSV (se abren directamente en Excel)
const toCsv=(headers,rows)=>{
 const esc=v=>{const s=v===null||v===undefined?"":String(v);return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return "\uFEFF"+[headers.join(";"),...rows.map(row=>row.map(esc).join(";"))].join("\r\n");
};
app.get("/api/export/inventario.csv",requireRole("admin","manager"),(q,r)=>{
 const rows=dbFor(q).prepare("SELECT * FROM products ORDER BY name").all();
 const csv=toCsv(["Producto","Categoría","Precio","Costo","Stock","Stock mínimo","Vencimiento","Código de barras"],rows.map(p=>[p.name,p.category,p.price,p.cost,p.stock,p.min_stock,p.expiration,p.barcode]));
 r.setHeader('Content-Type','text/csv; charset=utf-8');r.setHeader('Content-Disposition',`attachment; filename="inventario-${new Date().toISOString().slice(0,10)}.csv"`);r.send(csv);
});
app.get("/api/export/fiados.csv",requireRole("admin","manager"),(q,r)=>{
 const rows=dbFor(q).prepare("SELECT * FROM customers WHERE balance>0 ORDER BY balance DESC").all();
 const csv=toCsv(["Cliente","Teléfono","Saldo pendiente"],rows.map(c=>[c.name,c.phone,c.balance]));
 r.setHeader('Content-Type','text/csv; charset=utf-8');r.setHeader('Content-Disposition',`attachment; filename="fiados-${new Date().toISOString().slice(0,10)}.csv"`);r.send(csv);
});
app.get("/api/export/ventas.csv",requireRole("admin","manager"),(q,r)=>{
 const rows=dbFor(q).prepare("SELECT * FROM sales ORDER BY created_at DESC").all();
 const csv=toCsv(["Fecha","Cliente","Forma de pago","Total","Estado"],rows.map(s=>[s.created_at,s.customer_name,s.payment,s.total,s.status]));
 r.setHeader('Content-Type','text/csv; charset=utf-8');r.setHeader('Content-Disposition',`attachment; filename="ventas-${new Date().toISOString().slice(0,10)}.csv"`);r.send(csv);
});

app.listen(PORT,"0.0.0.0",()=>console.log(`Fiado App API → http://localhost:${PORT}`));
