// ══════════════════════════════════════════════════════════════════
// VOODO ERP — اختبارات قواعد Firestore
//
// بتشغّل firestore.rules الحقيقي على محاكي محلي وبتجرب عليه سيناريوهات
// حقيقية. بديل عن Rules Playground اليدوي: أسرع، بيتكرر بأمر واحد،
// وميقدرش يلمس الإنتاج إطلاقاً.
//
// كل اختبار هنا مكتوب بعد سؤال أمني حقيقي — مش تغطية شكلية.
//
// التشغيل:  test-rules.bat   (من جذر المشروع)
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc } = require('firebase/firestore');

const OWNER_EMAIL = 'shekovichy@gmail.com';
const FUTURE = Date.now() + 3600e3;   // لسه صالح
const PAST   = Date.now() - 3600e3;   // انتهت صلاحيته

let env, pass = 0, fail = 0;
const failures = [];

async function check(name, promise) {
  try { await promise; console.log('  \x1b[32m✓\x1b[0m ' + name); pass++; }
  catch (e) { console.log('  \x1b[31m✗\x1b[0m ' + name); failures.push(name + '\n      ' + (e.message || e)); fail++; }
}

// حسابات الاختبار
const cashier = () => env.authenticatedContext('uid_cashier', { email: 'c@voodo-pos.local' }).firestore();
const cashier2= () => env.authenticatedContext('uid_cashier2',{ email: 'c2@voodo-pos.local' }).firestore();
const admin   = () => env.authenticatedContext('uid_admin',   { email: 'a@voodo-pos.local' }).firestore();
const noRole  = () => env.authenticatedContext('uid_norole',  { email: 'n@voodo-pos.local' }).firestore();
const owner   = () => env.authenticatedContext('uid_owner',   { email: OWNER_EMAIL, email_verified: true }).firestore();
// نفس إيميل المالك بس من غير تحقق — لازم ميتعاملش كمالك إطلاقاً
const ownerUnverified = () => env.authenticatedContext('uid_owner2', { email: OWNER_EMAIL, email_verified: false }).firestore();
const anon    = () => env.unauthenticatedContext().firestore();

const REQ = (over = {}) => Object.assign({
  id: 999, cashier: 'c', cashierUid: 'uid_cashier', branchId: 'b5', branchName: 'باكوس',
  items: [{ code: 'T1', qty: 1, price: 70 }], total: 70, note: '',
  status: 'pending', adminNote: '', expiresAt: FUTURE
}, over);

async function seed(data) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'pos_price_approvals/999'), REQ(data));
  });
}

async function main() {
  env = await initializeTestEnvironment({
    projectId: 'voodo-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
  });

  // أدوار ثابتة لكل الاختبارات
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'roles/uid_cashier'),  { role: 'cashier', username: 'c',  branchId: 'b5' });
    await setDoc(doc(db, 'roles/uid_cashier2'), { role: 'cashier', username: 'c2', branchId: 'b5' });
    await setDoc(doc(db, 'roles/uid_admin'),    { role: 'admin',   username: 'a',  branchId: null });
    // uid_norole عمداً من غير مستند
  });

  console.log('\n\x1b[1mالثغرة الأصلية — الاعتماد الذاتي\x1b[0m');
  await seed();
  await check('كاشير مايقدرش يعتمد طلبه هو',
    assertFails(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: FUTURE }))));
  await check('كاشير تاني مايقدرش يعتمد كمان (مش أدمن)',
    assertFails(setDoc(doc(cashier2(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: FUTURE }))));
  await check('الأدمن يقدر يعتمد',
    assertSucceeds(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: FUTURE }))));
  await seed();
  await check('المالك يقدر يعتمد',
    assertSucceeds(setDoc(doc(owner(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: FUTURE }))));

  console.log('\n\x1b[1mالإنشاء\x1b[0m');
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'pos_price_approvals/tmp'), REQ()); });
  await check('كاشير ينشئ طلب pending باسمه',
    assertSucceeds(setDoc(doc(cashier(), 'pos_price_approvals/new1'), REQ({ id: 1, status: 'pending' }))));
  await check('مايقدرش ينشئ طلب معتمد من الأول',
    assertFails(setDoc(doc(cashier(), 'pos_price_approvals/new2'), REQ({ id: 2, status: 'approved', expiresAt: FUTURE }))));
  await check('مايقدرش ينشئ طلب باسم كاشير تاني',
    assertFails(setDoc(doc(cashier(), 'pos_price_approvals/new3'), REQ({ id: 3, cashierUid: 'uid_cashier2' }))));
  await check('حساب من غير role مايقدرش ينشئ',
    assertFails(setDoc(doc(noRole(), 'pos_price_approvals/new4'), REQ({ id: 4, cashierUid: 'uid_norole' }))));
  await check('غير مسجّل دخول مايقدرش ينشئ',
    assertFails(setDoc(doc(anon(), 'pos_price_approvals/new5'), REQ({ id: 5 }))));

  console.log('\n\x1b[1mتثبيت الأسعار وقت الاعتماد\x1b[0m');
  await seed();
  await check('الأدمن مايقدرش يغيّر الإجمالي وهو بيعتمد',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'approved', total: 10, expiresAt: FUTURE }))));
  await seed();
  await check('الأدمن مايقدرش يغيّر الأصناف وهو بيعتمد',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'),
      REQ({ status: 'approved', items: [{ code: 'T1', qty: 1, price: 5 }], expiresAt: FUTURE }))));
  await seed();
  await check('الأدمن مايقدرش ينسب الطلب لكاشير تاني',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'),
      REQ({ status: 'approved', cashierUid: 'uid_cashier2', expiresAt: FUTURE }))));

  console.log('\n\x1b[1mالإتمام والإلغاء وانتهاء الصلاحية\x1b[0m');
  await seed({ status: 'approved', expiresAt: FUTURE });
  await check('الكاشير يقفل فاتورته المعتمدة بالبيع (consumed)',
    assertSucceeds(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'consumed', expiresAt: FUTURE }))));
  await seed({ status: 'approved', expiresAt: FUTURE });
  await check('الكاشير يلغي فاتورته المعتمدة (cancelled)',
    assertSucceeds(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'cancelled', expiresAt: FUTURE }))));
  await seed({ status: 'approved', expiresAt: PAST });
  await check('⭐ مايقدرش يتمّ البيع بعد انتهاء الصلاحية',
    assertFails(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'consumed', expiresAt: PAST }))));
  await seed({ status: 'approved', expiresAt: PAST });
  await check('لكن الإلغاء لسه مسموح بعد الانتهاء (تنضيف)',
    assertSucceeds(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'cancelled', expiresAt: PAST }))));
  await seed({ status: 'approved', expiresAt: FUTURE });
  await check('كاشير تاني مايقدرش يستهلك فاتورة مش بتاعته',
    assertFails(setDoc(doc(cashier2(), 'pos_price_approvals/999'), REQ({ status: 'consumed', expiresAt: FUTURE }))));
  await seed({ status: 'approved', expiresAt: FUTURE });
  await check('الكاشير مايقدرش يرجّع فاتورته لـ pending',
    assertFails(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'pending', expiresAt: FUTURE }))));

  console.log('\n\x1b[1mالطلبات المعلقة اللي محدش رد عليها\x1b[0m');
  await seed({ status: 'pending', expiresAt: PAST });
  await check('⭐ الأدمن مايقدرش يعتمد طلب معلق انتهت صلاحيته',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: PAST }))));
  await seed({ status: 'pending', expiresAt: PAST });
  await check('الأدمن يعلّم الطلب المنتهي expired (تنضيف)',
    assertSucceeds(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'expired', expiresAt: PAST }))));
  await seed({ status: 'pending', expiresAt: PAST });
  await check('صاحب الطلب كمان يقدر يعلّمه expired',
    assertSucceeds(setDoc(doc(cashier(), 'pos_price_approvals/999'), REQ({ status: 'expired', expiresAt: PAST }))));
  await seed({ status: 'pending', expiresAt: FUTURE });
  await check('⭐ مايقدرش يدفن طلب لسه صالح بـ expired',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'expired', expiresAt: FUTURE }))));
  await seed({ status: 'pending', expiresAt: PAST });
  await check('كاشير أجنبي مايقدرش يعلّم طلب غيره expired',
    assertFails(setDoc(doc(cashier2(), 'pos_price_approvals/999'), REQ({ status: 'expired', expiresAt: PAST }))));
  await seed({ status: 'pending', expiresAt: FUTURE });
  await check('الأدمن يعتمد طلب معلق لسه صالح (ماتكسرش)',
    assertSucceeds(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: FUTURE }))));

  // expiresAt بقى إجباري. التسامح الانتقالي (اللي كان بيسمح باعتماد طلبات
  // النسخة السابقة اللي مالهاش الحقل) اتشال في 2026-08-15 بعد ما الطلبات
  // دي خلصت — أي مستند من غير الحقل دلوقتي مرفوض تماماً.
  console.log('\n\x1b[1mexpiresAt إجباري\x1b[0m');
  await env.withSecurityRulesDisabled(async ctx => {
    const legacy = REQ({ status: 'pending' });
    delete legacy.expiresAt;
    await setDoc(doc(ctx.firestore(), 'pos_price_approvals/999'), legacy);
  });
  await check('⭐ مايتعتمدش طلب من غير expiresAt (التسامح اتشال)',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'approved', expiresAt: FUTURE }))));
  await check('ومايتعلّمش expired كمان',
    assertFails(setDoc(doc(admin(), 'pos_price_approvals/999'), REQ({ status: 'expired' }))));
  await check('الطلب الجديد لازم يبقى معاه expiresAt',
    assertFails(setDoc(doc(cashier(), 'pos_price_approvals/nx'), (() => {
      const r = REQ({ id: 77 }); delete r.expiresAt; return r; })())));

  console.log('\n\x1b[1mالقراءة\x1b[0m');
  await seed({ status: 'approved', expiresAt: FUTURE });
  await check('الكاشير يقرا طلبه',
    assertSucceeds(getDoc(doc(cashier(), 'pos_price_approvals/999'))));
  await check('الأدمن يقرا أي طلب',
    assertSucceeds(getDoc(doc(admin(), 'pos_price_approvals/999'))));
  await check('كاشير تاني مايقراش طلب غيره',
    assertFails(getDoc(doc(cashier2(), 'pos_price_approvals/999'))));
  await check('حساب من غير role مايقراش',
    assertFails(getDoc(doc(noRole(), 'pos_price_approvals/999'))));
  await check('غير مسجّل دخول مايقراش',
    assertFails(getDoc(doc(anon(), 'pos_price_approvals/999'))));

  console.log('\n\x1b[1mالحذف\x1b[0m');
  await check('الكاشير مايقدرش يمسح طلبه (سجل)',
    assertFails(require('firebase/firestore').deleteDoc(doc(cashier(), 'pos_price_approvals/999'))));
  await check('الأدمن مايقدرش يمسح — المالك بس',
    assertFails(require('firebase/firestore').deleteDoc(doc(admin(), 'pos_price_approvals/999'))));

  // ── حماية الانحدار: القواعد القديمة لازم تفضل شغالة ──────────────
  // القواعد الجديدة إضافية. لو تعديل جاي كسر واحدة من دول، الاختبار ده
  // بيمسكها قبل النشر.
  // إيميل المالك هو الحاجة الوحيدة اللي بتعرّفه (الحساب مالوش roles/{uid})،
  // وإيميل غير متحقق منه مش إثبات ملكية. اتضاف في 2026-08-15 بعد ما الحساب
  // الحقيقي اتفعّل — قبل كده كان هيقفل المالك بره كل حاجة.
  console.log('\n\x1b[1mسجل الجردات (تسوية) — مستند لكل جرد، لا يتعدّل\x1b[0m');
  const TAKE = (over = {}) => Object.assign({
    id: 5, branchId: 'b5', branchName: 'باكوس', mode: 'full',
    startedAt: 1, countedAt: 2, countedBy: 'a', status: 'pending',
    items: [], summary: { total: 0, counted: 0, variances: 0, netValue: 0 }
  }, over);
  // الجرد شغل أدمن بالسياسة من أول يوم — الكاشير مالوش صلاحية ولا بيقدر
  // يفتح تبويب المخزون أصلاً. و`inventory` معلّم enforced:false، يعني
  // القواعد دي هي المكان الوحيد اللي ينفع تفرض ده فيه فعلاً.
  await check('⭐ الكاشير مايسجّلش جرد ولا حتى لفرعه',
    assertFails(setDoc(doc(cashier(), 'pos_stocktakes/t1'), TAKE())));
  await check('ولا لفرع تاني طبعاً',
    assertFails(setDoc(doc(cashier(), 'pos_stocktakes/t2'), TAKE({ branchId: 'b1' }))));
  await check('الأدمن يسجّل جرد أي فرع',
    assertSucceeds(setDoc(doc(admin(), 'pos_stocktakes/t3'), TAKE({ branchId: 'b1' }))));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'pos_stocktakes/t1'), TAKE());   // للقراءة تحت
  });
  await check('الجرد لازم يتولد pending — مايتسجّلش مطبّق من الأول',
    assertFails(setDoc(doc(admin(), 'pos_stocktakes/t9'), TAKE({ status: 'applied' }))));
  await check('الأدمن يعدّل الأعداد وهي لسه معلقة (مراجعة)',
    assertSucceeds(setDoc(doc(admin(), 'pos_stocktakes/t1'),
      TAKE({ summary: { total: 1, counted: 1, variances: 1, netValue: 50 } }))));
  await check('⭐ لكن مايقدرش ينقلها لفرع تاني وهو بيعدّل',
    assertFails(setDoc(doc(admin(), 'pos_stocktakes/t1'), TAKE({ branchId: 'b1' }))));
  await check('⭐ ولا الكاشير يعدّل فيها',
    assertFails(setDoc(doc(cashier(), 'pos_stocktakes/t1'), TAKE({ countedBy: 'x' }))));
  // المراجعة فوق غيّرت الـ summary المخزّن، وقاعدة الاعتماد بتثبّته — فلازم
  // نرجّع الحالة الأصلية قبل ما نختبر الاعتماد.
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'pos_stocktakes/t1'), TAKE()); });
  await check('⭐ الأدمن مايعتمدش التسوية (المالك بس)',
    assertFails(setDoc(doc(admin(), 'pos_stocktakes/t1'), TAKE({ status: 'applied' }))));
  await check('المالك يعتمدها',
    assertSucceeds(setDoc(doc(owner(), 'pos_stocktakes/t1'), TAKE({ status: 'applied' }))));
  await check('⭐ ومايقدرش يعتمدها تاني بعد ما اتعملت',
    assertFails(setDoc(doc(owner(), 'pos_stocktakes/t1'), TAKE({ status: 'applied' }))));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'pos_stocktakes/t1'), TAKE()); });
  await check('المالك يلغيها',
    assertSucceeds(setDoc(doc(owner(), 'pos_stocktakes/t1'), TAKE({ status: 'cancelled' }))));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'pos_stocktakes/t1'), TAKE()); });
  await check('⭐ مايقدرش يغيّر أرقام العدّ وهو بيعتمد',
    assertFails(setDoc(doc(owner(), 'pos_stocktakes/t1'),
      TAKE({ status: 'applied', summary: { total: 0, counted: 0, variances: 0, netValue: 9999 } }))));
  await check('⭐ ولا ينسب العدّ لحد تاني',
    assertFails(setDoc(doc(owner(), 'pos_stocktakes/t1'), TAKE({ status: 'applied', countedBy: 'مزوّر' }))));
  await check('الكاشير يقرا تسوية فرعه',
    assertSucceeds(getDoc(doc(cashier(), 'pos_stocktakes/t1'))));
  await check('⭐ مايقراش تسوية فرع تاني',
    assertFails(getDoc(doc(cashier(), 'pos_stocktakes/t3'))));
  await check('الأدمن يقرا أي تسوية',
    assertSucceeds(getDoc(doc(admin(), 'pos_stocktakes/t1'))));
  await check('حساب من غير role مايقراش',
    assertFails(getDoc(doc(noRole(), 'pos_stocktakes/t1'))));
  await check('الكاشير مايمسحش تسوية',
    assertFails(require('firebase/firestore').deleteDoc(doc(cashier(), 'pos_stocktakes/t1'))));

  console.log('\n\x1b[1mالمالك لازم يكون إيميله متحقق منه\x1b[0m');
  await check('المالك المتحقق يقرا roles (سلطة كاملة)',
    assertSucceeds(getDoc(doc(owner(), 'roles/uid_admin'))));
  await check('⭐ نفس الإيميل من غير تحقق مالوش أي سلطة',
    assertFails(getDoc(doc(ownerUnverified(), 'roles/uid_admin'))));
  await check('ومايكتبش roles كمان',
    assertFails(setDoc(doc(ownerUnverified(), 'roles/uid_hacker'), { role: 'admin' })));
  await check('ومايوصلش لمبيعات فرع تاني',
    assertFails(getDoc(doc(ownerUnverified(), 'pos_sales/2026-08/branches/b1'))));

  // «أدمن» لقب من 2026-07-20 والصلاحيات الفعلية من الشجرة. القاعدة كانت
  // بتتجاهل ده وتدي أي حساب بلقب admin كل الفروع. الحسابات دي منسوخة من
  // حسابات حقيقية في الإنتاج عشان الاختبار يعكس الأثر الفعلي.
  console.log('\n\x1b[1mلقب "أدمن" مايتخطاش شجرة الصلاحيات\x1b[0m');
  const P = (over) => Object.assign({
    inventory: { view: false, write: false }, sales: { view: false, write: false }
  }, over);
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    // maryam: أدمن قراءة بس
    await setDoc(doc(db, 'roles/uid_ro'),   { role: 'admin', username: 'ro', branchId: null,
      permissions: P({ inventory: { view: true, write: false }, sales: { view: true, write: false } }) });
    // tarek2: أدمن مخزون بس، ممنوع من المبيعات
    await setDoc(doc(db, 'roles/uid_inv'),  { role: 'admin', username: 'inv', branchId: null,
      permissions: P({ inventory: { view: true, write: true } }) });
    await setDoc(doc(db, 'pos_data/inventory/branches/b1'), { items: [] });
    await setDoc(doc(db, 'pos_sales/2026-08/branches/b1'), { items: [] });
  });
  const ro  = () => env.authenticatedContext('uid_ro',  { email: 'ro@voodo-pos.local' }).firestore();
  const inv = () => env.authenticatedContext('uid_inv', { email: 'inv@voodo-pos.local' }).firestore();

  await check('أدمن قراءة: يقرا المخزون',
    assertSucceeds(getDoc(doc(ro(), 'pos_data/inventory/branches/b1'))));
  await check('⭐ أدمن قراءة: مايكتبش المخزون (الشجرة بتمنعه)',
    assertFails(setDoc(doc(ro(), 'pos_data/inventory/branches/b1'), { items: [1] })));
  await check('أدمن قراءة: يقرا المبيعات',
    assertSucceeds(getDoc(doc(ro(), 'pos_sales/2026-08/branches/b1'))));
  await check('⭐ أدمن قراءة: مايكتبش المبيعات',
    assertFails(setDoc(doc(ro(), 'pos_sales/2026-08/branches/b1'), { items: [1] })));
  await check('أدمن المخزون: يقرا ويكتب المخزون',
    assertSucceeds(setDoc(doc(inv(), 'pos_data/inventory/branches/b1'), { items: [2] })));
  await check('⭐ أدمن المخزون: مايقراش المبيعات خالص (sales=false)',
    assertFails(getDoc(doc(inv(), 'pos_sales/2026-08/branches/b1'))));
  await check('⭐ ومايكتبش المبيعات',
    assertFails(setDoc(doc(inv(), 'pos_sales/2026-08/branches/b1'), { items: [1] })));
  await check('الكاشير لسه بيوصل لفرعه من غير أي منح تبويب',
    assertSucceeds(getDoc(doc(cashier(), 'pos_data/inventory/branches/b5'))));

  console.log('\n\x1b[1mانحدار — باقي النظام لسه محمي\x1b[0m');
  await check('مفيش role = مفيش وصول لـ pos_data',
    assertFails(getDoc(doc(noRole(), 'pos_data/settings'))));
  await check('pos_data/auth مقفول حتى على المالك',
    assertFails(getDoc(doc(owner(), 'pos_data/auth'))));
  await check('الكاشير مايكتبش settings',
    assertFails(setDoc(doc(cashier(), 'pos_data/settings'), { x: 1 })));
  await check('الكاشير مايقراش مخزون فرع تاني',
    assertFails(getDoc(doc(cashier(), 'pos_data/inventory/branches/b1'))));
  await check('الكاشير يقرا مخزون فرعه',
    assertSucceeds(getDoc(doc(cashier(), 'pos_data/inventory/branches/b5'))));
  await check('الدوكيومنت المشترك القديم بقى للقراءة بس',
    assertFails(setDoc(doc(cashier(), 'pos_data/price_approvals'), { items: [] })));
  await check('والأدمن كمان مايكتبش فيه',
    assertFails(setDoc(doc(admin(), 'pos_data/price_approvals'), { items: [] })));
  await check('سجل التغييرات مايتعدلش بعد الإنشاء',
    assertFails(setDoc(doc(admin(), 'pos_audit/x1'), { a: 1 }).then(() =>
      setDoc(doc(admin(), 'pos_audit/x1'), { a: 2 }))));

  console.log('\n' + '─'.repeat(52));
  if (fail) {
    console.log('\x1b[31m\x1b[1m  ' + fail + ' فشل\x1b[0m · ' + pass + ' نجح');
    console.log('\nالفاشل:');
    failures.forEach(f => console.log('  • ' + f));
  } else {
    console.log('\x1b[32m\x1b[1m  ✅ كل الاختبارات نجحت (' + pass + ')\x1b[0m');
  }
  console.log('─'.repeat(52) + '\n');

  await env.cleanup();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
