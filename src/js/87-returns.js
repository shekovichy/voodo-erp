// ══════════════════════════════════════════════
// #2 RETURNS
// ══════════════════════════════════════════════
let _returnOriginalSale = null;

function openReturnFromModal() {
  if (!lastSaleForPrint) return;
  if (lastSaleForPrint.isReturn) { showToast('لا يمكن إرجاع فاتورة مرتجعة'); return; }
  _returnOriginalSale = lastSaleForPrint;
  document.getElementById('returnReason').value = '';
  document.getElementById('returnSummary').style.display = 'none';
  document.getElementById('returnItemsList').innerHTML = lastSaleForPrint.items.map((item, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${escHtml(item.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">سعر الوحدة: ${fmt(item.price)} ج · الكمية الأصلية: ${item.qty}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <label style="font-size:12px;color:var(--text-muted);">كمية الإرجاع:</label>
        <input type="number" class="form-control" id="ret-qty-${idx}"
          value="0" min="0" max="${item.qty}" style="width:70px;text-align:center;"
          oninput="calcReturnTotal()" />
      </div>
    </div>`).join('');
  calcReturnTotal();
  document.getElementById('returnModal').classList.remove('hidden');
}

function calcReturnTotal() {
  if (!_returnOriginalSale) return;
  let total = 0;
  _returnOriginalSale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('ret-qty-'+idx)?.value)||0;
    total += qty * item.price;
  });
  const sumEl = document.getElementById('returnSummary');
  const totEl = document.getElementById('returnTotalDisplay');
  if (sumEl && totEl) { totEl.textContent = fmt(total); sumEl.style.display = total > 0 ? 'block' : 'none'; }
}

function processReturn() {
  if (!_returnOriginalSale) return;
  const sale = _returnOriginalSale;
  const reason = document.getElementById('returnReason').value.trim();
  const returnItems = [];
  let returnTotal = 0;
  sale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('ret-qty-'+idx)?.value)||0;
    if (qty > 0) { returnItems.push({...item, qty:-qty}); returnTotal += qty * item.price; }
  });
  if (!returnItems.length) { showToast('اختر على الأقل صنف واحد للإرجاع'); return; }
  showConfirmModal(`تأكيد إرجاع ${returnItems.length} صنف — المبلغ المسترد: ${fmt(returnTotal)} ج؟`, function() {
  _processReturnConfirmed(sale, reason, returnItems, returnTotal);
  });
}
function _processReturnConfirmed(sale, reason, returnItems, returnTotal) {
  // Restock into the ORIGINAL sale's branch, not whatever branch the admin is
  // currently viewing — otherwise returning a b1 invoice while viewing b2 would
  // credit the wrong branch's stock. Transactional (see adjustStock).
  const branchId = sale.branchId || currentBranch;
  adjustStock(returnItems.map(ri => ({ code: ri.code, delta: Math.abs(ri.qty) })), branchId);

  // Save return sale — carry over branch and customer so it shows up in the
  // right branch's reports and the customer's history.
  const returnSale = {
    id:             Date.now(),
    date:           new Date().toISOString(),
    isReturn:       true,
    originalSaleId: sale.id,
    returnReason:   reason || 'غير محدد',
    cashier:        currentUsername || (currentUser === 'admin' ? 'مدير' : 'كاشير'),
    salesperson:    sale.salesperson || '',
    branchId,
    branchName:     sale.branchName || getBranchName(branchId),
    customerId:     sale.customerId || '',
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

  document.getElementById('returnModal').classList.add('hidden');
  document.getElementById('saleDetailModal').classList.add('hidden');
  showToast(`✅ تم معالجة المرتجع — المبلغ المسترد: ${fmt(returnTotal)} ج\n📦 تم إعادة الكميات للمخزون`);
  if (!document.getElementById('page-sales').classList.contains('hidden')) renderSales();
  if (!document.getElementById('page-inventory').classList.contains('hidden')) renderInventory();
}

function buildReturnsReport() {
  const period = document.getElementById('rptReturnsPeriod').value;
  document.getElementById('rptReturnsCustom').classList.toggle('hidden', period!=='custom');
  const { from, to } = getDateRange(period, 'rptReturnsFrom', 'rptReturnsTo');
  const rbf = document.getElementById('rptReturnsBranchFilter');
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
  const returns = getSales().filter(s => {
    if (!s.isReturn) return false;
    if (branchFilter !== 'all' && s.branchId !== branchFilter) return false;
    const d = new Date(s.date); return d >= from && d <= to;
  });
  const count = returns.length;
  const total = returns.reduce((s,r) => s + Math.abs(r.total), 0);
  const units = returns.reduce((s,r) => s + r.items.reduce((a,i) => a + Math.abs(i.qty), 0), 0);
  animateNumber(document.getElementById('ret-count'), count);
  animateNumber(document.getElementById('ret-total'), total, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('ret-units'), units);
  document.getElementById('ret-body').innerHTML = !returns.length
    ? '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">لا توجد مرتجعات في هذه الفترة</td></tr>'
    : returns.sort((a,b) => new Date(b.date)-new Date(a.date)).map(r => `<tr>
        <td><span class="badge-return">مرتجع #${String(r.id).slice(-6)}</span></td>
        <td style="white-space:nowrap;">${new Date(r.date).toLocaleString('ar-EG')}</td>
        <td>${r.originalSaleId ? '#'+String(r.originalSaleId).slice(-6) : '-'}</td>
        <td>${r.items.map(i=>escHtml(i.name)+' ×'+Math.abs(i.qty)).join(' · ')}</td>
        <td style="color:var(--danger);font-weight:700;">${fmt(Math.abs(r.total))} ج</td>
        <td>${escHtml(r.returnReason)||'-'}</td>
      </tr>`).join('');
}

