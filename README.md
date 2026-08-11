# VOODO ERP — نظام نقاط البيع وإدارة المخزون

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-ready-purple?style=for-the-badge)
![Firebase](https://img.shields.io/badge/Firebase-realtime-orange?style=for-the-badge)

**A full-featured, multi-branch ERP & Point of Sale system — ships as a single static HTML file.**  
No installation. No server. Works offline. Deploy in 60 seconds.

[🐛 Report Bug](https://github.com/shekovichy/voodo-erp/issues)

</div>

---

## ✨ Why VOODO ERP?

Most ERP systems require expensive servers, complex setup, and weeks of training. VOODO ERP builds to a **single static HTML file** that runs anywhere — tablet, laptop, or phone — with zero installation. Yet it packs features that rival enterprise systems costing tens of thousands of dollars.

> ⚠️ **There is no public demo.** The Vercel and GitHub Pages URLs run a live
> production deployment backed by a real Firestore database with real business
> data. Accounts are per-deployment Firebase Auth users — deploy your own copy
> (see below) rather than looking for demo credentials.

---

## 🚀 Features

### 🛒 Point of Sale
- Fast cashier interface optimized for retail
- Barcode scanning support
- Multiple payment methods (cash, card, mixed)
- Invoice suspend & resume (park sales)
- Manager discount with PIN authorization
- Returns & refunds system
- WhatsApp invoice sharing

### 📦 Inventory Management
- Multi-branch stock control (branches are added at runtime, not fixed in code)
- Real-time stock transfers between branches
- **Stock-take** — count a whole branch or a custom sheet, scan by barcode, review variances before anything is written
- Low stock alerts & configurable thresholds
- Product families & categories
- Barcode & price tag printing

### 📊 Analytics & Reports
- Executive dashboard with KPIs
- ATV (Average Transaction Value) & UPT (Units Per Transaction)
- ABC product analysis (A/B/C classification)
- **Pivot reports** — pick your own dimensions & metrics, drill down into any cell
- **Strategic analytics** — discount analysis, stock-movement analysis, per-product ledger
- Comparative branch analytics
- Salesperson performance reports
- Profit & margin tracking per product/branch
- Excel & PDF export for all reports

### 👥 CRM & Customers
- Customer profiles with full purchase history
- Loyalty points with configurable rules
- Offers & promotions management

### 🏪 Multi-Branch
- Unlimited branches + main warehouse
- Per-branch dashboards and report filtering
- Inter-branch stock transfer management
- Real-time sync via Firebase Firestore, with per-branch data isolation enforced server-side

### 🛍️ Purchasing
- Supplier management
- Purchase orders (PO) creation & tracking
- Goods receipt with automatic inventory update

### 💰 Finance
- Expense tracking (branch-level & administrative)
- Revenue, cost & profit reports
- P&L, balance sheet & cash flow
- Accounting ledger with journal entries

### 👨‍💼 HR & Payroll
- Employee management
- Attendance tracking, with import from fingerprint devices
- Payroll (base salary + commission + bonus − deductions)
- Salesperson targets & commission calculation
- Leave & early-leave requests with management approval

### ✅ Internal Workflows
- Price-change approvals — a cashier requests, a manager approves
- Expense requests with approval chain
- Helpdesk tickets (category / priority / status)
- Data migration — import historical sales & expenses from a previous system

### ⚙️ Technical Highlights
- **PWA** — installable on any device, fully works offline
- **Dark mode** — system-aware toggle
- **Firebase real-time** — live sync across all devices
- **Firebase Auth + server-enforced permissions** — a per-user permission tree backed by Firestore security rules, not just hidden UI
- **Google Drive backup** — one-click cloud backup
- **Complete audit trail** — every change logged with user, timestamp, and before/after values
- **Export everything** — Excel & PDF for every report

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES2022+) — no framework, no bundler |
| Styling | Custom CSS (RTL-first) |
| Real-time Database | Firebase Firestore |
| Authentication | Firebase Auth (email/password) + `roles/{uid}` permission docs |
| Authorization | Firestore security rules |
| Offline Storage | localStorage |
| PWA | Web App Manifest + Service Worker |
| Deployment | Vercel + GitHub Pages (GitHub Actions) |
| Cloud Backup | Google Drive API (OAuth 2.0) |
| Architecture | 42 numbered source modules → one generated `index.html` (~15,000 lines of source), plus 7 lazy-loaded chunks |

---

## ⚡ Deploy in 60 Seconds

### Option 1: Vercel (Recommended — One Click)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/shekovichy/voodo-erp)

### Option 2: Local
```bash
git clone https://github.com/shekovichy/voodo-erp.git
cd voodo-erp
# Open index.html in any browser — done!
```

### Option 3: Any Static Host
Upload `index.html`, `chunk-*.js`, `manifest.json`, and `sw.js` to Netlify, GitHub Pages, S3, or any CDN.  
⚠️ The `chunk-*.js` files are required — the accounting, warehouse, purchasing, helpdesk, pivot, migration, and analytics pages are lazy-loaded from them at runtime.

---

## 🛠️ Building from Source

`index.html` is **generated** — never edit it directly. The real source lives in
`src/template.html` (all HTML + CSS) and `src/js/*.js` (42 numbered modules).

```bash
python build.py    # generates index.html + chunk-*.js from src/
python audit.py    # consistency checks — must pass before any push
```

`audit.py` catches the class of bug that survives human review: duplicate DOM
ids, `onclick` handlers bound to deleted functions, JS querying ids that don't
exist, more than one branch filter on a page, and chunks that were built but
never committed. Every check in it was written after a real bug.

---

## 🔧 First-Time Setup

1. Create a Firebase project, enable **Authentication → Email/Password** and **Firestore**
2. Put your Firebase config in `src/js/65-firebase.js`, then run `python build.py`
3. Deploy `firestore.rules` — **test it in the Firebase Console's Rules Playground first**
4. Create the owner account in Firebase Auth, sign in, then add staff accounts from **Settings → User Management**
5. Go to **Settings → Branches** — set your branch names
6. Optional: **Settings → Backup** — add a Google Drive Client ID for cloud backup

> Roles and permissions are enforced by `firestore.rules`, not by the UI. A user
> with no `roles/{uid}` document gets no access at all.

---

## 🌍 Language

- **Arabic (RTL)** — primary UI language
- Designed specifically for Arabic-speaking retail businesses in the Middle East

---

## 📈 Roadmap

- [x] Firebase Auth with server-enforced permissions
- [x] Per-user permission tree
- [x] Stock-take
- [x] Pivot & strategic analytics reports
- [ ] Full double-entry accounting (قيود يومية)
- [ ] REST API for third-party integrations
- [ ] E-commerce / online store module
- [ ] Native iOS & Android app
- [ ] Google verification for Drive OAuth

> A manufacturing (MRP/BOM) module was built and then **removed** in Aug 2026 —
> it was unused and caused record-id collisions. It is not planned to return.

---

## 🤝 Contributing

Pull requests are welcome!

```bash
# 1. Fork the repo
# 2. Create your branch
git checkout -b feature/my-feature
# 3. Edit src/ — never index.html, it is generated
python build.py && python audit.py
# 4. Commit (include the regenerated index.html and any chunk-*.js)
git commit -m 'Add my feature'
# 5. Push & open a PR
git push origin feature/my-feature
```

See [`CLAUDE.md`](CLAUDE.md) for the source-file map and [`TESTING.md`](TESTING.md)
for the manual test scenarios.

---

## 📄 License

MIT License — free for personal and commercial use.

---

## 💬 Support

- **Issues:** [GitHub Issues](https://github.com/shekovichy/voodo-erp/issues)
- **Email:** shekovichy@gmail.com

---

<div align="center">

Built with ❤️ for Arabic retail businesses

**⭐ Star this repo if you find it useful!**

</div>
