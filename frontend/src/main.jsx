
import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import * as I from "lucide-react";
import "./styles.css";

// Ruta relativa: Vite la reenvía al backend (ver vite.config.js).
// Así funciona igual en la PC (http://localhost:5173) y en el celular (https://IP-de-la-PC:5173).
const API="/api";
function apiFetch(url,options={}){
 const token=localStorage.getItem("fiao_token");
 const headers={...(options.headers||{})};
 if(token) headers.Authorization=`Bearer ${token}`;
 return fetch(url,{...options,headers}).then(async r=>{if(r.status===401)window.dispatchEvent(new Event("fiao-logout"));return r;});
}
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(n||0);
// Separador de miles para los campos donde se escriben valores en pesos (precio, costo, abonos, recibido...)
const fmtMiles=n=>(n===""||n===null||n===undefined)?"":Number(n).toLocaleString("es-CO");
// El backend guarda las fechas en UTC (formato "AAAA-MM-DD HH:MM:SS" sin zona horaria);
// aquí las interpretamos como UTC y las mostramos siempre en la hora real de Colombia.
function bogotaDate(value){
 if(value instanceof Date)return value;
 const s=String(value);
 const iso=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)?s.replace(" ","T")+"Z":s;
 return new Date(iso);
}
function fmtDateTime(value){return bogotaDate(value).toLocaleString("es-CO",{timeZone:"America/Bogota",dateStyle:"medium",timeStyle:"short"})}
function fmtDateLong(value){return bogotaDate(value).toLocaleString("es-CO",{timeZone:"America/Bogota",dateStyle:"long",timeStyle:"short"})}
function MoneyField({value,onChange,placeholder,required,autoFocus}){
 return <input inputMode="numeric" placeholder={placeholder} required={required} autoFocus={autoFocus}
  value={fmtMiles(value)} onChange={e=>onChange(e.target.value.replace(/\D/g,""))}/>
}
const initial={products:[],customers:[],lowStock:[],expiring:[],salesToday:0,weekSales:0,totalCredit:0,expensesToday:0,cashToday:0};

// Niveles de alerta (🔴 crítico, 🟠 medio, 🟢 normal) para inventario y vencimientos.
function stockLevel(p){ if(p.stock<=0||p.stock<=Math.ceil(p.min_stock/2))return "critical"; if(p.stock<=p.min_stock)return "warning"; return "ok"; }
function daysUntil(dateStr){ if(!dateStr)return Infinity; return Math.ceil((new Date(dateStr+"T00:00:00")-new Date(new Date().toDateString()))/86400000); }
function expiryLevel(p){ const d=daysUntil(p.expiration); if(d<=3)return "critical"; if(d<=15)return "warning"; return "ok"; }
const LEVEL_DOT={critical:"🔴",warning:"🟠",ok:"🟢"};
const LEVEL_LABEL={critical:"Crítico",warning:"Bajo",ok:"Normal"};

// Lee una imagen (foto de galería o archivo) y la comprime/redimensiona antes de convertirla a base64,
// para no llenar la base de datos con fotos pesadas del celular.
function fileToResizedDataURL(file,maxSize=700){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error("No se pudo leer el archivo"));
  reader.onload=()=>{
   const img=new Image();
   img.onerror=()=>reject(new Error("El archivo no es una imagen válida"));
   img.onload=()=>{
    let {width,height}=img;
    if(width>maxSize||height>maxSize){ const ratio=Math.min(maxSize/width,maxSize/height); width=Math.round(width*ratio); height=Math.round(height*ratio); }
    const canvas=document.createElement("canvas"); canvas.width=width; canvas.height=height;
    canvas.getContext("2d").drawImage(img,0,0,width,height);
    resolve(canvas.toDataURL("image/jpeg",0.82));
   };
   img.src=reader.result;
  };
  reader.readAsDataURL(file);
 });
}

// Botón para elegir una foto desde la galería o los archivos del dispositivo, con vista previa.
function ImageUploadField({value,onChange,notify}){
 const [loading,setLoading]=useState(false);
 const inputId="img-upload-"+useState(()=>Math.random().toString(36).slice(2))[0];
 const pick=async e=>{
  const file=e.target.files?.[0]; e.target.value="";
  if(!file)return;
  setLoading(true);
  try{ onChange(await fileToResizedDataURL(file)); }
  catch{ notify?.("No se pudo cargar la imagen, intenta con otra foto"); }
  setLoading(false);
 };
 return <div className="image-upload">
  {value?<div className="image-preview"><img src={value}/><button type="button" className="img-remove" onClick={()=>onChange("")}><I.X size={14}/></button></div>
  :<label htmlFor={inputId} className="image-drop"><I.ImagePlus size={22}/><span>{loading?"Cargando...":"Toca para agregar una foto"}</span><small>Desde galería o archivos</small></label>}
  <input id={inputId} type="file" accept="image/*" hidden onChange={pick}/>
  {value&&<label htmlFor={inputId} className="btn ghost image-change"><I.ImagePlus size={15}/>Cambiar foto</label>}
 </div>
}


function Login({onLogin}){
 const [mode,setMode]=useState("login"),[form,setForm]=useState({name:"",email:"admin@fiao.app",password:"admin123",storeName:""}),[error,setError]=useState(""),[busy,setBusy]=useState(false),[showPassword,setShowPassword]=useState(false);
 const submit=async e=>{e.preventDefault();setError("");setBusy(true);try{const endpoint=mode==="login"?"/auth/login":"/auth/register";const r=await fetch(API+endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo iniciar sesión");localStorage.setItem("fiao_token",x.token);onLogin(x);}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <div className="auth-page">
  <div className="auth-shell">
   <section className="auth-showcase">
    <div className="showcase-brand"><div className="auth-logo"><I.ShoppingBag size={25}/></div><div><strong>Fiado App</strong><span>Gestión inteligente para tu tienda</span></div></div>
    <div className="showcase-content">
     <span className="showcase-kicker">TU TIENDA, BAJO CONTROL</span>
     <h2>Administra tu negocio <em>sin complicarte.</em></h2>
     <p>Inventario, ventas, caja y fiados en un solo lugar, pensado para el día a día del tendero.</p>
     <div className="showcase-points">
      <div><span className="point-icon"><I.Package size={17}/></span><div><b>Inventario claro</b><small>Controla existencias y productos por vencer.</small></div></div>
      <div><span className="point-icon"><I.TrendingUp size={17}/></span><div><b>Decisiones con datos</b><small>Conoce tus ventas y lo que más se mueve.</small></div></div>
      <div><span className="point-icon"><I.CreditCard size={17}/></span><div><b>Fiados organizados</b><small>Registra abonos y envía recordatorios.</small></div></div>
     </div>
    </div>
    <div className="showcase-footer"><span>Fiado App</span><span>•</span><span>Simple para el tendero</span></div>
   </section>
   <section className="auth-card">
    <div className="auth-mobile-brand"><div className="auth-logo"><I.ShoppingBag size={21}/></div><div><strong>Fiado App</strong><small>Gestión de tu tienda</small></div></div>
    <div className="auth-heading"><span className="auth-overline">{mode==="login"?"ACCESO SEGURO":"NUEVA CUENTA"}</span><h1>{mode==="login"?"Bienvenido de nuevo":"Crea tu cuenta"}</h1><p>{mode==="login"?"Ingresa para continuar administrando tu tienda.":"Configura tu usuario administrador y comienza a trabajar."}</p></div>
    <form className="form auth-form" onSubmit={submit}>
     {mode==="register"&&<label>Nombre completo<div className="input-wrap"><I.UserRound size={17}/><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ej. Carlos Pérez"/></div></label>}
     <label>Correo electrónico<div className="input-wrap"><I.Mail size={17}/><input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="correo@ejemplo.com"/></div></label>
     <label>Contraseña<div className="input-wrap"><I.LockKeyhole size={17}/><input required type={showPassword?"text":"password"} minLength={6} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Mínimo 6 caracteres"/><button type="button" className="password-toggle" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?"Ocultar contraseña":"Mostrar contraseña"}>{showPassword?<I.EyeOff size={17}/>:<I.Eye size={17}/>}</button></div></label>
     {mode==="register"&&<label>Nombre de la tienda<div className="input-wrap"><I.Store size={17}/><input required value={form.storeName} onChange={e=>setForm({...form,storeName:e.target.value})} placeholder="Ej. Tienda La Esquina"/></div></label>}
     {error&&<p className="form-error auth-error"><I.AlertCircle size={16}/>{error}</p>}
     <button className="btn primary big auth-submit" disabled={busy}>{busy?<><I.LoaderCircle size={17} className="spin"/>Procesando...</>:mode==="login"?<>Iniciar sesión<I.ArrowRight size={17}/></>:<>Crear cuenta<I.ArrowRight size={17}/></>}</button>
    </form>
    <button className="auth-link" onClick={()=>{setMode(mode==="login"?"register":"login");setError("");setShowPassword(false)}}>{mode==="login"?"¿Primera vez en Fiado App? Crear una cuenta":"Ya tengo una cuenta · Iniciar sesión"}</button>
    {mode==="login"&&<div className="demo-box"><I.Sparkles size={15}/><div><b>Modo demostración</b><small>admin@fiao.app · admin123</small></div></div>}
    <div className="auth-security"><I.ShieldCheck size={14}/> Tus datos se gestionan de forma segura</div>
   </section>
  </div>
 </div>
}
function Team({session,notify}){
 const [users,setUsers]=useState([]),[form,setForm]=useState({name:"",email:"",password:"",role:"cashier"}),[loading,setLoading]=useState(true);
 const load=()=>apiFetch(API+"/users").then(r=>r.json()).then(setUsers).finally(()=>setLoading(false));useEffect(()=>{load()},[]);
 const add=async e=>{e.preventDefault();const r=await apiFetch(API+"/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});const x=await r.json();if(!r.ok)return notify(x.error);setForm({name:"",email:"",password:"",role:"cashier"});load();notify("Usuario agregado a la tienda");};
 const toggle=async u=>{const r=await apiFetch(API+"/users/"+u.id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({active:!u.active})});const x=await r.json();if(!r.ok)return notify(x.error);load();};
 return <div className="team-page"><div className="panel team-intro"><div><h2>Usuarios y equipo</h2><p>Gestiona quién puede trabajar en <b>{session.store.name}</b>. Cada usuario tiene su propio acceso.</p></div><span className="role-pill">{session.user.role==="admin"?"Administrador":session.user.role==="manager"?"Encargado":"Vendedor"}</span></div>
  <div className="two"><div className="panel"><h2>Agregar usuario</h2><p className="muted">Crea una cuenta para un empleado.</p><form className="form" onSubmit={add}>
   <label>Nombre<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Correo<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Contraseña<input required minLength={6} type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
   <label>Rol<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="cashier">Vendedor</option><option value="manager">Encargado</option><option value="admin">Administrador</option></select></label><button className="btn primary">Agregar usuario</button>
  </form></div><div className="panel"><h2>Miembros</h2>{loading?<div className="empty">Cargando...</div>:users.map(u=><div className="user-row" key={u.id}><div className="avatar">{(u.name||"?")[0].toUpperCase()}</div><div><b>{u.name}</b><small>{u.email} · {u.role==="admin"?"Administrador":u.role==="manager"?"Encargado":"Vendedor"}</small></div><button className={"mini-toggle "+(u.active?"":"off")} onClick={()=>toggle(u)}>{u.active?"Activo":"Inactivo"}</button></div>)}</div></div></div>
}

// Cada módulo tiene su propio color de identidad, para que el tendero distinga todo de un vistazo.
const MODS=[
 [I.LayoutDashboard,"inicio","Inicio","#1aab57"],
 [I.ShoppingCart,"ventas","Ventas","#2f6fed"],
 [I.Package,"productos","Inventario","#f0883e"],
 [I.Users,"fiados","Fiados","#8b5cf6"],
 [I.CalendarDays,"calendario","Calendario","#f59e0b"],
 [I.WalletCards,"caja","Caja","#0ea5a4"],
 [I.BarChart3,"reportes","Reportes","#ef4477"],
 [I.Settings,"configuracion","Configuración","#64748b"],
 [I.UserCog,"equipo","Equipo","#6366f1"],
];
const TAB_TITLE={inicio:"Resumen de hoy",ventas:"Nueva venta",productos:"Mi inventario",fiados:"Clientes fiados",calendario:"Calendario de vencimientos y cobros",caja:"Caja y gastos",configuracion:"Configuración",equipo:"Usuarios y equipo",reportes:"Mis reportes"};
// Qué puede ver cada rol: el Vendedor solo vende y fía, el Encargado suma inventario/caja/reportes,
// y el Administrador ve todo, incluida la configuración y el equipo.
const ROLE_TABS={
 cashier:["inicio","ventas","fiados","calendario"],
 manager:["inicio","ventas","productos","fiados","calendario","caja","reportes"],
 admin:["inicio","ventas","productos","fiados","calendario","caja","reportes","configuracion","equipo"],
};
// Reloj en vivo con la hora de Colombia, junto a las notificaciones
function Clock(){
 const [now,setNow]=useState(new Date());
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000*15);return()=>clearInterval(t)},[]);
 return <div className="clock-badge"><I.Clock size={15}/>{now.toLocaleTimeString("es-CO",{timeZone:"America/Bogota",hour:"2-digit",minute:"2-digit"})}</div>
}
function MainApp({session,onLogout,onSession}){
 const allowed=ROLE_TABS[session.user.role]||ROLE_TABS.cashier;
 const [tab,setTab]=useState(allowed.includes("inicio")?"inicio":allowed[0]),[data,setData]=useState(initial),[dark,setDark]=useState(false),[toast,setToast]=useState("");
 const load=()=>apiFetch(API+"/dashboard").then(x=>x.json()).then(setData).catch(()=>setToast("Inicia primero el servidor del backend"));
 useEffect(()=>{load()},[]);
 // Si al cambiar de tienda el rol ya no permite ver la pestaña actual, regresa a Inicio
 useEffect(()=>{if(!allowed.includes(tab))setTab(allowed.includes("inicio")?"inicio":allowed[0])},[session.user.role]);
 const notify=x=>{setToast(x);setTimeout(()=>setToast(""),2800)};
 const accent=(MODS.find(m=>m[1]===tab)||MODS[0])[3];
 const visibleMods=MODS.filter(([,k])=>allowed.includes(k));
 return <div className={dark?"app dark":"app"}><aside><div className="brand"><div className="mark">F</div><div><b>Fiado App</b><small>Ventas, inventario y fiados, fácil.</small></div></div><nav>
 {visibleMods.map(([Icon,k,t,color])=><button className={tab===k?"sel":""} style={{"--mod":color,"--mod-bg":color+"1f"}} onClick={()=>setTab(k)} key={k}><span className="nav-ico"><Icon size={18}/></span><span>{t}</span>{k==="fiados"&&data.totalCredit>0?<em>{money(data.totalCredit)}</em>:null}</button>)}
 </nav></aside>
 <main style={{"--accent":accent}}><header><div><div className="eyebrow">FIADO APP</div><h1>{TAB_TITLE[tab]}</h1><p>Control sencillo para una tienda que nunca se detiene.</p></div>
 <div className="header-right"><NotificationBell data={data} go={setTab}/>
 <Clock/>
 <button className="theme-toggle" onClick={()=>setDark(!dark)} title={dark?"Cambiar a modo claro":"Cambiar a modo oscuro"}>{dark?<I.Sun size={18}/>:<I.Moon size={18}/>}</button>
 <select className="store-select" value={session.store.id} onChange={async e=>{const r=await apiFetch(API+"/auth/switch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storeId:Number(e.target.value)})});const x=await r.json();if(x.error)return notify(x.error);onSession({...session,store:x.store,user:x.user||session.user});load();}}>
 {session.stores.map(s=><option key={s.id} value={s.id}>🏪 {s.name}</option>)}</select>
 <button className="add-store-btn" title="Crear otra tienda" onClick={async()=>{const name=prompt("Nombre de la nueva tienda:");if(!name?.trim())return;const r=await apiFetch(API+"/stores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})});const x=await r.json();if(!r.ok)return notify(x.error);onSession({...session,stores:x.stores,store:x.store});notify("Nueva tienda creada");load();}}>＋ Tienda</button>
 <button className="account-btn" onClick={onLogout}><I.LogOut size={16}/>{session.user.name}</button></div></header>
 {tab==="inicio"&&<Home data={data} go={setTab}/>}
 {tab==="productos"&&<Products data={data} reload={load} notify={notify}/>}
 {tab==="fiados"&&<Credits data={data} reload={load} notify={notify}/>}
 {tab==="calendario"&&<CalendarView data={data} go={setTab}/>}
 {tab==="caja"&&<CashBox data={data} reload={load} notify={notify}/>}
 {tab==="ventas"&&<Sales data={data} reload={load} notify={notify}/>}
 {tab==="reportes"&&<Reports/>}
 {tab==="configuracion"&&<Settings reload={load} notify={notify}/>}
 {tab==="equipo"&&<Team session={session} notify={notify}/>} 
 </main>{toast&&<div className="toast">{toast}</div>}</div>
}

// ---------- Campana de notificaciones: clientes que deben, poco stock y productos por vencer ----------
function NotificationBell({data,go}){
 const [open,setOpen]=useState(false);
 const debtors=data.customers.filter(c=>c.balance>0);
 const count=debtors.length+data.lowStock.length+data.expiring.length;
 useEffect(()=>{
  if(!open)return;
  const close=()=>setOpen(false);
  document.addEventListener("click",close);
  return ()=>document.removeEventListener("click",close);
 },[open]);
 const goTo=tab=>{setOpen(false);go(tab)};
 return <div className="notif-wrap" onClick={e=>e.stopPropagation()}>
  <button className="bell" onClick={()=>setOpen(o=>!o)}><I.Bell size={19}/>{count>0&&<span className="badge">{count>9?"9+":count}</span>}</button>
  {open&&<div className="notif-panel">
   <div className="notif-title">Notificaciones</div>
   {count===0?<Empty text="No hay novedades por ahora"/>:<>
    {debtors.map(c=><button className="notif-item" key={"d"+c.id} onClick={()=>goTo("fiados")}><span>💰</span><div><b>{c.name} te debe</b><small>{money(c.balance)} pendiente</small></div></button>)}
    {data.lowStock.map(p=><button className="notif-item" key={"s"+p.id} onClick={()=>goTo("productos")}><span>{LEVEL_DOT[stockLevel(p)]}</span><div><b>{p.name}</b><small>Quedan solo {p.stock} unidades</small></div></button>)}
    {data.expiring.map(p=><button className="notif-item" key={"e"+p.id} onClick={()=>goTo("productos")}><span>{LEVEL_DOT[expiryLevel(p)]}</span><div><b>{p.name}</b><small>Vence el {p.expiration}</small></div></button>)}
   </>}
  </div>}
 </div>
}
function Home({data,go}){
 return <><div className="welcome"><div><span>Buenos días 👋</span><h2>¿Qué necesitas hacer?</h2></div><div className="date">{new Date().toLocaleDateString("es-CO",{timeZone:"America/Bogota",weekday:"long",day:"numeric",month:"long"})}</div></div>
 <div className="quick"><button onClick={()=>go("ventas")}><I.ShoppingCart/><b>Registrar venta</b><small>Vende en segundos</small></button><button onClick={()=>go("productos")}><I.Package/><b>Agregar mercancía</b><small>Actualiza tu inventario</small></button><button onClick={()=>go("fiados")}><I.Users/><b>Ver fiados</b><small>Controla lo que te deben</small></button></div>
 <div className="stats"><Stat title="Ventas hoy" value={money(data.salesToday)} icon={I.TrendingUp}/><Stat title="Ventas últimos 7 días" value={money(data.weekSales)} icon={I.BarChart3}/><Stat title="Me deben" value={money(data.totalCredit)} icon={I.HandCoins} danger/></div>
 <div className="two"><section className="panel"><div className="panel-title"><h3>⚠️ Atención</h3><span>{data.lowStock.length+data.expiring.length} avisos</span></div>{data.lowStock.length===0&&data.expiring.length===0?<Empty text="Todo está en orden"/>:<div>{[...data.lowStock].sort((a,b)=>(stockLevel(a)==="critical"?0:1)-(stockLevel(b)==="critical"?0:1)).map(p=><Alert key={"s"+p.id} text={p.name} sub={`Quedan ${p.stock} unidades`} level={stockLevel(p)} onClick={()=>go("productos")}/>)}{[...data.expiring].sort((a,b)=>daysUntil(a.expiration)-daysUntil(b.expiration)).map(p=><Alert key={"e"+p.id} text={p.name} sub={`Vence el ${p.expiration}`} level={expiryLevel(p)} onClick={()=>go("productos")}/>)}</div>}</section>
 <section className="panel"><div className="panel-title"><h3>💰 Cobros pendientes</h3><button onClick={()=>go("fiados")}>Ver todos →</button></div>{data.customers.filter(c=>c.balance>0).slice(0,4).map(c=><div className="debtrow" key={c.id}><div className="avatar">{c.name[0]}</div><div><b>{c.name}</b><small>{c.phone}</small></div><strong>{money(c.balance)}</strong></div>)}</section></div></>
}
function Stat({title,value,icon:Icon,danger}){return <div className={"stat "+(danger?"red":"")}><div><small>{title}</small><strong>{value}</strong></div><div className="stat-icon"><Icon/></div></div>}
function Alert({text,sub,level="warning",onClick}){return <button className={"alert level-"+level} onClick={onClick}><span>{LEVEL_DOT[level]}</span><div><b>{text}</b><small>{sub}</small></div><I.ChevronRight/></button>}
function Empty({text}){return <div className="empty"><I.CircleCheckBig size={38}/><b>{text}</b></div>}

// ---------- Escáner de código de barras con la cámara del celular (o la webcam de la PC) ----------
function Scanner({title="Escanear código de barras",hint="Apunta la cámara al código de barras del producto",close,onDetected}){
 const [error,setError]=useState("");
 const [manual,setManual]=useState("");
 useEffect(()=>{
  let scanner=null, cancelled=false;
  import("html5-qrcode").then(({Html5Qrcode})=>{
   if(cancelled) return;
   scanner=new Html5Qrcode("scanner-box",{
    verbose:false,
    // usa el lector de códigos de barras nativo del celular cuando existe (más rápido y certero)
    experimentalFeatures:{useBarCodeDetectorIfSupported:true}
   });
   scanner.start(
    {facingMode:"environment"}, // pide la cámara trasera del celular
    {
     fps:10,
     qrbox:{width:280,height:160},
     // más resolución = el código se ve más nítido y es más fácil de leer
     videoConstraints:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}}
    },
    code=>{ if(cancelled) return; onDetected(code); scanner.stop().catch(()=>{}); },
    ()=>{} // se llama en cada cuadro sin lectura; no es un error real
   ).catch(()=>{if(!cancelled) setError("No se pudo abrir la cámara trasera. Revisa los permisos del navegador, o escribe el código abajo.")});
  });
  return ()=>{cancelled=true; if(scanner){scanner.stop().then(()=>scanner.clear()).catch(()=>{})}};
 },[]);
 return <div className="overlay"><div className="modal scanner-modal"><button className="close" onClick={close}>×</button><h2>{title}</h2>
  <div id="scanner-box" className="scanner-box"></div>
  {error?<p className="scanner-error">⚠️ {error}</p>:<p className="scanner-hint">{hint}. Aléjalo unos 10-15 cm y busca buena luz.</p>}
  <form className="scanner-manual" onSubmit={e=>{e.preventDefault();if(manual.trim())onDetected(manual.trim())}}>
   <input value={manual} onChange={e=>setManual(e.target.value)} placeholder="¿No lo lee? Escribe el código aquí"/>
   <button type="submit" className="btn primary">Buscar</button>
  </form>
 </div></div>
}

// ---------- Inventario / Productos ----------
const emptyProduct={name:"",category:"",price:"",cost:"",stock:"",min_stock:"5",expiration:"",image:"",barcode:""};

function Products({data,reload,notify}){
 const [q,setQ]=useState(""),[modal,setModal]=useState(false),[formError,setFormError]=useState("");
 const [form,setForm]=useState(emptyProduct);
 const [editingId,setEditingId]=useState(null); // id del producto en edición, o null si es nuevo
 const [scanning,setScanning]=useState(false); // escaneando para el formulario de nuevo producto
 const [invScan,setInvScan]=useState(false); // escaneando para ajustar inventario
 const [adjustProduct,setAdjustProduct]=useState(null);
 const list=data.products.filter(p=>(p.name+" "+p.category+" "+(p.barcode||"")).toLowerCase().includes(q.toLowerCase()));

 const submit=e=>{
  e.preventDefault();
  const url=editingId?API+"/products/"+editingId:API+"/products";
  const method=editingId?"PUT":"POST";
  apiFetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(form)})
   .then(r=>r.json())
   .then(x=>{
    if(x.error){setFormError(x.error);return}
    setModal(false);setFormError("");setForm(emptyProduct);setEditingId(null);reload();notify(editingId?"Producto actualizado correctamente":"Producto agregado correctamente");
   }).catch(()=>setFormError("No se pudo guardar el producto. Verifica que el backend esté encendido."));
 };

 const editProduct=p=>{
  setForm({name:p.name||"",category:p.category||"",price:p.price??"",cost:p.cost??"",stock:p.stock??"",min_stock:p.min_stock??"5",expiration:p.expiration||"",image:p.image||"",barcode:p.barcode||""});
  setEditingId(p.id);setFormError("");setModal(true);
 };

 const onScannedForNewProduct=code=>{
  setScanning(false);
  apiFetch(API+"/products/barcode/"+encodeURIComponent(code)).then(async r=>{
   if(r.ok){const p=await r.json(); notify(`Ese código ya pertenece a "${p.name}" (quedan ${p.stock}). Ciérralo y usa "Ajustar stock" en su tarjeta.`);}
   else{setForm(f=>({...f,barcode:code}));notify("Código escaneado ✓");}
  }).catch(()=>notify("No se pudo verificar el código, inténtalo otra vez"));
 };

 const onScannedForInventory=code=>{
  setInvScan(false);
  apiFetch(API+"/products/barcode/"+encodeURIComponent(code)).then(async r=>{
   if(r.ok){setAdjustProduct(await r.json());}
   else{notify("Ese código no está registrado todavía. Regístralo como producto nuevo.");setForm(f=>({...emptyProduct,barcode:code}));setEditingId(null);setModal(true);}
  }).catch(()=>notify("No se pudo verificar el código"));
 };

 const removeProduct=p=>{
  if(!confirm(`¿Eliminar "${p.name}" del inventario?`))return;
  apiFetch(API+"/products/"+p.id,{method:"DELETE"}).then(()=>{reload();notify("Producto eliminado")});
 };

 return <>
 <div className="toolbar">
  <div className="search"><I.Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Busca por nombre, categoría o código..."/></div>
  <div className="toolbar-actions">
   <button className="btn scan" onClick={()=>setInvScan(true)}><I.ScanLine size={18}/>Escanear para inventario</button>
   <button className="btn primary" onClick={()=>{setForm(emptyProduct);setFormError("");setEditingId(null);setModal(true)}}><I.Plus/>Nuevo producto</button>
  </div>
 </div>
 <div className="product-grid">{list.map(p=><div className="prod" key={p.id}>
  {p.image?<img src={p.image}/>:<div className="prod-img">{p.category==="Bebidas"?"🥤":p.category==="Mecato"?"🍪":"📦"}</div>}
  <div className="prod-body">
   <small>{p.category}</small><b>{p.name}</b><strong>{money(p.price)}</strong>
   <span className={"lvl-"+stockLevel(p)}>{LEVEL_DOT[stockLevel(p)]} {p.stock} disponibles{stockLevel(p)!=="ok"?" · "+LEVEL_LABEL[stockLevel(p)]:""}</span>
   {p.expiration&&<span className={"lvl-"+expiryLevel(p)}>{LEVEL_DOT[expiryLevel(p)]} Vence {p.expiration}</span>}
   {p.barcode&&<small className="barcode-chip"><I.ScanLine size={11}/> {p.barcode}</small>}
   <div className="prod-actions">
    <button onClick={()=>editProduct(p)}><I.Pencil size={14}/>Editar</button>
    <button onClick={()=>setAdjustProduct(p)}><I.PackagePlus size={14}/>Ajustar stock</button>
    <button className="danger" onClick={()=>removeProduct(p)}><I.Trash2 size={14}/></button>
   </div>
  </div>
 </div>)}</div>
 {modal&&<Modal title={editingId?"Editar producto":"Nuevo producto"} close={()=>{setModal(false);setEditingId(null)}}>
  <form onSubmit={submit} className="form">
   <label>Foto del producto (opcional)<ImageUploadField value={form.image} onChange={v=>setForm({...form,image:v})} notify={notify}/></label>
   {[["name","Nombre del producto","text"],["category","Categoría","text"],["price","Precio de venta","money"],["cost","Precio de compra","money"],["stock","Cantidad inicial","text"],["min_stock","Avisar cuando queden","text"],["expiration","Fecha de vencimiento","date"]].map(([k,l,t])=><label key={k}>{l}{t==="money"?<MoneyField value={form[k]} onChange={v=>setForm({...form,[k]:v})}/>:k==="category"?<select value={form[k]} onChange={e=>setForm({...form,category:e.target.value})}><option value="">General</option><option>Bebidas</option><option>Lácteos</option><option>Mecato</option><option>Granos</option><option>Aseo</option><option>Panadería</option><option>Conservas</option><option>Otros</option></select>:<input type={t} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} required={k==="name"}/>}</label>)}
   <label>Código de barras (opcional)
    <div className="barcode-row">
     <input value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value})} placeholder="Escanea o escribe el código"/>
     <button type="button" className="btn scan" onClick={()=>setScanning(true)}><I.ScanLine size={17}/>Escanear</button>
    </div>
   </label>
   {formError&&<p className="form-error">⚠️ {formError}</p>}
   <button className="btn primary">{editingId?"Guardar cambios":"Guardar producto"}</button>
  </form>
 </Modal>}
 {scanning&&<Scanner title="Escanea el código del producto" close={()=>setScanning(false)} onDetected={onScannedForNewProduct}/>}
 {invScan&&<Scanner title="Escanea para actualizar inventario" hint="Escanea el producto que llegó o que vas a contar" close={()=>setInvScan(false)} onDetected={onScannedForInventory}/>}
 {adjustProduct&&<StockAdjustModal p={adjustProduct} close={()=>setAdjustProduct(null)} reload={reload} notify={notify}/>}
 </>
}

function StockAdjustModal({p,close,reload,notify}){
 const [qty,setQty]=useState(""),[mode,setMode]=useState("entrada");
 const submit=e=>{
  e.preventDefault();
  const n=+qty; if(!n||n<=0)return;
  const delta=mode==="entrada"?n:-n;
  apiFetch(API+`/products/${p.id}/stock`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({delta,note:mode==="entrada"?"Entrada por inventario (escaneo)":"Salida/ajuste por inventario (escaneo)"})})
   .then(r=>r.json()).then(x=>{
    if(x.error){notify(x.error);return}
    close();reload();notify(`Stock actualizado: ${p.name} ahora tiene ${x.stock} unidades`);
   }).catch(()=>notify("No se pudo actualizar el stock"));
 };
 return <Modal title={"Ajustar stock — "+p.name} close={close}>
  <div className="balance-box"><small>Stock actual</small><b>{p.stock} unidades</b></div>
  <div className="switch"><button className={mode==="entrada"?"on":""} onClick={()=>setMode("entrada")}>+ Entró mercancía</button><button className={mode==="salida"?"on":""} onClick={()=>setMode("salida")}>− Salió / se dañó</button></div>
  <form className="form" onSubmit={submit}><label>Cantidad<input type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)} required/></label><button className="btn primary">Guardar ajuste</button></form>
 </Modal>
}

function Credits({data,reload,notify}){
 const [custModal,setCustModal]=useState(null); // true = agregar cliente, objeto cliente = editarlo
 const [selected,setSelected]=useState(null),[fiado,setFiado]=useState(null);
 const wa=c=>{let phone=(c.phone||"").replace(/\D/g,"");if(!phone)return notify("Este cliente no tiene número registrado");let text=`Hola ${c.name} 👋. Te recordamos de parte de Fiado que tienes un saldo pendiente de ${money(c.balance)}. Cuando puedas, agradecemos realizar tu pago. ¡Muchas gracias!`;window.open(`https://wa.me/${phone.startsWith("57")?phone:"57"+phone}?text=${encodeURIComponent(text)}`,"_blank")};
 return <><div className="credit-head"><div><h2>Mis clientes</h2><p>Que ningún fiado se convierta en una pérdida.</p></div><button className="btn primary" onClick={()=>setCustModal(true)}><I.Plus/>Agregar cliente</button></div><div className="credit-summary"><div><small>Total pendiente</small><b>{money(data.totalCredit)}</b></div><div><small>Clientes con deuda</small><b>{data.customers.filter(c=>c.balance>0).length}</b></div><div><small>Clientes al día</small><b>{data.customers.filter(c=>!c.balance).length}</b></div></div><div className="customer-grid">{data.customers.map(c=><div className="customer" key={c.id}><div className="avatar big">{c.name[0]}</div><div className="customer-content"><b>{c.name}</b><small>📱 {c.phone||"Sin WhatsApp"}</small><strong className={c.balance?"debt":"clear"}>{c.balance?money(c.balance):"Cuenta al día ✓"}</strong><div className="customer-actions">{c.balance>0&&<button className="wa" onClick={()=>wa(c)}><I.MessageCircle/> Recordar por WhatsApp</button>}<button onClick={()=>setFiado(c)}><I.Banknote/> {c.balance?"Registrar abono":"Agregar fiado"}</button><button onClick={()=>setSelected(c)}><I.History/> Historial</button><button onClick={()=>setCustModal(c)}><I.Pencil/> Editar</button></div></div></div>)}</div>{custModal&&<CustomerModal c={custModal===true?null:custModal} close={()=>setCustModal(null)} reload={reload} notify={notify}/>} {fiado&&<DebtModal c={fiado} close={()=>setFiado(null)} reload={reload} notify={notify}/>} {selected&&<HistoryModal c={selected} close={()=>setSelected(null)}/>}</>
}
function CustomerModal({c,close,reload,notify,onSaved}){
 const [f,setF]=useState({name:c?.name||"",phone:c?.phone||""});
 const submit=e=>{
  e.preventDefault();
  const url=c?API+"/customers/"+c.id:API+"/customers", method=c?"PUT":"POST";
  apiFetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(f)}).then(r=>r.json()).then(x=>{
   if(x.error){notify(x.error);return}
   close();reload();notify(c?"Cliente actualizado correctamente":"Cliente agregado");
   if(onSaved)onSaved(x);
  }).catch(()=>notify("No se pudo guardar el cliente"));
 };
 return <Modal title={c?"Editar cliente":"Agregar cliente"} close={close}><form className="form" onSubmit={submit}><label>Nombre completo<input value={f.name} onChange={e=>setF({...f,name:e.target.value})} required autoFocus/></label><label>Número de WhatsApp<input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})} placeholder="3001234567"/></label><button className="btn primary">{c?"Guardar cambios":"Guardar cliente"}</button></form></Modal>;
}
function DebtModal({c,close,reload,notify}){
 const [type,setType]=useState(c.balance?"abono":"fiado"),[amount,setAmount]=useState("");
 const submit=e=>{
  e.preventDefault();
  if(!(+amount>0))return notify("Ingresa un valor válido");
  apiFetch(API+`/customers/${c.id}/debt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,amount})}).then(r=>r.json()).then(x=>{
   if(x.error){notify(x.error);return}
   close();reload();notify(type==="fiado"?"Fiado registrado":"Abono registrado");
  }).catch(()=>notify("No se pudo registrar el movimiento"));
 };
 return <Modal title={type==="fiado"?"Registrar fiado":"Registrar abono"} close={close}><div className="balance-box"><small>Saldo actual</small><b>{money(c.balance)}</b></div><div className="switch"><button className={type==="fiado"?"on":""} onClick={()=>setType("fiado")}>+ Fiado</button><button className={type==="abono"?"on":""} onClick={()=>setType("abono")}>− Abono</button></div><form className="form" onSubmit={submit}><label>Valor<MoneyField value={amount} onChange={setAmount} placeholder="0" required/></label><button className="btn primary">Guardar movimiento</button></form></Modal>;
}
function HistoryModal({c,close}){const [h,setH]=useState([]);useEffect(()=>{apiFetch(API+`/customers/${c.id}/history`).then(x=>x.json()).then(setH)},[]);return <Modal title={"Historial — "+c.name} close={close}><div className="history">{h.length?h.map(x=><div className="hist" key={x.id}><span>{x.type==="fiado"?"📒":"💵"}</span><div><b>{x.type==="fiado"?"Fiado":"Abono"}</b><small>{fmtDateTime(x.created_at)}</small></div><strong className={x.type==="fiado"?"debt":"clear"}>{x.type==="fiado"?"+":"−"}{money(x.amount)}</strong></div>):<Empty text="No hay movimientos todavía."/>}</div></Modal>}

function Sales({data,reload,notify}){
 const [cart,setCart]=useState([]),[pay,setPay]=useState("efectivo"),[customer,setCustomer]=useState(""),[q,setQ]=useState(""),[scanning,setScanning]=useState(false),[received,setReceived]=useState("");
 const [newCustomer,setNewCustomer]=useState(false),[receipt,setReceipt]=useState(null);
 // Datos del comprador para la factura (nombre y cédula opcional, por si compra un menor de edad)
 const [buyerName,setBuyerName]=useState(""),[buyerCedula,setBuyerCedula]=useState(""),[buyerPhone,setBuyerPhone]=useState("");
 const [settings,setSettings]=useState({}),[qrModal,setQrModal]=useState(false);
 useEffect(()=>{apiFetch(API+"/settings").then(x=>x.json()).then(setSettings).catch(()=>{})},[]);
 const add=p=>setCart(x=>{
  let o=x.find(i=>i.id===p.id);
  if(o){ if(o.quantity>=p.stock){notify("No hay más unidades disponibles de "+p.name); return x} return x.map(i=>i.id===p.id?{...i,quantity:i.quantity+1}:i) }
  return[...x,{...p,quantity:1}];
 });
 const scanToAdd=code=>{
  setScanning(false);
  apiFetch(API+"/products/barcode/"+encodeURIComponent(code)).then(async r=>{
   if(r.ok){const p=await r.json(); if(p.stock<=0){notify(p.name+" no tiene unidades disponibles");return} add(p); notify(p.name+" agregado a la venta");}
   else notify("Ese código de barras no está registrado");
  }).catch(()=>notify("No se pudo verificar el código"));
 };
 const total=cart.reduce((s,i)=>s+i.price*i.quantity,0);
 const receivedNum=+received||0, change=receivedNum-total;
 const list=data.products.filter(p=>p.stock>0&&(p.name+" "+p.category+" "+(p.barcode||"")).toLowerCase().includes(q.toLowerCase()));
 const pickCustomer=id=>{
  setCustomer(id);
  const c=data.customers.find(c=>String(c.id)===String(id));
  if(c?.name)setBuyerName(c.name); // autocompleta el nombre del comprador, pero se puede editar
  if(c?.phone)setBuyerPhone(c.phone); // autocompleta el teléfono para poder enviar la factura por WhatsApp
 };
 const finish=()=>{
  if(!cart.length)return;
  if(!buyerName.trim())return notify("Escribe el nombre del cliente para la factura");
  if(pay==="fiado"&&!customer)return notify("Selecciona o agrega el cliente que va a fiar");
  if(pay==="efectivo"&&receivedNum<total)return notify("El monto recibido es menor al total de la venta");
  if(pay==="transferencia"&&!settings.qrImage)return notify("Aún no has cargado el QR de tu cuenta bancaria. Tócalo para agregarlo.");
  apiFetch(API+"/sales",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:cart,payment:pay,customerId:customer,customerName:buyerName.trim(),customerCedula:buyerCedula.trim()})}).then(x=>x.json()).then(x=>{
   if(x.error){notify(x.error);return}
   setReceipt({items:cart,total,payment:pay,buyerName:buyerName.trim(),buyerCedula:buyerCedula.trim(),buyerPhone:buyerPhone.trim(),received:pay==="efectivo"?receivedNum:null,change:pay==="efectivo"?change:null,qrImage:pay==="transferencia"?settings.qrImage:null,bankInfo:pay==="transferencia"?settings.bankInfo:null,storeName:settings.storeName,storePhone:settings.storePhone,storeAddress:settings.storeAddress,storeNit:settings.storeNit,date:new Date().toLocaleString("es-CO",{timeZone:"America/Bogota",dateStyle:"long",timeStyle:"short"})});
   setCart([]);setPay("efectivo");setCustomer("");setReceived("");setBuyerName("");setBuyerCedula("");setBuyerPhone("");reload();
  });
 };
 return <div className="sale">
 <div>
  <div className="sale-tools"><div className="search"><I.Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Busca un producto..."/></div><button className="btn scan" onClick={()=>setScanning(true)}><I.ScanLine size={18}/>Escanear</button><button className="btn ghost" onClick={()=>window.dispatchEvent(new Event("open-sales-history"))}><I.History size={18}/>Historial</button></div>
  <div className="sale-grid">{list.map(p=><button className="sale-prod" onClick={()=>add(p)} key={p.id}><div className="prod-img">{p.category==="Bebidas"?"🥤":p.category==="Mecato"?"🍪":"📦"}</div><b>{p.name}</b><span>{money(p.price)}</span><small>{p.stock} disponibles</small></button>)}</div>
 </div>
 <aside className="ticket"><h2>Venta actual</h2>{cart.length?cart.map(i=><div className="cartrow" key={i.id}><span>{i.name}<small>x{i.quantity}</small></span><div className="cart-actions"><button type="button" onClick={()=>setCart(c=>c.map(x=>x.id===i.id?{...x,quantity:Math.max(1,x.quantity-1)}:x))}>−</button><b>{money(i.price*i.quantity)}</b><button type="button" onClick={()=>add(i)}>+</button><button type="button" onClick={()=>setCart(c=>c.filter(x=>x.id!==i.id))}>×</button></div></div>):<Empty text="Agrega productos"/>}<div className="ticket-bottom"><div className="total"><span>Total</span><b>{money(total)}</b></div>
 <div className="buyer-box"><small className="buyer-title">Datos del cliente (para la factura)</small>
  <input value={buyerName} onChange={e=>setBuyerName(e.target.value)} placeholder="Nombre del cliente"/>
  <input value={buyerCedula} onChange={e=>setBuyerCedula(e.target.value)} placeholder="Cédula (opcional, puede quedar en blanco)"/>
  <input value={buyerPhone} onChange={e=>setBuyerPhone(e.target.value)} placeholder="WhatsApp (opcional, para enviarle la factura)"/>
 </div>
 <div className="switch"><button className={pay==="efectivo"?"on":""} onClick={()=>{setPay("efectivo")}}>💵 Efectivo</button><button className={pay==="transferencia"?"on":""} onClick={()=>{setPay("transferencia");setReceived("")}}>📲 Transferencia</button><button className={pay==="fiado"?"on":""} onClick={()=>{setPay("fiado");setReceived("")}}>📒 Fiado</button></div>
 {pay==="fiado"&&<div className="fiado-row"><select value={customer} onChange={e=>pickCustomer(e.target.value)}><option value="">Selecciona cliente...</option>{data.customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><button type="button" className="btn ghost" onClick={()=>setNewCustomer(true)}><I.UserPlus size={16}/>Nuevo</button></div>}
 {pay==="efectivo"&&<div className="cash-box"><label>¿Con cuánto paga?<MoneyField value={received} onChange={setReceived} placeholder="0"/></label><div className={"change-row "+(received!==""&&change<0?"neg":"")}><span>{received!==""&&change<0?"Falta":"Vuelto a devolver"}</span><b>{money(Math.abs(change))}</b></div></div>}
 {pay==="transferencia"&&<div className="qr-box">
  {settings.qrImage?<><img src={settings.qrImage} className="qr-preview"/><p>El cliente escanea este código para pagar por transferencia.</p><button type="button" className="btn ghost" onClick={()=>setQrModal(true)}><I.QrCode size={15}/>Cambiar QR de mi cuenta</button></>
  :<button type="button" className="btn scan" onClick={()=>setQrModal(true)}><I.QrCode size={16}/>Agregar QR de mi cuenta bancaria</button>}
 </div>}
 <button className="btn primary big" disabled={!cart.length} onClick={finish}>Confirmar venta</button></div></aside>
 {scanning&&<Scanner title="Escanea el producto para venderlo" close={()=>setScanning(false)} onDetected={scanToAdd}/>}
 {newCustomer&&<CustomerModal close={()=>setNewCustomer(false)} reload={reload} notify={notify} onSaved={c=>pickCustomer(String(c.id))}/>}
 {qrModal&&<QrSettingsModal settings={settings} setSettings={setSettings} close={()=>setQrModal(false)} notify={notify}/>}
 {receipt&&<ReceiptModal sale={receipt} close={()=>setReceipt(null)}/>}
 <SalesHistoryModal/>
 </div>
}

function ReturnSaleButton({sale,onDone}){
 const [busy,setBusy]=useState(false);
 const run=async()=>{const items=sale.items.filter(i=>i.quantity-i.returned_quantity>0).map(i=>({itemId:i.id,quantity:i.quantity-i.returned_quantity}));if(!items.length)return;if(!confirm("¿Devolver todos los productos disponibles de esta venta? El inventario será reintegrado."))return;setBusy(true);try{const r=await apiFetch(API+`/sales/${sale.id}/return`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})});const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo procesar la devolución");onDone()}catch(e){alert(e.message)}finally{setBusy(false)}};
 return <button className="btn danger" disabled={busy} onClick={run}><I.RotateCcw size={15}/> {busy?"Procesando...":"Devolver venta"}</button>;
}

function SalesHistoryModal(){
 const [open,setOpen]=useState(false),[sales,setSales]=useState([]),[detail,setDetail]=useState(null),[loading,setLoading]=useState(false);
 useEffect(()=>{const fn=()=>setOpen(true);window.addEventListener("open-sales-history",fn);return()=>window.removeEventListener("open-sales-history",fn)},[]);
 useEffect(()=>{if(!open)return;setLoading(true);apiFetch(API+"/sales?limit=100").then(r=>r.json()).then(setSales).catch(()=>{}).finally(()=>setLoading(false))},[open]);
 if(!open)return null;
 return <Modal title="Historial de ventas" close={()=>{setOpen(false);setDetail(null)}}>{loading?<p>Cargando...</p>:<div className={"history sales-history"+(detail?" no-print":"")}>{sales.length?sales.map(s=><button className="hist sale-history-row" key={s.id} onClick={()=>apiFetch(API+`/sales/${s.id}`).then(r=>r.json()).then(setDetail)}><div><b>Venta #{s.id}</b><small>{fmtDateTime(s.created_at)} · {s.payment}</small></div><strong>{money(s.total)}</strong><span>{s.status==='returned'?'↩ Devuelta':'›'}</span></button>):<Empty text="Aún no hay ventas registradas"/>}</div>}{detail&&<div className="sale-detail"><h3>Venta #{detail.id}</h3>{detail.items.map(i=><div className="receipt-row" key={i.id}><span>{i.quantity} × {i.name}</span><span>{money(i.quantity*i.price)}</span></div>)}<div className="receipt-total"><span>Total</span><b>{money(detail.total)}</b></div><div className="no-print" style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn ghost" onClick={()=>window.print()}><I.Printer size={15}/> Imprimir</button>{detail.status==="completed"&&<ReturnSaleButton sale={detail} onDone={()=>{setDetail(null);apiFetch(API+"/sales?limit=100").then(r=>r.json()).then(setSales)}}/>}</div></div>}</Modal>
}

// ---------- Configuración del QR bancario del tendero, usado en las facturas por transferencia ----------
function QrSettingsModal({settings,setSettings,close,notify}){
 const [qrImage,setQrImage]=useState(settings.qrImage||"");
 const [bankInfo,setBankInfo]=useState(settings.bankInfo||"");
 const save=()=>{
  apiFetch(API+"/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({qrImage,bankInfo})})
   .then(x=>x.json()).then(x=>{setSettings(x);close();notify("QR de tu cuenta bancaria guardado");})
   .catch(()=>notify("No se pudo guardar el QR"));
 };
 return <Modal title="QR de tu cuenta bancaria" close={close}>
  <p className="qr-help">Sube una foto o captura del código QR de tu cuenta (Nequi, Bancolombia, Daviplata, etc). Se mostrará en la factura cuando el cliente pague por transferencia.</p>
  <div className="form">
   <label>Código QR<ImageUploadField value={qrImage} onChange={setQrImage} notify={notify}/></label>
   <label>Datos de la cuenta (opcional)<input value={bankInfo} onChange={e=>setBankInfo(e.target.value)} placeholder="Ej: Nequi 300 123 4567 - Juan Pérez"/></label>
   <button type="button" className="btn primary" onClick={save}>Guardar</button>
  </div>
 </Modal>
}

// Arma el link de WhatsApp con la factura en texto, agregando el indicativo de Colombia si hace falta
function whatsappUrl(phone,text){
 let digits=String(phone||"").replace(/\D/g,"");
 if(digits.length===10)digits="57"+digits; // número local colombiano de 10 dígitos
 return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
function buildReceiptText(sale){
 const payLabel=sale.payment==="efectivo"?"Efectivo":sale.payment==="transferencia"?"Transferencia":"Fiado";
 const lines=[
  `🧾 *${sale.storeName||"Fiado App"}*`,
  sale.date,
  "",
  `Cliente: ${sale.buyerName||"—"}`,
  "",
  ...sale.items.map(i=>`${i.quantity} x ${i.name} — ${money(i.price*i.quantity)}`),
  "",
  `*Total: ${money(sale.total)}*`,
  `Forma de pago: ${payLabel}`,
  "",
  "¡Gracias por su compra! 🙌",
 ];
 return lines.join("\n");
}
function ReceiptModal({sale,close}){
 const payLabel=sale.payment==="efectivo"?"Efectivo":sale.payment==="transferencia"?"Transferencia":"Fiado";
 const sendWhatsapp=()=>{
  let phone=sale.buyerPhone;
  if(!phone){phone=prompt("Escribe el número de WhatsApp del cliente (con indicativo si es de otro país):")||"";if(!phone.trim())return;}
  window.open(whatsappUrl(phone,buildReceiptText(sale)),"_blank");
 };
 return <div className="overlay"><div className="modal receipt-modal">
  <button className="close no-print" onClick={close}>×</button>
  <div className="receipt">
   <div className="receipt-head"><b>{sale.storeName||"Fiado App"}</b>{(sale.storeAddress||sale.storePhone)&&<small>{[sale.storeAddress,sale.storePhone].filter(Boolean).join(" · ")}</small>}{sale.storeNit&&<small>NIT/ID: {sale.storeNit}</small>}<small>Factura de venta</small><small>{sale.date}</small></div>
   <div className="receipt-row"><span>Cliente</span><span>{sale.buyerName||"—"}</span></div>
   {sale.buyerCedula&&<div className="receipt-row"><span>Cédula</span><span>{sale.buyerCedula}</span></div>}
   <div className="receipt-items">{sale.items.map(i=><div className="receipt-row" key={i.id}><span>{i.quantity} x {i.name}</span><span>{money(i.price*i.quantity)}</span></div>)}</div>
   <div className="receipt-total"><span>Total</span><b>{money(sale.total)}</b></div>
   <div className="receipt-row"><span>Forma de pago</span><span>{payLabel}</span></div>
   {sale.payment==="efectivo"&&<>
    <div className="receipt-row"><span>Recibido</span><span>{money(sale.received)}</span></div>
    <div className="receipt-row"><span>Vuelto</span><span>{money(sale.change)}</span></div>
   </>}
   {sale.payment==="transferencia"&&sale.qrImage&&<div className="receipt-qr">
    <img src={sale.qrImage}/>
    <small>Escanea para pagar por transferencia</small>
    {sale.bankInfo&&<small>{sale.bankInfo}</small>}
   </div>}
   <div className="receipt-foot">¡Gracias por su compra!</div>
  </div>
  <div className="no-print" style={{display:"flex",gap:8}}>
   <button className="btn primary big" onClick={()=>window.print()}><I.Printer size={16}/>Imprimir recibo</button>
   <button className="btn big wa-btn" onClick={sendWhatsapp}><I.MessageCircle size={16}/>Enviar por WhatsApp</button>
  </div>
 </div></div>
}
// ---------- Calendario: vencimientos de productos + recordatorios de cobro/pago por fecha ----------
const isoDate=d=>d.toLocaleDateString("en-CA");
const WEEKDAYS=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
function CalendarView({data,go}){
 const [month,setMonth]=useState(()=>{const d=new Date();d.setDate(1);return d});
 const [reminders,setReminders]=useState([]);
 const [selected,setSelected]=useState(isoDate(new Date()));
 const [form,setForm]=useState({title:"",note:""});
 const load=()=>apiFetch(API+"/reminders").then(r=>r.json()).then(setReminders).catch(()=>{});
 useEffect(()=>{load()},[]);
 const eventsByDay={};
 const push=(day,ev)=>{(eventsByDay[day]=eventsByDay[day]||[]).push(ev)};
 data.products.filter(p=>p.expiration).forEach(p=>push(p.expiration,{type:"vence",color:"#f0883e",label:p.name,sub:"Vence hoy · Inventario"}));
 reminders.forEach(r=>push(r.date,{type:"recordatorio",id:r.id,color:r.done?"#94a3b8":"#f59e0b",label:r.title,sub:r.note,done:r.done}));
 const first=new Date(month), startOffset=(first.getDay()+6)%7; // lunes=0
 const gridStart=new Date(first); gridStart.setDate(first.getDate()-startOffset);
 const cells=Array.from({length:42},(_,i)=>{const d=new Date(gridStart); d.setDate(gridStart.getDate()+i); return d});
 const monthLabel=first.toLocaleDateString("es-CO",{month:"long",year:"numeric"});
 const addReminder=e=>{e.preventDefault();if(!form.title.trim())return;apiFetch(API+"/reminders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date:selected,title:form.title.trim(),note:form.note.trim()})}).then(r=>r.json()).then(()=>{setForm({title:"",note:""});load()})};
 const toggleDone=r=>apiFetch(API+"/reminders/"+r.id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({done:!r.done})}).then(load);
 const removeReminder=id=>apiFetch(API+"/reminders/"+id,{method:"DELETE"}).then(load);
 const dayEvents=(eventsByDay[selected]||[]).sort((a,b)=>a.type.localeCompare(b.type));
 const upcoming=Object.entries(eventsByDay).filter(([d])=>d>=isoDate(new Date())).sort(([a],[b])=>a.localeCompare(b)).slice(0,8);
 return <div className="calendar-page">
  <section className="panel cal-panel">
   <div className="cal-head"><button className="icon-btn" onClick={()=>setMonth(m=>{const d=new Date(m);d.setMonth(d.getMonth()-1);return d})}><I.ChevronLeft size={18}/></button><b style={{textTransform:"capitalize"}}>{monthLabel}</b><button className="icon-btn" onClick={()=>setMonth(m=>{const d=new Date(m);d.setMonth(d.getMonth()+1);return d})}><I.ChevronRight size={18}/></button></div>
   <div className="cal-weekdays">{WEEKDAYS.map(w=><span key={w}>{w}</span>)}</div>
   <div className="cal-grid">{cells.map(d=>{const key=isoDate(d);const inMonth=d.getMonth()===first.getMonth();const evs=eventsByDay[key]||[];const isToday=key===isoDate(new Date());return <button key={key} className={"cal-cell"+(inMonth?"":" out")+(key===selected?" sel":"")+(isToday?" today":"")} onClick={()=>setSelected(key)}><span>{d.getDate()}</span><div className="cal-dots">{evs.slice(0,3).map((e,i)=><i key={i} style={{background:e.color}}/>)}</div></button>})}</div>
  </section>
  <div className="cal-side">
   <section className="panel">
    <div className="panel-title"><h3>📅 {new Date(selected+"T00:00:00").toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})}</h3></div>
    {dayEvents.length?dayEvents.map((e,i)=><div className="cal-event" key={i}><span className="cal-dot" style={{background:e.color}}/><div><b style={{textDecoration:e.done?"line-through":"none"}}>{e.label}</b>{e.sub&&<small>{e.sub}</small>}</div>{e.type==="recordatorio"&&<div className="cal-event-actions"><button className="icon-btn" onClick={()=>toggleDone(e)} title={e.done?"Marcar pendiente":"Marcar hecho"}><I.Check size={14}/></button><button className="icon-btn" onClick={()=>removeReminder(e.id)} title="Eliminar"><I.Trash2 size={14}/></button></div>}</div>):<Empty text="Nada programado este día"/>}
    <form className="form cal-form" onSubmit={addReminder}><label>Agregar recordatorio<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Ej. Cobrar a Carlos"/></label><input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Nota (opcional)"/><button className="btn primary"><I.Plus size={15}/>Agregar</button></form>
   </section>
   <section className="panel">
    <div className="panel-title"><h3>🔔 Próximos avisos</h3></div>
    {upcoming.length?upcoming.map(([d,evs])=><button className="cal-upcoming-row" key={d} onClick={()=>setSelected(d)}><b>{new Date(d+"T00:00:00").toLocaleDateString("es-CO",{day:"numeric",month:"short"})}</b><span>{evs.map(e=>e.label).join(" · ")}</span></button>):<Empty text="No hay nada próximo"/>}
   </section>
  </div>
 </div>
}

function CashBox({data,reload,notify}){
 const [expenses,setExpenses]=useState([]),[form,setForm]=useState({description:"",amount:"",category:"General"});
 const load=()=>apiFetch(API+"/expenses").then(r=>r.json()).then(setExpenses).catch(()=>{});
 useEffect(()=>{load()},[]);
 const save=e=>{e.preventDefault();apiFetch(API+"/expenses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)}).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo guardar");setForm({description:"",amount:"",category:"General"});notify("Gasto registrado");load();reload()}).catch(e=>notify(e.message))};
 const del=id=>{if(!confirm("¿Eliminar este gasto?"))return;apiFetch(API+"/expenses/"+id,{method:"DELETE"}).then(()=>{load();reload();notify("Gasto eliminado")})};
 return <div className="cash-page"><div className="stats"><Stat title="Ventas de hoy" value={money(data.salesToday)} icon={I.TrendingUp}/><Stat title="Gastos de hoy" value={money(data.expensesToday)} icon={I.ReceiptText} danger/><Stat title="Caja neta estimada" value={money(data.cashToday)} icon={I.WalletCards}/></div>
 <div className="two"><section className="panel"><div className="panel-title"><h3>➕ Registrar gasto</h3><span>Controla salidas de dinero</span></div><form className="form" onSubmit={save}><label>Descripción<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Ej. compra de bolsas" required/></label><label>Valor<MoneyField value={form.amount} onChange={v=>setForm({...form,amount:v})} placeholder="Ej. 15000" required/></label><label>Categoría<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>General</option><option>Mercancía</option><option>Servicios</option><option>Transporte</option><option>Arriendo</option><option>Otros</option></select></label><button className="btn primary"><I.Plus size={16}/>Guardar gasto</button></form></section>
 <section className="panel"><div className="panel-title"><h3>💸 Últimos gastos</h3><span>{expenses.length} registros</span></div>{expenses.length?expenses.slice(0,12).map(x=><div className="expense-row" key={x.id}><div><b>{x.description}</b><small>{x.category} · {fmtDateTime(x.created_at)}</small></div><strong>{money(x.amount)}</strong><button className="icon-btn" onClick={()=>del(x.id)} title="Eliminar"><I.Trash2 size={15}/></button></div>):<Empty text="No hay gastos registrados"/>}</section></div></div>
}

function Settings({reload,notify}){
 const [f,setF]=useState({storeName:"",storePhone:"",storeAddress:"",storeNit:"",bankInfo:"",qrImage:""}),[saved,setSaved]=useState(false),[toast,setToast]=useState("");
 const [restoring,setRestoring]=useState(false);
 useEffect(()=>{apiFetch(API+"/settings").then(r=>r.json()).then(x=>setF(v=>({...v,...x})))},[]);
 const save=()=>apiFetch(API+"/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(f)}).then(r=>r.json()).then(x=>{setF(x);setSaved(true);setTimeout(()=>setSaved(false),2200)}).catch(()=>setToast("No se pudo guardar"));
 const backup=()=>{window.location.href=API+"/export"};
 const exportCsv=name=>{window.location.href=API+"/export/"+name+".csv"};
 const pickRestore=e=>{
  const file=e.target.files?.[0]; e.target.value="";
  if(!file)return;
  if(!confirm("⚠️ Esto va a BORRAR y REEMPLAZAR todos los productos, clientes, ventas y fiados actuales con los del archivo de respaldo. Esta acción no se puede deshacer.\n\n¿Seguro que quieres continuar?"))return;
  setRestoring(true);
  const reader=new FileReader();
  reader.onload=()=>{
   let parsed; try{ parsed=JSON.parse(reader.result); }catch{ setRestoring(false); notify?.("El archivo no es un respaldo válido (.json)"); return; }
   apiFetch(API+"/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(parsed)})
    .then(async r=>{const x=await r.json(); if(!r.ok)throw Error(x.error||"No se pudo restaurar"); notify?.("Copia de seguridad restaurada correctamente"); reload?.(); })
    .catch(e=>notify?.(e.message))
    .finally(()=>setRestoring(false));
  };
  reader.onerror=()=>{setRestoring(false);notify?.("No se pudo leer el archivo");};
  reader.readAsText(file);
 };
 return <div className="settings-page"><section className="panel"><div className="panel-title"><h3>🏪 Datos de la tienda</h3><span>Se usan en recibos y facturas</span></div><div className="form"><label>Nombre de la tienda<input value={f.storeName||""} onChange={e=>setF({...f,storeName:e.target.value})} placeholder="Ej. Mini Market El Éxito"/></label><label>Teléfono<input value={f.storePhone||""} onChange={e=>setF({...f,storePhone:e.target.value})}/></label><label>Dirección<input value={f.storeAddress||""} onChange={e=>setF({...f,storeAddress:e.target.value})}/></label><label>NIT / identificación (opcional)<input value={f.storeNit||""} onChange={e=>setF({...f,storeNit:e.target.value})}/></label><label>Datos de transferencia<input value={f.bankInfo||""} onChange={e=>setF({...f,bankInfo:e.target.value})} placeholder="Nequi, Bancolombia, Daviplata..."/></label><button className="btn primary" type="button" onClick={save}><I.Save size={16}/>Guardar configuración</button>{saved&&<p className="form-success">✓ Configuración guardada</p>}{toast&&<p className="form-error">{toast}</p>}</div></section>
 <section className="panel"><div className="panel-title"><h3>📊 Exportar a Excel</h3><span>Se abren directo en Excel</span></div><p>Descarga tus datos en formato CSV, compatible con Excel y Google Sheets.</p><div className="export-row"><button className="btn ghost" onClick={()=>exportCsv("inventario")}><I.Download size={16}/>Inventario</button><button className="btn ghost" onClick={()=>exportCsv("fiados")}><I.Download size={16}/>Fiados</button><button className="btn ghost" onClick={()=>exportCsv("ventas")}><I.Download size={16}/>Ventas</button></div></section>
 <section className="panel"><div className="panel-title"><h3>💾 Copias de seguridad</h3></div><p>Descarga todos los productos, clientes, ventas, fiados, movimientos y configuración en un archivo JSON.</p><button className="btn ghost" onClick={backup}><I.Download size={16}/>Descargar respaldo completo</button>
 <div className="restore-box"><small className="buyer-title">Restaurar una copia de seguridad</small><p className="qr-help">Selecciona un archivo .json descargado antes. Esto reemplaza TODA la información actual, así que descarga un respaldo reciente primero por si acaso.</p><label className="btn danger restore-btn">{restoring?"Restaurando...":<><I.Upload size={16}/>Restaurar desde archivo</>}<input type="file" accept="application/json" hidden disabled={restoring} onChange={pickRestore}/></label></div>
 </section></div>
}

function Reports(){
 const [range,setRange]=useState("semana");
 const [d,setD]=useState({top:[],sales:[],totalSales:0,totalProfit:0,totalExpenses:0,granularity:"day"});
 const RANGES={hoy:{days:1,label:"hoy"},semana:{days:7,label:"los últimos 7 días"},mes:{days:30,label:"los últimos 30 días"},año:{days:365,label:"el último año"}};
 useEffect(()=>{apiFetch(API+"/reports?days="+RANGES[range].days).then(x=>x.json()).then(setD)},[range]);
 const maxTop=Math.max(...d.top.map(x=>x.total),1), totalPeriod=d.sales.reduce((s,x)=>s+x.total,0);
 return <div className="reports-page">
  <div className="switch range-switch">{Object.keys(RANGES).map(k=><button key={k} className={range===k?"on":""} onClick={()=>setRange(k)} style={{textTransform:"capitalize"}}>{k}</button>)}</div>
  <div className="reports">
  <div className="stats"><Stat title={`Ventas ${RANGES[range].label}`} value={money(d.totalSales)} icon={I.TrendingUp}/><Stat title="Ganancia bruta" value={money(d.totalProfit)} icon={I.BadgeDollarSign}/><Stat title="Gastos del periodo" value={money(d.totalExpenses||0)} icon={I.ReceiptText} danger/></div>
  <section className="panel"><div className="panel-title"><h3>🔥 Lo más vendido</h3><span>{RANGES[range].label}</span></div>{d.top.length?d.top.map((x,i)=><div className="rank" key={x.name}><span>{i+1}</span><div><b>{x.name}</b><small>{x.quantity} unidades · Ganancia {money(x.profit)}</small><div className="rank-bar"><div style={{width:(x.total/maxTop*100)+"%"}}/></div></div><strong>{money(x.total)}</strong></div>):<Empty text="Aún no hay ventas registradas en este periodo"/>}</section>
  <section className="panel"><div className="panel-title"><h3>📈 Ventas {RANGES[range].label}</h3><span>{money(totalPeriod)} en total</span></div><SalesTrendChart sales={d.sales} granularity={d.granularity}/></section>
  </div>
 </div>
}

// ---------- Gráfica elegante de ventas por día (SVG, sin librerías externas) ----------
const weekdayLabel=(iso,granularity)=>{
 if(granularity==="month"){const m=new Date(iso+"T00:00:00").toLocaleDateString("es-CO",{month:"short"}).replace(".","");return m.charAt(0).toUpperCase()+m.slice(1)}
 const w=new Date(iso+"T00:00:00").toLocaleDateString("es-CO",{weekday:"short"}).replace(".","");return w.charAt(0).toUpperCase()+w.slice(1)};
// Convierte los puntos en una curva suave (Catmull-Rom → Bézier) en vez de líneas rectas
function smoothPath(pts){
 if(pts.length<2) return "";
 if(pts.length===2) return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;
 let d=`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} `;
 for(let i=0;i<pts.length-1;i++){
  const p0=pts[i===0?i:i-1],p1=pts[i],p2=pts[i+1],p3=pts[i+2===pts.length?i+1:i+2];
  const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
  const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
  d+=`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} `;
 }
 return d.trim();
}
function SalesTrendChart({sales,granularity="day"}){
 if(!sales.length) return <Empty text="Aún no hay ventas en este periodo"/>;
 const w=560,h=210,padL=10,padR=10,padT=34,padB=28;
 const max=Math.max(...sales.map(d=>d.total),1);
 const innerW=w-padL-padR, innerH=h-padT-padB;
 const stepX=sales.length>1?innerW/(sales.length-1):0;
 const yFor=v=>padT+innerH-(v/max)*innerH;
 const pts=sales.map((d,i)=>[padL+i*stepX, yFor(d.total)]);
 const line=smoothPath(pts);
 const area=pts.length===1
  ? `M${pts[0][0]},${h-padB} L${pts[0][0]},${pts[0][1]} L${pts[0][0]},${h-padB} Z`
  : line+` L${pts[pts.length-1][0].toFixed(1)},${h-padB} L${pts[0][0].toFixed(1)},${h-padB} Z`;
 const maxIdx=sales.reduce((best,x,i)=>x.total>sales[best].total?i:best,0);
 const hasSales=max>0&&sales.some(x=>x.total>0);
 const labelEvery=Math.max(1,Math.ceil(sales.length/12)); // evita que se amontonen las etiquetas cuando hay muchos puntos (ej. un año)
 return <svg viewBox={`0 0 ${w} ${h}`} className="trend-chart" preserveAspectRatio="none">
  <defs><linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1aab57" stopOpacity="0.32"/><stop offset="100%" stopColor="#1aab57" stopOpacity="0"/></linearGradient></defs>
  {[0,1,2,3].map(i=><line key={i} x1={padL} x2={w-padR} y1={padT+i*innerH/3} y2={padT+i*innerH/3} className="grid-line"/>)}
  <path d={area} fill="url(#fillGrad)"/>
  {pts.length>1&&<path d={line} fill="none" stroke="#139b4e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
  {pts.map((p,i)=><g key={i}>
   {i===maxIdx&&hasSales&&<text x={p[0]} y={p[1]-13} textAnchor="middle" className="chart-peak">{money(sales[i].total)}</text>}
   <circle cx={p[0]} cy={p[1]} r={i===maxIdx&&hasSales?5.5:sales[i].total>0?4.2:3} fill={sales[i].total>0?"#139b4e":"#c7d1d6"} stroke="#fff" strokeWidth="2"/>
   <title>{weekdayLabel(sales[i].day,granularity)} {sales[i].day.slice(8)}: {money(sales[i].total)}</title>
  </g>)}
  {sales.map((d,i)=>(i%labelEvery===0||i===sales.length-1)&&<text key={i} x={padL+i*stepX} y={h-8} textAnchor="middle" className="chart-label">{weekdayLabel(d.day,granularity)}</text>)}
 </svg>
}

function App(){
 const [session,setSession]=useState(null),[checking,setChecking]=useState(true);
 const logout=()=>{const token=localStorage.getItem("fiao_token");if(token)fetch(API+"/auth/logout",{method:"POST",headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});localStorage.removeItem("fiao_token");setSession(null)};
 useEffect(()=>{const handler=()=>{localStorage.removeItem("fiao_token");setSession(null)};window.addEventListener("fiao-logout",handler);const token=localStorage.getItem("fiao_token");if(!token){setChecking(false);return()=>window.removeEventListener("fiao-logout",handler)};fetch(API+"/auth/me",{headers:{Authorization:`Bearer ${token}`}}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(setSession).catch(()=>{localStorage.removeItem("fiao_token");setSession(null)}).finally(()=>setChecking(false));return()=>window.removeEventListener("fiao-logout",handler)},[]);
 if(checking)return <div className="auth-page"><div className="auth-loading">Cargando Fiado App…</div></div>;
 if(!session)return <Login onLogin={setSession}/>;
 return <MainApp session={session} onLogout={logout} onSession={setSession}/>;
}

function Modal({title,close,children}){return <div className="overlay"><div className="modal"><button className="close no-print" onClick={close}>×</button><h2>{title}</h2>{children}</div></div>}
createRoot(document.getElementById("root")).render(<App/>);
