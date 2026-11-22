#!/usr/bin/env python3
"""上游补丁分组：auto（可机器合）/ manual（必须人眼）/ skip（不吃）。

判定顺序：
1. 路径命中 sync/sync-paths.conf 里的 `:!` 排除项 → skip（已删模块 / 我们重写过的外壳）
2. 我们 tree 里没有这个文件：
   - 上游基线里也没有 → 上游新增文件，先当 auto 候选（下游依赖再看）
   - 上游基线里有 → 是我们删掉的 → skip
3. 我们改过（git diff OLD..HEAD 涉及该文件）→ manual
4. 其余 → auto 候选
5. 依赖闭环：反复剔除「@/ 引用在 tree 里和候选集里都找不到」的 auto 候选，降级为 manual（原因写进报告）

输出：auto.txt / manual.txt / skip.txt / manual_reasons.tsv
"""
import argparse
import os
import re
import subprocess
import sys

IMPORT_RE = re.compile(r"from\s+'(@/(?:lib|components|app)/[^']+)'")
EXTS = ('', '.ts', '.tsx', '/index.ts', '/index.tsx')


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True).stdout


def exists_in_tree(path):
    return any(os.path.exists(path + e) for e in EXTS)


def resolve_import(spec):
    return 'src/' + spec[2:]


def read_conf_prefixes(conf):
    """只取 `:!` 开头的排除项；普通白名单行不算排除。"""
    prefixes = []
    with open(conf, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith(':!'):
                prefixes.append(line[2:])
    return prefixes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--old', required=True)
    ap.add_argument('--new', required=True)
    ap.add_argument('--files', required=True)
    ap.add_argument('--conf', required=True)
    ap.add_argument('--outdir', required=True)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    conf_prefixes = read_conf_prefixes(args.conf)

    files = [l.strip() for l in open(args.files, encoding='utf-8') if l.strip()]
    touched = set(l.strip() for l in git('diff', '--name-only', args.old, 'HEAD').splitlines() if l.strip())

    auto, manual, skip = [], [], []
    reasons = {}

    def is_excluded(path):
        return any(path == p or path.startswith(p.rstrip('/') + '/') for p in conf_prefixes if p)

    for f in files:
        if is_excluded(f):
            skip.append(f)
            reasons[f] = '命中排除清单'
            continue
        if not os.path.exists(f):
            existed = subprocess.run(['git', 'cat-file', '-e', f'{args.old}:{f}'],
                                     capture_output=True).returncode == 0
            if existed:
                skip.append(f)
                reasons[f] = '我们删掉的模块文件'
            else:
                auto.append(f)  # 上游新增文件，先入候选
            continue
        if f in touched:
            manual.append(f)
        else:
            auto.append(f)

    # 依赖闭环：以「上游 NEW 版本的内容」为准，反复剔除内部引用缺失的候选
    # （必须先看合并后的内容：上游可能把某个文件改写成依赖我们已删模块的版本）
    cache = {}

    def content_of(path):
        if path in cache:
            return cache[path]
        text = git('show', f'{args.new}:{path}')
        if not text and os.path.exists(path):
            text = open(path, encoding='utf-8', errors='ignore').read()
        cache[path] = text
        return text

    changed = True
    auto_set = set(auto)
    while changed:
        changed = False
        for f in list(auto_set):
            src = content_of(f)
            if not src:
                continue
            deps = {resolve_import(m) for m in IMPORT_RE.findall(src)}
            missing = [d for d in deps
                       if not exists_in_tree(d) and d not in auto_set]
            if missing:
                auto_set.discard(f)
                manual.append(f)
                reasons[f] = '依赖缺失：' + '、'.join(sorted(missing)[:3])
                changed = True

    auto = sorted(auto_set)
    manual = sorted(set(manual))
    skip = sorted(set(skip))

    # 上游新增但没人引用的候选文件，留着也无害，但为了保守，仍然合（它们是纯新增，不影响现有代码）
    with open(os.path.join(args.outdir, 'auto.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(auto) + ('\n' if auto else ''))
    with open(os.path.join(args.outdir, 'manual.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(manual) + ('\n' if manual else ''))
    with open(os.path.join(args.outdir, 'skip.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(skip) + ('\n' if skip else ''))
    with open(os.path.join(args.outdir, 'reasons.tsv'), 'w', encoding='utf-8') as fh:
        for f in manual:
            fh.write(f"{f}\t{reasons.get(f, '我们改过')}\n")

    print(f"auto={len(auto)} manual={len(manual)} skip={len(skip)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
