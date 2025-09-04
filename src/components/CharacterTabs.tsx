import React, { useState, useContext } from 'react'
import useStore from '../store'
import { LocaleContext } from '../App'

export default function CharacterTabs() {
  const { t, lang } = useContext(LocaleContext)
  const { characters, activeId, addCharacter, setActive, deleteCharacter } = useStore()
  const [name, setName] = useState('')

  const onAdd = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    addCharacter(trimmed)
    setName('')
  }

  return (
    <div className="char-tabs">
      <div className="char-tab-list">
        {characters.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            className={`char-pill ${c.id === activeId ? 'active' : ''}`}
            title={c.name}
          >
            <span className="char-pill__name">{c.name}</span>
            <span
              className="char-close"
              title={t('ui.char.delete', 'Delete character')}
              onClick={(e) => {
                e.stopPropagation()
                const msg = t('ui.char.deleteConfirm','Delete character “{name}”? This will remove its saved progress.').replace('{name}', c.name)
                if (window.confirm(msg)) {
                  // Store provides the deletion; optional chaining avoids crashes
                  deleteCharacter?.(c.id)
                }
              }}
              aria-label={`${t('ui.char.delete','Delete character')} ${c.name}`}
            >
              ×
            </span>
          </button>
        ))}
      </div>
      <div className="char-add">
        <input
        key={lang}
          className="char-input"
          placeholder={t('ui.char.newPlaceholder','New character…')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAdd()
          }}
        />
        <button className="button" onClick={onAdd}>{t('ui.char.add','Add')}</button>
      </div>
    </div>
  )
}
