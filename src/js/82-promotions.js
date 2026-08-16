// ══════════════════════════════════════════════
// PROMOTIONS SYSTEM
// ══════════════════════════════════════════════
const getPromos = () => _promoCache;

function setPromos(list) {
  _promoCache = list;
  DB.s('pos_promos', list);
  try { _db && _db.collection('pos_data').doc('promotions').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

// ── Promo modal state ──
let _promoEditId   = null;
let _promoBundleItems = []; // [{code, name, minQty}]

function openPromoModal(id) {
  _promoEditId = id || null;
  _promoBundleItems = [];
  const promo = id ? getPromos().find(p => p.id === id) : null;
  document.getElementById('promoModalTitle').textContent = promo ? 'تعديل العرض' : 'إضافة عرض جديد';
  document.getElementById('promoName').value = promo?.name || '';
  const typeEl = document.getElementById('promoType');
  typeEl.value = promo?.type || 'bundle';
  if (promo?.type === 'bundle') {
    _promoBundleItems = promo.items ? JSON.parse(JSON.stringify(promo.items)) : [];
  }
  document.getElementById('promoBundlePrice').value   = promo?.bundlePrice || '';
  document.getElementById('promoMinAmount').value     = promo?.minAmount || '';
  document.getElementById('promoDiscType').value      = promo?.discountType || 'percent';
  document.getElementById('promoDiscValue').value     = promo?.discountValue || '';
  document.getElementById('promoCatDisc').value       = promo?.categoryDisc || '';
  document.getElementById('promoCatName').value       = promo?.categoryName || '';
  document.getElementById('promoBuyQty').value        = promo?.buyQty || 1;
  document.getElementById('promoGetQty').value        = promo?.getQty || 1;
  document.getElementById('promoStartDate').value     = promo?.startDate || '';
  document.getElementById('promoEndDate').value       = promo?.endDate || '';
  if (promo?.type === 'bxgy') _promoBundleItems = promo.items ? JSON.parse(JSON.stringify(promo.items)) : [];
  renderPromoBundleItems();
  togglePromoTypeUI();
  document.getElementById('promoModal').classList.remove('hidden');
}

function togglePromoTypeUI() {
  const type = document.getElementById('promoType').value;
  document.getElementById('bundleSection').classList.toggle('hidden', type !== 'bundle');
  document.getElementById('thresholdSection').classList.toggle('hidden', type !== 'threshold');
  document.getElementById('categorySection').classList.toggle('hidden', type !== 'category');
  document.getElementById('bxgySection').classList.toggle('hidden', type !== 'bxgy');
}

function renderPromoBundleItems() {
  const el = document.getElementById('promoBundleItemsList');
  if (!el) return;
  if (!_promoBundleItems.length) {
    el.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:8px;">لم يتم إضافة منتجات بعد</div>';
    return;
  }
  el.innerHTML = _promoBundleItems.map((bi, idx) => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border);">
      <span style="flex:1; font-size:13px;">${escHtml(bi.name)}</span>
      <span style="font-size:11px; color:var(--text-muted);">${escHtml(bi.code)}</span>
      <span style="font-size:12px;">كمية:</span>
      <input type="number" value="${bi.minQty}" min="1" style="width:52px; padding:3px 5px; border:1px solid var(--border); border-radius:4px; font-size:12px;"
        onchange="_promoBundleItems[${idx}].minQty = Math.max(1, parseInt(this.value)||1)" />
      <button onclick="_promoBundleItems.splice(${idx},1); renderPromoBundleItems();"
        style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:15px; padding:0 2px;">✕</button>
    </div>`).join('');
}

function addPromoProductSearch() {
  const q = document.getElementById('promoProdSearch').value.trim().toLowerCase();
  if (!q) return;
  const inv = getInv();
  const matches = inv.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  const dd = document.getElementById('promoProdDropdown');
  if (!matches.length) { dd.innerHTML = '<div style="padding:8px; font-size:12px; color:var(--text-muted);">لا نتائج</div>'; dd.classList.remove('hidden'); return; }
  dd.innerHTML = matches.slice(0,8).map(p => `
    <div style="padding:7px 10px; cursor:pointer; font-size:13px; border-bottom:1px solid #f0f0f0;"
      onmousedown="selectPromoProduct('${escJsAttr(p.code)}','${escJsAttr(p.name)}')">
      <span>${escHtml(p.name)}</span> <span style="color:var(--text-muted); font-size:11px;">${escHtml(p.code)}</span>
    </div>`).join('');
  dd.classList.remove('hidden');
}

function selectPromoProduct(code, name) {
  document.getElementById('promoProdDropdown').classList.add('hidden');
  document.getElementById('promoProdSearch').value = '';
  if (_promoBundleItems.find(b => b.code === code)) return; // already added
  _promoBundleItems.push({ code, name, minQty: 1 });
  renderPromoBundleItems();
}

function savePromo() {
  const name = document.getElementById('promoName').value.trim();
  const type = document.getElementById('promoType').value;
  if (!name) { showToast('أدخل اسم العرض'); return; }

  const startDate = document.getElementById('promoStartDate').value;
  const endDate   = document.getElementById('promoEndDate').value;
  let promo = { id: _promoEditId || Date.now(), name, type, active: true };
  if (startDate) promo.startDate = startDate;
  if (endDate)   promo.endDate   = endDate;

  if (type === 'bundle') {
    if (_promoBundleItems.length < 2) { showToast('أضف منتجين على الأقل للحزمة'); return; }
    const bPrice = parseFloat(document.getElementById('promoBundlePrice').value);
    if (!bPrice || bPrice <= 0) { showToast('أدخل سعر الحزمة'); return; }
    promo.items       = _promoBundleItems.map(b => ({...b}));
    promo.bundlePrice = bPrice;
  } else if (type === 'threshold') {
    const minAmt  = parseFloat(document.getElementById('promoMinAmount').value);
    const dType   = document.getElementById('promoDiscType').value;
    const dVal    = parseFloat(document.getElementById('promoDiscValue').value);
    if (!minAmt || minAmt <= 0) { showToast('أدخل الحد الأدنى للفاتورة'); return; }
    if (!dVal  || dVal <= 0)   { showToast('أدخل قيمة الخصم'); return; }
    promo.minAmount    = minAmt;
    promo.discountType = dType;
    promo.discountValue = dVal;
  } else if (type === 'category') {
    const catName = document.getElementById('promoCatName').value.trim();
    const catDisc = parseFloat(document.getElementById('promoCatDisc').value);
    if (!catName) { showToast('أدخل اسم الفئة'); return; }
    if (!catDisc || catDisc <= 0 || catDisc > 100) { showToast('أدخل نسبة الخصم (1-100)'); return; }
    promo.categoryName = catName;
    promo.categoryDisc = catDisc;
  } else if (type === 'bxgy') {
    if (!_promoBundleItems.length) { showToast('أضف المنتج المطلوب شراؤه'); return; }
    const buyQty = parseInt(document.getElementById('promoBuyQty').value) || 1;
    const getQty = parseInt(document.getElementById('promoGetQty').value) || 1;
    promo.items  = _promoBundleItems.map(b => ({...b}));
    promo.buyQty = buyQty;
    promo.getQty = getQty;
  }

  const list = getPromos();
  const idx  = list.findIndex(p => p.id === promo.id);
  if (idx >= 0) list[idx] = promo; else list.push(promo);
  setPromos(list);
  document.getElementById('promoModal').classList.add('hidden');
  renderPromosPage();
}

function deletePromo(id) {
  showConfirmModal('حذف هذا العرض؟', function() {
    const p = getPromos().find(x => x.id === id);
    setPromos(getPromos().filter(x => x.id !== id));
    if (p) {
      const changes = buildAuditDiff(
        { name: p.name, type: p.type, active: p.active ? 'نشط' : 'موقوف' },
        {},
        { name: 'الاسم', type: 'النوع', active: 'الحالة' }
      );
      addAuditLog('promo.delete', `حذف عرض: ${p.name}`, null, changes);
    }
    renderPromosPage();
  });
}

function togglePromoActive(id) {
  const list = getPromos();
  const p = list.find(x => x.id === id);
  if (p) { p.active = !p.active; setPromos(list); renderPromosPage(); }
}

function renderPromosPage() {
  const bundles    = getPromos().filter(p => p.type === 'bundle');
  const thresholds = getPromos().filter(p => p.type === 'threshold');
  const categories = getPromos().filter(p => p.type === 'category');
  const bxgys      = getPromos().filter(p => p.type === 'bxgy');
  const canEdit    = currentUser === 'admin';

  const promoCard = (p) => {
    const inv = getInv();
    let detail = '';
    if (p.type === 'bundle') {
      const itemsTotal = (p.items || []).reduce((s, bi) => {
        const ip = inv.find(x => x.code === bi.code);
        return s + (ip ? ip.priceAfter * bi.minQty : 0);
      }, 0);
      const saving = Math.max(0, itemsTotal - p.bundlePrice);
      detail = `<div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
        ${(p.items||[]).map(bi => `${escHtml(bi.name)} ×${bi.minQty}`).join(' + ')}
      </div>
      <div style="font-size:13px; margin-top:6px;">
        سعر الحزمة: <strong>${fmt(p.bundlePrice)} ج</strong>
        ${saving > 0 ? `<span style="color:var(--success); margin-right:8px;">وفر ${fmt(saving)} ج</span>` : ''}
      </div>`;
    } else if (p.type === 'threshold') {
      const discLabel = p.discountType === 'percent' ? `${p.discountValue}%` : `${fmt(p.discountValue)} ج`;
      detail = `<div style="font-size:13px; margin-top:6px;">عند فاتورة ≥ <strong>${fmt(p.minAmount)} ج</strong> — خصم <strong>${discLabel}</strong></div>`;
    } else if (p.type === 'category') {
      detail = `<div style="font-size:13px; margin-top:6px;">خصم <strong>${p.categoryDisc}%</strong> على فئة: <strong>${escHtml(p.categoryName)}</strong></div>`;
    } else if (p.type === 'bxgy') {
      detail = `<div style="font-size:13px; margin-top:6px;">اشتري <strong>${p.buyQty}</strong> من ${(p.items||[]).map(i=>escHtml(i.name)).join('+')} — خد <strong>${p.getQty}</strong> مجاناً</div>`;
    }
    const dateRange = (p.startDate || p.endDate) ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">📅 ${p.startDate||'—'} → ${p.endDate||'—'}</div>` : '';
    return `<div style="border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:10px; opacity:${p.active ? 1 : 0.55};">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div style="flex:1;">
          <div style="font-weight:700; font-size:15px;">${escHtml(p.name)}
            ${p.active ? '<span style="background:#d1fae5; color:#065f46; font-size:11px; padding:2px 7px; border-radius:99px; margin-right:6px;">نشط</span>'
                       : '<span style="background:#f3f4f6; color:#6b7280; font-size:11px; padding:2px 7px; border-radius:99px; margin-right:6px;">متوقف</span>'}
          </div>
          ${detail}${dateRange}
        </div>
        ${canEdit ? `<div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="btn btn-sm ${p.active ? 'btn-gray' : 'btn-success'}" onclick="togglePromoActive(${p.id})">${p.active ? 'إيقاف' : 'تفعيل'}</button>
          <button class="btn btn-sm btn-gray" onclick="openPromoModal(${p.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="deletePromo(${p.id})">🗑️</button>
        </div>` : ''}
      </div>
    </div>`;
  };

  const bEl = document.getElementById('bundlesBody');
  const tEl = document.getElementById('thresholdsBody');
  if (bEl) bEl.innerHTML = bundles.length ? bundles.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد حزم بعد</div>';
  if (tEl) tEl.innerHTML = thresholds.length ? thresholds.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد خصومات بعد</div>';
  const cEl = document.getElementById('categoriesBody');
  const xEl = document.getElementById('bxgyBody');
  if (cEl) cEl.innerHTML = categories.length ? categories.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد خصومات فئات بعد</div>';
  if (xEl) xEl.innerHTML = bxgys.length ? bxgys.map(promoCard).join('') : '<div style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد عروض اشتري وخد بعد</div>';
  // Admin-only: hide add button if cashier
  const addBtn = document.getElementById('addPromoBtn');
  if (addBtn) addBtn.style.display = currentUser === 'admin' ? '' : 'none';
}

// ── Cart promo detection ──
function calcPromoDiscount(promo) {
  if (promo.type === 'bundle') {
    const bundleItemsTotal = (promo.items || []).reduce((s, bi) => {
      const ci = cart.find(c => c.code === bi.code);
      return s + (ci ? ci.price * bi.minQty : 0);
    }, 0);
    return Math.max(0, bundleItemsTotal - promo.bundlePrice);
  }
  if (promo.type === 'threshold') {
    const sub = cart.reduce((s,i) => s + i.price * i.qty, 0);
    if (promo.discountType === 'percent') return Math.min(sub * promo.discountValue / 100, sub);
    return Math.min(promo.discountValue, sub);
  }
  if (promo.type === 'category') {
    const disc = cart.filter(i => (i.category||i.name||'').toLowerCase().includes((promo.categoryName||'').toLowerCase()))
      .reduce((s,i) => s + i.price * i.qty * promo.categoryDisc / 100, 0);
    return Math.max(0, disc);
  }
  if (promo.type === 'bxgy') {
    // "اشتري X خد Y مجاناً" لازم X+Y وحدة في السلة فعلاً — مش X بس. كان الشرط
    // بيقبل ci.qty >= buyQty بس، يعني عميل حاطط في السلة نفس عدد buyQty بالظبط
    // (من غير الوحدات المجانية أصلاً) كان بياخد خصم getQty كأنها موجودة، فعليًا
    // بيدفع أقل بكتير من العرض الحقيقي (مثال: "اشتري 2 خد 1" مع 2 بس في السلة
    // كان بيدي خصم كأنه "اشتري 1 خد 1" — خصم أكبر من المُعلَن).
    const allMatch = (promo.items||[]).every(bi => {
      const ci = cart.find(c => c.code === bi.code);
      return ci && ci.qty >= (promo.buyQty || 1) + (promo.getQty || 1);
    });
    if (!allMatch) return 0;
    return (promo.items||[]).reduce((s,bi) => {
      const ci = cart.find(c => c.code === bi.code);
      return s + (ci ? ci.price * (promo.getQty||1) : 0);
    }, 0);
  }
  return 0;
}

function detectEligiblePromos() {
  const sub = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const applied = new Set((cart._appliedPromos || []).map(p => p.id));
  return getPromos().filter(promo => {
    if (!promo.active) return false;
    if (applied.has(promo.id)) return false;
    // date range check
    const today = todayKey();
    if (promo.startDate && today < promo.startDate) return false;
    if (promo.endDate   && today > promo.endDate)   return false;
    if (promo.type === 'bundle') {
      return (promo.items || []).every(bi => {
        const ci = cart.find(c => c.code === bi.code);
        return ci && ci.qty >= bi.minQty;
      });
    }
    if (promo.type === 'threshold') return sub >= promo.minAmount;
    if (promo.type === 'category')  return cart.some(i => (i.category||i.name||'').toLowerCase().includes((promo.categoryName||'').toLowerCase()));
    if (promo.type === 'bxgy') {
      // شوف نفس الملاحظة في calcPromoDiscount — لازم buyQty+getQty مش buyQty بس.
      return (promo.items||[]).every(bi => {
        const ci = cart.find(c => c.code === bi.code);
        return ci && ci.qty >= (promo.buyQty||1) + (promo.getQty||1);
      });
    }
    return false;
  });
}

function applyPromo(id) {
  // مقارنة نصية زي removeAppliedPromo: الـ id بييجي من onclick كنص دايماً
  // بينما المحفوظ رقم (Date.now())، فالمقارنة الصارمة كانت هتفشل. كان الـ
  // onclick قبل كده بيمرّر الرقم من غير تنصيص — شغال بالصدفة طالما كل الـ
  // ids أرقام، وبيموت صامت لأول id نصي.
  const promo = getPromos().find(p => String(p.id) === String(id)); if (!promo) return;
  const discAmt = calcPromoDiscount(promo);
  if (discAmt <= 0) { showToast('هذا العرض لا يوفر خصماً على الفاتورة الحالية'); return; }
  if (!cart._appliedPromos) cart._appliedPromos = [];
  cart._appliedPromos.push({ id: promo.id, name: promo.name, discAmt });
  updateCartUI();
}

function removeAppliedPromo(id) {
  if (!cart._appliedPromos) return;
  cart._appliedPromos = cart._appliedPromos.filter(p => String(p.id) !== String(id));
  updateCartUI();
}

function renderEligiblePromos() {
  const el = document.getElementById('promoEligibleSection'); if (!el) return;
  if (!cart.length) { el.innerHTML = ''; return; }
  const eligible = detectEligiblePromos();
  if (!eligible.length) { el.innerHTML = ''; return; }
  el.innerHTML = eligible.map(promo => {
    const disc = calcPromoDiscount(promo);
    const badge = promo.type === 'bundle' ? '📦' : '💰';
    return `<div style="background:#faf5ff; border:1px dashed #7c3aed; border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
        <span>${badge} <strong>${escHtml(promo.name)}</strong> — وفر ${fmt(disc)} ج</span>
        <button class="btn btn-sm btn-primary" style="padding:3px 10px; font-size:11px;" onclick="applyPromo('${escJsAttr(promo.id)}')">تطبيق</button>
      </div>
    </div>`;
  }).join('');
}

