// ═══════════════════════════════════════════════════════════════════════
// EXPENSE APPROVAL REQUESTS — طلبات اعتماد المصاريف
// ═══════════════════════════════════════════════════════════════════════
let _expReqCache = null;
function getExpenseRequests() {
  if (!_expReqCache) _expReqCache = DB.g('pos_expense_requests', []);
  return _expReqCache;
}
function setExpenseRequests(list) {
  _expReqCache = list;
  DB.s('pos_expense_requests', list);
  try { _db && _db.collection('pos_data').doc('expense_requests').set({ list, updatedAt: Date.now() }); } catch(e) {}
}
function openExpenseRequestModal() {
  const brSel = document.getElementById('expReqBranchId');
  if (brSel) brSel.innerHTML = BRANCH_IDS.filter(b=>b!=='wh').map(b=>'<option value="'+b+'"'+(b===currentBranch?' selected':'')+'>'+getBranchName(b)+'</option>').join('');
  document.getElementById('expReqAmount').value = '';
  document.getElementById('expReqDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('expReqNote').value = '';
  document.getElementById('expReqCategory').value = 'rent';
  document.getElementById('expenseRequestModal').classList.remove('hidden');
}
function saveExpenseRequest() {
  const amount = parseFloat(document.getElementById('expReqAmount').value);
  const date   = document.getElementById('expReqDate').value;
  if (!amount || amount <= 0) { showToast('أدخل مبلغ صحيح'); return; }
  if (!date) { showToast('أدخل التاريخ'); return; }
  const rec = {
    id: 'expreq_' + Date.now(),
    branchId: document.getElementById('expReqBranchId').value || currentBranch,
    category: document.getElementById('expReqCategory').value,
    amount, date, month: date.slice(0,7),
    note: document.getElementById('expReqNote').value.trim(),
    status: 'pending',
    by: currentUser + ' (' + getBranchName(currentBranch) + ')',
    createdAt: Date.now()
  };
  const list = getExpenseRequests(); list.push(rec); setExpenseRequests(list);
  document.getElementById('expenseRequestModal').classList.add('hidden');
  updateExpReqBadge(); renderExpensesPage();
  showToast('✅ تم إرسال طلب المصروف — بانتظار اعتماد الإدارة');
}
function approveExpenseRequest(id) {
  showConfirmModal('تأكيد اعتماد هذا المصروف؟', function() {
    const list = getExpenseRequests(); const req = list.find(r=>r.id===id); if (!req) return;
    req.status = 'approved'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
    setExpenseRequests(list);
    const expenses = getExpenses();
    expenses.push({ id:'exp_'+Date.now(), type:'branch', branchId:req.branchId, category:req.category,
      amount:req.amount, date:req.date, month:req.month,
      note:(req.note?req.note+' — ':'')+'معتمد من '+req.by, by:currentUser, createdAt:Date.now() });
    setExpenses(expenses);
    updateExpReqBadge(); renderExpensesPage(); showToast('✅ تمت الموافقة وتسجيل المصروف');
  });
}
function rejectExpenseRequest(id) {
  const list = getExpenseRequests(); const req = list.find(r=>r.id===id); if (!req) return;
  req.status = 'rejected'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
  setExpenseRequests(list); updateExpReqBadge(); renderExpensesPage(); showToast('❌ تم رفض الطلب');
}
function updateExpReqBadge() {
  const pending = getExpenseRequests().filter(r=>r.status==='pending').length;
  const badge = document.getElementById('expReqBadge');
  if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
}
function switchExpTab(tab) {
  ['main','requests'].forEach(t => {
    const btn  = document.getElementById('expTabBtn_'+t);
    const pane = document.getElementById('expPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='requests') renderExpenseRequestsPane();
}
function renderExpenseRequestsPane() {
  const cont = document.getElementById('expPane_requests'); if (!cont) return;
  const isAdmin = currentUser === 'admin';
  const reqs = getExpenseRequests()
    .filter(r => isAdmin ? true : r.branchId === currentBranch)
    .sort((a,b) => b.createdAt - a.createdAt);
  if (!reqs.length) { cont.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px">لا توجد طلبات مصاريف</p>'; return; }
  cont.innerHTML = reqs.map(r => '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
    '<div style="flex:1;min-width:200px">' +
      '<div style="font-weight:700;font-size:15px">'+escHtml(EXP_CATS[r.category]||r.category)+' — <span style="color:#3d8fff">'+(r.amount||0).toLocaleString()+' ج</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">🏬 '+escHtml(getBranchName(r.branchId))+' · 📅 '+r.date+(r.note?' · '+escHtml(r.note):'')+'</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">👤 '+escHtml(r.by)+' · '+new Date(r.createdAt).toLocaleString('ar-EG')+'</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;background:'+(r.status==='pending'?'rgba(255,193,7,.15)':r.status==='approved'?'rgba(40,167,69,.15)':'rgba(220,53,69,.15)')+';color:'+(r.status==='pending'?'#e09000':r.status==='approved'?'#28a745':'#dc3545')+'">' +
        (r.status==='pending'?'⏳ بانتظار الاعتماد':r.status==='approved'?'✅ معتمد':'❌ مرفوض') +
      '</span>' +
      (isAdmin && r.status==='pending' ?
        '<button class="btn" style="background:#28a745;color:#fff;font-size:12px;padding:6px 14px" onclick="approveExpenseRequest(\''+escJsAttr(r.id)+'\')">✅ قبول</button>' +
        '<button class="btn" style="background:#dc3545;color:#fff;font-size:12px;padding:6px 14px" onclick="rejectExpenseRequest(\''+escJsAttr(r.id)+'\')">❌ رفض</button>' : '') +
      (r.status!=='pending' ? '<div style="font-size:11px;color:var(--text-muted)">'+escHtml(r.reviewedBy)+'</div>' : '') +
    '</div>' +
  '</div>').join('');
}


