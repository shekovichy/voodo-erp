// ══════════════════════════════════════════════════════════════════════
// ONE-TIME INVENTORY MIGRATION — flat pos_data/inv_{branchId} →
// pos_data/inventory/branches/{branchId}
//
// ⚠️ Run this ONLY as part of the coordinated cutover described in the
// comment above setInv() in 00-core.js — after the new write/listener code
// is live but BEFORE publishing the new firestore.rules. Harmless to
// re-run (plain overwrite of the same content — each branch's inventory is
// already a complete, standalone array, so unlike the sales migration
// there's no splitting/grouping involved, just moving where the same
// document lives).
// ══════════════════════════════════════════════════════════════════════

let _invMigrationPlan = null;

async function previewInventoryMigration() {
  if (currentUser !== 'admin') { showToast('الترحيل للأدمن فقط'); return; }
  if (!_fbReady) { showToast('محتاج اتصال بالإنترنت لعمل الترحيل'); return; }

  showToast('⏳ جاري فحص المخزون القديم...');
  const plan = { byBranch: {}, totalProducts: 0, branchesWithData: [] };
  for (const b of BRANCH_IDS) {
    let snap;
    try { snap = await _db.collection('pos_data').doc(`inv_${b}`).get(); }
    catch (e) { console.error('previewInventoryMigration read:', b, e); continue; }
    if (!snap.exists) continue;
    const items = snap.data().items || [];
    if (!items.length) continue;
    plan.byBranch[b] = items;
    plan.branchesWithData.push(b);
    plan.totalProducts += items.length;
  }

  _invMigrationPlan = plan;
  _renderInventoryMigrationPreview(plan);
}

function _renderInventoryMigrationPreview(plan) {
  const branchLines = plan.branchesWithData.map(b =>
    `<div style="font-size:12px;">• ${escHtml(getBranchName(b))}: ${plan.byBranch[b].length} منتج</div>`).join('');

  const body = !plan.branchesWithData.length
    ? '<div style="padding:16px;text-align:center;color:var(--text-muted);">مفيش بيانات في الهيكل القديم للترحيل — إما اتترحلت بالفعل أو مفيش مخزون مسجّل.</div>'
    : `
      <div style="padding:4px 2px 12px;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin-bottom:12px;">
          <div style="font-weight:700;margin-bottom:8px;">هيتم نسخ الآتي للهيكل الجديد المعزول لكل فرع:</div>
          <div style="font-size:13px;margin-bottom:4px;">📦 <strong>${plan.totalProducts}</strong> منتج عبر <strong>${plan.branchesWithData.length}</strong> فرع</div>
          ${branchLines}
        </div>
        <div style="font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-radius:8px;padding:10px;">
          ⚠️ ده نسخ بس (مش نقل) — الوثائق القديمة بتفضل زي ما هي كنسخة احتياطية. آمن تكرره أكتر من مرة. <strong>متنشرش قواعد Firestore الجديدة إلا بعد ما الترحيل ده يخلص ويتأكد.</strong>
        </div>
      </div>`;

  let modal = document.getElementById('invMigrationModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'invMigrationModal';
    modal.className = 'modal-overlay hidden';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:520px;width:94%;">
      <div class="modal-header">
        <h3>🔀 ترحيل المخزون للهيكل المعزول</h3>
        <button onclick="document.getElementById('invMigrationModal').classList.add('hidden')" style="background:none;border:none;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <div style="max-height:60vh;overflow-y:auto;">${body}</div>
      <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;">
        <button class="btn btn-gray btn-sm" onclick="document.getElementById('invMigrationModal').classList.add('hidden')">إغلاق</button>
        ${plan.branchesWithData.length ? '<button class="btn btn-primary btn-sm" onclick="executeInventoryMigration()">✅ ابدأ الترحيل</button>' : ''}
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

async function executeInventoryMigration() {
  if (currentUser !== 'admin') { showToast('الترحيل للأدمن فقط'); return; }
  const plan = _invMigrationPlan;
  if (!plan || !plan.branchesWithData.length) { showToast('اعمل فحص الأول'); return; }

  showToast('⏳ جاري الترحيل...');
  let written = 0, failed = 0;
  for (const b of plan.branchesWithData) {
    try {
      await _db.collection('pos_data').doc('inventory').collection('branches').doc(b)
        .set({ items: plan.byBranch[b], updatedAt: Date.now(), branchId: b });
      written++;
    } catch (e) {
      console.error('executeInventoryMigration write:', b, e);
      failed++;
    }
  }

  addAuditLog('inventory.migrate', `ترحيل ${plan.totalProducts} منتج عبر ${plan.branchesWithData.length} فرع للهيكل المعزول لكل فرع (${written} فرع نُسخ${failed ? `، ${failed} فشل` : ''})`, null);
  document.getElementById('invMigrationModal').classList.add('hidden');
  _invMigrationPlan = null;
  showMsg('sSettingsMsg', failed
    ? `⚠️ تم ترحيل ${written} فرع، وفشل ${failed} — راجع الـ Console وأعد المحاولة (آمن تكرر الترحيل)`
    : `✅ تم ترحيل مخزون ${written} فرع بنجاح. راجع صفحة المخزون للتأكد قبل نشر القواعد الجديدة.`,
    failed ? 'danger' : 'success');
}
