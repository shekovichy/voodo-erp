// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════
// ── USER ACCOUNTS (admin-managed) ──────────────────────────────
// User management now runs on REAL Firebase accounts: each staff member
// is a Firebase Auth user plus a roles/{uid} doc (the thing
// firestore.rules actually enforces). The legacy pos_data/accounts doc
// is no longer written — it survives only as an offline login fallback.
let _rolesListCache = [];
async function renderUserAccountsSettings() {
  const container = document.getElementById('userAccountsContainer');
  if (!container) return;
  if (!_fbReady || !firebase.auth().currentUser) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">إدارة المستخدمين تحتاج تسجيل دخول بحساب حقيقي متصل بالإنترنت</div>';
    return;
  }
  container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">⏳ جاري تحميل المستخدمين...</div>';
  try {
    const snap = await firebase.firestore().collection('roles').get();
    _rolesListCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (e) {
    container.innerHTML = '<div style="font-size:13px;color:var(--danger);padding:8px 0;">تعذّر تحميل المستخدمين — اتأكد إنك أدمن وإن الاتصال شغال</div>';
    return;
  }
  if (!_rolesListCache.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">لا يوجد مستخدمين بعد — اضغط "إضافة مستخدم"</div>';
    return;
  }
  container.innerHTML = _rolesListCache.map(acc => {
    const typeLabel   = acc.role === 'admin' ? '👑 أدمن' : (acc.role === 'manager' ? '🧑‍💼 مدير فرع' : '🧑‍💻 كاشير');
    const branchLabel = acc.role !== 'admin' && acc.branchId ? ` — ${escHtml(getBranchName(acc.branchId))}` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--bg);">
      <div style="font-size:13px;"><strong>${escHtml(acc.username)}</strong>
        <span style="color:var(--text-muted);"> — ${typeLabel}${branchLabel}</span></div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="openUserAccountModal('${escJsAttr(acc.uid)}')">✏️</button>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);" onclick="deleteUserAccount('${escJsAttr(acc.uid)}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// ── Segmented pill selectors (نوع المستخدم / الصلاحية الأساسية) ──────
// Same visual pattern already used for the HR/Accounting/Purchases page
// tab switchers (a pill row inside a var(--bg-secondary) track) — reused
// here instead of a plain <select>, since each is only 2 options and this
// screen is security-relevant enough to read clearly at a glance instead
// of hiding the choice behind a dropdown.
function _setActivePill(prefix, options, value) {
  options.forEach(v => {
    const btn = document.getElementById(prefix + '_' + v);
    if (!btn) return;
    const active = v === value;
    btn.style.background = active ? 'white' : '';
    btn.style.fontWeight = active ? '700' : '400';
    btn.style.boxShadow = active ? '0 1px 4px rgba(0,0,0,.1)' : '';
  });
}
function setUserTypeValue(v) {
  document.getElementById('uaType').value = v;
  _setActivePill('uaTypeBtn', ['branch', 'admin'], v);
}
function setUserRoleValue(v) {
  document.getElementById('uaRole').value = v;
  _setActivePill('uaRoleBtn', ['cashier', 'manager'], v);
}
function selectUserType(v) { setUserTypeValue(v); onUserTypeChanged(); }
function selectUserRole(v) { setUserRoleValue(v); onUserTypeChanged(); }

// Cashier/manager permissions are FIXED (_FIXED_ROLE_GRANTS, 00-core.js) —
// the owner picked them directly, so the tree is hidden entirely for
// those two; only 'admin' is actually customizable per-account (see the
// long note on _defaultPermissionsFor). 2026-07-20, directly requested:
// "اللعب كله في يوزرات الأدمن".
function toggleUserAccountFields() {
  const isAdmin = document.getElementById('uaType').value === 'admin';
  document.getElementById('uaBranchOnlyFields').style.display = isAdmin ? 'none' : 'flex';
  document.getElementById('uaPermsSection').classList.toggle('hidden', !isAdmin);
  document.getElementById('uaFixedRoleNote').classList.toggle('hidden', isAdmin);
}
// Only called from uaType's/uaRole's onchange (a real user action) —
// resets the matrix to that type's template. openUserAccountModal() sets
// the matrix itself (from the account's saved permissions, or a fresh
// template for a new user) and must NOT go through this, or editing an
// existing user would silently wipe their real permissions back to the
// default.
function onUserTypeChanged() {
  toggleUserAccountFields();
  const isAdmin = document.getElementById('uaType').value === 'admin';
  applyPermissionTemplate(isAdmin ? 'admin' : document.getElementById('uaRole').value);
}

// ── Permissions tree (Department → Tab → optional sub-item) ─────────
// Only rows with a data-key hold real permission data (view/write
// checkboxes read/written by readPermsFromMatrix()/renderPermsMatrix()).
// Department rows and tab-with-children "parent" rows are pure UI
// conveniences — checking one cascades to every data-key row under it;
// their own checked/indeterminate state is always DERIVED from their
// children afterward (_refreshAllParentStates), never stored itself.
function renderPermsMatrix(perms) {
  const body = document.getElementById('uaPermsBody');
  if (!body) return;
  perms = perms || {};
  const rows = [];
  DEPARTMENTS.forEach(dept => {
    rows.push(`<tr class="perm-dept-row" data-dept="${dept.key}" style="background:var(--bg-secondary);">
      <td style="font-weight:700;">${escHtml(dept.label)}</td>
      <td style="text-align:center;"><input type="checkbox" class="perm-dept-view" onchange="_onDeptToggle('${dept.key}','view',this.checked)" /></td>
      <td style="text-align:center;"><input type="checkbox" class="perm-dept-write" onchange="_onDeptToggle('${dept.key}','write',this.checked)" /></td>
    </tr>`);
    dept.tabs.forEach(tab => {
      const warn = tab.enforced ? '' : ' ⚠️';
      const title = tab.enforced ? '' : ' title="التاب ده مالوش تخزين سحابي مخصص لسه — الإخفاء هنا شكلي بس، مش ممنوع فعلياً من قاعدة البيانات"';
      if (tab.children) {
        rows.push(`<tr class="perm-tab-row" data-tab="${tab.key}"${title}>
          <td style="padding-right:22px;font-weight:600;">${escHtml(tab.label)}${warn}</td>
          <td style="text-align:center;"><input type="checkbox" class="perm-tab-view" onchange="_onTabToggle('${tab.key}','view',this.checked)" /></td>
          <td style="text-align:center;"><input type="checkbox" class="perm-tab-write" onchange="_onTabToggle('${tab.key}','write',this.checked)" /></td>
        </tr>`);
        tab.children.forEach(child => {
          const p = perms[child.key] || { view: false, write: false };
          rows.push(`<tr data-dept="${dept.key}" data-tab="${tab.key}" data-key="${child.key}">
            <td style="padding-right:40px;color:var(--text-muted);">${escHtml(child.label)}</td>
            <td style="text-align:center;"><input type="checkbox" class="ua-perm-view" ${p.view ? 'checked' : ''} onchange="_onLeafViewChange(this)" /></td>
            <td style="text-align:center;"><input type="checkbox" class="ua-perm-write" ${p.write ? 'checked' : ''} onchange="_onLeafWriteChange(this)" /></td>
          </tr>`);
        });
      } else {
        const p = perms[tab.key] || { view: false, write: false };
        rows.push(`<tr data-dept="${dept.key}" data-key="${tab.key}"${title}>
          <td style="padding-right:22px;">${escHtml(tab.label)}${warn}</td>
          <td style="text-align:center;"><input type="checkbox" class="ua-perm-view" ${p.view ? 'checked' : ''} onchange="_onLeafViewChange(this)" /></td>
          <td style="text-align:center;"><input type="checkbox" class="ua-perm-write" ${p.write ? 'checked' : ''} onchange="_onLeafWriteChange(this)" /></td>
        </tr>`);
      }
    });
  });
  body.innerHTML = rows.join('');
  _refreshAllParentStates();
}
// Sets every data-key row's checkboxes under `selector` to `checked` for
// `kind` (view/write) — write implies view (can't sensibly edit a tab you
// can't see); unchecking view drops write too, same rule the single-row
// version always enforced, just applied to a whole batch at once.
function _setLeafCheckboxes(selector, kind, checked) {
  document.querySelectorAll(selector).forEach(row => {
    const viewCb = row.querySelector('.ua-perm-view');
    const writeCb = row.querySelector('.ua-perm-write');
    if (kind === 'view') { viewCb.checked = checked; if (!checked) writeCb.checked = false; }
    else { writeCb.checked = checked; if (checked) viewCb.checked = true; }
  });
}
function _onDeptToggle(deptKey, kind, checked) {
  _setLeafCheckboxes(`#uaPermsBody tr[data-dept="${deptKey}"][data-key]`, kind, checked);
  _refreshAllParentStates();
}
function _onTabToggle(tabKey, kind, checked) {
  _setLeafCheckboxes(`#uaPermsBody tr[data-tab="${tabKey}"][data-key]`, kind, checked);
  _refreshAllParentStates();
}
function _onLeafViewChange(cb) {
  if (!cb.checked) { const row = cb.closest('tr'); row.querySelector('.ua-perm-write').checked = false; }
  _refreshAllParentStates();
}
function _onLeafWriteChange(cb) {
  if (cb.checked) { const row = cb.closest('tr'); row.querySelector('.ua-perm-view').checked = true; }
  _refreshAllParentStates();
}
// Derives every department/tab-parent checkbox's checked/indeterminate
// state from its actual data-key children — these rows never hold their
// own value, so this always runs after any change anywhere in the tree.
function _refreshAllParentStates() {
  document.querySelectorAll('#uaPermsBody tr.perm-tab-row').forEach(row => {
    const tabKey = row.dataset.tab;
    ['view', 'write'].forEach(kind => {
      const kids = [...document.querySelectorAll(`#uaPermsBody tr[data-tab="${tabKey}"][data-key] .ua-perm-${kind}`)];
      const checkedCount = kids.filter(c => c.checked).length;
      const cb = row.querySelector('.perm-tab-' + kind);
      cb.checked = kids.length > 0 && checkedCount === kids.length;
      cb.indeterminate = checkedCount > 0 && checkedCount < kids.length;
    });
  });
  document.querySelectorAll('#uaPermsBody tr.perm-dept-row').forEach(row => {
    const deptKey = row.dataset.dept;
    ['view', 'write'].forEach(kind => {
      const leaves = [...document.querySelectorAll(`#uaPermsBody tr[data-dept="${deptKey}"][data-key] .ua-perm-${kind}`)];
      const checkedCount = leaves.filter(c => c.checked).length;
      const cb = row.querySelector('.perm-dept-' + kind);
      cb.checked = leaves.length > 0 && checkedCount === leaves.length;
      cb.indeterminate = checkedCount > 0 && checkedCount < leaves.length;
    });
  });
}
function readPermsFromMatrix() {
  const perms = {};
  document.querySelectorAll('#uaPermsBody tr[data-key]').forEach(row => {
    perms[row.dataset.key] = {
      view: row.querySelector('.ua-perm-view').checked,
      write: row.querySelector('.ua-perm-write').checked
    };
  });
  return perms;
}
function applyPermissionTemplate(role) {
  renderPermsMatrix(_defaultPermissionsFor(role));
}

function openUserAccountModal(uid) {
  const branchSel = document.getElementById('uaBranch');
  branchSel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}">${escHtml(getBranchName(b))}</option>`).join('');
  document.getElementById('uaEditId').value = uid || '';
  document.getElementById('uaMsg').innerHTML = '';
  const userInp = document.getElementById('uaUsername');
  const passInp = document.getElementById('uaPassword');
  if (uid) {
    const acc = _rolesListCache.find(a => a.uid === uid);
    if (!acc) return;
    document.getElementById('uaModalTitle').textContent = '✏️ تعديل مستخدم';
    // The username IS the Firebase account's email — it can't change
    // without creating a new account, and an admin can't set another
    // user's password from the client SDK (the user changes their own
    // from Settings, or delete + recreate the account).
    userInp.value = acc.username; userInp.disabled = true;
    passInp.value = ''; passInp.disabled = true;
    passInp.placeholder = 'المستخدم يغيّر كلمة سره بنفسه من الإعدادات';
    setUserTypeValue(acc.role === 'admin' ? 'admin' : 'branch');
    if (acc.role !== 'admin') {
      branchSel.value = acc.branchId || 'b1';
      setUserRoleValue(acc.role === 'manager' ? 'manager' : 'cashier');
    }
    renderPermsMatrix(acc.permissions || _defaultPermissionsFor(acc.role));
  } else {
    document.getElementById('uaModalTitle').textContent = '➕ إضافة مستخدم';
    userInp.value = ''; userInp.disabled = false;
    passInp.value = ''; passInp.disabled = false;
    passInp.placeholder = 'كلمة المرور (6 أحرف على الأقل)';
    setUserTypeValue('branch');
    setUserRoleValue('cashier');
    renderPermsMatrix(_defaultPermissionsFor('cashier'));
  }
  toggleUserAccountFields();
  const form = document.getElementById('uaInlineForm');
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeUserAccountModal() {
  document.getElementById('uaInlineForm').classList.add('hidden');
}

// Shared by save/delete so the audit log can label a role consistently
// regardless of which action touched the account.
const roleLabel = r => r === 'admin' ? 'أدمن' : (r === 'manager' ? 'مدير فرع' : 'كاشير');

async function saveUserAccount() {
  const uid      = document.getElementById('uaEditId').value;
  const username = document.getElementById('uaUsername').value.trim().toLowerCase();
  const passRaw  = document.getElementById('uaPassword').value;
  const type     = document.getElementById('uaType').value;
  const branchId = document.getElementById('uaBranch').value;
  const role     = document.getElementById('uaRole').value;
  const msg      = document.getElementById('uaMsg');
  const showErr  = t => { msg.innerHTML = `<div style="color:var(--danger);font-size:12px;">${t}</div>`; };

  const roleValue = type === 'admin' ? 'admin' : (role === 'manager' ? 'manager' : 'cashier');
  // 'admin' is just a label now — everyone's real access comes from this
  // matrix, the owner alone (isOwner()/isRealOwner) is the true bypass.
  const permissions = readPermsFromMatrix();

  if (uid) {
    // Edit = update the roles doc only (identity/password are Firebase Auth's)
    const existing = _rolesListCache.find(a => a.uid === uid);
    if (!existing) return;
    try {
      await firebase.firestore().collection('roles').doc(uid).set({
        role: roleValue,
        branchId: roleValue === 'admin' ? null : branchId,
        permissions,
      }, { merge: true });
    } catch (e) { showErr('تعذّر الحفظ: ' + e.message); return; }
    const changes = buildAuditDiff(
      { role: roleLabel(existing.role), branch: existing.branchId ? getBranchName(existing.branchId) : '-', perms: summarizePermissions(existing.permissions) },
      { role: roleLabel(roleValue), branch: roleValue !== 'admin' ? getBranchName(branchId) : '-', perms: summarizePermissions(permissions) },
      { role: 'النوع/الصلاحية', branch: 'الفرع', perms: 'الصلاحيات' }
    );
    addAuditLog('user.save', `تعديل صلاحيات: ${existing.username} (${roleLabel(roleValue)})`, currentBranch, changes);
  } else {
    // Create = real Firebase account (via secondary app) + roles doc
    if (!username || !/^[a-z0-9._-]+$/.test(username)) { showErr('اسم المستخدم: حروف إنجليزية وأرقام بس (من غير مسافات)'); return; }
    if (!passRaw || passRaw.length < 6) { showErr('كلمة المرور لازم تكون 6 أحرف على الأقل (شرط Firebase)'); return; }
    if (_rolesListCache.find(a => a.username === username)) { showErr('اسم المستخدم ده مستخدم بالفعل'); return; }
    try {
      await createManagedUser(username, passRaw, roleValue, roleValue === 'admin' ? null : branchId, permissions);
    } catch (e) {
      if (e && e.code === 'auth/email-already-in-use') showErr('اسم المستخدم ده عليه حساب بالفعل');
      else if (e && e.code === 'auth/weak-password') showErr('كلمة المرور ضعيفة — 6 أحرف على الأقل');
      else showErr('تعذّر إنشاء الحساب: ' + (e.message || e));
      return;
    }
    const createdChanges = buildAuditDiff(
      null,
      { username, role: roleLabel(roleValue), branch: roleValue !== 'admin' ? getBranchName(branchId) : '-', perms: summarizePermissions(permissions) },
      { username: 'اسم المستخدم', role: 'النوع/الصلاحية', branch: 'الفرع', perms: 'الصلاحيات' }
    );
    addAuditLog('user.save', `إنشاء مستخدم: ${username} (${roleLabel(roleValue)})`, currentBranch, createdChanges);
  }

  renderUserAccountsSettings();
  closeUserAccountModal();
  showMsg('sSettingsMsg', '✅ تم حفظ المستخدم');
}

function deleteUserAccount(uid) {
  const acc = _rolesListCache.find(a => a.uid === uid);
  if (!acc) return;
  showConfirmModal(`حذف المستخدم "${acc.username}"؟ سيفقد كل صلاحيات الوصول فوراً.`, function() {
    // Removing the roles doc revokes ALL Firebase-based access server-side
    // (see firestore.rules) — but _legacyLogin() in 05-utils.js also
    // checks two OLDER, independent credential stores that predate the
    // Firebase rollout: getAccounts() (synced via pos_data/accounts) and
    // getBranchUsers() (per-branch, local-only). Neither is touched by
    // deleting the roles doc, so a username that also has a leftover
    // entry there (common for staff who predate the Firebase migration)
    // could still fully log in locally after being "deleted" here —
    // discovered 2026-07-20 when a removed employee could still log in.
    // Purge matching entries from both so deletion is actually final.
    const uname = (acc.username || '').toLowerCase();
    setAccounts(getAccounts().filter(a => (a.username || '').toLowerCase() !== uname));
    const bUsers = getBranchUsers();
    let bChanged = false;
    Object.keys(bUsers).forEach(b => {
      if (bUsers[b] && (bUsers[b].username || '').toLowerCase() === uname) {
        bUsers[b] = { username: '', password: '' };
        bChanged = true;
      }
    });
    if (bChanged) setBranchUsers(bUsers);

    firebase.firestore().collection('roles').doc(uid).delete()
      .then(() => {
        renderUserAccountsSettings();
        const deletedChanges = buildAuditDiff(
          { role: roleLabel(acc.role), branch: acc.branchId ? getBranchName(acc.branchId) : '-', perms: summarizePermissions(acc.permissions) },
          {},
          { role: 'النوع/الصلاحية', branch: 'الفرع', perms: 'الصلاحيات' }
        );
        addAuditLog('user.delete', `تم حذف مستخدم: ${acc.username} (شامل أي حساب دخول محلي قديم بنفس الاسم)`, currentBranch, deletedChanges);
        showMsg('sSettingsMsg', '✅ تم حذف المستخدم وسحب صلاحياته');
      })
      .catch(e => showMsg('sSettingsMsg', 'تعذّر الحذف: ' + e.message, 'danger'));
  });
}

// ── LEGACY LOCAL LOGIN CLEANUP ───────────────────────────────────
// Surfaces every account _legacyLogin() (05-utils.js) would still accept
// that isn't the new Firebase/roles system — so the admin can see and
// clear exactly what's letting a "deleted" user keep logging in locally.
// deleteUserAccount() now purges matches automatically going forward;
// this is for entries left over from BEFORE that fix existed.
function renderLegacyLoginCleanup() {
  const container = document.getElementById('legacyLoginContainer');
  if (!container) return;
  const rows = [];

  getAccounts().forEach((a, idx) => {
    rows.push({
      label: `${escHtml(a.username || '?')} — ${a.type === 'admin' ? 'أدمن' : (a.role === 'manager' ? 'مدير فرع' : 'كاشير')}${a.branchId ? ' — ' + escHtml(getBranchName(a.branchId)) : ''}`,
      sub: 'حساب دخول محلي قديم (متزامن)',
      onDelete: `removeLegacyAccount(${idx})`
    });
  });

  const bUsers = getBranchUsers();
  BRANCH_IDS.forEach(b => {
    const bu = bUsers[b];
    // An empty password can never match (checkPass short-circuits on a
    // falsy stored value) — skip the harmless untouched-default slots so
    // the list only shows accounts that could actually still log in.
    if (bu && bu.username && bu.password) {
      rows.push({
        label: `${escHtml(bu.username)} — ${escHtml(getBranchName(b))}`,
        sub: 'حساب دخول محلي قديم (على الجهاز ده بس)',
        onDelete: `removeLegacyBranchUser('${escJsAttr(b)}')`
      });
    }
  });

  const users = getUsers();
  if (users.admin) rows.push({ label: 'admin', sub: 'حساب أدمن محلي قديم (على الجهاز ده بس)', onDelete: `removeLegacyFixedUser('admin')` });
  if (users.cashier) rows.push({ label: 'cashier', sub: 'حساب كاشير محلي قديم (على الجهاز ده بس)', onDelete: `removeLegacyFixedUser('cashier')` });

  container.innerHTML = !rows.length
    ? '<div style="font-size:13px;color:var(--text-muted);">مفيش حسابات دخول محلية قديمة متبقية 👍</div>'
    : rows.map(r => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--bg);">
        <div style="font-size:13px;"><strong>${r.label}</strong><span style="color:var(--text-muted);"> — ${r.sub}</span></div>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);border-color:var(--danger);" onclick="${r.onDelete}">🗑️ حذف</button>
      </div>`).join('');
}
function removeLegacyAccount(idx) {
  const list = getAccounts();
  const acc = list[idx];
  if (!acc) return;
  setAccounts(list.filter((_, i) => i !== idx));
  addAuditLog('user.delete', `حذف حساب دخول محلي قديم: ${acc.username}`, currentBranch);
  renderLegacyLoginCleanup();
  showMsg('sSettingsMsg', '✅ اتحذف');
}
function removeLegacyBranchUser(b) {
  const bUsers = getBranchUsers();
  const uname = bUsers[b] && bUsers[b].username;
  bUsers[b] = { username: '', password: '' };
  setBranchUsers(bUsers);
  addAuditLog('user.delete', `حذف حساب دخول محلي قديم: ${uname} (${getBranchName(b)})`, currentBranch);
  renderLegacyLoginCleanup();
  showMsg('sSettingsMsg', '✅ اتحذف');
}
function removeLegacyFixedUser(role) {
  const users = getUsers();
  users[role] = '';
  setUsers(users);
  addAuditLog('user.delete', `حذف حساب دخول محلي قديم: ${role}`, currentBranch);
  renderLegacyLoginCleanup();
  showMsg('sSettingsMsg', '✅ اتحذف');
}

function changePass(role) {
  const curr = document.getElementById('sCurrPass').value;
  const np   = document.getElementById('sNewPass').value;
  const fu   = (typeof firebase !== 'undefined' && firebase.apps.length) ? firebase.auth().currentUser : null;

  if (fu && fu.email) {
    // Real account: reauthenticate then update in Firebase Auth
    if (np.length < 6) { showMsg('sAdminMsg','كلمة المرور لازم تكون 6 أحرف على الأقل','danger'); return; }
    const cred = firebase.auth.EmailAuthProvider.credential(fu.email, curr);
    fu.reauthenticateWithCredential(cred)
      .then(() => fu.updatePassword(np))
      .then(() => {
        showMsg('sAdminMsg','✅ تم تغيير كلمة المرور');
        document.getElementById('sCurrPass').value = '';
        document.getElementById('sNewPass').value  = '';
      })
      .catch(e => {
        if (e && (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'))
          showMsg('sAdminMsg','كلمة المرور الحالية غلط','danger');
        else showMsg('sAdminMsg','تعذّر التغيير: ' + e.message,'danger');
      });
    return;
  }

  // Legacy/offline session: local admin password on this device
  const users = getUsers();
  checkPass(curr, users.admin).then(ok => {
    if (!ok) { showMsg('sAdminMsg','كلمة المرور الحالية غلط','danger'); return; }
    if (np.length < 4) { showMsg('sAdminMsg','يجب أن تكون 4 أحرف على الأقل','danger'); return; }
    hashPass(np).then(hashed => {
      users.admin = hashed;
      setUsersLocal(users);
      showMsg('sAdminMsg','✅ تم تغيير كلمة المرور (محلياً)');
      document.getElementById('sCurrPass').value = '';
      document.getElementById('sNewPass').value  = '';
    });
  });
}

function saveSettings() {
  const oldThreshold = getThreshold();
  const oldVip = _settingsCache.vipThreshold || 1000;
  const v = parseInt(document.getElementById('sLowThreshold').value) || 5;
  setThreshold(v);
  const vip = parseInt(document.getElementById('sVipThreshold')?.value) || 1000;
  _settingsCache.vipThreshold = vip;
  saveSettingsCache();
  const changes = buildAuditDiff(
    { threshold: oldThreshold, vip: oldVip },
    { threshold: v, vip },
    { threshold: 'حد تنبيه المخزون المنخفض', vip: 'حد VIP' }
  );
  if (changes.length) addAuditLog('settings.change', 'تعديل إعدادات المخزون', currentBranch, changes);
  showMsg('sSettingsMsg','تم حفظ الإعدادات');
}

function _sellerBranchOptionsHtml(selected) {
  return '<option value="">🏬 كل الفروع</option>' +
    BRANCH_IDS.filter(function(b){ return b !== 'wh'; }).map(function(b) {
      return `<option value="${b}" ${selected===b?'selected':''}>${escHtml(getBranchName(b))}</option>`;
    }).join('');
}

function renderSellersSettings() {
  const wrap = document.getElementById('sellersListWrap');
  if (!wrap) return;
  const people = getSalespeople();
  wrap.innerHTML = people.map((sp,i) => {
    const n = salespersonName(sp);
    return `
    <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid var(--border);border-radius:20px;padding:5px 6px 5px 12px;font-size:13px;font-weight:600;">
      <span>👤 ${escHtml(n)}</span>
      <input type="number" min="0" value="${salespersonBaseSalary(sp) || ''}" placeholder="راتب أساسي" title="الراتب الأساسي"
        onchange="changeSellerBaseSalary('${escHtml(n).replace(/'/g,"\\'")}', this.value)"
        style="width:88px;border:1px solid var(--border);border-radius:12px;font-size:11px;padding:2px 6px;background:white;" />
      <select onchange="changeSellerBranch('${escHtml(n).replace(/'/g,"\\'")}', this.value)" style="border:1px solid var(--border);border-radius:12px;font-size:11px;padding:2px 6px;background:white;">
        ${_sellerBranchOptionsHtml(getSellerBranch(n))}
      </select>
      <button onclick="removeSeller(${i})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;line-height:1;padding:0 2px;" title="حذف">×</button>
    </div>`;
  }).join('');
  const newBranchSel = document.getElementById('sNewSellerBranch');
  if (newBranchSel && newBranchSel.options.length <= 1) newBranchSel.innerHTML = _sellerBranchOptionsHtml('');
}

function changeSellerBranch(name, branchId) {
  setSellerBranch(name, branchId || null);
  showMsg('sSellersMsg', branchId ? `تم نقل ${name} إلى ${getBranchName(branchId)}` : `${name} بقى شغال في كل الفروع`);
}

// Upgrades a plain-string entry to {name, baseSalary} in place the first
// time its base salary is set — every other consumer of getSalespeople()
// already tolerates both shapes (see salespersonName/salespersonBaseSalary
// in 00-core.js), so this doesn't require touching them.
function changeSellerBaseSalary(name, val) {
  const amount = Math.max(0, parseFloat(val) || 0);
  const arr = [...getSalespeople()];
  const idx = arr.findIndex(sp => salespersonName(sp) === name);
  if (idx < 0) return;
  arr[idx] = { name, baseSalary: amount };
  setSalespeople(arr);
  showMsg('sSellersMsg', amount > 0 ? `تم ضبط الراتب الأساسي لـ ${name}: ${fmt(amount)} ج` : `تم مسح الراتب الأساسي لـ ${name}`);
}

function addSeller() {
  const inp = document.getElementById('sNewSeller');
  const name = inp.value.trim();
  if (!name) return;
  const arr = [...getSalespeople()];
  if (arr.some(sp => salespersonName(sp) === name)) { showMsg('sSellersMsg','الاسم موجود بالفعل','danger'); return; }
  const baseSalaryInp = document.getElementById('sNewSellerBaseSalary');
  const baseSalary = Math.max(0, parseFloat(baseSalaryInp?.value) || 0);
  arr.push(baseSalary > 0 ? { name, baseSalary } : name);
  const branchSel = document.getElementById('sNewSellerBranch');
  if (branchSel && branchSel.value) setSellerBranch(name, branchSel.value);
  setSalespeople(arr);
  inp.value = '';
  if (baseSalaryInp) baseSalaryInp.value = '';
  if (branchSel) branchSel.value = '';
  showMsg('sSellersMsg','تمت الإضافة');
}

function removeSeller(idx) {
  const arr = [...getSalespeople()];
  if (arr.length <= 1) { showMsg('sSellersMsg','لازم يكون فيه بائع واحد على الأقل','danger'); return; }
  const removedName = salespersonName(arr[idx]);
  arr.splice(idx, 1);
  setSalespeople(arr);
  setSellerBranch(removedName, null);
  showMsg('sSellersMsg','تم الحذف');
}

function resetSales() {
  showConfirmModal('حذف كل المبيعات نهائياً؟', function() {
    setSales([]);
    showMsg('sSettingsMsg','تم حذف سجل المبيعات','warning');
  });
}

function resetAll() {
  showConfirmModal('حذف كل البيانات (المخزون + المبيعات)؟', function() {
    showConfirmModal('تأكيد أخير — هذا لا يمكن التراجع عنه', _resetAllConfirmed);
  });
}

function _resetAllConfirmed() {
  ['inv','sales','pos_suspended','threshold','pos_transfers']
    .concat(BRANCH_IDS.map(b=>`pos_inv_${b}`))
    .forEach(k => localStorage.removeItem(k));
  if (_fbReady) {
    // Inventory now lives at pos_data/inventory/branches/{branchId} (see
    // setInv() in 00-core.js, restructured 2026-07-17 for real per-branch
    // isolation) — delete BOTH that and the legacy flat inv_{b} docs, or a
    // "reset everything" that only wiped the old path would leave the
    // actual live stock data fully intact.
    BRANCH_IDS.forEach(b => {
      _db.collection('pos_data').doc(`inv_${b}`).delete().catch(()=>{});
      _db.collection('pos_data').doc('inventory').collection('branches').doc(b).delete().catch(()=>{});
    });
    _db.collection('pos_data').doc('inv').delete().catch(()=>{});
    _db.collection('pos_data').doc('suspended').delete().catch(()=>{});
    _db.collection('pos_data').doc('transfers').delete().catch(()=>{});
  }
  // Sales: setSales([]) already deletes both the legacy flat month docs and
  // the new pos_sales/{month}/branches/{branchId} structure across a
  // 24-month window (see 00-core.js) — no need to duplicate that logic here.
  setSales([]);
  _invCacheByBranch = {}; BRANCH_IDS.forEach(b => _invCacheByBranch[b] = []);
  _suspendCache = []; _transfersCache = [];
  // كان بيمسح doc الإعدادات بالكامل من Firestore ويستبدل _settingsCache
  // كله بـ {threshold:5} — يعني "حذف كل البيانات (المخزون + المبيعات)"
  // (نص الرسالتين اللي المستخدم بيأكدهم) كان فعليًا بيمسح كمان أسماء
  // الفروع، قايمة البائعين، توزيعهم على الفروع، وحد الـ VIP، من غير أي
  // تحذير عن كده. threshold بس هو اللي مفروض يترجع للافتراضي هنا —
  // saveSettingsCache() بتحفظ نسخة الـ cache زي ما هي دلوقتي (بعد تعديل
  // threshold بس) بدل ما تمسح الدوك كله.
  _settingsCache.threshold = 5;
  // بيتقارن بيه أي جهاز تاني لسه فاتح كاش محلي قديم لما يرجع يتصل — لو
  // كان آخر تعديل محلي عنده قبل اللحظة دي، السيستم بيرفض يرجّعه للسحابة
  // بدل ما يبعته تلقائي (شوف _setLocalInv/_localInvTs في 00-core.js
  // و_localSalesFallbackForReseed هنا) — نفس آلية بقاء بيانات الديمو
  // قبل كده، بس عامة لأي كاش قديم مش بس بيانات الديمو.
  _settingsCache.resetAt = Date.now();
  saveSettingsCache();
  showMsg('sSettingsMsg','تم حذف كل البيانات','danger');
}


// ══════════════════════════════════════════════════════════════════
// حذف بيانات فرع واحد (المالك فقط)
//
// The existing resetSales/resetAll are all-or-nothing across every branch.
// Clearing one branch — a warehouse stocked by mistake, a branch that closed,
// a test branch — meant wiping the lot. These do one branch at a time.
//
// Guarded harder than the old buttons, because they act on live data and
// there is no undo: owner only, a count of exactly what is about to go, the
// branch name typed out by hand, and an audit entry written BEFORE the delete
// so the record survives even if the delete half-fails.
// ══════════════════════════════════════════════════════════════════
function renderBranchWipeUI() {
  const sel = document.getElementById('bwBranch');
  if (!sel) return;
  const names = getBranches();
  sel.innerHTML = BRANCH_IDS.map(function (b) {
    return '<option value="' + b + '">' + escHtml(names[b] || BRANCH_DEFAULTS[b] || b) + '</option>';
  }).join('');
  bwRefreshCounts();
}

// What's actually there, so the confirmation isn't abstract.
function bwRefreshCounts() {
  const b  = document.getElementById('bwBranch').value;
  const el = document.getElementById('bwCounts');
  if (!b || !el) return;
  const inv    = getInv(b);
  const value  = inv.reduce(function (t, p) { return t + (parseFloat(p.cost) || 0) * (parseInt(p.qty) || 0); }, 0);
  const sales  = getSales().filter(function (s) { return s.branchId === b; });
  const rev    = sales.reduce(function (t, s) { return t + (parseFloat(s.total) || 0); }, 0);
  el.innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">'
    + '<span>📦 <strong>' + inv.length + '</strong> صنف بقيمة <strong>' + fmt(value) + ' ج</strong></span>'
    + '<span>🧾 <strong>' + sales.length + '</strong> فاتورة بإجمالي <strong>' + fmt(rev) + ' ج</strong></span>'
    + '</div>';
}

// Branch names can carry decoration the user can't reasonably retype — the
// warehouse is stored as "🏭 المخزن الرئيسي", so typing the words correctly was
// rejected for a missing emoji. Compare letters and digits only: still a
// deliberate act of typing the name, without demanding an emoji.
function _bwNormalizeName(s) {
  return String(s || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

function _bwConfirm(branchId, what, countText, run) {
  if (!isRealOwner) { showMsg('bwMsg', 'حذف بيانات الفرع للمالك فقط', 'danger'); return; }
  const name = getBranchName(branchId);
  showPromptModal(
    '⚠️ حذف ' + what + ' فرع "' + name + '" نهائياً — ' + countText + '.\n'
    + 'مفيش تراجع. اكتب اسم الفرع للتأكيد:',
    '',
    function (typed) {
      if (_bwNormalizeName(typed) !== _bwNormalizeName(name)) {
        showMsg('bwMsg', 'الاسم مش مطابق — ما اتحذفش حاجة', 'warning');
        return;
      }
      run();
      bwRefreshCounts();
      renderInventory();
    }
  );
}

function wipeBranchInventory() {
  const b   = document.getElementById('bwBranch').value;
  const inv = getInv(b);
  if (!inv.length) { showMsg('bwMsg', 'الفرع ده مفيهوش مخزون أصلاً', 'warning'); return; }
  const value = inv.reduce(function (t, p) { return t + (parseFloat(p.cost) || 0) * (parseInt(p.qty) || 0); }, 0);

  _bwConfirm(b, 'مخزون', inv.length + ' صنف بقيمة ' + fmt(value) + ' ج', function () {
    // Logged first: if the delete only partly lands, the record of what was
    // attempted still exists.
    addAuditLog('branch.wipe.inventory',
      'حذف مخزون فرع ' + getBranchName(b) + ' — ' + inv.length + ' صنف بقيمة ' + fmt(value) + ' ج', b);

    _invCacheByBranch[b] = [];
    DB.s('pos_inv_' + b, []);
    if (_fbReady && _db) {
      // Emptied, not deleted: the listener in initFirebase subscribes to this
      // document, and a branch whose document is missing reads as "no data
      // yet" rather than "no stock" on every device.
      _db.collection('pos_data').doc('inventory').collection('branches').doc(b)
         .set({ branchId: b, items: [], updatedAt: Date.now() })
         .catch(function (e) { console.error('wipeBranchInventory:', e); });
    }
    showMsg('bwMsg', '🗑️ اتمسح مخزون ' + getBranchName(b) + ' (' + inv.length + ' صنف)', 'danger');
  });
}

function wipeBranchSales() {
  const b     = document.getElementById('bwBranch').value;
  const sales = getSales().filter(function (s) { return s.branchId === b; });
  if (!sales.length) { showMsg('bwMsg', 'الفرع ده مفيهوش مبيعات', 'warning'); return; }
  const rev = sales.reduce(function (t, s) { return t + (parseFloat(s.total) || 0); }, 0);

  _bwConfirm(b, 'مبيعات', sales.length + ' فاتورة بإجمالي ' + fmt(rev) + ' ج (آخر 12 شهر)', function () {
    addAuditLog('branch.wipe.sales',
      'حذف مبيعات فرع ' + getBranchName(b) + ' — ' + sales.length + ' فاتورة بإجمالي ' + fmt(rev) + ' ج', b);

    // ⚠️ 12, not 24. The listener only caches 12 months (`_saMonths` in
    // 65-firebase.js), so getSales() — and therefore the count the owner just
    // approved — can only ever see 12. Deleting 24 destroyed up to a year of
    // history that was never counted, named or shown before the confirmation.
    // The two windows have to agree; widening the count instead would mean
    // reading a year of documents just to draw a dialog.
    if (_fbReady && _db) {
      const batch = _db.batch();
      for (let i = 0; i < 12; i++) {
        const d = new Date(); d.setMonth(d.getMonth() - i);
        const month = d.toISOString().slice(0, 7);
        batch.delete(_db.collection('pos_sales').doc(month).collection('branches').doc(b));
      }
      batch.commit().catch(function (e) { console.error('wipeBranchSales:', e); });
    }
    _salesCache = getSales().filter(function (s) { return s.branchId !== b; });
    DB.s('sales', _salesCache);
    showMsg('bwMsg', '🗑️ اتمسحت مبيعات ' + getBranchName(b) + ' (' + sales.length + ' فاتورة)', 'danger');
  });
}
