import React from 'react'
import useStore from '../store'
import { BadgeCheck, Sword, ScrollText, Map, Gift } from 'lucide-react'
import { Handle, Position } from 'reactflow'
import { getZoneByIdPrefix } from '../utils/zones'

export default function NodeCard({ data }: { data: any }) {
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
      {/* Ligne debug : afficher l'ID de la quête */}
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>ID : {data.id}</div>
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
      {data.rewards && data.rewards.length > 0 && (
        <div className="meta" style={{ marginTop: 6 }}>
          <span className="tag"><Gift size={14}/> {data.rewards.slice(0,2).join(' · ')}</span>
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button onClick={() => toggle(data.id)}>{isCompleted ? 'Marquer non fait' : 'Marquer fini'}</button>
      </div>
    </div>
  )
}
