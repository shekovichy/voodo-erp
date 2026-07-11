// ══════════════════════════════════════════════
// #1 CRM — CUSTOMERS
// ══════════════════════════════════════════════
let _customersCache = [];
let _promoCache     = [];
const getCustomers = () => _customersCache;

function setCustomers(list) {
  _customersCache = list;
  if (!_fbReady) { DB.s('pos_customers', list); return; }
  _db.collection('pos_data').doc('customers')
     .set({ items: list, updatedAt: Date.now() })
     .catch(e => console.error('Firestore setCustomers:', e));
}

function renderCustomers() {
  const q = (document.getElementById('custSearch')?.value || '').toLowerCase();
  const custs = getCustomers();
  const thresh = _settingsCache.vipThreshold || 1000;
  const items = q ? custs.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)) : custs;

  const vipCount   = custs.filter(c => (c.totalSpent||0) >= 5000).length;
  const totalSpent = custs.reduce((s,c) => s + (c.totalSpent||0), 0);
  const totalPts   = custs.reduce((s,c) => s + (c.loyaltyPoints||0), 0);
  const countEl = document.getElementById('cust-count'); if (countEl) countEl.textContent = custs.length;
  const vipEl   = document.getElementById('cust-vip');   if (vipEl)   vipEl.textContent   = vipCount;
  const spentEl = document.getElementById('cust-spent'); if (spentEl) spentEl.textContent = fmt(totalSpent)+' ج';
  const ptsEl   = document.getElementById('cust-pts');   if (ptsEl)   ptsEl.textContent   = totalPts+' نقطة';

  const tbody = document.getElementById('customersBody'); if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:40px;">لا يوجد عملاء — أضف عميلاً جديداً</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(c => {
    const spent = c.totalSpent || 0;
    const pts   = c.loyaltyPoints || 0;
    let tier, tierColor, tierBg;
    if (spent >= 20000)      { tier='💎 بلاتيني'; tierColor='#4c1d95'; tierBg='#ede9fe'; }
    else if (spent >= 5000)  { tier='🥇 ذهبي';   tierColor='#78350f'; tierBg='#fef3c7'; }
    else if (spent >= 1000)  { tier='🥈 فضي';    tierColor='#1e3a5f'; tierBg='#dbeafe'; }
    else                     { tier='🥉 برونزي';  tierColor='#4b3320'; tierBg='#fde8d0'; }
    return `<tr>
      <td><strong style="cursor:pointer;color:var(--primary);" onclick="openCustomerProfile('${escJsAttr(c.id)}')">${escHtml(c.name)}</strong></td>
      <td>${escHtml(c.phone)||'-'}</td>
      <td>${c.visits||0}</td>
      <td>${fmt(spent)} ج</td>
      <td><span style="font-weight:700;color:#059669;">${pts} نقطة</span></td>
      <td><span style="background:${tierBg};color:${tierColor};padding:2px 8px;border-radius:20px;font-size:11px;">${tier}</span></td>
      <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString('ar-EG') : '-'}</td>
      <td>
        <button class="btn btn-sm" style="background:#e0f2fe;color:#0369a1;" onclick="openCustomerProfile('${escJsAttr(c.id)}')" title="الملف الكامل">👁️</button>
        <button class="btn btn-gray btn-sm" onclick="openCustomerModal('${escJsAttr(c.id)}')" style="margin:0 3px;">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${escJsAttr(c.id)}')">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function openCustomerModal(id) {
  const c = id ? getCustomers().find(x => x.id === id) : null;
  document.getElementById('custModalTitle').textContent = c ? 'تعديل عميل' : 'إضافة عميل جديد';
  document.getElementById('custEditId').value  = c ? c.id   : '';
  document.getElementById('cust-name').value   = c ? c.name : '';
  document.getElementById('cust-phone').value  = c ? (c.phone||'')  : '';
  document.getElementById('cust-notes').value  = c ? (c.notes||'')  : '';
  document.getElementById('customerModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('cust-name').focus(), 100);
}

function saveCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  if (!name) { alert('الاسم مطلوب'); return; }
  const editId = document.getElementById('custEditId').value;
  const list   = getCustomers();
  if (editId) {
    const c = list.find(x => x.id === editId);
    if (c) {
      c.name  = name;
      c.phone = document.getElementById('cust-phone').value.trim();
      c.notes = document.getElementById('cust-notes').value.trim();
    }
  } else {
    list.push({
      id:         'C' + Date.now().toString(36).toUpperCase().slice(-8),
      name,
      phone:      document.getElementById('cust-phone').value.trim(),
      notes:      document.getElementById('cust-notes').value.trim(),
      createdAt:  new Date().toISOString(),
      totalSpent: 0,
      visits:     0
    });
  }
  setCustomers(list);
  document.getElementById('customerModal').classList.add('hidden');
  renderCustomers();
}

function deleteCustomer(id) {
  if (!confirm('حذف هذا العميل؟')) return;
  setCustomers(getCustomers().filter(c => c.id !== id));
  renderCustomers();
}

function openCustomerProfile(id) {
  const c = getCustomers().find(x => x.id === id);
  if (!c) return;
  const allSales = getSales().filter(s => !s.isReturn && (s.customerId === id || s.customerPhone === c.phone));
  const spent  = allSales.reduce((a,s) => a+s.total, 0);
  const visits = allSales.length;
  const pts    = c.loyaltyPoints || 0;
  const loyDisc = calcLoyaltyRedemption(pts);

  // tier
  let tier, tierColor, tierBg;
  if (spent >= 20000)      { tier='💎 بلاتيني'; tierColor='#4c1d95'; tierBg='#ede9fe'; }
  else if (spent >= 5000)  { tier='🥇 ذهبي';   tierColor='#78350f'; tierBg='#fef3c7'; }
  else if (spent >= 1000)  { tier='🥈 فضي';    tierColor='#1e3a5f'; tierBg='#dbeafe'; }
  else                     { tier='🥉 برونزي';  tierColor='#4b3320'; tierBg='#fde8d0'; }

  // top products
  const prodMap = {};
  allSales.forEach(s => (s.items||[]).forEach(i => {
    prodMap[i.name] = (prodMap[i.name]||0) + i.qty;
  }));
  const topProds = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const lastSale = allSales.sort((a,b)=>b.id-a.id)[0];

  const el = document.getElementById('custProfileModal');
  document.getElementById('cpBody').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
      <div style="width:54px;height:54px;border-radius:50%;background:#1a5faf;color:white;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0;">
        ${escHtml(c.name.charAt(0).toUpperCase())}
      </div>
      <div>
        <div style="font-size:18px;font-weight:700;">${escHtml(c.name)}</div>
        <div style="font-size:13px;color:var(--text-muted);">${escHtml(c.phone)||'لا يوجد هاتف'}</div>
        <span style="background:${tierBg};color:${tierColor};padding:2px 10px;border-radius:20px;font-size:12px;margin-top:4px;display:inline-block;">${tier}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      ${[
        {label:'إجمالي الإنفاق', val:fmt(spent)+' ج', bg:'#dcfce7', tc:'#15803d'},
        {label:'عدد الزيارات',   val:visits,           bg:'#eff6ff', tc:'#1d4ed8'},
        {label:'نقاط الولاء',    val:pts+' نقطة',      bg:'#fef9c3', tc:'#854d0e'},
        {label:'قيمة النقاط',    val:fmt(loyDisc)+' ج',bg:'#fce7f3', tc:'#9d174d'},
      ].map(k=>`<div style="background:${k.bg};border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:16px;font-weight:700;color:${k.tc};">${k.val}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${k.label}</div>
      </div>`).join('')}
    </div>

    ${topProds.length ? `
    <div style="background:var(--bg-secondary);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🏆 أكثر المنتجات شراءً</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${topProds.map(([name,qty],i)=>`<span style="background:white;border:1px solid var(--border);border-radius:20px;padding:3px 10px;font-size:12px;">${i+1}. ${escHtml(name)} <strong style="color:var(--primary);">×${qty}</strong></span>`).join('')}
      </div>
    </div>` : ''}

    ${c.notes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;">📝 ${escHtml(c.notes)}</div>` : ''}

    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🧾 آخر الفواتير</div>
    <div style="max-height:220px;overflow-y:auto;">
      ${allSales.slice(0,20).map(s=>{
        const d = new Date(s.date).toLocaleDateString('ar-EG');
        const t = new Date(s.date).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
        const preview = (s.items||[]).slice(0,2).map(i=>escHtml(i.name)).join('، ');
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-radius:6px;background:var(--bg-secondary);margin-bottom:4px;gap:8px;">
          <div>
            <span style="font-size:12px;font-weight:700;color:var(--primary);">#${String(s.id).slice(-6)}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-inline-start:6px;">${d} ${t}</span>
            <div style="font-size:11px;color:var(--text-muted);">${preview}</div>
          </div>
          <span style="font-weight:700;font-size:13px;flex-shrink:0;">${fmt(s.total)} ج</span>
        </div>`;
      }).join('') || '<p style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد فواتير</p>'}
    </div>
  `;
  el.classList.remove('hidden');
}


// ── Customer search in payment modal ──
let _custDDTimer = null;
function searchCustomerDD() {
  clearTimeout(_custDDTimer);
  _custDDTimer = setTimeout(() => {
    const q  = (document.getElementById('payCustomerSearch')?.value||'').trim().toLowerCase();
    const dd = document.getElementById('customerDropdown');
    if (!dd) return;
    if (!q) { dd.classList.add('hidden'); dd.innerHTML=''; return; }
    const thresh  = _settingsCache.vipThreshold || 1000;
    const results = getCustomers().filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)
    ).slice(0, 6);
    if (!results.length) {
      dd.innerHTML = '<div class="customer-dd-item" style="color:var(--text-muted);">لا توجد نتائج</div>';
    } else {
      dd.innerHTML = results.map(c =>
        `<div class="customer-dd-item" onclick="selectCustomer('${escJsAttr(c.id)}')">
          <strong>${escHtml(c.name)}</strong>${c.phone ? ' — ' + escHtml(c.phone) : ''}
          ${(c.totalSpent||0) >= thresh ? ' <span class="vip-badge" style="font-size:9px;padding:1px 5px;">VIP</span>' : ''}
        </div>`
      ).join('');
    }
    dd.classList.remove('hidden');
  }, 200);
}

function selectCustomer(id) {
  const c = getCustomers().find(x => x.id === id); if (!c) return;
  document.getElementById('selectedCustomerId').value      = id;
  document.getElementById('selectedCustomerName').textContent = c.name + (c.phone ? ' — '+c.phone : '');
  document.getElementById('selectedCustomerBox').classList.remove('hidden');
  document.getElementById('payCustomerSearch').value = '';
  document.getElementById('customerDropdown').classList.add('hidden');
}

function clearSelectedCustomer() {
  document.getElementById('selectedCustomerId').value = '';
  document.getElementById('selectedCustomerBox')?.classList.add('hidden');
  document.getElementById('payCustomerSearch').value = '';
}

function updateCustomerAfterSale(customerId, amount) {
  if (!customerId) return;
  const list = getCustomers();
  const c    = list.find(x => x.id === customerId); if (!c) return;
  c.totalSpent = (c.totalSpent||0) + amount;
  c.visits     = (c.visits||0)     + 1;
  c.lastVisit  = new Date().toISOString();
  setCustomers(list);
}

