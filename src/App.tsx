import React, { createContext, useEffect, useMemo, useRef, useState } from 'react'
import Graph from './components/Graph'
import Sidebar from './components/Sidebar'
import CharacterTabs from './components/CharacterTabs'
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
  priority?: number
}

type Data = {
  generated_at: string
  quest_count: number
  edge_count: number
  quests: Quest[]
}

// Contexte de locale (partagé à toute l'app)
type LocaleBag = {
  lang: string
  locale: Record<string, string> | null
  ui: Record<string, string>
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}

export const LocaleContext = createContext<LocaleBag>({
  lang: 'en-us',
  locale: null,
  ui: {},
  t: (_k, fb, vars) => {
    const s = fb ?? ''
    return s.replace(/\{(\w+)\}/g, (_m, k) => (vars && k in (vars as any) ? String((vars as any)[k]) : `{${k}}`))
  },
})

export default function App() {
  // Helper: préfixer une ressource avec la base (GitHub Pages => /nw-quest-map/)
  const withBase = (p: string) =>
    (import.meta.env.BASE_URL + String(p || '').replace(/^\//, ''))
      .replace(/([^:]\/)\/+/g, '$1')  
  // Sélecteur de langue
  const [lang, setLang] = useState<string>(() => {
    try { return localStorage.getItem('nwqm_lang') || 'en-us' } catch { return 'en-us' }
  })
  useEffect(() => {
    try { localStorage.setItem('nwqm_lang', lang) } catch {}
  }, [lang])



  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Charger la locale UNE seule fois par langue
  const [localeMap, setLocaleMap] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    if (lang === 'en-us') { setLocaleMap(null); return }
    const url = withBase(`lang/${lang}.json`)
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then(setLocaleMap)
      .catch(() => setLocaleMap(null))
  }, [lang])
 
  // --- Modern language popover ---
  const LANGS = [
    { code: 'en-us', label: 'EN', name: 'English',  flag: '🇺🇸' },
    { code: 'de-de', label: 'DE', name: 'Deutsch',  flag: '🇩🇪' },
    { code: 'es-es', label: 'ES', name: 'Español',  flag: '🇪🇸' },
    { code: 'es-mx', label: 'MX', name: 'Español (MX)', flag: '🇲🇽' },
    { code: 'fr-fr', label: 'FR', name: 'Français', flag: '🇫🇷' },
    { code: 'it-it', label: 'IT', name: 'Italiano', flag: '🇮🇹' },
    { code: 'pl-pl', label: 'PL', name: 'Polski',   flag: '🇵🇱' },
    { code: 'pt-br', label: 'PT', name: 'Português (BR)', flag: '🇧🇷' },
  ]
  const currentLang = LANGS.find(l => l.code === lang) ?? LANGS[0]
  const [langOpen, setLangOpen] = useState(false)
  const langMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!langMenuRef.current) return
      if (!langMenuRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])
  const selectLang = (code: string) => {
    setLang(code)
    try { localStorage.setItem('nwqm_lang', code) } catch {}
    setLangOpen(false)
  }


  // --- Dictionnaire UI (tes textes d’interface) ---
  // Valeurs EN par défaut (fallback si un fichier UI/<lang>.json n’est pas fourni)
  const UI_DEFAULT: Record<string, string> = {
    'ui.search.placeholder': 'Search quests (Name or ID)…',
    'ui.search.clear': 'Clear search',

    'ui.filters.types': 'Types:',
    'ui.filters.showAllTypes': 'Show all types',
    'ui.filters.hideAllTypes': 'Hide all types',
    'ui.filters.zones': 'Zones:',
    'ui.filters.showAllZones': 'Show all zones',
    'ui.filters.hideAllZones': 'Hide all zones',
    'ui.filters.repeatables': 'Repeatables',

    'ui.achievements.show': 'Show Achievements',
    'ui.achievements.select': 'Select an achievement',
    'ui.achievements.questsCompleted': 'quests completed',
    'ui.achievements.focus': 'Focus',
    'ui.common.close': 'Close',

    'ui.controls.back': 'Back to start',
    'ui.controls.unlock': 'Unlock node dragging',
    'ui.controls.lock': 'Lock node dragging',
    
    'ui.level.desc': 'Reach level',    

    'ui.progress.title': 'PROGRESS',
    'ui.progress.reset': 'Reset',
    'ui.progress.resetDesc': 'Reset progress',
    'ui.progress.resetConfirm': 'Reset progress for the active character?',
    'ui.progress.bulkMarkDone': 'Mark all {count} "{type}" quests as completed?',
    'ui.progress.bulkMarkUndone': 'Mark all {count} "{type}" quests as not completed?',
    'ui.progress.bulkUnmark': 'Unmark all {type} quests',
    'ui.progress.bulkMark': 'Mark all {type} quests as completed',

    'ui.help': 'Help',
    'ui.help.open': 'Open help panel',
    'ui.help.hide': 'Hide help panel',

    'ui.sidebar.information': 'Information',
    'ui.sidebar.about': 'About this map',
    'ui.sidebar.about.text':
      'Interactive quest flow for New World: filter by type/zone, pan & zoom, and track your character’s progress locally in your browser.',
    'ui.sidebar.howto.title': 'How to use',
    'ui.sidebar.howto.drag': 'Drag the canvas to pan (with mouse click or wheel or SHIFT+wheel)',
    'ui.sidebar.howto.zoom': 'Use the CTRL+wheel or buttons to zoom.',
    'ui.sidebar.howto.minimap': 'You can click on the minimap to move anywhere.',
    'ui.sidebar.howto.search': 'You can search for any quest with the search bar (Name or ID)',
    'ui.sidebar.howto.reorganize': 'Drag cards to reorganize (disabled when “Lock” 🔒 is enabled).',
    'ui.sidebar.howto.center': 'If you are lost, use the ↖️ button to center the view on first card',
    'ui.sidebar.howto.copyId': 'Click a card ID to copy it.',
    'ui.sidebar.howto.followEdge': 'Click an edge end to jump along the link.',
    'ui.sidebar.howto.character': 'Create a character to track quests per character.',
    'ui.sidebar.howto.tasks': 'Open the Tasks dropdown to see POIs and mobs (links to nw-buddy and NWDB on clicks).',

    'ui.char.newPlaceholder': 'New character…',
    'ui.char.add': 'Add',
    'ui.char.delete': 'Delete character',
    'ui.char.deleteConfirm': 'Delete character “{name}”? This will remove its saved progress.',

    'ui.card.tasks': 'Tasks',
    'ui.card.markDone': 'Mark as completed',
    'ui.card.markUndone': 'Mark as not completed'
  }
  const [uiMap, setUiMap] = useState<Record<string, string>>({})
  useEffect(() => {
    // charge toujours depuis public/lang/ui/ui-<lang>.json
    const url = withBase(`lang/ui/ui-${lang}.json`)
    fetch(url)
      .then(r => (r.ok ? r.json() : {}))
      .then((json) => setUiMap(json || {}))
      .catch(() => setUiMap({}))
  }, [lang])
  const t = useMemo(() => {
    const interpolate = (s: string, vars?: Record<string, string | number>) =>
      s.replace(/\{(\w+)\}/g, (_m, k) => (vars && k in (vars as any) ? String((vars as any)[k]) : `{${k}}`))
    return (key: string, fallback?: string, vars?: Record<string, string | number>) => {
      const base =
        (lang !== 'en-us' && uiMap && key in uiMap) ? uiMap[key] :
        (key in UI_DEFAULT ? UI_DEFAULT[key] : (fallback ?? key))
      return interpolate(base, vars)
    }
  }, [lang, uiMap])

  useEffect(() => {
    setLoading(true)
    fetch(withBase(`data/${lang}/quests.json`))
      .then(r => r.json())
      .then((json: Data) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [lang])

  const activeCharacter = useStore(s => s.characters.find(c => c.id === s.activeId))

  if (loading) return <div className="center">Chargement…</div>
  if (error || !data) return <div className="center error">Erreur : {error ?? 'données introuvables'}</div>

  const prettyGeneratedAt = new Date(data.generated_at).toLocaleString()

  return (
    <LocaleContext.Provider value={{ lang, locale: localeMap, ui: (lang === 'en-us' ? {} : uiMap), t }}>

      <div className="layout">
        <header className="topbar">
        <div className="brand">
          <span className="brand-title">New World Quest Map</span>
          <span className="brand-sub">Quest planner & tracker</span>
        </div>
          {/* Modern language selector (popover) */}
          <div className="lang-switcher" aria-label="Language selector">
            <div className="lang-menu" ref={langMenuRef}>
              <button
                type="button"
                className="lang-btn"
                aria-haspopup="menu"
                aria-expanded={langOpen}
                onClick={() => setLangOpen(v => !v)}
              >
                <span className="flag" aria-hidden="true">{currentLang.flag}</span>
                <span className="code">{currentLang.label}</span>
                <span className="chev" aria-hidden="true">▾</span>
              </button>
              {langOpen && (
                <div className="lang-popover" role="menu">
                  {LANGS.map(opt => (
                    <button
                      key={opt.code}
                      role="menuitemradio"
                      aria-checked={opt.code === lang}
                      className={`lang-item ${opt.code === lang ? 'active' : ''}`}
                      onClick={() => selectLang(opt.code)}
                    >
                      <span className="flag" aria-hidden="true">{opt.flag}</span>
                      <span className="name">{opt.name}</span>
                      <span className="code">{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        <SearchBar />
        <CharacterTabs />
        </header>
        <section className="content">
          <Graph quests={data.quests} lang={lang} />
          <Sidebar lang={lang} />
        </section>
        <footer className="footer">
          <div className="muted footer-right">
            Updated data on {prettyGeneratedAt}
          </div>
        </footer>
      </div>
    </LocaleContext.Provider>
  )
}
