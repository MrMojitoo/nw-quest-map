import React from 'react'
import ReactFlow, {
  MiniMap, Controls, ControlButton, Background, BackgroundVariant,
  Node, Edge, useReactFlow, applyNodeChanges, type NodeChange,
  ReactFlowProvider, type NodeProps
} from 'reactflow'
import 'reactflow/dist/style.css'
import useStore from '../store'
import { LocaleContext } from '../App'

// Helper pour préfixer correctement sous GitHub Pages
const withBase = (p: string) =>
  (import.meta.env.BASE_URL + String(p || '').replace(/^\//, '')).replace(/([^:]\/)\/+/g, '$1')

type Mission = {
  MissionID: string
  ObjectiveID?: string
  AvailableTerritoryId?: number | string
  RequiredFaction?: 'Covenant' | 'Marauder' | 'Syndicate' | string
  MissionGoalType?: string
  TitleOverride?: string
  POITagOverride?: string
  DescriptionOverride?: string
  TaskHaveAndReturnItemsOverride?: string
  TaskHaveAndReturnItemsDropProbabilityOverride?: string | number
  TaskHaveAndReturnChestDropProbabilityOverride?: string | number
  TaskKillContributionOverride?: string
  TaskKillContributionQtyOverride?: number | string
  VCLevel?: number | string
  RecommendedGroupSize?: number | string
  title_resolved?: string
  desc_text?: string
  desc_tokens?: any[]
  BgImage?: string
  ImagePath?: string
  RequiredTradeskill?: string
  TradeskillLevel?: number | string
  // récompenses 
    rewards?: {
    xp?: number
    coins?: number
    territoryStanding?: number
    reputation?: number
    tokens?: number
    azothSalt?: number
    pvpXp?: number
    influence?: number
  }
  tasks?: { key?: string; text?: string; tokens?: any[] }[]
}

type FactionKey = 'Covenant' | 'Marauder' | 'Syndicate'
const ALL_FACTIONS: FactionKey[] = ['Covenant','Marauder','Syndicate']

// Palette simple pour la minimap (1 couleur par faction)
const FAC_COLORS: Record<string,string> = {
  Covenant: '#f59e0b',   // amber
  Marauder: '#22c55e',   // green
  Syndicate: '#8b5cf6',  // violet
  Other: '#94a3b8'
}

// --- Couleurs par territoire (approx "comme dans Graph") ---
// On peut enrichir/ajuster facilement la palette si besoin.
const TERR_COLORS: Record<string, string> = {
  brightwood:        '#60a5fa',
  greatcleave:       '#f59e0b',
  everfall:          '#1f3a93',
  reekwater:         '#238aebff',
  windsward:         '#00ffff',
  shatteredmountain: '#ef4444',
  queensport:        '#b45309',
  firstlight:        '#86efac',
  cutlasskeys:       '#fbff00ff',
  mourningdale:      '#3923ffff',
  monarchsbluffs:    '#9ca3af',
  weaversfen:        '#a78bfa',
  edengrove:         '#10b981',
  restlessshore:     '#ff23daff',
  brimstonesands:    '#facc15',
}

// Couleurs par MissionGoalType
const GOAL_COLORS: Record<string, string> = {
  Loot:      '#06b6d4', 
  Raid:      '#f97316',
  Hunt:      '#22c55e',
  Harvest:   '#ccb116',
  Log:       '#a3a3a3',
  Espionage: '#ef4444',
  Control:   '#ef4444',
  Intercept: '#ef4444',
}

const hexToRgba = (hex: string, alpha = 0.1) => {
  const m = hex.replace('#','')
  const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16)
  return `rgba(${r},${g},${b},${alpha})`
}
 
// Ordre logique des types pour l'affichage en lignes
const GOAL_ORDER = ['Loot','Raid','Hunt','Harvest','Log','Espionage','Control','Intercept']

// === Constantes de mise en page (module-scope pour être visibles dans MissionCard) ===
const CARD_W     = 290  // largeur d'une carte (px)
const H_GAP      = 20   // écart horizontal entre cartes (px)
const CARD_STEP_X= CARD_W + H_GAP  // pas horizontal
const ROW_H      = 500  // pas vertical (hauteur d'une ligne)
const COL_GAP    = 40   // marge horizontale entre colonnes de zones
const BLOCK_MAX  = 10   // max quêtes par ligne (wrap au-delà)

declare global {
  interface Window { __DEBUG_FACTIONS_TASKS?: boolean }
}

// Carte mission ultra-light (réutilise les styles .node-card / .check-toggle)
const MissionCard = React.memo(function MissionCard({ data }: { data: {
  id: string
  title: string
  idLabel?: string 
  zoneLabel: string
  zoneSlug?: string
  faction?: string
  goalType?: string
  poiName?: string
  poiIcon?: string
  poiUrl?: string
  poiElite?: boolean
  RecommendedGroupSize?: number | string
  descTokens?: any[]
  BgImage?: string
  ImagePath?: string
  descText?: string
  rewards?: {
    xp?: number
    coins?: number
    territoryStanding?: number
    reputation?: number
    tokens?: number
    azothSalt?: number
    pvpXp?: number
    influence?: number
  }
  tasks?: { key?: string; text?: string; tokens?: any[] }[]
  renderDesc?: (tokens?: any[], fallback?: string, descKey?: string, zoneLabel?: string) => React.ReactNode
  onToggle: () => void
  done: boolean
}}) {

  // Log de debug optionnel (mettez window.__DEBUG_FACTIONS_TASKS = true dans la console)
  const hasLoggedRef = React.useRef(false)
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.__DEBUG_FACTIONS_TASKS && !hasLoggedRef.current) {
      const count = Array.isArray((data as any).tasks) ? (data as any).tasks.length : 0
      console.log('[Factions][MissionCard]', { id: data.idLabel || data.id, tasksCount: count, sample: (data as any).tasks?.[0] })
      hasLoggedRef.current = true
    }
  }, [data])

  const { t } = React.useContext(LocaleContext)
  const zoneColor = data.zoneSlug ? (TERR_COLORS[data.zoneSlug] || '#334155') : '#334155'
  // -- Image de fond : on prend BgImage si présent (pré-réécrit par le convert), sinon on transforme ImagePath côté front
  const rawBg = (data as any).bgImage ?? (data as any).BgImage ?? (data as any).ImagePath
  let bgUrl: string | undefined = undefined
  if (rawBg) {
    let p = String(rawBg).replace(/\\/g, '/')
    // si le convert n'a pas fourni BgImage, on fallback : LyShineUI/Images → /icons
    p = p.replace(/^LyShineUI\/Images/i, '/icons')
    // les assets du dossier public/ sont servis à / ; on retire le prefix "public/"
    p = p.replace(/^public\//i, '/')
    if (!p.startsWith('/')) p = '/' + p
    bgUrl = withBase(p)
  }
  const rgsVal = data.RecommendedGroupSize
  const rgs:number = rgsVal !== undefined && rgsVal !== null && String(rgsVal).trim() !== ''
    ? Number(rgsVal) : 0
  const borderColor =
    rgs === 3 ? '#ef4444' : (rgs === 5 ? '#e5ff00ff' : undefined)

  return (
    <div
      className="node-card"
      style={{
        width: CARD_W,
        ...(borderColor ? { border: `3px solid ${borderColor}` } : null),
      }}
    >
      {bgUrl && (
        <div
          className="node-card__bg"
          style={{
            backgroundImage: `linear-gradient(rgba(11,16,32,0.45), rgba(11,16,32,0.45)), url(${bgUrl})`,
          }}
        />
      )}
      <div className="node-card__content">
      {/* Topbar colorée uniquement */}
      <div style={{
        height: 6,
        width: '100%',
        background: zoneColor,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        marginTop: -6,
        marginBottom: 6
      }} />
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
        <div style={{ fontWeight:800, lineHeight:1.2, fontSize:20 }}>
          {data.title || data.id}
          {data.idLabel && (
            <div className="muted" style={{ fontSize:10, marginTop:2, fontWeight:600, opacity:.8 }}>
              {data.idLabel}
            </div>
          )}
        </div>
      </div>
      <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
        {data.faction && (
          <span className="tag tag--meta"
            style={{ background: (FAC_COLORS[data.faction] || '#334155'), color:'#0b1020', fontWeight:600 }}>
            {data.faction}
          </span>
        )}
        {data.zoneLabel && (
          <span className="tag tag--meta" title={data.zoneLabel}
            style={{ display:'inline-flex', alignItems:'center', gap:6,
                     background: zoneColor, color:'#0b1020', fontWeight:600 }}>
            {data.zoneLabel}
          </span>
        )}
        {data.goalType && (
          <span
            className="tag tag--meta"
            style={{
              background: (GOAL_COLORS[data.goalType] || '#475569'),
              color: '#0b1020',
              fontWeight: 600,
            }}
          >
            {data.goalType}
          </span>
        )}
        {/* Lvl min-max (sans couleur spéciale) */}
        {(() => {
          const minL = (data as any).MinLevel
          const maxL = (data as any).MaxLevel
          if (minL == null && maxL == null) return null
          const a = (minL != null && minL !== '') ? String(minL) : '?'
          const b = (maxL != null && maxL !== '') ? String(maxL) : '?'
          return (
            <span className="tag tag--req" title={t('ui.badges.levelRange.title','Required level range')}>
              {`Lvl ${a}-${b}`}
            </span>
          )
        })()}
        {/* Tradeskill requis (ex: "Skinning 70") */}
        {(() => {
          const ts = (data as any).RequiredTradeskill
          const tl = (data as any).TradeskillLevel
          if (!ts || tl == null || String(tl) === '') return null
          return (
            <span className="tag tag--req" title={t('ui.badges.tradeskill.title','Required tradeskill')}>
              {`${ts} ${tl}`}
            </span>
          )
        })()}
      </div>

      {/* Rewards entre 2 lignes pointillées */}
      {(() => {
        const r = (data as any).rewards
        const has =
          r && Object.values(r).some((v:any) => typeof v === 'number' ? v > 0 : !!v)
        if (!has) return null
        const fmtCoins = (n:number) => n.toFixed(2)
        return (
          <div className="rewards-inline">
            {r.xp ? (
              <span className="task-item" title={t('ui.rewards.xp','XP')}>
                <img className="reward-icon" src={withBase('/icons/reward_xp.webp')} alt="" />
                <span>{r.xp} XP</span>
              </span>
            ) : null}
            {r.coins ? (
              <span className="task-item" title={t('ui.rewards.coins','Coins')}>
                <img className="reward-icon" src={withBase('/icons/reward_coin.webp')} alt="" />
                <span>{fmtCoins(r.coins)}</span>
              </span>
            ) : null}
            {r.territoryStanding ? (
              <span className="task-item" title={t('ui.rewards.territoryStanding','Territory Standing')}>
                <img className="reward-icon" src={withBase('/icons/reward_territorystanding.webp')} alt="" />
                <span>{r.territoryStanding}</span>
              </span>
            ) : null}
            {r.reputation ? (
              <span className="task-item" title={t('ui.rewards.reputation','Faction Reputation')}>
                <img className="reward-icon" src={withBase('/icons/faction-reputation.png')} alt="" />
                <span>{r.reputation}</span>
              </span>
            ) : null}
            {r.tokens ? (
              <span className="task-item" title={t('ui.rewards.tokens','Faction Tokens')}>
                <img className="reward-icon" src={withBase('/icons/faction-tokens.png')} alt="" />
                <span>{r.tokens}</span>
              </span>
            ) : null}
            {r.azothSalt ? (
              <span className="task-item" title={t('ui.rewards.azothSalt','Azoth Salt')}>
                <img className="reward-icon" src={withBase('/icons/azoth-salt.png')} alt="" />
                <span>{r.azothSalt}</span>
              </span>
            ) : null}
            {r.pvpXp ? (
              <span className="task-item" title={t('ui.rewards.pvpXp','PvP XP')}>
                <img className="reward-icon" src={withBase('/icons/pvp-xp.png')} alt="" />
                <span>{r.pvpXp}</span>
              </span>
            ) : null}
            {r.influence ? (
              <span className="task-item" title={t('ui.rewards.influence','Faction Influence')}>
                <img className="reward-icon" src={withBase('/icons/faction-influence.png')} alt="" />
                <span>{r.influence}</span>
              </span>
            ) : null}
          </div>
        )
      })()}
      {data.renderDesc && (
        (Array.isArray(data.descTokens) && data.descTokens.length > 0) ||
        (data.descText && String(data.descText).trim())
      ) ? (
        <div className="tasks-raw node-card__desc">
          <div className="node-subtitle" style={{ fontSize: 16, fontWeight: 700, margin: '0px 0 0px' }}>
            {t('ui.description','Description')}
          </div>
          {data.renderDesc(data.descTokens, data.descText, (data as any).DescriptionOverride, data.zoneLabel)}
        </div>
      ) : null}

      {/* Tasks sous la description, avec dropdown */}
      {Array.isArray(data.tasks) && data.tasks.length > 0 ? (
        <div className="tasks-raw" style={{ borderTop:'1px dashed var(--border)', marginTop:6 }}>
          <details>
            <summary style={{ cursor:'pointer', userSelect:'none' }}>
              {`Tasks (${data.tasks.length})`}
            </summary>
            <ul className="tasks-ul" style={{ marginTop:6 }}>
              {data.tasks.map((tk, i) => (
                <li key={i} className="task-li">
                  <div className="task-line">
                    {data.renderDesc?.(tk.tokens, undefined, tk.key || undefined, data.zoneLabel)}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </div>
    </div>
  )
})

// === Node React Flow sans handles / sans fond ===
const FactionNode = React.memo(function FactionNode({ data }: NodeProps<any>) {
  return <MissionCard data={data as any} />
})
const nodeTypes = { faction: FactionNode }

function FactionsInner({ lang }: { lang: string }) {
  const { t, locale } = React.useContext(LocaleContext)
  const rf = useReactFlow()
  const isCompleted = useStore(s => s.isCompleted)
  const toggleQuest = useStore(s => s.toggleQuest)
  const setManyNodePos = useStore(s => s.setManyNodePos)
  const savedPos = useStore(s => ( (s as any).layoutPos?.factions || {} as Record<string,{x:number;y:number}> ))
  const resetLayoutPos = useStore(s => s.resetLayoutPos)
  const completedVersion = useStore(s => s.completedVersion)

  // --- Chargement missions (JSON simplifié généré depuis le CSV) ---
  // Attendu: { missions: Mission[] } OU Mission[] à la racine
  const [missions, setMissions] = React.useState<Mission[] | null>(null)
  const [loadErr, setLoadErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    let abort = false
    const tryJsonThenCsv = async () => {
      // 1) JSON généré par le convert
      try {
        const r = await fetch(withBase('/data/missions_factions.json'))
        if (r.ok) {
          const json = await r.json()
          const arr: Mission[] = Array.isArray(json) ? json : (Array.isArray(json?.missions) ? json.missions : [])
          if (!abort && arr.length) { setMissions(arr); return }
        }
      } catch {}
      // 2) Fallback CSV (si tu n'as pas relancé le convert)
      const csvPaths = ['/data/Missions.csv', '/Missions.csv'].map(withBase)
      for (const p of csvPaths) {
        try {
          const r2 = await fetch(p)
          if (!r2.ok) continue
          const text = await r2.text()
          const arr = parseMissionsCSV(text)
          if (!abort && arr.length) { setMissions(arr); return }
        } catch {}
      }
      if (!abort) setLoadErr(t('ui.factions.error','Unable to load faction missions.'))
    }
    tryJsonThenCsv()
    return () => { abort = true }
  }, [lang])

  // === Recherche globale : focus carte par MissionID (idLabel) ou titre via React Flow ===
  React.useEffect(() => {
    const onFocus = (e: Event) => {
      const query = String((e as CustomEvent).detail?.query || '').trim().toLowerCase()
      if (!query) return
      const nodes = rf.getNodes()

      // 1) match exact sur MissionID (data.idLabel)
      let hit = nodes.find(n => String((n.data?.idLabel ?? '')).toLowerCase() === query)

      // 2) sinon partiel sur MissionID ou titre
      if (!hit) {
        hit = nodes.find(n => {
          const id = String(n.data?.idLabel ?? '').toLowerCase()
          const title = String(n.data?.title ?? '').toLowerCase()
          return id.includes(query) || title.includes(query)
        }) || undefined
      }
      if (!hit) return

      // Pan/zoom vers la carte trouvée
      try {
        rf.fitView({ nodes: [hit], padding: 0.2, duration: 700, maxZoom: 1.25 })
      } catch {}

      // Surbrillance visuelle pendant 1,6s
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(hit.id)}"] .node-card`)
      if (el) {
        el.classList.add('node-card--highlight')
        window.setTimeout(() => el.classList.remove('node-card--highlight'), 1600)
      }
    }
    window.addEventListener('focus-node' as any, onFocus as any)
    return () => window.removeEventListener('focus-node' as any, onFocus as any)
  }, [rf])

  // Log global: combien de missions avec tasks côté front
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.__DEBUG_FACTIONS_TASKS && Array.isArray(missions)) {
      const total = missions.length
      const withTasks = missions.filter((m:any) => Array.isArray(m.tasks) && m.tasks.length > 0).length
      console.log('[Factions] Missions chargées:', { total, withTasks })
    }
  }, [missions])  

  // --- CSV parser minimal (gère les champs entre guillemets) ---
  const parseMissionsCSV = (csv: string): Mission[] => {
    const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0)
    if (!lines.length) return []
    const split = (line: string) => line.match(/(?:[^,"\\]+|"(?:[^"]|"")*")+/g) || []
    const headers = split(lines[0]).map(h => h.replace(/^"|"$/g,'').replace(/""/g,'"').trim())
    const idx = (k: string) => headers.findIndex(h => h.toLowerCase() === k.toLowerCase())
    const iMission   = idx('MissionID')
    const iObj       = idx('ObjectiveID')
    const iTerr      = idx('AvailableTerritoryId')
    const iFaction   = idx('RequiredFaction')
    const iGoalType  = idx('MissionGoalType')
    const iTitleOv   = idx('TitleOverride')
    const iPoiTagOv  = idx('POITagOverride')
    const iDescOv    = idx('DescriptionOverride')
    const iReqTS     = idx('RequiredTradeskill')
    const iTSLevel   = idx('TradeskillLevel')
    const iGroupSize = idx('RecommendedGroupSize')
    const out: Mission[] = []
    for (let li = 1; li < lines.length; li++) {
      const raw = split(lines[li]).map(v => v.replace(/^"|"$/g,'').replace(/""/g,'"'))
      const get = (i: number) => (i >= 0 && i < raw.length ? raw[i] : '').trim()
      const terrRaw = get(iTerr)
      const terr = /^\d+$/.test(terrRaw) ? Number(terrRaw) : (terrRaw || undefined)
      const rec: Mission = {
        MissionID: get(iMission),
        ObjectiveID: get(iObj) || undefined,
        AvailableTerritoryId: terr,
        RequiredFaction: (get(iFaction) || undefined) as any,
        MissionGoalType: get(iGoalType) || undefined,
        TitleOverride: get(iTitleOv) || undefined,
        POITagOverride: get(iPoiTagOv) || undefined,
        DescriptionOverride: get(iDescOv) || undefined,
        RecommendedGroupSize: (() => {
          const v = get(iGroupSize)
          return /^\d+$/.test(v) ? Number(v) : undefined
        })(),
        // Tradeskill requis (pour afficher le badge "Skinning 70", etc.)
        RequiredTradeskill: (() => {
          const v = get(iReqTS)
          return v ? v : undefined
        })(),
        TradeskillLevel: (() => {
          const v = get(iTSLevel)
          return /^\d+$/.test(v) ? Number(v) : undefined
        })()
      }
      if (rec.MissionID) out.push(rec)
    }
    return out
  }

  // --- Chargement mapping territoires -> slug (puis libellé via locale) ---
  const [territories, setTerritories] = React.useState<Record<string,string>>({})
  React.useEffect(() => {
    fetch(withBase('/data/territories_map.json'))
      .then(r => r.json())
      .then(setTerritories)
      .catch(()=>setTerritories({}))
  }, [])
 
  // Fallback EN (si locale n’expose pas les clés en anglais)
  const [enLocale, setEnLocale] = React.useState<Record<string,string>>({})
  React.useEffect(() => {
    let cancelled = false
    const tryLoad = async () => {
      const paths = ['/lang/ui/ui-en-us.json','/lang/en-us.json'].map(withBase)
      for (const p of paths) {
        try {
          const r = await fetch(p)
          if (!r.ok) continue
          const j = await r.json()
          if (!cancelled) setEnLocale(j || {})
          return
        } catch {}
      }
    }
    tryLoad()
    return () => { cancelled = true }
  }, [])
 
  // --- POI index (tag -> { name_key, map_icon, territory_id }) ---
  const [poiIndex, setPoiIndex] = React.useState<Record<string, {name_key?:string; map_icon?:string; territory_id?:number; elite?:boolean}>>({})
  React.useEffect(() => {
    fetch(withBase('/data/poi_index.json'))
      .then(r => r.ok ? r.json() : {})
      .then((j) => setPoiIndex(j || {}))
      .catch(() => setPoiIndex({}))
  }, [])

  // Helpers localisation
  const locGet = React.useCallback((key?: string) => {
    if (!key) return ''
    const k = String(key).trim().replace(/^@/,'').toLowerCase()
    const a = (locale && locale[k]) || (locale && locale[String(key).toLowerCase()])
    const b = (enLocale && enLocale[k]) || (enLocale && enLocale[String(key).toLowerCase()])
    return String(a ?? b ?? '')
  }, [locale, enLocale])

  // Resolve POI (nom + icône + URL NWDB) pour une mission
  const resolvePoi = React.useCallback((m: Mission) => {
    const tag = String(m.POITagOverride || '').trim().toLowerCase()
    if (!tag) return { name:'', icon:'', url:'' }
    const rec = poiIndex[tag] || null
    if (!rec) return { name:'', icon:'', url:'' }
    const name = locGet(rec.name_key || '')
    const icon = String(rec.map_icon || '')
    const url  = rec.territory_id ? `https://nwdb.info/db/zone/${rec.territory_id}` : ''
    return { name, icon, url, elite: !!rec.elite }
  }, [poiIndex, locGet])

  // Titre affiché: TitleOverride (locale) avec {POITags} remplacé par nom du POI
  const resolveTitle = React.useCallback((m: Mission) => {
    const rawKey = String(m.TitleOverride || '').trim()
    if (!rawKey) return ''
    let base = locGet(rawKey)
    if (!base) return ''
    if (base.includes('{POITags}')) {
      const poi = resolvePoi(m)
      base = base.replace('{POITags}', poi.name || '')
    }
    return base
  }, [locGet, resolvePoi])

  // --- Rendu description (tokens du convert) ---
  const rarityClass = (r?: string) => {
    const x = String(r||'').toLowerCase()
    return x ? `rarity-${x}` : ''
  }
  const fmtDrop = (v?: any) => {
    if (v === null || v === undefined || v === '') return null
    const num = typeof v === 'number' ? v : parseFloat(String(v))
    if (!isFinite(num)) return null
    // La valeur du CSV est déjà un pourcentage (ex: 100 → "100%")
    // formatage: supprime les zéros inutiles (2.50 -> 2.5)
    const s = Number.isInteger(num) ? String(num) : String(parseFloat(num.toFixed(2)))
    return `${s}%`
  }
  const renderDesc = (tokens?: any[], fallback?: string, descKey?: string, zoneLabel?: string) => {
    if (!tokens || !tokens.length) {
      const txt = (fallback||'').trim()
      return txt ? <p className="task-line">{txt}</p> : null
    }
    const clean = (s:string) =>
      s.replace(/\\n|\n/g,' ').replace(/<\/?font[^>]*>/gi,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()

    // 1) Texte localisé (si possible) depuis la clé DescriptionOverride
    const key = String(descKey||'').trim()
    const baseLoc = key ? locGet(key) : ''
    const pattern = /(\{POITags\}|\{itemName\}|\{enemyName\}|\{targetName\}|\{destinationName\})/g

    // Rendu d’un token “badge” (POI / ITEM / VC)
    const renderBadge = (tk:any, i:number) => {
      if (!tk) return null
      if (tk.type === 'POI') {
        const name = locGet(tk.name_key)
        const url  = tk.territory_id ? `https://nwdb.info/db/zone/${tk.territory_id}` : '#'
        return (
          <a key={`poi${i}`} className={`tag poi-badge${tk.elite ? ' elite' : ''}`}
             href={url} target="_blank" rel="noreferrer" title={name}
             style={{ textDecoration:'none', justifyContent:'center', display:'inline-flex', alignItems:'center', gap:6, color:'#fff', verticalAlign:'middle' }}>
            {tk.icon ? <img className="reward-icon" src={tk.icon} alt="" /> : null}
            <span style={{ color:'#fff' }}>{name}</span>
          </a>
        )
      }
      if (tk.type === 'ITEM') {
        const name = tk.name_key ? locGet(tk.name_key) : (tk.name||tk.id)
        const url = `https://www.nw-buddy.de/items/${encodeURIComponent(tk.id||'')}`
        const drop = fmtDrop(tk.drop)
        const qty = tk.qty ? `${tk.qty}× ` : null
        return (
          <a key={`it${i}`} className={`task-item ${rarityClass(tk.rarity)}`} href={url} target="_blank" rel="noreferrer">
            {qty ? <span className="item-qty">{qty}</span> : null}
            {tk.icon ? <img className="reward-icon" src={tk.icon} alt="" /> : null}
            <span className="task-item__name">{name}</span>
            {drop ? <span className="drop-badge">{drop}</span> : null}
          </a>
        )
      }
      if (tk.type === 'VC') {
        const name = locGet(tk.name_key)
        const url = `https://nwdb.info/db/creature/${encodeURIComponent(tk.vcid||'')}`
        const qty = tk.qty ? `${tk.qty}× ` : null
        return (
          <a key={`vc${i}`} className={`vc-badge ${tk.is_named ? 'vc-named' : ''}`} href={url} target="_blank" rel="noreferrer" title={name}>
            {qty ? <span className="target-qty">{qty}</span> : null}
            <span className="target-name">{name}</span>
            {tk.lvl ? <span className="target-lvl">(Lvl: {tk.lvl})</span> : null}
          </a>
        )
      }
      return null
    }

    // 2) Si on a un texte localisé, on le découpe et on intercale avec les tokens badges
    if (baseLoc) {
      const segs = baseLoc.split(pattern)  // garde les marqueurs
      const parts: React.ReactNode[] = []
      // file d’attente de tokens par type
      const pool = {
        POI:  (tokens || []).filter(t => t?.type === 'POI'),
        ITEM: (tokens || []).filter(t => t?.type === 'ITEM'),
        VC:   (tokens || []).filter(t => t?.type === 'VC'),
      }
      const idx = { POI:0, ITEM:0, VC:0 }
      for (let i=0;i<segs.length;i++){
        const s = segs[i]
        if (i % 2 === 0) {
          const txt = clean(s)
          if (txt) parts.push(<span key={`t${i}`}>{txt}</span>)
        } else {
          // placeholder
          if (s === '{POITags}') {
            const tk = pool.POI[idx.POI++] || null
            if (tk) parts.push(renderBadge(tk, i) as any)
          } else if (s === '{itemName}') {
            const tk = pool.ITEM[idx.ITEM++] || null
            if (tk) parts.push(renderBadge(tk, i) as any)
          } else if (s === '{enemyName}' || s === '{targetName}') {
            const tk = pool.VC[idx.VC++] || null
            if (tk) parts.push(renderBadge(tk, i) as any)
          } else if (s === '{destinationName}') {
            // Remplacer par le nom de la zone (passée par le caller)
            const z = zoneLabel || ''
            if (z) parts.push(<span key={`dest${i}`} className="task-dest">{z}</span>)
          }
        }
        // espace fin léger entre segments si pas déjà présent
        if (i < segs.length - 1) parts.push(<span key={`sp${i}`}> </span>)
      }
      return <p className="task-line">{parts}</p>
    }

    // 3) Fallback : pas de clé/locale → on réutilise les tokens fournis (EN nettoyé côté convert)
    const parts: React.ReactNode[] = []
    tokens.forEach((tk, i) => { parts.push(renderBadge(tk, i) ?? <span key={`t${i}`}>{String(tk.text||'')}</span>); if (i<tokens.length-1) parts.push(<span key={`sp${i}`}> </span>) })
    return <p className="task-line">{parts}</p>
  }

  // === Token renderer pour les lignes de Tasks (identique à Artifacts) ===
  // Tokens supportés :
  //   {{ITEM::icon=...::name=...::drop=...::rarity=...::id=<ItemID>}}
  //   {{POI::icon=...::name=...::tid=<zoneId>}}
  //   {{VC::name=...::qty=...::named=0|1::id=<vcid>}}
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
      const payload = full.slice(2, -2)
      const parts = payload.split('::').slice(1)
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
            <span key={`${m.index}-${full}`} className={`task-item ${raritySlug ? `rarity-${raritySlug}` : ''}`}>{inner}</span>
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
        // VC (creature)
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

  const zoneLabelFromId = React.useCallback((tid: string | number | undefined) => {
    if (tid === undefined || tid === null) return ''
    const key = String(tid)
    const slug = territories[key]
    if (!slug) return ''
    // 1) locale courante (si dispo), 2) fallback en-us.json, 3) slug brut
    const locA = locale ? (locale[slug] || locale[slug.toLowerCase()]) : undefined
    const locB = enLocale ? (enLocale[slug] || enLocale[slug.toLowerCase()]) : undefined
    return String(locA ?? locB ?? slug)
  }, [territories, locale, enLocale])
  
  const zoneSlugFromId = React.useCallback((tid: string | number | undefined) => {
    if (tid === undefined || tid === null) return undefined
    const key = String(tid)
    const slug = territories[key]
    return slug ? String(slug).toLowerCase() : undefined
  }, [territories])

  // --- Filtres (dropdowns) ---
  // Faction sélectionnée (défaut: Syndicate)
  const [selectedFaction, setSelectedFaction] = React.useState<FactionKey | 'ALL'>('Syndicate')
  // Zones disponibles + zone sélectionnée
  const zoneOptions = React.useMemo(() => {
    if (!missions) return [] as string[]
    const set = new Set<string>()
    for (const m of missions) {
      const z = zoneLabelFromId(m.AvailableTerritoryId ?? (m as any)?.AvailableTerritory ?? '')
      if (z) set.add(z)
    }
    return Array.from(set).sort((a,b)=>a.localeCompare(b))
  }, [missions, zoneLabelFromId])
  const [selectedZone, setSelectedZone] = React.useState<string | 'ALL'>('ALL')
  const [selectedLevel, setSelectedLevel] = React.useState<number | 'ALL'>('ALL')
 
  // Map "label localisé" -> "slug" (sert à teinter le point de légende du menu Zone)
  const zoneLabelToSlug = React.useMemo(() => {
    const m = new Map<string,string>()
    try {
      // territories: { "<TerritoryID>": "<slug>" }
      for (const [tid, slug] of Object.entries(territories || {})) {
        const label = zoneLabelFromId(tid)
        if (label && slug) {
          m.set(label, String(slug).toLowerCase())
        }
      }
    } catch {}
    return m
  }, [territories, zoneLabelFromId])

  // --- Regroupement en "familles" (Zone -> Type), puis tri par Faction dans chaque famille ---
  type Fam = { key: string; zone: string; goalType: string; items: Mission[] }
  const families = React.useMemo<Fam[]>(() => {
    if (!missions) return []
    // clé = "<ZoneLabel>||<MissionGoalType>"
    const by: Record<string, { zone: string; goalType: string; items: Mission[] }> = {}
    for (const m of missions) {
      const zLabel = zoneLabelFromId(m.AvailableTerritoryId ?? (m as any)?.AvailableTerritory ?? '')
      const gType  = String(m.MissionGoalType || '').trim()
      const zKey   = zLabel || '(Unknown Zone)'
      const tKey   = gType  || '(Unknown Type)'
      const key    = `${zKey}||${tKey}`
      if (!by[key]) by[key] = { zone: zKey, goalType: tKey, items: [] }
      by[key].items.push(m)
    }
    const fams = Object.entries(by).map(([key, v]) => ({ key, zone: v.zone, goalType: v.goalType, items: v.items }))
    // Tri des familles: d'abord par zone, puis par type
    fams.sort((a, b) => a.zone.localeCompare(b.zone) || a.goalType.localeCompare(b.goalType))
    return fams
  }, [missions, zoneLabelFromId])

  // --- Appliquer filtres ---
  const filteredFamilies = React.useMemo(() => {
    // ordre de factions pour le tri intra-famille
    const facOrder = new Map(ALL_FACTIONS.map((f, i) => [f, i]))
    return families.map(f => {
      const items = f.items
        .filter(m => {
          const fac = String(m.RequiredFaction || '').trim() as FactionKey
          const zl  = zoneLabelFromId(m.AvailableTerritoryId ?? (m as any)?.AvailableTerritory ?? '')
          const facOk  = (selectedFaction === 'ALL') ? true : (fac === selectedFaction)
          const zoneOk = (selectedZone === 'ALL') ? true : (zl === selectedZone)
          // Niveau: on accepte si le niveau choisi est dans [MinLevel, MaxLevel]
          const minL = Number((m as any).MinLevel ?? 0)
          const maxL = Number((m as any).MaxLevel ?? 999)
          const lvlOk = (typeof selectedLevel !== 'number')
            ? true
            : (minL <= selectedLevel && selectedLevel <= maxL)
          return facOk && zoneOk && lvlOk
        })
        // Tri à l'intérieur d'une famille : par Faction
        .sort((a, b) => {
          const ai = facOrder.get(String(a.RequiredFaction || '').trim() as FactionKey) ?? 999
          const bi = facOrder.get(String(b.RequiredFaction || '').trim() as FactionKey) ?? 999
          return ai - bi
        })
      return { ...f, items }
    }).filter(f => f.items.length > 0)
  }, [families, selectedFaction, selectedZone, selectedLevel, zoneLabelFromId])

  const [rfNodes, setRfNodes] = React.useState<Node[]>([])
  const [rfEdges, setRfEdges] = React.useState<Edge[]>([])
  // Buffer des positions modifiées pendant le drag (flush en fin de drag)
  const pendingPosRef = React.useRef<Record<string, {x:number;y:number}>>({})
  const [isDragging, setIsDragging] = React.useState(false)

  React.useEffect(() => {
    const nodes: Node[] = []
    // 1) Colonnes = zones présentes après filtres
    const zoneCols = Array.from(new Set(filteredFamilies.map(f => f.zone)))
      .sort((a,b)=>a.localeCompare(b))
    // 2) Lignes = types présents après filtres (tri selon GOAL_ORDER puis alpha)
    const goalIndex = (g: string) => {
      const i = GOAL_ORDER.indexOf(g); return i >= 0 ? i : 999
    }
    const typeRows = Array.from(new Set(filteredFamilies.map(f => f.goalType)))
      .sort((a,b)=> (goalIndex(a) - goalIndex(b)) || a.localeCompare(b))
    // 3) Accès rapide (zone||type -> missions déjà triées par faction)
    const famMap = new Map<string, Mission[]>()
    for (const fam of filteredFamilies) famMap.set(`${fam.zone}||${fam.goalType}`, fam.items)

    // 4) Groupement par cellule (zone||type) -> par faction
    const cellGroups = new Map<string, Map<string, Mission[]>>()  // key = "zone||type"
    for (const [key, arr] of famMap) {
      const g = new Map<string, Mission[]>()
      for (const m of arr) {
        const fac = String(m.RequiredFaction || '').trim()
        if (!g.has(fac)) g.set(fac, [])
        g.get(fac)!.push(m)
      }
      cellGroups.set(key, g)
    }

    // 5) Largeur dynamique par colonne (zone)
    //    - nb de colonnes par faction dans cette zone = min(10, max quêtes d'un bloc faction dans la zone)
    //    - largeur de la zone = (colonnes par faction) * (max factions présentes dans une cellule de cette zone)
    const zoneColsPerFaction = new Map<string, number>()  // nb colonnes réservées à chaque faction dans la zone
    const zoneMaxFactions    = new Map<string, number>()  // max factions présentes dans une cellule (zone, type)
    const zoneWidths         = new Map<string, number>()  // largeur en pixels
    zoneCols.forEach(zone => {
      let maxCols = 1
      let maxFactions = 1
      typeRows.forEach(gType => {
        const g = cellGroups.get(`${zone}||${gType}`)
        if (!g) return
        let present = 0
        ALL_FACTIONS.forEach(f => {
          const cnt = g.get(f)?.length || 0
          if (cnt > 0) present++
          const cols = Math.min(BLOCK_MAX, cnt)
          if (cols > maxCols) maxCols = cols
        })
        if (present > maxFactions) maxFactions = present
      })
      const colsPerFaction = Math.max(1, maxCols)
      const factionsInCell = Math.max(1, maxFactions)
      zoneColsPerFaction.set(zone, colsPerFaction)
      zoneMaxFactions.set(zone, factionsInCell)
      zoneWidths.set(zone, (colsPerFaction * factionsInCell) * CARD_STEP_X + COL_GAP)
    })
    // baseX cumulée pour chaque zone (colonnes à largeur variable)
    const zoneBaseX = new Map<string, number>()
    {
      let cursorX = 0
      zoneCols.forEach(zone => {
        zoneBaseX.set(zone, cursorX)
        cursorX += zoneWidths.get(zone)!
      })
    }

    // 6) Hauteur dynamique par (zone, type) : on compacte CHAQUE colonne-zone indépendamment
    //    => plus d'espaces "imposés" par d'autres zones.
    const zoneTypeHeight = new Map<string, Map<string, number>>() // px
    zoneCols.forEach(zone => {
      const perType = new Map<string, number>()
      typeRows.forEach(gType => {
        const g = cellGroups.get(`${zone}||${gType}`)
        if (!g) { perType.set(gType, 0); return } // pas de carte => pas d'espace
        const colsPerFaction = zoneColsPerFaction.get(zone)! // wrap selon largeur de bloc dans la zone
        let cellLines = 0
        ALL_FACTIONS.forEach(f => {
          const cnt = g.get(f)?.length || 0
          const lines = Math.ceil(cnt / colsPerFaction)
          if (lines > cellLines) cellLines = lines
        })
        perType.set(gType, cellLines * ROW_H)
      })
      zoneTypeHeight.set(zone, perType)
    })
    // baseY cumulée PAR zone (colonnes indépendantes)
    const zoneTypeBaseY = new Map<string, Map<string, number>>() // Y pour (zone,type)
    zoneCols.forEach(zone => {
      const perTypeY = new Map<string, number>()
      let cursorY = 0
      typeRows.forEach(t => {
        perTypeY.set(t, cursorY)
        cursorY += (zoneTypeHeight.get(zone)?.get(t) ?? 0)
      })
      zoneTypeBaseY.set(zone, perTypeY)
    })

    // 7) Placement : pour chaque ligne (type), zones côte à côte,
    //    et à l'intérieur de chaque cellule (zone,type) -> blocs par faction,
    //    wrap à BLOCK_MAX (ou moins selon zoneColsPerFaction).
    typeRows.forEach((gType) => {
      zoneCols.forEach((zone, colIdx) => {
        const baseY = zoneTypeBaseY.get(zone)?.get(gType) ?? 0
        const baseX = zoneBaseX.get(zone)!            // largeur de colonne dynamique
        const g = cellGroups.get(`${zone}||${gType}`) // groupes par faction dans cette cellule
        if (!g) return
        const colsPerFaction = zoneColsPerFaction.get(zone)! // nb colonnes réservées à CHAQUE faction dans cette zone
        const presentFactions = ALL_FACTIONS.filter(f => (g.get(f)?.length || 0) > 0)
        presentFactions.forEach((facKey, fIdx) => {
          const arr = g.get(facKey) || []
          arr.forEach((m, j) => {
            const col = j % colsPerFaction
            const subRow = Math.floor(j / colsPerFaction)
            const x = baseX + (fIdx * colsPerFaction + col) * CARD_STEP_X
            const y = baseY + subRow * ROW_H
            const id = `fm::${m.MissionID}`
            const zl = zoneLabelFromId(m.AvailableTerritoryId)
            const zslug = zoneSlugFromId(m.AvailableTerritoryId)
            const fac = String(m.RequiredFaction || '').trim()
            const saved = savedPos[id]
            const poi = resolvePoi(m)
            const dispTitle = resolveTitle(m) || String(m.MissionID)
            nodes.push({
              id,
              type: 'faction',
              position: saved ? { x: saved.x, y: saved.y } : { x, y },
              data: {
                id,
                title: dispTitle,
                idLabel: String(m.MissionID),
                zoneLabel: zl,
                zoneSlug: zslug,
                faction: fac,
                goalType: (m as any).MissionGoalType || undefined,
                DescriptionOverride: (m as any).DescriptionOverride || undefined,
                tasks: (m as any).tasks || [],
                MinLevel: (m as any).MinLevel ?? null,
                MaxLevel: (m as any).MaxLevel ?? null,
                RequiredTradeskill: (m as any).RequiredTradeskill ?? undefined,
                TradeskillLevel: (m as any).TradeskillLevel ?? undefined,
                BgImage: (m as any).BgImage || (m as any).ImagePath || undefined,
                poiName: poi.name || undefined,
                poiIcon: poi.icon || undefined,
                poiUrl:  poi.url  || undefined,
                poiElite: poi.elite || undefined,
                RecommendedGroupSize: (m as any).RecommendedGroupSize,
                descText: (m as any).desc_text || '',
                descTokens: (m as any).desc_tokens || [],
                rewards: (m as any).rewards || undefined,
                renderDesc,
                done: isCompleted(id),
                onToggle: () => toggleQuest(id),
              },
              style: { padding: 0, background: 'transparent', border: 'none' },
              dragHandle: '.node-card',
            } as any)
          })
        })
      })
    })
    setRfEdges([])
    setRfNodes(nodes)
  }, [filteredFamilies, savedPos, completedVersion, isCompleted, toggleQuest, zoneLabelFromId, zoneSlugFromId, resolvePoi, resolveTitle])

  // --- Drag/persist positions  multi-sélection (rectangle au clic droit, comme Graph) ---
  const reactFlow = useReactFlow()
  const [lockNodes, setLockNodes] = React.useState(false)
  const [marquee, setMarquee] = React.useState<null | { start:{x:number;y:number}, end:{x:number;y:number} }>(null)
  const startPt = React.useRef<{x:number;y:number} | null>(null)
  const preventCtx = React.useRef(false)

  // Empêche le menu contextuel pendant la sélection au clic droit
  const onGlobalContextMenu = React.useCallback((ev: MouseEvent) => {
    if (preventCtx.current) {
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, [])

  // Styles communs aux dropdowns (copie du look Artifacts)
  const filterWrapStyle: React.CSSProperties = {
    position:'absolute', top:68, left:12, zIndex:40,
    display:'flex', gap:8, alignItems:'center', flexWrap:'wrap',
    background:'#0b1220', border:'1px solid #1e293b', borderRadius:8, padding:'8px 10px', boxShadow:'0 6px 16px rgba(0,0,0,.35)'
  }
  const selectStyle: React.CSSProperties = {
    background:'#0f172a', color:'#e2e8f0', border:'1px solid #334155',
    borderRadius:6, padding:'6px 8px', fontSize:12
  }
  const labelStyle: React.CSSProperties = { fontSize:12, color:'#cbd5e1', marginRight:6 }
  
  // Couleurs de l’élément sélectionné (dot à côté du select)
  const selectedZoneColor = React.useMemo(() => {
    if (selectedZone === 'ALL') return '#334155'
    // retrouver le slug de la zone sélectionnée pour prendre la couleur
    // on parcourt une mission pour lier label -> slug (simple et rapide)
    let slug: string | undefined
    if (missions && missions.length) {
      for (const m of missions) {
        const label = zoneLabelFromId(m.AvailableTerritoryId)
        if (label === selectedZone) { slug = zoneSlugFromId(m.AvailableTerritoryId); break }
      }
    }
    return slug ? (TERR_COLORS[slug] || '#334155') : '#334155'
  }, [selectedZone, missions, zoneLabelFromId, zoneSlugFromId])
  const selectedFactionColor = React.useMemo(() => {
    return selectedFaction === 'ALL' ? '#334155' : (FAC_COLORS[selectedFaction] || '#334155')
  }, [selectedFaction])

  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    if (lockNodes) {
      const nonMove = changes.filter(ch => ch.type !== 'position' && ch.type !== 'dimensions')
      if (!nonMove.length) return
      setRfNodes(nds => applyNodeChanges(nonMove, nds))
      return
    }
    setRfNodes(nds => applyNodeChanges(changes, nds))
    // Bufferise les positions (pas d'I/O à chaque pixel)
    changes.forEach(ch => {
      if (ch.type === 'position' && 'position' in ch && ch.position) {
        pendingPosRef.current[ch.id] = { x: ch.position.x, y: ch.position.y }
      }
    })
  }, [lockNodes, setManyNodePos])

  // Début/fin de drag : pause minimap + flush des positions persistées
  const onNodeDragStart = React.useCallback(() => {
    setIsDragging(true)
  }, [])
  const onNodeDragStop = React.useCallback(() => {
    setIsDragging(false)
    const batch = pendingPosRef.current
    pendingPosRef.current = {}
    if (batch && Object.keys(batch).length) {
      try { (setManyNodePos as any)?.('factions', batch) } catch {}
    }
  }, [setManyNodePos])


  // rAF throttle pour éviter de recalculer à chaque pixel
  const rafRef = React.useRef<number | null>(null)
  const updateSelectionFromRect = React.useCallback((rect:{x1:number;y1:number;x2:number;y2:number}) => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const x = Math.min(rect.x1, rect.x2)
      const y = Math.min(rect.y1, rect.y2)
      const width  = Math.abs(rect.x2 - rect.x1)
      const height = Math.abs(rect.y2 - rect.y1)
      const hits = reactFlow.getIntersectingNodes({ x, y, width, height })
      const hitIds = new Set(hits.map(h => h.id))
      setRfNodes(prev => prev.map(n => (hitIds.has(n.id) ? { ...n, selected: true } : (n.selected ? { ...n, selected:false } : n))))
    })
  }, [reactFlow])
 
  // --- Revenir au début : centre sur la carte la plus "haut-gauche" (comme Graph.tsx) ---
  const backToStart = React.useCallback(() => {
    const nodes = reactFlow.getNodes()
    if (!nodes || !nodes.length) return
    let best = nodes[0]
    for (const n of nodes) {
      const by = n.positionAbsolute?.y ?? n.position?.y ?? 0
      const bx = n.positionAbsolute?.x ?? n.position?.x ?? 0
      const cy = best.positionAbsolute?.y ?? best.position?.y ?? 0
      const cx = best.positionAbsolute?.x ?? best.position?.x ?? 0
      if (by < cy || (by === cy && bx < cx)) best = n
    }
    const w = best.width ?? 200
    const h = best.height ?? 120
    const cx = (best.positionAbsolute?.x ?? best.position?.x ?? 0) + (w / 2)
    const cy = (best.positionAbsolute?.y ?? best.position?.y ?? 0) + (h / 2)
    reactFlow.setCenter(cx, cy, { zoom: 1, duration: 400 })
  }, [reactFlow])

  // Revient automatiquement au début quand on change de langue / filtres
  React.useEffect(() => {
    if (!rfNodes.length) return
    // petit délai pour laisser RF mesurer width/height
    const id = window.setTimeout(() => backToStart(), 0)
    return () => window.clearTimeout(id)
  }, [selectedFaction, selectedZone, lang, rfNodes.length, backToStart])



  // Sélection rectangulaire au **clic droit maintenu** (comme Artifacts)
  const onPaneMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 2) return
    e.preventDefault()
    preventCtx.current = true
    const start = { x: e.clientX, y: e.clientY }
    startPt.current = start
    setMarquee({ start, end: start })
    // bloque le menu contextuel tant que la sélection est active
    window.addEventListener('contextmenu', onGlobalContextMenu, true)
    const onMove = (ev: MouseEvent) => {
      const end = { x: ev.clientX, y: ev.clientY }
      setMarquee(m => (m ? { ...m, end } : m))
      const p1 = reactFlow.screenToFlowPosition(start)
      const p2 = reactFlow.screenToFlowPosition(end)
      updateSelectionFromRect({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y })
    }
    const onUp = () => {
      startPt.current = null
      setMarquee(null)
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTimeout(() => {
        preventCtx.current = false
        window.removeEventListener('contextmenu', onGlobalContextMenu, true)
      }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const [showResetPosConfirm, setShowResetPosConfirm] = React.useState(false)
  // --- Sidebar locale (même logique que Artifacts) ---
  const SIDEBAR_KEY = 'sidebarCollapsed_factions_v1'
  const [helpCollapsed, setHelpCollapsed] = React.useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1' } catch { return false }
  })
  React.useEffect(() => {
    const cls = 'sidebar-collapsed'
    const root = document.documentElement
    if (helpCollapsed) root.classList.add(cls)
    else root.classList.remove(cls)
    try { localStorage.setItem(SIDEBAR_KEY, helpCollapsed ? '1' : '0') } catch {}
  }, [helpCollapsed])

  return (
    <>
    <div className="graph factions-tab">
      {/* Masquer tout progress panel/dock global */}
      <style>{`.factions-tab .progress-panel,.factions-tab .progress-dock{display:none!important}`}</style>
      {/* Barre filtres (dropdowns comme Artifacts) + actions */}

      <div style={filterWrapStyle}>
        <div className="filters-modern">
          {/* Faction */}
          <div className="filter-group">
            <div className="filter-label">
              <span className="legend-dot" style={{ background: FAC_COLORS[selectedFaction as string] || '#64748b' }} />
              {t('ui.factions.filters.faction','Faction:')}
            </div>
            <select
              className="filter-select"
              value={selectedFaction}
              onChange={e => setSelectedFaction(e.target.value as any)}
            >
              <option value="ALL">{t('ui.factions.filters.any','Any')}</option>
              {ALL_FACTIONS.map(f => (
                <option
                  key={f}
                  value={f}
                  // Astuce : sur Chrome/Edge, ces styles passent souvent dans <option>, ailleurs non.
                  style={{ background: FAC_COLORS[f] || undefined, color: FAC_COLORS[f] ? '#0b1020' : undefined }}
                >
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-sep" />

          {/* Zone */}
          <div className="filter-group">
            <div className="filter-label">
              <span
                className="legend-dot"
                style={{
                  background: (() => {
                    const slug = selectedZone === 'ALL' ? '' : (zoneLabelToSlug.get(selectedZone) || '')
                    return TERR_COLORS[slug] || '#64748b'
                  })()
                }}
              />
              {t('ui.factions.filters.zone','Zones:')}
            </div>
            <select
              className="filter-select"
              value={selectedZone}
              onChange={e => setSelectedZone(e.target.value)}
            >
              <option value="ALL">{t('ui.factions.filters.any','Any')}</option>
              {zoneOptions.map(z => {
                const slug = zoneLabelToSlug.get(z) || ''
                return (
                  <option
                    key={z}
                    value={z}
                    style={{ background: TERR_COLORS[slug] || undefined, color: TERR_COLORS[slug] ? '#0b1020' : undefined }}
                  >
                    {z}
                  </option>
                )
              })}
            </select>
          </div>

          <div className="filter-sep" />

          {/* Level */}
          <div className="filter-group">
            <div className="filter-label">{t('ui.factions.filters.level','Level:')}</div>
            <select
              className="filter-select filter-select--level"
              value={selectedLevel as any}
              onChange={e => {
                const v = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)
                setSelectedLevel(v as any)
              }}
            >
              <option value="ALL">{t('ui.factions.filters.any','Any')}</option>
              {Array.from({ length: 70 }, (_, i) => 70 - i).map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {/* React Flow */}
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        onlyRenderVisibleElements
        nodesConnectable={false}
        connectOnClick={false}
        elementsSelectable
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onMouseDown={onPaneMouseDown}
        onContextMenu={(e)=>{ if (preventCtx.current) e.preventDefault() }}
        zoomOnScroll
        zoomOnPinch
        panOnDrag
        nodesDraggable={!lockNodes}
        nodeDragThreshold={3}
        minZoom={0.03}
        maxZoom={3}
      >
        {!isDragging && (
        <MiniMap
          className="minimap--white-viewport"
          position="bottom-right"
          style={{ backgroundColor: '#0b0f14', right: 0, bottom: 0 }}
          maskColor="rgba(0,0,0,0.15)"
          nodeColor={(n) => {
            const d = (n?.data as any) || {}
            // Par défaut: couleur de la ZONE
            if (selectedZone === 'ALL') {
              const slug = d.zoneSlug as (string | undefined)
              const c = slug ? TERR_COLORS[slug] : undefined
              return c || '#64748b'
            }
            // Si une zone est filtrée: couleur du TYPE de mission
            const gt = d.goalType as (string | undefined)
            const c = gt ? GOAL_COLORS[gt] : undefined
            return c || '#64748b'
          }}
          nodeStrokeColor="#e2e8f0"
          nodeBorderRadius={2}
        />)}
        <Controls showInteractive={false} position="bottom-left" style={{ bottom: 20 }}>
          <ControlButton
            className={`rf-lock-btn ${lockNodes ? 'locked' : 'unlocked'}`}
            onClick={() => setLockNodes(v => !v)}
            title={lockNodes ? t('ui.controls.unlock','Unlock node dragging') : t('ui.controls.lock','Lock node dragging')}
          >
            {lockNodes ? '🔒' : '🔓'}
          </ControlButton>
          {/* Back to start: même bouton/placement que dans Graph.tsx */}
          <ControlButton
            onClick={backToStart}
            title={t('ui.controls.back','Back to start')}
            aria-label={t('ui.controls.back','Back to start')}
          >
            ↖️
          </ControlButton>
        </Controls>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      </ReactFlow>
 
      {/* --- Probabilités par type (en bas à droite) --- */}
      {(() => {
        const ready = selectedFaction !== 'ALL' && selectedZone !== 'ALL' && selectedLevel !== 'ALL'
        // Calcule les stats quand les 3 filtres sont choisis
        let rows: { type: string; count: number; pct: number }[] = []
        let total = 0
        let eliteCount = 0
        let expoCount  = 0
        if (ready && Array.isArray(missions) && missions.length) {
          const block = new Set(['craft','espionage','control','intercept']) // ignore "Craft" et PvP
          const counts = new Map<string, number>()
          for (const m of missions) {
            const fac = String(m.RequiredFaction || '').trim()
            const zl  = zoneLabelFromId(m.AvailableTerritoryId ?? (m as any)?.AvailableTerritory ?? '')
            const minL = Number((m as any).MinLevel ?? 0)
            const maxL = Number((m as any).MaxLevel ?? 999)
            const levelOk = (typeof selectedLevel !== 'number')
              ? true
              : (minL <= selectedLevel && selectedLevel <= maxL)
            const type = String(m.MissionGoalType || '').trim()
            if (!type) continue
            const key = type.toLowerCase()
            if (block.has(key)) continue
            if (fac !== selectedFaction) continue
            if (zl !== selectedZone) continue
            if (!levelOk) continue
            counts.set(type, (counts.get(type) || 0) + 1)
            total++

            // --- Extra: flags Expédition & Elite via poiIndex ---
            const tag = String((m as any).POITagOverride || '').trim().toLowerCase()
            const prec = poiIndex[tag] || null
            if (prec) {
              const iconStr = String(prec.map_icon || '')
              const isExpo  = /expedition|dungeon/i.test(`${iconStr} ${tag} ${String(prec.name_key||'')}`)
              if (isExpo) expoCount++
              if (prec.elite) eliteCount++
            }
          }
          if (total > 0) {
            rows = Array.from(counts.entries())
              .map(([type, count]) => ({ type, count, pct: Math.round((count * 1000) / total) / 10 }))
              // ordre “logique” (GOAL_ORDER), puis alpha
              .sort((a, b) => {
                const ia = GOAL_ORDER.indexOf(a.type); const ib = GOAL_ORDER.indexOf(b.type)
                const oa = ia < 0 ? 999 : ia; const ob = ib < 0 ? 999 : ib
                return oa - ob || a.type.localeCompare(b.type)
              })
          }
        }
        return (
          <div className="prob-panel" aria-live="polite">
            <div className="prob-title">{t('ui.factions.prob.title','Probabilities')}</div>
            {!ready ? (
              <div className="prob-empty">{t('ui.factions.prob.selectAll','Choose Faction + Zone + Level to see the probabilities')}</div>
            ) : rows.length === 0 ? (
              <div className="prob-empty">{t('ui.factions.prob.none','No matching missions')}</div>
            ) : (
              <ul className="prob-list">
                {rows.map(r => (
                  <li key={r.type} className="prob-row">
                    <div className="prob-left">
                      <span className="prob-dot" style={{ background: (GOAL_COLORS[r.type] || '#64748b') }} />
                      <span className="prob-type">{r.type}</span>
                    </div>
                    <div className="prob-right">
                      <span className="prob-pct">{r.pct}%</span>
                      <span className="prob-count">({r.count})</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* Sous-section : Expédition / Elite */}
            {ready && total > 0 ? (
              <div className="prob-extra">
                <div className="prob-extra-row">
                  <div className="prob-left">
                    <span className="prob-dot" style={{ background: '#fbff00ff' }} />
                    <span className="prob-type">{t('ui.factions.prob.expedition','Expedition')}</span>
                  </div>
                  <div className="prob-right">
                    <span className="prob-pct">{Math.round((expoCount * 1000) / total) / 10}%</span>
                    <span className="prob-count">({expoCount})</span>
                  </div>
                </div>
                <div className="prob-extra-row">
                  <div className="prob-left">
                    <span className="prob-dot" style={{ background: '#ff0000ff' }} />
                    <span className="prob-type">{t('ui.factions.prob.elite','Elite')}</span>
                  </div>
                  <div className="prob-right">
                    <span className="prob-pct">{Math.round((eliteCount * 1000) / total) / 10}%</span>
                    <span className="prob-count">({eliteCount})</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )
      })()}

      {/* Rectangle de sélection (marquee) */}
      {marquee && (
        <div
          style={{
            position:'fixed', zIndex:11,
            left: Math.min(marquee.start.x, marquee.end.x),
            top: Math.min(marquee.start.y, marquee.end.y),
            width: Math.abs(marquee.end.x - marquee.start.x),
            height: Math.abs(marquee.end.y - marquee.start.y),
            border: '1px dashed #f59e0b',
            background: 'rgba(245,158,11,0.12)',
            pointerEvents:'none',
          }}
        />
      )}
      {/* Reset (à droite de la minimap) */}
      <div style={{ position:'absolute', right:645, bottom:35, zIndex:7 }}>
        <button
          className="btn-reset-graph btn-reset-graph--art"
          onClick={() => setShowResetPosConfirm(true)}
          title={t('ui.controls.reset','Reset positions')}
        >
          <span className="icon">↺</span>
          {t('ui.controls.reset','Reset positions')}
        </button>
      </div>

      {/* Modal confirmation Reset */}
      {showResetPosConfirm && (
        <div
          onClick={() => setShowResetPosConfirm(false)}
          style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.6)',
            display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000
          }}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{ background:'#0f172a', color:'#fff', border:'1px solid #334155',
                     borderRadius:8, padding:16, minWidth:360, boxShadow:'0 10px 30px rgba(0,0,0,0.45)' }}
          >
            <h3 style={{ marginTop:0, marginBottom:8 }}>{t('ui.controls.reset','Reset positions')}</h3>
            <p style={{ margin:0 }}>{t('ui.confirm.reset.factions','Reset faction positions? This removes all your manual moves.')}</p>
            <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
              <button
                onClick={() => {
                  try { (resetLayoutPos as any)?.('factions') } catch {}
                  setShowResetPosConfirm(false)
                }}
              >{t('ui.confirm','Confirm')}</button>
              <button onClick={() => setShowResetPosConfirm(false)}>{t('ui.cancel','Cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* États de chargement / erreur */}
      {!missions && !loadErr && (
        <div className="center"><div className="muted">{t('ui.factions.loading','Loading faction missions…')}</div></div>
      )}
      {loadErr && (
        <div className="center"><div className="error">{loadErr}</div></div>
      )}
    </div>

    {/* --- Bouton et Sidebar d’aide (même UX que Artifacts) --- */}
    <button
      className="sidebar-handle"
      onClick={() => setHelpCollapsed(v => !v)}
      title={helpCollapsed ? t('ui.help.open','Open help panel') : t('ui.help.hide','Hide help panel')}
      aria-expanded={!helpCollapsed}
    >
      {helpCollapsed ? `< ${t('ui.help','Help')}` : '>'}
    </button>
    <aside className="sidebar" aria-hidden={helpCollapsed}>
      <h3 className="sidebar-title">{t('ui.factions.help.title','How to use (Factions)')}</h3>
      <ul className="howto-list">
        <li>{t('ui.artifacts.help.tipMove','You can drag the canvas to pan (with mouse click)')}</li>
        <li>{t('ui.help.artifacts.reorder','Drag cards to rearrange them (disabled when “Lock” 🔒 is on).')}</li>
        <li>{t('ui.help.artifacts.multiselect','Hold right-click to select multiple cards and move them together.')}</li>
        <li>{t('ui.factions.help.tipSearch','Use the searchbar to navigate to a mission, by name or ID.')}</li>
        <li>{t('ui.factions.help.tipLinks','You can click on mission items/mobs/zones to go to their related nw-buddy/nwdb pages.')}</li>
        <li>{t('ui.factions.help.tasks','Open “Tasks (x)” under the description to see mission steps with the same badge system.')}</li>
        <li>{t('ui.factions.help.border','Cards may have a yellow border for Expeditions and Red for Elite.')}</li>
        <li>{t('ui.factions.help.prob','Bottom-right panel shows probabilities by mission type (needs Faction + Zone + Level) + Expedition & Elite rates.')}</li>
      </ul>
    </aside>
    </>
  )
}

export default function Factions(props: { lang: string }) {
  // Wrap the inner component with ReactFlowProvider so hooks like useReactFlow() work.
  return (
    <ReactFlowProvider>
      <FactionsInner {...props} />
    </ReactFlowProvider>
  )
}
