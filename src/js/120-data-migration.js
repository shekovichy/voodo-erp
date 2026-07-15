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
  if (tab === 'sales') migVlPopulateBranches();
}

function _readMigrationExcel(input, onRows) {
  const file = input.files[0];
  if (!file) return;
  const isCsv = /\.csv$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = e => {
    try {
      // .csv is plain UTF-8 text — SheetJS's array/binary readers don't
      // assume UTF-8 for raw bytes and corrupt Arabic into mojibake, so csv
      // goes through readAsText (browser-decoded UTF-8) + {type:'string'}.
      // .xlsx/.xls are real binary spreadsheet formats with their own
      // internal encoding metadata, so those still go through array buffer.
      const wb = isCsv
        ? XLSX.read(e.target.result, { type: 'string' })
        : XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('الملف فارغ أو غير مقروء'); return; }
      onRows(rows);
    } catch (ex) { showToast('خطأ في قراءة الملف: ' + ex.message); }
  };
  if (isCsv) reader.readAsText(file, 'UTF-8'); else reader.readAsArrayBuffer(file);
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
  // SheetJS auto-detects date-looking cells (even in plain CSV) and hands
  // them back as Excel serial numbers (days since 1899-12-30) instead of
  // the original string — convert those before falling through to the
  // plain-string YYYY-MM-DD/YYYY-MM checks below.
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const v = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}$/.test(v)) return v + '-01';
  return null;
}

// ── SALES IMPORT (VLOOKUP-style: pick a branch, map any column headers) ──
// Historical data rarely comes in one clean sheet — a branch's sales,
// returns, and cost may live in separate exports with different column
// names. So this maps ONE file at a time against a single chosen branch;
// re-uploading a second/third file (with its own column mapping) for the
// same branch just adds more history on top, never replaces it.
let _migVlHeaders = [];
let _migVlRows = [];
let _migVlPendingGroups = [];

function migVlPopulateBranches() {
  const sel = document.getElementById('migVlBranch');
  if (!sel || sel.options.length > 1) return;
  BRANCH_IDS.filter(b => b !== 'wh').forEach(b => {
    const o = document.createElement('option'); o.value = b; o.textContent = getBranchName(b); sel.appendChild(o);
  });
}

function migVlBranchChanged() {
  const branchId = document.getElementById('migVlBranch').value;
  document.getElementById('migVlUploadBtn').disabled = !branchId;
}

function handleMigVlFile(input) {
  _readMigrationExcel(input, rows => {
    _migVlRows = rows;
    _migVlHeaders = Object.keys(rows[0] || {});
    document.getElementById('migVlFileInfo').textContent = `${rows.length} صف • ${_migVlHeaders.length} عمود`;
    buildMigVlMappingUI();
  });
}

function buildMigVlMappingUI() {
  const opts = '<option value="">— اختر عمود —</option>' + _migVlHeaders.map(h => `<option value="${escHtml(h)}">${escHtml(h)}</option>`).join('');
  const optsSkip = '<option value="">⛔ لا تستورد</option>' + _migVlHeaders.map(h => `<option value="${escHtml(h)}">${escHtml(h)}</option>`).join('');
  document.getElementById('migVlDateCol').innerHTML   = opts;
  document.getElementById('migVlCodeCol').innerHTML   = opts;
  document.getElementById('migVlNameCol').innerHTML   = optsSkip;
  document.getElementById('migVlQtyCol').innerHTML    = opts;
  document.getElementById('migVlPaidCol').innerHTML   = opts;
  document.getElementById('migVlCostCol').innerHTML   = optsSkip;
  document.getElementById('migVlReturnCol').innerHTML = optsSkip;

  const autoMatch = {
    migVlDateCol:   ['date', 'تاريخ', 'التاريخ', 'اليوم'],
    migVlCodeCol:   ['code', 'كود', 'الكود', 'كود الصنف', 'sku', 'barcode'],
    migVlNameCol:   ['name', 'اسم', 'الاسم', 'اسم الصنف', 'product'],
    migVlQtyCol:    ['qty', 'quantity', 'الكمية', 'كمية', 'العدد'],
    migVlPaidCol:   ['paid', 'amount', 'المبلغ', 'المبلغ المدفوع', 'المدفوع', 'total'],
    migVlCostCol:   ['cost', 'التكلفة', 'تكلفة'],
    migVlReturnCol: ['return', 'مرتجع', 'returned'],
  };
  Object.keys(autoMatch).forEach(id => {
    const sel = document.getElementById(id);
    const kw = autoMatch[id];
    _migVlHeaders.forEach(h => { if (kw.includes(String(h).toLowerCase().trim())) sel.value = h; });
  });

  document.getElementById('migVlMapCard').classList.remove('hidden');
  document.getElementById('migVlPreview').innerHTML = '';
  document.getElementById('migVlConfirmBtn').classList.add('hidden');
}

function previewMigVlImport() {
  const branchId = document.getElementById('migVlBranch').value;
  if (!branchId) { showToast('اختر الفرع الأول'); return; }
  const dateCol = document.getElementById('migVlDateCol').value;
  const codeCol = document.getElementById('migVlCodeCol').value;
  const nameCol = document.getElementById('migVlNameCol').value;
  const qtyCol  = document.getElementById('migVlQtyCol').value;
  const paidCol = document.getElementById('migVlPaidCol').value;
  const costCol = document.getElementById('migVlCostCol').value;
  const retCol  = document.getElementById('migVlReturnCol').value;
  if (!dateCol || !codeCol || !qtyCol || !paidCol) { showToast('لازم تختار: التاريخ، كود الصنف، الكمية، المبلغ المدفوع على الأقل'); return; }

  const saleGroups = {};
  const returnGroups = {};
  const errors = [];

  _migVlRows.forEach((row, i) => {
    const date = _normalizeMigDate(row[dateCol]);
    if (!date) { errors.push(`صف ${i + 2}: تاريخ غير صحيح "${row[dateCol]}"`); return; }
    const code = String(row[codeCol] || '').trim();
    if (!code) { errors.push(`صف ${i + 2}: كود الصنف فاضي`); return; }
    const name = (nameCol ? String(row[nameCol] || '').trim() : '') || code;
    const qty = parseFloat(row[qtyCol]);
    if (isNaN(qty) || qty <= 0) { errors.push(`صف ${i + 2}: كمية غير صحيحة`); return; }
    const paidTotal = parseFloat(row[paidCol]);
    if (isNaN(paidTotal)) { errors.push(`صف ${i + 2}: مبلغ مدفوع غير صحيح`); return; }
    let costTotal = costCol ? parseFloat(row[costCol]) : NaN;
    if (isNaN(costTotal)) costTotal = 0;
    let isReturn = false;
    if (retCol) {
      const rv = String(row[retCol] || '').trim().toLowerCase();
      isReturn = rv !== '' && rv !== '0' && rv !== 'no' && rv !== 'false' && rv !== 'لا';
    }

    const item = { code, name, price: paidTotal / qty, cost: costTotal / qty, qty };
    const bucket = isReturn ? returnGroups : saleGroups;
    (bucket[date] = bucket[date] || []).push(item);
  });

  const saleList = Object.keys(saleGroups).sort().map(d => ({ date: d, items: saleGroups[d], isReturn: false }));
  const returnList = Object.keys(returnGroups).sort().map(d => ({ date: d, items: returnGroups[d], isReturn: true }));
  const allGroups = saleList.concat(returnList);

  const totalRevenue = saleList.reduce((s, g) => s + g.items.reduce((ss, i) => ss + i.price * i.qty, 0), 0);
  const totalReturns  = returnList.reduce((s, g) => s + g.items.reduce((ss, i) => ss + i.price * i.qty, 0), 0);

  const wrap = document.getElementById('migVlPreview');
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">✅ ${saleList.length} فاتورة مبيعات — ${fmt(totalRevenue)} ج</span>
      ${returnList.length ? `<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">↩️ ${returnList.length} فاتورة مرتجع — ${fmt(totalReturns)} ج</span>` : ''}
      ${errors.length ? `<span style="background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">⚠️ ${errors.length} صف اتجاهل</span>` : ''}
    </div>
    ${errors.length ? `<div style="max-height:120px;overflow-y:auto;font-size:12px;color:var(--danger);background:#fef2f2;border-radius:6px;padding:8px 12px;margin-bottom:12px;">${errors.slice(0, 30).map(escHtml).join('<br>')}</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>عدد الأصناف</th><th>الإجمالي</th></tr></thead>
    <tbody>${allGroups.map(g => {
      const tot = g.items.reduce((s, i) => s + i.price * i.qty, 0);
      return `<tr${g.isReturn ? ' style="color:var(--danger);"' : ''}><td>${g.date}</td><td>${g.isReturn ? '↩️ مرتجع' : '💰 بيع'}</td><td>${g.items.length}</td><td>${fmt(tot)} ج</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">لا توجد صفوف صالحة</td></tr>'}</tbody></table></div>`;

  _migVlPendingGroups = allGroups.map(g => Object.assign({ branchId }, g));
  document.getElementById('migVlConfirmBtn').classList.toggle('hidden', !allGroups.length);
}

function confirmMigVlImport() {
  const groups = _migVlPendingGroups;
  if (!groups.length) return;
  const branchName = getBranchName(groups[0].branchId);
  showConfirmModal(`تأكيد استيراد ${groups.length} فاتورة (مبيعات + مرتجعات) لفرع ${branchName}؟ العملية دي هتضيف بس ومش هتمسح أي بيانات موجودة.`, function() {
    _confirmMigVlImportConfirmed(groups);
  });
}
function _confirmMigVlImportConfirmed(groups) {
  groups.forEach(g => {
    const sign = g.isReturn ? -1 : 1;
    const items = g.items.map(i => ({ code: i.code, name: i.name, price: i.price, cost: i.cost, qty: i.qty * sign }));
    const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
    addSale({
      id: 'imported_' + (g.isReturn ? 'ret_' : '') + g.date + '_' + g.branchId + '_' + Math.random().toString(36).slice(2, 7),
      date: new Date(g.date + 'T12:00:00').toISOString(),
      isReturn: g.isReturn,
      cashier: 'استيراد بيانات', salesperson: 'رصيد افتتاحي',
      items, sub, disc: 0, total: sub, paid: sub, change: 0,
      payMethod: g.isReturn ? 'return' : 'cash', branchId: g.branchId, branchName: getBranchName(g.branchId),
      imported: true,
    });
  });
  addAuditLog('data.import', `استيراد ${groups.length} فاتورة قديمة (VLOOKUP) لفرع ${getBranchName(groups[0].branchId)}`, groups[0].branchId);
  showToast(`✅ تم استيراد ${groups.length} فاتورة`);
  document.getElementById('migVlPreview').innerHTML = '';
  document.getElementById('migVlFile').value = '';
  document.getElementById('migVlFileInfo').textContent = '';
  document.getElementById('migVlMapCard').classList.add('hidden');
  document.getElementById('migVlConfirmBtn').classList.add('hidden');
  _migVlPendingGroups = [];
  _migVlRows = []; _migVlHeaders = [];
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
