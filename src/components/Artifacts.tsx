import React, { useContext, useMemo, useState, useRef, useCallback, useEffect } from 'react'
import useStore from '../store'
import { LocaleContext } from '../App'
import ReactFlow, {
  Background, BackgroundVariant, Controls,
  Edge, MarkerType, Node, Position, Handle, ReactFlowInstance
} from 'reactflow' 
import 'reactflow/dist/style.css'

const LANE_COUNT = 4  // multi-voies pour écarter visuellement les arêtes corrélées

const MIN_ZOOM = 0.06
const MAX_ZOOM = 3

type Task = { perk?: number; number?: number; target?: string; zone?: string; mode?: string; taskId?: string; descriptions?: string[] }
type RelatedKind = 'same_drop_mob'|'same_drop_zone'|'same_drop_mode'|'same_task_target'|'same_task_zone'|'same_task_mode'
type Related = { to: string; kind: RelatedKind }
type Artifact = {
  item_id: string
  name: string
  icon?: string
  type?: string
  perks?: { unique?: string; p2?: string|null; p3?: string|null; p4?: string|null }
  perks_ids?: { unique?: string|null; p2?: string|null; p3?: string|null; p4?: string|null }
  perks_icons?: { unique?: string; p2?: string|null; p3?: string|null; p4?: string|null }
  drop?: {
    type?: string;
    mob?: string; mobId?: string;
    itemId?: string; itemName?: string; itemIcon?: string; itemRarity?: string;
    zone?: string; zoneTid?: string; zoneIcon?: string;
    mode?: string; chance?: number|null
  } | null
  quests?: Task[]
  related?: Related[]
}

// --- Filtres par TP_DescriptionTag (PvP + Expeditions), localisés ----------
type TagDef = {
  key: string
  group: 'pvp'|'expedition'
  /** clé de langue (ui/loc .json) pour afficher ET détecter dans la langue courante */
  labelTid: string
  /** fallback lisible si la clé n'existe pas dans une langue */
  fallback: string
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const strip = (s: string) => s
  .toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu,'')
  .replace(/['’]/g,'')            // retire apostrophes
  .replace(/\s+/g,' ')            // espace compact
  .trim()
const TAG_DEFS: TagDef[] = [
  // PvP
  { key:'objective_kill_arena', labelTid:'objective_arena',                 fallback:'Arena',                    group:'pvp' },
  { key:'objective_kill_ctf',   labelTid:'ctf_gamemode_name',              fallback:'Capture The Flag',         group:'pvp' },
  { key:'objective_kill_opr',   labelTid:'outpostrush_name',               fallback:'Outpost Rush',             group:'pvp' },
  // Expeditions / Trials / Raids
  { key:'objective_kill_bnbp',        labelTid:'dungeon_cutlasskeys00_title',  fallback:'Barnacles & Black Powder', group:'expedition' },
  { key:'objective_kill_depths',      labelTid:'dungeon_restlessshores01_title',fallback:'The Depths',              group:'expedition' },
  { key:'objective_kill_dynasty',     labelTid:'dungeon_ebonscale00_title',    fallback:'The Dynasty Shipyard',     group:'expedition' },
  { key:'objective_kill_ennead',      labelTid:'dungeon_brimstone_title',      fallback:'The Ennead',               group:'expedition' },
  { key:'objective_kill_empyean',     labelTid:'dungeon_greatcleave01_title',  fallback:'Empyrean Forge',           group:'expedition' },
  { key:'objective_kill_genesis',     labelTid:'dungeon_edengrove00_title',    fallback:'Garden of Genesis',        group:'expedition' },
  { key:'objective_kill_glacialtarn', labelTid:'dungeon_greatcleave00_title',  fallback:'Glacial Tarn',             group:'expedition' },
  { key:'objective_kill_lazarus',     labelTid:'dungeon_reekwater_title',      fallback:'The Lazarus Instrumentality', group:'expedition' },
  { key:'objective_kill_savagedivide',labelTid:'dungeon_firstlight01_title',   fallback:'Savage Divide',            group:'expedition' },
  { key:'objective_kill_starstone',   labelTid:'dungeon_everfall_title',       fallback:'The Starstone Barrows',    group:'expedition' },
  { key:'objective_kill_tempest',     labelTid:'dungeon_shattermtn00_title',   fallback:"Tempest's Heart",          group:'expedition' },
  { key:'objective_kill_hatchery',    labelTid:'trial_hatchery_title',         fallback:'Hatchery (Elite Trial)',   group:'expedition' },
  { key:'objective_kill_runeforge',   labelTid:'trial_runeforge_title',        fallback:'Winter Rune Forge (Elite Trial)', group:'expedition' },
  { key:'objective_kill_in_ck_raid',  labelTid:'raid_cutlasskeys00_title',     fallback:"Gorgon's Hive (CK Raid)",  group:'expedition' },
  { key:'objective_kill_sandworm',    labelTid:'trial_brimstone_sandworm_title', fallback:'Trial of the Devourer', group:'expedition' },
]

// Couleur par type de drop 
const typeColor = (type: string): string => {
  const k = (type || '').toLowerCase().trim()
  // Palette alignée sur DropCard.DROP_COLORS (mêmes teintes)
  const map: Record<string, string> = {
    'pvp tracks':      '#dc2626',
    'm1+ boss':        '#ec4899',
    'chests':          '#9ca3af',
    'named':           '#f59e0b',
    'quest':           '#facc15',
    'breaches':        '#8b5cf6',
    'opr/ctf':         '#166534',
    'mobs':            '#3b82f6',
    'doubloons':       '#14b8a6',
    'm1+ rewards':     '#f9a8d4',
    'raid boss':       '#86efac',
    '10-trial':        '#bbf7d0',
    'solo trials':     '#ffffff',
    'influence races': '#fda4af',
    'season pass':     '#374151',
  }
  return map[k] ?? '#94a3b8' // fallback neutre
}

// === Token renderer (même logique que dans NodeCard) =========================
// Tokens supportés par le convert :
//   {{ITEM::icon=...::name=...::drop=...::rarity=...::id=<ItemID>}}
//   {{POI::icon=...::name=...::tid=<zoneId>}}
//   {{VC::name=...::qty=...::named=0|1::id=<vcid>::url=...}}
const TOKEN_RE = /\{\{(ITEM|POI|VC)(?:::[^}]*)\}\}/g
function renderTaskText(text: string) {
  if (!text) return null
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text))) {
    const full = m[0]
    const kind = m[1]
    if (m.index > last) out.push(text.slice(last, m.index))
    const payload = full.slice(2, -2) // {{ ... }}
    const parts = payload.split('::').slice(1) // enlève ITEM/POI/VC
    const kv: Record<string, string> = {}
    for (const p of parts) {
      const eq = p.indexOf('=')
      if (eq > -1) kv[p.slice(0, eq)] = p.slice(eq + 1)
    }
    if (kind === 'ITEM') {
      const icon = kv.icon || ''
      const name = kv.name || 'Item'
      const drop = kv.drop || ''
      const raritySlug = (kv.rarity || '').toLowerCase().replace(/\s+/g, '-')
      const itemId = (kv.id || '').trim()
      const isHousing = itemId.toLowerCase().startsWith('house_housingitem')
      const href = itemId ? `https://www.nw-buddy.de/${isHousing ? 'housing' : 'items'}/${itemId}` : ''
      const inner = (
        <>
          {icon ? <img className="reward-icon" src={icon} alt="" loading="lazy" decoding="async" fetchPriority="low" /> : null}
          <span className="task-item__name">{name}</span>
          {drop ? <span className="drop-badge">{drop}</span> : null}
        </>
      )
      out.push(
        href ? (
          <a
            key={`${m.index}-${full}`}
            className={`task-item ${raritySlug ? `rarity-${raritySlug}` : ''}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onMouseDown={(e)=>e.stopPropagation()}
            onClick={(e)=>e.stopPropagation()}
            onPointerDown={(e)=>e.stopPropagation()}
          >
            {inner}
          </a>
        ) : (
          <span key={`${m.index}-${full}`} className={`task-item ${raritySlug ? `rarity-${raritySlug}` : ''}`}>
            {inner}
          </span>
        )
      )
    } else if (kind === 'POI') {
      const icon = kv.icon || ''
      const name = kv.name || 'POI'
      const tid = kv.tid || ''
      const href = tid ? `https://nwdb.info/db/zone/${tid}` : ''
      const inner = (
        <>
          {icon ? <img className="reward-icon" src={icon} alt="" loading="lazy" decoding="async" fetchPriority="low" /> : null}
          <span className="task-item__name">{name}</span>
        </>
      )
      out.push(
        href ? (
          <a
            key={`${m.index}-${full}`}
            className="task-item poi-badge"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onMouseDown={(e)=>e.stopPropagation()}
            onClick={(e)=>e.stopPropagation()}
            onPointerDown={(e)=>e.stopPropagation()}
          >
            {inner}
          </a>
        ) : (
          <span key={`${m.index}-${full}`} className="task-item poi-badge">{inner}</span>
        )
      )
    } else {
      // VC = créature (Vitals Category)
      const name = kv.name || 'Target'
      const qty = kv.qty || ''
      const isNamed = (kv.named || '') === '1' || (kv.named || '').toLowerCase() === 'true'
      const vcid = kv.vcid || kv.id || ''
      const href = vcid ? `https://nwdb.info/db/creature/${vcid}` : ''
      out.push(
        <span key={`${m.index}-${full}`} className="vc-wrap">
          {qty ? <span className="target-qty">{qty}×</span> : null}
          {href ? (
            <a
              className={`vc-badge${isNamed ? ' vc-named' : ''}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onMouseDown={(e)=>e.stopPropagation()}
              onClick={(e)=>e.stopPropagation()}
              onPointerDown={(e)=>e.stopPropagation()}
            >
              {name}
            </a>
          ) : (
            <span className={`vc-badge${isNamed ? ' vc-named' : ''}`}>{name}</span>
          )}
        </span>
      )
    }
    last = TOKEN_RE.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Petits helpers d’affichage/filtrage
function isValidVal(v: unknown) {
  if (v == null) return false
  const s = String(v).trim()
  if (!s) return false
  const low = s.toLowerCase()
  return !(low === 'nan' || low === 'none' || low === 'null' || s === '-')
}


// Normalisation spéciale pour les cibles de tasks :
// - enlève un éventuel compteur en tête du style "20x " ou "20× "
// - lowercase/trim, ignore valeurs vides
function normalizeTargetKey(raw: unknown) {
  if (raw == null) return ''
  let k = String(raw).trim().toLowerCase()
  k = k.replace(/^\d+\s*[x×]\s*/,'') // supprime "20x " / "20× "
  if (!k || k === 'nan' || k === 'none' || k === 'null' || k === '-') return ''
  return k
}
 
// Targets "faction" pour lesquelles on veut la même zone ET la même target
const FACTION_TARGETS = new Set([
  'ancient guardian','angry earth','corrupted','lost','feral beast','human'
])

// --- utilitaire: extraire une "clé zone" depuis les descriptions si q.zone est vide ---
// On lit le premier token {{POI::...::tid=<n>}} ; si pas de tid, on prend ::name=...
const POI_TOKEN_RE = /\{\{POI(?:::[^}]*)\}\}/i
function extractZoneKeyFromDesc(descs?: string[] | null): string {
  if (!Array.isArray(descs) || !descs.length) return ''
  const m = POI_TOKEN_RE.exec(descs[0])
  if (!m) return ''
  const full = m[0]
  const parts = full.slice(2, -2).split('::').slice(1) // enlève "POI"
  const kv: Record<string,string> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq > -1) kv[p.slice(0, eq).toLowerCase()] = p.slice(eq + 1)
  }
  // priorité au tid (stable), sinon name
  if (kv.tid && String(kv.tid).trim()) return String(kv.tid).trim().toLowerCase()
  if (kv.name && String(kv.name).trim()) return String(kv.name).trim().toLowerCase()
  return ''
}

// --- Cartes / nodes ---
function DropCard({ id, data }: { id: string; data: Artifact }) {
  const { t } = useContext(LocaleContext)
  const isCompleted = useStore(s => s.isCompleted)
  const toggleQuest = useStore(s => s.toggleQuest)
  const d = data.drop || {}
  const typeKey        = String(d.type || '').toLowerCase()
  const shouldBadgeMob = !!(typeKey && BADGE_DROP_TYPES.has(typeKey))
  const isItemBased    = !!(typeKey && ITEM_BASED_TYPES.has(typeKey))
  const isQuestType    = (typeKey === 'quest')
  const isChests       = (typeKey === 'chests')
  const isBasicLabelOnly = (typeKey === 'season pass' || typeKey === 'doubloons')
  const isNamedMob     = (typeKey === 'named' || typeKey === 'm1+ boss' || typeKey === 'raid boss')

  // Afficher la carte même si on a juste un type "label-only" (season pass / doubloons) ou quest
  const hasAny =
    isChests || isQuestType || isBasicLabelOnly || isItemBased ||
    isValidVal(d.mob) || isValidVal(d.zone) || isValidVal(d.mode) || (d.chance!=null)
  if (!hasAny) return null
  // palette selon le type (type est en minuscule côté convert)
  const DROP_COLORS: Record<string,string> = {
    'pvp tracks':     '#dc2626', // Rouge
    'm1+ boss':       '#ec4899', // Rose
    'chests':         '#9ca3af', // Gris
    'named':          '#f59e0b', // Orange
    'quest':          '#facc15', // Jaune
    'breaches':       '#8b5cf6', // Violet
    'opr/ctf':        '#166534', // Vert foncé
    'mobs':           '#3b82f6', // Bleu
    'doubloons':      '#14b8a6', // Turquoise
    'm1+ rewards':    '#f9a8d4', // Rose clair
    'raid boss':      '#86efac', // Vert clair
    '10-trial':       '#bbf7d0', // Vert très clair
    'solo trials':    '#ffffff', // Blanc
    'influence races':'#fda4af', // Rouge clair
    'season pass':    '#374151', // Gris foncé
  }
  const topBorder = DROP_COLORS[typeKey] || '#dc2626'
  const done = isCompleted(id) // id === `drop::<item_id>`
  return (
    <div className={`art-card node-card${done ? ' is-done' : ''}`} style={{ width: 260, borderTop: `3px solid ${topBorder}` }}>
      {/* Handles invisibles pour edges (haut/bas pour vertical, gauche/droite pour corrélations) */}
      <Handle type="target" position={Position.Top}    id="t" style={{ opacity: 0 }} />
      {/* Bas en source pour lier Perk2 -> Perk3 -> Perk4 en BOTTOM -> TOP */}
      <Handle type="source" position={Position.Bottom} id="b" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left}   id="sl" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left}   id="tl" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  id="sr" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right}  id="tr" style={{ opacity: 0 }} />
      {/* Check (drop) */}
      <button
        className={`check-toggle${done ? ' on' : ''}`}
        title={done ? t('ui.uncheck','Uncheck') : t('ui.check','Check')}
        onMouseDown={(e)=>e.stopPropagation()}
        onPointerDown={(e)=>e.stopPropagation()}
        onClick={(e)=>{ e.stopPropagation(); toggleQuest(id) }}
        aria-pressed={done}
        style={{ position:'absolute', top:8, right:8 }}
      />
      <div className="drop-title">
        {t('ui.artifacts.drop.title','Drop conditions')}
        {isValidVal(d.type) && <> - <span style={{ color: topBorder }}>{String(d.type)}</span></>}
      </div>
      <ul style={{margin:0, paddingLeft:16}}>
        {/* Chests → ligne simple */}
        {isChests && (
          <li><span className="task-item poi-badge">{t('ui.artifacts.drop.chests','Chests')}</span></li>
        )}
        {/* Label-only → Season Pass / Doubloons */}
        {isBasicLabelOnly && (
          <li>
            <span className="task-item poi-badge">
              {typeKey === 'season pass'
                ? t('ui.artifacts.drop.seasonPass','Season Pass')
                : t('ui.artifacts.drop.doubloons','Doubloons')}
            </span>
          </li>
        )}
        {/* Quest-based → "Quest :" + titre localisé (pas de badge) */}
        {isQuestType && (
          <li>
            {t('ui.artifacts.drop.quest','Quest')}:&nbsp;
            <span>{isValidVal((d as any).questTitle)
              ? String((d as any).questTitle)
              : (isValidVal((d as any).questKey) ? String((d as any).questKey) : t('ui.artifacts.drop.unknownQuest','Unknown quest'))}
            </span>
          </li>
        )}
        {/* Item-based → "Item :" + badge item (icône + nom + lien NWDB) */}
        {!isBasicLabelOnly && isItemBased && isValidVal(d.itemId) && (
          <li>
            {t('ui.artifacts.drop.item','Item')}:&nbsp;
            <a
              className="task-item"
              style={{ backgroundColor: rarityBg(d.itemRarity), color: '#fff', textDecoration: 'none' }}
              href={`https://nwdb.info/db/item/${encodeURIComponent(String(d.itemId!))}`}
              target="_blank"
              rel="noopener noreferrer"
              onMouseDown={(e)=>e.stopPropagation()}
              onClick={(e)=>e.stopPropagation()}
              onPointerDown={(e)=>e.stopPropagation()}
            >
              {isValidVal(d.itemIcon) ? (
                <img className="reward-icon" src={String(d.itemIcon)} alt="" loading="lazy" decoding="async" fetchPriority="low" />
              ) : null}
              <span className="task-item__name">{d.itemName || d.itemId}</span>
            </a>
          </li>
        )}
        {/* Mob standard (sauf si Chests ou Item-based) */}
        {!isChests && !isItemBased && !isQuestType && !isBasicLabelOnly && isValidVal(d.mob)  && (
          <li>
            {t('ui.artifacts.drop.mob','Mob')}:&nbsp;
            {/* badge créature (VC) uniquement si type autorisé + mobId disponible */}
            {shouldBadgeMob && isValidVal(d.mobId) ? (
               <a
                className={`vc-badge${isNamedMob ? ' vc-named' : ''} badge-link`}
                style={{ color: '#fff', textDecoration: 'none' }}
                href={`https://nwdb.info/db/creature/${encodeURIComponent(String(d.mobId!))}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e)=>e.stopPropagation()}
                onMouseDown={(e)=>e.stopPropagation()}
                onPointerDown={(e)=>e.stopPropagation()}
               >{d.mob}</a>
            ) : (
              <span className={`vc-badge${isNamedMob ? ' vc-named' : ''}`}>{d.mob}</span>
            )}
          </li>
        )}
        {!isBasicLabelOnly && isValidVal(d.zone) && (
          <li>
            {t('ui.artifacts.drop.zone','Zone')}:&nbsp;
            {/* badge POI identique aux tasks: icône + libellé + lien si tid présent */}
            {isValidVal(d.zoneTid) ? (
              <a
                className="task-item poi-badge"
                style={{ color: '#fff', textDecoration: 'none' }}
                href={`https://nwdb.info/db/zone/${encodeURIComponent(String(d.zoneTid))}`}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={(e)=>e.stopPropagation()}
                onClick={(e)=>e.stopPropagation()}
                onPointerDown={(e)=>e.stopPropagation()}
              >
                {isValidVal((d as any).zoneIcon) ? (
                  <img className="reward-icon" src={String((d as any).zoneIcon)} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                ) : null}
                <span className="task-item__name">{d.zone}</span>
              </a>
            ) : (
              <span className="task-item poi-badge">
                {isValidVal((d as any).zoneIcon) ? (
                  <img className="reward-icon" src={String((d as any).zoneIcon)} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                ) : null}
                <span className="task-item__name">{d.zone}</span>
              </span>
            )}
          </li>
        )}
        {isValidVal(d.mode) && <li>{t('ui.artifacts.drop.mode','Game mode')}: {d.mode}</li>}
        {(d.chance!=null)   && <li>{t('ui.artifacts.drop.chance','Drop chance')}: {d.chance}%</li>}
      </ul>
      <div className="done-overlay" style={{ pointerEvents:'none' }} />
    </div>
  )
}

// Node de carte artefact (au milieu)
function ArtifactCard({ id, data }: { id: string; data: Artifact }) {
  const { t } = useContext(LocaleContext)
  const isCompleted = useStore(s => s.isCompleted)
  const toggleQuest = useStore(s => s.toggleQuest)
  const a = data
  // état “maxed” = art coché OU les 3 tasks cochées
  const q0 = isCompleted(`quest::${a.item_id}::0`)
  const q1 = isCompleted(`quest::${a.item_id}::1`)
  const q2 = isCompleted(`quest::${a.item_id}::2`)
  const autoAllTasks = q0 && q1 && q2
  const artDone = isCompleted(`art::${a.item_id}`)
  const isDone = artDone || autoAllTasks
  return (
    <div className={`art-card node-card${isDone ? ' is-done' : ''}`} style={{ width: 260 }}>
      {/* Handles : top target (depuis drop), bottom source (vers quests), left/right pour liens croisés si besoin */}
      <Handle type="target" position={Position.Top}    id="t" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left}   id="sl" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left}   id="tl" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  id="sr" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right}  id="tr" style={{ opacity: 0 }} />
      <div className="art-head">
        {/* Check (artifact maxed) */}
        <button
          className={`check-toggle${isDone ? ' on' : ''}`}
          title={isDone ? t('ui.uncheck','Uncheck') : t('ui.check','Check')}
          onMouseDown={(e)=>e.stopPropagation()}
          onPointerDown={(e)=>e.stopPropagation()}
          onClick={(e)=>{ e.stopPropagation(); toggleQuest(`art::${a.item_id}`) }}
          aria-pressed={isDone}
          style={{ position:'absolute', top:8, right:8 }}
        />
        <div className="art-icon">
          {a.icon ? (
            <a href={`https://www.nw-buddy.de/items/${a.item_id}`} target="_blank" rel="noreferrer">
              <img src={a.icon} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
            </a>
          ) : '🧿'}
        </div>
        <div>
          <div className="art-name">{a.name}</div>
          {a.type && <div className="art-type">{a.type}</div>}
        </div>
      </div>
      <div className="art-perks">
        {a?.perks?.unique && (
          a?.perks_ids?.unique
            ? <a className="art-badge" href={`https://www.nw-buddy.de/perks/${a.perks_ids.unique}`} target="_blank" rel="noreferrer">
                {isValidVal(a?.perks_icons?.unique) && <img className="reward-icon" src={String(a.perks_icons!.unique)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.unique','Unique perk')}: {a.perks.unique}
              </a>
            : <span className="art-badge">
                {isValidVal(a?.perks_icons?.unique) && <img className="reward-icon" src={String(a.perks_icons!.unique)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.unique','Unique perk')}: {a.perks.unique}
              </span>
        )}
        {a?.perks?.p2 && (
          a?.perks_ids?.p2
            ? <a className="art-badge" href={`https://www.nw-buddy.de/perks/${a.perks_ids.p2}`} target="_blank" rel="noreferrer">
                {isValidVal(a?.perks_icons?.p2) && <img className="reward-icon" src={String(a.perks_icons!.p2)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.p2','Perk 2')}: {a.perks.p2}
              </a>
            : <span className="art-badge">
                {isValidVal(a?.perks_icons?.p2) && <img className="reward-icon" src={String(a.perks_icons!.p2)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.p2','Perk 2')}: {a.perks.p2}
              </span>
        )}
        {a?.perks?.p3 && (
          a?.perks_ids?.p3
            ? <a className="art-badge" href={`https://www.nw-buddy.de/perks/${a.perks_ids.p3}`} target="_blank" rel="noreferrer">
                {isValidVal(a?.perks_icons?.p3) && <img className="reward-icon" src={String(a.perks_icons!.p3)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.p3','Perk 3')}: {a.perks.p3}
              </a>
            : <span className="art-badge">
                {isValidVal(a?.perks_icons?.p3) && <img className="reward-icon" src={String(a.perks_icons!.p3)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.p3','Perk 3')}: {a.perks.p3}
              </span>
        )}
        {a?.perks?.p4 && (
          a?.perks_ids?.p4
            ? <a className="art-badge" href={`https://www.nw-buddy.de/perks/${a.perks_ids.p4}`} target="_blank" rel="noreferrer">
                {isValidVal(a?.perks_icons?.p4) && <img className="reward-icon" src={String(a.perks_icons!.p4)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.p4','Perk 4')}: {a.perks.p4}
              </a>
            : <span className="art-badge">
                {isValidVal(a?.perks_icons?.p4) && <img className="reward-icon" src={String(a.perks_icons!.p4)} alt="" loading="lazy" decoding="async" fetchPriority="low" />}
                {t('ui.artifacts.perks.p4','Perk 4')}: {a.perks.p4}
              </span>
        )}
      </div>
      <div className="done-overlay" style={{ pointerEvents:'none' }} />
    </div>
  )
}

function QuestCard({ id, data }: { id: string; data: { perk?: number; number?: number; target?: string; zone?: string; mode?: string; descriptions?: string[] } }) {
  const { t } = useContext(LocaleContext)
  const isCompleted = useStore(s => s.isCompleted)
  const toggleQuest = useStore(s => s.toggleQuest)
  const q = data
  const done = isCompleted(id) // id === `quest::<item_id>::<i>`
  return (
    <div className={`art-card node-card${done ? ' is-done' : ''}`} style={{ width: 260, borderLeft: '3px solid #2563eb' }}>
      {/* Handles : top target (depuis artifact), left/right pour liens croisés entre tasks */}
      <Handle type="target" position={Position.Top}    id="t" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left}   id="sl" style={{ opacity: 0 }} />
      {/* 4 voies à gauche (targets) espacées verticalement */}
      <Handle type="target" position={Position.Left}   id="tl0" style={{ opacity: 0, top: '20%' }} />
      <Handle type="target" position={Position.Left}   id="tl1" style={{ opacity: 0, top: '40%' }} />
      <Handle type="target" position={Position.Left}   id="tl2" style={{ opacity: 0, top: '60%' }} />
      <Handle type="target" position={Position.Left}   id="tl3" style={{ opacity: 0, top: '80%' }} />
      {/* 4 voies à droite (sources) espacées verticalement */}
      <Handle type="source" position={Position.Right}  id="sr0" style={{ opacity: 0, top: '20%' }} />
      <Handle type="source" position={Position.Right}  id="sr1" style={{ opacity: 0, top: '40%' }} />
      <Handle type="source" position={Position.Right}  id="sr2" style={{ opacity: 0, top: '60%' }} />
      <Handle type="source" position={Position.Right}  id="sr3" style={{ opacity: 0, top: '80%' }} />
      <Handle type="target" position={Position.Right}  id="tr"  style={{ opacity: 0 }} />
      {/* Fallbacks pour compat avec edges existantes (sr/tl) */}
      <Handle type="target" position={Position.Left}   id="tl" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  id="sr" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right}  id="tr"  style={{ opacity: 0 }} />
      {/* Check (task done) */}
      <button
        className={`check-toggle${done ? ' on' : ''}`}
        title={done ? t('ui.uncheck','Uncheck') : t('ui.check','Check')}
        onMouseDown={(e)=>e.stopPropagation()}
        onPointerDown={(e)=>e.stopPropagation()}
        onClick={(e)=>{ e.stopPropagation(); toggleQuest(id) }}
        aria-pressed={done}
        style={{ position:'absolute', top:8, right:8 }}
      />
      <div style={{fontWeight:700, marginBottom:6}}>
        {t('ui.artifacts.unlock.perk','Perk {n}',{ n: q.perk ?? '?' })}
      </div>
      {Array.isArray(q.descriptions) && q.descriptions.length > 0 ? (
        <ul style={{margin:0, paddingLeft:16}}>
          {q.descriptions.map((line, i) => (
            <li key={i} style={{fontSize:13}}>{renderTaskText(line)}</li>
          ))}
        </ul>
      ) : (
        <div style={{fontSize:13}}>
          {(q.number!=null) ? `${q.number} × ` : ''}{isValidVal(q.target) ? q.target : '—'}
          {isValidVal(q.zone) ? ` • ${q.zone}` : ''}{isValidVal(q.mode) ? ` • ${q.mode}` : ''}
        </div>
      )}
      <div className="done-overlay" style={{ pointerEvents:'none' }} />
    </div>
  )
}

const nodeTypes = { artifact: ArtifactCard, artifactDrop: DropCard, artifactQuest: QuestCard }
const BADGE_DROP_TYPES = new Set(['m1+ boss','named','mobs','raid boss'])  // pour décider si "Mob" doit être un badge
const ITEM_BASED_TYPES = new Set(['10-trial','breaches','influence races','m1+ rewards'])
const QUEST_BASED_TYPES = new Set(['quest'])

function rarityBg(r?: string) {
  const k = String(r || '').toLowerCase().trim()
  // Adapte si tu as d'autres libellés de rareté
  switch (k) {
    case 'legendary': return '#b45309'
    case 'epic':      return '#7c3aed'
    case 'rare':      return '#2563eb'
    case 'uncommon':  return '#059669'
    case 'common':    return '#6b7280'
    default:          return '#374151'
  }
}


type DropCond = {
  type?: string;
  mob?: string;
  mobId?: string;
  zone?: string;
  zoneTid?: string;
  mode?: string;
  chance?: number | null;
};

function edgeStyle(kind: RelatedKind) {
  switch (kind) {
    case 'same_drop_mob':    return { stroke: '#ef4444', strokeWidth: 2.2 }           // rouge, plein
    case 'same_drop_zone':   return { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 4' } // orange, pointillé
    case 'same_drop_mode':   return { stroke: '#a855f7', strokeWidth: 2, strokeDasharray: '2 6' } // violet, pointillés fins
    case 'same_task_target': return { stroke: '#3b82f6', strokeWidth: 2.2 }           // bleu, plein
    case 'same_task_zone':   return { stroke: '#10b981', strokeWidth: 2, strokeDasharray: '6 4' } // vert, pointillé
    case 'same_task_mode':   return { stroke: '#0ea5e9', strokeWidth: 2, strokeDasharray: '2 6' }
  }
}

export default function Artifacts({ lang, artifacts, error }:{
  lang: string
  artifacts: Artifact[] | null
  error: string | null
}) {
  const { t, locale } = useContext(LocaleContext)
  // --- UI state pour réduire le bruit visuel des arêtes ---
  const [showDropMob, setShowDropMob]       = useState(true)
  const [showDropZone, setShowDropZone]     = useState(false)
  const [showTaskTarget, setShowTaskTarget] = useState(true)
  const [showTaskZone, setShowTaskZone]     = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // --- Sidebar Help (même logique que Sidebar.tsx) ---
  const SIDEBAR_KEY = 'sidebarCollapsed_artifacts_v1'
  const [helpCollapsed, setHelpCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1' } catch { return false }
  })
  useEffect(() => {
    const cls = 'sidebar-collapsed'
    const root = document.documentElement
    if (helpCollapsed) root.classList.add(cls)
    else root.classList.remove(cls)
    try { localStorage.setItem(SIDEBAR_KEY, helpCollapsed ? '1' : '0') } catch {}
  }, [helpCollapsed])
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const viewInitRef = useRef(false)
  // Progress / per-character completion
  const isCompleted      = useStore(s => s.isCompleted)
  const toggleQuest      = useStore(s => s.toggleQuest)
  const completedVersion = useStore(s => s.completedVersion)
  const resetProgress    = useStore(s => s.resetProgress)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Retourne un libellé localisé à partir des TIDs "jeu" (ex: dungeon_* / objective_*)
  const labelFromLocale = useCallback((tid: string, fallback: string) => {
    const k = String(tid || '').replace(/^@/, '')
    const map: any = (locale as any) || {}
    // on essaie la clé telle quelle puis en minuscule (certains packs sont lowercased)
    const v = map[k] ?? map[k.toLowerCase?.()]
    return String(v ?? fallback)
  }, [locale])

  // -------- Détection des tags par artéfact --------
  const artifactTags = useMemo(() => {
    const map = new Map<string, Set<string>>()
    if (!artifacts) return map
    const ACCEPT = new Set(TAG_DEFS.map(td => td.key))
    for (const a of artifacts) {
      const set = new Set<string>()
      for (const q of (a.quests || [])) {
        const qq: any = q as any
        // 1) tableau de tags (nouveau convert)
        if (Array.isArray(qq?.descTags)) {
          for (const k of qq.descTags) {
            const key = String(k || '').trim()
            if (key && ACCEPT.has(key)) set.add(key)
          }
        }
        // 2) single (compat)
        const single =
          String(
            qq?.descTag ??
            qq?.TP_DescriptionTag ??
            qq?.tp_desc_tag ??
            qq?.tpDescriptionTag ??
            qq?.descriptionTag ??
            ''
          ).trim()
        if (single && ACCEPT.has(single)) set.add(single)
      }
      // 2) FALLBACK : si aucune clé présente, on tente un match **textuel localisé**
      if (set.size === 0) {
        // Prépare les libellés localisés à chercher pour CHAQUE tag
        const tagStrings: Record<string,string> = {}
        for (const td of TAG_DEFS) {
          const loc = labelFromLocale(td.labelTid, td.fallback)
          tagStrings[td.key] = strip(loc)
        }
        const testLine = (s?: string) => {
          const line = strip(String(s ?? ''))
          if (!line) return
          for (const td of TAG_DEFS) {
            const needle = tagStrings[td.key]
            if (needle && line.includes(needle)) set.add(td.key)
          }
        }
        // Tasks ONLY (zone/mode/descriptions)
        for (const q of (a.quests || [])) {
          if (q.zone) testLine(q.zone as any)
          if (q.mode) testLine(q.mode as any)
          if (Array.isArray(q.descriptions)) for (const d of q.descriptions) testLine(d)
        }
      }
      map.set(a.item_id, set)
    }
    return map
  }, [artifacts, labelFromLocale, lang])

  // Tags présents dans les données (n'affiche que l'utile)
  const presentTags = useMemo(() => {
    const have = new Set<string>()
    for (const [, s] of artifactTags) for (const k of s) have.add(k)
    return TAG_DEFS.filter(td => have.has(td.key))
  }, [artifactTags, labelFromLocale, lang])

  // Filtre exclusif via dropdown : un seul tag sélectionné (ou aucun)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  // Si le tag sélectionné n'existe plus (dataset changé), on l'efface
  useEffect(() => {
    if (selectedTag && !presentTags.some(t => t.key === selectedTag)) setSelectedTag(null)
  }, [presentTags, selectedTag])
  
  const focusNode = (id: string) => {
    const inst = rfRef.current
    if (!inst) return
    const n = inst.getNode(id)
    if (!n) return
    const cx = n.position.x + (n.width ?? 280) / 2
    const cy = n.position.y + (n.height ?? 120) / 2
    inst.setCenter(cx, cy, { zoom: 0.85, duration: 600 })
  }

  // Clic sur flèche : navigation douce dans les 2 sens (autre extrémité)
  const onEdgeClick = useCallback((evt: React.MouseEvent, edge: Edge) => {
    evt.stopPropagation()
    const other =
      (selectedId && selectedId === edge.source) ? edge.target :
      (selectedId && selectedId === edge.target) ? edge.source :
      (edge.target ?? edge.source)
    if (other) {
      setSelectedId(other)
      focusNode(other)
    }
  }, [selectedId])
 
  // Liste dédupliquée d’artefacts (utile pour la progression)
  const dedupArtifacts = useMemo(() => {
    if (!artifacts) return []
    const m = new Map<string, Artifact>()
    for (const a of artifacts) if (!m.has(a.item_id)) m.set(a.item_id, a)
    return Array.from(m.values())
  }, [artifacts])
  
  // Répartition par type de drop (pour le dropdown du Progress)
  const typeBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; dropped: number }>()
    for (const a of dedupArtifacts) {
      const type = String((a as any)?.drop?.type ?? '—')
      const cur = map.get(type) || { total: 0, dropped: 0 }
      cur.total++
      if (isCompleted(`drop::${a.item_id}`)) cur.dropped++
      map.set(type, cur)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [dedupArtifacts, completedVersion])

  // Compteurs de progression (par personnage via store)
  const droppedCount = useMemo(() => {
    return dedupArtifacts.reduce((acc, a) => acc + (isCompleted(`drop::${a.item_id}`) ? 1 : 0), 0)
  }, [dedupArtifacts, completedVersion])
  const maxedCount = useMemo(() => {
    return dedupArtifacts.reduce((acc, a) => {
      const q0 = isCompleted(`quest::${a.item_id}::0`)
      const q1 = isCompleted(`quest::${a.item_id}::1`)
      const q2 = isCompleted(`quest::${a.item_id}::2`)
      const allTasks = q0 && q1 && q2
      const artDone  = isCompleted(`art::${a.item_id}`)
      return acc + ((artDone || allTasks) ? 1 : 0)
    }, 0)
  }, [dedupArtifacts, completedVersion])


  // === Disposition déterministe en colonnes ===
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const result = { nodes: [] as Node[], edges: [] as Edge[] }
    if (!artifacts || artifacts.length === 0) return result

    // (A) Dédupe par item_id pour éviter nodes/edges en double
    const uniqMap = new Map<string, Artifact>()
    for (const a of artifacts) {
      if (!uniqMap.has(a.item_id)) uniqMap.set(a.item_id, a)
    }
    let arts = Array.from(uniqMap.values())

    // (A.1) Filtre exclusif : ne garder que les artéfacts qui matchent le tag sélectionné
    if (selectedTag) {
      arts = arts.filter(a => artifactTags.get(a.item_id)?.has(selectedTag))
    }

    // 1) Ordre “intelligent” : rapproche les artéfacts fortement reliés
    //    (poids = connexions drop/zone/target de tasks). Greedy double-ended.
    function keyNorm(v: unknown) {
      const s = (v ?? '').toString().trim().toLowerCase()
      if (!s || s === 'nan' || s === 'none' || s === 'null' || s === '-') return ''
      return s
    }
    function addW(a: string, b: string, w: number, map: Map<string, number>) {
      if (!a || !b || a === b || w <= 0) return
      const k = a < b ? `${a}|${b}` : `${b}|${a}`
      map.set(k, (map.get(k) || 0) + w)
    }
    // Groupes d’IDs d’artéfact par clé (drop/task)
    const gDropMob  = new Map<string, string[]>()
    const gDropZone = new Map<string, string[]>()
    const gQTarget  = new Map<string, string[]>()
    const gQZone    = new Map<string, string[]>()
    function pushMap(map: Map<string,string[]>, key: string, id: string) {
      if (!key) return
      const arr = map.get(key) || []
      arr.push(id); map.set(key, arr)
    }
    // Utilitaires tasks
    function descBaseOf(descs?: string[] | null): string {
      if (!descs || !descs.length) return ''
      return String(descs[0] ?? '').toLowerCase().replace(/qty=\d+/g, 'qty=*').replace(/\s+/g, ' ').trim()
    }
    // Remplit les groupes par artéfact
    for (const a of arts) {
      const id = a.item_id
      const d  = a.drop || {}
      const mob  = keyNorm(d.mob)
      const zone = keyNorm(d.zone)
      if (mob)  pushMap(gDropMob,  mob,  id)
      if (zone) pushMap(gDropZone, zone, id)
      for (const q of (a.quests || [])) {
        const targ = normalizeTargetKey(q.target)
        let zkey = keyNorm(q.zone)
        if (!zkey) zkey = extractZoneKeyFromDesc(q.descriptions)
        // Si target “faction”, on contraint par zone si possible (même logique que pour les edges)
        const tKey = FACTION_TARGETS.has(targ) && zkey ? `${targ}@@zone:${zkey}` : targ
        if (tKey) pushMap(gQTarget, tKey, id)
        if (zkey) pushMap(gQZone,   zkey, id)
      }
    }
    // Calcule les poids entre paires d’artéfacts
    const pairW = new Map<string, number>()
    function addFrom(map: Map<string,string[]>, w: number) {
      for (const ids of map.values()) {
        for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) addW(ids[i], ids[j], w, pairW)
      }
    }
    // Pondérations simples (ajuste si besoin)
    addFrom(gDropMob, 2)   // même mob de drop
    addFrom(gDropZone, 1)  // même zone de drop
    addFrom(gQTarget, 4)   // même target de task
    addFrom(gQZone, 3)     // même zone de task
    // Degrés par artéfact
    const ids = arts.map(a => a.item_id)
    const degree = new Map<string, number>(ids.map(id => [id, 0]))
    for (const [k,w] of pairW) {
      const [a,b] = k.split('|')
      degree.set(a, (degree.get(a) || 0) + w)
      degree.set(b, (degree.get(b) || 0) + w)
    }
    // Greedy double-ended : on part du plus connecté et on ajoute au bord le plus “proche”
    function wAB(a?: string, b?: string) {
      if (!a || !b) return 0
      const k = a < b ? `${a}|${b}` : `${b}|${a}`
      return pairW.get(k) || 0
    }
    let orderIds: string[]
    if (pairW.size === 0) {
      // fallback : ancien ordre alphabétique par nom
      orderIds = arts.slice().sort((a,b)=> (a.name||'').localeCompare(b.name||'')).map(a=>a.item_id)
    } else {
      let seed = ids[0], best = -1
      for (const id of ids) { const d = degree.get(id) || 0; if (d > best) { best = d; seed = id } }
      const unplaced = new Set(ids); unplaced.delete(seed)
      const seq: string[] = [seed]
      while (unplaced.size) {
        const L = seq[0], R = seq[seq.length-1]
        let pick: string | null = null, side: 'L'|'R' = 'R', score = -1
        for (const u of unplaced) {
          const sL = wAB(u, L), sR = wAB(u, R)
          const s = Math.max(sL, sR)
          if (s > score) { score = s; pick = u; side = (sR >= sL ? 'R' : 'L') }
        }
        if (!pick || score <= 0) {
          // plus de liens forts : choisir le plus “degré” restant
          let bestId = Array.from(unplaced)[0], bd = -1
          for (const u of unplaced) { const d = degree.get(u) || 0; if (d > bd) { bd = d; bestId = u } }
          seq.push(bestId); unplaced.delete(bestId); continue
        }
        unplaced.delete(pick)
        if (side === 'R') seq.push(pick); else seq.unshift(pick)
      }
      orderIds = seq
    }
    const ordered: Artifact[] = orderIds.map(id => arts.find(a => a.item_id === id)!).filter(Boolean)


    // 2) Constantes de layout (ajuste au besoin)
    const COL_W   = 320
    const COL_GAP = 24
    const X0      = 16
    const Y0      = 10
    const GAP_Y   = 14
    const GAP_DROP_ART = 100
    const H_DROP  = 110
    const H_ART   = 220
    const H_Q     = 110

    // 3) Créer nodes + vertical edges empilés
    const nodes: Node[] = []
    const edges: Edge[] = []
    const edgeIds = new Set<string>()
    const addEdge = (e: Edge) => {
      if (edgeIds.has(e.id)) return
      edgeIds.add(e.id)
      edges.push(e)
    }
    const qMeta: Record<string, { targetKey: string, zoneKey: string, descKey: string }> = {}
    const colIndexById: Record<string, number> = {}

    ordered.forEach((a, colIdx) => {
      const x = X0 + colIdx * (COL_W + COL_GAP)
      let y = Y0

      const idArt = a.item_id
      const d      = a.drop || {}
      const dType  = String(d.type || '').toLowerCase()
      const isItem = ITEM_BASED_TYPES.has(dType)              // '10-trial','breaches','influence races','m1+ rewards'
      const isQuest= (dType === 'quest')
      const isLabel= (dType === 'season pass' || dType === 'doubloons' || dType === 'chests')
      const hasDrop = !!(a.drop && (
        isQuest || isLabel || isItem ||
        (d.mob && String(d.mob).trim()) ||
        (d.zone && String(d.zone).trim()) ||
        (d.mode && String(d.mode).trim()) ||
        (d.chance != null)
      ))
      if (hasDrop) {
        nodes.push({
          id: `drop::${idArt}`,
          type: 'artifactDrop',
          data: a,
          position: { x, y },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        })
        y += H_DROP + GAP_DROP_ART
      }

      nodes.push({
        id: `art::${idArt}`,
        type: 'artifact',
        data: a,
        position: { x, y },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { borderRadius: 14, overflow: 'hidden', width: 260 },
      })
      y += H_ART + GAP_Y

      // Edge drop -> art (vertical) : de BOTTOM (drop) vers TOP (artifact)
      if (hasDrop) {
        addEdge({
          id: `e-drop-${idArt}`,
          source: `drop::${idArt}`,
          target: `art::${idArt}`,
          sourceHandle: 'b',
          targetHandle: 't',
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: { stroke: '#6b7280', strokeWidth: 1.5, strokeDasharray: '4 4' },
        })
      }

      // Quests empilées sous l’artéfact
      const qs = (a.quests || []).slice(0, 3) // si >3, on garde 3 selon ton spec initial
      let prevId = `art::${idArt}`
      qs.forEach((q, i) => {
        const qid = `quest::${idArt}::${i}`
        const tk = normalizeTargetKey(q.target)
        // Zone key: q.zone si dispo, sinon extraite de la 1ʳᵉ description (POI)
        let zk = ''
        if (isValidVal(q.zone)) {
          zk = String(q.zone).toLowerCase().trim()
        } else {
          zk = extractZoneKeyFromDesc(q.descriptions)
        }
        const dk = normalizeDescBase(q.descriptions)
        qMeta[qid] = { targetKey: tk, zoneKey: zk, descKey: dk }
        nodes.push({
          id: qid,
          type: 'artifactQuest',
          data: { perk: q.perk, number: q.number, target: q.target, zone: q.zone, mode: q.mode, descriptions: q.descriptions },
          position: { x, y },
          sourcePosition: Position.Right,
          targetPosition: Position.Top,
        })
        // edge vertical : prev -> quest  // BOTTOM -> TOP pour Perk 2->3->4 (et Artifact -> Perk2)
        addEdge({
          id: `e-v-${idArt}-${i}`,
          source: prevId,
          target: qid,
          sourceHandle: 'b',
          targetHandle: 't',
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: { stroke: '#1f2937', strokeWidth: 1.5 },
        })
        prevId = qid
        y += H_Q + GAP_Y
      })

      colIndexById[idArt] = colIdx
    })

    // 4) Liens croisés : DROP (mob/zone/mode) + QUEST (target/zone/mode)
    const mapDropMob:  Record<string,string[]> = {}
    const mapDropZone: Record<string,string[]> = {}
    const mapQTarget:  Record<string,string[]> = {}
    const mapQZone:    Record<string,string[]> = {}

    function push(map: Record<string,string[]>, key: string|undefined, nodeId: string) {
      const raw = (key ?? '')
      const k = raw.toString().trim().toLowerCase()
      if (!k || k === 'nan' || k === 'none' || k === 'null' || k === '-') return
      ;(map[k] ||= []).push(nodeId)
    }
    // version spéciale pour les cibles de tasks (ignore les compteurs)
    function pushTarget(map: Record<string,string[]>, key: string|undefined, nodeId: string) {
      const k = normalizeTargetKey(key)
      if (!k) return
      ;(map[k] ||= []).push(nodeId)
    }

  // Normalise la "base" d'une description de tâche pour comparer des templates identiques
  // - prend la 1ʳᵉ description si plusieurs
  // - passe en lower
  // - neutralise la quantité: qty=123  -> qty=*
  // - nettoie les espaces
  function normalizeDescBase(descs?: string[] | null): string {
    if (!descs || !descs.length) return ''
    const d = String(descs[0] ?? '').toLowerCase()
    if (!d) return ''
    return d
      .replace(/qty=\d+/g, 'qty=*')
      .replace(/\s+/g, ' ')
      .trim()
  }

    const GENERIC_TARGETS = new Set(['ancient','ancient guardian','angryearth','angry earth','corrupted','lost','beast','feral beast','human','player'])

    ordered.forEach((a) => {
      const idArt = a.item_id
      if (a.drop && (isValidVal(a.drop.mob) || isValidVal(a.drop.zone) || isValidVal(a.drop.mode))) {
        const dropId = `drop::${idArt}`
        push(mapDropMob,  a.drop.mob,  dropId)
        push(mapDropZone, a.drop.zone, dropId)
      }
      (a.quests || []).forEach((q, i) => {
        const qid = `quest::${idArt}::${i}`
      // --- Clé de corrélation pour la target de task ---
      const targ = (q.target ?? '').toString().trim().toLowerCase()
      let zkey = (q.zone ?? '').toString().trim().toLowerCase()
      if (!zkey) {
        // tente d'extraire une zone depuis la description (POI badge) si possible
        zkey = extractZoneKeyFromDesc(q.descriptions)
      }
      let targetKey = targ
      if (GENERIC_TARGETS.has(targ)) {
        if (zkey) {
          // générique + zone => on exige zone identique
          targetKey = `${targ}@@zone:${zkey}`
        } else {
          // générique + pas de zone => on exige la même "base de description"
          const base = normalizeDescBase(q.descriptions)
          targetKey = base ? `${targ}@@desc:${base}` : `${targ}@@desc:uniq:${qid}`
        }
      }
      push(mapQTarget, targetKey, qid)
      push(mapQZone,   q.zone,     qid)
      })
    })

    const seen = new Set<string>()
    // index de "voie" stable selon (source,target) pour connecter sr{lane}/tl{lane}
    function laneIndexFor(a: string, b: string, lanes = LANE_COUNT) {
      const s = a < b ? `${a}|${b}` : `${b}|${a}`
      let h = 0
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
      return Math.abs(h) % lanes
    }

    function connectPairs(
      ids: string[],
      kind: RelatedKind,
      prefix: string,
      opts?: { sourceHandle?: string; targetHandle?: string; lanes?: boolean }
    ) {
      if (ids.length < 2) return
      for (let i=0;i<ids.length;i++){
        for (let j=i+1;j<ids.length;j++){
          const a = ids[i], b = ids[j]
          const eid = `${prefix}__${a}__${b}`
          if (seen.has(eid)) continue
          seen.add(eid)
          // Répartition sur plusieurs voies si demandé (stable par paire)
          const lane = opts?.lanes ? laneIndexFor(a,b) : 0
          const baseSrc = opts?.sourceHandle ?? 'sr'
          const baseTgt = opts?.targetHandle ?? 'tl'
          const srcHandle = opts?.lanes ? `${baseSrc}${lane}` : baseSrc
          const tgtHandle = opts?.lanes ? `${baseTgt}${lane}` : baseTgt
          addEdge({
            id: eid,
            source: a,
            target: b,
            sourceHandle: srcHandle,
            targetHandle: tgtHandle,
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
            animated: false,
            style: edgeStyle(kind),
            data: { kind, corr: true },
          })
        }
      }
    }

    // Connexions spéciales pour "same_task_target" :
    // - si la target est une "faction" (Ancient/AngryEarth/Corrupted/Lost/Beast/Human),
    //   on ne relie QUE si la zone est identique des deux côtés.
    function connectTaskTargetPairsForKey(key: string, ids: string[]) {
      const isFaction = FACTION_TARGETS.has((key || '').toLowerCase())
      if (ids.length < 2) return
      for (let i=0;i<ids.length;i++){
        for (let j=i+1;j<ids.length;j++){
          const a = ids[i], b = ids[j]
          if (isFaction) {
            const za = qMeta[a]?.zoneKey || ''
            const zb = qMeta[b]?.zoneKey || ''
            if (!za || !zb || za !== zb) continue
          }
          const eid = `q-task-target__${a}__${b}`
          if (seen.has(eid)) continue
          seen.add(eid)
          // voies stables pour les corrélations de cibles de tasks
          const lane = laneIndexFor(a,b)
          edges.push({
            id: eid,
            source: a,
            target: b,
            sourceHandle: `sr${lane}`,
            targetHandle: `tl${lane}`,
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
            animated: false,
            style: edgeStyle('same_task_target'),
            data: { kind: 'same_task_target', corr: true },
          })
        }
      }
    }


    // 4a) Liens entre drops (mob/zone) — flèches: sortent à droite, entrent à gauche
    Object.values(mapDropMob ).forEach(ids =>
      // Drop <-> Drop : on garde des handles simples (pas de multi-voies)
      connectPairs(ids, 'same_drop_mob',  'q-drop-mob',  { sourceHandle: 'sr', targetHandle: 'tl' })
    )
    Object.values(mapDropZone).forEach(ids =>
      connectPairs(ids, 'same_drop_zone', 'q-drop-zone', { sourceHandle: 'sr', targetHandle: 'tl' })
    )

    // 4b) Liens entre tasks — règle génériques:
    //  - si zone présente des 2 côtés => elle doit être identique
    //  - sinon => la "base" de description (qty neutralisé) doit être identique
    Object.entries(mapQTarget).forEach(([key, ids]) => {
      const isFaction = FACTION_TARGETS.has((key || '').toLowerCase())
      if (ids.length < 2) return
      for (let i=0;i<ids.length;i++){
        for (let j=i+1;j<ids.length;j++){
          const a = ids[i], b = ids[j]
          if (isFaction) {
            const za = qMeta[a]?.zoneKey || ''
            const zb = qMeta[b]?.zoneKey || ''
            if (za && zb) {
              if (za !== zb) continue
            } else {
              const da = qMeta[a]?.descKey || ''
              const db = qMeta[b]?.descKey || ''
              if (!da || !db || da !== db) continue
            }
          }
          const eid = `q-task-target__${a}__${b}`
          if (seen.has(eid)) continue
          seen.add(eid)
          const lane = laneIndexFor(a,b)
          addEdge({
            id: eid,
            source: a,
            target: b,
            sourceHandle: `sr${lane}`,
            targetHandle: `tl${lane}`,
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
            animated: false,
            style: edgeStyle('same_task_target'),
            data: { kind: 'same_task_target', corr: true },
          })
        }
      }
    })
    Object.values(mapQZone).forEach(ids =>
      // Task <-> Task : activer les voies pour réduire les chevauchements
      connectPairs(ids, 'same_task_zone', 'q-task-zone', { sourceHandle: 'sr', targetHandle: 'tl', lanes: true })
    )

    // --- Filtrage / focalisation des arêtes corrélées ---
    const filteredEdges = edges.filter((e) => {
      const isCorr = (e as any).data?.corr === true
      if (!isCorr) return true // toujours garder les arêtes verticales "structurelles"
      const kind = (e as any).data?.kind as RelatedKind | undefined
      if (kind === 'same_drop_mob'    && !showDropMob)    return false
      if (kind === 'same_drop_zone'   && !showDropZone)   return false
      if (kind === 'same_task_target' && !showTaskTarget) return false
      if (kind === 'same_task_zone'   && !showTaskZone)   return false
      if (selectedId && e.source !== selectedId && e.target !== selectedId) return false
      return true
    }).map((e) => {
      const isCorr = (e as any).data?.corr === true
      const fade = Boolean(selectedId)
      return {
        ...e,
        style: {
          ...(e.style || {}),
          opacity: isCorr ? (fade ? 0.9 : 0.35) : 1, // atténue les corrélations quand pas en focus
        },
      }
    })

    // --- Encadrement rose des tasks corrélées à la sélection ---
    const relatedTaskIds = new Set<string>()
    if (selectedId) {
      filteredEdges.forEach((e) => {
        const kind = (e as any).data?.kind as RelatedKind | undefined
        const isTaskCorr = kind === 'same_task_target' || kind === 'same_task_zone'
        if (!isTaskCorr) return
        if (e.source === selectedId) relatedTaskIds.add(e.target)
        if (e.target === selectedId) relatedTaskIds.add(e.source)
      })
    }

    const styledNodes = nodes.map((n) => {
      if (n.type !== 'artifactQuest') return n
      const isSelected = (selectedId === n.id)
      const isRelated  = (!isSelected && relatedTaskIds.has(n.id))
      if (!isSelected && !isRelated) return n
      return {
        ...n,
        style: {
          ...(n.style || {}),
          // priorité au focus blanc s'il est sélectionné, sinon rose corrélé
          boxShadow: isSelected
            ? '0 0 0 3px #ffffff, 0 0 0 6px rgba(255,255,255,.22)'
            : '0 0 0 3px #ff45c8',
          borderRadius: 12,
        },
      }
    })

    result.nodes = styledNodes
    result.edges = Array.from(new Map(filteredEdges.map(e => [e.id, e])).values())
    return result
  }, [artifacts, showDropMob, showDropZone, showTaskTarget, showTaskZone, selectedId, artifactTags, presentTags, selectedTag])


  // ---- Vue initiale: centrer/zoomer sur l'artéfact le plus à gauche ----
  useEffect(() => {
    if (viewInitRef.current) return
    if (!layoutedNodes || layoutedNodes.length === 0) return
    const inst = rfRef.current
    if (!inst) return
    const arts = layoutedNodes.filter(n => n.type === 'artifact')
    if (arts.length === 0) return
    let left = arts[0]
    for (const n of arts) {
      if (n.position.x < left.position.x) left = n
    }
    const cx = left.position.x + ((left.width as number | undefined) ?? 260) / 2
    const cy = left.position.y + ((left.height as number | undefined) ?? 220) / 2
    inst.setCenter(cx, cy, { zoom: 1.1, duration: 600 })
    viewInitRef.current = true
  }, [layoutedNodes.length])

  // -- Recherche (SearchBar) : focus par nom localisé ou ID d’artefact quand on est sur ce tab
  React.useEffect(() => {
    const handler = (e: any) => {
      const raw = (e?.detail?.query ?? '').toString().trim().toLowerCase()
      if (!raw) return
      const inst = rfRef.current
      const nodes = inst?.getNodes?.() ?? layoutedNodes
      // On cible les nœuds 'artifact' (car on veut chercher par nom/ID d’artéfact)
      const target = nodes.find(n =>
        n.type === 'artifact' && (
          (n.id?.toLowerCase().includes(raw)) ||
          (String((n.data as any)?.name || '').toLowerCase().includes(raw))
        )
      )
      if (target && inst) {
        setSelectedId(null)
        inst.fitView({ nodes: [{ id: target.id }], padding: 0.25, duration: 400 })
      }
    }
    window.addEventListener('focus-node', handler as any)
    return () => window.removeEventListener('focus-node', handler as any)
  }, [layoutedNodes])

  // -- Infos panneau latéral : task sélectionnée + corrélations cliquables
  const selectedInfo = useMemo(() => {
    if (!selectedId) return null
    const node = layoutedNodes.find(n => n.id === selectedId && n.type === 'artifactQuest')
    if (!node) return null
    const m = /^quest::(.+?)::(\d+)$/.exec(selectedId)
    const itemId = m?.[1] ?? ''
    const artNode = layoutedNodes.find(n => n.id === `art::${itemId}`)
    const itemName = String((artNode?.data as any)?.name || itemId)
    const qd: any = node.data || {}
    const perkNum = qd?.perk ?? '?'
    const perks = (artNode?.data as any)?.perks || {}
    const pKey = perkNum === 1 ? 'unique' : `p${perkNum}`
    const perkName = perks[pKey] || pKey
    const taskText = Array.isArray(qd.descriptions) && qd.descriptions.length
      ? qd.descriptions.join(' · ')
      : `${qd?.number ? `${qd.number} × ` : ''}${qd?.target || '—'}${qd?.zone ? ` • ${qd.zone}` : ''}${qd?.mode ? ` • ${qd.mode}` : ''}`
    const corrEdges = layoutedEdges.filter(e =>
      (e as any).data?.corr &&
      (e.source === selectedId || e.target === selectedId) &&
      (['same_task_target','same_task_zone'].includes(String((e as any).data?.kind)))
    )
    const uniq = new Set<string>()
    const items = corrEdges
      .map(e => (e.source === selectedId ? e.target : e.source))
      .filter(id => {
        if (!id || uniq.has(id)) return false
        uniq.add(id); return true
      })
      .map(otherId => {
        const otherNode = layoutedNodes.find(n => n.id === otherId)
        const q: any = otherNode?.data || {}
        const mm = /^quest::(.+?)::(\d+)$/.exec(otherId)
        const oid = mm?.[1] ?? ''
        const oArt = layoutedNodes.find(n => n.id === `art::${oid}`)
        const oname = String((oArt?.data as any)?.name || oid)
        const onum = q?.perk ?? '?'
        const ok = onum === 1 ? 'unique' : `p${onum}`
        const on = (oArt?.data as any)?.perks?.[ok] || ok
        return { id: otherId, itemName: oname, perkNum: onum, perkName: on }
      })
    return { title: `${itemName} — Perk ${perkNum} — ${perkName}`, taskText, items }
  }, [selectedId, layoutedNodes, layoutedEdges])

  if (error) return <div className="center error">Artifacts error: {error}</div>
  if (!artifacts) return <div className="center">Loading artifacts…</div>
  if (artifacts.length === 0) return <div className="center">No artifacts found.</div>

  return (
    <>
      {/* Colonne principale (graph) */}
      <div className="graph" style={{ position:'relative' }}>
        {/* Dropdown de filtre (overlay en haut-gauche, au-dessus du graph) */}
        {presentTags.length > 0 && (
          <div
            style={{
              position:'absolute', top:8, left:8, zIndex:6,
              backdropFilter:'blur(3px)',
              background:'rgba(2,6,23,.7)',
              border:'1px solid #273244',
              boxShadow:'0 6px 18px rgba(0,0,0,.35)',
              borderRadius:10, padding:'8px 10px',
              display:'flex', alignItems:'center', gap:10
            }}
          >
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span
                style={{
                  fontWeight:800,
                  fontSize:13,
                  padding:'4px 10px',
                  borderRadius:999,
                  background:'#0b1220',
                  border:'1px solid #1f2937',
                  color:'#e5e7eb',
                  letterSpacing:.3
                }}
                title={t('ui.filters.byTag','Task filter')}
              >
                {t('ui.filters.byTag','Task filter')}
              </span>
              <select
                id="artifact-filter"
                value={selectedTag ?? ''}
                onChange={(e) => setSelectedTag(e.target.value ? e.target.value : null)}
                style={{
                  padding:'8px 12px',
                  borderRadius:10,
                  background:'#0f172a',
                  color:'#e5e7eb',
                  border:'1px solid #334155',
                  minWidth: 260,
                  fontWeight:600
                }} 
              >
                <option value="">{t('ui.filters.clear','No filter')}</option>
                <optgroup label={t('ui.filters.pvp','PvP')}>
                  {presentTags.filter(tg => tg.group==='pvp').map(tg => (
                    <option key={tg.key} value={tg.key}>
                      {labelFromLocale(tg.labelTid, tg.fallback)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('ui.filters.expeditions','Expeditions')}>
                  {presentTags.filter(tg => tg.group==='expedition').map(tg => (
                    <option key={tg.key} value={tg.key}>
                      {labelFromLocale(tg.labelTid, tg.fallback)}
                    </option>
                  ))}
                </optgroup>
              </select>
              {selectedTag && (
                <button
                  onClick={()=>setSelectedTag(null)}
                  title={t('ui.filters.clear','Clear filter')}
                  style={{
                    padding:'6px 10px',
                    borderRadius:999,
                    border:'1px solid #7f1d1d',
                    background:'#991b1b',
                    color:'#fff',
                    fontWeight:700
                  }}
                >
                  {t('ui.filters.clear','Clear filter')}
                </button>
              )}
            </div>
          </div>
        )}
        <div style={{width:'100%', height:'100%', border:'1px solid #1f2937', borderRadius:12}}>
          <ReactFlow
            nodes={layoutedNodes}
            edges={layoutedEdges}
            nodeTypes={nodeTypes}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            onInit={(inst) => { rfRef.current = inst }}
            onNodeClick={(_, node)=> {
              if (node.type !== 'artifactQuest') { setSelectedId(null); return }
              setSelectedId(prev => prev===node.id ? null : node.id)
            }}
            onEdgeClick={onEdgeClick}
            nodesConnectable={false}
            nodesDraggable={false}
            elementsSelectable={false}
            selectNodesOnDrag={false}
            selectionOnDrag={false}
          >
            <Background variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} position="bottom-left" style={{ bottom: 20 }}/>
          </ReactFlow>
        </div>
      </div>


      {/* --- Bouton et Sidebar d’aide (même UX que Graph) --- */}
      <button
        className="sidebar-handle"
        onClick={() => setHelpCollapsed(v => !v)}
        title={helpCollapsed ? t('ui.help.open','Open help panel') : t('ui.help.hide','Hide help panel')}
      >
        {helpCollapsed ? `< ${t('ui.help','Help')}` : '>'}
      </button>
      <aside className="sidebar" aria-hidden={helpCollapsed}>
        <h3 className="sidebar-title">{t('ui.artifacts.help.title','Artifacts — Help')}</h3>
        <h4 className="sidebar-subtitle">{t('ui.artifacts.help.howto','How to use this view')}</h4>
        {/* CTA vidéo */}
        <div className="help-cta">
          <a className="help-cta__btn"
             href="https://youtu.be/1GjaU6r_jpE"
             target="_blank" rel="noopener noreferrer">
            <svg className="yt-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M23.5 7.2a4.8 4.8 0 0 0-3.4-3.4C17.9 3.3 12 3.3 12 3.3s-5.9 0-8.1.5A4.8 4.8 0 0 0 .5 7.2 50.5 50.5 0 0 0 0 12a50.5 50.5 0 0 0 .5 4.8 4.8 4.8 0 0 0 3.4 3.4c2.2.5 8.1.5 8.1.5s5.9 0 8.1-.5a4.8 4.8 0 0 0 3.4-3.4A50.5 50.5 0 0 0 24 12a50.5 50.5 0 0 0-.5-4.8ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z"/>
            </svg>
            {t('ui.help.demo','Watch the demo video')}
          </a>
        </div>
        <ul className="howto-list">
          <li>{t('ui.artifacts.help.tipMove','You can drag the canvas to pan (with mouse click)')}</li>
          <li>{t('ui.artifacts.help.tipClick','Click a task to show correlated tasks (selected task shows white, correlated tasks show pink); click a list entry to navigate to it.')}</li>
          <li>{t('ui.artifacts.help.tipEdge','You can click on the end of an arrow to navigate to its other end')}</li>
          <li>{t('ui.artifacts.help.tipSearch','Use the searchbar to navigate to an artifact, by artifact name or ID.')}</li>
          <li>{t('ui.artifacts.help.tipComplete','Tick a drop condition to mark the artifact as "dropped" and tick a task to mark as completed. Ticking all 3 tasks will mark the artifact as "fully upgraded", or you can tick the artifact itself.')}</li>
          <li>{t('ui.artifacts.help.tipProgress','Your progress is tracked per character, you can make a new character or delete it')}</li>
          <li>{t('ui.artifacts.help.tipLinks','You can click on artifacts icons/perks/items/mobs/zones to go to their related nw-buddy/nwdb pages.')}</li>
          <li>{t('ui.artifacts.help.tipMap','FYI the artifacts are mapped so that the most correlated tasks are close to each other when possible')}</li>
          <li>{t('ui.sidebar.howto.backup')}</li>
        </ul>
      </aside>

      {/* Dock : détails de la tâche sélectionnée */}
      {selectedInfo && (
        <div className="art-sidepanel" role="complementary" aria-live="polite">
          <div className="asp-title">{t('ui.artifacts.selected.title','Selected task')}</div>
          <div className="asp-selected">{selectedInfo.title}</div>
          <div className="asp-sub">{t('ui.artifacts.selected.correlated','Correlated tasks')}</div>
          <ul className="asp-list">
            {selectedInfo.items.map(it => (
              <li key={it.id}>
                <button
                  type="button"
                  className="asp-link"
                  onClick={() => { setSelectedId(it.id); focusNode(it.id) }}
                >
                  {it.itemName} — {t('ui.artifacts.perk','Perk')} {it.perkNum} — {it.perkName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Progress dock (comme dans Graph) */}
      <div className="progress-dock">
        <div className="progress-dock__title">
          <div className="title">{t('ui.progress.title','Progress')}</div>
          <button
            className="btn-reset-progress"
            onClick={() => setShowResetConfirm(true)}
            aria-label={t('ui.progress.resetDesc','Reset progress')}
            title={t('ui.progress.resetDesc','Reset progress')}
          >
            {t('ui.progress.reset','Reset')}
          </button>
        </div>
        <div className="progress-list">
          <div className="progress-row">
            <div className="progress-label">{t('ui.artifacts.progress.dropped','Artifacts dropped')}</div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${dedupArtifacts.length ? (droppedCount / dedupArtifacts.length) * 100 : 0}%` }}
              />
            </div>
            <div className="tag">{droppedCount}/{dedupArtifacts.length}</div>
          </div>
          {/* Dropdown par type de condition de drop */}
          <details className="progress-breakdown">
            <summary>{t('ui.artifacts.progress.byType','By drop type')}</summary>
            <div className="breakdown-list">
              {typeBreakdown.map(([type, { total, dropped }]) => {
                const pct = total ? Math.round((dropped / total) * 100) : 0
                return (
                  <div key={type} className="progress-row">
                    <div className="progress-label" style={{ color: typeColor(type) }}>{type}</div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="tag">{dropped}/{total}</div>
                  </div>
                )
              })}
            </div>
          </details>
          <div className="progress-row">
            <div className="progress-label">{t('ui.artifacts.progress.maxed','Artifacts fully upgraded')}</div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${dedupArtifacts.length ? (maxedCount / dedupArtifacts.length) * 100 : 0}%` }}
              />
            </div>
            <div className="tag">{maxedCount}/{dedupArtifacts.length}</div>
          </div>
        </div>
      </div>
      {/* Reset confirmation overlay — identique à Graph.tsx */}
      {showResetConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            style={{
              background: '#0f172a',
              color: 'white',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: 16,
              minWidth: 360,
              boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
              {t('ui.progress.reset','Reset progress')}
            </h3>
            <p style={{ margin: 0 }}>
              {t('ui.progress.resetConfirm','Reset progress for the active character?')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { resetProgress(); setShowResetConfirm(false) }}>
                {t('ui.confirm','Confirm')}
              </button>
              <button onClick={() => setShowResetConfirm(false)}>
                {t('ui.cancel','Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}