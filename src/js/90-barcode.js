// ══════════════════════════════════════════════
// BARCODE & PRICE TAG PRINTING
// ══════════════════════════════════════════════

let _bcSelected = new Set();

function openBarcodeModal() {
  _bcSelected = new Set(getInv().map(i => i.code));
  renderBarcodeList();
  renderBarcodePreview();
  document.getElementById('barcodeModal').classList.remove('hidden');
}

function renderBarcodeList() {
  const q = (document.getElementById('bcSearch')?.value || '').toLowerCase();
  const inv = getInv().filter(i => !q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  const container = document.getElementById('bcProductList'); if (!container) return;
  container.innerHTML = inv.map(i => `<div style="display:flex; align-items:center; gap:8px; padding:5px 4px; border-bottom:1px solid var(--border); font-size:12px;">
    <input type="checkbox" ${_bcSelected.has(i.code)?'checked':''} onchange="bcToggle('${escJsAttr(i.code)}',this.checked)" style="cursor:pointer;" />
    <span style="flex:1;">${escHtml(i.name)}</span>
    <span style="color:var(--text-muted);">${escHtml(i.code)}</span>
    <span style="color:var(--primary); font-weight:600;">${fmt(i.priceAfter)} ج</span>
  </div>`).join('');
}

function bcToggle(code, checked) {
  if (checked) _bcSelected.add(code); else _bcSelected.delete(code);
  renderBarcodePreview();
}

function bcSelectAll(val) {
  const inv = getInv();
  if (val) inv.forEach(i => _bcSelected.add(i.code));
  else _bcSelected.clear();
  renderBarcodeList();
  renderBarcodePreview();
}

function getBCTagDimensions() {
  const size = document.getElementById('bcTagSize')?.value || 'medium';
  return { small:{w:'90px',h:'55px',font:'8px'}, medium:{w:'132px',h:'80px',font:'10px'}, large:{w:'210px',h:'132px',font:'13px'} }[size];
}

function renderBarcodePreview() {
  renderBarcodeList();
  const inv = getInv().filter(i => _bcSelected.has(i.code));
  const copies = parseInt(document.getElementById('bcCopies')?.value) || 1;
  const showPrice = document.getElementById('bcShowPrice')?.value || 'after';
  const dim = getBCTagDimensions();
  const preview = document.getElementById('bcPreview'); if (!preview) return;
  const tags = [];
  inv.forEach(item => {
    for (let c = 0; c < Math.min(copies, 3); c++) { // show max 3 copies in preview
      tags.push(buildPriceTag(item, showPrice, dim, true));
    }
  });
  preview.innerHTML = tags.slice(0, 12).join('');
}

function buildPriceTag(item, showPrice, dim, preview) {
  const priceHTML = showPrice === 'none' ? '' :
    showPrice === 'after' ? `<div style="font-size:${preview?'11px':'14px'}; font-weight:800; color:#1a5faf; margin-top:2px;">${fmt(item.priceAfter)} ج</div>` :
    showPrice === 'before' ? `<div style="font-size:${preview?'11px':'14px'}; font-weight:800; color:#1a5faf; margin-top:2px;">${fmt(item.priceBefore||item.priceAfter)} ج</div>` :
    `<div style="font-size:9px; color:#888; text-decoration:line-through;">${fmt(item.priceBefore||item.priceAfter)} ج</div><div style="font-size:${preview?'12px':'16px'}; font-weight:800; color:#1a5faf;">${fmt(item.priceAfter)} ج</div>`;
  return `<div style="width:${dim.w}; height:${dim.h}; border:1px solid #ccc; border-radius:4px; padding:3px; display:flex; flex-direction:column; align-items:center; justify-content:center; background:white; font-family:monospace; overflow:hidden;">
    <div style="font-size:${dim.font}; font-weight:700; text-align:center; width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${escHtml(item.name)}</div>
    <svg id="bc-${preview?'p':'pr'}-${item.code.replace(/[^a-zA-Z0-9]/g,'_')}" style="max-width:100%; height:${preview?'24px':'36px'};"></svg>
    ${priceHTML}
  </div>`;
}

function printBarcodes() {
  const inv = getInv().filter(i => _bcSelected.has(i.code));
  if (!inv.length) { showToast('اختر أصناف أولاً'); return; }
  const copies = parseInt(document.getElementById('bcCopies')?.value) || 1;
  const showPrice = document.getElementById('bcShowPrice')?.value || 'after';
  const dim = getBCTagDimensions();
  let tags = [];
  inv.forEach(item => {
    for (let c = 0; c < copies; c++) tags.push(buildPriceTag(item, showPrice, dim, false));
  });
  const w = window.open('','_blank','width=800,height=600');
  const scTag = 'scr'+'ipt';
  const html = '<!DOCTYPE html><html dir="rtl"><head>'
    + '<meta charset="UTF-8">'
    + '<' + scTag + ' src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></' + scTag + '>'
    + '<style>body{margin:0;padding:10px;font-family:monospace;}.tags-wrap{display:flex;flex-wrap:wrap;gap:4px;}@media print{@page{margin:5mm;}body{padding:0;}}</style>'
    + '</head><body>'
    + '<div class="tags-wrap">' + tags.join('') + '</div>'
    + '<' + scTag + '>window.onload=function(){'
    + 'document.querySelectorAll("svg[id^=\'bc-pr-\']").forEach(function(svg){'
    + 'var code=svg.id.replace("bc-pr-","").replace(/_/g,"-");'
    + 'try{JsBarcode(svg,code,{format:"CODE128",displayValue:true,fontSize:8,height:28,margin:2});}catch(e){'
    + 'try{JsBarcode(svg,code.replace(/-/g,""),{format:"CODE128",displayValue:true,fontSize:8,height:28,margin:2});}catch(e2){}}'
    + '});setTimeout(function(){window.print();},800);};'
    + '</' + scTag + '>'
    + '</body></html>';
  w.document.write(html);
  w.document.close();
}



// ═══════════════════════════════════════════════════════════════════════
// PRINTING — طابعات (ESC/POS USB + Barcode + A4)
// ═══════════════════════════════════════════════════════════════════════
let _serialPort   = null;
let _serialWriter = null;

function openPrinterSettings() {
  document.getElementById('printerSettingsModal').classList.remove('hidden');
  updatePrinterStatusUI();
}
function updatePrinterStatusUI() {
  const el = document.getElementById('printerStatusTxt');
  if (el) el.innerHTML = _serialPort
    ? '<span style="color:#28a745;font-weight:700">🟢 الطابعة متصلة</span>'
    : '<span style="color:#dc3545">🔴 غير متصلة</span>';
}
async function connectReceiptPrinter() {
  if (!('serial' in navigator)) {
    showToast('متصفحك لا يدعم Web Serial API\nاستخدم Chrome أو Edge على سطح المكتب فقط');
    return;
  }
  try {
    _serialPort = await navigator.serial.requestPort();
    const baud  = parseInt(document.getElementById('printerBaud')?.value || '9600');
    await _serialPort.open({ baudRate: baud });
    _serialWriter = _serialPort.writable.getWriter();
    updatePrinterStatusUI();
    showToast('✅ تم الاتصال بالطابعة');
  } catch(e) {
    _serialPort = null; _serialWriter = null;
    showToast('❌ فشل الاتصال: ' + e.message);
  }
}
async function disconnectPrinter() {
  try {
    if (_serialWriter) { await _serialWriter.releaseLock(); _serialWriter = null; }
    if (_serialPort)  { await _serialPort.close(); _serialPort = null; }
    updatePrinterStatusUI();
    showToast('✅ تم قطع الاتصال');
  } catch(e) { showToast('❌ خطأ: ' + e.message); }
}
async function sendToSerial(data) {
  if (!_serialWriter) return false;
  try { await _serialWriter.write(data); return true; }
  catch(e) { showToast('❌ خطأ في الطباعة: ' + e.message); return false; }
}
function buildReceiptESCPOS(sale) {
  const ESC = 0x1B, GS = 0x1D;
  const enc = new TextEncoder();
  const bytes = [];
  const push = arr => arr.forEach(b => bytes.push(b));
  const text  = str => enc.encode(str).forEach(b => bytes.push(b));
  const line  = str => text(str + '\n');
  // Init + center
  push([ESC,0x40]); push([ESC,0x61,0x01]);
  push([ESC,0x21,0x10]); // double height
  const s = _settingsCache || {};
  line(s.shopName || 'Voodo ERP');
  push([ESC,0x21,0x00]); // normal
  if (s.shopAddress) line(s.shopAddress);
  if (s.shopPhone)   line('Tel: ' + s.shopPhone);
  line('--------------------------------');
  push([ESC,0x61,0x00]); // left
  line('Date: ' + (sale.date || new Date().toISOString().slice(0,10)));
  line('Inv : #' + String(sale.id||'').slice(-6));
  if (sale.salesperson) line('By  : ' + sale.salesperson);
  line('--------------------------------');
  (sale.items||[]).forEach(item => {
    const nm = String(item.name||'').slice(0,20);
    text(nm + '\n');
    const det = (item.qty||1)+' x '+(item.price||0).toFixed(2)+' = '+((item.qty||1)*(item.price||0)).toFixed(2);
    text(det + '\n');
  });
  line('--------------------------------');
  push([ESC,0x61,0x02]); // right
  push([ESC,0x21,0x10]); // double height
  line('TOTAL: ' + (sale.total||0).toFixed(2) + ' EGP');
  push([ESC,0x21,0x00]);
  if (sale.paid > sale.total) {
    line('PAID : ' + (sale.paid).toFixed(2));
    line('CHANGE: ' + ((sale.paid||0)-(sale.total||0)).toFixed(2));
  }
  push([ESC,0x61,0x01]);
  line('\n  Thank you / شكرًا  \n');
  text('\n\n\n');
  push([GS,0x56,0x00]); // cut
  return new Uint8Array(bytes);
}
async function printReceiptESCPOS(sale) {
  if (!_serialWriter) { printSaleReceipt(sale); return; }
  const bytes = buildReceiptESCPOS(sale);
  const ok = await sendToSerial(bytes);
  if (ok) showToast('✅ تم الإرسال للطابعة');
}
async function testReceiptPrint() {
  if (!_serialWriter) { showToast('الطابعة غير متصلة — اضغط اتصال أولاً'); return; }
  await printReceiptESCPOS({
    id:'TEST001', date: new Date().toISOString().slice(0,10),
    salesperson:'اختبار', items:[{name:'منتج تجريبي',qty:2,price:50}],
    total:100, paid:100
  });
}

