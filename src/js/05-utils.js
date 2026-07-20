// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════
const fmt = (n) => (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Calls fn() only if the given page element exists and is currently visible.
// Used by both the Firestore listeners in 65-firebase.js (so live data
// updates only re-render the page actually on screen) and switchBranch() in
// 70-branches.js. Was previously a local const inside initFirebase() — a
// pure, closure-free helper that any other top-level function calling it
// (like switchBranch()) could never actually reach, so switchBranch() threw
// a ReferenceError every time an admin used the branch switcher and it never
// refreshed the currently-visible page. Hoisted here so it's one real global.
const visRefresh = (pageId, fn) => {
  const el = document.getElementById(pageId);
  if (el && !el.classList.contains('hidden')) fn();
};

// Locks a branch-filter <select> to the current user's OWN branch for
// non-admins (disables it and forces its value), returning the branch id
// (or 'all') the caller should filter by. MUST be called synchronously
// inside the render function itself, right after the <select>'s options
// are populated and before its value is read — locking it afterward (e.g.
// from a setTimeout in the showPage wrapper, as applyBranchReportsFilter()
// used to) only fixes the dropdown's visual state; the report/list had
// already rendered once with whatever branch was PREVIOUSLY selected on
// that page instance. That let a branch cashier briefly see another
// branch's sales (or none at all, if a different branch was last picked)
// on first render of "سجل المبيعات" and the reports "المبيعات" tab.
function lockBranchFilter(selectId) {
  const el = document.getElementById(selectId);
  if (!el) return 'all';
  if (currentUser === 'admin') {
    // Explicitly re-enable — the SPA never reloads the DOM between
    // sessions, so a filter left disabled by a PREVIOUS branch-cashier
    // session on the same device (e.g. an admin testing a cashier login)
    // would otherwise stay stuck disabled after switching back to admin.
    el.disabled = false;
  } else {
    el.disabled = true;
    el.value = currentBranch;
  }
  return el.value || 'all';
}

// Escape free-text values before interpolating into innerHTML — any field a
// user can type (names, notes, reasons...) must go through this, since
// Firestore currently accepts writes from any anonymous client (see
// CLAUDE.md security notes) and this app has no other XSS defense.
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Escape a value for use as a single-quoted JS string literal *inside* an
// inline onclick="fn('${...}')" HTML attribute (e.g. product code/name).
// escHtml() alone is NOT enough here: the browser decodes HTML entities in
// the attribute text before parsing it as JS, so an unescaped quote would
// still break out of the string. JS-escape first, then HTML-escape the
// result so it also survives the surrounding double-quoted attribute.
const escJsAttr = (s) => escHtml(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

// Count-up animation for KPI numbers (dashboard prototype). Reads the
// previous value off the element itself (data-raw-value) so repeated calls
// on filter/period changes animate from the last shown number, not from 0.
// Respects prefers-reduced-motion by jumping straight to the final value.
const _prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateNumber(el, to, opts = {}) {
  if (!el) return;
  const { duration = 700, format = (n) => Math.round(n).toLocaleString('en-US'), suffix = '' } = opts;
  to = parseFloat(to) || 0;
  const from = parseFloat(el.dataset.rawValue) || 0;
  el.dataset.rawValue = to;
  if (_prefersReducedMotion() || from === to) {
    el.textContent = format(to) + suffix;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = format(from + (to - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = format(to) + suffix;
  };
  requestAnimationFrame(step);
}

function showMsg(id, msg, type='success') {
  const el = document.getElementById(id);
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  setTimeout(() => el.innerHTML = '', 3500);
}

// Floating toast for actions with no dedicated inline message slot (unlike
// showMsg(), which targets a specific element id). Was called from ~30 spots
// across the app (barcode printer, Google Drive backup, expense/leave
// approvals, Excel export, fingerprint import) but never defined, so every
// one of those silently crashed right at that line — this was purely a gap.
function showToast(msg) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'background:#1f2937;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;max-width:90vw;text-align:center;white-space:pre-line;';
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

// Generic in-app replacements for window.prompt()/window.confirm() — both
// are silent no-ops in a PWA running standalone/installed on several mobile
// browsers (see the branch-add fix in 70-branches.js for the first place
// this broke a real feature). Callback-based since a modal is inherently
// async, unlike the browser-native blocking dialogs they replace.
let _gpCallback = null;
function showPromptModal(title, defaultValue, callback) {
  document.getElementById('gpTitle').textContent = title;
  document.getElementById('gpInput').value = defaultValue || '';
  _gpCallback = callback;
  document.getElementById('genericPromptModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('gpInput').focus(), 50);
}
function closeGenericPrompt() {
  document.getElementById('genericPromptModal').classList.add('hidden');
  _gpCallback = null;
}
function confirmGenericPrompt() {
  const val = document.getElementById('gpInput').value;
  const cb = _gpCallback;
  closeGenericPrompt();
  if (cb) cb(val);
}

let _gcCallback = null;
function showConfirmModal(message, callback) {
  document.getElementById('gcMessage').textContent = message;
  _gcCallback = callback;
  document.getElementById('genericConfirmModal').classList.remove('hidden');
}
function closeGenericConfirm() {
  document.getElementById('genericConfirmModal').classList.add('hidden');
  _gcCallback = null;
}
function confirmGenericConfirm() {
  const cb = _gcCallback;
  closeGenericConfirm();
  if (cb) cb();
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
// Shared post-auth setup for any admin-type login (hardcoded 'admin' or a
// new admin-type account created via "إدارة المستخدمين").
function _enterAdminSession(auditLabel) {
  currentUser = 'admin';
  isBranchManager = false;
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('managerView').classList.remove('hidden');
  document.getElementById('todayDate').textContent =
    new Date().toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  document.getElementById('sLowThreshold').value = getThreshold();
  initFirebase();   // ← يشغّل Firebase عند دخول الأدمن
  initBranchUI();
  document.getElementById('topbarLogout').style.display = 'inline-flex';
  showPage('home');
  setTimeout(() => addAuditLog('auth.login', auditLabel, currentBranch), 500);
}

// Shared post-auth setup for any branch login (legacy per-branch slot or a
// new branch-type account), covering both warehouse-only and normal branches.
function _enterBranchSession(branchId, role, username) {
  currentUser = 'cashier';
  isBranchManager = role === 'manager';
  currentBranch = branchId;
  DB.s('currentBranch', branchId);
  document.getElementById('loginPage').classList.add('hidden');
  if (branchId === 'wh') {
    // Warehouse-only mode: restricted to warehouse & transfers pages
    window._whMode = true;
    document.body.classList.add('warehouse-mode');
    document.getElementById('managerView').classList.remove('hidden');
    document.getElementById('topbarLogout').style.display = 'inline-flex';
    initFirebase();
    showPage('warehouse');
    setTimeout(() => addAuditLog('auth.login', `تسجيل دخول مخزن: ${username}`, branchId), 500);
  } else {
    document.getElementById('managerView').classList.remove('hidden');
    initFirebase();
    initBranchUI();
    showPage('home');
    renderHomeIcons();
    setTimeout(() => addAuditLog('auth.login', `تسجيل دخول كاشير: ${username} — ${getBranchName(branchId)}`, branchId), 500);
  }
}

function _showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (msg) el.textContent = msg;
  el.classList.remove('hidden');
}

async function doLogin() {
  const user = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  document.getElementById('loginError').classList.add('hidden');
  if (!pass) { _showLoginError('أدخل كلمة المرور'); return; }

  // ── Real authentication first: Firebase email/password ──────────
  // Usernames map to a synthetic email (see usernameToEmail). The role
  // comes from roles/{uid} (or the hardcoded owner email) and is what
  // firestore.rules actually enforces server-side.
  const online = navigator.onLine !== false;
  let fbErr = null;
  if (online && typeof firebase !== 'undefined' && FIREBASE_CONFIG.projectId) {
    try {
      const cred = await firebase.auth().signInWithEmailAndPassword(usernameToEmail(user), pass);
      await resolveRoleAndEnter(cred.user);
      return;
    } catch (e) {
      fbErr = e;
      console.error('Firebase sign-in error:', e && e.code, e && e.message);
      if (e && e.message === 'no-role') {
        _showLoginError('الحساب موجود لكن ملوش صلاحية بعد — كلّم المدير يضيفك من "إدارة المستخدمين"');
        return;
      }
      if (e && e.code === 'auth/too-many-requests') {
        _showLoginError('محاولات كتير غلط — استنى شوية وحاول تاني');
        return;
      }
      // Expected/normal for typos or for devices that haven't been migrated
      // to a real account yet → fall through to the legacy path below.
      // Anything else (network/config/internal errors) is NOT a "wrong
      // password" — surfaced with its real code below instead of hiding it
      // behind the generic message, so it doesn't get misread as a typo.
    }
  }

  // ── Legacy/offline fallback (local credentials on THIS device) ──
  if (await _legacyLogin(user, pass)) return;

  const expectedCodes = ['auth/wrong-password', 'auth/invalid-credential', 'auth/user-not-found', 'auth/invalid-email'];
  if (fbErr && fbErr.code && !expectedCodes.includes(fbErr.code)) {
    _showLoginError(`تعذّر الاتصال بحساب الدخول (${fbErr.code}) — جرّب تاني أو راجع إعدادات Firebase`);
  } else {
    _showLoginError('بيانات الدخول غير صحيحة');
  }
}

// The old localStorage-credential chain, kept for offline use and for
// the transition period before every device moves to real accounts.
// Sessions entered this way have no Firebase auth token, so once the
// v2 firestore.rules are published they can only see local data.
async function _legacyLogin(user, pass) {
  const users = getUsers();

  if (user === 'admin' && users.admin && await checkPass(pass, users.admin)) {
    await upgradePassIfNeeded(pass, users.admin, 'admin');
    currentUsername = user;
    isRealOwner = true; // the single hardcoded local admin fallback predates multi-admin accounts and has no cloud access either way
    _enterAdminSession('تسجيل دخول (محلي): admin');
    return true;
  }

  if (user === 'cashier' && users.cashier && pass === users.cashier) {
    currentUser = 'cashier';
    currentUsername = user;
    isBranchManager = false;
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('cashierView').classList.remove('hidden');
    initFirebase();
    applyMobileUI();
    renderProducts();
    updateClock();
    setInterval(updateClock, 30000);
    setTimeout(function(){ checkForApprovedCarts(); }, 1000);
    setTimeout(function(){ try { updateSessionUI(); } catch(e){} }, 1200);
    return true;
  }

  for (const acc of getAccounts()) {
    if ((acc.username || '').toLowerCase() === user && await checkPass(pass, acc.password)) {
      currentUsername = user;
      if (acc.type === 'admin') _enterAdminSession(`تسجيل دخول (محلي): ${user}`);
      else _enterBranchSession(acc.branchId, acc.role, user);
      return true;
    }
  }

  const branchUsers = getBranchUsers();
  for (const b of BRANCH_IDS) {
    if (branchUsers[b] &&
        user === (branchUsers[b].username || '').toLowerCase() &&
        await checkPass(pass, branchUsers[b].password)) {
      currentUsername = user;
      _enterBranchSession(b, branchUsers[b].role, user);
      return true;
    }
  }
  return false;
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


// ── BACKUP SNAPSHOT (shared by local export + Google Drive) ─────────
// One place that knows what a complete backup contains, reading from the
// live in-memory caches (the source of truth once Firestore listeners run).
function _buildFullBackup() {
  const invByBranch = {};
  BRANCH_IDS.forEach(b => { invByBranch[b] = getInv(b); });
  return {
    version:     3,
    exportedAt:  new Date().toISOString(),
    invByBranch,
    sales:       getSales(),
    customers:   getCustomers(),
    suppliers:   _suppliersCache,
    purchases:   _purchaseCache,
    transfers:   getTransfers(),
    expenses:    getExpenses(),
    hr:          _hrCache,
    settings:    _settingsCache,
    suspended:   getSuspended(),
  };
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
  // Built from the LIVE caches, not localStorage keys. The old version read
  // keys that were never written under those names ('pos_sales', 'pos_sellers',
  // 'pos_branch_names'...) so the uploaded backup was mostly empty arrays —
  // it looked like a backup but restored nothing.
  const backup = _buildFullBackup();
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
  showConfirmModal('هل تريد تسجيل الخروج؟', function() {
    currentUser = null; currentUsername = null; isBranchManager = false; cart = [];
    // End the real Firebase session too, and drop the cached role so the
    // auth bootstrap doesn't auto-resume on the next page load.
    localStorage.removeItem('pos_role_cache');
    try { if (typeof firebase !== 'undefined' && firebase.apps.length) firebase.auth().signOut(); } catch(e) {}
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('cashierView').classList.add('hidden');
    document.getElementById('managerView').classList.add('hidden');
    window._whMode = false;
    document.body.classList.remove('warehouse-mode');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
  });
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
// ── PRE-INIT: hide loading overlay ──
// Passwords are no longer fetched from Firestore before login (they used to be
// readable by any anonymous client via pos_data/auth — see CLAUDE.md). Each
// device manages its own local admin/cashier credentials, so there is nothing
// to wait on here.
function preInitFirebase() {
  const overlay = document.getElementById('appLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
}
preInitFirebase();

document.addEventListener('DOMContentLoaded', applyMobileUI);

// ── CLOCK ────────────────────────────────────
function updateClock() {
  document.getElementById('cartClock').textContent = new Date().toLocaleString('ar-EG');
}

