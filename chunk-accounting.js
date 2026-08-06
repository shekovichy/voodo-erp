// ══════════════════════════════════════════════
// ACCOUNTING — محاسبة رسمية
// ══════════════════════════════════════════════
let _accTab = 'pnl';

function switchAccTab(tab) {
  _accTab = tab;
  ['pnl','cashflow','ledger','balance','apaging','summary'].forEach(t => {
    const btn  = document.getElementById('accTab_'+t);
    const pane = document.getElementById('accPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  renderAccTab(tab);
}

function renderAccountingPage() {
  const mf = document.getElementById('accMonthFilter');
  if (mf && !mf.options.length) {
    const now = new Date();
    const opts = [];
    for (let i=0; i<12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const v = d.toISOString().slice(0,7);
      const l = d.toLocaleString('ar-EG',{year:'numeric',month:'long'});
      opts.push(`<option value="${v}">${l}</option>`);
    }
    mf.innerHTML = opts.join('');
  }
  renderAccTab(_accTab);
}

function getAccMonth() {
  return document.getElementById('accMonthFilter')?.value || new Date().toISOString().slice(0,7);
}

function renderAccTab(tab) {
  if (tab==='pnl')      renderPnL();
  if (tab==='cashflow') renderCashFlow();
  if (tab==='ledger')   renderLedger();
  if (tab==='balance')  renderBalanceSheet();
  if (tab==='apaging')  renderAPAging();
  if (tab==='summary')  renderAccSummary();
}

function renderPnL() {
  const month = getAccMonth();
  const pane = document.getElementById('accPane_pnl');
  if (!pane) return;
  const sales    = getSales().filter(s=>!s.isReturn&&s.date?.slice(0,7)===month);
  const rets     = getSales().filter(s=> s.isReturn&&s.date?.slice(0,7)===month);
  const exps     = getExpenses().filter(e=>e.date?.slice(0,7)===month);
  const revenue  = sales.reduce((s,x)=>s+x.total,0);
  const returnAmt= rets.reduce((s,x)=>s+Math.abs(x.total||0),0);
  const netRev   = revenue - returnAmt;
  // المرتجعات لازم تتخصم من التكلفة زي ما اتخصمت من الإيراد: البضاعة رجعت
  // للمخزن فعلاً (شوف _processCashierReturnConfirmed) فتكلفتها مش مصروف.
  // من غير كده الإيراد بينقص والتكلفة تفضل زي ما هي، فالربح يقل بمقدار تكلفة
  // المرتجع بالظبط. سطور المرتجع كمياتها سالبة، فدمجها هنا بيخصم لوحده —
  // نفس أسلوب الداشبورد (30-dashboard.js) اللي كان بيحسبها صح أصلاً.
  const cogs     = [...sales, ...rets].reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
  const grossP   = netRev - cogs;
  const salaries = typeof calcMonthlyPayroll==='function' ? calcMonthlyPayroll(month).reduce((s,p)=>s+p.net,0) : 0;
  const opExp    = exps.reduce((s,e)=>s+(e.amount||0),0);
  const totalOp  = salaries + opExp;
  const ebit     = grossP - totalOp;
  const gMargin  = netRev>0?(grossP/netRev*100).toFixed(1):0;

  const row = (label, amt, indent=0, bold=false, sep=false, color='') => {
    const st = `padding:${sep?'10':'7'}px 8px ${indent?'padding-right:'+(8+indent*16)+'px':''};${bold?'font-weight:700;':''}${color?'color:'+color+';':''}${sep?'border-top:2px solid var(--border);':''}`;
    return `<tr><td style="${st}">${label}</td>
      <td style="${st}text-align:left;direction:ltr;">${amt!==null?(amt<0?'-':'')+fmt(Math.abs(amt))+' ج':''}</td>
      <td style="${st}text-align:center;font-size:11px;color:var(--text-muted);">${amt!==null&&netRev>0?(Math.abs(amt)/netRev*100).toFixed(1)+'%':''}</td></tr>`;
  };

  pane.innerHTML = `<div style="max-width:580px;">
    <div style="font-size:15px;font-weight:800;margin-bottom:14px;color:var(--primary);">📋 قائمة الدخل — ${month}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <thead><tr style="background:var(--sidebar);color:white;">
        <th style="padding:10px 8px;text-align:right;">البند</th>
        <th style="padding:10px 8px;text-align:left;">المبلغ</th>
        <th style="padding:10px 8px;text-align:center;">%</th>
      </tr></thead><tbody>
      ${row('إيرادات المبيعات',revenue,0,true,false,'#059669')}
      ${row('المرتجعات',-returnAmt,1)}
      ${row('صافي الإيراد',netRev,0,true,true,'#1d4ed8')}
      ${row('تكلفة البضاعة المباعة',-cogs,1)}
      ${row('إجمالي الربح',grossP,0,true,true,grossP>=0?'#059669':'#dc2626')}
      <tr><td colspan="3" style="padding:4px 8px;background:var(--bg-secondary);font-size:11px;font-weight:700;color:var(--text-muted);">المصاريف التشغيلية</td></tr>
      ${row('الرواتب',-salaries,1)}
      ${row('مصاريف أخرى',-opExp,1)}
      ${row('إجمالي المصاريف',-totalOp,0,true,true)}
      ${row('الربح التشغيلي (EBIT)',ebit,0,true,true,ebit>=0?'#059669':'#dc2626')}
      </tbody>
    </table>
    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${[{l:'هامش الربح الإجمالي',v:gMargin+'%',bg:'#dcfce7',tc:'#15803d'},{l:'صافي الربح',v:fmt(ebit)+' ج',bg:ebit>=0?'#dcfce7':'#fee2e2',tc:ebit>=0?'#15803d':'#b91c1c'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:${k.tc};">${k.v}</div><div style="font-size:12px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div></div>`;
}

function renderCashFlow() {
  const month = getAccMonth();
  const pane  = document.getElementById('accPane_cashflow');
  if (!pane) return;
  const sales = getSales().filter(s=>!s.isReturn&&s.date?.slice(0,7)===month);
  const rets  = getSales().filter(s=> s.isReturn&&s.date?.slice(0,7)===month);
  const exps  = getExpenses().filter(e=>e.date?.slice(0,7)===month);
  // _purchaseCache (not getPurchases()) — 93-accounting.js and 75-purchases.js
  // are both lazy chunks; getPurchases() would throw if this page is opened
  // before the purchases chunk has loaded. The raw cache lives in 00-core.js
  // and is kept current by the Firestore listener in 65-firebase.js regardless
  // of which chunks have loaded, so it's always safe to read directly.
  const pos   = _purchaseCache.filter(po=>po.receivedAt&&new Date(po.receivedAt).toISOString().slice(0,7)===month&&po.status==='received');

  const byM = {};
  sales.forEach(s=>{ const m=s.payMethod||'cash'; byM[m]=(byM[m]||0)+s.total; });
  const cashIn  = (byM['cash']||0)+(byM['نقدي']||0);
  const cardIn  = (byM['card']||0)+(byM['فيزا']||0)+(byM['كريدت']||0);
  const otherIn = Object.entries(byM).filter(([k])=>!['cash','نقدي','card','فيزا','كريدت'].includes(k)).reduce((s,[,v])=>s+v,0);
  const totalIn = cashIn+cardIn+otherIn;
  const retOut  = rets.reduce((s,x)=>s+Math.abs(x.total||0),0);
  const expOut  = exps.reduce((s,e)=>s+(e.amount||0),0);
  const purOut  = pos.reduce((s,po)=>s+(po.total||0),0);
  const totalOut= retOut+expOut+purOut;
  const net     = totalIn-totalOut;

  const [yr,mo] = month.split('-').map(Number);
  const days = new Date(yr,mo,0).getDate();
  const daily = [];
  for (let d=1;d<=days;d++) {
    const ds=`${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    daily.push({d, s:sales.filter(x=>x.date?.slice(0,10)===ds).reduce((a,x)=>a+x.total,0), e:exps.filter(x=>x.date?.slice(0,10)===ds).reduce((a,x)=>a+(x.amount||0),0)});
  }
  const mx = Math.max(...daily.map(d=>Math.max(d.s,d.e)),1);
  const bars = daily.map(({d,s,e})=>`<div style="display:flex;flex-direction:column;align-items:center;gap:1px;flex:1;min-width:6px;">
    <div style="width:60%;background:#1a5faf;height:${Math.round(s/mx*70)}px;border-radius:2px 2px 0 0;" title="مبيعات ${fmt(s)} ج"></div>
    <div style="width:60%;background:#ef4444;height:${Math.round(e/mx*70)}px;border-radius:2px 2px 0 0;" title="مصاريف ${fmt(e)} ج"></div>
    ${days<=16?`<div style="font-size:8px;color:var(--text-muted);">${d}</div>`:''}
  </div>`).join('');

  pane.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
      ${[{l:'إجمالي الداخل',v:'+'+fmt(totalIn)+' ج',bg:'#dcfce7',tc:'#15803d'},{l:'إجمالي الخارج',v:'-'+fmt(totalOut)+' ج',bg:'#fee2e2',tc:'#b91c1c'},{l:'صافي التدفق',v:(net>=0?'+':'')+fmt(net)+' ج',bg:net>=0?'#eff6ff':'#fef3c7',tc:net>=0?'#1d4ed8':'#854d0e'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:18px;font-weight:800;color:${k.tc};">${k.v}</div><div style="font-size:11px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div>
    <div style="background:white;border-radius:10px;padding:14px;margin-bottom:16px;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <div style="font-weight:700;margin-bottom:10px;font-size:13px;">📊 <span style="color:#1a5faf;">■ مبيعات</span> <span style="color:#ef4444;">■ مصاريف</span></div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:80px;">${bars}</div>
    </div>
    <div style="background:white;border-radius:10px;padding:14px;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${[['📥 مبيعات كاش','+'+fmt(cashIn)+' ج','#059669'],['💳 مبيعات بطاقة','+'+fmt(cardIn)+' ج','#059669'],['📥 أخرى','+'+fmt(otherIn)+' ج','#059669'],['📤 مرتجعات','-'+fmt(retOut)+' ج','#dc2626'],['📤 مصاريف','-'+fmt(expOut)+' ج','#dc2626'],['📤 موردون','-'+fmt(purOut)+' ج','#dc2626']]
          .map(([l,v,tc])=>`<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">${l}</td><td style="padding:8px;text-align:left;direction:ltr;font-weight:700;color:${tc};">${v}</td></tr>`).join('')}
        <tr style="background:var(--bg-secondary);"><td style="padding:10px;font-weight:800;">🏦 صافي التدفق</td><td style="padding:10px;font-weight:800;text-align:left;direction:ltr;color:${net>=0?'#15803d':'#dc2626'};font-size:15px;">${(net>=0?'+':'')+fmt(net)} ج</td></tr>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════
// CHART OF ACCOUNTS + GENERAL LEDGER + BALANCE SHEET + AP AGING
// ══════════════════════════════════════════════
// No real double-entry bookkeeping exists anywhere else in the app — this
// is built from scratch. Journal entries are DERIVED live from the same
// source data the P&L/cash-flow reports above already read (sales,
// expenses, purchase orders, supplier payments), the same way those
// reports already work, rather than maintained as a separately-persisted
// ledger that transaction-creating code all over the app would have to
// remember to keep in sync — that would silently drift and produce wrong
// financial statements, which is worse than not having them at all.
const CHART_OF_ACCOUNTS = {
  cash:      { code:'1010', name:'النقدية والبنوك',              type:'asset' },
  inventory: { code:'1020', name:'المخزون',                      type:'asset' },
  ar:        { code:'1030', name:'ذمم مدينة - عملاء',            type:'asset' },
  ap:        { code:'2010', name:'ذمم دائنة - موردين',           type:'liability' },
  equity:    { code:'3010', name:'حقوق الملكية (الأرباح المرحلة)', type:'equity' },
  revenue:   { code:'4010', name:'إيرادات المبيعات',             type:'revenue' },
  returns:   { code:'4020', name:'مرتجعات المبيعات',             type:'revenue' },
  cogs:      { code:'5010', name:'تكلفة البضاعة المباعة',        type:'expense' },
  payroll:   { code:'6050', name:'الرواتب (حضور وانصراف)',       type:'expense' },
  exp_rent:        { code:'6110', name:'إيجار',            type:'expense' },
  exp_electricity: { code:'6120', name:'كهرباء',           type:'expense' },
  exp_water:       { code:'6130', name:'مياه',             type:'expense' },
  exp_internet:    { code:'6140', name:'إنترنت/تليفون',    type:'expense' },
  exp_salaries:    { code:'6150', name:'رواتب (مصروف يدوي)', type:'expense' },
  exp_maintenance: { code:'6160', name:'صيانة',            type:'expense' },
  exp_marketing:   { code:'6170', name:'تسويق',            type:'expense' },
  exp_transport:   { code:'6180', name:'نقل/شحن',          type:'expense' },
  exp_other:       { code:'6190', name:'أخرى',             type:'expense' },
};
const ACCT_TYPE_LABEL = { asset:'أصول', liability:'التزامات', equity:'حقوق ملكية', revenue:'إيرادات', expense:'مصروفات' };

// Builds one journal entry per financial event in [from,to]. Each entry has
// exactly one debit account and one credit account (amounts always equal —
// the double-entry invariant holds by construction, not by manual balancing).
// _purchaseCache is read directly (not getPurchases()) — see the note on
// renderCashFlow()'s purOut fix above; same cross-chunk-safety reasoning
// applies to every lazy-chunk-owned cache read in this function.
function buildJournalEntries(from, to) {
  const entries = [];
  // calcMonthlyPayroll() (92-hr-attendance.js) always adds the CURRENT
  // staff list's base salary for any month it's asked about, attendance
  // or not — it has no concept of "this employee didn't exist yet". The
  // payroll loop below walks every month from `from`, and renderBalanceSheet()
  // passes `from = new Date(0)` (epoch) to get all-time cumulative cash.
  // Left unbounded, that posts a phantom payroll expense for every one of
  // the ~650 months since 1970, wrecking the derived cash balance (and
  // wastefully recomputing payroll that many times on every render).
  // Real transactions never predate actual business activity anyway, so
  // clamping the payroll loop's start to the earliest recorded
  // sale/expense/purchase only affects this phantom-month case.
  const payrollFrom = (() => {
    const dates = [...getSales(), ...getExpenses()].map(x => x.date)
      .concat(_purchaseCache.map(po => po.receivedAt))
      .filter(Boolean).map(d => new Date(d));
    if (!dates.length) return from;
    const earliest = new Date(Math.min(...dates));
    return earliest > from ? earliest : from;
  })();
  const push = (date, desc, debit, credit, amount, source) => {
    if (!amount) return;
    entries.push({ date, desc, debit, credit, amount, source });
  };

  getSales().forEach(sale => {
    const d = new Date(sale.date);
    if (d < from || d > to) return;
    const cogsAmt = (sale.items||[]).reduce((s,i)=>s+(i.cost||0)*i.qty,0);
    const ref = '#'+String(sale.id).slice(-6);
    if (sale.isReturn) {
      push(sale.date, `مرتجع فاتورة ${ref}`, 'returns', 'cash', Math.abs(sale.total), {type:'sale-return', id:sale.id});
      // Math.abs مقصودة: سطور المرتجع كمياتها سالبة فـ cogsAmt بيطلع سالب،
      // والقيد هنا أصلاً بيقلب الحسابات (مخزون مدين / تكلفة دائن) عشان يعكس
      // البيع. تمرير المبلغ سالب كان بيعكس العكس — فالمخزون ينقص تاني بدل ما
      // البضاعة ترجع، والرصيد يبان أقل بضعف تكلفة المرتجع.
      if (cogsAmt) push(sale.date, `عكس تكلفة مرتجع ${ref}`, 'inventory', 'cogs', Math.abs(cogsAmt), {type:'sale-return-cogs', id:sale.id});
    } else {
      push(sale.date, `فاتورة مبيعات ${ref}`, 'cash', 'revenue', sale.total, {type:'sale', id:sale.id});
      if (cogsAmt) push(sale.date, `تكلفة البضاعة ${ref}`, 'cogs', 'inventory', cogsAmt, {type:'sale-cogs', id:sale.id});
    }
  });

  getExpenses().forEach(exp => {
    const d = new Date(exp.date);
    if (d < from || d > to) return;
    const acctKey = 'exp_' + exp.category;
    push(exp.date, EXP_CATS[exp.category] || exp.category, CHART_OF_ACCOUNTS[acctKey] ? acctKey : 'exp_other', 'cash', exp.amount, {type:'expense', id:exp.id});
  });

  _purchaseCache.filter(po => po.status === 'received' && po.receivedAt).forEach(po => {
    const d = new Date(po.receivedAt);
    if (d < from || d > to) return;
    push(new Date(po.receivedAt).toISOString(), `استلام أمر شراء #${po.id.slice(-6)} — ${po.supplierName}`, 'inventory', 'ap', po.total, {type:'po-receive', id:po.id});
  });

  _supplierPaymentsCache.forEach(pay => {
    const d = new Date(pay.date);
    if (d < from || d > to) return;
    push(pay.date, `دفعة لمورد ${pay.supplierName}`, 'ap', 'cash', pay.amount, {type:'supplier-payment', id:pay.id});
  });

  // Payroll is computed monthly (calcMonthlyPayroll), not a stored
  // transaction — post one entry per covered month, dated to that month.
  if (typeof calcMonthlyPayroll === 'function') {
    const seen = new Set();
    const cursor = new Date(payrollFrom.getFullYear(), payrollFrom.getMonth(), 1);
    while (cursor <= to) {
      const m = cursor.toISOString().slice(0,7);
      if (!seen.has(m)) {
        seen.add(m);
        const total = calcMonthlyPayroll(m).reduce((s,p)=>s+p.net,0);
        if (total) push(new Date(cursor).toISOString(), `رواتب شهر ${m}`, 'payroll', 'cash', total, {type:'payroll', id:m});
      }
      cursor.setMonth(cursor.getMonth()+1);
    }
  }

  return entries.sort((a,b) => new Date(a.date) - new Date(b.date));
}

function accountBalance(accountKey, entries) {
  const isDebitNormal = CHART_OF_ACCOUNTS[accountKey].type === 'asset' || CHART_OF_ACCOUNTS[accountKey].type === 'expense';
  let balance = 0;
  entries.forEach(e => {
    if (e.debit === accountKey)  balance += isDebitNormal ?  e.amount : -e.amount;
    if (e.credit === accountKey) balance += isDebitNormal ? -e.amount :  e.amount;
  });
  return balance;
}

let _ledgerEntries = [];

function renderLedger() {
  const month = getAccMonth();
  const [y, m] = month.split('-').map(Number);
  const from = new Date(y, m-1, 1);
  const to   = new Date(y, m, 0, 23, 59, 59);
  _ledgerEntries = buildJournalEntries(from, to);

  const rows = Object.keys(CHART_OF_ACCOUNTS).map(key => {
    const acct = CHART_OF_ACCOUNTS[key];
    const debitTotal  = _ledgerEntries.filter(e=>e.debit===key).reduce((s,e)=>s+e.amount,0);
    const creditTotal = _ledgerEntries.filter(e=>e.credit===key).reduce((s,e)=>s+e.amount,0);
    const balance = accountBalance(key, _ledgerEntries);
    const count = _ledgerEntries.filter(e=>e.debit===key||e.credit===key).length;
    return { key, acct, debitTotal, creditTotal, balance, count };
  }).filter(r => r.count > 0);

  const totalDebit  = rows.reduce((s,r)=>s+r.debitTotal,0);
  const totalCredit = rows.reduce((s,r)=>s+r.creditTotal,0);

  const pane = document.getElementById('accPane_ledger');
  if (!pane) return;
  pane.innerHTML = `
    <div style="font-size:15px;font-weight:800;margin-bottom:14px;color:var(--primary);">📒 دفتر الأستاذ العام — ميزان المراجعة — ${month}</div>
    <div class="table-wrap">
      <table><thead><tr><th>الكود</th><th>الحساب</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th></th></tr></thead>
      <tbody>
        ${rows.length ? rows.map(r => `<tr>
          <td style="font-size:11px;color:var(--text-muted);">${r.acct.code}</td>
          <td style="font-weight:600;">${escHtml(r.acct.name)}</td>
          <td style="font-size:11px;color:var(--text-muted);">${ACCT_TYPE_LABEL[r.acct.type]}</td>
          <td>${r.debitTotal ? fmt(r.debitTotal)+' ج' : '-'}</td>
          <td>${r.creditTotal ? fmt(r.creditTotal)+' ج' : '-'}</td>
          <td style="font-weight:700;">${fmt(r.balance)} ج</td>
          <td><button class="btn btn-outline btn-sm" onclick="showLedgerAccountDetail('${r.key}')">🔍 القيود (${r.count})</button></td>
        </tr>`).join('') : '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">لا توجد قيود هذا الشهر</td></tr>'}
        <tr style="background:var(--bg-secondary);font-weight:800;"><td colspan="3">الإجمالي</td><td>${fmt(totalDebit)} ج</td><td>${fmt(totalCredit)} ج</td><td colspan="2"></td></tr>
      </tbody></table>
    </div>`;
}

// Dedicated modal for journal-entry drill-down (own DOM ids, own close
// function) — deliberately NOT reusing the pivot analyzer's analysisDrillModal:
// 93-accounting.js and 115-pivot-reports.js are separate lazy chunks, and
// that modal's buttons call closeDrillDown()/exportDrillExcel() which only
// exist once the pivot chunk has loaded. Journal entries (debit/credit/
// description) also don't fit that modal's sales-line columns anyway.
function showLedgerAccountDetail(accountKey) {
  const acct = CHART_OF_ACCOUNTS[accountKey];
  const rows = _ledgerEntries.filter(e => e.debit === accountKey || e.credit === accountKey);
  document.getElementById('ledgerDrillTitle').textContent = `📒 ${acct.name} (${acct.code})`;
  document.getElementById('ledgerDrillCount').textContent = rows.length;
  document.getElementById('ledgerDrillBody').innerHTML = rows.length ? rows.map(e => `<tr>
    <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${new Date(e.date).toLocaleString('ar-EG')}</td>
    <td style="font-size:12px;">${escHtml(e.desc)}</td>
    <td style="font-size:12px;">${e.debit===accountKey?fmt(e.amount)+' ج':'-'}</td>
    <td style="font-size:12px;">${e.credit===accountKey?fmt(e.amount)+' ج':'-'}</td>
    <td style="font-size:12px;color:var(--text-muted);">${escHtml((e.debit===accountKey?CHART_OF_ACCOUNTS[e.credit]:CHART_OF_ACCOUNTS[e.debit])?.name||'')}</td>
  </tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted" style="padding:20px;">لا توجد قيود</td></tr>';
  document.getElementById('ledgerDrillModal').classList.remove('hidden');
}
function closeLedgerDrill() { document.getElementById('ledgerDrillModal').classList.add('hidden'); }

function renderBalanceSheet() {
  const month = getAccMonth();
  const [y, m] = month.split('-').map(Number);
  const asOf = new Date(y, m, 0, 23, 59, 59); // last moment of the selected month
  const entries = buildJournalEntries(new Date(0), asOf);

  const cash = accountBalance('cash', entries);
  const inventoryValue = Object.values(_invCacheByBranch).flat().reduce((s,p)=>s+(p.cost||0)*(p.qty||0),0);
  const ar = 0; // no credit-sale feature exists — every POS sale is fully paid at checkout
  const totalAssets = cash + inventoryValue + ar;

  const ap = accountBalance('ap', entries);
  const totalLiabilities = ap;

  const equity = totalAssets - totalLiabilities; // plug — no separate owner-capital-injection tracking exists

  const pane = document.getElementById('accPane_balance');
  if (!pane) return;
  const line = (label, amt, bold) => `<tr><td style="padding:8px;${bold?'font-weight:800;':''}">${label}</td><td style="padding:8px;text-align:left;direction:ltr;${bold?'font-weight:800;':''}">${fmt(amt)} ج</td></tr>`;
  pane.innerHTML = `
    <div style="font-size:15px;font-weight:800;margin-bottom:6px;color:var(--primary);">⚖️ الميزانية العمومية — كما في نهاية ${month}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">
      💡 "النقدية" رقم مُشتق من كل العمليات المسجلة في النظام من بداية استخدامه (إيرادات - مصروفات - مشتريات مدفوعة) وليس رصيد بنكي فعلي مُطابَق.
      "الذمم المدينة" = صفر لأن كل بيع في السيستم يُدفع بالكامل وقت البيع.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:760px;">
      <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);">
        <div style="background:var(--sidebar);color:white;padding:10px 8px;font-weight:700;">الأصول</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          ${line('💵 النقدية (مُشتقة)', cash)}
          ${line('📦 المخزون', inventoryValue)}
          ${line('🧾 ذمم مدينة - عملاء', ar)}
          <tr style="border-top:2px solid var(--border);background:var(--bg-secondary);">${line('إجمالي الأصول', totalAssets, true).replace('<tr>','').replace('</tr>','')}</tr>
        </table>
      </div>
      <div>
        <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);margin-bottom:16px;">
          <div style="background:#7c3aed;color:white;padding:10px 8px;font-weight:700;">الالتزامات</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            ${line('🏭 ذمم دائنة - موردين', ap)}
            <tr style="border-top:2px solid var(--border);background:var(--bg-secondary);">${line('إجمالي الالتزامات', totalLiabilities, true).replace('<tr>','').replace('</tr>','')}</tr>
          </table>
        </div>
        <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);">
          <div style="background:#059669;color:white;padding:10px 8px;font-weight:700;">حقوق الملكية</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            ${line('حقوق الملكية (الأرباح المرحلة)', equity)}
          </table>
        </div>
      </div>
    </div>
    <div style="margin-top:16px;max-width:760px;background:#eff6ff;border-radius:8px;padding:12px 16px;font-size:13px;font-weight:700;color:#1d4ed8;">
      ✓ الأصول (${fmt(totalAssets)} ج) = الالتزامات (${fmt(totalLiabilities)} ج) + حقوق الملكية (${fmt(equity)} ج)
    </div>`;
}

function renderAPAging() {
  const asOf = new Date();
  const buckets = { current:0, '1-30':0, '31-60':0, '61-90':0, '90+':0 };
  const bySupplier = {};
  _purchaseCache.filter(po => po.status === 'received' && (po.payStatus||'unpaid') !== 'paid').forEach(po => {
    const outstanding = po.total - (po.paidAmount || 0);
    if (outstanding <= 0) return;
    const due = po.dueDate ? new Date(po.dueDate) : null;
    const daysOverdue = due ? Math.floor((asOf - due) / 86400000) : 0;
    let bucket = 'current';
    if (daysOverdue > 90) bucket = '90+';
    else if (daysOverdue > 60) bucket = '61-90';
    else if (daysOverdue > 30) bucket = '31-60';
    else if (daysOverdue > 0) bucket = '1-30';
    buckets[bucket] += outstanding;
    (bySupplier[po.supplierId] = bySupplier[po.supplierId] || { name: po.supplierName, rows: [], total: 0 });
    bySupplier[po.supplierId].rows.push({ po, outstanding, daysOverdue, bucket });
    bySupplier[po.supplierId].total += outstanding;
  });

  const bucketLabels = { current:'لم يستحق بعد', '1-30':'1-30 يوم', '31-60':'31-60 يوم', '61-90':'61-90 يوم', '90+':'أكثر من 90 يوم' };
  const bucketColors = { current:'#0891b2', '1-30':'#d97706', '31-60':'#ea580c', '61-90':'#dc2626', '90+':'#991b1b' };
  const totalAP = Object.values(buckets).reduce((s,v)=>s+v,0);

  const pane = document.getElementById('accPane_apaging');
  if (!pane) return;
  const suppliers = Object.values(bySupplier).sort((a,b)=>b.total-a.total);
  pane.innerHTML = `
    <div style="font-size:15px;font-weight:800;margin-bottom:14px;color:var(--primary);">📅 أعمار الذمم الدائنة — كما اليوم</div>
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-bottom:16px;">
      ${Object.keys(buckets).map(b => `<div class="stat-card"><div class="stat-label">${bucketLabels[b]}</div><div class="stat-value" style="font-size:18px;color:${bucketColors[b]};">${fmt(buckets[b])} ج</div></div>`).join('')}
    </div>
    ${!suppliers.length ? '<div class="text-center text-muted" style="padding:30px;">لا توجد فواتير شراء مستحقة</div>' : suppliers.map(s => `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:700;">🏭 ${escHtml(s.name)}</div>
          <div style="font-weight:800;color:var(--danger);">${fmt(s.total)} ج</div>
        </div>
        <div class="table-wrap">
          <table><thead><tr><th>أمر الشراء</th><th>تاريخ الاستحقاق</th><th>المتأخر</th><th>الفئة</th><th>المتبقي</th></tr></thead>
          <tbody>${s.rows.sort((a,b)=>b.daysOverdue-a.daysOverdue).map(r => `<tr>
            <td style="font-size:12px;">#${r.po.id.slice(-6)}</td>
            <td style="font-size:12px;">${r.po.dueDate?new Date(r.po.dueDate).toLocaleDateString('ar-EG'):'-'}</td>
            <td style="font-size:12px;">${r.daysOverdue>0?r.daysOverdue+' يوم':'-'}</td>
            <td><span style="background:${bucketColors[r.bucket]}22;color:${bucketColors[r.bucket]};padding:2px 8px;border-radius:10px;font-size:11px;">${bucketLabels[r.bucket]}</span></td>
            <td style="font-weight:700;">${fmt(r.outstanding)} ج</td>
          </tr>`).join('')}</tbody></table>
        </div>
      </div>`).join('')}
    <div style="margin-top:8px;font-weight:800;font-size:14px;">إجمالي الذمم الدائنة: <span style="color:var(--danger);">${fmt(totalAP)} ج</span></div>`;
}

function renderAccSummary() {
  const pane = document.getElementById('accPane_summary');
  if (!pane) return;
  // المرتجعات مدموجة مع المبيعات هنا (إجماليها وكمياتها سالبة) فبتتخصم من
  // الإيراد والتكلفة مع بعض — زي renderPnL والداشبورد بالظبط. استبعادها كان
  // بيخلي التبويب ده يعرض صافي ربح مختلف عن قائمة الدخل في نفس الصفحة.
  const allSales = getSales();
  const allExp   = getExpenses();
  const months   = [...new Set(allSales.map(s=>s.date?.slice(0,7)).filter(Boolean))].sort().reverse();
  const totalRev = allSales.reduce((s,x)=>s+x.total,0);
  const totalCOGS= allSales.reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
  const totalExp = allExp.reduce((s,e)=>s+(e.amount||0),0);
  const totalNP  = totalRev-totalCOGS-totalExp;

  const rows = months.slice(0,12).map(m=>{
    const mS=allSales.filter(s=>s.date?.slice(0,7)===m).reduce((s,x)=>s+x.total,0);
    const mC=allSales.filter(s=>s.date?.slice(0,7)===m).reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
    const mE=allExp.filter(e=>e.date?.slice(0,7)===m).reduce((s,e)=>s+(e.amount||0),0);
    const mP=mS-mC-mE;
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${m}</td>
      <td style="padding:8px;text-align:center;">${fmt(mS)} ج</td>
      <td style="padding:8px;text-align:center;">${fmt(mC)} ج</td>
      <td style="padding:8px;text-align:center;">${fmt(mE)} ج</td>
      <td style="padding:8px;text-align:center;font-weight:700;color:${mP>=0?'#059669':'#dc2626'};">${fmt(mP)} ج</td>
    </tr>`;
  }).join('');

  pane.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
      ${[{l:'إجمالي الإيراد',v:fmt(totalRev)+' ج',bg:'#eff6ff',tc:'#1d4ed8'},{l:'إجمالي التكاليف',v:fmt(totalCOGS)+' ج',bg:'#fef9c3',tc:'#854d0e'},{l:'إجمالي المصاريف',v:fmt(totalExp)+' ج',bg:'#fee2e2',tc:'#b91c1c'},{l:'صافي الأرباح الكلي',v:fmt(totalNP)+' ج',bg:totalNP>=0?'#dcfce7':'#fee2e2',tc:totalNP>=0?'#15803d':'#b91c1c'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:16px;font-weight:800;color:${k.tc};">${k.v}</div><div style="font-size:11px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div>
    <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:var(--sidebar);color:white;">
          ${['الشهر','الإيراد','التكلفة','المصاريف','صافي الربح'].map(h=>`<th style="padding:10px 8px;text-align:center;">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">لا توجد بيانات</td></tr>'}</tbody>
      </table>
    </div>`;
}

