// ══════════════════════════════════════════════════════════════════
// VOODO WhatsApp Bot — مرحلة 1: أسعار وتوفر المنتجات، بدون AI
//
// سيرفر منفصل تماماً عن تطبيق الكاشير (src/) — نفس مشروع Firebase بس
// (nexus-2fec6)، عشان يقرا نفس مخزون الفروع مباشرة بصلاحيات Admin SDK
// (بتتخطى firestore.rules بالكامل — الأمان هنا مسؤولية الكود ده نفسه،
// مش القواعد). الفنكشن دي بتقرا بس، مفيش أي كتابة على أي بيانات حقيقية.
//
// ⚠️ قبل النشر:
//   1. فعّل خطة Blaze (pay-as-you-go) على مشروع Firebase — Cloud
//      Functions مش شغالة على الخطة المجانية Spark.
//   2. اضبط الأسرار (شوف تحت) بأمر:
//      firebase functions:secrets:set DIALOG360_API_KEY
//      firebase functions:secrets:set WEBHOOK_PATH_SECRET
//   3. سجّل رابط الـ webhook في لوحة تحكم 360dialog:
//      https://<region>-nexus-2fec6.cloudfunctions.net/whatsappWebhook/<WEBHOOK_PATH_SECRET>
//      (الرابط الحقيقي بيظهر في تيرمنال بعد أول deploy)
//   4. جرّب أول رسالة بسؤال بسيط زي اسم منتج موجود فعلاً في المخزون.
// ══════════════════════════════════════════════════════════════════
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const { loadCatalog, searchCatalog, availabilityLabel } = require('./lib/catalog');
const { welcomeReply, noMatchReply, tooManyMatchesReply, singleMatchReply } = require('./lib/replies');
const { sendWhatsAppText, parseIncomingMessage } = require('./lib/dialog360');

const DIALOG360_API_KEY   = defineSecret('DIALOG360_API_KEY');
const WEBHOOK_PATH_SECRET = defineSecret('WEBHOOK_PATH_SECRET');

// كلمات ترحيب بسيطة — بدون AI، تطابق حرفي كفاية لمرحلة 1
const GREETING_WORDS = ['السلام عليكم', 'مرحبا', 'اهلا', 'أهلا', 'هاي', 'hello', 'hi'];

exports.whatsappWebhook = onRequest(
  { secrets: [DIALOG360_API_KEY, WEBHOOK_PATH_SECRET], region: 'europe-west1' },
  async (req, res) => {
    // ── حماية المسار: لازم يكون آخر جزء من الرابط مطابق للسر ────────
    // ده الحاجز الأساسي هنا بدل التحقق من توقيع 360dialog (لسه محتاج
    // تأكيد شكله الفعلي — شوف الملاحظة في lib/dialog360.js). طول ما
    // السر ده معروف لـ360dialog بس، مفيش حد تاني يقدر ينادي الرابط ده.
    const pathSecret = req.path.replace(/^\/+/, '');
    if (pathSecret !== WEBHOOK_PATH_SECRET.value()) {
      logger.warn('webhook: مسار غلط أو سر مش مطابق', { path: req.path });
      res.status(404).send('Not found');
      return;
    }

    // ── مصافحة التحقق (Meta/360dialog webhook verification handshake) ──
    if (req.method === 'GET') {
      const challenge = req.query['hub.challenge'];
      if (challenge) { res.status(200).send(String(challenge)); return; }
      res.status(200).send('ok');
      return;
    }

    if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

    // نرد 200 بسرعة دايماً — مزوّدين الواتساب بيعيدوا المحاولة بعنف لو
    // ماجاوبناش 2xx بسرعة، وده ممكن يسبب ردود مكررة. أي خطأ داخلي
    // بيتسجل في اللوج مش بيتبعت للعميل كخطأ HTTP.
    res.status(200).send('ok');

    try {
      const incoming = parseIncomingMessage(req.body);
      if (!incoming || !incoming.text) {
        logger.info('webhook: مفيش رسالة نصية قابلة للمعالجة', { body: req.body });
        return;
      }

      logger.info('رسالة واردة', { from: incoming.from, text: incoming.text });

      const text = incoming.text.trim();
      let reply;

      if (GREETING_WORDS.some(w => text.toLowerCase().includes(w.toLowerCase()))) {
        reply = welcomeReply();
      } else {
        const catalog = await loadCatalog();
        const matches = searchCatalog(catalog, text);
        if (matches.length === 0)      reply = noMatchReply(text);
        else if (matches.length === 1) reply = singleMatchReply(matches[0], catalog.threshold, availabilityLabel);
        else                            reply = tooManyMatchesReply(text, matches);
      }

      await sendWhatsAppText(DIALOG360_API_KEY.value(), incoming.from, reply);
      logger.info('رد اتبعت', { to: incoming.from, reply });
    } catch (e) {
      // الخطأ بيتسجل بس — العميل مش المفروض يحس إن فيه مشكلة سيرفر داخلية،
      // والـ webhook خلاص رد 200 فمفيش إعادة محاولة من 360dialog.
      logger.error('webhook: خطأ أثناء معالجة الرسالة', e);
    }
  }
);
