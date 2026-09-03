# VOODO WhatsApp Bot — مرحلة 1

رد تلقائي بدون AI: سؤال عن منتج → رد بالسعر والتوفر. سيرفر منفصل تماماً
عن `src/` (تطبيق الكاشير)، بس بيقرا من نفس مشروع Firebase (`nexus-2fec6`).

## قبل أول نشر

1. **فعّل خطة Blaze** على مشروع Firebase — Cloud Functions مش شغالة على
   الخطة المجانية. (Console → Usage & billing → Modify plan.)
2. **اضبط السرّين** (من جذر المشروع، مش من `functions/`):
   ```
   firebase functions:secrets:set DIALOG360_API_KEY
   firebase functions:secrets:set WEBHOOK_PATH_SECRET
   ```
   لـ `WEBHOOK_PATH_SECRET` — ولّد نص عشوائي طويل بنفسك (مش باسورد
   تتذكره، ده جزء من الرابط اللي بيمنع أي حد غير 360dialog ينادي
   الفنكشن). أي أداة توليد UUID كفاية.
3. **انشر**:
   ```
   npm --prefix functions install
   firebase deploy --only functions
   ```
   هيديك رابط شكله:
   `https://europe-west1-nexus-2fec6.cloudfunctions.net/whatsappWebhook`
4. **سجّل الرابط في لوحة تحكم 360dialog** بعد ما تضيف السر في الآخر:
   `.../whatsappWebhook/<WEBHOOK_PATH_SECRET اللي اخترته>`

## ⚠️ حاجات لسه محتاجة تأكيد من توثيق 360dialog الفعلي وقت الربط

- شكل الـ webhook الوارد وطريقة الإرسال (`lib/dialog360.js`) مبنيين على
  توافق 360dialog المعلن مع WhatsApp Cloud API — مش مجرّبين ضد حساب
  حقيقي لسه.
- لو 360dialog بتوفر توقيع تحقق (HMAC signature) على الـ webhook،
  يستاهل يتضاف فوق حماية `WEBHOOK_PATH_SECRET` الحالية، مش بدالها.

## حدود مرحلة 1 (مقصودة)

- مفيش تفريق بين الفروع في الرد — بيجمع الكمية من كل الفروع.
- مفيش حماية من رسالة مكررة لو 360dialog أعادت إرسال نفس الـ webhook
  (نادر، بس وارد لو الشبكة اتقطعت وقت الرد).
- مفيش تسجيل في Firestore للمحادثات لسه — اللوج في Cloud Logging بس
  (`firebase functions:log`). هيتضاف لو احتجنا شاشة مراجعة من التطبيق.
- استفسار حالة الفاتورة والشات الحر (Claude API) مش هنا — مرحلة 2 و3.

## التجربة محلياً قبل النشر

```
firebase emulators:start --only functions,firestore
```
وابعت طلب POST يدوي لمحاكاة رسالة واردة (شوف شكلها في
`lib/dialog360.js` — `parseIncomingMessage`).
