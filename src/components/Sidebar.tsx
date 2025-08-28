import React from 'react'
import useStore from '../store'

export default function Sidebar() {
  const { characters, activeId } = useStore()
  const active = characters.find(c => c.id === activeId)
  const total = Object.keys(active?.completed ?? {}).length

  return (
    <aside className="sidebar">
      <div className="title">Panneau</div>
      <div className="section">
        <div className="muted">Suivi local (navigateur) par personnage.</div>
        <ul>
          <li>Pan & zoom à la souris</li>
          <li>Glisser les cartes pour réorganiser</li>
          <li>Flèches = prérequis → objectif</li>
        </ul>
      </div>
      <div className="section">
        <div className="title">Progression</div>
        <div>Quêtes cochées : <strong>{total}</strong></div>
      </div>
      <div className="section muted" style={{fontSize:12}}>
        Astuce : Double-cliquez sur la carte pour centrer. Utilisez la vue « Haut → Bas » pour les longues chaînes.
      </div>
    </aside>
  )
}
