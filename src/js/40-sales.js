// ══════════════════════════════════════════════
// SALES LIST
// ══════════════════════════════════════════════
function initSalesFilter() {
  if (!document.getElementById('salesFrom').value) {
    const d = new Date(); d.setDate(1);
    document.getElementById('salesFrom').value = d.toISOString().slice(0,10);
    document.getElementById('salesTo').value   = new Date().toISOString().slice(0,10);
  }
}

function clearSalesFilter() {
  document.getElementById('salesFrom').value = '';
  document.getElementById('salesTo').value   = '';
  renderSales();
}

function renderSales() {
  // Populate branch filter if empty
  var sbf = document.getElementById('salesBranchFilter');
  if (sbf && sbf.options.length === 0) {
    var opt0 = document.createElement('option'); opt0.value='all'; opt0.textContent='🏬 كل الفروع'; sbf.appendChild(opt0);
    var bnames = getBranches();
    BRANCH_IDS.filter(function(b){ return b!=='wh'; }).forEach(function(b){
      var o = document.createElement('option'); o.value=b; o.textContent=(bnames[b]||BRANCH_DEFAULTS[b]); sbf.appendChild(o);
    });
  }
  var selBranch = sbf ? sbf.value : 'all';
  const from = document.getElementById('salesFrom').value;
  const to   = document.getElementById('salesTo').value;
  let sales  = getSales();
  if (selBranch && selBranch !== 'all') sales = sales.filter(function(s){ return s.branchId === selBranch; });
  if (from) sales = sales.filter(s => s.date.slice(0,10) >= from);
  if (to)   sales = sales.filter(s => s.date.slice(0,10) <= to);
  sales.sort((a,b) => new Date(b.date) - new Date(a.date));

  animateNumber(document.getElementById('salesFilterTotal'), sales.reduce((s,x)=>s+x.total,0), { format: fmt });
  document.getElementById('salesBody').innerHTML = !sales.length
    ? '<tr><td colspan="10" class="text-center text-muted" style="padding:40px;">لا توجد مبيعات</td></tr>'
    : sales.map(s => `<tr class="${s.isReturn ? 'return-row' : ''}">
        <td>${s.isReturn ? `<span class="badge-return">مرتجع #${String(s.id).slice(-6)}</span>` : `<span class="badge badge-info">#${String(s.id).slice(-6)}</span>`}</td>
        <td style="white-space:nowrap;">${new Date(s.date).toLocaleString('ar-EG')}</td>
        <td><span style="font-size:11px;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:8px;">${escHtml(s.branchName||getBranchName(s.branchId||'b1'))}</span></td>
        <td>${escHtml(s.salesperson||s.cashier||'-')}</td>
        <td>${s.items.reduce((x,i)=>x+i.qty,0)}</td>
        <td>${fmt(s.sub)} ج</td>
        <td>${s.disc>0?fmt(s.disc)+' ج':'-'}</td>
        <td><strong>${fmt(s.total)} ج</strong></td>
        <td>${s.payMethod==='cash'?'💵 نقدي':'💳 كارت'}</td>
        <td><button class="btn btn-gray btn-sm" onclick="viewSale(${s.id})">👁️ عرض</button></td>
      </tr>`).join('');
}

function viewSale(id) {
  const sale = getSales().find(s => s.id === id); if (!sale) return;
  lastSaleForPrint = sale;
  document.getElementById('saleDetailContent').innerHTML = `
    <div class="grid-2" style="font-size:13px;margin-bottom:14px;gap:8px;">
      <div><strong>رقم الفاتورة:</strong> ${String(sale.id).slice(-8)}</div>
      <div><strong>التاريخ:</strong> ${new Date(sale.date).toLocaleString('ar-EG')}</div>
      <div><strong>البائع:</strong> ${escHtml(sale.salesperson || sale.cashier || '-')}</div>
      <div><strong>الدفع:</strong> ${sale.payMethod==='cash'?'💵 نقدي':'💳 كارت'}</div>
    </div>
    <div class="table-wrap">
      <table style="font-size:13px;">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${sale.items.map(i=>`<tr><td>${escHtml(i.name)}</td><td>${i.qty}</td><td>${fmt(i.price)} ج</td><td><strong>${fmt(i.price*i.qty)} ج</strong></td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-top:12px;font-size:14px;">
      <div class="flex justify-between"><span>المجموع</span><span>${fmt(sale.sub)} ج</span></div>
      ${sale.disc>0?`<div class="flex justify-between" style="color:green;"><span>خصم</span><span>-${fmt(sale.disc)} ج</span></div>`:''}
      <div class="flex justify-between font-bold" style="font-size:16px;margin-top:6px;border-top:1px solid var(--border);padding-top:6px;"><span>الإجمالي</span><span>${fmt(sale.total)} ج</span></div>
      ${sale.payMethod==='cash'?`<div class="flex justify-between" style="color:var(--primary);"><span>مدفوع</span><span>${fmt(sale.paid)} ج</span></div><div class="flex justify-between" style="color:green;font-weight:700;"><span>الباقي</span><span>${fmt(sale.change)} ج</span></div>`:''}
    </div>`;
  document.getElementById('saleDetailModal').classList.remove('hidden');
}

function printSaleFromModal() {
  if (lastSaleForPrint) { showReceipt(lastSaleForPrint); document.getElementById('saleDetailModal').classList.add('hidden'); setTimeout(printReceipt, 300); }
}

