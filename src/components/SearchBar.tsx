import React, { useEffect, useState, useContext } from 'react'
import { LocaleContext } from '../App'

export default function SearchBar() {
  const { t, lang } = useContext(LocaleContext)
  const [q, setQ] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const el = document.getElementById('search-input') as HTMLInputElement | null
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

  const onClear = () => {
    setQ('')
    const el = document.getElementById('search-input') as HTMLInputElement | null
    el?.focus()
  }

  return (
    <form onSubmit={onSubmit} className="search" role="search" aria-label={t('ui.search.placeholder','Search quests (Name or ID)...')}>
      <svg className="search__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 21l-4.35-4.35m1.6-4.65A7 7 0 1 1 7 5a7 7 0 0 1 11.25 7.0z"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        id="search-input"
        className="search__input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('ui.search.placeholder','Search quests (Name or ID)...')}
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      {q && (
        <button type="button" className="search__clear" onClick={onClear} aria-label={t('ui.search.clear','Clear search')}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </form>
  )
}