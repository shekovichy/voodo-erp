// ══════════════════════════════════════════════════════════════════
// نصوص الردود بالعربي — مفصولة عن منطق البحث عشان تتعدّل بسهولة
// من غير ما تلمس أي كود شغّال.
// ══════════════════════════════════════════════════════════════════
// نفس أسلوب src/js/05-utils.js fmt() بالظبط — أرقام لاتينية بفواصل الآلاف،
// مش أرقام هندية (اللي toLocaleString('ar-EG') كانت بترجعها بشكل مختلف عن
// أي رقم تاني العميل شايفه في فاتورته أو ملصق السعر).
function fmt(n) {
  return (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function welcomeReply() {
  return 'أهلاً بيك في VOODO 👋\nابعتلنا اسم المنتج أو الكود وهنقوللك السعر والتوفر.';
}

function noMatchReply(query) {
  return `مقدرناش نلاقي "${query}" في الكتالوج.\nتقدر تبعت اسم المنتج بشكل تاني، أو كوده لو عندك.`;
}

function tooManyMatchesReply(query, matches) {
  const lines = matches.map(p => `• ${p.name} (${p.code})`).join('\n');
  return `لقينا أكتر من منتج بيتطابق مع "${query}":\n${lines}\n\nابعت الكود بالظبط عشان نقوللك السعر.`;
}

function singleMatchReply(product, threshold, availabilityLabel) {
  const status = availabilityLabel(product.totalQty, threshold);
  const priceLine = product.priceAfter != null
    ? `💰 السعر: ${fmt(product.priceAfter)} ج`
    : '💰 السعر: غير محدد حالياً';
  return `🔹 ${product.name}\n${priceLine}\n📦 التوفر: ${status}`;
}

module.exports = { welcomeReply, noMatchReply, tooManyMatchesReply, singleMatchReply, fmt };
