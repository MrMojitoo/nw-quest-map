import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import useStore from '../store'
import { LocaleContext } from '../App'

type Quest = {
  id: string
  type?: string
  tags?: string[]
}

const BASE = import.meta.env.BASE_URL
// Helper de préfixe sûr (même logique que dans Graph/NodeCard)
const withBase = (p: string) =>
  (BASE + String(p || '').replace(/^\//, ''))
    .replace(/([^:]\/)\/+/g, '$1')

// ---- Order / icons for types (edit TYPE_ORDER to change display order) ----
const TYPE_ORDER = [
  'Main Story Quest',
  'Level',
  'Objective',
  'Journey',
  'Skill Progression',
  'Season Quest',
  'Faction Story',
  'Mount Unlock',
  'Mount Race',
  'Event',
  'Other',
]
const typeWeight = (t: string) => {
  const i = TYPE_ORDER.indexOf(t)
  return i === -1 ? 999 : i
}
// Icônes (dans /public/icons). Change les noms de fichiers si besoin.
const TYPE_ICON_PATHS: Record<string, string> = {
  'Main Story Quest': withBase('/icons/icon_objectivemainstory_quest.png'),
  Journey: withBase('/icons/icon_objective_quest.png'),
  'Skill Progression': withBase('/icons/icon_objectiveprogression_quest.png'),
  'Season Quest': withBase('/icons/icon_objectiveseasons_quest.png'),
  'Faction Story': withBase('/icons/icon_factionstory_covenant_quest.png'),
  'Mount Unlock': withBase('/icons/icon_mountunlock_quest.png'),
  'Mount Race': withBase('/icons/icon_mountrace_quest.png'),
  Event: withBase('/icons/icon_event_npc_2.png'),
}

const normalizeType = (t?: string) => {
  if (!t) return 'Other'
  if (t.startsWith('Faction Story')) return 'Faction Story'
  return t
}

export default function Sidebar({ lang = 'en-us' }: { lang?: string }) {
  const { t } = React.useContext(LocaleContext)
  const { characters, activeId } = useStore()
  const resetProgress = useStore((s:any) => s.resetProgress)
  const active = characters.find((c) => c.id === activeId)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // set uniquement des IDs marqués "true" (évite de compter ceux mis à false)
  const completedIds = useMemo(() => {
    const map = active?.completed ?? {}
    const ids = Object.entries(map)
      .filter(([, v]) => !!v)
      .map(([k]) => k)
    return new Set(ids)
  }, [active])
  const [quests, setQuests] = useState<Quest[]>([])
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebarCollapsed') === '1' } catch { return false }
  })

  useEffect(() => {
    let cancelled = false
    // load the same dataset used by the graph
    fetch(withBase(`/data/${lang}/quests.json`))
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setQuests((data?.quests ?? []) as Quest[])
      })
      .catch(() => setQuests([]))
    return () => {
      cancelled = true
    }
  }, [lang])

  // IDs par type (pour appliquer une complétion en masse)
  const idsByType = useMemo(() => {
    const known = new Set(TYPE_ORDER)
    const map = new Map<string, string[]>()
    quests.forEach((q) => {
      const t0 =
        q.type || (q.tags ? q.tags.find((x) => known.has(x)) : undefined)
      const t = normalizeType(t0)
      if (!map.has(t)) map.set(t, [])
      map.get(t)!.push(q.id)
    })
    return map
  }, [quests])


  // Applique une classe root pour contracter la colonne via CSS Grid
  useEffect(() => {
    const cls = 'sidebar-collapsed'
    const root = document.documentElement
    if (collapsed) root.classList.add(cls)
    else root.classList.remove(cls)
    try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0') } catch {}
  }, [collapsed])


  // Compute totals per (normalized) type
  const totalsByType = useMemo(() => {
    const acc: Record<string, number> = {}
    const known = new Set(TYPE_ORDER)
    quests.forEach((q) => {
      const t0 = q.type || (q.tags ? q.tags.find((x) => known.has(x)) : undefined)
      const t = normalizeType(t0)
      acc[t] = (acc[t] || 0) + 1
    })
    return acc
  }, [quests])

  // Compute completed per type
  const completedByType = useMemo(() => {
    const acc: Record<string, number> = {}
    const known = new Set(TYPE_ORDER)
    quests.forEach((q) => {
      if (!completedIds.has(q.id)) return
      const t0 = q.type || (q.tags ? q.tags.find((x) => known.has(x)) : undefined)
      const t = normalizeType(t0)
      acc[t] = (acc[t] || 0) + 1
    })
    return acc
  }, [quests, completedIds])

  const totalCompleted = completedIds.size
  const totalQuests = quests.length

  const rows = useMemo(() => {
    const allTypes = Array.from(new Set([...Object.keys(totalsByType), ...Object.keys(completedByType)]))
    return allTypes
      .sort((a, b) => typeWeight(a) - typeWeight(b) || a.localeCompare(b))
      .map((typeLabel) => {
        const total = totalsByType[typeLabel] ?? 0
        const done = completedByType[typeLabel] ?? 0
        const pct = total ? Math.round((done / total) * 100) : 0
        return { typeLabel, total, done, pct }
      })
  }, [totalsByType, completedByType])

  return (
    <>
      {/* --- Onglet de contrôle, à l'extérieur de la sidebar --- */}
      <button
        className="sidebar-handle"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? t('ui.help.open','Open help panel') : t('ui.help.hide','Hide help panel')}
      >
        {collapsed ? `< ${t('ui.help','Help')}` : '>'}
      </button>

      {/* --- Sidebar d’info --- */}
      <aside className="sidebar" aria-hidden={collapsed}>
        <h3 className="sidebar-title">{t('ui.sidebar.information','Information')}</h3>

        {/* On garde le contenu monté ; la largeur est gérée via CSS Grid */}
        <h4 className="sidebar-subtitle">{t('ui.sidebar.about','About this map')}</h4>
        <div className="section">
        <p className="muted">{t('ui.sidebar.about.text')}</p>
        </div>

        <h4 className="sidebar-subtitle">{t('ui.sidebar.howto.title','How to use')}</h4>
        <div className="section">
          <ul className="howto-list">
            <li>{t('ui.sidebar.howto.drag')}</li>
            <li>{t('ui.sidebar.howto.zoom')}</li>
            <li>{t('ui.sidebar.howto.minimap')}</li>
            <li>{t('ui.sidebar.howto.search')}</li>
            <li>{t('ui.sidebar.howto.reorganize')}</li>
            <li>{t('ui.sidebar.howto.center')}</li>
            <li>{t('ui.sidebar.howto.copyId')}</li>
            <li>{t('ui.sidebar.howto.followEdge')}</li>
            <li>{t('ui.sidebar.howto.character')}</li>
            <li>{t('ui.sidebar.howto.tasks')}</li>
          </ul>
        </div>
      </aside>

      {/* --- Progress dock : toujours visible en bas à droite --- */}
      <div className="progress-dock" role="status" aria-live="polite">
        <div className="progress-dock__title">
          <span className="title">
            {t('ui.progress.title','PROGRESS')} <span className="muted">({totalCompleted} / {totalQuests})</span>
          </span>
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
          {rows.map(({ typeLabel, total, done, pct }) => {
            const allDone = total > 0 && done === total
            const ids = idsByType.get(typeLabel) ?? []
           const onToggleType = () => {
              if (!ids.length) return
              const makeCompleted = !allDone
              const msg = makeCompleted
                ? t('ui.progress.bulkMarkDone','Mark all {count} "{type}" quests as completed?', { count: ids.length, type: typeLabel })
                : t('ui.progress.bulkMarkUndone','Mark all {count} "{type}" quests as not completed?', { count: ids.length, type: typeLabel })
              if (!window.confirm(msg)) return
              // Mise à jour en masse dans le store actif
              useStore.setState((state: any) => {
                const idx = state.characters.findIndex((c: any) => c.id === state.activeId)
                if (idx === -1) return {}
                const chars = [...state.characters]
                const ch = { ...chars[idx], completed: { ...(chars[idx].completed || {}) } }
                ids.forEach((id) => {
                  if (makeCompleted) ch.completed[id] = true
                  else delete ch.completed[id]
                })
                chars[idx] = ch
                return { characters: chars, completedVersion: Date.now() }
              })
            }
            return (
              <div key={typeLabel} className="progress-row">
                <div className="progress-label">
                <img
                  className="type-icon"
                  src={TYPE_ICON_PATHS[typeLabel] ?? '/icons/icon_objective_quest.png'}
                  alt=""
                  loading="lazy"
                />
                  {typeLabel} <span className="muted">({done}/{total})</span>
                </div>
                <div className="progress-bar" aria-label={`${typeLabel} ${pct}%`}>
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                {/* Bouton check circulaire (désormais après la barre) */}
                <button
                  className={`check-toggle ${allDone ? 'on' : ''}`}
                  onClick={onToggleType}
                  aria-label={ allDone ? t('ui.progress.bulkUnmark','Unmark all {type} quests', { type: typeLabel }) : t('ui.progress.bulkMark','Mark all {type} quests as completed', { type: typeLabel }) }
                  title={      allDone ? t('ui.progress.bulkUnmark','Unmark all {type} quests', { type: typeLabel }) : t('ui.progress.bulkMark','Mark all {type} quests as completed', { type: typeLabel }) }
                />
              </div>
            )
          })}
        </div>  
        {/* Reset confirmation overlay — identique à Graph */}
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
      </div>
    </>
  )
}