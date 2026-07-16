// ══════════════════════════════════════════════
// PAYMENT
// ══════════════════════════════════════════════
function openPayment() {
  if (!cart.length) { showToast('الفاتورة فارغة'); return; }
  const { total } = cartTotals();
  document.getElementById('modalTotal').textContent = fmt(total) + ' ج';
  document.getElementById('paidAmount').value = '';
  document.getElementById('changeAmt').textContent = '0.00 ج';
  // Populate salesperson dropdown — only sellers assigned to this branch
  // (plus any unassigned "all branches" sellers); falls back to everyone
  // if that filter would leave the list empty.
  const sel = document.getElementById('paymentSalesperson');
  const allPeople = getSalespeople();
  const branchPeople = allPeople.filter(n => !getSellerBranch(n) || getSellerBranch(n) === currentBranch);
  const people = branchPeople.length ? branchPeople : allPeople;
  sel.innerHTML = people.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  if (window._lastSalesperson && people.includes(window._lastSalesperson)) sel.value = window._lastSalesperson;
  clearSelectedCustomer();
  setPayMethod('cash');
  document.getElementById('paymentModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('paidAmount').focus(), 100);
}

function setPayMethod(m) {
  payMethod = m;
  document.getElementById('btnCash').className = 'btn ' + (m === 'cash' ? 'btn-success' : 'btn-gray');
  document.getElementById('btnCard').className = 'btn ' + (m === 'card' ? 'btn-primary' : 'btn-gray');
  document.getElementById('cashSection').style.display = m === 'cash' ? 'block' : 'none';
}

function calcChange() {
  const { total } = cartTotals();
  const paid = parseFloat(document.getElementById('paidAmount').value) || 0;
  const change = paid - total;
  const el = document.getElementById('changeAmt');
  el.textContent = fmt(Math.max(0, change)) + ' ج';
  el.style.color = change >= 0 ? 'var(--success)' : 'var(--danger)';
}

function completeSale() {
  const { sub, disc, total } = cartTotals();
  let paid = total, change = 0;
  if (payMethod === 'cash') {
    paid = parseFloat(document.getElementById('paidAmount').value) || 0;
    if (paid < total) { showToast('المبلغ المدفوع أقل من الإجمالي'); return; }
    change = paid - total;
  }

  // Deduct stock — transactional per-product deltas so two cashiers selling
  // at the same moment can't clobber each other's deductions (see adjustStock).
  adjustStock(cart.map(ci => ({ code: ci.code, delta: -ci.qty })));

  // Save sale
  const salesperson = document.getElementById('paymentSalesperson')?.value || '';
  window._lastSalesperson = salesperson; // remember for next invoice
  const _saleCustomerId = document.getElementById('selectedCustomerId')?.value || '';
  const _saleCustomer   = _saleCustomerId ? getCustomers().find(c => c.id === _saleCustomerId) : null;
  const sale = {
    id: Date.now(),
    date: new Date().toISOString(),
    cashier: currentUser === 'admin' ? 'مدير' : 'كاشير',
    salesperson,
    items: cart.map(i => ({...i})),
    sub, disc, total, paid, change, payMethod,
    appliedPromos: cart._appliedPromos || [],
    branchId: currentBranch,
    branchName: getBranchName(currentBranch),
    // Link the sale to the selected customer so loyalty points, the customer
    // profile purchase history, and phone-based return search all work. These
    // were previously missing, so sale.customerId was always undefined (loyalty
    // never awarded) and the customer profile filter never matched any sale.
    customerId:    _saleCustomerId || '',
    customerName:  _saleCustomer ? _saleCustomer.name : '',
    customerPhone: _saleCustomer ? (_saleCustomer.phone || '') : ''
  };
  addSale(sale);
  if (sale.customerId) awardLoyaltyPoints(sale.customerId, sale.total);
  _lastSale = sale; // for WhatsApp sharing
  addAuditLog('sale.complete', `فاتورة #${String(sale.id||'').slice(-6)} — ${fmt(sale.total)} ج — ${sale.items.length} صنف`, sale.branchId);

  updateCustomerAfterSale(_saleCustomerId, total);
  clearSelectedCustomer();
  document.getElementById('paymentModal').classList.add('hidden');
  toggleMobileCart(false); // close cart sheet on mobile after sale
  lastSaleForPrint = sale;
  showReceipt(sale);
  cart = [];
  cart._adminDiscount = 0;
  cart._adminDiscountNote = '';
  cart._appliedPromos = [];
  document.getElementById('adminDiscountRow').classList.add('hidden');
  const _aprEl = document.getElementById('promoAppliedRows'); if (_aprEl) _aprEl.innerHTML = '';
  const _pesEl = document.getElementById('promoEligibleSection'); if (_pesEl) _pesEl.innerHTML = '';
  renderCart(); renderProducts();
}

// ══════════════════════════════════════════════
// RECEIPT
// ══════════════════════════════════════════════
function showReceipt(sale) {
  lastSaleForPrint = sale;
  const lines = sale.items.map(i =>
    `<div style="display:flex;justify-content:space-between;">
      <span>${escHtml(i.name)} × ${i.qty}</span><span>${fmt(i.price*i.qty)} ج</span>
    </div>`).join('');
  document.getElementById('receiptContent').innerHTML = `
    <div style="text-align:center;margin-bottom:10px;">
      <div style="display:inline-block;background:#1a5faf;padding:8px 18px;border-radius:6px;margin-bottom:6px;">
        <div style="font-family:'Jost',Arial,sans-serif;color:white;font-size:14px;font-weight:700;letter-spacing:3px;">VOODO</div>
        <div style="font-family:'Jost',Arial,sans-serif;color:white;font-size:8px;font-weight:300;letter-spacing:6px;">HOME</div>
      </div>
      <div style="font-size:13px;font-weight:700;margin-top:4px;">فاتورة مبيعات</div>
      <div style="font-size:11px;color:gray;">${new Date(sale.date).toLocaleString('ar-EG')}</div>
      <div style="font-size:11px;color:gray;">رقم: ${String(sale.id).slice(-8)}</div>
      ${sale.salesperson ? `<div style="font-size:11px;color:gray;">البائع: ${escHtml(sale.salesperson)}</div>` : ''}
    </div>
    <hr style="border:1px dashed #ccc;margin:8px 0;">
    ${lines}
    <hr style="border:1px dashed #ccc;margin:8px 0;">
    <div style="display:flex;justify-content:space-between;"><span>المجموع</span><span>${fmt(sale.sub)} ج</span></div>
    ${sale.disc > 0 ? `<div style="display:flex;justify-content:space-between;color:green;"><span>خصم</span><span>-${fmt(sale.disc)} ج</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-top:4px;border-top:1px solid #ccc;padding-top:4px;">
      <span>الإجمالي</span><span>${fmt(sale.total)} ج</span>
    </div>
    ${sale.payMethod === 'cash' ? `
    <div style="display:flex;justify-content:space-between;color:#2563eb;margin-top:4px;"><span>مدفوع</span><span>${fmt(sale.paid)} ج</span></div>
    <div style="display:flex;justify-content:space-between;color:green;font-weight:700;"><span>الباقي</span><span>${fmt(sale.change)} ج</span></div>
    ` : '<div style="text-align:center;color:#2563eb;margin-top:6px;">💳 دفع بالكارت</div>'}
    <div style="text-align:center;margin-top:12px;font-size:12px;color:gray;">شكراً لتعاملكم معنا 🙏</div>`;
  document.getElementById('receiptModal').classList.remove('hidden');
}

function printReceipt() {
  const html = document.getElementById('receiptContent').innerHTML;
  const w = window.open('','_blank','width=400,height=600');
  w.document.write('<html dir="rtl"><head><style>body{font-family:monospace;direction:rtl;padding:20px;font-size:13px;}</style></head><body>' + html + '</body></html>');
  w.document.close(); w.print();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

