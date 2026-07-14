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
      imported++; logs.push('✅ '+escHtml(empName)+' — '+date+(checkIn?' ('+escHtml(checkIn)+'-'+escHtml(checkOut)+')':''));
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



/* ═══════════════════════════════════════════════
   HOME PAGE — ROLE-BASED ICON GRID
   ═══════════════════════════════════════════════ */

let _clockIntervalStarted = false;

function switchToCashier() {
  document.getElementById('managerView').classList.add('hidden');
  document.getElementById('cashierView').classList.remove('hidden');
  applyMobileUI();
  renderProducts();
  updateClock();
  if (!_clockIntervalStarted) {
    _clockIntervalStarted = true;
    setInterval(updateClock, 30000);
  }
}

function switchToHome() {
  document.getElementById('cashierView').classList.add('hidden');
  document.getElementById('managerView').classList.remove('hidden');
  showPage('home');
  renderHomeIcons();
}

function renderHomeIcons() {
  const isAdmin = (currentUser === 'admin');
  const adminGrid = document.getElementById('homeGrid');
  const branchGrid = document.getElementById('homeGrid_branch');
  if (adminGrid) adminGrid.style.display = isAdmin ? '' : 'none';
  if (branchGrid) branchGrid.style.display = isAdmin ? 'none' : '';
  const branchDash = document.getElementById('homeAppBranchDashboard');
  if (branchDash) branchDash.style.display = (!isAdmin && isBranchManager) ? '' : 'none';
  // Update pending badges on admin home icons
  if (isAdmin) {
    try {
      const expPending = getExpenseRequests().filter(r => r.status === 'pending').length;
      const leavePending = getLeaveRequests().filter(r => r.status === 'pending').length;
      const eb = document.getElementById('homeExpReqBadge');
      const lb = document.getElementById('homeLeaveReqBadge');
      if (eb) { eb.textContent = expPending; eb.style.display = expPending ? 'inline' : 'none'; }
      if (lb) { lb.textContent = leavePending; lb.style.display = leavePending ? 'inline' : 'none'; }
    } catch(e) {}
  }
  renderFolderPreviews();
}

/* ═══════════════════════════════════════════════
   HOME PAGE — FOLDERS
   Groups related pages behind one home-screen tile (like a phone's app
   folders) instead of a flat, ever-growing icon list. New features go
   into an existing folder's `icons` array — the home screen itself never
   needs a new top-level tile for them.
   ═══════════════════════════════════════════════ */
const HOME_FOLDERS = {
  inventory: { name: '📦 المخزون', icons: [
    { page:'inventory',  label:'المخزون',        grad:'#22c55e,#16a34a', svg:'<rect x="8" y="18" width="32" height="22" rx="3" stroke="white" stroke-width="3"/><path d="M17 18V13a7 7 0 0114 0v5" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M18 29h12M24 24v10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
    { page:'warehouse',  label:'المخزن الرئيسي',  grad:'#64748b,#475569', svg:'<path d="M6 21L24 9l18 12v20H6V21z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><rect x="18" y="28" width="12" height="13" rx="2" fill="white"/><rect x="14" y="20" width="7" height="7" rx="1" fill="white" opacity=".7"/><rect x="27" y="20" width="7" height="7" rx="1" fill="white" opacity=".7"/>' },
    { page:'transfers',  label:'التحويلات',       grad:'#34d399,#059669', svg:'<path d="M10 18h28M30 10l8 8-8 8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 30H10M18 22l-8 8 8 8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  ]},
  customers: { name: '👥 العملاء والعروض', icons: [
    { page:'customers', label:'العملاء', grad:'#a855f7,#7c3aed', svg:'<circle cx="24" cy="16" r="8" stroke="white" stroke-width="2.5"/><path d="M8 40c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
    { page:'promos',    label:'العروض',  grad:'#fb7185,#dc2626', svg:'<path d="M20 8H10a2 2 0 00-2 2v10l20 20 12-12L20 8z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><circle cx="15" cy="15" r="2.5" fill="white"/>' },
  ]},
  purchases: { name: '🛒 المشتريات', icons: [
    { page:'purchases', label:'المشتريات', grad:'#fcd34d,#a16207', svg:'<path d="M14 8h20l4 8H10l4-8z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><rect x="10" y="16" width="28" height="24" rx="3" stroke="white" stroke-width="2.5"/><path d="M20 28h8M24 24v8" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  ]},
  accounting: { name: '💰 المحاسبة والمصاريف', icons: [
    { page:'accounting', label:'المحاسبة', grad:'#34d399,#047857', svg:'<rect x="10" y="6" width="28" height="36" rx="3" stroke="white" stroke-width="2.5"/><path d="M16 16h16M16 22h16M16 28h10" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M28 32l3 3 5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
    { page:'expenses',   label:'المصاريف', grad:'#f87171,#b91c1c', svg:'<circle cx="24" cy="24" r="16" stroke="white" stroke-width="2.5"/><path d="M24 13v22M18 19c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 4-6 4-6 1.686-6 4 2.686 6 6 6 6-2.686 6-6" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  ]},
  reports: { name: '📊 التقارير والتحليلات', icons: [
    { page:'reports',    label:'التقارير',       grad:'#38bdf8,#0369a1', svg:'<path d="M8 36L18 24l8 6 8-12 6 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="6" y="6" width="36" height="36" rx="4" stroke="white" stroke-width="2.5"/>' },
    { page:'customized', label:'تقارير مخصصة',   grad:'#f472b6,#be185d', svg:'<circle cx="21" cy="21" r="12" stroke="white" stroke-width="2.5"/><path d="M30 30l10 10" stroke="white" stroke-width="3.5" stroke-linecap="round"/><path d="M17 21h8M21 17v8" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  ]},
  system: { name: '⚙️ النظام والإدارة', icons: [
    { page:'audit',    label:'سجل التغييرات', grad:'#94a3b8,#334155', svg:'<rect x="10" y="6" width="28" height="36" rx="3" stroke="white" stroke-width="2.5"/><path d="M16 16h16M16 22h16M16 28h8" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M30 32l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' },
    { page:'settings', label:'الإعدادات',     grad:'#a1a1aa,#3f3f46', svg:'<circle cx="24" cy="24" r="5" stroke="white" stroke-width="2.5"/><path d="M24 8v4M24 36v4M8 24h4M36 24h4M13.4 13.4l2.8 2.8M31.8 31.8l2.8 2.8M13.4 34.6l2.8-2.8M31.8 16.2l2.8-2.8" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' },
  ]},
};

// Stacked-card preview inside each folder tile — the first item's icon
// shown full-size and clear, with up to 2 plain color slivers peeking out
// behind it (from the 2nd/3rd items, if any) signaling "more inside".
function renderFolderPreviews() {
  Object.keys(HOME_FOLDERS).forEach(function(id) {
    const el = document.getElementById('folderPreview_' + id);
    if (!el) return;
    const icons = HOME_FOLDERS[id].icons;
    let html = '';
    if (icons[2]) html += '<div class="folder-peek p3" style="background:linear-gradient(145deg,' + icons[2].grad + ');"></div>';
    if (icons[1]) html += '<div class="folder-peek p2" style="background:linear-gradient(145deg,' + icons[1].grad + ');"></div>';
    html += '<div class="folder-peek front" style="background:linear-gradient(145deg,' + icons[0].grad + ');">'
      + '<svg viewBox="0 0 48 48" fill="none">' + icons[0].svg + '</svg></div>';
    el.innerHTML = html;
  });
}

function openHomeFolder(id) {
  const folder = HOME_FOLDERS[id]; if (!folder) return;
  document.getElementById('homeFolderTitle').textContent = folder.name;
  document.getElementById('homeFolderGrid').innerHTML = folder.icons.map(function(i) {
    return '<div class="app-icon" onclick="closeHomeFolder();showPage(\'' + i.page + '\')">'
      + '<div class="app-tile" style="width:58px;height:58px;background:linear-gradient(145deg,' + i.grad + ');">'
      + '<svg viewBox="0 0 48 48" fill="none" style="width:30px;height:30px;">' + i.svg + '</svg></div>'
      + '<span class="app-name" style="color:var(--text);text-shadow:none;">' + escHtml(i.label) + '</span></div>';
  }).join('');
  document.getElementById('homeFolderModal').classList.remove('hidden');
}

function closeHomeFolder() {
  document.getElementById('homeFolderModal').classList.add('hidden');
}


// Override showPage to render home icons when navigating to home



/* ═══════════════════════════════════════════════════
   BRANCH USER ROLE RESTRICTIONS
   ═══════════════════════════════════════════════════ */

// Patch openExpenseRequestModal: auto-lock branch for non-admin users
(function() {
  var _origExpModal = openExpenseRequestModal;
  window.openExpenseRequestModal = function() {
    _origExpModal();
    if (currentUser !== 'admin') {
      var brSel = document.getElementById('expReqBranchId');
      if (brSel) {
        brSel.value = currentBranch;
        var row = brSel.closest('div');
        if (row) row.style.display = 'none';
      }
    }
  };
})();

// Patch openLeaveRequestModal: show only employees of current branch
(function() {
  var _origLeaveModal = openLeaveRequestModal;
  window.openLeaveRequestModal = function() {
    _origLeaveModal();
    if (currentUser !== 'admin') {
      var empSel = document.getElementById('leaveReqEmpName');
      if (empSel) {
        var filtered = getSalespeople()
          .filter(function(e) {
            if (typeof e === 'string') return true;
            return !e.branch || e.branch === currentBranch;
          })
          .map(function(e) { return typeof e === 'string' ? e : e.name; })
          .filter(Boolean);
        empSel.innerHTML = filtered.map(function(n) {
          return '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>';
        }).join('');
      }
    }
  };
})();

// Reports page: restrict sections visible to branch users
function applyBranchReportsFilter() {
  var isAdmin = (currentUser === 'admin');
  ['rpt-inventory', 'rpt-profit', 'rpt-kpi', 'rpt-returns'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
  var bf = document.getElementById('rptBranchFilter');
  if (bf) {
    bf.disabled = !isAdmin;
    if (!isAdmin) bf.value = currentBranch;
  }
}

// Unified showPage wrapper: badges + home icons + branch reports filter
(function() {
  var _orig = showPage;
  window.showPage = function(page) {
    _orig(page);
    setTimeout(function() {
      try { updateExpReqBadge(); } catch(e) {}
      try { updateLeaveReqBadge(); } catch(e) {}
      if (page === 'home')    { try { renderHomeIcons(); } catch(e) {} }
      if (page === 'reports') { try { applyBranchReportsFilter(); } catch(e) {} }
    }, 50);
  };
})();

