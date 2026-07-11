// ══════════════════════════════════════════════
// CASHIER – PRODUCTS
// ══════════════════════════════════════════════
function renderProducts() {
  // Block POS sales from warehouse
  if (currentBranch === 'wh') {
    const grid = document.getElementById('productsGrid');
    if (grid) {
      grid.innerHTML = '';
      var msg = document.createElement('div');
      msg.style.cssText = 'grid-column:1/-1;text-align:center;padding:60px 20px;';
      msg.innerHTML = '<div style="font-size:48px;">🏭</div><h3 style="font-size:18px;font-weight:700;margin:12px 0 6px;">المخزن الرئيسي</h3><p style="color:var(--text-muted);font-size:14px;">لا يمكن البيع من المخزن الرئيسي<br>الرجاء التحويل لأحد الفروع أولاً</p>';
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.style.marginTop = '16px';
      btn.textContent = '🏭 الذهاب للمخزن';
      btn.onclick = function(){ showPage('warehouse'); };
      msg.appendChild(btn);
      grid.appendChild(msg);
    }
    return;
  }
  const q = document.getElementById('productSearch').value.trim().toLowerCase();
  const inv = getInv();
  const items = q ? inv.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) : inv;
  const grid = document.getElementById('productsGrid');
  if (!items.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted);">' +
      (inv.length ? 'لم يُعثر على نتائج' : '📦 لا توجد منتجات — استورد ملف Excel من لوحة الإدارة') + '</div>';
    return;
  }
  grid.innerHTML = items.map(p => {
    const oos = p.qty <= 0;
    return `<div class="product-card ${oos ? 'out-of-stock' : ''}" onclick="${oos ? '' : `addToCart('${escJsAttr(p.code)}')`}">
      <div class="product-code">${escHtml(p.code)}</div>
      <div class="product-name">${escHtml(p.name)}</div>
      <div class="product-price">${fmt(p.priceAfter)} ج</div>
      ${p.priceBefore > p.priceAfter && p.priceBefore ? `<div class="product-old-price">${fmt(p.priceBefore)}</div>` : ''}
      <div class="product-stock">${oos ? '❌ نفد' : `📦 ${p.qty}`}</div>
    </div>`;
  }).join('');
}

function handleSearchKey(e) {
  if (e.key !== 'Enter') return;
  const q = document.getElementById('productSearch').value.trim();
  const inv = getInv();
  const found = inv.find(p => p.code.toLowerCase() === q.toLowerCase());
  if (found && found.qty > 0) {
    addToCart(found.code);
    document.getElementById('productSearch').value = '';
    renderProducts();
  }
}

