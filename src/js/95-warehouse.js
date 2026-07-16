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

  animateNumber(document.getElementById('wh-items'), totalItems);
  animateNumber(document.getElementById('wh-units'), totalUnits);
  animateNumber(document.getElementById('wh-value'), totalValue, { format: fmt, suffix: ' ج' });
  animateNumber(document.getElementById('wh-low'),   lowItems);

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
      tbody += '<td style="padding:8px 12px;font-size:12px;color:var(--text-muted);">'+escHtml(p.code)+'</td>';
      tbody += '<td style="padding:8px 12px;font-weight:600;">'+escHtml(p.name)+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-size:12px;">'+(escHtml(p.category)||'—')+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-size:12px;">'+(escHtml(p.family)||'—')+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-weight:700;color:'+qtyClr+';">'+(p.qty||0)+(low?' ⚠️':'')+'</td>';
      tbody += '<td style="padding:8px;text-align:center;">'+fmt(p.cost||0)+'</td>';
      tbody += '<td style="padding:8px;text-align:center;font-weight:600;">'+fmt(val)+'</td>';
      tbody += '<td style="padding:8px;text-align:center;">';
      tbody += '<button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;" onclick="openWhTransferModal(\''+escJsAttr(p.code)+'\')">📤 تحويل</button>';
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
      histHtml += '<td style="padding:7px 8px;font-weight:600;">'+escHtml(t.fromName||t.from)+'</td>';
      histHtml += '<td style="padding:7px 8px;font-weight:600;">'+escHtml(t.toName||t.to)+'</td>';
      histHtml += '<td style="padding:7px 8px;text-align:center;">'+(t.items?.length||0)+' صنف</td>';
      histHtml += '<td style="padding:7px 8px;font-size:12px;color:var(--text-muted);">'+(escHtml(t.note)||'—')+'</td>';
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
    .map(function(b){ return '<option value="'+b+'">'+escHtml(branches[b]||BRANCH_DEFAULTS[b])+'</option>'; }).join('');
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
    return '<div onclick="whTrAddItemByCode(\''+escJsAttr(p.code)+'\'); this.parentNode.style.display=\'none\';" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;" onmouseover="this.style.background=\'#f0f9ff\'" onmouseout="this.style.background=\'white\'">'
      +'<span style="font-weight:600;font-size:13px;">'+escHtml(p.name)+'</span>'
      +'<span style="font-size:12px;color:var(--text-muted);">متاح: <strong style="color:#1d4ed8;">'+p.qty+'</strong></span>'
      +'</div>';
  }).join('');
}

// Looked up by code instead of passing the whole product object through the
// onclick attribute — embedding JSON.stringify(p) with quotes swapped (the
// old approach) let a product name containing a single quote break out of
// the inline handler and inject arbitrary JS.
function whTrAddItemByCode(code) {
  var prod = getInv('wh').find(function(p){ return p.code === code; });
  if (prod) whTrAddItem(prod);
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
    html2 += '<div><div style="font-weight:600;font-size:13px;">'+escHtml(item.name)+'</div>';
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
  if (!to) { showToast('اختر الفرع'); return; }
  if (!_whTrItems.length) { showToast('أضف أصناف للتحويل'); return; }
  var note = document.getElementById('whTrNote').value.trim();

  // Validate quantities from warehouse
  var whInv = getInv('wh');
  for (var k=0; k<_whTrItems.length; k++) {
    var it = _whTrItems[k];
    var p  = whInv.find(function(x){ return x.code===it.code; });
    if (!p || p.qty < it.qty) {
      showToast('الكمية المطلوبة من "'+it.name+'" غير متاحة في المخزن الرئيسي (متاح: '+(p?p.qty:0)+')');
      return;
    }
  }

  // Deduct from warehouse / add to destination — transactional per-product
  // deltas so a concurrent sale on the destination branch isn't clobbered
  // (see adjustStock). `insert` seeds products the branch doesn't stock yet.
  adjustStock(_whTrItems.map(function(i){ return { code: i.code, delta: -i.qty }; }), 'wh');
  adjustStock(_whTrItems.map(function(i){
    return {
      code: i.code, delta: i.qty,
      insert: whInv.find(function(x){ return x.code === i.code; })
    };
  }), to);

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
  showToast('✅ تم التحويل بنجاح\nمن: المخزن الرئيسي → إلى: '+(record.toName)+'\n'+_whTrItems.length+' صنف');
}

