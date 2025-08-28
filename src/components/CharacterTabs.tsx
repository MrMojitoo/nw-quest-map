import React, { useState } from 'react'
import useStore from '../store'

export default function CharacterTabs() {
  const { characters, activeId, addCharacter, setActive } = useStore()
  const [name, setName] = useState('')

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'flex-end' }}>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {characters.map(c => (
          <button key={c.id} onClick={()=>setActive(c.id)} className="button" style={{ borderColor: c.id===activeId ? 'var(--accent)' : 'var(--border)' }}>{c.name}</button>
        ))}
      </div>
      <input placeholder="Nouveau perso…" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter' && name.trim()) { addCharacter(name.trim()); setName('') } }} />
      <button onClick={()=>{ if(name.trim()) { addCharacter(name.trim()); setName('') } }}>Ajouter</button>
    </div>
  )
}
