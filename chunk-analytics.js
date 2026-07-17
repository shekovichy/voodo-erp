// ══════════════════════════════════════════════════════════════════════
// STRATEGIC ANALYTICS — Discount Analysis, Stock Ageing/Valuation, Stock
// Ledger, Customer RFM/Churn/Ranking/CLV, Vendor Performance, Forecasted
// Stock. Lazy chunk (see LAZY_CHUNKS in build.py) — admin-only entry point
// (see HOME_FOLDERS in 100-home.js), so no core file may call into this
// unconditionally.
//
// Branch scoping follows the same pattern fixed in lockBranchFilter()
// (05-utils.js): every tab locks its own branch <select> to currentBranch
// for non-admins BEFORE reading its value, so a branch manager who somehow
// reaches this page never sees another branch's numbers.
// ══════════════════════════════════════════════════════════════════════

let _saLedgerProduct = '';

function renderAnalyticsPage() {
  const root = document.getElementById('analyticsRoot');
  if (!root) return;
  if (!root.dataset.built) {
    root.dataset.built = '1';
    root.innerHTML = `
      <div class="tabs" style="margin-bottom:14px;">
        <div class="tab active" id="saTab-discounts" onclick="switchAnalyticsTab('discounts',this)">🏷️ الخصومات</div>
        <div class="tab" id="saTab-stock" onclick="switchAnalyticsTab('stock',this)">📦 المخزون (عمر وتقييم)</div>
        <div class="tab" id="saTab-ledger" onclick="switchAnalyticsTab('ledger',this)">📖 دفتر حركة الصنف</div>
        <div class="tab" id="saTab-customers" onclick="switchAnalyticsTab('customers',this)">👥 تحليل العملاء</div>
        <div class="tab" id="saTab-vendors" onclick="switchAnalyticsTab('vendors',this)">🚚 أداء الموردين</div>
        <div class="tab" id="saTab-forecast" onclick="switchAnalyticsTab('forecast',this)">📉 توقع نفاد المخزون</div>
      </div>
      <div id="sa-pane-discounts"></div>
      <div id="sa-pane-stock" class="hidden"></div>
      <div id="sa-pane-ledger" class="hidden"></div>
      <div id="sa-pane-customers" class="hidden"></div>
      <div id="sa-pane-vendors" class="hidden"></div>
      <div id="sa-pane-forecast" class="hidden"></div>`;
  }
  buildDiscountAnalysis();
}

function switchAnalyticsTab(tab, el) {
  ['discounts','stock','ledger','customers','vendors','forecast'].forEach(t => {
    document.getElementById('sa-pane-'+t)?.classList.toggle('hidden', t !== tab);
    document.getElementById('saTab-'+t)?.classList.toggle('active', t === tab);
  });
  if (tab === 'discounts') buildDiscountAnalysis();
  if (tab === 'stock')     buildStockAnalysis();
  if (tab === 'ledger')    buildStockLedger();
  if (tab === 'customers') buildCustomerAnalytics();
  if (tab === 'vendors')   buildVendorPerformance();
  if (tab === 'forecast')  buildForecastedStock();
}

// Shared branch-select builder used by every tab below (mirrors the
// populate-then-lock pattern already used across 45-reports.js).
function _saBranchOptions(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  if (sel.options.length === 0) {
    sel.innerHTML = '<option value="all">🏬 كل الفروع</option>' +
      BRANCH_IDS.map(b => `<option value="${b}">${escHtml(getBranchName(b))}</option>`).join('');
  }
}

// ════════════════════════════════════════════════════
// 1) DISCOUNT ANALYSIS — تحليل الخصومات
// ════════════════════════════════════════════════════
function buildDiscountAnalysis() {
  const pane = document.getElementById('sa-pane-discounts');
  if (!pane.dataset.built) {
    pane.dataset.built = '1';
    pane.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
        <select id="saDiscPeriod" class="form-control" style="width:auto;" onchange="buildDiscountAnalysis()">
          <option value="month">الشهر الحالي</option>
          <option value="week">آخر 7 أيام</option>
          <option value="today">اليوم</option>
          <option value="year">السنة</option>
        </select>
        <select id="saDiscBranch" class="form-control" style="width:auto;" onchange="buildDiscountAnalysis()"></select>
      </div>
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;" id="saDiscKPIs"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;" class="grid-2">
        <div class="card">
          <div style="font-weight:700;margin-bottom:10px;">👤 الخصومات حسب البائع</div>
          <table><thead><tr><th>البائع</th><th>عدد الفواتير</th><th>إجمالي الخصم</th><th>% من مبيعاته</th></tr></thead>
            <tbody id="saDiscBySeller"></tbody></table>
        </div>
        <div class="card">
          <div style="font-weight:700;margin-bottom:10px;">🏬 الخصومات حسب الفرع</div>
          <table><thead><tr><th>الفرع</th><th>عدد الفواتير</th><th>إجمالي الخصم</th><th>% من مبيعاته</th></tr></thead>
            <tbody id="saDiscByBranch"></tbody></table>
        </div>
      </div>
      <div class="card" style="margin-top:16px;">
        <div style="font-weight:700;margin-bottom:10px;">📦 أكثر المنتجات تخفيضاً (تعديل سعر يدوي)</div>
        <table><thead><tr><th>المنتج</th><th>مرات التعديل</th><th>الكمية</th><th>قيمة التخفيض</th></tr></thead>
          <tbody id="saDiscByProduct"></tbody></table>
      </div>`;
  }
  _saBranchOptions('saDiscBranch');
  const branchFilter = lockBranchFilter('saDiscBranch');
  const period = document.getElementById('saDiscPeriod').value;
  const { from, to } = getDateRange(period);

  let sales = getSales().filter(s => !s.isReturn && (() => { const d = new Date(s.date); return d >= from && d <= to; })());
  if (branchFilter !== 'all') sales = sales.filter(s => s.branchId === branchFilter);

  const totalDisc  = sales.reduce((s,x) => s + (x.disc||0), 0);
  const totalGross = sales.reduce((s,x) => s + x.sub, 0);
  const discInvoices = sales.filter(s => (s.disc||0) > 0);
  const discPct = totalGross ? (totalDisc / totalGross * 100) : 0;
  const avgDisc = discInvoices.length ? totalDisc / discInvoices.length : 0;

  document.getElementById('saDiscKPIs').innerHTML = [
    { label:'إجمالي الخصومات', val: fmt(totalDisc)+' ج', bg:'#fee2e2', tc:'#b91c1c' },
    { label:'% من إجمالي المبيعات', val: discPct.toFixed(1)+'%', bg:'#fef9c3', tc:'#92400e' },
    { label:'عدد الفواتير المخصومة', val: discInvoices.length, bg:'#eff6ff', tc:'#1d4ed8' },
    { label:'متوسط الخصم للفاتورة', val: fmt(avgDisc)+' ج', bg:'#f3f4f6', tc:'#374151' },
  ].map(k => `<div style="background:${k.bg};border-radius:10px;padding:14px;text-align:center;">
    <div style="font-size:20px;font-weight:800;color:${k.tc};">${k.val}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${k.label}</div>
  </div>`).join('');

  // By seller
  const bySeller = {};
  sales.forEach(s => {
    const key = s.salesperson || 'غير محدد';
    (bySeller[key] = bySeller[key] || { disc:0, gross:0, invoices:0, discInvoices:0 });
    bySeller[key].gross += s.sub; bySeller[key].disc += (s.disc||0); bySeller[key].invoices++;
    if ((s.disc||0) > 0) bySeller[key].discInvoices++;
  });
  const sellerRows = Object.entries(bySeller).filter(([,v]) => v.disc > 0).sort((a,b) => b[1].disc - a[1].disc);
  document.getElementById('saDiscBySeller').innerHTML = sellerRows.length ? sellerRows.map(([name,v]) => `<tr>
      <td>${escHtml(name)}</td><td>${v.discInvoices}</td><td style="color:var(--danger);font-weight:700;">${fmt(v.disc)} ج</td>
      <td>${v.gross ? (v.disc/v.gross*100).toFixed(1) : '0'}%</td>
    </tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">لا توجد خصومات في هذه الفترة</td></tr>';

  // By branch
  const byBranch = {};
  sales.forEach(s => {
    const key = s.branchId || 'b1';
    (byBranch[key] = byBranch[key] || { disc:0, gross:0, invoices:0, discInvoices:0 });
    byBranch[key].gross += s.sub; byBranch[key].disc += (s.disc||0); byBranch[key].invoices++;
    if ((s.disc||0) > 0) byBranch[key].discInvoices++;
  });
  const branchRows = Object.entries(byBranch).filter(([,v]) => v.disc > 0).sort((a,b) => b[1].disc - a[1].disc);
  document.getElementById('saDiscByBranch').innerHTML = branchRows.length ? branchRows.map(([b,v]) => `<tr>
      <td>${escHtml(getBranchName(b))}</td><td>${v.discInvoices}</td><td style="color:var(--danger);font-weight:700;">${fmt(v.disc)} ج</td>
      <td>${v.gross ? (v.disc/v.gross*100).toFixed(1) : '0'}%</td>
    </tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">لا توجد خصومات في هذه الفترة</td></tr>';

  // Per-product manual price overrides (item.priceModified with originalPrice)
  const byProduct = {};
  sales.forEach(s => (s.items||[]).forEach(i => {
    if (!i.priceModified) return;
    const diff = (i.originalPrice - i.price) * i.qty;
    if (diff <= 0) return;
    (byProduct[i.code] = byProduct[i.code] || { name:i.name, times:0, qty:0, value:0 });
    byProduct[i.code].times++; byProduct[i.code].qty += i.qty; byProduct[i.code].value += diff;
  }));
  const prodRows = Object.values(byProduct).sort((a,b) => b.value - a.value).slice(0,15);
  document.getElementById('saDiscByProduct').innerHTML = prodRows.length ? prodRows.map(p => `<tr>
      <td>${escHtml(p.name)}</td><td>${p.times}</td><td>${p.qty}</td><td style="color:var(--danger);font-weight:700;">${fmt(p.value)} ج</td>
    </tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">لا توجد تعديلات أسعار يدوية في هذه الفترة</td></tr>';
}

// ════════════════════════════════════════════════════
// 2) STOCK AGEING + INVENTORY VALUATION — عمر وتقييم المخزون
// ════════════════════════════════════════════════════
function buildStockAnalysis() {
  const pane = document.getElementById('sa-pane-stock');
  if (!pane.dataset.built) {
    pane.dataset.built = '1';
    pane.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
        <select id="saStockBranch" class="form-control" style="width:auto;" onchange="buildStockAnalysis()"></select>
        <input id="saStockSearch" class="form-control" style="width:220px;" placeholder="🔍 دوّر على منتج..." oninput="buildStockAnalysis()" />
      </div>
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;" id="saStockKPIs"></div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:4px;">📦 تقييم المخزون وعمره — مرتب من الأقدم حركة</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
          "أيام بدون بيع" محسوبة من تاريخ آخر عملية بيع فعلية لهذا الصنف (أو "لم يُباع أبداً" لو مفيش أي فاتورة عليه) — مش من تاريخ إضافته للمخزون، لعدم توفر هذا التاريخ في السجل الحالي.
        </div>
        <div class="table-wrap">
        <table><thead><tr><th>الكود</th><th>المنتج</th><th>الفرع</th><th>الكمية</th><th>التكلفة/وحدة</th><th>قيمة المخزون (تكلفة)</th><th>قيمة البيع</th><th>آخر بيع</th><th>أيام بدون بيع</th></tr></thead>
          <tbody id="saStockBody"></tbody></table>
        </div>
      </div>`;
  }
  _saBranchOptions('saStockBranch');
  const branchFilter = lockBranchFilter('saStockBranch');
  const q = (document.getElementById('saStockSearch').value || '').toLowerCase();

  // Tag each row with its branch — needed in the "all branches" view where
  // the same product code legitimately appears once per branch; without
  // this there was no way to tell which row belonged to which branch.
  const inv = branchFilter === 'all'
    ? BRANCH_IDS.flatMap(b => getInv(b).map(p => ({ ...p, _branchId: b })))
    : getInv(branchFilter).map(p => ({ ...p, _branchId: branchFilter }));
  const sales = getSales().filter(s => !s.isReturn && (branchFilter === 'all' || s.branchId === branchFilter));

  // Keyed by code+branch (not just code) so the "all branches" view doesn't
  // blend branch A's last sale into branch B's row for the same product.
  const lastSaleByKey = {};
  sales.forEach(s => (s.items||[]).forEach(i => {
    const key = i.code + '|' + s.branchId;
    if (!lastSaleByKey[key] || s.date > lastSaleByKey[key]) lastSaleByKey[key] = s.date;
  }));

  const costVal  = inv.reduce((s,p) => s + (p.cost||0)*p.qty, 0);
  const sellVal  = inv.reduce((s,p) => s + (p.priceAfter||0)*p.qty, 0);
  const now = Date.now();
  const rows = inv
    .filter(p => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    .map(p => {
      const last = lastSaleByKey[p.code + '|' + p._branchId];
      const days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : Infinity;
      return { ...p, lastSale: last, days };
    })
    .sort((a,b) => b.days - a.days);
  const staleCount = rows.filter(r => r.days >= 60).length;

  document.getElementById('saStockKPIs').innerHTML = [
    { label:'عدد الأصناف', val: inv.length, bg:'#eff6ff', tc:'#1d4ed8' },
    { label:'قيمة المخزون (تكلفة)', val: fmt(costVal)+' ج', bg:'#f3f4f6', tc:'#374151' },
    { label:'قيمة المخزون (بيع)', val: fmt(sellVal)+' ج', bg:'#dcfce7', tc:'#15803d' },
    { label:'أصناف راكدة (60+ يوم)', val: staleCount, bg:'#fee2e2', tc:'#b91c1c' },
  ].map(k => `<div style="background:${k.bg};border-radius:10px;padding:14px;text-align:center;">
    <div style="font-size:20px;font-weight:800;color:${k.tc};">${k.val}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${k.label}</div>
  </div>`).join('');

  document.getElementById('saStockBody').innerHTML = rows.length ? rows.map(p => {
    const stale = p.days >= 60;
    const never = p.days === Infinity;
    return `<tr style="${stale?'background:#fff5f5;':''}">
      <td>${escHtml(p.code)}</td><td>${escHtml(p.name)}</td>
      <td><span style="font-size:11px;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:8px;">${escHtml(getBranchName(p._branchId))}</span></td>
      <td>${p.qty}</td>
      <td>${fmt(p.cost||0)}</td><td>${fmt((p.cost||0)*p.qty)} ج</td><td>${fmt((p.priceAfter||0)*p.qty)} ج</td>
      <td style="font-size:12px;">${p.lastSale ? new Date(p.lastSale).toLocaleDateString('ar-EG') : '—'}</td>
      <td style="font-weight:700;color:${never?'var(--danger)':stale?'#d97706':'var(--text-muted)'};">${never ? 'لم يُباع أبداً' : p.days + ' يوم'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="text-center text-muted" style="padding:20px;">لا توجد أصناف</td></tr>';
}

// ════════════════════════════════════════════════════
// 3) STOCK LEDGER — دفتر حركة الصنف
// ════════════════════════════════════════════════════
function buildStockLedger() {
  const pane = document.getElementById('sa-pane-ledger');
  if (!pane.dataset.built) {
    pane.dataset.built = '1';
    pane.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
        <input id="saLedgerSearch" class="form-control" style="width:260px;" placeholder="🔍 اكتب كود أو اسم منتج..." oninput="_saLedgerSearchInput()" />
        <select id="saLedgerBranch" class="form-control" style="width:auto;" onchange="buildStockLedger()"></select>
      </div>
      <div id="saLedgerDropdown" class="hidden" style="position:relative;">
        <div style="position:absolute;top:0;right:0;left:0;background:white;border:1px solid var(--border);border-radius:8px;z-index:5;max-height:220px;overflow-y:auto;"></div>
      </div>
      <div id="saLedgerHeader" style="margin-bottom:10px;"></div>
      <div class="card">
        <div class="table-wrap">
        <table><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>الفرع</th><th>التغيير</th><th>الرصيد بعدها</th></tr></thead>
          <tbody id="saLedgerBody"></tbody></table>
        </div>
      </div>`;
  }
  _saBranchOptions('saLedgerBranch');
  const branchFilter = lockBranchFilter('saLedgerBranch');
  _saRenderLedgerBody(branchFilter);
}

function _saLedgerSearchInput() {
  const q = document.getElementById('saLedgerSearch').value.trim().toLowerCase();
  const dd = document.getElementById('saLedgerDropdown');
  const inner = dd.querySelector('div');
  if (!q) { dd.classList.add('hidden'); return; }
  const allProducts = {};
  Object.values(_invCacheByBranch).flat().forEach(p => { if (!allProducts[p.code]) allProducts[p.code] = p; });
  const matches = Object.values(allProducts).filter(p =>
    p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { inner.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">لا نتائج</div>'; dd.classList.remove('hidden'); return; }
  inner.innerHTML = matches.map(p => `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px;"
      onmousedown="_saSelectLedgerProduct('${escJsAttr(p.code)}','${escJsAttr(p.name)}')">${escHtml(p.name)} <span style="color:var(--text-muted);font-size:11px;">(${escHtml(p.code)})</span></div>`).join('');
  dd.classList.remove('hidden');
}
function _saSelectLedgerProduct(code, name) {
  _saLedgerProduct = code;
  document.getElementById('saLedgerSearch').value = name;
  document.getElementById('saLedgerDropdown').classList.add('hidden');
  const branchFilter = lockBranchFilter('saLedgerBranch');
  _saRenderLedgerBody(branchFilter);
}

function _saRenderLedgerBody(branchFilter) {
  const header = document.getElementById('saLedgerHeader');
  const body   = document.getElementById('saLedgerBody');
  if (!_saLedgerProduct) {
    header.innerHTML = '';
    body.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">دوّر على منتج فوق لعرض حركته</td></tr>';
    return;
  }
  const code = _saLedgerProduct;
  const inv = branchFilter === 'all' ? Object.values(_invCacheByBranch).flat() : getInv(branchFilter);
  const prod = inv.find(p => p.code === code);
  const currentQty = branchFilter === 'all'
    ? Object.keys(_invCacheByBranch).reduce((s,b) => { const p=(_invCacheByBranch[b]||[]).find(x=>x.code===code); return s+(p?p.qty:0); }, 0)
    : (prod ? prod.qty : 0);

  // Gather every movement affecting this code (manual qty corrections are
  // NOT included — they only show in the audit log, since reconstructing
  // an exact before/after quantity from that log's free-text diff isn't
  // reliable enough for a balance column here).
  const moves = [];
  getSales().forEach(s => {
    if (branchFilter !== 'all' && s.branchId !== branchFilter) return;
    (s.items||[]).forEach(i => {
      if (i.code !== code) return;
      moves.push({
        date: s.date, delta: -i.qty, // sale item qty is already negative for returns
        type: s.isReturn ? '↩️ مرتجع' : '💰 بيع',
        ref: '#' + String(s.id).slice(-6), branchName: s.branchName || getBranchName(s.branchId)
      });
    });
  });
  getTransfers().forEach(t => {
    (t.items||[]).forEach(i => {
      if (i.code !== code) return;
      if (branchFilter !== 'all' && t.from !== branchFilter && t.to !== branchFilter) return;
      if (branchFilter === 'all' || t.to === branchFilter)
        moves.push({ date:t.date, delta: i.qty, type:'📥 تحويل وارد', ref: `من ${t.fromName}`, branchName: t.toName });
      if (branchFilter === 'all' || t.from === branchFilter)
        moves.push({ date:t.date, delta: -i.qty, type:'📤 تحويل صادر', ref: `إلى ${t.toName}`, branchName: t.fromName });
    });
  });
  // _purchaseCache directly — see the comment in buildVendorPerformance()
  // about getPurchases()/getSuppliers() living in the lazy purchases chunk.
  _purchaseCache.filter(po => po.status === 'received').forEach(po => {
    if (branchFilter !== 'all' && po.branchId !== branchFilter) return;
    (po.items||[]).forEach(i => {
      if (i.code !== code) return;
      moves.push({ date: new Date(po.receivedAt||po.date).toISOString(), delta: i.qty, type:'📦 استلام شراء', ref:'PO-'+String(po.id).slice(-6), branchName: getBranchName(po.branchId) });
    });
  });

  moves.sort((a,b) => new Date(a.date) - new Date(b.date));
  const totalDelta = moves.reduce((s,m) => s + m.delta, 0);
  let running = currentQty - totalDelta; // reconstruct starting point from the known current qty
  const withBalance = moves.map(m => { running += m.delta; return { ...m, balance: running }; });

  header.innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap;">
    <div><strong>${escHtml(prod?.name || code)}</strong> <span style="color:var(--text-muted);font-size:12px;">(${escHtml(code)})</span></div>
    <div style="color:var(--primary);font-weight:700;">الرصيد الحالي: ${currentQty}</div>
    <div style="color:var(--text-muted);font-size:12px;">${withBalance.length} حركة مسجّلة</div>
  </div>`;

  body.innerHTML = withBalance.length ? withBalance.slice().reverse().map(m => `<tr>
      <td style="font-size:12px;white-space:nowrap;">${new Date(m.date).toLocaleString('ar-EG')}</td>
      <td>${m.type}</td>
      <td style="font-size:12px;">${escHtml(m.ref)}</td>
      <td style="font-size:12px;">${escHtml(m.branchName||'')}</td>
      <td style="font-weight:700;color:${m.delta>=0?'var(--success)':'var(--danger)'};">${m.delta>=0?'+':''}${m.delta}</td>
      <td style="font-weight:700;">${m.balance}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">لا توجد حركات مسجّلة لهذا الصنف</td></tr>';
}

// ════════════════════════════════════════════════════
// 4) CUSTOMER ANALYTICS — RFM + Churn + Ranking + CLV
// ════════════════════════════════════════════════════
function buildCustomerAnalytics() {
  const pane = document.getElementById('sa-pane-customers');
  if (!pane.dataset.built) {
    pane.dataset.built = '1';
    pane.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
        <select id="saCustSegmentFilter" class="form-control" style="width:auto;" onchange="buildCustomerAnalytics()">
          <option value="">كل الشرائح</option>
          <option value="vip">💎 VIP</option>
          <option value="new">🆕 عميل جديد</option>
          <option value="risk">⚠️ معرّض للفقد</option>
          <option value="churned">👋 فقدناه</option>
          <option value="regular">🙂 عادي</option>
        </select>
      </div>
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;" id="saCustKPIs"></div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:10px;">👥 تحليل RFM وترتيب العملاء (Recency / Frequency / Monetary)</div>
        <div class="table-wrap">
        <table><thead><tr><th>العميل</th><th>آخر زيارة</th><th>عدد الزيارات</th><th>إجمالي الإنفاق (صافي)</th><th>القيمة السنوية المتوقعة</th><th>الشريحة</th></tr></thead>
          <tbody id="saCustBody"></tbody></table>
        </div>
      </div>`;
  }
  const segFilter = document.getElementById('saCustSegmentFilter').value;
  const customers = getCustomers();
  const sales = getSales().filter(s => !s.isReturn);
  const now = Date.now();

  const rows = customers.map(c => {
    const custSales = sales.filter(s => s.customerId === c.id || (c.phone && s.customerPhone === c.phone));
    const lastSaleDate = custSales.length ? custSales.reduce((a,s) => s.date > a ? s.date : a, custSales[0].date) : c.lastVisit;
    const recencyDays = lastSaleDate ? Math.floor((now - new Date(lastSaleDate).getTime()) / 86400000) : null;
    const visits = custSales.length || c.visits || 0;
    const monetary = c.totalSpent || 0;

    // Segment (business-meaningful thresholds, not statistical quintiles —
    // more robust than quintile scoring when the customer count is small).
    let segment, segLabel, segColor, segBg;
    if (recencyDays === null) { segment='new'; segLabel='🆕 لم يشترِ بعد'; segColor='#374151'; segBg='#f3f4f6'; }
    else if (recencyDays > 180) { segment='churned'; segLabel='👋 فقدناه'; segColor='#991b1b'; segBg='#fee2e2'; }
    else if (recencyDays > 60 && monetary >= 1000) { segment='risk'; segLabel='⚠️ معرّض للفقد'; segColor='#92400e'; segBg='#fef9c3'; }
    else if (monetary >= 5000 && visits >= 5 && recencyDays <= 60) { segment='vip'; segLabel='💎 VIP'; segColor='#4c1d95'; segBg='#ede9fe'; }
    else if (visits <= 1 && recencyDays <= 30) { segment='new'; segLabel='🆕 عميل جديد'; segColor='#1d4ed8'; segBg='#eff6ff'; }
    else { segment='regular'; segLabel='🙂 عادي'; segColor='#15803d'; segBg='#dcfce7'; }

    // Simple projected annual value: needs at least 2 months of history to
    // avoid extrapolating a single visit into a fictitious "yearly" figure.
    const firstDate = custSales.length ? custSales.reduce((a,s) => s.date < a ? s.date : a, custSales[0].date) : c.createdAt;
    const tenureDays = firstDate ? Math.max(1, (now - new Date(firstDate).getTime()) / 86400000) : 0;
    const projectedAnnual = tenureDays >= 60 ? (monetary / tenureDays) * 365 : null;

    return { c, recencyDays, visits, monetary, segment, segLabel, segColor, segBg, projectedAnnual };
  }).sort((a,b) => b.monetary - a.monetary);

  const filtered = segFilter ? rows.filter(r => r.segment === segFilter) : rows;

  const vipCount = rows.filter(r => r.segment==='vip').length;
  const riskCount = rows.filter(r => r.segment==='risk').length;
  const churnedCount = rows.filter(r => r.segment==='churned').length;
  const totalMonetary = rows.reduce((s,r) => s + r.monetary, 0);

  document.getElementById('saCustKPIs').innerHTML = [
    { label:'إجمالي العملاء', val: customers.length, bg:'#eff6ff', tc:'#1d4ed8' },
    { label:'💎 عملاء VIP', val: vipCount, bg:'#ede9fe', tc:'#4c1d95' },
    { label:'⚠️ معرّضين للفقد', val: riskCount, bg:'#fef9c3', tc:'#92400e' },
    { label:'👋 فقدناهم (180+ يوم)', val: churnedCount, bg:'#fee2e2', tc:'#b91c1c' },
    { label:'إجمالي قيمة العملاء', val: fmt(totalMonetary)+' ج', bg:'#dcfce7', tc:'#15803d' },
  ].map(k => `<div style="background:${k.bg};border-radius:10px;padding:14px;text-align:center;">
    <div style="font-size:20px;font-weight:800;color:${k.tc};">${k.val}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${k.label}</div>
  </div>`).join('');

  document.getElementById('saCustBody').innerHTML = filtered.length ? filtered.map(r => `<tr>
      <td><strong style="cursor:pointer;color:var(--primary);" onclick="openCustomerProfile('${escJsAttr(r.c.id)}')">${escHtml(r.c.name)}</strong></td>
      <td style="font-size:12px;">${r.recencyDays===null ? '—' : r.recencyDays+' يوم'}</td>
      <td>${r.visits}</td>
      <td style="font-weight:700;">${fmt(r.monetary)} ج</td>
      <td style="font-size:12px;color:var(--text-muted);">${r.projectedAnnual!==null ? fmt(r.projectedAnnual)+' ج' : '—'}</td>
      <td><span style="background:${r.segBg};color:${r.segColor};padding:2px 10px;border-radius:20px;font-size:11px;">${r.segLabel}</span></td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">لا يوجد عملاء في هذه الشريحة</td></tr>';
}

// ════════════════════════════════════════════════════
// 5) VENDOR PERFORMANCE — أداء الموردين
// ════════════════════════════════════════════════════
function buildVendorPerformance() {
  const pane = document.getElementById('sa-pane-vendors');
  if (!pane.dataset.built) {
    pane.dataset.built = '1';
    pane.innerHTML = `
      <div class="card">
        <div style="font-weight:700;margin-bottom:4px;">🚚 أداء الموردين</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
          "متوسط مدة التوريد" = الفرق الفعلي بين تاريخ الطلب والاستلام (مفيش تاريخ تسليم متفق عليه مسجّل في النظام حالياً للمقارنة، فمينفعش نحسب "نسبة الالتزام بالموعد" بدقة).
        </div>
        <div class="table-wrap">
        <table><thead><tr><th>المورد</th><th>عدد الطلبات</th><th>إجمالي قيمة الطلبات</th><th>متوسط مدة التوريد</th><th>الرصيد المستحق</th><th>متأخر السداد</th></tr></thead>
          <tbody id="saVendorBody"></tbody></table>
        </div>
      </div>`;
  }
  // Read the shared caches directly rather than through getSuppliers()/
  // getPurchases() — those wrapper functions live in the LAZY purchases
  // chunk (75-purchases.js), which may never have loaded if the admin came
  // straight to Analytics without visiting Purchases first. The caches
  // themselves are core-level globals (00-core.js) kept fresh by the
  // Firestore listeners in 65-firebase.js regardless of which chunks loaded.
  const suppliers = _suppliersCache;
  const purchases = _purchaseCache;
  const now = Date.now();

  const rows = suppliers.map(sup => {
    const pos = purchases.filter(p => p.supplierId === sup.id);
    const received = pos.filter(p => p.status === 'received' && p.receivedAt);
    const totalValue = pos.reduce((s,p) => s + (p.total||0), 0);
    const leadTimes = received.map(p => (p.receivedAt - new Date(p.date).getTime()) / 86400000).filter(d => d >= 0);
    const avgLead = leadTimes.length ? leadTimes.reduce((a,b)=>a+b,0)/leadTimes.length : null;
    const overdue = pos.filter(p => p.status==='received' && (p.payStatus||'unpaid')!=='paid' && p.dueDate && p.dueDate < now);
    const overdueAmt = overdue.reduce((s,p) => s + (p.total - (p.paidAmount||0)), 0);
    return { sup, count: pos.length, totalValue, avgLead, balance: sup.balance||0, overdueAmt };
  }).filter(r => r.count > 0).sort((a,b) => b.totalValue - a.totalValue);

  document.getElementById('saVendorBody').innerHTML = rows.length ? rows.map(r => `<tr>
      <td><strong>${escHtml(r.sup.name)}</strong></td>
      <td>${r.count}</td>
      <td style="font-weight:700;">${fmt(r.totalValue)} ج</td>
      <td>${r.avgLead!==null ? r.avgLead.toFixed(1)+' يوم' : '—'}</td>
      <td>${fmt(r.balance)} ج</td>
      <td style="color:${r.overdueAmt>0?'var(--danger)':'var(--text-muted)'};font-weight:${r.overdueAmt>0?'700':'400'};">${r.overdueAmt>0 ? fmt(r.overdueAmt)+' ج' : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">لا يوجد موردين لديهم طلبات شراء بعد</td></tr>';
}

// ════════════════════════════════════════════════════
// 6) FORECASTED STOCK — توقع نفاد المخزون
// ════════════════════════════════════════════════════
function buildForecastedStock() {
  const pane = document.getElementById('sa-pane-forecast');
  if (!pane.dataset.built) {
    pane.dataset.built = '1';
    pane.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
        <select id="saForecastBranch" class="form-control" style="width:auto;" onchange="buildForecastedStock()"></select>
      </div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:4px;">📉 توقع نفاد المخزون — بناءً على متوسط البيع اليومي لآخر 30 يوم</div>
        <div class="table-wrap">
        <table><thead><tr><th>الكود</th><th>المنتج</th><th>الكمية الحالية</th><th>متوسط البيع اليومي</th><th>أيام متبقية للنفاد</th></tr></thead>
          <tbody id="saForecastBody"></tbody></table>
        </div>
      </div>`;
  }
  _saBranchOptions('saForecastBranch');
  const branchFilter = lockBranchFilter('saForecastBranch');
  const inv = branchFilter === 'all' ? Object.values(_invCacheByBranch).flat() : getInv(branchFilter);

  const since = new Date(); since.setDate(since.getDate() - 30);
  const recentSales = getSales().filter(s => !s.isReturn && new Date(s.date) >= since && (branchFilter === 'all' || s.branchId === branchFilter));
  const soldByCode = {};
  recentSales.forEach(s => (s.items||[]).forEach(i => { soldByCode[i.code] = (soldByCode[i.code]||0) + i.qty; }));

  const rows = inv.map(p => {
    const soldQty = soldByCode[p.code] || 0;
    const dailyRate = soldQty / 30;
    const daysLeft = dailyRate > 0 ? p.qty / dailyRate : null;
    return { ...p, dailyRate, daysLeft };
  }).filter(r => r.daysLeft !== null).sort((a,b) => a.daysLeft - b.daysLeft);

  document.getElementById('saForecastBody').innerHTML = rows.length ? rows.map(p => {
    const urgent = p.daysLeft <= 7;
    const soon = p.daysLeft <= 14;
    return `<tr style="${urgent?'background:#fff5f5;':''}">
      <td>${escHtml(p.code)}</td><td>${escHtml(p.name)}</td><td>${p.qty}</td>
      <td>${p.dailyRate.toFixed(2)}</td>
      <td style="font-weight:700;color:${urgent?'var(--danger)':soon?'#d97706':'var(--text-muted)'};">${Math.round(p.daysLeft)} يوم</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="text-center text-muted" style="padding:20px;">لا توجد بيانات مبيعات كافية لهذه الفترة لعمل توقع</td></tr>';
}
