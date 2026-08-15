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

// ── Completed stock-takes (تسوية الجرد) ────────────────────────────
// Applying a count used to leave nothing behind but one audit-log line —
// item names and quantities, no codes and no costs — so there was no way to
// produce a reconciliation afterwards. Each applied count is now kept as its
// own immutable document (pos_stocktakes/{id}), same pattern as pos_audit:
// a record of what was counted, what it was worth, and who did it.
//
// Fetched on demand rather than through a listener — counts are occasional
// and historical, so a permanent subscription to a collection that only grows
// would cost more than it's worth.
let _stocktakesCache = null;
function getStocktakes() {
  if (!_stocktakesCache) _stocktakesCache = DB.g('pos_stocktakes', []);
  return _stocktakesCache;
}

// The snapshot is taken from the session plus the cost of each item at the
// moment of applying — cost is what values a variance, and looking it up
// later would price the count with whatever cost happens to be current then.
function _buildStocktakeRecord(s) {
  const inv = getInv(s.branchId);
  const items = s.items.map(function (i) {
    const p    = inv.find(x => x.code === i.code);
    const cost = p ? (parseFloat(p.cost) || 0) : 0;
    const diff = i.countedQty === null ? 0 : i.countedQty - i.expectedQty;
    return {
      code: i.code, name: i.name, cost: cost,
      expectedQty: i.expectedQty,
      countedQty:  i.countedQty,          // null = لم يُعد
      diff:        diff,
      value:       diff * cost,
      notInSystem: !!i._notInSystem,
    };
  });

  const counted   = items.filter(i => i.countedQty !== null);
  const applied   = counted.filter(i => i.diff !== 0 && !i.notInSystem);
  const surplus   = applied.filter(i => i.diff > 0).reduce((t, i) => t + i.value, 0);
  const shortage  = applied.filter(i => i.diff < 0).reduce((t, i) => t + i.value, 0);

  return {
    // Reuses the id when this count was reopened from a pending settlement, so
    // a review round revises that settlement instead of filing another one.
    id: s.settlementId || Date.now(),
    revisions:  (s.revisions || 0),
    branchId:   s.branchId,
    branchName: getBranchName(s.branchId),
    mode:       s.mode,
    startedAt:  s.startedAt,
    startedBy:  s.startedBy,
    // Counting and applying are two separate acts now. A count produces a
    // settlement and nothing else; the stock only moves when the owner
    // approves it, possibly days and several reviews later.
    countedAt:  Date.now(),
    countedBy:  currentUsername || currentUser || '',
    status:     'pending',
    items:      items,
    summary: {
      total:        items.length,
      counted:      counted.length,
      uncounted:    items.length - counted.length,
      matched:      counted.filter(i => i.diff === 0).length,
      variances:    applied.length,
      skipped:      counted.filter(i => i.diff !== 0 && i.notInSystem).length,
      surplusValue: surplus,
      shortageValue: shortage,          // سالب
      netValue:     surplus + shortage,
    },
  };
}

function _saveStocktake(rec) {
  const list = getStocktakes();
  // Upsert, not prepend: a revision and an approval both rewrite an existing
  // settlement, and blindly unshifting left a stale duplicate of it in the
  // local list (Firestore was fine — same document id).
  const i = list.findIndex(function (x) { return x.id === rec.id; });
  if (i === -1) list.unshift(rec); else list[i] = rec;
  _stocktakesCache = list.slice(0, 100);      // مرآة محلية محدودة
  DB.s('pos_stocktakes', _stocktakesCache);
  if (_fbReady && _db) {
    _db.collection('pos_stocktakes').doc(String(rec.id))
       .set(rec)
       .catch(function (e) { console.error('_saveStocktake:', e); });
  }
}

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
  // Belt as well as braces: the button is hidden for non-admins (renderInventory)
  // and firestore.rules refuses the record, but neither helps if this is reached
  // some other way — a stale page, a console call, a future entry point.
  if (currentUser !== 'admin') { showToast('الجرد للأدمن فقط'); return; }
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
      <td>${statusHtml}${it._notInSystem ? `<button onclick="addUnknownStockCountItem(${idx})" class="btn btn-sm" style="margin-right:6px;background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe;padding:2px 8px;font-size:11px;">➕ ضيفه</button>` : ''}</td>
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
  hideStockCountDropdown();
  if (!code) return;
  const s = _stockCountSession; if (!s) return;

  let idx = s.items.findIndex(i => i.code.toLowerCase() === code.toLowerCase());
  if (idx < 0) {
    // Found something on the shelf that wasn't on the list. If the system
    // knows the product, just add it to the count (e.g. misplaced stock, or a
    // full count whose snapshot predates it). If it doesn't know it at all,
    // offer to create it — this used to be a dead end in both modes: the scan
    // was dropped, and in a full count the item list is snapshotted at start,
    // so adding the product from the inventory screen afterwards wouldn't have
    // appeared here either. The only way through was to abandon the count.
    const prod = getInv(s.branchId).find(p => p.code.toLowerCase() === code.toLowerCase());
    if (!prod) { promptAddProductDuringCount(code); return; }
    s.items.push({ code: prod.code, name: prod.name, expectedQty: prod.qty, countedQty: 0 });
    idx = s.items.length - 1;
  }
  s.items[idx].countedQty = (s.items[idx].countedQty || 0) + 1;
  _persistStockCount();
  renderStockCountModal();
  input.focus();
}

// ── Adding a product mid-count ──────────────────────────────────────
// Set while the product modal is open on behalf of a count, so saveProduct()
// (35-inventory.js) can hand the new product straight back here instead of the
// admin having to cancel the count, add the product, and start over.
let _stockCountAddingCode = null;

function promptAddProductDuringCount(code) {
  const s = _stockCountSession; if (!s) return;
  showConfirmModal(
    'الكود "' + code + '" مش موجود في السيستم خالص — تحب تضيفه كمنتج جديد وتكمّل الجرد؟',
    function () {
      _stockCountAddingCode = code;
      document.getElementById('stockCountModal').classList.add('hidden');
      openProductModal(null);
      document.getElementById('pm-code').value = code;
      // Zero on purpose: the system genuinely holds none of it yet. The count
      // supplies the real figure, so the variance comes out as the full
      // quantity found — which is what the settlement should show and value.
      document.getElementById('pm-qty').value = 0;
      setTimeout(() => document.getElementById('pm-name')?.focus(), 80);
    }
  );
}

// Called when the product modal is dismissed without saving — otherwise the
// count modal stays hidden behind it and the admin is stranded mid-count.
function stockCountCancelAddProduct() {
  if (!_stockCountAddingCode) return;
  _stockCountAddingCode = null;
  if (!_stockCountSession) return;
  document.getElementById('stockCountModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('stockCountScanInput')?.focus(), 100);
}

// Called by saveProduct() after a successful save. No-op unless a count asked
// for it.
function stockCountAbsorbNewProduct(prod) {
  if (!_stockCountAddingCode) return;
  _stockCountAddingCode = null;
  const s = _stockCountSession;
  document.getElementById('stockCountModal').classList.remove('hidden');
  if (!s || !prod) return;

  const existing = s.items.findIndex(i => i.code.toLowerCase() === prod.code.toLowerCase());
  if (existing >= 0) {
    // Was already on the list flagged as not-in-system (custom sheet) — it is
    // real now, so it stops being skipped at apply time.
    s.items[existing].name        = prod.name;
    s.items[existing].expectedQty = prod.qty;
    delete s.items[existing]._notInSystem;
  } else {
    s.items.push({ code: prod.code, name: prod.name, expectedQty: prod.qty, countedQty: 1 });
  }
  _persistStockCount();
  renderStockCountModal();
  showToast('✅ اتضاف للنظام وللجرد — اكتب الكمية اللي عدّيتها');
  setTimeout(() => document.getElementById('stockCountScanInput')?.focus(), 100);
}

// Offered on the rows a custom sheet flagged as unknown, so they can be fixed
// without leaving the count.
function addUnknownStockCountItem(idx) {
  const s = _stockCountSession; if (!s || !s.items[idx]) return;
  promptAddProductDuringCount(s.items[idx].code);
}

// ── Search while counting ───────────────────────────────────────────
// A barcode gun types the whole code and hits Enter, which is what the input
// was built for. Counting by hand is not that: you have the item in your hand
// and part of its name, and typing a 13-digit code to find it is the slow way.
// Same substring search the cashier screen uses, over the count's own list.
function hideStockCountDropdown() {
  document.getElementById('stockCountDropdown')?.classList.add('hidden');
}

function stockCountSearchInput() {
  const s  = _stockCountSession;
  const dd = document.getElementById('stockCountDropdown');
  if (!s || !dd) return;
  const q = document.getElementById('stockCountScanInput').value.trim().toLowerCase();
  // One character matches most of the branch — not a useful list. A gun typing
  // a full code passes through here too, and Enter fires before it matters.
  if (q.length < 2) { hideStockCountDropdown(); return; }

  const matches = s.items
    .map(function (it, idx) { return { it: it, idx: idx }; })
    .filter(function (m) {
      return m.it.code.toLowerCase().includes(q) || (m.it.name || '').toLowerCase().includes(q);
    });

  if (!matches.length) {
    dd.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">مفيش صنف بالاسم أو الكود ده في الجرد — لو الصنف موجود فعلاً، اكتب كوده كامل واضغط Enter عشان يتضاف.</div>';
    dd.classList.remove('hidden');
    return;
  }

  dd.innerHTML = matches.slice(0, 12).map(function (m) {
    const done = m.it.countedQty !== null;
    const tag  = done
      ? '<span style="color:#15803d;font-size:11px;">اتعدّ: ' + m.it.countedQty + '</span>'
      : '<span style="color:var(--text-muted);font-size:11px;">لسه</span>';
    return '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;gap:10px;"'
      // mousedown, not click: blur fires first and would close the list before
      // a click ever lands.
      + ' onmousedown="pickStockCountItem(' + m.idx + ')">'
      + '<span>' + escHtml(m.it.name) + '<br><span style="color:var(--text-muted);font-size:11px;">' + escHtml(m.it.code) + '</span></span>'
      + '<span style="white-space:nowrap;">المتوقع: ' + m.it.expectedQty + '<br>' + tag + '</span>'
      + '</div>';
  }).join('');
  dd.classList.remove('hidden');
}

// Jumps to the row and puts the cursor in its quantity box — you pick the item,
// then type how many you counted, rather than the scan behaviour of +1 each time.
function pickStockCountItem(idx) {
  hideStockCountDropdown();
  const input = document.getElementById('stockCountScanInput');
  if (input) input.value = '';
  const box = document.querySelector('#stockCountBody tr:nth-child(' + (idx + 1) + ') input[type="number"]');
  if (!box) return;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  box.focus();
  box.select();
  const row = box.closest('tr');
  if (row) {
    const prev = row.style.background;
    row.style.background = '#fef9c3';
    setTimeout(function () { row.style.background = prev; }, 1200);
  }
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

// Ends the count and issues the settlement. Deliberately does NOT touch stock:
// a count has to be reviewed — more than once, by more than one pair of eyes —
// before anyone believes the numbers. Moving stock the moment counting stopped
// meant the first draft of a count was also the final word on it.
function finishStockCount() {
  const s = _stockCountSession; if (!s) return;
  const revising = !!s.settlementId;
  if (revising) {
    const prev = getStocktakes().find(x => x.id === s.settlementId);
    s.revisions = ((prev && prev.revisions) || 0) + 1;
  }
  const record = _buildStocktakeRecord(s);
  _saveStocktake(record);

  const countedTotal = s.items.filter(i => i.countedQty !== null).length;
  addAuditLog(revising ? 'stocktake.revise' : 'stocktake.count',
    `${revising ? 'تعديل' : 'إنهاء'} جرد ${s.mode === 'full' ? 'كامل' : 'مخصص'} — ${countedTotal} صنف اتعدّ، ${record.summary.variances} فرق — تسوية في انتظار الاعتماد`,
    s.branchId);

  _clearStockCountSession(s.branchId);
  _stockCountSession = null;
  document.getElementById('stockCountReviewModal').classList.add('hidden');
  showToast(revising
    ? '✅ اتحدّثت التسوية — المخزون لسه ما اتغيّرش'
    : '✅ اتقفل الجرد واتعملت التسوية — المخزون لسه ما اتغيّرش');
  openStocktakeSettlement(record.id);
}

// Older records predate the two-step flow: they were applied the instant
// counting stopped, so treat a missing status as already applied.
function stocktakeStatus(r) { return r.status || 'applied'; }

// The second step, owner only. Applies the variance as a DELTA, never as an
// absolute quantity: between counting and approving, the branch keeps selling.
// Writing the counted figure back would erase every sale and transfer that
// happened in between — with an immediate apply the two were the same thing,
// with a deferred one they are not.
function applyStocktakeToStock(id) {
  const r = getStocktakes().find(x => x.id === id);
  if (!r) return;
  if (!isRealOwner) { showToast('اعتماد التسوية للمالك فقط'); return; }
  if (stocktakeStatus(r) !== 'pending') { showToast('التسوية دي اتعملت خلاص'); return; }

  const applicable = r.items.filter(i => i.countedQty !== null && i.diff !== 0 && !i.notInSystem);
  if (!applicable.length) {
    showConfirmModal('مفيش أي فروقات تتطبّق. تحب تقفل التسوية كمعتمدة؟', function () {
      _markStocktakeApplied(r, 0, []);
    });
    return;
  }

  // Anything that moved since the count is worth saying out loud — the person
  // approving counted days ago and can't know what happened since.
  const inv   = getInv(r.branchId);
  const moved = applicable.filter(function (i) {
    const p = inv.find(x => x.code === i.code);
    return p && p.qty !== i.expectedQty;
  });

  let msg = 'اعتماد التسوية وتطبيق ' + applicable.length + ' فرق على مخزون ' + r.branchName + '؟';
  if (moved.length) {
    msg += ' ⚠️ ' + moved.length + ' صنف اتحرك مخزونه بعد الجرد — الفرق هيتضاف لرصيدهم الحالي مش هيلغيه.';
  }
  showConfirmModal(msg, function () {
    adjustStock(applicable.map(i => ({ code: i.code, delta: i.diff })), r.branchId);
    _markStocktakeApplied(r, applicable.length, applicable);
  });
}

function _markStocktakeApplied(r, count, applied) {
  r.status    = 'applied';
  r.appliedAt = Date.now();
  r.appliedBy = currentUsername || currentUser || '';
  _saveStocktake(r);
  addAuditLog('stocktake.apply',
    'اعتماد تسوية جرد ' + r.branchName + ' — ' + count + ' صنف اتعدّل، صافي ' + fmt(r.summary.netValue) + ' ج',
    r.branchId,
    applied.map(i => ({ label: i.name, before: String(i.expectedQty), after: String(i.countedQty) })));
  renderInventory();
  openStocktakeSettlement(r.id);
  showToast('✅ اتعتمدت التسوية واتطبّقت على المخزون');
}

// Reopens a pending settlement as a live count. A review is the whole point of
// the pending stage, and a review that finds a different number has to be able
// to correct it — otherwise the only options are approving figures you no
// longer believe or throwing the count away and recounting from scratch.
// Finishing again updates the SAME settlement rather than making a second one.
function reopenStocktakeForEdit(id) {
  const r = getStocktakes().find(x => x.id === id);
  if (!r) return;
  if (currentUser !== 'admin') { showToast('الجرد للأدمن فقط'); return; }
  if (stocktakeStatus(r) !== 'pending') { showToast('التسوية اتعملت خلاص — مينفعش تتعدّل'); return; }

  const existing = _loadStockCountSession(r.branchId);
  const warn = existing
    ? 'فيه جرد شغال على الفرع ده هيتلغي. تكمّل؟'
    : 'ترجع لتعديل أعداد الجرد ده؟ التسوية هتتحدّث لما تخلّص.';
  showConfirmModal(warn, function () {
    _stockCountSession = {
      branchId:  r.branchId,
      mode:      r.mode,
      startedAt: r.startedAt,
      startedBy: r.startedBy,
      // Ties the next finish back to this settlement instead of filing a new
      // one — otherwise every review round would leave another record behind.
      settlementId: r.id,
      items: r.items.map(function (i) {
        return { code: i.code, name: i.name, expectedQty: i.expectedQty,
                 countedQty: i.countedQty, _notInSystem: i.notInSystem || undefined };
      }),
      status: 'in_progress',
    };
    _persistStockCount();
    document.getElementById('stocktakeSettlementModal').classList.add('hidden');
    renderStockCountModal();
    document.getElementById('stockCountModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('stockCountScanInput')?.focus(), 100);
  });
}

// A count that turned out wrong shouldn't sit pending forever.
function cancelStocktakeSettlement(id) {
  const r = getStocktakes().find(x => x.id === id);
  if (!r) return;
  if (!isRealOwner) { showToast('إلغاء التسوية للمالك فقط'); return; }
  if (stocktakeStatus(r) !== 'pending') { showToast('التسوية دي اتعملت خلاص'); return; }
  showConfirmModal('إلغاء التسوية دي نهائياً؟ المخزون مش هيتغيّر والجرد هيفضل في السجل كملغي.', function () {
    r.status      = 'cancelled';
    r.cancelledAt = Date.now();
    r.cancelledBy = currentUsername || currentUser || '';
    _saveStocktake(r);
    addAuditLog('stocktake.cancel', 'إلغاء تسوية جرد ' + r.branchName, r.branchId);
    // Refresh whichever screen asked — cancelling from the list shouldn't
    // throw you into the settlement you just got rid of.
    if (!document.getElementById('stocktakeHistoryModal').classList.contains('hidden')) {
      renderStocktakeHistory();
    } else {
      openStocktakeSettlement(r.id);
    }
    showToast('اتلغت التسوية — المخزون زي ما هو');
  });
}

// ══════════════════════════════════════════════
// سجل الجردات + تسوية الجرد
// ══════════════════════════════════════════════
let _lastSettlementId = null;

// Fetched on open rather than subscribed to — see the note on getStocktakes().
// ⚠️ The query has to mirror the rule: everyone may read their own branch's
// counts and only an admin may read them all. Firestore rejects a whole query
// it cannot prove safe rather than trimming it, so widening either branch here
// without widening the rule breaks the screen outright.
async function openStocktakeHistory() {
  const body = document.getElementById('stocktakeHistoryBody');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">جاري التحميل...</div>';
  document.getElementById('stocktakeHistoryModal').classList.remove('hidden');

  if (_fbReady && _db) {
    try {
      const col = _db.collection('pos_stocktakes');
      // ⚠️ NO orderBy. Firestore drops any document missing the ordered field,
      // and ordering by appliedAt hid every pending settlement — they only get
      // an appliedAt when the owner approves them. The settlement was saved
      // correctly and simply never appeared in this list, so closing it looked
      // like losing it and the owner had nothing to approve. Counts are
      // occasional; sorting the handful we get here costs nothing.
      const q   = (currentUser === 'admin')
        ? col.limit(200)
        : col.where('branchId', '==', currentBranch);
      const snap = await q.get();
      _stocktakesCache = snap.docs.map(d => d.data())
                             .sort((a, b) => (b.countedAt || b.appliedAt || 0) - (a.countedAt || a.appliedAt || 0));
      DB.s('pos_stocktakes', _stocktakesCache.slice(0, 100));
    } catch (e) {
      console.error('openStocktakeHistory:', e);   // نكمل على المرآة المحلية
    }
  }
  renderStocktakeHistory();
}

function renderStocktakeHistory() {
  const list = getStocktakes();
  const body = document.getElementById('stocktakeHistoryBody');
  if (!list.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">مفيش جردات متسجّلة لسه</div>';
    return;
  }
  body.innerHTML = list.map(function (r) {
    const net = r.summary.netValue;
    const col = net === 0 ? 'var(--text-muted)' : (net > 0 ? '#1d4ed8' : 'var(--danger)');
    const st  = stocktakeStatus(r);
    const tag = st === 'pending'
      ? '<span class="badge" style="background:#fef9c3;color:#854d0e;">⏳ في انتظار الاعتماد</span>'
      : st === 'cancelled'
      ? '<span class="badge badge-danger">❌ ملغية</span>'
      : '<span class="badge badge-success">✅ مطبّقة</span>';
    return '<div onclick="openStocktakeSettlement(' + r.id + ')" style="cursor:pointer;background:white;border:1px solid ' + (st==='pending'?'#fde68a':'var(--border)') + ';border-radius:10px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;">'
      + '<div><div style="font-weight:700;font-size:14px;">📋 جرد ' + (r.mode === 'full' ? 'كامل' : 'مخصص') + ' — ' + escHtml(r.branchName) + ' ' + tag + '</div>'
      + '<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">'
      + new Date(r.countedAt || r.appliedAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })
      + ' — ' + escHtml(r.countedBy || r.appliedBy || '') + '</div>'
      + '<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">'
      + r.summary.counted + ' صنف اتعدّ · ' + r.summary.variances + ' فرق</div></div>'
      + '<div style="text-align:left;white-space:nowrap;display:flex;align-items:center;gap:10px;">'
      + '<div>'
      + '<div style="font-size:11px;color:var(--text-muted);">صافي التسوية</div>'
      + '<div style="font-size:18px;font-weight:800;color:' + col + ';">' + fmt(net) + ' ج</div>'
      + '</div>'
      // Straight from the list — a wrong count shouldn't need opening first.
      // stopPropagation, or the row's own click reopens the settlement behind it.
      + (st === 'pending' && isRealOwner
          ? '<button class="btn btn-danger btn-sm" title="إلغاء الجرد ده" onclick="event.stopPropagation();cancelStocktakeSettlement(' + r.id + ')">🗑️ إلغاء</button>'
          : '')
      + '</div></div>';
  }).join('');
}

function openStocktakeSettlement(id) {
  const r = getStocktakes().find(x => x.id === id);
  if (!r) { showToast('التسوية مش موجودة'); return; }
  _lastSettlementId = id;
  document.getElementById('stocktakeHistoryModal').classList.add('hidden');
  document.getElementById('stocktakeSettlementBody').innerHTML = _renderSettlementHTML(r);

  // Approval controls live in the footer, outside the printed body — a PDF of
  // the settlement shouldn't carry buttons.
  const foot    = document.getElementById('stocktakeApproveBar');
  const pending = stocktakeStatus(r) === 'pending';
  let bar = '';
  if (pending) {
    // Anyone who may run a count may revise it while it is still pending —
    // that is what the review stage is for.
    if (currentUser === 'admin') {
      bar += '<button class="btn btn-outline btn-sm" onclick="reopenStocktakeForEdit(' + r.id + ')">↩️ تعديل الأعداد</button>';
    }
    bar += isRealOwner
      ? '<button class="btn btn-danger btn-sm" onclick="cancelStocktakeSettlement(' + r.id + ')">❌ إلغاء التسوية</button>'
        + '<button class="btn btn-success" onclick="applyStocktakeToStock(' + r.id + ')">✅ اعتماد وتطبيق على المخزون</button>'
      : '<span style="font-size:12px;color:var(--text-muted);align-self:center;">⏳ في انتظار اعتماد المالك</span>';
  }
  foot.innerHTML = bar;

  document.getElementById('stocktakeSettlementModal').classList.remove('hidden');
}

function _settlementRow(i, showValue) {
  const col = i.diff > 0 ? '#1d4ed8' : (i.diff < 0 ? 'var(--danger)' : 'inherit');
  return '<tr><td style="font-size:12px;">' + escHtml(i.code) + '</td>'
    + '<td>' + escHtml(i.name) + (i.notInSystem ? ' <span style="color:var(--danger);font-size:11px;">(مش في النظام)</span>' : '') + '</td>'
    + '<td>' + i.expectedQty + '</td>'
    + '<td>' + (i.countedQty === null ? '—' : i.countedQty) + '</td>'
    + '<td style="font-weight:700;color:' + col + ';">' + (i.diff > 0 ? '+' : '') + i.diff + '</td>'
    + (showValue ? '<td style="font-weight:700;color:' + col + ';">' + fmt(i.value) + ' ج</td>' : '')
    + '</tr>';
}

function _settlementTable(items, showValue) {
  return '<div class="table-wrap"><table><thead><tr>'
    + '<th>الكود</th><th>المنتج</th><th>المتوقع</th><th>المعدود</th><th>الفرق</th>'
    + (showValue ? '<th>قيمة الفرق</th>' : '')
    + '</tr></thead><tbody>'
    + items.map(function (i) { return _settlementRow(i, showValue); }).join('')
    + '</tbody></table></div>';
}

// Rendered into a real element so exportReportPDF() (05-utils.js) can lift it
// into a print window — the same path every other report PDF takes. Its
// stylesheet already styles .stats-grid/.stat-card/table, so the print copy
// comes out formatted without a second set of styles here.
function _renderSettlementHTML(r) {
  const s         = r.summary;
  const variances = r.items.filter(function (i) { return i.countedQty !== null && i.diff !== 0; });
  const matched   = r.items.filter(function (i) { return i.countedQty !== null && i.diff === 0; });
  const uncounted = r.items.filter(function (i) { return i.countedQty === null; });
  const netCol    = s.netValue === 0 ? '#1a2b4a' : (s.netValue > 0 ? '#1d4ed8' : '#dc2626');
  const card = function (label, value, color) {
    return '<div class="stat-card"><div class="stat-label">' + label + '</div>'
      + '<div class="stat-value" style="color:' + (color || '#1a5faf') + ';">' + value + '</div></div>';
  };
  const when = function (t) { return new Date(t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); };

  const st = stocktakeStatus(r);
  const banner = st === 'pending'
    ? '<div style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-weight:600;">'
      + '⏳ في انتظار الاعتماد — <strong>المخزون لسه ما اتغيّرش.</strong> راجع الأعداد كويس، وبعدين المالك يعتمدها.</div>'
    : st === 'cancelled'
    ? '<div style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-weight:600;">'
      + '❌ تسوية ملغية — المخزون ما اتغيّرش.</div>'
    : '<div style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-weight:600;">'
      + '✅ معتمدة ومطبّقة على المخزون</div>';

  return banner
    + '<div style="margin-bottom:14px;font-size:13px;line-height:1.9;">'
    + '<strong>الفرع:</strong> ' + escHtml(r.branchName)
    + ' &nbsp;·&nbsp; <strong>نوع الجرد:</strong> ' + (r.mode === 'full' ? 'كامل' : 'مخصص')
    + '<br><strong>بدأ:</strong> ' + when(r.startedAt) + ' &nbsp;·&nbsp; <strong>بواسطة:</strong> ' + escHtml(r.startedBy || '—')
    + '<br><strong>اتقفل العدّ:</strong> ' + when(r.countedAt || r.appliedAt) + ' &nbsp;·&nbsp; <strong>بواسطة:</strong> ' + escHtml(r.countedBy || r.appliedBy || '—')
    + (st === 'applied' && r.appliedAt
        ? '<br><strong>اتعتمد وطُبّق:</strong> ' + when(r.appliedAt) + ' &nbsp;·&nbsp; <strong>بواسطة:</strong> ' + escHtml(r.appliedBy || '—')
        : '')
    + (st === 'cancelled' && r.cancelledAt
        ? '<br><strong>اتلغى:</strong> ' + when(r.cancelledAt) + ' &nbsp;·&nbsp; <strong>بواسطة:</strong> ' + escHtml(r.cancelledBy || '—')
        : '')
    + '</div>'

    + '<div class="stats-grid">'
    + card('إجمالي الأصناف', s.total)
    + card('اتعدّ', s.counted)
    + card('مطابق', s.matched, '#16a34a')
    + card('فيه فرق', s.variances, s.variances ? '#dc2626' : '#16a34a')
    + '</div>'
    + '<div class="stats-grid">'
    + card('قيمة الزيادة', fmt(s.surplusValue) + ' ج', '#1d4ed8')
    + card('قيمة العجز', fmt(s.shortageValue) + ' ج', '#dc2626')
    + card('صافي التسوية', fmt(s.netValue) + ' ج', netCol)
    + card('ماتعدّش', s.uncounted, s.uncounted ? '#d97706' : '#16a34a')
    + '</div>'

    + (variances.length
        ? '<h3 style="font-size:15px;margin:18px 0 8px;">الفروقات (' + variances.length + ')</h3>' + _settlementTable(variances, true)
        : '<div style="background:#dcfce7;color:#166534;padding:10px 14px;border-radius:8px;margin:16px 0;font-weight:600;">✅ مفيش أي فروقات — الجرد مطابق بالكامل</div>')

    + (s.skipped
        ? '<div style="background:#fee2e2;color:#b91c1c;padding:10px 14px;border-radius:8px;margin:12px 0;font-size:13px;">⚠️ ' + s.skipped + ' صنف فيه فرق بس مش موجود في مخزون النظام — كميته ماتغيرتش، لازم يتضاف يدوي.</div>'
        : '')

    + (matched.length
        ? '<h3 style="font-size:15px;margin:18px 0 8px;">الأصناف المطابقة (' + matched.length + ')</h3>' + _settlementTable(matched, false)
        : '')

    + (uncounted.length
        ? '<h3 style="font-size:15px;margin:18px 0 8px;">أصناف ماتعدّتش (' + uncounted.length + ')</h3>'
          + '<div style="font-size:12px;color:#666;margin-bottom:6px;">كمياتها ماتغيرتش في المخزون.</div>'
          + _settlementTable(uncounted, false)
        : '');
}

function exportStocktakeSettlementPDF() {
  const r = getStocktakes().find(function (x) { return x.id === _lastSettlementId; });
  if (!r) return;
  exportReportPDF('stocktakeSettlementBody',
    'تسوية جرد المخزون — ' + r.branchName + ' — ' + new Date(r.appliedAt).toLocaleDateString('ar-EG'));
}
