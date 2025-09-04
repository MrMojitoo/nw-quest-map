#!/usr/bin/env python3
# Re-génère public/data/quests.json à partir d'un CSV exporté
import sys, os, json, re, datetime, glob, shutil
import pandas as pd
import numpy as np
from typing import Dict, List, Set

if len(sys.argv) < 2:
    print("Usage: python tools/convert_csv_to_json.py <QUESTS_CSV> [ITEMS_CSV] [OBJECTIVE_TASKS_CSV] [OBJECTIVES_DIR] [META_ACHIEVEMENTS_CSV]")
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
                rec = {'id': iid, 'name': name or iid, 'icon': icon, 'rarity': rarity}
                # Accès par ID exact ET insensible à la casse
                items_by_id[iid] = rec
                items_by_id.setdefault(iid.lower(), rec)
            if name:
                items_by_name[name.lower()] = {'id': iid, 'name': name, 'icon': icon, 'rarity': rarity}
    except Exception as ex:
        print(f"[items.csv] lecture impossible: {ex}")

# ----- housing_items.csv (optionnel) -----------------------------------------
# Même structure que items.csv. On ne charge que les IDs "House_Housingitem*".
try:
    housing_items_path = os.path.join('tools', 'housing_items.csv')
    if os.path.isfile(housing_items_path):
        hidf = pd.read_csv(housing_items_path, encoding='utf-8', low_memory=False)
        hidf.columns = [c.strip() for c in hidf.columns]
        added = 0
        for _, ir in hidf.iterrows():
            name = str(ir.get('Name', '') or '').strip()
            iid  = str(ir.get('Item ID', '') or '').strip()
            iid_l = iid.lower()
            if not iid or not iid_l.startswith('house_housingitem'):
                continue
            icon = str(ir.get('Icon Path', '') or '').strip()
            rarity = str(ir.get('Rarity', '') or '').strip()
            # Index par ID (remplit ou crée uniquement pour les items Housing)
            rec = {'id': iid, 'name': (name or iid), 'icon': icon, 'rarity': rarity}
            items_by_id[iid] = rec
            items_by_id.setdefault(iid_l, rec)
            # Index par nom (n’écrase pas si déjà présent)
            if name:
                items_by_name.setdefault(name.lower(), {'id': iid, 'name': name, 'icon': icon, 'rarity': rarity})
            added += 1
        print(f"[OK] housing_items.csv chargé: {added} items 'House_Housingitem*'")
except Exception as ex:
    print(f"[housing_items.csv] lecture impossible: {ex}")

############################################
# Item Definitions (javelindata_itemdefinitions_*.json)
############################################

def _cdnize_icon(path: str) -> str:
    if not path:
        return ""
    p = str(path).replace("\\", "/")
    if p.lower().endswith(".png"):
        p = p[:-4] + ".webp"
    return ("https://cdn.nw-buddy.de/nw-data/live/" + p).lower()

def load_item_definitions(path_or_dir: str | None) -> dict[str, dict]:
    """
    Charge tous les javelindata_itemdefinitions_*.json et indexe par ItemID (insensible à la casse).
    Retour: { itemid_lower: { "id": ItemID, "name_key": <clé locale sans @>, "icon": <url ou "">, "rarity": <str ou ""> } }
    """
    files: list[str] = []
    if path_or_dir and os.path.isdir(path_or_dir):
        files = sorted(glob.glob(os.path.join(path_or_dir, "javelindata_itemdefinitions_*.json")))
    elif path_or_dir and os.path.isfile(path_or_dir):
        files = [path_or_dir]
    else:
        # auto-découverte
        files = sorted(glob.glob(os.path.join("tools", "javelindata_itemdefinitions_*.json")))
        if not files:
            cand_dir = os.path.join("tools", "itemdefinitions")
            if os.path.isdir(cand_dir):
                files = sorted(glob.glob(os.path.join(cand_dir, "javelindata_itemdefinitions_*.json")))
    if not files:
        print("[WARN] Aucune définition d’items (javelindata_itemdefinitions_*.json) trouvée")
        return {}

    idx: dict[str, dict] = {}
    total = 0
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                arr = json.load(f)
        except Exception as e:
            print(f"[WARN] Lecture impossible: {os.path.basename(fp)} ({e})")
            continue
        if not isinstance(arr, list):
            continue
        for rec in arr:
            total += 1
            iid = str(rec.get("ItemID") or "").strip()
            if not iid:
                continue
            name_raw = str(rec.get("Name") or "").strip()  # ex: @CritterCallT1_MasterName
            # Certaines dumps utilisent "NameLocalizationKey" déjà sans @ — gérons les deux
            if not name_raw:
                name_raw = str(rec.get("NameLocalizationKey") or "").strip()
            # normalise la clé de locale (on enlève @ et guillemets)
            def _norm_loc_key(s: str) -> str:
                s = s.strip()
                if s.startswith('@'):
                    s = s[1:].strip()
                if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
                    s = s[1:-1]
                return s
            name_key = _norm_loc_key(name_raw) if name_raw else ""
            # icône: on tente différents champs fréquents
            icon = (rec.get("IconPath") or rec.get("Icon") or rec.get("IconPathSmall") or "")
            icon_url = _cdnize_icon(icon) if icon else ""
            # rareté éventuelle (laisser brut si dispo)
            rarity = str(rec.get("ItemRarityId") or rec.get("Rarity") or "").strip()
            idx[iid.lower()] = {"id": iid, "name_key": name_key, "icon": icon_url, "rarity": rarity}
    print(f"[OK] ItemDefinitions chargées: {len(idx)} items (depuis {len(files)} fichiers, {total} entrées)")
    return idx
itemdefs_path = None
# On accepte un 9ᵉ argument optionnel pour pointer vers le dossier des itemdefinitions
if len(sys.argv) >= 9 and sys.argv[8]:
    itemdefs_path = sys.argv[8]
item_defs_by_id = load_item_definitions(itemdefs_path)

def resolve_item_via_defs(iid: str) -> tuple[str, str, str]:
    """
    Retourne (display_name_localisé, icon_url, rarity) pour un ItemID
    via javelindata_itemdefinitions_* + locale courante. Fallback: (iid, '', '')
    """
    if not iid:
        return "", "", ""
    rec = item_defs_by_id.get(iid.lower())
    if not rec:
        return iid, "", ""
    key = rec.get("name_key") or ""
    name = _locale_get(key) if key else iid
    return name, (rec.get("icon") or ""), (rec.get("rarity") or "")

# ---------- Housing item definitions (javelindata_housingitems.json) ----------
def load_housing_item_definitions(path_or_dir: str | None) -> dict[str, dict]:
    """
    Charge javelindata_housingitems.json (liste d'objets avec HouseItemID, Name, ...).
    Index par HouseItemID (insensible à la casse):
      { id_lower: { "id": HouseItemID, "name_key": <clé locale sans @>, "icon": <url ou ''> } }
    """
    # Trouver le fichier
    candidates: list[str] = []
    if path_or_dir and os.path.isdir(path_or_dir):
        cand = os.path.join(path_or_dir, "javelindata_housingitems.json")
        if os.path.isfile(cand):
            candidates.append(cand)
    elif path_or_dir and os.path.isfile(path_or_dir):
        # si l'utilisateur pointe directement vers le fichier
        if os.path.basename(path_or_dir).lower() == "javelindata_housingitems.json":
            candidates.append(path_or_dir)
    if not candidates:
        # fallback auto
        for base in ("tools", os.path.join("tools", "itemdefinitions")):
            cand = os.path.join(base, "javelindata_housingitems.json")
            if os.path.isfile(cand):
                candidates.append(cand)
                break
    if not candidates:
        print("[INFO] Aucun javelindata_housingitems.json détecté (housing via CSV/fallback)")
        return {}

    fp = candidates[0]
    try:
        with open(fp, "r", encoding="utf-8") as f:
            arr = json.load(f)
    except Exception as e:
        print(f"[WARN] Lecture impossible: {os.path.basename(fp)} ({e})")
        return {}
    if not isinstance(arr, list):
        print(f"[WARN] Format inattendu dans {os.path.basename(fp)} (attendu: liste)")
        return {}

    def _norm_loc_key(s: str) -> str:
        s = str(s).strip()
        if s.startswith('@'):
            s = s[1:].strip()
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            s = s[1:-1]
        return s

    idx: dict[str, dict] = {}
    total = 0
    for rec in arr:
        total += 1
        hid = str(rec.get("HouseItemID") or "").strip()
        if not hid:
            continue
        name_raw = str(rec.get("Name") or "").strip()  # ex: @House_HousingItem_Settler_...
        name_key = _norm_loc_key(name_raw) if name_raw else ""
        icon = (rec.get("IconPath") or rec.get("Icon") or "")
        icon_url = _cdnize_icon(icon) if icon else ""
        idx[hid.lower()] = {"id": hid, "name_key": name_key, "icon": icon_url}
    print(f"[OK] HousingDefinitions chargées: {len(idx)} items (depuis {os.path.basename(fp)})")
    return idx

# On réutilise le même répertoire que 'itemdefs_path' pour chercher le JSON housing
housing_defs_by_id = load_housing_item_definitions(itemdefs_path)

def resolve_housing_item_via_defs(iid: str) -> tuple[str, str, str]:
    """
    Résolution spécifique aux House_HousingItem* via javelindata_housingitems.json.
    Retourne (display_name_localisé, icon_url, rarity) ; rarity vide (non pertinente ici).
    """
    if not iid:
        return "", "", ""
    rec = housing_defs_by_id.get(iid.lower())
    if not rec:
        return iid, "", ""
    key = rec.get("name_key") or ""
    name = _locale_get(key) if key else iid
    return name, (rec.get("icon") or ""), ""


# ---------- Debug résolution d'item ----------
def resolve_item_with_debug(iid: str):
    """
    Tente de résoudre un ItemID via itemdefinitions + locale,
    retourne (name, icon, rarity, reason)
      - reason = '' si OK
               = 'MISSING_DEF' si ItemID absent des defs
               = 'MISSING_NAME_KEY' si defs présentes mais pas de champ Name/NameLocalizationKey
               = 'MISSING_LOCALE_ENTRY' si clé présente mais absente de la locale courante
    """
    if not iid:
        return "", "", "", "EMPTY_ID"
    lower = iid.lower()
    # 1) Housing d'abord si c'est un House_HousingItem*
    if lower.startswith("house_housingitem"):
        rec = housing_defs_by_id.get(lower)
        if not rec:
            return iid, "", "", "MISSING_HOUSING_DEF"
        key = rec.get("name_key") or ""
        if not key:
            return iid, (rec.get("icon") or ""), "", "MISSING_HOUSING_NAME_KEY"
        txt = _locale_get(key)
        if txt == key:
            return iid, (rec.get("icon") or ""), "", "MISSING_LOCALE_ENTRY"
        return txt, (rec.get("icon") or ""), "", ""
    # 2) Sinon, defs classiques
    rec = item_defs_by_id.get(lower)
    if not rec:
        return iid, "", "", "MISSING_DEF"
    key = rec.get("name_key") or ""
    if not key:
        return iid, (rec.get("icon") or ""), (rec.get("rarity") or ""), "MISSING_NAME_KEY"
    txt = _locale_get(key)
    if txt == key:
        return iid, (rec.get("icon") or ""), (rec.get("rarity") or ""), "MISSING_LOCALE_ENTRY"
    return txt, (rec.get("icon") or ""), (rec.get("rarity") or ""), ""


############################################
# Chargement des ObjectiveTasks (fusion)
############################################

# 2ᵉ/3ᵉ arguments optionnels
items_csv_path = sys.argv[2] if len(sys.argv) >= 3 and sys.argv[2] else None
# Peut être un CSV unique OU un dossier contenant des ObjectiveTasksDataManager_*.csv
objective_tasks_path = sys.argv[3] if len(sys.argv) >= 4 and sys.argv[3] else "ObjectiveTasksDataManager.csv"
meta_csv_path = sys.argv[7] if len(sys.argv) >= 8 and sys.argv[7] else None



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

# ---------- Locales : fichier unique OU dossier tools/lang ----------
locale_map: Dict[str, str] = {}
locale_arg = sys.argv[4] if len(sys.argv) >= 5 else None

def _iter_locale_files(path_or_file: str) -> list[str]:
    if not path_or_file:
        return []
    if os.path.isdir(path_or_file):
        return sorted(glob.glob(os.path.join(path_or_file, "*.json")))
    return [path_or_file]

def _lang_key_from_path(p: str) -> str:
    return os.path.splitext(os.path.basename(p))[0].lower()

# ---------- EN baseline & reverse map (valeur EN -> clé) ----------
en_us_locale_map: Dict[str, str] = {}
_en_rev_exact: Dict[str, str] = {}
_en_rev_lower: Dict[str, str] = {}

def _try_load_json(fp: str) -> dict:
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _build_en_reverse(loc: Dict[str, str]):
    global _en_rev_exact, _en_rev_lower
    _en_rev_exact, _en_rev_lower = {}, {}
    for k, v in loc.items():
        if isinstance(v, str):
            s = v.strip()
            if not s:
                continue
            # ne remplace pas si déjà présent (1er match conserve la clé)
            _en_rev_exact.setdefault(s, k)
            _en_rev_lower.setdefault(s.lower(), k)


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
            # 1) Tenter comme ItemID via itemdefinitions + locale
            disp_loc, icon_loc, rarity_loc = resolve_item_via_defs(item_raw)
            if disp_loc and disp_loc != item_raw:
                disp = disp_loc
                icon = icon_loc or icon
                rarity = (rarity_loc or rarity).lower()
            else:
                # 2) Fallback: items.csv (par nom, puis par ID)
                rec = items_by_name.get(item_raw.lower()) or items_by_id.get(item_raw)
                if rec:
                    icon = rec.get('icon') or icon
                    disp = rec.get('name') or item_raw
                    rarity = (rec.get('rarity') or '').lower()
                else:
                    disp = item_raw
        drop = _format_percent(row.get('ItemDropProbability') if row.get('ItemDropProbability') not in (None, '') else row.get('ChestDropProbability'))
        # Tente de récupérer l'ID d'item pour rendre le badge cliquable côté front
        # On expose l'ID si on le trouve (pour lien NWDB/NW-buddy côté front)
        rec = item_defs_by_id.get((item_raw or "").lower()) or (items_by_name.get(item_raw.lower()) if item_raw else None) or (items_by_id.get(item_raw) if item_raw else None)
        rid = (rec.get('id') if isinstance(rec, dict) and rec.get('id') else (item_raw if item_raw else ''))
        token = f"{{{{ITEM::icon={icon}::name={disp}::drop={drop}::rarity={rarity}::id={rid}}}}}"
        out = out.replace('{itemName}', token)

    # {targetName} -> "qty × {{VC::name=...::qty=...::named=0|1::id=<vcid>}}"
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

        # 1) Priorité: ItemDropVC (lookup direct dans javelindata_vitalscategories.json)
        vc_id = str(row.get('ItemDropVC') or '').strip()
        vc_rec = (vitals_by_id.get(vc_id) or vitals_by_id.get(vc_id.lower())) if vc_id else None

        # 2) Sinon: tenter KillEnemyType comme VitalsCategoryID (puis fallback en libellé brut)
        kill = str(row.get('KillEnemyType') or '').strip()
        if vc_rec:
            vc_name = vc_rec.get("name") or vc_id
            named   = "1" if vc_rec.get("isNamed") else "0"
        elif kill:
            krec = vitals_by_id.get(kill) or vitals_by_id.get(kill.lower())
            if krec:
                vc_id  = kill                        # on utilise KillEnemyType comme id pour le lien NWDB
                vc_name = krec.get("name") or kill   # DisplayName résolu via en-us.json (sans @) par load_vitals_categories
                named   = "1" if krec.get("isNamed") else "0"
            else:
                vc_name = kill
                named   = "0"
        else:
            vc_name = 'Target'
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

# --- Nettoyage HTML léger pour les descriptions meta (retirer <font ...> ... </font>) ---
FONT_TAG_RE = re.compile(r"</?font\b[^>]*>", re.IGNORECASE)
def _strip_font_tags(s: str) -> str:
    if not isinstance(s, str) or not s:
        return s
    # Supprime les balises <font ...> et compacte les espaces résiduels
    cleaned = FONT_TAG_RE.sub("", s)
    return re.sub(r"\s+", " ", cleaned).strip()

def _localize_from_en_value(value: str) -> tuple[str, str | None]:
    """
    À partir d'une *valeur anglaise* (telle qu'elle figure dans quests.csv),
    retrouve la *clé* en-us, puis renvoie la traduction courante (locale_map).
    Retourne (texte_localisé_ou_original, clé_ou_None).
    """
    if not isinstance(value, str):
        return value, None
    val = value.strip()
    if not val or not _en_rev_exact:
        return value, None
    key = _en_rev_exact.get(val) or _en_rev_lower.get(val.lower())
    if not key:
        return value, None
    return _locale_get(key), key


# ---------- Meta Achievements (MetaAchievementDataTable.csv) ----------
def load_meta_achievements(path: str,
                           ach_to_q: Dict[str, Set[str]],
                           arc_to_qids: Dict[str, Set[str]]) -> list[dict]:
    """
    Ne conserve que les lignes où MetaAchievementId commence par 'Quest'.
    Deux modes:
      - AchievementsID: liste d'achievement ids -> résolue via ach_to_q
      - QuestGroupTag:  utilise arc_to_qids (à partir de 'Quest Arc Tag' du CSV principal)
    Retour: [{id, title, title_key, quest_ids}]
    """
    metas: list[dict] = []
    if not path or not os.path.isfile(path):
        return metas
    try:
        mdf = pd.read_csv(path, encoding='utf-8', low_memory=False)
        mdf.columns = [c.strip() for c in mdf.columns]
    except Exception as e:
        print(f"[WARN] Impossible de lire MetaAchievementDataTable: {e}")
        return metas

    def _starts_with_quest(x: str) -> bool:
        return isinstance(x, str) and x.strip().lower().startswith("quest")

    unmatched_group_tags = []  # pour debug: (meta_id, group_tag_normalisé)
    used_group_tags = 0
 
    def _cell_str(row: dict, col: str) -> str:
        """Retourne '' si la cellule est NaN/None, sinon la chaîne trim."""
        v = row.get(col, "")
        if v is None:
            return ""
        # NaN (float) → vide
        try:
            import numpy as _np
            if isinstance(v, float) and _np.isnan(v):
                return ""
        except Exception:
            pass
        s = str(v).strip()
        # Evite le piège 'nan' (str) venu de str(NaN)
        return "" if s.lower() == "nan" else s   
    for _, row in mdf.iterrows():
        meta_id = str(row.get("MetaAchievementId", "") or "").strip()
        if not _starts_with_quest(meta_id):
            continue
        if meta_id.lower().startswith('quest_counttotals'):
            continue
        title_key = str(row.get("Title", "") or "").strip()
        title = _locale_get(title_key) if title_key else meta_id
        # Description (clé -> texte localisé), puis on retire les balises <font>
        desc_key = str(row.get("Description", "") or "").strip()
        description = _strip_font_tags(_locale_get(desc_key)) if desc_key else ""      
        # Icône (convertir .png -> .webp et préfixer CDN, puis passer en lowercase)
        icon_raw = _cell_str(row, "Icon")
        icon_url = ""
        if icon_raw:
            p = str(icon_raw).replace("\\", "/")
            if p.lower().endswith(".png"):
                p = p[:-4] + ".webp"
            icon_url = ("https://cdn.nw-buddy.de/nw-data/live/" + p).lower()

        qids: Set[str] = set()
        ach_list = _cell_str(row, "AchievementsID")
        group_tag_raw = _cell_str(row, "QuestGroupTag")

        if ach_list:
            for tok in re.split(r"[,\|; \t]+", ach_list):
                aid = tok.strip()
                if not aid:
                    continue
                for q in ach_to_q.get(aid, set()):
                    qids.add(q)
        elif group_tag_raw:
            used_group_tags += 1
            # Supporte plusieurs tags dans la cellule (séparateurs: , | ; ou espaces)
            tokens = [t for t in re.split(r"[,\|; \t]+", group_tag_raw) if t.strip()]
            any_match = False
            for tok in tokens:
                key = _norm_tag(tok)
                found = arc_to_qids.get(key, set())
                if found:
                    any_match = True
                    qids.update(found)
            if not any_match:
                # garde une trace pour debug
                unmatched_group_tags.append((meta_id, _norm_tag(group_tag_raw)))

        metas.append({
            "id": meta_id,
            "title_key": title_key,
            "title": title,
            "icon": icon_url,
            "desc_key": desc_key,
            "description": description,
            "quest_ids": sorted(qids)
        })
    print(f"[OK] Meta achievements chargés: {len(metas)} (depuis {path})")
    print(f"[INFO] MetaAchievements utilisant QuestGroupTag: {used_group_tags}")
    # Debug: montre un petit échantillon de ceux qui n'ont rien matché (s'il y en a)
    if unmatched_group_tags:
        sample = unmatched_group_tags[:10]
        print(f"[WARN] {len(unmatched_group_tags)} MetaAchievement(s) via QuestGroupTag n'ont matché aucune quête.")
        for mid, gtag in sample:
            print(f"   - MetaId={mid}  QuestGroupTag(normalisé)='{gtag}'  -> 0 quest")    
    return metas

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
poi_tag_to_def: Dict[str, dict] = {}  # chargé par langue

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
vitals_by_id: Dict[str, dict] = {}  # chargé par langue


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

def _norm_tag(s: str) -> str:
    """
    Normalise un tag pour comparaison: trim + lowercase.
    (On NE touche PAS aux underscores/traits d'union, on évite de supprimer trop de caractères.)
    """
    if not isinstance(s, str):
        s = "" if s is None else str(s)
    return s.strip().lower()


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
arc_to_qids: Dict[str, Set[str]] = {}
for r in rows:
    ach = str(get(r, 'Achievement Id', '')).strip()
    qid = str(get(r, 'ID', '')).strip()
    arc_raw = str(get(r, 'Quest Arc Tag', '')).strip()
    if ach:
        ach_to_q.setdefault(ach, set()).add(qid)
    if arc_raw:
        # Supporte plusieurs tags dans la cellule, comme pour QuestGroupTag
        for tok in re.split(r"[,\|; \t]+", arc_raw):
            if not tok.strip():
                continue
            arc_key = _norm_tag(tok)
            arc_to_qids.setdefault(arc_key, set()).add(qid)

# ---------- Génération par langue ----------
token_re = re.compile(r"[A-Za-z0-9_\\-]+")
def parse_logic(expr: str):
    out = []
    if not isinstance(expr, str) or not expr.strip():
        return out
    for raw in re.findall(r'!?[A-Za-z0-9_\\-]+', expr):
        is_neg = raw.startswith('!')
        tok = raw[1:] if is_neg else raw
        out.append((tok, is_neg))
    return out

def _generate_for_locale(locale_file: str, is_default: bool=False):
    global locale_map, poi_tag_to_def, vitals_by_id
    # 1) Locale
    with open(locale_file, "r", encoding="utf-8") as f:
        locale_map = json.load(f)
    print(f"[OK] Locale chargée: {len(locale_map):,} entrées depuis {locale_file}")
    # Publier la locale brute pour le front (traduction des zones)
    try:
        out_lang_dir = os.path.join("public", "lang")
        os.makedirs(out_lang_dir, exist_ok=True)
        lang_key = _lang_key_from_path(locale_file)
        shutil.copyfile(locale_file, os.path.join(out_lang_dir, f"{lang_key}.json"))
    except Exception as e:
        print(f"[WARN] Impossible de copier la locale vers public/lang: {e}")    
   # 2) Ressources dépendantes de la locale
    poi_tag_to_def = load_poi_defs(poi_dir) if poi_dir else {}
    vitals_by_id   = load_vitals_categories(vitals_path) if vitals_path else {}
    # 3) Meta achievements (dépendent de la locale)
    metas = load_meta_achievements(
        meta_csv_path or os.path.join("tools", "MetaAchievementDataTable.csv"),
        ach_to_q, arc_to_qids
    )
    # 4) Quêtes (tasks + textes localisés)
    quests: list[dict] = []
    edges: list[tuple] = []
    lang = _lang_key_from_path(locale_file)
    localized_q_count = 0    
    # Stats debug items pour cette langue
    item_debug_counts = {
        "OK": 0,
        "MISSING_DEF": 0, "MISSING_NAME_KEY": 0, "MISSING_LOCALE_ENTRY": 0,
        "MISSING_HOUSING_DEF": 0, "MISSING_HOUSING_NAME_KEY": 0,
        "EMPTY_ID": 0, "FALLBACK_ITEMS_CSV": 0
    }    
    unresolved_samples: list[dict] = []  # petite liste d'échantillons
    def _record_unresolved(iid: str, reason: str, context: str):
        if reason and reason in item_debug_counts:
            item_debug_counts[reason] += 1
        if len(unresolved_samples) < 30 and reason and reason != "OK":
            unresolved_samples.append({"id": iid, "reason": reason, "context": context})    
    for r in rows:
        qid = str(get(r, 'ID', '')).strip()
        if not qid:
            continue
        # Valeurs brutes issues du CSV (EN)
        raw_title = str(get(r, 'Title', '')).strip()
        raw_desc  = str(get(r, 'Description', '')).strip()

        # Localisation des titres/descriptions de quêtes:
        # - si 'lang' != en-us et si on a une baseline EN -> clé -> traduction
        title_loc, title_key = (raw_title, None)
        desc_loc,  desc_key  = (raw_desc, None)
        if lang != "en-us" and _en_rev_exact:
            title_loc, title_key = _localize_from_en_value(raw_title)
            desc_loc,  desc_key  = _localize_from_en_value(raw_desc)
            # nettoyage léger des descriptions (balises <font>)
            if isinstance(desc_loc, str):
                desc_loc = _strip_font_tags(desc_loc)
            if (title_key or desc_key) and (title_loc != raw_title or desc_loc != raw_desc):
                localized_q_count += 1

        q = {
            "id": qid,
            "title": title_loc,
            "description": desc_loc,
            # pour debug/traçabilité (facultatif : l'UI les ignore)
            **({"title_key": title_key} if title_key else {}),
            **({"desc_key":  desc_key}  if desc_key  else {}),
            "type": str(get(r, 'Type', '')).strip(),
            "icon": str(get(r, 'Icon', '')).strip(),
            "recommended_level": to_int_safe(get(r, 'Difficulty Level', None)),
            "required_level": to_int_safe(get(r, 'Required Level', None)),
            "zone_id": to_int_safe(get(r, 'Exclusive Territory', None)),
            "quest_arc_tag": str(get(r, 'Quest Arc Tag', None)),
            "rewards": [],
            "achievement_id": str(get(r, 'Achievement Id', '')).strip() or None,
            "required_achievements_expr": str(get(r, 'Required Achievement Id', '')).strip() or None,
            "prerequisites": [],
            "not_prerequisites": [],
            "repeatable": False,
            "priority": 1,
            "tasks": [],
            "meta_ids": []
        }
        # Rewards
        exp = to_int_safe(get(r, 'Universal Exp Amount', None)) or 0
        az  = to_int_safe(get(r, 'Azoth Reward', None)) or 0
        coin_raw = to_int_safe(get(r, 'Currency Reward', None)) or 0
        coin = int(round(coin_raw / 100)) if coin_raw else 0
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
        # Items
        item_id_raw    = str(get(r, 'Item Reward', '')).strip()
        item2_name_raw = str(get(r, 'Item Reward Name', '')).strip()
        item2_qty      = to_int_safe(get(r, 'Item Reward Qty', None)) or 0
        # Résolution des items via définitions (localisées) d'abord, fallback items.csv
        if item_id_raw:
            name1, icon1, rar1, reason1 = resolve_item_with_debug(item_id_raw)
            if reason1:
                if reason1 in ("MISSING_DEF","MISSING_NAME_KEY","MISSING_LOCALE_ENTRY","MISSING_HOUSING_DEF","MISSING_HOUSING_NAME_KEY"):
                    _record_unresolved(item_id_raw, reason1, "quest_reward_item_id")
                else:
                    item_debug_counts[reason1] = item_debug_counts.get(reason1, 0) + 1
        else:
            name1, icon1, rar1, reason1 = ("", "", "", "EMPTY_ID")
        resolved_by_id = (items_by_id.get(item_id_raw) or items_by_id.get(item_id_raw.lower())) if item_id_raw else None
        # "Item Reward Name" est souvent un ID aussi -> tenter via defs
        if item2_name_raw:
            name2, icon2, rar2, reason2 = resolve_item_with_debug(item2_name_raw)
            if reason2:
                if reason2 in ("MISSING_DEF","MISSING_NAME_KEY","MISSING_LOCALE_ENTRY","MISSING_HOUSING_DEF","MISSING_HOUSING_NAME_KEY"):
                    _record_unresolved(item2_name_raw, reason2, "quest_reward_item2")
                else:
                    item_debug_counts[reason2] = item_debug_counts.get(reason2, 0) + 1
        else:
            name2, icon2, rar2, reason2 = ("", "", "", "EMPTY_ID")
        resolved_item2 = (
            items_by_id.get(item2_name_raw) or items_by_id.get(item2_name_raw.lower()) or
            (items_by_name.get(item2_name_raw.lower()) if item2_name_raw else None)
        ) if item2_name_raw else None
        q["item_rewards"] = []
        if item_id_raw:
            q["item_rewards"].append({
                "id": item_id_raw,
                "name": (name1 or (resolved_by_id.get("name") if resolved_by_id else item_id_raw)),
                "icon": (icon1 or (resolved_by_id.get("icon") if resolved_by_id else None)),
                "rarity": ((rar1 or (resolved_by_id.get("rarity") if resolved_by_id else None)) or None),
                "qty": None
            })
        if item2_name_raw:
            q["item_rewards"].append({
                "id":    (resolved_item2.get("id")    if resolved_item2 else (item2_name_raw if name2 else None)),
                "name":  (name2 or (resolved_item2.get("name")  if resolved_item2 else item2_name_raw)),
                "icon":  (icon2 or (resolved_item2.get("icon")  if resolved_item2 else None)),
                "rarity":((rar2 or (resolved_item2.get("rarity") if resolved_item2 else None)) or None),
                "qty":   (item2_qty if item2_qty and item2_qty > 1 else None)
            })
        chosen = (q["item_rewards"][1] if len(q["item_rewards"]) > 1 else (q["item_rewards"][0] if q["item_rewards"] else None))
        q["item_reward"]               = (chosen.get("id") if chosen else (item_id_raw or ""))
        q["item_reward_name"]          = (item2_name_raw or "")
        q["item_reward_qty"]           = (item2_qty or 0)
        q["item_reward_resolved_name"] = (chosen.get("name") if chosen else (name1 or item_id_raw))
        q["item_reward_icon"]          = (chosen.get("icon") if chosen else (icon1 or None))
        q["item_reward_rarity"]        = (chosen.get("rarity") if chosen else ((rar1 or None)))
        if q["item_rewards"]:
            for it in q["item_rewards"]:
                label = it["name"]
                if it.get("qty"): label += f" x{it['qty']}"
                q["rewards"].append(label)
        # Marquer les cas où items.csv a servi effectivement de fallback
        if (item_id_raw and not name1 and resolved_by_id) or (item2_name_raw and not name2 and resolved_item2):
            item_debug_counts["FALLBACK_ITEMS_CSV"] += 1
        # Compter les OK
        if item_id_raw and name1 and name1 != item_id_raw: item_debug_counts["OK"] += 1
        if item2_name_raw and name2 and name2 != item2_name_raw: item_debug_counts["OK"] += 1                

        # Tasks
        task_field = str(get(r, 'Task', '') or '').strip()
        if task_field:
            tokens = re.split(r'[,\|; \t]+', task_field)
            seen_tids: Set[str] = set()
            for tok in tokens:
                tid = tok.strip()
                if not tid or tid in seen_tids:
                    continue
                seen_tids.add(tid)
                if tid in task_index:
                    q["tasks"].append({"task_id": tid, "data": task_index[tid]})
                else:
                    q["tasks"].append({"task_id": tid})
        # Descriptions finales
        desc_texts: list[str] = []
        visited_ids: set[str] = set()
        for t in q["tasks"]:
            row = t.get("data")
            if isinstance(row, dict):
                desc_texts.extend(_collect_desc_texts(row, visited_ids))
        seen_txt: set[str] = set()
        flat_txt: list[str] = []
        for s in desc_texts:
            if s not in seen_txt:
                seen_txt.add(s)
                flat_txt.append(s)
        q["task_desc_texts"] = flat_txt
        # Repeatable
        sched = str(get(r, 'Schedule Id', '') or '')
        if isinstance(sched, str) and ('hourly' in sched.lower() or 'daily' in sched.lower()):
            q["repeatable"] = True
        # Prérequis (edges)
        req = q["required_achievements_expr"]
        if req:
            seen_pos, seen_neg = set(), set()
            for tok, is_neg in parse_logic(req):
                if tok in ach_to_q:
                    for src in ach_to_q[tok]:
                        if src == qid:
                            continue
                        if is_neg:
                            if src not in seen_neg:
                                q["not_prerequisites"].append(src)
                                edges.append((src, qid, True))
                                seen_neg.add(src)
                        else:
                            if src not in seen_pos:
                                q["prerequisites"].append(src)
                                edges.append((src, qid, False))
                                seen_pos.add(src)
        quests.append(q)
    for q in quests:
        if q["type"].strip().lower() == "main story quest":
            q["priority"] = 0
    quests.sort(key=lambda x: x["priority"])
    # Manual links
    id_to_q = {q["id"]: q for q in quests}
    if os.path.isfile(MANUAL_PATH):
        try:
            with open(MANUAL_PATH, 'r', encoding='utf-8') as f:
                manual = json.load(f)
            for link in (manual.get("links") or []):
                src = str(link.get("source", "")).strip()
                tgt = str(link.get("target", "")).strip()
                kind = str(link.get("type", "requires")).strip().lower()
                if not src or not tgt or src == tgt: continue
                if src not in id_to_q or tgt not in id_to_q:
                    print(f"[manual_links] ignoré (id absent): {src} -> {tgt}")
                    continue
                target_q = id_to_q[tgt]
                target_q.setdefault("prerequisites", [])
                target_q.setdefault("not_prerequisites", [])
                if kind in ("not", "negative", "forbid"):
                    if src not in target_q["not_prerequisites"]:
                        target_q["not_prerequisites"].append(src)
                        edges.append((src, tgt, True))
                else:
                    if src not in target_q["prerequisites"]:
                        target_q["prerequisites"].append(src)
                        edges.append((src, tgt, False))
        except Exception as ex:
            print(f"[manual_links] erreur de lecture {MANUAL_PATH}: {ex}")
    # Rattacher meta → quêtes
    meta_ids_attached = 0
    for m in metas:
        mid = m["id"]
        for qid in m.get("quest_ids", []):
            if qid in id_to_q:
                qq = id_to_q[qid]
                qq.setdefault("meta_ids", [])
                if mid not in qq["meta_ids"]:
                    qq["meta_ids"].append(mid)
                    meta_ids_attached += 1
    print(f"[OK] Meta links ajoutés aux quêtes: {meta_ids_attached}")
    # Sorties
    out_dir = os.path.join("public","data", lang)
    os.makedirs(out_dir, exist_ok=True)
    data = {
        "generated_at": datetime.datetime.utcnow().isoformat()+"Z",
        "quest_count": len(quests),
        "edge_count": len(edges),
        "quests": quests,
        "meta_achievements": metas
    }
    quests_out = os.path.join(out_dir, "quests.json")
    with open(quests_out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # meta minimal pour le front
    meta_min = [
        {
            "id": m.get("id"),
            "title": m.get("title"),
            "icon": m.get("icon") or "",
            "description": m.get("description") or "",
            "quests": m.get("quest_ids", []),
            "questTotal": len(m.get("quest_ids", []))
        } for m in metas
    ]
    meta_out = os.path.join(out_dir, "meta_achievements.json")
    with open(meta_out, "w", encoding="utf-8") as mf:
        json.dump(meta_min, mf, ensure_ascii=False)
    print(f"[OK] Écrit {quests_out} et {meta_out} (lang={lang})")

    # --- Debug items non résolus ---
    debug_out = {
        "lang": lang,
        "counts": item_debug_counts,
        "unresolved_samples": unresolved_samples
    }
    with open(os.path.join(out_dir, "debug_items.json"), "w", encoding="utf-8") as df:
        json.dump(debug_out, df, ensure_ascii=False, indent=2)
    if any(k in ("MISSING_DEF","MISSING_NAME_KEY","MISSING_LOCALE_ENTRY") and v > 0 for k,v in item_debug_counts.items()):
        print(f"[WARN] Items non résolus (lang={lang}): {item_debug_counts}")
        if unresolved_samples:
            print("[WARN] Échantillon (max 30):")
            for row in unresolved_samples[:10]:
                print("  -", row)

    # Fallback racine pour la première langue
    if is_default:
        root_q = os.path.join("public","data","quests.json")
        root_m = os.path.join("public","data","meta_achievements.json")
        with open(root_q, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        with open(root_m, "w", encoding="utf-8") as mf:
            json.dump(meta_min, mf, ensure_ascii=False)
        print(f"[OK] Fallback racine écrit: {root_q} et {root_m}")
    print(f"[INFO] Tasks résolus (lang={lang}): {sum(len(q.get('tasks',[])) for q in quests)} / quêtes={len(quests)}")
    if lang != "en-us":
        print(f"[INFO] Quêtes localisées (title/description) pour {lang}: {localized_q_count}")    

# --- Boucle multi-lang ---
locale_files = _iter_locale_files(locale_arg) if locale_arg else []
if not locale_files:
    print("[WARN] Aucune locale fournie; aucune sortie localisée ne sera générée")
else:
    # Charger la baseline EN pour faire le reverse (valeur EN -> clé)
    _en_file = None
    for lf in locale_files:
        if _lang_key_from_path(lf) == "en-us":
            _en_file = lf
            break
    if not _en_file:
        # fallback standard
        cand = os.path.join("tools", "lang", "en-us.json")
        if os.path.isfile(cand):
            _en_file = cand
    if _en_file:
        en_us_locale_map = _try_load_json(_en_file)
        _build_en_reverse(en_us_locale_map)
        print(f"[OK] Baseline EN chargée pour reverse-map: {len(en_us_locale_map):,} entrées ({_en_file})")
    else:
        print("[WARN] Impossible de charger la baseline en-us.json — titres/descriptions de quêtes resteront en anglais")
    
    # Prioriser en-us si présent pour servir de fallback racine
    locale_files = sorted(locale_files, key=lambda p: (0 if _lang_key_from_path(p) == "en-us" else 1, p))
    for i, lf in enumerate(locale_files):
        _generate_for_locale(lf, is_default=(i == 0))

print(f"[INFO] ObjectiveTasks source: {objective_tasks_path}")
if locale_arg:
    print(f"[INFO] Locales utilisées: {', '.join(_lang_key_from_path(p) for p in locale_files)}")
