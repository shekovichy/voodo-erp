// ══════════════════════════════════════════════
// SELLERS REPORT
// ══════════════════════════════════════════════
function buildSellersReport() {
  const period = document.getElementById('rptSellersPeriod').value;
  document.getElementById('rptSellersCustom').classList.toggle('hidden', period!=='custom');
  const { from, to } = getDateRange(period, 'rptSellersFrom', 'rptSellersTo');
  const sales = getSales().filter(s => { const d=new Date(s.date); return d>=from&&d<=to; });

  const bd = {};
  sales.forEach(s => {
    const name = s.salesperson || 'غير محدد';
    if (!bd[name]) bd[name] = { name, count:0, units:0, revenue:0, disc:0 };
    // مفيش فلترة للمرتجعات فوق — دمجها هنا مقصود عشان الإيراد/الوحدات
    // يتصفوا صح (المرتجع بيحمل كمية وإجمالي بالسالب، فبيتخصم لوحده). لكن
    // العدّاد لازم يستثنيها: مرتجع مش فاتورة بيع جديدة للبائع، وعدّه كان
    // بيقلّل متوسط الفاتورة (ATV) لأي بائع ترجّع له بيع، بنفس مشكلة تقرير
    // الـ KPI (50-kpi.js).
    if (!s.isReturn) bd[name].count++;
    bd[name].units   += s.items.reduce((a,i)=>a+i.qty,0);
    bd[name].revenue += s.total;
    bd[name].disc    += s.disc||0;
  });
  const rows = Object.values(bd).sort((a,b)=>b.revenue-a.revenue);

  document.getElementById('sellersStatsGrid').innerHTML = rows.map(r => `
    <div class="stat-card">
      <div class="stat-label">👤 ${escHtml(r.name)}</div>
      <div class="stat-value" style="font-size:20px;">${fmt(r.revenue)} ج</div>
      <div class="stat-sub">${r.count} فاتورة · ${r.units} وحدة</div>
    </div>`).join('');

  document.getElementById('sellers-body').innerHTML = !rows.length
    ? '<tr><td colspan="7" class="text-center text-muted" style="padding:20px;">لا توجد بيانات</td></tr>'
    : rows.map(r => {
        const atv = r.count ? r.revenue/r.count : 0;
        const upt = r.count ? r.units/r.count : 0;
        return `<tr>
          <td><strong>${escHtml(r.name)}</strong></td>
          <td>${r.count}</td>
          <td>${r.units}</td>
          <td>${fmt(r.revenue)} ج</td>
          <td>${fmt(atv)} ج</td>
          <td>${upt.toFixed(2)}</td>
          <td style="color:var(--warning);">${fmt(r.disc)} ج</td>
        </tr>`;
      }).join('');

  if (chartSellers) chartSellers.destroy();
  if (rows.length) {
    chartSellers = new Chart(document.getElementById('chartSellers'), {
      type:'bar',
      data:{
        labels: rows.map(r=>r.name),
        datasets:[
          {label:'الإيرادات',data:rows.map(r=>r.revenue),backgroundColor:'rgba(200,25,60,.8)',borderRadius:6},
          {label:'الخصومات',data:rows.map(r=>r.disc),backgroundColor:'rgba(217,119,6,.6)',borderRadius:6}
        ]
      },
      options:{ plugins:{legend:{display:true}}, scales:{y:{beginAtZero:true}}, responsive:true }
    });
  }
}

