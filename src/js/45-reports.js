// ══════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════
function switchReport(name, tab) {
  ['rpt-sales','rpt-inventory','rpt-profit','rpt-kpi','rpt-sellers','rpt-returns'].forEach(id => { var el = document.getElementById(id); if(el) el.classList.add('hidden'); });
  document.getElementById('rpt-'+name).classList.remove('hidden');
  document.querySelectorAll('#page-reports .tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  if (name==='sales')     buildSalesReport();
  if (name==='inventory') buildInventoryReport();
  if (name==='profit')    buildProfitReport();
  if (name==='kpi')       buildKPIReport();
  if (name==='sellers')   buildSellersReport();
  if (name==='returns')   buildReturnsReport();

}

function populateSellerFilter(selId) {
  const sel = document.getElementById(selId); if (!sel) return;
  const cur = sel.value;
  const people = getSalespeople().map(salespersonName);
  // Include 'غير محدد' if any sale lacks salesperson
  const all = getSales().map(s => s.salesperson || '');
  const hasBlank = all.some(x => !x);
  sel.innerHTML = '<option value="">👤 كل البائعين</option>' +
    people.map(n=>`<option value="${n}">${n}</option>`).join('') +
    (hasBlank ? '<option value="__none__">غير محدد</option>' : '');
  if (cur) sel.value = cur;
}

function getPrevSales(period, fromId, toId) {
  // Return sales for the equivalent previous period
  const { from, to } = getDateRange(period, fromId, toId);
  const dur = to - from;
  const prevTo   = new Date(from - 1);
  const prevFrom = new Date(from - dur - 1);
  return getSales().filter(s => { const d=new Date(s.date); return d>=prevFrom&&d<=prevTo; });
}

function renderCmpRow(containerId, cur, prev, labels) {
  // cur/prev: plain objects { key: value }
  const el = document.getElementById(containerId); if (!el) return;
  el.innerHTML = labels.map(({key, label, unit}) => {
    const c = cur[key] || 0, p = prev[key] || 0;
    const diff = c - p;
    const pct  = p ? (diff/p*100) : (c ? 100 : 0);
    const cls  = diff > 0 ? 'cmp-up' : diff < 0 ? 'cmp-down' : 'cmp-flat';
    const arrow= diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
    const displayVal = unit === 'pct' ? c.toFixed(1)+'%' : fmt(c)+' ج';
    return `<div class="cmp-card">
      <div class="cmp-label">${label}</div>
      <div class="cmp-val">${displayVal}</div>
      <div class="cmp-delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}% مقارنة بالفترة السابقة</div>
    </div>`;
  }).join('');
}

function buildSalesReport() {
  const period = document.getElementById('rptSalesPeriod').value;
  document.getElementById('rptSalesCustom').classList.toggle('hidden', period!=='custom');
  populateSellerFilter('rptSalesSellerFilter');
  // Populate branch filter
  const rbf = document.getElementById('rptBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter  = lockBranchFilter('rptBranchFilter');
  const sellerFilter  = document.getElementById('rptSalesSellerFilter')?.value || '';
  const { from, to }  = getDateRange(period, 'rptSalesFrom', 'rptSalesTo');
  let sales = getSales().filter(s => !s.isReturn && (()=>{ const d=new Date(s.date); return d>=from&&d<=to; })());
  if (branchFilter !== 'all') sales = sales.filter(s => s.branchId === branchFilter);
  if (sellerFilter) {
    sales = sales.filter(s => sellerFilter==='__none__'
      ? !s.salesperson : s.salesperson===sellerFilter);
  }
  const net = sales.reduce((s,x)=>s+x.total,0);
  const sub = sales.reduce((s,x)=>s+x.sub,0);
  animateNumber(document.getElementById('rs-total'), sub, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('rs-net'),   net, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('rs-count'), sales.length);
  animateNumber(document.getElementById('rs-avg'),   sales.length ? net/sales.length : 0, { format: fmt, suffix: ' ج' });

  if (period !== 'custom') {
    let prevSales = getPrevSales(period, 'rptSalesFrom', 'rptSalesTo');
    if (sellerFilter) prevSales = prevSales.filter(s => sellerFilter==='__none__' ? !s.salesperson : s.salesperson===sellerFilter);
    const prevNet = prevSales.reduce((s,x)=>s+x.total,0);
    const prevAvg = prevSales.length ? prevNet/prevSales.length : 0;
    renderCmpRow('salesCmpRow',
      { net, count: sales.length, avg: sales.length ? net/sales.length : 0 },
      { net: prevNet, count: prevSales.length, avg: prevAvg },
      [
        { key:'net',   label:'الإيرادات',     unit:'amount' },
        { key:'count', label:'الفواتير',       unit:'amount' },
        { key:'avg',   label:'متوسط الفاتورة', unit:'amount' }
      ]
    );
  } else {
    document.getElementById('salesCmpRow').innerHTML = '';
  }

  const dayMap = {};
  sales.forEach(s => { const d=s.date.slice(0,10); dayMap[d]=(dayMap[d]||0)+s.total; });
  const days = Object.keys(dayMap).sort();
  if (chartRptSales) chartRptSales.destroy();
  chartRptSales = new Chart(document.getElementById('chartRptSales'), {
    type:'line',
    data:{ labels:days, datasets:[{data:days.map(d=>dayMap[d]),borderColor:'#1a5faf',backgroundColor:'rgba(26,95,175,.1)',fill:true,tension:.3,label:'المبيعات'}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}, responsive:true }
  });

  const bd = {};
  sales.forEach(s=>s.items.forEach(i=>{ if(!bd[i.code]) bd[i.code]={name:i.name,qty:0,rev:0}; bd[i.code].qty+=i.qty; bd[i.code].rev+=i.price*i.qty; }));
  const sorted = Object.values(bd).sort((a,b)=>b.rev-a.rev);
  document.getElementById('rs-breakdown').innerHTML = !sorted.length
    ? '<tr><td colspan="3" class="text-center text-muted" style="padding:16px;">لا توجد مبيعات</td></tr>'
    : sorted.map(d=>`<tr><td>${escHtml(d.name)}</td><td>${d.qty}</td><td><strong>${fmt(d.rev)} ج</strong></td></tr>`).join('');
}

function buildInventoryReport() {
  const rbf = document.getElementById('rptInventoryBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter = rbf?.value || 'all';
  const inv = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  const thresh = getThreshold();
  const costVal = inv.reduce((s,p)=>s+(p.cost||0)*p.qty,0);
  const sellVal = inv.reduce((s,p)=>s+p.priceAfter*p.qty,0);
  const units   = inv.reduce((s,p)=>s+p.qty,0);
  animateNumber(document.getElementById('ri-count'), inv.length);
  animateNumber(document.getElementById('ri-cost'),  costVal, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('ri-sell'),  sellVal, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('ri-units'), units);
  const sorted = [...inv].sort((a,b)=>a.qty-b.qty);
  document.getElementById('ri-body').innerHTML = sorted.map(p => {
    const stockVal = p.priceAfter*p.qty;
    const profit   = (p.priceAfter-(p.cost||0))*p.qty;
    return `<tr>
      <td>${escHtml(p.code)}</td><td>${escHtml(p.name)}</td><td><strong>${p.qty}</strong></td>
      <td>${fmt(p.cost||0)}</td><td>${fmt(p.priceAfter)}</td>
      <td>${fmt(stockVal)} ج</td>
      <td style="color:${profit>=0?'var(--success)':'var(--danger)'};">${fmt(profit)} ج</td>
      <td><span class="badge ${p.qty<=0?'badge-danger':p.qty<=thresh?'badge-warning':'badge-success'}">
        ${p.qty<=0?'نفد':p.qty<=thresh?'منخفض':'متوفر'}
      </span></td>
    </tr>`;
  }).join('');
}

function buildProfitReport() {
  const period = document.getElementById('rptProfitPeriod').value;
  document.getElementById('rptProfitCustom').classList.toggle('hidden', period!=='custom');
  populateSellerFilter('rptProfitSellerFilter');
  const sellerFilter = document.getElementById('rptProfitSellerFilter')?.value || '';
  const { from, to } = getDateRange(period, 'rptProfitFrom', 'rptProfitTo');
  const rbf = document.getElementById('rptProfitBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter = rbf?.value || 'all';
  const inv   = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  let sales = getSales()
    .filter(s => branchFilter === 'all' || s.branchId === branchFilter)
    .filter(s => { const d=new Date(s.date); return d>=from&&d<=to; });
  if (sellerFilter) {
    sales = sales.filter(s => sellerFilter==='__none__'
      ? !s.salesperson : s.salesperson===sellerFilter);
  }

  const bd = {};
  sales.forEach(s => s.items.forEach(i => {
    const cost = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost || 0);
    if (!bd[i.code]) bd[i.code]={name:i.name,qty:0,rev:0,cost:0};
    bd[i.code].qty+=i.qty; bd[i.code].rev+=i.price*i.qty; bd[i.code].cost+=cost*i.qty;
  }));

  const revenue    = sales.reduce((s,x)=>s+x.total,0);
  const totalCost  = Object.values(bd).reduce((s,x)=>s+x.cost,0);
  const totalDisc  = sales.reduce((s,x)=>s+(x.disc||0),0);
  const profit     = revenue - totalCost;
  const margin     = revenue ? profit/revenue*100 : 0;

  animateNumber(document.getElementById('rp-revenue'),   revenue, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('rp-cost'),      totalCost, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('rp-profit'),    profit, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('rp-margin'),    margin, { format: (n) => n.toFixed(1), suffix: '%' });
  animateNumber(document.getElementById('rp-discounts'), totalDisc, { format: fmt, suffix: ' ج' });

  if (period !== 'custom') {
    let prevSales = getPrevSales(period, 'rptProfitFrom', 'rptProfitTo');
    if (sellerFilter) prevSales = prevSales.filter(s => sellerFilter==='__none__' ? !s.salesperson : s.salesperson===sellerFilter);
    const prevRevenue = prevSales.reduce((s,x)=>s+x.total,0);
    let prevCost = 0;
    prevSales.forEach(s => s.items.forEach(i => {
      const c = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost||0);
      prevCost += c * i.qty;
    }));
    const prevProfit = prevRevenue - prevCost;
    renderCmpRow('profitCmpRow',
      { revenue, profit, margin },
      { revenue: prevRevenue, profit: prevProfit, margin: prevRevenue ? (prevRevenue-prevCost)/prevRevenue*100 : 0 },
      [
        { key:'revenue', label:'الإيرادات',  unit:'amount' },
        { key:'profit',  label:'صافي الربح', unit:'amount' },
        { key:'margin',  label:'هامش الربح', unit:'pct'    }
      ]
    );
  } else {
    document.getElementById('profitCmpRow').innerHTML = '';
  }

  if (chartProfit) chartProfit.destroy();
  chartProfit = new Chart(document.getElementById('chartProfit'), {
    type:'bar',
    data:{
      labels:['الإيرادات','التكلفة','صافي الربح'],
      datasets:[{data:[revenue,totalCost,profit],backgroundColor:['rgba(200,25,60,.8)','rgba(168,20,47,.6)','rgba(22,163,74,.75)'],borderRadius:8}]
    },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}, responsive:true }
  });

  const sorted2 = Object.values(bd).sort((a,b)=>(b.rev-b.cost)-(a.rev-a.cost));
  document.getElementById('rp-breakdown').innerHTML = !sorted2.length
    ? '<tr><td colspan="6" class="text-center text-muted" style="padding:16px;">لا توجد بيانات</td></tr>'
    : sorted2.map(d => {
        const p=d.rev-d.cost, m=d.rev?p/d.rev*100:0;
        return `<tr><td>${escHtml(d.name)}</td><td>${d.qty}</td><td>${fmt(d.rev)} ج</td><td>${fmt(d.cost)} ج</td>
          <td style="color:${p>=0?'var(--success)':'var(--danger)'};font-weight:700;">${fmt(p)} ج</td>
          <td>${m.toFixed(1)}%</td></tr>`;
      }).join('');
}

// ══════════════════════════════════════════
// CUSTOMIZED REPORTS PAGE
// ══════════════════════════════════════════
function getDateRangeForPeriod(period) {
  var now = new Date();
  var from, to;
  to = now.toISOString().slice(0,10);
  if (period === 'today') {
    from = to;
  } else if (period === 'week') {
    var d = new Date(now); d.setDate(d.getDate() - d.getDay());
    from = d.toISOString().slice(0,10);
  } else if (period === 'month') {
    from = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
  } else if (period === 'year') {
    from = now.getFullYear() + '-01-01';
  } else {
    return null; // custom
  }
  return {from: from, to: to};
}

function onCustPeriodChange() {
  var period = document.getElementById('custRptPeriod')?.value;
  var customDiv = document.getElementById('custRptCustomDates');
  if (period === 'custom') {
    customDiv.classList.remove('hidden');
    customDiv.style.display = 'flex';
  } else {
    customDiv.classList.add('hidden');
  }
  renderCustomizedPage();
}

function renderCustomizedPage() {
  var period = document.getElementById('custRptPeriod')?.value || 'month';
  var from, to;
  if (period === 'custom') {
    from = document.getElementById('custRptFrom')?.value || '';
    to   = document.getElementById('custRptTo')?.value   || '';
  } else {
    var range = getDateRangeForPeriod(period);
    from = range ? range.from : '';
    to   = range ? range.to   : '';
  }
  renderCategoryReport(from, to);
}

// Pivot analyzer + period comparison live in 115-pivot-reports.js (a lazy
// chunk, see _CHUNK_FILES in 00-core.js) since they're heavier, less-used
// tools than the always-loaded category report above. This function is the
// entry point that stays in the core bundle so the mode-switch buttons work
// immediately; it loads the chunk on first use before calling into it.
function switchCustomMode(mode) {
  if ((mode === 'pivot' || mode === 'compare') && !_loadedChunks.has('pivot')) {
    _loadChunk('pivot', () => switchCustomMode(mode));
    return;
  }
  ['category', 'pivot', 'compare'].forEach(m => {
    document.getElementById('custPane_' + m)?.classList.toggle('hidden', m !== mode);
    const btn = document.getElementById('custModeBtn_' + m);
    if (btn) {
      btn.style.background = m === mode ? 'white' : '';
      btn.style.fontWeight  = m === mode ? '700' : '400';
      btn.style.boxShadow   = m === mode ? '0 1px 4px rgba(0,0,0,.1)' : '';
    }
  });
  if (mode === 'pivot')   renderPivotUI();
  if (mode === 'compare') renderCompareUI();
}

