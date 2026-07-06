// ══════════════════════════════════════════════
// DEMO MODE — داتا تجريبية جاهزة
// ══════════════════════════════════════════════

function loadDemoAndEnter() {
  const btn = document.getElementById('demoBtnText');
  if (btn) btn.textContent = '⏳ جاري تحميل الديمو...';

  // ── 1. SETTINGS ─────────────────────────────
  const settings = {
    threshold: 5,
    salespeople: ['أحمد سالم', 'محمد علي', 'سارة خالد', 'مروة حسن'],
    branches: {
      wh: '🏭 المخزن الرئيسي',
      b1: 'فرع المعادي',
      b2: 'فرع مدينة نصر',
      b3: 'فرع الهرم',
      b4: 'فرع الإسكندرية'
    }
  };
  DB.s('pos_settings', settings);
  _settingsCache = settings;

  // ── 2. INVENTORY ─────────────────────────────
  // السيستم بيستخدم priceAfter كسعر البيع الحالي
  const inv = [
    { code:'P001', name:'طقم غرفة نوم كاملة',  priceAfter:8500,  cost:5800, qty:12, category:'أثاث',    barcode:'6001001' },
    { code:'P002', name:'كنبة ثلاثة مقاعد',     priceAfter:4200,  cost:2700, qty:8,  category:'أثاث',    barcode:'6001002' },
    { code:'P003', name:'طاولة سفرة 6 كراسي',  priceAfter:3600,  cost:2200, qty:6,  category:'أثاث',    barcode:'6001003' },
    { code:'P004', name:'مرتبة طبية 160×200',   priceAfter:2800,  cost:1700, qty:15, category:'مراتب',   barcode:'6001004' },
    { code:'P005', name:'مرتبة أطفال 120×200',  priceAfter:1400,  cost:850,  qty:20, category:'مراتب',   barcode:'6001005' },
    { code:'P006', name:'طقم ستائر صالة',       priceAfter:1200,  cost:700,  qty:25, category:'ستائر',   barcode:'6001006' },
    { code:'P007', name:'ستارة غرفة نوم',        priceAfter:650,   cost:380,  qty:40, category:'ستائر',   barcode:'6001007' },
    { code:'P008', name:'سجادة صالة 3×4',       priceAfter:1800,  cost:1100, qty:10, category:'سجاد',    barcode:'6001008' },
    { code:'P009', name:'سجادة صغيرة 1.5×2.5', priceAfter:650,   cost:380,  qty:18, category:'سجاد',    barcode:'6001009' },
    { code:'P010', name:'مطبخ ألمونيوم كامل',   priceAfter:12000, cost:8000, qty:5,  category:'مطابخ',   barcode:'6001010' },
    { code:'P011', name:'براد أبواب زجاجية',    priceAfter:850,   cost:500,  qty:22, category:'إكسسوار', barcode:'6001011' },
    { code:'P012', name:'لوحة ديكور فنية',      priceAfter:450,   cost:250,  qty:35, category:'ديكور',   barcode:'6001012' },
    { code:'P013', name:'إضاءة سقف LED',        priceAfter:320,   cost:180,  qty:50, category:'إضاءة',   barcode:'6001013' },
    { code:'P014', name:'طقم بشكير فاخر',       priceAfter:280,   cost:150,  qty:60, category:'منسوجات', barcode:'6001014' },
    { code:'P015', name:'مفرش سرير مطرز',       priceAfter:420,   cost:240,  qty:45, category:'منسوجات', barcode:'6001015' },
    { code:'P016', name:'خزانة ملابس 4 أبواب',  priceAfter:5500,  cost:3600, qty:7,  category:'أثاث',    barcode:'6001016' },
    { code:'P017', name:'كومودينو خشب',         priceAfter:780,   cost:450,  qty:20, category:'أثاث',    barcode:'6001017' },
    { code:'P018', name:'مرآة حائط كبيرة',      priceAfter:950,   cost:550,  qty:15, category:'ديكور',   barcode:'6001018' },
    { code:'P019', name:'طاولة قهوة زجاج',      priceAfter:1100,  cost:650,  qty:12, category:'أثاث',    barcode:'6001019' },
    { code:'P020', name:'أريكة فردية مودرن',    priceAfter:1800,  cost:1100, qty:9,  category:'أثاث',    barcode:'6001020' },
  ];

  _invCacheByBranch['b1'] = inv;
  _invCacheByBranch['b2'] = inv.map(p => ({...p, qty: Math.floor(p.qty * 0.7)}));
  _invCacheByBranch['b3'] = inv.map(p => ({...p, qty: Math.floor(p.qty * 0.5)}));
  BRANCH_IDS.forEach(b => DB.s(`pos_inv_${b}`, _invCacheByBranch[b] || []));

  // ── 3. SALES (last 60 days) ──────────────────
  const sellers = settings.salespeople;
  const payMethods = ['cash','card','cash','cash','card','installment'];
  const branches = ['b1','b1','b1','b2','b2','b3'];
  const sales = [];
  const now = Date.now();

  for (let d = 0; d < 60; d++) {
    const dayMs = now - d * 86400000;
    const dayDate = new Date(dayMs);
    // 2-6 sales per day, fewer on Fridays
    const count = dayDate.getDay() === 5 ? 1 : Math.floor(Math.random() * 5) + 2;
    for (let s = 0; s < count; s++) {
      const numItems = Math.floor(Math.random() * 3) + 1;
      const items = [];
      const usedCodes = new Set();
      for (let i = 0; i < numItems; i++) {
        let p;
        do { p = inv[Math.floor(Math.random() * inv.length)]; } while (usedCodes.has(p.code));
        usedCodes.add(p.code);
        const qty = Math.floor(Math.random() * 2) + 1;
        items.push({ ...p, qty, total: p.priceAfter * qty });
      }
      const sub   = items.reduce((a, i) => a + i.priceAfter * i.qty, 0);
      const disc  = Math.random() > 0.8 ? Math.round(sub * 0.05) : 0;
      const total = sub - disc;
      const branchId = branches[Math.floor(Math.random() * branches.length)];
      const saleDate = new Date(dayMs - Math.floor(Math.random() * 28800000)); // spread over 8hrs
      sales.push({
        id: dayMs + s,
        date: saleDate.toISOString(),
        cashier: 'مدير',
        salesperson: sellers[Math.floor(Math.random() * sellers.length)],
        items,
        sub, disc, total,
        paid: total + (Math.random() > 0.7 ? Math.floor(Math.random() * 200) : 0),
        change: 0,
        payMethod: payMethods[Math.floor(Math.random() * payMethods.length)],
        appliedPromos: [],
        branchId,
        branchName: settings.branches[branchId]
      });
    }
  }
  _salesCache = sales;
  DB.s('sales', sales);

  // ── 4. SUPPLIERS & PURCHASES ─────────────────
  const suppliers = [
    { id:'S001', name:'شركة النيل للأثاث',     phone:'01001234567', email:'nile@furniture.eg',    balance:15000 },
    { id:'S002', name:'مصنع الشرق للمراتب',    phone:'01112345678', email:'east@mattress.eg',     balance:8500  },
    { id:'S003', name:'توريدات الديكور الحديث', phone:'01223456789', email:'modern@decor.eg',      balance:3200  },
  ];
  _suppliersCache = suppliers;
  DB.s('pos_suppliers', suppliers);

  const purchases = [
    { id:'PO001', supplierId:'S001', supplierName:'شركة النيل للأثاث',  date: new Date(now-15*86400000).toISOString(), status:'received', items:[{code:'P001',name:'طقم غرفة نوم كاملة',qty:5,cost:5800,total:29000}], total:29000, branchId:'b1' },
    { id:'PO002', supplierId:'S002', supplierName:'مصنع الشرق للمراتب', date: new Date(now-8*86400000).toISOString(),  status:'pending',  items:[{code:'P004',name:'مرتبة طبية 160×200',qty:10,cost:1700,total:17000}], total:17000, branchId:'b1' },
    { id:'PO003', supplierId:'S003', supplierName:'توريدات الديكور',     date: new Date(now-3*86400000).toISOString(),  status:'ordered',  items:[{code:'P012',name:'لوحة ديكور فنية',qty:20,cost:250,total:5000}],   total:5000,  branchId:'b2' },
  ];
  _purchaseCache = purchases;
  DB.s('pos_purchases', purchases);

  // ── 5. HR TARGETS ────────────────────────────
  const month = new Date().toISOString().slice(0,7);
  const hrData = sellers.map((name, i) => ({
    name, month,
    target: [30000, 25000, 20000, 18000][i] || 20000,
    commission: 2.5,
    bonus: [1500, 1000, 800, 800][i] || 800
  }));
  _hrCache = hrData;
  DB.s('pos_hr', hrData);

  // ── 6. EXPENSES ──────────────────────────────
  const expenses = [
    { id:'E001', date: new Date(now-5*86400000).toISOString(),  type:'branch',   branchId:'b1', category:'إيجار',      amount:12000, note:'إيجار شهر يوليو — فرع المعادي' },
    { id:'E002', date: new Date(now-5*86400000).toISOString(),  type:'branch',   branchId:'b2', category:'إيجار',      amount:9500,  note:'إيجار شهر يوليو — فرع مدينة نصر' },
    { id:'E003', date: new Date(now-3*86400000).toISOString(),  type:'company',  branchId:'b1', category:'رواتب',      amount:35000, note:'رواتب موظفين يوليو' },
    { id:'E004', date: new Date(now-1*86400000).toISOString(),  type:'branch',   branchId:'b1', category:'مصاريف تشغيل', amount:2200, note:'فواتير كهرباء ومياه' },
    { id:'E005', date: new Date(now-2*86400000).toISOString(),  type:'company',  branchId:'b1', category:'تسويق',      amount:3500,  note:'إعلانات سوشيال ميديا' },
    { id:'E006', date: new Date(now-10*86400000).toISOString(), type:'branch',   branchId:'b3', category:'صيانة',      amount:1800,  note:'صيانة تكييفات الفرع' },
  ];
  _expensesCache = expenses;
  DB.s('pos_expenses', expenses);

  // ── 7. CRM CUSTOMERS ─────────────────────────
  const customers = [
    { id:'C001', name:'أحمد محمود الشريف',  phone:'01001111111', email:'ahmed@email.com',   points:450,  totalSpent:18500, visits:7,  createdAt: new Date(now-90*86400000).toISOString() },
    { id:'C002', name:'منى عبدالله حسن',    phone:'01112222222', email:'mona@email.com',    points:280,  totalSpent:11200, visits:4,  createdAt: new Date(now-60*86400000).toISOString() },
    { id:'C003', name:'كريم سامي فؤاد',     phone:'01223333333', email:'karim@email.com',   points:620,  totalSpent:24800, visits:10, createdAt: new Date(now-120*86400000).toISOString() },
    { id:'C004', name:'هبة محمد النجار',    phone:'01034444444', email:'heba@email.com',    points:150,  totalSpent:6000,  visits:2,  createdAt: new Date(now-30*86400000).toISOString() },
    { id:'C005', name:'طارق علي إبراهيم',   phone:'01155555555', email:'tarek@email.com',   points:890,  totalSpent:35600, visits:15, createdAt: new Date(now-180*86400000).toISOString() },
  ];
  DB.s('pos_customers', customers);

  // ── 8. BRANCH + PASSWORD + FLAG ──────────────
  // نحط باسورد الديمو "1234" بس لو مافيش باسورد أصلاً
  const existingUsers = DB.g('users', { admin: '', cashier: '' });
  if (!existingUsers.admin) {
    DB.s('users', { admin: '1234', cashier: '1234' });
  }
  DB.s('currentBranch', 'b1');
  DB.s('pos_demo_mode', true);

  // ── 9. ENTER AS ADMIN ────────────────────────
  currentBranch = 'b1';
  currentUser   = 'admin';
  document.getElementById('loginPage').classList.add('hidden');

  // Show demo banner
  _showDemoBanner();

  // Show manager view properly then navigate to home
  switchToHome(); // هيظهر managerView ويعمل renderHomeIcons

  // Refresh low stock bell
  if (typeof updateLowStockBell === 'function') setTimeout(updateLowStockBell, 300);
}

function _showDemoBanner() {
  if (document.getElementById('demoBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'demoBanner';
  bar.innerHTML = `
    <span>⚡ وضع الديمو — البيانات تجريبية</span>
    <a href="#" onclick="if(confirm('مسح كل بيانات الديمو والبدء من جديد؟')){localStorage.clear();location.reload();}return false;"
       style="color:#fbbf24;margin-right:16px;font-weight:700;text-decoration:underline;">مسح الديمو</a>
  `;
  bar.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:9999;
    background:linear-gradient(90deg,#1e1b4b,#312e81);
    color:#c7d2fe;font-size:13px;font-weight:600;
    padding:7px 20px;text-align:center;
    display:flex;align-items:center;justify-content:center;gap:8px;
    box-shadow:0 2px 8px rgba(0,0,0,.3);
  `;
  document.body.prepend(bar);
  // Push content down
  document.body.style.paddingTop = '35px';
}
