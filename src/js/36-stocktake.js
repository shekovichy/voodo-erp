// ══════════════════════════════════════════════
// STOCK COUNT (جرد المخزون) — full-branch or a custom uploaded list.
// One session per branch, persisted to localStorage (device-local — no
// multi-device merge for a single count; two people counting the same
// branch at once on different devices isn't supported) so an accidental
// tab close/reload mid-count doesn't lose progress. Nothing touches real
// stock until the admin reviews the variance list and explicitly applies
// it — counting itself never writes to inventory.
// ══════════════════════════════════════════════
let _stockCountSession   = null; // { branchId, mode, startedAt, startedBy, items:[{code,name,expectedQty,countedQty}] }
let _stockCountPendingRows = null; // parsed rows from an uploaded custom-count sheet, before "ابدأ الجرد" is clicked

function _stockCountKey(branchId) { return `pos_stocktake_${branchId}`; }
function _persistStockCount() {
  if (!_stockCountSession) return;
  DB.s(_stockCountKey(_stockCountSession.branchId), _stockCountSession);
}
function _loadStockCountSession(branchId) {
  return DB.g(_stockCountKey(branchId), null);
}
function _clearStockCountSession(branchId) {
  localStorage.removeItem(_stockCountKey(branchId));
}

function openStockCountStartModal() {
  const b = invPageBranch();
  const existing = _loadStockCountSession(b);
  if (existing) {
    // Resume rather than restart — starting a fresh count over an
    // in-progress one would silently discard whatever's already counted.
    _stockCountSession = existing;
    renderStockCountModal();
    document.getElementById('stockCountModal').classList.remove('hidden');
    return;
  }
  _stockCountPendingRows = null;
  document.getElementById('stockCountFileInfo').textContent = '';
  document.getElementById('stockCountFile').value = '';
  document.querySelector('input[name="stockCountMode"][value="full"]').checked = true;
  stockCountModeChanged();
  document.getElementById('stockCountBranchLabel').textContent = getBranchName(b);
  document.getElementById('stockCountStartModal').classList.remove('hidden');
}

function stockCountModeChanged() {
  const mode = document.querySelector('input[name="stockCountMode"]:checked').value;
  document.getElementById('stockCountFileRow').classList.toggle('hidden', mode !== 'custom');
}

function handleStockCountFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      // Same UTF-8-safe read as importExcel() (35-inventory.js) — reading
      // as a binary string here would garble Arabic product codes/names.
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array', codepage: 65001 });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('الملف فارغ أو غير مقروء'); return; }
      _stockCountPendingRows = rows;
      document.getElementById('stockCountFileInfo').textContent = `✅ ${rows.length} صف جاهز للجرد`;
    } catch (ex) { showToast('خطأ في قراءة الملف: ' + ex.message); }
  };
  reader.readAsArrayBuffer(file);
}

function startStockCount() {
  const branchId = invPageBranch();
  const mode = document.querySelector('input[name="stockCountMode"]:checked').value;
  const inv = getInv(branchId);
  let items;

  if (mode === 'full') {
    items = inv.map(p => ({ code: p.code, name: p.name, expectedQty: p.qty, countedQty: null }));
  } else {
    if (!_stockCountPendingRows || !_stockCountPendingRows.length) { showToast('ارفع ملف الجرد الأول'); return; }
    const g = (row, ...keys) => { for (const k of keys) { const nk = Object.keys(row).find(h => h.trim().toLowerCase() === k); if (nk !== undefined && row[nk] !== '') return row[nk]; } return ''; };
    items = [];
    const seen = new Set();
    _stockCountPendingRows.forEach(row => {
      const code = String(g(row, 'code', 'كود', 'الكود', 'sku', 'barcode') || '').trim();
      if (!code || seen.has(code)) return;
      seen.add(code);
      const prod = inv.find(p => p.code.toLowerCase() === code.toLowerCase());
      const sheetQty = parseFloat(g(row, 'qty', 'quantity', 'الكمية', 'كمية'));
      items.push({
        code,
        name: prod ? prod.name : (String(g(row, 'name', 'اسم', 'الاسم') || '').trim() || code),
        expectedQty: !isNaN(sheetQty) ? sheetQty : (prod ? prod.qty : 0),
        countedQty: null,
        _notInSystem: !prod,
      });
    });
    if (!items.length) { showToast('الملف مفيهوش أي كود صنف صالح'); return; }
  }

  _stockCountSession = {
    branchId, mode, startedAt: Date.now(),
    startedBy: currentUsername || (currentUser === 'admin' ? 'مدير' : 'كاشير'),
    items, status: 'in_progress',
  };
  _persistStockCount();
  addAuditLog('stocktake.start', `بدء جرد ${mode === 'full' ? 'كامل' : 'مخصص'} — ${items.length} صنف`, branchId);
  document.getElementById('stockCountStartModal').classList.add('hidden');
  renderStockCountModal();
  document.getElementById('stockCountModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('stockCountScanInput')?.focus(), 100);
}

function renderStockCountModal() {
  const s = _stockCountSession; if (!s) return;
  document.getElementById('stockCountTitle').textContent = `📋 جرد ${s.mode === 'full' ? 'كامل' : 'مخصص'} — ${getBranchName(s.branchId)}`;
  const counted = s.items.filter(i => i.countedQty !== null).length;
  document.getElementById('stockCountProgress').textContent = `${counted} / ${s.items.length} صنف اتعدّ`;

  document.getElementById('stockCountBody').innerHTML = s.items.map((it, idx) => {
    const done = it.countedQty !== null;
    const diff = done ? it.countedQty - it.expectedQty : null;
    let statusHtml;
    if (!done) statusHtml = '<span class="badge" style="background:#f3f4f6;color:#6b7280;">لسه</span>';
    else if (diff === 0) statusHtml = '<span class="badge badge-success">مطابق</span>';
    else if (diff > 0) statusHtml = `<span class="badge" style="background:#dbeafe;color:#1d4ed8;">زيادة ${diff}</span>`;
    else statusHtml = `<span class="badge badge-danger">ناقص ${Math.abs(diff)}</span>`;
    return `<tr style="${done && diff !== 0 ? 'background:#fff5f5;' : ''}">
      <td style="font-size:12px;">${escHtml(it.code)}${it._notInSystem ? ' <span title="مش موجود في مخزون النظام" style="color:var(--danger);">⚠️</span>' : ''}</td>
      <td>${escHtml(it.name)}</td>
      <td>${it.expectedQty}</td>
      <td><input type="number" min="0" value="${done ? it.countedQty : ''}" placeholder="—" style="width:70px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;text-align:center;"
          onchange="stockCountSetQty(${idx}, this.value)" /></td>
      <td style="font-weight:700;color:${diff===null?'var(--text-muted)':diff===0?'var(--success)':'var(--danger)'};">${diff===null?'—':(diff>=0?'+':'')+diff}</td>
      <td>${statusHtml}</td>
    </tr>`;
  }).join('');
}

// Barcode guns act like a keyboard typing the code then Enter — scanning
// the same item twice increments its count, matching how a physical count
// actually works (one scan per physical unit found).
function stockCountScanEnter() {
  const input = document.getElementById('stockCountScanInput');
  const code = input.value.trim();
  input.value = '';
  if (!code) return;
  const s = _stockCountSession; if (!s) return;

  let idx = s.items.findIndex(i => i.code.toLowerCase() === code.toLowerCase());
  if (idx < 0) {
    if (s.mode === 'custom') {
      // Found something on the shelf that wasn't on the planned list —
      // useful to know (e.g. misplaced stock from another branch), so add
      // it rather than silently dropping the scan.
      const prod = getInv(s.branchId).find(p => p.code.toLowerCase() === code.toLowerCase());
      if (!prod) { showToast('⚠️ الكود ده مش معروف في السيستم خالص'); input.focus(); return; }
      s.items.push({ code: prod.code, name: prod.name, expectedQty: prod.qty, countedQty: 0 });
      idx = s.items.length - 1;
    } else {
      showToast('⚠️ الكود ده مش موجود في مخزون الفرع ده');
      input.focus();
      return;
    }
  }
  s.items[idx].countedQty = (s.items[idx].countedQty || 0) + 1;
  _persistStockCount();
  renderStockCountModal();
  input.focus();
}

function stockCountSetQty(idx, val) {
  const s = _stockCountSession; if (!s) return;
  const n = parseInt(val);
  s.items[idx].countedQty = (val === '' || isNaN(n)) ? null : Math.max(0, n);
  _persistStockCount();
  renderStockCountModal();
}

function cancelStockCount() {
  const s = _stockCountSession; if (!s) return;
  showConfirmModal('إلغاء الجرد الحالي؟ كل الكميات اللي اتعدّت هتضيع.', function () {
    addAuditLog('stocktake.cancel', `إلغاء جرد ${s.mode === 'full' ? 'كامل' : 'مخصص'} قبل التطبيق`, s.branchId);
    _clearStockCountSession(s.branchId);
    _stockCountSession = null;
    document.getElementById('stockCountModal').classList.add('hidden');
  });
}

function reviewStockCount() {
  const s = _stockCountSession; if (!s) return;
  const counted = s.items.filter(i => i.countedQty !== null);
  const variances = counted.filter(i => i.countedQty !== i.expectedQty);
  const uncounted = s.items.length - counted.length;
  const skippedNew = variances.filter(i => i._notInSystem);

  const body = document.getElementById('stockCountReviewBody');
  body.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <span style="background:#eff6ff;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">${counted.length} صنف اتعدّ</span>
      <span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">${variances.length} فرق</span>
      ${uncounted ? `<span style="background:#fef9c3;color:#92400e;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;">${uncounted} لسه ما اتعدّش (مش هيتغيّر)</span>` : ''}
    </div>
    ${!variances.length ? '<div style="text-align:center;padding:20px;color:var(--text-muted);">مفيش فروقات — كل حاجة مطابقة ✓</div>' : `
    <div class="table-wrap" style="max-height:40vh;">
      <table><thead><tr><th>الكود</th><th>المنتج</th><th>المتوقع</th><th>المعدود</th><th>الفرق</th></tr></thead>
        <tbody>${variances.map(i => `<tr>
          <td style="font-size:12px;">${escHtml(i.code)}</td>
          <td>${escHtml(i.name)}${i._notInSystem?' <span style="color:var(--danger);font-size:11px;">(مش هينضاف — مش موجود في النظام)</span>':''}</td>
          <td>${i.expectedQty}</td><td>${i.countedQty}</td>
          <td style="font-weight:700;color:${i.countedQty>i.expectedQty?'#1d4ed8':'var(--danger)'};">${i.countedQty>i.expectedQty?'+':''}${i.countedQty-i.expectedQty}</td>
        </tr>`).join('')}</tbody></table>
    </div>`}
    ${skippedNew.length ? `<div style="margin-top:10px;font-size:12px;color:var(--danger);">⚠️ ${skippedNew.length} صنف مش موجود في مخزون النظام — مش هيتضاف تلقائي وقت التطبيق، لازم يتضاف يدوي من "إضافة منتج" الأول.</div>` : ''}
  `;
  document.getElementById('stockCountModal').classList.add('hidden');
  document.getElementById('stockCountReviewModal').classList.remove('hidden');
}

function applyStockCount() {
  const s = _stockCountSession; if (!s) return;
  const variances = s.items.filter(i => i.countedQty !== null && i.countedQty !== i.expectedQty && !i._notInSystem);

  if (variances.length) {
    // One transactional bulk update (see adjustStock) — items that match
    // their expected count need no write at all.
    adjustStock(variances.map(i => ({ code: i.code, set: { qty: i.countedQty } })), s.branchId);
  }

  const changes = variances.map(i => ({ label: i.name, before: String(i.expectedQty), after: String(i.countedQty) }));
  const countedTotal = s.items.filter(i => i.countedQty !== null).length;
  addAuditLog('stocktake.apply',
    `تطبيق جرد ${s.mode === 'full' ? 'كامل' : 'مخصص'} — ${countedTotal} صنف اتعدّ، ${variances.length} اتصحّح`,
    s.branchId, changes.length ? changes : null);

  _clearStockCountSession(s.branchId);
  _stockCountSession = null;
  document.getElementById('stockCountReviewModal').classList.add('hidden');
  renderInventory();
  showToast(`✅ تم تطبيق الجرد — ${variances.length} صنف اتصحّحت كميته`);
}
