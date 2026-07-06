// ══════════════════════════════════════════════
// CASHIER RETURN SYSTEM
// ══════════════════════════════════════════════
let _crSelectedSale = null;
let _crLastReturn   = null;

function openCashierReturn() {
  toggleMobileCart(false);
  document.getElementById('crSearchInput').value = '';
  document.getElementById('crDateFilter').value = '';
  document.getElementById('crResultsBody').innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">اكتب رقم التليفون أو رقم الفاتورة أو اختر تاريخ للبحث</p>';
  document.getElementById('cashierReturnSearchModal').classList.remove('hidden');
}

function searchSalesForReturn() {
  const q    = document.getElementById('crSearchInput').value.trim().toLowerCase();
  const dStr = document.getElementById('crDateFilter').value; // YYYY-MM-DD
  const body = document.getElementById('crResultsBody');
  if (!q && !dStr) {
    body.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">اكتب رقم التليفون أو رقم الفاتورة أو اختر تاريخ للبحث</p>';
    return;
  }
  const allSales = getSales().filter(s => !s.isReturn);
  const results = allSales.filter(s => {
    if (dStr && s.date.slice(0,10) !== dStr) return false;
    if (q) {
      const idStr    = String(s.id).toLowerCase();
      const phone    = (s.customerPhone || s.phone || '').toLowerCase();
      const customer = (s.customerName  || '').toLowerCase();
      const hasItem  = (s.items || []).some(i =>
        (i.code || '').toLowerCase().includes(q) || (i.name || '').toLowerCase().includes(q)
      );
      if (!idStr.includes(q) && !phone.includes(q) && !customer.includes(q) && !hasItem) return false;
    }
    return true;
  }).sort((a,b) => b.id - a.id).slice(0, 50);

  if (!results.length) {
    body.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد نتائج</p>';
    return;
  }

  body.innerHTML = results.map(s => {
    const d = new Date(s.date).toLocaleDateString('ar-EG');
    const t = new Date(s.date).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
    const itemsPreview = (s.items||[]).slice(0,2).map(i=>i.name).join('، ') + ((s.items||[]).length>2?' ...':'');
    const alreadyReturned = getSales().some(r => r.isReturn && r.originalSaleId === s.id);
    return `<div onclick="${alreadyReturned ? '' : `openCashierReturnItems(${s.id})`}"
      style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;
             cursor:${alreadyReturned?'default':'pointer'};opacity:${alreadyReturned?'0.55':'1'};background:var(--bg-card);"
      ${alreadyReturned?'':' onmouseover="this.style.borderColor=\'var(--danger)\'" onmouseout="this.style.borderColor=\'var(--border)\'"'}>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div>
          <span style="font-weight:700;font-size:13px;">#${String(s.id).slice(-6)}</span>
          ${s.customerName?`<span style="margin-inline-start:8px;font-size:12px;color:var(--text-muted);">👤 ${s.customerName}</span>`:''}
          ${(s.customerPhone||s.phone)?`<span style="margin-inline-start:8px;font-size:12px;color:var(--text-muted);">📞 ${s.customerPhone||s.phone}</span>`:''}
          ${alreadyReturned?'<span style="margin-inline-start:8px;font-size:11px;color:var(--danger);font-weight:600;">✓ تم الإرجاع</span>':''}
        </div>
        <div style="text-align:end;flex-shrink:0;">
          <div style="font-weight:700;color:var(--primary);">${fmt(s.total)} ج</div>
          <div style="font-size:11px;color:var(--text-muted);">${d} ${t}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${itemsPreview}</div>
    </div>`;
  }).join('');
}

function openCashierReturnItems(saleId) {
  const sale = getSales().find(s => s.id === saleId);
  if (!sale) return;
  _crSelectedSale = sale;
  const d = new Date(sale.date).toLocaleString('ar-EG');
  document.getElementById('crInvoiceInfo').innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
      <div><b>فاتورة #${String(sale.id).slice(-6)}</b> · ${d}</div>
      <div style="color:var(--primary);font-weight:700;">${fmt(sale.total)} ج</div>
    </div>
    ${sale.customerName?`<div style="margin-top:4px;">👤 ${sale.customerName}${(sale.customerPhone||sale.phone)?' · 📞 '+(sale.customerPhone||sale.phone):''}</div>`:''}`;
  document.getElementById('crItemsList').innerHTML = sale.items.map((item, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${item.name}</div>
        <div style="font-size:11px;color:var(--text-muted);">كود: ${item.code} · ${fmt(item.price)} ج × ${item.qty}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <label style="font-size:12px;color:var(--text-muted);">إرجاع:</label>
        <input type="number" class="form-control" id="cr-qty-${idx}"
          value="0" min="0" max="${item.qty}"
          style="width:70px;text-align:center;padding:4px;" oninput="calcCashierReturnTotal()" />
        <span style="font-size:11px;color:var(--text-muted);">من ${item.qty}</span>
      </div>
    </div>`).join('');
  document.getElementById('crReturnReason').value = '';
  document.getElementById('crReturnSummary').style.display = 'none';
  document.getElementById('cashierReturnSearchModal').classList.add('hidden');
  document.getElementById('cashierReturnItemsModal').classList.remove('hidden');
  calcCashierReturnTotal();
}

function calcCashierReturnTotal() {
  if (!_crSelectedSale) return;
  let total = 0;
  _crSelectedSale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('cr-qty-'+idx)?.value) || 0;
    total += qty * item.price;
  });
  const sumEl = document.getElementById('crReturnSummary');
  const totEl = document.getElementById('crReturnTotal');
  if (sumEl && totEl) { totEl.textContent = fmt(total); sumEl.style.display = total > 0 ? 'block' : 'none'; }
}

function processCashierReturn() {
  if (!_crSelectedSale) return;
  const sale = _crSelectedSale;
  const reason = document.getElementById('crReturnReason').value.trim();
  const returnItems = [];
  let returnTotal = 0;
  sale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('cr-qty-'+idx)?.value) || 0;
    if (qty > 0) { returnItems.push({...item, qty: -qty}); returnTotal += qty * item.price; }
  });
  if (!returnItems.length) { alert('اختر على الأقل صنف واحد للإرجاع'); return; }
  if (!confirm(`تأكيد إرجاع ${returnItems.length} صنف — المبلغ المسترد: ${fmt(returnTotal)} ج؟`)) return;
  // Restock
  const inv = getInv();
  returnItems.forEach(ri => { const p = inv.find(x => x.code === ri.code); if (p) p.qty += Math.abs(ri.qty); });
  setInv(inv);
  // Save return record
  const returnSale = {
    id:             Date.now(),
    date:           new Date().toISOString(),
    isReturn:       true,
    originalSaleId: sale.id,
    returnReason:   reason || 'غير محدد',
    cashier:        currentUser === 'admin' ? 'مدير' : 'كاشير',
    salesperson:    sale.salesperson || '',
    branchId:       sale.branchId || currentBranch,
    branchName:     sale.branchName || getBranchName(currentBranch),
    customerName:   sale.customerName || '',
    customerPhone:  sale.customerPhone || sale.phone || '',
    items:          returnItems,
    sub:            -returnTotal,
    disc:           0,
    total:          -returnTotal,
    paid:           -returnTotal,
    change:         0,
    payMethod:      'return'
  };
  addSale(returnSale);
  _crLastReturn = returnSale;
  addAuditLog('return', `مرتجع من فاتورة #${String(sale.id).slice(-6)} — ${fmt(returnTotal)} ج`, currentBranch);
  document.getElementById('cashierReturnItemsModal').classList.add('hidden');
  // Open WhatsApp modal
  document.getElementById('crWAPhone').value = sale.customerPhone || sale.phone || '';
  document.getElementById('crWhatsAppModal').classList.remove('hidden');
}

function sendReturnWhatsApp() {
  const s = _crLastReturn;
  const phone = document.getElementById('crWAPhone').value.trim().replace(/\D/g,'');
  document.getElementById('crWhatsAppModal').classList.add('hidden');
  if (!s) return;
  const lines = [
    `🔄 إيصال مرتجع — VOODO ERP`,
    `📅 ${new Date(s.date).toLocaleString('ar-EG')}`,
    `🏬 ${s.branchName || getBranchName(s.branchId || 'b1')}`,
    `فاتورة أصلية: #${String(s.originalSaleId).slice(-6)}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...s.items.map(i => `• ${i.name} ×${Math.abs(i.qty)}  =  ${fmt(Math.abs(i.qty)*i.price)} ج`),
    `━━━━━━━━━━━━━━━━━━━━`,
    `💰 المبلغ المسترد: ${fmt(Math.abs(s.total))} ج`,
    s.returnReason !== 'غير محدد' ? `📝 السبب: ${s.returnReason}` : '',
    ``,
    `شكراً لثقتك بـ VOODO ERP 🏠`
  ].filter(l => l !== '');
  const text = encodeURIComponent(lines.join('\n'));
  const url = phone ? `https://wa.me/2${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, '_blank');
}

