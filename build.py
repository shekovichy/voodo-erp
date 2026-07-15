#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VOODO ERP Build Script
Concatenates src/ files into index.html

Usage:
  python build.py          -> build once
  python build.py --watch  -> watch and rebuild on changes
"""

import os, sys, time, glob

SRC_DIR      = 'src'
TEMPLATE     = os.path.join(SRC_DIR, 'template.html')
CSS_DIR      = os.path.join(SRC_DIR, 'css')
JS_DIR       = os.path.join(SRC_DIR, 'js')
OUTPUT       = 'index.html'

CSS_PLACEHOLDER = '<!-- BUILD:CSS -->'
JS_PLACEHOLDER  = '<!-- BUILD:JS -->'

# Pages verified to have zero inbound calls from the always-loaded "core"
# code (no other module reads their functions unconditionally, no Firestore
# listener calls into them without a visibility guard). Their scripts are
# written as separate chunk files and lazy-loaded on first visit instead of
# being inlined into index.html — see _loadChunk()/showPage() in 25-navigation.js.
# Do NOT add a file here without re-checking for cross-file calls the way
# these four were checked (grep every other src/js/*.js for its function
# names) — an unverified addition can silently break navigation app-wide.
LAZY_CHUNKS = {
    '93-accounting.js':     'chunk-accounting.js',
    '95-warehouse.js':      'chunk-warehouse.js',
    '105-manufacturing.js': 'chunk-manufacturing.js',
    '75-purchases.js':      'chunk-purchases.js',
    '110-helpdesk.js':      'chunk-helpdesk.js',
    '115-pivot-reports.js': 'chunk-pivot.js',
    '120-data-migration.js': 'chunk-migration.js',
}


def collect_css():
    files = []
    main = os.path.join(CSS_DIR, 'styles.css')
    if os.path.exists(main):
        files.append(main)
    for f in sorted(glob.glob(os.path.join(CSS_DIR, '*.css'))):
        if f != main:
            files.append(f)
    parts = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            parts.append(fh.read())
    return '\n'.join(parts)


def collect_js():
    parts = []
    for f in sorted(glob.glob(os.path.join(JS_DIR, '*.js'))):
        if os.path.basename(f) in LAZY_CHUNKS:
            continue
        with open(f, encoding='utf-8') as fh:
            parts.append(fh.read())
    return '\n'.join(parts)


def write_lazy_chunks():
    for src_name, out_name in LAZY_CHUNKS.items():
        src_path = os.path.join(JS_DIR, src_name)
        with open(src_path, encoding='utf-8') as fh:
            content = fh.read()
        with open(out_name, 'w', encoding='utf-8') as fh:
            fh.write(content)


def build():
    with open(TEMPLATE, encoding='utf-8') as fh:
        html = fh.read()

    css = collect_css()
    js  = collect_js()

    html = html.replace(CSS_PLACEHOLDER, css)
    html = html.replace(JS_PLACEHOLDER, js)

    with open(OUTPUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    write_lazy_chunks()

    chunk_sizes = ', '.join(f'{name} {os.path.getsize(name):,}b' for name in LAZY_CHUNKS.values())
    print(f'Built {OUTPUT} ({len(html):,} bytes) + chunks: {chunk_sizes}')


def watch():
    print('Watching src/ for changes... (Ctrl+C to stop)')
    last = {}
    while True:
        changed = False
        for f in glob.glob(os.path.join(SRC_DIR, '**'), recursive=True):
            if os.path.isfile(f):
                mtime = os.path.getmtime(f)
                if last.get(f) != mtime:
                    last[f] = mtime
                    changed = True
        if changed:
            try:
                build()
            except Exception as e:
                print(f'Build error: {e}')
        time.sleep(1)


if __name__ == '__main__':
    if '--watch' in sys.argv:
        watch()
    else:
        build()
