# VOODO ERP — CLAUDE.md

## 🔐 الأمان والأدوار (v2 — Firebase Auth حقيقي)
النظام اتنقل من الباسوردات المحلية (localStorage) لـ **Firebase Authentication** (email/password) + مجموعة `roles/{uid}` في Firestore:
- **الدخول**: اليوزرنيم بيتحول لإيميل داخلي (`branch1@voodo-pos.local`) — شوف `usernameToEmail()` في `65-firebase.js`. الإيميل `shekovichy@gmail.com` هو الـ **owner** — أدمن دايماً حتى من غير role doc (hardcoded في الكود وفي `firestore.rules`).
- **الأدوار**: `roles/{uid} = { username, email, role: admin|manager|cashier, branchId }` — الأدمن بيديرها من "إدارة المستخدمين" (بتنشئ حساب Firebase حقيقي عبر secondary app + role doc). حذف المستخدم = حذف الـ role doc (بيسحب كل الصلاحيات فوراً — حساب الـ Auth اليتيم مش خطر).
- **الإنفاذ الحقيقي في `firestore.rules`**: مفيش role = مفيش وصول نهائياً. `settings` و`accounts` كتابة أدمن بس. `pos_data/auth` مقفول تماماً.
- **الدخول المحلي القديم** (`_legacyLogin` في `05-utils.js`) شغال **كـ fallback أوفلاين بس** — جلسة من غير Firebase token، القواعد بتمنعها من أي وصول سحابي.
- **قيد معروف**: الأدمن مش بيقدر يغيّر باسورد مستخدم تاني (محتاج Admin SDK) — المستخدم بيغيّر باسورده بنفسه من الإعدادات، أو الأدمن يحذف الحساب وينشئ واحد جديد باسم مختلف.

### ⚠️ خطوات تفعيل الأمان (مطلوبة مرة واحدة — بالترتيب ده بالظبط)
1. **حساب الـ owner**: `shekovichy@gmail.com` موجود بالفعل في Authentication → Users — لو الباسورد مش معروف اعمل Reset password من الـ Console (أو احذفه وأضفه تاني — آمن، الـ owner بيتعرف بالإيميل مش الـ uid). (Email/Password provider مفعّل بالفعل.)
2. انشر العميل الجديد على main واتأكد إن دخول الـ owner شغال.
3. انشر `firestore.rules` الجديدة (اختبرها في Rules Playground الأول — شوف قسم Firestore Rules تحت). الـ owner مش هيتأثر (معرّف بالإيميل). العملاء المجهولين القدام هيتقفلوا هنا — وده الهدف.
4. **بعد نشر القواعد بس**: أنشئ حسابات الموظفين من "إدارة المستخدمين" وسجّل دخول كل جهاز فرع — إنشاء الحسابات بيكتب في مجموعة `roles` والقواعد **القديمة** بترفض الكتابة فيها، فمينفعش قبل الخطوة 3. اعمل الخطوات 2→4 في نفس اليوم: في الفترة بينهم أجهزة الفروع بتشتغل محلي بس ومبيعاتها بتتحفظ على الجهاز (addSale بيحفظ محلياً لو الكتابة السحابية اترفضت).

## ⚠️ لا تقرأ أبداً
- `index.html` — مُولَّد تلقائياً بـ build.py (حجمه 500 KB+)
- `src/js/app.js` — placeholder فقط، الكود الحقيقي في الملفات المرقمة
- `src/js/app.js.bak` — نسخة احتياطية

## Build
```
cd C:\Projects\voodo-erp
python build.py        # يولّد index.html من src/ + chunk-*.js
git add -A && git commit -m "..." && git push
```
GitHub Actions تنشر تلقائياً على https://shekovichy.github.io/voodo-erp/

### تحميل كسول (Lazy chunks)
4 صفحات مستقلة تماماً (`93-accounting.js`, `95-warehouse.js`, `105-manufacturing.js`, `75-purchases.js`) بتتبني كملفات `chunk-*.js` منفصلة بدل ما تتلزق جوه `index.html` — `showPage()` في `25-navigation.js` بيحمّلها ديناميكياً أول مرة المستخدم يدخل الصفحة (شوف `_loadChunk`/`_CHUNK_FILES` في `00-core.js`).

⚠️ **لو هتضيف ملف جديد للتحميل الكسول**: لازم تتأكد أولاً إن مفيش ملف "أساسي" (مش هو نفسه) بينادي على أي دالة فيه بشكل غير مشروط (يعني من غير `visRefresh`/فحص `!hidden` قبلها) — لأن ده هيبوّظ لو الملف لسه ماتحمّلش. افحص بـ:
```
grep -oE '^function [a-zA-Z0-9_]+|^const [a-zA-Z0-9_]+ = ' src/js/الملف.js
```
وبعدين دوّر على كل اسم دالة طلعلك في باقي ملفات `src/js/*.js` وشوف هل فيه نداء غير محمي عليه. لو لقيت، إما سيب الملف في الحزمة الأساسية، أو انقل بس الدالة/المتغيّر المشترك لملف `00-core.js`.

---

## ملفات المصدر

| الملف | المحتوى | السطور |
|-------|---------|--------|
| `src/template.html` | كل HTML + CSS | ~1500 |
| `src/js/00-core.js` | DB، BRANCH_IDS، cache variables | 116 |
| `src/js/05-utils.js` | fmt، showMsg، getDateRange، login/logout | 398 |
| `src/js/10-pos-products.js` | renderProducts، handleSearchKey | 55 |
| `src/js/15-pos-cart.js` | addToCart، renderCart، cartTotals | 124 |
| `src/js/20-pos-payment.js` | openPayment، completeSale، showReceipt | 134 |
| `src/js/25-navigation.js` | showPage | 47 |
| `src/js/30-dashboard.js` | buildDashboard، calcProfit | 223 |
| `src/js/35-inventory.js` | renderInventory، saveProduct، importExcel | 178 |
| `src/js/40-sales.js` | renderSales، viewSale | 82 |
| `src/js/45-reports.js` | buildSalesReport، buildInventoryReport، buildProfitReport | 302 |
| `src/js/50-kpi.js` | buildKPIReport | 83 |
| `src/js/52-sellers-report.js` | buildSellersReport | 59 |
| `src/js/55-lowstock.js` | updateLowStockBell، buildHeatmap، exportBackup | 206 |
| `src/js/60-settings.js` | saveSettings، renderBranchUsersSettings | 137 |
| `src/js/65-firebase.js` | initFirebase، Firebase listeners، suspend/cashier | 633 |
| `src/js/70-branches.js` | switchBranch، openTransferModal، getTransfers | 203 |
| `src/js/75-purchases.js` | suppliers، purchase orders، receive goods | 384 |
| `src/js/80-hr-targets.js` | HR targets، commission، buildSellersReport | 144 |
| `src/js/82-promotions.js` | promotions system | 310 |
| `src/js/85-crm.js` | CRM customers، loyalty points | 236 |
| `src/js/87-returns.js` | returns system | 122 |
| `src/js/88-abc-expenses.js` | ABC analysis، expense tracking، audit log، WhatsApp | 278 |
| `src/js/89-cashier-return.js` | openCashierReturn، processCashierReturn | 181 |
| `src/js/90-barcode.js` | barcodes، price tags، ESC/POS printer | 206 |
| `src/js/91-loyalty.js` | loyalty settings | 57 |
| `src/js/92-hr-attendance.js` | attendance، payroll، renderAttendancePane | 219 |
| `src/js/93-accounting.js` | P&L، cash flow، accounting page | 186 |
| `src/js/94-vlookup.js` | VLOOKUP reports، category reports | 346 |
| `src/js/95-warehouse.js` | warehouse page، warehouse transfers | 207 |
| `src/js/96-approvals.js` | price-change approvals، suspended tabs | 339 |
| `src/js/97-expense-requests.js` | expense approval requests | 99 |
| `src/js/98-leave-requests.js` | leave & permission requests | 120 |
| `src/js/100-home.js` | home page، renderHomeIcons، fingerprint import | 181 |
| `src/js/105-manufacturing.js` | التصنيع — raw materials، lines، orders، quality | 506 |

---

## خريطة الدوال الرئيسية

### للتعديل في كل فيتشر — اقرأ هذا الملف فقط:

| الفيتشر | الملف |
|---------|-------|
| كاشير / بيع | `20-pos-payment.js` + `15-pos-cart.js` |
| المخزون | `35-inventory.js` |
| الداشبورد | `30-dashboard.js` |
| Firebase / cloud | `65-firebase.js` |
| الفروع والتحويلات | `70-branches.js` |
| المشتريات والموردين | `75-purchases.js` |
| HR / رواتب / حضور | `80-hr-targets.js` + `92-hr-attendance.js` |
| التصنيع | `105-manufacturing.js` |
| التقارير | `45-reports.js` + `50-kpi.js` + `94-vlookup.js` |
| المحاسبة | `93-accounting.js` |
| الإعدادات | `60-settings.js` |
| CRM / العملاء | `85-crm.js` |
| طلبات الإجازات | `98-leave-requests.js` |
| طلبات المصاريف | `97-expense-requests.js` |
| اعتماد الأسعار | `96-approvals.js` |

---

## بعد أي تعديل

### تعديل كود (src/)
1. **اختبر محلياً الأول** — شغّل `dev.bat` (بيعمل build.py ويفتح المتصفح على `localhost:8765`). جرّب الفيتشر فعلياً قبل الدفع — ده بالظبط اللي كان ناقص لما حصلت مشكلة اختفاء المبيعات في 2026-07-11.
2. لو تمام: `python build.py` (لو لسه ماعملتوش) → `git add -A && git commit -m "وصف التغيير" && git push`
3. GitHub Actions تنشر على GitHub Pages خلال ~30 ثانية، وVercel بينشر تلقائي كمان.
4. لتجربة تغيير كبير قبل ما يوصل لـ main، ادفعه على فرع `staging` الأول (`git push origin HEAD:staging`) — لو Vercel مضبوط يعمل preview للفروع هيديك لينك منفصل تجرب عليه.

### تعديل Firestore Rules (`firestore.rules`)
⚠️ **ممنوع تنشر Rules جديدة على الـ Console مباشرة من غير تجربة.** في 2026-07-11 نشر Rules ناقصة (من غير قاعدة لـ `pos_sales`) قفل وصول المبيعات كلها في الإنتاج فجأة.
1. عدّل `firestore.rules` في الكود، اعمل commit وpush زي أي تعديل عادي (الملف مش جزء من build.py، بس لازم يفضل متزامن مع اللي منشور فعلاً).
2. **قبل الضغط على Publish في Firebase Console**: افتح تبويب Rules → **"Rules playground"** (موجودة تحت في نفس الصفحة) والصق القواعد الجديدة فيها، وجرّب محاكاة get/list على أهم المسارات (خصوصاً `pos_data/{doc}` و`pos_sales/{doc}`) وشوف النتيجة Allow ولا Deny قبل ما تنشر فعلياً.
3. بعد التأكد، انشر، وبعدها افتح التطبيق وتأكد إن البيانات بترجع تظهر.
