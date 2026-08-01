// ═══════════════════════════════════════════════════════════════════════
// LEAVE & PERMISSION REQUESTS — طلبات الإجازات والأذونات
// ═══════════════════════════════════════════════════════════════════════
let _leaveReqCache = null;
function getLeaveRequests() {
  if (!_leaveReqCache) _leaveReqCache = DB.g('pos_leave_requests', []);
  return _leaveReqCache;
}
function setLeaveRequests(list) {
  _leaveReqCache = list;
  DB.s('pos_leave_requests', list);
  try { _db && _db.collection('pos_data').doc('leave_requests').set({ list, updatedAt: Date.now() }); } catch(e) {}
}
function openLeaveRequestModal() {
  const empSel = document.getElementById('leaveReqEmpName');
  const emps = getSalespeople ? getSalespeople() : DB.g('pos_salespeople', []);
  const empNames = emps.map(e => typeof e === 'string' ? e : e.name).filter(Boolean);
  if (empSel) empSel.innerHTML = empNames.map(n => '<option value="'+escHtml(n)+'">'+escHtml(n)+'</option>').join('');
  document.getElementById('leaveReqDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('leaveReqType').value = 'leave';
  document.getElementById('leaveReqFromTime').value = '';
  document.getElementById('leaveReqToTime').value = '';
  document.getElementById('leaveReqReason').value = '';
  toggleLeaveTimeFields();
  document.getElementById('leaveRequestModal').classList.remove('hidden');
}
function toggleLeaveTimeFields() {
  const type = document.getElementById('leaveReqType').value;
  const row  = document.getElementById('leaveReqTimeRow');
  if (row) row.style.display = (type === 'permission') ? '' : 'none';
}
function saveLeaveRequest() {
  const empName = document.getElementById('leaveReqEmpName').value;
  const date    = document.getElementById('leaveReqDate').value;
  const type    = document.getElementById('leaveReqType').value;
  if (!empName) { showToast('اختر الموظف'); return; }
  if (!date)    { showToast('أدخل التاريخ'); return; }
  const rec = {
    id: 'leaveq_' + Date.now(),
    branchId: currentBranch,
    empName, type, date,
    fromTime: document.getElementById('leaveReqFromTime').value || '',
    toTime:   document.getElementById('leaveReqToTime').value   || '',
    reason:   document.getElementById('leaveReqReason').value.trim(),
    status: 'pending',
    by: currentUser + ' (' + getBranchName(currentBranch) + ')',
    createdAt: Date.now()
  };
  const list = getLeaveRequests(); list.push(rec); setLeaveRequests(list);
  document.getElementById('leaveRequestModal').classList.add('hidden');
  updateLeaveReqBadge(); renderHRPage();
  showToast('✅ تم إرسال الطلب — بانتظار موافقة الإدارة');
}
function approveLeaveRequest(id) {
  showConfirmModal('تأكيد الموافقة على هذا الطلب؟', function() {
    const list = getLeaveRequests(); const req = list.find(r=>r.id===id); if (!req) return;
    req.status = 'approved'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
    setLeaveRequests(list);
    if (req.type === 'leave') {
      // 'excused' مش 'absent': الإجازة المعتمدة مالهاش علاقة بالغياب بدون
      // إذن — تسجيلها absent كان بيخليها تظهر ❌ غياب في ملخص الحضور
      // وتتعد في absentDays في الرواتب، والملاحظة "إجازة معتمدة" محدش
      // بيقراها. الحالة دي كانت معرّفة في SC/SL (92-hr-attendance.js) من
      // غير ما حاجة تكتبها.
      saveAttendanceRecord(req.empName, req.date, 'excused', '', '', 'إجازة معتمدة');
    } else {
      const notes = (req.fromTime && req.toTime) ? 'إذن انصراف '+req.fromTime+' - '+req.toTime : 'إذن انصراف معتمد';
      saveAttendanceRecord(req.empName, req.date, 'late', req.fromTime||'', req.toTime||'', notes);
    }
    updateLeaveReqBadge(); renderHRPage(); showToast('✅ تمت الموافقة وتسجيل الحضور');
  });
}
function rejectLeaveRequest(id) {
  const list = getLeaveRequests(); const req = list.find(r=>r.id===id); if (!req) return;
  req.status = 'rejected'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
  setLeaveRequests(list); updateLeaveReqBadge(); renderHRPage(); showToast('❌ تم رفض الطلب');
}
function updateLeaveReqBadge() {
  const pending = getLeaveRequests().filter(r=>r.status==='pending').length;
  const badge = document.getElementById('leaveReqBadge');
  if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
}
function renderLeaveRequestsPane() {
  const cont = document.getElementById('hrPane_leavereqs'); if (!cont) return;
  const isAdmin = currentUser === 'admin';
  const btn = document.getElementById('leaveReqAddBtn');
  if (btn) btn.style.display = (currentUser !== 'admin') ? '' : 'none';
  const reqs = getLeaveRequests()
    .filter(r => isAdmin ? true : r.branchId === currentBranch)
    .sort((a,b) => b.createdAt - a.createdAt);
  if (!reqs.length) { cont.querySelector('#leaveReqList').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px">لا توجد طلبات إجازات أو أذونات</p>'; return; }
  const TYPE_LABELS = { leave: '🏖️ إجازة يوم كامل', permission: '🕐 إذن انصراف' };
  cont.querySelector('#leaveReqList').innerHTML = reqs.map(r =>
    '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
    '<div style="flex:1;min-width:200px">' +
      '<div style="font-weight:700;font-size:15px">👤 '+escHtml(r.empName)+' — <span style="color:#3d8fff">'+(TYPE_LABELS[r.type]||r.type)+'</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">🏬 '+escHtml(getBranchName(r.branchId))+' · 📅 '+r.date+(r.type==='permission'&&r.fromTime?' · 🕐 '+escHtml(r.fromTime)+'–'+escHtml(r.toTime):'')+(r.reason?' · '+escHtml(r.reason):'')+'</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">👤 '+escHtml(r.by)+' · '+new Date(r.createdAt).toLocaleString('ar-EG')+'</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;background:'+(r.status==='pending'?'rgba(255,193,7,.15)':r.status==='approved'?'rgba(40,167,69,.15)':'rgba(220,53,69,.15)')+';color:'+(r.status==='pending'?'#e09000':r.status==='approved'?'#28a745':'#dc3545')+'">' +
        (r.status==='pending'?'⏳ بانتظار الموافقة':r.status==='approved'?'✅ موافق عليه':'❌ مرفوض') +
      '</span>' +
      (isAdmin && r.status==='pending' ?
        '<button class="btn" style="background:#28a745;color:#fff;font-size:12px;padding:6px 14px" onclick="approveLeaveRequest(\''+escJsAttr(r.id)+'\')">✅ قبول</button>' +
        '<button class="btn" style="background:#dc3545;color:#fff;font-size:12px;padding:6px 14px" onclick="rejectLeaveRequest(\''+escJsAttr(r.id)+'\')">❌ رفض</button>' : '') +
      (r.status!=='pending' ? '<span style="font-size:11px;color:var(--text-muted)">'+escHtml(r.reviewedBy)+'</span>' : '') +
    '</div></div>'
  ).join('');
}
// Extend switchHRTab to handle leavereqs tab
const _origSwitchHRTab = switchHRTab;
function switchHRTab(tab) {
  _hrActiveTab = tab;
  ['targets','attendance','payroll','leavereqs'].forEach(t => {
    const btn  = document.getElementById('hrTab_'+t);
    const pane = document.getElementById('hrPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='attendance') renderAttendancePane();
  if (tab==='payroll')    renderPayrollPane();
  if (tab==='leavereqs')  renderLeaveRequestsPane();
}


