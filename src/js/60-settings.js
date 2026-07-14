// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════
// ── USER ACCOUNTS (admin-managed) ──────────────────────────────
// One-time import of any real credentials already sitting in the old
// per-branch-slot storage on THIS device, so whichever device the admin
// used to set up real branch logins before doesn't lose them — they get
// published to Firestore (pos_data/accounts) the first time this renders.
function _migrateLegacyBranchUsersOnce() {
  if (DB.g('pos_accounts_migrated_v1', false)) return;
  DB.s('pos_accounts_migrated_v1', true);
  const legacy = getBranchUsers();
  const accounts = getAccounts();
  const additions = [];
  BRANCH_IDS.forEach(b => {
    const lu = legacy[b];
    if (lu && lu.username && lu.password &&
        !accounts.find(a => a.username.toLowerCase() === (lu.username || '').toLowerCase())) {
      additions.push({
        id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '_' + b,
        username: lu.username, password: lu.password,
        type: 'branch', branchId: b, role: lu.role || 'cashier',
      });
    }
  });
  if (additions.length) setAccounts([...accounts, ...additions]);
}

function renderUserAccountsSettings() {
  _migrateLegacyBranchUsersOnce();
  const container = document.getElementById('userAccountsContainer');
  if (!container) return;
  const accounts = getAccounts();
  if (!accounts.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">لا يوجد مستخدمين بعد — اضغط "إضافة مستخدم"</div>';
    return;
  }
  container.innerHTML = accounts.map(acc => {
    const typeLabel   = acc.type === 'admin' ? '👑 أدمن' : (acc.role === 'manager' ? '🧑‍💼 مدير فرع' : '🧑‍💻 كاشير');
    const branchLabel = acc.type === 'branch' ? ` — ${escHtml(getBranchName(acc.branchId))}` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--bg);">
      <div style="font-size:13px;"><strong>${escHtml(acc.username)}</strong>
        <span style="color:var(--text-muted);"> — ${typeLabel}${branchLabel}</span></div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;" onclick="openUserAccountModal('${acc.id}')">✏️</button>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);" onclick="deleteUserAccount('${acc.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function toggleUserAccountFields() {
  const isAdmin = document.getElementById('uaType').value === 'admin';
  document.getElementById('uaBranchFields').style.display = isAdmin ? 'none' : 'flex';
}

function openUserAccountModal(id) {
  const branchSel = document.getElementById('uaBranch');
  branchSel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}">${escHtml(getBranchName(b))}</option>`).join('');
  document.getElementById('uaEditId').value = id || '';
  document.getElementById('uaMsg').innerHTML = '';
  if (id) {
    const acc = getAccounts().find(a => a.id === id);
    if (!acc) return;
    document.getElementById('uaModalTitle').textContent = '✏️ تعديل مستخدم';
    document.getElementById('uaUsername').value = acc.username;
    document.getElementById('uaPassword').value = '';
    document.getElementById('uaPassword').placeholder = 'اتركها فارغة للإبقاء على نفس كلمة المرور';
    document.getElementById('uaType').value = acc.type;
    if (acc.type === 'branch') {
      branchSel.value = acc.branchId;
      document.getElementById('uaRole').value = acc.role || 'cashier';
    }
  } else {
    document.getElementById('uaModalTitle').textContent = '➕ إضافة مستخدم';
    document.getElementById('uaUsername').value = '';
    document.getElementById('uaPassword').value = '';
    document.getElementById('uaPassword').placeholder = 'password';
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
  const id       = document.getElementById('uaEditId').value;
  const username = document.getElementById('uaUsername').value.trim().toLowerCase();
  const passRaw  = document.getElementById('uaPassword').value;
  const type     = document.getElementById('uaType').value;
  const branchId = document.getElementById('uaBranch').value;
  const role     = document.getElementById('uaRole').value;
  const msg      = document.getElementById('uaMsg');

  if (!username) { msg.innerHTML = '<div style="color:var(--danger);font-size:12px;">اكتب اسم مستخدم</div>'; return; }
  if (['admin', 'cashier'].includes(username)) { msg.innerHTML = '<div style="color:var(--danger);font-size:12px;">اسم المستخدم ده محجوز</div>'; return; }

  const accounts = getAccounts();
  if (accounts.find(a => a.username.toLowerCase() === username && a.id !== id)) {
    msg.innerHTML = '<div style="color:var(--danger);font-size:12px;">اسم المستخدم ده مستخدم بالفعل</div>'; return;
  }

  const existing = id ? accounts.find(a => a.id === id) : null;
  if (!existing && (!passRaw || passRaw.length < 4)) {
    msg.innerHTML = '<div style="color:var(--danger);font-size:12px;">كلمة المرور لازم تكون 4 أحرف على الأقل</div>'; return;
  }
  const password = passRaw && passRaw.length >= 4 ? await hashPass(passRaw) : (existing ? existing.password : '');

  const record = {
    id: id || ('u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    username, password, type,
    branchId: type === 'branch' ? branchId : null,
    role:     type === 'branch' ? role : null,
  };

  const roleLabel = a => a.type === 'admin' ? 'أدمن' : (a.role === 'manager' ? 'مدير فرع' : 'كاشير');
  const changes = existing ? buildAuditDiff(
    { username: existing.username, role: roleLabel(existing), branch: existing.branchId ? getBranchName(existing.branchId) : '-' },
    { username: record.username, role: roleLabel(record), branch: record.branchId ? getBranchName(record.branchId) : '-' },
    { username: 'اسم المستخدم', role: 'النوع/الصلاحية', branch: 'الفرع' }
  ) : null;
  if (changes && existing.password !== record.password) changes.push({ label: 'كلمة المرور', before: '••••', after: '(تم التغيير)' });

  setAccounts(id ? accounts.map(a => a.id === id ? record : a) : [...accounts, record]);
  renderUserAccountsSettings();
  closeUserAccountModal();
  showMsg('sSettingsMsg', '✅ تم حفظ المستخدم');
  addAuditLog('user.save', `تم حفظ مستخدم: ${username} (${roleLabel(record)})`, currentBranch, changes);
}

function deleteUserAccount(id) {
  const accounts = getAccounts();
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  if (!confirm(`حذف المستخدم "${acc.username}"؟`)) return;
  setAccounts(accounts.filter(a => a.id !== id));
  renderUserAccountsSettings();
  addAuditLog('user.delete', `تم حذف مستخدم: ${acc.username}`, currentBranch);
}

function changePass(role) {
  const users = getUsers();
  const curr = document.getElementById('sCurrPass').value;
  const np   = document.getElementById('sNewPass').value;
  checkPass(curr, users.admin).then(ok => {
    if (!ok) { showMsg('sAdminMsg','كلمة المرور الحالية غلط','danger'); return; }
    if (np.length < 4) { showMsg('sAdminMsg','يجب أن تكون 4 أحرف على الأقل','danger'); return; }
    hashPass(np).then(hashed => {
      users.admin = hashed;
      setUsersLocal(users);
      // Password stays local only — never synced to Firestore (see CLAUDE.md security notes)
      showMsg('sAdminMsg','✅ تم تغيير كلمة المرور');
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

function renderSellersSettings() {
  const wrap = document.getElementById('sellersListWrap');
  if (!wrap) return;
  const people = getSalespeople();
  wrap.innerHTML = people.map((n,i) => `
    <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:13px;font-weight:600;">
      <span>👤 ${escHtml(n)}</span>
      <button onclick="removeSeller(${i})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:14px;line-height:1;padding:0 2px;" title="حذف">×</button>
    </div>`).join('');
}

function addSeller() {
  const inp = document.getElementById('sNewSeller');
  const name = inp.value.trim();
  if (!name) return;
  const arr = [...getSalespeople()];
  if (arr.includes(name)) { showMsg('sSellersMsg','الاسم موجود بالفعل','danger'); return; }
  arr.push(name);
  setSalespeople(arr);
  inp.value = '';
  showMsg('sSellersMsg','تمت الإضافة');
}

function removeSeller(idx) {
  const arr = [...getSalespeople()];
  if (arr.length <= 1) { showMsg('sSellersMsg','لازم يكون فيه بائع واحد على الأقل','danger'); return; }
  arr.splice(idx, 1);
  setSalespeople(arr);
  showMsg('sSellersMsg','تم الحذف');
}

function resetSales() {
  if (!confirm('حذف كل المبيعات نهائياً؟')) return;
  setSales([]);
  showMsg('sSettingsMsg','تم حذف سجل المبيعات','warning');
}

function resetAll() {
  if (!confirm('حذف كل البيانات (المخزون + المبيعات)؟')) return;
  if (!confirm('تأكيد أخير — هذا لا يمكن التراجع عنه')) return;
  ['inv','sales','pos_suspended','threshold','pos_transfers']
    .concat(BRANCH_IDS.map(b=>`pos_inv_${b}`))
    .forEach(k => localStorage.removeItem(k));
  if (_fbReady) {
    BRANCH_IDS.forEach(b => _db.collection('pos_data').doc(`inv_${b}`).delete().catch(()=>{}));
    _db.collection('pos_data').doc('inv').delete().catch(()=>{});
    _db.collection('pos_data').doc('suspended').delete().catch(()=>{});
    _db.collection('pos_data').doc('settings').delete().catch(()=>{});
    _db.collection('pos_data').doc('transfers').delete().catch(()=>{});
    _db.collection('pos_sales').get().then(snap => {
      const batch = _db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).catch(()=>{});
  }
  _invCacheByBranch = {}; BRANCH_IDS.forEach(b => _invCacheByBranch[b] = []);
  _salesCache = []; _suspendCache = []; _transfersCache = [];
  _settingsCache = { threshold: 5 };
  showMsg('sSettingsMsg','تم حذف كل البيانات','danger');
}

