import { create } from 'zustand'
import { persist as persistMiddleware } from 'zustand/middleware'

type Character = {
  id: string
  name: string
  completed: Record<string, boolean>
}
 
type LayoutPos = {
  quests: Record<string, { x: number; y: number }>
  artifacts: Record<string, { x: number; y: number }>
}


type State = {
  characters: Character[]
  activeId: string | null
  layoutPos: LayoutPos
  
  addCharacter: (name: string) => void
  setActive: (id: string) => void
  deleteCharacter: (id: string) => void
  toggleQuest: (questId: string) => void
  isCompleted: (questId: string) => boolean
  resetProgress: () => void
  batchSetCompleted: (questIds: string[], completed: boolean) => void
  completedVersion: number
  /** Définir la position d'un nœud */
  setNodePos: (view: 'quests'|'artifacts', id: string, pos: { x: number; y: number }) => void
  /** Définir plusieurs positions d'un coup */
  setManyNodePos: (view: 'quests'|'artifacts', updates: Record<string, { x: number; y: number }>) => void
  /** Réinitialiser toutes les positions d'une vue */
  resetLayoutPos: (view: 'quests'|'artifacts') => void
  /** Export all user data (all characters) into a portable payload */
  exportData: () => ExportPayload
  /** Import user data payload (merge by default, or 'replace') */
  importData: (payload: unknown, strategy?: 'merge'|'replace') => { ok: boolean; reason?: string }
}
 
type ExportPayload = {
  format: 'nwqm-export-v1'
  exportedAt: string
  activeId: string | null
  characters: Character[]
  /** Positions manuelles (incluses dans l'export) */
  layoutPos: LayoutPos
}

const genId = () => 'c_' + Math.random().toString(36).slice(2, 9)

const useStore = create<State>()(
  persistMiddleware(
    (set, get) => ({
      characters: [{ id: 'default', name: 'Default', completed: {} }],
      activeId: 'default',
      layoutPos: { quests: {}, artifacts: {} },

      addCharacter: (name) =>
        set((s) => {
          const id = genId()
          return {
            characters: [...s.characters, { id, name, completed: {} }],
            activeId: id,
          }
        }),

      setActive: (id) => set({ activeId: id }),
      
      deleteCharacter: (id) =>
        set((s) => {
          const characters = s.characters.filter((c) => c.id !== id)
          const activeId = s.activeId === id ? (characters[0]?.id ?? null) : s.activeId
          // If you keep per-character progress in state, clean it here as well.
          // Example if you have: completedByCharacter: Record<string, Record<string, boolean>>
          // const { [id]: _drop, ...rest } = s.completedByCharacter ?? {}
          return {
            characters,
            activeId,
            // completedByCharacter: rest,
          }
        }),

      toggleQuest: (questId) =>
        set((s) => {
          const active = s.activeId ?? 'default'
          const updated = s.characters.map((c) => {
            if (c.id !== active) return c
            const next = { ...c.completed, [questId]: !c.completed[questId] }
            return { ...c, completed: next }
          })
          return { characters: updated, completedVersion: Date.now() }
        }),

      // Marquer en lot (utilisé par la sidebar pour cocher/décocher toutes les quêtes d’un type)
      batchSetCompleted: (questIds, completed) =>
        set((s) => {
          if (!questIds || questIds.length === 0) return {}
          const active = s.activeId ?? 'default'
          const updated = s.characters.map((c) => {
            if (c.id !== active) return c
            const next = { ...c.completed }
            if (completed) {
              // Marquer toutes comme complétées
              for (const id of questIds) {
                next[id] = true
              }
            } else {
              // Marquer toutes comme non complétées (on met false pour rester cohérent avec toggleQuest)
              for (const id of questIds) {
                next[id] = false
              }
            }
            return { ...c, completed: next }
          })
          return { characters: updated, completedVersion: Date.now() }
        }),

      isCompleted: (questId) => {
        const s = get()
        const active = s.activeId ?? 'default'
        const c = s.characters.find((c) => c.id === active)
        return !!c?.completed[questId]
      },

      resetProgress: () =>
        set((s) => {
          const active = s.activeId ?? 'default'
          const updated = s.characters.map((c) =>
            c.id === active ? { ...c, completed: {} } : c
          )
          return { characters: updated, completedVersion: Date.now() }
        }),

      completedVersion: 0,

      setNodePos: (view, id, pos) =>
        set((s) => ({
          layoutPos: {
            ...s.layoutPos,
            [view]: {
              ...s.layoutPos[view],
              [id]: { x: Math.round(pos.x), y: Math.round(pos.y) },
            },
          },
        })),

      setManyNodePos: (view, updates) =>
        set((s) => {
          const next = { ...s.layoutPos[view] }
          for (const [id, p] of Object.entries(updates)) {
            next[id] = { x: Math.round(p.x), y: Math.round(p.y) }
          }
          return { layoutPos: { ...s.layoutPos, [view]: next } }
        }),

      resetLayoutPos: (view) =>
        set((s) => ({ layoutPos: { ...s.layoutPos, [view]: {} } })),

      exportData: () => {
        const { characters, activeId, layoutPos } = get()
        return {
          format: 'nwqm-export-v1',
          exportedAt: new Date().toISOString(),
          activeId,
          characters,
          layoutPos,
        }
      },

      importData: (payload, strategy = 'merge') => {
        try {
          const obj: any = payload
          const normalized = normalizePayload(obj)
          if (!normalized) return { ok: false, reason: 'invalid payload' }
          const prev = get()
          const nextChars =
            strategy === 'replace'
              ? sanitizeCharacters(normalized.characters)
              : mergeCharacters(prev.characters, normalized.characters)
          const nextActive =
            normalized.activeId && nextChars.some(c => c.id === normalized.activeId)
              ? normalized.activeId
              : (prev.activeId ?? nextChars[0]?.id ?? null)
          const nextLayout =
            normalized.layoutPos
              ? (strategy === 'replace'
                  ? sanitizeLayoutPos(normalized.layoutPos)
                  : mergeLayoutPos(prev.layoutPos, normalized.layoutPos))
              : prev.layoutPos
          set({
            characters: nextChars,
            activeId: nextActive,
            layoutPos: nextLayout,
            completedVersion: Date.now(),
          })
          return { ok: true }
        } catch (e) {
          return { ok: false, reason: String(e) }
        }
      },
    }),
    { name: 'nwq-progress-v1' }
  )
)
 
// -------- helpers (non exportés) --------
function normalizePayload(input: any): { activeId: string|null; characters: Character[]; layoutPos?: Partial<LayoutPos> } | null {
  // Notre format d’export
  if (input && input.format === 'nwqm-export-v1' && Array.isArray(input.characters)) {
    return {
      activeId: input.activeId ?? null,
      characters: sanitizeCharacters(input.characters),
      layoutPos: input.layoutPos,
    }
  }
  // Format "persist" de zustand: { state: { characters, activeId } }
  if (input && input.state && Array.isArray(input.state.characters)) {
    return {
      activeId: input.state.activeId ?? null,
      characters: sanitizeCharacters(input.state.characters),
      layoutPos: input.state.layoutPos,
    }
  }
  // Fallback brut: { characters, activeId }
  if (input && Array.isArray(input.characters)) {
    return {
      activeId: input.activeId ?? null,
      characters: sanitizeCharacters(input.characters),
      layoutPos: input.layoutPos,
    }
  }
  return null
}

function sanitizeCharacters(arr: any[]): Character[] {
  const seen = new Set<string>()
  return arr.map((raw, i) => {
    const id0 = String(raw?.id ?? '').trim()
    const id = id0 && !seen.has(id0) ? id0 : genId()
    seen.add(id)
    const name = String(raw?.name ?? `Character ${i+1}`).slice(0, 80)
    const completed: Record<string, boolean> = {}
    const src = raw?.completed ?? {}
    for (const k of Object.keys(src || {})) {
      completed[String(k)] = !!src[k]
    }
    return { id, name, completed }
  })
}

function mergeCharacters(oldChars: Character[], incomingRaw: any[]): Character[] {
  const incoming = sanitizeCharacters(incomingRaw)
  const out: Character[] = oldChars.map(c => ({ ...c, completed: { ...c.completed } }))
  const byId = new Map(out.map(c => [c.id, c]))
  const byName = new Map(out.map(c => [normalizeName(c.name), c]))
  for (const inc of incoming) {
    const dst = byId.get(inc.id) || byName.get(normalizeName(inc.name))
    if (dst) {
      for (const [qid, val] of Object.entries(inc.completed)) {
        if (val) dst.completed[qid] = true // union logique
      }
    } else {
      out.push(inc)
      byId.set(inc.id, inc)
      byName.set(normalizeName(inc.name), inc)
    }
  }
  return out
}
const normalizeName = (s: string) => String(s || '').trim().toLowerCase()
 
// --- helpers positions ---
function sanitizeLayoutPos(input: Partial<LayoutPos> | undefined | null): LayoutPos {
  const qp = coercePosMap((input as any)?.quests)
  const ap = coercePosMap((input as any)?.artifacts)
  return { quests: qp, artifacts: ap }
}

function mergeLayoutPos(base: LayoutPos, inc?: Partial<LayoutPos> | null): LayoutPos {
  if (!inc) return base
  const add = sanitizeLayoutPos(inc)
  return {
    quests: { ...base.quests, ...add.quests },
    artifacts: { ...base.artifacts, ...add.artifacts },
  }
}

function coercePosMap(obj: any): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  if (obj && typeof obj === 'object') {
    for (const [id, v] of Object.entries(obj)) {
      const x = Math.round(Number((v as any)?.x))
      const y = Math.round(Number((v as any)?.y))
      if (Number.isFinite(x) && Number.isFinite(y)) out[String(id)] = { x, y }
    }
  }
  return out
}


export default useStore