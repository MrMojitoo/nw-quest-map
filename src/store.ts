import { create } from 'zustand'

export type Character = { id: string; name: string; completed: Record<string, boolean> }

type State = {
  characters: Character[]
  activeId: string | null
  addCharacter: (name: string) => void
  renameCharacter: (id: string, name: string) => void
  removeCharacter: (id: string) => void
  setActive: (id: string) => void
  toggleQuest: (questId: string) => void
}

const KEY = 'nwq-characters-v1'

function load(): Pick<State,'characters'|'activeId'> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { characters: [], activeId: null }
    return JSON.parse(raw)
  } catch {
    return { characters: [], activeId: null }
  }
}

function persist(s: Pick<State,'characters'|'activeId'>) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

const useStore = create<State>((set, get) => ({
  ...load(),
  addCharacter: (name) => {
    const id = crypto.randomUUID()
    const characters = [...get().characters, { id, name, completed: {} }]
    set({ characters, activeId: id })
    persist({ characters, activeId: id })
  },
  renameCharacter: (id, name) => {
    const characters = get().characters.map(c => c.id === id ? { ...c, name } : c)
    set({ characters })
    persist({ characters, activeId: get().activeId })
  },
  removeCharacter: (id) => {
    const characters = get().characters.filter(c => c.id !== id)
    let activeId = get().activeId
    if (activeId === id) activeId = characters[0]?.id ?? null
    set({ characters, activeId })
    persist({ characters, activeId })
  },
  setActive: (id) => {
    set({ activeId: id })
    persist({ characters: get().characters, activeId: id })
  },
  toggleQuest: (questId) => {
    const { activeId, characters } = get()
    if (!activeId) return
    const updated = characters.map(c => {
      if (c.id !== activeId) return c
      const completed = { ...c.completed, [questId]: !c.completed[questId] }
      return { ...c, completed }
    })
    set({ characters: updated })
    persist({ characters: updated, activeId })
  },
}))

export default useStore
