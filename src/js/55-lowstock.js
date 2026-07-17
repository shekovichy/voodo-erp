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
        <div style="font-size:13px;font-weight:600;">${escHtml(p.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">كود: ${escHtml(p.code)}</div>
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
  if (!items.length) { showToast('لا توجد منتجات تحتاج تجديد'); return; }
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
  // Full snapshot (all branches + customers/suppliers/purchases/...) — the
  // old version exported only the CURRENT branch's inventory, so a restore
  // silently dropped every other branch. See _buildFullBackup() in 05-utils.js.
  const backup = _buildFullBackup();
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
  showConfirmModal('استعادة النسخة الاحتياطية ستستبدل البيانات الحالية. هل تريد المتابعة؟', function() {
  _importBackupConfirmed(file);
  });
}
function _importBackupConfirmed(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.version || (!data.inv && !data.invByBranch)) { throw new Error('ملف غير صالح'); }
      let invCount = 0;
      if (data.invByBranch) {
        // v3 format — per-branch inventory
        Object.keys(data.invByBranch).forEach(b => {
          if (BRANCH_IDS.includes(b)) { setInv(data.invByBranch[b], b); invCount += (data.invByBranch[b] || []).length; }
        });
      } else if (data.inv) {
        // v2 format — single (current-branch) inventory
        setInv(data.inv);
        invCount = data.inv.length;
      }
      if (data.sales)     { _salesCache = data.sales; if (!_fbReady) DB.s('sales', data.sales); }
      if (data.customers) setCustomers(data.customers);
      if (data.transfers) setTransfers(data.transfers);
      if (data.settings)  { _settingsCache = data.settings; saveSettingsCache(); }
      if (data.suspended) setSuspended(data.suspended);
      showMsg('sBackupMsg', 'تم الاستعادة — ' + invCount + ' منتج · ' + (data.sales?.length||0) + ' فاتورة');
      buildDashboard();
    } catch(err) {
      showMsg('sBackupMsg', 'خطأ في قراءة الملف: ' + err.message, 'danger');
    }
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

