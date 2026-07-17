// ══════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════
const DB = {
  g: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  s: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

// ══ LAZY-LOADED PAGES ══════════════════════════════════════════════
// A handful of independent, heavy pages (accounting, warehouse,
// manufacturing, purchases — see LAZY_CHUNKS in build.py) ship as separate
// .js files instead of being inlined into index.html, so a cashier who
// never opens them never downloads them. showPage() in 25-navigation.js
// calls _loadChunk() before rendering one of these pages.
const _CHUNK_FILES = {
  accounting:    'chunk-accounting.js',
  warehouse:     'chunk-warehouse.js',
  manufacturing: 'chunk-manufacturing.js',
  purchases:     'chunk-purchases.js',
  helpdesk:      'chunk-helpdesk.js',
  pivot:         'chunk-pivot.js',
  migration:     'chunk-migration.js',
};
const _loadedChunks = new Set();
function _loadChunk(page, cb) {
  if (!_CHUNK_FILES[page] || _loadedChunks.has(page)) { cb(); return; }
  const s = document.createElement('script');
  s.src = _CHUNK_FILES[page];
  s.onload  = () => { _loadedChunks.add(page); cb(); };
  s.onerror = () => { console.error('Failed to load module for page:', page); showToast('تعذّر تحميل الصفحة — تأكد من الاتصال بالإنترنت وحاول تاني'); };
  document.body.appendChild(s);
}
// ══ CLOUD DATA CACHES — synced with Firestore in real-time ══════════════
// Base branches always exist; admin-added branches (see addNewBranch() in
// 70-branches.js) get auto-numbered ids (b5, b6, ...) appended here. This
// list is computed once at page load from localStorage — adding a branch
// requires a reload to take effect everywhere (Firestore listeners, cached
// filter dropdowns, etc. are all set up once at startup, see CLAUDE.md-style
// note in addNewBranch()), so there's no need for this to be reactive mid-session.
const BASE_BRANCH_IDS = ['wh','b1','b2','b3','b4'];
const BRANCH_IDS      = [...BASE_BRANCH_IDS, ...DB.g('extraBranchIds', [])];
const BRANCH_DEFAULTS = { wh:'🏭 المخزن الرئيسي', b1:'الفرع الأول', b2:'الفرع الثاني', b3:'الفرع الثالث', b4:'الفرع الرابع' };
let currentBranch       = DB.g('currentBranch', 'b1');
let _invCacheByBranch   = {};                        // { b1:[], b2:[], b3:[], b4:[] }
let _salesCache         = [];                        // filled by Firebase listeners — each sale has .branchId
// pos_branches was previously write-only — saveBranchNames()/addNewBranch()
// persisted it but nothing ever read it back at load time, so renamed/added
// branch names silently reset to BRANCH_DEFAULTS on every fresh page load
// until Firestore's settings listener happened to fire and repopulate it.
let _settingsCache      = { threshold: DB.g('threshold', 5), salespeople: DB.g('salespeople', ['محمد','الاء']), branches: DB.g('pos_branches', null) || undefined, sellerBranches: DB.g('pos_seller_branches', {}) };
let _transfersCache     = [];                        // inter-branch transfers
let _suppliersCache     = [];                        // suppliers list
let _purchaseCache      = [];                        // purchase orders
let _hrCache            = [];                        // salesperson targets & commission
let _expensesCache      = [];                        // expenses per branch + company
let _auditCache         = [];                        // audit log entries (last 500)
let _helpdeskCache      = [];                        // support tickets
let _supplierPaymentsCache = [];                     // payments recorded against supplier balances (AP)
let _pivotFavoritesCache = [];                       // saved pivot-analyzer report configs

// Helper: current branch display name
function getBranchName(b) { return ((_settingsCache.branches) || BRANCH_DEFAULTS)[b] || b; }
function getBranches()    { return _settingsCache.branches || BRANCH_DEFAULTS; }

// INVENTORY — branch-aware
const getInv = (branch) => _invCacheByBranch[branch || currentBranch] || [];
// ⚠️ setInv REPLACES the whole branch inventory — it's inherently last-write-
// wins, so it must only be used for intentional full replacement (backup
// restore, demo seed). Anything that MODIFIES stock (sale, return, transfer,
// receive, product edit/delete/import) must go through adjustStock() below,
// which applies per-product deltas inside a Firestore transaction so two
// devices writing at the same moment can't clobber each other's changes.
function setInv(v, branch) {
  const b = branch || currentBranch;
  _invCacheByBranch[b] = v;
  DB.s(`pos_inv_${b}`, v);
  if (!_fbReady) return;
  _db.collection('pos_data').doc(`inv_${b}`)
     .set({ items: v, updatedAt: Date.now() })
     .catch(e => console.error('Firestore setInv:', e));
}

// Race-safe inventory mutation. deltas = [{ code, delta?, set?, insert?, remove? }]
//   delta:  add to qty (negative = deduct)          — sales, returns, transfers, receiving
//   set:    Object.assign fields onto the product   — cost/price/category edits, absolute qty corrections
//   insert: product template to create (qty starts at 0) if `code` isn't in the branch yet
//   remove: true → delete the product from the branch
// Applied optimistically to the local cache/localStorage first, then re-applied
// server-side inside a transaction against the CURRENT server state — so a
// concurrent sale on another device survives (the old read-modify-setInv
// pattern silently lost one of the two writes). If the transaction can't run
// (offline / repeated contention), falls back to writing the local array —
// no worse than the old behavior, and the SDK queues it until reconnect.
function adjustStock(deltas, branch) {
  const b = branch || currentBranch;
  const applyTo = (items) => {
    deltas.forEach(d => {
      const idx = items.findIndex(x => x.code === d.code);
      if (d.remove) { if (idx >= 0) items.splice(idx, 1); return; }
      let p = idx >= 0 ? items[idx] : null;
      if (!p) {
        if (!d.insert) return;
        p = Object.assign({}, d.insert, { qty: 0 });
        items.push(p);
      }
      if (d.set)   Object.assign(p, d.set);
      if (d.delta) p.qty = (p.qty || 0) + d.delta;
    });
    return items;
  };
  _invCacheByBranch[b] = applyTo(_invCacheByBranch[b] || []);
  DB.s(`pos_inv_${b}`, _invCacheByBranch[b]);
  if (!_fbReady) return;
  const ref = _db.collection('pos_data').doc(`inv_${b}`);
  _db.runTransaction(tx =>
    tx.get(ref).then(snap => {
      const items = applyTo(snap.exists ? (snap.data().items || []) : []);
      tx.set(ref, { items, updatedAt: Date.now() });
    })
  ).catch(e => {
    console.error('Firestore adjustStock (falling back to direct write):', e);
    ref.set({ items: _invCacheByBranch[b], updatedAt: Date.now() })
       .catch(e2 => console.error('Firestore adjustStock fallback:', e2));
  });
}

// SALES — addSale() لإضافة فاتورة / setSales([]) لمسح الكل
const getSales = () => _salesCache;
function addSale(sale) {
  _salesCache.push(sale);
  if (!_fbReady) { DB.s('sales', _salesCache); return; }
  const month = sale.date.slice(0, 7); // YYYY-MM
  // Atomically append ONLY this sale to the month document instead of
  // rewriting the whole month array. The old rewrite had a lost-update race:
  // two branches (or two cashiers) selling at the same moment would each read
  // the month array, add their own invoice, and write the whole thing back —
  // the second write silently clobbering the first branch's invoice.
  // arrayUnion appends server-side, so every concurrent sale survives.
  // (merge:true creates the doc if the month is new.)
  _db.collection('pos_sales').doc(month)
     .set({ items: firebase.firestore.FieldValue.arrayUnion(sale), updatedAt: Date.now() }, { merge: true })
     .catch(e => {
       // Write refused (e.g. a legacy/unauthenticated session during the
       // auth transition, or a rules change) — persist the whole sales
       // cache locally so the invoice survives a reload instead of
       // silently evaporating with the failed cloud write.
       console.error('Firestore addSale (persisted locally):', e);
       DB.s('sales', _salesCache);
     });
}
function setSales(v) {
  // Used only for reset (v = [])
  _salesCache = v;
  if (!_fbReady) { DB.s('sales', v); return; }
  _db.collection('pos_sales').get()
     .then(snap => {
       if (!snap.empty) {
         const batch = _db.batch();
         snap.docs.forEach(doc => batch.delete(doc.ref));
         return batch.commit();
       }
     }).catch(e => console.error('Firestore setSales clear:', e));
}

// USERS — kept in localStorage (passwords stay local)
const getUsers = ()  => DB.g('users', { admin: '', cashier: '' });
function setUsers(v) {
  setUsersLocal(v); // passwords NEVER go to Firestore
}

// Branch-specific cashier users (يوزر + باسورد مختلف لكل فرع)
const DEFAULT_BRANCH_USERS = {
  b1: { username: 'branch1', password: '' },
  b2: { username: 'branch2', password: '' },
  b3: { username: 'branch3', password: '' },
  b4: { username: 'branch4', password: '' },
};
const getBranchUsers = () => DB.g('pos_branch_users', DEFAULT_BRANCH_USERS);
function setBranchUsers(v) {
  setBranchUsersLocal(v); // passwords NEVER go to Firestore
}

// Admin-managed user accounts — replaces the old one-slot-per-branch model
// so the admin can create any number of admin/cashier/manager logins from
// "إدارة المستخدمين" in Settings. Each entry:
// { id, username, password (hash), type:'admin'|'branch', branchId, role }
// Synced through Firestore (pos_data/accounts) — same auth-required
// protection tier as inventory/sales, NOT the old pos_data/auth doc that
// leaked publicly (see CLAUDE.md). Only the password HASH is ever stored.
let _accountsCache = DB.g('pos_accounts', []);
const getAccounts = () => _accountsCache;
function setAccountsLocal(v) { _accountsCache = v; DB.s('pos_accounts', v); }
function setAccounts(v) {
  setAccountsLocal(v);
  if (!_fbReady) return;
  _db.collection('pos_data').doc('accounts')
     .set({ list: v, updatedAt: Date.now() })
     .catch(e => console.error('Firestore setAccounts:', e));
}

// SETTINGS
const getThreshold    = () => _settingsCache.threshold || 5;
const getSalespeople  = () => _settingsCache.salespeople && _settingsCache.salespeople.length ? _settingsCache.salespeople : ['محمد','الاء'];
// Seller → branch assignment. A seller with no entry (or branchId === null)
// works across all branches; kept as a separate map (not baked into the
// salespeople array) so every existing consumer that expects plain name
// strings (POS payment dropdown, reports, HR targets/attendance, leave
// requests) keeps working unchanged.
const getSellerBranch = (name) => (_settingsCache.sellerBranches || {})[name] || null;
function setSellerBranch(name, branchId) {
  if (!_settingsCache.sellerBranches) _settingsCache.sellerBranches = {};
  if (branchId) _settingsCache.sellerBranches[name] = branchId;
  else delete _settingsCache.sellerBranches[name];
  saveSettingsCache();
}

function saveSettingsCache() {
  if (!_fbReady) {
    DB.s('threshold',   _settingsCache.threshold);
    DB.s('salespeople', _settingsCache.salespeople);
    DB.s('pos_seller_branches', _settingsCache.sellerBranches || {});
    return;
  }
  _db.collection('pos_data').doc('settings')
     .set({ ..._settingsCache, updatedAt: Date.now() })
     .catch(e => console.error('Firestore saveSettings:', e));
}

function setThreshold(v) {
  _settingsCache.threshold = parseInt(v) || 5;
  saveSettingsCache();
}
function setSalespeople(arr) {
  _settingsCache.salespeople = arr;
  saveSettingsCache();
  renderSellersSettings();
}

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
let currentUser = null;
// The actual username of whoever is logged in (from the Firebase role doc,
// a legacy local account, or the demo). Recorded on sales/returns/transfers/
// audit entries for real accountability — currentUser only distinguishes
// admin vs cashier, which is useless once several people share a role.
let currentUsername = null;
// A branch manager is still currentUser==='cashier' (keeps every existing
// admin-vs-cashier check working unchanged) with this extra flag layering
// on a couple of additional, branch-scoped, read-only pages — see doLogin()
// in 05-utils.js and renderHomeIcons()/buildDashboard().
let isBranchManager = false;
let cart = [];
let payMethod = 'cash';
let chartWeekly = null, chartTop = null, chartRptSales = null, chartProfit = null;
let chartTrend = null, chartBranches = null, chartCmpTrend = null, chartCmpBranches = null;
let _dashRange = 30; // default 30 days
let lastSaleForPrint = null;

