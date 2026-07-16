// ══════════════════════════════════════════════
// PURCHASE MANAGEMENT SYSTEM
// ══════════════════════════════════════════════

const getSuppliers = () => _suppliersCache;
function setSuppliers(list) {
  _suppliersCache = list;
  DB.s('pos_suppliers', list);
  try { _db && _db.collection('pos_data').doc('suppliers').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

const getPurchases = () => _purchaseCache;
function setPurchases(list) {
  _purchaseCache = list;
  DB.s('pos_purchases', list);
  try { _db && _db.collection('pos_data').doc('purchases').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

// Payments recorded against a supplier's balance (accounts payable) — each
// payment auto-allocates FIFO across that supplier's oldest unpaid/partial
// purchase orders, so AP Aging can be computed per-invoice, not just as one
// running balance. See recordSupplierPayment() below.
const getSupplierPayments = () => _supplierPaymentsCache;
function setSupplierPayments(list) {
  _supplierPaymentsCache = list;
  DB.s('pos_supplier_payments', list);
  try { _db && _db.collection('pos_data').doc('supplier_payments').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

// ── Supplier CRUD ──
function openSupplierModal(id) {
  const sup = id ? getSuppliers().find(s => s.id === id) : null;
  document.getElementById('supModalTitle').textContent = sup ? '✏️ تعديل مورد' : '➕ مورد جديد';
  document.getElementById('supEditId').value   = sup?.id || '';
  document.getElementById('supName').value     = sup?.name || '';
  document.getElementById('supPhone').value    = sup?.phone || '';
  document.getElementById('supAddress').value  = sup?.address || '';
  document.getElementById('supBalance').value  = sup?.balance || 0;
  document.getElementById('supPaymentTerms').value = sup?.paymentTerms ?? 30;
  document.getElementById('supNotes').value    = sup?.notes || '';
  document.getElementById('supplierModal').classList.remove('hidden');
}

function saveSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { showToast('أدخل اسم المورد'); return; }
  const editId = document.getElementById('supEditId').value;
  const list = getSuppliers();
  const rec = {
    id: editId || 'sup_' + Date.now(),
    name,
    phone:   document.getElementById('supPhone').value.trim(),
    address: document.getElementById('supAddress').value.trim(),
    balance: parseFloat(document.getElementById('supBalance').value) || 0,
    paymentTerms: parseInt(document.getElementById('supPaymentTerms').value) || 30,
    notes:   document.getElementById('supNotes').value.trim(),
    createdAt: editId ? (list.find(s=>s.id===editId)?.createdAt || Date.now()) : Date.now()
  };
  if (editId) {
    const idx = list.findIndex(s => s.id === editId);
    if (idx >= 0) list[idx] = rec; else list.push(rec);
  } else {
    list.push(rec);
  }
  setSuppliers(list);
  closeModal('supplierModal');
  renderSuppliersPage();
}

function deleteSupplier(id) {
  showConfirmModal('حذف هذا المورد نهائياً؟', function() {
    setSuppliers(getSuppliers().filter(s => s.id !== id));
    renderSuppliersPage();
  });
}

function renderSuppliersPage() {
  const q = (document.getElementById('supSearch')?.value || '').toLowerCase();
  let list = getSuppliers();
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.phone.includes(q));
  const totalDebt = getSuppliers().reduce((s, x) => s + (x.balance || 0), 0);
  animateNumber(document.getElementById('sup-count'), getSuppliers().length);
  animateNumber(document.getElementById('sup-debt'),  totalDebt, { format: fmt, suffix: ' ج' });
  const tbody = document.getElementById('suppliersBody'); if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">لا يوجد موردون بعد — أضف أول مورد</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => `<tr>
    <td style="font-weight:600;">${escHtml(s.name)}</td>
    <td>${escHtml(s.phone) || '-'}</td>
    <td style="font-size:12px; color:var(--text-muted);">${escHtml(s.address) || '-'}</td>
    <td style="font-weight:600; color:${(s.balance||0)>0?'var(--danger)':'var(--success)'};">${fmt(s.balance||0)} ج</td>
    <td style="font-size:12px; color:var(--text-muted);">${escHtml(s.notes) || '-'}</td>
    <td>
      ${(s.balance||0)>0?`<button class="btn btn-success btn-sm" onclick="openSupplierPaymentModal('${escJsAttr(s.id)}')" style="font-size:11px; padding:3px 8px; margin-left:4px;">💵 دفعة</button>`:''}
      <button class="btn btn-sm" onclick="openSupplierModal('${escJsAttr(s.id)}')" style="font-size:11px; padding:3px 8px; margin-left:4px;">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${escJsAttr(s.id)}')" style="font-size:11px; padding:3px 8px;">🗑️</button>
    </td>
  </tr>`).join('');
}

// ── Purchase Orders ──
let _poItems = []; // [{code, name, qty, cost}]
let _poViewId = null;

function openPOModal(id) {
  _poItems = [];
  const po = id ? getPurchases().find(p => p.id === id) : null;
  document.getElementById('poModalTitle').textContent = po ? '✏️ تعديل أمر الشراء' : '📋 أمر شراء جديد';
  document.getElementById('poEditId').value = po?.id || '';
  // Populate supplier dropdown
  const supSel = document.getElementById('poSupplierId');
  supSel.innerHTML = '<option value="">-- اختر مورد --</option>' +
    getSuppliers().map(s => `<option value="${escHtml(s.id)}" ${po?.supplierId===s.id?'selected':''}>${escHtml(s.name)}</option>`).join('');
  // Populate branch dropdown
  const brSel = document.getElementById('poBranchId');
  brSel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}" ${(po?.branchId||currentBranch)===b?'selected':''}>${getBranchName(b)}</option>`).join('');
  document.getElementById('poShipping').value      = po?.shipping || 0;
  document.getElementById('poNotes').value         = po?.notes || '';
  document.getElementById('poExpectedDate').value  = po?.expectedDate || '';
  if (po?.items) _poItems = JSON.parse(JSON.stringify(po.items));
  renderPOItems();
  calcPOTotals();
  document.getElementById('poModal').classList.remove('hidden');
}

function poProdSearchFn() {
  const q = document.getElementById('poProdSearch').value.toLowerCase().trim();
  const dd = document.getElementById('poProdDropdown');
  if (!q) { dd.classList.add('hidden'); return; }
  const results = getInv().filter(i => i.name.toLowerCase().includes(q) || (i.code||'').toLowerCase().includes(q)).slice(0,8);
  if (!results.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML = results.map(i => `<div style="padding:8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid var(--border);"
    onmousedown="selectPOProduct('${escJsAttr(i.code)}','${escJsAttr(i.name)}',${i.cost||0})">
    <span style="font-weight:600;">${escHtml(i.name)}</span>
    <span style="color:var(--text-muted); font-size:11px; margin-right:8px;">${escHtml(i.code)}</span>
    <span style="color:var(--primary); font-size:11px;">تكلفة: ${fmt(i.cost||0)} ج</span>
  </div>`).join('');
  dd.classList.remove('hidden');
}

function selectPOProduct(code, name, cost) {
  document.getElementById('poProdDropdown').classList.add('hidden');
  document.getElementById('poProdSearch').value = '';
  const existing = _poItems.find(i => i.code === code);
  if (existing) { existing.qty++; }
  else { _poItems.push({ code, name, qty: 1, cost: cost || 0 }); }
  renderPOItems();
  calcPOTotals();
}

function updatePOItem(code, field, val) {
  const item = _poItems.find(i => i.code === code);
  if (!item) return;
  item[field] = parseFloat(val) || 0;
  calcPOTotals();
  // Update inline total cell
  const totalEl = document.getElementById(`po-line-total-${code}`);
  if (totalEl) totalEl.textContent = fmt(item.qty * item.cost) + ' ج';
}

function removePOItem(code) {
  _poItems = _poItems.filter(i => i.code !== code);
  renderPOItems();
  calcPOTotals();
}

function renderPOItems() {
  const tbody = document.getElementById('poItemsBody'); if (!tbody) return;
  if (!_poItems.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:16px;">لم تُضف أصناف بعد</td></tr>';
    return;
  }
  tbody.innerHTML = _poItems.map(i => `<tr>
    <td style="font-size:13px;">${escHtml(i.name)}<br><span style="font-size:10px;color:var(--text-muted);">${escHtml(i.code)}</span></td>
    <td><input type="number" value="${i.qty}" min="1" style="width:60px;" class="form-control" style="padding:4px;"
      oninput="updatePOItem('${escJsAttr(i.code)}','qty',this.value)" /></td>
    <td><input type="number" value="${i.cost}" min="0" step="0.01" style="width:80px;" class="form-control" style="padding:4px;"
      oninput="updatePOItem('${escJsAttr(i.code)}','cost',this.value)" /></td>
    <td id="po-line-total-${escHtml(i.code)}" style="font-weight:600;">${fmt(i.qty*i.cost)} ج</td>
    <td><button class="btn btn-danger btn-sm" onclick="removePOItem('${escJsAttr(i.code)}')" style="padding:2px 6px; font-size:11px;">✕</button></td>
  </tr>`).join('');
}

function calcPOTotals() {
  const subtotal = _poItems.reduce((s, i) => s + i.qty * i.cost, 0);
  const shipping = parseFloat(document.getElementById('poShipping')?.value) || 0;
  const grand = subtotal + shipping;
  const s = document.getElementById('poSubtotal'); if (s) s.textContent = fmt(subtotal) + ' ج';
  const sd = document.getElementById('poShippingDisp'); if (sd) sd.textContent = fmt(shipping) + ' ج';
  const g = document.getElementById('poGrandTotal'); if (g) g.textContent = fmt(grand) + ' ج';
}

function savePO() {
  const supplierId = document.getElementById('poSupplierId').value;
  if (!supplierId) { showToast('اختر المورد أولاً'); return; }
  if (!_poItems.length) { showToast('أضف صنف واحد على الأقل'); return; }
  const editId = document.getElementById('poEditId').value;
  const shipping = parseFloat(document.getElementById('poShipping').value) || 0;
  const subtotal = _poItems.reduce((s, i) => s + i.qty * i.cost, 0);
  const supplier = getSuppliers().find(s => s.id === supplierId);
  const list = getPurchases();
  const rec = {
    id: editId || 'po_' + Date.now(),
    supplierId,
    supplierName: supplier?.name || '',
    branchId: document.getElementById('poBranchId').value,
    items: JSON.parse(JSON.stringify(_poItems)),
    shipping,
    subtotal,
    total: subtotal + shipping,
    notes: document.getElementById('poNotes').value.trim(),
    expectedDate: document.getElementById('poExpectedDate').value,
    status: editId ? (list.find(p=>p.id===editId)?.status || 'pending') : 'pending',
    createdAt: editId ? (list.find(p=>p.id===editId)?.createdAt || Date.now()) : Date.now(),
    by: currentUser
  };
  if (editId) { const idx = list.findIndex(p => p.id === editId); if (idx>=0) list[idx]=rec; else list.push(rec); }
  else list.push(rec);
  setPurchases(list);
  closeModal('poModal');
  renderPurchasesPage();
}

function openPODetails(id) {
  const po = getPurchases().find(p => p.id === id);
  if (!po) return;
  _poViewId = id;
  document.getElementById('poDetailsTitle').textContent = `📋 أمر الشراء #${po.id.slice(-6)}`;
  const statusLabel = po.status === 'received' ? '✅ مستلمة' : po.status === 'partial' ? '🔶 جزئي' : '⏳ قيد الانتظار';
  const statusColor = po.status === 'received' ? '#065f46' : po.status === 'partial' ? '#92400e' : '#1d4ed8';
  const statusBg    = po.status === 'received' ? '#d1fae5' : po.status === 'partial' ? '#fef9c3' : '#dbeafe';
  document.getElementById('poDetailsBody').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px; background:var(--bg); border-radius:8px; padding:12px; border:1px solid var(--border);">
      <div><div style="font-size:11px;color:var(--text-muted);">المورد</div><div style="font-weight:700;">${escHtml(po.supplierName)}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted);">الفرع</div><div style="font-weight:700;">${getBranchName(po.branchId)}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted);">الحالة</div><span style="background:${statusBg};color:${statusColor};padding:2px 10px;border-radius:10px;font-size:12px;">${statusLabel}</span></div>
      <div><div style="font-size:11px;color:var(--text-muted);">تاريخ الإنشاء</div><div style="font-size:12px;">${new Date(po.createdAt).toLocaleDateString('ar-EG')}</div></div>
      ${po.expectedDate?`<div><div style="font-size:11px;color:var(--text-muted);">موعد الاستلام</div><div style="font-size:12px;">${po.expectedDate}</div></div>`:''}
      ${po.receivedAt?`<div><div style="font-size:11px;color:var(--text-muted);">تاريخ الاستلام</div><div style="font-size:12px;color:var(--success);">${new Date(po.receivedAt).toLocaleDateString('ar-EG')}</div></div>`:''}
      ${po.status==='received'?`<div><div style="font-size:11px;color:var(--text-muted);">موعد الاستحقاق</div><div style="font-size:12px;">${po.dueDate?new Date(po.dueDate).toLocaleDateString('ar-EG'):'-'}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted);">حالة السداد</div><span style="background:${po.payStatus==='paid'?'#d1fae5':po.payStatus==='partial_paid'?'#fef9c3':'#fee2e2'};color:${po.payStatus==='paid'?'#065f46':po.payStatus==='partial_paid'?'#92400e':'#991b1b'};padding:2px 10px;border-radius:10px;font-size:12px;">${po.payStatus==='paid'?'✅ مسددة':po.payStatus==='partial_paid'?'🔶 مسددة جزئياً':'❌ غير مسددة'}</span></div>
      <div><div style="font-size:11px;color:var(--text-muted);">المتبقي</div><div style="font-size:12px;font-weight:700;color:${(po.total-(po.paidAmount||0))>0?'var(--danger)':'var(--success)'};">${fmt(po.total-(po.paidAmount||0))} ج</div></div>`:''}
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:12px;">
      <thead><tr style="background:var(--bg);">
        <th style="padding:8px; text-align:right; border:1px solid var(--border);">الصنف</th>
        <th style="padding:8px; text-align:center; border:1px solid var(--border);">الكمية</th>
        <th style="padding:8px; text-align:center; border:1px solid var(--border);">التكلفة</th>
        <th style="padding:8px; text-align:center; border:1px solid var(--border);">الإجمالي</th>
      </tr></thead>
      <tbody>${po.items.map(i=>`<tr>
        <td style="padding:8px; border:1px solid var(--border);">${escHtml(i.name)}</td>
        <td style="padding:8px; text-align:center; border:1px solid var(--border);">${i.qty}</td>
        <td style="padding:8px; text-align:center; border:1px solid var(--border);">${fmt(i.cost)} ج</td>
        <td style="padding:8px; text-align:center; border:1px solid var(--border);">${fmt(i.qty*i.cost)} ج</td>
      </tr>`).join('')}</tbody>
    </table>
    <div style="text-align:left; font-size:13px;">
      <div>إجمالي الأصناف: <strong>${fmt(po.subtotal)} ج</strong></div>
      <div>الشحن: <strong>${fmt(po.shipping||0)} ج</strong></div>
      <div style="font-size:16px; margin-top:4px;">الإجمالي الكلي: <strong style="color:var(--primary);">${fmt(po.total)} ج</strong></div>
    </div>
    ${po.notes?`<div style="margin-top:12px; padding:8px; background:#fffbeb; border-radius:6px; font-size:13px;">📝 ${escHtml(po.notes)}</div>`:''}
  `;
  const receiveSection = document.getElementById('poReceiveSection');
  const detailsFooter = document.getElementById('poDetailsFooter');
  if (po.status === 'pending' || po.status === 'partial') {
    receiveSection.classList.remove('hidden');
    detailsFooter.classList.add('hidden');
    document.getElementById('poReceiveBtn').dataset.poId = id;
  } else {
    receiveSection.classList.add('hidden');
    detailsFooter.classList.remove('hidden');
  }
  document.getElementById('poDetailsModal').classList.remove('hidden');
}

function receivePO() {
  const po = getPurchases().find(p => p.id === _poViewId);
  if (!po) return;
  showConfirmModal(`استلام بضاعة أمر الشراء #${po.id.slice(-6)}؟\nسيتم تحديث مخزون فرع: ${getBranchName(po.branchId)}\nوتحديث تكلفة الأصناف بما في ذلك تكلفة الشحن الموزعة.`, function() {
  _receivePOConfirmed(po);
  });
}
function _receivePOConfirmed(po) {
  const supplier = getSuppliers().find(s => s.id === po.supplierId);

  // Distribute shipping cost proportionally
  const subtotal = po.subtotal || po.items.reduce((s,i)=>s+i.qty*i.cost, 0);
  const shipping = po.shipping || 0;
  const inv = [...(getInv(po.branchId) || [])];

  po.items.forEach(item => {
    const shippingShare = subtotal > 0 ? (item.qty * item.cost / subtotal) * shipping : 0;
    const landedCost = item.cost + (item.qty > 0 ? shippingShare / item.qty : 0);
    const idx = inv.findIndex(i => i.code === item.code);
    if (idx >= 0) {
      // Weighted average cost
      const oldQty  = inv[idx].qty || 0;
      const oldCost = inv[idx].cost || 0;
      const newTotalQty = oldQty + item.qty;
      inv[idx].cost = newTotalQty > 0 ? (oldQty * oldCost + item.qty * landedCost) / newTotalQty : landedCost;
      inv[idx].qty  = newTotalQty;
    } else {
      // Add as new item
      inv.push({ code: item.code, name: item.name, qty: item.qty, cost: landedCost, price: item.cost * 1.3 });
    }
  });
  setInv(inv, po.branchId);

  // Update PO status + AP tracking (due date, payment status — see recordSupplierPayment())
  const list = getPurchases();
  const idx = list.findIndex(p => p.id === po.id);
  if (idx >= 0) {
    const receivedAt = Date.now();
    const termsDays = supplier?.paymentTerms ?? 30;
    list[idx].status = 'received';
    list[idx].receivedAt = receivedAt;
    list[idx].receivedBy = currentUser;
    list[idx].dueDate = receivedAt + termsDays * 86400000;
    list[idx].paidAmount = 0;
    list[idx].payStatus = 'unpaid';
  }
  setPurchases(list);

  // Update supplier balance
  const supList = getSuppliers();
  const supIdx = supList.findIndex(s => s.id === po.supplierId);
  if (supIdx >= 0) { supList[supIdx].balance = (supList[supIdx].balance || 0) + po.total; }
  setSuppliers(supList);

  addAuditLog('po.receive', `استلام أمر شراء #${po.id.slice(-6)} — ${getBranchName(po.branchId)} — ${fmt(po.total)} ج`, po.branchId);
  closeModal('poDetailsModal');
  renderPurchasesPage();
  showToast(`✅ تم الاستلام بنجاح!\nتم تحديث مخزون ${getBranchName(po.branchId)} وتكاليف الأصناف.`);
}

// ── Supplier Payments (AP) ──────────────────────────────────────
function openSupplierPaymentModal(supplierId) {
  const sup = getSuppliers().find(s => s.id === supplierId);
  if (!sup) return;
  document.getElementById('spSupplierId').value = supplierId;
  document.getElementById('spSupplierName').textContent = sup.name;
  document.getElementById('spCurrentBalance').textContent = fmt(sup.balance || 0) + ' ج';
  document.getElementById('spAmount').value = '';
  document.getElementById('spDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('spNotes').value = '';
  document.getElementById('supplierPaymentModal').classList.remove('hidden');
}
function closeSupplierPaymentModal() { document.getElementById('supplierPaymentModal').classList.add('hidden'); }

// Records a payment against a supplier's balance and auto-allocates it FIFO
// (oldest due date first) across that supplier's outstanding received POs,
// so AP Aging can report per-invoice status instead of one running total.
function saveSupplierPayment() {
  const supplierId = document.getElementById('spSupplierId').value;
  const amount = parseFloat(document.getElementById('spAmount').value);
  const date = document.getElementById('spDate').value;
  if (!amount || amount <= 0) { showToast('أدخل مبلغ صحيح'); return; }
  if (!date) { showToast('أدخل التاريخ'); return; }
  const sup = getSuppliers().find(s => s.id === supplierId);
  if (!sup) return;

  let remaining = amount;
  const allocations = [];
  const poList = getPurchases();
  const outstanding = poList
    .filter(p => p.supplierId === supplierId && p.status === 'received' && (p.payStatus || 'unpaid') !== 'paid')
    .sort((a, b) => (a.dueDate || a.receivedAt || 0) - (b.dueDate || b.receivedAt || 0));

  outstanding.forEach(po => {
    if (remaining <= 0) return;
    const owed = po.total - (po.paidAmount || 0);
    if (owed <= 0) return;
    const applied = Math.min(owed, remaining);
    po.paidAmount = (po.paidAmount || 0) + applied;
    po.payStatus = po.paidAmount >= po.total ? 'paid' : 'partial_paid';
    remaining -= applied;
    allocations.push({ poId: po.id, amount: applied });
  });
  setPurchases(poList);

  const supList = getSuppliers();
  const supIdx = supList.findIndex(s => s.id === supplierId);
  if (supIdx >= 0) supList[supIdx].balance = Math.max(0, (supList[supIdx].balance || 0) - amount);
  setSuppliers(supList);

  const payments = getSupplierPayments();
  payments.push({
    id: 'pay_' + Date.now(), supplierId, supplierName: sup.name,
    amount, date, allocations,
    notes: document.getElementById('spNotes').value.trim(),
    by: currentUser, createdAt: Date.now(),
  });
  setSupplierPayments(payments);

  addAuditLog('supplier.payment', `دفعة لمورد ${sup.name} — ${fmt(amount)} ج`, null);
  closeSupplierPaymentModal();
  renderPurchasesPage();
  showToast('✅ تم تسجيل الدفعة');
}

function deletePO(id) {
  showConfirmModal('حذف أمر الشراء هذا؟', function() {
    setPurchases(getPurchases().filter(p => p.id !== id));
    renderPurchasesPage();
  });
}

function switchPurchaseTab(tab) {
  document.getElementById('page-suppliers').classList.toggle('hidden', tab !== 'suppliers');
  document.getElementById('page-orders').classList.toggle('hidden', tab !== 'orders');
  const btnSup  = document.getElementById('tab-suppliers-btn');
  const btnOrd  = document.getElementById('tab-orders-btn');
  if (btnSup) { btnSup.className = tab === 'suppliers' ? 'btn btn-primary' : 'btn'; btnSup.style.cssText = 'border-radius:8px 8px 0 0;' + (tab!=='suppliers'?'background:var(--bg);color:var(--text);border:1px solid var(--border);':''); }
  if (btnOrd) { btnOrd.className = tab === 'orders' ? 'btn btn-primary' : 'btn'; btnOrd.style.cssText = 'border-radius:8px 8px 0 0;' + (tab!=='orders'?'background:var(--bg);color:var(--text);border:1px solid var(--border);':''); }
  if (tab === 'orders') populatePOFilters();
}

function populatePOFilters() {
  const supSel = document.getElementById('poSupplierFilter');
  if (supSel) {
    supSel.innerHTML = '<option value="">جميع الموردين</option>' +
      getSuppliers().map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  }
  const brSel = document.getElementById('poBranchFilter');
  if (brSel) {
    brSel.innerHTML = '<option value="">جميع الفروع</option>' +
      BRANCH_IDS.map(b => `<option value="${b}">${getBranchName(b)}</option>`).join('');
  }
}

function renderPurchasesPage() {
  renderSuppliersPage();
  // Stats
  let list = getPurchases();
  const pending  = list.filter(p=>p.status==='pending'||p.status==='partial').length;
  const received = list.filter(p=>p.status==='received').length;
  const total    = list.reduce((s,p)=>s+p.total,0);
  animateNumber(document.getElementById('po-count'),    list.length);
  animateNumber(document.getElementById('po-pending'),  pending);
  animateNumber(document.getElementById('po-received'), received);
  animateNumber(document.getElementById('po-total'),    total, { format: fmt, suffix: ' ج' });

  // Filters
  populatePOFilters();
  const stFilter  = document.getElementById('poStatusFilter')?.value || '';
  const supFilter = document.getElementById('poSupplierFilter')?.value || '';
  const brFilter  = document.getElementById('poBranchFilter')?.value || '';
  if (stFilter)  list = list.filter(p => p.status === stFilter);
  if (supFilter) list = list.filter(p => p.supplierId === supFilter);
  if (brFilter)  list = list.filter(p => p.branchId === brFilter);

  const tbody = document.getElementById('purchasesBody'); if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">لا توجد أوامر شراء بعد</td></tr>';
    return;
  }
  tbody.innerHTML = list.slice().reverse().map(po => {
    const statusLabel = po.status==='received'?'✅ مستلمة':po.status==='partial'?'🔶 جزئي':'⏳ انتظار';
    const statusBg    = po.status==='received'?'#d1fae5':po.status==='partial'?'#fef9c3':'#dbeafe';
    const statusColor = po.status==='received'?'#065f46':po.status==='partial'?'#92400e':'#1d4ed8';
    return `<tr>
      <td style="font-size:11px; color:var(--text-muted);">#${po.id.slice(-6)}</td>
      <td style="font-weight:600;">${escHtml(po.supplierName)}</td>
      <td><span style="font-size:12px; background:#f0f4ff; color:#4338ca; padding:2px 8px; border-radius:10px;">${getBranchName(po.branchId)}</span></td>
      <td style="font-size:12px;">${po.items.length} صنف</td>
      <td>${fmt(po.shipping||0)} ج</td>
      <td style="font-weight:700; color:var(--primary);">${fmt(po.total)} ج</td>
      <td style="font-size:12px;">${new Date(po.createdAt).toLocaleDateString('ar-EG')}</td>
      <td><span style="background:${statusBg};color:${statusColor};padding:2px 8px;border-radius:10px;font-size:11px;">${statusLabel}</span></td>
      <td>
        <button class="btn btn-sm" onclick="openPODetails('${po.id}')" style="font-size:11px; padding:3px 8px; margin-left:4px;">👁️</button>
        ${po.status!=='received'?`<button class="btn btn-sm" onclick="openPOModal('${po.id}')" style="font-size:11px; padding:3px 8px; margin-left:4px;">✏️</button>`:''}
        <button class="btn btn-danger btn-sm" onclick="deletePO('${po.id}')" style="font-size:11px; padding:3px 8px;">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

