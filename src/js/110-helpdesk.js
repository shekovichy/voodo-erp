// ══════════════════════════════════════════════
// HELPDESK — تذاكر الدعم الفني بين الفروع والإدارة
// ══════════════════════════════════════════════
const HD_CATEGORIES = { pos:'🖥️ نظام الكاشير', inventory:'📦 المخزون', hardware:'🔧 أجهزة/طابعة', network:'🌐 الشبكة/الإنترنت', other:'❓ أخرى' };
const HD_PRIORITIES = { low:'منخفضة', medium:'متوسطة', high:'عالية', urgent:'عاجلة' };
const HD_STATUSES   = { open:'مفتوحة', in_progress:'قيد المعالجة', closed:'مغلقة' };

const getHelpdesk = () => _helpdeskCache;
function setHelpdesk(list) {
  _helpdeskCache = list;
  DB.s('pos_helpdesk', list);
  try { _db && _db.collection('pos_data').doc('helpdesk').set({ list, updatedAt: Date.now() }); } catch(e) {}
}

function openHelpdeskTicketModal() {
  document.getElementById('hdSubject').value = '';
  document.getElementById('hdDescription').value = '';
  document.getElementById('hdCategory').value = 'pos';
  document.getElementById('hdPriority').value = 'medium';
  const branchSel = document.getElementById('hdBranch');
  branchSel.innerHTML = BRANCH_IDS.map(b => `<option value="${b}">${escHtml(getBranchName(b))}</option>`).join('');
  const branchRow = document.getElementById('hdBranchRow');
  if (currentUser === 'admin') {
    branchSel.disabled = false;
    if (branchRow) branchRow.style.display = '';
  } else {
    branchSel.value = currentBranch;
    branchSel.disabled = true;
    if (branchRow) branchRow.style.display = 'none';
  }
  document.getElementById('helpdeskTicketModal').classList.remove('hidden');
}
function closeHelpdeskTicketModal() { document.getElementById('helpdeskTicketModal').classList.add('hidden'); }

function submitHelpdeskTicket() {
  const subject     = document.getElementById('hdSubject').value.trim();
  const description = document.getElementById('hdDescription').value.trim();
  if (!subject || !description) { alert('اكتب عنوان ووصف المشكلة'); return; }
  const branchId = currentUser === 'admin' ? document.getElementById('hdBranch').value : currentBranch;
  const ticket = {
    id: 'hd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    subject, description,
    category: document.getElementById('hdCategory').value,
    priority: document.getElementById('hdPriority').value,
    branchId,
    status: 'open',
    createdBy: currentUser + ' (' + getBranchName(branchId) + ')',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    replies: [],
  };
  setHelpdesk([ticket, ...getHelpdesk()]);
  addAuditLog('helpdesk.create', `تذكرة جديدة: ${subject} — ${getBranchName(branchId)}`, branchId);
  closeHelpdeskTicketModal();
  renderHelpdeskPage();
  showToast('✅ تم فتح التذكرة');
}

function renderHelpdeskPage() {
  const isAdmin = currentUser === 'admin';
  const branchFilterEl = document.getElementById('hdBranchFilter');
  if (branchFilterEl) {
    if (branchFilterEl.options.length <= 1) {
      BRANCH_IDS.forEach(b => {
        const o = document.createElement('option'); o.value = b; o.textContent = getBranchName(b);
        branchFilterEl.appendChild(o);
      });
    }
    branchFilterEl.style.display = isAdmin ? '' : 'none';
  }

  const scoped = getHelpdesk().filter(t => isAdmin || t.branchId === currentBranch);
  let list = scoped;
  const statusFilter = document.getElementById('hdStatusFilter')?.value || '';
  const branchFilter  = isAdmin ? (branchFilterEl?.value || '') : '';
  if (statusFilter) list = list.filter(t => t.status === statusFilter);
  if (branchFilter) list = list.filter(t => t.branchId === branchFilter);

  animateNumber(document.getElementById('hd-open'),     scoped.filter(t => t.status === 'open').length);
  animateNumber(document.getElementById('hd-progress'), scoped.filter(t => t.status === 'in_progress').length);
  animateNumber(document.getElementById('hd-closed'),   scoped.filter(t => t.status === 'closed').length);

  const statusBadge   = s => ({ open:'badge-danger', in_progress:'badge-warning', closed:'badge-success' })[s] || '';
  const priorityBadge = p => ({ urgent:'badge-danger', high:'badge-warning' })[p] || '';

  const tbody = document.getElementById('helpdeskBody'); if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">لا توجد تذاكر</td></tr>'; return; }
  tbody.innerHTML = list.map(t => `<tr>
    <td style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${new Date(t.createdAt).toLocaleDateString('ar-EG')}</td>
    <td style="font-size:12px;font-weight:600;">${escHtml(t.subject)}</td>
    <td style="font-size:12px;">${escHtml(getBranchName(t.branchId))}</td>
    <td style="font-size:12px;">${escHtml(HD_CATEGORIES[t.category] || t.category)}</td>
    <td><span class="badge ${priorityBadge(t.priority)}">${escHtml(HD_PRIORITIES[t.priority] || t.priority)}</span></td>
    <td><span class="badge ${statusBadge(t.status)}">${escHtml(HD_STATUSES[t.status] || t.status)}</span></td>
    <td><button class="btn btn-outline btn-sm" onclick="openHelpdeskDetail('${t.id}')">عرض</button></td>
  </tr>`).join('');
}

function openHelpdeskDetail(id) {
  const t = getHelpdesk().find(x => x.id === id);
  if (!t) return;
  document.getElementById('hdDetailId').value = t.id;
  document.getElementById('hdDetailTitle').textContent = t.subject;
  document.getElementById('hdDetailMeta').textContent =
    `${getBranchName(t.branchId)} — ${HD_CATEGORIES[t.category] || t.category} — بواسطة ${t.createdBy} — ${new Date(t.createdAt).toLocaleString('ar-EG')}`;
  document.getElementById('hdDetailDescription').textContent = t.description;
  document.getElementById('hdDetailReplies').innerHTML = (t.replies || []).map(r =>
    `<div style="background:var(--bg-secondary);border-radius:8px;padding:8px 12px;margin-bottom:6px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">${escHtml(r.author)} — ${new Date(r.timestamp).toLocaleString('ar-EG')}</div>
      <div style="font-size:13px;">${escHtml(r.text)}</div>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text-muted);">لا توجد ردود بعد</div>';
  const statusSel = document.getElementById('hdDetailStatus');
  statusSel.value = t.status;
  statusSel.disabled = currentUser !== 'admin';
  document.getElementById('hdReplyText').value = '';
  document.getElementById('helpdeskDetailModal').classList.remove('hidden');
}
function closeHelpdeskDetail() { document.getElementById('helpdeskDetailModal').classList.add('hidden'); }

function addHelpdeskReply() {
  const id = document.getElementById('hdDetailId').value;
  const text = document.getElementById('hdReplyText').value.trim();
  if (!text) return;
  const list = getHelpdesk();
  const t = list.find(x => x.id === id);
  if (!t) return;
  t.replies = [...(t.replies || []), {
    id: 'r_' + Date.now(),
    text,
    author: currentUser + ' (' + getBranchName(currentUser === 'admin' ? t.branchId : currentBranch) + ')',
    timestamp: Date.now(),
  }];
  t.updatedAt = Date.now();
  setHelpdesk(list);
  addAuditLog('helpdesk.reply', `رد على تذكرة: ${t.subject}`, t.branchId);
  openHelpdeskDetail(id);
  renderHelpdeskPage();
}

function changeHelpdeskStatus() {
  if (currentUser !== 'admin') return;
  const id = document.getElementById('hdDetailId').value;
  const newStatus = document.getElementById('hdDetailStatus').value;
  const list = getHelpdesk();
  const t = list.find(x => x.id === id);
  if (!t || t.status === newStatus) return;
  const oldStatus = t.status;
  t.status = newStatus;
  t.updatedAt = Date.now();
  setHelpdesk(list);
  addAuditLog('helpdesk.status', `تذكرة "${t.subject}": ${HD_STATUSES[oldStatus]} ← ${HD_STATUSES[newStatus]}`, t.branchId,
    [{ label: 'الحالة', before: HD_STATUSES[oldStatus], after: HD_STATUSES[newStatus] }]);
  renderHelpdeskPage();
  showToast('✅ تم تحديث حالة التذكرة');
}
