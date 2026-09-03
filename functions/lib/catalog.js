// ══════════════════════════════════════════════════════════════════
// كتالوج المنتجات — بحث بدون AI خالص لمرحلة 1
//
// مصدر الحقيقة لقايمة الفروع هو نفسه اللي التطبيق بيستخدمه:
// pos_data/settings.branches (map: branchId -> اسم الفرع). مفيش قايمة
// ثابتة هنا عن قصد — لو الأدمن ضاف فرع جديد من التطبيق، البوت بيشوفه
// تلقائي من غير أي تعديل كود (نفس منطق _syncExtraBranchIds في
// src/js/00-core.js، بس هنا بنقرا من السحابة مباشرة بدل localStorage).
//
// السعر: لو نفس الكود له priceAfter مختلف بين الفروع (مش المفروض
// يحصل، بس مفيش ضمان في الداتا الحالية)، بناخد أول قيمة نلاقيها
// ونسجّل تحذير في اللوج — عشان صاحب المحل ياخد باله لو فيه تضارب
// أسعار حقيقي بين الفروع، بدل ما نخفيه.
// ══════════════════════════════════════════════════════════════════
const admin = require('firebase-admin');

async function loadCatalog() {
  const db = admin.firestore();

  const settingsSnap = await db.collection('pos_data').doc('settings').get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const branches = settings.branches || {};
  const branchIds = Object.keys(branches);
  const threshold = Number(settings.threshold) || 5;

  if (!branchIds.length) {
    console.warn('[catalog] pos_data/settings.branches فاضية — مفيش فروع نقرا مخزونها');
    return { products: new Map(), threshold };
  }

  const invDocs = await Promise.all(
    branchIds.map(b => db.collection('pos_data').doc('inventory').collection('branches').doc(b).get())
  );

  const products = new Map();   // code (lowercase) -> { code, name, category, family, priceAfter, priceBefore, totalQty }
  invDocs.forEach((snap, i) => {
    if (!snap.exists) return;
    const items = snap.data().items || [];
    items.forEach(it => {
      if (!it.code) return;
      const key = String(it.code).trim().toLowerCase();
      const qty = parseInt(it.qty, 10) || 0;
      const existing = products.get(key);
      if (!existing) {
        products.set(key, {
          code: it.code, name: it.name || it.code,
          category: it.category || '', family: it.family || '',
          priceAfter: it.priceAfter, priceBefore: it.priceBefore,
          totalQty: qty,
        });
      } else {
        existing.totalQty += qty;
        if (it.priceAfter != null && existing.priceAfter != null &&
            Number(it.priceAfter) !== Number(existing.priceAfter)) {
          console.warn(`[catalog] تضارب سعر لنفس الكود "${it.code}": ${existing.priceAfter} vs ${it.priceAfter} (فرع ${branchIds[i]})`);
        }
      }
    });
  });

  return { products, threshold };
}

function availabilityLabel(totalQty, threshold) {
  if (totalQty <= 0) return 'غير متوفر حالياً';
  if (totalQty <= threshold) return 'الكمية محدودة';
  return 'متوفر';
}

// بحث بسيط: تطابق تام على الكود الأول، وبعدين تطابق جزئي على الاسم.
// من غير AI عن قصد — مرحلة 1 بتغطي استفسار سعر/توفر مباشر بس.
function searchCatalog(catalog, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return [];

  const byCode = catalog.products.get(q);
  if (byCode) return [byCode];

  const matches = [];
  for (const p of catalog.products.values()) {
    if (p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) {
      matches.push(p);
      if (matches.length >= 5) break;   // كفاية عشان الرد ميطولش أوي في واتساب
    }
  }
  return matches;
}

module.exports = { loadCatalog, searchCatalog, availabilityLabel };
