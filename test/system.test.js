import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('persistent owner workspace, cross-site attendance and stock accounting',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'siteledger-test-'));const port=3219;
 const start=()=>spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let child=start();let cookie='';
 async function ready(){await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Server stopped')));});}
 async function call(path,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};}
 async function add(kind,b){const r=await call(kind,'POST',b);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
 try{await ready();assert.equal((await call('data')).status,401);assert.equal((await call('auth')).body.setup,true);assert.equal((await call('auth','POST',{password:'a-secure-test-password'})).status,200);
 const a=await add('sites',{name:'Colombo residence',client:'Client A',location:'Colombo',budget:100000,status:'Active'});const b=await add('sites',{name:'Kandy office',client:'Client B',location:'Kandy',budget:200000,status:'Planning'});
 const e=await add('employees',{name:'Kamal',payType:'Daily',rate:3500,overtimeRate:500});
 await add('attendance',{siteId:a.id,date:'2026-10-14',employeeId:e.id,days:.5,overtime:2});await add('attendance',{siteId:b.id,date:'2026-10-14',employeeId:e.id,days:.5,overtime:1});assert.equal((await call('attendance','POST',{siteId:a.id,date:'2026-10-14',employeeId:e.id,days:.1,overtime:0})).status,400);
 const m=await add('materials',{name:'Cement',unit:'bags',minimum:10});await add('stock',{siteId:a.id,date:'2026-10-14',materialId:m.id,movement:'Opening',quantity:50,cost:50000});await add('stock',{siteId:a.id,date:'2026-10-14',materialId:m.id,movement:'Transfer',quantity:20,cost:0,toSiteId:b.id});await add('stock',{siteId:b.id,date:'2026-10-14',materialId:m.id,movement:'Used',quantity:5,cost:0});assert.equal((await call('stock','POST',{siteId:a.id,date:'2026-10-14',materialId:m.id,movement:'Used',quantity:31,cost:0})).status,400);
 await add('diaries',{siteId:a.id,date:'2026-10-14',work:'Foundation concrete completed',notes:'Inspection passed'});
 const hire=await add('hires',{siteId:a.id,date:'2026-10-14',vehicle:'Excavator',supplier:'Local hire',units:8,rate:4000,paid:10000});assert.equal((await call('hires/'+hire.id,'PUT',{...hire,paid:32000})).status,200);
 await add('transactions',{siteId:a.id,date:'2026-10-14',type:'Salary advance',description:'Weekly advance',employeeId:e.id,amount:1000});await add('documents',{siteId:a.id,name:'Receipt',category:'Receipt',mime:'text/plain',data:Buffer.from('receipt contents').toString('base64'),filename:'receipt.txt'});
 let all=(await call('data')).body;assert.equal(all.attendance.reduce((s,r)=>s+r.days*r.rate+r.overtime*r.overtimeRate,0),5000);assert.equal(all.stock.filter(r=>r.siteId===a.id).reduce((s,r)=>s+(r.movement==='Opening'?r.quantity:-r.quantity),0),30);assert.equal(all.hires[0].paid,32000);
 assert.equal((await call('teams','PUT',{siteId:a.id,employeeIds:[e.id]})).status,200);
 const bulk=await call('attendance/bulk','POST',{siteId:a.id,date:'2026-10-15',rows:[{employeeId:e.id,days:1,overtime:2}]});assert.equal(bulk.status,200);const entry=bulk.body.rows[0];
 assert.equal((await call('attendance/'+entry.id,'PUT',{...entry,days:.5,reason:'Half-day correction'})).status,200);
 assert.equal((await call('attendance/invalid','POST',{siteId:a.id})).status,405);
 await new Promise(r=>{child.once('exit',r);child.kill();});child=start();await ready();cookie='';assert.equal((await call('auth')).body.setup,false);await call('auth','POST',{password:'a-secure-test-password'});all=(await call('data')).body;assert.equal(all.sites.length,2);assert.equal(all.documents.length,1);assert.equal(all.teams[0].employeeIds[0],e.id);assert.equal(all.attendanceHistory.length,1);assert.equal(all.attendance.find(r=>r.id===entry.id).days,.5);
 }finally{child.kill();rmSync(dir,{recursive:true,force:true});}
});
