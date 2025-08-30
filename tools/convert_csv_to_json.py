#!/usr/bin/env python3
# Re-génère public/data/quests.json à partir d'un CSV exporté
import sys, os, json, re, datetime, glob
import pandas as pd
import numpy as np
from typing import Dict, List, Set

if len(sys.argv) < 2:
    print("Usage: python tools/convert_csv_to_json.py <QUESTS_CSV> [ITEMS_CSV] [OBJECTIVE_TASKS_PATH] [LOCALE_JSON] [POI_DIR] [VITALS_JSON]")
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

def _format_percent(p) -> str:
    """Normalise un pourcentage : 0.25 -> '25%', 25 -> '25%'."""
    try:
        if p is None or (isinstance(p, float) and np.isnan(p)):
            return ""
        v = float(p)
        if v <= 1.0:
            v = v * 100.0
        # pas d'arrondi agressif, gardons 0 décimale si entier
        if abs(v - round(v)) < 1e-6:
            return f"{int(round(v))}%"
        return f"{v:.1f}%"
    except Exception:
        s = str(p).strip()
        return s if s.endswith('%') else (s + '%')

def _apply_placeholders(txt: str, row: dict) -> str:
    """
    Remplace {POITags}, {itemName}, {targetName} dans 'txt' à partir des colonnes de 'row'.
    Pour {itemName}, on injecte un token spécial lisible par le front :
      {{ITEM::icon=<url>::name=<nom>::drop=<xx%>}}
    """
    if not isinstance(txt, str) or not txt:
        return txt
    out = txt

    # {POITags}
    poi_tag = str(row.get('POITag') or '').strip()
    if '{POITags}' in out and poi_tag:
        # si plusieurs tags sont listés, on prend le 1er résolu
        candidates = [t.strip() for t in re.split(r'[,\|\s]+', poi_tag) if t.strip()] or [poi_tag]
        token_or_text = None
        for t in candidates:
            rec = poi_tag_to_def.get(t)
            if rec and (rec.get("name") or rec.get("icon") or rec.get("territoryId") is not None):
                name = rec.get("name") or t
                icon = rec.get("icon") or ""
                tid  = rec.get("territoryId")
                # Token POI consommé par le front (affiche un badge + lien NWDB zone/tid)
                token_or_text = f"{{{{POI::icon={icon}::name={name}::tid={tid}}}}}"
                break
        if not token_or_text:
            # fallback: tentative directe via locale, sinon garder le tag brut
            token_or_text = _locale_get(candidates[0]) or candidates[0]
        out = out.replace('{POITags}', token_or_text)

    # {itemName} -> token ITEM
    if '{itemName}' in out:
        item_raw = str(row.get('ItemName') or '').strip()
        icon, disp, rarity = "", "", ""
        if item_raw:
            # résolution via items.csv (par nom, puis par ID)
            rec = items_by_name.get(item_raw.lower()) or items_by_id.get(item_raw)
            if rec:
                icon = rec.get('icon') or ''
                disp = rec.get('name') or item_raw
                rarity = (rec.get('rarity') or '').lower()
            else:
                disp = item_raw
        drop = _format_percent(row.get('ItemDropProbability') if row.get('ItemDropProbability') not in (None, '') else row.get('ChestDropProbability'))
        token = f"{{{{ITEM::icon={icon}::name={disp}::drop={drop}::rarity={rarity}}}}}"
        out = out.replace('{itemName}', token)

    # {targetName} -> "qty × {{VC::name=...::qty=...::named=0|1}}"
    if '{targetName}' in out:
        raw_qty = row.get('TargetQty')
        try:
            if raw_qty is None or (isinstance(raw_qty, float) and np.isnan(raw_qty)):
                qty_val = ''
            else:
                qf = float(raw_qty)
                qty_val = int(qf) if abs(qf - int(qf)) < 1e-6 else qf
        except Exception:
            qty_val = str(raw_qty).strip()

        vc_id = str(row.get('ItemDropVC') or '').strip()
        vc_rec = vitals_by_id.get(vc_id) or vitals_by_id.get(vc_id.lower()) if vc_id else None
        if vc_rec:
            vc_name = vc_rec.get("name") or vc_id
            named   = "1" if vc_rec.get("isNamed") else "0"
        else:
            # fallback KillEnemyType (non nommé)
            vc_name = str(row.get('KillEnemyType') or '').strip() or 'Target'
            named   = "0"
        qty_str = f"{qty_val}" if str(qty_val) != '' else ""
        vc_url = f"https://nwdb.info/db/creature/{vc_id}" if vc_id else ""
        token = f"{{{{VC::name={vc_name}::qty={qty_str}::named={named}::id={vc_id}::url={vc_url}}}}}"
        out = out.replace('{targetName}', token)
    return out

def _collect_desc_texts(row: dict, visited: set[str]) -> list[str]:
    """
    Récupère récursivement les descriptions (locale résolue) en appliquant les placeholders.
    Ignore IsHidden == 1.
    """
    out: list[str] = []
    tid = str(row.get('TaskID') or row.get('Task Id') or row.get('ID') or '').strip()
    if tid:
        if tid in visited:
            return out
        visited.add(tid)
    if not _is_hidden_task(row):
        tag = str(row.get('TP_DescriptionTag') or '').strip()
        if tag:
            base = _locale_get(tag) if locale_map else tag
            out.append(_apply_placeholders(base, row))
    for cid in _iter_subtask_ids(row):
        child = task_index.get(cid)
        if child:
            out.extend(_collect_desc_texts(child, visited))
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

def _locale_get(key: str) -> str:
    """
    Lookup insensible à la casse dans le fichier de locale.
    Retourne la clé brute si non trouvée.
    """
    if not isinstance(key, str) or not key.strip():
        return ""
    k = _desc_key_from_tag(key)
    return locale_map.get(k) or locale_map.get(k.lower()) or k

# ---------- POI definitions (javelindata_poidefinitions_*.json) ----------
# On construit un mapping: poi_tag -> {"name": <nom localisé>, "icon": <url absolue>, "territoryId": <int>}
def load_poi_defs(dir_path: str) -> Dict[str, dict]:
    mapping: Dict[str, dict] = {}
    if not dir_path or not os.path.isdir(dir_path):
        return mapping
    files = sorted(glob.glob(os.path.join(dir_path, "javelindata_poidefinitions_*.json")))
    total = 0
    cdn_prefix = "https://cdn.nw-buddy.de/nw-data/live/"

    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                arr = json.load(f)
        except Exception as e:
            print(f"[WARN] Impossible de lire {os.path.basename(fp)}: {e}")
            continue
        if not isinstance(arr, list):
            continue
        for rec in arr:
            total += 1
            tags = rec.get("POITag")
            name_key = rec.get("NameLocalizationKey")
            map_icon = rec.get("MapIcon") or ""
            territory_id = rec.get("TerritoryID")
            # URL absolue vers l'icône (si fournie)
            icon_url = (cdn_prefix + map_icon) if map_icon else ""
            if not tags or not name_key:
                continue
            # POITag est un tableau; on mappe chaque tag vers le nom localisé
            try:
                for t in tags:
                    t_str = str(t).strip()
                    if t_str and t_str not in mapping:
                        mapping[t_str] = {
                            "name": _locale_get(name_key),   # enlève @ et résout via locale
                            "icon": icon_url,
                            "territoryId": territory_id
                        }
            except Exception:
                # si jamais ce n'est pas un tableau
                t_str = str(tags).strip()
                if t_str and t_str not in mapping:
                    mapping[t_str] = {
                        "name": _locale_get(name_key),
                        "icon": icon_url,
                        "territoryId": territory_id
                    }
    print(f"[OK] POI defs chargés: {len(mapping)} tags (depuis {len(files)} fichiers, {total} entrées)")
    return mapping

# chemin du dossier contenant les javelindata_poidefinitions_*.json
poi_dir = None
if len(sys.argv) >= 6 and sys.argv[5]:
    poi_dir = sys.argv[5]
else:
    # défaut: tools/pointofinterestdefinitions
    cand = os.path.join("tools", "pointofinterestdefinitions")
    poi_dir = cand if os.path.isdir(cand) else None
poi_tag_to_def: Dict[str, dict] = load_poi_defs(poi_dir) if poi_dir else {}

# ---------- Vitals categories (javelindata_vitalscategories.json) ----------
# Map: id -> {"name": <localisé>, "isNamed": bool}
def load_vitals_categories(path: str) -> Dict[str, dict]:
    mapping: Dict[str, dict] = {}
    if not path or not os.path.isfile(path):
        return mapping
    try:
        with open(path, "r", encoding="utf-8") as f:
            arr = json.load(f)
    except Exception as e:
        print(f"[WARN] Impossible de lire {os.path.basename(path)}: {e}")
        return mapping
    if not isinstance(arr, list):
        return mapping
    for rec in arr:
        vc_id = str(rec.get("VitalsCategoryID") or "").strip()
        disp  = rec.get("DisplayName")
        is_named = bool(rec.get("IsNamed", False))
        if not vc_id:
            continue
        # Résolution via locale (enlève @, insensible à la casse)
        name = _locale_get(str(disp) or "") if disp else vc_id
        mapping[vc_id] = {"name": name, "isNamed": is_named}
        # Accès tolérant à la casse
        mapping.setdefault(vc_id.lower(), {"name": name, "isNamed": is_named})
    print(f"[OK] VitalsCategories chargés: {len(mapping)} entrées depuis {path}")
    return mapping

# chemin du fichier javelindata_vitalscategories.json
vitals_path = sys.argv[6] if len(sys.argv) >= 7 and sys.argv[6] else None
if not vitals_path:
    cand = os.path.join("tools", "javelindata_vitalscategories.json")
    vitals_path = cand if os.path.isfile(cand) else None
vitals_by_id: Dict[str, dict] = load_vitals_categories(vitals_path) if vitals_path else {}


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
    # ---- Items de récompense (peuvent être 0, 1 ou 2) ----
    item_id_raw   = str(get(r, 'Item Reward', '')).strip()
    item2_name_raw = str(get(r, 'Item Reward Name', '')).strip()
    item2_qty      = to_int_safe(get(r, 'Item Reward Qty', None)) or 0  # qty liée au *Name* seulement

    # Résolutions
    resolved_by_id = items_by_id.get(item_id_raw) if item_id_raw else None
    # "Item Reward Name" contient en réalité un *ID* d'item : on essaie par ID d'abord, puis par nom en fallback
    resolved_item2 = (
        items_by_id.get(item2_name_raw) or
        (items_by_name.get(item2_name_raw.lower()) if item2_name_raw else None)
    ) if item2_name_raw else None

    # Nouveau format : liste d’objets item_rewards
    q["item_rewards"] = []
    if item_id_raw:
        q["item_rewards"].append({
            "id": item_id_raw,
            "name": (resolved_by_id.get("name") if resolved_by_id else item_id_raw),
            "icon": (resolved_by_id.get("icon") if resolved_by_id else None),
            "rarity": (resolved_by_id.get("rarity") if resolved_by_id else None),
            "qty": None  # pas de quantité liée à "Item Reward" (ID)
        })
    if item2_name_raw:
        q["item_rewards"].append({
            "id":    (resolved_item2.get("id")    if resolved_item2 else None),
            "name":  (resolved_item2.get("name")  if resolved_item2 else item2_name_raw),
            "icon":  (resolved_item2.get("icon")  if resolved_item2 else None),
            "rarity":(resolved_item2.get("rarity")if resolved_item2 else None),
            "qty":   (item2_qty if item2_qty and item2_qty > 1 else None)
        })

    # Fallback compat’ avec l’existant (on privilégie l’item par *Name* s’il existe)
    chosen = (q["item_rewards"][1] if len(q["item_rewards"]) > 1 else (q["item_rewards"][0] if q["item_rewards"] else None))
    q["item_reward"]                 = (chosen.get("id") if chosen else (item_id_raw or ""))
    q["item_reward_name"]            = (item2_name_raw or "")
    q["item_reward_qty"]             = (item2_qty or 0)
    q["item_reward_resolved_name"]   = (chosen.get("name") if chosen else (item2_name_raw or item_id_raw))
    q["item_reward_icon"]            = (chosen.get("icon") if chosen else None)
    q["item_reward_rarity"]          = (chosen.get("rarity") if chosen else None)

    # Texte récap dans q["rewards"] (laisser simple)
    if q["item_rewards"]:
        for it in q["item_rewards"]:
            label = it["name"]
            if it.get("qty"):
                label += f" x{it['qty']}"
            q["rewards"].append(label)

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

    # ----- Descriptions finales (avec placeholders appliqués) -----
    desc_texts: list[str] = []
    visited_ids: set[str] = set()
    for t in q["tasks"]:
        row = t.get("data")
        if isinstance(row, dict):
            desc_texts.extend(_collect_desc_texts(row, visited_ids))
    # de-dupe en préservant l'ordre
    seen_txt: set[str] = set()
    flat_txt: list[str] = []
    for s in desc_texts:
        if s not in seen_txt:
            seen_txt.add(s)
            flat_txt.append(s)
    q["task_desc_texts"] = flat_txt

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

