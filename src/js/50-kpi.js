// ══════════════════════════════════════════════
// KPI REPORT
// ══════════════════════════════════════════════
let chartKPI = null, chartSellers = null;

function buildKPIReport() {
  const period = document.getElementById('rptKpiPeriod').value;
  document.getElementById('rptKpiCustom').classList.toggle('hidden', period!=='custom');
  const { from, to } = getDateRange(period, 'rptKpiFrom', 'rptKpiTo');
  const rbf = document.getElementById('rptKpiBranchFilter');
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
  const sales = getSales()
    .filter(s => branchFilter === 'all' || s.branchId === branchFilter)
    .filter(s => { const d=new Date(s.date); return d>=from&&d<=to; });
  // Per-transaction stats (avg ticket, units/ticket, card%) shouldn't count
  // a return as if it were another purchase transaction — a return isn't a
  // new sale, it's a reversal of a prior one, so leaving it in `count`
  // understates ATV/UPT/card% every time a return happens in the period.
  // Revenue/cost below deliberately keep returns IN `sales` — return items
  // carry negative qty/total, so combining them nets those figures
  // correctly, same convention as buildProfitReport()/93-accounting.js.
  const purchaseSales = sales.filter(s => !s.isReturn);

  const count      = purchaseSales.length;
  const revenue    = sales.reduce((s,x)=>s+x.total,0);
  const totalUnits = purchaseSales.reduce((s,x)=>s+x.items.reduce((a,i)=>a+i.qty,0),0);
  const totalDisc  = sales.reduce((s,x)=>s+(x.disc||0),0);
  const cardCount  = purchaseSales.filter(s=>s.payMethod==='card').length;

  let totalCost = 0;
  sales.forEach(s => s.items.forEach(i => {
    const cost = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost||0);
    totalCost += cost * i.qty;
  }));

  const atv      = count ? revenue/count : 0;
  const upt      = count ? totalUnits/count : 0;
  const gm       = revenue ? (revenue-totalCost)/revenue*100 : 0;
  const cardPct  = count ? cardCount/count*100 : 0;
  const discPct  = revenue ? totalDisc/revenue*100 : 0;

  const turnFrom = document.getElementById('turnoverFrom')?.value;
  const turnTo   = document.getElementById('turnoverTo')?.value;
  const tvSales  = getSales().filter(s => branchFilter === 'all' || s.branchId === branchFilter).filter(s => {
    if (!turnFrom && !turnTo) return true;
    const d = s.date.slice(0,10);
    return (!turnFrom || d>=turnFrom) && (!turnTo || d<=turnTo);
  });
  let cogs = 0;
  tvSales.forEach(s => s.items.forEach(i => {
    const cost = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost||0);
    cogs += cost * i.qty;
  }));
  const invValue = inv.reduce((s,p)=>s+(p.cost||0)*p.qty, 0);
  const turnover = invValue ? cogs / invValue : 0;

  animateNumber(document.getElementById('kpi-atv'),      atv, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('kpi-upt'),      upt, { format: (n) => n.toFixed(2) });
  animateNumber(document.getElementById('kpi-gm'),       gm, { format: (n) => n.toFixed(1), suffix: '%' });
  animateNumber(document.getElementById('kpi-turnover'), turnover, { format: (n) => n.toFixed(2), suffix: '×' });
  animateNumber(document.getElementById('kpi-card-pct'), cardPct, { format: (n) => n.toFixed(1), suffix: '%' });
  animateNumber(document.getElementById('kpi-disc-pct'), discPct, { format: (n) => n.toFixed(1), suffix: '%' });
  animateNumber(document.getElementById('tv-cogs'),      cogs, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('tv-inv'),       invValue, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('tv-rate'),      turnover, { format: (n) => n.toFixed(2), suffix: '×' });

  const dayMap = {};
  sales.forEach(s => { const d=s.date.slice(0,10); dayMap[d]=(dayMap[d]||0)+s.total; });
  const days = Object.keys(dayMap).sort();
  if (chartKPI) chartKPI.destroy();
  chartKPI = new Chart(document.getElementById('chartKPI'), {
    type:'line',
    data:{ labels:days, datasets:[{data:days.map(d=>dayMap[d]),borderColor:'#1a5faf',backgroundColor:'rgba(26,95,175,.1)',fill:true,tension:.3,label:'المبيعات'}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}, responsive:true }
  });

  buildHeatmap(purchaseSales);
}

