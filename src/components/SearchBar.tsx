import React, { useEffect, useState } from 'react'

export default function SearchBar() {
  const [q, setQ] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const el = document.getElementById('search-input') as HTMLInputElement
        el?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    window.dispatchEvent(new CustomEvent('focus-node', { detail: { query } }))
  }

  return (
    <form onSubmit={onSubmit} className="controls" style={{ justifyContent:'center' }}>
      <input id="search-input" placeholder="Rechercher une quête (Ctrl/Cmd+K)…" value={q} onChange={e=>setQ(e.target.value)} />
      <button type="submit">OK</button>
    </form>
  )
}
