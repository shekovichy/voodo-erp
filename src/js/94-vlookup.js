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
  // fallback: also try other sellable branches (excludes warehouse, and now
  // uses BRANCH_IDS instead of a hardcoded b1-b4 literal so admin-added
  // branches are included in the lookup too)
  BRANCH_IDS.filter(function(b){ return b !== 'wh'; }).forEach(function(b){
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
      t += '<td style="padding:8px 10px;font-weight:700;">'+escHtml(r.name)+'</td>';
      t += '<td style="padding:8px;text-align:center;font-weight:700;color:var(--primary);">'+fmt(r.revenue)+' ج</td>';
      t += '<td style="padding:8px;text-align:center;">'+fmt(r.cost)+' ج</td>';
      t += '<td style="padding:8px;text-align:center;"><span style="background:'+mg_bg+';color:'+mg_tc+';padding:2px 8px;border-radius:12px;font-size:11px;">'+margin+'%</span></td>';
      t += '<td style="padding:8px;text-align:center;">'+r.qty+'</td>';
      t += '<td style="padding:8px;text-align:center;">';
      t += '<div style="background:var(--border);border-radius:4px;height:6px;margin-bottom:2px;"><div style="background:var(--primary);height:6px;border-radius:4px;width:'+Math.min(pct,100)+'%;"></div></div>';
      t += '<span style="font-size:11px;">'+pct+'%</span></td>';
      t += '<td style="padding:8px;text-align:center;font-size:12px;">'+(topItem?escHtml(topItem[0])+' (x'+topItem[1]+')':'-')+'</td>';
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
    rows += '<td style="padding:6px 8px;font-size:12px;"><strong>'+escHtml(p.code)+'</strong></td>';
    rows += '<td style="padding:6px 8px;font-size:12px;">'+escHtml(p.name)+'</td>';
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
  var updates = [];
  inv.forEach(function(p, i) {
    var catEl = document.getElementById('bcat_' + i);
    var famEl = document.getElementById('bfam_' + i);
    if (!catEl || !famEl) return;
    if (catEl.value !== (p.category||'') || famEl.value !== (p.family||'')) {
      updates.push({ code: p.code, set: { category: catEl.value, family: famEl.value } });
    }
  });
  // Transactional field updates (see adjustStock) — the old whole-array
  // setInv() clobbered any sale that happened while this modal was open.
  if (updates.length) { adjustStock(updates); renderInventory(); }
  document.getElementById('bulkCatModal').classList.add('hidden');
  showToast(updates.length > 0 ? ('تم تحديث ' + updates.length + ' منتج') : 'لا يوجد تغييرات');
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
      if (!rows.length) { showToast('الملف فارغ أو غير مقروء'); return; }
      _vlData    = rows;
      _vlHeaders = Object.keys(rows[0]);
      buildVlMappingUI();
    } catch(ex) { showToast('خطأ في قراءة الملف: ' + ex.message); }
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
  if (document.getElementById('vlQtyCol')) document.getElementById('vlQtyCol').innerHTML = optsWithSkip;

  // Auto-detect common column names
  var autoMatch = {
    vlKeyCol:         ['code','كود','الكود','sku','barcode','item code','كود المنتج'],
    vlCostCol:        ['cost','تكلفة','التكلفة','buying price','buy price','سعر الشراء'],
    vlPriceBeforeCol: ['price before','pricebefore','السعر قبل','قبل','old price','before'],
    vlPriceAfterCol:  ['price after','priceafter','السعر بعد','بعد','price','السعر','after'],
    vlCategoryCol:    ['category','الفئة','فئة','كاتيجورى','كاتيجوري','cat'],
    vlFamilyCol:      ['family','المجموعة','مجموعة','فاميلى','فاميلي','fam'],
    vlQtyCol:         ['qty','quantity','الكمية','كمية','رصيد','stock','رصيد افتتاحي']
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
  if (!keyCol) { showToast('اختر عمود الكود أولاً'); return; }

  var mapping = {
    cost:        document.getElementById('vlCostCol').value,
    priceBefore: document.getElementById('vlPriceBeforeCol').value,
    priceAfter:  document.getElementById('vlPriceAfterCol').value,
    category:    document.getElementById('vlCategoryCol').value,
    family:      document.getElementById('vlFamilyCol').value,
    qty:         document.getElementById('vlQtyCol') ? document.getElementById('vlQtyCol').value : ''
  };

  var hasAnyMapping = Object.values(mapping).some(function(v){ return v !== ''; });
  if (!hasAnyMapping) { showToast('اختر على الأقل حقل واحد للاستيراد'); return; }

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
    if (mapping.qty && row[mapping.qty] !== '') {
      var v = parseFloat(row[mapping.qty]);
      if (!isNaN(v) && v !== (prod ? prod.qty : null)) { changes.qty = v; hasChange = true; }
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

  var fieldLabel = {cost:'التكلفة', priceBefore:'السعر قبل', priceAfter:'السعر بعد', category:'الفئة', family:'المجموعة', qty:'الكمية'};
  var tbody = '';
  matched.forEach(function(r) {
    var changesHtml = Object.entries(r.changes).map(function(e){
      var lbl = fieldLabel[e[0]] || e[0];
      var old = r.prod ? (r.prod[e[0]]||'—') : '—';
      return '<div style="font-size:11px;"><span style="color:var(--text-muted);">'+escHtml(lbl)+':</span> <span style="text-decoration:line-through;color:#dc2626;">'+escHtml(old)+'</span> → <strong style="color:#15803d;">'+escHtml(e[1])+'</strong></div>';
    }).join('');
    tbody += '<tr style="border-bottom:1px solid var(--border);">';
    tbody += '<td style="padding:8px;font-weight:700;font-size:13px;">'+escHtml(r.keyVal)+'</td>';
    tbody += '<td style="padding:8px;font-size:13px;">'+(r.prod?escHtml(r.prod.name):'')+'</td>';
    tbody += '<td style="padding:8px;">'+changesHtml+'</td>';
    tbody += '</tr>';
  });
  if (notFound.length) {
    notFound.forEach(function(r){
      tbody += '<tr style="border-bottom:1px solid var(--border);opacity:.5;">';
      tbody += '<td style="padding:8px;font-size:13px;">'+escHtml(r.keyVal)+'</td>';
      tbody += '<td colspan="2" style="padding:8px;font-size:12px;color:#dc2626;">❌ غير موجود في المخزون</td>';
      tbody += '</tr>';
    });
  }
  document.getElementById('vlPreviewBody').innerHTML = tbody || '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted);">لا توجد تغييرات</td></tr>';

  // store for apply
  document.getElementById('vlApplyBtn').onclick = function() { applyVlookup(matched); };
}

function applyVlookup(matched) {
  if (!matched || !matched.length) { showToast('لا توجد تغييرات للتطبيق'); return; }
  var inv = getInv();
  var updates = [];
  matched.forEach(function(r) {
    var prod = inv.find(function(p){ return p.code === r.keyVal || p.code.toLowerCase() === r.keyVal.toLowerCase(); });
    if (!prod) return;
    updates.push({ code: prod.code, set: r.changes });
  });
  // Transactional field updates (see adjustStock) — the old whole-array
  // setInv() clobbered any sale that happened during the VLOOKUP apply.
  if (updates.length) adjustStock(updates);
  renderInventory();
  document.getElementById('vlookupModal').classList.add('hidden');
  showToast('تم تحديث ' + updates.length + ' منتج بنجاح');
}

