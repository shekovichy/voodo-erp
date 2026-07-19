// ══════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════
function addToCart(code) {
  const inv = getInv();
  const p = inv.find(x => x.code === code);
  if (!p || p.qty <= 0) return;
  const ex = cart.find(x => x.code === code);
  if (ex) {
    if (ex.qty >= p.qty) { showToast('لا يوجد مخزون كافٍ'); return; }
    ex.qty++;
  } else {
    cart.push({ code: p.code, name: p.name, price: p.priceAfter, cost: p.cost || 0, qty: 1 });
  }
  renderCart();
}

function changeQty(code, d) {
  const item = cart.find(x => x.code === code);
  if (!item) return;
  const inv = getInv();
  const p = inv.find(x => x.code === code);
  item.qty += d;
  if (item.qty <= 0) cart = cart.filter(x => x.code !== code);
  else if (p && item.qty > p.qty) { item.qty = p.qty; showToast('لا يوجد مخزون كافٍ'); }
  renderCart();
}

function removeFromCart(code) { cart = cart.filter(x => x.code !== code); renderCart(); }

function clearCart() {
  if (!cart.length) { _clearCartConfirmed(); return; }
  showConfirmModal('مسح الفاتورة؟', _clearCartConfirmed);
}
function _clearCartConfirmed() {
  cart = [];
  cart._adminDiscount = 0;
  cart._adminDiscountNote = '';
  cart._appliedPromos = [];
  document.getElementById('adminDiscountRow').classList.add('hidden');
  const aprEl = document.getElementById('promoAppliedRows'); if (aprEl) aprEl.innerHTML = '';
  const pesEl = document.getElementById('promoEligibleSection'); if (pesEl) pesEl.innerHTML = '';
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cartItems');
  if (!cart.length) { el.innerHTML = '<div class="cart-empty">أضف منتجات للفاتورة</div>'; updateCartUI(); return; }
  el.innerHTML = cart.map(i => {
    const modified = i.priceModified;
    const priceHtml = modified
      ? `<span style="text-decoration:line-through;color:#9ca3af;font-size:11px;">${fmt(i.originalPrice)} ج</span> <span style="color:#dc2626;font-weight:700;">${fmt(i.price)} ج</span> × ${i.qty}`
      : `${fmt(i.price)} ج × ${i.qty}`;
    return `<div class="cart-item ${modified?'cart-item-modified':''}">
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(i.name)}</div>
        <div class="cart-item-price">${priceHtml}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty('${escJsAttr(i.code)}',-1)">−</button>
        <span class="qty-num">${i.qty}</span>
        <button class="qty-btn" onclick="changeQty('${escJsAttr(i.code)}',1)">+</button>
      </div>
      <button onclick="editItemPrice('${escJsAttr(i.code)}')" class="cart-edit-price-btn ${modified?'is-modified':''}" title="تعديل السعر">✏️</button>
      <div class="item-total">${fmt(i.price*i.qty)}</div>
      <button class="delete-item" onclick="removeFromCart('${escJsAttr(i.code)}')">✕</button>
    </div>`;
  }).join('');
  updateCartUI();
}

function cartTotals() {
  const sub       = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const adminDisc = Math.min(Math.max(cart._adminDiscount || 0, 0), sub);
  const promoDisc = (cart._appliedPromos || []).reduce((s,p) => s + p.discAmt, 0);
  const totalDisc = Math.min(adminDisc + promoDisc, sub);
  return { sub, adminDisc, promoDisc, disc: totalDisc, total: sub - totalDisc };
}

function updateCartUI() {
  const { sub, adminDisc, promoDisc, total } = cartTotals();
  const count = cart.reduce((s,i) => s+i.qty, 0);
  document.getElementById('cartCount').textContent    = count;
  document.getElementById('cartSubtotal').textContent = fmt(sub) + ' ج';
  document.getElementById('cartTotal').textContent    = fmt(total) + ' ج';
  // Show/hide admin discount row
  const adRow = document.getElementById('adminDiscountRow');
  const adEl  = document.getElementById('cartAdminDiscountDisplay');
  if (adminDisc > 0 && adRow && adEl) {
    adRow.classList.remove('hidden');
    adEl.textContent = '-' + fmt(adminDisc) + ' ج';
  } else if (adRow) {
    adRow.classList.add('hidden');
  }
  // Render applied promo rows
  const aprEl = document.getElementById('promoAppliedRows');
  if (aprEl) {
    aprEl.innerHTML = (cart._appliedPromos || []).map(p => `
      <div class="cart-row cart-row-promo">
        <span style="display:flex; align-items:center; gap:4px;">
          🏷️ ${escHtml(p.name)}
          <button onclick="removeAppliedPromo('${escJsAttr(p.id)}')" class="promo-remove-btn" title="إزالة العرض">✕</button>
        </span>
        <span>-${fmt(p.discAmt)} ج</span>
      </div>`).join('');
  }
  // Render eligible (not yet applied) promos
  renderEligiblePromos();
  // Sync FAB badge
  const fc = document.getElementById('fabCount');
  if (fc) fc.textContent = count;
  // Change pay button if any prices modified
  const hasModified = cart.some(function(i){ return i.priceModified; });
  const payBtn = document.getElementById('cartPayBtn');
  if (payBtn) {
    if (hasModified) {
      payBtn.textContent = '📤 إرسال للموافقة';
      payBtn.style.background = '#d97706';
      payBtn.onclick = sendForApproval;
    } else {
      payBtn.textContent = '💳 دفع';
      payBtn.style.background = '';
      payBtn.onclick = openPayment;
    }
  }
}

