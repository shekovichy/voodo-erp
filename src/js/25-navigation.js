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

function _showPageImpl(page) {
  if (window._whMode && !['warehouse','transfers'].includes(page)) return;
  ['home','dashboard','inventory','sales','suspended','reports','customized','warehouse','settings','customers','promos','transfers','purchases','hr','expenses','audit','accounting','manufacturing'].forEach(p => {
    document.getElementById('page-'+p)?.classList.add('hidden');
  });
  document.getElementById('page-'+page).classList.remove('hidden');
  var content = document.querySelector('.main-content');
  if (content) content.classList.toggle('home-mode', page === 'home');
  if (page === 'home') { updateHomeClock(); updateSuspendedBadge(); }
  const titles ={ dashboard:'الرئيسية', inventory:'إدارة المخزون', sales:'سجل المبيعات', suspended:'فواتير معلقة', reports:'التقارير', customized:'تقارير مخصصة', home:'الرئيسية', warehouse:'المخزن الرئيسي', settings:'الإعدادات', customers:'العملاء', purchases:'المشتريات', hr:'الموارد البشرية', expenses:'المصاريف', audit:'سجل التغييرات', accounting:'المحاسبة الرسمية' };
  document.getElementById('pageTitle').textContent = titles[page] || '';
  if (page === 'dashboard')  buildDashboard();
  if (page === 'inventory')  renderInventory();
  if (page === 'sales')      { initSalesFilter(); renderSales(); }
  if (page === 'reports')    { buildSalesReport(); setTimeout(()=>showVLTab('catreport'),100); }
  if (page === 'suspended')  renderSuspendedPage();
  if (page === 'settings')   { renderSellersSettings(); renderLastBackupInfo(); initGoogleDriveUI(); document.getElementById('sVipThreshold').value = _settingsCache.vipThreshold || 1000; populateBranchNameInputs(); renderUserAccountsSettings(); }
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

