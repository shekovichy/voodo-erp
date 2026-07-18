// ══════════════════════════════════════════════════════════════════════
// ONE-TIME SALES MIGRATION — flat pos_sales/{month} → branch-scoped
// pos_sales/{month}/branches/{branchId}
//
// ⚠️ Run this ONLY as part of the coordinated cutover described in the
// comment above addSale() in 00-core.js — after the new write/listener code
// is live but BEFORE publishing the new firestore.rules. Running it earlier
// or later is harmless (arrayUnion makes it idempotent — safe to re-run),
// but the SEQUENCE with the rules publish matters: the new rules deny read
// access to the old flat docs, so if you publish them before migrating,
// nobody can migrate the old data out anymore.
// ══════════════════════════════════════════════════════════════════════

let _salesMigrationPlan = null;

async function previewSalesMigration() {
  if (currentUser !== 'admin') { showToast('الترحيل للأدمن فقط'); return; }
  if (!_fbReady) { showToast('محتاج اتصال بالإنترنت لعمل الترحيل'); return; }

  showToast('⏳ جاري فحص المبيعات القديمة...');
  const months = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }

  const plan = { byMonth: {}, totalSales: 0, byBranch: {}, monthsWithData: [] };
  for (const month of months) {
    let snap;
    try { snap = await _db.collection('pos_sales').doc(month).get(); }
    catch (e) { console.error('previewSalesMigration read:', month, e); continue; }
    if (!snap.exists) continue;
    const items = snap.data().items || [];
    if (!items.length) continue;
    const byBranch = {};
    items.forEach(sale => {
      const b = sale.branchId || 'unknown';
      (byBranch[b] = byBranch[b] || []).push(sale);
    });
    plan.byMonth[month] = byBranch;
    plan.monthsWithData.push(month);
    plan.totalSales += items.length;
    Object.keys(byBranch).forEach(b => { plan.byBranch[b] = (plan.byBranch[b] || 0) + byBranch[b].length; });
  }

  _salesMigrationPlan = plan;
  _renderSalesMigrationPreview(plan);
}

function _renderSalesMigrationPreview(plan) {
  const branchLines = Object.keys(plan.byBranch).map(b =>
    `<div style="font-size:12px;">• ${escHtml(b === 'unknown' ? '(بدون فرع محدد)' : getBranchName(b))}: ${plan.byBranch[b]} فاتورة</div>`).join('');

  const body = !plan.monthsWithData.length
    ? '<div style="padding:16px;text-align:center;color:var(--text-muted);">مفيش بيانات في الهيكل القديم للترحيل — إما اتترحلت بالفعل أو مفيش مبيعات مسجّلة.</div>'
    : `
      <div style="padding:4px 2px 12px;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin-bottom:12px;">
          <div style="font-weight:700;margin-bottom:8px;">هيتم نسخ الآتي للهيكل الجديد المعزول لكل فرع:</div>
          <div style="font-size:13px;margin-bottom:4px;">🧾 <strong>${plan.totalSales}</strong> فاتورة عبر <strong>${plan.monthsWithData.length}</strong> شهر</div>
          <div style="font-size:13px;margin-bottom:4px;">🏬 حسب الفرع:</div>
          ${branchLines}
        </div>
        <div style="font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-radius:8px;padding:10px;">
          ⚠️ ده نسخ بس (add-only، مش نقل) — المستندات القديمة بتفضل زي ما هي كنسخة احتياطية. آمن تكرره أكتر من مرة. <strong>متنشرش قواعد Firestore الجديدة إلا بعد ما الترحيل ده يخلص ويتأكد.</strong>
        </div>
      </div>`;

  let modal = document.getElementById('salesMigrationModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'salesMigrationModal';
    modal.className = 'modal-overlay hidden';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:520px;width:94%;">
      <div class="modal-header">
        <h3>🔀 ترحيل المبيعات للهيكل المعزول</h3>
        <button onclick="document.getElementById('salesMigrationModal').classList.add('hidden')" style="background:none;border:none;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <div style="max-height:60vh;overflow-y:auto;">${body}</div>
      <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;">
        <button class="btn btn-gray btn-sm" onclick="document.getElementById('salesMigrationModal').classList.add('hidden')">إغلاق</button>
        ${plan.monthsWithData.length ? '<button class="btn btn-primary btn-sm" onclick="executeSalesMigration()">✅ ابدأ الترحيل</button>' : ''}
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

async function executeSalesMigration() {
  if (currentUser !== 'admin') { showToast('الترحيل للأدمن فقط'); return; }
  const plan = _salesMigrationPlan;
  if (!plan || !plan.monthsWithData.length) { showToast('اعمل فحص الأول'); return; }

  showToast('⏳ جاري الترحيل...');
  let written = 0, failed = 0;
  for (const month of plan.monthsWithData) {
    const byBranch = plan.byMonth[month];
    for (const branchId of Object.keys(byBranch)) {
      try {
        await _db.collection('pos_sales').doc(month).collection('branches').doc(branchId)
          .set({
            items: firebase.firestore.FieldValue.arrayUnion(...byBranch[branchId]),
            updatedAt: Date.now(), month, branchId
          }, { merge: true });
        written++;
      } catch (e) {
        console.error('executeSalesMigration write:', month, branchId, e);
        failed++;
      }
    }
  }

  addAuditLog('sales.migrate', `ترحيل ${plan.totalSales} فاتورة عبر ${plan.monthsWithData.length} شهر للهيكل المعزول لكل فرع (${written} مستند نُسخ${failed ? `، ${failed} فشل` : ''})`, null);
  document.getElementById('salesMigrationModal').classList.add('hidden');
  _salesMigrationPlan = null;
  showMsg('sSettingsMsg', failed
    ? `⚠️ تم ترحيل ${written} مستند، وفشل ${failed} — راجع الـ Console وأعد المحاولة (آمن تكرر الترحيل)`
    : `✅ تم ترحيل ${written} مستند بنجاح. راجع تقرير المبيعات للتأكد قبل نشر القواعد الجديدة.`,
    failed ? 'danger' : 'success');
}
