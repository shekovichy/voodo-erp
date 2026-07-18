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

// ═══════════════════════════════════════════════════════════════
// REAL AUTHENTICATION — Firebase email/password + roles/{uid}
// Replaces the DIY localStorage-password system (kept below only as
// an OFFLINE fallback). Server-side enforcement lives in
// firestore.rules: an account without a roles/{uid} doc has no
// Firestore access at all.
// ═══════════════════════════════════════════════════════════════
// This exact account is always admin (mirrors isOwner() in the rules)
// — it bootstraps the system before any roles exist.
const OWNER_EMAIL = 'shekovichy@gmail.com';
// Staff log in with short usernames; Firebase Auth requires emails, so
// usernames map to a synthetic internal domain (never receives mail).
const AUTH_EMAIL_DOMAIN = 'voodo-pos.local';
function usernameToEmail(u) {
  u = String(u || '').trim().toLowerCase();
  return u.includes('@') ? u : (u + '@' + AUTH_EMAIL_DOMAIN);
}
function emailToUsername(e) {
  e = String(e || '');
  return e.endsWith('@' + AUTH_EMAIL_DOMAIN) ? e.slice(0, e.indexOf('@')) : e;
}

// Resolve the signed-in Firebase user's role and enter the matching
// session. Role source: owner email → admin; otherwise roles/{uid}.
// The resolved role is cached in localStorage so a POS device that
// restarts offline can resume its session (Firebase Auth itself
// persists the sign-in locally).
async function resolveRoleAndEnter(fbUser) {
  let rec = null;
  if ((fbUser.email || '').toLowerCase() === OWNER_EMAIL) {
    rec = { role: 'admin', username: emailToUsername(fbUser.email), branchId: null };
  } else {
    const snap = await firebase.firestore().collection('roles').doc(fbUser.uid).get();
    if (snap.exists) rec = snap.data();
  }
  if (!rec) {
    await firebase.auth().signOut();
    throw new Error('no-role');
  }
  rec.uid = fbUser.uid;
  DB.s('pos_role_cache', rec);
  _enterSessionByRole(rec);
  return rec;
}

function _enterSessionByRole(rec) {
  currentUsername = rec.username || null;
  if (rec.role === 'admin') {
    _enterAdminSession(`تسجيل دخول: ${rec.username}`);
  } else {
    _enterBranchSession(rec.branchId || 'b1', rec.role === 'manager' ? 'manager' : 'cashier', rec.username);
  }
}

// Revocation check for cached sessions: if an admin deleted this
// user's role doc while the device was away, sign it out on resume.
function _verifyRoleStillValid(fbUser) {
  if ((fbUser.email || '').toLowerCase() === OWNER_EMAIL) return;
  firebase.firestore().collection('roles').doc(fbUser.uid).get()
    .then(snap => {
      if (!snap.exists) {
        localStorage.removeItem('pos_role_cache');
        firebase.auth().signOut().finally(() => location.reload());
      } else {
        const rec = snap.data(); rec.uid = fbUser.uid;
        DB.s('pos_role_cache', rec);
      }
    })
    .catch(() => {}); // offline — keep cached session
}

// ── ADMIN USER MANAGEMENT (Firebase accounts + roles docs) ──────
// Creating a user with the primary auth instance would sign the admin
// OUT and the new user IN (client-SDK behavior) — so account creation
// runs on a throwaway secondary app instance, and the roles doc is
// written from the still-signed-in admin session.
function _secondaryAuth() {
  const existing = firebase.apps.find(a => a.name === 'user-mgmt');
  const app = existing || firebase.initializeApp(FIREBASE_CONFIG, 'user-mgmt');
  return app.auth();
}
async function createManagedUser(username, password, role, branchId) {
  const email = usernameToEmail(username);
  const sec = _secondaryAuth();
  const cred = await sec.createUserWithEmailAndPassword(email, password);
  const uid = cred.user.uid;
  await sec.signOut();
  await firebase.firestore().collection('roles').doc(uid).set({
    username: username.trim().toLowerCase(),
    email,
    role,
    branchId: branchId || null,
    createdAt: Date.now(),
    createdBy: (firebase.auth().currentUser || {}).uid || null
  });
  return uid;
}

// ── PASSWORD SECURITY (legacy local accounts — offline fallback) ──
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
    BRANCH_IDS.forEach(b => { _invCacheByBranch[b] = DB.g(`pos_inv_${b}`, b === 'b1' ? DB.g('inv', []) : []); });
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
    // NOTE: no anonymous sign-in anymore — the user is already signed in
    // with a real email/password account by the time initFirebase() runs
    // (see doLogin/resolveRoleAndEnter). In legacy-offline sessions there
    // is no Firebase auth at all: the listeners below fail permission
    // checks and every err handler falls back to localStorage.

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
          if (!_settingsCache.sellerBranches) _settingsCache.sellerBranches = {};
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

    // Suppliers listener — renderSuppliersPage/renderPurchasesPage live in
    // 75-purchases.js (a lazy chunk). Two bugs fixed here together:
    // (1) Passing the bare identifier straight to visRefresh() as an
    //     argument is NOT lazy: JS resolves it to a value the moment this
    //     line executes, regardless of any guard visRefresh checks
    //     internally — so if the chunk never loaded, merely reaching this
    //     line threw an uncaught ReferenceError and killed the rest of this
    //     snapshot callback. Wrapping in an arrow function defers the
    //     lookup until visRefresh actually decides to call it.
    // (2) That guard must check 'page-purchases' (the real top-level page
    //     _showPageImpl toggles 'hidden' on), NOT 'page-suppliers' — that's
    //     an inner sub-tab whose own 'hidden' class is only ever touched by
    //     the purchases chunk's OWN tab-switcher (see switchPurchasesTab-
    //     style code in 75-purchases.js), which hasn't run before the chunk
    //     loads. The static template gives it no 'hidden' class at all, so
    //     until the chunk loads and switches tabs at least once, visRefresh
    //     saw it as "visible" and called the (still undefined) render
    //     function on every listener update — regardless of what page was
    //     actually on screen.
    _db.collection('pos_data').doc('suppliers')
      .onSnapshot(snap => {
        _suppliersCache = snap.exists ? (snap.data().list || []) : DB.g('pos_suppliers', []);
        visRefresh('page-purchases', () => renderSuppliersPage());
        visRefresh('page-purchases', () => renderPurchasesPage());
      }, err => { _suppliersCache = DB.g('pos_suppliers', []); });

    // Purchase Orders listener
    _db.collection('pos_data').doc('purchases')
      .onSnapshot(snap => {
        _purchaseCache = snap.exists ? (snap.data().list || []) : DB.g('pos_purchases', []);
        visRefresh('page-purchases', () => renderPurchasesPage());
      }, err => { _purchaseCache = DB.g('pos_purchases', []); });

    // Supplier payments listener (AP) — see the lazy-chunk note above
    // (checks 'page-purchases', not 'page-suppliers', for the same reason).
    _db.collection('pos_data').doc('supplier_payments')
      .onSnapshot(snap => {
        _supplierPaymentsCache = snap.exists ? (snap.data().list || []) : DB.g('pos_supplier_payments', []);
        visRefresh('page-purchases', () => renderSuppliersPage());
      }, err => { _supplierPaymentsCache = DB.g('pos_supplier_payments', []); });

    // Helpdesk tickets listener — see the lazy-chunk note above.
    _db.collection('pos_data').doc('helpdesk')
      .onSnapshot(snap => {
        _helpdeskCache = snap.exists ? (snap.data().list || []) : DB.g('pos_helpdesk', []);
        visRefresh('page-helpdesk', () => renderHelpdeskPage());
      }, err => { _helpdeskCache = DB.g('pos_helpdesk', []); });

    // Pivot-analyzer favorites listener — see the lazy-chunk note above.
    _db.collection('pos_data').doc('pivot_favorites')
      .onSnapshot(snap => {
        _pivotFavoritesCache = snap.exists ? (snap.data().list || []) : DB.g('pos_pivot_favorites', []);
        visRefresh('page-customized', () => renderPivotFavorites());
      }, err => { _pivotFavoritesCache = DB.g('pos_pivot_favorites', []); });

    // HR listener
    _db.collection('pos_data').doc('hr')
      .onSnapshot(snap => {
        _hrCache = snap.exists ? (snap.data().list || []) : DB.g('pos_hr', []);
        visRefresh('page-hr', renderHRPage);
      }, err => { _hrCache = DB.g('pos_hr', []); });

    // Budgets listener — renderAnalyticsPage's Budget tab lives in the lazy
    // analytics chunk, so guard against it not being loaded (see note above).
    _db.collection('pos_data').doc('budgets')
      .onSnapshot(snap => {
        _budgetsCache = snap.exists ? (snap.data().list || []) : DB.g('pos_budgets', []);
        if (!snap.exists && _budgetsCache.length) {
          _db.collection('pos_data').doc('budgets').set({ list: _budgetsCache, updatedAt: Date.now() });
        }
        visRefresh('page-analytics', () => { if (typeof buildBudgetVsActual === 'function') buildBudgetVsActual(); });
      }, err => { _budgetsCache = DB.g('pos_budgets', []); });

    // POS cash sessions listener — cashier "shifts" (open/close + variance).
    // The cashier UI reads _sessionsCache directly; the report tab is in the
    // lazy analytics chunk (guarded).
    _db.collection('pos_data').doc('sessions')
      .onSnapshot(snap => {
        _sessionsCache = snap.exists ? (snap.data().list || []) : DB.g('pos_sessions', []);
        if (!snap.exists && _sessionsCache.length) {
          _db.collection('pos_data').doc('sessions').set({ list: _sessionsCache, updatedAt: Date.now() });
        }
        if (typeof updateSessionUI === 'function') { try { updateSessionUI(); } catch(e) {} }
        visRefresh('page-analytics', () => { if (typeof buildSessionReport === 'function') buildSessionReport(); });
      }, err => { _sessionsCache = DB.g('pos_sessions', []); });

    // Expenses listener
    _db.collection('pos_data').doc('expenses')
      .onSnapshot(snap => {
        _expensesCache = snap.exists ? (snap.data().list || []) : DB.g('pos_expenses', []);
        visRefresh('page-expenses', renderExpensesPage);
        visRefresh('page-dashboard', buildDashboard);
      }, err => { _expensesCache = DB.g('pos_expenses', []); });

    // Audit Log listener — pos_audit is now ONE DOCUMENT PER ENTRY (see
    // addAuditLog in 88-abc-expenses.js), not a single array-in-one-doc, so
    // it's queried and ordered rather than read as a single doc.
    _db.collection('pos_audit').orderBy('timestamp', 'desc').limit(500)
      .onSnapshot(snap => {
        _auditCache = snap.docs.map(d => d.data());
        visRefresh('page-audit', renderAuditPage);
      }, err => { _auditCache = DB.g('pos_audit', []); });

    // One-time migration: the audit log used to live entirely as one array
    // field in pos_data/audit. If the new pos_audit collection is still
    // empty, copy any existing entries over as individual documents so
    // history isn't lost, then never touch the old doc again — the query
    // above becomes the sole source of truth from here on. Runs from an
    // admin session only (cashier logins are far more frequent/concurrent,
    // which would just multiply harmless-but-noisy duplicate-migration
    // attempts for no benefit — this is a one-time bootstrap, not something
    // that needs every session racing to perform it).
    if (currentUser === 'admin') {
      _db.collection('pos_audit').limit(1).get().then(snap => {
        if (!snap.empty) return;
        _db.collection('pos_data').doc('audit').get().then(oldSnap => {
          const oldList = oldSnap.exists ? (oldSnap.data().list || []) : [];
          if (!oldList.length) return;
          const batch = _db.batch();
          oldList.forEach(entry => {
            const id = entry.id || ('a_' + entry.timestamp + '_' + Math.random().toString(36).slice(2, 7));
            batch.set(_db.collection('pos_audit').doc(id), { ...entry, id });
          });
          batch.commit().catch(e => console.error('Firestore audit migration:', e));
        });
      }).catch(e => console.error('Firestore audit migration check:', e));
    }

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

    // ⚠️ NOT YET LIVE — see the long comment above addSale() in 00-core.js.
    // This subscribes to the NEW pos_sales/{month}/branches/{branchId}
    // structure (real per-branch isolation — see firestore.rules), not the
    // old flat pos_sales/{month} doc. Admin subscribes to every branch;
    // everyone else only to their own (which is also all the NEW rules will
    // permit them to read). Do not merge to main / publish the matching
    // rules until migrateSalesToBranchStructure() has been run — this
    // listener finds nothing for any month that hasn't been migrated yet.
    const _saMonths = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      _saMonths.push(d.toISOString().slice(0, 7));
    }
    const _saBranches = currentUser === 'admin' ? BRANCH_IDS : [currentBranch];
    _saBranches.forEach(b => {
      _saMonths.forEach(month => {
        _db.collection('pos_sales').doc(month).collection('branches').doc(b)
          .onSnapshot(snap => {
            const items = snap.exists ? (snap.data().items || []) : [];
            _salesCache = [
              ..._salesCache.filter(s => !(s.date.slice(0, 7) === month && (s.branchId || '') === b)),
              ...items
            ];
            if (!snap.exists) {
              // Same local-fallback seeding as before, scoped to this
              // specific branch+month now instead of the whole month.
              const localSalesAll = DB.g('sales', []);
              const localMonthBranch = localSalesAll.filter(s => s.date.slice(0, 7) === month && (s.branchId || currentBranch) === b);
              if (localMonthBranch.length) {
                _db.collection('pos_sales').doc(month).collection('branches').doc(b)
                   .set({ items: firebase.firestore.FieldValue.arrayUnion(...localMonthBranch), updatedAt: Date.now(), month, branchId: b }, { merge: true });
              }
            }
            visRefresh('page-sales', () => { initSalesFilter(); renderSales(); });
            visRefresh('page-dashboard', buildDashboard);
            visRefresh('page-reports', buildSalesReport);
          }, err => console.error(`Firestore sales/${month}/${b} error:`, err));
      });
    });

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
  if (!cart.length) { showToast('الفاتورة فارغة'); return; }
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
    cashier:   currentUsername || (currentUser === 'admin' ? 'مدير' : 'كاشير'),
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
  showToast('تم تحميل الفاتورة — يمكن الآن الدفع من الكاشير');
}

function deleteSuspended(id) {
  showConfirmModal('حذف هذه الفاتورة المعلقة؟', function() {
    setSuspended(getSuspended().filter(b => b.id !== id));
    renderSuspendedPage();
  });
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

// ═══════════════════════════════════════════════════════════════
// AUTH BOOTSTRAP — runs once at page load (this file executes near
// the end of the bundle, so every function it needs is defined).
// Initializes the Firebase app + auth listener so a device that is
// already signed in resumes its session automatically instead of
// showing the login page on every restart. The async callback fires
// after the whole bundle has executed.
// ═══════════════════════════════════════════════════════════════
(function initAuthLayer() {
  if (!FIREBASE_CONFIG.projectId || typeof firebase === 'undefined') return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(fbUser => {
      if (!fbUser || currentUser) return; // not signed in, or already in a session
      const cached = DB.g('pos_role_cache', null);
      if (cached && cached.uid === fbUser.uid) {
        // Instant resume from cache (works offline), then re-verify the
        // role against the server in the background (revocation check).
        _enterSessionByRole(cached);
        _verifyRoleStillValid(fbUser);
      } else {
        resolveRoleAndEnter(fbUser).catch(e => {
          if (e && e.message === 'no-role') console.warn('Auth: account has no role — signed out.');
          else console.error('Auth resume error:', e);
        });
      }
    });
  } catch (e) {
    console.error('Auth init error:', e);
  }
})();

