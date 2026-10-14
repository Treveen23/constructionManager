import {initAttendance,attendanceExtras,saveTeam,saveAttendance} from './attendance.js';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
const dir=process.env.DATA_DIR||'data'; mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(join(dir,'siteledger.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);`);
initAttendance(db);
const sessions=new Map();
const attempts=new Map();
const kinds=['sites','diaries','employees','attendance','materials','stock','hires','transactions','documents'];
const money=n=>Number.isFinite(Number(n))&&Number(n)>=0;
function validate(kind,b){
 if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Invalid record');
 const need=fields=>fields.forEach(k=>{if(b[k]===undefined||b[k]===null||String(b[k]).trim()==='')throw Error(`${k} is required`);});
 const numeric=fields=>fields.forEach(k=>{if(!money(b[k]))throw Error(`${k} must be a non-negative number`); b[k]=Number(b[k]);});
 if(kind==='sites'){need(['name','client','location','status']);numeric(['budget']);if(!['Active','Planning','Completed'].includes(b.status))throw Error('Invalid status');}
 if(kind==='employees'){need(['name','payType']);numeric(['rate','overtimeRate']);if(!['Daily','Monthly'].includes(b.payType))throw Error('Invalid pay type');}
 if(kind==='materials'){need(['name','unit']);numeric(['minimum']);}
 if(['diaries','attendance','stock','hires','transactions','documents'].includes(kind)){need(['siteId']);if(!db.prepare('SELECT id FROM records WHERE id=? AND kind=?').get(Number(b.siteId),'sites'))throw Error('Site does not exist');b.siteId=Number(b.siteId);}
 if(['diaries','attendance','stock','hires','transactions'].includes(kind)){need(['date']);if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||Number.isNaN(Date.parse(b.date)))throw Error('Invalid date');}
 if(kind==='diaries')need(['work']);

 if(kind==='stock'){need(['materialId','movement']);numeric(['quantity','cost']);if(b.quantity<=0)throw Error('Quantity must be greater than zero');if(!['Opening','Received','Used','Waste','Transfer'].includes(b.movement))throw Error('Invalid movement');b.materialId=Number(b.materialId);if(!db.prepare('SELECT id FROM records WHERE id=? AND kind=?').get(b.materialId,'materials'))throw Error('Material does not exist');if(['Used','Waste','Transfer'].includes(b.movement)){const rows=db.prepare("SELECT body FROM records WHERE kind='stock'").all().map(r=>JSON.parse(r.body));const balance=rows.reduce((sum,r)=>sum+(r.siteId===b.siteId&&r.materialId===b.materialId?(['Opening','Received'].includes(r.movement)?r.quantity:-r.quantity):0)+(r.toSiteId===b.siteId&&r.materialId===b.materialId?r.quantity:0),0);if(b.quantity>balance)throw Error('Insufficient site stock');}if(b.movement==='Transfer'){b.toSiteId=Number(b.toSiteId);if(b.toSiteId===b.siteId||!db.prepare('SELECT id FROM records WHERE id=? AND kind=?').get(b.toSiteId,'sites'))throw Error('Choose a different destination site');}else delete b.toSiteId;}
 if(kind==='hires'){need(['vehicle','supplier']);numeric(['units','rate','paid']);if(b.paid>b.units*b.rate)throw Error('Paid exceeds hire total');}
 if(kind==='transactions'){need(['type','description']);numeric(['amount']);if(!['Expense','Client payment','Salary advance','Salary payment'].includes(b.type))throw Error('Invalid transaction type');if(b.type.startsWith('Salary')){b.employeeId=Number(b.employeeId);if(!db.prepare('SELECT id FROM records WHERE id=? AND kind=?').get(b.employeeId,'employees'))throw Error('Choose an employee');}}
 if(kind==='documents'){need(['name','category','data','mime']);if(!['application/pdf','image/jpeg','image/png','image/webp','text/plain'].includes(b.mime))throw Error('Supported files: PDF, JPG, PNG, WebP, TXT');if(typeof b.data!=='string'||b.data.length>7_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data))throw Error('Invalid or oversized file');}
 return b;
}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>8_000_000)throw Error('Request too large');}return JSON.parse(s||'{}');}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 if(['POST','PUT','DELETE'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return send(res,403,{error:'Invalid origin'});
 const owner=db.prepare('SELECT * FROM owner WHERE id=1').get();
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
 const authenticated=token&&sessions.get(token)>Date.now();
 if(url.pathname==='/api/auth'&&req.method==='GET')return send(res,200,{setup:!owner,authenticated:!!authenticated});
 if(url.pathname==='/api/auth'&&req.method==='POST'){const address=req.socket.remoteAddress; const attempt=attempts.get(address);if(attempt&&attempt.count>=10&&attempt.until>Date.now())return send(res,429,{error:'Too many attempts. Try again in 15 minutes.'});const b=await body(req);if(typeof b.password!=='string'||b.password.length<10||b.password.length>200)return send(res,400,{error:'Use a password of 10–200 characters'});if(!owner){const salt=randomBytes(16).toString('hex');db.prepare('INSERT INTO owner VALUES(1,?,?)').run(salt,scryptSync(b.password,salt,64).toString('hex'));}else if(!timingSafeEqual(scryptSync(b.password,owner.salt,64),Buffer.from(owner.hash,'hex'))){attempts.set(address,{count:attempt&&attempt.until>Date.now()?attempt.count+1:1,until:Date.now()+900_000});return send(res,401,{error:'Incorrect password'});}attempts.delete(address);const t=randomBytes(32).toString('hex');sessions.set(t,Date.now()+12*3600_000);res.setHeader('Set-Cookie',`session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return send(res,200,{ok:true});}
 if(url.pathname==='/api/logout'){sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
 if(url.pathname.startsWith('/api/')){
 if(!authenticated)return send(res,401,{error:'Please sign in'});
 if(url.pathname==='/api/data'&&req.method==='GET'){const result=Object.fromEntries(kinds.map(k=>[k,[]]));for(const r of db.prepare('SELECT * FROM records ORDER BY id DESC').all())result[r.kind].push({...JSON.parse(r.body),id:r.id});return send(res,200,{...result,...attendanceExtras(db)});}
 if(url.pathname==='/api/teams'&&req.method==='PUT')return send(res,200,saveTeam(db,await body(req)));
 if(url.pathname==='/api/attendance/bulk'&&req.method==='POST')return send(res,200,saveAttendance(db,await body(req)));
 if(url.pathname==='/api/attendance'&&req.method==='POST'){const b=await body(req);const result=saveAttendance(db,{siteId:b.siteId,date:b.date,rows:[b]});return send(res,201,result.rows[0]);}
 if(/^\/api\/attendance\/\d+$/.test(url.pathname)&&req.method==='PUT'){const b=await body(req);const result=saveAttendance(db,{siteId:b.siteId,date:b.date,reason:b.reason,rows:[{...b,id:Number(url.pathname.split('/')[3])}]});return send(res,200,result);}
 if(url.pathname.startsWith('/api/attendance'))return send(res,405,{error:'Method not allowed'});
 const kind=url.pathname.split('/')[2];if(!kinds.includes(kind))return send(res,404,{error:'Not found'});
 if(req.method==='PUT'){if(!['sites','employees','diaries','hires','transactions'].includes(kind))return send(res,405,{error:'This register is append-only'});const id=Number(url.pathname.split('/')[3]);if(!db.prepare('SELECT id FROM records WHERE id=? AND kind=?').get(id,kind))return send(res,404,{error:'Record not found'});const b=validate(kind,await body(req));db.prepare('UPDATE records SET body=? WHERE id=? AND kind=?').run(JSON.stringify(b),id,kind);return send(res,200,{...b,id});}
 if(req.method==='POST'){const b=validate(kind,await body(req));const r=db.prepare('INSERT INTO records(kind,body) VALUES(?,?)').run(kind,JSON.stringify(b));return send(res,201,{...b,id:Number(r.lastInsertRowid)});}
 return send(res,405,{error:'Method not allowed'});
 }
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 const paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=paths[url.pathname];if(!file||!existsSync(join('public',file)))return send(res,404,{error:'Not found'});res.setHeader('Content-Type',{'html':'text/html','js':'text/javascript','css':'text/css'}[extname(file).slice(1)]);res.end(readFileSync(join('public',file)));
 }catch(e){send(res,400,{error:e.message});}});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`SiteLedger listening on port ${process.env.PORT||3000}`));
