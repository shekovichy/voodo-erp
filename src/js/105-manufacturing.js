
// ============================================================
// وحدة التصنيع — Manufacturing Module
// DB.g(key, default) — synchronous getter (localStorage / Firebase)
// DB.s(key, value)   — synchronous setter
// Keys: pos_mfg_rawMats, pos_mfg_lines, pos_mfg_orders, pos_mfg_quality
// ============================================================

// -------- DOM helpers (module-local) --------
function _mEl(id)     { return document.getElementById(id); }
function _mSet(id,v)  { const e=_mEl(id); if(e) e.textContent=v; }
function _mVal(id)    { const e=_mEl(id); return e?e.value:''; }
function _mSetV(id,v) { const e=_mEl(id); if(e) e.value=v; }
function _mEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _mOpenModal(id) { const e=_mEl(id); if(e) e.classList.remove('hidden'); }
function _mToast(msg,type) {
  if (typeof showMsg==='function') { showMsg(msg,type); return; }
  const d=document.createElement('div');
  d.textContent=msg;
  d.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);'
    +'background:'+(type==='error'?'#e74c3c':'#27ae60')+';color:#fff;padding:10px 22px;'
    +'border-radius:8px;z-index:99999;font-size:14px;font-family:inherit;';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),2500);
}

// ============================================================
// Tab switching
// ============================================================
function switchMfgTab(tab) {
  ['rawmat','lines','orders','quality','reports'].forEach(t => {
    const c=_mEl('mfg-tab-'+t), b=_mEl('mfg-tab-'+t+'-btn');
    if(c) c.classList.toggle('hidden', t!==tab);
    if(b) b.classList.toggle('active', t===tab);
  });
  if(tab==='rawmat')  renderRawMaterials();
  if(tab==='lines')   renderLines();
  if(tab==='orders')  renderProductionOrders();
  if(tab==='quality') renderQualityChecks();
  if(tab==='reports') renderMfgReports();
}

// Called from showPage('manufacturing')
function renderManufacturingPage() {
  // Set default report date range
  const today=new Date(), first=new Date(today.getFullYear(),today.getMonth(),1);
  _mSetV('mfgRptFrom', first.toISOString().split('T')[0]);
  _mSetV('mfgRptTo',   today.toISOString().split('T')[0]);
  renderRawMaterials(); // default active tab
}

// ============================================================
// الخامات — Raw Materials
// ============================================================
function renderRawMaterials() {
  const all    = DB.g('pos_mfg_rawMats', []);
  const search = (_mVal('rawmatSearch')||'').toLowerCase();
  const list   = all.filter(r =>
    !search ||
    (r.name||'').toLowerCase().includes(search) ||
    (r.supplier||'').toLowerCase().includes(search)
  );
  const low = all.filter(r=>+(r.qty||0)<+(r.minStock||0)).length;
  const val = all.reduce((s,r)=>s+(+(r.qty||0))*(+(r.cost||0)),0);
  _mSet('mfg-rawmat-count', all.length);
  _mSet('mfg-rawmat-low',   low);
  _mSet('mfg-rawmat-value', val.toLocaleString('ar-EG')+' ج.م');

  const tbody=_mEl('rawmatsBody');
  if(!tbody) return;
  if(!list.length){
    tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:24px">لا توجد خامات</td></tr>';
    return;
  }
  tbody.innerHTML=list.map(r=>{
    const qty=+(r.qty||0), min=+(r.minStock||0), isLow=qty<min;
    return `<tr>
      <td><strong>${_mEsc(r.name)}</strong></td>
      <td>${_mEsc(r.unit||'-')}</td>
      <td style="${isLow?'color:var(--danger)':''}">${qty.toLocaleString('ar-EG')}</td>
      <td>${min.toLocaleString('ar-EG')}</td>
      <td>${(+(r.cost||0)).toLocaleString('ar-EG')} ج.م</td>
      <td>${_mEsc(r.supplier||'-')}</td>
      <td><span class="badge ${isLow?'badge-danger':'badge-success'}">${isLow?'منخفض':'مناسب'}</span></td>
      <td>
        <button class="btn-icon" onclick="openRawMatModal('${r.id}')">✏️</button>
        <button class="btn-icon" style="color:var(--danger)" onclick="deleteRawMat('${r.id}')">🗑️</button>
      </td></tr>`;
  }).join('');
}

function openRawMatModal(id) {
  const r = id ? (DB.g('pos_mfg_rawMats',[])).find(x=>x.id==id) : null;
  _mSet('rawMatModalTitle', r?'تعديل خامة':'إضافة خامة جديدة');
  _mSetV('rmName',     r?.name     ||'');
  _mSetV('rmUnit',     r?.unit     ||'كيلو');
  _mSetV('rmQty',      r?.qty      ||'');
  _mSetV('rmMinStock', r?.minStock ||'');
  _mSetV('rmCost',     r?.cost     ||'');
  _mSetV('rmSupplier', r?.supplier ||'');
  _mSetV('rmNotes',    r?.notes    ||'');
  _mSetV('rmEditId',   id||'');
  _mOpenModal('rawMatModal');
}

function saveRawMaterial() {
  const name=_mVal('rmName').trim();
  if(!name) return _mToast('أدخل اسم الخامة','error');
  const editId=_mVal('rmEditId');
  const list=DB.g('pos_mfg_rawMats',[]);
  const data={
    id:editId||Date.now(), name,
    unit:_mVal('rmUnit'),
    qty:+(_mVal('rmQty')||0),
    minStock:+(_mVal('rmMinStock')||0),
    cost:+(_mVal('rmCost')||0),
    supplier:_mVal('rmSupplier').trim(),
    notes:_mVal('rmNotes').trim(),
    updatedAt:Date.now()
  };
  if(editId){const i=list.findIndex(x=>x.id==editId);if(i>-1)list[i]=data;else list.push(data);}
  else list.push(data);
  DB.s('pos_mfg_rawMats',list);
  closeModal('rawMatModal');
  renderRawMaterials();
  _mToast('تم حفظ الخامة','success');
}

function deleteRawMat(id) {
  if(!confirm('هل تريد حذف هذه الخامة؟')) return;
  DB.s('pos_mfg_rawMats', DB.g('pos_mfg_rawMats',[]).filter(x=>x.id!=id));
  renderRawMaterials();
  _mToast('تم الحذف','success');
}

// ============================================================
// خطوط الإنتاج — Production Lines
// ============================================================
function renderLines() {
  const all    = DB.g('pos_mfg_lines', []);
  const orders = DB.g('pos_mfg_orders', []);
  _mSet('mfg-lines-count',  all.length);
  _mSet('mfg-lines-active', all.filter(l=>l.status==='active').length);
  _mSet('mfg-lines-maint',  all.filter(l=>l.status==='maintenance').length);
  const grid=_mEl('linesGrid');
  if(!grid) return;
  if(!all.length){
    grid.innerHTML='<div style="text-align:center;padding:40px;opacity:.5">لا توجد خطوط إنتاج</div>';
    return;
  }
  const sL={active:'نشط',maintenance:'صيانة',idle:'متوقف'};
  const sC={active:'success',maintenance:'warning',idle:'muted'};
  grid.innerHTML=all.map(l=>{
    const lo=orders.filter(o=>o.lineId==l.id);
    const good=lo.filter(o=>o.status==='done').reduce((s,o)=>s+(+(o.good||0)),0);
    return `<div class="stat-card" style="margin-bottom:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>⚙️ ${_mEsc(l.name)}</strong>
        <span class="badge badge-${sC[l.status]||'muted'}">${sL[l.status]||l.status}</span>
      </div>
      <div style="font-size:13px;line-height:1.9">
        <div>المشرف: <strong>${_mEsc(l.supervisor||'-')}</strong></div>
        <div>الطاقة: <strong>${(+(l.capacity||0)).toLocaleString('ar-EG')} وحدة/يوم</strong></div>
        <div>العمال: <strong>${l.workers||0}</strong> | الأوامر: <strong>${lo.length}</strong></div>
        <div>إجمالي السليم: <strong>${good.toLocaleString('ar-EG')}</strong></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" onclick="openLineModal('${l.id}')">✏️ تعديل</button>
        <button class="btn btn-sm" style="background:var(--danger);color:#fff" onclick="deleteLine('${l.id}')">🗑️</button>
      </div></div>`;
  }).join('');
}

function openLineModal(id) {
  const l = id ? (DB.g('pos_mfg_lines',[])).find(x=>x.id==id) : null;
  _mSet('lineModalTitle', l?'تعديل خط الإنتاج':'إضافة خط إنتاج');
  _mSetV('lineName',       l?.name       ||'');
  _mSetV('lineStatus',     l?.status     ||'active');
  _mSetV('lineCapacity',   l?.capacity   ||'');
  _mSetV('lineSupervisor', l?.supervisor ||'');
  _mSetV('lineProducts',   l?.products   ||'');
  _mSetV('lineWorkers',    l?.workers    ||'');
  _mSetV('lineEditId',     id||'');
  _mOpenModal('lineModal');
}

function saveLine() {
  const name=_mVal('lineName').trim();
  if(!name) return _mToast('أدخل اسم خط الإنتاج','error');
  const editId=_mVal('lineEditId');
  const list=DB.g('pos_mfg_lines',[]);
  const data={
    id:editId||Date.now(), name,
    status:_mVal('lineStatus'),
    capacity:+(_mVal('lineCapacity')||0),
    supervisor:_mVal('lineSupervisor').trim(),
    products:_mVal('lineProducts').trim(),
    workers:+(_mVal('lineWorkers')||0),
    updatedAt:Date.now()
  };
  if(editId){const i=list.findIndex(x=>x.id==editId);if(i>-1)list[i]=data;else list.push(data);}
  else list.push(data);
  DB.s('pos_mfg_lines',list);
  closeModal('lineModal');
  renderLines();
  _mToast('تم حفظ خط الإنتاج','success');
}

function deleteLine(id) {
  if(!confirm('هل تريد حذف خط الإنتاج؟')) return;
  DB.s('pos_mfg_lines', DB.g('pos_mfg_lines',[]).filter(x=>x.id!=id));
  renderLines();
  _mToast('تم الحذف','success');
}

// helpers: populate selects
function _mfgLinesSelect(selId, emptyLbl, curVal) {
  const s=_mEl(selId); if(!s) return;
  const lines=DB.g('pos_mfg_lines',[]);
  s.innerHTML=`<option value="">${_mEsc(emptyLbl)}</option>`
    +lines.map(l=>`<option value="${l.id}"${l.id==curVal?' selected':''}>${_mEsc(l.name)}</option>`).join('');
}
function _mfgOrdersSelect(selId, emptyLbl, curVal) {
  const s=_mEl(selId); if(!s) return;
  const orders=DB.g('pos_mfg_orders',[]).filter(o=>o.status!=='cancelled');
  s.innerHTML=`<option value="">${_mEsc(emptyLbl)}</option>`
    +orders.map(o=>{
      const no=o.orderNo||('PO-'+String(o.id).slice(-6).toUpperCase());
      return `<option value="${o.id}"${o.id==curVal?' selected':''}>${_mEsc(no)} — ${_mEsc(o.product||'')}</option>`;
    }).join('');
}

// ============================================================
// أوامر الإنتاج — Production Orders
// ============================================================
function renderProductionOrders() {
  const all    = DB.g('pos_mfg_orders', []);
  const lines  = DB.g('pos_mfg_lines',  []);
  const statusF=_mVal('poStatusFilter'), lineF=_mVal('poLineFilter');
  _mfgLinesSelect('poLineFilter','كل الخطوط',lineF);
  const list = all.filter(o=>
    (!statusF||o.status===statusF)&&(!lineF||String(o.lineId)===lineF)
  );
  const good  =list.reduce((s,o)=>s+(+(o.good||0)),0);
  const defect=list.reduce((s,o)=>s+(+(o.defect||0)),0);
  const tot   =good+defect;
  _mSet('mfg-po-count',        list.length);
  _mSet('mfg-po-good',         good.toLocaleString('ar-EG'));
  _mSet('mfg-po-defect',       defect.toLocaleString('ar-EG'));
  _mSet('mfg-po-quality-rate', tot>0?((good/tot)*100).toFixed(1)+'%':'0%');
  const sL={pending:'قيد الانتظار',inprogress:'جارٍ',done:'منتهي',cancelled:'ملغي'};
  const sC={pending:'warning',inprogress:'info',done:'success',cancelled:'muted'};
  const tbody=_mEl('prodOrdersBody'); if(!tbody) return;
  if(!list.length){tbody.innerHTML='<tr><td colspan="10" style="text-align:center;padding:24px">لا توجد أوامر إنتاج</td></tr>';return;}
  tbody.innerHTML=list.map(o=>{
    const ln=lines.find(l=>l.id==o.lineId);
    const no=o.orderNo||('PO-'+String(o.id).slice(-6).toUpperCase());
    return `<tr>
      <td><strong>${_mEsc(no)}</strong></td>
      <td>${_mEsc(o.product||'-')}</td>
      <td>${_mEsc(ln?.name||'-')}</td>
      <td>${(+(o.qty||0)).toLocaleString('ar-EG')}</td>
      <td style="color:var(--success)">${(+(o.good||0)).toLocaleString('ar-EG')}</td>
      <td style="color:var(--danger)">${(+(o.defect||0)).toLocaleString('ar-EG')}</td>
      <td>${o.startDate||'-'}</td>
      <td>${o.endDate||'-'}</td>
      <td><span class="badge badge-${sC[o.status]||'muted'}">${sL[o.status]||o.status}</span></td>
      <td>
        <button class="btn-icon" onclick="openProdOrderModal('${o.id}')">✏️</button>
        <button class="btn-icon" style="color:var(--danger)" onclick="deleteProdOrder('${o.id}')">🗑️</button>
      </td></tr>`;
  }).join('');
}

function openProdOrderModal(id) {
  const o = id ? (DB.g('pos_mfg_orders',[])).find(x=>x.id==id) : null;
  _mSet('prodOrderModalTitle', o?'تعديل أمر الإنتاج':'أمر إنتاج جديد');
  _mfgLinesSelect('poLine','اختر خط الإنتاج', o?.lineId||'');
  _mSetV('poProduct',   o?.product   ||'');
  _mSetV('poQty',       o?.qty       ||'');
  _mSetV('poStatus',    o?.status    ||'pending');
  _mSetV('poStartDate', o?.startDate ||new Date().toISOString().split('T')[0]);
  _mSetV('poEndDate',   o?.endDate   ||'');
  _mSetV('poGood',      o?.good      ||'');
  _mSetV('poDefect',    o?.defect    ||'');
  _mSetV('poBOM',       o?.bom       ||'');
  _mSetV('poNotes',     o?.notes     ||'');
  _mSetV('poEditId',    id||'');
  _mOpenModal('prodOrderModal');
}

function saveProdOrder() {
  const product=_mVal('poProduct').trim(), lineId=_mVal('poLine'), qty=+(_mVal('poQty')||0);
  if(!product) return _mToast('أدخل اسم المنتج','error');
  if(!lineId)  return _mToast('اختر خط الإنتاج','error');
  if(qty<1)    return _mToast('أدخل كمية صحيحة','error');
  const editId=_mVal('poEditId');
  const list=DB.g('pos_mfg_orders',[]);
  const ex=editId?list.find(o=>o.id==editId):null;
  const data={
    id:editId||Date.now(),
    orderNo:ex?.orderNo||('PO-'+String(Date.now()).slice(-6)),
    product, lineId, qty,
    status:_mVal('poStatus'),
    startDate:_mVal('poStartDate'),
    endDate:_mVal('poEndDate'),
    good:+(_mVal('poGood')||0),
    defect:+(_mVal('poDefect')||0),
    bom:_mVal('poBOM').trim(),
    notes:_mVal('poNotes').trim(),
    createdAt:ex?.createdAt||Date.now()
  };
  if(editId){const i=list.findIndex(x=>x.id==editId);if(i>-1)list[i]=data;else list.push(data);}
  else list.push(data);
  DB.s('pos_mfg_orders',list);
  closeModal('prodOrderModal');
  renderProductionOrders();
  _mToast('تم حفظ أمر الإنتاج','success');
}

function deleteProdOrder(id) {
  if(!confirm('حذف أمر الإنتاج؟')) return;
  DB.s('pos_mfg_orders', DB.g('pos_mfg_orders',[]).filter(x=>x.id!=id));
  renderProductionOrders();
  _mToast('تم الحذف','success');
}

// ============================================================
// مراقبة الجودة — Quality Control
// ============================================================
function renderQualityChecks() {
  const all    = DB.g('pos_mfg_quality', []);
  const orders = DB.g('pos_mfg_orders',  []);
  const orderF = _mVal('qcOrderFilter');
  // refresh order filter select
  const qcF=_mEl('qcOrderFilter');
  if(qcF){
    const cur=qcF.value;
    qcF.innerHTML='<option value="">كل الأوامر</option>'
      +orders.map(o=>{
        const no=o.orderNo||('PO-'+String(o.id).slice(-6).toUpperCase());
        return `<option value="${o.id}">${_mEsc(no)} — ${_mEsc(o.product||'')}</option>`;
      }).join('');
    qcF.value=cur;
  }
  const list=all.filter(q=>!orderF||String(q.orderId)===orderF);
  const pass=list.filter(q=>q.result==='pass').length;
  const fail=list.filter(q=>q.result==='fail').length;
  _mSet('mfg-qc-count', list.length);
  _mSet('mfg-qc-pass',  pass);
  _mSet('mfg-qc-fail',  fail);
  _mSet('mfg-qc-rate',  list.length>0?((pass/list.length)*100).toFixed(1)+'%':'0%');
  const rL={pass:'مقبول',fail:'مرفوض',conditional:'بشروط'};
  const rC={pass:'success',fail:'danger',conditional:'warning'};
  const tbody=_mEl('qualityBody'); if(!tbody) return;
  if(!list.length){tbody.innerHTML='<tr><td colspan="10" style="text-align:center;padding:24px">لا توجد فحوصات جودة</td></tr>';return;}
  tbody.innerHTML=list.map(q=>{
    const ord=orders.find(o=>o.id==q.orderId);
    const ordLbl=ord?(ord.orderNo||('PO-'+String(ord.id).slice(-6).toUpperCase()))+' — '+(ord.product||''):'-';
    return `<tr>
      <td>${_mEsc(ordLbl)}</td>
      <td>${_mEsc(q.inspector||'-')}</td>
      <td>${q.date||'-'}</td>
      <td>${(+(q.total||0)).toLocaleString('ar-EG')}</td>
      <td style="color:var(--success)">${(+(q.pass||0)).toLocaleString('ar-EG')}</td>
      <td style="color:var(--danger)">${(+(q.fail||0)).toLocaleString('ar-EG')}</td>
      <td>${_mEsc(q.defectType||'—')}</td>
      <td>${_mEsc(q.notes||'—')}</td>
      <td><span class="badge badge-${rC[q.result]||'muted'}">${rL[q.result]||q.result||'-'}</span></td>
      <td>
        <button class="btn-icon" onclick="openQualityModal('${q.id}')">✏️</button>
        <button class="btn-icon" style="color:var(--danger)" onclick="deleteQC('${q.id}')">🗑️</button>
      </td></tr>`;
  }).join('');
}

function openQualityModal(id) {
  const q = id ? (DB.g('pos_mfg_quality',[])).find(x=>x.id==id) : null;
  _mSet('qualityModalTitle', q?'تعديل فحص الجودة':'فحص جودة جديد');
  _mfgOrdersSelect('qcOrder','اختر أمر الإنتاج', q?.orderId||'');
  _mSetV('qcInspector',  q?.inspector  ||'');
  _mSetV('qcDate',       q?.date       ||new Date().toISOString().split('T')[0]);
  _mSetV('qcTotal',      q?.total      ||'');
  _mSetV('qcPass',       q?.pass       ||'');
  _mSetV('qcFail',       q?.fail       ||'');
  _mSetV('qcDefectType', q?.defectType ||'');
  _mSetV('qcResult',     q?.result     ||'pass');
  _mSetV('qcNotes',      q?.notes      ||'');
  _mSetV('qcEditId',     id||'');
  _mOpenModal('qualityModal');
}

function saveQualityCheck() {
  const orderId=_mVal('qcOrder'), inspector=_mVal('qcInspector').trim();
  if(!orderId)   return _mToast('اختر أمر الإنتاج','error');
  if(!inspector) return _mToast('أدخل اسم المفتش','error');
  const editId=_mVal('qcEditId');
  const list=DB.g('pos_mfg_quality',[]);
  const data={
    id:editId||Date.now(),
    orderId, inspector,
    date:_mVal('qcDate'),
    total:+(_mVal('qcTotal')||0),
    pass:+(_mVal('qcPass')||0),
    fail:+(_mVal('qcFail')||0),
    defectType:_mVal('qcDefectType'),
    result:_mVal('qcResult'),
    notes:_mVal('qcNotes').trim(),
    createdAt:Date.now()
  };
  if(editId){const i=list.findIndex(x=>x.id==editId);if(i>-1)list[i]=data;else list.push(data);}
  else list.push(data);
  DB.s('pos_mfg_quality',list);
  closeModal('qualityModal');
  renderQualityChecks();
  _mToast('تم حفظ فحص الجودة','success');
}

function deleteQC(id) {
  if(!confirm('حذف هذا الفحص؟')) return;
  DB.s('pos_mfg_quality', DB.g('pos_mfg_quality',[]).filter(x=>x.id!=id));
  renderQualityChecks();
  _mToast('تم الحذف','success');
}

// ============================================================
// تقارير التصنيع — Reports
// ============================================================
function renderMfgReports() {
  const orders=DB.g('pos_mfg_orders',[]), lines=DB.g('pos_mfg_lines',[]);
  const from=_mVal('mfgRptFrom'), to=_mVal('mfgRptTo');
  const filtered=orders.filter(o=>{
    if(o.status==='cancelled') return false;
    if(from && o.startDate && o.startDate<from) return false;
    if(to   && o.startDate && o.startDate>to)   return false;
    return true;
  });
  const totalGood  =filtered.reduce((s,o)=>s+(+(o.good||0)),0);
  const totalDefect=filtered.reduce((s,o)=>s+(+(o.defect||0)),0);
  const totalProd  =totalGood+totalDefect;
  const totalReq   =filtered.reduce((s,o)=>s+(+(o.qty||0)),0);
  _mSet('rpt-total-produced', totalProd.toLocaleString('ar-EG'));
  _mSet('rpt-total-good',     totalGood.toLocaleString('ar-EG'));
  _mSet('rpt-total-defect',   totalDefect.toLocaleString('ar-EG'));
  _mSet('rpt-efficiency',     totalReq>0?((totalProd/totalReq)*100).toFixed(1)+'%':'0%');
  _mSet('rpt-waste-rate',     totalProd>0?((totalDefect/totalProd)*100).toFixed(1)+'%':'0%');
  _mSet('rpt-material-cost',  '—');
  const byLine={};
  filtered.forEach(o=>{
    const k=o.lineId||'unknown';
    if(!byLine[k]) byLine[k]={orders:0,qty:0,good:0,defect:0};
    byLine[k].orders++; byLine[k].qty+=+(o.qty||0);
    byLine[k].good+=+(o.good||0); byLine[k].defect+=+(o.defect||0);
  });
  const tbody=_mEl('mfgRptBody'); if(!tbody) return;
  const entries=Object.entries(byLine);
  if(!entries.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px">لا توجد بيانات في هذه الفترة</td></tr>';return;}
  tbody.innerHTML=entries.map(([lid,d])=>{
    const ln=lines.find(l=>l.id==lid);
    const prod=d.good+d.defect;
    const eff=d.qty>0?((prod/d.qty)*100).toFixed(1):'0';
    return `<tr>
      <td><strong>${_mEsc(ln?.name||lid)}</strong></td>
      <td>${d.orders}</td>
      <td>${d.qty.toLocaleString('ar-EG')}</td>
      <td style="color:var(--success)">${d.good.toLocaleString('ar-EG')}</td>
      <td style="color:var(--danger)">${d.defect.toLocaleString('ar-EG')}</td>
      <td>${eff}%</td></tr>`;
  }).join('');
}

function exportMfgReport() {
  const orders=DB.g('pos_mfg_orders',[]), lines=DB.g('pos_mfg_lines',[]);
  const rows=[['خط الإنتاج','عدد الأوامر','الكمية','السليم','المعيب','الكفاءة']];
  const byLine={};
  orders.filter(o=>o.status!=='cancelled').forEach(o=>{
    const k=o.lineId||'unknown';
    if(!byLine[k]) byLine[k]={orders:0,qty:0,good:0,defect:0};
    byLine[k].orders++; byLine[k].qty+=+(o.qty||0);
    byLine[k].good+=+(o.good||0); byLine[k].defect+=+(o.defect||0);
  });
  Object.entries(byLine).forEach(([lid,d])=>{
    const ln=lines.find(l=>l.id==lid);
    const prod=d.good+d.defect;
    rows.push([ln?.name||lid, d.orders, d.qty, d.good, d.defect, (d.qty>0?((prod/d.qty)*100).toFixed(1):'0')+'%']);
  });
  const csv='﻿'+rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download='mfg_report_'+new Date().toISOString().split('T')[0]+'.csv';
  a.click();
  _mToast('تم تصدير التقرير','success');
}

// ============================================================
// Wire up showPage — patch to add manufacturing case
// ============================================================
(function() {
  const _orig = showPage;
  showPage = function(page) {
    _orig(page);
    if (page === 'manufacturing') renderManufacturingPage();
  };
})();
