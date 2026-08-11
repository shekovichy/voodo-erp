// ══════════════════════════════════════════════════════
// PRICE-CHANGE APPROVAL SYSTEM
// ══════════════════════════════════════════════════════

// ── Data layer ─────────────────────────────────────────
// ONE FIRESTORE DOCUMENT PER REQUEST (pos_price_approvals/{id}).
//
// This used to be a single shared array document (pos_data/price_approvals),
// which could not be secured at all: a Firestore rule gates a whole document,
// so every account allowed to write that document could set status:'approved'
// on its OWN request. The manager-approves-a-discount control existed only in
// the UI. Splitting storage per request is what lets the rule say "the
// requester may not be the approver" — see pos_price_approvals in
// firestore.rules, and the pos_audit collection for the same pattern.
var _approvalsCache = null;
function getApprovals() {
  if (!_approvalsCache) _approvalsCache = DB.g('pos_price_approvals', []);
  return _approvalsCache;
}
function _persistApprovalsLocal() {
  DB.s('pos_price_approvals', _approvalsCache || []);
}
// The uid the rules identify a requester by. Null offline / in local test
// mode (no Firebase Auth) — everything still works there, it just stays on
// the device, which is exactly what local testing should do.
function _myUid() {
  try {
    return (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser)
      ? firebase.auth().currentUser.uid : null;
  } catch (e) { return null; }
}
// Every mutation goes through here, so the Firestore write is always a
// single-document set() that the rules can reason about. Writing the whole
// list at once (the old setApprovals) is what made the rule unenforceable.
function _saveApproval(req) {
  var list = getApprovals();
  var i = list.findIndex(function(r){ return r.id === req.id; });
  if (i === -1) list.unshift(req); else list[i] = req;
  _persistApprovalsLocal();
  if (_fbReady && _db) {
    _db.collection('pos_price_approvals').doc(String(req.id))
       .set(req)
       .catch(function(e){ console.error('_saveApproval:', e); });
  }
}

// ── Expiry — an approval dies with the business day ────
// A price cleared for one specific customer must not still be loadable next
// week for a different one. Before this, an approved cart that never became a
// sale stayed in "الفواتير المعتمدة" forever and could be re-loaded any number
// of times — the same control bypassed by waiting instead of by an API call.
function _endOfDayMs(when) {
  var e = new Date(when || Date.now());
  e.setHours(23, 59, 59, 999);
  return e.getTime();
}
// Legacy records predate expiresAt and are localStorage-only; treat them as
// live rather than making them vanish on upgrade.
function isApprovalLive(r) {
  return r.status === 'approved' && (!r.expiresAt || Date.now() < r.expiresAt);
}

// ── Cashier: edit item price ────────────────────────────
function editItemPrice(code) {
  var item = cart.find(function(i){ return i.code === code; });
  if (!item) return;
  showPromptModal('السعر الجديد لـ "' + item.name + '" (السعر الحالي: ' + item.price + ')', item.price, function(val) {
    var newPrice = parseFloat(val);
    if (isNaN(newPrice) || newPrice <= 0) return;
    if (newPrice === item.price) return;
    if (!item.priceModified) item.originalPrice = item.price;
    item.price = newPrice;
    item.priceModified = true;
    renderCart();
  });
}

// ── Cashier: send for approval ──────────────────────────
function sendForApproval() {
  if (!cart.length) { showToast('الفاتورة فارغة'); return; }
  var hasModified = cart.some(function(i){ return i.priceModified; });
  if (!hasModified) { openPayment(); return; }
  showPromptModal('ملاحظة للمدير (اختياري):', '', function(val) {
    var note = val || '';
    var { total } = cartTotals();
    var request = {
      id: Date.now(),
      date: new Date().toISOString(),
      // Real username when available; the match in checkForApprovedCarts()
      // compares against the same expression, so old records (generic
      // 'cashier') and new ones both keep working.
      cashier: currentUsername || currentUser || 'كاشير',
      // The rules match on uid, not on this display name — a name is
      // client-supplied and so can't decide who owns a request.
      cashierUid: _myUid(),
      branchId: currentBranch,
      branchName: (getBranches()[currentBranch] || BRANCH_DEFAULTS[currentBranch]),
      items: cart.map(function(i){ return Object.assign({}, i); }),
      total: total,
      note: note,
      status: 'pending',
      adminNote: ''
    };
    _saveApproval(request);
    // _clearCartConfirmed مباشرة مش clearCart: التانية بتسأل "مسح الفاتورة؟"
    // وده سؤال غلط في السياق ده — الفاتورة اتبعتت للمدير خلاص. ولو الكاشير
    // رد بـ"لا" كانت السلة تفضل بالسعر المعدّل، فيضغط دفع تاني ويتبعت طلب
    // مكرر لنفس الفاتورة (اتأكد عملياً: طلبين بنفس الإجمالي عند المدير).
    _clearCartConfirmed();
    updateApprovalBadge();
    showToast('✅ تم إرسال الفاتورة للمدير\nسيتم إشعارك عند الموافقة');
  });
}

// ── Admin: open approvals panel ─────────────────────────
function openApprovalsPanel() {
  renderApprovalsList();
  document.getElementById('approvalsModal').classList.remove('hidden');
}

function renderApprovalsList() {
  var list = getApprovals().filter(function(r){ return r.status === 'pending'; });
  var el = document.getElementById('approvalsList');
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد طلبات معلقة ✓</div>';
    return;
  }
  el.innerHTML = list.map(function(req){
    var itemsHtml = req.items.filter(function(i){ return i.priceModified; }).map(function(i){
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">'
        + '<span style="font-weight:600;font-size:13px;">'+escHtml(i.name)+'</span>'
        + '<span style="font-size:13px;">'
        + '<span style="text-decoration:line-through;color:#9ca3af;">'+fmt(i.originalPrice)+' ج</span>'
        + ' → <span style="color:#dc2626;font-weight:700;">'+fmt(i.price)+' ج</span>'
        + ' × '+i.qty
        + '</span></div>';
    }).join('');
    return '<div style="background:white;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<div><div style="font-weight:700;font-size:14px;">📋 فاتورة #'+req.id+'</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">'+req.date.slice(0,16).replace('T',' ')+' — '+escHtml(req.branchName)+' — '+escHtml(req.cashier)+'</div></div>'
      + '<div style="font-size:20px;font-weight:800;color:#1d4ed8;">'+fmt(req.total)+' ج</div>'
      + '</div>'
      + '<div style="margin-bottom:10px;">'+itemsHtml+'</div>'
      + (req.note ? '<div style="background:#fef9c3;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;">💬 '+escHtml(req.note)+'</div>' : '')
      + '<div style="display:flex;gap:8px;">'
      + '<input id="adminNote_'+req.id+'" class="form-control" placeholder="ملاحظة للكاشير (اختياري)" style="flex:1;font-size:12px;" />'
      + '<button onclick="approveRequest('+req.id+')" class="btn btn-success">✅ موافقة</button>'
      + '<button onclick="rejectRequest('+req.id+')" class="btn btn-danger btn-sm">❌ رفض</button>'
      + '</div></div>';
  }).join('');
}

// The two approve/reject pairs (this modal and the suspended-page tab) share
// one implementation so a fix to either can't drift out of the other.
function _decideRequest(id, decision, noteElId, repaint) {
  var req = getApprovals().find(function(r){ return r.id === id; });
  if (!req || req.status !== 'pending') return;
  req.status    = decision;
  req.adminNote = document.getElementById(noteElId + id)?.value || '';
  if (decision === 'approved') {
    req.approvedAt = new Date().toISOString();
    req.approvedBy = currentUsername || currentUser || '';
    req.expiresAt  = _endOfDayMs();
  } else {
    req.rejectedAt = new Date().toISOString();
  }
  _saveApproval(req);
  updateApprovalBadge();
  if (repaint) repaint();
  if (decision === 'approved') showToast('✅ تمت الموافقة — سيتم إشعار الكاشير');
}

function approveRequest(id) { _decideRequest(id, 'approved', 'adminNote_', renderApprovalsList); }
function rejectRequest(id)  { _decideRequest(id, 'rejected', 'adminNote_', renderApprovalsList); }

// ── Badge update ────────────────────────────────────────
function updateApprovalBadge() {
  var pending = getApprovals().filter(function(r){ return r.status === 'pending'; }).length;
  var btn    = document.getElementById('approvalBellBtn');
  var badge  = document.getElementById('approvalBadge');
  if (currentUser === 'admin') {
    if (btn) btn.style.display = pending > 0 ? 'inline-block' : 'none';
    if (badge) { badge.style.display = pending > 0 ? 'inline-block' : 'none'; badge.textContent = pending; }
  }
  // Cashier: check for newly approved items
  checkForApprovedCarts();
}

// ── Cashier: watch for approvals ────────────────────────
var _notifiedApprovals = DB.g('pos_notified_approvals', []);
function checkForApprovedCarts() {
  if (currentUser === 'admin') return;
  var approved = getApprovals().filter(function(r){
    return isApprovalLive(r) && (r.cashier === currentUsername || r.cashier === currentUser) && !_notifiedApprovals.includes(r.id);
  });
  if (!approved.length) return;
  approved.forEach(function(r){ _notifiedApprovals.push(r.id); });
  DB.s('pos_notified_approvals', _notifiedApprovals);
  // Show toast
  var toast = document.getElementById('approvalToast');
  document.getElementById('approvalToastMsg').textContent = approved.length + ' فاتورة جاهزة للإتمام';
  if (toast) { toast.style.display = 'block'; setTimeout(function(){ toast.style.display='none'; }, 12000); }
}

// ── Cashier: open approved carts ────────────────────────
function openApprovedCarts() {
  document.getElementById('approvalToast').style.display = 'none';
  renderApprovedCartsList();
  document.getElementById('approvedCartsModal').classList.remove('hidden');
}

function renderApprovedCartsList() {
  var myApproved = getApprovals().filter(function(r){
    return isApprovalLive(r) && (currentUser === 'admin' || r.cashier === currentUsername || r.cashier === currentUser);
  });
  var el = document.getElementById('approvedCartsList');
  if (!myApproved.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">لا توجد فواتير معتمدة</div>';
    return;
  }
  el.innerHTML = myApproved.map(function(req){
    var itemsHtml = req.items.map(function(i){
      return '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;">'
        + '<span>'+escHtml(i.name)+' × '+i.qty+'</span>'
        + '<span style="font-weight:700;'+(i.priceModified?'color:#dc2626;':'')+'">'+fmt(i.price)+' ج</span>'
        + '</div>';
    }).join('');
    return '<div style="background:white;border:2px solid #10b981;border-radius:10px;padding:14px;margin-bottom:10px;">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">'
      + '<div><div style="font-weight:700;">✅ معتمدة — '+escHtml(req.branchName)+'</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">'+req.date.slice(0,16).replace('T',' ')+'</div></div>'
      + '<div style="font-size:20px;font-weight:800;color:#1d4ed8;">'+fmt(req.total)+' ج</div>'
      + '</div>'
      + '<div style="margin-bottom:10px;">'+itemsHtml+'</div>'
      + (req.adminNote ? '<div style="background:#d1fae5;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:8px;">💬 '+escHtml(req.adminNote)+'</div>' : '')
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="resumeApprovedCart('+req.id+')" class="btn btn-success" style="flex:1;">🛒 تحميل الفاتورة وإتمام البيع</button>'
      + '<button onclick="cancelApprovedCart('+req.id+')" class="btn btn-danger btn-sm" title="العميل رجع في كلامه">❌ إلغاء</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center;">⏳ صالحة لآخر اليوم</div>'
      + '</div>';
  }).join('');
}

// Called from completeSale() (20-pos-payment.js) once a sale actually
// commits — see the note in _resumeApprovedCartConfirmed() above for why
// this can't happen any earlier than that.
function markApprovalConsumed(id) {
  if (!id) return;
  var r = getApprovals().find(function(x){ return x.id === id; });
  if (!r) return;
  r.status = 'consumed';
  r.consumedAt = new Date().toISOString();
  _saveApproval(r);
  updateApprovalBadge();
}

// The exit that was missing: an approved cart the customer walked away from
// had no way to close. It stayed loadable forever, because 'consumed' is only
// set once a sale actually commits (see markApprovalConsumed and the comment
// in _resumeApprovedCartConfirmed). Cancelling only ever reduces what the
// request permits, so the requester is allowed to do it themselves.
function cancelApprovedCart(id) {
  showConfirmModal('إلغاء الفاتورة المعتمدة نهائياً؟ مش هتقدر ترجعها.', function(){
    var r = getApprovals().find(function(x){ return x.id === id; });
    if (!r || r.status !== 'approved') return;
    r.status      = 'cancelled';
    r.cancelledAt = new Date().toISOString();
    _saveApproval(r);
    addAuditLog('approval.cancel',
      'إلغاء فاتورة معتمدة #' + String(id).slice(-6) + ' — ' + fmt(r.total) + ' ج', r.branchId);
    updateApprovalBadge();
    renderApprovedCartsList();
    showToast('تم إلغاء الفاتورة المعتمدة');
  });
}

function resumeApprovedCart(id) {
  var req = getApprovals().find(function(r){ return r.id === id; });
  if (!req) return;
  if (cart.length) {
    showConfirmModal('سيتم استبدال الفاتورة الحالية. هل تريد المتابعة؟', function(){ _resumeApprovedCartConfirmed(id); });
  } else {
    _resumeApprovedCartConfirmed(id);
  }
}
function _resumeApprovedCartConfirmed(id) {
  var req = getApprovals().find(function(r){ return r.id === id; });
  if (!req) return;
  cart = req.items.map(function(i){ return Object.assign({},i); });
  // مش بتتحط 'consumed' هنا خالص — ده كان بيحصل قبل ما البيع يتم فعلاً،
  // فلو الكاشير قفل شاشة الدفع (أو مسح الفاتورة) بدل ما يكمّل، الطلب
  // المعتمد كان بيختفي نهائيًا من "الفواتير المعتمدة" من غير ما فاتورة
  // حقيقية تتسجل — الطلب ضايع تمامًا ومفيش أي أثر إنه اتضاع. بتتحط
  // 'consumed' فعليًا في completeSale() (20-pos-payment.js) بعد ما
  // addSale() تنجح فعلاً.
  cart._fromApprovalId = id;
  renderCart();
  document.getElementById('approvedCartsModal').classList.add('hidden');
  updateApprovalBadge();
  // Open payment
  setTimeout(openPayment, 300);
}

// ── Firebase listener for approvals ────────────────────
// ⚠️ THE QUERY MUST MIRROR THE RULE. Firestore will not filter a query down
// to what you're allowed to see — if a single document the query could return
// fails the rule, the WHOLE query is rejected and the listener errors out. So
// a cashier must filter by their own uid (the rule lets them read only their
// own requests) and only an admin may read the collection unfiltered.
// Widening either query without widening the rule breaks approvals outright.
function initApprovalsFirebaseListener() {
  if (!_fbReady || !_db) return;
  var col = _db.collection('pos_price_approvals');
  var q;
  if (currentUser === 'admin') {
    // 'pending'/'approved' only: closed requests are history no screen reads,
    // and this keeps a long-lived listener off the whole growing collection.
    q = col.where('status', 'in', ['pending', 'approved']);
  } else {
    var uid = _myUid();
    if (!uid) return;   // offline/local session — localStorage is the source
    q = col.where('cashierUid', '==', uid);
  }
  q.onSnapshot(function(snap) {
    _approvalsCache = snap.docs.map(function(d){ return d.data(); })
                          .sort(function(a, b){ return (b.id || 0) - (a.id || 0); });
    _persistApprovalsLocal();
    updateApprovalBadge();
    // Repaint whichever approvals view is currently open, so an approval
    // landing from another device shows up without a manual refresh.
    if (!document.getElementById('approvalsModal')?.classList.contains('hidden')) renderApprovalsList();
    if (!document.getElementById('approvedCartsModal')?.classList.contains('hidden')) renderApprovedCartsList();
    var pane = document.getElementById('suspPane_approvals');
    if (pane && !pane.classList.contains('hidden')) renderSuspApprovals();
  }, function(err){ console.error('approvals listener:', err); });
}

// ══════════════════════════════════════════
// SUSPENDED PAGE TABS
// ══════════════════════════════════════════
function switchSuspTab(tab, el) {
  ['bills','approvals'].forEach(function(t){
    var pane = document.getElementById('suspPane_'+t);
    var btn  = document.getElementById('suspTab_'+t);
    if (pane) pane.classList.toggle('hidden', t!==tab);
    if (btn)  btn.classList.toggle('active',  t===tab);
  });
  if (tab === 'approvals') renderSuspApprovals();
}

function renderSuspApprovals() {
  var el = document.getElementById('suspApprovalsList');
  if (!el) return;
  var list = getApprovals().filter(function(r){ return r.status === 'pending'; });

  // Update count badge
  var badge = document.getElementById('suspApprovalsCount');
  if (badge) { badge.textContent = list.length; badge.style.display = list.length ? 'inline' : 'none'; }

  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">✅ لا توجد طلبات معلقة</div>';
    return;
  }
  el.innerHTML = list.map(function(req){
    var modItems = req.items.filter(function(i){ return i.priceModified; });
    var itemsHtml = modItems.map(function(i){
      return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">'
        +'<span style="font-weight:600;">'+escHtml(i.name)+' × '+i.qty+'</span>'
        +'<span><span style="text-decoration:line-through;color:#9ca3af;">'+fmt(i.originalPrice)+' ج</span>'
        +' → <span style="color:#dc2626;font-weight:700;">'+fmt(i.price)+' ج</span></span>'
        +'</div>';
    }).join('');
    return '<div style="background:white;border:1px solid #fecaca;border-right:4px solid #ef4444;border-radius:10px;padding:16px;margin-bottom:12px;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      +'<div>'
      +'<div style="font-weight:700;font-size:14px;">✏️ طلب تعديل سعر</div>'
      +'<div style="font-size:12px;color:var(--text-muted);">'+req.date.slice(0,16).replace('T',' ')+' — '+escHtml(req.branchName)+' — '+escHtml(req.cashier)+'</div>'
      +'</div>'
      +'<div style="font-size:20px;font-weight:800;color:#1d4ed8;">'+fmt(req.total)+' ج</div>'
      +'</div>'
      +'<div style="margin-bottom:10px;">'+itemsHtml+'</div>'
      +(req.note?'<div style="background:#fef9c3;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;">💬 '+escHtml(req.note)+'</div>':'')
      +'<div style="display:flex;gap:8px;align-items:center;">'
      +'<input id="sAdminNote_'+req.id+'" class="form-control" placeholder="ملاحظة للكاشير (اختياري)" style="flex:1;font-size:12px;" />'
      +'<button onclick="approveSuspRequest('+req.id+')" class="btn btn-success">✅ موافقة</button>'
      +'<button onclick="rejectSuspRequest('+req.id+')" class="btn btn-danger btn-sm">❌ رفض</button>'
      +'</div>'
      +'</div>';
  }).join('');
}

function approveSuspRequest(id) { _decideRequest(id, 'approved', 'sAdminNote_', renderSuspApprovals); }
function rejectSuspRequest(id)  { _decideRequest(id, 'rejected', 'sAdminNote_', renderSuspApprovals); }

function updateHomeClock() {
  var now = new Date();
  var hh  = String(now.getHours()).padStart(2,'0');
  var mm  = String(now.getMinutes()).padStart(2,'0');
  var el  = document.getElementById('homeClock');
  if (el) el.textContent = hh + ':' + mm;
  var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  var dateStr = days[now.getDay()] + ' ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
  var del = document.getElementById('homeDate');
  if (del) del.textContent = dateStr;
  var greet = document.getElementById('homeGreeting');
  if (greet) {
    var h = now.getHours();
    var g = h < 12 ? '🌅 صباح الخير' : h < 18 ? '☀️ مساء الخير' : '🌙 مساء النور';
    greet.textContent = g;
  }
}
function showFirstRunSetup() {
  document.getElementById('firstRunModal').classList.remove('hidden');
  document.getElementById('loginPage').classList.add('hidden');
}
async function confirmFirstRun() {
  const p1 = document.getElementById('frPass1').value;
  const p2 = document.getElementById('frPass2').value;
  const msg = document.getElementById('frMsg');
  if (p1.length < 4) { msg.textContent = 'كلمة المرور قصيرة جداً (4 أحرف على الأقل)'; return; }
  if (p1 !== p2)     { msg.textContent = 'كلمتا المرور غير متطابقتين'; return; }
  const hashed = await hashPass(p1);
  const users  = getUsers();
  users.admin  = hashed;
  setUsersLocal(users);
  document.getElementById('firstRunModal').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('frMsg').textContent = '';
  showToast('✅ تم تعيين كلمة مرور المدير — سجّل الدخول الآن');
}

setInterval(updateHomeClock, 1000);



