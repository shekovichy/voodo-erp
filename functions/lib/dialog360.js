// ══════════════════════════════════════════════════════════════════
// إرسال رسالة عن طريق 360dialog
//
// ⚠️ الشكل هنا مبني على توافق 360dialog المعلن مع WhatsApp Cloud API
// (endpoint + شكل الطلب). لسه محتاج تأكيد من لوحة تحكم 360dialog
// الفعلية بتاعتك وقت الربط الحقيقي — الـ base URL أو شكل الرد ممكن
// يختلف حسب نوع الحساب (Sandbox مقابل حساب حقيقي معتمد من Meta).
// اربط API key بس بعد ما تتأكد من الشكل ده في التوثيق الرسمي.
// ══════════════════════════════════════════════════════════════════
const BASE_URL = process.env.DIALOG360_BASE_URL || 'https://waba-v2.360dialog.io';

async function sendWhatsAppText(apiKey, toPhone, body) {
  const res = await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'D360-API-KEY': apiKey,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`360dialog send failed: ${res.status} ${errText}`);
  }
  return res.json();
}

// شكل الـ webhook الوارد (بيفترض توافق Cloud API القياسي — تأكيد لازم
// وقت الربط الحقيقي، نفس الملاحظة فوق).
function parseIncomingMessage(body) {
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || msg.type !== 'text') return null;
    return {
      from: msg.from,                       // رقم المرسل — متحقق منه من واتساب نفسه، مش نص في الرسالة
      text: msg.text?.body || '',
      waMessageId: msg.id,
      contactName: value?.contacts?.[0]?.profile?.name || '',
    };
  } catch (e) {
    console.error('[dialog360] فشل تحليل الرسالة الواردة:', e);
    return null;
  }
}

module.exports = { sendWhatsAppText, parseIncomingMessage };
