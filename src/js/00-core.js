// ══════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════
const DB = {
  g: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  s: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

// ══ LAZY-LOADED PAGES ══════════════════════════════════════════════
// A handful of independent, heavy pages (accounting, warehouse,
// purchases — see LAZY_CHUNKS in build.py) ship as separate .js files
// instead of being inlined into index.html, so a cashier who never opens
// them never downloads them. showPage() in 25-navigation.js calls
// _loadChunk() before rendering one of these pages.
const _CHUNK_FILES = {
  accounting:    'chunk-accounting.js',
  warehouse:     'chunk-warehouse.js',
  purchases:     'chunk-purchases.js',
  helpdesk:      'chunk-helpdesk.js',
  pivot:         'chunk-pivot.js',
  migration:     'chunk-migration.js',
  analytics:     'chunk-analytics.js',
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

// الفروع الإضافية مصدرها الحقيقي هو pos_data/settings.branches المتزامن،
// مش localStorage: confirmAddBranch() بتكتب الاسم في السحابة وقايمة الـ ids
// محلياً بس، فالفرع كان بيبان على جهاز إنشائه لوحده. بينادى من مستمع
// الإعدادات (65-firebase.js) أول ما البيانات توصل.
// ⚠️ push على نفس المصفوفة عن قصد — كل الملفات ماسكة نفس المرجع، فالتعديل
// في المكان بيوصلهم كلهم؛ إعادة الإسناد كانت هتسيبهم على النسخة القديمة.
function _syncExtraBranchIds(branchesMap) {
  if (!branchesMap) return [];
  const added = Object.keys(branchesMap)
    .filter(id => /^b\d+$/.test(id) && !BRANCH_IDS.includes(id))
    .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  if (!added.length) return [];
  added.forEach(id => BRANCH_IDS.push(id));
  DB.s('extraBranchIds', BRANCH_IDS.filter(id => !BASE_BRANCH_IDS.includes(id)));
  return added;
}
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
let _budgetsCache       = [];                        // monthly company budgets (revenue target + expense budget per category)
let _sessionsCache      = [];                        // POS cash sessions (shift open/close + variance)

// ══ PERMISSIONS TREE — Department → Tab → (optional) Sub-item ══════════
// Replaces the old flat tab list (2026-07-20) — grouped by department to
// match how the business is actually organized, with a real (not
// cosmetic) third level wherever the underlying data already lives in
// separate Firestore documents rather than one shared blob. Also doubles
// as the home-screen navigation grouping (100-home.js) — one source of
// truth for "how the app is organized" instead of two structures that
// could drift apart.
//
// A department's `tabs` entries are either a plain leaf tab
// ({key,label,enforced}) or a tab with real independently-gateable
// children ({key,label,enforced,children:[{key,label}]}). Permissions are
// only ever STORED at the leaf level — a childless tab's own key, or each
// child's key — never at a parent-with-children's own key. 'settings',
// 'migration' and 'userperms' aren't in this tree at all (hardcoded
// owner-only, see isRealOwner). 'home' has no permission entry — always
// visible once logged in.
//
// `enforced:true` means firestore.rules actually checks this (see
// tabForDoc() there) — a denied user is blocked at the database, not just
// the UI. `enforced:false` covers TWO different reasons, both meaning
// "hiding the tab here is the only boundary that exists":
//  (a) no dedicated cloud document to gate at all — dashboard/reports are
//      pure derived views.
//  (b) the tab's document IS synced to Firestore, but the SAME document is
//      also read/written as a routine part of completing a sale or a cash
//      shift — inventory/sales (obviously), suspended (a cashier suspends/
//      resumes their OWN cart from the topbar bell, not just the
//      management list), customers/promos (looked up and auto-applied
//      during checkout — see openPayment()/completeSale() in
//      20-pos-payment.js), and analytics (POS session open/close writes to
//      the same pos_data/sessions doc — see confirmOpenSession() in the
//      same file). Firestore rules gate a whole document, not a UI page, so
//      restricting these would just as well lock a cashier out of finishing
//      a sale or opening their drawer — found this the hard way while
//      designing the rule (see the design notes on this feature), so these
//      stay UI-only on purpose rather than "mostly enforced with a few
//      landmines still in it".
const DEPARTMENTS = [
  { key: 'sales_pos', label: '🛒 المبيعات ونقطة البيع', tabs: [
    { key: 'sales',     label: 'المبيعات',        enforced: false },
    { key: 'suspended', label: 'الفواتير المعلقة', enforced: false },
  ]},
  { key: 'customers_marketing', label: '👥 العملاء والتسويق', tabs: [
    { key: 'customers', label: 'العملاء',         enforced: false },
    { key: 'promos',    label: 'العروض الترويجية', enforced: false },
  ]},
  { key: 'inventory_warehouse', label: '📦 المخزون والمخازن', tabs: [
    { key: 'inventory', label: 'المخزون',       enforced: false },
    { key: 'warehouse', label: 'المخزن الرئيسي', enforced: true  },
    { key: 'transfers', label: 'التحويلات',      enforced: true  },
  ]},
  { key: 'purchasing', label: '🛍️ المشتريات', tabs: [
    { key: 'purchases', label: 'المشتريات والموردين', enforced: true, children: [
      { key: 'purchases_suppliers', label: 'الموردين' },
      { key: 'purchases_orders',    label: 'أوامر الشراء' },
      { key: 'purchases_payments',  label: 'مدفوعات الموردين' },
    ]},
  ]},
  { key: 'finance', label: '💰 المالية والمحاسبة', tabs: [
    { key: 'accounting', label: 'المحاسبة', enforced: true },
    { key: 'expenses',   label: 'المصاريف', enforced: true, children: [
      { key: 'expenses_main',     label: 'المصاريف' },
      { key: 'expenses_requests', label: 'طلبات اعتماد المصاريف' },
    ]},
  ]},
  { key: 'hr_dept', label: '👔 الموارد البشرية', tabs: [
    { key: 'hr', label: 'الموارد البشرية', enforced: true, children: [
      { key: 'hr_targets',    label: 'الأهداف والعمولات' },
      { key: 'hr_attendance', label: 'الحضور والانصراف' },
      { key: 'hr_payroll',    label: 'الرواتب' },
      { key: 'hr_leaves',     label: 'طلبات الإجازات' },
    ]},
  ]},
  { key: 'reports_analytics', label: '📊 التقارير والتحليلات', tabs: [
    { key: 'dashboard',  label: 'الداشبورد',            enforced: false },
    { key: 'reports',    label: 'التقارير',              enforced: false },
    { key: 'customized', label: 'تقارير مخصصة',          enforced: true  },
    { key: 'analytics',  label: 'التحليلات الاستراتيجية', enforced: false },
  ]},
  { key: 'support_system', label: '🎫 الدعم والنظام', tabs: [
    { key: 'helpdesk', label: 'الدعم الفني',   enforced: true },
    { key: 'audit',    label: 'سجل التغييرات', enforced: true },
  ]},
];

// Flat leaf-item list — the only level permissions are actually stored at.
// Kept under the old name so every existing call site that just needs
// "the list of {key,label,enforced}" (matrix rendering, defaults
// computation, the migration tool) keeps working unchanged.
const TAB_PERMISSIONS = DEPARTMENTS.flatMap(d => d.tabs.flatMap(t =>
  t.children
    ? t.children.map(c => ({ key: c.key, label: c.label, enforced: t.enforced }))
    : [{ key: t.key, label: t.label, enforced: t.enforced }]
));
// Parent tab key -> its children's leaf keys, for tabs that have them
// (purchases/expenses/hr). Used by canViewTab/canWriteTab to aggregate:
// checking a parent tab key (e.g. showPage('hr')'s gate) means "does this
// account have access to ANY of its children".
const TAB_CHILDREN = {};
DEPARTMENTS.forEach(d => d.tabs.forEach(t => { if (t.children) TAB_CHILDREN[t.key] = t.children.map(c => c.key); }));

// Icon per tab — shared by the admin's HOME_FOLDERS (100-home.js) and the
// dynamic per-permission grid rendered for non-admin accounts (same file).
const TAB_ICON = {
  dashboard:     { grad:'#06b6d4,#0891b2', svg:'<rect x="6" y="28" width="9" height="13" rx="2" fill="white"/><rect x="20" y="18" width="9" height="23" rx="2" fill="white"/><rect x="34" y="8" width="9" height="33" rx="2" fill="white"/>' },
  inventory:     { grad:'#22c55e,#16a34a', svg:'<rect x="8" y="18" width="32" height="22" rx="3" stroke="white" stroke-width="3"/><path d="M17 18V13a7 7 0 0114 0v5" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M18 29h12M24 24v10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  sales:         { grad:'#0ea5e9,#0369a1', svg:'<rect x="8" y="8" width="32" height="32" rx="3" stroke="white" stroke-width="2.5"/><path d="M14 24h20M14 30h14M14 18h10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  suspended:     { grad:'#f59e0b,#b45309', svg:'<rect x="10" y="14" width="28" height="22" rx="3" stroke="white" stroke-width="2.5"/><path d="M16 22h16M16 28h10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  reports:       { grad:'#38bdf8,#0369a1', svg:'<path d="M8 36L18 24l8 6 8-12 6 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="6" width="36" height="36" rx="4" stroke="white" stroke-width="2.5"/>' },
  customized:    { grad:'#f472b6,#be185d', svg:'<circle cx="21" cy="21" r="12" stroke="white" stroke-width="2.5"/><path d="M30 30l10 10" stroke="white" stroke-width="3.5" stroke-linecap="round"/><path d="M17 21h8M21 17v8" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  warehouse:     { grad:'#64748b,#475569', svg:'<path d="M6 21L24 9l18 12v20H6V21z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><rect x="18" y="28" width="12" height="13" rx="2" fill="white"/><rect x="14" y="20" width="7" height="7" rx="1" fill="white" opacity=".7"/><rect x="27" y="20" width="7" height="7" rx="1" fill="white" opacity=".7"/>' },
  customers:     { grad:'#a855f7,#7c3aed', svg:'<circle cx="24" cy="16" r="8" stroke="white" stroke-width="2.5"/><path d="M8 40c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  promos:        { grad:'#fb7185,#dc2626', svg:'<path d="M20 8H10a2 2 0 00-2 2v10l20 20 12-12L20 8z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><circle cx="15" cy="15" r="2.5" fill="white"/>' },
  transfers:     { grad:'#34d399,#059669', svg:'<path d="M10 18h28M30 10l8 8-8 8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 30H10M18 22l-8 8 8 8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  purchases:     { grad:'#fcd34d,#a16207', svg:'<path d="M14 8h20l4 8H10l4-8z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><rect x="10" y="16" width="28" height="24" rx="3" stroke="white" stroke-width="2.5"/><path d="M20 28h8M24 24v8" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  hr:            { grad:'#8b5cf6,#6d28d9', svg:'<circle cx="18" cy="16" r="6" stroke="white" stroke-width="2.5"/><circle cx="32" cy="16" r="6" stroke="white" stroke-width="2.5"/><path d="M6 40c0-6.627 5.373-12 12-12s12 5.373 12 12M22 40c0-6.627 5.373-12 12-12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  expenses:      { grad:'#f87171,#b91c1c', svg:'<circle cx="24" cy="24" r="16" stroke="white" stroke-width="2.5"/><path d="M24 13v22M18 19c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 4-6 4-6 1.686-6 4 2.686 6 6 6 6-2.686 6-6" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  audit:         { grad:'#94a3b8,#334155', svg:'<rect x="10" y="6" width="28" height="36" rx="3" stroke="white" stroke-width="2.5"/><path d="M16 16h16M16 22h16M16 28h8" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M30 32l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  accounting:    { grad:'#34d399,#047857', svg:'<rect x="10" y="6" width="28" height="36" rx="3" stroke="white" stroke-width="2.5"/><path d="M16 16h16M16 22h16M16 28h10" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M28 32l3 3 5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  helpdesk:      { grad:'#fb923c,#c2410c', svg:'<path d="M8 34V16a6 6 0 016-6h20a6 6 0 016 6v10a6 6 0 01-6 6H20l-8 8v-6z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><circle cx="18" cy="21" r="2" fill="white"/><circle cx="24" cy="21" r="2" fill="white"/><circle cx="30" cy="21" r="2" fill="white"/>' },
  analytics:     { grad:'#6366f1,#4338ca', svg:'<path d="M8 40V22M18 40V14M28 40V26M38 40V10" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M8 16l10-8 10 6 10-10" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
};

// Starting-point templates the create/edit-user UI pre-fills when you pick
// a base type — every value is then freely editable per user and saved as
// its own roles/{uid}.permissions map. 'admin' is now just a LABEL: only
// the real owner (isOwner()/isRealOwner — the hardcoded OWNER_EMAIL) gets
// unconditional full bypass. An admin-labeled staff account is governed by
// this same customizable matrix like manager/cashier (2026-07-20 — the
// owner asked to be able to hand out an "admin" title without it silently
// meaning root access, e.g. for someone managing a single company/branch
// on the owner's behalf).
//
// ⚠️ Defaults to FULL access on every tab for every non-owner role alike —
// this deliberately matches the *data layer* as it's worked until now:
// every pos_data/{doc} was already readable/writable by any signed-in role
// (see firestore.rules), the UI just never linked to most of these pages
// for non-admin. Tried defaulting to a "minimal" set matching what the old
// UI visibly linked to instead, but that turned out to have gaps — e.g. the
// topbar's suspended-invoices bell is reachable from every branch account
// regardless of home-screen icons, not just the ones the icon grid implied
// — and any such gap silently breaks a real workflow after migration.
// Defaulting wide-open and letting the owner dial specific users DOWN from
// here is the only direction where a mistake just leaves someone with
// access they already effectively had, instead of quietly taking away
// something they need mid-shift.
// 2026-07-20: cashier/manager are FIXED role-appropriate sets the owner
// picked directly (not a starting point — the matrix is hidden entirely
// for these two types in the UI, see toggleUserAccountFields() in
// 60-settings.js; only 'admin' is actually customizable, since only admin-
// labeled accounts vary enough per-person to need it). Anything not
// listed for a role defaults to no access.
const _FIXED_ROLE_GRANTS = {
  cashier: { helpdesk: { view: true, write: true } },
  manager: {
    helpdesk:           { view: true, write: true },
    reports:            { view: true, write: false }, // branch-locked already (lockBranchFilter) — sees only their own branch
    hr_attendance:      { view: true, write: true },
    expenses_requests:  { view: true, write: true },
    warehouse:           { view: true, write: true },
    transfers:           { view: true, write: true },
  },
};
function _defaultPermissionsFor(role) {
  const perms = {};
  TAB_PERMISSIONS.forEach(t => { perms[t.key] = { view: false, write: false }; });
  if (role === 'admin') {
    // Admin's matrix is a fully-editable starting point, not a fixed
    // grant — defaults to everything ON so the owner dials it DOWN
    // rather than having to hunt for what to turn on (see the long
    // rationale above this used to sit on, still true for admin).
    TAB_PERMISSIONS.forEach(t => { perms[t.key] = { view: true, write: true }; });
  } else {
    Object.assign(perms, _FIXED_ROLE_GRANTS[role] || {});
  }
  return perms;
}

// Effective permissions for whoever is currently logged in — null means
// unrestricted (the real owner, or a legacy offline account with no cloud
// role at all). Falls back to the role's default template if this account
// predates the permissions system (hasn't been migrated yet — see
// 06-permissions-migration.js), mirroring the same fallback firestore.rules
// applies so the UI and the actual server-side access never disagree.
function getMyPermissions() {
  if (isRealOwner) return null;
  const rec = DB.g('pos_role_cache', null);
  if (!rec) return null; // no cloud role at all (legacy local account) — nothing to restrict
  return rec.permissions || _defaultPermissionsFor(rec.role);
}

// Turns a raw permissions map into a readable Arabic one-liner for the
// audit log (e.g. "المخزون (عرض+تعديل)، المشتريات (عرض)") — used when
// creating/deleting a user so the log shows what access they actually had,
// not just their role label. Only lists tabs with at least view granted.
function summarizePermissions(perms) {
  if (!perms) return 'كل الصلاحيات (بدون قيود)';
  const parts = TAB_PERMISSIONS
    .filter(t => perms[t.key] && perms[t.key].view)
    .map(t => `${t.label}${perms[t.key].write ? ' (عرض+تعديل)' : ' (عرض فقط)'}`);
  return parts.length ? parts.join('، ') : 'بدون أي صلاحيات ظاهرة';
}
function canViewTab(tabKey) {
  if (isRealOwner) return true;
  const perms = getMyPermissions();
  if (!perms) return true;
  if (TAB_CHILDREN[tabKey]) return TAB_CHILDREN[tabKey].some(ck => perms[ck] && perms[ck].view);
  if (!TAB_PERMISSIONS.some(t => t.key === tabKey)) return true; // untracked tab — always allowed
  return !!(perms[tabKey] && perms[tabKey].view);
}
function canWriteTab(tabKey) {
  if (isRealOwner) return true;
  const perms = getMyPermissions();
  if (!perms) return true;
  if (TAB_CHILDREN[tabKey]) return TAB_CHILDREN[tabKey].some(ck => perms[ck] && perms[ck].write);
  return !!(perms[tabKey] && perms[tabKey].write);
}

// Helper: current branch display name
function getBranchName(b) { return ((_settingsCache.branches) || BRANCH_DEFAULTS)[b] || b; }
function getBranches()    { return _settingsCache.branches || BRANCH_DEFAULTS; }

// INVENTORY — branch-aware
//
// ⚠️ NOT YET LIVE — pos_data/inventory/branches/{branchId} write path below
// is implemented and tested locally, but firestore.rules still only has the
// OLD flat pos_data/inv_{branchId} rule (any role reads/writes any branch's
// stock — see the security review dated 2026-07-17). Cutting over requires,
// in this exact order: (1) run the one-time migration tool (Settings →
// "🔀 ترحيل المخزون لهيكل معزول لكل فرع", 04-inventory-migration.js) while
// the OLD rule still permits reading the old inv_{branchId} docs, (2)
// verify inventory renders correctly for every branch, (3) publish the NEW
// rules that require roles/{uid}.branchId to match the branchId path
// segment — a 'wh' (warehouse) role additionally keeps write access to
// every branch, since warehouse→branch transfers are a real cross-branch
// workflow, not a security gap (see confirmWhTransfer in 95-warehouse.js).
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
  _db.collection('pos_data').doc('inventory').collection('branches').doc(b)
     .set({ items: v, updatedAt: Date.now(), branchId: b })
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
  const ref = _db.collection('pos_data').doc('inventory').collection('branches').doc(b);
  _db.runTransaction(tx =>
    tx.get(ref).then(snap => {
      const items = applyTo(snap.exists ? (snap.data().items || []) : []);
      tx.set(ref, { items, updatedAt: Date.now(), branchId: b });
    })
  ).catch(e => {
    console.error('Firestore adjustStock (falling back to direct write):', e);
    ref.set({ items: _invCacheByBranch[b], updatedAt: Date.now(), branchId: b })
       .catch(e2 => console.error('Firestore adjustStock fallback:', e2));
  });
}

// SALES — addSale() لإضافة فاتورة / setSales([]) لمسح الكل
//
// ⚠️ NOT YET LIVE — pos_sales/{month}/branches/{branchId} write path below
// is implemented and tested locally, but firestore.rules still only has the
// OLD flat pos_sales/{document=**} rule (any role reads/writes the whole
// month, all branches mixed — see the security review dated 2026-07-17).
// Cutting over requires, in this exact order: (1) run the one-time
// migration tool to copy existing flat-doc sales into the new per-branch
// structure while the OLD rule still permits reading them, (2) verify the
// migrated data renders correctly, (3) publish the NEW rules that require
// roles/{uid}.branchId to match the branchId path segment (removing the old
// blanket rule). Do not merge the new listener/rules pair to main without
// running the migration first — the new listener looks for data that only
// exists after migration; publishing before then makes sales reports look
// empty.
const getSales = () => _salesCache;
function addSale(sale) {
  _salesCache.push(sale);
  if (!_fbReady) { DB.s('sales', _salesCache); return; }
  const month = sale.date.slice(0, 7); // YYYY-MM
  const branchId = sale.branchId || currentBranch;
  // Branch-scoped subcollection, NOT a flat pos_sales/{month} doc. Firestore
  // security rules operate at the document level — they can allow or deny
  // an entire document, but can never filter which ELEMENTS of an array
  // field a given reader may see. So as long as every branch's invoices for
  // a month lived in one shared document, granting a branch cashier read
  // access to "their month" meant granting it to every other branch's
  // invoices in that same document too — a UI filter hides them, but the
  // raw document (and therefore the data) was never actually restricted.
  // Splitting storage by branch is what makes a real per-branch rule
  // possible at all (see firestore.rules). Still arrayUnion'd (not
  // overwritten) for the same concurrent-write safety as before.
  _db.collection('pos_sales').doc(month).collection('branches').doc(branchId)
     .set({
       items: firebase.firestore.FieldValue.arrayUnion(sale),
       updatedAt: Date.now(), month, branchId
     }, { merge: true })
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
  if (v.length) { console.error('setSales: non-empty array not supported for cloud writes'); return; }
  // Delete every branch-month doc across a generous 24-month window (well
  // under Firestore's 500-ops-per-batch limit even with several branches),
  // plus any leftover legacy flat pos_sales/{month} docs from before the
  // per-branch migration.
  const months = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const batch = _db.batch();
  months.forEach(month => {
    batch.delete(_db.collection('pos_sales').doc(month));
    BRANCH_IDS.forEach(b => batch.delete(_db.collection('pos_sales').doc(month).collection('branches').doc(b)));
  });
  batch.commit().catch(e => console.error('Firestore setSales clear:', e));
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

// MONTHLY BUDGETS — one record per month: { month:'YYYY-MM',
// revenueTarget, categories:{ rent, salaries, ... } (keys = EXP_CATS) }.
// Synced through Firestore (pos_data/budgets), admin-write-only via rules.
const getBudgets = () => _budgetsCache;
function setBudgets(list) {
  _budgetsCache = list;
  DB.s('pos_budgets', list);
  try { _fbReady && _db.collection('pos_data').doc('budgets').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

// POS CASH SESSIONS (shifts) — { id, branchId, cashier, openedAt, openingCash,
// closedAt, closingCashCounted, status:'open'|'closed', expectedCash, variance }.
// Synced through Firestore (pos_data/sessions).
const getSessions = () => _sessionsCache;
function setSessions(list) {
  _sessionsCache = list;
  DB.s('pos_sessions', list);
  try { _fbReady && _db.collection('pos_data').doc('sessions').set({ list, updatedAt: Date.now() }); } catch(e) {}
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
// True ONLY for the hardcoded owner account (OWNER_EMAIL) — an 'admin'-
// labeled staff account created from "المستخدمين والصلاحيات" is currentUser
// === 'admin' too (keeps every existing admin-only UI check working) but is
// NOT isRealOwner, so it's governed by its own permissions matrix instead of
// bypassing everything. Set in _enterSessionByRole()/_legacyLogin() (the
// single hardcoded local 'admin' fallback also counts, since it predates
// the multi-admin concept and has no cloud access to protect either way).
let isRealOwner = false;
let cart = [];
let payMethod = 'cash';

// السلة كانت موجودة في الذاكرة بس (متغير JS عادي) — أي ريفريش عرضي (أو
// PWA مسطّبة اتقفلت من النظام وفتحت تاني) كان بيمسحها بالكامل حتى لو فيها
// فاتورة نص مكتوبة، من غير أي تحذير. بتتحفظ دلوقتي لكل فرع لوحده (جهاز ممكن
// يشتغل كذا فرع بمرور الوقت) وترجع تلقائي أول ما الجلسة تبدأ. مش بديل عن
// "تعليق الفاتورة" الرسمي — ده بس بيمنع ضياع السلة بسبب حادثة تقنية.
function _persistCart() {
  DB.s(`pos_cart_${currentBranch}`, {
    items: cart,
    adminDiscount: cart._adminDiscount || 0,
    adminDiscountNote: cart._adminDiscountNote || '',
    appliedPromos: cart._appliedPromos || [],
    // لو الفاتورة دي جاية من "استئناف فاتورة معتمدة" (96-approvals.js) —
    // من غير الحفظ ده، ريفريش عرضي وسط الدفع كان هيرجّع الفاتورة صح بس
    // يضيع الربط بطلب الاعتماد، فـ completeSale() ما كانتش هتعرف تحطه
    // 'consumed'، وكان يفضل معلّق للأبد كأنه لسه مستني رغم إنه اتباع فعلاً.
    fromApprovalId: cart._fromApprovalId || null,
  });
}
function _restoreCart() {
  const saved = DB.g(`pos_cart_${currentBranch}`, null);
  if (!saved || !Array.isArray(saved.items) || !saved.items.length) return;
  // بتترجع دايماً على أول دخول للجلسة — يعني قبل ما initFirebase() يجيب
  // المخزون (بيتنادى بعد السطر ده في كل نقاط الدخول). لو فلترنا هنا على
  // مخزون لسه فاضي، هنمسح الفاتورة كلها ونحفظ النسخة الفاضية دي فوراً
  // (renderCart بيعمل _persistCart أول حاجة) — يعني نضيع الفاتورة الأصلية
  // نهائياً بدل ما نحميها. فلترة "الأصناف الملغاة" بتتعمل بس لو المخزون
  // فعلاً وصل، وإلا بترجع الفاتورة زي ما هي وتتنضف من نفسها أول ما
  // المستخدم يلمسها (تعديل كمية، دفع، ...إلخ).
  const inv = getInv();
  cart = inv.length ? saved.items.filter(i => inv.some(p => p.code === i.code)) : saved.items.slice();
  cart._adminDiscount = saved.adminDiscount || 0;
  cart._adminDiscountNote = saved.adminDiscountNote || '';
  cart._appliedPromos = saved.appliedPromos || [];
  if (saved.fromApprovalId) cart._fromApprovalId = saved.fromApprovalId;
}
let chartWeekly = null, chartTop = null, chartRptSales = null, chartProfit = null;
let chartTrend = null, chartBranches = null, chartCmpTrend = null, chartCmpBranches = null;
let _dashRange = 30; // default 30 days
let lastSaleForPrint = null;

