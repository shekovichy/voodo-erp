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
};
const _loadedChunks = new Set();
function _loadChunk(page, cb) {
  if (!_CHUNK_FILES[page] || _loadedChunks.has(page)) { cb(); return; }
  const s = document.createElement('script');
  s.src = _CHUNK_FILES[page];
  s.onload  = () => { _loadedChunks.add(page); cb(); };
  s.onerror = () => { console.error('Failed to load module for page:', page); alert('تعذّر تحميل الصفحة — تأكد من الاتصال بالإنترنت وحاول تاني'); };
  document.body.appendChild(s);
}
// ══ CLOUD DATA CACHES — synced with Firestore in real-time ══════════════
const BRANCH_IDS      = ['wh','b1','b2','b3','b4'];
const BRANCH_DEFAULTS = { wh:'🏭 المخزن الرئيسي', b1:'الفرع الأول', b2:'الفرع الثاني', b3:'الفرع الثالث', b4:'الفرع الرابع' };
let currentBranch       = DB.g('currentBranch', 'b1');
let _invCacheByBranch   = {};                        // { b1:[], b2:[], b3:[], b4:[] }
let _salesCache         = [];                        // filled by Firebase listeners — each sale has .branchId
let _settingsCache      = { threshold: DB.g('threshold', 5), salespeople: DB.g('salespeople', ['محمد','الاء']) };
let _transfersCache     = [];                        // inter-branch transfers
let _suppliersCache     = [];                        // suppliers list
let _purchaseCache      = [];                        // purchase orders
let _hrCache            = [];                        // salesperson targets & commission
let _expensesCache      = [];                        // expenses per branch + company
let _auditCache         = [];                        // audit log entries (last 500)
let _helpdeskCache      = [];                        // support tickets
let _supplierPaymentsCache = [];                     // payments recorded against supplier balances (AP)

// Helper: current branch display name
function getBranchName(b) { return ((_settingsCache.branches) || BRANCH_DEFAULTS)[b] || b; }
function getBranches()    { return _settingsCache.branches || BRANCH_DEFAULTS; }

// INVENTORY — branch-aware
const getInv = (branch) => _invCacheByBranch[branch || currentBranch] || [];
function setInv(v, branch) {
  const b = branch || currentBranch;
  _invCacheByBranch[b] = v;
  DB.s(`pos_inv_${b}`, v);
  if (!_fbReady) return;
  _db.collection('pos_data').doc(`inv_${b}`)
     .set({ items: v, updatedAt: Date.now() })
     .catch(e => console.error('Firestore setInv:', e));
}

// SALES — addSale() لإضافة فاتورة / setSales([]) لمسح الكل
const getSales = () => _salesCache;
function addSale(sale) {
  _salesCache.push(sale);
  if (!_fbReady) { DB.s('sales', _salesCache); return; }
  const month = sale.date.slice(0, 7); // YYYY-MM
  const monthItems = _salesCache.filter(s => s.date.slice(0, 7) === month);
  _db.collection('pos_sales').doc(month)
     .set({ items: monthItems, updatedAt: Date.now() })
     .catch(e => console.error('Firestore addSale:', e));
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

function saveSettingsCache() {
  if (!_fbReady) {
    DB.s('threshold',   _settingsCache.threshold);
    DB.s('salespeople', _settingsCache.salespeople);
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

