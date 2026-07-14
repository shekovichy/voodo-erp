// ══════════════════════════════════════════════
// ACCOUNTING — محاسبة رسمية
// ══════════════════════════════════════════════
let _accTab = 'pnl';

function switchAccTab(tab) {
  _accTab = tab;
  ['pnl','cashflow','summary'].forEach(t => {
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
  const cogs     = sales.reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
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

function renderAccSummary() {
  const pane = document.getElementById('accPane_summary');
  if (!pane) return;
  const allSales = getSales().filter(s=>!s.isReturn);
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

