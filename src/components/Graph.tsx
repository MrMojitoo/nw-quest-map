import React, { useMemo, useState } from 'react'
import ReactFlow, { MiniMap, Controls, Background, BackgroundVariant, Node, Edge, MarkerType, Position, useReactFlow, ReactFlowProvider } from 'reactflow'
import { getZoneByIdPrefix } from '../utils/zones'

import 'reactflow/dist/style.css'
import dagre from 'dagre'
import NodeCard from './NodeCard'
import useStore from '../store'

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

const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))


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

const getLayouted = (nodes: Node[], edgesForLayout: Edge[], direction: 'LR'|'TB' = 'LR') => {
  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({ rankdir: direction, ranksep: 200, nodesep: 100, edgesep: 20 })
  nodes.forEach((n) => dagreGraph.setNode(n.id, { width: 240, height: 120 }))
  edgesForLayout.forEach((e) => dagreGraph.setEdge(e.source, e.target))
  dagre.layout(dagreGraph)
  const newNodes = nodes.map((n) => {
    const p: any = dagreGraph.node(n.id)
    return {
      ...n,
      position: { x: p.x - 120, y: p.y - 60 },
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
    }
  })
  return { nodes: newNodes }
}

function GraphInner({ quests }: { quests: Quest[] }) {
  const active = useStore(s => s.characters.find(c => c.id === s.activeId))
  const [direction, setDirection] = useState<'LR'|'TB'>('LR')
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [filterZone, setFilterZone] = useState<string>('all')
  const reactFlow = useReactFlow()


  const nodesEdges = useMemo(() => {
    const done = new Set(Object.keys(active?.completed ?? {}))
    const filtered = quests.filter(q => filterZone === 'all' || String(q.zone_id) === filterZone)

    const nodes: Node[] = filtered.map(q => ({
      id: q.id,
      type: 'card',
      data: q,
      position: { x: 0, y: 0 },
      draggable: true,
      style: onlyTodo && done.has(q.id) ? { opacity: 0.35 } : undefined,
    }))
    const edgesPos: Edge[] = []
    const edgesNeg: Edge[] = []
    const ids = new Set(filtered.map(f=>f.id))
    for (const q of filtered) {
      for (const src of q.prerequisites) {
        if (!ids.has(src)) continue
        if (src === q.id) continue
        edgesPos.push({
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
    const laid = getLayouted(nodes, edgesPos, direction)

    // --- Post-traitement : parent d'abord, gauche→droite ---
    // Seules les arêtes POSITIVES (blanches) structurent le placement
    const children: Record<string, string[]> = {}
    for (const e of edgesPos) {
      (children[e.source] ||= []).push(e.target)
    }
    // Tri enfants par priorité PUIS ID (MSQ = priority 0 en premier)
    const prio: Record<string, number> = {}
    for (const n of laid.nodes) prio[n.id] = (n.data as any)?.priority ?? 1
    for (const k of Object.keys(children)) {
      children[k].sort((a, b) => {
        const pa = prio[a] ?? 1, pb = prio[b] ?? 1
        if (pa !== pb) return pa - pb
        return a.localeCompare(b)
      })
    }
    const nodeMap: Record<string, any> = {}
    for (const n of laid.nodes) nodeMap[n.id] = n

    // Traitement parent→enfant en ordre de rang (X croissant)
    const ordered = [...laid.nodes].sort((a, b) => a.position.x - b.position.x)
    const ROW_STEP = 500
    const seen = new Set<string>()
    function alignFromParent(id: string) {
      if (seen.has(id)) return
      seen.add(id)
      const parent = nodeMap[id]
      if (!parent) return
      const kids = children[id] || []
      if (!kids.length) return
      // enfant primaire aligné sur le Y du parent
      const firstId = kids[0]
      const first = nodeMap[firstId]
      if (first) first.position.y = parent.position.y
      // enfants suivants en colonne sous le Y du parent
      for (let i = 1; i < kids.length; i++) {
        const kid = nodeMap[kids[i]]
        if (!kid) continue
        kid.position.y = parent.position.y + i * ROW_STEP
      }
      // propager immédiatement sur l'enfant primaire (garde la MSQ bien droite)
      if (first) alignFromParent(firstId)
    }
    for (const n of ordered) alignFromParent(n.id)
    return { nodes: laid.nodes, edges: [...edgesPos, ...edgesNeg] }
  }, [quests, direction, active?.completed, onlyTodo, filterZone])

  const zones = useMemo(() => {
    const set = new Set(quests.map(q => q.zone_id).filter((x:any) => x != null))
    return Array.from(set).sort((a:any,b:any)=>Number(a)-Number(b))
  }, [quests])

  
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
    nodesEdges.nodes.length,
    nodesEdges.edges.length,
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
            const ns = nodesEdges.nodes
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
      <ReactFlow nodes={nodesEdges.nodes} edges={nodesEdges.edges} nodeTypes={nodeTypes} fitView>
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
