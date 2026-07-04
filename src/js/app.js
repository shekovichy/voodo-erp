
// ══════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════
const DB = {
  g: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  s: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
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
let cart = [];
let payMethod = 'cash';
let chartWeekly = null, chartTop = null, chartRptSales = null, chartProfit = null;
let chartTrend = null, chartBranches = null, chartCmpTrend = null, chartCmpBranches = null;
let _dashRange = 30; // default 30 days
let lastSaleForPrint = null;

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════
const fmt = (n) => (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function showMsg(id, msg, type='success') {
  const el = document.getElementById(id);
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  setTimeout(() => el.innerHTML = '', 3500);
}

function getDateRange(period, fromId, toId) {
  const now = new Date();
  let from, to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (period === 'today')  { from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
  else if (period === 'week')  { from = new Date(now); from.setDate(from.getDate()-6); from.setHours(0,0,0,0); }
  else if (period === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); }
  else if (period === 'year')  { from = new Date(now.getFullYear(), 0, 1); }
  else if (period === 'custom' && fromId && toId) {
    const f = document.getElementById(fromId)?.value;
    const t = document.getElementById(toId)?.value;
    from = f ? new Date(f) : new Date(0);
    to   = t ? new Date(t + 'T23:59:59') : new Date();
  }
  return { from: from || new Date(0), to };
}

// ══════════════════════════════════════════════
// LOGIN / LOGOUT
// ══════════════════════════════════════════════
async function doLogin() {
  const user = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const users = getUsers();
  const branchUsers = getBranchUsers();
  document.getElementById('loginError').classList.add('hidden');
  if (!pass) { document.getElementById('loginError').textContent = 'أدخل كلمة المرور'; document.getElementById('loginError').classList.remove('hidden'); return; }

  // First-run: no admin password set yet → show setup
  if (!users.admin) {
    showFirstRunSetup();
    return;
  }

  if (user === 'admin' && await checkPass(pass, users.admin)) {
    await upgradePassIfNeeded(pass, users.admin, 'admin');
    currentUser = 'admin';
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('managerView').classList.remove('hidden');
    document.getElementById('todayDate').textContent =
      new Date().toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    document.getElementById('sLowThreshold').value = getThreshold();
    initFirebase();   // ← يشغّل Firebase عند دخول الأدمن
    initBranchUI();
    document.getElementById('topbarLogout').style.display = 'inline-flex';
    showPage('home');
    setTimeout(() => addAuditLog('auth.login', 'تسجيل دخول: admin', currentBranch), 500);
  } else if (user === 'cashier' && pass === users.cashier) {
    // Legacy cashier (all branches)
    currentUser = 'cashier';
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('cashierView').classList.remove('hidden');
    initFirebase();
    applyMobileUI();
    renderProducts();
    updateClock();
    setInterval(updateClock, 30000);
    setTimeout(function(){ checkForApprovedCarts(); }, 1000);
  } else {
    // Branch-specific cashier login
    const branchUsers = getBranchUsers();
    let matchedBranch = null;
    for (const b of BRANCH_IDS) {
      if (branchUsers[b] &&
          user === (branchUsers[b].username || '').toLowerCase() &&
          await checkPass(pass, branchUsers[b].password)) {
        matchedBranch = b; break;
      }
    }
    if (matchedBranch) {
      currentUser = 'cashier';
      currentBranch = matchedBranch;
      DB.s('currentBranch', matchedBranch);
      document.getElementById('loginPage').classList.add('hidden');
      if (matchedBranch === 'wh') {
        // Warehouse-only mode: restricted to warehouse & transfers pages
        window._whMode = true;
        document.body.classList.add('warehouse-mode');
        document.getElementById('managerView').classList.remove('hidden');
        document.getElementById('topbarLogout').style.display = 'inline-flex';
        initFirebase();
        showPage('warehouse');
        setTimeout(() => addAuditLog('auth.login', `تسجيل دخول مخزن: ${user}`, matchedBranch), 500);
      } else {
        document.getElementById('cashierView').classList.remove('hidden');
        initFirebase();
        applyMobileUI();
        renderProducts();
        updateClock();
        setInterval(updateClock, 30000);
        setTimeout(() => addAuditLog('auth.login', `تسجيل دخول كاشير: ${user} — ${getBranchName(matchedBranch)}`, matchedBranch), 500);
      }
    } else {
      document.getElementById('loginError').classList.remove('hidden');
    }
  }
}


// ── EXPORT REPORTS — Excel & PDF ────────────────────────────
function exportReportExcel(type) {
  const wb = XLSX.utils.book_new();
  let ws, sheetName;

  if (type === 'sales') {
    // Build data from sales breakdown table
    const rows = [['المنتج','الكمية المباعة','الإيراد (ج.م)']];
    document.querySelectorAll('#rs-breakdown tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      if (cells.length) rows.push(cells);
    });
    // Add summary at top
    const summary = [
      ['إجمالي المبيعات', document.getElementById('rs-total')?.textContent || ''],
      ['صافي الإيرادات',  document.getElementById('rs-net')?.textContent || ''],
      ['عدد الفواتير',    document.getElementById('rs-count')?.textContent || ''],
      ['متوسط الفاتورة',  document.getElementById('rs-avg')?.textContent || ''],
      [],
      ...rows
    ];
    ws = XLSX.utils.aoa_to_sheet(summary);
    sheetName = 'تقرير المبيعات';
  } else if (type === 'profit') {
    const rows = [['المنتج','الكمية','الإيراد','التكلفة','الربح','هامش%']];
    document.querySelectorAll('#rp-breakdown tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      if (cells.length) rows.push(cells);
    });
    const summary = [
      ['إجمالي الإيرادات', document.getElementById('rp-revenue')?.textContent || ''],
      ['إجمالي التكلفة',   document.getElementById('rp-cost')?.textContent || ''],
      ['صافي الربح',       document.getElementById('rp-profit')?.textContent || ''],
      ['هامش الربح',       document.getElementById('rp-margin')?.textContent || ''],
      ['إجمالي الخصومات', document.getElementById('rp-discounts')?.textContent || ''],
      [],
      ...rows
    ];
    ws = XLSX.utils.aoa_to_sheet(summary);
    sheetName = 'تقرير الأرباح';
  }

  if (!ws) { showToast('⚠️ لا توجد بيانات للتصدير'); return; }

  // Style column widths
  ws['!cols'] = [{wch:30},{wch:15},{wch:15},{wch:15},{wch:15},{wch:10}];

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const date = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, sheetName + '_' + date + '.xlsx');
  showToast('✅ تم تصدير ' + sheetName + ' كـ Excel');
}

function exportReportPDF(sectionId, title) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  // Open print dialog with just this section
  const printWin = window.open('', '_blank', 'width=900,height=700');
  const styles = [...document.styleSheets].map(ss => {
    try { return [...ss.cssRules].map(r => r.cssText).join('\n'); }
    catch(e) { return ''; }
  }).join('\n');

  printWin.document.write(`<!DOCTYPE html><html dir="rtl"><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; direction: rtl; padding: 20px; color: #1a2b4a; }
      h1 { color: #1a5faf; font-size: 20px; margin-bottom: 16px; border-bottom: 2px solid #1a5faf; padding-bottom: 8px; }
      .print-date { font-size: 12px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { background: #1a5faf; color: white; padding: 8px 10px; text-align: right; }
      td { padding: 7px 10px; border-bottom: 1px solid #e0e0e0; }
      tr:nth-child(even) td { background: #f5f8ff; }
      .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
      .stat-card { background: #f0f5ff; border-radius: 8px; padding: 12px; border: 1px solid #c0d4f5; }
      .stat-label { font-size: 11px; color: #666; }
      .stat-value { font-size: 20px; font-weight: 800; color: #1a5faf; margin-top: 4px; }
      .btn { display: none; }
      @media print { button { display: none; } }
    </style>
  </head><body>
    <h1>${title}</h1>
    <div class="print-date">📅 تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
    ${section.innerHTML}
  </body></html>`);

  printWin.document.close();
  setTimeout(() => { printWin.print(); printWin.close(); }, 800);
}


// ── GOOGLE DRIVE BACKUP ─────────────────────────────────────
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let _gdriveToken = null;

function getGdriveClientId() { return DB.g('gdriveClientId', ''); }

function saveGdriveClientId() {
  const val = document.getElementById('gdriveClientIdInput').value.trim();
  if (!val) { showToast('⚠️ أدخل الـ Client ID أولاً'); return; }
  DB.s('gdriveClientId', val);
  showToast('✅ تم حفظ الـ Client ID');
  initGoogleDriveUI();
}

function initGoogleDriveUI() {
  const clientId = getGdriveClientId();
  const connectBtn = document.getElementById('gdriveConnectBtn');
  const backupBtn  = document.getElementById('gdriveBackupBtn');
  const setupBox   = document.getElementById('gdriveSetupBox');
  const autoToggle = document.getElementById('autoBackupToggle');
  if (setupBox) {
    setupBox.style.display = clientId ? 'none' : 'block';
    const inp = document.getElementById('gdriveClientIdInput');
    if (inp && clientId) inp.value = clientId;
  }
  if (connectBtn) connectBtn.style.display = (clientId && !_gdriveToken) ? 'flex' : 'none';
  if (backupBtn)  backupBtn.style.display  = _gdriveToken ? 'flex' : 'none';
  if (autoToggle) autoToggle.checked = DB.g('autoBackupEnabled', false);
  const statusEl = document.getElementById('gdriveStatus');
  if (statusEl) statusEl.textContent = _gdriveToken ? '✅ متصل بـ Google Drive' : '';
}

function connectGoogleDrive() {
  const clientId = getGdriveClientId();
  if (!clientId) { showToast('⚠️ أدخل الـ Client ID أولاً'); return; }
  const redirect = window.location.origin;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirect) + '&response_type=token' +
    '&scope=' + encodeURIComponent(GDRIVE_SCOPE) + '&prompt=select_account';
  const popup = window.open(url, 'gdrive_auth', 'width=500,height=600,left=300,top=100');
  const timer = setInterval(() => {
    try {
      if (!popup || popup.closed) { clearInterval(timer); return; }
      const hash = popup.location.hash;
      if (hash && hash.includes('access_token')) {
        clearInterval(timer); popup.close();
        const params = new URLSearchParams(hash.slice(1));
        _gdriveToken = params.get('access_token');
        initGoogleDriveUI();
        showToast('✅ تم الربط مع Google Drive!');
        if (DB.g('autoBackupEnabled', false)) checkAutoBackup(true);
      }
    } catch(e) {}
  }, 500);
}

async function backupToGoogleDrive(silent) {
  if (!_gdriveToken) { if (!silent) showToast('⚠️ ارتبط بـ Google Drive أولاً'); return false; }
  const backup = {
    version:2, date:new Date().toISOString(), branch:currentBranch,
    inv:DB.g('pos_inv_'+currentBranch,[]), sales:DB.g('pos_sales',[]),
    customers:DB.g('pos_customers',[]), expenses:DB.g('pos_expenses',[]),
    sellers:DB.g('pos_sellers',[]), branchNames:DB.g('pos_branch_names',{}),
    purchases:DB.g('pos_purchases',[]), suppliers:DB.g('pos_suppliers',[]),
  };
  const fileName = 'VoodoERP_Backup_' + new Date().toISOString().slice(0,10) + '.json';
  const blob = new Blob([JSON.stringify(backup,null,2)], {type:'application/json'});
  try {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({name:fileName,mimeType:'application/json'})],{type:'application/json'}));
    form.append('file', blob);
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method:'POST', headers:{Authorization:'Bearer '+_gdriveToken}, body:form
    });
    if (!res.ok) {
      const err = await res.json();
      if (err.error && err.error.code===401) { _gdriveToken=null; if(!silent) showToast('⚠️ انتهت صلاحية الربط — أعد الاتصال'); initGoogleDriveUI(); return false; }
      throw new Error((err.error && err.error.message) || 'Upload failed');
    }
    DB.s('lastDriveBackup', new Date().toISOString());
    if (!silent) showToast('☁️ تم رفع النسخة على Google Drive!');
    renderLastBackupInfo(); return true;
  } catch(err) { if (!silent) showToast('❌ فشل الرفع: '+err.message); return false; }
}

function toggleAutoBackup(enabled) {
  DB.s('autoBackupEnabled', enabled);
  showToast(enabled ? '✅ تم تفعيل النسخ التلقائي' : '⏹️ تم إيقاف النسخ التلقائي');
}

async function checkAutoBackup(force) {
  if (!DB.g('autoBackupEnabled',false) && !force) return;
  const last = DB.g('lastDriveBackup','');
  const today = new Date().toISOString().slice(0,10);
  if (!force && last && last.startsWith(today)) return;
  if (_gdriveToken) {
    const ok = await backupToGoogleDrive(true);
    if (ok) showToast('☁️ تم النسخ الاحتياطي التلقائي على Drive');
  }
}
setTimeout(() => checkAutoBackup(false), 5000);


function logout() {
  if (!confirm('هل تريد تسجيل الخروج؟')) return;
  currentUser = null; cart = [];
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('cashierView').classList.add('hidden');
  document.getElementById('managerView').classList.add('hidden');
  window._whMode = false;
  document.body.classList.remove('warehouse-mode');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
}

// ── DARK MODE ────────────────────────────────
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  applyTheme(newTheme);
  DB.s('theme', newTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('darkModeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Apply saved theme on load
(function() {
  const saved = DB.g ? DB.g('theme', 'light') : (localStorage.getItem('pos_theme') || 'light');
  applyTheme(saved);
})();


// ── MOBILE HELPERS ──────────────────────────
function isMobile() { return window.innerWidth <= 768; }

function toggleMobileCart(open) {
  if (!isMobile()) return;
  document.getElementById('cashierView').querySelector('.cart-panel').classList.toggle('open', open);
  document.getElementById('cartBackdrop').classList.toggle('open', open);
}

function applyMobileUI() {
  const mobile = isMobile();
  // Cart close button
  const cb = document.getElementById('cartCloseBtn');
  if (cb) cb.style.display = mobile ? 'flex' : 'none';
  // Manager topbar logout button — always shown after login, don't touch here
  // FAB
  const fab = document.getElementById('cartFab');
  if (fab) fab.style.display = mobile ? 'flex' : 'none';
}

window.addEventListener('resize', applyMobileUI);
// ── PRE-INIT: load passwords from Firebase before showing login ──
async function preInitFirebase() {
  const overlay = document.getElementById('appLoadingOverlay');
  try {
    if (!FIREBASE_CONFIG.projectId) { if(overlay) overlay.style.display='none'; return; }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();
    // fetch auth doc with a short timeout (3s)
    // Must sign in anonymously first — Firestore rules require auth
    await Promise.race([
      firebase.auth().signInAnonymously(),
      new Promise((_,reject) => setTimeout(() => reject(new Error('auth timeout')), 5000))
    ]);
    // Now fetch passwords
    const snap = await Promise.race([
      db.collection('pos_data').doc('auth').get(),
      new Promise((_,reject) => setTimeout(() => reject(new Error('read timeout')), 4000))
    ]);
    if (snap.exists) {
      const data = snap.data();
      const localU = DB.g('users', { admin: '', cashier: '' });
      if (data.users && !localU.admin) DB.s('users', data.users);
      const localBU = DB.g('pos_branch_users', null);
      if (data.branchUsers && !localBU) DB.s('pos_branch_users', data.branchUsers);
    }
  } catch(e) {
    console.warn('preInitFirebase failed:', e);
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}
preInitFirebase();

document.addEventListener('DOMContentLoaded', applyMobileUI);

// ── CLOCK ────────────────────────────────────
function updateClock() {
  document.getElementById('cartClock').textContent = new Date().toLocaleString('ar-EG');
}

// ══════════════════════════════════════════════
// CASHIER – PRODUCTS
// ══════════════════════════════════════════════
function renderProducts() {
  // Block POS sales from warehouse
  if (currentBranch === 'wh') {
    const grid = document.getElementById('productsGrid');
    if (grid) {
      grid.innerHTML = '';
      var msg = document.createElement('div');
      msg.style.cssText = 'grid-column:1/-1;text-align:center;padding:60px 20px;';
      msg.innerHTML = '<div style="font-size:48px;">🏭</div><h3 style="font-size:18px;font-weight:700;margin:12px 0 6px;">المخزن الرئيسي</h3><p style="color:var(--text-muted);font-size:14px;">لا يمكن البيع من المخزن الرئيسي<br>الرجاء التحويل لأحد الفروع أولاً</p>';
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.style.marginTop = '16px';
      btn.textContent = '🏭 الذهاب للمخزن';
      btn.onclick = function(){ showPage('warehouse'); };
      msg.appendChild(btn);
      grid.appendChild(msg);
    }
    return;
  }
  const q = document.getElementById('productSearch').value.trim().toLowerCase();
  const inv = getInv();
  const items = q ? inv.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) : inv;
  const grid = document.getElementById('productsGrid');
  if (!items.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted);">' +
      (inv.length ? 'لم يُعثر على نتائج' : '📦 لا توجد منتجات — استورد ملف Excel من لوحة الإدارة') + '</div>';
    return;
  }
  grid.innerHTML = items.map(p => {
    const oos = p.qty <= 0;
    return `<div class="product-card ${oos ? 'out-of-stock' : ''}" onclick="${oos ? '' : `addToCart('${p.code}')`}">
      <div class="product-code">${p.code}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">${fmt(p.priceAfter)} ج</div>
      ${p.priceBefore > p.priceAfter && p.priceBefore ? `<div class="product-old-price">${fmt(p.priceBefore)}</div>` : ''}
      <div class="product-stock">${oos ? '❌ نفد' : `📦 ${p.qty}`}</div>
    </div>`;
  }).join('');
}

function handleSearchKey(e) {
  if (e.key !== 'Enter') return;
  const q = document.getElementById('productSearch').value.trim();
  const inv = getInv();
  const found = inv.find(p => p.code.toLowerCase() === q.toLowerCase());
  if (found && found.qty > 0) {
    addToCart(found.code);
    document.getElementById('productSearch').value = '';
    renderProducts();
  }
}

// ══════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════
function addToCart(code) {
  const inv = getInv();
  const p = inv.find(x => x.code === code);
  if (!p || p.qty <= 0) return;
  const ex = cart.find(x => x.code === code);
  if (ex) {
    if (ex.qty >= p.qty) { alert('لا يوجد مخزون كافٍ'); return; }
    ex.qty++;
  } else {
    cart.push({ code: p.code, name: p.name, price: p.priceAfter, cost: p.cost || 0, qty: 1 });
  }
  renderCart();
}

function changeQty(code, d) {
  const item = cart.find(x => x.code === code);
  if (!item) return;
  const inv = getInv();
  const p = inv.find(x => x.code === code);
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(x => x.code !== code);
  else if (p && item.qty > p.qty) { item.qty = p.qty; alert('لا يوجد مخزون كافٍ'); }
  renderCart();
}

function removeFromCart(code) { cart = cart.filter(x => x.code !== code); renderCart(); }

function clearCart() {
  if (cart.length && !confirm('مسح الفاتورة؟')) return;
  cart = [];
  cart._adminDiscount = 0;
  cart._adminDiscountNote = '';
  cart._appliedPromos = [];
  document.getElementById('adminDiscountRow').classList.add('hidden');
  const aprEl = document.getElementById('promoAppliedRows'); if (aprEl) aprEl.innerHTML = '';
  const pesEl = document.getElementById('promoEligibleSection'); if (pesEl) pesEl.innerHTML = '';
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cartItems');
  if (!cart.length) { el.innerHTML = '<div class="cart-empty">أضف منتجات للفاتورة</div>'; updateCartUI(); return; }
  el.innerHTML = cart.map(i => {
    const modified = i.priceModified;
    const priceHtml = modified
      ? `<span style="text-decoration:line-through;color:#9ca3af;font-size:11px;">${fmt(i.originalPrice)} ج</span> <span style="color:#dc2626;font-weight:700;">${fmt(i.price)} ج</span> × ${i.qty}`
      : `${fmt(i.price)} ج × ${i.qty}`;
    return `<div class="cart-item" style="${modified?'background:#fff5f5;border-right:3px solid #ef4444;':''}">
      <div class="cart-item-info">
        <div class="cart-item-name">${i.name}</div>
        <div class="cart-item-price">${priceHtml}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty('${i.code}',-1)">−</button>
        <span class="qty-num">${i.qty}</span>
        <button class="qty-btn" onclick="changeQty('${i.code}',1)">+</button>
      </div>
      <button onclick="editItemPrice('${i.code}')" style="background:${modified?'#fef3c7':'#f3f4f6'};border:none;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:12px;" title="تعديل السعر">✏️</button>
      <div class="item-total">${fmt(i.price*i.qty)}</div>
      <button class="delete-item" onclick="removeFromCart('${i.code}')">✕</button>
    </div>`;
  }).join('');
  updateCartUI();
}

function cartTotals() {
  const sub       = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const adminDisc = Math.min(Math.max(cart._adminDiscount || 0, 0), sub);
  const promoDisc = (cart._appliedPromos || []).reduce((s,p) => s + p.discAmt, 0);
  const totalDisc = Math.min(adminDisc + promoDisc, sub);
  return { sub, adminDisc, promoDisc, disc: totalDisc, total: sub - totalDisc };
}

function updateCartUI() {
  const { sub, adminDisc, promoDisc, total } = cartTotals();
  const count = cart.reduce((s,i) => s+i.qty, 0);
  document.getElementById('cartCount').textContent    = count;
  document.getElementById('cartSubtotal').textContent = fmt(sub) + ' ج';
  document.getElementById('cartTotal').textContent    = fmt(total) + ' ج';
  // Show/hide admin discount row
  const adRow = document.getElementById('adminDiscountRow');
  const adEl  = document.getElementById('cartAdminDiscountDisplay');
  if (adminDisc > 0 && adRow && adEl) {
    adRow.classList.remove('hidden');
    adEl.textContent = '-' + fmt(adminDisc) + ' ج';
  } else if (adRow) {
    adRow.classList.add('hidden');
  }
  // Render applied promo rows
  const aprEl = document.getElementById('promoAppliedRows');
  if (aprEl) {
    aprEl.innerHTML = (cart._appliedPromos || []).map(p => `
      <div class="cart-row" style="color:#7c3aed; background:#f5f3ff; padding:5px 8px; border-radius:6px; margin:2px 0; align-items:center;">
        <span style="display:flex; align-items:center; gap:4px;">
          🏷️ ${p.name}
          <button onclick="removeAppliedPromo('${p.id}')" style="background:none; border:none; cursor:pointer; color:#ef4444; font-size:12px; padding:0 2px;" title="إزالة العرض">✕</button>
        </span>
        <span>-${fmt(p.discAmt)} ج</span>
      </div>`).join('');
  }
  // Render eligible (not yet applied) promos
  renderEligiblePromos();
  // Sync FAB badge
  const fc = document.getElementById('fabCount');
  if (fc) fc.textContent = count;
  // Change pay button if any prices modified
  const hasModified = cart.some(function(i){ return i.priceModified; });
  const payBtn = document.getElementById('cartPayBtn');
  if (payBtn) {
    if (hasModified) {
      payBtn.textContent = '📤 إرسال للموافقة';
      payBtn.style.background = '#d97706';
      payBtn.onclick = sendForApproval;
    } else {
      payBtn.textContent = '💳 دفع';
      payBtn.style.background = '';
      payBtn.onclick = openPayment;
    }
  }
}

// ══════════════════════════════════════════════
// PAYMENT
// ══════════════════════════════════════════════
function openPayment() {
  if (!cart.length) { alert('الفاتورة فارغة'); return; }
  const { total } = cartTotals();
  document.getElementById('modalTotal').textContent = fmt(total) + ' ج';
  document.getElementById('paidAmount').value = '';
  document.getElementById('changeAmt').textContent = '0.00 ج';
  // Populate salesperson dropdown
  const sel = document.getElementById('paymentSalesperson');
  const people = getSalespeople();
  sel.innerHTML = people.map(n => `<option value="${n}">${n}</option>`).join('');
  if (window._lastSalesperson && people.includes(window._lastSalesperson)) sel.value = window._lastSalesperson;
  clearSelectedCustomer();
  setPayMethod('cash');
  document.getElementById('paymentModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('paidAmount').focus(), 100);
}

function setPayMethod(m) {
  payMethod = m;
  document.getElementById('btnCash').className = 'btn ' + (m === 'cash' ? 'btn-success' : 'btn-gray');
  document.getElementById('btnCard').className = 'btn ' + (m === 'card' ? 'btn-primary' : 'btn-gray');
  document.getElementById('cashSection').style.display = m === 'cash' ? 'block' : 'none';
}

function calcChange() {
  const { total } = cartTotals();
  const paid = parseFloat(document.getElementById('paidAmount').value) || 0;
  const change = paid - total;
  const el = document.getElementById('changeAmt');
  el.textContent = fmt(Math.max(0, change)) + ' ج';
  el.style.color = change >= 0 ? 'var(--success)' : 'var(--danger)';
}

function completeSale() {
  const { sub, disc, total } = cartTotals();
  let paid = total, change = 0;
  if (payMethod === 'cash') {
    paid = parseFloat(document.getElementById('paidAmount').value) || 0;
    if (paid < total) { alert('المبلغ المدفوع أقل من الإجمالي'); return; }
    change = paid - total;
  }

  // Deduct stock
  const inv = getInv();
  cart.forEach(ci => { const p = inv.find(x => x.code === ci.code); if (p) p.qty -= ci.qty; });
  setInv(inv);

  // Save sale
  const salesperson = document.getElementById('paymentSalesperson')?.value || '';
  window._lastSalesperson = salesperson; // remember for next invoice
  const _saleCustomerId = document.getElementById('selectedCustomerId')?.value || '';
  const sale = {
    id: Date.now(),
    date: new Date().toISOString(),
    cashier: currentUser === 'admin' ? 'مدير' : 'كاشير',
    salesperson,
    items: cart.map(i => ({...i})),
    sub, disc, total, paid, change, payMethod,
    appliedPromos: cart._appliedPromos || [],
    branchId: currentBranch,
    branchName: getBranchName(currentBranch)
  };
  addSale(sale);
  if (sale.customerId) awardLoyaltyPoints(sale.customerId, sale.total);
  _lastSale = sale; // for WhatsApp sharing
  addAuditLog('sale.complete', `فاتورة #${String(sale.id||'').slice(-6)} — ${fmt(sale.total)} ج — ${sale.items.length} صنف`, sale.branchId);

  updateCustomerAfterSale(_saleCustomerId, total);
  clearSelectedCustomer();
  document.getElementById('paymentModal').classList.add('hidden');
  toggleMobileCart(false); // close cart sheet on mobile after sale
  lastSaleForPrint = sale;
  showReceipt(sale);
  cart = [];
  cart._adminDiscount = 0;
  cart._adminDiscountNote = '';
  cart._appliedPromos = [];
  document.getElementById('adminDiscountRow').classList.add('hidden');
  const _aprEl = document.getElementById('promoAppliedRows'); if (_aprEl) _aprEl.innerHTML = '';
  const _pesEl = document.getElementById('promoEligibleSection'); if (_pesEl) _pesEl.innerHTML = '';
  renderCart(); renderProducts();
}

// ══════════════════════════════════════════════
// RECEIPT
// ══════════════════════════════════════════════
function showReceipt(sale) {
  lastSaleForPrint = sale;
  const lines = sale.items.map(i =>
    `<div style="display:flex;justify-content:space-between;">
      <span>${i.name} × ${i.qty}</span><span>${fmt(i.price*i.qty)} ج</span>
    </div>`).join('');
  document.getElementById('receiptContent').innerHTML = `
    <div style="text-align:center;margin-bottom:10px;">
      <div style="display:inline-block;background:#1a5faf;padding:8px 18px;border-radius:6px;margin-bottom:6px;">
        <div style="font-family:'Jost',Arial,sans-serif;color:white;font-size:14px;font-weight:700;letter-spacing:3px;">VOODO</div>
        <div style="font-family:'Jost',Arial,sans-serif;color:white;font-size:8px;font-weight:300;letter-spacing:6px;">HOME</div>
      </div>
      <div style="font-size:13px;font-weight:700;margin-top:4px;">فاتورة مبيعات</div>
      <div style="font-size:11px;color:gray;">${new Date(sale.date).toLocaleString('ar-EG')}</div>
      <div style="font-size:11px;color:gray;">رقم: ${String(sale.id).slice(-8)}</div>
      ${sale.salesperson ? `<div style="font-size:11px;color:gray;">البائع: ${sale.salesperson}</div>` : ''}
    </div>
    <hr style="border:1px dashed #ccc;margin:8px 0;">
    ${lines}
    <hr style="border:1px dashed #ccc;margin:8px 0;">
    <div style="display:flex;justify-content:space-between;"><span>المجموع</span><span>${fmt(sale.sub)} ج</span></div>
    ${sale.disc > 0 ? `<div style="display:flex;justify-content:space-between;color:green;"><span>خصم</span><span>-${fmt(sale.disc)} ج</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px;margin-top:4px;border-top:1px solid #ccc;padding-top:4px;">
      <span>الإجمالي</span><span>${fmt(sale.total)} ج</span>
    </div>
    ${sale.payMethod === 'cash' ? `
    <div style="display:flex;justify-content:space-between;color:#2563eb;margin-top:4px;"><span>مدفوع</span><span>${fmt(sale.paid)} ج</span></div>
    <div style="display:flex;justify-content:space-between;color:green;font-weight:700;"><span>الباقي</span><span>${fmt(sale.change)} ج</span></div>
    ` : '<div style="text-align:center;color:#2563eb;margin-top:6px;">💳 دفع بالكارت</div>'}
    <div style="text-align:center;margin-top:12px;font-size:12px;color:gray;">شكراً لتعاملكم معنا 🙏</div>`;
  document.getElementById('receiptModal').classList.remove('hidden');
}

function printReceipt() {
  const html = document.getElementById('receiptContent').innerHTML;
  const w = window.open('','_blank','width=400,height=600');
  w.document.write('<html dir="rtl"><head><style>body{font-family:monospace;direction:rtl;padding:20px;font-size:13px;}</style></head><body>' + html + '</body></html>');
  w.document.close(); w.print();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// ══════════════════════════════════════════════
// MANAGER PAGES
// ══════════════════════════════════════════════
function showPage(page) {
  if (window._whMode && !['warehouse','transfers'].includes(page)) return;
  ['home','dashboard','inventory','sales','suspended','reports','customized','warehouse','settings','customers','promos','transfers','purchases','hr','expenses','audit','accounting'].forEach(p => {
    document.getElementById('page-'+p)?.classList.add('hidden');
  });
  document.getElementById('page-'+page).classList.remove('hidden');
  var content = document.querySelector('.main-content');
  if (content) content.classList.toggle('home-mode', page === 'home');
  if (page === 'home') { updateHomeClock(); updateSuspendedBadge(); }
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'الرئيسية', inventory:'إدارة المخزون', sales:'سجل المبيعات', suspended:'فواتير معلقة', reports:'التقارير', customized:'تقارير مخصصة', home:'الرئيسية', warehouse:'المخزن الرئيسي', settings:'الإعدادات', customers:'العملاء', purchases:'المشتريات', hr:'الموارد البشرية', expenses:'المصاريف', audit:'سجل التغييرات', accounting:'المحاسبة الرسمية' };
  document.getElementById('pageTitle').textContent = titles[page] || '';
  if (page === 'dashboard')  buildDashboard();
  if (page === 'inventory')  renderInventory();
  if (page === 'sales')      { initSalesFilter(); renderSales(); }
  if (page === 'reports')    { buildSalesReport(); setTimeout(()=>showVLTab('catreport'),100); }
  if (page === 'suspended')  renderSuspendedPage();
  if (page === 'settings')   { renderSellersSettings(); renderLastBackupInfo(); initGoogleDriveUI(); document.getElementById('sVipThreshold').value = _settingsCache.vipThreshold || 1000; populateBranchNameInputs(); renderBranchUsersSettings(); }
  if (page === 'customers')  renderCustomers();
  if (page === 'promos')     renderPromosPage();
  if (page === 'transfers')  renderTransfersPage();
  if (page === 'purchases')  renderPurchasesPage();
  if (page === 'hr')         renderHRPage();
  if (page === 'accounting') renderAccountingPage();
  if (page === 'customized') renderCustomizedPage();
  if (page === 'suspended') {
    renderSuspendedPage();
    // Show approvals tab for admin if there are pending requests
    if (currentUser === 'admin') {
      var pendingCount = getApprovals().filter(function(r){ return r.status==='pending'; }).length;
      var badge = document.getElementById('suspApprovalsCount');
      if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount?'inline':'none'; }
      document.getElementById('suspTab_approvals').style.display = currentUser==='admin' ? '' : 'none';
    } else {
      var t = document.getElementById('suspTab_approvals');
      if (t) t.style.display = 'none';
    }
  }
  if (page === 'warehouse')  renderWarehousePage();
  if (page === 'expenses')   renderExpensesPage();
  if (page === 'audit')      renderAuditPage();
}

// ══════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════
function setDashRange(days) {
  _dashRange = days;
  // Update button styles
  [7,30,90,365].forEach(d => {
    const btn = document.getElementById('dbr-'+d);
    if (!btn) return;
    btn.className = d === days ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    btn.style.fontSize = '11px'; btn.style.padding = '3px 10px';
  });
  buildDashboard();
}

// Helper: calc profit from a sales array
function calcProfit(salesArr, inv) {
  return salesArr.reduce((acc, s) => {
    return acc + s.items.reduce((a, i) => {
      const cost = i.cost > 0 ? i.cost : (inv.find(x => x.code === i.code)?.cost || 0);
      return a + (i.price - cost) * i.qty;
    }, 0) - (s.disc || 0);
  }, 0);
}

// Helper: delta badge HTML
function deltaBadge(curr, prev, isPercent) {
  if (prev === 0) return '<span style="color:#94a3b8; font-size:11px;">لا يوجد مقارنة</span>';
  const pct = Math.round((curr - prev) / Math.abs(prev) * 100);
  const up = pct >= 0;
  const arrow = up ? '▲' : '▼';
  const color = up ? '#16a34a' : '#dc2626';
  const label = isPercent ? `${curr > 0 ? '+' : ''}${pct}%` : `${arrow} ${Math.abs(pct)}%`;
  return `<span style="color:${color}; font-size:12px; font-weight:700;">${arrow} ${Math.abs(pct)}%</span>
          <span style="color:#94a3b8; font-size:10px; margin-right:4px;">vs السابق</span>`;
}

function buildDashboard() {
  // Populate branch filter dropdown
  const dbf = document.getElementById('dashBranchFilter');
  if (dbf && dbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!dbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        dbf.appendChild(o);
      }
    });
  }
  const branchFilter = dbf?.value || 'all';

  const allSales = getSales().filter(s => !s.isReturn);
  const sales = branchFilter === 'all' ? allSales : allSales.filter(s => s.branchId === branchFilter);
  const inv   = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  const thresh = getThreshold();

  // ── Date range filter ──
  const now = new Date();
  const rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate() - _dashRange + 1); rangeStart.setHours(0,0,0,0);
  const prevStart  = new Date(rangeStart); prevStart.setDate(prevStart.getDate() - _dashRange);
  const prevEnd    = new Date(rangeStart); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23,59,59,999);

  const today = now.toDateString();
  const thisMonth = now.toISOString().slice(0,7);

  // Get prev month
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0,7);

  const todaySales  = sales.filter(s => new Date(s.date).toDateString() === today);
  const rangeSales  = sales.filter(s => { const d = new Date(s.date); return d >= rangeStart && d <= now; });
  const monthSales  = sales.filter(s => s.date.startsWith(thisMonth));
  const prevMonthSales = sales.filter(s => s.date.startsWith(prevMonth));

  const low  = inv.filter(p => p.qty > 0  && p.qty <= thresh);
  const out  = inv.filter(p => p.qty <= 0);

  // Range label
  const labelEl = document.getElementById('dashRangeLabel');
  if (labelEl) {
    labelEl.textContent = `${rangeStart.toLocaleDateString('ar-EG',{day:'numeric',month:'short'})} — ${now.toLocaleDateString('ar-EG',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  // Profit for range period
  const rangeProfit = calcProfit(rangeSales, inv);
  const monthProfit = calcProfit(monthSales, inv);
  const prevMonthProfit = calcProfit(prevMonthSales, inv);

  document.getElementById('sd-today').textContent    = fmt(todaySales.reduce((s,x) => s+x.total,0)) + ' ج';
  document.getElementById('sd-today-c').textContent  = todaySales.length + ' فاتورة';
  document.getElementById('sd-month').textContent    = fmt(rangeSales.reduce((s,x) => s+x.total,0)) + ' ج';
  document.getElementById('sd-month-c').textContent  = rangeSales.length + ' فاتورة';
  document.getElementById('sd-profit').textContent   = fmt(rangeProfit) + ' ج';
  document.getElementById('sd-products').textContent = inv.length;
  document.getElementById('sd-low').textContent      = low.length;
  document.getElementById('sd-out').textContent      = out.length;
  updateLowStockBell();

  // ── Month vs Prev Month comparison cards ──
  const thisRev  = monthSales.reduce((s,x) => s+x.total, 0);
  const prevRev  = prevMonthSales.reduce((s,x) => s+x.total, 0);
  const thisOrders = monthSales.length;
  const prevOrders = prevMonthSales.length;
  const thisATV  = thisOrders > 0 ? thisRev / thisOrders : 0;
  const prevATV  = prevOrders > 0 ? prevRev / prevOrders : 0;
  const thisMargin = thisRev > 0 ? Math.round(monthProfit / thisRev * 100) : 0;
  const prevMargin = prevRev > 0 ? Math.round(prevMonthProfit / prevRev * 100) : 0;

  const cmpEl = (id, val, prev, unit) => {
    const el = document.getElementById(id);
    const deltaEl = document.getElementById(id+'-delta');
    if (el) el.textContent = fmt(val) + (unit||'');
    if (deltaEl) deltaEl.innerHTML = deltaBadge(val, prev);
  };
  cmpEl('cmp-rev',    thisRev,    prevRev,    ' ج');
  cmpEl('cmp-profit', monthProfit, prevMonthProfit, ' ج');
  cmpEl('cmp-orders', thisOrders, prevOrders, ' ف');
  cmpEl('cmp-atv',    thisATV,    prevATV,    ' ج');
  const cmpMarginEl = document.getElementById('cmp-margin');
  const cmpMarginDelta = document.getElementById('cmp-margin-delta');
  if (cmpMarginEl) cmpMarginEl.textContent = thisMargin + '%';
  if (cmpMarginDelta) cmpMarginDelta.innerHTML = deltaBadge(thisMargin, prevMargin);

  // ── Weekly chart (last 7 days) ──
  const days = Array.from({length:7}, (_,i) => { const d=new Date(); d.setDate(d.getDate()-6+i); return d; });
  const weeklyData = days.map(d => sales.filter(s=>new Date(s.date).toDateString()===d.toDateString()).reduce((s,x)=>s+x.total,0));
  if (chartWeekly) chartWeekly.destroy();
  chartWeekly = new Chart(document.getElementById('chartWeekly'), {
    type:'bar',
    data:{ labels:days.map(d=>d.toLocaleDateString('ar-EG',{weekday:'short',day:'numeric'})), datasets:[{data:weeklyData,backgroundColor:'rgba(200,25,60,.75)',borderRadius:6,label:'المبيعات'}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{callback:v=>v>0?fmt(v):'0'}}}, responsive:true }
  });

  // ── Top products doughnut ──
  const ps = {};
  monthSales.forEach(s=>s.items.forEach(i=>{ ps[i.name]=(ps[i.name]||0)+i.qty; }));
  const top5 = Object.entries(ps).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (chartTop) chartTop.destroy();
  if (top5.length) {
    chartTop = new Chart(document.getElementById('chartTop'), {
      type:'doughnut',
      data:{ labels:top5.map(x=>x[0]), datasets:[{data:top5.map(x=>x[1]),backgroundColor:['#1a5faf','#F47920','#2472cc','#134a8a','#5b9bd5']}] },
      options:{ plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}, responsive:true }
    });
  }

  // ── 6-month revenue trend line chart ──
  const trendMonths = Array.from({length:6}, (_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { key: d.toISOString().slice(0,7), label: d.toLocaleDateString('ar-EG',{month:'short',year:'2-digit'}) };
  });
  const trendData = trendMonths.map(m => sales.filter(s=>s.date.startsWith(m.key)).reduce((s,x)=>s+x.total,0));
  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(document.getElementById('chartTrend'), {
    type:'line',
    data:{
      labels: trendMonths.map(m=>m.label),
      datasets:[{ data:trendData, borderColor:'#1a5faf', backgroundColor:'rgba(26,95,175,.08)', tension:.4, fill:true, pointBackgroundColor:'#1a5faf', pointRadius:5, label:'الإيرادات' }]
    },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{callback:v=>fmt(v)}}}, responsive:true }
  });

  // ── Branch comparison horizontal bar chart ──
  const branches = getBranches();
  const branchLabels = BRANCH_IDS.map(b => branches[b]||BRANCH_DEFAULTS[b]);
  const branchRevs   = BRANCH_IDS.map(b => allSales.filter(s=>s.date.startsWith(thisMonth)&&s.branchId===b).reduce((s,x)=>s+x.total,0));
  if (chartBranches) chartBranches.destroy();
  chartBranches = new Chart(document.getElementById('chartBranches'), {
    type:'bar',
    data:{
      labels: branchLabels,
      datasets:[{ data:branchRevs, backgroundColor:['#1a5faf','#F47920','#d97706','#7c3aed'], borderRadius:6, label:'الإيرادات' }]
    },
    options:{
      indexAxis:'y',
      plugins:{legend:{display:false}},
      scales:{x:{beginAtZero:true,ticks:{callback:v=>fmt(v)}}},
      responsive:true
    }
  });

  // ── Executive KPIs ──
  const monthRevenue = thisRev;
  const marginPct    = thisMargin;
  const invValue     = inv.reduce((s,i)=>s+(i.cost||0)*(i.qty||0),0);
  const cogs = monthSales.reduce((acc,s)=>acc+s.items.reduce((a,i)=>{
    const c = i.cost>0?i.cost:(inv.find(x=>x.code===i.code)?.cost||0);
    return a + c*i.qty; },0),0);
  const turnover = invValue > 0 ? (cogs / invValue) : 0;
  const dailyRevenue = monthRevenue / now.getDate();
  const coverage = dailyRevenue > 0 ? Math.round(invValue / dailyRevenue) : 0;
  const hrRec = getHR().find(h=>h.month===thisMonth);
  const totalTarget = hrRec ? Object.values(hrRec.targets||{}).reduce((s,t)=>s+(t.target||0),0) : 0;
  const achievePct  = totalTarget > 0 ? Math.round(monthRevenue/totalTarget*100) : 0;

  const execMargin   = document.getElementById('exec-margin');
  const execTarget   = document.getElementById('exec-target');
  const execTargetSub= document.getElementById('exec-target-sub');
  const execTurnover = document.getElementById('exec-turnover');
  const execCoverage = document.getElementById('exec-coverage');
  const execInvVal   = document.getElementById('exec-inv-value');
  if (execMargin)    { execMargin.textContent = marginPct+'%'; execMargin.style.color = marginPct>=20?'#7c3aed':marginPct>=10?'#d97706':'#dc2626'; }
  if (execTarget)    { execTarget.textContent = totalTarget>0 ? achievePct+'%' : '-'; }
  if (execTargetSub) { execTargetSub.textContent = totalTarget>0 ? `هدف: ${fmt(totalTarget)} ج` : 'لم يُحدد هدف'; }
  if (execTurnover)  execTurnover.textContent = turnover.toFixed(1)+'x';
  if (execCoverage)  execCoverage.textContent = coverage;
  if (execInvVal)    execInvVal.textContent = fmt(invValue)+' ج';

  // Low stock list
  const allAlert = [...out, ...low].sort((a,b) => a.qty-b.qty);
  const dashEl = document.getElementById('dashLowStock');
  if (!allAlert.length) {
    dashEl.innerHTML = '<div class="text-center text-muted" style="padding:20px;">لا توجد منتجات تحتاج تجديد 👍</div>';
  } else {
    dashEl.innerHTML = `<table style="width:100%;"><thead><tr><th>الكود</th><th>الاسم</th><th>الكمية الحالية</th><th>الحالة</th></tr></thead><tbody>
      ${allAlert.map(p=>`<tr><td>${p.code}</td><td>${p.name}</td><td><strong>${p.qty}</strong></td>
        <td><span class="badge ${p.qty<=0?'badge-danger':'badge-warning'}">${p.qty<=0?'نفد المخزون':'مخزون منخفض'}</span></td></tr>`).join('')}
    </tbody></table>`;
  }
}

// ══════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════
function renderInventory() {
  // Populate branch filter if empty
  var ibf = document.getElementById('invBranchFilter');
  if (ibf && ibf.options.length === 0) {
    var bnames = getBranches();
    BRANCH_IDS.forEach(function(b){
      var o = document.createElement('option'); o.value = b;
      o.textContent = (bnames[b]||BRANCH_DEFAULTS[b]);
      ibf.appendChild(o);
    });
    ibf.value = currentBranch;
  }
  var selBranch = ibf ? ibf.value : currentBranch;
  const q = (document.getElementById('invSearch')?.value || '').toLowerCase();
  const inv = getInv(selBranch), thresh = getThreshold();
  const catFilter = document.getElementById('invCatFilter')?.value || '';
  const famFilter = document.getElementById('invFamFilter')?.value || '';
  let items = inv;
  if (q)         items = items.filter(p => p.name.toLowerCase().includes(q)||p.code.toLowerCase().includes(q)||(p.category||'').toLowerCase().includes(q)||(p.family||'').toLowerCase().includes(q));
  if (catFilter) items = items.filter(p => (p.category||'') === catFilter);
  if (famFilter) items = items.filter(p => (p.family||'') === famFilter);
  const _cf = document.getElementById('invCatFilter');
  const _ff = document.getElementById('invFamFilter');
  if (_cf) { const _cv=_cf.value; const _cats=[...new Set(inv.map(x=>x.category).filter(Boolean))].sort(); _cf.innerHTML='<option value="">كل الفئات</option>'+_cats.map(c=>`<option value="${c}" ${c===_cv?'selected':''}>${c}</option>`).join(''); _cf.value=_cv; }
  if (_ff) { const _fv=_ff.value; const _fams=[...new Set(inv.map(x=>x.family).filter(Boolean))].sort(); _ff.innerHTML='<option value="">كل المجموعات</option>'+_fams.map(f=>`<option value="${f}" ${f===_fv?'selected':''}>${f}</option>`).join(''); _ff.value=_fv; }

  document.getElementById('inventoryBody').innerHTML = !items.length
    ? '<tr><td colspan="10" class="text-center text-muted" style="padding:40px;">لا توجد منتجات</td></tr>'
    : items.map(p => `<tr>
        <td><strong>${p.code}</strong></td>
        <td>${p.name}</td>
        <td><span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:11px;">${p.category||'—'}</span></td>
        <td><span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:12px;font-size:11px;">${p.family||'—'}</span></td>
        <td>${fmt(p.cost||0)}</td>
        <td>${p.priceBefore ? fmt(p.priceBefore) : '-'}</td>
        <td><strong>${fmt(p.priceAfter)}</strong></td>
        <td><input type="number" value="${p.qty}" min="0"
          onchange="updateQty('${p.code}',this.value)"
          style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;text-align:center;font-family:inherit;" /></td>
        <td><span class="badge ${p.qty<=0?'badge-danger':p.qty<=thresh?'badge-warning':'badge-success'}">
          ${p.qty<=0?'نفد':p.qty<=thresh?'منخفض':'متوفر'}
        </span></td>
        <td>
          <button class="btn btn-gray btn-sm" onclick="editProduct('${p.code}')" style="margin-left:4px;">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.code}')">🗑️</button>
        </td>
      </tr>`).join('');
}

function updateQty(code, val) {
  const inv = getInv();
  const p = inv.find(x => x.code === code);
  if (p) { p.qty = parseInt(val) || 0; setInv(inv); renderInventory(); }
}

function openProductModal(p) {
  document.getElementById('pmTitle').textContent = p ? 'تعديل منتج' : 'إضافة منتج جديد';
  document.getElementById('pmEditCode').value    = p ? p.code : '';
  document.getElementById('pm-code').value        = p ? p.code : '';
  document.getElementById('pm-name').value        = p ? p.name : '';
  document.getElementById('pm-cost').value        = p ? (p.cost||'') : '';
  document.getElementById('pm-priceBefore').value = p ? (p.priceBefore||'') : '';
  document.getElementById('pm-priceAfter').value  = p ? p.priceAfter : '';
  document.getElementById('pm-qty').value         = p ? p.qty : '';
  document.getElementById('pm-category').value    = p ? (p.category||'') : '';
  document.getElementById('pm-family').value      = p ? (p.family||'') : '';
  document.getElementById('productModal').classList.remove('hidden');
}

function editProduct(code) {
  const p = getInv().find(x => x.code === code);
  if (p) openProductModal(p);
}

function saveProduct() {
  const code       = document.getElementById('pm-code').value.trim();
  const name       = document.getElementById('pm-name').value.trim();
  const priceAfter = parseFloat(document.getElementById('pm-priceAfter').value);
  if (!code || !name || isNaN(priceAfter)) { alert('الكود والاسم والسعر مطلوبون'); return; }

  const inv = getInv();
  const editCode = document.getElementById('pmEditCode').value;
  const prod = {
    code, name,
    cost:       parseFloat(document.getElementById('pm-cost').value) || 0,
    priceBefore: parseFloat(document.getElementById('pm-priceBefore').value) || 0,
    priceAfter,
    qty:      parseInt(document.getElementById('pm-qty').value) || 0,
    category: document.getElementById('pm-category').value.trim(),
    family:   document.getElementById('pm-family').value.trim()
  };

  if (editCode) {
    const idx = inv.findIndex(x => x.code === editCode);
    const oldProd = inv[idx];
    if (idx >= 0) inv[idx] = prod; else inv.push(prod);
    // Audit: price change?
    if (oldProd && oldProd.priceAfter !== prod.priceAfter) {
      addAuditLog('price.change', `${prod.name}: سعر ${fmt(oldProd.priceAfter)} ← ${fmt(prod.priceAfter)} ج`, null);
    } else {
      addAuditLog('inv.edit', `تعديل: ${prod.name} (${prod.code}) — كمية: ${prod.qty}`, null);
    }
  } else {
    if (inv.find(x => x.code === code)) { alert('هذا الكود موجود مسبقاً'); return; }
    inv.push(prod);
    addAuditLog('inv.add', `إضافة: ${prod.name} (${prod.code}) — سعر: ${fmt(prod.priceAfter)} ج`, null);
  }
  setInv(inv);
  document.getElementById('productModal').classList.add('hidden');
  renderInventory();
}

function deleteProduct(code) {
  if (!confirm('حذف هذا المنتج؟')) return;
  const prod = getInv().find(x => x.code === code);
  setInv(getInv().filter(x => x.code !== code));
  if (prod) addAuditLog('inv.delete', `حذف: ${prod.name} (${prod.code})`, null);
  renderInventory();
}

function importExcel(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const wb   = XLSX.read(ev.target.result, { type:'binary' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    const inv  = getInv();
    let added=0, updated=0, errors=[];

    rows.forEach((row, i) => {
      // Normalize keys: trim whitespace + lowercase for case-insensitive matching
      const norm = {};
      Object.keys(row).forEach(k => { norm[k.trim().toLowerCase()] = row[k]; });
      const g = (...keys) => { for (const k of keys) { const v = norm[k.toLowerCase()]; if (v !== undefined && v !== '') return v; } return ''; };

      const code = String(g('code','كود','الكود')||'').trim();
      const name = String(g('name','اسم','الاسم','product name','product','item','item name')||'').trim();
      if (!code||!name) { errors.push(`سطر ${i+2}: كود أو اسم مفقود`); return; }

      const priceAfter = parseFloat(g('price after','price_after','priceafter','السعر بعد','سعر بعد','price','السعر')||0) || 0;

      const prod = {
        code, name,
        cost:        parseFloat(g('cost','التكلفة','تكلفة','buy price','buying price','purchase price','سعر الشراء')||0)||0,
        priceBefore: parseFloat(g('price before','price_before','pricebefore','السعر قبل','سعر قبل','old price')||0)||0,
        priceAfter,
        qty:      parseInt(g('qty','quantity','الكمية','كمية','stock','مخزون')||0)||0,
        category: String(g('category','الفئة','فئة','كاتيجورى','كاتيجوري','')||'').trim(),
        family:   String(g('family','المجموعة','مجموعة','فاميلى','فاميلي','')||'').trim()
      };
      const ex = inv.find(x => x.code === code);
      if (ex) { Object.assign(ex, prod); updated++; } else { inv.push(prod); added++; }
    });

    setInv(inv); e.target.value = '';
    const msg = `✅ تم الاستيراد: ${added} منتج جديد · ${updated} تم تحديثه${errors.length ? `<br>⚠️ ${errors.slice(0,3).join(' | ')}` : ''}`;
    document.getElementById('importAlert').innerHTML = `<div class="alert alert-success">${msg}</div>`;
    setTimeout(() => document.getElementById('importAlert').innerHTML='', 6000);
    renderInventory();
  };
  reader.readAsBinaryString(file);
}

function exportInventoryExcel() {
  const data = getInv().map(p => ({
    'الكود':p.code,'الاسم':p.name,'التكلفة':p.cost||0,
    'السعر قبل':p.priceBefore||0,'السعر بعد':p.priceAfter,'الكمية':p.qty
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
  XLSX.writeFile(wb, 'inventory_' + new Date().toISOString().slice(0,10) + '.xlsx');
}

// ══════════════════════════════════════════════
// SALES LIST
// ══════════════════════════════════════════════
function initSalesFilter() {
  if (!document.getElementById('salesFrom').value) {
    const d = new Date(); d.setDate(1);
    document.getElementById('salesFrom').value = d.toISOString().slice(0,10);
    document.getElementById('salesTo').value   = new Date().toISOString().slice(0,10);
  }
}

function clearSalesFilter() {
  document.getElementById('salesFrom').value = '';
  document.getElementById('salesTo').value   = '';
  renderSales();
}

function renderSales() {
  // Populate branch filter if empty
  var sbf = document.getElementById('salesBranchFilter');
  if (sbf && sbf.options.length === 0) {
    var opt0 = document.createElement('option'); opt0.value='all'; opt0.textContent='🏬 كل الفروع'; sbf.appendChild(opt0);
    var bnames = getBranches();
    BRANCH_IDS.filter(function(b){ return b!=='wh'; }).forEach(function(b){
      var o = document.createElement('option'); o.value=b; o.textContent=(bnames[b]||BRANCH_DEFAULTS[b]); sbf.appendChild(o);
    });
  }
  var selBranch = sbf ? sbf.value : 'all';
  const from = document.getElementById('salesFrom').value;
  const to   = document.getElementById('salesTo').value;
  let sales  = getSales();
  if (selBranch && selBranch !== 'all') sales = sales.filter(function(s){ return s.branchId === selBranch; });
  if (from) sales = sales.filter(s => s.date.slice(0,10) >= from);
  if (to)   sales = sales.filter(s => s.date.slice(0,10) <= to);
  sales.sort((a,b) => new Date(b.date) - new Date(a.date));

  document.getElementById('salesFilterTotal').textContent = fmt(sales.reduce((s,x)=>s+x.total,0));
  document.getElementById('salesBody').innerHTML = !sales.length
    ? '<tr><td colspan="10" class="text-center text-muted" style="padding:40px;">لا توجد مبيعات</td></tr>'
    : sales.map(s => `<tr class="${s.isReturn ? 'return-row' : ''}">
        <td>${s.isReturn ? `<span class="badge-return">مرتجع #${String(s.id).slice(-6)}</span>` : `<span class="badge badge-info">#${String(s.id).slice(-6)}</span>`}</td>
        <td style="white-space:nowrap;">${new Date(s.date).toLocaleString('ar-EG')}</td>
        <td><span style="font-size:11px;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:8px;">${s.branchName||getBranchName(s.branchId||'b1')}</span></td>
        <td>${s.salesperson||s.cashier||'-'}</td>
        <td>${s.items.reduce((x,i)=>x+i.qty,0)}</td>
        <td>${fmt(s.sub)} ج</td>
        <td>${s.disc>0?fmt(s.disc)+' ج':'-'}</td>
        <td><strong>${fmt(s.total)} ج</strong></td>
        <td>${s.payMethod==='cash'?'💵 نقدي':'💳 كارت'}</td>
        <td><button class="btn btn-gray btn-sm" onclick="viewSale(${s.id})">👁️ عرض</button></td>
      </tr>`).join('');
}

function viewSale(id) {
  const sale = getSales().find(s => s.id === id); if (!sale) return;
  lastSaleForPrint = sale;
  document.getElementById('saleDetailContent').innerHTML = `
    <div class="grid-2" style="font-size:13px;margin-bottom:14px;gap:8px;">
      <div><strong>رقم الفاتورة:</strong> ${String(sale.id).slice(-8)}</div>
      <div><strong>التاريخ:</strong> ${new Date(sale.date).toLocaleString('ar-EG')}</div>
      <div><strong>البائع:</strong> ${sale.salesperson || sale.cashier || '-'}</div>
      <div><strong>الدفع:</strong> ${sale.payMethod==='cash'?'💵 نقدي':'💳 كارت'}</div>
    </div>
    <div class="table-wrap">
      <table style="font-size:13px;">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${sale.items.map(i=>`<tr><td>${i.name}</td><td>${i.qty}</td><td>${fmt(i.price)} ج</td><td><strong>${fmt(i.price*i.qty)} ج</strong></td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-top:12px;font-size:14px;">
      <div class="flex justify-between"><span>المجموع</span><span>${fmt(sale.sub)} ج</span></div>
      ${sale.disc>0?`<div class="flex justify-between" style="color:green;"><span>خصم</span><span>-${fmt(sale.disc)} ج</span></div>`:''}
      <div class="flex justify-between font-bold" style="font-size:16px;margin-top:6px;border-top:1px solid var(--border);padding-top:6px;"><span>الإجمالي</span><span>${fmt(sale.total)} ج</span></div>
      ${sale.payMethod==='cash'?`<div class="flex justify-between" style="color:var(--primary);"><span>مدفوع</span><span>${fmt(sale.paid)} ج</span></div><div class="flex justify-between" style="color:green;font-weight:700;"><span>الباقي</span><span>${fmt(sale.change)} ج</span></div>`:''}
    </div>`;
  document.getElementById('saleDetailModal').classList.remove('hidden');
}

function printSaleFromModal() {
  if (lastSaleForPrint) { showReceipt(lastSaleForPrint); document.getElementById('saleDetailModal').classList.add('hidden'); setTimeout(printReceipt, 300); }
}

// ══════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════
function switchReport(name, tab) {
  ['rpt-sales','rpt-inventory','rpt-profit','rpt-kpi','rpt-sellers','rpt-returns'].forEach(id => { var el = document.getElementById(id); if(el) el.classList.add('hidden'); });
  document.getElementById('rpt-'+name).classList.remove('hidden');
  document.querySelectorAll('#page-reports .tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  if (name==='sales')     buildSalesReport();
  if (name==='inventory') buildInventoryReport();
  if (name==='profit')    buildProfitReport();
  if (name==='kpi')       buildKPIReport();
  if (name==='sellers')   buildSellersReport();
  if (name==='returns')   buildReturnsReport();

}

function populateSellerFilter(selId) {
  const sel = document.getElementById(selId); if (!sel) return;
  const cur = sel.value;
  const people = getSalespeople();
  // Include 'غير محدد' if any sale lacks salesperson
  const all = getSales().map(s => s.salesperson || '');
  const hasBlank = all.some(x => !x);
  sel.innerHTML = '<option value="">👤 كل البائعين</option>' +
    people.map(n=>`<option value="${n}">${n}</option>`).join('') +
    (hasBlank ? '<option value="__none__">غير محدد</option>' : '');
  if (cur) sel.value = cur;
}

function getPrevSales(period, fromId, toId) {
  // Return sales for the equivalent previous period
  const { from, to } = getDateRange(period, fromId, toId);
  const dur = to - from;
  const prevTo   = new Date(from - 1);
  const prevFrom = new Date(from - dur - 1);
  return getSales().filter(s => { const d=new Date(s.date); return d>=prevFrom&&d<=prevTo; });
}

function renderCmpRow(containerId, cur, prev, labels) {
  // cur/prev: plain objects { key: value }
  const el = document.getElementById(containerId); if (!el) return;
  el.innerHTML = labels.map(({key, label, unit}) => {
    const c = cur[key] || 0, p = prev[key] || 0;
    const diff = c - p;
    const pct  = p ? (diff/p*100) : (c ? 100 : 0);
    const cls  = diff > 0 ? 'cmp-up' : diff < 0 ? 'cmp-down' : 'cmp-flat';
    const arrow= diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
    const displayVal = unit === 'pct' ? c.toFixed(1)+'%' : fmt(c)+' ج';
    return `<div class="cmp-card">
      <div class="cmp-label">${label}</div>
      <div class="cmp-val">${displayVal}</div>
      <div class="cmp-delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}% مقارنة بالفترة السابقة</div>
    </div>`;
  }).join('');
}

function buildSalesReport() {
  const period = document.getElementById('rptSalesPeriod').value;
  document.getElementById('rptSalesCustom').classList.toggle('hidden', period!=='custom');
  populateSellerFilter('rptSalesSellerFilter');
  // Populate branch filter
  const rbf = document.getElementById('rptBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter  = rbf?.value || 'all';
  const sellerFilter  = document.getElementById('rptSalesSellerFilter')?.value || '';
  const { from, to }  = getDateRange(period, 'rptSalesFrom', 'rptSalesTo');
  let sales = getSales().filter(s => !s.isReturn && (()=>{ const d=new Date(s.date); return d>=from&&d<=to; })());
  if (branchFilter !== 'all') sales = sales.filter(s => s.branchId === branchFilter);
  if (sellerFilter) {
    sales = sales.filter(s => sellerFilter==='__none__'
      ? !s.salesperson : s.salesperson===sellerFilter);
  }
  const net = sales.reduce((s,x)=>s+x.total,0);
  const sub = sales.reduce((s,x)=>s+x.sub,0);
  document.getElementById('rs-total').textContent = fmt(sub)+' ج';
  document.getElementById('rs-net').textContent   = fmt(net)+' ج';
  document.getElementById('rs-count').textContent = sales.length;
  document.getElementById('rs-avg').textContent   = fmt(sales.length ? net/sales.length : 0)+' ج';

  if (period !== 'custom') {
    let prevSales = getPrevSales(period, 'rptSalesFrom', 'rptSalesTo');
    if (sellerFilter) prevSales = prevSales.filter(s => sellerFilter==='__none__' ? !s.salesperson : s.salesperson===sellerFilter);
    const prevNet = prevSales.reduce((s,x)=>s+x.total,0);
    const prevAvg = prevSales.length ? prevNet/prevSales.length : 0;
    renderCmpRow('salesCmpRow',
      { net, count: sales.length, avg: sales.length ? net/sales.length : 0 },
      { net: prevNet, count: prevSales.length, avg: prevAvg },
      [
        { key:'net',   label:'الإيرادات',     unit:'amount' },
        { key:'count', label:'الفواتير',       unit:'amount' },
        { key:'avg',   label:'متوسط الفاتورة', unit:'amount' }
      ]
    );
  } else {
    document.getElementById('salesCmpRow').innerHTML = '';
  }

  const dayMap = {};
  sales.forEach(s => { const d=s.date.slice(0,10); dayMap[d]=(dayMap[d]||0)+s.total; });
  const days = Object.keys(dayMap).sort();
  if (chartRptSales) chartRptSales.destroy();
  chartRptSales = new Chart(document.getElementById('chartRptSales'), {
    type:'line',
    data:{ labels:days, datasets:[{data:days.map(d=>dayMap[d]),borderColor:'#1a5faf',backgroundColor:'rgba(26,95,175,.1)',fill:true,tension:.3,label:'المبيعات'}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}, responsive:true }
  });

  const bd = {};
  sales.forEach(s=>s.items.forEach(i=>{ if(!bd[i.code]) bd[i.code]={name:i.name,qty:0,rev:0}; bd[i.code].qty+=i.qty; bd[i.code].rev+=i.price*i.qty; }));
  const sorted = Object.values(bd).sort((a,b)=>b.rev-a.rev);
  document.getElementById('rs-breakdown').innerHTML = !sorted.length
    ? '<tr><td colspan="3" class="text-center text-muted" style="padding:16px;">لا توجد مبيعات</td></tr>'
    : sorted.map(d=>`<tr><td>${d.name}</td><td>${d.qty}</td><td><strong>${fmt(d.rev)} ج</strong></td></tr>`).join('');
}

function buildInventoryReport() {
  const rbf = document.getElementById('rptInventoryBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter = rbf?.value || 'all';
  const inv = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  const thresh = getThreshold();
  const costVal = inv.reduce((s,p)=>s+(p.cost||0)*p.qty,0);
  const sellVal = inv.reduce((s,p)=>s+p.priceAfter*p.qty,0);
  const units   = inv.reduce((s,p)=>s+p.qty,0);
  document.getElementById('ri-count').textContent = inv.length;
  document.getElementById('ri-cost').textContent  = fmt(costVal)+' ج';
  document.getElementById('ri-sell').textContent  = fmt(sellVal)+' ج';
  document.getElementById('ri-units').textContent = units;
  const sorted = [...inv].sort((a,b)=>a.qty-b.qty);
  document.getElementById('ri-body').innerHTML = sorted.map(p => {
    const stockVal = p.priceAfter*p.qty;
    const profit   = (p.priceAfter-(p.cost||0))*p.qty;
    return `<tr>
      <td>${p.code}</td><td>${p.name}</td><td><strong>${p.qty}</strong></td>
      <td>${fmt(p.cost||0)}</td><td>${fmt(p.priceAfter)}</td>
      <td>${fmt(stockVal)} ج</td>
      <td style="color:${profit>=0?'var(--success)':'var(--danger)'};">${fmt(profit)} ج</td>
      <td><span class="badge ${p.qty<=0?'badge-danger':p.qty<=thresh?'badge-warning':'badge-success'}">
        ${p.qty<=0?'نفد':p.qty<=thresh?'منخفض':'متوفر'}
      </span></td>
    </tr>`;
  }).join('');
}

function buildProfitReport() {
  const period = document.getElementById('rptProfitPeriod').value;
  document.getElementById('rptProfitCustom').classList.toggle('hidden', period!=='custom');
  populateSellerFilter('rptProfitSellerFilter');
  const sellerFilter = document.getElementById('rptProfitSellerFilter')?.value || '';
  const { from, to } = getDateRange(period, 'rptProfitFrom', 'rptProfitTo');
  const rbf = document.getElementById('rptProfitBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter = rbf?.value || 'all';
  const inv   = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  let sales = getSales()
    .filter(s => branchFilter === 'all' || s.branchId === branchFilter)
    .filter(s => { const d=new Date(s.date); return d>=from&&d<=to; });
  if (sellerFilter) {
    sales = sales.filter(s => sellerFilter==='__none__'
      ? !s.salesperson : s.salesperson===sellerFilter);
  }

  const bd = {};
  sales.forEach(s => s.items.forEach(i => {
    const cost = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost || 0);
    if (!bd[i.code]) bd[i.code]={name:i.name,qty:0,rev:0,cost:0};
    bd[i.code].qty+=i.qty; bd[i.code].rev+=i.price*i.qty; bd[i.code].cost+=cost*i.qty;
  }));

  const revenue    = sales.reduce((s,x)=>s+x.total,0);
  const totalCost  = Object.values(bd).reduce((s,x)=>s+x.cost,0);
  const totalDisc  = sales.reduce((s,x)=>s+(x.disc||0),0);
  const profit     = revenue - totalCost;
  const margin     = revenue ? profit/revenue*100 : 0;

  document.getElementById('rp-revenue').textContent   = fmt(revenue)+' ج';
  document.getElementById('rp-cost').textContent      = fmt(totalCost)+' ج';
  document.getElementById('rp-profit').textContent    = fmt(profit)+' ج';
  document.getElementById('rp-margin').textContent    = margin.toFixed(1)+'%';
  document.getElementById('rp-discounts').textContent = fmt(totalDisc)+' ج';

  if (period !== 'custom') {
    let prevSales = getPrevSales(period, 'rptProfitFrom', 'rptProfitTo');
    if (sellerFilter) prevSales = prevSales.filter(s => sellerFilter==='__none__' ? !s.salesperson : s.salesperson===sellerFilter);
    const prevRevenue = prevSales.reduce((s,x)=>s+x.total,0);
    let prevCost = 0;
    prevSales.forEach(s => s.items.forEach(i => {
      const c = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost||0);
      prevCost += c * i.qty;
    }));
    const prevProfit = prevRevenue - prevCost;
    renderCmpRow('profitCmpRow',
      { revenue, profit, margin },
      { revenue: prevRevenue, profit: prevProfit, margin: prevRevenue ? (prevRevenue-prevCost)/prevRevenue*100 : 0 },
      [
        { key:'revenue', label:'الإيرادات',  unit:'amount' },
        { key:'profit',  label:'صافي الربح', unit:'amount' },
        { key:'margin',  label:'هامش الربح', unit:'pct'    }
      ]
    );
  } else {
    document.getElementById('profitCmpRow').innerHTML = '';
  }

  if (chartProfit) chartProfit.destroy();
  chartProfit = new Chart(document.getElementById('chartProfit'), {
    type:'bar',
    data:{
      labels:['الإيرادات','التكلفة','صافي الربح'],
      datasets:[{data:[revenue,totalCost,profit],backgroundColor:['rgba(200,25,60,.8)','rgba(168,20,47,.6)','rgba(22,163,74,.75)'],borderRadius:8}]
    },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}, responsive:true }
  });

  const sorted2 = Object.values(bd).sort((a,b)=>(b.rev-b.cost)-(a.rev-a.cost));
  document.getElementById('rp-breakdown').innerHTML = !sorted2.length
    ? '<tr><td colspan="6" class="text-center text-muted" style="padding:16px;">لا توجد بيانات</td></tr>'
    : sorted2.map(d => {
        const p=d.rev-d.cost, m=d.rev?p/d.rev*100:0;
        return `<tr><td>${d.name}</td><td>${d.qty}</td><td>${fmt(d.rev)} ج</td><td>${fmt(d.cost)} ج</td>
          <td style="color:${p>=0?'var(--success)':'var(--danger)'};font-weight:700;">${fmt(p)} ج</td>
          <td>${m.toFixed(1)}%</td></tr>`;
      }).join('');
}

// ══════════════════════════════════════════════
// KPI REPORT
// ══════════════════════════════════════════════
let chartKPI = null, chartSellers = null;

function buildKPIReport() {
  const period = document.getElementById('rptKpiPeriod').value;
  document.getElementById('rptKpiCustom').classList.toggle('hidden', period!=='custom');
  const { from, to } = getDateRange(period, 'rptKpiFrom', 'rptKpiTo');
  const rbf = document.getElementById('rptKpiBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter = rbf?.value || 'all';
  const inv   = branchFilter === 'all'
    ? Object.values(_invCacheByBranch).flat()
    : getInv(branchFilter);
  const sales = getSales()
    .filter(s => branchFilter === 'all' || s.branchId === branchFilter)
    .filter(s => { const d=new Date(s.date); return d>=from&&d<=to; });

  const count      = sales.length;
  const revenue    = sales.reduce((s,x)=>s+x.total,0);
  const totalUnits = sales.reduce((s,x)=>s+x.items.reduce((a,i)=>a+i.qty,0),0);
  const totalDisc  = sales.reduce((s,x)=>s+(x.disc||0),0);
  const cardCount  = sales.filter(s=>s.payMethod==='card').length;

  let totalCost = 0;
  sales.forEach(s => s.items.forEach(i => {
    const cost = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost||0);
    totalCost += cost * i.qty;
  }));

  const atv      = count ? revenue/count : 0;
  const upt      = count ? totalUnits/count : 0;
  const gm       = revenue ? (revenue-totalCost)/revenue*100 : 0;
  const cardPct  = count ? cardCount/count*100 : 0;
  const discPct  = revenue ? totalDisc/revenue*100 : 0;

  const turnFrom = document.getElementById('turnoverFrom')?.value;
  const turnTo   = document.getElementById('turnoverTo')?.value;
  const tvSales  = getSales().filter(s => branchFilter === 'all' || s.branchId === branchFilter).filter(s => {
    if (!turnFrom && !turnTo) return true;
    const d = s.date.slice(0,10);
    return (!turnFrom || d>=turnFrom) && (!turnTo || d<=turnTo);
  });
  let cogs = 0;
  tvSales.forEach(s => s.items.forEach(i => {
    const cost = i.cost > 0 ? i.cost : (inv.find(x=>x.code===i.code)?.cost||0);
    cogs += cost * i.qty;
  }));
  const invValue = inv.reduce((s,p)=>s+(p.cost||0)*p.qty, 0);
  const turnover = invValue ? cogs / invValue : 0;

  document.getElementById('kpi-atv').textContent      = fmt(atv)+' ج';
  document.getElementById('kpi-upt').textContent      = upt.toFixed(2);
  document.getElementById('kpi-gm').textContent       = gm.toFixed(1)+'%';
  document.getElementById('kpi-turnover').textContent = turnover.toFixed(2)+'×';
  document.getElementById('kpi-card-pct').textContent = cardPct.toFixed(1)+'%';
  document.getElementById('kpi-disc-pct').textContent = discPct.toFixed(1)+'%';
  document.getElementById('tv-cogs').textContent      = fmt(cogs)+' ج';
  document.getElementById('tv-inv').textContent       = fmt(invValue)+' ج';
  document.getElementById('tv-rate').textContent      = turnover.toFixed(2)+'×';

  const dayMap = {};
  sales.forEach(s => { const d=s.date.slice(0,10); dayMap[d]=(dayMap[d]||0)+s.total; });
  const days = Object.keys(dayMap).sort();
  if (chartKPI) chartKPI.destroy();
  chartKPI = new Chart(document.getElementById('chartKPI'), {
    type:'line',
    data:{ labels:days, datasets:[{data:days.map(d=>dayMap[d]),borderColor:'#1a5faf',backgroundColor:'rgba(26,95,175,.1)',fill:true,tension:.3,label:'المبيعات'}] },
    options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}, responsive:true }
  });

  buildHeatmap(sales);
}

// ══════════════════════════════════════════════
// SELLERS REPORT
// ══════════════════════════════════════════════
function buildSellersReport() {
  const period = document.getElementById('rptSellersPeriod').value;
  document.getElementById('rptSellersCustom').classList.toggle('hidden', period!=='custom');
  const { from, to } = getDateRange(period, 'rptSellersFrom', 'rptSellersTo');
  const sales = getSales().filter(s => { const d=new Date(s.date); return d>=from&&d<=to; });

  const bd = {};
  sales.forEach(s => {
    const name = s.salesperson || 'غير محدد';
    if (!bd[name]) bd[name] = { name, count:0, units:0, revenue:0, disc:0 };
    bd[name].count++;
    bd[name].units   += s.items.reduce((a,i)=>a+i.qty,0);
    bd[name].revenue += s.total;
    bd[name].disc    += s.disc||0;
  });
  const rows = Object.values(bd).sort((a,b)=>b.revenue-a.revenue);

  document.getElementById('sellersStatsGrid').innerHTML = rows.map(r => `
    <div class="stat-card">
      <div class="stat-label">👤 ${r.name}</div>
      <div class="stat-value" style="font-size:20px;">${fmt(r.revenue)} ج</div>
      <div class="stat-sub">${r.count} فاتورة · ${r.units} وحدة</div>
    </div>`).join('');

  document.getElementById('sellers-body').innerHTML = !rows.length
    ? '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">لا توجد بيانات</td></tr>'
    : rows.map(r => {
        const atv = r.count ? r.revenue/r.count : 0;
        const upt = r.count ? r.units/r.count : 0;
        return `<tr>
          <td><strong>${r.name}</strong></td>
          <td>${r.count}</td>
          <td>${r.units}</td>
          <td>${fmt(r.revenue)} ج</td>
          <td>${fmt(atv)} ج</td>
          <td>${upt.toFixed(2)}</td>
          <td style="color:var(--warning);">${fmt(r.disc)} ج</td>
        </tr>`;
      }).join('');

  if (chartSellers) chartSellers.destroy();
  if (rows.length) {
    chartSellers = new Chart(document.getElementById('chartSellers'), {
      type:'bar',
      data:{
        labels: rows.map(r=>r.name),
        datasets:[
          {label:'الإيرادات',data:rows.map(r=>r.revenue),backgroundColor:'rgba(200,25,60,.8)',borderRadius:6},
          {label:'الخصومات',data:rows.map(r=>r.disc),backgroundColor:'rgba(217,119,6,.6)',borderRadius:6}
        ]
      },
      options:{ plugins:{legend:{display:true}}, scales:{y:{beginAtZero:true}}, responsive:true }
    });
  }
}

// ══════════════════════════════════════════════
// #4 LOW STOCK BELL
// ══════════════════════════════════════════════
function updateLowStockBell() {
  const inv    = getInv();
  const thresh = getThreshold();
  const low    = inv.filter(p => p.qty <= thresh);
  const badge  = document.getElementById('lowStockBadge');
  if (!badge) return;
  if (low.length) {
    badge.textContent = low.length > 99 ? '99+' : low.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function toggleLowStockPanel() {
  const panel = document.getElementById('lowStockPanel');
  const isOpen = panel.classList.toggle('open');
  if (isOpen) renderLowStockPanel();
}

function renderLowStockPanel() {
  const inv    = getInv();
  const thresh = getThreshold();
  const items  = inv.filter(p => p.qty <= thresh).sort((a,b)=>a.qty-b.qty);
  const el     = document.getElementById('lowStockPanelBody');
  if (!items.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">كل المنتجات متوفرة</div>';
    return;
  }
  el.innerHTML = items.map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:13px;font-weight:600;">${p.name}</div>
        <div style="font-size:11px;color:var(--text-muted);">كود: ${p.code}</div>
      </div>
      <span class="badge ${p.qty<=0?'badge-danger':'badge-warning'}" style="font-size:12px;padding:3px 10px;">
        ${p.qty<=0?'نفد':'متبقي '+p.qty}
      </span>
    </div>`).join('');
}

function exportReorderList() {
  const inv    = getInv();
  const thresh = getThreshold();
  const items  = inv.filter(p => p.qty <= thresh);
  if (!items.length) { alert('لا توجد منتجات تحتاج تجديد'); return; }
  const data = items.map(p => ({
    'الكود': p.code, 'الاسم': p.name,
    'الكمية الحالية': p.qty, 'حد التنبيه': thresh,
    'الحالة': p.qty<=0?'نفد المخزون':'مخزون منخفض'
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'قائمة الطلب');
  XLSX.writeFile(wb, 'reorder_list_' + new Date().toISOString().slice(0,10) + '.xlsx');
}

// ══════════════════════════════════════════════
// #10 FULLSCREEN POS
// ══════════════════════════════════════════════
function toggleFullscreen() {
  const btn = document.getElementById('fullscreenBtn');
  if (!document.fullscreenElement) {
    document.getElementById('cashierView').requestFullscreen().catch(()=>{
      document.getElementById('cashierView').webkitRequestFullscreen && document.getElementById('cashierView').webkitRequestFullscreen();
    });
    document.addEventListener('fullscreenchange', onFsChange, {once:true});
    document.addEventListener('webkitfullscreenchange', onFsChange, {once:true});
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

function onFsChange() {
  const btn = document.getElementById('fullscreenBtn');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (btn) btn.textContent = '✕';
    document.addEventListener('fullscreenchange', onFsChange, {once:true});
    document.addEventListener('webkitfullscreenchange', onFsChange, {once:true});
  } else {
    if (btn) btn.textContent = '⛶';
  }
}

// ══════════════════════════════════════════════
// #17 HEATMAP
// ══════════════════════════════════════════════
function buildHeatmap(sales) {
  const wrap = document.getElementById('heatmapWrap'); if (!wrap) return;
  if (!sales || !sales.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">لا توجد بيانات في هذه الفترة</div>';
    return;
  }

  const dayNames = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const matrix = Array.from({length:7}, () => Array(24).fill(0));
  sales.forEach(s => {
    const d = new Date(s.date);
    matrix[d.getDay()][d.getHours()] += s.total;
  });

  const allVals = matrix.flat();
  const maxVal  = Math.max(...allVals, 1);

  function heatColor(v) {
    if (!v) return '#f8fafc';
    const ratio = Math.min(v / maxVal, 1);
    const r = 200;
    const g = Math.round(255 * (1 - ratio * 0.85));
    const b = Math.round(220 * (1 - ratio));
    return `rgb(${r},${g},${b})`;
  }

  const hours = Array.from({length:16}, (_,i) => i+7);
  let html = '<table class="heatmap-table"><thead><tr><th>اليوم</th>';
  hours.forEach(h => { html += `<th>${h}:00</th>`; });
  html += '</tr></thead><tbody>';

  for (let d = 0; d < 7; d++) {
    html += `<tr><th style="text-align:right;padding:4px 8px;white-space:nowrap;">${dayNames[d]}</th>`;
    hours.forEach(h => {
      const v = matrix[d][h];
      const bg = heatColor(v);
      const label = v >= 1000 ? (v/1000).toFixed(1)+'k' : v > 0 ? Math.round(v) : '';
      html += `<td style="background:${bg};" title="${dayNames[d]} ${h}:00 — ${fmt(v)} ج">${label}</td>`;
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += `<div style="margin-top:10px;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);">
    <span>أقل</span>
    <div style="width:120px;height:10px;border-radius:4px;background:linear-gradient(to right,#f8fafc,rgb(200,60,20));"></div>
    <span>أكثر</span>
  </div>`;
  wrap.innerHTML = html;
}

// ══════════════════════════════════════════════
// #18 BACKUP
// ══════════════════════════════════════════════
function exportBackup() {
  const backup = {
    version:    2,
    exportedAt: new Date().toISOString(),
    inv:        getInv(),
    sales:      getSales(),
    settings:   _settingsCache,
    suspended:  _suspendCache
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'voodo_erp_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  DB.s('lastBackup', new Date().toISOString());
  showMsg('sBackupMsg', 'تم تصدير النسخة الاحتياطية بنجاح');
  renderLastBackupInfo();
}

function importBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  if (!confirm('استعادة النسخة الاحتياطية ستستبدل البيانات الحالية. هل تريد المتابعة؟')) {
    e.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.version || !data.inv) { throw new Error('ملف غير صالح'); }
      if (data.inv)       setInv(data.inv);
      if (data.sales)     { _salesCache = data.sales; if (!_fbReady) DB.s('sales', data.sales); }
      if (data.settings)  { _settingsCache = data.settings; saveSettingsCache(); }
      if (data.suspended) setSuspended(data.suspended);
      showMsg('sBackupMsg', 'تم الاستعادة — ' + (data.inv?.length||0) + ' منتج · ' + (data.sales?.length||0) + ' فاتورة');
      buildDashboard();
    } catch(err) {
      showMsg('sBackupMsg', 'خطأ في قراءة الملف: ' + err.message, 'danger');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function renderLastBackupInfo() {
  const el = document.getElementById('lastBackupInfo'); if (!el) return;
  const last = DB.g('lastBackup', null);
  if (last) el.textContent = 'آخر نسخة احتياطية: ' + new Date(last).toLocaleString('ar-EG');
}

function printReport(sectionId) {
  const html = document.getElementById(sectionId).innerHTML;
  const w = window.open('','_blank');
  w.document.write('<html dir="rtl"><head><title>تقرير</title>'
    + '<style>body{font-family:Arial,sans-serif;direction:rtl;padding:20px;font-size:13px;}'
    + 'table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:7px;text-align:right;}'
    + 'th{background:#f0f0f0;}.hidden,.btn,.tabs,.flex.gap-8.mb-16{display:none!important;}</style>'
    + '</head><body>' + html + '</body></html>');
  w.document.close(); w.print();
}

// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════
function renderBranchUsersSettings() {
  const bu = getBranchUsers();
  const container = document.getElementById('branchUsersContainer');
  if (!container) return;
  container.innerHTML = BRANCH_IDS.map(b => {
    const name = getBranchName(b);
    const uname = bu[b]?.username || '';
    const upass  = bu[b]?.password || '';
    return `<div style="border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:10px; background:var(--bg);">
      <div style="font-weight:700; font-size:13px; margin-bottom:8px; color:var(--primary);">🏬 ${name}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div><label style="font-size:11px; color:var(--text-muted);">اسم المستخدم</label>
          <input class="form-control" id="bu-user-${b}" value="${uname}" placeholder="username" style="margin-top:4px;" /></div>
        <div><label style="font-size:11px; color:var(--text-muted);">كلمة المرور</label>
          <input class="form-control" id="bu-pass-${b}" value="" placeholder="password" style="margin-top:4px;" /></div>
      </div>
    </div>`;
  }).join('');
}

async function saveBranchUsers() {
  const bu = getBranchUsers();
  for (const b of BRANCH_IDS) {
    const uname = document.getElementById(`bu-user-${b}`)?.value.trim();
    const upass  = document.getElementById(`bu-pass-${b}`)?.value.trim();
    if (uname) {
      if (upass && upass.length >= 4) {
        const hashed = await hashPass(upass);
        bu[b] = { username: uname, password: hashed };
      } else if (upass === '') {
        // Keep existing password hash unchanged
        bu[b] = { username: uname, password: bu[b]?.password || '' };
      }
    }
  }
  setBranchUsersLocal(bu);
  if (typeof _fbReady !== 'undefined' && _fbReady && _db) {
    _db.collection('pos_data').doc('auth').update({ branchUsers: bu, updatedAt: Date.now() })
      .catch(() => _db.collection('pos_data').doc('auth').set({ users: getUsers(), branchUsers: bu, updatedAt: Date.now() }).catch(()=>{}));
  }
  showMsg('sBranchUsersMsg', '✅ تم حفظ بيانات دخول الفروع');
}

function changePass(role) {
  const users = getUsers();
  const curr = document.getElementById('sCurrPass').value;
  const np   = document.getElementById('sNewPass').value;
  checkPass(curr, users.admin).then(ok => {
    if (!ok) { showMsg('sAdminMsg','كلمة المرور الحالية غلط','danger'); return; }
    if (np.length < 4) { showMsg('sAdminMsg','يجب أن تكون 4 أحرف على الأقل','danger'); return; }
    hashPass(np).then(hashed => {
      users.admin = hashed;
      setUsersLocal(users);
      if (typeof _fbReady !== 'undefined' && _fbReady && _db) {
        _db.collection('pos_data').doc('auth').update({ users: users, updatedAt: Date.now() })
          .catch(() => _db.collection('pos_data').doc('auth').set({ users: users, updatedAt: Date.now() }).catch(()=>{}));
      }
      showMsg('sAdminMsg','✅ تم تغيير كلمة المرور');
      document.getElementById('sCurrPass').value = '';
      document.getElementById('sNewPass').value  = '';
    });
  });
}

function saveSettings() {
  const v = parseInt(document.getElementById('sLowThreshold').value) || 5;
  setThreshold(v);
  const vip = parseInt(document.getElementById('sVipThreshold')?.value) || 1000;
  _settingsCache.vipThreshold = vip;
  saveSettingsCache();
  showMsg('sSettingsMsg','تم حفظ الإعدادات');
}

function renderSellersSettings() {
  const wrap = document.getElementById('sellersListWrap');
  if (!wrap) return;
  const people = getSalespeople();
  wrap.innerHTML = people.map((n,i) => `
    <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:13px;font-weight:600;">
      <span>👤 ${n}</span>
      <button onclick="removeSeller(${i})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;line-height:1;padding:0 2px;" title="حذف">×</button>
    </div>`).join('');
}

function addSeller() {
  const inp = document.getElementById('sNewSeller');
  const name = inp.value.trim();
  if (!name) return;
  const arr = [...getSalespeople()];
  if (arr.includes(name)) { showMsg('sSellersMsg','الاسم موجود بالفعل','danger'); return; }
  arr.push(name);
  setSalespeople(arr);
  inp.value = '';
  showMsg('sSellersMsg','تمت الإضافة');
}

function removeSeller(idx) {
  const arr = [...getSalespeople()];
  if (arr.length <= 1) { showMsg('sSellersMsg','لازم يكون فيه بائع واحد على الأقل','danger'); return; }
  arr.splice(idx, 1);
  setSalespeople(arr);
  showMsg('sSellersMsg','تم الحذف');
}

function resetSales() {
  if (!confirm('حذف كل المبيعات نهائياً؟')) return;
  setSales([]);
  showMsg('sSettingsMsg','تم حذف سجل المبيعات','warning');
}

function resetAll() {
  if (!confirm('حذف كل البيانات (المخزون + المبيعات)؟')) return;
  if (!confirm('تأكيد أخير — هذا لا يمكن التراجع عنه')) return;
  ['inv','sales','pos_suspended','threshold','pos_transfers']
    .concat(BRANCH_IDS.map(b=>`pos_inv_${b}`))
    .forEach(k => localStorage.removeItem(k));
  if (_fbReady) {
    BRANCH_IDS.forEach(b => _db.collection('pos_data').doc(`inv_${b}`).delete().catch(()=>{}));
    _db.collection('pos_data').doc('inv').delete().catch(()=>{});
    _db.collection('pos_data').doc('suspended').delete().catch(()=>{});
    _db.collection('pos_data').doc('settings').delete().catch(()=>{});
    _db.collection('pos_data').doc('transfers').delete().catch(()=>{});
    _db.collection('pos_sales').get().then(snap => {
      const batch = _db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).catch(()=>{});
  }
  _invCacheByBranch = {}; BRANCH_IDS.forEach(b => _invCacheByBranch[b] = []);
  _salesCache = []; _suspendCache = []; _transfersCache = [];
  _settingsCache = { threshold: 5 };
  showMsg('sSettingsMsg','تم حذف كل البيانات','danger');
}

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

    // Auth listener — sync passwords across devices
    _db.collection('pos_data').doc('auth')
      .onSnapshot(snap => {
        if (snap.exists) {
          const data = snap.data();
          const localU = DB.g('users', { admin: '', cashier: '' });
          if (data.users && !localU.admin) DB.s('users', data.users);
          const localBU = DB.g('pos_branch_users', null);
          if (data.branchUsers && !localBU) DB.s('pos_branch_users', data.branchUsers);
        } else {
          // First time: upload local passwords to Firestore
          _db.collection('pos_data').doc('auth').set({
            users: getUsers(), branchUsers: getBranchUsers(), updatedAt: Date.now()
          }).catch(()=>{});
        }
      }, err => console.warn('Auth sync error:', err));

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
          <div style="font-size:12px;color:var(--text-muted);">${new Date(b.created).toLocaleString('ar-EG')} — كاشير: ${b.cashier}</div>
          ${b.note?`<div style="font-size:12px;margin-top:3px;color:#6b7280;">ملاحظة: ${b.note}</div>`:''}
        </div>
        <div style="text-align:left;">
          <div style="font-size:18px;font-weight:700;">${fmt(final)} ج</div>
          ${discAmt>0?`<div style="font-size:12px;color:var(--success);">خصم: -${fmt(discAmt)} ج</div>`:''}
          ${b.adminDiscountNote?`<div style="font-size:11px;color:var(--text-muted);">${b.adminDiscountNote}</div>`:''}
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
        ${b.items.map(i=>`${i.name} × ${i.qty}`).join(' · ')}
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
      <td style="font-weight:600;">${item.name}</td>
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
            ${name} <span style="color:var(--primary);font-weight:700;">${d.qty} قطعة</span></span>`).join('')}
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
      const preview = (s.items||[]).map(i=>i.name+'×'+i.qty).join('، ');
      const pmColor = s.payMethod==='card'?'#1d4ed8':s.payMethod==='mixed'?'#7c3aed':'#15803d';
      const pmLabel = s.payMethod==='card'?'كارت':s.payMethod==='mixed'?'مختلط':'كاش';
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 10px;border-radius:6px;background:var(--bg-secondary);margin-bottom:4px;gap:8px;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;">
          <span style="font-size:12px;font-weight:700;color:var(--primary);">#${String(s.id).slice(-6)}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-inline-start:6px;">${t}</span>
          ${s.customerName?`<span style="font-size:11px;color:var(--text-muted);margin-inline-start:6px;">👤 ${s.customerName}</span>`:''}
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
      <div style="font-size:12px;margin-bottom:8px;">${b.items.map(i=>i.name+' ×'+i.qty).join(' · ')}</div>
      ${discAmt>0?`<div style="font-size:12px;color:var(--success);margin-bottom:8px;">خصم مدير: -${fmt(discAmt)} ج</div>`:''}
      ${b.note?`<div style="font-size:12px;color:#6b7280;margin-bottom:8px;">ملاحظة: ${b.note}</div>`:''}
      <button class="btn btn-success btn-sm" onclick="resumeFromModal('${b.id}')">استئناف هذه الفاتورة</button>
    </div>`;
  }).join('');
}

function resumeFromModal(id) {
  document.getElementById('resumeModal').classList.add('hidden');
  activateSuspended(id);
}

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

function populateBranchNameInputs() {
  const branches = getBranches();
  BRANCH_IDS.forEach(b => {
    const el = document.getElementById(`branchName_${b}`);
    if (el) el.value = branches[b] || BRANCH_DEFAULTS[b];
  });
}

function saveBranchNames() {
  const branches = {};
  BRANCH_IDS.forEach(b => {
    const el = document.getElementById(`branchName_${b}`);
    branches[b] = (el?.value.trim()) || BRANCH_DEFAULTS[b];
  });
  _settingsCache.branches = branches;
  if (_fbReady) {
    _db.collection('pos_data').doc('settings').set(_settingsCache)
       .catch(e => console.error('saveBranchNames:', e));
  }
  DB.s('pos_branches', branches);
  populateBranchSelect();
  loadBranchNamesUI();
  showMsg('sBranchMsg', 'تم حفظ أسماء الفروع ✓', 'success');
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
      onmousedown="selectTrProduct('${p.code}','${p.name.replace(/'/g,'')}',${p.qty})">
      <span>${p.name}</span>
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
      <span style="flex:1;font-size:13px;">${item.name}</span>
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
  if (from === to) { alert('الفرع المصدر والوجهة متطابقان'); return; }
  if (!_trItems.length) { alert('أضف أصناف للتحويل'); return; }
  const note = document.getElementById('trNote').value.trim();

  // Validate quantities
  const srcInv = getInv(from);
  for (const item of _trItems) {
    const p = srcInv.find(x => x.code === item.code);
    if (!p || p.qty < item.qty) { alert(`الكمية المطلوبة من "${item.name}" غير متاحة في المصدر`); return; }
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
  alert(`✅ تم التحويل بنجاح\nمن: ${record.fromName} → إلى: ${record.toName}\n${_trItems.length} صنف`);
}

function renderTransfersPage() {
  const list    = getTransfers();
  const done    = list.filter(t=>t.status==='completed').length;
  const pending = list.filter(t=>t.status==='pending').length;
  document.getElementById('tr-count').textContent   = list.length;
  document.getElementById('tr-done').textContent    = done;
  document.getElementById('tr-pending').textContent = pending;

  const tbody = document.getElementById('transfersBody'); if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">لا توجد تحويلات بعد</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => `<tr>
    <td style="white-space:nowrap;font-size:12px;">${new Date(t.date).toLocaleString('ar-EG')}</td>
    <td><span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:12px;">${t.fromName}</span></td>
    <td><span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:12px;">${t.toName}</span></td>
    <td style="font-size:12px;">${t.items.map(i=>`${i.name} ×${i.qty}`).join(' · ')}</td>
    <td><span style="background:${t.status==='completed'?'#d1fae5':'#fef9c3'};color:${t.status==='completed'?'#065f46':'#92400e'};padding:2px 8px;border-radius:10px;font-size:11px;">${t.status==='completed'?'✅ مكتمل':'⏳ معلق'}</span></td>
    <td style="font-size:12px;color:var(--text-muted);">${t.note||'-'}</td>
    <td style="font-size:11px;color:var(--text-muted);">${t.by||''}</td>
  </tr>`).join('');
}

// Call populateBranchSelect on login
function initBranchUI() {
  populateBranchSelect();
}

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

// ── Supplier CRUD ──
function openSupplierModal(id) {
  const sup = id ? getSuppliers().find(s => s.id === id) : null;
  document.getElementById('supModalTitle').textContent = sup ? '✏️ تعديل مورد' : '➕ مورد جديد';
  document.getElementById('supEditId').value   = sup?.id || '';
  document.getElementById('supName').value     = sup?.name || '';
  document.getElementById('supPhone').value    = sup?.phone || '';
  document.getElementById('supAddress').value  = sup?.address || '';
  document.getElementById('supBalance').value  = sup?.balance || 0;
  document.getElementById('supNotes').value    = sup?.notes || '';
  document.getElementById('supplierModal').classList.remove('hidden');
}

function saveSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { alert('أدخل اسم المورد'); return; }
  const editId = document.getElementById('supEditId').value;
  const list = getSuppliers();
  const rec = {
    id: editId || 'sup_' + Date.now(),
    name,
    phone:   document.getElementById('supPhone').value.trim(),
    address: document.getElementById('supAddress').value.trim(),
    balance: parseFloat(document.getElementById('supBalance').value) || 0,
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
  if (!confirm('حذف هذا المورد نهائياً؟')) return;
  setSuppliers(getSuppliers().filter(s => s.id !== id));
  renderSuppliersPage();
}

function renderSuppliersPage() {
  const q = (document.getElementById('supSearch')?.value || '').toLowerCase();
  let list = getSuppliers();
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.phone.includes(q));
  const totalDebt = getSuppliers().reduce((s, x) => s + (x.balance || 0), 0);
  const el = document.getElementById('sup-count'); if (el) el.textContent = getSuppliers().length;
  const elD = document.getElementById('sup-debt'); if (elD) elD.textContent = fmt(totalDebt) + ' ج';
  const tbody = document.getElementById('suppliersBody'); if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">لا يوجد موردون بعد — أضف أول مورد</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => `<tr>
    <td style="font-weight:600;">${s.name}</td>
    <td>${s.phone || '-'}</td>
    <td style="font-size:12px; color:var(--text-muted);">${s.address || '-'}</td>
    <td style="font-weight:600; color:${(s.balance||0)>0?'var(--danger)':'var(--success)'};">${fmt(s.balance||0)} ج</td>
    <td style="font-size:12px; color:var(--text-muted);">${s.notes || '-'}</td>
    <td>
      <button class="btn btn-sm" onclick="openSupplierModal('${s.id}')" style="font-size:11px; padding:3px 8px; margin-left:4px;">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${s.id}')" style="font-size:11px; padding:3px 8px;">🗑️</button>
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
    getSuppliers().map(s => `<option value="${s.id}" ${po?.supplierId===s.id?'selected':''}>${s.name}</option>`).join('');
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
    onmousedown="selectPOProduct('${i.code}','${i.name.replace(/'/g,"\\'")}',${i.cost||0})">
    <span style="font-weight:600;">${i.name}</span>
    <span style="color:var(--text-muted); font-size:11px; margin-right:8px;">${i.code}</span>
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
    <td style="font-size:13px;">${i.name}<br><span style="font-size:10px;color:var(--text-muted);">${i.code}</span></td>
    <td><input type="number" value="${i.qty}" min="1" style="width:60px;" class="form-control" style="padding:4px;"
      oninput="updatePOItem('${i.code}','qty',this.value)" /></td>
    <td><input type="number" value="${i.cost}" min="0" step="0.01" style="width:80px;" class="form-control" style="padding:4px;"
      oninput="updatePOItem('${i.code}','cost',this.value)" /></td>
    <td id="po-line-total-${i.code}" style="font-weight:600;">${fmt(i.qty*i.cost)} ج</td>
    <td><button class="btn btn-danger btn-sm" onclick="removePOItem('${i.code}')" style="padding:2px 6px; font-size:11px;">✕</button></td>
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
  if (!supplierId) { alert('اختر المورد أولاً'); return; }
  if (!_poItems.length) { alert('أضف صنف واحد على الأقل'); return; }
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
      <div><div style="font-size:11px;color:var(--text-muted);">المورد</div><div style="font-weight:700;">${po.supplierName}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted);">الفرع</div><div style="font-weight:700;">${getBranchName(po.branchId)}</div></div>
      <div><div style="font-size:11px;color:var(--text-muted);">الحالة</div><span style="background:${statusBg};color:${statusColor};padding:2px 10px;border-radius:10px;font-size:12px;">${statusLabel}</span></div>
      <div><div style="font-size:11px;color:var(--text-muted);">تاريخ الإنشاء</div><div style="font-size:12px;">${new Date(po.createdAt).toLocaleDateString('ar-EG')}</div></div>
      ${po.expectedDate?`<div><div style="font-size:11px;color:var(--text-muted);">موعد الاستلام</div><div style="font-size:12px;">${po.expectedDate}</div></div>`:''}
      ${po.receivedAt?`<div><div style="font-size:11px;color:var(--text-muted);">تاريخ الاستلام</div><div style="font-size:12px;color:var(--success);">${new Date(po.receivedAt).toLocaleDateString('ar-EG')}</div></div>`:''}
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:12px;">
      <thead><tr style="background:var(--bg);">
        <th style="padding:8px; text-align:right; border:1px solid var(--border);">الصنف</th>
        <th style="padding:8px; text-align:center; border:1px solid var(--border);">الكمية</th>
        <th style="padding:8px; text-align:center; border:1px solid var(--border);">التكلفة</th>
        <th style="padding:8px; text-align:center; border:1px solid var(--border);">الإجمالي</th>
      </tr></thead>
      <tbody>${po.items.map(i=>`<tr>
        <td style="padding:8px; border:1px solid var(--border);">${i.name}</td>
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
    ${po.notes?`<div style="margin-top:12px; padding:8px; background:#fffbeb; border-radius:6px; font-size:13px;">📝 ${po.notes}</div>`:''}
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
  if (!confirm(`استلام بضاعة أمر الشراء #${po.id.slice(-6)}؟\nسيتم تحديث مخزون فرع: ${getBranchName(po.branchId)}\nوتحديث تكلفة الأصناف بما في ذلك تكلفة الشحن الموزعة.`)) return;

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

  // Update PO status
  const list = getPurchases();
  const idx = list.findIndex(p => p.id === po.id);
  if (idx >= 0) { list[idx].status = 'received'; list[idx].receivedAt = Date.now(); list[idx].receivedBy = currentUser; }
  setPurchases(list);

  // Update supplier balance
  const supList = getSuppliers();
  const supIdx = supList.findIndex(s => s.id === po.supplierId);
  if (supIdx >= 0) { supList[supIdx].balance = (supList[supIdx].balance || 0) + po.total; }
  setSuppliers(supList);

  addAuditLog('po.receive', `استلام أمر شراء #${po.id.slice(-6)} — ${getBranchName(po.branchId)} — ${fmt(po.total)} ج`, po.branchId);
  closeModal('poDetailsModal');
  renderPurchasesPage();
  alert(`✅ تم الاستلام بنجاح!\nتم تحديث مخزون ${getBranchName(po.branchId)} وتكاليف الأصناف.`);
}

function deletePO(id) {
  if (!confirm('حذف أمر الشراء هذا؟')) return;
  setPurchases(getPurchases().filter(p => p.id !== id));
  renderPurchasesPage();
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
      getSuppliers().map(s => `<option value="${s.id}">${s.name}</option>`).join('');
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
  const elC = document.getElementById('po-count');    if (elC) elC.textContent = list.length;
  const elP = document.getElementById('po-pending');  if (elP) elP.textContent = pending;
  const elR = document.getElementById('po-received'); if (elR) elR.textContent = received;
  const elT = document.getElementById('po-total');    if (elT) elT.textContent = fmt(total) + ' ج';

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
      <td style="font-weight:600;">${po.supplierName}</td>
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

// ══════════════════════════════════════════════
// HR SYSTEM — TARGETS & COMMISSION
// ══════════════════════════════════════════════

const getHR = () => _hrCache;
function setHR(list) {
  _hrCache = list;
  DB.s('pos_hr', list);
  try { _db && _db.collection('pos_data').doc('hr').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function openHRTargetModal() {
  const today = new Date();
  const thisMonth = today.toISOString().slice(0,7);
  document.getElementById('hrTargetMonth').value = thisMonth;
  const salespeople = (getSalespeople ? getSalespeople() : (DB.g('pos_salespeople',[])))
    .map(sp => typeof sp === 'string' ? sp : sp.name);
  const hrList = getHR();
  const existing = hrList.find(h => h.month === thisMonth) || { targets: {} };
  const tbody = document.getElementById('hrTargetBody');
  if (!salespeople.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted" style="padding:16px;">لا يوجد بائعون — أضفهم من الإعدادات أولاً</td></tr>';
  } else {
    tbody.innerHTML = salespeople.map(name => `<tr>
      <td style="padding:8px; font-weight:600;">${name}</td>
      <td style="padding:8px;"><input type="number" class="form-control" id="hr-target-${name}" value="${existing.targets[name]?.target||0}" min="0" placeholder="0" /></td>
      <td style="padding:8px;"><input type="number" class="form-control" id="hr-comm-${name}" value="${existing.targets[name]?.commPct||0}" min="0" max="100" step="0.5" placeholder="0" /></td>
    </tr>`).join('');
  }
  document.getElementById('hrTargetModal').classList.remove('hidden');
}

function saveHRTargets() {
  const month = document.getElementById('hrTargetMonth').value;
  if (!month) { alert('اختر الشهر'); return; }
  const salespeople = (getSalespeople ? getSalespeople() : (DB.g('pos_salespeople',[])))
    .map(sp => typeof sp === 'string' ? sp : sp.name);
  const targets = {};
  salespeople.forEach(name => {
    targets[name] = {
      target:  parseFloat(document.getElementById(`hr-target-${name}`)?.value) || 0,
      commPct: parseFloat(document.getElementById(`hr-comm-${name}`)?.value) || 0
    };
  });
  const list = getHR().filter(h => h.month !== month);
  list.push({ month, targets, updatedAt: Date.now() });
  setHR(list);
  closeModal('hrTargetModal');
  renderHRPage();
}

function populateHRMonthFilter() {
  const sel = document.getElementById('hrMonthFilter'); if (!sel) return;
  const months = [...new Set(getHR().map(h=>h.month))].sort().reverse();
  const today = new Date().toISOString().slice(0,7);
  sel.innerHTML = `<option value="">الشهر الحالي (${today})</option>` +
    months.map(m => `<option value="${m}">${m}</option>`).join('');
}

function renderHRPage() {
  populateHRMonthFilter();
  const selMonth = document.getElementById('hrMonthFilter')?.value || new Date().toISOString().slice(0,7);
  const hrRec = getHR().find(h => h.month === selMonth) || { targets: {} };
  const targets = hrRec.targets || {};
  const salespeople = (getSalespeople ? getSalespeople() : (DB.g('pos_salespeople',[])))
    .map(sp => typeof sp === 'string' ? sp : sp.name);

  // Calculate actual sales per person for selected month
  const allSales = getSales().filter(s => !s.isReturn && s.date && s.date.slice(0,7) === selMonth);
  const salesBySP = {};
  allSales.forEach(s => {
    const sp = s.salesperson || 'غير محدد';
    salesBySP[sp] = (salesBySP[sp] || 0) + s.total;
  });

  // Build rows
  const rows = salespeople.map(name => {
    const t = targets[name] || { target: 0, commPct: 0 };
    const actual = salesBySP[name] || 0;
    const pct    = t.target > 0 ? Math.min((actual / t.target) * 100, 200) : 0;
    const commission = actual * (t.commPct / 100);
    return { name, target: t.target, commPct: t.commPct, actual, pct, commission };
  });
  // Add any salesperson who sold but isn't in the list
  Object.keys(salesBySP).forEach(name => {
    if (!rows.find(r => r.name === name)) {
      const actual = salesBySP[name];
      rows.push({ name, target: 0, commPct: 0, actual, pct: 0, commission: 0 });
    }
  });

  // Summary KPIs
  const totalTarget = rows.reduce((s,r)=>s+r.target,0);
  const totalSales  = rows.reduce((s,r)=>s+r.actual,0);
  const totalComm   = rows.reduce((s,r)=>s+r.commission,0);
  const achievePct  = totalTarget > 0 ? Math.round(totalSales/totalTarget*100) : 0;
  const el1 = document.getElementById('hr-total-target');    if (el1) el1.textContent = fmt(totalTarget) + ' ج';
  const el2 = document.getElementById('hr-total-sales');     if (el2) el2.textContent = fmt(totalSales) + ' ج';
  const el3 = document.getElementById('hr-achieve-pct');     if (el3) el3.textContent = achievePct + '%';
  const el4 = document.getElementById('hr-total-commission'); if (el4) el4.textContent = fmt(totalComm) + ' ج';

  // Render cards
  const container = document.getElementById('hrSalespeople'); if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<div class="card" style="text-align:center; padding:32px; color:var(--text-muted);">لا يوجد بائعون — أضفهم من الإعدادات</div>';
    return;
  }
  container.innerHTML = rows.map(r => {
    const barColor = r.pct >= 100 ? 'var(--success)' : r.pct >= 70 ? 'var(--warning)' : 'var(--danger)';
    const badge    = r.pct >= 100 ? '🏆 تجاوز الهدف!' : r.pct >= 70 ? '👍 جيد' : '⚠️ دون الهدف';
    return `<div class="card" style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div style="font-size:17px; font-weight:700;">👤 ${r.name}</div>
        <span style="background:${r.pct>=100?'#d1fae5':r.pct>=70?'#fef9c3':'#fee2e2'}; color:${r.pct>=100?'#065f46':r.pct>=70?'#92400e':'#991b1b'}; padding:4px 12px; border-radius:12px; font-size:13px;">${badge}</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin-bottom:14px;">
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">🎯 الهدف</div>
          <div style="font-size:18px; font-weight:700;">${fmt(r.target)} ج</div>
        </div>
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">💰 المبيعات الفعلية</div>
          <div style="font-size:18px; font-weight:700; color:var(--success);">${fmt(r.actual)} ج</div>
        </div>
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">📊 نسبة الإنجاز</div>
          <div style="font-size:18px; font-weight:700; color:${barColor};">${Math.round(r.pct)}%</div>
        </div>
        <div style="text-align:center; background:var(--bg); border-radius:8px; padding:10px;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">💸 العمولة (${r.commPct}%)</div>
          <div style="font-size:18px; font-weight:700; color:#7c3aed;">${fmt(r.commission)} ج</div>
        </div>
      </div>
      <!-- Progress bar -->
      <div style="background:#e5e7eb; border-radius:100px; height:12px; overflow:hidden;">
        <div style="background:${barColor}; width:${Math.min(r.pct,100)}%; height:100%; border-radius:100px; transition:width 0.5s ease;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:4px;">
        <span>0</span><span>${fmt(r.target)} ج</span>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// PROMOTIONS SYSTEM
// ══════════════════════════════════════════════
const getPromos = () => _promoCache;

function setPromos(list) {
  _promoCache = list;
  DB.s('pos_promos', list);
  try { _db && _db.collection('pos_data').doc('promotions').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

// ── Promo modal state ──
let _promoEditId   = null;
let _promoBundleItems = []; // [{code, name, minQty}]

function openPromoModal(id) {
  _promoEditId = id || null;
  _promoBundleItems = [];
  const promo = id ? getPromos().find(p => p.id === id) : null;
  document.getElementById('promoModalTitle').textContent = promo ? 'تعديل العرض' : 'إضافة عرض جديد';
  document.getElementById('promoName').value = promo?.name || '';
  const typeEl = document.getElementById('promoType');
  typeEl.value = promo?.type || 'bundle';
  if (promo?.type === 'bundle') {
    _promoBundleItems = promo.items ? JSON.parse(JSON.stringify(promo.items)) : [];
  }
  document.getElementById('promoBundlePrice').value   = promo?.bundlePrice || '';
  document.getElementById('promoMinAmount').value     = promo?.minAmount || '';
  document.getElementById('promoDiscType').value      = promo?.discountType || 'percent';
  document.getElementById('promoDiscValue').value     = promo?.discountValue || '';
  document.getElementById('promoCatDisc').value       = promo?.categoryDisc || '';
  document.getElementById('promoCatName').value       = promo?.categoryName || '';
  document.getElementById('promoBuyQty').value        = promo?.buyQty || 1;
  document.getElementById('promoGetQty').value        = promo?.getQty || 1;
  document.getElementById('promoStartDate').value     = promo?.startDate || '';
  document.getElementById('promoEndDate').value       = promo?.endDate || '';
  if (promo?.type === 'bxgy') _promoBundleItems = promo.items ? JSON.parse(JSON.stringify(promo.items)) : [];
  renderPromoBundleItems();
  togglePromoTypeUI();
  document.getElementById('promoModal').classList.remove('hidden');
}

function togglePromoTypeUI() {
  const type = document.getElementById('promoType').value;
  document.getElementById('bundleSection').classList.toggle('hidden', type !== 'bundle');
  document.getElementById('thresholdSection').classList.toggle('hidden', type !== 'threshold');
  document.getElementById('categorySection').classList.toggle('hidden', type !== 'category');
  document.getElementById('bxgySection').classList.toggle('hidden', type !== 'bxgy');
}

function renderPromoBundleItems() {
  const el = document.getElementById('promoBundleItemsList');
  if (!el) return;
  if (!_promoBundleItems.length) {
    el.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:8px;">لم يتم إضافة منتجات بعد</div>';
    return;
  }
  el.innerHTML = _promoBundleItems.map((bi, idx) => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border);">
      <span style="flex:1; font-size:13px;">${bi.name}</span>
      <span style="font-size:11px; color:var(--text-muted);">${bi.code}</span>
      <span style="font-size:12px;">كمية:</span>
      <input type="number" value="${bi.minQty}" min="1" style="width:52px; padding:3px 5px; border:1px solid var(--border); border-radius:4px; font-size:12px;"
        onchange="_promoBundleItems[${idx}].minQty = Math.max(1, parseInt(this.value)||1)" />
      <button onclick="_promoBundleItems.splice(${idx},1); renderPromoBundleItems();"
        style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:15px; padding:0 2px;">✕</button>
    </div>`).join('');
}

function addPromoProductSearch() {
  const q = document.getElementById('promoProdSearch').value.trim().toLowerCase();
  if (!q) return;
  const inv = getInv();
  const matches = inv.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  const dd = document.getElementById('promoProdDropdown');
  if (!matches.length) { dd.innerHTML = '<div style="padding:8px; font-size:12px; color:var(--text-muted);">لا نتائج</div>'; dd.classList.remove('hidden'); return; }
  dd.innerHTML = matches.slice(0,8).map(p => `
    <div style="padding:7px 10px; cursor:pointer; font-size:13px; border-bottom:1px solid #f0f0f0;"
      onmousedown="selectPromoProduct('${p.code}','${p.name.replace(/'/g,'')}')">
      <span>${p.name}</span> <span style="color:var(--text-muted); font-size:11px;">${p.code}</span>
    </div>`).join('');
  dd.classList.remove('hidden');
}

function selectPromoProduct(code, name) {
  document.getElementById('promoProdDropdown').classList.add('hidden');
  document.getElementById('promoProdSearch').value = '';
  if (_promoBundleItems.find(b => b.code === code)) return; // already added
  _promoBundleItems.push({ code, name, minQty: 1 });
  renderPromoBundleItems();
}

function savePromo() {
  const name = document.getElementById('promoName').value.trim();
  const type = document.getElementById('promoType').value;
  if (!name) { alert('أدخل اسم العرض'); return; }

  const startDate = document.getElementById('promoStartDate').value;
  const endDate   = document.getElementById('promoEndDate').value;
  let promo = { id: _promoEditId || Date.now(), name, type, active: true };
  if (startDate) promo.startDate = startDate;
  if (endDate)   promo.endDate   = endDate;

  if (type === 'bundle') {
    if (_promoBundleItems.length < 2) { alert('أضف منتجين على الأقل للحزمة'); return; }
    const bPrice = parseFloat(document.getElementById('promoBundlePrice').value);
    if (!bPrice || bPrice <= 0) { alert('أدخل سعر الحزمة'); return; }
    promo.items       = _promoBundleItems.map(b => ({...b}));
    promo.bundlePrice = bPrice;
  } else if (type === 'threshold') {
    const minAmt  = parseFloat(document.getElementById('promoMinAmount').value);
    const dType   = document.getElementById('promoDiscType').value;
    const dVal    = parseFloat(document.getElementById('promoDiscValue').value);
    if (!minAmt || minAmt <= 0) { alert('أدخل الحد الأدنى للفاتورة'); return; }
    if (!dVal  || dVal <= 0)   { alert('أدخل قيمة الخصم'); return; }
    promo.minAmount    = minAmt;
    promo.discountType = dType;
    promo.discountValue = dVal;
  } else if (type === 'category') {
    const catName = document.getElementById('promoCatName').value.trim();
    const catDisc = parseFloat(document.getElementById('promoCatDisc').value);
    if (!catName) { alert('أدخل اسم الفئة'); return; }
    if (!catDisc || catDisc <= 0 || catDisc > 100) { alert('أدخل نسبة الخصم (1-100)'); return; }
    promo.categoryName = catName;
    promo.categoryDisc = catDisc;
  } else if (type === 'bxgy') {
    if (!_promoBundleItems.length) { alert('أضف المنتج المطلوب شراؤه'); return; }
    const buyQty = parseInt(document.getElementById('promoBuyQty').value) || 1;
    const getQty = parseInt(document.getElementById('promoGetQty').value) || 1;
    promo.items  = _promoBundleItems.map(b => ({...b}));
    promo.buyQty = buyQty;
    promo.getQty = getQty;
  }

  const list = getPromos();
  const idx  = list.findIndex(p => p.id === promo.id);
  if (idx >= 0) list[idx] = promo; else list.push(promo);
  setPromos(list);
  document.getElementById('promoModal').classList.add('hidden');
  renderPromosPage();
}

function deletePromo(id) {
  if (!confirm('حذف هذا العرض؟')) return;
  setPromos(getPromos().filter(p => p.id !== id));
  renderPromosPage();
}

function togglePromoActive(id) {
  const list = getPromos();
  const p = list.find(x => x.id === id);
  if (p) { p.active = !p.active; setPromos(list); renderPromosPage(); }
}

function renderPromosPage() {
  const bundles    = getPromos().filter(p => p.type === 'bundle');
  const thresholds = getPromos().filter(p => p.type === 'threshold');
  const categories = getPromos().filter(p => p.type === 'category');
  const bxgys      = getPromos().filter(p => p.type === 'bxgy');
  const canEdit    = currentUser === 'admin';

  const promoCard = (p) => {
    const inv = getInv();
    let detail = '';
    if (p.type === 'bundle') {
      const itemsTotal = (p.items || []).reduce((s, bi) => {
        const ip = inv.find(x => x.code === bi.code);
        return s + (ip ? ip.priceAfter * bi.minQty : 0);
      }, 0);
      const saving = Math.max(0, itemsTotal - p.bundlePrice);
      detail = `<div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
        ${(p.items||[]).map(bi => `${bi.name} ×${bi.minQty}`).join(' + ')}
      </div>
      <div style="font-size:13px; margin-top:6px;">
        سعر الحزمة: <strong>${fmt(p.bundlePrice)} ج</strong>
        ${saving > 0 ? `<span style="color:var(--success); margin-right:8px;">وفر ${fmt(saving)} ج</span>` : ''}
      </div>`;
    } else if (p.type === 'threshold') {
      const discLabel = p.discountType === 'percent' ? `${p.discountValue}%` : `${fmt(p.discountValue)} ج`;
      detail = `<div style="font-size:13px; margin-top:6px;">عند فاتورة ≥ <strong>${fmt(p.minAmount)} ج</strong> — خصم <strong>${discLabel}</strong></div>`;
    } else if (p.type === 'category') {
      detail = `<div style="font-size:13px; margin-top:6px;">خصم <strong>${p.categoryDisc}%</strong> على فئة: <strong>${p.categoryName}</strong></div>`;
    } else if (p.type === 'bxgy') {
      detail = `<div style="font-size:13px; margin-top:6px;">اشتري <strong>${p.buyQty}</strong> من ${(p.items||[]).map(i=>i.name).join('+')} — خد <strong>${p.getQty}</strong> مجاناً</div>`;
    }
    const dateRange = (p.startDate || p.endDate) ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">📅 ${p.startDate||'—'} → ${p.endDate||'—'}</div>` : '';
    return `<div style="border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:10px; opacity:${p.active ? 1 : 0.55};">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div style="flex:1;">
          <div style="font-weight:700; font-size:15px;">${p.name}
            ${p.active ? '<span style="background:#d1fae5; color:#065f46; font-size:11px; padding:2px 7px; border-radius:99px; margin-right:6px;">نشط</span>'
                       : '<span style="background:#f3f4f6; color:#6b7280; font-size:11px; padding:2px 7px; border-radius:99px; margin-right:6px;">متوقف</span>'}
          </div>
          ${detail}${dateRange}
        </div>
        ${canEdit ? `<div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="btn btn-sm ${p.active ? 'btn-gray' : 'btn-success'}" onclick="togglePromoActive(${p.id})">${p.active ? 'إيقاف' : 'تفعيل'}</button>
          <button class="btn btn-sm btn-gray" onclick="openPromoModal(${p.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="deletePromo(${p.id})">🗑️</button>
        </div>` : ''}
      </div>
    </div>`;
  };

  const bEl = document.getElementById('bundlesBody');
  const tEl = document.getElementById('thresholdsBody');
  if (bEl) bEl.innerHTML = bundles.length ? bundles.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد حزم بعد</div>';
  if (tEl) tEl.innerHTML = thresholds.length ? thresholds.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد خصومات بعد</div>';
  const cEl = document.getElementById('categoriesBody');
  const xEl = document.getElementById('bxgyBody');
  if (cEl) cEl.innerHTML = categories.length ? categories.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد خصومات فئات بعد</div>';
  if (xEl) xEl.innerHTML = bxgys.length ? bxgys.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد عروض اشتري وخد بعد</div>';
  // Admin-only: hide add button if cashier
  const addBtn = document.getElementById('addPromoBtn');
  if (addBtn) addBtn.style.display = currentUser === 'admin' ? '' : 'none';
}

// ── Cart promo detection ──
function calcPromoDiscount(promo) {
  if (promo.type === 'bundle') {
    const bundleItemsTotal = (promo.items || []).reduce((s, bi) => {
      const ci = cart.find(c => c.code === bi.code);
      return s + (ci ? ci.price * bi.minQty : 0);
    }, 0);
    return Math.max(0, bundleItemsTotal - promo.bundlePrice);
  }
  if (promo.type === 'threshold') {
    const sub = cart.reduce((s,i) => s + i.price * i.qty, 0);
    if (promo.discountType === 'percent') return Math.min(sub * promo.discountValue / 100, sub);
    return Math.min(promo.discountValue, sub);
  }
  if (promo.type === 'category') {
    const disc = cart.filter(i => (i.category||i.name||'').toLowerCase().includes((promo.categoryName||'').toLowerCase()))
      .reduce((s,i) => s + i.price * i.qty * promo.categoryDisc / 100, 0);
    return Math.max(0, disc);
  }
  if (promo.type === 'bxgy') {
    const allMatch = (promo.items||[]).every(bi => {
      const ci = cart.find(c => c.code === bi.code);
      return ci && ci.qty >= (promo.buyQty || 1);
    });
    if (!allMatch) return 0;
    return (promo.items||[]).reduce((s,bi) => {
      const ci = cart.find(c => c.code === bi.code);
      return s + (ci ? ci.price * (promo.getQty||1) : 0);
    }, 0);
  }
  return 0;
}

function detectEligiblePromos() {
  const sub = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const applied = new Set((cart._appliedPromos || []).map(p => p.id));
  return getPromos().filter(promo => {
    if (!promo.active) return false;
    if (applied.has(promo.id)) return false;
    // date range check
    const today = new Date().toISOString().slice(0,10);
    if (promo.startDate && today < promo.startDate) return false;
    if (promo.endDate   && today > promo.endDate)   return false;
    if (promo.type === 'bundle') {
      return (promo.items || []).every(bi => {
        const ci = cart.find(c => c.code === bi.code);
        return ci && ci.qty >= bi.minQty;
      });
    }
    if (promo.type === 'threshold') return sub >= promo.minAmount;
    if (promo.type === 'category')  return cart.some(i => (i.category||i.name||'').toLowerCase().includes((promo.categoryName||'').toLowerCase()));
    if (promo.type === 'bxgy') {
      return (promo.items||[]).every(bi => {
        const ci = cart.find(c => c.code === bi.code);
        return ci && ci.qty >= (promo.buyQty||1);
      });
    }
    return false;
  });
}

function applyPromo(id) {
  const promo = getPromos().find(p => p.id === id); if (!promo) return;
  const discAmt = calcPromoDiscount(promo);
  if (discAmt <= 0) { alert('هذا العرض لا يوفر خصماً على الفاتورة الحالية'); return; }
  if (!cart._appliedPromos) cart._appliedPromos = [];
  cart._appliedPromos.push({ id: promo.id, name: promo.name, discAmt });
  updateCartUI();
}

function removeAppliedPromo(id) {
  if (!cart._appliedPromos) return;
  cart._appliedPromos = cart._appliedPromos.filter(p => String(p.id) !== String(id));
  updateCartUI();
}

function renderEligiblePromos() {
  const el = document.getElementById('promoEligibleSection'); if (!el) return;
  if (!cart.length) { el.innerHTML = ''; return; }
  const eligible = detectEligiblePromos();
  if (!eligible.length) { el.innerHTML = ''; return; }
  el.innerHTML = eligible.map(promo => {
    const disc = calcPromoDiscount(promo);
    const badge = promo.type === 'bundle' ? '📦' : '💰';
    return `<div style="background:#faf5ff; border:1px dashed #7c3aed; border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
        <span>${badge} <strong>${promo.name}</strong> — وفر ${fmt(disc)} ج</span>
        <button class="btn btn-sm btn-primary" style="padding:3px 10px; font-size:11px;" onclick="applyPromo(${promo.id})">تطبيق</button>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// #1 CRM — CUSTOMERS
// ══════════════════════════════════════════════
let _customersCache = [];
let _promoCache     = [];
const getCustomers = () => _customersCache;

function setCustomers(list) {
  _customersCache = list;
  if (!_fbReady) { DB.s('pos_customers', list); return; }
  _db.collection('pos_data').doc('customers')
     .set({ items: list, updatedAt: Date.now() })
     .catch(e => console.error('Firestore setCustomers:', e));
}

function renderCustomers() {
  const q = (document.getElementById('custSearch')?.value || '').toLowerCase();
  const custs = getCustomers();
  const thresh = _settingsCache.vipThreshold || 1000;
  const items = q ? custs.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)) : custs;

  const vipCount   = custs.filter(c => (c.totalSpent||0) >= 5000).length;
  const totalSpent = custs.reduce((s,c) => s + (c.totalSpent||0), 0);
  const totalPts   = custs.reduce((s,c) => s + (c.loyaltyPoints||0), 0);
  const countEl = document.getElementById('cust-count'); if (countEl) countEl.textContent = custs.length;
  const vipEl   = document.getElementById('cust-vip');   if (vipEl)   vipEl.textContent   = vipCount;
  const spentEl = document.getElementById('cust-spent'); if (spentEl) spentEl.textContent = fmt(totalSpent)+' ج';
  const ptsEl   = document.getElementById('cust-pts');   if (ptsEl)   ptsEl.textContent   = totalPts+' نقطة';

  const tbody = document.getElementById('customersBody'); if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:40px;">لا يوجد عملاء — أضف عميلاً جديداً</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(c => {
    const spent = c.totalSpent || 0;
    const pts   = c.loyaltyPoints || 0;
    let tier, tierColor, tierBg;
    if (spent >= 20000)      { tier='💎 بلاتيني'; tierColor='#4c1d95'; tierBg='#ede9fe'; }
    else if (spent >= 5000)  { tier='🥇 ذهبي';   tierColor='#78350f'; tierBg='#fef3c7'; }
    else if (spent >= 1000)  { tier='🥈 فضي';    tierColor='#1e3a5f'; tierBg='#dbeafe'; }
    else                     { tier='🥉 برونزي';  tierColor='#4b3320'; tierBg='#fde8d0'; }
    return `<tr>
      <td><strong style="cursor:pointer;color:var(--primary);" onclick="openCustomerProfile('${c.id}')">${c.name}</strong></td>
      <td>${c.phone||'-'}</td>
      <td>${c.visits||0}</td>
      <td>${fmt(spent)} ج</td>
      <td><span style="font-weight:700;color:#059669;">${pts} نقطة</span></td>
      <td><span style="background:${tierBg};color:${tierColor};padding:2px 8px;border-radius:20px;font-size:11px;">${tier}</span></td>
      <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString('ar-EG') : '-'}</td>
      <td>
        <button class="btn btn-sm" style="background:#e0f2fe;color:#0369a1;" onclick="openCustomerProfile('${c.id}')" title="الملف الكامل">👁️</button>
        <button class="btn btn-gray btn-sm" onclick="openCustomerModal('${c.id}')" style="margin:0 3px;">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function openCustomerModal(id) {
  const c = id ? getCustomers().find(x => x.id === id) : null;
  document.getElementById('custModalTitle').textContent = c ? 'تعديل عميل' : 'إضافة عميل جديد';
  document.getElementById('custEditId').value  = c ? c.id   : '';
  document.getElementById('cust-name').value   = c ? c.name : '';
  document.getElementById('cust-phone').value  = c ? (c.phone||'')  : '';
  document.getElementById('cust-notes').value  = c ? (c.notes||'')  : '';
  document.getElementById('customerModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('cust-name').focus(), 100);
}

function saveCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  if (!name) { alert('الاسم مطلوب'); return; }
  const editId = document.getElementById('custEditId').value;
  const list   = getCustomers();
  if (editId) {
    const c = list.find(x => x.id === editId);
    if (c) {
      c.name  = name;
      c.phone = document.getElementById('cust-phone').value.trim();
      c.notes = document.getElementById('cust-notes').value.trim();
    }
  } else {
    list.push({
      id:         'C' + Date.now().toString(36).toUpperCase().slice(-8),
      name,
      phone:      document.getElementById('cust-phone').value.trim(),
      notes:      document.getElementById('cust-notes').value.trim(),
      createdAt:  new Date().toISOString(),
      totalSpent: 0,
      visits:     0
    });
  }
  setCustomers(list);
  document.getElementById('customerModal').classList.add('hidden');
  renderCustomers();
}

function deleteCustomer(id) {
  if (!confirm('حذف هذا العميل؟')) return;
  setCustomers(getCustomers().filter(c => c.id !== id));
  renderCustomers();
}

function openCustomerProfile(id) {
  const c = getCustomers().find(x => x.id === id);
  if (!c) return;
  const allSales = getSales().filter(s => !s.isReturn && (s.customerId === id || s.customerPhone === c.phone));
  const spent  = allSales.reduce((a,s) => a+s.total, 0);
  const visits = allSales.length;
  const pts    = c.loyaltyPoints || 0;
  const loyDisc = calcLoyaltyRedemption(pts);

  // tier
  let tier, tierColor, tierBg;
  if (spent >= 20000)      { tier='💎 بلاتيني'; tierColor='#4c1d95'; tierBg='#ede9fe'; }
  else if (spent >= 5000)  { tier='🥇 ذهبي';   tierColor='#78350f'; tierBg='#fef3c7'; }
  else if (spent >= 1000)  { tier='🥈 فضي';    tierColor='#1e3a5f'; tierBg='#dbeafe'; }
  else                     { tier='🥉 برونزي';  tierColor='#4b3320'; tierBg='#fde8d0'; }

  // top products
  const prodMap = {};
  allSales.forEach(s => (s.items||[]).forEach(i => {
    prodMap[i.name] = (prodMap[i.name]||0) + i.qty;
  }));
  const topProds = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const lastSale = allSales.sort((a,b)=>b.id-a.id)[0];

  const el = document.getElementById('custProfileModal');
  document.getElementById('cpBody').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
      <div style="width:54px;height:54px;border-radius:50%;background:#1a5faf;color:white;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0;">
        ${c.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <div style="font-size:18px;font-weight:700;">${c.name}</div>
        <div style="font-size:13px;color:var(--text-muted);">${c.phone||'لا يوجد هاتف'}</div>
        <span style="background:${tierBg};color:${tierColor};padding:2px 10px;border-radius:20px;font-size:12px;margin-top:4px;display:inline-block;">${tier}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      ${[
        {label:'إجمالي الإنفاق', val:fmt(spent)+' ج', bg:'#dcfce7', tc:'#15803d'},
        {label:'عدد الزيارات',   val:visits,           bg:'#eff6ff', tc:'#1d4ed8'},
        {label:'نقاط الولاء',    val:pts+' نقطة',      bg:'#fef9c3', tc:'#854d0e'},
        {label:'قيمة النقاط',    val:fmt(loyDisc)+' ج',bg:'#fce7f3', tc:'#9d174d'},
      ].map(k=>`<div style="background:${k.bg};border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:16px;font-weight:700;color:${k.tc};">${k.val}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${k.label}</div>
      </div>`).join('')}
    </div>

    ${topProds.length ? `
    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🏆 أكثر المنتجات شراءً</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${topProds.map(([name,qty],i)=>`<span style="background:white;border:1px solid var(--border);border-radius:20px;padding:3px 10px;font-size:12px;">${i+1}. ${name} <strong style="color:var(--primary);">×${qty}</strong></span>`).join('')}
      </div>
    </div>` : ''}

    ${c.notes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;">📝 ${c.notes}</div>` : ''}

    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🧾 آخر الفواتير</div>
    <div style="max-height:220px;overflow-y:auto;">
      ${allSales.slice(0,20).map(s=>{
        const d = new Date(s.date).toLocaleDateString('ar-EG');
        const t = new Date(s.date).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
        const preview = (s.items||[]).slice(0,2).map(i=>i.name).join('، ');
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-radius:6px;background:var(--bg-secondary);margin-bottom:4px;gap:8px;">
          <div>
            <span style="font-size:12px;font-weight:700;color:var(--primary);">#${String(s.id).slice(-6)}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-inline-start:6px;">${d} ${t}</span>
            <div style="font-size:11px;color:var(--text-muted);">${preview}</div>
          </div>
          <span style="font-weight:700;font-size:13px;flex-shrink:0;">${fmt(s.total)} ج</span>
        </div>`;
      }).join('') || '<p style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد فواتير</p>'}
    </div>
  `;
  el.classList.remove('hidden');
}


// ── Customer search in payment modal ──
let _custDDTimer = null;
function searchCustomerDD() {
  clearTimeout(_custDDTimer);
  _custDDTimer = setTimeout(() => {
    const q  = (document.getElementById('payCustomerSearch')?.value||'').trim().toLowerCase();
    const dd = document.getElementById('customerDropdown');
    if (!dd) return;
    if (!q) { dd.classList.add('hidden'); dd.innerHTML=''; return; }
    const thresh  = _settingsCache.vipThreshold || 1000;
    const results = getCustomers().filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)
    ).slice(0, 6);
    if (!results.length) {
      dd.innerHTML = '<div class="customer-dd-item" style="color:var(--text-muted);">لا توجد نتائج</div>';
    } else {
      dd.innerHTML = results.map(c =>
        `<div class="customer-dd-item" onclick="selectCustomer('${c.id}')">
          <strong>${c.name}</strong>${c.phone ? ' — ' + c.phone : ''}
          ${(c.totalSpent||0) >= thresh ? ' <span class="vip-badge" style="font-size:9px;padding:1px 5px;">VIP</span>' : ''}
        </div>`
      ).join('');
    }
    dd.classList.remove('hidden');
  }, 200);
}

function selectCustomer(id) {
  const c = getCustomers().find(x => x.id === id); if (!c) return;
  document.getElementById('selectedCustomerId').value      = id;
  document.getElementById('selectedCustomerName').textContent = c.name + (c.phone ? ' — '+c.phone : '');
  document.getElementById('selectedCustomerBox').classList.remove('hidden');
  document.getElementById('payCustomerSearch').value = '';
  document.getElementById('customerDropdown').classList.add('hidden');
}

function clearSelectedCustomer() {
  document.getElementById('selectedCustomerId').value = '';
  document.getElementById('selectedCustomerBox')?.classList.add('hidden');
  document.getElementById('payCustomerSearch').value = '';
}

function updateCustomerAfterSale(customerId, amount) {
  if (!customerId) return;
  const list = getCustomers();
  const c    = list.find(x => x.id === customerId); if (!c) return;
  c.totalSpent = (c.totalSpent||0) + amount;
  c.visits     = (c.visits||0)     + 1;
  c.lastVisit  = new Date().toISOString();
  setCustomers(list);
}

// ══════════════════════════════════════════════
// #2 RETURNS
// ══════════════════════════════════════════════
let _returnOriginalSale = null;

function openReturnFromModal() {
  if (!lastSaleForPrint) return;
  if (lastSaleForPrint.isReturn) { alert('لا يمكن إرجاع فاتورة مرتجعة'); return; }
  _returnOriginalSale = lastSaleForPrint;
  document.getElementById('returnReason').value = '';
  document.getElementById('returnSummary').style.display = 'none';
  document.getElementById('returnItemsList').innerHTML = lastSaleForPrint.items.map((item, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${item.name}</div>
        <div style="font-size:11px;color:var(--text-muted);">سعر الوحدة: ${fmt(item.price)} ج · الكمية الأصلية: ${item.qty}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <label style="font-size:12px;color:var(--text-muted);">كمية الإرجاع:</label>
        <input type="number" class="form-control" id="ret-qty-${idx}"
          value="0" min="0" max="${item.qty}" style="width:70px;text-align:center;"
          oninput="calcReturnTotal()" />
      </div>
    </div>`).join('');
  calcReturnTotal();
  document.getElementById('returnModal').classList.remove('hidden');
}

function calcReturnTotal() {
  if (!_returnOriginalSale) return;
  let total = 0;
  _returnOriginalSale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('ret-qty-'+idx)?.value)||0;
    total += qty * item.price;
  });
  const sumEl = document.getElementById('returnSummary');
  const totEl = document.getElementById('returnTotalDisplay');
  if (sumEl && totEl) { totEl.textContent = fmt(total); sumEl.style.display = total > 0 ? 'block' : 'none'; }
}

function processReturn() {
  if (!_returnOriginalSale) return;
  const sale = _returnOriginalSale;
  const reason = document.getElementById('returnReason').value.trim();
  const returnItems = [];
  let returnTotal = 0;
  sale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('ret-qty-'+idx)?.value)||0;
    if (qty > 0) { returnItems.push({...item, qty:-qty}); returnTotal += qty * item.price; }
  });
  if (!returnItems.length) { alert('اختر على الأقل صنف واحد للإرجاع'); return; }
  if (!confirm(`تأكيد إرجاع ${returnItems.length} صنف — المبلغ المسترد: ${fmt(returnTotal)} ج؟`)) return;

  // Restock
  const inv = getInv();
  returnItems.forEach(ri => { const p = inv.find(x=>x.code===ri.code); if (p) p.qty += Math.abs(ri.qty); });
  setInv(inv);

  // Save return sale
  const returnSale = {
    id:             Date.now(),
    date:           new Date().toISOString(),
    isReturn:       true,
    originalSaleId: sale.id,
    returnReason:   reason || 'غير محدد',
    cashier:        currentUser === 'admin' ? 'مدير' : 'كاشير',
    salesperson:    sale.salesperson || '',
    items:          returnItems,
    sub:            -returnTotal,
    disc:           0,
    total:          -returnTotal,
    paid:           -returnTotal,
    change:         0,
    payMethod:      'return'
  };
  addSale(returnSale);

  document.getElementById('returnModal').classList.add('hidden');
  document.getElementById('saleDetailModal').classList.add('hidden');
  alert(`✅ تم معالجة المرتجع — المبلغ المسترد: ${fmt(returnTotal)} ج\n📦 تم إعادة الكميات للمخزون`);
  if (!document.getElementById('page-sales').classList.contains('hidden')) renderSales();
  if (!document.getElementById('page-inventory').classList.contains('hidden')) renderInventory();
}

function buildReturnsReport() {
  const period = document.getElementById('rptReturnsPeriod').value;
  document.getElementById('rptReturnsCustom').classList.toggle('hidden', period!=='custom');
  const { from, to } = getDateRange(period, 'rptReturnsFrom', 'rptReturnsTo');
  const rbf = document.getElementById('rptReturnsBranchFilter');
  if (rbf && rbf.options.length <= 1) {
    const branches = getBranches();
    BRANCH_IDS.forEach(b => {
      if (!rbf.querySelector(`option[value="${b}"]`)) {
        const o = document.createElement('option'); o.value = b; o.textContent = branches[b]||BRANCH_DEFAULTS[b];
        rbf.appendChild(o);
      }
    });
  }
  const branchFilter = rbf?.value || 'all';
  const returns = getSales().filter(s => {
    if (!s.isReturn) return false;
    if (branchFilter !== 'all' && s.branchId !== branchFilter) return false;
    const d = new Date(s.date); return d >= from && d <= to;
  });
  const count = returns.length;
  const total = returns.reduce((s,r) => s + Math.abs(r.total), 0);
  const units = returns.reduce((s,r) => s + r.items.reduce((a,i) => a + Math.abs(i.qty), 0), 0);
  document.getElementById('ret-count').textContent = count;
  document.getElementById('ret-total').textContent = fmt(total)+' ج';
  document.getElementById('ret-units').textContent = units;
  document.getElementById('ret-body').innerHTML = !returns.length
    ? '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">لا توجد مرتجعات في هذه الفترة</td></tr>'
    : returns.sort((a,b) => new Date(b.date)-new Date(a.date)).map(r => `<tr>
        <td><span class="badge-return">مرتجع #${String(r.id).slice(-6)}</span></td>
        <td style="white-space:nowrap;">${new Date(r.date).toLocaleString('ar-EG')}</td>
        <td>${r.originalSaleId ? '#'+String(r.originalSaleId).slice(-6) : '-'}</td>
        <td>${r.items.map(i=>i.name+' ×'+Math.abs(i.qty)).join(' · ')}</td>
        <td style="color:var(--danger);font-weight:700;">${fmt(Math.abs(r.total))} ج</td>
        <td>${r.returnReason||'-'}</td>
      </tr>`).join('');
}

// ══════════════════════════════════════════════
// ABC ANALYSIS
// ══════════════════════════════════════════════
let _abcData = []; // full classified list for filter




// ══════════════════════════════════════════════
// EXPENSE TRACKING
// ══════════════════════════════════════════════

const EXP_CATS = { rent:'إيجار', electricity:'كهرباء', water:'مياه', internet:'إنترنت/تليفون', salaries:'رواتب', maintenance:'صيانة', marketing:'تسويق', transport:'نقل/شحن', other:'أخرى' };
const EXP_ICONS = { rent:'🏠', electricity:'⚡', water:'💧', internet:'🌐', salaries:'👤', maintenance:'🔧', marketing:'📢', transport:'🚚', other:'📌' };

const getExpenses = () => _expensesCache;
function setExpenses(list) {
  _expensesCache = list;
  DB.s('pos_expenses', list);
  try { _db && _db.collection('pos_data').doc('expenses').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function openExpenseModal(id) {
  const exp = id ? getExpenses().find(e => e.id === id) : null;
  document.getElementById('expModalTitle').textContent = exp ? '✏️ تعديل مصروف' : '➕ إضافة مصروف';
  document.getElementById('expEditId').value    = exp?.id || '';
  document.getElementById('expType').value      = exp?.type || 'branch';
  document.getElementById('expCategory').value  = exp?.category || 'rent';
  document.getElementById('expAmount').value    = exp?.amount || '';
  document.getElementById('expDate').value      = exp?.date || new Date().toISOString().slice(0,10);
  document.getElementById('expNote').value      = exp?.note || '';
  // Populate branch select
  const brSel = document.getElementById('expBranchId');
  brSel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}" ${exp?.branchId===b?'selected':''}>${getBranchName(b)}</option>`).join('');
  toggleExpBranch();
  document.getElementById('expenseModal').classList.remove('hidden');
}

function toggleExpBranch() {
  const isCompany = document.getElementById('expType').value === 'company';
  document.getElementById('expBranchGroup').style.display = isCompany ? 'none' : '';
}

function saveExpense() {
  const amount = parseFloat(document.getElementById('expAmount').value);
  const date   = document.getElementById('expDate').value;
  if (!amount || amount <= 0) { alert('أدخل مبلغ صحيح'); return; }
  if (!date) { alert('أدخل التاريخ'); return; }
  const type     = document.getElementById('expType').value;
  const editId   = document.getElementById('expEditId').value;
  const list     = getExpenses();
  const rec = {
    id:       editId || 'exp_' + Date.now(),
    type,
    branchId: type === 'branch' ? document.getElementById('expBranchId').value : null,
    category: document.getElementById('expCategory').value,
    amount,
    date,
    month:    date.slice(0,7),
    note:     document.getElementById('expNote').value.trim(),
    by:       currentUser,
    createdAt: editId ? (list.find(e=>e.id===editId)?.createdAt||Date.now()) : Date.now()
  };
  if (editId) { const idx=list.findIndex(e=>e.id===editId); if(idx>=0) list[idx]=rec; else list.push(rec); }
  else list.push(rec);
  setExpenses(list);
  addAuditLog('expense.add', `مصروف: ${EXP_CATS[rec.category]} — ${fmt(rec.amount)} ج ${rec.type==='company'?'(إداري)':'('+(rec.branchId?getBranchName(rec.branchId):'')+')'}`, null);
  closeModal('expenseModal');
  renderExpensesPage();
  buildDashboard();
}

function deleteExpense(id) {
  if (!confirm('حذف هذا المصروف؟')) return;
  setExpenses(getExpenses().filter(e => e.id !== id));
  renderExpensesPage();
  buildDashboard();
}

function renderExpensesPage() {
  // Populate month filter
  const monthSel = document.getElementById('expMonthFilter');
  if (monthSel) {
    const months = [...new Set(getExpenses().map(e=>e.month))].sort().reverse();
    const cur = monthSel.value;
    monthSel.innerHTML = '<option value="">الشهر الحالي</option>' + months.map(m=>`<option value="${m}" ${m===cur?'selected':''}>${m}</option>`).join('');
  }
  // Populate branch filter
  const brSel = document.getElementById('expBranchFilter');
  if (brSel && brSel.options.length <= 2) {
    BRANCH_IDS.forEach(b => {
      const o = document.createElement('option'); o.value=b; o.textContent='🏬 '+getBranchName(b);
      brSel.appendChild(o);
    });
  }
  const selMonth  = document.getElementById('expMonthFilter')?.value  || new Date().toISOString().slice(0,7);
  const selBranch = document.getElementById('expBranchFilter')?.value || '';
  let list = getExpenses().filter(e => e.month === selMonth);
  if (selBranch === 'company') list = list.filter(e => e.type === 'company');
  else if (selBranch) list = list.filter(e => e.type === 'branch' && e.branchId === selBranch);

  const totalAll   = list.reduce((s,e)=>s+e.amount,0);
  const totalBr    = list.filter(e=>e.type==='branch').reduce((s,e)=>s+e.amount,0);
  const totalCo    = list.filter(e=>e.type==='company').reduce((s,e)=>s+e.amount,0);

  // Net profit = month gross profit - expenses
  const monthSales  = getSales().filter(s=>!s.isReturn && s.date && s.date.slice(0,7)===selMonth);
  const inv = Object.values(_invCacheByBranch).flat();
  const grossProfit = monthSales.reduce((acc,s)=>acc+s.items.reduce((a,i)=>{
    const c=i.cost>0?i.cost:(inv.find(x=>x.code===i.code)?.cost||0); return a+(i.price-c)*i.qty; },0)-s.disc, 0);
  const netProfit = grossProfit - totalAll;

  const el1=document.getElementById('exp-total');    if(el1) el1.textContent=fmt(totalAll)+' ج';
  const el2=document.getElementById('exp-branches'); if(el2) el2.textContent=fmt(totalBr)+' ج';
  const el3=document.getElementById('exp-company');  if(el3) el3.textContent=fmt(totalCo)+' ج';
  const el4=document.getElementById('exp-net-profit'); if(el4) { el4.textContent=fmt(netProfit)+' ج'; el4.style.color=netProfit>=0?'var(--success)':'var(--danger)'; }

  // Branch breakdown cards
  const breakdown = document.getElementById('expBranchBreakdown');
  if (breakdown) {
    const allMonthExp = getExpenses().filter(e=>e.month===selMonth);
    breakdown.innerHTML = BRANCH_IDS.map(b => {
      const bExp = allMonthExp.filter(e=>e.type==='branch'&&e.branchId===b).reduce((s,e)=>s+e.amount,0);
      const bSales = getSales().filter(s=>!s.isReturn&&s.date&&s.date.slice(0,7)===selMonth&&s.branchId===b).reduce((s,x)=>s+x.total,0);
      return `<div class="stat-card" style="border-top:3px solid var(--primary);">
        <div style="font-weight:700; font-size:13px; margin-bottom:6px;">🏬 ${getBranchName(b)}</div>
        <div style="font-size:12px; color:var(--text-muted);">مصاريف: <strong style="color:var(--danger);">${fmt(bExp)} ج</strong></div>
        <div style="font-size:12px; color:var(--text-muted);">مبيعات: <strong style="color:var(--success);">${fmt(bSales)} ج</strong></div>
      </div>`;
    }).join('');
  }

  // Table
  const tbody = document.getElementById('expensesBody'); if(!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">لا توجد مصاريف لهذا الشهر</td></tr>'; return;
  }
  const sorted = [...list].sort((a,b)=>b.date.localeCompare(a.date));
  tbody.innerHTML = sorted.map(e => `<tr>
    <td style="white-space:nowrap; font-size:12px;">${e.date}</td>
    <td><span style="background:${e.type==='company'?'#f3e8ff':'#dbeafe'};color:${e.type==='company'?'#7c3aed':'#1d4ed8'};padding:2px 8px;border-radius:10px;font-size:11px;">${e.type==='company'?'🏢 إداري':'🏬 فرع'}</span></td>
    <td style="font-size:12px;">${e.type==='company'?'شركة':getBranchName(e.branchId)}</td>
    <td><span style="font-size:12px;">${EXP_ICONS[e.category]||''} ${EXP_CATS[e.category]||e.category}</span></td>
    <td style="font-weight:700; color:var(--danger);">${fmt(e.amount)} ج</td>
    <td style="font-size:12px; color:var(--text-muted);">${e.note||'-'}</td>
    <td style="font-size:11px; color:var(--text-muted);">${e.by||''}</td>
    <td>
      <button class="btn btn-sm" onclick="openExpenseModal('${e.id}')" style="font-size:11px;padding:3px 8px;margin-left:4px;">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')" style="font-size:11px;padding:3px 8px;">🗑️</button>
    </td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════

const getAudit = () => _auditCache;
function setAudit(list) {
  _auditCache = list;
  DB.s('pos_audit', list);
  try { _db && _db.collection('pos_data').doc('audit').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function addAuditLog(action, details, branchId) {
  const list = [...getAudit()];
  list.unshift({
    id: 'a_' + Date.now(),
    action,
    details,
    user: currentUser || 'system',
    branchId: branchId || currentBranch,
    timestamp: Date.now()
  });
  // Keep last 500 entries
  setAudit(list.slice(0, 500));
}

function renderAuditPage() {
  const userFilter = document.getElementById('auditUserFilter')?.value || '';
  const typeFilter = document.getElementById('auditTypeFilter')?.value || '';
  const daysFilter = parseInt(document.getElementById('auditDateFilter')?.value) || 30;

  // Populate user filter
  const userSel = document.getElementById('auditUserFilter');
  if (userSel && userSel.options.length <= 1) {
    const users = [...new Set(getAudit().map(a=>a.user))].filter(Boolean);
    users.forEach(u => {
      if (!userSel.querySelector(`option[value="${u}"]`)) {
        const o=document.createElement('option'); o.value=u; o.textContent=u; userSel.appendChild(o);
      }
    });
  }

  const cutoff = daysFilter === 'all' ? 0 : Date.now() - daysFilter * 86400000;
  let list = getAudit().filter(a => a.timestamp >= cutoff);
  if (userFilter) list = list.filter(a => a.user === userFilter);
  if (typeFilter) list = list.filter(a => a.action.startsWith(typeFilter));

  const totalCount    = list.length;
  const invCount      = list.filter(a=>a.action.startsWith('inv')||a.action.startsWith('price')).length;
  const saleCount     = list.filter(a=>a.action.startsWith('sale')).length;
  const settingsCount = list.filter(a=>a.action.startsWith('settings')||a.action.startsWith('auth')).length;

  const el1=document.getElementById('audit-total');    if(el1) el1.textContent=totalCount;
  const el2=document.getElementById('audit-inv');      if(el2) el2.textContent=invCount;
  const el3=document.getElementById('audit-sales');    if(el3) el3.textContent=saleCount;
  const el4=document.getElementById('audit-settings'); if(el4) el4.textContent=settingsCount;

  const actionLabels = {
    'inv.add':'➕ إضافة صنف', 'inv.edit':'✏️ تعديل صنف', 'inv.delete':'🗑️ حذف صنف',
    'price.change':'🏷️ تغيير سعر', 'sale.complete':'💰 فاتورة مكتملة', 'sale.return':'↩️ مرتجع',
    'po.receive':'📦 استلام بضاعة', 'po.create':'🛒 أمر شراء', 'transfer.done':'🔄 تحويل',
    'expense.add':'💸 مصروف', 'settings.change':'⚙️ تغيير إعداد',
    'auth.login':'🔐 تسجيل دخول', 'auth.logout':'🚪 تسجيل خروج'
  };

  const tbody = document.getElementById('auditBody'); if(!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">لا توجد سجلات</td></tr>'; return;
  }
  tbody.innerHTML = list.slice(0, 200).map(a => `<tr>
    <td style="white-space:nowrap; font-size:11px; color:var(--text-muted);">${new Date(a.timestamp).toLocaleString('ar-EG')}</td>
    <td><span style="background:#f0f4ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${a.user||'system'}</span></td>
    <td style="font-size:12px;">${a.branchId?getBranchName(a.branchId):'-'}</td>
    <td style="font-size:12px;">${actionLabels[a.action]||a.action}</td>
    <td style="font-size:12px; color:var(--text-muted);">${a.details||''}</td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════
// WHATSAPP SHARING
// ══════════════════════════════════════════════

let _lastSale = null; // stored in completeSale for WhatsApp

function shareReceiptWhatsApp() {
  // Build text receipt from last sale
  const sale = _lastSale;
  if (!sale) { alert('لا توجد فاتورة لمشاركتها'); return; }
  const lines = [
    `🧾 فاتورة من VOODO ERP`,
    `📅 ${new Date(sale.date).toLocaleString('ar-EG')}`,
    `🏬 ${sale.branchName || getBranchName(sale.branchId || 'b1')}`,
    `👤 ${sale.salesperson || sale.cashier || ''}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...sale.items.map(i => `• ${i.name} ×${i.qty}  =  ${fmt(i.price * i.qty)} ج`),
    `━━━━━━━━━━━━━━━━━━━━`,
    sale.disc > 0 ? `🎁 خصم: ${fmt(sale.disc)} ج` : '',
    `💰 الإجمالي: ${fmt(sale.total)} ج`,
    `💳 الدفع: ${sale.payMethod === 'cash' ? 'نقدي' : 'كارت'}`,
    ``,
    `شكراً لثقتك بـ VOODO ERP 🏠`
  ].filter(l => l !== undefined && l !== null);
  const text = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

function shareOffersWhatsApp() {
  const promos = getPromos().filter(p => p.active);
  if (!promos.length) { alert('لا توجد عروض نشطة للمشاركة'); return; }
  const lines = [
    `🏷️ *عروض وحزم VOODO ERP*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...promos.map(p => {
      if (p.type === 'bundle') {
        return `📦 *${p.name}*\nاشتري: ${p.items.map(i=>i.name+' ×'+i.minQty).join(' + ')}\nبسعر: ${fmt(p.bundlePrice)} ج بدل ${fmt(p.items.reduce((s,i)=>{const inv=getInv().find(x=>x.code===i.code);return s+(inv?.priceAfter||inv?.price||0)*i.minQty;},0))} ج`;
      } else {
        return `💰 *${p.name}*\nعند شراء بأكثر من ${fmt(p.minAmount)} ج\nخصم ${p.discountType==='percent'?p.discountValue+'%':fmt(p.discountValue)+' ج'}`;
      }
    }),
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏠 VOODO ERP — بادر بالشراء!`
  ];
  const text = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

// ══════════════════════════════════════════════
// CASHIER RETURN SYSTEM
// ══════════════════════════════════════════════
let _crSelectedSale = null;
let _crLastReturn   = null;

function openCashierReturn() {
  toggleMobileCart(false);
  document.getElementById('crSearchInput').value = '';
  document.getElementById('crDateFilter').value = '';
  document.getElementById('crResultsBody').innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">اكتب رقم التليفون أو رقم الفاتورة أو اختر تاريخ للبحث</p>';
  document.getElementById('cashierReturnSearchModal').classList.remove('hidden');
}

function searchSalesForReturn() {
  const q    = document.getElementById('crSearchInput').value.trim().toLowerCase();
  const dStr = document.getElementById('crDateFilter').value; // YYYY-MM-DD
  const body = document.getElementById('crResultsBody');
  if (!q && !dStr) {
    body.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">اكتب رقم التليفون أو رقم الفاتورة أو اختر تاريخ للبحث</p>';
    return;
  }
  const allSales = getSales().filter(s => !s.isReturn);
  const results = allSales.filter(s => {
    if (dStr && s.date.slice(0,10) !== dStr) return false;
    if (q) {
      const idStr    = String(s.id).toLowerCase();
      const phone    = (s.customerPhone || s.phone || '').toLowerCase();
      const customer = (s.customerName  || '').toLowerCase();
      const hasItem  = (s.items || []).some(i =>
        (i.code || '').toLowerCase().includes(q) || (i.name || '').toLowerCase().includes(q)
      );
      if (!idStr.includes(q) && !phone.includes(q) && !customer.includes(q) && !hasItem) return false;
    }
    return true;
  }).sort((a,b) => b.id - a.id).slice(0, 50);

  if (!results.length) {
    body.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد نتائج</p>';
    return;
  }

  body.innerHTML = results.map(s => {
    const d = new Date(s.date).toLocaleDateString('ar-EG');
    const t = new Date(s.date).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
    const itemsPreview = (s.items||[]).slice(0,2).map(i=>i.name).join('، ') + ((s.items||[]).length>2?' ...':'');
    const alreadyReturned = getSales().some(r => r.isReturn && r.originalSaleId === s.id);
    return `<div onclick="${alreadyReturned ? '' : `openCashierReturnItems(${s.id})`}"
      style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;
             cursor:${alreadyReturned?'default':'pointer'};opacity:${alreadyReturned?'0.55':'1'};background:var(--bg-card);"
      ${alreadyReturned?'':' onmouseover="this.style.borderColor=\'var(--danger)\'" onmouseout="this.style.borderColor=\'var(--border)\'"'}>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div>
          <span style="font-weight:700;font-size:13px;">#${String(s.id).slice(-6)}</span>
          ${s.customerName?`<span style="margin-inline-start:8px;font-size:12px;color:var(--text-muted);">👤 ${s.customerName}</span>`:''}
          ${(s.customerPhone||s.phone)?`<span style="margin-inline-start:8px;font-size:12px;color:var(--text-muted);">📞 ${s.customerPhone||s.phone}</span>`:''}
          ${alreadyReturned?'<span style="margin-inline-start:8px;font-size:11px;color:var(--danger);font-weight:600;">✓ تم الإرجاع</span>':''}
        </div>
        <div style="text-align:end;flex-shrink:0;">
          <div style="font-weight:700;color:var(--primary);">${fmt(s.total)} ج</div>
          <div style="font-size:11px;color:var(--text-muted);">${d} ${t}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${itemsPreview}</div>
    </div>`;
  }).join('');
}

function openCashierReturnItems(saleId) {
  const sale = getSales().find(s => s.id === saleId);
  if (!sale) return;
  _crSelectedSale = sale;
  const d = new Date(sale.date).toLocaleString('ar-EG');
  document.getElementById('crInvoiceInfo').innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
      <div><b>فاتورة #${String(sale.id).slice(-6)}</b> · ${d}</div>
      <div style="color:var(--primary);font-weight:700;">${fmt(sale.total)} ج</div>
    </div>
    ${sale.customerName?`<div style="margin-top:4px;">👤 ${sale.customerName}${(sale.customerPhone||sale.phone)?' · 📞 '+(sale.customerPhone||sale.phone):''}</div>`:''}`;
  document.getElementById('crItemsList').innerHTML = sale.items.map((item, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${item.name}</div>
        <div style="font-size:11px;color:var(--text-muted);">كود: ${item.code} · ${fmt(item.price)} ج × ${item.qty}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <label style="font-size:12px;color:var(--text-muted);">إرجاع:</label>
        <input type="number" class="form-control" id="cr-qty-${idx}"
          value="0" min="0" max="${item.qty}"
          style="width:70px;text-align:center;padding:4px;" oninput="calcCashierReturnTotal()" />
        <span style="font-size:11px;color:var(--text-muted);">من ${item.qty}</span>
      </div>
    </div>`).join('');
  document.getElementById('crReturnReason').value = '';
  document.getElementById('crReturnSummary').style.display = 'none';
  document.getElementById('cashierReturnSearchModal').classList.add('hidden');
  document.getElementById('cashierReturnItemsModal').classList.remove('hidden');
  calcCashierReturnTotal();
}

function calcCashierReturnTotal() {
  if (!_crSelectedSale) return;
  let total = 0;
  _crSelectedSale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('cr-qty-'+idx)?.value) || 0;
    total += qty * item.price;
  });
  const sumEl = document.getElementById('crReturnSummary');
  const totEl = document.getElementById('crReturnTotal');
  if (sumEl && totEl) { totEl.textContent = fmt(total); sumEl.style.display = total > 0 ? 'block' : 'none'; }
}

function processCashierReturn() {
  if (!_crSelectedSale) return;
  const sale = _crSelectedSale;
  const reason = document.getElementById('crReturnReason').value.trim();
  const returnItems = [];
  let returnTotal = 0;
  sale.items.forEach((item, idx) => {
    const qty = parseInt(document.getElementById('cr-qty-'+idx)?.value) || 0;
    if (qty > 0) { returnItems.push({...item, qty: -qty}); returnTotal += qty * item.price; }
  });
  if (!returnItems.length) { alert('اختر على الأقل صنف واحد للإرجاع'); return; }
  if (!confirm(`تأكيد إرجاع ${returnItems.length} صنف — المبلغ المسترد: ${fmt(returnTotal)} ج؟`)) return;
  // Restock
  const inv = getInv();
  returnItems.forEach(ri => { const p = inv.find(x => x.code === ri.code); if (p) p.qty += Math.abs(ri.qty); });
  setInv(inv);
  // Save return record
  const returnSale = {
    id:             Date.now(),
    date:           new Date().toISOString(),
    isReturn:       true,
    originalSaleId: sale.id,
    returnReason:   reason || 'غير محدد',
    cashier:        currentUser === 'admin' ? 'مدير' : 'كاشير',
    salesperson:    sale.salesperson || '',
    branchId:       sale.branchId || currentBranch,
    branchName:     sale.branchName || getBranchName(currentBranch),
    customerName:   sale.customerName || '',
    customerPhone:  sale.customerPhone || sale.phone || '',
    items:          returnItems,
    sub:            -returnTotal,
    disc:           0,
    total:          -returnTotal,
    paid:           -returnTotal,
    change:         0,
    payMethod:      'return'
  };
  addSale(returnSale);
  _crLastReturn = returnSale;
  addAuditLog('return', `مرتجع من فاتورة #${String(sale.id).slice(-6)} — ${fmt(returnTotal)} ج`, currentBranch);
  document.getElementById('cashierReturnItemsModal').classList.add('hidden');
  // Open WhatsApp modal
  document.getElementById('crWAPhone').value = sale.customerPhone || sale.phone || '';
  document.getElementById('crWhatsAppModal').classList.remove('hidden');
}

function sendReturnWhatsApp() {
  const s = _crLastReturn;
  const phone = document.getElementById('crWAPhone').value.trim().replace(/\D/g,'');
  document.getElementById('crWhatsAppModal').classList.add('hidden');
  if (!s) return;
  const lines = [
    `🔄 إيصال مرتجع — VOODO ERP`,
    `📅 ${new Date(s.date).toLocaleString('ar-EG')}`,
    `🏬 ${s.branchName || getBranchName(s.branchId || 'b1')}`,
    `فاتورة أصلية: #${String(s.originalSaleId).slice(-6)}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...s.items.map(i => `• ${i.name} ×${Math.abs(i.qty)}  =  ${fmt(Math.abs(i.qty)*i.price)} ج`),
    `━━━━━━━━━━━━━━━━━━━━`,
    `💰 المبلغ المسترد: ${fmt(Math.abs(s.total))} ج`,
    s.returnReason !== 'غير محدد' ? `📝 السبب: ${s.returnReason}` : '',
    ``,
    `شكراً لثقتك بـ VOODO ERP 🏠`
  ].filter(l => l !== '');
  const text = encodeURIComponent(lines.join('\n'));
  const url = phone ? `https://wa.me/2${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, '_blank');
}

// ══════════════════════════════════════════════
// BARCODE & PRICE TAG PRINTING
// ══════════════════════════════════════════════

let _bcSelected = new Set();

function openBarcodeModal() {
  _bcSelected = new Set(getInv().map(i => i.code));
  renderBarcodeList();
  renderBarcodePreview();
  document.getElementById('barcodeModal').classList.remove('hidden');
}

function renderBarcodeList() {
  const q = (document.getElementById('bcSearch')?.value || '').toLowerCase();
  const inv = getInv().filter(i => !q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  const container = document.getElementById('bcProductList'); if (!container) return;
  container.innerHTML = inv.map(i => `<div style="display:flex; align-items:center; gap:8px; padding:5px 4px; border-bottom:1px solid var(--border); font-size:12px;">
    <input type="checkbox" ${_bcSelected.has(i.code)?'checked':''} onchange="bcToggle('${i.code}',this.checked)" style="cursor:pointer;" />
    <span style="flex:1;">${i.name}</span>
    <span style="color:var(--text-muted);">${i.code}</span>
    <span style="color:var(--primary); font-weight:600;">${fmt(i.priceAfter)} ج</span>
  </div>`).join('');
}

function bcToggle(code, checked) {
  if (checked) _bcSelected.add(code); else _bcSelected.delete(code);
  renderBarcodePreview();
}

function bcSelectAll(val) {
  const inv = getInv();
  if (val) inv.forEach(i => _bcSelected.add(i.code));
  else _bcSelected.clear();
  renderBarcodeList();
  renderBarcodePreview();
}

function getBCTagDimensions() {
  const size = document.getElementById('bcTagSize')?.value || 'medium';
  return { small:{w:'90px',h:'55px',font:'8px'}, medium:{w:'132px',h:'80px',font:'10px'}, large:{w:'210px',h:'132px',font:'13px'} }[size];
}

function renderBarcodePreview() {
  renderBarcodeList();
  const inv = getInv().filter(i => _bcSelected.has(i.code));
  const copies = parseInt(document.getElementById('bcCopies')?.value) || 1;
  const showPrice = document.getElementById('bcShowPrice')?.value || 'after';
  const dim = getBCTagDimensions();
  const preview = document.getElementById('bcPreview'); if (!preview) return;
  const tags = [];
  inv.forEach(item => {
    for (let c = 0; c < Math.min(copies, 3); c++) { // show max 3 copies in preview
      tags.push(buildPriceTag(item, showPrice, dim, true));
    }
  });
  preview.innerHTML = tags.slice(0, 12).join('');
}

function buildPriceTag(item, showPrice, dim, preview) {
  const priceHTML = showPrice === 'none' ? '' :
    showPrice === 'after' ? `<div style="font-size:${preview?'11px':'14px'}; font-weight:800; color:#1a5faf; margin-top:2px;">${fmt(item.priceAfter)} ج</div>` :
    showPrice === 'before' ? `<div style="font-size:${preview?'11px':'14px'}; font-weight:800; color:#1a5faf; margin-top:2px;">${fmt(item.priceBefore||item.priceAfter)} ج</div>` :
    `<div style="font-size:9px; color:#888; text-decoration:line-through;">${fmt(item.priceBefore||item.priceAfter)} ج</div><div style="font-size:${preview?'12px':'16px'}; font-weight:800; color:#1a5faf;">${fmt(item.priceAfter)} ج</div>`;
  return `<div style="width:${dim.w}; height:${dim.h}; border:1px solid #ccc; border-radius:4px; padding:3px; display:flex; flex-direction:column; align-items:center; justify-content:center; background:white; font-family:monospace; overflow:hidden;">
    <div style="font-size:${dim.font}; font-weight:700; text-align:center; width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${item.name}</div>
    <svg id="bc-${preview?'p':'pr'}-${item.code.replace(/[^a-zA-Z0-9]/g,'_')}" style="max-width:100%; height:${preview?'24px':'36px'};"></svg>
    ${priceHTML}
  </div>`;
}

function printBarcodes() {
  const inv = getInv().filter(i => _bcSelected.has(i.code));
  if (!inv.length) { alert('اختر أصناف أولاً'); return; }
  const copies = parseInt(document.getElementById('bcCopies')?.value) || 1;
  const showPrice = document.getElementById('bcShowPrice')?.value || 'after';
  const dim = getBCTagDimensions();
  let tags = [];
  inv.forEach(item => {
    for (let c = 0; c < copies; c++) tags.push(buildPriceTag(item, showPrice, dim, false));
  });
  const w = window.open('','_blank','width=800,height=600');
  const scTag = 'scr'+'ipt';
  const html = '<!DOCTYPE html><html dir="rtl"><head>'
    + '<meta charset="UTF-8">'
    + '<' + scTag + ' src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></' + scTag + '>'
    + '<style>body{margin:0;padding:10px;font-family:monospace;}.tags-wrap{display:flex;flex-wrap:wrap;gap:4px;}@media print{@page{margin:5mm;}body{padding:0;}}</style>'
    + '</head><body>'
    + '<div class="tags-wrap">' + tags.join('') + '</div>'
    + '<' + scTag + '>window.onload=function(){'
    + 'document.querySelectorAll("svg[id^=\'bc-pr-\']").forEach(function(svg){'
    + 'var code=svg.id.replace("bc-pr-","").replace(/_/g,"-");'
    + 'try{JsBarcode(svg,code,{format:"CODE128",displayValue:true,fontSize:8,height:28,margin:2});}catch(e){'
    + 'try{JsBarcode(svg,code.replace(/-/g,""),{format:"CODE128",displayValue:true,fontSize:8,height:28,margin:2});}catch(e2){}}'
    + '});setTimeout(function(){window.print();},800);};'
    + '</' + scTag + '>'
    + '</body></html>';
  w.document.write(html);
  w.document.close();
}



// ══════════════════════════════════════════════
// LOYALTY PROGRAM
// ══════════════════════════════════════════════
let _loyaltyCache = null;

function getLoyalty() {
  if (!_loyaltyCache) {
    const stored = DB.g('pos_loyalty');
    _loyaltyCache = stored || { pointsPerEGP: 10, pointValue: 0.5, enabled: true };
  }
  return _loyaltyCache;
}

function setLoyalty(cfg) {
  _loyaltyCache = cfg;
  DB.s('pos_loyalty', cfg);
  try { _db && _db.collection('pos_data').doc('loyalty').set({ cfg, updatedAt: Date.now() }); } catch(e) {}
}

// Award points to customer after sale
function awardLoyaltyPoints(customerId, saleTotal) {
  const cfg = getLoyalty();
  if (!cfg.enabled || !customerId) return;
  const pts = Math.floor(saleTotal / cfg.pointsPerEGP);
  if (pts <= 0) return;
  const list = getCustomers();
  const c = list.find(x => x.id === customerId);
  if (!c) return;
  c.loyaltyPoints = (c.loyaltyPoints || 0) + pts;
  setCustomers(list);
}

// Redeem points: returns discount amount in EGP
function calcLoyaltyRedemption(points) {
  return points * getLoyalty().pointValue;
}

// Cart loyalty redemption state
let _cartLoyaltyRedeem = 0;

function openLoyaltySettings() {
  const cfg = getLoyalty();
  document.getElementById('loyPtsPerEGP').value  = cfg.pointsPerEGP;
  document.getElementById('loyPointValue').value = cfg.pointValue;
  document.getElementById('loyEnabled').checked  = cfg.enabled;
  document.getElementById('loyaltySettingsModal').classList.remove('hidden');
}

function saveLoyaltySettings() {
  setLoyalty({
    pointsPerEGP: parseFloat(document.getElementById('loyPtsPerEGP').value) || 10,
    pointValue:   parseFloat(document.getElementById('loyPointValue').value) || 0.5,
    enabled: document.getElementById('loyEnabled').checked
  });
  document.getElementById('loyaltySettingsModal').classList.add('hidden');
  alert('تم حفظ إعدادات الولاء ✓');
}
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// ATTENDANCE & PAYROLL
// ══════════════════════════════════════════════
let _attendanceCache = null;
let _payrollCache    = null;

function getAttendance() {
  if (!_attendanceCache) _attendanceCache = DB.g('pos_attendance', []);
  return _attendanceCache;
}
function setAttendance(list) {
  _attendanceCache = list;
  DB.s('pos_attendance', list);
  try { _db && _db.collection('pos_data').doc('attendance').set({ list, updatedAt: Date.now() }); } catch(e) {}
}
function getPayroll() {
  if (!_payrollCache) _payrollCache = DB.g('pos_payroll', []);
  return _payrollCache;
}
function setPayroll(list) {
  _payrollCache = list;
  DB.s('pos_payroll', list);
  try { _db && _db.collection('pos_data').doc('payroll').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function saveAttendanceRecord(empName, date, status, checkIn, checkOut, notes) {
  const list = getAttendance();
  const existing = list.find(a => a.empName === empName && a.date === date);
  const rec = { id: existing?.id || Date.now(), empName, date, status, checkIn: checkIn||'', checkOut: checkOut||'', notes: notes||'' };
  if (existing) Object.assign(existing, rec);
  else list.push(rec);
  setAttendance(list);
}

function savePayrollAdjustment(month, empName, bonus, deduction) {
  const list = getPayroll();
  const ex = list.find(p => p.month === month && p.empName === empName);
  if (ex) { ex.bonus = bonus; ex.deduction = deduction; }
  else list.push({ id: Date.now(), month, empName, bonus, deduction, isPaid: false });
  setPayroll(list);
}

function markPayrollPaid(month, empName, isPaid) {
  const list = getPayroll();
  const ex = list.find(p => p.month === month && p.empName === empName);
  if (ex) ex.isPaid = isPaid;
  else list.push({ id: Date.now(), month, empName, bonus: 0, deduction: 0, isPaid });
  setPayroll(list);
}

function calcMonthlyPayroll(month) {
  const sps = (getSalespeople ? getSalespeople() : []);
  const hrRec = getHR().find(h => h.month === month) || {};
  const allSales = getSales().filter(s => !s.isReturn && s.date?.slice(0,7) === month);
  const attMonth = getAttendance().filter(a => a.date?.slice(0,7) === month);
  const stored   = getPayroll().filter(p => p.month === month);
  return sps.map(sp => {
    const name = typeof sp === 'string' ? sp : sp.name;
    const base = typeof sp === 'object' ? (sp.baseSalary || 0) : 0;
    const empSales  = allSales.filter(s => s.salesperson === name).reduce((s,x)=>s+x.total,0);
    const commPct   = hrRec.targets?.[name]?.commission ?? 0;
    const commission = Math.round(empSales * commPct / 100);
    const workDays  = attMonth.filter(a => a.empName===name && a.status==='present').length;
    const absentDays= attMonth.filter(a => a.empName===name && a.status==='absent').length;
    const lateDays  = attMonth.filter(a => a.empName===name && a.status==='late').length;
    const sr = stored.find(p => p.empName===name) || {};
    const bonus = sr.bonus||0; const deduction = sr.deduction||0;
    return { name, base, empSales, commPct, commission, workDays, absentDays, lateDays, bonus, deduction, net: base+commission+bonus-deduction, isPaid: sr.isPaid||false };
  });
}

let _hrActiveTab = 'targets';
function switchHRTab(tab) {
  _hrActiveTab = tab;
  ['targets','attendance','payroll'].forEach(t => {
    const btn = document.getElementById('hrTab_'+t);
    const pane = document.getElementById('hrPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='attendance') renderAttendancePane();
  if (tab==='payroll')    renderPayrollPane();
}

function getHRMonth() {
  return document.getElementById('hrMonthFilter')?.value || new Date().toISOString().slice(0,7);
}

function renderAttendancePane() {
  const month = getHRMonth();
  const sps = (getSalespeople?getSalespeople():[]).map(sp=>typeof sp==='string'?sp:sp.name);
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const today = new Date().toISOString().slice(0,10);
  const attMap = {};
  getAttendance().filter(a=>a.date?.slice(0,7)===month).forEach(a=>{ attMap[a.empName+'_'+a.date]=a; });
  const SC = {present:'#dcfce7',absent:'#fee2e2',late:'#fef9c3',excused:'#eff6ff','':'#f3f4f6'};
  const SL = {present:'✅',absent:'❌',late:'⏰',excused:'🔵','':'—'};

  const summCards = sps.map(name => {
    const p = Object.values(attMap).filter(a=>a.empName===name&&a.status==='present').length;
    const ab= Object.values(attMap).filter(a=>a.empName===name&&a.status==='absent').length;
    const lt= Object.values(attMap).filter(a=>a.empName===name&&a.status==='late').length;
    return `<div style="background:var(--bg-secondary);border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <span style="font-weight:700;min-width:70px;">${name}</span>
      <span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:12px;font-size:12px;">✅ ${p} حضور</span>
      <span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:12px;font-size:12px;">❌ ${ab} غياب</span>
      <span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:12px;font-size:12px;">⏰ ${lt} تأخير</span>
    </div>`;
  }).join('');

  const recentDays = [];
  for (let d = daysInMonth; d >= 1; d--) {
    recentDays.push(`${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  }

  const rows = recentDays.map(ds => {
    const cells = sps.map(name => {
      const rec = attMap[name+'_'+ds];
      const st = rec?.status||'';
      return `<td style="background:${SC[st]};text-align:center;cursor:pointer;padding:8px 6px;border:1px solid var(--border);"
        title="${rec?.checkIn||''} → ${rec?.checkOut||''}" onclick="openAttendanceEdit('${name}','${ds}')">${SL[st]}</td>`;
    }).join('');
    return `<tr><td style="font-size:12px;color:var(--text-muted);padding:6px 8px;white-space:nowrap;border:1px solid var(--border);">${ds.slice(5)}${ds===today?' 🔵':''}</td>${cells}</tr>`;
  }).join('');

  const pane = document.getElementById('hrPane_attendance');
  if (!pane) return;
  pane.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="font-weight:700;font-size:14px;">ملخص ${month}</div>
      <button class="btn btn-primary btn-sm" onclick="openAttendanceEdit('','${today}')">➕ تسجيل حضور</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">${summCards}</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border);">التاريخ</th>
          ${sps.map(n=>`<th style="padding:6px 8px;background:var(--bg-secondary);text-align:center;border:1px solid var(--border);">${n}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function openAttendanceEdit(empName, date) {
  const sps = (getSalespeople?getSalespeople():[]).map(sp=>typeof sp==='string'?sp:sp.name);
  const existing = getAttendance().find(a=>a.empName===empName&&a.date===date);
  document.getElementById('attEmpSelect').innerHTML = sps.map(n=>`<option value="${n}" ${n===empName?'selected':''}>${n}</option>`).join('');
  document.getElementById('attDate').value     = date;
  document.getElementById('attStatus').value   = existing?.status||'present';
  document.getElementById('attCheckIn').value  = existing?.checkIn||'';
  document.getElementById('attCheckOut').value = existing?.checkOut||'';
  document.getElementById('attNotes').value    = existing?.notes||'';
  document.getElementById('attendanceEditModal').classList.remove('hidden');
}

function saveAttendanceEdit() {
  const emp    = document.getElementById('attEmpSelect').value;
  const date   = document.getElementById('attDate').value;
  if (!emp||!date) { alert('اختر الموظف والتاريخ'); return; }
  saveAttendanceRecord(emp, date,
    document.getElementById('attStatus').value,
    document.getElementById('attCheckIn').value,
    document.getElementById('attCheckOut').value,
    document.getElementById('attNotes').value);
  document.getElementById('attendanceEditModal').classList.add('hidden');
  renderAttendancePane();
}

function renderPayrollPane() {
  const month = getHRMonth();
  const payroll = calcMonthlyPayroll(month);
  const pane = document.getElementById('hrPane_payroll');
  if (!pane) return;
  if (!payroll.length) { pane.innerHTML='<p style="text-align:center;color:var(--text-muted);padding:30px;">لا يوجد بائعون — أضفهم من الإعدادات</p>'; return; }
  const totalNet  = payroll.reduce((s,p)=>s+p.net,0);
  const totalPaid = payroll.filter(p=>p.isPaid).reduce((s,p)=>s+p.net,0);
  pane.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
      ${[{l:'إجمالي الرواتب',v:fmt(totalNet)+' ج',bg:'#eff6ff',tc:'#1d4ed8'},{l:'تم الصرف',v:fmt(totalPaid)+' ج',bg:'#dcfce7',tc:'#15803d'},{l:'متبقي للصرف',v:fmt(totalNet-totalPaid)+' ج',bg:'#fee2e2',tc:'#b91c1c'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:18px;font-weight:700;color:${k.tc};">${k.v}</div><div style="font-size:11px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:700px;">
      <thead><tr style="background:var(--bg-secondary);">
        ${['الموظف','المبيعات','عمولة%','العمولة','راتب أساسي','مكافأة','خصم','الصافي','الحالة','إجراء']
          .map(h=>`<th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">${h}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${payroll.map(p=>`<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;font-weight:700;">${p.name}</td>
          <td style="padding:8px;text-align:center;">${fmt(p.empSales)} ج</td>
          <td style="padding:8px;text-align:center;">${p.commPct}%</td>
          <td style="padding:8px;text-align:center;color:#059669;font-weight:700;">${fmt(p.commission)} ج</td>
          <td style="padding:8px;text-align:center;">${fmt(p.base)} ج</td>
          <td style="padding:8px;text-align:center;">
            <input type="number" value="${p.bonus}" min="0" style="width:70px;text-align:center;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px;"
              onchange="savePayrollAdjustment('${month}','${p.name}',parseFloat(this.value)||0,${p.deduction});renderPayrollPane();" />
          </td>
          <td style="padding:8px;text-align:center;">
            <input type="number" value="${p.deduction}" min="0" style="width:70px;text-align:center;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px;"
              onchange="savePayrollAdjustment('${month}','${p.name}',${p.bonus},parseFloat(this.value)||0);renderPayrollPane();" />
          </td>
          <td style="padding:8px;text-align:center;font-weight:800;color:var(--primary);font-size:14px;">${fmt(p.net)} ج</td>
          <td style="padding:8px;text-align:center;">
            <span style="background:${p.isPaid?'#dcfce7':'#fee2e2'};color:${p.isPaid?'#15803d':'#b91c1c'};padding:2px 8px;border-radius:12px;font-size:11px;">${p.isPaid?'✅ مصروف':'⏳ لم يُصرف'}</span>
          </td>
          <td style="padding:8px;text-align:center;">
            <button class="btn btn-sm" style="background:${p.isPaid?'#fee2e2':'#dcfce7'};color:${p.isPaid?'#b91c1c':'#15803d'};"
              onclick="markPayrollPaid('${month}','${p.name}',${!p.isPaid});renderPayrollPane();">
              ${p.isPaid?'↩ استرداد':'💵 صرف الراتب'}
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ══════════════════════════════════════════════
// ACCOUNTING — محاسبة رسمية
// ══════════════════════════════════════════════
let _accTab = 'pnl';

function switchAccTab(tab) {
  _accTab = tab;
  ['pnl','cashflow','summary'].forEach(t => {
    const btn  = document.getElementById('accTab_'+t);
    const pane = document.getElementById('accPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  renderAccTab(tab);
}

function renderAccountingPage() {
  const mf = document.getElementById('accMonthFilter');
  if (mf && !mf.options.length) {
    const now = new Date();
    const opts = [];
    for (let i=0; i<12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const v = d.toISOString().slice(0,7);
      const l = d.toLocaleString('ar-EG',{year:'numeric',month:'long'});
      opts.push(`<option value="${v}">${l}</option>`);
    }
    mf.innerHTML = opts.join('');
  }
  renderAccTab(_accTab);
}

function getAccMonth() {
  return document.getElementById('accMonthFilter')?.value || new Date().toISOString().slice(0,7);
}

function renderAccTab(tab) {
  if (tab==='pnl')      renderPnL();
  if (tab==='cashflow') renderCashFlow();
  if (tab==='summary')  renderAccSummary();
}

function renderPnL() {
  const month = getAccMonth();
  const pane = document.getElementById('accPane_pnl');
  if (!pane) return;
  const sales    = getSales().filter(s=>!s.isReturn&&s.date?.slice(0,7)===month);
  const rets     = getSales().filter(s=> s.isReturn&&s.date?.slice(0,7)===month);
  const exps     = getExpenses().filter(e=>e.date?.slice(0,7)===month);
  const revenue  = sales.reduce((s,x)=>s+x.total,0);
  const returnAmt= rets.reduce((s,x)=>s+Math.abs(x.total||0),0);
  const netRev   = revenue - returnAmt;
  const cogs     = sales.reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
  const grossP   = netRev - cogs;
  const salaries = typeof calcMonthlyPayroll==='function' ? calcMonthlyPayroll(month).reduce((s,p)=>s+p.net,0) : 0;
  const opExp    = exps.reduce((s,e)=>s+(e.amount||0),0);
  const totalOp  = salaries + opExp;
  const ebit     = grossP - totalOp;
  const gMargin  = netRev>0?(grossP/netRev*100).toFixed(1):0;

  const row = (label, amt, indent=0, bold=false, sep=false, color='') => {
    const st = `padding:${sep?'10':'7'}px 8px ${indent?'padding-right:'+(8+indent*16)+'px':''};${bold?'font-weight:700;':''}${color?'color:'+color+';':''}${sep?'border-top:2px solid var(--border);':''}`;
    return `<tr><td style="${st}">${label}</td>
      <td style="${st}text-align:left;direction:ltr;">${amt!==null?(amt<0?'-':'')+fmt(Math.abs(amt))+' ج':''}</td>
      <td style="${st}text-align:center;font-size:11px;color:var(--text-muted);">${amt!==null&&netRev>0?(Math.abs(amt)/netRev*100).toFixed(1)+'%':''}</td></tr>`;
  };

  pane.innerHTML = `<div style="max-width:580px;">
    <div style="font-size:15px;font-weight:800;margin-bottom:14px;color:var(--primary);">📋 قائمة الدخل — ${month}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <thead><tr style="background:var(--sidebar);color:white;">
        <th style="padding:10px 8px;text-align:right;">البند</th>
        <th style="padding:10px 8px;text-align:left;">المبلغ</th>
        <th style="padding:10px 8px;text-align:center;">%</th>
      </tr></thead><tbody>
      ${row('إيرادات المبيعات',revenue,0,true,false,'#059669')}
      ${row('المرتجعات',-returnAmt,1)}
      ${row('صافي الإيراد',netRev,0,true,true,'#1d4ed8')}
      ${row('تكلفة البضاعة المباعة',-cogs,1)}
      ${row('إجمالي الربح',grossP,0,true,true,grossP>=0?'#059669':'#dc2626')}
      <tr><td colspan="3" style="padding:4px 8px;background:var(--bg-secondary);font-size:11px;font-weight:700;color:var(--text-muted);">المصاريف التشغيلية</td></tr>
      ${row('الرواتب',-salaries,1)}
      ${row('مصاريف أخرى',-opExp,1)}
      ${row('إجمالي المصاريف',-totalOp,0,true,true)}
      ${row('الربح التشغيلي (EBIT)',ebit,0,true,true,ebit>=0?'#059669':'#dc2626')}
      </tbody>
    </table>
    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${[{l:'هامش الربح الإجمالي',v:gMargin+'%',bg:'#dcfce7',tc:'#15803d'},{l:'صافي الربح',v:fmt(ebit)+' ج',bg:ebit>=0?'#dcfce7':'#fee2e2',tc:ebit>=0?'#15803d':'#b91c1c'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:${k.tc};">${k.v}</div><div style="font-size:12px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div></div>`;
}

function renderCashFlow() {
  const month = getAccMonth();
  const pane  = document.getElementById('accPane_cashflow');
  if (!pane) return;
  const sales = getSales().filter(s=>!s.isReturn&&s.date?.slice(0,7)===month);
  const rets  = getSales().filter(s=> s.isReturn&&s.date?.slice(0,7)===month);
  const exps  = getExpenses().filter(e=>e.date?.slice(0,7)===month);
  const pos   = (typeof getPurchaseOrders==='function'?getPurchaseOrders():[]).filter(po=>po.createdAt&&new Date(po.createdAt).toISOString().slice(0,7)===month&&po.status==='received');

  const byM = {};
  sales.forEach(s=>{ const m=s.paymentMethod||'cash'; byM[m]=(byM[m]||0)+s.total; });
  const cashIn  = (byM['cash']||0)+(byM['نقدي']||0);
  const cardIn  = (byM['card']||0)+(byM['فيزا']||0)+(byM['كريدت']||0);
  const otherIn = Object.entries(byM).filter(([k])=>!['cash','نقدي','card','فيزا','كريدت'].includes(k)).reduce((s,[,v])=>s+v,0);
  const totalIn = cashIn+cardIn+otherIn;
  const retOut  = rets.reduce((s,x)=>s+Math.abs(x.total||0),0);
  const expOut  = exps.reduce((s,e)=>s+(e.amount||0),0);
  const purOut  = pos.reduce((s,po)=>s+(po.grandTotal||0),0);
  const totalOut= retOut+expOut+purOut;
  const net     = totalIn-totalOut;

  const [yr,mo] = month.split('-').map(Number);
  const days = new Date(yr,mo,0).getDate();
  const daily = [];
  for (let d=1;d<=days;d++) {
    const ds=`${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    daily.push({d, s:sales.filter(x=>x.date?.slice(0,10)===ds).reduce((a,x)=>a+x.total,0), e:exps.filter(x=>x.date?.slice(0,10)===ds).reduce((a,x)=>a+(x.amount||0),0)});
  }
  const mx = Math.max(...daily.map(d=>Math.max(d.s,d.e)),1);
  const bars = daily.map(({d,s,e})=>`<div style="display:flex;flex-direction:column;align-items:center;gap:1px;flex:1;min-width:6px;">
    <div style="width:60%;background:#1a5faf;height:${Math.round(s/mx*70)}px;border-radius:2px 2px 0 0;" title="مبيعات ${fmt(s)} ج"></div>
    <div style="width:60%;background:#ef4444;height:${Math.round(e/mx*70)}px;border-radius:2px 2px 0 0;" title="مصاريف ${fmt(e)} ج"></div>
    ${days<=16?`<div style="font-size:8px;color:var(--text-muted);">${d}</div>`:''}
  </div>`).join('');

  pane.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
      ${[{l:'إجمالي الداخل',v:'+'+fmt(totalIn)+' ج',bg:'#dcfce7',tc:'#15803d'},{l:'إجمالي الخارج',v:'-'+fmt(totalOut)+' ج',bg:'#fee2e2',tc:'#b91c1c'},{l:'صافي التدفق',v:(net>=0?'+':'')+fmt(net)+' ج',bg:net>=0?'#eff6ff':'#fef3c7',tc:net>=0?'#1d4ed8':'#854d0e'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:18px;font-weight:800;color:${k.tc};">${k.v}</div><div style="font-size:11px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div>
    <div style="background:white;border-radius:10px;padding:14px;margin-bottom:16px;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <div style="font-weight:700;margin-bottom:10px;font-size:13px;">📊 <span style="color:#1a5faf;">■ مبيعات</span> <span style="color:#ef4444;">■ مصاريف</span></div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:80px;">${bars}</div>
    </div>
    <div style="background:white;border-radius:10px;padding:14px;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        ${[['📥 مبيعات كاش','+'+fmt(cashIn)+' ج','#059669'],['💳 مبيعات بطاقة','+'+fmt(cardIn)+' ج','#059669'],['📥 أخرى','+'+fmt(otherIn)+' ج','#059669'],['📤 مرتجعات','-'+fmt(retOut)+' ج','#dc2626'],['📤 مصاريف','-'+fmt(expOut)+' ج','#dc2626'],['📤 موردون','-'+fmt(purOut)+' ج','#dc2626']]
          .map(([l,v,tc])=>`<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">${l}</td><td style="padding:8px;text-align:left;direction:ltr;font-weight:700;color:${tc};">${v}</td></tr>`).join('')}
        <tr style="background:var(--bg-secondary);"><td style="padding:10px;font-weight:800;">🏦 صافي التدفق</td><td style="padding:10px;font-weight:800;text-align:left;direction:ltr;color:${net>=0?'#15803d':'#dc2626'};font-size:15px;">${(net>=0?'+':'')+fmt(net)} ج</td></tr>
      </table>
    </div>`;
}

function renderAccSummary() {
  const pane = document.getElementById('accPane_summary');
  if (!pane) return;
  const allSales = getSales().filter(s=>!s.isReturn);
  const allExp   = getExpenses();
  const months   = [...new Set(allSales.map(s=>s.date?.slice(0,7)).filter(Boolean))].sort().reverse();
  const totalRev = allSales.reduce((s,x)=>s+x.total,0);
  const totalCOGS= allSales.reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
  const totalExp = allExp.reduce((s,e)=>s+(e.amount||0),0);
  const totalNP  = totalRev-totalCOGS-totalExp;

  const rows = months.slice(0,12).map(m=>{
    const mS=allSales.filter(s=>s.date?.slice(0,7)===m).reduce((s,x)=>s+x.total,0);
    const mC=allSales.filter(s=>s.date?.slice(0,7)===m).reduce((s,x)=>s+(x.items||[]).reduce((ss,i)=>ss+(i.cost||0)*i.qty,0),0);
    const mE=allExp.filter(e=>e.date?.slice(0,7)===m).reduce((s,e)=>s+(e.amount||0),0);
    const mP=mS-mC-mE;
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px;">${m}</td>
      <td style="padding:8px;text-align:center;">${fmt(mS)} ج</td>
      <td style="padding:8px;text-align:center;">${fmt(mC)} ج</td>
      <td style="padding:8px;text-align:center;">${fmt(mE)} ج</td>
      <td style="padding:8px;text-align:center;font-weight:700;color:${mP>=0?'#059669':'#dc2626'};">${fmt(mP)} ج</td>
    </tr>`;
  }).join('');

  pane.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
      ${[{l:'إجمالي الإيراد',v:fmt(totalRev)+' ج',bg:'#eff6ff',tc:'#1d4ed8'},{l:'إجمالي التكاليف',v:fmt(totalCOGS)+' ج',bg:'#fef9c3',tc:'#854d0e'},{l:'إجمالي المصاريف',v:fmt(totalExp)+' ج',bg:'#fee2e2',tc:'#b91c1c'},{l:'صافي الأرباح الكلي',v:fmt(totalNP)+' ج',bg:totalNP>=0?'#dcfce7':'#fee2e2',tc:totalNP>=0?'#15803d':'#b91c1c'}]
        .map(k=>`<div style="background:${k.bg};border-radius:8px;padding:12px;text-align:center;"><div style="font-size:16px;font-weight:800;color:${k.tc};">${k.v}</div><div style="font-size:11px;color:var(--text-muted);">${k.l}</div></div>`).join('')}
    </div>
    <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:var(--sidebar);color:white;">
          ${['الشهر','الإيراد','التكلفة','المصاريف','صافي الربح'].map(h=>`<th style="padding:10px 8px;text-align:center;">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">لا توجد بيانات</td></tr>'}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════
// VLOOKUP — تقارير ربط الجداول
// ══════════════════════════════════════════════
let _vlTab = 'supplier';

function showVLTab(tab) {
  _vlTab = tab;
  ['supplier','catreport','customer','turnover'].forEach(function(t) {
    var btn  = document.getElementById('vlTab_'+t);
    var pane = document.getElementById('vlPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='catreport') renderCategoryReport();
}




// ── Category / Family Sales Report ────────────────────────────────
function renderCategoryReport(fromDate, toDate) {
  var pane = document.getElementById('custRptContent');
  if (!pane) return;

  var allProducts = getInv();
  // Also collect products across branches for better category lookup
  var productMap = {};
  allProducts.forEach(function(p){ if(p.code) productMap[p.code] = p; });
  // fallback: also try other branches
  ['b1','b2','b3','b4'].forEach(function(b){
    var brInv = _invCacheByBranch[b] || [];
    brInv.forEach(function(p){ if(p.code && !productMap[p.code]) productMap[p.code] = p; });
  });

  var allSales = getSales().filter(function(s){ return !s.isReturn; });

  // Date filter
  if (fromDate) allSales = allSales.filter(function(s){ return s.date && s.date.slice(0,10) >= fromDate; });
  if (toDate)   allSales = allSales.filter(function(s){ return s.date && s.date.slice(0,10) <= toDate; });

  var catMap = {}, famMap = {};
  allSales.forEach(function(sale) {
    (sale.items||[]).forEach(function(item) {
      var prod = productMap[item.code] || null;
      var cat  = (prod && prod.category) ? prod.category : (item.category || 'غير محدد');
      var fam  = (prod && prod.family)   ? prod.family   : (item.family   || 'غير محدد');
      var rev  = (item.price||0) * (item.qty||1);
      var cost = (item.cost||prod&&prod.cost||0) * (item.qty||1);
      var qty  = item.qty||1;

      if (!catMap[cat]) catMap[cat] = {name:cat, revenue:0, cost:0, qty:0, items:{}};
      catMap[cat].revenue += rev; catMap[cat].cost += cost; catMap[cat].qty += qty;
      catMap[cat].items[item.name] = (catMap[cat].items[item.name]||0) + qty;

      if (!famMap[fam]) famMap[fam] = {name:fam, revenue:0, cost:0, qty:0, items:{}};
      famMap[fam].revenue += rev; famMap[fam].cost += cost; famMap[fam].qty += qty;
      famMap[fam].items[item.name] = (famMap[fam].items[item.name]||0) + qty;
    });
  });

  var totalRev = Object.values(catMap).reduce(function(s,x){return s+x.revenue;},0) || 1;

  function buildTable(map, title, icon) {
    var rows = Object.values(map).sort(function(a,b){return b.revenue-a.revenue;});
    if (!rows.length) return '<div style="padding:20px;color:var(--text-muted);text-align:center;">لا توجد مبيعات في هذه الفترة</div>';
    var t = '<div style="font-size:14px;font-weight:700;margin:16px 0 10px;">'+icon+' '+title+'</div>';
    t += '<div style="overflow-x:auto;background:var(--card);border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.07);margin-bottom:20px;">';
    t += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    t += '<thead><tr style="background:var(--sidebar);color:white;">';
    ['الاسم','الإيراد','التكلفة','هامش %','الكمية','% من الإجمالي','أعلى منتج'].forEach(function(h){ t += '<th style="padding:9px 8px;text-align:center;">'+h+'</th>'; });
    t += '</tr></thead><tbody>';
    rows.forEach(function(r,i) {
      var margin = r.revenue>0 ? Math.round((r.revenue-r.cost)/r.revenue*100) : 0;
      var pct    = Math.round(r.revenue/totalRev*100);
      var topItem= Object.entries(r.items).sort(function(a,b){return b[1]-a[1];})[0];
      var _dark  = document.documentElement.getAttribute('data-theme')==='dark';
      var mg_bg  = _dark ? (margin>=30?'#0a2218':margin>=15?'#2d1f06':'#2d0e0e') : (margin>=30?'#dcfce7':margin>=15?'#fef9c3':'#fee2e2');
      var mg_tc  = _dark ? (margin>=30?'#4ade80':margin>=15?'#fbbf24':'#f87171') : (margin>=30?'#15803d':margin>=15?'#854d0e':'#b91c1c');
      t += '<tr style="border-bottom:1px solid var(--border);background:'+(i%2===0?'var(--card)':'var(--bg)')+'">';
      t += '<td style="padding:8px 10px;font-weight:700;">'+r.name+'</td>';
      t += '<td style="padding:8px;text-align:center;font-weight:700;color:var(--primary);">'+fmt(r.revenue)+' ج</td>';
      t += '<td style="padding:8px;text-align:center;">'+fmt(r.cost)+' ج</td>';
      t += '<td style="padding:8px;text-align:center;"><span style="background:'+mg_bg+';color:'+mg_tc+';padding:2px 8px;border-radius:12px;font-size:11px;">'+margin+'%</span></td>';
      t += '<td style="padding:8px;text-align:center;">'+r.qty+'</td>';
      t += '<td style="padding:8px;text-align:center;">';
      t += '<div style="background:var(--border);border-radius:4px;height:6px;margin-bottom:2px;"><div style="background:var(--primary);height:6px;border-radius:4px;width:'+Math.min(pct,100)+'%;"></div></div>';
      t += '<span style="font-size:11px;">'+pct+'%</span></td>';
      t += '<td style="padding:8px;text-align:center;font-size:12px;">'+(topItem?topItem[0]+' (x'+topItem[1]+')':'-')+'</td>';
      t += '</tr>';
    });
    t += '</tbody></table></div>';
    return t;
  }

  var totalCost   = Object.values(catMap).reduce(function(s,x){return s+x.cost;},0);
  var totalMargin = totalRev>0 ? Math.round((totalRev-totalCost)/totalRev*100) : 0;
  var catCount    = Object.keys(catMap).length;
  var famCount    = Object.keys(famMap).length;
  var salesCount  = allSales.length;

  var out = '';
  // KPI row
  out += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px;">';
  var isDark = document.documentElement.getAttribute('data-theme')==='dark';
  [{l:'إيراد الفترة', v:fmt(totalRev)+' ج', bg_l:'#eff6ff', tc_l:'#1d4ed8', bg_d:'#0d1e35', tc_d:'#60a5fa'},
   {l:'هامش الربح',   v:totalMargin+'%',    bg_l:'#dcfce7', tc_l:'#15803d', bg_d:'#0a2218', tc_d:'#4ade80'},
   {l:'عدد الفواتير', v:salesCount,         bg_l:'#f5f3ff', tc_l:'#6d28d9', bg_d:'#1a1035', tc_d:'#a78bfa'},
   {l:'عدد الفئات',   v:catCount,           bg_l:'#fef9c3', tc_l:'#854d0e', bg_d:'#2d1f06', tc_d:'#fbbf24'},
   {l:'عدد المجموعات',v:famCount,           bg_l:'#fde8d0', tc_l:'#9a3412', bg_d:'#2a1205', tc_d:'#fb923c'}].forEach(function(k){
    var bg = isDark ? k.bg_d : k.bg_l;
    var tc = isDark ? k.tc_d : k.tc_l;
    out += '<div style="background:'+bg+';border-radius:8px;padding:12px;text-align:center;">';
    out += '<div style="font-size:20px;font-weight:800;color:'+tc+';">'+k.v+'</div>';
    out += '<div style="font-size:11px;color:var(--text-muted);">'+k.l+'</div></div>';
  });
  out += '</div>';
  out += buildTable(catMap, 'تقرير حسب الفئة (Category)', '🏷️');
  out += buildTable(famMap, 'تقرير حسب المجموعة (Family)', '📦');
  pane.innerHTML = out;
}

// BULK CATEGORY / FAMILY UPDATER
function openBulkCategoryModal() {
  var inv  = getInv();
  var cats = ['','cookware','kitchenware','dining','SDA','textile'];
  var fams = ['','Ahram','Ahram Home','Import','Local'];
  var rows = '';
  inv.forEach(function(p,i) {
    var catOpts = cats.map(function(v){ return '<option value="'+v+'" '+(((p.category||'')===(v))?'selected':'')+'>'+( v||'— اختر الفئة —')+'</option>'; }).join('');
    var famOpts = fams.map(function(v){ return '<option value="'+v+'" '+(((p.family||'')===(v))?'selected':'')+'>'+( v||'— اختر المجموعة —')+'</option>'; }).join('');
    rows += '<tr style="border-bottom:1px solid var(--border);">';
    rows += '<td style="padding:6px 8px;font-size:12px;"><strong>'+p.code+'</strong></td>';
    rows += '<td style="padding:6px 8px;font-size:12px;">'+p.name+'</td>';
    rows += '<td style="padding:4px 6px;"><select id="bcat_'+i+'" style="width:100%;font-size:12px;padding:4px;border:1px solid var(--border);border-radius:6px;">'+catOpts+'</select></td>';
    rows += '<td style="padding:4px 6px;"><select id="bfam_'+i+'" style="width:100%;font-size:12px;padding:4px;border:1px solid var(--border);border-radius:6px;">'+famOpts+'</select></td>';
    rows += '</tr>';
  });
  document.getElementById('bulkCatBody').innerHTML = rows;
  document.getElementById('bulkCatModal').dataset.count = inv.length;
  document.getElementById('bulkCatModal').classList.remove('hidden');
}

function saveBulkCategories() {
  var inv     = getInv();
  var changed = 0;
  inv.forEach(function(p, i) {
    var catEl = document.getElementById('bcat_' + i);
    var famEl = document.getElementById('bfam_' + i);
    if (!catEl || !famEl) return;
    if (catEl.value !== (p.category||'') || famEl.value !== (p.family||'')) {
      p.category = catEl.value;
      p.family   = famEl.value;
      changed++;
    }
  });
  if (changed > 0) { setInv(inv); renderInventory(); }
  document.getElementById('bulkCatModal').classList.add('hidden');
  alert(changed > 0 ? ('تم تحديث ' + changed + ' منتج') : 'لا يوجد تغييرات');
}

function filterUnclassified() {
  var rows    = document.getElementById('bulkCatBody').querySelectorAll('tr');
  var showAll = document.getElementById('bulkShowAll').checked;
  rows.forEach(function(row) {
    if (showAll) { row.style.display = ''; return; }
    var sels = row.querySelectorAll('select');
    var nocat = sels[0] && !sels[0].value;
    var nofam = sels[1] && !sels[1].value;
    row.style.display = (nocat || nofam) ? '' : 'none';
  });
}

// ══════════════════════════════════════════════
// VLOOKUP FROM EXCEL
// ══════════════════════════════════════════════
var _vlData    = [];  // parsed rows from uploaded file
var _vlHeaders = [];  // column headers

function openVlookupModal() {
  _vlData = []; _vlHeaders = [];
  document.getElementById('vlFile').value = '';
  document.getElementById('vlStep1').classList.remove('hidden');
  document.getElementById('vlStep2').classList.add('hidden');
  document.getElementById('vlStep3').classList.add('hidden');
  document.getElementById('vlookupModal').classList.remove('hidden');
}

function handleVlFile(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb   = XLSX.read(e.target.result, {type:'binary'});
      var ws   = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      if (!rows.length) { alert('الملف فارغ أو غير مقروء'); return; }
      _vlData    = rows;
      _vlHeaders = Object.keys(rows[0]);
      buildVlMappingUI();
    } catch(ex) { alert('خطأ في قراءة الملف: ' + ex.message); }
  };
  reader.readAsBinaryString(file);
}

function buildVlMappingUI() {
  document.getElementById('vlStep1').classList.add('hidden');
  document.getElementById('vlStep2').classList.remove('hidden');
  document.getElementById('vlStep3').classList.add('hidden');

  var opts = '<option value="">— اختر عمود —</option>' + _vlHeaders.map(function(h){ return '<option value="'+h+'">'+h+'</option>'; }).join('');
  var optsWithSkip = '<option value="">⛔ لا تستورد</option>' + _vlHeaders.map(function(h){ return '<option value="'+h+'">'+h+'</option>'; }).join('');

  document.getElementById('vlKeyCol').innerHTML   = opts;
  document.getElementById('vlCostCol').innerHTML  = optsWithSkip;
  document.getElementById('vlPriceBeforeCol').innerHTML = optsWithSkip;
  document.getElementById('vlPriceAfterCol').innerHTML  = optsWithSkip;
  document.getElementById('vlCategoryCol').innerHTML    = optsWithSkip;
  document.getElementById('vlFamilyCol').innerHTML      = optsWithSkip;

  // Auto-detect common column names
  var autoMatch = {
    vlKeyCol:         ['code','كود','الكود','sku','barcode','item code','كود المنتج'],
    vlCostCol:        ['cost','تكلفة','التكلفة','buying price','buy price','سعر الشراء'],
    vlPriceBeforeCol: ['price before','pricebefore','السعر قبل','قبل','old price','before'],
    vlPriceAfterCol:  ['price after','priceafter','السعر بعد','بعد','price','السعر','after'],
    vlCategoryCol:    ['category','الفئة','فئة','كاتيجورى','كاتيجوري','cat'],
    vlFamilyCol:      ['family','المجموعة','مجموعة','فاميلى','فاميلي','fam']
  };
  Object.keys(autoMatch).forEach(function(selId) {
    var sel = document.getElementById(selId);
    var keywords = autoMatch[selId];
    _vlHeaders.forEach(function(h) {
      if (keywords.indexOf(h.toLowerCase().trim()) !== -1) {
        sel.value = h;
      }
    });
  });

  document.getElementById('vlFileInfo').textContent = _vlData.length + ' صف • ' + _vlHeaders.length + ' عمود';
}

function previewVlookup() {
  var keyCol = document.getElementById('vlKeyCol').value;
  if (!keyCol) { alert('اختر عمود الكود أولاً'); return; }

  var mapping = {
    cost:        document.getElementById('vlCostCol').value,
    priceBefore: document.getElementById('vlPriceBeforeCol').value,
    priceAfter:  document.getElementById('vlPriceAfterCol').value,
    category:    document.getElementById('vlCategoryCol').value,
    family:      document.getElementById('vlFamilyCol').value
  };

  var hasAnyMapping = Object.values(mapping).some(function(v){ return v !== ''; });
  if (!hasAnyMapping) { alert('اختر على الأقل حقل واحد للاستيراد'); return; }

  var inv = getInv();
  var results = [];

  _vlData.forEach(function(row) {
    var keyVal = String(row[keyCol]||'').trim();
    if (!keyVal) return;
    var prod = inv.find(function(p){ return p.code === keyVal || p.code.toLowerCase() === keyVal.toLowerCase(); });
    var changes = {};
    var hasChange = false;

    if (mapping.cost && row[mapping.cost] !== '') {
      var v = parseFloat(row[mapping.cost]);
      if (!isNaN(v) && v !== (prod ? prod.cost : null)) { changes.cost = v; hasChange = true; }
    }
    if (mapping.priceBefore && row[mapping.priceBefore] !== '') {
      var v = parseFloat(row[mapping.priceBefore]);
      if (!isNaN(v) && v !== (prod ? prod.priceBefore : null)) { changes.priceBefore = v; hasChange = true; }
    }
    if (mapping.priceAfter && row[mapping.priceAfter] !== '') {
      var v = parseFloat(row[mapping.priceAfter]);
      if (!isNaN(v) && v !== (prod ? prod.priceAfter : null)) { changes.priceAfter = v; hasChange = true; }
    }
    if (mapping.category && row[mapping.category] !== '') {
      var v = String(row[mapping.category]).trim();
      if (v !== (prod ? (prod.category||'') : null)) { changes.category = v; hasChange = true; }
    }
    if (mapping.family && row[mapping.family] !== '') {
      var v = String(row[mapping.family]).trim();
      if (v !== (prod ? (prod.family||'') : null)) { changes.family = v; hasChange = true; }
    }

    results.push({ keyVal:keyVal, prod:prod||null, changes:changes, hasChange:hasChange, found:!!prod });
  });

  // Show preview
  document.getElementById('vlStep2').classList.add('hidden');
  document.getElementById('vlStep3').classList.remove('hidden');

  var matched   = results.filter(function(r){ return r.found && r.hasChange; });
  var notFound  = results.filter(function(r){ return !r.found; });
  var noChange  = results.filter(function(r){ return r.found && !r.hasChange; });

  document.getElementById('vlPreviewStats').innerHTML =
    '<span style="background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:12px;font-size:13px;margin:0 4px;">✅ سيتم تحديث: '+matched.length+' منتج</span>' +
    '<span style="background:#fee2e2;color:#b91c1c;padding:3px 10px;border-radius:12px;font-size:13px;margin:0 4px;">❌ غير موجود: '+notFound.length+'</span>' +
    '<span style="background:#f3f4f6;color:#374151;padding:3px 10px;border-radius:12px;font-size:13px;margin:0 4px;">➖ لا تغيير: '+noChange.length+'</span>';

  var fieldLabel = {cost:'التكلفة', priceBefore:'السعر قبل', priceAfter:'السعر بعد', category:'الفئة', family:'المجموعة'};
  var tbody = '';
  matched.forEach(function(r) {
    var changesHtml = Object.entries(r.changes).map(function(e){
      var lbl = fieldLabel[e[0]] || e[0];
      var old = r.prod ? (r.prod[e[0]]||'—') : '—';
      return '<div style="font-size:11px;"><span style="color:var(--text-muted);">'+lbl+':</span> <span style="text-decoration:line-through;color:#dc2626;">'+old+'</span> → <strong style="color:#15803d;">'+e[1]+'</strong></div>';
    }).join('');
    tbody += '<tr style="border-bottom:1px solid var(--border);">';
    tbody += '<td style="padding:8px;font-weight:700;font-size:13px;">'+r.keyVal+'</td>';
    tbody += '<td style="padding:8px;font-size:13px;">'+(r.prod?r.prod.name:'')+'</td>';
    tbody += '<td style="padding:8px;">'+changesHtml+'</td>';
    tbody += '</tr>';
  });
  if (notFound.length) {
    notFound.forEach(function(r){
      tbody += '<tr style="border-bottom:1px solid var(--border);opacity:.5;">';
      tbody += '<td style="padding:8px;font-size:13px;">'+r.keyVal+'</td>';
      tbody += '<td colspan="2" style="padding:8px;font-size:12px;color:#dc2626;">❌ غير موجود في المخزون</td>';
      tbody += '</tr>';
    });
  }
  document.getElementById('vlPreviewBody').innerHTML = tbody || '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted);">لا توجد تغييرات</td></tr>';

  // store for apply
  document.getElementById('vlApplyBtn').onclick = function() { applyVlookup(matched); };
}

function applyVlookup(matched) {
  if (!matched || !matched.length) { alert('لا توجد تغييرات للتطبيق'); return; }
  var inv = getInv();
  matched.forEach(function(r) {
    var prod = inv.find(function(p){ return p.code === r.keyVal || p.code.toLowerCase() === r.keyVal.toLowerCase(); });
    if (!prod) return;
    Object.keys(r.changes).forEach(function(field){ prod[field] = r.changes[field]; });
  });
  setInv(inv);
  renderInventory();
  document.getElementById('vlookupModal').classList.add('hidden');
  alert('تم تحديث ' + matched.length + ' منتج بنجاح');
}

// ══════════════════════════════════════════
// CUSTOMIZED REPORTS PAGE
// ══════════════════════════════════════════
function getDateRangeForPeriod(period) {
  var now = new Date();
  var from, to;
  to = now.toISOString().slice(0,10);
  if (period === 'today') {
    from = to;
  } else if (period === 'week') {
    var d = new Date(now); d.setDate(d.getDate() - d.getDay());
    from = d.toISOString().slice(0,10);
  } else if (period === 'month') {
    from = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
  } else if (period === 'year') {
    from = now.getFullYear() + '-01-01';
  } else {
    return null; // custom
  }
  return {from: from, to: to};
}

function onCustPeriodChange() {
  var period = document.getElementById('custRptPeriod')?.value;
  var customDiv = document.getElementById('custRptCustomDates');
  if (period === 'custom') {
    customDiv.classList.remove('hidden');
    customDiv.style.display = 'flex';
  } else {
    customDiv.classList.add('hidden');
  }
  renderCustomizedPage();
}

function renderCustomizedPage() {
  var period = document.getElementById('custRptPeriod')?.value || 'month';
  var from, to;
  if (period === 'custom') {
    from = document.getElementById('custRptFrom')?.value || '';
    to   = document.getElementById('custRptTo')?.value   || '';
  } else {
    var range = getDateRangeForPeriod(period);
    from = range ? range.from : '';
    to   = range ? range.to   : '';
  }
  renderCategoryReport(from, to);
}

// ══════════════════════════════════════════════
// WAREHOUSE (المخزن الرئيسي) MODULE
// ══════════════════════════════════════════════
var _whTrItems = [];

function renderWarehousePage() {
  var inv = getInv('wh');
  var q      = (document.getElementById('whSearch')?.value || '').toLowerCase();
  var catF   = document.getElementById('whCatFilter')?.value || '';
  var famF   = document.getElementById('whFamFilter')?.value || '';

  var items = inv;
  if (q)    items = items.filter(function(p){ return (p.name||'').toLowerCase().includes(q)||(p.code||'').toLowerCase().includes(q); });
  if (catF) items = items.filter(function(p){ return (p.category||'') === catF; });
  if (famF) items = items.filter(function(p){ return (p.family||'') === famF; });

  // KPI
  var totalItems = inv.length;
  var totalUnits = inv.reduce(function(s,p){ return s+(p.qty||0); }, 0);
  var totalValue = inv.reduce(function(s,p){ return s+(p.qty||0)*(p.cost||0); }, 0);
  var lowItems   = inv.filter(function(p){ return (p.qty||0) <= getThreshold(); }).length;

  document.getElementById('wh-items').textContent = totalItems;
  document.getElementById('wh-units').textContent = totalUnits.toLocaleString();
  document.getElementById('wh-value').textContent = fmt(totalValue) + ' ج';
  document.getElementById('wh-low').textContent   = lowItems;

  // Table
  var tbody = '';
  if (!items.length) {
    tbody = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد أصناف — أضف منتجات أو استورد من Excel</td></tr>';
  } else {
    items.forEach(function(p, i) {
      var val    = (p.qty||0) * (p.cost||0);
      var low    = (p.qty||0) <= getThreshold();
      var rowBg  = low ? '#fff5f5' : (i%2===0 ? 'white' : '#fafafa');
      var qtyClr = low ? '#dc2626' : '#1d4ed8';
      tbody += '<tr style="border-bottom:1px solid var(--border);background:'+rowBg+';">';
      tbody += '<td style="padding:8px 12px;font-size:12px;color:var(--text-muted);">'+p.code+'</td>';
      tbody += '<td style="padding:8px 12px;font-weight:600;">'+p.name+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-size:12px;">'+(p.category||'—')+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-size:12px;">'+(p.family||'—')+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-weight:700;color:'+qtyClr+';">'+(p.qty||0)+(low?' ⚠️':'')+'</td>';
      tbody += '<td style="padding:8px;text-align:center;">'+fmt(p.cost||0)+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-weight:600;">'+fmt(val)+'</td>';
      tbody += '<td style="padding:8px;text-align:center;">';
      tbody += '<button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;" onclick="openWhTransferModal(\''+p.code+'\')">📤 تحويل</button>';
      tbody += '</td>';
      tbody += '</tr>';
    });
  }
  document.getElementById('whInventoryBody').innerHTML = tbody;

  // Transfer history
  var transfers = getTransfers().filter(function(t){ return t.from==='wh'||t.to==='wh'; }).slice(0,10);
  var histHtml = '';
  if (!transfers.length) {
    histHtml = '<p style="color:var(--text-muted);font-size:13px;">لا توجد تحويلات بعد</p>';
  } else {
    histHtml = '<div style="overflow-x:auto;background:white;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);">';
    histHtml += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    histHtml += '<thead><tr style="background:var(--bg-secondary);"><th style="padding:8px;text-align:right;">التاريخ</th><th style="padding:8px;text-align:right;">من</th><th style="padding:8px;text-align:right;">إلى</th><th style="padding:8px;text-align:center;">الأصناف</th><th style="padding:8px;">ملاحظة</th></tr></thead><tbody>';
    transfers.forEach(function(t){
      histHtml += '<tr style="border-bottom:1px solid var(--border);">';
      histHtml += '<td style="padding:7px 8px;font-size:12px;color:var(--text-muted);">'+(t.date?t.date.slice(0,10):'')+'</td>';
      histHtml += '<td style="padding:7px 8px;font-weight:600;">'+(t.fromName||t.from)+'</td>';
      histHtml += '<td style="padding:7px 8px;font-weight:600;">'+(t.toName||t.to)+'</td>';
      histHtml += '<td style="padding:7px 8px;text-align:center;">'+(t.items?.length||0)+' صنف</td>';
      histHtml += '<td style="padding:7px 8px;font-size:12px;color:var(--text-muted);">'+(t.note||'—')+'</td>';
      histHtml += '</tr>';
    });
    histHtml += '</tbody></table></div>';
  }
  document.getElementById('whTransferHistory').innerHTML = histHtml;
}

// Open transfer modal (optionally pre-fill a product)
function openWhTransferModal(preCode) {
  _whTrItems = [];
  // Populate branch options (exclude wh)
  var branches = getBranches();
  var opts = BRANCH_IDS.filter(function(b){ return b !== 'wh'; })
    .map(function(b){ return '<option value="'+b+'">'+(branches[b]||BRANCH_DEFAULTS[b])+'</option>'; }).join('');
  document.getElementById('whTrToBranch').innerHTML = opts;
  document.getElementById('whTrSearch').value = '';
  document.getElementById('whTrNote').value = '';
  document.getElementById('whTrSearchResults').style.display = 'none';
  document.getElementById('whTrSearchResults').innerHTML = '';

  // If a specific product code was passed, add it
  if (preCode) {
    var inv = getInv('wh');
    var prod = inv.find(function(p){ return p.code === preCode; });
    if (prod) whTrAddItem(prod);
  }
  renderWhTrItems();
  document.getElementById('whTransferModal').classList.remove('hidden');
}

function whTrSearchProducts() {
  var q = document.getElementById('whTrSearch').value.toLowerCase().trim();
  var resultsDiv = document.getElementById('whTrSearchResults');
  if (!q) { resultsDiv.style.display='none'; return; }
  var inv = getInv('wh');
  var matches = inv.filter(function(p){ return (p.name||'').toLowerCase().includes(q)||(p.code||'').toLowerCase().includes(q); }).slice(0,8);
  if (!matches.length) { resultsDiv.style.display='none'; return; }
  resultsDiv.style.display = 'block';
  resultsDiv.innerHTML = matches.map(function(p){
    return '<div onclick="whTrAddItem('+JSON.stringify(p).replace(/"/g,"'")+'); this.parentNode.style.display=\'none\';" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;" onmouseover="this.style.background=\'#f0f9ff\'" onmouseout="this.style.background=\'white\'">'
      +'<span style="font-weight:600;font-size:13px;">'+p.name+'</span>'
      +'<span style="font-size:12px;color:var(--text-muted);">متاح: <strong style="color:#1d4ed8;">'+p.qty+'</strong></span>'
      +'</div>';
  }).join('');
}

function whTrAddItem(prod) {
  var existing = _whTrItems.find(function(i){ return i.code===prod.code; });
  if (existing) { existing.qty++; }
  else { _whTrItems.push({code:prod.code, name:prod.name, qty:1, maxQty:prod.qty||0}); }
  document.getElementById('whTrSearch').value = '';
  document.getElementById('whTrSearchResults').style.display='none';
  renderWhTrItems();
}

function renderWhTrItems() {
  var div = document.getElementById('whTrItems');
  if (!_whTrItems.length) { div.innerHTML='<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">ابحث عن المنتجات وأضفها</p>'; return; }
  var html2 = '<div style="background:var(--bg-secondary);border-radius:8px;padding:10px;max-height:200px;overflow-y:auto;">';
  _whTrItems.forEach(function(item, idx){
    html2 += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:white;border-radius:6px;margin-bottom:6px;">';
    html2 += '<div><div style="font-weight:600;font-size:13px;">'+item.name+'</div>';
    html2 += '<div style="font-size:11px;color:var(--text-muted);">متاح في المخزن: '+item.maxQty+'</div></div>';
    html2 += '<div style="display:flex;align-items:center;gap:6px;">';
    html2 += '<button onclick="whTrChangeQty('+idx+',-1)" class="btn btn-gray" style="padding:2px 8px;font-size:14px;min-width:28px;">−</button>';
    html2 += '<input type="number" value="'+item.qty+'" min="1" max="'+item.maxQty+'" onchange="whTrSetQty('+idx+',this.value)" style="width:55px;text-align:center;border:1px solid var(--border);border-radius:5px;padding:3px;" />';
    html2 += '<button onclick="whTrChangeQty('+idx+',1)" class="btn btn-gray" style="padding:2px 8px;font-size:14px;min-width:28px;">+</button>';
    html2 += '<button onclick="whTrRemoveItem('+idx+')" style="background:#fee2e2;border:none;border-radius:5px;padding:3px 8px;cursor:pointer;color:#dc2626;">✕</button>';
    html2 += '</div></div>';
  });
  html2 += '</div>';
  div.innerHTML = html2;
}

function whTrChangeQty(idx, delta) {
  _whTrItems[idx].qty = Math.max(1, Math.min(_whTrItems[idx].maxQty, _whTrItems[idx].qty + delta));
  renderWhTrItems();
}
function whTrSetQty(idx, val) {
  _whTrItems[idx].qty = Math.max(1, Math.min(_whTrItems[idx].maxQty, parseInt(val)||1));
  renderWhTrItems();
}
function whTrRemoveItem(idx) { _whTrItems.splice(idx,1); renderWhTrItems(); }

function confirmWhTransfer() {
  var to = document.getElementById('whTrToBranch').value;
  if (!to) { alert('اختر الفرع'); return; }
  if (!_whTrItems.length) { alert('أضف أصناف للتحويل'); return; }
  var note = document.getElementById('whTrNote').value.trim();

  // Validate quantities from warehouse
  var whInv = getInv('wh');
  for (var k=0; k<_whTrItems.length; k++) {
    var it = _whTrItems[k];
    var p  = whInv.find(function(x){ return x.code===it.code; });
    if (!p || p.qty < it.qty) {
      alert('الكمية المطلوبة من "'+it.name+'" غير متاحة في المخزن الرئيسي (متاح: '+(p?p.qty:0)+')');
      return;
    }
  }

  // Deduct from warehouse
  var newWh = whInv.map(function(p){
    var tr = _whTrItems.find(function(i){ return i.code===p.code; });
    return tr ? Object.assign({},p,{qty: p.qty - tr.qty}) : p;
  });
  setInv(newWh, 'wh');

  // Add to destination branch
  var dstInv = getInv(to).map(function(p){ return Object.assign({},p); });
  _whTrItems.forEach(function(item){
    var dp = dstInv.find(function(x){ return x.code===item.code; });
    if (dp) dp.qty += item.qty;
    else {
      var src = whInv.find(function(x){ return x.code===item.code; });
      dstInv.push(Object.assign({}, src, {qty: item.qty}));
    }
  });
  setInv(dstInv, to);

  // Save transfer record
  var branches = getBranches();
  var record = {
    id: Date.now(), date: new Date().toISOString(),
    from: 'wh', to: to,
    fromName: branches['wh'] || '🏭 المخزن الرئيسي',
    toName:   branches[to]   || BRANCH_DEFAULTS[to],
    items: _whTrItems.map(function(i){ return Object.assign({},i); }),
    note: note, status: 'completed',
    by: currentUser === 'admin' ? 'مدير' : 'كاشير'
  };
  var list = getTransfers(); list.unshift(record); setTransfers(list);

  document.getElementById('whTransferModal').classList.add('hidden');
  renderWarehousePage();
  alert('✅ تم التحويل بنجاح\nمن: المخزن الرئيسي → إلى: '+(record.toName)+'\n'+_whTrItems.length+' صنف');
}

// ══════════════════════════════════════════════════════
// PRICE-CHANGE APPROVAL SYSTEM
// ══════════════════════════════════════════════════════

// ── Data layer ─────────────────────────────────────────
var _approvalsCache = null;
function getApprovals() {
  if (!_approvalsCache) _approvalsCache = DB.g('pos_price_approvals', []);
  return _approvalsCache;
}
function setApprovals(v) {
  _approvalsCache = v;
  DB.s('pos_price_approvals', v);
  if (_fbReady && _db) {
    _db.collection('pos_data').doc('price_approvals')
       .set({ items: v, updatedAt: Date.now() })
       .catch(function(e){ console.error('setApprovals:', e); });
  }
}

// ── Cashier: edit item price ────────────────────────────
function editItemPrice(code) {
  var item = cart.find(function(i){ return i.code === code; });
  if (!item) return;
  var newPrice = parseFloat(prompt('السعر الجديد لـ "' + item.name + '" (السعر الحالي: ' + item.price + ')', item.price));
  if (isNaN(newPrice) || newPrice <= 0) return;
  if (newPrice === item.price) return;
  if (!item.priceModified) item.originalPrice = item.price;
  item.price = newPrice;
  item.priceModified = true;
  renderCart();
}

// ── Cashier: send for approval ──────────────────────────
function sendForApproval() {
  if (!cart.length) { alert('الفاتورة فارغة'); return; }
  var hasModified = cart.some(function(i){ return i.priceModified; });
  if (!hasModified) { openPayment(); return; }
  var note = prompt('ملاحظة للمدير (اختياري):', '') || '';
  var { total } = cartTotals();
  var request = {
    id: Date.now(),
    date: new Date().toISOString(),
    cashier: currentUser || 'كاشير',
    branchId: currentBranch,
    branchName: (getBranches()[currentBranch] || BRANCH_DEFAULTS[currentBranch]),
    items: cart.map(function(i){ return Object.assign({}, i); }),
    total: total,
    note: note,
    status: 'pending',
    adminNote: ''
  };
  var list = getApprovals();
  list.unshift(request);
  setApprovals(list);
  clearCart();
  updateApprovalBadge();
  alert('✅ تم إرسال الفاتورة للمدير\nسيتم إشعارك عند الموافقة');
}

// ── Admin: open approvals panel ─────────────────────────
function openApprovalsPanel() {
  renderApprovalsList();
  document.getElementById('approvalsModal').classList.remove('hidden');
}

function renderApprovalsList() {
  var list = getApprovals().filter(function(r){ return r.status === 'pending'; });
  var el = document.getElementById('approvalsList');
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد طلبات معلقة ✓</div>';
    return;
  }
  el.innerHTML = list.map(function(req){
    var itemsHtml = req.items.filter(function(i){ return i.priceModified; }).map(function(i){
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">'
        + '<span style="font-weight:600;font-size:13px;">'+i.name+'</span>'
        + '<span style="font-size:13px;">'
        + '<span style="text-decoration:line-through;color:#9ca3af;">'+fmt(i.originalPrice)+' ج</span>'
        + ' → <span style="color:#dc2626;font-weight:700;">'+fmt(i.price)+' ج</span>'
        + ' × '+i.qty
        + '</span></div>';
    }).join('');
    return '<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<div><div style="font-weight:700;font-size:14px;">📋 فاتورة #'+req.id+'</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">'+req.date.slice(0,16).replace('T',' ')+' — '+req.branchName+' — '+req.cashier+'</div></div>'
      + '<div style="font-size:20px;font-weight:800;color:#1d4ed8;">'+fmt(req.total)+' ج</div>'
      + '</div>'
      + '<div style="margin-bottom:10px;">'+itemsHtml+'</div>'
      + (req.note ? '<div style="background:#fef9c3;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;">💬 '+req.note+'</div>' : '')
      + '<div style="display:flex;gap:8px;">'
      + '<input id="adminNote_'+req.id+'" class="form-control" placeholder="ملاحظة للكاشير (اختياري)" style="flex:1;font-size:12px;" />'
      + '<button onclick="approveRequest('+req.id+')" class="btn btn-success">✅ موافقة</button>'
      + '<button onclick="rejectRequest('+req.id+')" class="btn btn-danger btn-sm">❌ رفض</button>'
      + '</div></div>';
  }).join('');
}

function approveRequest(id) {
  var list = getApprovals();
  var req = list.find(function(r){ return r.id === id; });
  if (!req) return;
  req.status = 'approved';
  req.adminNote = document.getElementById('adminNote_' + id)?.value || '';
  req.approvedAt = new Date().toISOString();
  setApprovals(list);
  updateApprovalBadge();
  renderApprovalsList();
  alert('✅ تمت الموافقة — سيتم إشعار الكاشير');
}

function rejectRequest(id) {
  var list = getApprovals();
  var req = list.find(function(r){ return r.id === id; });
  if (!req) return;
  req.status = 'rejected';
  req.adminNote = document.getElementById('adminNote_' + id)?.value || '';
  req.rejectedAt = new Date().toISOString();
  setApprovals(list);
  updateApprovalBadge();
  renderApprovalsList();
}

// ── Badge update ────────────────────────────────────────
function updateApprovalBadge() {
  var pending = getApprovals().filter(function(r){ return r.status === 'pending'; }).length;
  var btn    = document.getElementById('approvalBellBtn');
  var badge  = document.getElementById('approvalBadge');
  if (currentUser === 'admin') {
    if (btn) btn.style.display = pending > 0 ? 'inline-block' : 'none';
    if (badge) { badge.style.display = pending > 0 ? 'inline-block' : 'none'; badge.textContent = pending; }
  }
  // Cashier: check for newly approved items
  checkForApprovedCarts();
}

// ── Cashier: watch for approvals ────────────────────────
var _notifiedApprovals = DB.g('pos_notified_approvals', []);
function checkForApprovedCarts() {
  if (currentUser === 'admin') return;
  var approved = getApprovals().filter(function(r){
    return r.status === 'approved' && r.cashier === currentUser && !_notifiedApprovals.includes(r.id);
  });
  if (!approved.length) return;
  approved.forEach(function(r){ _notifiedApprovals.push(r.id); });
  DB.s('pos_notified_approvals', _notifiedApprovals);
  // Show toast
  var toast = document.getElementById('approvalToast');
  document.getElementById('approvalToastMsg').textContent = approved.length + ' فاتورة جاهزة للإتمام';
  if (toast) { toast.style.display = 'block'; setTimeout(function(){ toast.style.display='none'; }, 12000); }
}

// ── Cashier: open approved carts ────────────────────────
function openApprovedCarts() {
  document.getElementById('approvalToast').style.display = 'none';
  renderApprovedCartsList();
  document.getElementById('approvedCartsModal').classList.remove('hidden');
}

function renderApprovedCartsList() {
  var myApproved = getApprovals().filter(function(r){
    return r.status === 'approved' && (currentUser === 'admin' || r.cashier === currentUser);
  });
  var el = document.getElementById('approvedCartsList');
  if (!myApproved.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد فواتير معتمدة</div>';
    return;
  }
  el.innerHTML = myApproved.map(function(req){
    var itemsHtml = req.items.map(function(i){
      return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;">'
        + '<span>'+i.name+' × '+i.qty+'</span>'
        + '<span style="font-weight:700;'+(i.priceModified?'color:#dc2626;':'')+'">'+fmt(i.price)+' ج</span>'
        + '</div>';
    }).join('');
    return '<div style="background:white;border:2px solid #10b981;border-radius:10px;padding:14px;margin-bottom:10px;">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">'
      + '<div><div style="font-weight:700;">✅ معتمدة — '+req.branchName+'</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">'+req.date.slice(0,16).replace('T',' ')+'</div></div>'
      + '<div style="font-size:20px;font-weight:800;color:#1d4ed8;">'+fmt(req.total)+' ج</div>'
      + '</div>'
      + '<div style="margin-bottom:10px;">'+itemsHtml+'</div>'
      + (req.adminNote ? '<div style="background:#d1fae5;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:8px;">💬 '+req.adminNote+'</div>' : '')
      + '<button onclick="resumeApprovedCart('+req.id+')" class="btn btn-success" style="width:100%;">🛒 تحميل الفاتورة وإتمام البيع</button>'
      + '</div>';
  }).join('');
}

function resumeApprovedCart(id) {
  var req = getApprovals().find(function(r){ return r.id === id; });
  if (!req) return;
  if (cart.length && !confirm('سيتم استبدال الفاتورة الحالية. هل تريد المتابعة؟')) return;
  cart = req.items.map(function(i){ return Object.assign({},i); });
  renderCart();
  document.getElementById('approvedCartsModal').classList.add('hidden');
  // Mark as consumed
  var list = getApprovals();
  var r = list.find(function(x){ return x.id === id; });
  if (r) r.status = 'consumed';
  setApprovals(list);
  updateApprovalBadge();
  // Open payment
  setTimeout(openPayment, 300);
}

// ── Firebase listener for approvals ────────────────────
function initApprovalsFirebaseListener() {
  if (!_fbReady || !_db) return;
  _db.collection('pos_data').doc('price_approvals')
    .onSnapshot(function(snap) {
      if (snap.exists) {
        _approvalsCache = snap.data().items || [];
        DB.s('pos_price_approvals', _approvalsCache);
        updateApprovalBadge();
      }
    }, function(err){ console.error('approvals listener:', err); });
}

// ══════════════════════════════════════════
// SUSPENDED PAGE TABS
// ══════════════════════════════════════════
function switchSuspTab(tab, el) {
  ['bills','approvals'].forEach(function(t){
    var pane = document.getElementById('suspPane_'+t);
    var btn  = document.getElementById('suspTab_'+t);
    if (pane) pane.classList.toggle('hidden', t!==tab);
    if (btn)  btn.classList.toggle('active',  t===tab);
  });
  if (tab === 'approvals') renderSuspApprovals();
}

function renderSuspApprovals() {
  var el = document.getElementById('suspApprovalsList');
  if (!el) return;
  var list = getApprovals().filter(function(r){ return r.status === 'pending'; });

  // Update count badge
  var badge = document.getElementById('suspApprovalsCount');
  if (badge) { badge.textContent = list.length; badge.style.display = list.length ? 'inline' : 'none'; }

  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">✅ لا توجد طلبات معلقة</div>';
    return;
  }
  el.innerHTML = list.map(function(req){
    var modItems = req.items.filter(function(i){ return i.priceModified; });
    var itemsHtml = modItems.map(function(i){
      return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">'
        +'<span style="font-weight:600;">'+i.name+' × '+i.qty+'</span>'
        +'<span><span style="text-decoration:line-through;color:#9ca3af;">'+fmt(i.originalPrice)+' ج</span>'
        +' → <span style="color:#dc2626;font-weight:700;">'+fmt(i.price)+' ج</span></span>'
        +'</div>';
    }).join('');
    return '<div style="background:white;border:1px solid #fecaca;border-right:4px solid #ef4444;border-radius:10px;padding:16px;margin-bottom:12px;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      +'<div>'
      +'<div style="font-weight:700;font-size:14px;">✏️ طلب تعديل سعر</div>'
      +'<div style="font-size:12px;color:var(--text-muted);">'+req.date.slice(0,16).replace('T',' ')+' — '+req.branchName+' — '+req.cashier+'</div>'
      +'</div>'
      +'<div style="font-size:20px;font-weight:800;color:#1d4ed8;">'+fmt(req.total)+' ج</div>'
      +'</div>'
      +'<div style="margin-bottom:10px;">'+itemsHtml+'</div>'
      +(req.note?'<div style="background:#fef9c3;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;">💬 '+req.note+'</div>':'')
      +'<div style="display:flex;gap:8px;align-items:center;">'
      +'<input id="sAdminNote_'+req.id+'" class="form-control" placeholder="ملاحظة للكاشير (اختياري)" style="flex:1;font-size:12px;" />'
      +'<button onclick="approveSuspRequest('+req.id+')" class="btn btn-success">✅ موافقة</button>'
      +'<button onclick="rejectSuspRequest('+req.id+')" class="btn btn-danger btn-sm">❌ رفض</button>'
      +'</div>'
      +'</div>';
  }).join('');
}

function approveSuspRequest(id) {
  var list = getApprovals();
  var req  = list.find(function(r){ return r.id===id; });
  if (!req) return;
  req.status    = 'approved';
  req.adminNote = document.getElementById('sAdminNote_'+id)?.value || '';
  req.approvedAt= new Date().toISOString();
  setApprovals(list);
  updateApprovalBadge();
  renderSuspApprovals();
}

function rejectSuspRequest(id) {
  var list = getApprovals();
  var req  = list.find(function(r){ return r.id===id; });
  if (!req) return;
  req.status    = 'rejected';
  req.adminNote = document.getElementById('sAdminNote_'+id)?.value || '';
  req.rejectedAt= new Date().toISOString();
  setApprovals(list);
  updateApprovalBadge();
  renderSuspApprovals();
}

function updateHomeClock() {
  var now = new Date();
  var hh  = String(now.getHours()).padStart(2,'0');
  var mm  = String(now.getMinutes()).padStart(2,'0');
  var el  = document.getElementById('homeClock');
  if (el) el.textContent = hh + ':' + mm;
  var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  var dateStr = days[now.getDay()] + ' ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
  var del = document.getElementById('homeDate');
  if (del) del.textContent = dateStr;
  var greet = document.getElementById('homeGreeting');
  if (greet) {
    var h = now.getHours();
    var g = h < 12 ? '🌅 صباح الخير' : h < 18 ? '☀️ مساء الخير' : '🌙 مساء النور';
    greet.textContent = g;
  }
}
function showFirstRunSetup() {
  document.getElementById('firstRunModal').classList.remove('hidden');
  document.getElementById('loginPage').classList.add('hidden');
}
async function confirmFirstRun() {
  const p1 = document.getElementById('frPass1').value;
  const p2 = document.getElementById('frPass2').value;
  const msg = document.getElementById('frMsg');
  if (p1.length < 4) { msg.textContent = 'كلمة المرور قصيرة جداً (4 أحرف على الأقل)'; return; }
  if (p1 !== p2)     { msg.textContent = 'كلمتا المرور غير متطابقتين'; return; }
  const hashed = await hashPass(p1);
  const users  = getUsers();
  users.admin  = hashed;
  setUsersLocal(users);
  document.getElementById('firstRunModal').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('frMsg').textContent = '';
  showToast('✅ تم تعيين كلمة مرور المدير — سجّل الدخول الآن');
}

setInterval(updateHomeClock, 1000);



// ═══════════════════════════════════════════════════════════════════════
// EXPENSE APPROVAL REQUESTS — طلبات اعتماد المصاريف
// ═══════════════════════════════════════════════════════════════════════
let _expReqCache = null;
function getExpenseRequests() {
  if (!_expReqCache) _expReqCache = DB.g('pos_expense_requests', []);
  return _expReqCache;
}
function setExpenseRequests(list) {
  _expReqCache = list;
  DB.s('pos_expense_requests', list);
  try { _db && _db.collection('pos_data').doc('expense_requests').set({ list, updatedAt: Date.now() }); } catch(e) {}
}
function openExpenseRequestModal() {
  const brSel = document.getElementById('expReqBranchId');
  if (brSel) brSel.innerHTML = BRANCH_IDS.filter(b=>b!=='wh').map(b=>'<option value="'+b+'"'+(b===currentBranch?' selected':'')+'>'+getBranchName(b)+'</option>').join('');
  document.getElementById('expReqAmount').value = '';
  document.getElementById('expReqDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('expReqNote').value = '';
  document.getElementById('expReqCategory').value = 'rent';
  document.getElementById('expenseRequestModal').classList.remove('hidden');
}
function saveExpenseRequest() {
  const amount = parseFloat(document.getElementById('expReqAmount').value);
  const date   = document.getElementById('expReqDate').value;
  if (!amount || amount <= 0) { alert('أدخل مبلغ صحيح'); return; }
  if (!date) { alert('أدخل التاريخ'); return; }
  const rec = {
    id: 'expreq_' + Date.now(),
    branchId: document.getElementById('expReqBranchId').value || currentBranch,
    category: document.getElementById('expReqCategory').value,
    amount, date, month: date.slice(0,7),
    note: document.getElementById('expReqNote').value.trim(),
    status: 'pending',
    by: currentUser + ' (' + getBranchName(currentBranch) + ')',
    createdAt: Date.now()
  };
  const list = getExpenseRequests(); list.push(rec); setExpenseRequests(list);
  document.getElementById('expenseRequestModal').classList.add('hidden');
  updateExpReqBadge(); renderExpensesPage();
  showToast('✅ تم إرسال طلب المصروف — بانتظار اعتماد الإدارة');
}
function approveExpenseRequest(id) {
  if (!confirm('تأكيد اعتماد هذا المصروف؟')) return;
  const list = getExpenseRequests(); const req = list.find(r=>r.id===id); if (!req) return;
  req.status = 'approved'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
  setExpenseRequests(list);
  const expenses = getExpenses();
  expenses.push({ id:'exp_'+Date.now(), type:'branch', branchId:req.branchId, category:req.category,
    amount:req.amount, date:req.date, month:req.month,
    note:(req.note?req.note+' — ':'')+'معتمد من '+req.by, by:currentUser, createdAt:Date.now() });
  setExpenses(expenses);
  updateExpReqBadge(); renderExpensesPage(); showToast('✅ تمت الموافقة وتسجيل المصروف');
}
function rejectExpenseRequest(id) {
  const list = getExpenseRequests(); const req = list.find(r=>r.id===id); if (!req) return;
  req.status = 'rejected'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
  setExpenseRequests(list); updateExpReqBadge(); renderExpensesPage(); showToast('❌ تم رفض الطلب');
}
function updateExpReqBadge() {
  const pending = getExpenseRequests().filter(r=>r.status==='pending').length;
  const badge = document.getElementById('expReqBadge');
  if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
}
function switchExpTab(tab) {
  ['main','requests'].forEach(t => {
    const btn  = document.getElementById('expTabBtn_'+t);
    const pane = document.getElementById('expPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='requests') renderExpenseRequestsPane();
}
function renderExpenseRequestsPane() {
  const cont = document.getElementById('expPane_requests'); if (!cont) return;
  const isAdmin = currentUser === 'admin';
  const reqs = getExpenseRequests()
    .filter(r => isAdmin ? true : r.branchId === currentBranch)
    .sort((a,b) => b.createdAt - a.createdAt);
  if (!reqs.length) { cont.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px">لا توجد طلبات مصاريف</p>'; return; }
  cont.innerHTML = reqs.map(r => '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
    '<div style="flex:1;min-width:200px">' +
      '<div style="font-weight:700;font-size:15px">'+(EXP_CATS[r.category]||r.category)+' — <span style="color:#3d8fff">'+(r.amount||0).toLocaleString()+' ج</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">🏬 '+getBranchName(r.branchId)+' · 📅 '+r.date+(r.note?' · '+r.note:'')+'</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">👤 '+r.by+' · '+new Date(r.createdAt).toLocaleString('ar-EG')+'</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;background:'+(r.status==='pending'?'rgba(255,193,7,.15)':r.status==='approved'?'rgba(40,167,69,.15)':'rgba(220,53,69,.15)')+';color:'+(r.status==='pending'?'#e09000':r.status==='approved'?'#28a745':'#dc3545')+'">' +
        (r.status==='pending'?'⏳ بانتظار الاعتماد':r.status==='approved'?'✅ معتمد':'❌ مرفوض') +
      '</span>' +
      (isAdmin && r.status==='pending' ?
        '<button class="btn" style="background:#28a745;color:#fff;font-size:12px;padding:6px 14px" onclick="approveExpenseRequest(\''+r.id+'\')">✅ قبول</button>' +
        '<button class="btn" style="background:#dc3545;color:#fff;font-size:12px;padding:6px 14px" onclick="rejectExpenseRequest(\''+r.id+'\')">❌ رفض</button>' : '') +
      (r.status!=='pending' ? '<div style="font-size:11px;color:var(--text-muted)">'+r.reviewedBy+'</div>' : '') +
    '</div>' +
  '</div>').join('');
}


// ═══════════════════════════════════════════════════════════════════════
// LEAVE & PERMISSION REQUESTS — طلبات الإجازات والأذونات
// ═══════════════════════════════════════════════════════════════════════
let _leaveReqCache = null;
function getLeaveRequests() {
  if (!_leaveReqCache) _leaveReqCache = DB.g('pos_leave_requests', []);
  return _leaveReqCache;
}
function setLeaveRequests(list) {
  _leaveReqCache = list;
  DB.s('pos_leave_requests', list);
  try { _db && _db.collection('pos_data').doc('leave_requests').set({ list, updatedAt: Date.now() }); } catch(e) {}
}
function openLeaveRequestModal() {
  const empSel = document.getElementById('leaveReqEmpName');
  const emps = getSalespeople ? getSalespeople() : DB.g('pos_salespeople', []);
  const empNames = emps.map(e => typeof e === 'string' ? e : e.name).filter(Boolean);
  if (empSel) empSel.innerHTML = empNames.map(n => '<option value="'+n+'">'+n+'</option>').join('');
  document.getElementById('leaveReqDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('leaveReqType').value = 'leave';
  document.getElementById('leaveReqFromTime').value = '';
  document.getElementById('leaveReqToTime').value = '';
  document.getElementById('leaveReqReason').value = '';
  toggleLeaveTimeFields();
  document.getElementById('leaveRequestModal').classList.remove('hidden');
}
function toggleLeaveTimeFields() {
  const type = document.getElementById('leaveReqType').value;
  const row  = document.getElementById('leaveReqTimeRow');
  if (row) row.style.display = (type === 'permission') ? '' : 'none';
}
function saveLeaveRequest() {
  const empName = document.getElementById('leaveReqEmpName').value;
  const date    = document.getElementById('leaveReqDate').value;
  const type    = document.getElementById('leaveReqType').value;
  if (!empName) { alert('اختر الموظف'); return; }
  if (!date)    { alert('أدخل التاريخ'); return; }
  const rec = {
    id: 'leaveq_' + Date.now(),
    branchId: currentBranch,
    empName, type, date,
    fromTime: document.getElementById('leaveReqFromTime').value || '',
    toTime:   document.getElementById('leaveReqToTime').value   || '',
    reason:   document.getElementById('leaveReqReason').value.trim(),
    status: 'pending',
    by: currentUser + ' (' + getBranchName(currentBranch) + ')',
    createdAt: Date.now()
  };
  const list = getLeaveRequests(); list.push(rec); setLeaveRequests(list);
  document.getElementById('leaveRequestModal').classList.add('hidden');
  updateLeaveReqBadge(); renderHRPage();
  showToast('✅ تم إرسال الطلب — بانتظار موافقة الإدارة');
}
function approveLeaveRequest(id) {
  if (!confirm('تأكيد الموافقة على هذا الطلب؟')) return;
  const list = getLeaveRequests(); const req = list.find(r=>r.id===id); if (!req) return;
  req.status = 'approved'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
  setLeaveRequests(list);
  if (req.type === 'leave') {
    saveAttendanceRecord(req.empName, req.date, 'absent', '', '', 'إجازة معتمدة');
  } else {
    const notes = (req.fromTime && req.toTime) ? 'إذن انصراف '+req.fromTime+' - '+req.toTime : 'إذن انصراف معتمد';
    saveAttendanceRecord(req.empName, req.date, 'late', req.fromTime||'', req.toTime||'', notes);
  }
  updateLeaveReqBadge(); renderHRPage(); showToast('✅ تمت الموافقة وتسجيل الحضور');
}
function rejectLeaveRequest(id) {
  const list = getLeaveRequests(); const req = list.find(r=>r.id===id); if (!req) return;
  req.status = 'rejected'; req.reviewedBy = currentUser; req.reviewedAt = Date.now();
  setLeaveRequests(list); updateLeaveReqBadge(); renderHRPage(); showToast('❌ تم رفض الطلب');
}
function updateLeaveReqBadge() {
  const pending = getLeaveRequests().filter(r=>r.status==='pending').length;
  const badge = document.getElementById('leaveReqBadge');
  if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
}
function renderLeaveRequestsPane() {
  const cont = document.getElementById('hrPane_leavereqs'); if (!cont) return;
  const isAdmin = currentUser === 'admin';
  const btn = document.getElementById('leaveReqAddBtn');
  if (btn) btn.style.display = (currentUser !== 'admin') ? '' : 'none';
  const reqs = getLeaveRequests()
    .filter(r => isAdmin ? true : r.branchId === currentBranch)
    .sort((a,b) => b.createdAt - a.createdAt);
  if (!reqs.length) { cont.querySelector('#leaveReqList').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:32px">لا توجد طلبات إجازات أو أذونات</p>'; return; }
  const TYPE_LABELS = { leave: '🏖️ إجازة يوم كامل', permission: '🕐 إذن انصراف' };
  cont.querySelector('#leaveReqList').innerHTML = reqs.map(r =>
    '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
    '<div style="flex:1;min-width:200px">' +
      '<div style="font-weight:700;font-size:15px">👤 '+r.empName+' — <span style="color:#3d8fff">'+(TYPE_LABELS[r.type]||r.type)+'</span></div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">🏬 '+getBranchName(r.branchId)+' · 📅 '+r.date+(r.type==='permission'&&r.fromTime?' · 🕐 '+r.fromTime+'–'+r.toTime:'')+(r.reason?' · '+r.reason:'')+'</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">👤 '+r.by+' · '+new Date(r.createdAt).toLocaleString('ar-EG')+'</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;background:'+(r.status==='pending'?'rgba(255,193,7,.15)':r.status==='approved'?'rgba(40,167,69,.15)':'rgba(220,53,69,.15)')+';color:'+(r.status==='pending'?'#e09000':r.status==='approved'?'#28a745':'#dc3545')+'">' +
        (r.status==='pending'?'⏳ بانتظار الموافقة':r.status==='approved'?'✅ موافق عليه':'❌ مرفوض') +
      '</span>' +
      (isAdmin && r.status==='pending' ?
        '<button class="btn" style="background:#28a745;color:#fff;font-size:12px;padding:6px 14px" onclick="approveLeaveRequest(\''+r.id+'\')">✅ قبول</button>' +
        '<button class="btn" style="background:#dc3545;color:#fff;font-size:12px;padding:6px 14px" onclick="rejectLeaveRequest(\''+r.id+'\')">❌ رفض</button>' : '') +
      (r.status!=='pending' ? '<span style="font-size:11px;color:var(--text-muted)">'+r.reviewedBy+'</span>' : '') +
    '</div></div>'
  ).join('');
}
// Extend switchHRTab to handle leavereqs tab
const _origSwitchHRTab = switchHRTab;
function switchHRTab(tab) {
  _hrActiveTab = tab;
  ['targets','attendance','payroll','leavereqs'].forEach(t => {
    const btn  = document.getElementById('hrTab_'+t);
    const pane = document.getElementById('hrPane_'+t);
    if (btn)  { btn.style.background = t===tab?'white':''; btn.style.fontWeight = t===tab?'700':'400'; btn.style.boxShadow = t===tab?'0 1px 4px rgba(0,0,0,.1)':''; }
    if (pane) pane.classList.toggle('hidden', t!==tab);
  });
  if (tab==='attendance') renderAttendancePane();
  if (tab==='payroll')    renderPayrollPane();
  if (tab==='leavereqs')  renderLeaveRequestsPane();
}


// ═══════════════════════════════════════════════════════════════════════
// PRINTING — طابعات (ESC/POS USB + Barcode + A4)
// ═══════════════════════════════════════════════════════════════════════
let _serialPort   = null;
let _serialWriter = null;

function openPrinterSettings() {
  document.getElementById('printerSettingsModal').classList.remove('hidden');
  updatePrinterStatusUI();
}
function updatePrinterStatusUI() {
  const el = document.getElementById('printerStatusTxt');
  if (el) el.innerHTML = _serialPort
    ? '<span style="color:#28a745;font-weight:700">🟢 الطابعة متصلة</span>'
    : '<span style="color:#dc3545">🔴 غير متصلة</span>';
}
async function connectReceiptPrinter() {
  if (!('serial' in navigator)) {
    alert('متصفحك لا يدعم Web Serial API\nاستخدم Chrome أو Edge على سطح المكتب فقط');
    return;
  }
  try {
    _serialPort = await navigator.serial.requestPort();
    const baud  = parseInt(document.getElementById('printerBaud')?.value || '9600');
    await _serialPort.open({ baudRate: baud });
    _serialWriter = _serialPort.writable.getWriter();
    updatePrinterStatusUI();
    showToast('✅ تم الاتصال بالطابعة');
  } catch(e) {
    _serialPort = null; _serialWriter = null;
    showToast('❌ فشل الاتصال: ' + e.message);
  }
}
async function disconnectPrinter() {
  try {
    if (_serialWriter) { await _serialWriter.releaseLock(); _serialWriter = null; }
    if (_serialPort)  { await _serialPort.close(); _serialPort = null; }
    updatePrinterStatusUI();
    showToast('✅ تم قطع الاتصال');
  } catch(e) { showToast('❌ خطأ: ' + e.message); }
}
async function sendToSerial(data) {
  if (!_serialWriter) return false;
  try { await _serialWriter.write(data); return true; }
  catch(e) { showToast('❌ خطأ في الطباعة: ' + e.message); return false; }
}
function buildReceiptESCPOS(sale) {
  const ESC = 0x1B, GS = 0x1D;
  const enc = new TextEncoder();
  const bytes = [];
  const push = arr => arr.forEach(b => bytes.push(b));
  const text  = str => enc.encode(str).forEach(b => bytes.push(b));
  const line  = str => text(str + '\n');
  // Init + center
  push([ESC,0x40]); push([ESC,0x61,0x01]);
  push([ESC,0x21,0x10]); // double height
  const s = _settingsCache || {};
  line(s.shopName || 'Voodo ERP');
  push([ESC,0x21,0x00]); // normal
  if (s.shopAddress) line(s.shopAddress);
  if (s.shopPhone)   line('Tel: ' + s.shopPhone);
  line('--------------------------------');
  push([ESC,0x61,0x00]); // left
  line('Date: ' + (sale.date || new Date().toISOString().slice(0,10)));
  line('Inv : #' + String(sale.id||'').slice(-6));
  if (sale.salesperson) line('By  : ' + sale.salesperson);
  line('--------------------------------');
  (sale.items||[]).forEach(item => {
    const nm = String(item.name||'').slice(0,20);
    text(nm + '\n');
    const det = (item.qty||1)+' x '+(item.price||0).toFixed(2)+' = '+((item.qty||1)*(item.price||0)).toFixed(2);
    text(det + '\n');
  });
  line('--------------------------------');
  push([ESC,0x61,0x02]); // right
  push([ESC,0x21,0x10]); // double height
  line('TOTAL: ' + (sale.total||0).toFixed(2) + ' EGP');
  push([ESC,0x21,0x00]);
  if (sale.paid > sale.total) {
    line('PAID : ' + (sale.paid).toFixed(2));
    line('CHANGE: ' + ((sale.paid||0)-(sale.total||0)).toFixed(2));
  }
  push([ESC,0x61,0x01]);
  line('\n  Thank you / شكرًا  \n');
  text('\n\n\n');
  push([GS,0x56,0x00]); // cut
  return new Uint8Array(bytes);
}
async function printReceiptESCPOS(sale) {
  if (!_serialWriter) { printSaleReceipt(sale); return; }
  const bytes = buildReceiptESCPOS(sale);
  const ok = await sendToSerial(bytes);
  if (ok) showToast('✅ تم الإرسال للطابعة');
}
async function testReceiptPrint() {
  if (!_serialWriter) { alert('الطابعة غير متصلة — اضغط اتصال أولاً'); return; }
  await printReceiptESCPOS({
    id:'TEST001', date: new Date().toISOString().slice(0,10),
    salesperson:'اختبار', items:[{name:'منتج تجريبي',qty:2,price:50}],
    total:100, paid:100
  });
}

// ═══════════════════════════════════════════════════════════════════════
// FINGERPRINT IMPORT — استيراد بيانات جهاز البصمة
// ═══════════════════════════════════════════════════════════════════════
function openFingerprintModal() {
  document.getElementById('fingerprintModal').classList.remove('hidden');
  document.getElementById('fingerprintImportLog').innerHTML = '';
  document.getElementById('fingerprintFile').value = '';
}
function handleFingerprintFile(input) {
  const file = input.files[0]; if (!file) return;
  const logEl = document.getElementById('fingerprintImportLog');
  logEl.innerHTML = '<div style="color:var(--text-muted)">⏳ جاري قراءة الملف...</div>';
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const rows = text.trim().split('\n').map(r => r.split(/[,\t;]/));
    let imported = 0, skipped = 0;
    const logs = [];
    rows.forEach((cols, idx) => {
      if (idx === 0 && isNaN(parseInt(cols[0])) && cols[0].trim().length > 1) return; // skip header
      if (cols.length < 2) { skipped++; return; }
      let empName = cols[0]?.trim().replace(/"/g,'');
      let rawDate = cols[1]?.trim().replace(/"/g,'');
      let checkIn  = (cols[2]||'').trim().replace(/"/g,'');
      let checkOut = (cols[3]||'').trim().replace(/"/g,'');
      // Normalize date
      let date = '';
      const m1 = rawDate.match(/^(\d{4})[\-\/](\d{2})[\-\/](\d{2})/);
      const m2 = rawDate.match(/^(\d{2})[\-\/](\d{2})[\-\/](\d{4})/);
      if (m1) date = m1[1]+'-'+m1[2]+'-'+m1[3];
      else if (m2) date = m2[3]+'-'+m2[2]+'-'+m2[1];
      else { skipped++; return; }
      if (!empName) { skipped++; return; }
      const status = checkIn ? 'present' : 'absent';
      saveAttendanceRecord(empName, date, status, checkIn, checkOut, 'استيراد البصمة');
      imported++; logs.push('✅ '+empName+' — '+date+(checkIn?' ('+checkIn+'-'+checkOut+')':''));
    });
    logEl.innerHTML =
      '<div style="color:#28a745;font-weight:700;margin-bottom:8px">تم الاستيراد: '+imported+' سجل</div>'+
      (skipped?'<div style="color:#ffc107;margin-bottom:8px">تخطي: '+skipped+' سطر</div>':'')+
      '<div style="max-height:180px;overflow-y:auto;font-size:12px;color:var(--text-muted)">'+
        logs.slice(0,50).join('<br>')+(logs.length>50?'<br>... و '+(logs.length-50)+' آخر':'')+
      '</div>';
    if (imported > 0) {
      showToast('✅ تم استيراد '+imported+' سجل حضور');
      if (!document.getElementById('page-hr').classList.contains('hidden')) renderHRPage();
    }
  };
  reader.readAsText(file, 'UTF-8');
}
function downloadFingerprintTemplate() {
  const csv = 'الاسم,التاريخ,وقت الحضور,وقت الانصراف\nأحمد محمد,2026-07-04,09:00,17:00\nمحمد علي,2026-07-05,09:15,17:30\n';
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='نموذج_بيانات_البصمة.csv'; a.click();
}

// ─── Badge updates on showPage ────────────────────────────────────────
const _origShowPageBadge = showPage;
function showPage(page) {
  _origShowPageBadge(page);
  setTimeout(()=>{ updateExpReqBadge(); updateLeaveReqBadge(); }, 50);
}
