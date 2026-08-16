// ══════════════════════════════════════════════
// MANAGER PAGES
// ══════════════════════════════════════════════

// showPage() is the public entry point — it makes sure a lazy chunk (see
// _CHUNK_FILES in 00-core.js) is loaded before handing off to the real
// implementation, so every existing onclick="showPage('x')" in the HTML
// keeps working unchanged whether or not that page's code has loaded yet.
function showPage(page) {
  if (_CHUNK_FILES[page] && !_loadedChunks.has(page)) {
    const t = document.getElementById('pageTitle');
    if (t) t.textContent = '⏳ جاري التحميل...';
    _loadChunk(page, () => showPage(page));
    return;
  }
  _showPageImpl(page);
}

// Pages that render their own branch filter (see the branch-select audit in
// template.html). Keep in sync if a page gains or loses one — the header
// switcher is hidden on exactly these.
const _PAGES_WITH_OWN_BRANCH_FILTER = [
  'dashboard', 'inventory', 'sales', 'reports', 'purchases', 'expenses', 'helpdesk'
];

function _showPageImpl(page) {
  if (window._whMode && !['warehouse','transfers'].includes(page)) return;
  // Real enforcement lives in firestore.rules (see tabForDoc() there) —
  // this is the UI-side mirror of it, the single choke point every
  // showPage() call passes through regardless of which icon/link got it
  // here (or none at all, e.g. a stale deep link or console call).
  if (page !== 'home' && !canViewTab(page)) {
    showToast('🚫 مالكش صلاحية الدخول للصفحة دي');
    return;
  }
  // Settings/migration/userperms are owner-only, full stop — not part of
  // the customizable permissions matrix at all, and not delegable to an
  // 'admin'-labeled account (see isRealOwner in 00-core.js). Settings holds
  // the legacy credential doc + destructive reset tools; userperms is what
  // GRANTS permissions, so letting a delegate in would let them escalate
  // their own access.
  if (['settings', 'migration', 'userperms'].includes(page) && !isRealOwner) {
    showToast('🚫 الصفحة دي للمالك فقط');
    return;
  }
  ['home','dashboard','inventory','sales','suspended','reports','customized','warehouse','settings','customers','promos','transfers','purchases','hr','expenses','audit','accounting','helpdesk','migration','analytics','userperms'].forEach(p => {
    document.getElementById('page-'+p)?.classList.add('hidden');
  });
  document.getElementById('page-'+page).classList.remove('hidden');
  // Exactly ONE branch selector per page. These pages carry their own
  // branch filter (which also offers "كل الفروع", something the header
  // switcher can't express), so the global header switcher is hidden while
  // they're open — showing both was confusing and was the root cause of an
  // Excel import landing in a different branch than the one on screen.
  // Every other page (cashier, home, settings, ...) keeps the header
  // switcher, since that's what sets the branch a sale is recorded to.
  var hdr = document.getElementById('branchSwitcherWrap');
  if (hdr) hdr.style.display = _PAGES_WITH_OWN_BRANCH_FILTER.includes(page) ? 'none' : 'flex';
  var content = document.querySelector('.main-content');
  if (content) content.classList.toggle('home-mode', page === 'home');
  if (page === 'home') { updateHomeClock(); updateSuspendedBadge(); }
  const titles ={ dashboard:'الرئيسية', inventory:'إدارة المخزون', sales:'سجل المبيعات', suspended:'فواتير معلقة', reports:'التقارير', customized:'تقارير مخصصة', home:'الرئيسية', warehouse:'المخزن الرئيسي', settings:'الإعدادات', customers:'العملاء', purchases:'المشتريات', hr:'الموارد البشرية', expenses:'المصاريف', audit:'سجل التغييرات', accounting:'المحاسبة الرسمية', helpdesk:'الدعم الفني', migration:'استيراد بيانات قديمة', analytics:'التحليلات الاستراتيجية', userperms:'المستخدمين والصلاحيات' };
  document.getElementById('pageTitle').textContent = titles[page] || '';
  if (page === 'dashboard')  buildDashboard();
  if (page === 'inventory')  renderInventory();
  if (page === 'sales')      { initSalesFilter(); renderSales(); }
  if (page === 'reports')    { buildSalesReport(); setTimeout(()=>showVLTab('catreport'),100); }
  if (page === 'suspended')  renderSuspendedPage();
  if (page === 'settings')   { renderLastBackupInfo(); initGoogleDriveUI(); document.getElementById('sVipThreshold').value = _settingsCache.vipThreshold || 1000; populateBranchNameInputs(); renderBranchWipeUI(); }
  if (page === 'userperms')  { renderUserAccountsSettings(); renderLegacyLoginCleanup(); }
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
  if (page === 'helpdesk')   renderHelpdeskPage();
  if (page === 'migration')  switchMigTab('sales');
  if (page === 'analytics')  renderAnalyticsPage();
}

