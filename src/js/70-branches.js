// ══════════════════════════════════════════════
// MULTI-BRANCH
// ══════════════════════════════════════════════

function switchBranch(b) {
  if (!BRANCH_IDS.includes(b)) return;
  currentBranch = b;
  DB.s('currentBranch', b);
  // Update branch selector
  const sel = document.getElementById('branchSelect');
  if (sel) sel.value = b;
  // Refresh relevant views
  renderProducts();
  updateLowStockBell();
  if (currentUser === 'admin') {
    const pages = ['page-inventory','page-dashboard','page-reports','page-sales'];
    pages.forEach(p => visRefresh(p, () => {})); // trigger re-render if visible
    visRefresh('page-inventory',  renderInventory);
    visRefresh('page-dashboard',  buildDashboard);
    visRefresh('page-reports',    buildSalesReport);
    visRefresh('page-sales',      () => { initSalesFilter(); renderSales(); });
  }
  // Update low stock
  updateLowStockBell();
}

function populateBranchSelect() {
  const sel = document.getElementById('branchSelect'); if (!sel) return;
  const branches = getBranches();
  sel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}" ${b===currentBranch?'selected':''}>${branches[b]||BRANCH_DEFAULTS[b]}</option>`).join('');
}

// Builds one input row per non-warehouse branch (warehouse keeps its fixed
// name, matching prior behavior — this UI never had a 'wh' row). Rebuilding
// the whole container (rather than assuming fixed branchName_b1..b4 inputs)
// is what lets a newly-added branch show up here without any HTML changes.
function populateBranchNameInputs() {
  const container = document.getElementById('branchNamesContainer');
  if (!container) return;
  const branches = getBranches();
  container.innerHTML = BRANCH_IDS.filter(b => b !== 'wh').map(b => {
    const label = BRANCH_DEFAULTS[b] || b;
    const value = branches[b] || BRANCH_DEFAULTS[b] || b;
    return `<div class="form-group"><label>${escHtml(label)}</label><input class="form-control" id="branchName_${b}" value="${escHtml(value)}" placeholder="${escHtml(label)}" /></div>`;
  }).join('');
}

function saveBranchNames() {
  const oldBranches = getBranches();
  const branches = {};
  BRANCH_IDS.forEach(b => {
    const el = document.getElementById(`branchName_${b}`);
    branches[b] = (el?.value.trim()) || BRANCH_DEFAULTS[b] || b;
  });
  const changes = BRANCH_IDS
    .filter(b => (oldBranches[b] || BRANCH_DEFAULTS[b] || b) !== branches[b])
    .map(b => ({ label: `اسم فرع (${BRANCH_DEFAULTS[b] || b})`, before: oldBranches[b] || BRANCH_DEFAULTS[b] || b, after: branches[b] }));
  _settingsCache.branches = branches;
  if (_fbReady) {
    _db.collection('pos_data').doc('settings').set(_settingsCache)
       .catch(e => console.error('saveBranchNames:', e));
  }
  DB.s('pos_branches', branches);
  populateBranchSelect();
  populateBranchNameInputs();
  if (changes.length) addAuditLog('settings.change', 'تعديل أسماء الفروع', currentBranch, changes);
  showMsg('sBranchMsg', 'تم حفظ أسماء الفروع ✓', 'success');
}

// Appends a new branch id (b5, b6, ...) beyond the base wh/b1-b4 set.
// BRANCH_IDS is computed once at page load (see 00-core.js) — every
// Firestore listener, cached filter <select>, and branch-name input is set
// up once at startup too, so there's no reliable way to make a new branch
// show up everywhere without a reload. Reloading immediately after saving
// is simpler and safer than trying to hot-patch every one of those places.
//
// Uses a real in-app modal instead of window.prompt()/window.alert() — those are
// silently no-ops in a PWA running in standalone/installed mode on several
// mobile browsers, which is exactly how this app is meant to be used (it
// has an "install app" button). A prompt() call there just returns null
// immediately with zero visible feedback, which is what this looked like
// before the fix.
function openAddBranchModal() {
  document.getElementById('newBranchName').value = '';
  document.getElementById('addBranchModal').classList.remove('hidden');
}
function closeAddBranchModal() {
  document.getElementById('addBranchModal').classList.add('hidden');
}
function confirmAddBranch() {
  const name = document.getElementById('newBranchName').value;
  if (!name || !name.trim()) { showMsg('sBranchMsg', 'اكتب اسم الفرع الأول', 'danger'); return; }
  const trimmedName = name.trim();

  const existingNums = BRANCH_IDS.filter(b => /^b\d+$/.test(b)).map(b => parseInt(b.slice(1), 10));
  const newId = 'b' + ((existingNums.length ? Math.max(...existingNums) : 0) + 1);

  const extra = DB.g('extraBranchIds', []);
  extra.push(newId);
  DB.s('extraBranchIds', extra);

  const branches = getBranches();
  branches[newId] = trimmedName;
  _settingsCache.branches = branches;
  if (_fbReady) {
    _db.collection('pos_data').doc('settings').set(_settingsCache)
       .catch(e => console.error('addNewBranch:', e));
  }
  DB.s('pos_branches', branches);

  addAuditLog('branch.add', `إضافة فرع جديد: ${trimmedName} (${newId})`, null);
  closeAddBranchModal();
  showMsg('sBranchMsg', `✅ تم إضافة فرع "${trimmedName}"! جاري تحديث الصفحة...`, 'success');
  setTimeout(() => location.reload(), 1200);
}

// ── TRANSFERS ──────────────────────────────────
const getTransfers = () => _transfersCache;
function setTransfers(list) {
  _transfersCache = list;
  DB.s('pos_transfers', list);
  try { _fbReady && _db.collection('pos_data').doc('transfers').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

let _trItems = []; // temp state for transfer modal

function openTransferModal() {
  _trItems = [];
  const branches = getBranches();
  const opts = BRANCH_IDS.map(b => `<option value="${b}">${branches[b]||BRANCH_DEFAULTS[b]}</option>`).join('');
  document.getElementById('trFromBranch').innerHTML = opts;
  document.getElementById('trToBranch').innerHTML   = opts;
  // set second branch as default "to"
  if (document.getElementById('trToBranch').options.length > 1)
    document.getElementById('trToBranch').selectedIndex = 1;
  document.getElementById('trNote').value = '';
  renderTrItems();
  document.getElementById('transferModal').classList.remove('hidden');
}

function addTrProductSearch() {
  const q  = document.getElementById('trProdSearch').value.trim().toLowerCase(); if (!q) return;
  const from = document.getElementById('trFromBranch').value;
  const inv = getInv(from);
  const matches = inv.filter(p => (p.name.toLowerCase().includes(q)||p.code.toLowerCase().includes(q)) && p.qty > 0);
  const dd = document.getElementById('trProdDropdown');
  if (!matches.length) { dd.innerHTML='<div style="padding:8px;font-size:12px;color:var(--text-muted);">لا نتائج</div>'; dd.classList.remove('hidden'); return; }
  dd.innerHTML = matches.slice(0,8).map(p=>`
    <div style="padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0;"
      onmousedown="selectTrProduct('${escJsAttr(p.code)}','${escJsAttr(p.name)}',${p.qty})">
      <span>${escHtml(p.name)}</span>
      <span style="color:var(--text-muted);font-size:11px;margin-right:6px;">متاح: ${p.qty}</span>
    </div>`).join('');
  dd.classList.remove('hidden');
}

function selectTrProduct(code, name, maxQty) {
  document.getElementById('trProdDropdown').classList.add('hidden');
  document.getElementById('trProdSearch').value = '';
  if (_trItems.find(i => i.code === code)) return;
  _trItems.push({ code, name, qty: 1, maxQty });
  renderTrItems();
}

function renderTrItems() {
  const el = document.getElementById('trItemsList'); if (!el) return;
  if (!_trItems.length) { el.innerHTML='<div style="color:var(--text-muted);font-size:12px;padding:8px;">لم يتم إضافة أصناف</div>'; return; }
  el.innerHTML = _trItems.map((item,idx) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="flex:1;font-size:13px;">${escHtml(item.name)}</span>
      <span style="font-size:11px;color:var(--text-muted);">متاح: ${item.maxQty}</span>
      <input type="number" value="${item.qty}" min="1" max="${item.maxQty}" style="width:60px;padding:3px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px;"
        onchange="updateTrQty(${idx}, this.value)" />
      <button onclick="_trItems.splice(${idx},1);renderTrItems();" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:15px;padding:0 2px;">✕</button>
    </div>`).join('');
}

function updateTrQty(idx, val) {
  _trItems[idx].qty = Math.min(Math.max(1, parseInt(val)||1), _trItems[idx].maxQty);
}

function confirmTransfer() {
  const from = document.getElementById('trFromBranch').value;
  const to   = document.getElementById('trToBranch').value;
  if (from === to) { showToast('الفرع المصدر والوجهة متطابقان'); return; }
  if (!_trItems.length) { showToast('أضف أصناف للتحويل'); return; }
  const note = document.getElementById('trNote').value.trim();

  // Validate quantities
  const srcInv = getInv(from);
  for (const item of _trItems) {
    const p = srcInv.find(x => x.code === item.code);
    if (!p || p.qty < item.qty) { showToast(`الكمية المطلوبة من "${item.name}" غير متاحة في المصدر`); return; }
  }

  // Deduct from source
  const newSrc = srcInv.map(p => {
    const tr = _trItems.find(i => i.code === p.code);
    return tr ? { ...p, qty: p.qty - tr.qty } : p;
  });
  setInv(newSrc, from);

  // Add to destination
  const dstInv = getInv(to).map(p => ({...p}));
  _trItems.forEach(item => {
    const dp = dstInv.find(x => x.code === item.code);
    if (dp) dp.qty += item.qty;
    else dstInv.push({ ...srcInv.find(x=>x.code===item.code), qty: item.qty });
  });
  setInv(dstInv, to);

  // Save transfer record
  const branches = getBranches();
  const record = {
    id: Date.now(),
    date: new Date().toISOString(),
    from, to,
    fromName: branches[from]||BRANCH_DEFAULTS[from],
    toName:   branches[to]||BRANCH_DEFAULTS[to],
    items: _trItems.map(i=>({...i})),
    note,
    status: 'completed',
    by: currentUser === 'admin' ? 'مدير' : 'كاشير'
  };
  const list = getTransfers();
  list.unshift(record);
  setTransfers(list);

  document.getElementById('transferModal').classList.add('hidden');
  renderTransfersPage();
  showToast(`✅ تم التحويل بنجاح\nمن: ${record.fromName} → إلى: ${record.toName}\n${_trItems.length} صنف`);
}

function renderTransfersPage() {
  const list    = getTransfers();
  const done    = list.filter(t=>t.status==='completed').length;
  const pending = list.filter(t=>t.status==='pending').length;
  animateNumber(document.getElementById('tr-count'),   list.length);
  animateNumber(document.getElementById('tr-done'),    done);
  animateNumber(document.getElementById('tr-pending'), pending);

  const tbody = document.getElementById('transfersBody'); if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">لا توجد تحويلات بعد</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => `<tr>
    <td style="white-space:nowrap;font-size:12px;">${new Date(t.date).toLocaleString('ar-EG')}</td>
    <td><span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:12px;">${escHtml(t.fromName)}</span></td>
    <td><span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:12px;">${escHtml(t.toName)}</span></td>
    <td style="font-size:12px;">${t.items.map(i=>`${escHtml(i.name)} ×${i.qty}`).join(' · ')}</td>
    <td><span style="background:${t.status==='completed'?'#d1fae5':'#fef9c3'};color:${t.status==='completed'?'#065f46':'#92400e'};padding:2px 8px;border-radius:10px;font-size:11px;">${t.status==='completed'?'✅ مكتمل':'⏳ معلق'}</span></td>
    <td style="font-size:12px;color:var(--text-muted);">${escHtml(t.note)||'-'}</td>
    <td style="font-size:11px;color:var(--text-muted);">${escHtml(t.by)||''}</td>
  </tr>`).join('');
}

// Call populateBranchSelect on login
function initBranchUI() {
  populateBranchSelect();
}

