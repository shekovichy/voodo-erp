// ══════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════
function renderInventory() {
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
  const inv = getInv();
  const p = inv.find(x => x.code === code);
  if (p) { p.qty = parseInt(val) || 0; setInv(inv); renderInventory(); }
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
  document.getElementById('pm-category').value    = p ? (p.category||'') : '';
  document.getElementById('pm-family').value      = p ? (p.family||'') : '';
  document.getElementById('productModal').classList.remove('hidden');
}

function editProduct(code) {
  const p = getInv().find(x => x.code === code);
  if (p) openProductModal(p);
}

function saveProduct() {
  const code       = document.getElementById('pm-code').value.trim();
  const name       = document.getElementById('pm-name').value.trim();
  const priceAfter = parseFloat(document.getElementById('pm-priceAfter').value);
  if (!code || !name || isNaN(priceAfter)) { showToast('الكود والاسم والسعر مطلوبون'); return; }

  const inv = getInv();
  const editCode = document.getElementById('pmEditCode').value;
  const prod = {
    code, name,
    cost:       parseFloat(document.getElementById('pm-cost').value) || 0,
    priceBefore: parseFloat(document.getElementById('pm-priceBefore').value) || 0,
    priceAfter,
    qty:      parseInt(document.getElementById('pm-qty').value) || 0,
    category: document.getElementById('pm-category').value.trim(),
    family:   document.getElementById('pm-family').value.trim()
  };

  if (editCode) {
    const idx = inv.findIndex(x => x.code === editCode);
    const oldProd = inv[idx];
    if (idx >= 0) inv[idx] = prod; else inv.push(prod);
    // Audit: price change?
    const fieldLabels = { name:'الاسم', cost:'التكلفة', priceBefore:'السعر قبل الخصم', priceAfter:'السعر', qty:'الكمية', category:'الفئة', family:'العائلة' };
    const changes = oldProd ? buildAuditDiff(
      { name: oldProd.name, cost: fmt(oldProd.cost), priceBefore: fmt(oldProd.priceBefore), priceAfter: fmt(oldProd.priceAfter), qty: oldProd.qty, category: oldProd.category, family: oldProd.family },
      { name: prod.name, cost: fmt(prod.cost), priceBefore: fmt(prod.priceBefore), priceAfter: fmt(prod.priceAfter), qty: prod.qty, category: prod.category, family: prod.family },
      fieldLabels
    ) : null;
    if (oldProd && oldProd.priceAfter !== prod.priceAfter) {
      addAuditLog('price.change', `${prod.name}: سعر ${fmt(oldProd.priceAfter)} ← ${fmt(prod.priceAfter)} ج`, null, changes);
    } else {
      addAuditLog('inv.edit', `تعديل: ${prod.name} (${prod.code}) — كمية: ${prod.qty}`, null, changes);
    }
  } else {
    if (inv.find(x => x.code === code)) { showToast('هذا الكود موجود مسبقاً'); return; }
    inv.push(prod);
    addAuditLog('inv.add', `إضافة: ${prod.name} (${prod.code}) — سعر: ${fmt(prod.priceAfter)} ج`, null);
  }
  setInv(inv);
  document.getElementById('productModal').classList.add('hidden');
  renderInventory();
}

function deleteProduct(code) {
  if (!confirm('حذف هذا المنتج؟')) return;
  const prod = getInv().find(x => x.code === code);
  setInv(getInv().filter(x => x.code !== code));
  if (prod) addAuditLog('inv.delete', `حذف: ${prod.name} (${prod.code})`, null);
  renderInventory();
}

function importExcel(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const wb   = XLSX.read(ev.target.result, { type:'binary' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    const inv  = getInv();
    let added=0, updated=0, errors=[];

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
        qty:      parseInt(g('qty','quantity','الكمية','كمية','stock','مخزون')||0)||0,
        category: String(g('category','الفئة','فئة','كاتيجورى','كاتيجوري','')||'').trim(),
        family:   String(g('family','المجموعة','مجموعة','فاميلى','فاميلي','')||'').trim()
      };
      const ex = inv.find(x => x.code === code);
      if (ex) { Object.assign(ex, prod); updated++; } else { inv.push(prod); added++; }
    });

    setInv(inv); e.target.value = '';
    const msg = `✅ تم الاستيراد: ${added} منتج جديد · ${updated} تم تحديثه${errors.length ? `<br>⚠️ ${errors.slice(0,3).join(' | ')}` : ''}`;
    document.getElementById('importAlert').innerHTML = `<div class="alert alert-success">${msg}</div>`;
    setTimeout(() => document.getElementById('importAlert').innerHTML='', 6000);
    renderInventory();
  };
  reader.readAsBinaryString(file);
}

function exportInventoryExcel() {
  const data = getInv().map(p => ({
    'الكود':p.code,'الاسم':p.name,'التكلفة':p.cost||0,
    'السعر قبل':p.priceBefore||0,'السعر بعد':p.priceAfter,'الكمية':p.qty
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
  XLSX.writeFile(wb, 'inventory_' + new Date().toISOString().slice(0,10) + '.xlsx');
}

