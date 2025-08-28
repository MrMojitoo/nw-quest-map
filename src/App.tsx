import React, { useEffect, useState } from 'react'
import Graph from './components/Graph'
import Sidebar from './components/Sidebar'
import CharacterTabs from './components/CharacterTabs'
import Legend from './components/Legend'
import SearchBar from './components/SearchBar'
import useStore from './store'
import './styles.css'

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
  achievement_id?: string|null
  required_achievements_expr?: string|null
  prerequisites: string[]
  not_prerequisites?: string[]
  repeatable?: boolean
}

type Data = {
  generated_at: string
  quest_count: number
  edge_count: number
  quests: Quest[]
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/data/quests.json')
      .then(r => r.json())
      .then((json: Data) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const activeCharacter = useStore(s => s.characters.find(c => c.id === s.activeId))

  if (loading) return <div className="center">Chargement…</div>
  if (error || !data) return <div className="center error">Erreur : {error ?? 'données introuvables'}</div>

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">New World – Carte des Quêtes</div>
        <SearchBar />
        <CharacterTabs />
      </header>
      <section className="content">
        <Graph quests={data.quests} />
        <Sidebar />
      </section>
      <footer className="footer">
        <Legend quests={data.quests} />
        <div className="muted">
          Données générées le {new Date(data.generated_at).toLocaleString()}
          {' '}— Personnage actif : <strong>{activeCharacter?.name ?? '—'}</strong>
        </div>      </footer>
    </div>
  )
}
