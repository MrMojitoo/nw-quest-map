import React, { useMemo, useState } from 'react'
import ReactFlow, { MiniMap, Controls, Background, BackgroundVariant, Node, Edge, MarkerType, Position, useReactFlow, ReactFlowProvider } from 'reactflow'
import { getZoneByIdPrefix } from '../utils/zones'

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

// Palette de couleurs cohérente avec les cartes (par zone)
function zoneColor(zoneId?: number|null) {
  const palette = [
    '#60a5fa','#34d399','#f59e0b','#f472b6','#22d3ee',
    '#a78bfa','#f87171','#10b981','#eab308','#fb7185',
    '#38bdf8','#c084fc','#fbbf24','#2dd4bf','#fca5a5',
    '#4ade80','#93c5fd','#fda4af'
  ]
  if (zoneId == null || (zoneId as any) < 0) return '#94a3b8'
  const idx = Number(zoneId) % palette.length
  return palette[idx]
}


const nodeTypes = { card: NodeCard }

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

const DEFAULT_RANKSEP = 160; // LR: horizontal | TB: vertical
const DEFAULT_NODESEP = 140; // LR: vertical   | TB: horizontal+
// === Heuristiques pour estimer la hauteur des cartes ===
const EST_NODE_BASE_H = 160;  // hauteur mini estimée d'une carte
const EST_LINE_H = 16;        // hauteur d'une ligne de texte
const SIBLING_STEP = 180;     // écart vertical entre enfants d'un même parent (au lieu de 300)
const BAND_GAP = 100;         // espace entre deux bandes (MSQ, LEVEL, Objective, …)

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
  reachableFromMsq?: boolean
): number {
  const t = (type || '').toLowerCase()
  if (t.includes('main story')) return 100
  if (reachableFromMsq) return 95
  if (id?.startsWith('LEVEL_')) return 90
  if (reachableFromLevel) return 89
  const p = computePriority(type, id)
  return p > 0 ? p * 10 - 20 : 0 // 8→60, 7→50, …, 1→-10 (rare)
}




function GraphInner({ quests }: { quests: Quest[] }) {
  const active = useStore(s => s.characters.find(c => c.id === s.activeId))
  const [direction, setDirection] = useState<'LR'|'TB'>('LR')
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [filterZone, setFilterZone] = useState<string>('all')
  const reactFlow = useReactFlow()
  // Résultat layouté (ELK étant async)
  const [rfNodes, setRfNodes] = React.useState<Node[]>([])
  const [rfEdges, setRfEdges] = React.useState<Edge[]>([])


  const base = useMemo(() => {
    const done = new Set(Object.keys(active?.completed ?? {}))
    const filtered = quests.filter(q => filterZone === 'all' || String(q.zone_id) === filterZone)
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
      data: q, // <- contient le required_level effectif
      position: { x: 0, y: 0 },
      draggable: true,
      style: onlyTodo && done.has(q.id) ? { opacity: 0.35 } : undefined,
    }))

    // === NŒUDS DE NIVEAU : "LEVEL_XX" ===
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
    Object.keys(levelParents).forEach((lvl) => {
      nodesRaw.push({
        id: `LEVEL_${lvl}`,
        type: 'card',
        data: {
          id: `LEVEL_${lvl}`,
          title: `Level ${lvl}`,
          type: 'Level',                      // type simple, s’affichera comme une carte
          description: `Atteindre le niveau ${lvl}`,
          required_level: Number(lvl),
          prerequisites: [],
          not_prerequisites: [],
          zone_id: null,
          rewards: [],
          priority: -2,                        // MSQ (priority 0) reste prioritaire
        },
        position: { x: 0, y: 0 },
        draggable: true,
      } as Node)
    })

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
          animated: !done.has(q.id),
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
    // Arêtes des nœuds LEVEL_XX vers les quêtes concernées
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

    // === Chaînage des niveaux entre eux (LEVEL_a -> LEVEL_b -> ...) ===
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
    return {
      nodesRaw,
      edgesPosRaw,
      edgesNeg,
      levelParents
    }
  }, [quests, direction, active?.completed, onlyTodo, filterZone])


  const zones = useMemo(() => {
    const set = new Set(quests.map(q => q.zone_id).filter((x:any) => x != null))
    return Array.from(set).sort((a:any,b:any)=>Number(a)-Number(b))
  }, [quests])

  
  // --- ELK layout async + post-traitements (LEVEL, MSQ, alignements, anti-chevauchement) ---
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { nodesRaw, edgesPosRaw, edgesNeg, levelParents } = base
      if (!nodesRaw?.length) {
        if (!cancelled) { setRfNodes([]); setRfEdges([]) }
        return
      }
      const isHorizontal = direction === 'LR'
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
         reachableFromMsq.has(n.id)
        )
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
          'elk.direction': isHorizontal ? 'RIGHT' : 'DOWN',
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

      const orderBands = [100, 95, 90, 89, 80, 70, 60, 50, 40, 30, 20, 10, 0]
      const nodesByBand: Record<number, string[]> = {}
      for (const n of ordered) {
        const b = ((nodeMap[n.id]?.data as any)?.band ?? 0)
        ;(nodesByBand[b] ||= []).push(n.id)
      }
      // point de départ : top actuel de la MSQ si elle existe, sinon top global
      const allIds = ordered.map(o => o.id)
      const minYAll = Math.min(...allIds.map(id => nodeMap[id].position.y))
      let cursorY = minYAll
      for (const b of orderBands) {
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

      if (!cancelled) {
        setRfNodes(laidNodes)
        setRfEdges([...edgesPosRaw, ...edgesNeg])
      }
    })()
    return () => { cancelled = true }
  }, [base, direction])

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
  }, [
    rfNodes.length,
    rfEdges.length,
    direction,
  ])

  return (
    <div className="graph">
      <div style={{ position: 'absolute', zIndex: 5, display:'flex', gap:8, padding:8 }}>
        <select value={direction} onChange={(e)=>setDirection(e.target.value as any)}>
          <option value="LR">Gauche → Droite</option>
          <option value="TB">Haut → Bas</option>
        </select>
        <label className="controls">
          <input type="checkbox" checked={onlyTodo} onChange={e=>setOnlyTodo(e.target.checked)} />
          Masquer les quêtes finies
        </label>
        <select value={filterZone} onChange={(e)=>setFilterZone(e.target.value)}>
          <option value="all">Toutes zones</option>
          {zones.map((z:any) => <option key={String(z)} value={String(z)}>Zone {String(z)}</option>)}
        </select>
        {/* Bouton pour revenir en haut à gauche */}
        <button
          onClick={() => {
            // Si on a des nœuds, on calcule le coin haut-gauche puis on centre dessus
            const ns = rfNodes
            if (!ns || ns.length === 0) return
            const minX = Math.min(...ns.map(n => n.position.x))
            const minY = Math.min(...ns.map(n => n.position.y))
            // on laisse un petit padding
            reactFlow.setViewport({ x: minX - 40, y: minY - 40, zoom: 1 }, { duration: 300 })
          }}
          title="Revenir en haut à gauche"
        >
          Revenir ↑←
        </button>
      </div>
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView>
        <MiniMap
          className="minimap--white-viewport"
          style={{ backgroundColor: '#0b0f14' }}
          maskColor="rgba(0,0,0,0.15)"   // masque plus léger → bordure visible
          nodeStrokeColor="#e2e8f0"
          nodeBorderRadius={2}
          nodeComponent={MiniMapNode}      // <— rendu custom fiable
        />
        <Controls />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  )
}

export default function Graph({ quests }: { quests: Quest[] }) {
  // Fournit le contexte React Flow pour GraphInner (où l’on utilise useReactFlow).
  return (
    <ReactFlowProvider>
      <GraphInner quests={quests} />
    </ReactFlowProvider>
  )
}
