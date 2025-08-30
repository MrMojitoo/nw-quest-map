#!/usr/bin/env python3
# Re-génère public/data/quests.json à partir d'un CSV exporté
import sys, os, json, re, datetime, glob
import pandas as pd
import numpy as np
from typing import Dict, List, Set

if len(sys.argv) < 2:
    print("Usage: python tools/convert_csv_to_json.py <QUESTS_CSV> [ITEMS_CSV] [OBJECTIVE_TASKS_PATH]")
    sys.exit(1)

csv_path = sys.argv[1]
out_path = os.path.join('public', 'data', 'quests.json')
df = pd.read_csv(csv_path, encoding='utf-8', low_memory=False)
df.columns = [c.strip() for c in df.columns]
EXCLUDE_RE = re.compile(r"(^01_|^S_|^Quest_|AC_Test|devworld|_alt|EnterZone_SM|_EG|_RW|^9806_|^9809_|^9812_" \
                        r"|(_soldier|_destroyer|_ranger|_musketeer|_occultist|_mystic|_swordsman)$)")
TYPE_EXCLUDE_RE = re.compile(r"\b(Artifact|Mission|Community Goal)\b", re.IGNORECASE)
MANUAL_PATH = os.path.join('tools', 'manual_links.json')



# ----- items.csv (optionnel) -------------------------------------------------
# Colonnes attendues: "Name", "Item ID", "Icon Path", "Rarity"
items_path = None
if len(sys.argv) >= 3:
    items_path = sys.argv[2]
else:
    # chemin par défaut
    cand = os.path.join('tools', 'items.csv')
    if os.path.isfile(cand):
        items_path = cand

items_by_id = {}
items_by_name = {}
if items_path and os.path.isfile(items_path):
    try:
        idf = pd.read_csv(items_path, encoding='utf-8', low_memory=False)
        idf.columns = [c.strip() for c in idf.columns]
        for _, ir in idf.iterrows():
            name = str(ir.get('Name', '') or '').strip()
            iid  = str(ir.get('Item ID', '') or '').strip()
            icon = str(ir.get('Icon Path', '') or '').strip()
            rarity = str(ir.get('Rarity', '') or '').strip()
            if iid:
                items_by_id[iid] = {'id': iid, 'name': name or iid, 'icon': icon, 'rarity': rarity}
            if name:
                items_by_name[name.lower()] = {'id': iid, 'name': name, 'icon': icon, 'rarity': rarity}
    except Exception as ex:
        print(f"[items.csv] lecture impossible: {ex}")


############################################
# Chargement des ObjectiveTasks (fusion)
############################################

# 2ᵉ/3ᵉ arguments optionnels
items_csv_path = sys.argv[2] if len(sys.argv) >= 3 and sys.argv[2] else None
# Peut être un CSV unique OU un dossier contenant des ObjectiveTasksDataManager_*.csv
objective_tasks_path = sys.argv[3] if len(sys.argv) >= 4 and sys.argv[3] else "ObjectiveTasksDataManager.csv"


# Si tu avais déjà un chargement des items via sys.argv[2], garde-le tel quel.
# Ici on s'assure juste de ne pas écraser ta variable existante si elle est déjà définie plus haut.
try:
    _ = items_csv_path  # no-op, juste pour clarifier
except NameError:
    items_csv_path = None

def load_objective_tasks_many(path_or_csv: str) -> Dict[str, dict]:
    """
    Charge un ou plusieurs ObjectiveTasksDataManager_*.csv et fusionne en:
      dict[TaskID] = row(dict)
    - Si path_or_csv est un dossier: on prend tous les fichiers
      ObjectiveTasksDataManager*.csv dedans.
    - Sinon: on traite path_or_csv comme un seul CSV.
    """
    files: List[str] = []
    if path_or_csv and os.path.isdir(path_or_csv):
        # Tous les CSV “ObjectiveTasksDataManager*.csv” du dossier
        files = sorted(glob.glob(os.path.join(path_or_csv, "ObjectiveTasksDataManager*.csv")))
    elif path_or_csv and os.path.isfile(path_or_csv):
        files = [path_or_csv]
    else:
        # Fallback: tenter un fichier simple dans CWD
        if os.path.isfile("ObjectiveTasksDataManager.csv"):
            files = ["ObjectiveTasksDataManager.csv"]

    if not files:
        print(f"[WARN] Aucun ObjectiveTasksDataManager*.csv trouvé à partir de: {path_or_csv}")
        return {}

    idx: Dict[str, dict] = {}
    total_rows = 0
    for fp in files:
        try:
            df_tasks = pd.read_csv(fp, encoding='utf-8', low_memory=False)
        except Exception as e:
            print(f"[WARN] Lecture impossible: {fp} ({e})")
            continue
        df_tasks.columns = [c.strip() for c in df_tasks.columns]
        if "TaskID" not in df_tasks.columns:
            print(f"[WARN] Colonne 'TaskID' absente dans {os.path.basename(fp)} — ignoré")
            continue
        for _, row in df_tasks.iterrows():
            tid = str(row.get("TaskID","")).strip()
            if not tid:
                continue
            # dernière occurrence gagne (OK pour nous)
            idx[tid] = {k: (None if (isinstance(v,float) and np.isnan(v)) else v) for k,v in row.to_dict().items()}
            total_rows += 1
    print(f"[OK] ObjectiveTasks chargés: {len(idx)} (fusion de {len(files)} fichier(s), {total_rows} lignes lues)")
    return idx



# Construit les index
task_index = load_objective_tasks_many(objective_tasks_path)

# ---------- Optional: load locale (en-us.json) ----------
locale_map: Dict[str, str] = {}
locale_path = None
if len(sys.argv) >= 5:
    locale_path = sys.argv[4]
    try:
        with open(locale_path, "r", encoding="utf-8") as f:
            locale_map = json.load(f)
        print(f"[OK] Locale chargé: {len(locale_map):,} entrées depuis {locale_path}")
    except Exception as e:
        print(f"[WARN] Impossible de charger le fichier locale {locale_path}: {e}")
        locale_map = {}

# ---------- Helpers: recursive collection of TP_DescriptionTag ----------
SUBTASK_COL_RE = re.compile(r'^\s*sub\s*task', re.IGNORECASE)

def _is_hidden_task(row: dict) -> bool:
    v = row.get('IsHidden', 0)
    try:
        return int(v) == 1
    except Exception:
        return str(v).strip().lower() in ('1', 'true', 'yes')

def _iter_subtask_ids(row: dict) -> list[str]:
    ids: list[str] = []
    for k, v in row.items():
        if not isinstance(k, str):
            continue
        if not SUBTASK_COL_RE.match(k):
            continue
        if v is None or (isinstance(v, float) and np.isnan(v)) or str(v).strip() == '':
            continue
        for tok in re.split(r'[,\|; \t]+', str(v).strip()):
            tid = tok.strip()
            if tid and tid in task_index:
                ids.append(tid)
    return ids

def _collect_desc_tags_from_row(row: dict, visited: set[str]) -> list[str]:
    out: list[str] = []
    tid = str(row.get('TaskID') or row.get('Task Id') or row.get('ID') or '').strip()
    if tid:
        if tid in visited:
            return out
        visited.add(tid)
    if not _is_hidden_task(row):
        desc = str(row.get('TP_DescriptionTag') or '').strip()
        if desc:
            out.append(desc)
    for cid in _iter_subtask_ids(row):
        child = task_index.get(cid)
        if child:
            out.extend(_collect_desc_tags_from_row(child, visited))
    return out

# ---------- Locale helpers ----------
def _desc_key_from_tag(tag: str) -> str:
    """
    Convertit un tag de la forme @\"KEY\" ou @"KEY" ou "KEY" en 'KEY'
    """
    s = str(tag).strip()
    if s.startswith('@'):
        s = s[1:].strip()
    # retire guillemets simples/doubles entourant la clé
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1]
    return s


# Helper pour récupérer l'ID de tâche dans une ligne brute (clé "Task ID"/"ID", etc.)
def task_id_from_row(row: dict) -> str:
    for k in row.keys():
        if re.match(r'^\s*(Task\s*ID|ID|TaskId|TaskID)\s*$', str(k), re.I):
            val = str(row.get(k) or "").strip()
            if val:
                return val
    return ""

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
        "priority": 1,
        "tasks": []
    }

    # Rewards
    exp = to_int_safe(get(r, 'Universal Exp Amount', None)) or 0
    az  = to_int_safe(get(r, 'Azoth Reward', None)) or 0
    coin = to_int_safe(get(r, 'Currency Reward', None)) or 0
    standing = to_int_safe(get(r, 'Territory Standing', None)) or 0
    faction_influence  = to_int_safe(get(r, 'Faction Influence Amount', None)) or 0
    faction_reputation  = to_int_safe(get(r, 'Faction Reputation', None)) or 0
    faction_tokens  = to_int_safe(get(r, 'Faction Tokens', None)) or 0
    q["experience_reward"] = exp
    q["azoth_reward"] = az
    q["currency_reward"] = coin
    q["territory_standing"] = standing
    q["faction_influence"] = faction_influence
    q["faction_reputation"] = faction_reputation
    q["faction_tokens"] = faction_tokens
    if exp > 0: q["rewards"].append(f"XP +{exp}")
    if az  > 0: q["rewards"].append(f"Azoth +{az}")
    if coin> 0: q["rewards"].append(f"Coin +{coin}")
    if standing > 0: q["rewards"].append(f"Territory Standing +{standing}")
    item_name = str(get(r, 'Item Reward Name', '')).strip()
    item_id = str(get(r, 'Item Reward', '')).strip()
    item_qty = to_int_safe(get(r, 'Item Reward Qty', None)) or 0

    # Résolution via items.csv (par ID prioritaire, sinon par Name)
    resolved = None
    if item_id and item_id in items_by_id:
        resolved = items_by_id[item_id]
    elif item_name and item_name.lower() in items_by_name:
        resolved = items_by_name[item_name.lower()]
        # si l’ID manquait dans la quête on le récupère
        if not item_id:
            item_id = resolved.get('id') or ''

    # Champs “item_*” pour l’affichage détaillé
    q["item_reward"] = item_id                    # ID d’origine (ou résolu)
    q["item_reward_name"] = item_name             # Nom brut du CSV de quêtes
    q["item_reward_qty"] = item_qty
    q["item_reward_rarity"] = None
    # Champs résolus (affichage)
    if resolved:
        q["item_reward_resolved_name"] = resolved.get("name") or item_name or item_id
        q["item_reward_icon"] = resolved.get("icon") or None
        q["item_reward_rarity"] = resolved.get("rarity") or None
    else:
        q["item_reward_resolved_name"] = item_name or item_id
        q["item_reward_icon"] = None
        q["item_reward_rarity"] = None

    if q["item_reward_resolved_name"]:
        disp = q["item_reward_resolved_name"]
        q["rewards"].append(f"{disp}" + (f" x{item_qty}" if item_qty>1 else ""))

    task_field = str(get(r, 'Task', '') or '').strip()
    if task_field:
        tokens = re.split(r'[,\|; \t]+', task_field)
        seen_tids: Set[str] = set()
        for tok in tokens:
            tid = tok.strip()
            if not tid or tid in seen_tids:
                continue
            seen_tids.add(tid)

            # Lookup direct par TaskID dans l’index fusionné
            if tid in task_index:
                q["tasks"].append({"task_id": tid, "data": task_index[tid]})
            else:
                # rien trouvé → on garde l’ID brut pour debug/affichage
                q["tasks"].append({"task_id": tid})


    task_descs: list[str] = []
    visited_ids: set[str] = set()
    for t in q["tasks"]:
        row = t.get("data")
        if not isinstance(row, dict):
            continue
        task_descs.extend(_collect_desc_tags_from_row(row, visited_ids))
    # de-dupe en préservant l'ordre
    seen: set[str] = set()
    flat: list[str] = []
    for d in task_descs:
        if d not in seen:
            seen.add(d)
            flat.append(d)
    q["task_desc_tags"] = flat

    # --- Résolution en texte (locale) ---
    if locale_map:
        resolved: list[str] = []
        seen_txt: set[str] = set()
        for tag in flat:
            raw_key = _desc_key_from_tag(tag)
            # lookup insensible à la casse : d'abord exact, puis en lower()
            txt = locale_map.get(raw_key) or locale_map.get(raw_key.lower())
            if not txt:
                # fallback: si non trouvé on peut garder la clé brute
                txt = raw_key
            if txt not in seen_txt:
                seen_txt.add(txt)
                resolved.append(txt)
        q["task_desc_texts"] = resolved
    else:
        # pas de locale fournie : on laisse la liste vide (UI fera fallback si besoin)
        q["task_desc_texts"] = []

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
print(f"[INFO] ObjectiveTasks source: {objective_tasks_path}")
if locale_path:
    print(f"[INFO] Locale utilisé: {locale_path}")
print(f"[INFO] Tasks résolus: {sum(len(q.get('tasks',[])) for q in quests)} (quêtes={len(quests)})")

