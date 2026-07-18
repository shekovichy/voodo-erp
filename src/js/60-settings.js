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

function toggleUserAccountFields() {
  const isAdmin = document.getElementById('uaType').value === 'admin';
  document.getElementById('uaBranchFields').style.display = isAdmin ? 'none' : 'flex';
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
    document.getElementById('uaType').value = acc.role === 'admin' ? 'admin' : 'branch';
    if (acc.role !== 'admin') {
      branchSel.value = acc.branchId || 'b1';
      document.getElementById('uaRole').value = acc.role === 'manager' ? 'manager' : 'cashier';
    }
  } else {
    document.getElementById('uaModalTitle').textContent = '➕ إضافة مستخدم';
    userInp.value = ''; userInp.disabled = false;
    passInp.value = ''; passInp.disabled = false;
    passInp.placeholder = 'كلمة المرور (6 أحرف على الأقل)';
    document.getElementById('uaType').value = 'branch';
    document.getElementById('uaRole').value = 'cashier';
  }
  toggleUserAccountFields();
  document.getElementById('userAccountModal').classList.remove('hidden');
}

function closeUserAccountModal() {
  document.getElementById('userAccountModal').classList.add('hidden');
}

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
  const roleLabel = r => r === 'admin' ? 'أدمن' : (r === 'manager' ? 'مدير فرع' : 'كاشير');

  if (uid) {
    // Edit = update the roles doc only (identity/password are Firebase Auth's)
    const existing = _rolesListCache.find(a => a.uid === uid);
    if (!existing) return;
    try {
      await firebase.firestore().collection('roles').doc(uid).set({
        role: roleValue,
        branchId: roleValue === 'admin' ? null : branchId,
      }, { merge: true });
    } catch (e) { showErr('تعذّر الحفظ: ' + e.message); return; }
    const changes = buildAuditDiff(
      { role: roleLabel(existing.role), branch: existing.branchId ? getBranchName(existing.branchId) : '-' },
      { role: roleLabel(roleValue), branch: roleValue !== 'admin' ? getBranchName(branchId) : '-' },
      { role: 'النوع/الصلاحية', branch: 'الفرع' }
    );
    addAuditLog('user.save', `تعديل صلاحيات: ${existing.username} (${roleLabel(roleValue)})`, currentBranch, changes);
  } else {
    // Create = real Firebase account (via secondary app) + roles doc
    if (!username || !/^[a-z0-9._-]+$/.test(username)) { showErr('اسم المستخدم: حروف إنجليزية وأرقام بس (من غير مسافات)'); return; }
    if (!passRaw || passRaw.length < 6) { showErr('كلمة المرور لازم تكون 6 أحرف على الأقل (شرط Firebase)'); return; }
    if (_rolesListCache.find(a => a.username === username)) { showErr('اسم المستخدم ده مستخدم بالفعل'); return; }
    try {
      await createManagedUser(username, passRaw, roleValue, roleValue === 'admin' ? null : branchId);
    } catch (e) {
      if (e && e.code === 'auth/email-already-in-use') showErr('اسم المستخدم ده عليه حساب بالفعل');
      else if (e && e.code === 'auth/weak-password') showErr('كلمة المرور ضعيفة — 6 أحرف على الأقل');
      else showErr('تعذّر إنشاء الحساب: ' + (e.message || e));
      return;
    }
    addAuditLog('user.save', `إنشاء مستخدم: ${username} (${roleLabel(roleValue)})`, currentBranch);
  }

  renderUserAccountsSettings();
  closeUserAccountModal();
  showMsg('sSettingsMsg', '✅ تم حفظ المستخدم');
}

function deleteUserAccount(uid) {
  const acc = _rolesListCache.find(a => a.uid === uid);
  if (!acc) return;
  showConfirmModal(`حذف المستخدم "${acc.username}"؟ سيفقد كل صلاحيات الوصول فوراً.`, function() {
    // Removing the roles doc revokes ALL access server-side (see
    // firestore.rules). The orphaned Firebase Auth account is harmless —
    // deleting it needs the Admin SDK, which a client app doesn't have.
    firebase.firestore().collection('roles').doc(uid).delete()
      .then(() => {
        renderUserAccountsSettings();
        addAuditLog('user.delete', `تم حذف مستخدم: ${acc.username}`, currentBranch);
        showMsg('sSettingsMsg', '✅ تم حذف المستخدم وسحب صلاحياته');
      })
      .catch(e => showMsg('sSettingsMsg', 'تعذّر الحذف: ' + e.message, 'danger'));
  });
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
  wrap.innerHTML = people.map((n,i) => `
    <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid var(--border);border-radius:20px;padding:5px 6px 5px 12px;font-size:13px;font-weight:600;">
      <span>👤 ${escHtml(n)}</span>
      <select onchange="changeSellerBranch('${escHtml(n).replace(/'/g,"\\'")}', this.value)" style="border:1px solid var(--border);border-radius:12px;font-size:11px;padding:2px 6px;background:white;">
        ${_sellerBranchOptionsHtml(getSellerBranch(n))}
      </select>
      <button onclick="removeSeller(${i})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;line-height:1;padding:0 2px;" title="حذف">×</button>
    </div>`).join('');
  const newBranchSel = document.getElementById('sNewSellerBranch');
  if (newBranchSel && newBranchSel.options.length <= 1) newBranchSel.innerHTML = _sellerBranchOptionsHtml('');
}

function changeSellerBranch(name, branchId) {
  setSellerBranch(name, branchId || null);
  showMsg('sSellersMsg', branchId ? `تم نقل ${name} إلى ${getBranchName(branchId)}` : `${name} بقى شغال في كل الفروع`);
}

function addSeller() {
  const inp = document.getElementById('sNewSeller');
  const name = inp.value.trim();
  if (!name) return;
  const arr = [...getSalespeople()];
  if (arr.includes(name)) { showMsg('sSellersMsg','الاسم موجود بالفعل','danger'); return; }
  arr.push(name);
  const branchSel = document.getElementById('sNewSellerBranch');
  if (branchSel && branchSel.value) setSellerBranch(name, branchSel.value);
  setSalespeople(arr);
  inp.value = '';
  if (branchSel) branchSel.value = '';
  showMsg('sSellersMsg','تمت الإضافة');
}

function removeSeller(idx) {
  const arr = [...getSalespeople()];
  if (arr.length <= 1) { showMsg('sSellersMsg','لازم يكون فيه بائع واحد على الأقل','danger'); return; }
  const removedName = arr[idx];
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
    _db.collection('pos_data').doc('settings').delete().catch(()=>{});
    _db.collection('pos_data').doc('transfers').delete().catch(()=>{});
  }
  // Sales: setSales([]) already deletes both the legacy flat month docs and
  // the new pos_sales/{month}/branches/{branchId} structure across a
  // 24-month window (see 00-core.js) — no need to duplicate that logic here.
  setSales([]);
  _invCacheByBranch = {}; BRANCH_IDS.forEach(b => _invCacheByBranch[b] = []);
  _suspendCache = []; _transfersCache = [];
  _settingsCache = { threshold: 5 };
  showMsg('sSettingsMsg','تم حذف كل البيانات','danger');
}

