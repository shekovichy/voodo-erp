// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════
function renderBranchUsersSettings() {
  const bu = getBranchUsers();
  const container = document.getElementById('branchUsersContainer');
  if (!container) return;
  container.innerHTML = BRANCH_IDS.map(b => {
    const name = getBranchName(b);
    const uname = bu[b]?.username || '';
    const upass  = bu[b]?.password || '';
    const role   = bu[b]?.role || 'cashier';
    return `<div style="border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:10px; background:var(--bg);">
      <div style="font-weight:700; font-size:13px; margin-bottom:8px; color:var(--primary);">🏬 ${escHtml(name)}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
        <div><label style="font-size:11px; color:var(--text-muted);">اسم المستخدم</label>
          <input class="form-control" id="bu-user-${b}" value="${escHtml(uname)}" placeholder="username" style="margin-top:4px;" /></div>
        <div><label style="font-size:11px; color:var(--text-muted);">كلمة المرور</label>
          <input class="form-control" id="bu-pass-${b}" value="" placeholder="password" style="margin-top:4px;" /></div>
        <div><label style="font-size:11px; color:var(--text-muted);">الصلاحية</label>
          <select class="form-control" id="bu-role-${b}" style="margin-top:4px;">
            <option value="cashier" ${role==='cashier'?'selected':''}>كاشير</option>
            <option value="manager" ${role==='manager'?'selected':''}>مدير فرع</option>
          </select></div>
      </div>
    </div>`;
  }).join('');
}

async function saveBranchUsers() {
  const bu = getBranchUsers();
  for (const b of BRANCH_IDS) {
    const uname = document.getElementById(`bu-user-${b}`)?.value.trim();
    const upass  = document.getElementById(`bu-pass-${b}`)?.value.trim();
    const role   = document.getElementById(`bu-role-${b}`)?.value || 'cashier';
    if (uname) {
      if (upass && upass.length >= 4) {
        const hashed = await hashPass(upass);
        bu[b] = { username: uname, password: hashed, role };
      } else if (upass === '') {
        // Keep existing password hash unchanged
        bu[b] = { username: uname, password: bu[b]?.password || '', role };
      }
    }
  }
  setBranchUsersLocal(bu);
  // Passwords stay local only — never synced to Firestore (see CLAUDE.md security notes)
  showMsg('sBranchUsersMsg', '✅ تم حفظ بيانات دخول الفروع');
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
  const v = parseInt(document.getElementById('sLowThreshold').value) || 5;
  setThreshold(v);
  const vip = parseInt(document.getElementById('sVipThreshold')?.value) || 1000;
  _settingsCache.vipThreshold = vip;
  saveSettingsCache();
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

