// ══════════════════════════════════════════════
// FIREBASE CONFIG
// ══════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCzDuaf-4hN0f9ZZYUXUywQ6Lbe_ZbBVVQ",
  authDomain:        "nexus-2fec6.firebaseapp.com",
  projectId:         "nexus-2fec6",
  storageBucket:     "nexus-2fec6.firebasestorage.app",
  messagingSenderId: "923229931538",
  appId:             "1:923229931538:web:b3e9dc00f383732e8230cb"
};

let _db            = null;
let _fbReady       = false;
let _suspendCache  = [];


// ── PASSWORD SECURITY ─────────────────────────────────────────
async function hashPass(plain) {
  const data = new TextEncoder().encode(plain + 'voodo-pos-salt');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return 'h:' + Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function checkPass(plain, stored) {
  if (!stored) return false;
  if (stored.startsWith('h:')) return stored === await hashPass(plain);
  return plain === stored; // legacy plain text
}
async function upgradePassIfNeeded(plain, stored, type, branchId) {
  if (!stored.startsWith('h:')) {
    const hashed = await hashPass(plain);
    if (type === 'admin') {
      const u = getUsers(); u.admin = hashed; setUsersLocal(u);
    } else if (type === 'branch' && branchId) {
      const bu = getBranchUsers(); bu[branchId].password = hashed; setBranchUsersLocal(bu);
    }
  }
}
// setUsers / setBranchUsers — NEVER sync passwords to Firestore
function setUsersLocal(v) { DB.s('users', v); }
function setBranchUsersLocal(v) { DB.s('pos_branch_users', v); }

function initFirebase() {
  const fbEl = document.getElementById('fbStatus');

  if (!FIREBASE_CONFIG.projectId) {
    _suspendCache   = DB.g('pos_suspended', []);
    _invCache       = DB.g('inv', []);
    _salesCache     = DB.g('sales', []);
    _customersCache = DB.g('pos_customers', []);
    _settingsCache  = { threshold: DB.g('threshold', 5) };
    if (fbEl) fbEl.innerHTML = 'بدون Firebase';
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _db      = firebase.firestore();
    _fbReady = true;
    if (fbEl) {
      fbEl.style.cssText = 'font-size:11px;padding:3px 8px;border-radius:10px;background:#fef3c7;color:#92400e;';
      fbEl.textContent   = 'جاري الاتصال...';
    }
    // Anonymous auth — required for Firestore Security Rules
    firebase.auth().signInAnonymously().catch(e => console.warn('Firebase Auth:', e.message));

    const visRefresh = (pageId, fn) => {
      const el = document.getElementById(pageId);
      if (el && !el.classList.contains('hidden')) fn();
    };

    _db.collection('pos_data').doc('suspended')
      .onSnapshot(snap => {
        _suspendCache = snap.exists ? (snap.data().bills || []) : [];
        updateSuspendedBadge();
        visRefresh('page-suspended', renderSuspendedPage);
        if (!document.getElementById('resumeModal')?.classList.contains('hidden')) renderResumeList();
        if (fbEl) {
          fbEl.style.cssText = 'font-size:11px;padding:3px 8px;border-radius:10px;background:#d1fae5;color:#065f46;';
          fbEl.textContent   = 'Firebase متصل';
        }
      }, err => {
        console.error('Firestore suspended error:', err);
        _suspendCache = DB.g('pos_suspended', []);
        if (fbEl) {
          fbEl.style.cssText = 'font-size:11px;padding:3px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;';
          fbEl.textContent   = 'خطأ في الاتصال';
        }
      });

    initApprovalsFirebaseListener();
    // ── branch inventory listeners (wh + b1..b4) ──────────────────────────────────
    BRANCH_IDS.forEach(b => {
      _db.collection('pos_data').doc(`inv_${b}`)
        .onSnapshot(snap => {
          if (snap.exists) {
            _invCacheByBranch[b] = snap.data().items || [];
          } else {
            // Migration: first load — try old single-branch 'inv' for b1, then localStorage
            const local = b === 'b1'
              ? (DB.g('pos_inv_b1', null) || DB.g('inv', []))
              : DB.g(`pos_inv_${b}`, []);
            _invCacheByBranch[b] = local;
            if (local.length) {
              _db.collection('pos_data').doc(`inv_${b}`)
                 .set({ items: local, updatedAt: Date.now() });
            }
          }
          DB.s(`pos_inv_${b}`, _invCacheByBranch[b]); // keep localStorage in sync
          if (b === currentBranch) {
            updateLowStockBell();
            if (currentUser === 'admin') {
              visRefresh('page-inventory', renderInventory);
              visRefresh('page-dashboard', buildDashboard);
            } else if (currentUser) {
              renderProducts();
            }
          }
        }, err => console.error(`Firestore inv_${b} error:`, err));
    });

    _db.collection('pos_data').doc('settings')
      .onSnapshot(snap => {
        if (snap.exists) {
          _settingsCache = snap.data();
          if (!_settingsCache.salespeople) _settingsCache.salespeople = DB.g('salespeople', ['محمد','الاء']);
        } else {
          const localThresh      = DB.g('threshold', 5);
          const localSalespeople = DB.g('salespeople', ['محمد','الاء']);
          _settingsCache = { threshold: localThresh, salespeople: localSalespeople };
          _db.collection('pos_data').doc('settings').set(_settingsCache);
        }
        const thEl = document.getElementById('sLowThreshold');
        if (thEl) thEl.value = _settingsCache.threshold || 5;
        renderSellersSettings();
      }, err => console.error('Firestore settings error:', err));

    // Suppliers listener
    _db.collection('pos_data').doc('suppliers')
      .onSnapshot(snap => {
        _suppliersCache = snap.exists ? (snap.data().list || []) : DB.g('pos_suppliers', []);
        visRefresh('page-suppliers', renderSuppliersPage);
        visRefresh('page-purchases', renderPurchasesPage);
      }, err => { _suppliersCache = DB.g('pos_suppliers', []); });

    // Purchase Orders listener
    _db.collection('pos_data').doc('purchases')
      .onSnapshot(snap => {
        _purchaseCache = snap.exists ? (snap.data().list || []) : DB.g('pos_purchases', []);
        visRefresh('page-purchases', renderPurchasesPage);
      }, err => { _purchaseCache = DB.g('pos_purchases', []); });

    // HR listener
    _db.collection('pos_data').doc('hr')
      .onSnapshot(snap => {
        _hrCache = snap.exists ? (snap.data().list || []) : DB.g('pos_hr', []);
        visRefresh('page-hr', renderHRPage);
      }, err => { _hrCache = DB.g('pos_hr', []); });

    // Expenses listener
    _db.collection('pos_data').doc('expenses')
      .onSnapshot(snap => {
        _expensesCache = snap.exists ? (snap.data().list || []) : DB.g('pos_expenses', []);
        visRefresh('page-expenses', renderExpensesPage);
        visRefresh('page-dashboard', buildDashboard);
      }, err => { _expensesCache = DB.g('pos_expenses', []); });

    // Audit Log listener
    _db.collection('pos_data').doc('audit')
      .onSnapshot(snap => {
        _auditCache = snap.exists ? (snap.data().list || []) : DB.g('pos_audit', []);
        visRefresh('page-audit', renderAuditPage);
      }, err => { _auditCache = DB.g('pos_audit', []); });

    // Transfers listener
    _db.collection('pos_data').doc('transfers')
      .onSnapshot(snap => {
        _transfersCache = snap.exists ? (snap.data().list || []) : DB.g('pos_transfers', []);
        visRefresh('page-transfers', renderTransfersPage);
      }, err => { _transfersCache = DB.g('pos_transfers', []); });

    // Promotions listener
    _db.collection('pos_data').doc('promotions')
      .onSnapshot(snap => {
        _promoCache = snap.exists ? (snap.data().list || []) : DB.g('pos_promos', []);
        if (!snap.exists && _promoCache.length) {
          _db.collection('pos_data').doc('promotions').set({ list: _promoCache, updatedAt: Date.now() });
        }
        visRefresh('page-promos', renderPromosPage);
      }, err => { _promoCache = DB.g('pos_promos', []); });

    // NOTE: the original hardcoded admin/legacy-cashier passwords (getUsers()) are
    // intentionally NOT synced through Firestore — pos_data/auth used to hold password
    // hashes and was readable by any anonymously-authenticated client. Each device keeps
    // those two specific credentials in localStorage only. See CLAUDE.md security notes.
    // Admin-managed accounts created via "إدارة المستخدمين" (below) DO sync — they live
    // at pos_data/accounts, not the blocked pos_data/auth doc, and only ever store a
    // password HASH, never plaintext — same protection tier as inventory/sales.

    // Accounts listener (admin-managed users: extra admins + branch cashiers/managers)
    _db.collection('pos_data').doc('accounts')
      .onSnapshot(snap => {
        if (snap.exists) {
          _accountsCache = snap.data().list || [];
          DB.s('pos_accounts', _accountsCache); // keep local fallback fresh
        } else {
          _accountsCache = DB.g('pos_accounts', []);
          if (_accountsCache.length) {
            _db.collection('pos_data').doc('accounts').set({ list: _accountsCache, updatedAt: Date.now() });
          }
        }
        visRefresh('page-settings', renderUserAccountsSettings);
      }, err => { _accountsCache = DB.g('pos_accounts', []); });

    // Customers listener
    _db.collection('pos_data').doc('customers')
      .onSnapshot(snap => {
        _customersCache = snap.exists ? (snap.data().items || []) : DB.g('pos_customers', []);
        if (!snap.exists && _customersCache.length) {
          _db.collection('pos_data').doc('customers').set({ items: _customersCache, updatedAt: Date.now() });
        }
        visRefresh('page-customers', renderCustomers);
      }, err => { _customersCache = DB.g('pos_customers', []); });

    for (let i = 0; i < 12; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const month = d.toISOString().slice(0, 7);
      _db.collection('pos_sales').doc(month)
        .onSnapshot(snap => {
          if (snap.exists) {
            const monthItems = snap.data().items || [];
            _salesCache = [
              ..._salesCache.filter(s => s.date.slice(0, 7) !== month),
              ...monthItems
            ];
          } else {
            // Read fresh from localStorage each time (not a stale startup snapshot)
            const localSalesAll = DB.g('sales', []);
            const localMonth = localSalesAll.filter(s => s.date.slice(0, 7) === month);
            if (localMonth.length) {
              _db.collection('pos_sales').doc(month).set({ items: localMonth, updatedAt: Date.now() });
            }
          }
          visRefresh('page-sales', () => { initSalesFilter(); renderSales(); });
          visRefresh('page-dashboard', buildDashboard);
          visRefresh('page-reports', buildSalesReport);
        }, err => console.error(`Firestore sales/${month} error:`, err));
    }

  } catch(e) {
    console.error('Firebase init error:', e);
    _suspendCache   = DB.g('pos_suspended', []);
    BRANCH_IDS.forEach(b => { _invCacheByBranch[b] = DB.g(`pos_inv_${b}`, b==='b1'?DB.g('inv',[]):[]) });
    _salesCache     = DB.g('sales', []);
    _transfersCache = DB.g('pos_transfers', []);
    _customersCache = DB.g('pos_customers', []);
    _promoCache     = DB.g('pos_promos', []);
    _expensesCache  = DB.g('pos_expenses', []);
    _auditCache     = DB.g('pos_audit', []);
    _settingsCache  = { threshold: DB.g('threshold', 5) };
    if (fbEl) fbEl.textContent = 'خطأ Firebase';
  }
}

const getSuspended = () => _suspendCache;

function setSuspended(list) {
  _suspendCache = list;
  if (!_fbReady) {
    DB.s('pos_suspended', list);
    return;
  }
  _db.collection('pos_data').doc('suspended')
     .set({ bills: list, updatedAt: Date.now() })
     .catch(e => console.error('Firestore write error:', e));
}

function suspendBill() {
  if (!cart.length) { alert('الفاتورة فارغة'); return; }
  document.getElementById('suspendNote').value = '';
  document.getElementById('suspendSuccessMsg').classList.add('hidden');
  document.getElementById('suspendConfirmBtn').classList.remove('hidden');
  document.getElementById('suspendCancelBtn').textContent = 'إلغاء';
  document.getElementById('suspendModal').classList.remove('hidden');
}

function confirmSuspend() {
  if (!cart.length) return;
  const note = document.getElementById('suspendNote').value.trim();
  const sub  = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const bill = {
    id:        'S' + Date.now().toString(36).toUpperCase().slice(-6),
    created:   new Date().toISOString(),
    cashier:   currentUser === 'admin' ? 'مدير' : 'كاشير',
    note,
    items:     cart.map(i => ({...i})),
    sub,
    adminDiscount:     0,
    adminDiscountType: 'amount',
    adminDiscountNote: '',
    status:    'pending'
  };

  const list = getSuspended();
  list.push(bill);
  setSuspended(list);

  cart = [];
  renderCart(); renderProducts();

  const msg = document.getElementById('suspendSuccessMsg');
  document.getElementById('suspendSuccessText').innerHTML =
    `تم تعليق الفاتورة <strong style="font-family:monospace; color:var(--primary); font-size:16px;">${bill.id}</strong><br>
    <span style="font-size:12px; color:var(--text-muted); margin-top:4px; display:block;">أبلغ المدير — يلاقيها في "فواتير معلقة"</span>`;
  msg.classList.remove('hidden');
  document.getElementById('suspendConfirmBtn').classList.add('hidden');
  document.getElementById('suspendCancelBtn').textContent = 'إغلاق';
}

function updateSuspendedBadge() {
  const list   = getSuspended();
  const badge  = document.getElementById('suspendedBadge');
  const count  = list.length;
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
}

function renderSuspendedPage() {
  const list = getSuspended();
  document.getElementById('suspendedCountLabel').textContent = list.length + ' فاتورة معلقة';
  const el = document.getElementById('suspendedList');
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">لا توجد فواتير معلقة</div>';
    return;
  }
  el.innerHTML = list.map(b => {
    const total = b.sub;
    const disc  = b.adminDiscount || 0;
    const discType = b.adminDiscountType || 'amount';
    const discAmt  = discType === 'percent' ? (total * disc / 100) : Math.min(disc, total);
    const final    = total - discAmt;
    return `<div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        <div>
          <div style="font-weight:700;font-size:15px;font-family:monospace;color:var(--primary);">${b.id}</div>
          <div style="font-size:12px;color:var(--text-muted);">${new Date(b.created).toLocaleString('ar-EG')} — كاشير: ${escHtml(b.cashier)}</div>
          ${b.note?`<div style="font-size:12px;margin-top:3px;color:#6b7280;">ملاحظة: ${escHtml(b.note)}</div>`:''}
        </div>
        <div style="text-align:left;">
          <div style="font-size:18px;font-weight:700;">${fmt(final)} ج</div>
          ${discAmt>0?`<div style="font-size:12px;color:var(--success);">خصم: -${fmt(discAmt)} ج</div>`:''}
          ${b.adminDiscountNote?`<div style="font-size:11px;color:var(--text-muted);">${escHtml(b.adminDiscountNote)}</div>`:''}
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
        ${b.items.map(i=>`${escHtml(i.name)} × ${i.qty}`).join(' · ')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" onclick="activateSuspended('${b.id}')">تفعيل للكاشير</button>
        <button class="btn btn-warning btn-sm" onclick="openAdminDiscount('${b.id}')">إضافة خصم</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSuspended('${b.id}')">حذف</button>
      </div>
    </div>`;
  }).join('');
}

function activateSuspended(id) {
  const bill = getSuspended().find(b => b.id === id); if (!bill) return;

  // Prices are already modified by admin — no need for extra _adminDiscount
  cart = bill.items.map(i => ({...i}));
  cart._adminDiscount     = 0;
  cart._adminDiscountNote = bill.adminDiscountNote || '';

  // Remove from suspended immediately so it doesn't stay after payment
  setSuspended(getSuspended().filter(b => b.id !== id));

  renderCart(); renderProducts();
  document.getElementById('adminDiscountRow').classList.add('hidden');
  alert('تم تحميل الفاتورة — يمكن الآن الدفع من الكاشير');
}

function deleteSuspended(id) {
  if (!confirm('حذف هذه الفاتورة المعلقة؟')) return;
  setSuspended(getSuspended().filter(b => b.id !== id));
  renderSuspendedPage();
}

function openAdminDiscount(id) {
  const bill = getSuspended().find(b => b.id === id); if (!bill) return;
  document.getElementById('adSuspendId').value = id;
  document.getElementById('adDiscountNote').value = bill.adminDiscountNote || '';
  const tbody = document.getElementById('adItemsBody');
  tbody.innerHTML = bill.items.map((item, idx) => {
    const origPrice = item._origPrice || item.price;
    return `<tr data-orig-price="${origPrice}" data-qty="${item.qty}">
      <td style="font-weight:600;">${escHtml(item.name)}</td>
      <td style="text-align:center;">${item.qty}</td>
      <td style="text-align:center;">${fmt(origPrice)} ج</td>
      <td style="text-align:center;">
        <input type="number" class="form-control" id="ad-newprice-${idx}" value="${item.price}" min="0" step="0.5"
          style="width:90px;text-align:center;padding:3px 6px;font-size:12px;" oninput="calcAdminDiscount()" />
      </td>
      <td id="ad-final-${idx}" style="text-align:center;font-weight:600;">0 ج</td>
    </tr>`;
  }).join('');
  calcAdminDiscount();
  document.getElementById('adminDiscountModal').classList.remove('hidden');
}

function calcAdminDiscount() {
  const id   = document.getElementById('adSuspendId').value;
  const bill = getSuspended().find(b => b.id === id); if (!bill) return;
  let totalOrig = 0, totalNew = 0;
  bill.items.forEach((item, idx) => {
    const origPrice = item._origPrice || item.price;
    const qty       = item.qty;
    totalOrig += origPrice * qty;
    const newPrice = parseFloat(document.getElementById(`ad-newprice-${idx}`)?.value);
    const usedPrice = isNaN(newPrice) ? item.price : newPrice;
    totalNew += usedPrice * qty;
    const diff = (usedPrice - origPrice) * qty;
    const el = document.getElementById(`ad-final-${idx}`);
    if (el) {
      el.textContent = (diff >= 0 ? '+' : '') + fmt(diff) + ' ج';
      el.style.color = diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--success)' : 'var(--text-muted)';
    }
  });
  document.getElementById('adSubTotal').textContent    = fmt(totalOrig) + ' ج';
  document.getElementById('adDiscountCalc').textContent = fmt(totalNew) + ' ج';
  const netDiff = totalNew - totalOrig;
  const finalEl = document.getElementById('adFinalTotal');
  finalEl.textContent = (netDiff >= 0 ? '+' : '') + fmt(netDiff) + ' ج';
  finalEl.style.color = netDiff > 0 ? 'var(--danger)' : netDiff < 0 ? 'var(--success)' : 'inherit';
}

function resetAllItemDiscounts() {
  document.querySelectorAll('#adItemsBody tr').forEach((row, idx) => {
    const origPrice = parseFloat(row.dataset.origPrice || 0);
    const el = document.getElementById(`ad-newprice-${idx}`);
    if (el) el.value = origPrice;
  });
  calcAdminDiscount();
}

function saveAdminDiscount() {
  const id   = document.getElementById('adSuspendId').value;
  const list = getSuspended();
  const bill = list.find(b => b.id === id); if (!bill) return;
  let totalOrig = 0, totalNew = 0;
  bill.items.forEach((item, idx) => {
    const origPrice = item._origPrice || item.price;
    item._origPrice = origPrice; // preserve original
    totalOrig += origPrice * item.qty;
    const newPrice = parseFloat(document.getElementById(`ad-newprice-${idx}`)?.value);
    if (!isNaN(newPrice) && newPrice >= 0) item.price = newPrice;
    totalNew += item.price * item.qty;
  });
  bill.adminDiscount     = Math.max(0, totalOrig - totalNew);
  bill.adminDiscountNote = document.getElementById('adDiscountNote').value.trim();
  setSuspended(list);
  document.getElementById('adminDiscountModal').classList.add('hidden');
  renderSuspendedPage();
  addAuditLog('discount.apply', `تعديل أسعار فاتورة معلقة — من ${fmt(totalOrig)} إلى ${fmt(totalNew)} ج`, currentBranch);
}

let _crpPeriod = 'today';

function setCRPeriod(p) {
  _crpPeriod = p;
  ['today','week','month','all','custom'].forEach(x => {
    const btn = document.getElementById('crpBtn' + x.charAt(0).toUpperCase() + x.slice(1));
    if (!btn) return;
    btn.style.background = (p===x) ? 'var(--primary)' : '';
    btn.style.color      = (p===x) ? 'white' : '';
    btn.style.borderColor= (p===x) ? 'var(--primary)' : 'var(--border)';
  });
  renderCashierReport();
}

function openCashierReport() {
  toggleMobileCart(false);
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('crpFrom').value = today;
  document.getElementById('crpTo').value   = today;
  _crpPeriod = 'today';
  setCRPeriod('today');
  document.getElementById('cashierReportModal').classList.remove('hidden');
}

function renderCashierReport() {
  const today = new Date().toISOString().slice(0,10);
  let fromStr, toStr;
  if (_crpPeriod === 'today') {
    fromStr = toStr = today;
  } else if (_crpPeriod === 'week') {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay()+1)%7));
    fromStr = d.toISOString().slice(0,10); toStr = today;
  } else if (_crpPeriod === 'month') {
    fromStr = today.slice(0,7) + '-01'; toStr = today;
  } else if (_crpPeriod === 'custom') {
    fromStr = document.getElementById('crpFrom').value || today;
    toStr   = document.getElementById('crpTo').value   || today;
  } else {
    fromStr = '2000-01-01'; toStr = '2099-12-31';
  }

  // All sales for this branch in the date range (no cashier filter — show all)
  const allSales = getSales().filter(s =>
    !s.isReturn && s.branchId === currentBranch &&
    s.date.slice(0,10) >= fromStr && s.date.slice(0,10) <= toStr
  );
  const allReturns = getSales().filter(s =>
    s.isReturn && s.branchId === currentBranch &&
    s.date.slice(0,10) >= fromStr && s.date.slice(0,10) <= toStr
  );

  const totalRev   = allSales.reduce((a,s)=>a+s.total,0);
  const totalDisc  = allSales.reduce((a,s)=>a+(s.disc||0),0);
  const invoiceQty = allSales.length;
  const atv        = invoiceQty ? totalRev/invoiceQty : 0;
  const returnAmt  = allReturns.reduce((a,s)=>a+Math.abs(s.total||0),0);

  const prodMap = {};
  allSales.forEach(s=>(s.items||[]).forEach(i=>{
    if(!prodMap[i.name]) prodMap[i.name]={qty:0};
    prodMap[i.name].qty += i.qty;
  }));
  const topProds = Object.entries(prodMap).sort((a,b)=>b[1].qty-a[1].qty).slice(0,5);

  // KPIs
  document.getElementById('crpKPIs').innerHTML = [
    {label:'إجمالي المبيعات', val:fmt(totalRev)+' ج',  bg:'#dcfce7',tc:'#15803d',icon:'💰'},
    {label:'عدد الفواتير',    val:invoiceQty,            bg:'#eff6ff',tc:'#1d4ed8',icon:'🧾'},
    {label:'متوسط الفاتورة',  val:fmt(atv)+' ج',         bg:'#fef9c3',tc:'#854d0e',icon:'📈'},
    {label:'إجمالي المرتجعات',val:fmt(returnAmt)+' ج',   bg:'#fee2e2',tc:'#b91c1c',icon:'🔄'},
  ].map(k=>`<div style="background:${k.bg};border-radius:10px;padding:12px;text-align:center;">
    <div style="font-size:22px;">${k.icon}</div>
    <div style="font-size:16px;font-weight:700;color:${k.tc};">${k.val}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${k.label}</div>
  </div>`).join('');

  // Top products
  document.getElementById('crpTopProducts').innerHTML = topProds.length
    ? `<div style="background:var(--bg-secondary);border-radius:10px;padding:12px;margin-bottom:4px;">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🏆 أكثر المنتجات مبيعاً</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${topProds.map(([name,d],i)=>`<span style="background:white;border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:12px;display:flex;align-items:center;gap:5px;">
            <span style="background:var(--primary);color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${i+1}</span>
            ${escHtml(name)} <span style="color:var(--primary);font-weight:700;">${d.qty} قطعة</span></span>`).join('')}
        </div>
      </div>` : '';

  // Daily breakdown
  const byDay = {};
  allSales.forEach(s=>{
    const day = s.date.slice(0,10);
    if(!byDay[day]) byDay[day]={total:0,count:0,sales:[]};
    byDay[day].total += s.total; byDay[day].count++;
    byDay[day].sales.push(s);
  });
  const days = Object.keys(byDay).sort((a,b)=>b.localeCompare(a));
  const body = document.getElementById('cashierReportBody');
  if(!days.length){
    body.innerHTML='<p style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد مبيعات في هذه الفترة</p>';
    return;
  }
  body.innerHTML = days.map(day=>{
    const d = byDay[day];
    const dateLabel = new Date(day+'T12:00:00').toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    const invoicesHtml = d.sales.sort((a,b)=>b.id-a.id).map(s=>{
      const t = new Date(s.date).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      const preview = (s.items||[]).map(i=>escHtml(i.name)+'×'+i.qty).join('، ');
      const pmColor = s.payMethod==='card'?'#1d4ed8':s.payMethod==='mixed'?'#7c3aed':'#15803d';
      const pmLabel = s.payMethod==='card'?'كارت':s.payMethod==='mixed'?'مختلط':'كاش';
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 10px;border-radius:6px;background:var(--bg-secondary);margin-bottom:4px;gap:8px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <span style="font-size:12px;font-weight:700;color:var(--primary);">#${String(s.id).slice(-6)}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-inline-start:6px;">${t}</span>
          ${s.customerName?`<span style="font-size:11px;color:var(--text-muted);margin-inline-start:6px;">👤 ${escHtml(s.customerName)}</span>`:''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${preview}</div>
        </div>
        <div style="text-align:end;flex-shrink:0;">
          <div style="font-weight:700;font-size:13px;">${fmt(s.total)} ج</div>
          <span style="font-size:10px;color:${pmColor};background:${pmColor}20;padding:2px 6px;border-radius:8px;">${pmLabel}</span>
        </div>
      </div>`;
    }).join('');
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="font-size:13px;">${dateLabel}</strong>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;color:var(--text-muted);">${d.count} فاتورة</span>
          <span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:10px;font-weight:700;font-size:13px;">${fmt(d.total)} ج</span>
        </div>
      </div>
      <div>${invoicesHtml}</div>
    </div>`;
  }).join('');
}

function openResumeModal() {
  renderResumeList();
  document.getElementById('resumeModal').classList.remove('hidden');
}

function renderResumeList() {
  const list = getSuspended();
  const el   = document.getElementById('resumeLocalList');
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد فواتير معلقة</div>';
    return;
  }
  el.innerHTML = list.map(b => {
    const disc    = b.adminDiscount || 0;
    const discType= b.adminDiscountType || 'amount';
    const discAmt = discType==='percent' ? (b.sub*disc/100) : Math.min(disc,b.sub);
    const final   = b.sub - discAmt;
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-family:monospace;font-weight:700;color:var(--primary);font-size:14px;">${b.id}</span>
        <span style="font-size:15px;font-weight:700;">${fmt(final)} ج</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${new Date(b.created).toLocaleString('ar-EG')}</div>
      <div style="font-size:12px;margin-bottom:8px;">${b.items.map(i=>escHtml(i.name)+' ×'+i.qty).join(' · ')}</div>
      ${discAmt>0?`<div style="font-size:12px;color:var(--success);margin-bottom:8px;">خصم مدير: -${fmt(discAmt)} ج</div>`:''}
      ${b.note?`<div style="font-size:12px;color:#6b7280;margin-bottom:8px;">ملاحظة: ${escHtml(b.note)}</div>`:''}
      <button class="btn btn-success btn-sm" onclick="resumeFromModal('${b.id}')">استئناف هذه الفاتورة</button>
    </div>`;
  }).join('');
}

function resumeFromModal(id) {
  document.getElementById('resumeModal').classList.add('hidden');
  activateSuspended(id);
}

