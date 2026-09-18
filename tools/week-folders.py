#!/usr/bin/env python3
"""Rebuild the Week N folders and their README index from data.json.

The journal is the source of truth; this just gives every class week a real
folder on disk to drop PDFs and images into, with a README listing what the
journal already files under that week. Re-run it after adding entries:

    python3 tools/week-folders.py
"""
import json, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TERM_START = datetime.date(2026, 8, 28)   # week 1 opens this Friday — same rule as app.js
TERM_WEEKS = 15

KIND = {"reading": "Reading", "artist": "Artist", "font": "Font",
        "design-ref": "Design reference", "resource": "Resource",
        "image": "Image", "document": "Document", "journal": "Journal"}

def week_of(iso):
    d = datetime.date.fromisoformat(iso)
    n = (d - TERM_START).days // 7 + 1
    return max(1, min(TERM_WEEKS, n))

def span(n):
    a = TERM_START + datetime.timedelta(days=7 * (n - 1))
    b = a + datetime.timedelta(days=6)
    fmt = lambda d, m: d.strftime("%-d %B %Y") if m else d.strftime("%-d")
    return f"{fmt(a, a.month != b.month)}–{b.strftime('%-d %B %Y')}"

def line(e):
    bits = [KIND.get(e["kind"], e["kind"])]
    if e.get("author"):
        bits.append(e["author"])
    if e.get("url"):
        bits.append(e["url"])
    for a in e.get("attachments", []):
        bits.append("file: " + a["name"])
    return f"- **{e['title']}** — {e['date']} · " + " · ".join(bits)

data = json.load(open(os.path.join(ROOT, "data.json")))
by_week = {}
for e in data["entries"]:
    by_week.setdefault(week_of(e["date"]), []).append(e)

latest = max(by_week) if by_week else 1
for n in range(1, latest + 1):
    folder = os.path.join(ROOT, f"Week {n}")
    os.makedirs(folder, exist_ok=True)
    items = sorted(by_week.get(n, []), key=lambda e: (e["date"], e["title"]))
    journal = [e for e in items if e["kind"] == "journal"]
    refs = [e for e in items if e["kind"] != "journal"]
    on_disk = sorted(f for f in os.listdir(folder)
                     if not f.startswith(".") and f != "README.md")

    out = [f"# Week {n}", "", span(n), "",
           "Source files for this week live in this folder. The list below is generated "
           "from `data.json`, which is the journal's source of truth — "
           "re-run `python3 tools/week-folders.py` after adding entries.", ""]
    out += ["## Journal", ""] + ([line(e) for e in journal] or ["_None._"]) + [""]
    out += ["## References", ""] + ([line(e) for e in refs] or ["_None._"]) + [""]
    out += ["## Files in this folder", ""] + \
           ([f"- `{f}`" for f in on_disk] or ["_None yet._"]) + [""]

    open(os.path.join(folder, "README.md"), "w").write("\n".join(out))
    print(f"Week {n}: {len(journal)} journal, {len(refs)} references, {len(on_disk)} files")
