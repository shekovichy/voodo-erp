// ══════════════════════════════════════════════
// DATA MIGRATION — استيراد بيانات قديمة من سيستم سابق
// ══════════════════════════════════════════════
// Historical sales are imported as synthetic monthly/daily per-branch "sale"
// records (shape-compatible with real sales, marked `imported:true`) so
// every existing report/dashboard/pivot/accounting view works on them
// unchanged. Historical expenses reuse the exact existing expense record
// shape. Both go through addSale()/setExpenses() — NEVER setSales(), which
// is a destructive full-reset-only function (see CLAUDE.md-style note
// below); using it here would wipe every real sale in production.

function switchMigTab(tab) {
  ['sales', 'expenses'].forEach(t => {
    document.getElementById('migTab_' + t)?.classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('migTabBtn_' + t);
    if (btn) {
      btn.style.background = t === tab ? 'white' : '';
      btn.style.fontWeight = t === tab ? '700' : '400';
      btn.style.boxShadow = t === tab ? '0 1px 4px rgba(0,0,0,.1)' : '';
    }
  });
}

function _readMigrationExcel(input, onRows) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('الملف فارغ أو غير مقروء'); return; }
      onRows(rows);
    } catch (ex) { showToast('خطأ في قراءة الملف: ' + ex.message); }
  };
  reader.readAsBinaryString(file);
}

function _findBranchIdByNameOrCode(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (BRANCH_IDS.includes(lower)) return lower;
  const match = BRANCH_IDS.find(b => {
    const name = (getBranchName(b) || '').trim();
    return name === v || name.toLowerCase() === lower;
  });
  return match || null;
}

function _normalizeMigDate(raw) {
  const v = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}$/.test(v)) return v + '-01';
  return null;
}

// ── SALES IMPORT ──────────────────────────────────────────────
let _pendingSalesImportGroups = [];

function downloadSalesImportTemplate() {
  const csv = 'التاريخ,الفرع,كود الصنف,اسم الصنف,الكمية,سعر البيع,التكلفة\n'
    + '2026-06-01,الفرع الأول,P1,طقم أطباق,5,250,150\n'
    + '2026-06,الفرع الثاني,P2,طقم شاي,20,80,50\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'نموذج_استيراد_مبيعات_قديمة.csv'; a.click();
}

function handleSalesImportFile(input) {
  _readMigrationExcel(input, rows => previewSalesImport(rows));
}

function previewSalesImport(rows) {
  const groups = {};
  const errors = [];
  rows.forEach((row, i) => {
    const date = _normalizeMigDate(row['التاريخ']);
    if (!date) { errors.push(`صف ${i + 2}: تاريخ غير صحيح "${row['التاريخ']}"`); return; }
    const branchId = _findBranchIdByNameOrCode(row['الفرع']);
    if (!branchId) { errors.push(`صف ${i + 2}: فرع غير معروف "${row['الفرع']}"`); return; }
    const code = String(row['كود الصنف'] || '').trim();
    const name = String(row['اسم الصنف'] || '').trim() || code;
    const qty = parseFloat(row['الكمية']);
    const price = parseFloat(row['سعر البيع']);
    if (!code || isNaN(qty) || qty <= 0 || isNaN(price)) { errors.push(`صف ${i + 2}: بيانات ناقصة أو غير صحيحة`); return; }
    const cost = parseFloat(row['التكلفة']) || 0;
    const key = date + '|' + branchId;
    (groups[key] = groups[key] || { date, branchId, items: [] }).items.push({ code, name, price, cost, qty });
  });

  const groupList = Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  const totalRevenue = groupList.reduce((s, g) => s + g.items.reduce((ss, i) => ss + i.price * i.qty, 0), 0);
  const wrap = document.getElementById('migSalesPreview');
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">✅ ${groupList.length} فاتورة مركّبة هتتعمل</span>
      <span style="background:#eff6ff;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">💰 إجمالي ${fmt(totalRevenue)} ج</span>
      ${errors.length ? `<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">⚠️ ${errors.length} صف اتجاهل</span>` : ''}
    </div>
    ${errors.length ? `<div style="max-height:120px;overflow-y:auto;font-size:12px;color:var(--danger);background:#fef2f2;border-radius:6px;padding:8px 12px;margin-bottom:12px;">${errors.slice(0, 30).map(escHtml).join('<br>')}</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الفرع</th><th>عدد الأصناف</th><th>الإجمالي</th></tr></thead>
    <tbody>${groupList.map(g => `<tr><td>${g.date}</td><td>${escHtml(getBranchName(g.branchId))}</td><td>${g.items.length}</td><td>${fmt(g.items.reduce((s, i) => s + i.price * i.qty, 0))} ج</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">لا توجد صفوف صالحة</td></tr>'}</tbody></table></div>`;
  _pendingSalesImportGroups = groupList;
  document.getElementById('migSalesConfirmBtn').disabled = !groupList.length;
}

function confirmSalesImport() {
  const groups = _pendingSalesImportGroups;
  if (!groups.length) return;
  showConfirmModal(`تأكيد استيراد ${groups.length} فاتورة مركّبة من البيانات القديمة؟ العملية دي هتضيف بس ومش هتمسح أي بيانات موجودة.`, function() {
  _confirmSalesImportConfirmed(groups);
  });
}
function _confirmSalesImportConfirmed(groups) {
  groups.forEach(g => {
    const sub = g.items.reduce((s, i) => s + i.price * i.qty, 0);
    addSale({
      id: 'imported_' + g.date + '_' + g.branchId + '_' + Math.random().toString(36).slice(2, 7),
      date: new Date(g.date + 'T12:00:00').toISOString(),
      cashier: 'استيراد بيانات', salesperson: 'رصيد افتتاحي',
      items: g.items, sub, disc: 0, total: sub, paid: sub, change: 0,
      payMethod: 'cash', branchId: g.branchId, branchName: getBranchName(g.branchId),
      imported: true,
    });
  });
  addAuditLog('data.import', `استيراد ${groups.length} فاتورة مبيعات قديمة`, null);
  showToast(`✅ تم استيراد ${groups.length} فاتورة`);
  document.getElementById('migSalesPreview').innerHTML = '';
  document.getElementById('migSalesFile').value = '';
  document.getElementById('migSalesConfirmBtn').disabled = true;
  _pendingSalesImportGroups = [];
}

// ── EXPENSES IMPORT ──────────────────────────────────────────
let _pendingExpenseImportRows = [];

function downloadExpensesImportTemplate() {
  const csv = 'التاريخ,النوع,الفرع,الفئة,المبلغ,الاسم/الملاحظة\n'
    + '2026-06-01,فرع,الفرع الأول,إيجار,5000,إيجار يونيو\n'
    + '2026-06-15,شركة,,تسويق,1200,إعلانات فيسبوك\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'نموذج_استيراد_مصروفات_قديمة.csv'; a.click();
}

function _matchExpenseCategory(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return { key: 'other', matched: false };
  const found = Object.keys(EXP_CATS).find(k => k.toLowerCase() === v || EXP_CATS[k].toLowerCase() === v);
  return found ? { key: found, matched: true } : { key: 'other', matched: false };
}

function handleExpensesImportFile(input) {
  _readMigrationExcel(input, rows => previewExpensesImport(rows));
}

function previewExpensesImport(rows) {
  const valid = [];
  const errors = [];
  rows.forEach((row, i) => {
    const date = _normalizeMigDate(row['التاريخ']);
    if (!date) { errors.push(`صف ${i + 2}: تاريخ غير صحيح "${row['التاريخ']}"`); return; }
    const typeRaw = String(row['النوع'] || '').trim();
    const isCompany = ['شركة', 'company', 'إدارية'].includes(typeRaw);
    let branchId = null;
    if (!isCompany) {
      branchId = _findBranchIdByNameOrCode(row['الفرع']);
      if (!branchId) { errors.push(`صف ${i + 2}: فرع غير معروف "${row['الفرع']}" (اكتب "شركة" فى عمود النوع لو مصروف إداري)`); return; }
    }
    const amount = parseFloat(row['المبلغ']);
    if (isNaN(amount) || amount <= 0) { errors.push(`صف ${i + 2}: مبلغ غير صحيح`); return; }
    const noteRaw = String(row['الاسم/الملاحظة'] || '').trim();
    const cat = _matchExpenseCategory(row['الفئة']);
    const note = cat.matched ? noteRaw : [String(row['الفئة'] || '').trim(), noteRaw].filter(Boolean).join(' — ');
    valid.push({ date, type: isCompany ? 'company' : 'branch', branchId, category: cat.key, amount, note });
  });

  const totalAmount = valid.reduce((s, r) => s + r.amount, 0);
  const wrap = document.getElementById('migExpensesPreview');
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">✅ ${valid.length} مصروف هيتضاف</span>
      <span style="background:#eff6ff;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">💰 إجمالي ${fmt(totalAmount)} ج</span>
      ${errors.length ? `<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">⚠️ ${errors.length} صف اتجاهل</span>` : ''}
    </div>
    ${errors.length ? `<div style="max-height:120px;overflow-y:auto;font-size:12px;color:var(--danger);background:#fef2f2;border-radius:6px;padding:8px 12px;margin-bottom:12px;">${errors.slice(0, 30).map(escHtml).join('<br>')}</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الفئة</th><th>المبلغ</th><th>الملاحظة</th></tr></thead>
    <tbody>${valid.map(r => `<tr><td>${r.date}</td><td>${r.type === 'company' ? 'شركة' : escHtml(getBranchName(r.branchId))}</td><td>${escHtml(EXP_CATS[r.category])}</td><td>${fmt(r.amount)} ج</td><td style="font-size:12px;color:var(--text-muted);">${escHtml(r.note) || '-'}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted" style="padding:16px;">لا توجد صفوف صالحة</td></tr>'}</tbody></table></div>`;
  _pendingExpenseImportRows = valid;
  document.getElementById('migExpensesConfirmBtn').disabled = !valid.length;
}

function confirmExpensesImport() {
  const rows = _pendingExpenseImportRows;
  if (!rows.length) return;
  showConfirmModal(`تأكيد استيراد ${rows.length} مصروف من البيانات القديمة؟ العملية دي هتضيف بس ومش هتمسح أي بيانات موجودة.`, function() {
  _confirmExpensesImportConfirmed(rows);
  });
}
function _confirmExpensesImportConfirmed(rows) {
  const list = getExpenses();
  rows.forEach(r => {
    list.push({
      id: 'imported_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      type: r.type, branchId: r.branchId, category: r.category, amount: r.amount,
      date: r.date, month: r.date.slice(0, 7), note: r.note, by: 'استيراد بيانات', createdAt: Date.now(),
    });
  });
  setExpenses(list);
  addAuditLog('data.import', `استيراد ${rows.length} مصروف قديم`, null);
  showToast(`✅ تم استيراد ${rows.length} مصروف`);
  document.getElementById('migExpensesPreview').innerHTML = '';
  document.getElementById('migExpensesFile').value = '';
  document.getElementById('migExpensesConfirmBtn').disabled = true;
  _pendingExpenseImportRows = [];
  renderExpensesPage();
}
