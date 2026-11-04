#!/usr/bin/env python3
"""CHANGELOG 生成与提取工具。

用法：
  python3 scripts/changelog.py generate <version>  # 用上次 tag 到 HEAD 的提交生成一个版本段落
  python3 scripts/changelog.py extract <version>   # 输出指定版本的段落（用于 GitHub Release 说明）

生成时会过滤 Bump / chore / docs / ci 等非功能提交，只保留面向用户的功能变化。
"""

import datetime
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = ROOT / "CHANGELOG.md"
HEADER = "# 更新日志\n\n> 记录面向用户的功能变化，技术细节不在此展开。\n\n"

CATEGORIES = {
    "feat": "新增",
    "fix": "修复",
    "perf": "优化",
}

SKIP_PREFIXES = ("chore", "docs", "ci", "build", "test", "style", "refactor")
SKIP_SUBJECTS = re.compile(r"^(Bump v|Merge )", re.IGNORECASE)
COMMIT_RE = re.compile(r"^(?P<type>[a-zA-Z]+)(?:\([^)]*\))?!?:\s*(?P<subject>.+)$")
SECTION_RE = re.compile(r"^##\s+\[?v?(?P<version>\d+(?:\.\d+){0,2})\]?(?:\s|$)", re.MULTILINE)


def run_git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def last_tag():
    try:
        return run_git("describe", "--tags", "--abbrev=0", "HEAD")
    except subprocess.CalledProcessError:
        return ""


def normalize(version):
    return str(version or "").strip().lstrip("vV")


def collect_commits():
    tag = last_tag()
    rev_range = f"{tag}..HEAD" if tag else "HEAD"
    try:
        subjects = run_git("log", rev_range, "--pretty=%s").splitlines()
    except subprocess.CalledProcessError:
        return {"feat": [], "fix": [], "perf": [], "other": []}

    grouped = {"feat": [], "fix": [], "perf": [], "other": []}
    seen = set()
    for raw in subjects:
        subject = raw.strip()
        if not subject or SKIP_SUBJECTS.match(subject):
            continue
        match = COMMIT_RE.match(subject)
        if match:
            kind = match.group("type").lower()
            text = match.group("subject").strip()
            if kind in SKIP_PREFIXES:
                continue
            key = kind if kind in grouped else "other"
        else:
            kind = ""
            text = subject
            key = "other"
        # 去掉常见的英文动词前缀，让文案更接近「功能描述」。
        text = re.sub(r"^(add|adds|added|support|supports|allow|allows)\s+", "", text, flags=re.IGNORECASE)
        text = text[:1].upper() + text[1:] if text else text
        if not text or text in seen:
            continue
        seen.add(text)
        grouped[key].append(text)
    return grouped


def build_section(version):
    grouped = collect_commits()
    lines = [f"## v{version} - {datetime.date.today().isoformat()}", ""]
    for key in ("feat", "fix", "perf", "other"):
        items = grouped.get(key) or []
        if not items:
            continue
        title = CATEGORIES.get(key, "其他")
        lines.append(f"### {title}")
        lines.append("")
        lines.extend(f"- {item}" for item in items)
        lines.append("")
    if len(lines) == 2:
        lines.append("- 本次版本暂无面向用户的功能变化。")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def cmd_generate(version):
    version = normalize(version)
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"invalid version: {version}")
    section = build_section(version)
    existing = CHANGELOG.read_text(encoding="utf-8") if CHANGELOG.exists() else HEADER
    if not existing.lstrip().startswith("# "):
        existing = HEADER + existing
    match = re.search(r"^##\s", existing, re.MULTILINE)
    if match:
        updated = existing[: match.start()] + section + "\n" + existing[match.start() :]
    else:
        updated = existing.rstrip() + "\n\n" + section
    CHANGELOG.write_text(updated, encoding="utf-8")
    print(f"[changelog] wrote v{version}")


def cmd_extract(version):
    version = normalize(version)
    if not CHANGELOG.exists():
        return
    text = CHANGELOG.read_text(encoding="utf-8")
    matches = list(SECTION_RE.finditer(text))
    for index, match in enumerate(matches):
        if normalize(match.group("version")) != version:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        print(text[match.start() : end].strip())
        return


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    command, version = argv[1], argv[2] if len(argv) > 2 else ""
    if command == "generate":
        cmd_generate(version)
    elif command == "extract":
        cmd_extract(version)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
