// ══════════════════════════════════════════════
// LOYALTY PROGRAM
// ══════════════════════════════════════════════
let _loyaltyCache = null;

function getLoyalty() {
  if (!_loyaltyCache) {
    const stored = DB.g('pos_loyalty');
    _loyaltyCache = stored || { pointsPerEGP: 10, pointValue: 0.5, enabled: true };
  }
  return _loyaltyCache;
}

function setLoyalty(cfg) {
  _loyaltyCache = cfg;
  DB.s('pos_loyalty', cfg);
  try { _db && _db.collection('pos_data').doc('loyalty').set({ cfg, updatedAt: Date.now() }); } catch(e) {}
}

// Award points to customer after sale
function awardLoyaltyPoints(customerId, saleTotal) {
  const cfg = getLoyalty();
  if (!cfg.enabled || !customerId) return;
  const pts = Math.floor(saleTotal / cfg.pointsPerEGP);
  if (pts <= 0) return;
  const list = getCustomers();
  const c = list.find(x => x.id === customerId);
  if (!c) return;
  c.loyaltyPoints = (c.loyaltyPoints || 0) + pts;
  setCustomers(list);
}

// Redeem points: returns discount amount in EGP
function calcLoyaltyRedemption(points) {
  return points * getLoyalty().pointValue;
}

// Cart loyalty redemption state
let _cartLoyaltyRedeem = 0;

function openLoyaltySettings() {
  const cfg = getLoyalty();
  document.getElementById('loyPtsPerEGP').value  = cfg.pointsPerEGP;
  document.getElementById('loyPointValue').value = cfg.pointValue;
  document.getElementById('loyEnabled').checked  = cfg.enabled;
  document.getElementById('loyaltySettingsModal').classList.remove('hidden');
}

function saveLoyaltySettings() {
  setLoyalty({
    pointsPerEGP: parseFloat(document.getElementById('loyPtsPerEGP').value) || 10,
    pointValue:   parseFloat(document.getElementById('loyPointValue').value) || 0.5,
    enabled: document.getElementById('loyEnabled').checked
  });
  document.getElementById('loyaltySettingsModal').classList.add('hidden');
  showToast('تم حفظ إعدادات الولاء ✓');
}
