// ══════════════════════════════════════════════════════════════════════
// ONE-TIME PERMISSIONS BACKFILL — writes roles/{uid}.permissions onto every
// EXISTING account that doesn't have one yet (computed from its current
// role via _defaultPermissionsFor() in 00-core.js, which mirrors exactly
// what that account could already reach through the UI before this system
// existed — see the long comment on that function). Nothing changes for
// anyone until the admin explicitly edits a user's matrix afterward.
//
// Safe to run anytime, safe to re-run: it only ever touches accounts whose
// `permissions` field is still absent — an admin who already customized
// someone's matrix is never overwritten by running this again. Also safe
// to publish the new firestore.rules BEFORE running this: the rules fall
// back to the same defaults for any account still missing `permissions`
// (see hasTabPermission() in firestore.rules), so nothing breaks either way
// — this tool exists so the admin can actually SEE and edit each account's
// starting matrix from "إدارة المستخدمين" afterward.
// ══════════════════════════════════════════════════════════════════════

let _permsMigrationPlan = null;

async function previewPermissionsMigration() {
  if (currentUser !== 'admin') { showToast('الترحيل للأدمن فقط'); return; }
  if (!_fbReady) { showToast('محتاج اتصال بالإنترنت لعمل الترحيل'); return; }

  showToast('⏳ جاري فحص المستخدمين...');
  let snap;
  try { snap = await firebase.firestore().collection('roles').get(); }
  catch (e) { console.error('previewPermissionsMigration read:', e); showToast('تعذّر القراءة'); return; }

  const affected = [];
  snap.forEach(doc => {
    const rec = doc.data();
    if (rec.role === 'admin') return; // admin never has/needs a permissions map
    if (rec.permissions) return;      // already has one — never touched
    affected.push({ uid: doc.id, username: rec.username, role: rec.role });
  });

  _permsMigrationPlan = affected;
  _renderPermsMigrationPreview(affected);
}

function _renderPermsMigrationPreview(affected) {
  const rows = affected.map(a =>
    `<div style="font-size:12px;">• ${escHtml(a.username)} — ${a.role === 'manager' ? 'مدير فرع' : 'كاشير'}</div>`).join('');

  const body = !affected.length
    ? '<div style="padding:16px;text-align:center;color:var(--text-muted);">كل المستخدمين عندهم صلاحيات محددة بالفعل — مفيش حاجة للترحيل.</div>'
    : `
      <div style="padding:4px 2px 12px;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin-bottom:12px;">
          <div style="font-weight:700;margin-bottom:8px;">هيتم إعطاء الصلاحيات الافتراضية دي (اللي كانوا شايفينها بالظبط قبل كده) للمستخدمين دول:</div>
          <div style="font-size:13px;margin-bottom:4px;">👥 <strong>${affected.length}</strong> مستخدم</div>
          ${rows}
        </div>
        <div style="font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-radius:8px;padding:10px;">
          ⚠️ ده بس بيدّي كل واحد نفس الصلاحيات اللي كان شايفها فعلياً قبل كده (تقارير + دعم فني، ومدير الفرع كمان الداشبورد) — مفيش حد هياخد صلاحية جديدة تلقائي. بعد كده تقدر تعدّل صلاحيات أي حد من نفس شاشة "إدارة المستخدمين".
        </div>
      </div>`;

  let modal = document.getElementById('permsMigrationModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'permsMigrationModal';
    modal.className = 'modal-overlay hidden';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:520px;width:94%;">
      <div class="modal-header">
        <h3>🔀 ترحيل صلاحيات التابات</h3>
        <button onclick="document.getElementById('permsMigrationModal').classList.add('hidden')" style="background:none;border:none;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <div style="max-height:60vh;overflow-y:auto;">${body}</div>
      <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;">
        <button class="btn btn-gray btn-sm" onclick="document.getElementById('permsMigrationModal').classList.add('hidden')">إغلاق</button>
        ${affected.length ? '<button class="btn btn-primary btn-sm" onclick="executePermissionsMigration()">✅ ابدأ الترحيل</button>' : ''}
      </div>
    </div>`;
  modal.classList.remove('hidden');
}

async function executePermissionsMigration() {
  if (currentUser !== 'admin') { showToast('الترحيل للأدمن فقط'); return; }
  const plan = _permsMigrationPlan;
  if (!plan || !plan.length) { showToast('اعمل فحص الأول'); return; }

  showToast('⏳ جاري الترحيل...');
  let written = 0, failed = 0;
  for (const a of plan) {
    try {
      const permissions = _defaultPermissionsFor(a.role === 'manager' ? 'manager' : 'cashier');
      await firebase.firestore().collection('roles').doc(a.uid).set({ permissions }, { merge: true });
      written++;
    } catch (e) {
      console.error('executePermissionsMigration write:', a.uid, e);
      failed++;
    }
  }

  addAuditLog('permissions.migrate', `ترحيل صلاحيات التابات لـ ${written} مستخدم${failed ? `، وفشل ${failed}` : ''}`, null);
  document.getElementById('permsMigrationModal').classList.add('hidden');
  _permsMigrationPlan = null;
  showMsg('sSettingsMsg', failed
    ? `⚠️ تم ترحيل ${written}، وفشل ${failed} — راجع الـ Console وأعد المحاولة (آمن تكرر الترحيل)`
    : `✅ تم ترحيل صلاحيات ${written} مستخدم. راجعهم من "إدارة المستخدمين" وعدّل اللي محتاج تعديل.`,
    failed ? 'danger' : 'success');
  if (_rolesListCache) renderUserAccountsSettings();
}
