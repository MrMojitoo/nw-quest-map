#!/usr/bin/env python3
# Re-génère public/data/quests.json à partir d'un CSV exporté
import sys, os, json, re, datetime
import pandas as pd
import numpy as np

if len(sys.argv) < 2:
    print("Usage: python tools/convert_csv_to_json.py <CSV_PATH>")
    sys.exit(1)

csv_path = sys.argv[1]
out_path = os.path.join('public', 'data', 'quests.json')
df = pd.read_csv(csv_path, encoding='utf-8', low_memory=False)
df.columns = [c.strip() for c in df.columns]
EXCLUDE_RE = re.compile(r"(^01_|^S_|^Quest_|AC_Test|devworld|_alt|EnterZone_SM|_EG|_RW" \
                        r"|(_soldier|_destroyer|_ranger|_musketeer|_occultist|_mystic|_swordsman)$)")
TYPE_EXCLUDE_RE = re.compile(r"\b(Artifact|Mission|Community Goal)\b", re.IGNORECASE)
MANUAL_PATH = os.path.join('tools', 'manual_links.json')

def to_int_safe(x):
    try:
        if x is None or (isinstance(x, float) and np.isnan(x)): return None
        if isinstance(x, bool): return int(x)
        s = str(x).strip()
        if s.lower() in ('true','false','nan','none',''): return None
        return int(float(s))
    except Exception:
        return None

def get(row, col, default=None):
    return row[col] if col in row and pd.notna(row[col]) else default

# 1) Construire la liste des quêtes conservées (on exclut ici)
rows = []
for _, r in df.iterrows():
    qid = str(get(r, 'ID', '')).strip()
    if not qid or EXCLUDE_RE.search(qid):
        continue
    t = str(get(r, 'Type', '') or '')
    if TYPE_EXCLUDE_RE.search(t):
        continue
    rows.append(r)

# 2) Index achievement -> questId uniquement sur les quêtes conservées
ach_to_q = {}
for r in rows:
    ach = str(get(r, 'Achievement Id', '')).strip()
    qid = str(get(r, 'ID', '')).strip()
    if ach:
        ach_to_q.setdefault(ach, set()).add(qid)

token_re = re.compile(r"[A-Za-z0-9_\\-]+")

# Support : !TOKEN, TOKEN, opérateurs &&, ||, parenthèses (on considère le ! immédiat)
def parse_logic(expr: str):
    out = []
    if not isinstance(expr, str) or not expr.strip():
        return out
    for raw in re.findall(r'!?[A-Za-z0-9_\\-]+', expr):
        is_neg = raw.startswith('!')
        tok = raw[1:] if is_neg else raw
        out.append((tok, is_neg))
    return out

quests = []
edges = []
for r in rows:
    qid = str(get(r, 'ID', '')).strip()
    if not qid: 
        continue
    q = {
        "id": qid,
        "title": str(get(r, 'Title', '')).strip(),
        "description": str(get(r, 'Description', '')).strip(),
        "type": str(get(r, 'Type', '')).strip(),
        "icon": str(get(r, 'Icon', '')).strip(),
        "recommended_level": to_int_safe(get(r, 'Difficulty Level', None)),
        "required_level": to_int_safe(get(r, 'Required Level', None)),
        "zone_id": to_int_safe(get(r, 'Exclusive Territory', None)),
        "rewards": [],
        "achievement_id": str(get(r, 'Achievement Id', '')).strip() or None,
        "required_achievements_expr": str(get(r, 'Required Achievement Id', '')).strip() or None,
        "prerequisites": [],
        "not_prerequisites": [],
        "repeatable": False,
        "priority": 1
    }
    exp = to_int_safe(get(r, 'Experience Reward', None))
    if exp and exp > 0: q["rewards"].append(f"XP +{exp}")
    az = to_int_safe(get(r, 'Azoth Reward', None))
    if az and az > 0: q["rewards"].append(f"Azoth +{az}")
    coin = to_int_safe(get(r, 'Currency Reward', None))
    if coin and coin > 0: q["rewards"].append(f"Coin +{coin}")
    item_name = str(get(r, 'Item Reward Name', '')).strip()
    item_qty = to_int_safe(get(r, 'Item Reward Qty', None))
    if item_name:
        q["rewards"].append(f"{item_name}" + (f" x{item_qty}" if item_qty and item_qty>1 else ""))

    # Repeatable via "Schedule Id" (Hourly/Daily)
    sched = str(get(r, 'Schedule Id', '') or '')
    if isinstance(sched, str) and ('hourly' in sched.lower() or 'daily' in sched.lower()):
        q["repeatable"] = True

    # Prérequis logiques (tokens positifs ET négatifs)
    req = q["required_achievements_expr"]
    if req:
        seen_pos, seen_neg = set(), set()
        for tok, is_neg in parse_logic(req):
            if tok in ach_to_q:
                for src in ach_to_q[tok]:
                    if src == qid:
                        continue  # pas d'auto-lien
                    if is_neg:
                        if src not in seen_neg:
                            q["not_prerequisites"].append(src)
                            edges.append((src, qid, True))   # True = négatif
                            seen_neg.add(src)
                    else:
                        if src not in seen_pos:
                            q["prerequisites"].append(src)
                            edges.append((src, qid, False))  # False = positif
                            seen_pos.add(src)

    quests.append(q)

for q in quests:
    if q["type"].strip().lower() == "main story quest":
        q["priority"] = 0

quests.sort(key=lambda x: x["priority"])

id_to_q = {q["id"]: q for q in quests}
if os.path.isfile(MANUAL_PATH):
    try:
        with open(MANUAL_PATH, 'r', encoding='utf-8') as f:
            manual = json.load(f)
        for link in (manual.get("links") or []):
            src = str(link.get("source", "")).strip()
            tgt = str(link.get("target", "")).strip()
            kind = str(link.get("type", "requires")).strip().lower()  # default = requires
            if not src or not tgt or src == tgt:
                continue
            if src not in id_to_q or tgt not in id_to_q:
                print(f"[manual_links] ignoré (id absent): {src} -> {tgt}")
                continue
            target_q = id_to_q[tgt]
            # initialise les listes si besoin
            target_q.setdefault("prerequisites", [])
            target_q.setdefault("not_prerequisites", [])
            if kind in ("not", "negative", "forbid"):
                if src not in target_q["not_prerequisites"]:
                    target_q["not_prerequisites"].append(src)
                    edges.append((src, tgt, True))   # True = négatif
            else:
                if src not in target_q["prerequisites"]:
                    target_q["prerequisites"].append(src)
                    edges.append((src, tgt, False))  # False = positif
    except Exception as ex:
        print(f"[manual_links] erreur de lecture {MANUAL_PATH}: {ex}")


data = {
    "generated_at": datetime.datetime.utcnow().isoformat()+"Z",
    "quest_count": len(quests),
    "edge_count": len(edges),
    "quests": quests
}

os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Écrit {out_path} (quests={len(quests)}, edges={len(edges)})")
