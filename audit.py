# -*- coding: utf-8 -*-
"""
VOODO ERP — فاحص التناسق (Consistency Auditor)

بيمسك نوع البجّات اللي المراجعة البشرية بتفوّتها: الحاجات اللي كل ملف
فيها سليم لوحده، لكن الملفات مع بعض متعارضة. كل فحص هنا اتكتب بعد بج
حقيقي حصل فعلاً في السيستم:

  1. IDs مكررة      → بج ملاحظات أمر الشراء (الكلام اللي بيتكتب بيتلغي)
                       وبج فلتر فرع تقرير المخزون (مكانش شغال خالص)
  2. onclick يتيم    → زرار بينادي دالة اتمسحت (بيقع صامت)
  3. عنصر مفقود      → JS بيدوّر على id مش موجود في الـ HTML
  4. فلاتر فروع      → أكتر من فلتر فرع في نفس الصفحة (بج استيراد الإكسيل)

التشغيل:  python audit.py
بيرجّع exit code 1 لو فيه أخطاء — ينفع يتحط في CI.
"""
import re, sys, glob, io, os

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.dirname(os.path.abspath(__file__))
def rd(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

TEMPLATE = rd('src/template.html')
JS_FILES = sorted(glob.glob(os.path.join(ROOT, 'src/js/*.js')))
# القالب نفسه فيه <script> جوّاه (installPWA وغيرها) — لازم يتحسب كمصدر
# للدوال، وإلا كل دالة معرّفة هناك هتبان "يتيمة" بالغلط.
JS_ALL = '\n'.join(rd(os.path.relpath(f, ROOT)) for f in JS_FILES) \
       + '\n' + '\n'.join(re.findall(r'<script[^>]*>(.*?)</script>', TEMPLATE, re.S))

errors, warnings = [], []

# ── 1. IDs مكررة ────────────────────────────────────────────────────
# getElementById بيرجّع أول عنصر بس، فالتاني بيبقى ميت من غير ما حد ياخد
# باله — وده اللي خلى ملاحظات أمر الشراء تتكتب في حقل التصنيع وتضيع.
ids = re.findall(r'id="([a-zA-Z0-9_-]+)"', TEMPLATE)
seen, dupes = set(), set()
for i in ids:
    if i in seen: dupes.add(i)
    seen.add(i)
for d in sorted(dupes):
    lines = [n for n, l in enumerate(TEMPLATE.split('\n'), 1) if f'id="{d}"' in l]
    errors.append(f'ID مكرر: "{d}" في السطور {lines} — getElementById هيرجّع الأول بس')

# ── 2. onclick/onchange بينادي دالة مش موجودة ───────────────────────
handlers = set(re.findall(r'on(?:click|change|input|submit)="\s*([a-zA-Z_$][\w$]*)\s*\(', TEMPLATE))
defined  = set(re.findall(r'function\s+([a-zA-Z_$][\w$]*)', JS_ALL))
defined |= set(re.findall(r'(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()', JS_ALL))
BUILTIN = {'if', 'return', 'fn', 'this', 'window', 'document', 'event', 'alert', 'confirm'}
for h in sorted(handlers - defined - BUILTIN):
    errors.append(f'onclick يتيم: "{h}()" مربوط بزرار بس مفيش دالة بالاسم ده')

# ── 3. JS بيدوّر على id مش موجود في الـ HTML ─────────────────────────
# غالباً typo أو عنصر اتمسح والكود بتاعه فضل. بيتحسب تحذير مش خطأ لأن فيه
# عناصر بتتعمل ديناميكياً بالـ innerHTML.
tpl_ids = set(ids)
# عناصر بتتولد من الجافاسكريبت نفسه — سواء داخل innerHTML أو بإسناد
# مباشر زي `el.id = 'toastHost'` (زي مودالات الترحيل وحاوية التوستات).
dynamic  = set(re.findall(r'id=[\'"`]?\$?\{?([a-zA-Z0-9_-]+)', JS_ALL))
dynamic |= set(re.findall(r'\.id\s*=\s*[\'"`]([a-zA-Z0-9_-]+)[\'"`]', JS_ALL))
for m in re.finditer(r"getElementById\(\s*['\"]([a-zA-Z0-9_-]+)['\"]\s*\)", JS_ALL):
    el = m.group(1)
    if el not in tpl_ids and el not in dynamic:
        warnings.append(f'عنصر مفقود: JS بيدوّر على #{el} ومش لاقيه في القالب')

# ── 4. أكتر من فلتر فرع في نفس الصفحة ───────────────────────────────
# ده اللي خلّى استيراد الإكسيل يروح لفرع غير اللي على الشاشة.
lines = TEMPLATE.split('\n')
# أقرب حاوية سابقة: صفحة ولا مودال؟ الـ select اللي جوه مودال ده حقل في
# فورم (فرع التحويل، فرع الطلب...) مش فلتر عرض، فمالوش دعوة بالفحص ده.
def container_of(n):
    kind, name = None, '(header)'
    for i in range(n, -1, -1):
        mp = re.search(r'id="page-([a-zA-Z]+)"', lines[i])
        mm = re.search(r'class="modal|id="([a-zA-Z0-9_-]*[Mm]odal)"', lines[i])
        if mp: return 'page', mp.group(1)
        if mm: return 'modal', mm.group(1) or 'modal'
    return kind, name

per_page = {}
for n, l in enumerate(lines):
    # فلتر عرض حقيقي = select فيه branch وبينادي دالة إعادة رسم
    if '<select' in l and re.search(r'[Bb]ranch', l) and re.search(r'onchange="', l):
        mid = re.search(r'id="([a-zA-Z0-9_-]+)"', l)
        kind, name = container_of(n)
        if mid and kind == 'page':
            per_page.setdefault(name, []).append((n + 1, mid.group(1)))
for pg, sels in sorted(per_page.items()):
    if pg == 'reports':   # التقارير فيها تبويبات، كل تبويب ليه فلتره — مقبول
        continue
    if len(sels) > 1:
        detail = '، '.join(f'#{i} (سطر {n})' for n, i in sels)
        errors.append(f'صفحة "{pg}" فيها {len(sels)} فلاتر فروع: {detail}')

# ── 5. ملفات البناء ناقصة من الـ commit أو قديمة ────────────────────
# الصفحات الكسولة بتتبني في ملفات chunk-*.js منفصلة، مش جوه index.html.
# في 2026-08-01 اتعملت 3 إصلاحات في 93-accounting.js واتعمل commit لـ
# index.html بس — فالإصلاحات فضلت في الريبو من غير ما توصل للتطبيق أصلاً،
# لأن صفحة المحاسبة بتتحمّل من الشنك. الفحص ده بيمسك الحالتين: نسيان
# البناء بعد تعديل المصدر، ونسيان الـ commit بعد البناء.
import subprocess

def _git(*args):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True,
                              text=True, timeout=15).stdout.strip()
    except Exception:
        return None

_lazy = dict(re.findall(r"'([\w.-]+\.js)':\s*'(chunk-[\w-]+\.js)'", rd('build.py')))
for srcname, chunkname in _lazy.items():
    srcp   = os.path.join(ROOT, 'src/js', srcname)
    chunkp = os.path.join(ROOT, chunkname)
    if not os.path.exists(srcp) or not os.path.exists(chunkp):
        continue
    if os.path.getmtime(srcp) > os.path.getmtime(chunkp):
        errors.append(f'{chunkname} أقدم من {srcname} — شغّل build.py')

if _git('rev-parse', '--git-dir') is not None:
    artifacts = ['index.html'] + sorted(_lazy.values())
    for art in artifacts:
        if not os.path.exists(os.path.join(ROOT, art)):
            continue
        on_disk   = _git('hash-object', art)
        committed = _git('rev-parse', f'HEAD:{art}')
        if on_disk and committed and on_disk != committed:
            errors.append(f'{art} اتبنى بس ماتعملّهوش commit — التعديل مش هيوصل للتطبيق')

# ── التقرير ─────────────────────────────────────────────────────────
print('=' * 66)
print('  VOODO ERP — فاحص التناسق')
print('=' * 66)
for e in errors:   print(f'  ❌ {e}')
for w in warnings: print(f'  ⚠️  {w}')
if not errors and not warnings:
    print('  ✅ كل الفحوصات سليمة')
elif not errors:
    print(f'\n  ✅ مفيش أخطاء ({len(warnings)} تحذير للمراجعة)')
print('=' * 66)
print(f'  {len(errors)} خطأ · {len(warnings)} تحذير')
sys.exit(1 if errors else 0)
