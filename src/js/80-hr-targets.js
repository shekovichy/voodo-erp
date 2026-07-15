// ══════════════════════════════════════════════
// HR SYSTEM — TARGETS & COMMISSION
// ══════════════════════════════════════════════

const getHR = () => _hrCache;
function setHR(list) {
  _hrCache = list;
  DB.s('pos_hr', list);
  try { _db && _db.collection('pos_data').doc('hr').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function openHRTargetModal() {
  const today = new Date();
  const thisMonth = today.toISOString().slice(0,7);
  document.getElementById('hrTargetMonth').value = thisMonth;
  const salespeople = (getSalespeople ? getSalespeople() : (DB.g('pos_salespeople',[])))
    .map(sp => typeof sp === 'string' ? sp : sp.name);
  const hrList = getHR();
  const existing = hrList.find(h => h.month === thisMonth) || { targets: {} };
  const tbody = document.getElementById('hrTargetBody');
  if (!salespeople.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted" style="padding:16px;">لا يوجد بائعون — أضفهم من الإعدادات أولاً</td></tr>';
  } else {
    tbody.innerHTML = salespeople.map(name => `<tr>
      <td style="padding:8px; font-weight:600;">${escHtml(name)}</td>
      <td style="padding:8px;"><input type="number" class="form-control" id="hr-target-${name}" value="${existing.targets[name]?.target||0}" min="0" placeholder="0" /></td>
      <td style="padding:8px;"><input type="number" class="form-control" id="hr-comm-${name}" value="${existing.targets[name]?.commPct||0}" min="0" max="100" step="0.5" placeholder="0" /></td>
    </tr>`).join('');
  }
  document.getElementById('hrTargetModal').classList.remove('hidden');
}

function saveHRTargets() {
  const month = document.getElementById('hrTargetMonth').value;
  if (!month) { showToast('اختر الشهر'); return; }
  const salespeople = (getSalespeople ? getSalespeople() : (DB.g('pos_salespeople',[])))
    .map(sp => typeof sp === 'string' ? sp : sp.name);
  const targets = {};
  salespeople.forEach(name => {
    targets[name] = {
      target:  parseFloat(document.getElementById(`hr-target-${name}`)?.value) || 0,
      commPct: parseFloat(document.getElementById(`hr-comm-${name}`)?.value) || 0
    };
  });
  const list = getHR().filter(h => h.month !== month);
  list.push({ month, targets, updatedAt: Date.now() });
  setHR(list);
  closeModal('hrTargetModal');
  renderHRPage();
}

function populateHRMonthFilter() {
  const sel = document.getElementById('hrMonthFilter'); if (!sel) return;
  const months = [...new Set(getHR().map(h=>h.month))].sort().reverse();
  const today = new Date().toISOString().slice(0,7);
  sel.innerHTML = `<option value="">الشهر الحالي (${today})</option>` +
    months.map(m => `<option value="${m}">${m}</option>`).join('');
}

function renderHRPage() {
  populateHRMonthFilter();
  const selMonth = document.getElementById('hrMonthFilter')?.value || new Date().toISOString().slice(0,7);
  const hrRec = getHR().find(h => h.month === selMonth) || { targets: {} };
  const targets = hrRec.targets || {};
  const salespeople = (getSalespeople ? getSalespeople() : (DB.g('pos_salespeople',[])))
    .map(sp => typeof sp === 'string' ? sp : sp.name);

  // Calculate actual sales per person for selected month
  const allSales = getSales().filter(s => !s.isReturn && s.date && s.date.slice(0,7) === selMonth);
  const salesBySP = {};
  allSales.forEach(s => {
    const sp = s.salesperson || 'غير محدد';
    salesBySP[sp] = (salesBySP[sp] || 0) + s.total;
  });

  // Build rows
  const rows = salespeople.map(name => {
    const t = targets[name] || { target: 0, commPct: 0 };
    const actual = salesBySP[name] || 0;
    const pct    = t.target > 0 ? Math.min((actual / t.target) * 100, 200) : 0;
    const commission = actual * (t.commPct / 100);
    return { name, target: t.target, commPct: t.commPct, actual, pct, commission };
  });
  // Add any salesperson who sold but isn't in the list
  Object.keys(salesBySP).forEach(name => {
    if (!rows.find(r => r.name === name)) {
      const actual = salesBySP[name];
      rows.push({ name, target: 0, commPct: 0, actual, pct: 0, commission: 0 });
    }
  });

  // Summary KPIs
  const totalTarget = rows.reduce((s,r)=>s+r.target,0);
  const totalSales  = rows.reduce((s,r)=>s+r.actual,0);
  const totalComm   = rows.reduce((s,r)=>s+r.commission,0);
  const achievePct  = totalTarget > 0 ? Math.round(totalSales/totalTarget*100) : 0;
  animateNumber(document.getElementById('hr-total-target'),     totalTarget, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('hr-total-sales'),      totalSales, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('hr-achieve-pct'),      achievePct, { suffix: '%' });
  animateNumber(document.getElementById('hr-total-commission'), totalComm, { format: fmt, suffix: ' ج' });

  // Render cards
  const container = document.getElementById('hrSalespeople'); if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--text-muted);">لا يوجد بائعون — أضفهم من الإعدادات</div>';
    return;
  }
  container.innerHTML = rows.map(r => {
    const barColor = r.pct >= 100 ? 'var(--success)' : r.pct >= 70 ? 'var(--warning)' : 'var(--danger)';
    const badge    = r.pct >= 100 ? '🏆 تجاوز الهدف!' : r.pct >= 70 ? '👍 جيد' : '⚠️ دون الهدف';
    return `<div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div style="font-size:17px; font-weight:700;">👤 ${escHtml(r.name)}</div>
        <span style="background:${r.pct>=100?'#d1fae5':r.pct>=70?'#fef9c3':'#fee2e2'}; color:${r.pct>=100?'#065f46':r.pct>=70?'#92400e':'#991b1b'}; padding:4px 12px; border-radius:12px; font-size:13px;">${badge}</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin-bottom:14px;">
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">🎯 الهدف</div>
          <div style="font-size:18px; font-weight:700;">${fmt(r.target)} ج</div>
        </div>
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">💰 المبيعات الفعلية</div>
          <div style="font-size:18px; font-weight:700; color:var(--success);">${fmt(r.actual)} ج</div>
        </div>
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">📊 نسبة الإنجاز</div>
          <div style="font-size:18px; font-weight:700; color:${barColor};">${Math.round(r.pct)}%</div>
        </div>
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">💸 العمولة (${r.commPct}%)</div>
          <div style="font-size:18px; font-weight:700; color:#7c3aed;">${fmt(r.commission)} ج</div>
        </div>
      </div>
      <!-- Progress bar -->
      <div style="background:#e5e7eb; border-radius:100px; height:12px; overflow:hidden;">
        <div style="background:${barColor}; width:${Math.min(r.pct,100)}%; height:100%; border-radius:100px; transition:width 0.5s ease;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:4px;">
        <span>0</span><span>${fmt(r.target)} ج</span>
      </div>
    </div>`;
  }).join('');
}

