// ══════════════════════════════════════════════
// ATTENDANCE & PAYROLL
// ══════════════════════════════════════════════
let _attendanceCache = null;
let _payrollCache    = null;

function getAttendance() {
  if (!_attendanceCache) _attendanceCache = DB.g('pos_attendance', []);
  return _attendanceCache;
}
function setAttendance(list) {
  _attendanceCache = list;
  DB.s('pos_attendance', list);
  try { _db && _db.collection('pos_data').doc('attendance').set({ list, updatedAt: Date.now() }); } catch(e) {}
}
function getPayroll() {
  if (!_payrollCache) _payrollCache = DB.g('pos_payroll', []);
  return _payrollCache;
}
function setPayroll(list) {
  _payrollCache = list;
  DB.s('pos_payroll', list);
  try { _db && _db.collection('pos_data').doc('payroll').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function saveAttendanceRecord(empName, date, status, checkIn, checkOut, notes) {
  const list = getAttendance();
  const existing = list.find(a => a.empName === empName && a.date === date);
  const rec = { id: existing?.id || Date.now(), empName, date, status, checkIn: checkIn||'', checkOut: checkOut||'', notes: notes||'' };
  if (existing) Object.assign(existing, rec);
  else list.push(rec);
  setAttendance(list);
}

function savePayrollAdjustment(month, empName, bonus, deduction) {
  const list = getPayroll();
  const ex = list.find(p => p.month === month && p.empName === empName);
  if (ex) { ex.bonus = bonus; ex.deduction = deduction; }
  else list.push({ id: Date.now(), month, empName, bonus, deduction, isPaid: false });
  setPayroll(list);
}

function markPayrollPaid(month, empName, isPaid) {
  const list = getPayroll();
  const ex = list.find(p => p.month === month && p.empName === empName);
  if (ex) ex.isPaid = isPaid;
  else list.push({ id: Date.now(), month, empName, bonus: 0, deduction: 0, isPaid });
  setPayroll(list);
}

function calcMonthlyPayroll(month) {
  const sps = (getSalespeople ? getSalespeople() : []);
  const hrRec = getHR().find(h => h.month === month) || {};
  const allSales = getSales().filter(s => !s.isReturn && s.date?.slice(0,7) === month);
  const attMonth = getAttendance().filter(a => a.date?.slice(0,7) === month);
  const stored   = getPayroll().filter(p => p.month === month);
  return sps.map(sp => {
    const name = typeof sp === 'string' ? sp : sp.name;
    const base = typeof sp === 'object' ? (sp.baseSalary || 0) : 0;
    const empSales  = allSales.filter(s => s.salesperson === name).reduce((s,x)=>s+x.total,0);
    const commPct   = hrRec.targets?.[name]?.commission ?? 0;
    const commission = Math.round(empSales * commPct / 100);
    const workDays  = attMonth.filter(a => a.empName===name && a.status==='present').length;
    // الإجازات المعتمدة ('excused') مقصودة إنها مش داخلة في absentDays ولا
    // في workDays — بتتعد لوحدها، عشان يوم إجازة موافَق عليه ميظهرش كغياب.
    const absentDays= attMonth.filter(a => a.empName===name && a.status==='absent').length;
    const lateDays  = attMonth.filter(a => a.empName===name && a.status==='late').length;
    const leaveDays = attMonth.filter(a => a.empName===name && a.status==='excused').length;
    const sr = stored.find(p => p.empName===name) || {};
    const bonus = sr.bonus||0; const deduction = sr.deduction||0;
    return { name, base, empSales, commPct, commission, workDays, absentDays, lateDays, leaveDays, bonus, deduction, net: base+commission+bonus-deduction, isPaid: sr.isPaid||false };
  });
}

let _hrActiveTab = 'targets';
function switchHRTab(tab) {
  _hrActiveTab = tab;
  ['targets','attendance','payroll'].forEach(t => {
    const btn = document.getElementById('hrTab_'+t);
    const pane = document.getElementById('hrPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='attendance') renderAttendancePane();
  if (tab==='payroll')    renderPayrollPane();
}

function getHRMonth() {
  return document.getElementById('hrMonthFilter')?.value || new Date().toISOString().slice(0,7);
}

function renderAttendancePane() {
  const month = getHRMonth();
  const sps = (getSalespeople?getSalespeople():[]).map(sp=>typeof sp==='string'?sp:sp.name);
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const today = new Date().toISOString().slice(0,10);
  const attMap = {};
  getAttendance().filter(a=>a.date?.slice(0,7)===month).forEach(a=>{ attMap[a.empName+'_'+a.date]=a; });
  const SC = {present:'#dcfce7',absent:'#fee2e2',late:'#fef9c3',excused:'#eff6ff','':'#f3f4f6'};
  const SL = {present:'✅',absent:'❌',late:'⏰',excused:'🔵','':'—'};

  const summCards = sps.map(name => {
    const p = Object.values(attMap).filter(a=>a.empName===name&&a.status==='present').length;
    const ab= Object.values(attMap).filter(a=>a.empName===name&&a.status==='absent').length;
    const lt= Object.values(attMap).filter(a=>a.empName===name&&a.status==='late').length;
    const ex= Object.values(attMap).filter(a=>a.empName===name&&a.status==='excused').length;
    return `<div style="background:var(--bg-secondary);border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <span style="font-weight:700;min-width:70px;">${escHtml(name)}</span>
      <span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:12px;font-size:12px;">✅ ${p} حضور</span>
      <span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:12px;font-size:12px;">❌ ${ab} غياب</span>
      <span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:12px;font-size:12px;">⏰ ${lt} تأخير</span>
      <span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:12px;">🔵 ${ex} إجازة</span>
    </div>`;
  }).join('');

  const recentDays = [];
  for (let d = daysInMonth; d >= 1; d--) {
    recentDays.push(`${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }

  const rows = recentDays.map(ds => {
    const cells = sps.map(name => {
      const rec = attMap[name+'_'+ds];
      const st = rec?.status||'';
      return `<td style="background:${SC[st]};text-align:center;cursor:pointer;padding:8px 6px;border:1px solid var(--border);"
        title="${escHtml(rec?.checkIn||'')} → ${escHtml(rec?.checkOut||'')}" onclick="openAttendanceEdit('${escJsAttr(name)}','${ds}')">${SL[st]}</td>`;
    }).join('');
    return `<tr><td style="font-size:12px;color:var(--text-muted);padding:6px 8px;white-space:nowrap;border:1px solid var(--border);">${ds.slice(5)}${ds===today?' 🔵':''}</td>${cells}</tr>`;
  }).join('');

  const pane = document.getElementById('hrPane_attendance');
  if (!pane) return;
  pane.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="font-weight:700;font-size:14px;">ملخص ${month}</div>
      <button class="btn btn-primary btn-sm" onclick="openAttendanceEdit('','${today}')">➕ تسجيل حضور</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">${summCards}</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border);">التاريخ</th>
          ${sps.map(n=>`<th style="padding:6px 8px;background:var(--bg-secondary);text-align:center;border:1px solid var(--border);">${escHtml(n)}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function openAttendanceEdit(empName, date) {
  const sps = (getSalespeople?getSalespeople():[]).map(sp=>typeof sp==='string'?sp:sp.name);
  const existing = getAttendance().find(a=>a.empName===empName&&a.date===date);
  document.getElementById('attEmpSelect').innerHTML = sps.map(n=>`<option value="${escHtml(n)}" ${n===empName?'selected':''}>${escHtml(n)}</option>`).join('');
  document.getElementById('attDate').value     = date;
  document.getElementById('attStatus').value   = existing?.status||'present';
  document.getElementById('attCheckIn').value  = existing?.checkIn||'';
  document.getElementById('attCheckOut').value = existing?.checkOut||'';
  document.getElementById('attNotes').value    = existing?.notes||'';
  document.getElementById('attendanceEditModal').classList.remove('hidden');
}

function saveAttendanceEdit() {
  const emp    = document.getElementById('attEmpSelect').value;
  const date   = document.getElementById('attDate').value;
  if (!emp||!date) { showToast('اختر الموظف والتاريخ'); return; }
  saveAttendanceRecord(emp, date,
    document.getElementById('attStatus').value,
    document.getElementById('attCheckIn').value,
    document.getElementById('attCheckOut').value,
    document.getElementById('attNotes').value);
  document.getElementById('attendanceEditModal').classList.add('hidden');
  renderAttendancePane();
}

function renderPayrollPane() {
  const month = getHRMonth();
  const payroll = calcMonthlyPayroll(month);
  const pane = document.getElementById('hrPane_payroll');
  if (!pane) return;
  if (!payroll.length) { pane.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">لا يوجد بائعون — أضفهم من الإعدادات</p>'; return; }
  const totalNet  = payroll.reduce((s,p)=>s+p.net,0);
  const totalPaid = payroll.filter(p=>p.isPaid).reduce((s,p)=>s+p.net,0);
  pane.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
      ${[{l:'إجمالي الرواتب',v:fmt(totalNet)+' ج',bg:'#eff6ff',tc:'#1d4ed8'},{l:'تم الصرف',v:fmt(totalPaid)+' ج',bg:'#dcfce7',tc:'#15803d'},{l:'متبقي للصرف',v:fmt(totalNet-totalPaid)+' ج',bg:'#fee2e2',tc:'#b91c1c'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:18px;font-weight:700;color:${k.tc};">${k.v}</div><div style="font-size:11px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:700px;">
      <thead><tr style="background:var(--bg-secondary);">
        ${['الموظف','المبيعات','عمولة%','العمولة','راتب أساسي','مكافأة','خصم','الصافي','الحالة','إجراء']
          .map(h=>`<th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">${h}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${payroll.map(p=>`<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;font-weight:700;">${escHtml(p.name)}</td>
          <td style="padding:8px;text-align:center;">${fmt(p.empSales)} ج</td>
          <td style="padding:8px;text-align:center;">${p.commPct}%</td>
          <td style="padding:8px;text-align:center;color:#059669;font-weight:700;">${fmt(p.commission)} ج</td>
          <td style="padding:8px;text-align:center;">${fmt(p.base)} ج</td>
          <td style="padding:8px;text-align:center;">
            <input type="number" value="${p.bonus}" min="0" style="width:70px;text-align:center;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px;"
              onchange="savePayrollAdjustment('${escJsAttr(month)}','${escJsAttr(p.name)}',parseFloat(this.value)||0,${p.deduction});renderPayrollPane();" />
          </td>
          <td style="padding:8px;text-align:center;">
            <input type="number" value="${p.deduction}" min="0" style="width:70px;text-align:center;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px;"
              onchange="savePayrollAdjustment('${escJsAttr(month)}','${escJsAttr(p.name)}',${p.bonus},parseFloat(this.value)||0);renderPayrollPane();" />
          </td>
          <td style="padding:8px;text-align:center;font-weight:800;color:var(--primary);font-size:14px;">${fmt(p.net)} ج</td>
          <td style="padding:8px;text-align:center;">
            <span style="background:${p.isPaid?'#dcfce7':'#fee2e2'};color:${p.isPaid?'#15803d':'#b91c1c'};padding:2px 8px;border-radius:12px;font-size:11px;">${p.isPaid?'✅ مصروف':'⏳ لم يُصرف'}</span>
          </td>
          <td style="padding:8px;text-align:center;">
            <button class="btn btn-sm" style="background:${p.isPaid?'#fee2e2':'#dcfce7'};color:${p.isPaid?'#b91c1c':'#15803d'};"
              onclick="markPayrollPaid('${escJsAttr(month)}','${escJsAttr(p.name)}',${!p.isPaid});renderPayrollPane();">
              ${p.isPaid?'↩ استرداد':'💵 صرف الراتب'}
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

