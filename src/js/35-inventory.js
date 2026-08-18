// ══════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════

// The branch this page is currently SHOWING (the #invBranchFilter dropdown),
// which is not necessarily currentBranch — an admin can view any branch here.
// EVERY read and write on this page must go through this, not the
// getInv()/adjustStock() default: those fall back to currentBranch, so with
// the filter pointing anywhere else the page read one branch while writing
// another. That silently sent an entire Excel import to the wrong branch
// (looked like "32 products imported" then nothing in the table), and made
// qty edits/deletes hit a different branch's stock than the row shown.
function invPageBranch() {
  const ibf = document.getElementById('invBranchFilter');
  return (ibf && ibf.value) || currentBranch;
}


// ── Sorting ─────────────────────────────────────────────────────────
// 2,900 products across the catalogue and no way to order them: finding the
// most expensive item, the deepest stock or anything without a cost meant
// scrolling. Category and family already had filters; everything else needed
// an ordering, so every column that holds a value is sortable by clicking it.
//
// Numbers sort numerically and text by Arabic collation — 'ب' after 'ا', which
// a plain > comparison gets wrong. Blank and missing values always sink to the
// bottom whichever direction is chosen, since "products with no cost" is a
// thing you go looking for, not noise you want mixed into the middle.
const INV_COLS = [
  { key: 'code',        label: 'الكود',      type: 'text' },
  { key: 'name',        label: 'الاسم',      type: 'text' },
  { key: 'category',    label: 'الفئة',      type: 'text' },
  { key: 'family',      label: 'المجموعة',   type: 'text' },
  { key: 'cost',        label: 'التكلفة',    type: 'num'  },
  { key: 'priceBefore', label: 'السعر قبل',  type: 'num'  },
  { key: 'priceAfter',  label: 'السعر بعد',  type: 'num'  },
  { key: 'qty',         label: 'الكمية',     type: 'num'  },
];
let _invSort = { key: null, dir: 1 };   // dir: 1 تصاعدي، -1 تنازلي

function sortInventory(key) {
  // Third click on the same column clears the sort and restores the original
  // order, so there is a way back to "as imported" without reloading.
  if (_invSort.key !== key)      _invSort = { key, dir: 1 };
  else if (_invSort.dir === 1)   _invSort.dir = -1;
  else                           _invSort = { key: null, dir: 1 };
  renderInventory();
}

function _renderInvHead() {
  const head = document.getElementById('inventoryHead');
  if (!head) return;
  const cells = INV_COLS.map(function (c) {
    const on  = _invSort.key === c.key;
    const ind = on ? (_invSort.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th onclick="sortInventory(&quot;' + c.key + '&quot;)" title="اضغط للترتيب"'
      + ' style="cursor:pointer;user-select:none;' + (on ? 'color:#93c5fd;' : '') + '">'
      + c.label + '<span style="font-size:10px;">' + ind + '</span></th>';
  }).join('');
  head.innerHTML = '<tr>' + cells + '<th>الحالة</th><th>إجراءات</th></tr>';
}

function _applyInvSort(items) {
  if (!_invSort.key) return items;
  const col = INV_COLS.find(function (c) { return c.key === _invSort.key; });
  if (!col) return items;
  const d = _invSort.dir;
  return items.slice().sort(function (a, z) {
    let av = a[col.key], zv = z[col.key];
    if (col.type === 'num') {
      av = parseFloat(av); zv = parseFloat(zv);
      const an = isNaN(av), zn = isNaN(zv);
      if (an && zn) return 0;
      if (an) return 1;              // الفاضي تحت دايماً
      if (zn) return -1;
      return (av - zv) * d;
    }
    av = (av || '').toString().trim();
    zv = (zv || '').toString().trim();
    if (!av && !zv) return 0;
    if (!av) return 1;
    if (!zv) return -1;
    return av.localeCompare(zv, 'ar') * d;
  });
}

function renderInventory() {
  // Stock-taking is an admin-only job by policy. Until now that rested
  // entirely on the inventory tab itself being hidden from cashiers by the
  // permissions tree (_FIXED_ROLE_GRANTS grants a cashier helpdesk and nothing
  // else) — nothing in the code said so, so widening that tree even slightly
  // would have exposed the buttons by accident. Say it here as well; the
  // enforcement that actually counts is in firestore.rules, since `inventory`
  // is enforced: false.
  var isAdmin = (currentUser === 'admin');
  ['stockCountBtn', 'stocktakeHistoryBtn'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });

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
  // Lock the filter to the user's OWN branch for non-admins — same pattern as
  // the sales/reports pages (see lockBranchFilter in 05-utils.js). Must run
  // after the options exist and before the value is read. Without it a branch
  // cashier could point this page at another branch; firestore.rules would
  // still deny the actual write, but the optimistic local cache would show
  // phantom edits that silently never persist.
  lockBranchFilter('invBranchFilter');
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
  if (_cf) { const _cv=_cf.value; const _cats=[...new Set(inv.map(x=>x.category).filter(Boolean))].sort(); _cf.innerHTML='<option value="">كل الفئات</option>'+_cats.map(c=>`<option value="${escHtml(c)}" ${c===_cv?'selected':''}>${escHtml(c)}</option>`).join(''); _cf.value=_cv; }
  if (_ff) { const _fv=_ff.value; const _fams=[...new Set(inv.map(x=>x.family).filter(Boolean))].sort(); _ff.innerHTML='<option value="">كل المجموعات</option>'+_fams.map(f=>`<option value="${escHtml(f)}" ${f===_fv?'selected':''}>${escHtml(f)}</option>`).join(''); _ff.value=_fv; }

  _renderInvHead();
  items = _applyInvSort(items);

  document.getElementById('inventoryBody').innerHTML = !items.length
    ? '<tr><td colspan="10" class="text-center text-muted" style="padding:40px;">لا توجد منتجات</td></tr>'
    : items.map(p => `<tr>
        <td><strong>${escHtml(p.code)}</strong></td>
        <td>${escHtml(p.name)}</td>
        <td><span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:11px;">${escHtml(p.category)||'—'}</span></td>
        <td><span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:12px;font-size:11px;">${escHtml(p.family)||'—'}</span></td>
        <td>${fmt(p.cost||0)}</td>
        <td>${p.priceBefore ? fmt(p.priceBefore) : '-'}</td>
        <td><strong>${fmt(p.priceAfter)}</strong></td>
        <td><input type="number" value="${p.qty}" min="0"
          onchange="updateQty('${escJsAttr(p.code)}',this.value)"
          style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;text-align:center;font-family:inherit;" /></td>
        <td><span class="badge ${p.qty<=0?'badge-danger':p.qty<=thresh?'badge-warning':'badge-success'}">
          ${p.qty<=0?'نفد':p.qty<=thresh?'منخفض':'متوفر'}
        </span></td>
        <td>
          <button class="btn btn-gray btn-sm" onclick="editProduct('${escJsAttr(p.code)}')" style="margin-left:4px;">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct('${escJsAttr(p.code)}')">🗑️</button>
        </td>
      </tr>`).join('');
}

function updateQty(code, val) {
  const b = invPageBranch();
  const p = getInv(b).find(x => x.code === code);
  if (!p) return;
  // Absolute correction of ONE product's count — routed through adjustStock so
  // it no longer rewrites the whole array (which clobbered concurrent sales of
  // OTHER products). The corrected product itself is intentionally last-write-
  // wins: the admin is overriding the count on purpose.
  adjustStock([{ code, set: { qty: Math.max(0, parseInt(val) || 0) } }], b);
  renderInventory();
}

// الفئة/المجموعة عبارة عن <select> بخيارات ثابتة، لكن استيراد الإكسيل
// بيقبل أي نص — فمنتج جاي من ملف بمجموعة "ahram" (حرف صغير) مكانش بيلاقي
// الخيار "Ahram" (حرف كبير)، فالقايمة كانت تفضل فاضية، وأول ما الأدمن
// يحفظ أي تعديل تاني كانت المجموعة تتمسح من غير ما حد ياخد باله.
// الحل: أي قيمة مش موجودة في القايمة تتضاف ليها مؤقتاً بدل ما تضيع —
// بنحافظ على القيمة الأصلية زي ما هي بدل ما نغيّر حالة حروفها.
function _setSelectPreserving(id, val) {
  const sel = document.getElementById(id);
  if (!sel) return;
  Array.from(sel.querySelectorAll('option[data-injected]')).forEach(o => o.remove());
  val = val || '';
  if (val && !Array.from(sel.options).some(o => o.value === val)) {
    const o = document.createElement('option');
    o.value = val; o.textContent = val; o.dataset.injected = '1';
    sel.appendChild(o);
  }
  sel.value = val;
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
  _setSelectPreserving('pm-category', p ? p.category : '');
  _setSelectPreserving('pm-family',   p ? p.family   : '');
  document.getElementById('productModal').classList.remove('hidden');
}

function editProduct(code) {
  const p = getInv(invPageBranch()).find(x => x.code === code);
  if (p) openProductModal(p);
}

function saveProduct() {
  const code       = document.getElementById('pm-code').value.trim();
  const name       = document.getElementById('pm-name').value.trim();
  const priceAfter = parseFloat(document.getElementById('pm-priceAfter').value);
  if (!code || !name || isNaN(priceAfter)) { showToast('الكود والاسم والسعر مطلوبون'); return; }

  const invBranch = invPageBranch();
  const inv = getInv(invBranch);
  const editCode = document.getElementById('pmEditCode').value;
  const prod = {
    code, name,
    cost:       parseFloat(document.getElementById('pm-cost').value) || 0,
    priceBefore: parseFloat(document.getElementById('pm-priceBefore').value) || 0,
    priceAfter,
    qty:      Math.max(0, parseInt(document.getElementById('pm-qty').value) || 0),
    category: document.getElementById('pm-category').value.trim(),
    family:   document.getElementById('pm-family').value.trim()
  };

  if (editCode) {
    // نسخة مستقلة، مش مرجع: adjustStock بيعمل Object.assign على نفس الكائن
    // اللي جوه الكاش، فلو سِبنا المرجع زي ما هو كانت القيم "القديمة" بتتحدّث
    // للجديدة قبل ما نقارن — يعني الفرق بيطلع فاضي دايماً وتغيير السعر عمره
    // ما بيتسجل كـ price.change. لازم الالتقاط يحصل قبل adjustStock.
    const found = inv.find(x => x.code === editCode);
    const oldProd = found ? Object.assign({}, found) : null;
    // Upsert this ONE product transactionally (see adjustStock) — the old
    // whole-array setInv() clobbered concurrent sales of other products.
    // If the admin changed the product code, remove the old entry first.
    const deltas = [];
    if (editCode !== prod.code) deltas.push({ code: editCode, remove: true });
    deltas.push({ code: prod.code, insert: prod, set: prod });
    adjustStock(deltas, invBranch);
    // Audit: price change?
    const fieldLabels = { name:'الاسم', cost:'التكلفة', priceBefore:'السعر قبل الخصم', priceAfter:'السعر', qty:'الكمية', category:'الفئة', family:'العائلة' };
    const changes = oldProd ? buildAuditDiff(
      { name: oldProd.name, cost: fmt(oldProd.cost), priceBefore: fmt(oldProd.priceBefore), priceAfter: fmt(oldProd.priceAfter), qty: oldProd.qty, category: oldProd.category, family: oldProd.family },
      { name: prod.name, cost: fmt(prod.cost), priceBefore: fmt(prod.priceBefore), priceAfter: fmt(prod.priceAfter), qty: prod.qty, category: prod.category, family: prod.family },
      fieldLabels
    ) : null;
    if (oldProd && oldProd.priceAfter !== prod.priceAfter) {
      addAuditLog('price.change', `${prod.name}: سعر ${fmt(oldProd.priceAfter)} ← ${fmt(prod.priceAfter)} ج`, invBranch, changes);
    } else {
      addAuditLog('inv.edit', `تعديل: ${prod.name} (${prod.code}) — كمية: ${prod.qty}`, invBranch, changes);
    }
  } else {
    if (inv.find(x => x.code === code)) { showToast('هذا الكود موجود مسبقاً'); return; }
    adjustStock([{ code: prod.code, insert: prod, set: prod }], invBranch);
    const addFieldLabels = { code:'الكود', name:'الاسم', cost:'التكلفة', priceBefore:'السعر قبل الخصم', priceAfter:'السعر', qty:'الكمية', category:'الفئة', family:'العائلة' };
    const addedChanges = buildAuditDiff(
      null,
      { code: prod.code, name: prod.name, cost: fmt(prod.cost), priceBefore: fmt(prod.priceBefore), priceAfter: fmt(prod.priceAfter), qty: prod.qty, category: prod.category, family: prod.family },
      addFieldLabels
    );
    addAuditLog('inv.add', `إضافة: ${prod.name} (${prod.code}) — سعر: ${fmt(prod.priceAfter)} ج`, invBranch, addedChanges);
  }
  document.getElementById('productModal').classList.add('hidden');
  renderInventory();
  // If a stock count opened this modal to create a missing product, hand the
  // product straight back so the count picks it up — a full count's item list
  // is snapshotted when it starts, so it would never see it otherwise.
  if (typeof stockCountAbsorbNewProduct === 'function') stockCountAbsorbNewProduct(prod);
}

// Dismissing the modal has to go through here rather than hiding it inline,
// so a count waiting behind it gets restored instead of being left buried.
function closeProductModal() {
  document.getElementById('productModal').classList.add('hidden');
  if (typeof stockCountCancelAddProduct === 'function') stockCountCancelAddProduct();
}

function deleteProduct(code) {
  showConfirmModal('حذف هذا المنتج؟', function() {
    const b = invPageBranch();
    const prod = getInv(b).find(x => x.code === code);
    adjustStock([{ code, remove: true }], b);
    if (prod) {
      const delFieldLabels = { code:'الكود', name:'الاسم', cost:'التكلفة', priceBefore:'السعر قبل الخصم', priceAfter:'السعر', qty:'الكمية', category:'الفئة', family:'العائلة' };
      const deletedChanges = buildAuditDiff(
        { code: prod.code, name: prod.name, cost: fmt(prod.cost), priceBefore: fmt(prod.priceBefore), priceAfter: fmt(prod.priceAfter), qty: prod.qty, category: prod.category, family: prod.family },
        {},
        delFieldLabels
      );
      addAuditLog('inv.delete', `حذف: ${prod.name} (${prod.code})`, b, deletedChanges);
    }
    renderInventory();
  });
}

function importExcel(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    // 'array' + readAsArrayBuffer (مش 'binary' + readAsBinaryString): القراءة
    // كـ binary string بتفك البايتات على أنها latin1، فأي اسم عربي في ملف
    // CSV بيترجع مشوّه ("ÙÙØªØ¬" بدل "منتج"). ملفات xlsx مكانتش بتتأثر
    // لأنها ZIP والمكتبة بتفك ترميزها بنفسها — عشان كده البج عاش من غير ما
    // يتلاحظ. codepage 65001 = UTF-8 لملفات الـ CSV اللي من غير BOM.
    const wb   = XLSX.read(new Uint8Array(ev.target.result), { type:'array', codepage:65001 });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    const impBranch = invPageBranch();
    const inv  = getInv(impBranch);
    let added=0, updated=0, errors=[];
    const upserts = [];

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
        qty:      Math.max(0, parseInt(g('qty','quantity','الكمية','كمية','stock','مخزون')||0)||0),
        category: String(g('category','الفئة','فئة','كاتيجورى','كاتيجوري','')||'').trim(),
        family:   String(g('family','المجموعة','مجموعة','فاميلى','فاميلي','')||'').trim()
      };
      const ex = inv.find(x => x.code === code);
      if (ex) { updated++; } else { added++; }
      upserts.push({ code, insert: prod, set: prod });
    });

    // One transactional bulk upsert (see adjustStock) — the old whole-array
    // setInv() clobbered any sale that happened during the import.
    if (upserts.length) adjustStock(upserts, impBranch);
    e.target.value = '';
    // Name the branch explicitly — an admin importing while the branch filter
    // points somewhere other than their own branch has no other way to tell
    // where the rows actually landed.
    const msg = `✅ تم الاستيراد لفرع "${escHtml(getBranchName(impBranch))}": ${added} منتج جديد · ${updated} تم تحديثه${errors.length ? `<br>⚠️ ${errors.slice(0,3).join(' | ')}` : ''}`;
    document.getElementById('importAlert').innerHTML = `<div class="alert alert-success">${msg}</div>`;
    setTimeout(() => document.getElementById('importAlert').innerHTML='', 6000);
    renderInventory();
  };
  reader.readAsArrayBuffer(file);
}

function exportInventoryExcel() {
  const data = getInv(invPageBranch()).map(p => ({
    'الكود':p.code,'الاسم':p.name,'التكلفة':p.cost||0,
    'السعر قبل':p.priceBefore||0,'السعر بعد':p.priceAfter,'الكمية':p.qty
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
  XLSX.writeFile(wb, 'inventory_' + todayKey() + '.xlsx');
}

