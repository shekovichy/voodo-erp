// ══════════════════════════════════════════════
// PIVOT ANALYZER + FREE PERIOD COMPARISON + DRILL-DOWN
// محلل بيانات حر — مقارنة فترات حرة — التنقل للتفاصيل
// ══════════════════════════════════════════════

// Flat per-line-item dataset (one row per sold item per sale) — the shared
// foundation for the pivot table, the period comparison, and drill-down.
// Each line already carries revenue/cost/profit as TOTALS (price*qty,
// unitCost*qty) so every metric is a plain sum over the array.
function buildSalesLines(from, to, branchId) {
  const invByCode = {};
  Object.values(_invCacheByBranch).flat().forEach(p => { if (!invByCode[p.code]) invByCode[p.code] = p; });
  const lines = [];
  getSales().forEach(sale => {
    if (sale.isReturn) return;
    const d = new Date(sale.date);
    if (d < from || d > to) return;
    if (branchId && sale.branchId !== branchId) return;
    (sale.items || []).forEach(item => {
      const prod = invByCode[item.code];
      const unitCost = item.cost || prod?.cost || 0;
      const revenue = item.price * item.qty;
      const cost = unitCost * item.qty;
      lines.push({
        saleId: sale.id, date: sale.date,
        branchId: sale.branchId, branchName: getBranchName(sale.branchId),
        salesperson: sale.salesperson, payMethod: sale.payMethod,
        productCode: item.code, productName: item.name,
        category: prod?.category || '', family: prod?.family || '',
        qty: item.qty, revenue, cost, profit: revenue - cost,
      });
    });
  });
  return lines;
}

// ── PIVOT ANALYZER ──────────────────────────────────────────────
const PIVOT_DIMENSIONS = {
  day:       { label: '📅 اليوم',        get: r => r.date.slice(0, 10) },
  month:     { label: '📆 الشهر',        get: r => r.date.slice(0, 7) },
  branch:    { label: '🏬 الفرع',        get: r => r.branchName },
  product:   { label: '📦 المنتج',       get: r => r.productName },
  category:  { label: '🏷️ الفئة',        get: r => r.category || '—' },
  family:    { label: '🗂️ المجموعة',     get: r => r.family || '—' },
  seller:    { label: '👤 البائع',       get: r => r.salesperson || '—' },
  payMethod: { label: '💳 طريقة الدفع',  get: r => r.payMethod === 'cash' ? 'نقدي' : 'كارت' },
};
const PIVOT_METRICS = {
  revenue:  { label: '💰 الإيراد',      calc: rows => rows.reduce((s, r) => s + r.revenue, 0), fmtMoney: true },
  cost:     { label: '📉 التكلفة',      calc: rows => rows.reduce((s, r) => s + r.cost, 0), fmtMoney: true },
  profit:   { label: '📈 الربح',        calc: rows => rows.reduce((s, r) => s + r.profit, 0), fmtMoney: true },
  qty:      { label: '🔢 الكمية',       calc: rows => rows.reduce((s, r) => s + r.qty, 0), fmtMoney: false },
  invoices: { label: '🧾 عدد الفواتير', calc: rows => new Set(rows.map(r => r.saleId)).size, fmtMoney: false },
  lines:    { label: '📋 عدد الأصناف',  calc: rows => rows.length, fmtMoney: false },
};

function buildPivotTable(lines, rowDim, colDim, metricKey) {
  const rowGet = PIVOT_DIMENSIONS[rowDim].get;
  const colGet = colDim ? PIVOT_DIMENSIONS[colDim].get : null;
  const metric = PIVOT_METRICS[metricKey];
  const rowKeys = new Set(), colKeys = new Set();
  const buckets = {};
  lines.forEach(r => {
    const rk = rowGet(r);
    const ck = colGet ? colGet(r) : '__all__';
    rowKeys.add(rk); colKeys.add(ck);
    (buckets[rk] = buckets[rk] || {});
    (buckets[rk][ck] = buckets[rk][ck] || []).push(r);
  });
  const rowList = [...rowKeys].sort();
  const colList = colDim ? [...colKeys].sort() : ['__all__'];
  const table = rowList.map(rk => {
    const cells = colList.map(ck => {
      const cellLines = (buckets[rk] && buckets[rk][ck]) || [];
      return { value: metric.calc(cellLines), lines: cellLines };
    });
    const rowTotal = metric.calc(colList.flatMap(ck => (buckets[rk] && buckets[rk][ck]) || []));
    return { key: rk, cells, total: rowTotal };
  });
  const colTotals = colList.map(ck => metric.calc(rowList.flatMap(rk => (buckets[rk] && buckets[rk][ck]) || [])));
  const grandTotal = metric.calc(lines);
  return { rowList, colList, table, colTotals, grandTotal, hasCol: !!colDim };
}

function renderPivotUI() {
  const rowSel = document.getElementById('pvRowDim');
  const colSel = document.getElementById('pvColDim');
  const metricSel = document.getElementById('pvMetric');
  const branchSel = document.getElementById('pvBranch');
  if (rowSel && rowSel.options.length <= 1) {
    Object.keys(PIVOT_DIMENSIONS).forEach(k => {
      rowSel.innerHTML += `<option value="${k}">${PIVOT_DIMENSIONS[k].label}</option>`;
      colSel.innerHTML += `<option value="${k}">${PIVOT_DIMENSIONS[k].label}</option>`;
    });
  }
  if (metricSel && metricSel.options.length === 0) {
    Object.keys(PIVOT_METRICS).forEach(k => { metricSel.innerHTML += `<option value="${k}">${PIVOT_METRICS[k].label}</option>`; });
  }
  if (branchSel && branchSel.options.length <= 1) {
    BRANCH_IDS.forEach(b => { branchSel.innerHTML += `<option value="${b}">${escHtml(getBranchName(b))}</option>`; });
  }
  renderPivotFavorites();
}

let _lastPivot = null;

function runPivotAnalysis() {
  const rowDim = document.getElementById('pvRowDim').value;
  const colDim = document.getElementById('pvColDim').value;
  const metricKey = document.getElementById('pvMetric').value;
  if (!rowDim || !metricKey) { showToast('⚠️ اختر الصف والمقياس على الأقل'); return; }
  const period = document.getElementById('pvPeriod').value;
  const { from, to } = getDateRange(period, 'pvFrom', 'pvTo');
  const branchId = document.getElementById('pvBranch').value;
  const lines = buildSalesLines(from, to, branchId);
  _lastPivot = buildPivotTable(lines, rowDim, colDim || null, metricKey);
  renderPivotTable(_lastPivot, rowDim, metricKey);
}

function renderPivotTable(pivot, rowDim, metricKey) {
  const metric = PIVOT_METRICS[metricKey];
  const fmtVal = v => metric.fmtMoney ? fmt(v) : v.toLocaleString('ar-EG');
  const wrap = document.getElementById('pivotResultWrap');
  if (!pivot.rowList.length) { wrap.innerHTML = '<div class="text-center text-muted" style="padding:30px;">لا توجد بيانات فى الفترة المحددة</div>'; return; }
  let html = '<table><thead><tr><th>' + PIVOT_DIMENSIONS[rowDim].label + '</th>';
  if (pivot.hasCol) { pivot.colList.forEach(ck => html += `<th>${escHtml(ck)}</th>`); html += '<th>الإجمالي</th>'; }
  else { html += `<th>${metric.label}</th>`; }
  html += '</tr></thead><tbody>';
  pivot.table.forEach((row, ri) => {
    html += `<tr><td style="font-weight:600;">${escHtml(row.key)}</td>`;
    row.cells.forEach((cell, ci) => {
      html += `<td style="cursor:pointer;color:${cell.value ? 'var(--primary)' : 'var(--text-muted)'};" onclick="drillPivotCell(${ri},${ci})">${fmtVal(cell.value)}</td>`;
    });
    if (pivot.hasCol) html += `<td style="font-weight:700;">${fmtVal(row.total)}</td>`;
    html += '</tr>';
  });
  html += `<tr style="font-weight:700;background:var(--bg-secondary);"><td>الإجمالي</td>`;
  if (pivot.hasCol) { pivot.colTotals.forEach(t => html += `<td>${fmtVal(t)}</td>`); html += `<td>${fmtVal(pivot.grandTotal)}</td>`; }
  else { html += `<td>${fmtVal(pivot.grandTotal)}</td>`; }
  html += '</tr></tbody></table>';
  wrap.innerHTML = html;
}

function drillPivotCell(ri, ci) {
  if (!_lastPivot) return;
  const row = _lastPivot.table[ri];
  const colLabel = _lastPivot.hasCol ? ' — ' + _lastPivot.colList[ci] : '';
  openDrillDown(row.cells[ci].lines, `${row.key}${colLabel}`);
}

// ── SAVED / FAVORITE PIVOT REPORTS ──────────────────────────────
const getPivotFavorites = () => _pivotFavoritesCache;
function setPivotFavorites(list) {
  _pivotFavoritesCache = list;
  DB.s('pos_pivot_favorites', list);
  try { _db && _db.collection('pos_data').doc('pivot_favorites').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function renderPivotFavorites() {
  const sel = document.getElementById('pvFavorites');
  if (!sel) return;
  const current = sel.value;
  const favs = getPivotFavorites();
  sel.innerHTML = '<option value="">⭐ اختر تقرير محفوظ...</option>' +
    favs.map(f => `<option value="${f.id}">${escHtml(f.name)}</option>`).join('');
  if (favs.find(f => f.id === current)) sel.value = current;
}

function savePivotFavorite() {
  const rowDim = document.getElementById('pvRowDim').value;
  const metricKey = document.getElementById('pvMetric').value;
  if (!rowDim || !metricKey) { showToast('⚠️ اعمل تحليل الأول قبل الحفظ'); return; }
  showPromptModal('اسم التقرير المفضّل:', '', function(name) {
    if (!name || !name.trim()) return;
    const fav = {
      id: 'pvf_' + Date.now(),
      name: name.trim(),
      rowDim, colDim: document.getElementById('pvColDim').value,
      metric: metricKey,
      period: document.getElementById('pvPeriod').value,
      from: document.getElementById('pvFrom').value,
      to: document.getElementById('pvTo').value,
      branchId: document.getElementById('pvBranch').value,
      createdBy: currentUser, createdAt: Date.now(),
    };
    setPivotFavorites([...getPivotFavorites(), fav]);
    renderPivotFavorites();
    document.getElementById('pvFavorites').value = fav.id;
    showToast('⭐ تم حفظ التقرير في المفضّلة');
  });
}

function loadPivotFavorite() {
  const id = document.getElementById('pvFavorites').value;
  if (!id) return;
  const fav = getPivotFavorites().find(f => f.id === id);
  if (!fav) return;
  document.getElementById('pvRowDim').value = fav.rowDim || '';
  document.getElementById('pvColDim').value = fav.colDim || '';
  document.getElementById('pvMetric').value = fav.metric || '';
  document.getElementById('pvPeriod').value = fav.period || 'month';
  document.getElementById('pvCustomDates').classList.toggle('hidden', fav.period !== 'custom');
  document.getElementById('pvFrom').value = fav.from || '';
  document.getElementById('pvTo').value = fav.to || '';
  document.getElementById('pvBranch').value = fav.branchId || '';
  runPivotAnalysis();
}

function deletePivotFavorite() {
  const id = document.getElementById('pvFavorites').value;
  if (!id) { showToast('⚠️ اختر تقرير محفوظ للحذف'); return; }
  const fav = getPivotFavorites().find(f => f.id === id);
  if (!fav) return;
  showConfirmModal(`حذف "${fav.name}" من المفضّلة؟`, function() {
    setPivotFavorites(getPivotFavorites().filter(f => f.id !== id));
    renderPivotFavorites();
    showToast('🗑️ تم الحذف');
  });
}

// ── FREE PERIOD COMPARISON ──────────────────────────────────────
let _cmpLinesA = [], _cmpLinesB = [];

function renderCompareUI() {
  const branchSel = document.getElementById('cmpBranch');
  if (branchSel && branchSel.options.length <= 1) {
    BRANCH_IDS.forEach(b => { branchSel.innerHTML += `<option value="${b}">${escHtml(getBranchName(b))}</option>`; });
  }
}

function runPeriodComparison() {
  const periodA = document.getElementById('cmpPeriodA').value;
  const periodB = document.getElementById('cmpPeriodB').value;
  const { from: fromA, to: toA } = getDateRange(periodA, 'cmpFromA', 'cmpToA');
  const { from: fromB, to: toB } = getDateRange(periodB, 'cmpFromB', 'cmpToB');
  const branchId = document.getElementById('cmpBranch').value;
  _cmpLinesA = buildSalesLines(fromA, toA, branchId);
  _cmpLinesB = buildSalesLines(fromB, toB, branchId);
  renderComparisonResult(_cmpLinesA, _cmpLinesB, fromA, toA, fromB, toB);
}

function _cmpMetrics(lines) {
  const revenue = lines.reduce((s, r) => s + r.revenue, 0);
  const cost = lines.reduce((s, r) => s + r.cost, 0);
  const invoices = new Set(lines.map(r => r.saleId)).size;
  const qty = lines.reduce((s, r) => s + r.qty, 0);
  return { revenue, profit: revenue - cost, invoices, qty, atv: invoices ? revenue / invoices : 0 };
}

function _cmpDeltaCard(label, a, b, isMoney) {
  const delta = b - a;
  const pct = a !== 0 ? (delta / a * 100) : (b > 0 ? 100 : 0);
  const up = delta >= 0;
  const fmtv = v => isMoney ? fmt(v) : Math.round(v).toLocaleString('ar-EG');
  return `<div class="stat-card">
    <div class="stat-label">${label}</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;gap:8px;">
      <div><div style="font-size:11px;color:var(--text-muted);">🔵 الأولى</div><div style="font-size:15px;font-weight:700;">${fmtv(a)}</div></div>
      <div><div style="font-size:11px;color:#d97706;">🟠 الثانية</div><div style="font-size:15px;font-weight:700;color:#d97706;">${fmtv(b)}</div></div>
    </div>
    <div style="margin-top:6px;font-size:12px;font-weight:700;color:${up ? 'var(--success)' : 'var(--danger)'};">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</div>
  </div>`;
}

function renderComparisonResult(linesA, linesB, fromA, toA, fromB, toB) {
  const mA = _cmpMetrics(linesA), mB = _cmpMetrics(linesB);
  const wrap = document.getElementById('cmpResultWrap');
  wrap.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
      🔵 الفترة الأولى: ${fromA.toLocaleDateString('ar-EG')} → ${toA.toLocaleDateString('ar-EG')}
      &nbsp;|&nbsp; 🟠 الفترة الثانية: ${fromB.toLocaleDateString('ar-EG')} → ${toB.toLocaleDateString('ar-EG')}
    </div>
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
      ${_cmpDeltaCard('💰 الإيراد', mA.revenue, mB.revenue, true)}
      ${_cmpDeltaCard('📈 الربح', mA.profit, mB.profit, true)}
      ${_cmpDeltaCard('🧾 عدد الفواتير', mA.invoices, mB.invoices, false)}
      ${_cmpDeltaCard('🎫 متوسط الفاتورة', mA.atv, mB.atv, true)}
      ${_cmpDeltaCard('🔢 الكمية المباعة', mA.qty, mB.qty, false)}
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;">
      <button class="btn btn-outline btn-sm" onclick="openDrillDown(_cmpLinesA, '🔵 تفاصيل الفترة الأولى')">🔍 تفاصيل الفترة الأولى (${linesA.length})</button>
      <button class="btn btn-outline btn-sm" onclick="openDrillDown(_cmpLinesB, '🟠 تفاصيل الفترة الثانية')">🔍 تفاصيل الفترة الثانية (${linesB.length})</button>
    </div>`;
}

// ── DRILL-DOWN (shared by pivot + comparison) ───────────────────
let _drillLines = [];

function openDrillDown(lines, title) {
  _drillLines = lines;
  document.getElementById('drillTitle').textContent = title;
  document.getElementById('drillCount').textContent = lines.length;
  document.getElementById('drillBody').innerHTML = lines.length ? lines.map(r => `<tr>
    <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${new Date(r.date).toLocaleString('ar-EG')}</td>
    <td style="font-size:12px;">${escHtml(r.branchName)}</td>
    <td style="font-size:12px;">${escHtml(r.productName)}</td>
    <td style="font-size:12px;">${r.qty}</td>
    <td style="font-size:12px;font-weight:600;">${fmt(r.revenue)}</td>
    <td style="font-size:12px;">${escHtml(r.salesperson || '—')}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">لا توجد عمليات</td></tr>';
  document.getElementById('analysisDrillModal').classList.remove('hidden');
}
function closeDrillDown() { document.getElementById('analysisDrillModal').classList.add('hidden'); }

function exportDrillExcel() {
  if (!_drillLines.length) { showToast('⚠️ لا توجد بيانات للتصدير'); return; }
  const rows = [['التاريخ', 'الفرع', 'المنتج', 'الكمية', 'الإيراد', 'البائع'],
    ..._drillLines.map(r => [new Date(r.date).toLocaleString('ar-EG'), r.branchName, r.productName, r.qty, r.revenue, r.salesperson || ''])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'تفاصيل');
  XLSX.writeFile(wb, 'تفاصيل_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}
