# VOODO ERP — CLAUDE.md

## 📋 قايمة الفيتشرز
**[`FEATURES.md`](FEATURES.md) فيها قايمة كاملة بكل فيتشر في السيستم** (اسم + سطر وصف). ⚠️ **أي فيتشر جديد يتضاف للكود — لازم يتضاف سطر ليه في `FEATURES.md` في نفس الـ commit.**

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

## 🧪 الإنتاج مقابل التجربة (مهم)
فيه **قاعدة بيانات واحدة حية بس**، مفيش نسخة staging منها. قبل 2026-08-11 كان أي بناء شايل `projectId` بيكتب عليها — يعني فرع `staging` وبريفيوهات Vercel و`dev.bat` على `localhost` كلهم كانوا بيكتبوا على داتا الشغل الحقيقية، والحماية الوحيدة إنك تفتكر تفضّي `projectId` بإيدك قبل كل تجربة.

دلوقتي مواقع الإنتاج بقت قايمة صريحة في `65-firebase.js`:
```js
const PROD_HOSTS = ['voodo-erp.vercel.app', 'shekovichy.github.io'];
const IS_PROD = PROD_HOSTS.includes(location.hostname);
projectId: IS_PROD ? "nexus-2fec6" : ""
```
أي هوست تاني بيشتغل **محلي بالكامل** — `initFirebase()` بيرجع من غير ما ينشئ اتصال (`_db` بيفضل `null`)، وبيظهر تنبيه أحمر في الهيدر: **🧪 تجريبي — بيانات محلية**.

- **الدخول محلياً**: `dev` / `dev` (في `_legacyLogin` بـ `05-utils.js`، محمي بـ `!IS_PROD`). محتاجينه لأن `doLogin` بيتخطى Firebase Auth لما `projectId` فاضي، ومتصفح نضيف مالوش `users.admin` — من غير الحساب ده مش هتقدر تعدي شاشة الدخول أصلاً.
- ⚠️ **أي دومين إنتاج جديد لازم يتضاف لـ `PROD_HOSTS`** — جهاز فرع بيفتح من لينك مش في القايمة هيفضل يبيع عادي والمبيعات تتحفظ على الجهاز بس. التنبيه الأحمر هو الإشارة: لو ظهر على جهاز فرع حقيقي، يبقى القايمة ناقصة.
- الفروع بتفتح من `voodo-erp.vercel.app` وبعدين بيتسطب كـ PWA — الـ PWA بياخد الهوست من الأصل اللي اتسطب منه، فهو مغطى.

## ⚠️ لا تقرأ أبداً
- `index.html` — مُولَّد تلقائياً بـ build.py (حجمه 500 KB+)
- `src/js/app.js` — placeholder فقط، الكود الحقيقي في الملفات المرقمة
(ملف `app.js.bak` القديم اتحذف في 2026-07-17 — كان 7000 سطر ميت بيلوّث نتايج البحث؛ موجود في تاريخ git لو اتاحتجت)

## Build
```
cd C:\Projects\voodo-erp
python build.py        # يولّد index.html من src/ + chunk-*.js
python audit.py        # فاحص التناسق — لازم يعدي قبل أي push
git add -A && git commit -m "..." && git push
```
GitHub Actions تنشر تلقائياً على https://shekovichy.github.io/voodo-erp/

### تحميل كسول (Lazy chunks)
7 صفحات مستقلة تماماً بتتبني كملفات `chunk-*.js` منفصلة بدل ما تتلزق جوه `index.html` — `showPage()` في `25-navigation.js` بيحمّلها ديناميكياً أول مرة المستخدم يدخل الصفحة (شوف `_loadChunk`/`_CHUNK_FILES` في `00-core.js`). القايمة الرسمية في `LAZY_CHUNKS` جوه `build.py`:

| الملف | الشنك |
|-------|-------|
| `93-accounting.js` | `chunk-accounting.js` |
| `95-warehouse.js` | `chunk-warehouse.js` |
| `75-purchases.js` | `chunk-purchases.js` |
| `110-helpdesk.js` | `chunk-helpdesk.js` |
| `115-pivot-reports.js` | `chunk-pivot.js` |
| `120-data-migration.js` | `chunk-migration.js` |
| `125-strategic-analytics.js` | `chunk-analytics.js` |

⚠️ الشنكات دي **مش** جوه `index.html`، فلازم تتبني ويتعملها commit لوحدها. في 2026-08-01 اتعملت 3 إصلاحات في `93-accounting.js` واتعمل commit لـ `index.html` بس — الإصلاحات فضلت في الريبو من غير ما توصل للتطبيق أصلاً. `audit.py` بيمسك الحالة دي دلوقتي.

⚠️ **لو هتضيف ملف جديد للتحميل الكسول**: لازم تتأكد أولاً إن مفيش ملف "أساسي" (مش هو نفسه) بينادي على أي دالة فيه بشكل غير مشروط (يعني من غير `visRefresh`/فحص `!hidden` قبلها) — لأن ده هيبوّظ لو الملف لسه ماتحمّلش. افحص بـ:
```
grep -oE '^function [a-zA-Z0-9_]+|^const [a-zA-Z0-9_]+ = ' src/js/الملف.js
```
وبعدين دوّر على كل اسم دالة طلعلك في باقي ملفات `src/js/*.js` وشوف هل فيه نداء غير محمي عليه. لو لقيت، إما سيب الملف في الحزمة الأساسية، أو انقل بس الدالة/المتغيّر المشترك لملف `00-core.js`.

---

## ملفات المصدر

⚠️ أرقام السطور دي بتقدم بسرعة. لو فرق كبير عن الواقع، حدّثها بـ:
`for f in src/js/*.js; do echo "$(basename $f) $(wc -l < $f)"; done`

| الملف | المحتوى | السطور |
|-------|---------|--------|
| `src/template.html` | كل HTML + CSS | 3007 |
| `src/js/00-core.js` | DB، BRANCH_IDS، cache variables، `_loadChunk`، `addSale` | 635 |
| `src/js/02-demo-cleanup.js` | تنظيف بيانات الديمو اللي تسربت للداتا الحقيقية (مرة واحدة) | 154 |
| `src/js/03-sales-migration.js` | ترحيل `pos_sales` من مسطح لمعزول بالفرع (مرة واحدة) | 123 |
| `src/js/04-inventory-migration.js` | ترحيل المخزون لعزل الفروع (مرة واحدة) | 104 |
| `src/js/05-utils.js` | fmt، showMsg، getDateRange، login/logout | 634 |
| `src/js/06-permissions-migration.js` | backfill لـ `roles/{uid}.permissions` (مرة واحدة، آمن التكرار) | 114 |
| `src/js/10-pos-products.js` | renderProducts، handleSearchKey | 55 |
| `src/js/15-pos-cart.js` | addToCart، renderCart، cartTotals | 134 |
| `src/js/20-pos-payment.js` | openPayment، completeSale، showReceipt | 266 |
| `src/js/25-navigation.js` | showPage | 98 |
| `src/js/30-dashboard.js` | buildDashboard، calcProfit | 263 |
| `src/js/35-inventory.js` | renderInventory، saveProduct، importExcel | 270 |
| `src/js/36-stocktake.js` | جرد المخزون — فرع كامل أو شيت مخصص، جلسة محفوظة | 239 |
| `src/js/40-sales.js` | renderSales، viewSale | 82 |
| `src/js/45-reports.js` | buildSalesReport، buildInventoryReport، buildProfitReport | 325 |
| `src/js/50-kpi.js` | buildKPIReport | 91 |
| `src/js/52-sellers-report.js` | buildSellersReport | 64 |
| `src/js/55-lowstock.js` | updateLowStockBell، buildHeatmap، exportBackup | 242 |
| `src/js/60-settings.js` | saveSettings، renderBranchUsersSettings، شجرة الصلاحيات | 612 |
| `src/js/65-firebase.js` | initFirebase، Firebase listeners، suspend/cashier | 1065 |
| `src/js/70-branches.js` | switchBranch، openTransferModal، getTransfers | 255 |
| `src/js/75-purchases.js` | suppliers، purchase orders، receive goods | 546 |
| `src/js/80-hr-targets.js` | HR targets، commission، الراتب الأساسي | 145 |
| `src/js/82-promotions.js` | promotions system | 330 |
| `src/js/85-crm.js` | CRM customers، loyalty points | 274 |
| `src/js/87-returns.js` | returns system | 153 |
| `src/js/88-abc-expenses.js` | ABC analysis، expense tracking، audit log، WhatsApp | 356 |
| `src/js/89-cashier-return.js` | openCashierReturn، processCashierReturn | 194 |
| `src/js/90-barcode.js` | barcodes، price tags، ESC/POS printer | 217 |
| `src/js/91-loyalty.js` | loyalty settings | 57 |
| `src/js/92-hr-attendance.js` | attendance، payroll، renderAttendancePane | 232 |
| `src/js/93-accounting.js` | P&L، cash flow، accounting page | 513 |
| `src/js/94-vlookup.js` | VLOOKUP reports، category reports | 360 |
| `src/js/95-warehouse.js` | warehouse page، warehouse transfers | 208 |
| `src/js/96-approvals.js` | price-change approvals، suspended tabs | 373 |
| `src/js/97-expense-requests.js` | expense approval requests | 100 |
| `src/js/98-leave-requests.js` | leave & permission requests | 129 |
| `src/js/100-home.js` | home page، renderHomeIcons، fingerprint import | 280 |
| `src/js/110-helpdesk.js` | تذاكر الدعم الفني (تصنيف/أولوية/حالة) | 155 |
| `src/js/115-pivot-reports.js` | تقارير محورية — أبعاد ومقاييس + drill-down على الخلية | 313 |
| `src/js/120-data-migration.js` | استيراد بيانات سيستم قديم من إكسيل (مبيعات ومصاريف تاريخية) | 320 |
| `src/js/125-strategic-analytics.js` | تحليل الخصومات، تحليل حركة المخزون، كشف حساب صنف | 782 |

---

## خريطة الدوال الرئيسية

### للتعديل في كل فيتشر — اقرأ هذا الملف فقط:

| الفيتشر | الملف |
|---------|-------|
| كاشير / بيع | `20-pos-payment.js` + `15-pos-cart.js` |
| المخزون | `35-inventory.js` |
| جرد المخزون | `36-stocktake.js` |
| الداشبورد | `30-dashboard.js` |
| Firebase / cloud | `65-firebase.js` |
| الفروع والتحويلات | `70-branches.js` |
| المشتريات والموردين | `75-purchases.js` |
| HR / رواتب / حضور | `80-hr-targets.js` + `92-hr-attendance.js` |
| التقارير | `45-reports.js` + `50-kpi.js` + `94-vlookup.js` |
| المحاسبة | `93-accounting.js` |
| الإعدادات | `60-settings.js` |
| CRM / العملاء | `85-crm.js` |
| طلبات الإجازات | `98-leave-requests.js` |
| طلبات المصاريف | `97-expense-requests.js` |
| اعتماد الأسعار | `96-approvals.js` |
| الدعم الفني | `110-helpdesk.js` |
| التقارير المحورية | `115-pivot-reports.js` |
| استيراد بيانات قديمة | `120-data-migration.js` |
| التحليلات الاستراتيجية | `125-strategic-analytics.js` |

---

## بعد أي تعديل

### تعديل كود (src/)
1. **اختبر محلياً الأول** — شغّل `dev.bat` (بيعمل build.py ويفتح المتصفح على `localhost:8765`) وسجّل دخول بـ **`dev` / `dev`**. جرّب الفيتشر فعلياً قبل الدفع — ده بالظبط اللي كان ناقص لما حصلت مشكلة اختفاء المبيعات في 2026-07-11.
2. `python build.py` (لو لسه ماعملتوش).
3. **`python audit.py` — قبل أي push، من غير استثناء.** بيرجّع exit code 1 لو فيه أخطاء. بيمسك في أقل من ثانية نوع البجّات اللي المراجعة البشرية بتفوّتها لأن كل ملف لوحده بيبان سليم والتعارض بين الملفات: IDs مكررة، `onclick` بينادي دالة اتمسحت، JS بيدوّر على `id` مش موجود، أكتر من فلتر فرع في نفس الصفحة، وشنك اتبنى ومااتعملّهوش commit. **كل فحص فيه اتكتب بعد بج حقيقي حصل فعلاً.**
4. لو التعديل يمس منطق (مش شكل بس) — امشي على السيناريوهات اليدوية في [`TESTING.md`](TESTING.md). القاعدة الذهبية: جرّب بحسابين على الأقل (المالك + كاشير فرع)، ولو الصفحة فيها فلتر فرع غيّر الفلتر **وبعدين** اعمل عملية كتابة.
5. `git add -A && git commit -m "وصف التغيير" && git push`
6. GitHub Actions تنشر على GitHub Pages خلال ~30 ثانية، وVercel بينشر تلقائي كمان.
7. لتجربة تغيير كبير قبل ما يوصل لـ main، ادفعه على فرع `staging` الأول (`git push origin HEAD:staging`) — لو Vercel مضبوط يعمل preview للفروع هيديك لينك منفصل تجرب عليه.

### لو لقيت بج
اسأل: **"هل `audit.py` كان يقدر يمسكه؟"** لو أيوة ضيف الفحص فيه، لو لأ ضيف السيناريو في `TESTING.md`. كده كل بج بيتصاد مرة واحدة بس. وفيه أوديت شهري بـ 20 دقيقة في `TESTING.md` بيكشف التلف الصامت المتراكم (أهمه: صافي الربح لازم يطابق في 3 شاشات — الداشبورد، قائمة الدخل، الملخص).

### تعديل Firestore Rules (`firestore.rules`)
⚠️ **ممنوع تنشر Rules جديدة على الـ Console مباشرة من غير تجربة.** في 2026-07-11 نشر Rules ناقصة (من غير قاعدة لـ `pos_sales`) قفل وصول المبيعات كلها في الإنتاج فجأة.
1. عدّل `firestore.rules` في الكود، اعمل commit وpush زي أي تعديل عادي (الملف مش جزء من build.py، بس لازم يفضل متزامن مع اللي منشور فعلاً).
   - `firebase.json` و`.firebaserc` موجودين دلوقتي، يعني ينفع تنشر بـ `firebase deploy --only firestore:rules` بدل النسخ اليدوي في الكونسول — بس **خطوة التجربة تحت لسه إجبارية بنفس الدرجة**، الأمر ده بينشر على طول من غير أي تأكيد.
2. **شغّل `test-rules.bat`** — دي الطريقة المفضّلة دلوقتي بدل الـ Playground اليدوي. بتشغّل `firestore.rules` الحقيقي على محاكي محلي وبتجرب عليه 31 سيناريو (اعتماد ذاتي، تثبيت الأسعار، انتهاء الصلاحية، عزل الفروع، `pos_data/auth` مقفول...). ثانيتين، بتتكرر، ومستحيل تلمس الإنتاج (مشروع وهمي `voodo-rules-test`). الاختبارات في `rules-test/run-tests.js` — **أي قاعدة جديدة تتضاف، يتضاف ليها اختبار**.
   - محتاج Java (اتسطّبت OpenJDK 21 في 2026-08-13) و`npm install` مرة واحدة في `rules-test/` (الـ bat بيعملها لوحده أول مرة).
3. **الـ Playground اليدوي** لسه مفيد للتأكد من حالة حساب حقيقي بعينه، بس مش بديل عن (2).

⚠️ **متفوّضش الخطوة دي لوكيل تاني.** في 2026-08-13 اتجربت مرتين مع وكيل متصفح: الأولى اختبر القواعد **القديمة** (ماكانش لصق الملف) وفسّر الفشل بإنه "قيد في الأداة"؛ التانية **كتب نسخة مختصرة من القواعد من دماغه** (53 سطر بدل 350) واختبرها وقال "كله تمام" — لو اتنشرت كانت هتمسح كل حماية في النظام. `test-rules.bat` موجود عشان الخطوة دي متتفوّضش أصلاً.
4. بعد التأكد، انشر، وبعدها افتح التطبيق وتأكد إن البيانات بترجع تظهر.

⚠️ **مجموعة غريبة في `firestore.rules` — متمسحهاش**: `china_pricing_prices/{source}` (سطر ~272) **مالهاش أي علاقة بـ VOODO** — دي مشروع جانبي منفصل (حاسبة تسعير) بيشارك نفس مشروع Firebase عشان الخطة المجانية بتسمح بمشروع واحد بس. معزولة تماماً: مفيش تداخل مع أي مجموعة أو قاعدة بتاعة VOODO، ومحمية بـ `signedIn()`. لو مسحتها هتكسر التطبيق التاني من غير ما تلاحظ.

### ⚠️ أي مراجعة أوتوماتيكية للقواعد = فرضيات مش توصيات
الأدوات العامة (زي سكيل `firebase-security-rules-auditor`) بتشتغل بقايمة معايير عامة ومعرفهاش حاجة عن السيستم ده. في 2026-08-11 راجعت القواعد بيها وطلعت 6 اكتشافات — **اتنين منهم كانوا هيسببوا انقطاع لو اتنفذوا**:

- **"امسح `role == 'admin'` من قواعد المخزون والمبيعات"** — حسابات الأدمن `branchId` بتاعها `null` (`60-settings.js`)، فمكانتش هتطابق `branchId == branchId` ولا `'wh'` → كانت هتتقفل بره المخزون خالص. وكمان الاكتشاف نفسه كان غلط: `inventory` و`sales` معلّمين `enforced: false` في `DEPARTMENTS` (`00-core.js`) **عن قصد** — القاعدة بتحكم دوكيومنت كامل مش صفحة.
- **"ضيف `email_verified == true` لـ `isOwner()`"** — سؤال سليم، لكن حساب المالك `emailVerified: false` فعلياً. تنفيذها كان هيقفل المالك بره كل حاجة لحظة النشر.

**القاعدة**: قبل أي تعديل مقترح على `firestore.rules`، اتحقق من (١) `DEPARTMENTS` في `00-core.js` — هل التبويب `enforced` أصلاً؟ (٢) الحالة الحقيقية للحسابات في Firebase (فيه Firebase MCP، `auth_get_users` بيجاوب في ثانية). (٣) إيه اللي بيكسر لو الشرط اتشال — مش بس إيه اللي بيتأمّن.

الاكتشافات الحقيقية اللي طلعت منها للتوثيق: `pos_data/price_approvals` دوكيومنت واحد مشترك فأي حساب معاه role يقدر يكتب `status:'approved'` على طلبه (الحل: دوكيومنت لكل طلب زي `pos_audit`)، و`china_pricing_prices` كتابته مفتوحة بلا حدود على نفس كوتا المشروع.
