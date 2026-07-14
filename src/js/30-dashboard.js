// ══════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════
function setDashRange(days) {
  _dashRange = days;
  // Update button styles
  [7,30,90,365].forEach(d => {
    const btn = document.getElementById('dbr-'+d);
    if (!btn) return;
    btn.className = d === days ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    btn.style.fontSize = '11px'; btn.style.padding = '3px 10px';
  });
  buildDashboard();
}

// Helper: calc profit from a sales array
function calcProfit(salesArr, inv) {
  return salesArr.reduce((acc, s) => {
    return acc + s.items.reduce((a, i) => {
      const cost = i.cost > 0 ? i.cost : (inv.find(x => x.code === i.code)?.cost || 0);
      return a + (i.price - cost) * i.qty;
    }, 0) - (s.disc || 0);
  }, 0);
}

// Helper: delta badge HTML
function deltaBadge(curr, prev, isPercent) {
  if (prev === 0) return '<span style="color:#94a3b8; font-size:11px;">لا يوجد مقارنة</span>';
  const pct = Math.round((curr - prev) / Math.abs(prev) * 100);
  const up = pct >= 0;
  const arrow = up ? '▲' : '▼';
  const color = up ? '#16a34a' : '#dc2626';
  const label = isPercent ? `${curr > 0 ? '+' : ''}${pct}%` : `${arrow} ${Math.abs(pct)}%`;
  return `<span style="color:${color}; font-size:12px; font-weight:700;">${arrow} ${Math.abs(pct)}%</span>
          <span style="color:#94a3b8; font-size:10px; margin-right:4px;">vs السابق</span>`;
}

// Branch managers (isBranchManager) see the dashboard locked to their own
// branch — the branch filter is disabled, and the cross-branch comparison
// chart (which always compares ALL branches regardless of the filter) is
// hidden outright since it would leak other branches' revenue otherwise.
function applyBranchDashboardFilter() {
  const isAdmin = (currentUser === 'admin');
  const dbf = document.getElementById('dashBranchFilter');
  if (dbf) {
    dbf.disabled = !isAdmin;
    if (!isAdmin) dbf.value = currentBranch;
  }
  const cmpCard = document.getElementById('dashBranchCompareCard');
  if (cmpCard) cmpCard.style.display = isAdmin ? '' : 'none';
}

function buildDashboard() {
  // Populate branch filter dropdown
  const dbf = document.getElementById('dashBranchFilter');
  if (dbf && dbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!dbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        dbf.appendChild(o);
      }
    });
  }
  applyBranchDashboardFilter();
  const branchFilter = dbf?.value || 'all';

  const allSales = getSales().filter(s => !s.isReturn);
  const sales = branchFilter === 'all' ? allSales : allSales.filter(s => s.branchId === branchFilter);
  const inv   = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  const thresh = getThreshold();

  // ── Date range filter ──
  const now = new Date();
  const rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate() - _dashRange + 1); rangeStart.setHours(0,0,0,0);
  const prevStart  = new Date(rangeStart); prevStart.setDate(prevStart.getDate() - _dashRange);
  const prevEnd    = new Date(rangeStart); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23,59,59,999);

  const today = now.toDateString();
  const thisMonth = now.toISOString().slice(0,7);

  // Get prev month
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0,7);

  const todaySales  = sales.filter(s => new Date(s.date).toDateString() === today);
  const rangeSales  = sales.filter(s => { const d = new Date(s.date); return d >= rangeStart && d <= now; });
  const monthSales  = sales.filter(s => s.date.startsWith(thisMonth));
  const prevMonthSales = sales.filter(s => s.date.startsWith(prevMonth));

  const low  = inv.filter(p => p.qty > 0  && p.qty <= thresh);
  const out  = inv.filter(p => p.qty <= 0);

  // Range label
  const labelEl = document.getElementById('dashRangeLabel');
  if (labelEl) {
    labelEl.textContent = `${rangeStart.toLocaleDateString('ar-EG',{day:'numeric',month:'short'})} — ${now.toLocaleDateString('ar-EG',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  // Profit for range period
  const rangeProfit = calcProfit(rangeSales, inv);
  const monthProfit = calcProfit(monthSales, inv);
  const prevMonthProfit = calcProfit(prevMonthSales, inv);

  animateNumber(document.getElementById('sd-today'),    todaySales.reduce((s,x) => s+x.total,0), { format: fmt, suffix: ' ج' });
  document.getElementById('sd-today-c').textContent   = todaySales.length + ' فاتورة';
  animateNumber(document.getElementById('sd-month'),    rangeSales.reduce((s,x) => s+x.total,0), { format: fmt, suffix: ' ج' });
  document.getElementById('sd-month-c').textContent   = rangeSales.length + ' فاتورة';
  animateNumber(document.getElementById('sd-profit'),   rangeProfit, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('sd-products'), inv.length);
  animateNumber(document.getElementById('sd-low'),      low.length);
  animateNumber(document.getElementById('sd-out'),      out.length);
  updateLowStockBell();

  // ── Month vs Prev Month comparison cards ──
  const thisRev  = monthSales.reduce((s,x) => s+x.total, 0);
  const prevRev  = prevMonthSales.reduce((s,x) => s+x.total, 0);
  const thisOrders = monthSales.length;
  const prevOrders = prevMonthSales.length;
  const thisATV  = thisOrders > 0 ? thisRev / thisOrders : 0;
  const prevATV  = prevOrders > 0 ? prevRev / prevOrders : 0;
  const thisMargin = thisRev > 0 ? Math.round(monthProfit / thisRev * 100) : 0;
  const prevMargin = prevRev > 0 ? Math.round(prevMonthProfit / prevRev * 100) : 0;

  const _pulse = (el) => {
    if (!el) return;
    el.classList.remove('dash-pulse');
    void el.offsetWidth; // force reflow so the animation can restart
    el.classList.add('dash-pulse');
  };
  const cmpEl = (id, val, prev, unit) => {
    const el = document.getElementById(id);
    const deltaEl = document.getElementById(id+'-delta');
    if (el) animateNumber(el, val, { format: fmt, suffix: unit||'' });
    if (deltaEl) { deltaEl.innerHTML = deltaBadge(val, prev); _pulse(deltaEl); }
  };
  cmpEl('cmp-rev',    thisRev,    prevRev,    ' ج');
  cmpEl('cmp-profit', monthProfit, prevMonthProfit, ' ج');
  cmpEl('cmp-orders', thisOrders, prevOrders, ' ف');
  cmpEl('cmp-atv',    thisATV,    prevATV,    ' ج');
  const cmpMarginEl = document.getElementById('cmp-margin');
  const cmpMarginDelta = document.getElementById('cmp-margin-delta');
  if (cmpMarginEl) animateNumber(cmpMarginEl, thisMargin, { suffix: '%' });
  if (cmpMarginDelta) { cmpMarginDelta.innerHTML = deltaBadge(thisMargin, prevMargin); _pulse(cmpMarginDelta); }

  // ── Weekly chart (last 7 days) ──
  const days = Array.from({length:7}, (_,i) => { const d=new Date(); d.setDate(d.getDate()-6+i); return d; });
  const weeklyData = days.map(d => sales.filter(s=>new Date(s.date).toDateString()===d.toDateString()).reduce((s,x)=>s+x.total,0));
  if (chartWeekly) chartWeekly.destroy();
  chartWeekly = new Chart(document.getElementById('chartWeekly'), {
    type:'bar',
    data:{ labels:days.map(d=>d.toLocaleDateString('ar-EG',{weekday:'short',day:'numeric'})), datasets:[{data:weeklyData,backgroundColor:'rgba(200,25,60,.75)',borderRadius:6,label:'المبيعات'}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{callback:v=>v>0?fmt(v):'0'}}}, responsive:true }
  });

  // ── Top products doughnut ──
  const ps = {};
  monthSales.forEach(s=>s.items.forEach(i=>{ ps[i.name]=(ps[i.name]||0)+i.qty; }));
  const top5 = Object.entries(ps).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (chartTop) chartTop.destroy();
  if (top5.length) {
    chartTop = new Chart(document.getElementById('chartTop'), {
      type:'doughnut',
      data:{ labels:top5.map(x=>x[0]), datasets:[{data:top5.map(x=>x[1]),backgroundColor:['#1a5faf','#F47920','#2472cc','#134a8a','#5b9bd5']}] },
      options:{ plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}, responsive:true }
    });
  }

  // ── 6-month revenue trend line chart ──
  const trendMonths = Array.from({length:6}, (_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { key: d.toISOString().slice(0,7), label: d.toLocaleDateString('ar-EG',{month:'short',year:'2-digit'}) };
  });
  const trendData = trendMonths.map(m => sales.filter(s=>s.date.startsWith(m.key)).reduce((s,x)=>s+x.total,0));
  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(document.getElementById('chartTrend'), {
    type:'line',
    data:{
      labels: trendMonths.map(m=>m.label),
      datasets:[{ data:trendData, borderColor:'#1a5faf', backgroundColor:'rgba(26,95,175,.08)', tension:.4, fill:true, pointBackgroundColor:'#1a5faf', pointRadius:5, label:'الإيرادات' }]
    },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{callback:v=>fmt(v)}}}, responsive:true }
  });

  // ── Branch comparison horizontal bar chart ──
  const branches = getBranches();
  const branchLabels = BRANCH_IDS.map(b => branches[b]||BRANCH_DEFAULTS[b]);
  const branchRevs   = BRANCH_IDS.map(b => allSales.filter(s=>s.date.startsWith(thisMonth)&&s.branchId===b).reduce((s,x)=>s+x.total,0));
  if (chartBranches) chartBranches.destroy();
  chartBranches = new Chart(document.getElementById('chartBranches'), {
    type:'bar',
    data:{
      labels: branchLabels,
      datasets:[{ data:branchRevs, backgroundColor:['#1a5faf','#F47920','#d97706','#7c3aed'], borderRadius:6, label:'الإيرادات' }]
    },
    options:{
      indexAxis:'y',
      plugins:{legend:{display:false}},
      scales:{x:{beginAtZero:true,ticks:{callback:v=>fmt(v)}}},
      responsive:true
    }
  });

  // ── Executive KPIs ──
  const monthRevenue = thisRev;
  const marginPct    = thisMargin;
  const invValue     = inv.reduce((s,i)=>s+(i.cost||0)*(i.qty||0),0);
  const cogs = monthSales.reduce((acc,s)=>acc+s.items.reduce((a,i)=>{
    const c = i.cost>0?i.cost:(inv.find(x=>x.code===i.code)?.cost||0);
    return a + c*i.qty; },0),0);
  const turnover = invValue > 0 ? (cogs / invValue) : 0;
  const dailyRevenue = monthRevenue / now.getDate();
  const coverage = dailyRevenue > 0 ? Math.round(invValue / dailyRevenue) : 0;
  const hrRec = getHR().find(h=>h.month===thisMonth);
  const totalTarget = hrRec ? Object.values(hrRec.targets||{}).reduce((s,t)=>s+(t.target||0),0) : 0;
  const achievePct  = totalTarget > 0 ? Math.round(monthRevenue/totalTarget*100) : 0;

  const execMargin   = document.getElementById('exec-margin');
  const execTarget   = document.getElementById('exec-target');
  const execTargetSub= document.getElementById('exec-target-sub');
  const execTurnover = document.getElementById('exec-turnover');
  const execCoverage = document.getElementById('exec-coverage');
  const execInvVal   = document.getElementById('exec-inv-value');
  if (execMargin)    { animateNumber(execMargin, marginPct, { suffix: '%' }); execMargin.style.color = marginPct>=20?'#7c3aed':marginPct>=10?'#d97706':'#dc2626'; }
  if (execTarget)    { if (totalTarget>0) animateNumber(execTarget, achievePct, { suffix: '%' }); else execTarget.textContent = '-'; }
  if (execTargetSub) { execTargetSub.textContent = totalTarget>0 ? `هدف: ${fmt(totalTarget)} ج` : 'لم يُحدد هدف'; }
  if (execTurnover)  animateNumber(execTurnover, turnover, { format: (n) => n.toFixed(1), suffix: 'x' });
  if (execCoverage)  animateNumber(execCoverage, coverage);
  if (execInvVal)    animateNumber(execInvVal, invValue, { format: fmt, suffix: ' ج' });

  // Low stock list
  const allAlert = [...out, ...low].sort((a,b) => a.qty-b.qty);
  const dashEl = document.getElementById('dashLowStock');
  if (!allAlert.length) {
    dashEl.innerHTML = '<div class="text-center text-muted" style="padding:20px;">لا توجد منتجات تحتاج تجديد 👍</div>';
  } else {
    dashEl.innerHTML = `<table style="width:100%;"><thead><tr><th>الكود</th><th>الاسم</th><th>الكمية الحالية</th><th>الحالة</th></tr></thead><tbody>
      ${allAlert.map(p=>`<tr><td>${escHtml(p.code)}</td><td>${escHtml(p.name)}</td><td><strong>${p.qty}</strong></td>
        <td><span class="badge ${p.qty<=0?'badge-danger':'badge-warning'}">${p.qty<=0?'نفد المخزون':'مخزون منخفض'}</span></td></tr>`).join('')}
    </tbody></table>`;
  }
}

