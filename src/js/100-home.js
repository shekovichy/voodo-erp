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
  try { updateSessionUI(); } catch(e) {}
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
  if (!isAdmin) renderBranchDynamicIcons();
  else renderAdminHomeGrid();
  ['homeAppUserPerms', 'homeAppSettings', 'homeAppMigration'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isRealOwner ? '' : 'none';
  });
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
}

// Non-admin home screen: the fixed action icons (POS, expense/leave
// requests) stay hardcoded in template.html — everything else (any TAB
// this account has been granted view on, aggregated across its children
// if it has any — see canViewTab() in 00-core.js) renders here, one icon
// per tab from DEPARTMENTS (not per department — a branch account's home
// screen is usually short enough that folders would just add clicks), so
// a branch account's home screen reflects exactly what the owner granted
// it instead of a fixed manager/cashier split.
function renderBranchDynamicIcons() {
  const container = document.getElementById('homeGrid_branch_dynamic');
  if (!container) return;
  const tabs = DEPARTMENTS.flatMap(d => d.tabs).filter(t => canViewTab(t.key) && TAB_ICON[t.key]);
  container.innerHTML = tabs.map(t => {
    const icon = TAB_ICON[t.key];
    return `<div class="app-icon branch-card" onclick="showPage('${t.key}')" style="background:linear-gradient(145deg,${icon.grad.split(',').map(c=>c+'2e').join(',')});border:1px solid ${icon.grad.split(',')[0]}4d;border-radius:20px;padding:20px 12px 16px;gap:10px;">
      <div class="app-tile" style="background:linear-gradient(135deg,${icon.grad});width:64px;height:64px;">
        <svg viewBox="0 0 48 48" fill="none">${icon.svg}</svg>
      </div>
      <span class="app-name" style="font-weight:700;font-size:14px;">${escHtml(t.label)}</span>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   HOME PAGE — DEPARTMENT FOLDERS
   Generated from DEPARTMENTS (00-core.js) — the SAME tree the permissions
   matrix uses, so navigation and permissions can never drift apart into
   two different pictures of "how the app is organized" (2026-07-20, the
   owner's own words: "التابات جوه التابات" needed to match the
   department grouping, not be a separate hand-maintained list). A
   department with only one tab shows as a standalone tile (no point
   wrapping a single icon in a folder); 2+ tabs become a folder tile
   (tap → popup grid), same interaction as before.
   ═══════════════════════════════════════════════ */
function _deptIcons(dept) {
  return dept.tabs.map(t => Object.assign({ page: t.key, label: t.label }, TAB_ICON[t.key])).filter(i => i.svg);
}

// Rebuilds the whole admin home grid's department section from scratch —
// cheap enough to just do on every renderHomeIcons() call rather than try
// to diff it, and guarantees it never goes stale.
function renderAdminHomeGrid() {
  const container = document.getElementById('homeGridDept');
  if (!container) return;
  container.innerHTML = DEPARTMENTS.map(dept => {
    const icons = _deptIcons(dept);
    if (!icons.length) return '';
    if (icons.length === 1) {
      const i = icons[0];
      return `<div class="app-icon" onclick="showPage('${i.page}')">
        <div class="app-tile" style="background:linear-gradient(145deg,${i.grad});">
          <svg viewBox="0 0 48 48" fill="none">${i.svg}</svg>
        </div>
        <span class="app-name">${escHtml(dept.label)}</span>
      </div>`;
    }
    return `<div class="app-icon" onclick="openHomeFolder('${dept.key}')">
      <div class="app-tile folder-tile" id="folderPreview_${dept.key}"></div>
      <span class="app-name">${escHtml(dept.label)}</span>
    </div>`;
  }).join('');
  renderFolderPreviews();
}

// Stacked-card preview inside each folder tile — the first item's icon
// shown full-size and clear, with up to 2 plain color slivers peeking out
// behind it (from the 2nd/3rd items, if any) signaling "more inside".
function renderFolderPreviews() {
  DEPARTMENTS.forEach(function(dept) {
    const el = document.getElementById('folderPreview_' + dept.key);
    if (!el) return;
    const icons = _deptIcons(dept);
    if (!icons.length) { el.innerHTML = ''; return; }
    let html = '';
    if (icons[2]) html += '<div class="folder-peek p3" style="background:linear-gradient(145deg,' + icons[2].grad + ');"></div>';
    if (icons[1]) html += '<div class="folder-peek p2" style="background:linear-gradient(145deg,' + icons[1].grad + ');"></div>';
    html += '<div class="folder-peek front" style="background:linear-gradient(145deg,' + icons[0].grad + ');">'
      + '<svg viewBox="0 0 48 48" fill="none">' + icons[0].svg + '</svg></div>';
    el.innerHTML = html;
  });
}

function openHomeFolder(deptKey) {
  const dept = DEPARTMENTS.find(d => d.key === deptKey); if (!dept) return;
  document.getElementById('homeFolderTitle').textContent = dept.label;
  document.getElementById('homeFolderGrid').innerHTML = _deptIcons(dept).map(function(i) {
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

// Reports page: restrict sections visible to branch users. Branch-locking
// rptBranchFilter itself now happens synchronously inside buildSalesReport()
// via lockBranchFilter() (05-utils.js) — doing it here via setTimeout was too
// late and let a branch cashier briefly see another branch's data (or none)
// on first render; see lockBranchFilter()'s comment for the full story.
function applyBranchReportsFilter() {
  var isAdmin = (currentUser === 'admin');
  ['rpt-inventory', 'rpt-profit', 'rpt-kpi', 'rpt-returns'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
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

