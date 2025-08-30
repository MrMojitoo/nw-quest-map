import React from 'react'
import useStore from '../store'
import { BadgeCheck, Sword, ScrollText, Map } from 'lucide-react'
import { Handle, Position } from 'reactflow'
import { getZoneByIdPrefix } from '../utils/zones'


// Helpers to render nested key/values from ObjectiveTasks rows
function renderEntries(obj: any, depth = 0): JSX.Element {
  if (obj === null || obj === undefined) return <em className="muted">—</em>
  if (Array.isArray(obj)) {
    if (obj.length === 0) return <span>[]</span>
    return (
      <div className="kv-array">
        {obj.map((item, i) => (
          <div key={i} className="nested">
            {renderEntries(item, depth + 1)}
          </div>
        ))}
      </div>
    )
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj).filter(
      ([, v]) => v !== null && v !== undefined && String(v) !== ''
    )
    if (entries.length === 0) return <span>{'{}'}</span>
    return (
      <div className="kv-grid">
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <div className="kv-key">{k}</div>
            <div className="kv-val">{renderEntries(v, depth + 1)}</div>
          </React.Fragment>
        ))}
      </div>
    )
  }
  return <span>{String(obj)}</span>
}




function Icon({
  base,
  alt = '',
  className = 'reward-icon',
}: {
  base: string
  alt?: string
  className?: string
}) {
  const [src, setSrc] = React.useState<string>(`/icons/${base}.webp`)
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => {
        // si le .webp échoue, on tente le .png
        if (src.endsWith('.webp')) {
          setSrc(`/icons/${base}.png`)
        } else {
          // dernier recours : masquer l’icône cassée
          e.currentTarget.style.display = 'none'
        }
      }}
    />
  )
}



// Noms de bases des fichiers d’icônes
const REWARD_ICON_BASE = {
  xp: 'reward_xp',
  coin: 'reward_coin',
  factionInfluence: 'faction-influence',
  factionReputation: 'faction-reputaiton',
  factionTokens: 'faction-tokens',
  azoth: 'reward_azoth',
  standing: 'reward_territorystanding',
  item: 'reward_coin', 
}

// Séparateur de milliers
const fmt = (n?: number | string) =>
  (typeof n === 'number' ? n : Number(n ?? 0)).toLocaleString()

// Parse tokens:
//   {{ITEM::icon=...::name=...::drop=...::rarity=...}}
//   {{POI::icon=...::name=...::tid=12345}}
const TOKEN_RE = /\{\{(ITEM|POI)(?:::[^}]*)\}\}/g;
function renderTaskText(text: string) {
  if (!text) return null;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(text))) {
    const full = m[0];
    const kind = m[1]; // "ITEM" | "POI"
    // Exemple de payload : "ITEM::icon=...::name=...::drop=...::rarity=Rare"
    const payload = full.slice(2, -2); // enlever {{ }}
    const parts = payload.split("::").slice(1); // enlever "ITEM"/"POI"
    const kv: Record<string, string> = {};
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq > -1) kv[p.slice(0, eq)] = p.slice(eq + 1);
    }
    const icon = kv.icon || "";
    const name = kv.name || "";
    const drop = kv.drop || "";
    const raritySlug = (kv.rarity || "").toLowerCase().replace(/\s+/g, "-");
    const tid = kv.tid || "";
    // push plain text before the token
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    // push token as JSX
    if (kind === 'ITEM') {
      nodes.push(
        <span
          className={`task-item ${raritySlug ? `rarity-${raritySlug}` : ""}`}
          key={`${m.index}-${full}`}
        >
          {icon ? <img className="reward-icon" src={icon} alt="" /> : null}
          <span className="task-item__name">{name || "Item"}</span>
          {drop ? <span className="drop-badge">{drop}</span> : null}
        </span>
      );
    } else {
      // POI badge cliquable -> lien NWDB
      const href = tid ? `https://nwdb.info/db/zone/${tid}` : undefined;
      const inner = (
        <>
          {icon ? <img className="reward-icon" src={icon} alt="" /> : null}
          <span className="task-item__name">{name || "POI"}</span>
        </>
      );
      nodes.push(
        href ? (
          <a
            key={`${m.index}-${full}`}
            className="task-item poi-badge"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onMouseDown={(e)=>e.stopPropagation()}
          >
            {inner}
          </a>
        ) : (
          <span key={`${m.index}-${full}`} className="task-item poi-badge">
            {inner}
          </span>
        )
      );
    }
    last = TOKEN_RE.lastIndex;
  }
  // push trailing text
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}


export default function NodeCard({ data }: { data: any }) {
  const [copied, setCopied] = React.useState(false)
  const toggle = useStore(s => s.toggleQuest)
  const active = useStore(s => s.characters.find(c => c.id === s.activeId))
  const isCompleted = !!active?.completed?.[data.id]
  const zone = getZoneByIdPrefix(data.id)
  const isRepeatable = Boolean(data?.repeatable)
  const isMainStory = String(data?.type || '').trim().toLowerCase() === 'main story quest'
  
  const normType = String(data.type || '')
    .replace(/\s+/g, ' ')
    .trim()

  const iconMap: Record<string, string> = {
    'Event': '/icons/icon_event_npc_2.png',
    'Faction Story Covenant': '/icons/icon_factionstory_covenant_quest.png',
    'Faction Story Marauders': '/icons/icon_factionstory_marauders_quest.png',
    'Faction Story Syndicate': '/icons/icon_factionstory_syndicate_quest.png',
    'Mount Race': '/icons/icon_mountrace_quest.png',
    'Mount Unlock': '/icons/icon_mountunlock_quest.png',
    'Objective': '/icons/icon_objective_quest.png',
    'Journey': '/icons/icon_objective_quest.png',
    'Main Story Quest': '/icons/icon_objectivemainstory_quest.png',
    'Skill Progression': '/icons/icon_objectiveprogression_quest.png',
    'Season Quest': '/icons/icon_objectiveseasons_quest.png',
    'Artifact': '/icons/icon_artifact_quest.png',
    // 'Town Project': '/icons/icon_objective_townproject.png',
  }
  const iconSrc = iconMap[normType]

  return (
    <div
      className={
        'node-card' +
        (isCompleted ? ' completed' : '') +
        (isRepeatable ? ' repeatable' : '') +
        (isMainStory ? ' mainstory' : '')
      }
    >
      {/* Handles pour connexions (gauche = target, droite = source) */}
      <Handle type="target" id="l" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="r" position={Position.Right} style={{ opacity: 0 }} />
      <div className="zone" style={{ background: zone.color }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {iconSrc && (
          <img src={iconSrc} alt={normType} className="q-icon" />
        )}
        <div className="title">{data.title || data.id}</div>
      </div>
      {/* ID cliquable : copie l'identifiant en un clic */}
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        ID :{' '}
        <code
          className={`copy-id${copied ? ' copied' : ''}`}
          title="Click to copy ID"
          onMouseDown={(e) => e.stopPropagation()} // évite le pan/drag
          onClick={async (e) => {
            e.stopPropagation()
            const text = String(data.id)
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text)
              } else {
                // Fallback pour anciens navigateurs
                const ta = document.createElement('textarea')
                ta.value = text
                ta.setAttribute('readonly', '')
                ta.style.position = 'fixed'
                ta.style.opacity = '0'
                document.body.appendChild(ta)
                ta.select()
                document.execCommand('copy')
                document.body.removeChild(ta)
              }
              setCopied(true)
              window.setTimeout(() => setCopied(false), 900)
            } catch {
              // silencieux ; on peut logger si besoin
            }
          }}
        >
          {data.id}
        </code>
      </div>
      <div className="meta">
        {normType && <span className="tag"><ScrollText size={14}/> {normType}</span>}
        {isRepeatable && <span className="tag" style={{ borderColor:'#facc15', color:'#facc15' }}>Repeatable</span>}
        {data.required_level != null && <span className="tag"><BadgeCheck size={14}/> Req {data.required_level}</span>}
        {data.recommended_level != null && <span className="tag"><Sword size={14}/> Reco {data.recommended_level}</span>}
        <span className="tag"><Map size={14}/> {zone.name}</span>
      </div>
      {data.description && (
        <p className="desc muted" style={{ fontSize:12, marginTop:6 }}>
          {String(data.description)}
        </p>
      )}
      {/* Récompenses détaillées */}
      {(() => {
        // Les clés supposées issues du convert: adapte si nécessaire
        const xp = (data as any)?.experience_reward ?? (data as any)?.universal_exp_amount ?? 0
        const coin = (data as any)?.currency_reward ?? 0
        const factionInfluence = (data as any)?.faction_influence ?? 0
        const factionReputation = (data as any)?.faction_reputation ?? 0
        const factionTokens = (data as any)?.faction_tokens ?? 0
        const azoth = (data as any)?.azoth_reward ?? 0
        const standing = (data as any)?.territory_standing ?? 0
        const itemId = (data as any)?.item_reward ?? (data as any)?.item_reward_name ?? ''
        const itemQty = (data as any)?.item_reward_qty ?? 0
        const itemNameId = (data as any)?.item_reward_name ?? ''
        const itemResolved = (data as any)?.item_reward_resolved_name ?? ''
        const itemIcon = (data as any)?.item_reward_icon ?? ''
        const itemRarityRaw = String((data as any)?.item_reward_rarity || '').trim()
        const raritySlug = itemRarityRaw
          ? itemRarityRaw.toLowerCase().replace(/\s+/g, '-')
          : ''

        const hasAny =
          (xp && xp > 0) ||
          (coin && coin > 0) ||
          (azoth && azoth > 0) ||
          (standing && standing > 0) ||
          itemId || itemNameId

        if (!hasAny) return null

        return (
          <div className="rewards">
            {xp > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.xp} />
                <b>{fmt(xp)}</b> XP
              </span>
            )}
            {coin > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.coin} />
                <b>{fmt(coin)}</b> Coin
              </span>
            )}
            {factionInfluence > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.factionInfluence} />
                <b>{fmt(factionInfluence)}</b> Faction&nbsp;Influence
              </span>
            )}
            {factionReputation > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.factionReputation} />
                <b>{fmt(factionReputation)}</b> Faction&nbsp;Reputation
              </span>
            )}
            {factionTokens > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.factionTokens} />
                <b>{fmt(factionTokens)}</b> Faction&nbsp;Tokens
              </span>
            )}
            {azoth > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.azoth} />
                <b>{fmt(azoth)}</b> Azoth
              </span>
            )}
            {standing > 0 && (
              <span className="reward">
                <Icon base={REWARD_ICON_BASE.standing} />
                <b>{fmt(standing)}</b> Territory&nbsp;Standing
              </span>
            )}
            {(itemId || itemNameId || itemResolved) && (
              <span className={`reward item-reward ${raritySlug ? `rarity-${raritySlug}` : ''}`}>
                {itemIcon ? (
                  <img src={itemIcon} alt="" className="reward-icon" />
                ) : (
                  <Icon base={REWARD_ICON_BASE.item} />
                )}
                {itemQty ? <b>{fmt(itemQty)}×</b> : null}
                <span className="item-reward__name">
                  {String(itemResolved || itemNameId || itemId)}
                </span>
              </span>
            )}
          </div>
        )
      })()}
      
      {/* ----- Tasks (résolues via en-us.json si dispo, sinon tags) ----- */}
      {(() => {
        const texts: string[] =
          (Array.isArray((data as any)?.task_desc_texts) && (data as any).task_desc_texts.length
            ? (data as any).task_desc_texts
            : (Array.isArray((data as any)?.task_desc_tags) ? (data as any).task_desc_tags : [])) as string[]
        if (!texts || texts.length === 0) return null

        return (
          <div className="tasks-raw" style={{ marginTop: 8 }}>
            <details>
              <summary
                style={{
                  cursor: 'pointer',
                  userSelect: 'none',
                  fontWeight: 600,
                  fontSize: 13,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Tasks ({texts.length})
              </summary>
              {/* Liste avec tirets et rendu compact/centré des éléments */}
              <ul className="tasks-ul">
                {texts.map((s, i) => (
                  <li key={i} className="task-li">
                    <span className="task-line">{renderTaskText(s)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )
      })()}


      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button onClick={() => toggle(data.id)}>{isCompleted ? 'Marquer non fait' : 'Marquer fini'}</button>
      </div>
    </div>
  )
}
