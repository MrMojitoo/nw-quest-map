import React, { useMemo, useState, useRef, useCallback } from 'react'
import ReactFlow, { MiniMap, Controls, ControlButton, Background, BackgroundVariant, Node, Edge, MarkerType, Position, useReactFlow, ReactFlowProvider,
  applyNodeChanges, type NodeChange } from 'reactflow'
import { getZoneByIdPrefix } from '../utils/zones'
import { LocaleContext } from '../App'

import 'reactflow/dist/style.css'
import ELK from 'elkjs/lib/elk.bundled.js'
import NodeCard from './NodeCard'
import useStore from '../store'
import manual from '../../tools/manual_links.json'

type Quest = {
  id: string
  title: string
  type?: string
  icon?: string
  description?: string
  recommended_level?: number|null
  required_level?: number|null
  zone_id?: number|null
  rewards?: string[]
  prerequisites: string[]
  not_prerequisites?: string[]
  repeatable?: boolean
  priority?: number
}

// --- Meta achievements (chargés depuis /data/<lang>/meta_achievements.json) ---
type MetaAchievement = {
  id: string
  title: string
  description?: string
  quests: string[]
}


// Helper pour préfixer correctement sous GitHub Pages (pas de new URL ici)
const withBase = (p: string) =>
  (import.meta.env.BASE_URL + String(p || '').replace(/^\//, ''))
    .replace(/([^:]\/)\/+/g, '$1') 
// Icônes par type (utilisées dans les boutons de filtres "Types")
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

// Normalisation pour le regroupement "Faction Story"
const normalizeType = (t?: string) =>
  !t ? 'Other' : (t.startsWith('Faction Story') ? 'Faction Story' : t)


// --- Normalisation des types pour les filtres ---
function normalizeTypeForFilter(t?: string): string {
  const s = (t || '').trim()
  const low = s.toLowerCase()
  if (!s) return 'Other'
  if (low.startsWith('faction story')) return 'Faction Story'
  return s
}
// Ordre préféré des types (modifie simplement ce tableau pour réordonner l’affichage)
const TYPE_ORDER = [
  'Main Story Quest',
  'Level',
  'Objective',
  'Journey',
  'Skill Progression',
  'Season Quest',
  'Faction Story',
  'Mount unlock',
  'Mount race',
  'Event',
  'Other',
]
const typeWeight = (t: string) => {
  const i = TYPE_ORDER.indexOf(t)
  return i === -1 ? 999 : i
}


// --- Node visuel pour le contour d'un achievement sélectionné ---
const AchBoxNode = ({ data }: { data: { w: number; h: number; done?: boolean } }) => {
  const w = Math.max(10, Number(data?.w ?? 0))
  const h = Math.max(10, Number(data?.h ?? 0))
  const done = !!data?.done
  return (
    <div
      style={{
        width: w,
        height: h,
        border: `2px dashed ${done ? '#22c55e' : '#f4dd66'}`,
        borderRadius: 12,
        background: done ? 'rgba(34,197,94,0.07)' : 'rgba(244,221,102,0.06)',
        pointerEvents: 'none',
      }}
    />
  )
}
const nodeTypes = { card: NodeCard, ach: AchBoxNode }

const MiniMapNode = (props: any) => {
  const { id, x, y, width, height } = props
  const color = getZoneByIdPrefix(String(id)).color
  return (
    <rect
      x={x}
      y={y}
      width={Math.max(4, width)}
      height={Math.max(4, height)}
      fill={color}
      stroke="#e2e8f0"
      strokeWidth={1}
      rx={2}
      ry={2}
    />
  )
}

const DEFAULT_RANKSEP = 180; // LR: horizontal | TB: vertical
const DEFAULT_NODESEP = 170; // LR: vertical   | TB: horizontal+
// Bornes de zoom globales
const MIN_ZOOM = 0.013
const MAX_ZOOM = 3
// === Heuristiques pour estimer la hauteur des cartes ===
const EST_NODE_BASE_H = 250;  // hauteur mini estimée d'une carte
const EST_LINE_H = 16;        // hauteur d'une ligne de texte
const SIBLING_STEP = 400;     // écart vertical entre enfants d'un même parent (au lieu de 300)
const BAND_GAP = 100;         // espace entre deux bandes (MSQ, LEVEL, Objective, …)
// Espacement spécifique pour les nœuds "orphelins" (sans arêtes)
const ORPHAN_COL_GAP = 220;   // écart H entre deux cartes orphelines
const ORPHAN_ROW_GAP = 220;   // écart V entre deux cartes orphelines
const NODE_WIDTH = 240;       // largeur déclarée côté ELK (doit rester en phase)

// --- ELK instance ---
const elk = new ELK()

// Estime la hauteur d'un nœud en fonction de son contenu (approx.)
function estimateNodeHeight(n: Node): number {
  const d: any = n.data || {}
  const title = String(d.title || '')
  const desc = String(d.description || '')
  const extraTitle = Math.max(0, title.length - 28) * 0.6
  const descLines = Math.ceil(desc.length / 90)
  const h = EST_NODE_BASE_H + descLines * EST_LINE_H + extraTitle
  return Math.max(EST_NODE_BASE_H, Math.min(360, h))
}


// Priorités d’affichage (plus haut = “plus important”)
// Priorité (ordre logique, pas directement la bande verticale)
function computePriority(type?: string, id?: string): number {
  const t = (type || '').toLowerCase()
  if (id?.startsWith('LEVEL_')) return 7
  if (t.includes('main story')) return 10
  if (t.includes('objective')) return 9
  if (t.includes('journey')) return 8
  if (t.includes('skill progression')) return 6
  if (t.includes('season quest')) return 5
  if (t.includes('faction story')) return 4
  if (t.includes('mount unlock')) return 3
  if (t.includes('mount race')) return 2
  if (t.includes('event')) return 1
  return 0
}

// Bande verticale (strates) : 100=MSQ, 90=LEVEL, 89=descendance des LEVEL,
// 80…10 pour le reste, 0 = défaut.
function bandFrom(
  type?: string,
  id?: string,
  reachableFromLevel?: boolean,
  reachableFromMsq?: boolean,
  reqLevel?: number
): number {
  const t = (type || '').toLowerCase()
  const isMsq = t.includes('main story')
  // Les cartes LEVEL_* restent la rangée des niveaux
  if (id?.startsWith('LEVEL_')) return 90
  // Cas spécial : MSQ qui n'a PAS d'ancêtre MSQ et qui est gated par un niveau
  // => on la met juste SOUS la ligne des niveaux (bande 89)
  if (isMsq && (reqLevel ?? 0) > 0 && !reachableFromMsq) return 89
  // MSQ "classiques" (chaîne principale)
  if (isMsq) return 100
  if (reachableFromMsq) return 95
  if (reachableFromLevel) return 89
  const p = computePriority(type, id)
  return p > 0 ? p * 10 - 20 : 0 // 8→60, 7→50, …, 1→-10 (rare)
}




function GraphInner({ quests, lang = 'en-us' }: { quests: Quest[]; lang?: string }) {
  // Locale chargée globalement dans App (évite les fetchs répétés)
  const { locale, t } = React.useContext(LocaleContext)
  const active = useStore(s => s.characters.find(c => c.id === s.activeId))
  const toggleQuest = useStore(s => s.toggleQuest)
  const isCompleted = useStore(s => s.isCompleted)
  const resetProgress = useStore(s => s.resetProgress)
  const completedVersion = useStore(s => s.completedVersion)
  const setManyNodePos = useStore(s => s.setManyNodePos)
  const resetLayoutPos = useStore(s => s.resetLayoutPos)
  const activeId = active?.id ?? 'default'

  // ---- Filtres (par type et par zone) ----
  // par défaut: tout activé
  const allTypes = useMemo(() => {
    const set = new Set<string>()
    for (const q of quests) set.add(normalizeTypeForFilter(q.type))
    set.add('Level') // on expose aussi le type "Level"
    return Array.from(set).sort((a,b) => {
      const wa = typeWeight(a), wb = typeWeight(b)
      return wa === wb ? a.localeCompare(b) : wa - wb
    })
  }, [quests])
  type ZoneFilter = { key: string; label: string; color: string }
  const allZones = useMemo<ZoneFilter[]>(() => {
    const map = new Map<string, ZoneFilter>()
    for (const q of quests) {
      const z = getZoneByIdPrefix(String(q.id)) as any
      const key = String(z?.key ?? z?.id ?? z?.name ?? 'Unknown')
      // libellé traduit via locale[zone.key] si dispo
      const locKey = String(z?.key ?? '').toLowerCase()
      const translated =
        (lang !== 'en-us' && locale)
          ? (locale[locKey] || locale[String(z?.key ?? '')] || null)
          : null
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: String(translated ?? z?.name ?? z?.label ?? key),
          color: String(z?.color ?? '#94a3b8'),
        })
      }
    }
    // tri alpha par libellé
    return Array.from(map.values()).sort((a,b) => a.label.localeCompare(b.label))
  }, [quests, lang, locale])
  const [typeOn, setTypeOn] = React.useState<Record<string, boolean>>({})
  const [zoneOn, setZoneOn] = React.useState<Record<string, boolean>>({})
  const [showRepeatables, setShowRepeatables] = React.useState(true)
  React.useEffect(() => {
    setTypeOn(Object.fromEntries(allTypes.map(t => [t, true])))
  }, [allTypes])
  React.useEffect(() => {
    setZoneOn(Object.fromEntries(allZones.map(z => [z.key, true])))
  }, [allZones])

  const reactFlow = useReactFlow()
  const paneRef = useRef<HTMLDivElement | null>(null)
  // Sélection multiple (marquee au clic droit)
  const [marquee, setMarquee] = useState<null | { start:{x:number;y:number}, end:{x:number;y:number} }>(null)
  const startPt = useRef<{x:number;y:number} | null>(null)
  const preventCtx = useRef(false)
  // Résultat layouté (ELK étant async)
  const [rfNodes, setRfNodes] = React.useState<Node[]>([])
  const [rfEdges, setRfEdges] = React.useState<Edge[]>([])
  // Permet de forcer un re-layout à la demande (ex: Reset)
  const [layoutEpoch, setLayoutEpoch] = React.useState(0)
  // --- Lock: disable node dragging only (keep panning/zoom) ---
  const [lockNodes, setLockNodes] = React.useState(false)
  // Positions manuelles (drag utilisateur) conservées par id
  const [userPos, setUserPos] = React.useState<Record<string, { x:number, y:number }>>({})
  const userPosRef = React.useRef(userPos)
  React.useEffect(() => { userPosRef.current = userPos }, [userPos])

  // UI pour le modal de confirmation
  const [showResetConfirm, setShowResetConfirm] = React.useState(false)
  const [showResetPosConfirm, setShowResetPosConfirm] = React.useState(false)

  // --- Achievements UI state ---
  const [achievements, setAchievements] = React.useState<MetaAchievement[]>([])
  const [showAchModal, setShowAchModal] = React.useState(false)
  const [selectedAch, setSelectedAch] = React.useState<MetaAchievement | null>(null)
  // on conserve le dernier rectangle calculé pour le node "box"
  const [achRect, setAchRect] = React.useState<{ x:number; y:number; w:number; h:number } | null>(null)


  // Ré-applique les positions sauvegardées (store) en dernier.
  // Effet idempotent : ne change rien si les positions sont déjà à jour.
  const savedQuestPos = useStore(s => s.layoutPos.quests)
  React.useEffect(() => {
    if (!rfNodes.length) return
    setRfNodes(prev => {
      let changed = false
      const next = prev.map(n => {
        const p = savedQuestPos[n.id]
        if (!p) return n
        const same = n.position?.x === p.x && n.position?.y === p.y
        if (same) return n
        changed = true
        return { ...n, position: { x: p.x, y: p.y } }
      })
      return changed ? next : prev
    })
  }, [savedQuestPos, rfNodes.length])

  React.useEffect(() => {
    // reset pour éviter d’afficher l’ancienne liste pendant le refetch
    setAchievements([])
    const url = withBase(`/data/${lang}/meta_achievements.json`)
    console.info('[Meta] lang =', lang, '→', url)
    fetch(url).then(r => r.json()).then((arr: MetaAchievement[]) => {
       const filtered = (Array.isArray(arr) ? arr : []).filter(a =>
         !String(a?.id ?? '').startsWith('Quest_CountTotals')
       )
       setAchievements(filtered)
    }).catch(async (err) => {
      // Fallback EN si la variante langue n’existe pas (prod)
      if (lang !== 'en-us') {
        const fb = withBase('/data/en-us/meta_achievements.json')
        console.warn('[Meta] fallback en-us →', fb, String(err))
        try {
          const r = await fetch(fb)
          if (r.ok) {
            const arr = await r.json()
            const filtered = (Array.isArray(arr) ? arr : []).filter(a => !String(a?.id ?? '').startsWith('Quest_CountTotals'))
            setAchievements(filtered)
            return
          }
        } catch {}
      }
      console.error('[Meta] failed to load metas:', err)
    })
  }, [lang])

  React.useEffect(() => {
    setUserPos({})
    hasCenteredRef.current = false // on autorise un recentrage automatique après relayout
  }, [typeOn, zoneOn, showRepeatables])


  // Centrage initial sur le nœud le plus "en haut à gauche"
  const { setCenter, getNodes } = useReactFlow()
  const hasCenteredRef = React.useRef(false)
  React.useEffect(() => {
    if (hasCenteredRef.current) return
    if (!rfNodes.length) return
    // Récupère les nœuds mesurés par React Flow (avec width/height)
    const nodes = getNodes()
    if (!nodes || !nodes.length) return
    // Trouve le nœud minimal en Y, puis minimal en X (haut-gauche)
    let best = nodes[0]
    for (const n of nodes) {
      const by = n.position?.y ?? 0
      const bx = n.position?.x ?? 0
      const cy = best.position?.y ?? 0
      const cx = best.position?.x ?? 0
      if (by < cy || (by === cy && bx < cx)) {
        best = n
      }
    }
    const cx = (best.position?.x ?? 0) + ((best.width ?? 0) / 2)
    const cy = (best.position?.y ?? 0) + ((best.height ?? 0) / 2)
    setCenter(cx, cy, { zoom: 1, duration: 0 })
    hasCenteredRef.current = true
  }, [rfNodes, getNodes, setCenter])
  // Applique les changements de nœuds émis par React Flow (drag en direct)
  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    // Si les nœuds sont "lock", on ignore toute modif de position/dimension
    if (lockNodes) {
      const nonMove = changes.filter(
        (ch) => ch.type !== 'position' && ch.type !== 'dimensions'
      )
      if (nonMove.length === 0) return
      setRfNodes((nds) => applyNodeChanges(nonMove, nds))
      return
    }
    setRfNodes((nds) => applyNodeChanges(changes, nds))
    // Persistance locale + store (batch)
    const batch: Record<string, {x:number;y:number}> = {}
    changes.forEach((ch) => {
      if (ch.type === 'position' && 'position' in ch && ch.position) {
        batch[ch.id] = { x: ch.position.x, y: ch.position.y }
      }
    })
    if (Object.keys(batch).length) {
      setUserPos((prev) => ({ ...prev, ...batch }))
      try { setManyNodePos?.('quests', batch) } catch {}
    }
  }, [lockNodes])

  // --- Marquee (clic droit) : sélectionne/ désélectionne des nœuds ---
  const updateSelectionFromRect = useCallback((rect:{x1:number;y1:number;x2:number;y2:number}) => {
    const { x1, y1, x2, y2 } = rect
    const minX = Math.min(x1,x2), maxX = Math.max(x1,x2)
    const minY = Math.min(y1,y2), maxY = Math.max(y1,y2)
    const nodes = reactFlow.getNodes()
    setRfNodes(prev => prev.map(n => {
      const x = n.positionAbsolute?.x ?? n.position.x
      const y = n.positionAbsolute?.y ?? n.position.y
      const w = n.width ?? 200
      const h = n.height ?? 120
      const inside = x + w >= minX && x <= maxX && y + h >= minY && y <= maxY
      return inside ? { ...n, selected: true } : { ...n, selected: false }
    }))
  }, [reactFlow, setRfNodes])


  // Démarre le "marquee" UNIQUEMENT au clic droit MAINTENU
  const onPaneMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 2) return;             // uniquement clic droit
    e.preventDefault();                     // évite le menu contextuel
    preventCtx.current = true;
    const startScreen = { x: e.clientX, y: e.clientY };
    const startFlow = reactFlow.screenToFlowPosition(startScreen);
    startPt.current = startFlow;
    setMarquee({ start: startScreen, end: startScreen });
    const onMove = (ev: MouseEvent) => {
      const endScreen = { x: ev.clientX, y: ev.clientY };
      setMarquee(m => (m ? { ...m, end: endScreen } : m));
      const a = startPt.current;
      if (!a) return;
      const b = reactFlow.screenToFlowPosition(endScreen);
      updateSelectionFromRect({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
   };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      startPt.current = null;
      setMarquee(null);                      // le rectangle disparaît
      setTimeout(() => { preventCtx.current = false; }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [reactFlow, updateSelectionFromRect]);

  const base = useMemo(() => {
    // applique les filtres sélectionnés
    const filtered = quests.filter(q => {
      // Zone filter (toujours appliqué)
      const z = getZoneByIdPrefix(String(q.id)) as any
      const zoneKey = String(z?.key ?? z?.id ?? z?.name ?? 'Unknown')
      const allowZone = (zoneOn[zoneKey] ?? true)

      // Priorité au filtre Repeatable:
      // - si la quête est repeatable: on l'affiche uniquement si showRepeatables est ON,
      //   indépendamment du filtre de type (mais en respectant la zone).
      // - si la quête n'est pas repeatable: on applique les filtres de type + zone.
      if (q.repeatable) {
        return showRepeatables && allowZone
      }

      const typeKey = normalizeTypeForFilter(q.type)
      const allowType = typeOn[typeKey] ?? true
      return allowType && allowZone
    })
    // — niveaux requis manuels (ne servent que si CSV n’a pas de valeur) —
    const manualLevels: Record<string, number> = (manual as any).requiredLevels || {}

    // Enrichit chaque quête avec required_level effectif (CSV sinon override manuel)
    const enriched = filtered.map((q) => ({
      ...q,
      required_level: q.required_level || manualLevels[q.id] || 0,
    }))

    const nodesRaw: Node[] = enriched.map(q => ({
      id: q.id,
      type: 'card',
      data: {
        ...q,
      },
      position: { x: 0, y: 0 },
    }))

    // === NŒUDS DE NIVEAU : "LEVEL_XX" (affichés seulement si le type "Level" est ON) ===
    const levelTypeOn = (typeOn['Level'] ?? true)
    // Rassemble les quêtes SANS prérequis de quête mais AVEC required_level
    const levelParents: Record<string, string[]> = {}
    for (const q of enriched) {
      const hasQuestPrereq =
        (q.prerequisites?.length ?? 0) > 0 ||
        (q.not_prerequisites?.length ?? 0) > 0
      if (!hasQuestPrereq && (q.required_level ?? 0) > 0) {
        const key = String(q.required_level)
        ;(levelParents[key] ||= []).push(q.id)
      }
    }
    // Crée un node par niveau requis trouvé
    if (levelTypeOn) {
      Object.keys(levelParents).forEach((lvl) => {
        nodesRaw.push({
          id: `LEVEL_${lvl}`,
          type: 'card',
          data: {
            id: `LEVEL_${lvl}`,
            title: `Level ${lvl}`,
            type: 'Level',                      // type simple, s’affichera comme une carte
            description: `t('ui.level.desc','Reach level') ${lvl}`,
            required_level: Number(lvl),
            prerequisites: [],
            not_prerequisites: [],
            zone_id: null,
            rewards: [],
            priority: -2,                        // MSQ (priority 0) reste prioritaire
          },
          position: { x: 0, y: 0 },
        } as Node)
      })
    }

    const edgesPosRaw: Edge[] = []
    const edgesNeg: Edge[] = []
    const ids = new Set(enriched.map(f=>f.id))
    for (const q of enriched) {
      for (const src of q.prerequisites) {
        if (!ids.has(src)) continue
        if (src === q.id) continue
        edgesPosRaw.push({
          id: `${src}->${q.id}`,
          source: src,
          target: q.id,
          sourceHandle: 'r',
          targetHandle: 'l',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          animated: false,
          style: { strokeWidth: 1.5, stroke: '#ffffff' },
        })
      }
      for (const src of (q.not_prerequisites ?? [])) {
        if (!ids.has(src)) continue
        if (src === q.id) continue
        edgesNeg.push({
          id: `not:${src}->${q.id}`,
          source: src,
          target: q.id,
          sourceHandle: 'r',
          targetHandle: 'l',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          animated: false,
          style: { strokeWidth: 1.5, stroke: '#f87171' }, 
        })
      }
    }
    // Arêtes des nœuds LEVEL_XX vers les quêtes concernées (seulement si "Level" est ON)
    if (levelTypeOn) {
      for (const [lvl, targets] of Object.entries(levelParents)) {
        const srcId = `LEVEL_${lvl}`
        for (const t of targets) {
          edgesPosRaw.push({
            id: `${srcId}->${t}`,
            source: srcId,
            target: t,
            sourceHandle: 'r',
            targetHandle: 'l',
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
            animated: false,
            style: { strokeWidth: 1.5, stroke: '#ffffff' },
          })
        }
      }
    } 

    // === Chaînage des niveaux entre eux (LEVEL_a -> LEVEL_b -> ...) (si "Level" ON) ===
    if (levelTypeOn) {
      const levelOrder = Object.keys(levelParents)
        .map((n) => Number(n))
        .sort((a, b) => a - b)
      for (let i = 0; i < levelOrder.length - 1; i++) {
        const a = levelOrder[i]
        const b = levelOrder[i + 1]
        edgesPosRaw.push({
          id: `LEVEL_${a}->LEVEL_${b}`,
          source: `LEVEL_${a}`,
          target: `LEVEL_${b}`,
          sourceHandle: 'r',
          targetHandle: 'l',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          animated: false,
          style: { strokeWidth: 1.5, stroke: '#ffffff' },
        })
      }
    }
    return {
      nodesRaw,
      edgesPosRaw,
      edgesNeg,
      levelParents
    }
  }, [quests, typeOn, zoneOn, showRepeatables])

  
  // --- ELK layout async + post-traitements (LEVEL, MSQ, alignements, anti-chevauchement) ---
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { nodesRaw, edgesPosRaw, edgesNeg, levelParents } = base
      if (!nodesRaw?.length) {
        if (!cancelled) { setRfNodes([]); setRfEdges([]) }
        return
      }
      const isHorizontal = true
      // 1) Construire nodesRaw / edgesPosRaw (déjà fait au-dessus)
      //    -> enrichir avec priorité + bande
      // Map des successeurs (pour trouver la descendance des LEVEL)
      const succ: Record<string, string[]> = {}
      for (const e of edgesPosRaw) {
        ;(succ[e.source] ||= []).push(e.target)
      }

     // --- Descendance depuis les MSQ ---
     const msqRoots = nodesRaw
       .filter(n => String((n.data as any)?.type ?? '').toLowerCase().includes('main story'))
       .map(n => n.id)
     const reachableFromMsq = new Set<string>()
     {
       const q: string[] = [...msqRoots]
       for (let i = 0; i < q.length; i++) {
         const cur = q[i]
         for (const to of succ[cur] || []) {
           if (!reachableFromMsq.has(to) && !to.startsWith('LEVEL_')) {
             reachableFromMsq.add(to)
             q.push(to)
           }
         }
       }
     }

      // parcours depuis tous les LEVEL_*
      const reachableFromLevel = new Set<string>()
      const q: string[] = nodesRaw.filter(n => n.id.startsWith('LEVEL_')).map(n => n.id)
      for (let i = 0; i < q.length; i++) {
        const cur = q[i]
        for (const to of succ[cur] || []) {
          if (!reachableFromLevel.has(to) && !to.startsWith('LEVEL_')) {
            reachableFromLevel.add(to)
            q.push(to)
          }
        }
      }
      for (const n of nodesRaw) {
        const t = (n.data as any)?.type as string | undefined
        const prio = computePriority(t, n.id)
        ;(n.data as any).priority = prio
       ;(n.data as any).band = bandFrom(
         t,
         n.id,
         reachableFromLevel.has(n.id),
         reachableFromMsq.has(n.id),
         Number((n.data as any)?.required_level || 0)
        )
      }

      // --- MSQ "après niveau" : forcer la bande 89 pour les MSQ qui
      // descendent de racines MSQ gated par niveau (ex: ..._MedusaRaidVector → ..._MedusaRaid)
      const msqLevelRootIds = nodesRaw
        .filter(n => {
          const dt = String(((n.data as any)?.type || '')).toLowerCase()
          const req = Number(((n.data as any)?.required_level || 0))
          return dt.includes('main story') && req > 0 && !reachableFromMsq.has(n.id)
        })
        .map(n => n.id)
      const msqAfterLevel = new Set<string>()
      {
        const q2: string[] = [...msqLevelRootIds]
        while (q2.length) {
          const cur = q2.shift()!
          for (const to of succ[cur] || []) {
            if (!msqAfterLevel.has(to)) { msqAfterLevel.add(to); q2.push(to) }
          }
        }
      }
      // Forcer la bande 89 uniquement pour les nœuds MSQ situés dans cette descendance
      for (const n of nodesRaw) {
        const dt = String(((n.data as any)?.type || '')).toLowerCase()
        if (dt.includes('main story') && msqAfterLevel.has(n.id)) {
          (n.data as any).band = 89
        }
      }
      

      // Ordonne une vue des nodes par priorité (desc), puis par id — cela
      // influence l’ordre vertical dans une même couche grâce à
      // 'elk.layered.considerModelOrder'
      const nodesForElk = [...nodesRaw].sort((a, b) => {
        const pa = ((a.data as any)?.priority ?? 0)
        const pb = ((b.data as any)?.priority ?? 0)
        if (pb !== pa) return pb - pa
        return a.id.localeCompare(b.id)
      })
      // Graph ELK
      const graph: any = {
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          // espacement entre couches (colonnes en LR)
          'elk.layered.spacing.nodeNodeBetweenLayers': String(DEFAULT_RANKSEP),
          // espacement interne dans une couche
          'elk.spacing.nodeNode': String(DEFAULT_NODESEP),
          // compacter au mieux différents éléments
          'elk.spacing.edgeNode': '20',
          'elk.layered.spacing.edgeNodeBetweenLayers': '20',
          'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
          'elk.spacing.componentComponent': '60',
          'elk.layered.considerModelOrder': 'NODES_AND_EDGES',
          // placement des nœuds : favorise les lignes droites
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          'elk.layered.nodePlacement.bk.fixedAlignment': 'UP_LEFT',
          'elk.layered.nodePlacement.bk.edgeStraightening': 'IMPROVE_STRAIGHTNESS',
          'elk.layered.nodePlacement.favorStraightEdges': 'true',
          // layering & cycles
          'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
          'elk.layered.cycleBreaking.strategy': 'GREEDY',
          // des orthogonales, plus lisibles et plus compactes
          'elk.edgeRouting': 'ORTHOGONAL',
        },
        children: nodesForElk.map(n => ({
          id: n.id,
          width: 240,
          height: estimateNodeHeight(n),
        })),
        edges: [...edgesPosRaw].sort((ea, eb) => {
          const pa = ((nodesRaw.find(n => n.id === ea.source)?.data as any)?.priority ?? 0)
          const pb = ((nodesRaw.find(n => n.id === eb.source)?.data as any)?.priority ?? 0)
          if (pb !== pa) return pb - pa
          return ea.id.localeCompare(eb.id)
        }).map(e => ({
          id: e.id,
          sources: [String(e.source)],
          targets: [String(e.target)],
        })),
      }
      const res: any = await elk.layout(graph)
      type ElkChildPos = { x: number; y: number }
      const posById = new Map<string, ElkChildPos>(
        res.children.map((c: any) => [String(c.id), { x: Number(c.x ?? 0), y: Number(c.y ?? 0) }])
      )
      // Applique positions ELK
      const laidNodes = nodesRaw.map(n => {
        const c = posById.get(n.id)
        const x = c ? c.x : 0
        const y = c ? c.y : 0
        return {
          ...n,
          position: { x, y },
          sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
          targetPosition: isHorizontal ? Position.Left : Position.Top,
        } as Node
      })

      // --- Post-traitement : parent→enfant, puis anti-chevauchement ---
      const children: Record<string, string[]> = {}
      const indeg: Record<string, number> = {}
      const outdeg: Record<string, number> = {}      
      for (const e of edgesPosRaw) {
        const isLevelChain = String(e.source).startsWith('LEVEL_') && String(e.target).startsWith('LEVEL_')
        if (isLevelChain) continue
        if (String(e.source).startsWith('LEVEL_')) continue
        ;(children[e.source] ||= []).push(e.target)
        indeg[e.target] = (indeg[e.target] ?? 0) + 1
        outdeg[e.source] = (outdeg[e.source] ?? 0) + 1
      }
      const prio: Record<string, number> = {}
      for (const n of laidNodes) prio[n.id] = (n.data as any)?.priority ?? 1
      for (const k of Object.keys(children)) {
        children[k].sort((a, b) => {
          const pa = prio[a] ?? 1, pb = prio[b] ?? 1
          if (pa !== pb) return pa - pb
          return a.localeCompare(b)
        })
      }
      const nodeMap: Record<string, any> = {}
      for (const n of laidNodes) nodeMap[n.id] = n

      const ordered = [...laidNodes].sort((a, b) => a.position.x - b.position.x)
      const ROW_STEP = SIBLING_STEP
      const seen = new Set<string>()
      function alignFromParent(id: string) {
        if (seen.has(id)) return
        seen.add(id)
        const parent = nodeMap[id]
        if (!parent) return
        let kids = children[id] || []
        if (id.startsWith('LEVEL_')) return // pas d’alignement pour les LEVEL
        // garde uniquement les enfants dans la même bande
        const parentBand = (parent.data as any)?.band ?? 0
        kids = kids.filter(k => ((nodeMap[k]?.data as any)?.band ?? 0) === parentBand)
        if (!kids.length) return
        const firstId = kids[0]
        const first = nodeMap[firstId]
        if (first) first.position.y = parent.position.y
        for (let i = 1; i < kids.length; i++) {
          const kid = nodeMap[kids[i]]
          if (!kid) continue
          kid.position.y = parent.position.y + i * ROW_STEP
        }
        if (first) alignFromParent(firstId)
      }
      for (const n of ordered) alignFromParent(n.id)

      // Redresse les CHAÎNES 1→1 (un seul parent ET un seul enfant) pour faire des lignes horizontales
      const visited = new Set<string>()
      for (const n of ordered) {
        const id = n.id
        if (visited.has(id)) continue
        const hasOneOut = (outdeg[id] ?? 0) === 1
        if (!hasOneOut) continue
        // tête de chaîne = in-degree ≠ 1
        if ((indeg[id] ?? 0) === 1) continue
        const band = ((nodeMap[id]?.data as any)?.band ?? 0)
        // parcours de la chaîne
        const chain: string[] = [id]
        let cur = id
        while (true) {
          const k = children[cur]?.[0]
          if (!k) break
          if ((indeg[k] ?? 0) !== 1 || (outdeg[k] ?? 0) > 1) break
          if ((((nodeMap[k]?.data as any)?.band ?? 0) !== band)) break
          chain.push(k)
          cur = k
        }
        if (chain.length > 1) {
          const baseY = nodeMap[chain[0]].position.y
          for (const cid of chain) {
            visited.add(cid)
            nodeMap[cid].position.y = baseY
          }
        }
      }

      const nodesByBand: Record<number, string[]> = {}
      for (const n of ordered) {
        const b = ((nodeMap[n.id]?.data as any)?.band ?? 0)
        ;(nodesByBand[b] ||= []).push(n.id)
      }
      const dynamicBands = Object.keys(nodesByBand)
        .map(Number)
        .sort((a, b) => b - a)  // plus grande bande tout en haut

      // Point de départ : top de la MSQ si elle existe, sinon top global
      const msqIds = nodesByBand[100] || []
      const allIds = ordered.map(o => o.id)
      const msqTop = msqIds.length
        ? Math.min(...msqIds.map(id => nodeMap[id].position.y))
        : Math.min(...allIds.map(id => nodeMap[id].position.y))
      let cursorY = msqTop

      for (const b of dynamicBands) {
        const ids = nodesByBand[b]
        if (!ids || !ids.length) continue
        const minY = Math.min(...ids.map(id => nodeMap[id].position.y))
        const maxBottom = Math.max(...ids.map(id => nodeMap[id].position.y + estimateNodeHeight(nodeMap[id] as any)))
        const dy = cursorY - minY
        if (Math.abs(dy) > 0.5) {
          for (const id of ids) {
            nodeMap[id].position.y += dy
          }
        }
        // petit coup d’alignement intra-bande après déplacement
        for (const id of ids) alignFromParent(id)
        const newMaxBottom = Math.max(...ids.map(id => nodeMap[id].position.y + estimateNodeHeight(nodeMap[id] as any)))
        cursorY = newMaxBottom + BAND_GAP
      }

      {
        const levelIds = ordered
          .filter(n => n.id.startsWith('LEVEL_'))
          .map(n => n.id)
        if (levelIds.length) {
          const yLevels = Math.min(...levelIds.map(id => nodeMap[id].position.y))
          for (const id of levelIds) nodeMap[id].position.y = yLevels
        }
      }


      // --- Répartition en GRILLE des nœuds "orphelins" (aucun parent/aucun enfant)
      //     Utile quand on filtre et qu'il ne reste que des composants isolés.
      //     On le fait par "bande" pour conserver l'organisation générale.
      for (const b of dynamicBands) {
        const idsInBand = nodesByBand[b] || []
        if (!idsInBand.length) continue
        // orphelins = pas d'arête entrante/sortante (hors LEVEL_*)
        const orphans = idsInBand.filter(id =>
          !id.startsWith('LEVEL_') &&
          ((indeg[id] ?? 0) === 0) &&
          ((outdeg[id] ?? 0) === 0)
        )
        if (orphans.length < 2) continue

        // point d'ancrage à gauche/haut de la bande
        const startX = Math.min(...orphans.map(id => nodeMap[id].position.x))
        const startY = Math.min(...orphans.map(id => nodeMap[id].position.y))

        // cellule de grille : largeur = NODE_WIDTH + gap ; hauteur = max(h) + gap
        const maxH = Math.max(...orphans.map(id => estimateNodeHeight(nodeMap[id] as any)))
        const cellW = NODE_WIDTH + ORPHAN_COL_GAP
        const cellH = maxH + ORPHAN_ROW_GAP

        // grille carrée-ish
        const cols = Math.ceil(Math.sqrt(orphans.length))
        orphans.forEach((id, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          nodeMap[id].position.x = startX + col * cellW
          nodeMap[id].position.y = startY + row * cellH
        })
      }


      if (!cancelled) {
        // Calcule l'indegré uniquement pour les arêtes “prérequis” (hors LEVEL_)
        const indeg: Record<string, number> = {}
        for (const e of edgesPosRaw) {
          if (!String(e.source).startsWith('LEVEL_')) {
            indeg[e.target] = (indeg[e.target] || 0) + 1
          }
        }

        // Applique les overrides utilisateurs + isCompleted + classe “no-parent”
        const finalNodes = laidNodes.map(n => {
          const ov = userPosRef.current[n.id]
          const withPos = ov ? { ...n, position: ov } : n
          const isDone = isCompleted(n.id)
          const hasNoParents =
            !String(n.id).startsWith('LEVEL_') && (indeg[n.id] ?? 0) === 0

          return {
            ...withPos,
            className: hasNoParents
              ? ['no-parent-node', withPos.className].filter(Boolean).join(' ')
              : withPos.className,
            data: {
              ...(withPos.data as any),
              isCompleted: isDone,
              onToggleComplete: toggleQuest,
            },
          }
        })
        // -- index des arêtes par "target" pour MAJ rapides lors d'un toggle --
        const idx: Record<string, string[]> = {}
        const allEdges = [...edgesPosRaw, ...edgesNeg].map((e) => ({
          ...e,
          // par défaut: animer seulement si la cible n'est PAS complétée
          animated: !isCompleted(String(e.target)),
        }))
        for (const e of allEdges) {
          const t = String(e.target)
          ;(idx[t] ||= []).push(String(e.id))
        }

        setRfNodes(finalNodes)
        setRfEdges(allEdges)
        setEdgesIndex(idx)
      }
    })()
    return () => { cancelled = true }
  }, [base, layoutEpoch])

  // --- Helpers Achievements ---
  const removeAchBoxNode = React.useCallback(() => {
    setRfNodes(prev => prev.filter(n => n.id !== '__ACH_BOX__'))
    setAchRect(null)
  }, [])

  const updateAchBoxForIds = React.useCallback((ids: string[], done: boolean = false) => {
    const nodes = reactFlow.getNodes()
    const wanted = new Set(ids)
    const targets = nodes.filter(n => wanted.has(n.id))
    if (!targets.length) {
      removeAchBoxNode()
      return
    }
    // bbox en coordonnées "flow"
    const minX = Math.min(...targets.map(n => (n.positionAbsolute?.x ?? n.position?.x ?? 0)))
    const minY = Math.min(...targets.map(n => (n.positionAbsolute?.y ?? n.position?.y ?? 0)))
    const maxX = Math.max(...targets.map(n => (n.positionAbsolute?.x ?? n.position?.x ?? 0) + (n.width ?? 240)))
    const maxY = Math.max(...targets.map(n => (n.positionAbsolute?.y ?? n.position?.y ?? 0) + (n.height ?? 240)))
    const pad = 24
    const rect = { x: minX - pad, y: minY - pad, w: (maxX - minX) + 2*pad, h: (maxY - minY) + 2*pad }
    setAchRect(rect)
    // injecte/MAJ un node spécial
    setRfNodes(prev => {
      const others = prev.filter(n => n.id !== '__ACH_BOX__')
      const box: Node = {
        id: '__ACH_BOX__',
        type: 'ach',
        position: { x: rect.x, y: rect.y },
        data: { w: rect.w, h: rect.h, done },
        draggable: false,
        selectable: false,
        // @ts-ignore: zIndex possible via style
        style: { zIndex: 0, pointerEvents: 'none' },
      }
      return [...others, box]
    })
  }, [reactFlow, removeAchBoxNode])

  // Stats d'achievements (X/Y complétées) + recalcul du contour
  const achStats = React.useMemo(() => {
    return achievements.map(a => {
      const total = a.quests?.length ?? 0
      const done = a.quests?.reduce((acc, qid) => acc + (isCompleted(qid) ? 1 : 0), 0) ?? 0
      return { id: a.id, total, done, complete: total > 0 && done === total }
    })
  }, [achievements, completedVersion, isCompleted, activeId])

  const completedAchCount = React.useMemo(
    () => achStats.filter(s => s.complete).length,
    [achStats]
  )

  // Recalcule le contour si on relayout/filtre ou si l'achievement sélectionné change
  React.useEffect(() => {
    if (!selectedAch) return
    const stat = achStats.find(s => s.id === selectedAch.id)
    const done = !!stat?.complete
    updateAchBoxForIds(selectedAch.quests, done)
  }, [selectedAch, rfNodes.length, rfEdges.length, updateAchBoxForIds, achStats])
  
  // Ajoute/retire la classe 'ach-match' carte-par-carte selon l'achievement sélectionné
  React.useEffect(() => {
    const ids = new Set(selectedAch?.quests || [])
    setRfNodes(prev =>
      prev.map(n => {
        const cls = String(n.className || '')
        // retire toute ancienne occurrence
        const clean = cls.replace(/\bach-match\b/g, '').replace(/\s{2,}/g, ' ').trim()
        const next = ids.has(n.id) ? (clean ? `${clean} ach-match` : 'ach-match') : clean
        return next === cls ? n : { ...n, className: next }
      })
    )
  }, [selectedAch, rfNodes.length])

  React.useEffect(() => {
    const handler = (e: any) => {
      const queryRaw: string = e?.detail?.query ?? ''
      const query = queryRaw.toLowerCase()
      if (!query) return
      const nodes = reactFlow.getNodes()
      let target = nodes.find(n => n.id.toLowerCase() === query)
      if (!target) {
        target = nodes.find(n => {
          const title = String((n.data as any)?.title ?? '').toLowerCase()
          return n.id.toLowerCase().includes(query) || title.includes(query)
        })
      }
      if (!target) return
      reactFlow.fitView({
        nodes: [{ id: target.id }],
        padding: 0.2,
        minZoom: 0.5,
        maxZoom: 1.5,
        duration: 400,
        includeHiddenNodes: false,
      })
    }
    window.addEventListener('focus-node', handler as EventListener)
    return () => window.removeEventListener('focus-node', handler as EventListener)
  }, [reactFlow])

  
  // Force (au besoin) la bordure blanche du viewport de la MiniMap
  React.useEffect(() => {
    // on laisse le temps à la MiniMap de (re)peindre
    requestAnimationFrame(() => {
      const el = document.querySelector(
        '.minimap--white-viewport .react-flow__minimap-viewport'
      ) as SVGGraphicsElement | null
      if (el) {
        el.setAttribute('stroke', '#ffffff')
        el.setAttribute('stroke-width', '3')
        el.setAttribute('fill', 'none')
        ;(el as any).style.filter = 'drop-shadow(0 0 2px rgba(255,255,255,0.85))'
      }
    })
  }, [rfNodes.length, rfEdges.length])


  // --- Clic sur une arête : aller au nœud opposé à l'extrémité cliquée ---
  const handleEdgeClick = React.useCallback(
    (evt: any, edge: any) => {
      if (!edge || !edge.source || !edge.target) return;
      // Convertit la position écran -> coordonnées du graphe
      const toFlow = (pt: { x: number; y: number }) =>
        (reactFlow as any).screenToFlowPosition
          ? (reactFlow as any).screenToFlowPosition(pt)
          : reactFlow.project(pt);
      const p = toFlow({ x: evt.clientX, y: evt.clientY });

      const src = reactFlow.getNode(edge.source);
      const tgt = reactFlow.getNode(edge.target);
      if (!src || !tgt) return;

      const centerOf = (n: any) => {
        const ax = n.positionAbsolute?.x ?? n.position?.x ?? 0;
        const ay = n.positionAbsolute?.y ?? n.position?.y ?? 0;
        const w = n.width ?? 200;
        const h = n.height ?? 120;
        return { x: ax + w / 2, y: ay + h / 2 };
      };

      const cSrc = centerOf(src);
      const cTgt = centerOf(tgt);
      const dSrc = (p.x - cSrc.x) ** 2 + (p.y - cSrc.y) ** 2;
      const dTgt = (p.x - cTgt.x) ** 2 + (p.y - cTgt.y) ** 2;

      // Si clic plus proche de la cible → aller à la source, sinon aller à la cible
      const focus = dTgt < dSrc ? src : tgt;
      const { zoom } = reactFlow.getViewport();
      const fc = centerOf(focus);
      reactFlow.setCenter(fc.x, fc.y, { zoom, duration: 300 });
    },
    [reactFlow]
  );

  // Quand on termine de déplacer un nœud, on mémorise sa position
  const handleNodeDragStop = React.useCallback((_evt: any, node: any) => {
    if (lockNodes) return
    setUserPos(prev => ({
      ...prev,
      [node.id]: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
    }))
  }, [lockNodes])


  // Click sur la MiniMap -> se déplacer à l'endroit cliqué
  React.useEffect(() => {
    // On cible le svg de la minimap
    const svg = document.querySelector('.react-flow__minimap svg') as SVGSVGElement | null
    if (!svg) return

    const onClick = (e: MouseEvent) => {
      const vb = svg.getAttribute('viewBox')
      if (!vb) return
      const [vbX, vbY, vbW, vbH] = vb.split(/\s+/).map(Number)
      const rect = svg.getBoundingClientRect()
      const relX = (e.clientX - rect.left) / rect.width
      const relY = (e.clientY - rect.top) / rect.height
      const gx = vbX + relX * vbW
      const gy = vbY + relY * vbH
      const { zoom } = reactFlow.getViewport()
      reactFlow.setCenter(gx, gy, { zoom, duration: 300 })
    }

    svg.addEventListener('click', onClick)
    return () => svg.removeEventListener('click', onClick)
  }, [reactFlow, rfNodes.length, rfEdges.length])

  // --- Quand la progression change (n'importe quel perso), met à jour le flag isCompleted
  React.useEffect(() => {
    setRfNodes(prev => {
      let changed = false
      const next = prev.map(n => {
        const completed = isCompleted(n.id)
        const prevCompleted = !!(n.data as any)?.isCompleted
        if (prevCompleted === completed) return n
        changed = true
        return { ...n, data: { ...n.data, isCompleted: completed } }
      })
      return changed ? next : prev
    })
  }, [completedVersion, isCompleted, rfNodes.length, activeId])

  // Index pour MAJ ciblées des arêtes lors d’un toggle d’une quête
  const [edgesIndex, setEdgesIndex] = React.useState<Record<string, string[]>>({})

  // Toggle local : met à jour l’état store + l’UI (nœud + arêtes ciblées) sans relancer ELK
  const handleToggleComplete = React.useCallback((id: string) => {
    const wasCompleted = isCompleted(id)
    // 1) store
    toggleQuest(id)
    // 2) nœud local (feedback immédiat)
    setRfNodes(prev => prev.map(n => n.id === id
      ? { ...n, data: { ...n.data, isCompleted: !wasCompleted } }
      : n
    ))
    // 3) arêtes qui pointent vers ce nœud (target === id)
    const list = edgesIndex[id]
    if (!list?.length) return
    setRfEdges(prev => {
      let changed = false
      const next = prev.map(e => {
        if (!list.includes(String(e.id))) return e
        const shouldAnim = wasCompleted /* si c’était complété, ça redevient non-complété => animer */
        if (e.animated === shouldAnim) return e
        changed = true
        return { ...e, animated: shouldAnim }
      })
      return changed ? next : prev
    })
  }, [isCompleted, toggleQuest, edgesIndex])

  return (    
    <div className="graph">
      {/* Boutons Achievements (en bas-gauche, au-dessus des Controls) */}
      {selectedAch && (
        <div
          className="selected-ach-banner"
          style={{ position: 'absolute', left: 60, bottom: 120, zIndex: 7, maxWidth: '46vw' }}
        >
          <span className="label">🏆 Selected:</span>
          {!!(selectedAch as any)?.icon && (
            <img className="ach-icon" src={(selectedAch as any).icon} alt="" loading="lazy" />
          )}          
          <strong className="title" title={selectedAch.title}>{selectedAch.title}</strong>
          <button
            className="btn-clear-ach"
            onClick={() => { setSelectedAch(null); removeAchBoxNode() }}
            title="Clear selection"
          >
            ✖
          </button>
        </div>
      )}
      <div
        style={{ position: 'absolute', left: 60, bottom: 70, zIndex: 7 }}
      >
      <button
        className="btn-achievements"
        onClick={() => setShowAchModal(true)}
        aria-label={t('ui.achievements.show','Show Achievements')}
        title={t('ui.achievements.show','Show Achievements')}
      >
        <span>{t('ui.achievements.show','Show Achievements')}</span>
      </button>
      </div>   
      <div style={{ position: 'absolute', zIndex: 5, display:'flex', gap:8, padding:8, alignItems:'center', flexWrap:'wrap', maxWidth:'80vw' }}>
        {/* Row 2: Types */}
        <div className="toolbar-row">
          <span className="toolbar-label">{t('ui.filters.types','Types:')}</span>
          <button className="toggle" onClick={() => setTypeOn(Object.fromEntries(allTypes.map(t => [t, true])))}>
            {t('ui.filters.showAllTypes','Show all types')}
          </button>
          <button className="toggle" onClick={() => setTypeOn(Object.fromEntries(allTypes.map(t => [t, false])))}>
            {t('ui.filters.hideAllTypes','Hide all types')}
          </button>
          {allTypes.map((raw) => {
            const t = normalizeType(raw)
            return (
             <button
              key={`type-${t}`}
               className={`toggle ${typeOn[t] ? 'on' : ''}`}
               onClick={() => setTypeOn(prev => ({ ...prev, [t]: !prev[t] }))}
               title={typeOn[t] ? `Hide ${t}` : `Show ${t}`}
             >
              <img
                className="type-icon"
                src={TYPE_ICON_PATHS[t] ?? withBase('/icons/icon_objective_quest.png')}
                alt=""
                loading="lazy"
              />
              {t}
             </button>
          )})}
          {/* Unique toggle for repeatable quests */}
            <button
              className={`toggle repeatable ${showRepeatables ? 'on' : ''}`}
              onClick={() => setShowRepeatables(v => !v)}
              title="Toggle repeatable quests"
            >
              Repeatable
            </button>
        </div>
        {/* Row 3: Zones */}
        <div className="toolbar-row">
          <span className="toolbar-label">{t('ui.filters.zones','Zones:')}</span>
          <button className="toggle" onClick={() => setZoneOn(Object.fromEntries(allZones.map(z => [z.key, true])))}>
            {t('ui.filters.showAllZones','Show all zones')}
          </button>
          <button className="toggle" onClick={() => setZoneOn(Object.fromEntries(allZones.map(z => [z.key, false])))}>
            {t('ui.filters.hideAllZones','Hide all zones')}
          </button>
          {allZones.map((z) => {
            const on = zoneOn[z.key]
            return (
              <button
                key={`zone-${z.key}`}
                className={`toggle zone ${on ? 'on' : ''}`}
                onClick={() => setZoneOn(prev => ({ ...prev, [z.key]: !prev[z.key] }))}
                title={on ? `Hide zone ${z.label}` : `Show zone ${z.label}`}
                style={{
                  borderColor: z.color,
                  background: on ? `linear-gradient(0deg, ${z.color}33, ${z.color}33)` : 'transparent',
                  color: on ? '#fff' : undefined,
                }}
              >
                <span className="legend-dot" style={{ backgroundColor: z.color }} />
                {z.label}
              </button>
            )
          })}
        </div>
      </div>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgeClick={handleEdgeClick}
        onNodeDragStop={handleNodeDragStop}
        onMouseDown={onPaneMouseDown}         /* démarre la sélection au clic droit */
        onContextMenu={(e)=>{                 /* bloque le menu contextuel si on vient de faire un drag au bouton droit */
          if (preventCtx.current) e.preventDefault();
        }}
        /* Améliore l’ergonomie de déplacement */
        panOnDrag={true}
        nodesDraggable={!lockNodes}
        panOnScroll={true}
        selectionOnDrag={false}
        zoomOnDoubleClick={true}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onlyRenderVisibleElements={true}
        defaultEdgeOptions={{ interactionWidth: 24 }}
      >
        {/* Overlay visuel de la sélection rectangulaire */}
        {marquee && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(marquee.start.x, marquee.end.x),
              top: Math.min(marquee.start.y, marquee.end.y),
              width: Math.abs(marquee.end.x - marquee.start.x),
              height: Math.abs(marquee.end.y - marquee.start.y),
              border: '1px dashed #f59e0b',           /* orange */
              background: 'rgba(245,158,11,0.12)',
              pointerEvents: 'none',
              zIndex: 9,
            }}
          />
        )}
        <MiniMap
          className="minimap--white-viewport"
          position="bottom-right"
          style={{ backgroundColor:'#0b0f14', right: 0, bottom: 0 }}
          maskColor="rgba(0,0,0,0.15)"
          nodeStrokeColor="#e2e8f0"
          nodeBorderRadius={2}
          /* Rendu custom + fallback couleur par zone (évite le blanc) */
          nodeComponent={MiniMapNode}
          nodeColor={(n)=> getZoneByIdPrefix(String(n.id)).color}
        />
        {/* Custom lock that only affects node dragging */}
        <Controls showInteractive={false} style={{ bottom: 20 }}>
          <ControlButton
            className={`rf-lock-btn ${lockNodes ? 'locked' : 'unlocked'}`}
            onClick={() => setLockNodes(v => !v)}
            title={lockNodes ? t('ui.controls.unlock','Unlock node dragging') : t('ui.controls.lock','Lock node dragging')}
            aria-label={lockNodes ? t('ui.controls.unlock','Unlock node dragging') : t('ui.controls.lock','Lock node dragging')}
          >
            {lockNodes ? '🔒' : '🔓'}
          </ControlButton>
          {/* Back to start: positionné à côté des Controls */}
          <ControlButton
            onClick={() => {
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
            }}
            title={t('ui.controls.back','Back to start')}
            aria-label={t('ui.controls.back','Back to start')}
          >
            ↖️
          </ControlButton>          
        </Controls>
        {/* Reset Graph (à gauche de la minimap, en bas-droite) */}
        <div style={{ position: 'absolute', right: 205, bottom: 5, zIndex: 7 }}>
          <button
            className="btn-reset-graph btn-reset-graph--quests"
            onClick={() => setShowResetPosConfirm(true)}
            title={t('ui.controls.reset','Reset positions')}
          >
            <span className="icon">↺</span>
            {t('ui.controls.reset','Reset positions')}
          </button>
        </div>
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
      {/* Reset positions (quests) — modal de confirmation */}
      {showResetPosConfirm && (
        <div
          onClick={() => setShowResetPosConfirm(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0f172a',
              color: 'white',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: 16,
              minWidth: 360,
              boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
              {t('ui.controls.reset','Reset positions')}
            </h3>
            <p style={{ margin: 0 }}>
              {t('ui.confirm.reset.quests','Reset quest positions? This removes all your manual moves.')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  try { (useStore.getState() as any).resetLayoutPos?.('quests') } catch {}
                  setUserPos({})
                  setLayoutEpoch(e => e + 1)
                  setShowResetPosConfirm(false)
                }}
              >
                {t('ui.confirm','Confirm')}
              </button>
              <button onClick={() => setShowResetPosConfirm(false)}>
                {t('ui.cancel','Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}      
      {/* Modal Achievements */}
      {showAchModal && (
        <div
          onClick={() => setShowAchModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0f172a',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 10,
              width: 'min(820px, 92vw)',
              maxHeight: '70vh',
              padding: 18,
              boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 18, letterSpacing: 0.2 }}>
                {t('ui.achievements.select','Select an achievement')}
              </h3>
              <button onClick={() => setShowAchModal(false)}>{t('ui.common.close','Close')}</button>
            </div>
            <div style={{ overflow: 'auto', borderTop: '1px solid #1f2937', paddingTop: 8 }}>
              {achievements.map(a => {
                const stat = achStats.find(s => s.id === a.id)
                const total = stat?.total ?? (a.quests?.length ?? 0)
                const done = stat?.done ?? 0
                const complete = !!stat?.complete
                const pct = total > 0 ? Math.round((done / total) * 100) : 0
                // Couleur de zone dominante déduite des quêtes de l'achievement
                const zoneCount: Record<string, number> = {}
                for (const qid of a.quests) {
                  const z = getZoneByIdPrefix(String(qid)) as any
                  const color = String(z?.color ?? '#94a3b8')
                  zoneCount[color] = (zoneCount[color] ?? 0) + 1
                }
                const zoneColor =
                  Object.entries(zoneCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '#94a3b8'
                 
                return (
                  <div
                    key={a.id}
                    style={{
                      display:'flex',
                      alignItems:'center',
                      gap: 12,
                      padding: '10px 8px',
                      borderBottom: '1px solid #1f2937',
                      borderLeft: `6px solid ${zoneColor}`,
                      background: complete
                        ? 'linear-gradient(90deg, rgba(34,197,94,0.08), transparent 60%)'
                        : 'transparent',
                    }}
                  >
                    {!!(a as any).icon && (
                      <img className="ach-icon" src={(a as any).icon} alt="" loading="lazy" />
                    )}                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.title}
                        </div>
                        {complete && <span title="Completed">✅</span>}
                      </div>
                      {!!a.description && (
                        <div style={{ opacity: 0.85, fontSize: 12, marginTop: 4, lineHeight: 1.25 }}>
                          {a.description}
                        </div>
                      )}
                      <div style={{ opacity: 0.8, fontSize: 12, marginTop: 2 }}>
                        {done} / {total} {t('ui.achievements.questsCompleted','quests completed')}
                      </div>
                      <div style={{ marginTop: 6, height: 8, background:'#1f2937', borderRadius: 999, overflow:'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background:'#22c55e' }} />
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedAch(a)
                        setShowAchModal(false)
                        // fitView sur les quêtes de l'achievement (celles qui sont affichées)
                        const nodes = reactFlow.getNodes()
                        const setIds = new Set(a.quests)
                        const present = nodes.filter(n => setIds.has(n.id)).map(n => ({ id: n.id }))
                        if (present.length) {
                          reactFlow.fitView({ nodes: present, padding: 0.2, duration: 400, includeHiddenNodes: false })
                        }
                        updateAchBoxForIds(a.quests, complete)
                      }}
                      title="Focus on this achievement"
                    >
                      {t('ui.achievements.focus','Focus')}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}      
      {/* Reset confirmation overlay */}
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
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Reset progress</h3>
            <p style={{ margin: 0 }}>Are you sure you want to delete all of this character&apos;s quests progress?</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { resetProgress(); setShowResetConfirm(false) }}>
                Yes, I&apos;m sure
              </button>              <button onClick={() => setShowResetConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Graph({ quests, lang }: { quests: Quest[]; lang?: string }) {
  // Fournit le contexte React Flow pour GraphInner (où l’on utilise useReactFlow).
  return (
    <ReactFlowProvider>
      <GraphInner quests={quests} lang={lang ?? 'en-us'} />
    </ReactFlowProvider>
  )
}
