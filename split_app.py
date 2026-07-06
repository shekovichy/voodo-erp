#!/usr/bin/env python3
"""
Split app.js into feature modules.
Run from: C:\\Projects\\voodo-erp
Output: src/js/  (replaces app.js with numbered module files)
"""

import os, re, shutil

SRC  = os.path.join(os.path.dirname(__file__), 'src', 'js', 'app.js')
DST  = os.path.join(os.path.dirname(__file__), 'src', 'js')

with open(SRC, encoding='utf-8') as f:
    lines = f.readlines()

# ── Find section boundaries ───────────────────────────────────────────────
# A section title sits between two consecutive // ══ lines.
# We record the 0-based index of the FIRST boundary line.
sec_starts = [0]   # first section always starts at line 0
for i in range(1, len(lines) - 1):
    if (lines[i-1].startswith('// ══') and
            lines[i+1].startswith('// ══') and
            not lines[i].startswith('// ══')):
        sec_starts.append(i - 1)   # start at the opening boundary line

sec_starts = sorted(set(sec_starts))
sec_starts.append(len(lines))      # sentinel

# ── Assign sections to numbered module files ──────────────────────────────
# Format: (output_filename, first_line_inclusive, last_line_exclusive)
# We read each section title to decide grouping.

def get_title(start_idx):
    """Return the section title string at sec_starts[start_idx]."""
    i = sec_starts[start_idx]
    if i + 2 < len(lines):
        candidate = lines[i + 1].strip().lstrip('/').strip()
        if lines[i].startswith('// ══') and lines[i + 2].startswith('// ══'):
            return candidate
    return ''

def sec_len(idx):
    return sec_starts[idx + 1] - sec_starts[idx]

# Build raw sections list
raw = []
for idx in range(len(sec_starts) - 1):
    raw.append({
        'title': get_title(idx),
        'start': sec_starts[idx],
        'end':   sec_starts[idx + 1],
    })

# ── Manual grouping map ───────────────────────────────────────────────────
# Each tuple: (output_name, list_of_title_substrings_that_go_in_this_file)
GROUPS = [
    ('00-core',             ['DATA', 'STATE']),
    ('05-utils',            ['UTILS', 'LOGIN']),
    ('10-pos-products',     ['CASHIER – PRODUCTS', 'CASHIER - PRODUCTS']),
    ('15-pos-cart',         ['CART']),
    ('20-pos-payment',      ['PAYMENT', 'RECEIPT']),
    ('25-navigation',       ['MANAGER PAGES']),
    ('30-dashboard',        ['DASHBOARD']),
    ('35-inventory',        ['INVENTORY']),
    ('40-sales',            ['SALES LIST']),
    ('45-reports',          ['REPORTS']),
    ('50-kpi',              ['KPI REPORT']),
    ('52-sellers-report',   ['SELLERS REPORT']),
    ('55-lowstock',         ['LOW STOCK', 'FULLSCREEN', 'HEATMAP', 'BACKUP']),
    ('60-settings',         ['SETTINGS']),
    ('65-firebase',         ['FIREBASE']),
    ('70-branches',         ['MULTI-BRANCH']),
    ('75-purchases',        ['PURCHASE MANAGEMENT']),
    ('80-hr-targets',       ['HR SYSTEM']),
    ('82-promotions',       ['PROMOTIONS']),
    ('85-crm',              ['CRM']),
    ('87-returns',          ['#2 RETURNS']),
    ('88-abc-expenses',     ['ABC ANALYSIS', 'EXPENSE TRACKING', 'AUDIT LOG', 'WHATSAPP']),
    ('89-cashier-return',   ['CASHIER RETURN']),
    ('90-barcode',          ['BARCODE']),
    ('91-loyalty',          ['LOYALTY']),
    ('92-hr-attendance',    ['ATTENDANCE', '']),   # empty title section
    ('93-accounting',       ['ACCOUNTING']),
    ('94-vlookup',          ['VLOOKUP', 'CUSTOMIZED REPORTS']),
    ('95-warehouse',        ['WAREHOUSE']),
    ('96-approvals',        ['PRICE-CHANGE APPROVAL', 'SUSPENDED PAGE TABS']),
    ('97-expense-requests', ['EXPENSE APPROVAL']),
    ('98-leave-requests',   ['LEAVE & PERMISSION']),
    ('99-printers',         ['PRINTING']),
    ('100-home',            ['FINGERPRINT']),
    ('105-manufacturing',   []),   # catches everything remaining
]

# Assign each raw section to a group
assigned = {}   # group_name -> list of raw section indices

def match_group(title):
    title_up = title.upper()
    for name, keywords in GROUPS:
        for kw in keywords:
            if kw and kw.upper() in title_up:
                return name
    return None

unmatched = []
for idx, sec in enumerate(raw):
    g = match_group(sec['title'])
    if g:
        assigned.setdefault(g, []).append(idx)
    else:
        unmatched.append(idx)

# Remaining unmatched → last group (manufacturing)
last_group = GROUPS[-1][0]
assigned.setdefault(last_group, []).extend(unmatched)

# ── Write module files ────────────────────────────────────────────────────
# Backup app.js first
backup = SRC + '.bak'
if not os.path.exists(backup):
    shutil.copy2(SRC, backup)
    print(f'Backed up app.js → app.js.bak')

written = []
for group_name, _ in GROUPS:
    indices = assigned.get(group_name, [])
    if not indices:
        continue
    indices.sort()
    # Collect lines
    chunk = []
    for idx in indices:
        chunk.extend(lines[raw[idx]['start']:raw[idx]['end']])

    out_path = os.path.join(DST, group_name + '.js')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.writelines(chunk)

    lc = sum(1 for _ in chunk)
    written.append((group_name + '.js', lc))
    print(f'  wrote {group_name}.js  ({lc} lines)')

# ── Verify total line count ───────────────────────────────────────────────
total_written = sum(lc for _, lc in written)
print(f'\nOriginal app.js : {len(lines)} lines')
print(f'Modules total   : {total_written} lines')
if total_written == len(lines):
    print('✓ Line counts match — safe to delete app.js')
    os.remove(SRC)
    print('  app.js deleted (backup at app.js.bak)')
else:
    print(f'⚠ Mismatch ({total_written} vs {len(lines)}) — app.js kept for safety')

# ── Generate CLAUDE.md ────────────────────────────────────────────────────
claude_lines = [
    '# VOODO ERP — CLAUDE.md\n',
    '\n',
    '## ⚠️ NEVER READ\n',
    '- `index.html` (generated by build.py — always 6 MB+)\n',
    '- `app.js.bak`\n',
    '\n',
    '## Build\n',
    '```\n',
    'python build.py   # generates index.html from src/\n',
    '```\n',
    '\n',
    '## Source files\n',
    '| File | Contents |\n',
    '|------|----------|\n',
    '| src/template.html | All HTML pages + CSS |\n',
]
for fname, lc in written:
    title = fname.replace('.js','').split('-',1)[-1].replace('-',' ').title()
    claude_lines.append(f'| src/js/{fname} | {title} ({lc} lines) |\n')

claude_lines += [
    '\n',
    '## Module file map\n',
]
# Add function→file map
for group_name, _ in GROUPS:
    indices = assigned.get(group_name, [])
    if not indices:
        continue
    indices.sort()
    fns = []
    for idx in indices:
        start = raw[idx]['start']
        end   = raw[idx]['end']
        for ln in lines[start:end]:
            m = re.match(r'^function (\w+)\(', ln)
            if m:
                fns.append(m.group(1))
    if fns:
        claude_lines.append(f'\n### {group_name}.js\n')
        for fn in fns:
            claude_lines.append(f'- `{fn}`\n')

claude_lines += [
    '\n',
    '## After any edit\n',
    '1. Run `python build.py` to regenerate index.html\n',
    '2. `git add -A && git commit -m "..." && git push`\n',
    '3. GitHub Actions deploys automatically\n',
]

claude_path = os.path.join(os.path.dirname(__file__), 'CLAUDE.md')
with open(claude_path, 'w', encoding='utf-8') as f:
    f.writelines(claude_lines)
print('\nWrote CLAUDE.md')
print('\n✅ Done! Now run: git add -A && git commit -m "refactor: split app.js" && git push')
