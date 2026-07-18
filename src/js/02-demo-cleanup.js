// ══════════════════════════════════════════════════════════════════════
// ONE-TIME DEMO-DATA CLEANUP TOOL
// The old demo mode wrote its sample data to localStorage; on a device that
// later signed in for real, the Firestore "seed empty doc from localStorage"
// listeners uploaded that demo data into the live database. The demo mode
// itself has been removed — this tool finds and removes the records it
// leaked, matching only STRONG demo fingerprints, and always previews before
// deleting. Safe to delete this file once the data is clean.
// ══════════════════════════════════════════════════════════════════════

// Demo product codes were exactly P001..P020 with barcodes 6001001..6001020.
const _DEMO_CODES = new Set(Array.from({ length: 20 }, (_, i) => 'P' + String(i + 1).padStart(3, '0')));
// Demo customers had these exact ids / phones.
const _DEMO_CUST_IDS = new Set(['C001', 'C002', 'C003', 'C004', 'C005']);
const _DEMO_CUST_PHONES = new Set(['01001111111', '01112222222', '01223333333', '01034444444', '01155555555']);

// A sale is treated as demo only on a strong signal, to avoid ever touching a
// real invoice:
//   • payMethod 'installment' — the live POS only produces cash/card/return,
//     never 'installment' (that value exists ONLY in the old demo generator), OR
//   • it has line items and EVERY item references a demo product code
//     (P001–P020). A real invoice would have to consist entirely of items
//     coded exactly like the demo set to match — which the preview surfaces
//     for the admin to verify before anything is deleted.
function _isDemoSale(s) {
  if (!s) return false;
  if (s.payMethod === 'installment') return true;
  const items = s.items || [];
  if (!items.length) return false;
  return items.every(i => _DEMO_CODES.has(i.code));
}
function _isDemoCustomer(c) {
  return _DEMO_CUST_IDS.has(c.id) || _DEMO_CUST_PHONES.has(String(c.phone || ''));
}

let _demoCleanupPlan = null;

function previewDemoCleanup() {
  const allSales = getSales();
  const demoSales = allSales.filter(_isDemoSale);
  const demoSalesValue = demoSales.reduce((s, x) => s + (x.total || 0), 0);
  const affectedMonths = [...new Set(demoSales.map(s => (s.date || '').slice(0, 7)))].filter(Boolean).sort();
  // Sales now live at pos_sales/{month}/branches/{branchId} (see 00-core.js/
  // addSale — branch-isolated storage, added 2026-07-17), not a flat
  // pos_sales/{month} doc. Cleanup must rewrite the SAME per-branch
  // documents the live listeners actually watch, or the fix only ever
  // "sticks" in the admin's own in-memory cache until the next listener
  // update pulls the still-dirty server copy right back.
  const affectedMonthBranches = [...new Set(demoSales.map(s => (s.date||'').slice(0,7) + '|' + (s.branchId||currentBranch)))]
    .filter(k => k.split('|')[0]).map(k => { const [month, branchId] = k.split('|'); return { month, branchId }; });

  const demoCustomers = getCustomers().filter(_isDemoCustomer);

  const demoInvByBranch = {};
  let demoInvTotal = 0;
  BRANCH_IDS.forEach(b => {
    const found = getInv(b).filter(p => _DEMO_CODES.has(p.code));
    if (found.length) { demoInvByBranch[b] = found; demoInvTotal += found.length; }
  });

  _demoCleanupPlan = { demoSales, affectedMonths, affectedMonthBranches, demoCustomers, demoInvByBranch };

  const nothing = !demoSales.length && !demoCustomers.length && !demoInvTotal;
  const branchLines = Object.keys(demoInvByBranch).map(b =>
    `<div style="font-size:12px;">• ${escHtml(getBranchName(b))}: ${demoInvByBranch[b].length} منتج</div>`).join('');
  const sampleSales = demoSales.slice(0, 5).map(s =>
    `<div style="font-size:11px;color:var(--text-muted);">#${String(s.id).slice(-6)} — ${fmt(s.total)} ج — ${escHtml(s.salesperson || s.cashier || '')} — ${(s.date || '').slice(0, 10)}${s.payMethod === 'installment' ? ' — (تقسيط: بصمة ديمو)' : ''}</div>`).join('');

  const body = nothing
    ? '<div style="padding:16px;text-align:center;color:var(--success);font-weight:700;">✅ مفيش أي بيانات ديمو متسربة — كله نظيف.</div>'
    : `
      <div style="padding:4px 2px 12px;">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:12px;">
          <div style="font-weight:700;margin-bottom:8px;">هيتم حذف الآتي (بيانات ديمو مؤكدة فقط):</div>
          <div style="font-size:13px;margin-bottom:4px;">🧾 <strong>${demoSales.length}</strong> فاتورة تجريبية — إجمالي ${fmt(demoSalesValue)} ج ${affectedMonths.length ? '(شهور: ' + affectedMonths.join('، ') + ')' : ''}</div>
          <div style="font-size:13px;margin-bottom:4px;">👥 <strong>${demoCustomers.length}</strong> عميل تجريبي</div>
          <div style="font-size:13px;margin-bottom:4px;">📦 <strong>${demoInvTotal}</strong> منتج تجريبي في المخزون${branchLines ? ':' : ''}</div>
          ${branchLines}
        </div>
        ${demoSales.length ? `<div style="margin-bottom:8px;"><div style="font-size:12px;font-weight:700;margin-bottom:4px;">عينة من الفواتير اللي هتتحذف:</div>${sampleSales}${demoSales.length > 5 ? `<div style="font-size:11px;color:var(--text-muted);">... و${demoSales.length - 5} فاتورة أخرى</div>` : ''}</div>` : ''}
        <div style="font-size:12px;color:var(--text-muted);margin-top:10px;background:var(--bg-secondary);border-radius:8px;padding:10px;">
          ⚠️ راجع العينة كويس. لو شفت أي فاتورة أو عميل <strong>حقيقي</strong> في القايمة، متكملش واتصل بيا — يعني أكواد منتجاتك الحقيقية بتتقاطع مع أكواد الديمو (P001–P020) ومحتاجين بصمة أدق. لو كله فعلاً ديمو، كمّل الحذف. <strong>اعمل نسخة احتياطية (تصدير) الأول من قسم النسخ الاحتياطي لو حابب.</strong>
        </div>
      </div>`;

  _openDemoCleanupModal(body, !nothing);
}

function _openDemoCleanupModal(bodyHtml, showConfirm) {
  let modal = document.getElementById('demoCleanupModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'demoCleanupModal';
    modal.className = 'modal-overlay hidden';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:520px;width:94%;">
      <div class="modal-header">
        <h3>🧹 تنظيف بيانات الديمو</h3>
        <button onclick="document.getElementById('demoCleanupModal').classList.add('hidden')" style="background:none;border:none;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <div style="max-height:60vh;overflow-y:auto;">${bodyHtml}</div>
      <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;">
        <button class="btn btn-gray btn-sm" onclick="document.getElementById('demoCleanupModal').classList.add('hidden')">إغلاق</button>
        ${showConfirm ? '<button class="btn btn-danger btn-sm" onclick="executeDemoCleanup()">🗑️ احذف بيانات الديمو دي</button>' : ''}
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

function executeDemoCleanup() {
  if (currentUser !== 'admin') { showToast('التنظيف للأدمن فقط'); return; }
  const plan = _demoCleanupPlan;
  if (!plan) { showToast('اعمل فحص الأول'); return; }

  // ── Sales: rewrite each affected (month, branch) doc with only the
  // NON-demo sales for that specific branch — the actual document the live
  // listeners watch (pos_sales/{month}/branches/{branchId}). A plain
  // overwrite (not arrayUnion/merge) is required here since we're SHRINKING
  // the list, not adding to it.
  const demoIds = new Set(plan.demoSales.map(s => s.id));
  _salesCache = getSales().filter(s => !demoIds.has(s.id));
  DB.s('sales', _salesCache);
  if (_fbReady) {
    (plan.affectedMonthBranches || []).forEach(({ month, branchId }) => {
      const items = _salesCache.filter(s => (s.date || '').slice(0, 7) === month && (s.branchId || currentBranch) === branchId);
      _db.collection('pos_sales').doc(month).collection('branches').doc(branchId)
         .set({ items, updatedAt: Date.now(), month, branchId })
         .catch(e => console.error('demo cleanup sales:', e));
    });
  }

  // ── Customers ──
  if (plan.demoCustomers.length) {
    const demoCustIds = new Set(plan.demoCustomers.map(c => c.id));
    setCustomers(getCustomers().filter(c => !demoCustIds.has(c.id)));
  }

  // ── Inventory: drop demo product codes from each affected branch ──
  Object.keys(plan.demoInvByBranch).forEach(b => {
    const cleaned = getInv(b).filter(p => !_DEMO_CODES.has(p.code));
    setInv(cleaned, b);
  });

  const removed = plan.demoSales.length + plan.demoCustomers.length +
    Object.values(plan.demoInvByBranch).reduce((s, arr) => s + arr.length, 0);
  addAuditLog('demo.cleanup', `تنظيف بيانات الديمو — ${plan.demoSales.length} فاتورة، ${plan.demoCustomers.length} عميل، ${Object.values(plan.demoInvByBranch).reduce((s, arr) => s + arr.length, 0)} منتج`, null);
  _demoCleanupPlan = null;
  document.getElementById('demoCleanupModal').classList.add('hidden');
  showMsg('sSettingsMsg', `✅ تم حذف ${removed} سجل ديمو. راجع التقارير للتأكد.`);
  try { buildDashboard(); } catch (e) {}
}
