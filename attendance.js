export function initAttendance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS site_teams(site_id INTEGER PRIMARY KEY, employee_ids TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attendance_history(id INTEGER PRIMARY KEY, attendance_id INTEGER NOT NULL, body TEXT NOT NULL);`);
}
const records = (db,kind) => db.prepare('SELECT id,body FROM records WHERE kind=?').all(kind).map(r=>({...JSON.parse(r.body),id:r.id}));
const exists = (db,kind,id) => db.prepare('SELECT id,body FROM records WHERE kind=? AND id=?').get(kind,id);
export function attendanceExtras(db) {
  return {teams:db.prepare('SELECT * FROM site_teams').all().map(r=>({siteId:r.site_id,employeeIds:JSON.parse(r.employee_ids)})),attendanceHistory:db.prepare('SELECT * FROM attendance_history ORDER BY id DESC').all().map(r=>({...JSON.parse(r.body),id:r.id,attendanceId:r.attendance_id}))};
}
export function saveTeam(db,body) {
  const siteId=Number(body.siteId);
  if(!exists(db,'sites',siteId))throw Error('Site does not exist');
  if(!Array.isArray(body.employeeIds))throw Error('Choose the site team');
  const employeeIds=[...new Set(body.employeeIds.map(Number))];
  if(employeeIds.some(id=>!exists(db,'employees',id)))throw Error('Employee does not exist');
  db.prepare('INSERT INTO site_teams VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET employee_ids=excluded.employee_ids').run(siteId,JSON.stringify(employeeIds));
  return {siteId,employeeIds};
}
export function saveAttendance(db,payload) {
  const siteId=Number(payload.siteId),date=payload.date;
  if(!exists(db,'sites',siteId))throw Error('Site does not exist');
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date)throw Error('Invalid date');
  if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>1000)throw Error('Choose 1–1000 attendance rows');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current=records(db,'attendance'),payments=records(db,'transactions');
    const seen=new Set(),changes=[];
    for(const row of payload.rows){
      const employeeId=Number(row.employeeId),days=Number(row.days),overtime=Number(row.overtime);
      if(seen.has(employeeId))throw Error('An employee appears more than once in the sheet');seen.add(employeeId);
      const employee=exists(db,'employees',employeeId);if(!employee)throw Error('Employee does not exist');
      if(row.days===''||row.days==null||row.overtime===''||row.overtime==null||!Number.isFinite(days)||!Number.isFinite(overtime)||days<0||days>1||overtime<0||overtime>24)throw Error('Days must be 0–1 and overtime 0–24 hours');
      let old;
      if(row.id){old=current.find(r=>r.id===Number(row.id));if(!old||old.employeeId!==employeeId||old.siteId!==siteId||old.date!==date)throw Error('Attendance record changed; reload the sheet');if(Number(row.version)!==(old.version||1))throw Error('Attendance was changed elsewhere; reload the sheet');}
      if(!old&&current.some(r=>r.employeeId===employeeId&&r.siteId===siteId&&r.date===date))throw Error('Attendance already exists; reload the sheet to correct it');
      const other=current.filter(r=>r.employeeId===employeeId&&r.date===date&&r.id!==old?.id);
      if(other.reduce((s,r)=>s+r.days,0)+days>1.00000001||other.reduce((s,r)=>s+r.overtime,0)+overtime>24.00000001)throw Error(`${JSON.parse(employee.body).name}: attendance across sites exceeds daily limits`);
      if(old&&old.days===days&&old.overtime===overtime)continue;
      if(old&&(!payload.reason||!String(payload.reason).trim()))throw Error('Enter a reason for attendance corrections');
      const e=JSON.parse(employee.body),now=new Date().toISOString();
      const next={siteId,date,employeeId,days,overtime,rate:old?old.rate:e.rate,overtimeRate:old?old.overtimeRate:e.overtimeRate,payType:old?old.payType:e.payType,version:old?(old.version||1)+1:1,updatedAt:now};
      const paymentWarning=payments.some(p=>p.type==='Salary payment'&&p.employeeId===employeeId&&p.date>=date);
      changes.push({old,next,paymentWarning});
    }
    for(const c of changes){
      let id=c.old?.id;
      if(id){db.prepare('UPDATE records SET body=? WHERE id=? AND kind=?').run(JSON.stringify(c.next),id,'attendance');const audit={before:c.old,after:c.next,reason:String(payload.reason).trim(),changedAt:c.next.updatedAt,changedBy:'Owner',paymentWarning:c.paymentWarning};db.prepare('INSERT INTO attendance_history(attendance_id,body) VALUES(?,?)').run(id,JSON.stringify(audit));}
      else{id=Number(db.prepare('INSERT INTO records(kind,body) VALUES(?,?)').run('attendance',JSON.stringify(c.next)).lastInsertRowid);}
      c.next.id=id;
    }
    db.exec('COMMIT');return {saved:changes.length,rows:changes.map(c=>c.next),paymentWarning:changes.some(c=>c.old&&c.paymentWarning)};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
