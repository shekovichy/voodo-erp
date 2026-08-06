// ══════════════════════════════════════════════
// ABC ANALYSIS
// ══════════════════════════════════════════════
let _abcData = []; // full classified list for filter




// ══════════════════════════════════════════════
// EXPENSE TRACKING
// ══════════════════════════════════════════════

const EXP_CATS = { rent:'إيجار', electricity:'كهرباء', water:'مياه', internet:'إنترنت/تليفون', salaries:'رواتب', maintenance:'صيانة', marketing:'تسويق', transport:'نقل/شحن', other:'أخرى' };
const EXP_ICONS = { rent:'🏠', electricity:'⚡', water:'💧', internet:'🌐', salaries:'👤', maintenance:'🔧', marketing:'📢', transport:'🚚', other:'📌' };

const getExpenses = () => _expensesCache;
function setExpenses(list) {
  _expensesCache = list;
  DB.s('pos_expenses', list);
  try { _db && _db.collection('pos_data').doc('expenses').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function openExpenseModal(id) {
  const exp = id ? getExpenses().find(e => e.id === id) : null;
  document.getElementById('expModalTitle').textContent = exp ? '✏️ تعديل مصروف' : '➕ إضافة مصروف';
  document.getElementById('expEditId').value    = exp?.id || '';
  document.getElementById('expType').value      = exp?.type || 'branch';
  document.getElementById('expCategory').value  = exp?.category || 'rent';
  document.getElementById('expAmount').value    = exp?.amount || '';
  document.getElementById('expDate').value      = exp?.date || new Date().toISOString().slice(0,10);
  document.getElementById('expNote').value      = exp?.note || '';
  // Populate branch select
  const brSel = document.getElementById('expBranchId');
  brSel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}" ${exp?.branchId===b?'selected':''}>${getBranchName(b)}</option>`).join('');
  toggleExpBranch();
  document.getElementById('expenseModal').classList.remove('hidden');
}

function toggleExpBranch() {
  const isCompany = document.getElementById('expType').value === 'company';
  document.getElementById('expBranchGroup').style.display = isCompany ? 'none' : '';
}

function saveExpense() {
  const amount = parseFloat(document.getElementById('expAmount').value);
  const date   = document.getElementById('expDate').value;
  if (!amount || amount <= 0) { showToast('أدخل مبلغ صحيح'); return; }
  if (!date) { showToast('أدخل التاريخ'); return; }
  const type     = document.getElementById('expType').value;
  const editId   = document.getElementById('expEditId').value;
  const list     = getExpenses();
  const rec = {
    id:       editId || 'exp_' + Date.now(),
    type,
    branchId: type === 'branch' ? document.getElementById('expBranchId').value : null,
    category: document.getElementById('expCategory').value,
    amount,
    date,
    month:    date.slice(0,7),
    note:     document.getElementById('expNote').value.trim(),
    by:       currentUser,
    createdAt: editId ? (list.find(e=>e.id===editId)?.createdAt||Date.now()) : Date.now()
  };
  const fieldLabels = { category: 'الفئة', amount: 'المبلغ', date: 'التاريخ', note: 'ملاحظة' };
  const displayRec = { category: EXP_CATS[rec.category], amount: fmt(rec.amount) + ' ج', date: rec.date, note: rec.note || '-' };
  if (editId) {
    const idx = list.findIndex(e => e.id === editId);
    const oldRec = idx >= 0 ? list[idx] : null;
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    setExpenses(list);
    const changes = buildAuditDiff(
      oldRec ? { category: EXP_CATS[oldRec.category], amount: fmt(oldRec.amount) + ' ج', date: oldRec.date, note: oldRec.note || '-' } : null,
      displayRec,
      fieldLabels
    );
    addAuditLog('expense.edit', `تعديل مصروف: ${EXP_CATS[rec.category]} — ${fmt(rec.amount)} ج`, null, changes);
  } else {
    list.push(rec);
    setExpenses(list);
    const changes = buildAuditDiff(null, displayRec, fieldLabels);
    addAuditLog('expense.add', `مصروف: ${EXP_CATS[rec.category]} — ${fmt(rec.amount)} ج ${rec.type==='company'?'(إداري)':'('+(rec.branchId?getBranchName(rec.branchId):'')+')'}`, null, changes);
  }
  closeModal('expenseModal');
  renderExpensesPage();
  buildDashboard();
}

function deleteExpense(id) {
  showConfirmModal('حذف هذا المصروف؟', function() {
    const rec = getExpenses().find(e => e.id === id);
    setExpenses(getExpenses().filter(e => e.id !== id));
    if (rec) {
      const changes = buildAuditDiff(
        { category: EXP_CATS[rec.category], amount: fmt(rec.amount) + ' ج', date: rec.date, note: rec.note || '-' },
        {},
        { category: 'الفئة', amount: 'المبلغ', date: 'التاريخ', note: 'ملاحظة' }
      );
      addAuditLog('expense.delete', `حذف مصروف: ${EXP_CATS[rec.category]} — ${fmt(rec.amount)} ج`, null, changes);
    }
    renderExpensesPage();
    buildDashboard();
  });
}

function renderExpensesPage() {
  // Populate month filter
  const monthSel = document.getElementById('expMonthFilter');
  if (monthSel) {
    const months = [...new Set(getExpenses().map(e=>e.month))].sort().reverse();
    const cur = monthSel.value;
    monthSel.innerHTML = '<option value="">الشهر الحالي</option>' + months.map(m=>`<option value="${m}" ${m===cur?'selected':''}>${m}</option>`).join('');
  }
  // Populate branch filter
  const brSel = document.getElementById('expBranchFilter');
  if (brSel && brSel.options.length <= 2) {
    BRANCH_IDS.forEach(b => {
      const o = document.createElement('option'); o.value=b; o.textContent='🏬 '+getBranchName(b);
      brSel.appendChild(o);
    });
  }
  const selMonth  = document.getElementById('expMonthFilter')?.value  || new Date().toISOString().slice(0,7);
  const selBranch = document.getElementById('expBranchFilter')?.value || '';
  let list = getExpenses().filter(e => e.month === selMonth);
  if (selBranch === 'company') list = list.filter(e => e.type === 'company');
  else if (selBranch) list = list.filter(e => e.type === 'branch' && e.branchId === selBranch);

  const totalAll   = list.reduce((s,e)=>s+e.amount,0);
  const totalBr    = list.filter(e=>e.type==='branch').reduce((s,e)=>s+e.amount,0);
  const totalCo    = list.filter(e=>e.type==='company').reduce((s,e)=>s+e.amount,0);

  // Net profit = month gross profit - expenses. Includes returns (not just
  // !isReturn sales) the same way 93-accounting.js's P&L and 30-dashboard.js's
  // calcProfit() already do — a return's items carry negative qty, which
  // nets its profit back out automatically. Excluding returns here (as this
  // used to) overstated "صافي الربح" by the profit on every returned item,
  // the exact same bug already fixed in the accounting page's P&L.
  const monthSales  = getSales().filter(s=>s.date && s.date.slice(0,7)===selMonth);
  const inv = Object.values(_invCacheByBranch).flat();
  const grossProfit = monthSales.reduce((acc,s)=>acc+s.items.reduce((a,i)=>{
    const c=i.cost>0?i.cost:(inv.find(x=>x.code===i.code)?.cost||0); return a+(i.price-c)*i.qty; },0)-s.disc, 0);
  const netProfit = grossProfit - totalAll;

  animateNumber(document.getElementById('exp-total'),    totalAll, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('exp-branches'), totalBr, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('exp-company'),  totalCo, { format: fmt, suffix: ' ج' });
  const el4=document.getElementById('exp-net-profit'); if(el4) { animateNumber(el4, netProfit, { format: fmt, suffix: ' ج' }); el4.style.color=netProfit>=0?'var(--success)':'var(--danger)'; }

  // Branch breakdown cards
  const breakdown = document.getElementById('expBranchBreakdown');
  if (breakdown) {
    const allMonthExp = getExpenses().filter(e=>e.month===selMonth);
    breakdown.innerHTML = BRANCH_IDS.map(b => {
      const bExp = allMonthExp.filter(e=>e.type==='branch'&&e.branchId===b).reduce((s,e)=>s+e.amount,0);
      const bSales = getSales().filter(s=>!s.isReturn&&s.date&&s.date.slice(0,7)===selMonth&&s.branchId===b).reduce((s,x)=>s+x.total,0);
      return `<div class="stat-card" style="border-top:3px solid var(--primary);">
        <div style="font-weight:700; font-size:13px; margin-bottom:6px;">🏬 ${getBranchName(b)}</div>
        <div style="font-size:12px; color:var(--text-muted);">مصاريف: <strong style="color:var(--danger);">${fmt(bExp)} ج</strong></div>
        <div style="font-size:12px; color:var(--text-muted);">مبيعات: <strong style="color:var(--success);">${fmt(bSales)} ج</strong></div>
      </div>`;
    }).join('');
  }

  // Table
  const tbody = document.getElementById('expensesBody'); if(!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">لا توجد مصاريف لهذا الشهر</td></tr>'; return;
  }
  const sorted = [...list].sort((a,b)=>b.date.localeCompare(a.date));
  tbody.innerHTML = sorted.map(e => `<tr>
    <td style="white-space:nowrap; font-size:12px;">${e.date}</td>
    <td><span style="background:${e.type==='company'?'#f3e8ff':'#dbeafe'};color:${e.type==='company'?'#7c3aed':'#1d4ed8'};padding:2px 8px;border-radius:10px;font-size:11px;">${e.type==='company'?'🏢 إداري':'🏬 فرع'}</span></td>
    <td style="font-size:12px;">${e.type==='company'?'شركة':getBranchName(e.branchId)}</td>
    <td><span style="font-size:12px;">${EXP_ICONS[e.category]||''} ${escHtml(EXP_CATS[e.category]||e.category)}</span></td>
    <td style="font-weight:700; color:var(--danger);">${fmt(e.amount)} ج</td>
    <td style="font-size:12px; color:var(--text-muted);">${escHtml(e.note)||'-'}</td>
    <td style="font-size:11px; color:var(--text-muted);">${escHtml(e.by)||''}</td>
    <td>
      <button class="btn btn-sm" onclick="openExpenseModal('${escJsAttr(e.id)}')" style="font-size:11px;padding:3px 8px;margin-left:4px;">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="deleteExpense('${escJsAttr(e.id)}')" style="font-size:11px;padding:3px 8px;">🗑️</button>
    </td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════

const getAudit = () => _auditCache;

// changes: optional array of { label, before, after } — one entry per field
// that actually changed. Powers the "🔍 التفاصيل" diff view in the audit page.
//
// Each entry is now its OWN Firestore document (pos_audit/{id}), not an
// element inside one shared array field. That's what makes real append-only
// enforcement possible: firestore.rules allows `create` on this collection
// to anyone with a role, but `update`/`delete` are hard-denied to everyone,
// including admin, from the client — no rule can express "you may only grow
// this array, never rewrite an old entry inside it" when the whole log is
// one field, since any write there replaces the field wholesale. One
// document per entry is the only way Firestore's document-level security
// model can guarantee that.
function addAuditLog(action, details, branchId, changes) {
  const entry = {
    id: 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    action,
    details,
    user: currentUsername || currentUser || 'system',
    branchId: branchId || currentBranch,
    timestamp: Date.now(),
    changes: (changes && changes.length) ? changes : null
  };
  _auditCache = [entry, ..._auditCache];
  DB.s('pos_audit', _auditCache.slice(0, 500)); // local mirror only, capped for storage size
  if (!_fbReady) return;
  _db.collection('pos_audit').doc(entry.id).set(entry)
     .catch(e => console.error('Firestore addAuditLog:', e));
}

// Builds a before/after diff array from two display-ready objects (values
// should already be formatted strings/numbers, not raw records) — only
// includes fields that actually changed. fieldLabels maps object keys to
// their Arabic display label, e.g. { qty: 'الكمية' }.
function buildAuditDiff(oldObj, newObj, fieldLabels) {
  const changes = [];
  for (const key in fieldLabels) {
    const before = oldObj ? oldObj[key] : undefined;
    const after = newObj[key];
    if (before !== after) {
      changes.push({
        label: fieldLabels[key],
        before: (before === undefined || before === null || before === '') ? '—' : before,
        after:  (after  === undefined || after  === null || after  === '') ? '—' : after,
      });
    }
  }
  return changes;
}

function showAuditDiff(id) {
  const entry = getAudit().find(a => a.id === id);
  if (!entry || !entry.changes) return;
  document.getElementById('auditDiffBody').innerHTML = entry.changes.map(c => `<tr>
    <td style="font-weight:600;font-size:12px;">${escHtml(c.label)}</td>
    <td style="font-size:12px;color:var(--danger);text-decoration:line-through;">${escHtml(String(c.before))}</td>
    <td style="font-size:12px;color:var(--success);font-weight:600;">${escHtml(String(c.after))}</td>
  </tr>`).join('');
  document.getElementById('auditDiffModal').classList.remove('hidden');
}

function renderAuditPage() {
  const userFilter = document.getElementById('auditUserFilter')?.value || '';
  const typeFilter = document.getElementById('auditTypeFilter')?.value || '';
  const daysFilter = parseInt(document.getElementById('auditDateFilter')?.value) || 30;

  // Populate user filter
  const userSel = document.getElementById('auditUserFilter');
  if (userSel && userSel.options.length <= 1) {
    const users = [...new Set(getAudit().map(a=>a.user))].filter(Boolean);
    users.forEach(u => {
      if (!userSel.querySelector(`option[value="${u}"]`)) {
        const o=document.createElement('option'); o.value=u; o.textContent=u; userSel.appendChild(o);
      }
    });
  }

  const cutoff = daysFilter === 'all' ? 0 : Date.now() - daysFilter * 86400000;
  let list = getAudit().filter(a => a.timestamp >= cutoff);
  if (userFilter) list = list.filter(a => a.user === userFilter);
  if (typeFilter) list = list.filter(a => a.action.startsWith(typeFilter));

  const totalCount    = list.length;
  const invCount      = list.filter(a=>a.action.startsWith('inv')||a.action.startsWith('price')).length;
  const saleCount     = list.filter(a=>a.action.startsWith('sale')).length;
  const settingsCount = list.filter(a=>a.action.startsWith('settings')||a.action.startsWith('auth')).length;

  animateNumber(document.getElementById('audit-total'),    totalCount);
  animateNumber(document.getElementById('audit-inv'),      invCount);
  animateNumber(document.getElementById('audit-sales'),    saleCount);
  animateNumber(document.getElementById('audit-settings'), settingsCount);

  const actionLabels = {
    'inv.add':'➕ إضافة صنف', 'inv.edit':'✏️ تعديل صنف', 'inv.delete':'🗑️ حذف صنف',
    'price.change':'🏷️ تغيير سعر', 'sale.complete':'💰 فاتورة مكتملة', 'sale.return':'↩️ مرتجع',
    'po.receive':'📦 استلام بضاعة', 'po.create':'🛒 أمر شراء', 'po.delete':'🗑️ حذف أمر شراء',
    'supplier.delete':'🗑️ حذف مورّد', 'supplier.payment':'💵 دفعة لمورّد',
    'customer.delete':'🗑️ حذف عميل', 'promo.delete':'🗑️ حذف عرض',
    'transfer.done':'🔄 تحويل',
    'expense.add':'💸 إضافة مصروف', 'expense.edit':'✏️ تعديل مصروف', 'expense.delete':'🗑️ حذف مصروف',
    'settings.change':'⚙️ تغيير إعداد', 'user.save':'👤 حفظ مستخدم', 'user.delete':'🗑️ حذف مستخدم',
    'auth.login':'🔐 تسجيل دخول', 'auth.logout':'🚪 تسجيل خروج'
  };

  const tbody = document.getElementById('auditBody'); if(!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">لا توجد سجلات</td></tr>'; return;
  }
  tbody.innerHTML = list.slice(0, 200).map(a => `<tr>
    <td style="white-space:nowrap; font-size:11px; color:var(--text-muted);">${new Date(a.timestamp).toLocaleString('ar-EG')}</td>
    <td><span style="background:#f0f4ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${escHtml(a.user)||'system'}</span></td>
    <td style="font-size:12px;">${a.branchId?escHtml(getBranchName(a.branchId)):'-'}</td>
    <td style="font-size:12px;">${escHtml(actionLabels[a.action]||a.action)}</td>
    <td style="font-size:12px; color:var(--text-muted);">${escHtml(a.details)||''}
      ${a.changes ? `<button onclick="showAuditDiff('${a.id}')" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:11px;text-decoration:underline;padding:0 0 0 6px;">🔍 التفاصيل</button>` : ''}
    </td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════
// WHATSAPP SHARING
// ══════════════════════════════════════════════

let _lastSale = null; // stored in completeSale for WhatsApp

function shareReceiptWhatsApp() {
  // Build text receipt from last sale
  const sale = _lastSale;
  if (!sale) { showToast('لا توجد فاتورة لمشاركتها'); return; }
  const lines = [
    `🧾 فاتورة من VOODO ERP`,
    `📅 ${new Date(sale.date).toLocaleString('ar-EG')}`,
    `🏬 ${sale.branchName || getBranchName(sale.branchId || 'b1')}`,
    `👤 ${sale.salesperson || sale.cashier || ''}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...sale.items.map(i => `• ${i.name} ×${i.qty}  =  ${fmt(i.price * i.qty)} ج`),
    `━━━━━━━━━━━━━━━━━━━━`,
    sale.disc > 0 ? `🎁 خصم: ${fmt(sale.disc)} ج` : '',
    `💰 الإجمالي: ${fmt(sale.total)} ج`,
    `💳 الدفع: ${payMethodLabel(sale.payMethod, {emoji:false})}`,
    ``,
    `شكراً لثقتك بـ VOODO ERP 🏠`
  ].filter(l => l !== undefined && l !== null);
  const text = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

function shareOffersWhatsApp() {
  const promos = getPromos().filter(p => p.active);
  if (!promos.length) { showToast('لا توجد عروض نشطة للمشاركة'); return; }
  const lines = [
    `🏷️ *عروض وحزم VOODO ERP*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...promos.map(p => {
      if (p.type === 'bundle') {
        return `📦 *${p.name}*\nاشتري: ${p.items.map(i=>i.name+' ×'+i.minQty).join(' + ')}\nبسعر: ${fmt(p.bundlePrice)} ج بدل ${fmt(p.items.reduce((s,i)=>{const inv=getInv().find(x=>x.code===i.code);return s+(inv?.priceAfter||inv?.price||0)*i.minQty;},0))} ج`;
      } else {
        return `💰 *${p.name}*\nعند شراء بأكثر من ${fmt(p.minAmount)} ج\nخصم ${p.discountType==='percent'?p.discountValue+'%':fmt(p.discountValue)+' ج'}`;
      }
    }),
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏠 VOODO ERP — بادر بالشراء!`
  ];
  const text = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

