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

    // --- Post-traitement : "première connexion alignée", suivantes en dessous ---
    // enfants POSITIFS uniquement (les NOT n'influencent pas le placement)
    const children: Record<string, string[]> = {}
    const inDeg: Record<string, number> = {}
    for (const e of edgesPos) {
      (children[e.source] ||= []).push(e.target)
      inDeg[e.target] = (inDeg[e.target] || 0) + 1
      inDeg[e.source] = inDeg[e.source] || 0
    }
    // on peut trier les enfants pour donner une stabilité visuelle (ex: par id)
    for (const k of Object.keys(children)) {
      children[k].sort((a, b) => a.localeCompare(b))
    }

    const nodeMap: Record<string, any> = {}
    for (const n of laid.nodes) nodeMap[n.id] = n

    // Trouver des racines (sans entrée positive) pour propager l'alignement
    const roots = laid.nodes
      .map(n => n.id)
      .filter(id => (inDeg[id] || 0) === 0)

    const ROW_STEP = 120 // décalage vertical entre "branches" sœurs
    const seen = new Set<string>()

    function alignPrimaryChain(sourceId: string) {
      if (seen.has(sourceId)) return
      seen.add(sourceId)
      const kids = children[sourceId] || []
      if (!kids.length) return
      const parent = nodeMap[sourceId]
      // 1) premier enfant sur la même ligne (même Y) que le parent
      const first = nodeMap[kids[0]]
      if (first) first.position.y = parent.position.y
      // 2) les suivants descendent l’un sous l’autre
      for (let i = 1; i < kids.length; i++) {
        const k = nodeMap[kids[i]]
        if (!k) continue
        k.position.y = parent.position.y + i * ROW_STEP
      }
      // 3) propager à la chaîne primaire suivante (le "first" devient le parent)
      alignPrimaryChain(kids[0])
      // (les autres branches suivent le layout dagre de base)
    }

    for (const r of roots) alignPrimaryChain(r)

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

  return (
    <div className="graph">
      <div style={{ position: 'absolute', zIndex: 5, display:'flex', gap:8, padding:8 }}>
        <select value={direction} onChange={(e)=>setDirection(e.target.value as any)}>
          <option value="LR">Gauche → Droite</option>
          <option value="TB">Haut → Bas</option>
        </select>
        <label className="controls">
    