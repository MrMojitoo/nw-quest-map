import { create } from 'zustand'
import { persist as persistMiddleware } from 'zustand/middleware'

type Character = {
  id: string
  name: string
  completed: Record<string, boolean>
}

type State = {
  characters: Character[]
  activeId: string | null
  
  addCharacter: (name: string) => void
  setActive: (id: string) => void
  deleteCharacter: (id: string) => void
  toggleQuest: (questId: string) => void
  isCompleted: (questId: string) => boolean
  resetProgress: () => void
  batchSetCompleted: (questIds: string[], completed: boolean) => void
  completedVersion: number
}

const genId = () => 'c_' + Math.random().toString(36).slice(2, 9)

const useStore = create<State>()(
  persistMiddleware(
    (set, get) => ({
      characters: [{ id: 'default', name: 'Default', completed: {} }],
      activeId: 'default',

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
    }),
    { name: 'nwq-progress-v1' }
  )
)

export default useStore