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

