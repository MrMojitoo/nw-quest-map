import React, { createContext, useEffect, useMemo, useRef, useState } from 'react'
import Graph from './components/Graph'
import Sidebar from './components/Sidebar'
import CharacterTabs from './components/CharacterTabs'
import SearchBar from './components/SearchBar'
import Artifacts from './components/Artifacts'
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

type Artifact = {
  item_id: string
  name: string
  icon?: string
  type?: string
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
  const [tab, setTab] = useState<'quests'|'artifacts'>('quests')

  const LANGS = [
    { code: 'en-us', cc: 'us', label: 'EN', name: 'English' },
    { code: 'de-de', cc: 'de', label: 'DE', name: 'Deutsch' },
    { code: 'es-es', cc: 'es', label: 'ES', name: 'Español' },
    { code: 'es-mx', cc: 'mx', label: 'MX', name: 'Español (MX)' },
    { code: 'fr-fr', cc: 'fr', label: 'FR', name: 'Français' },
    { code: 'it-it', cc: 'it', label: 'IT', name: 'Italiano' },
    { code: 'pl-pl', cc: 'pl', label: 'PL', name: 'Polski' },
    { code: 'pt-br', cc: 'br', label: 'PT', name: 'Português (BR)' },
  ]
  const currentLang = LANGS.find(l => l.code === lang) ?? LANGS[0]
  const flagUrlFor = (cc?: string) =>
    cc ? `https://flagcdn.com/${cc}.svg` : ''
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

  
  // ----- Import / Export handlers -----
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const onExportClick = () => {
    const exp = (useStore.getState().exportData?.() as any) ?? {
      format: 'nwqm-export-v1',
      exportedAt: new Date().toISOString(),
      activeId: useStore.getState().activeId,
      characters: useStore.getState().characters,
    }
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0,16)
    a.href = url
    a.download = `nwqm-progress-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result || '{}'))
        const res = useStore.getState().importData
          ? useStore.getState().importData(json, 'merge') // merge par défaut (sécurisant)
          : (useStore.setState(() => {
              // Fallback ultra-minimal si l’action n’existe pas
              const characters = Array.isArray((json as any)?.characters)
                ? (json as any).characters
                : (json as any)?.state?.characters
              const activeId = (json as any)?.activeId ?? (json as any)?.state?.activeId ?? null
              if (!Array.isArray(characters)) throw new Error('no characters array')
              return { characters, activeId, completedVersion: Date.now() }
            }), { ok: true })
        alert(res?.ok ? t('ui.data.import.ok','Import successful!') : (t('ui.data.import.err','Import failed: invalid file.') + (res?.reason ? `\n${res.reason}` : '')))
      } catch {
        alert(t('ui.data.import.err','Import failed: invalid file.'))
      } finally {
        e.target.value = '' // permet de réimporter le même fichier
      }
    }
    reader.readAsText(f)
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

    'ui.achievements.show': '🏆 Show Achievements',
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
    // Data I/O
    'ui.data.export': 'Export',
    'ui.data.exportTitle': 'Download your data (all characters)',
    'ui.data.import': 'Import',
    'ui.data.importTitle': 'Import from a JSON file',
    'ui.data.import.ok': 'Import successful!',
    'ui.data.import.err': 'Import failed: invalid file.',

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
 
  // Charge les artéfacts (lazy quand on ouvre l’onglet)
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null)
  const [artifactsErr, setArtifactsErr] = useState<string | null>(null)
  useEffect(() => {
    if (tab !== 'artifacts') return
    setArtifacts(null); setArtifactsErr(null)
    fetch(withBase(`data/${lang}/artifacts.json`))
      .then(r => r.json())
      .then((json) => setArtifacts(json?.artifacts ?? []))
      .catch(e => setArtifactsErr(String(e)))
  }, [tab, lang])

  const openArtifacts = () => setTab('artifacts')
  const openQuests = () => setTab('quests')

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
          <nav className="tabs">
            <button className={`tab tab-quests ${tab==='quests'?'active':''}`} onClick={openQuests}>
              {t('ui.tabs.quests','Quests')}
            </button>
            <button className={`tab tab-artifacts ${tab==='artifacts'?'active':''}`} onClick={openArtifacts}>
              {t('ui.tabs.artifacts','Artifacts')}
            </button>
          </nav>
          {/* CENTRE : Lang + Search (même colonne) */}
          <div className="topbar-center">
            <div className="lang-switcher" aria-label="Language selector">
              <div className="lang-menu" ref={langMenuRef}>
                <button
                  type="button"
                  className="lang-btn"
                  aria-haspopup="menu"
                  aria-expanded={langOpen}
                  aria-label={currentLang.name}
                  onClick={() => setLangOpen(v => !v)}
                >
                  {currentLang.cc && (
                    <img className="flag-img" src={flagUrlFor(currentLang.cc)} alt={currentLang.label} />
                  )}
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
                        {opt.cc && (
                          <img className="flag-img" src={flagUrlFor(opt.cc)} alt={opt.label} />
                        )}
                        <span className="name">{opt.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <SearchBar />
          </div>

          {/* DROITE : onglets personnage  autres contrôles */}
          <div className="topbar-right">
            <CharacterTabs />
            <div className="data-io" role="group" aria-label="Data import/export">

              <button
                className="icon-btn"
                onClick={onExportClick}
                title={t('ui.data.exportTitle','Download your data (all characters)')}
                aria-label={t('ui.data.export','Export')}
              >
                {/* download icon */}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42L11 12.6V4a1 1 0 0 1 1-1ZM5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/>
                </svg>
              </button>
              <label
                className="icon-btn"
                title={t('ui.data.importTitle','Import from a JSON file')}
                aria-label={t('ui.data.import','Import')}
              >
                {/* upload icon */}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M12 3a1 1 0 0 1 .7.29l4 4a1 1 0 1 1-1.4 1.42L13 6.41V14a1 1 0 1 1-2 0V6.41L8.7 8.71A1 1 0 0 1 7.3 7.29l4-4A1 1 0 0 1 12 3ZM5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/>
                </svg>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  onChange={onImportFile}
                  hidden
                />
              </label>
            </div>            
          </div>
        </header>
        <section className="content">
          {tab === 'quests' ? (
            <>
              <Graph quests={data.quests} lang={lang} />
              <Sidebar lang={lang} />
            </>
          ) : (
            <Artifacts lang={lang} artifacts={artifacts} error={artifactsErr} />
          )}
        </section>
        <footer className="footer">
          {/* Socials card (replace hrefs with your links) */}
          <div className="footer-socials" role="group" aria-label="Social links">
            <a className="social discord" href="https://discord.gg/f5BBnn5nmR" target="_blank" rel="noopener noreferrer" aria-label="Discord">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                <path fill="currentColor" d="M20.317 4.369A18.07 18.07 0 0 0 16.558 3c-.173.31-.37.73-.508 1.06a16.34 16.34 0 0 0-4.1 0C11.812 3.73 11.62 3.31 11.44 3a18.123 18.123 0 0 0-3.761 1.369C4.66 7.2 3.91 10.94 4.18 14.63A18.3 18.3 0 0 0 8.06 16c.31-.42.59-.86.84-1.32-.46-.17-.9-.38-1.32-.61.11-.08.22-.16.33-.24 2.54 1.19 5.3 1.19 7.82 0 .11.08.22.16.33.24-.42.23-.86.44-1.32.61.25.46.53.9.84 1.32 1.41-.3 2.77-.81 4.05-1.49.33-3.93-.57-7.62-3.34-10.26ZM9.5 13.1c-.74 0-1.35-.68-1.35-1.51 0-.83.6-1.51 1.35-1.51s1.36.68 1.35 1.51c0 .83-.6 1.51-1.35 1.51Zm5 0c-.74 0-1.35-.68-1.35-1.51 0-.83.6-1.51 1.35-1.51s1.35.68 1.35 1.51c0 .83-.6 1.51-1.35 1.51Z"/>
              </svg>
            </a>
            <a className="social youtube" href="https://www.youtube.com/@MrMojitoTV" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="currentColor" d="M23.5 7.2a4.8 4.8 0 0 0-3.4-3.4C17.9 3.3 12 3.3 12 3.3s-5.9 0-8.1.5A4.8 4.8 0 0 0 .5 7.2 50.5 50.5 0 0 0 0 12a50.5 50.5 0 0 0 .5 4.8 4.8 4.8 0 0 0 3.4 3.4c2.2.5 8.1.5 8.1.5s5.9 0 8.1-.5a4.8 4.8 0 0 0 3.4-3.4A50.5 50.5 0 0 0 24 12a50.5 50.5 0 0 0-.5-4.8ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z"/>
              </svg>
            </a>
            <a className="social twitch" href="https://www.twitch.tv/mrmojitotv" target="_blank" rel="noopener noreferrer" aria-label="Twitch">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="currentColor" d="M4 3h16l-1.5 10.5-4 3.5H11l-3 3H6v-3H2V5.5L4 3Zm2 2v9.5h3v3l3-3h4.5L18.5 5H6Zm7 1.5h2V11h-2V6.5Zm-4 0h2V11H9V6.5Z"/>
              </svg>
            </a>

            <a className="social sheets" href="https://mrmojitoo.github.io/new-world-sheets" target="_blank" rel="noopener noreferrer" aria-label="Google Sheets">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="currentColor" d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/>
                <path fill="currentColor" d="M14 3v6h6z"/>
                <rect x="8" y="10" width="8" height="8" rx="1" ry="1" fill="none" stroke="#ffffff" stroke-width="1.6"/>
                <path d="M12 10v8M8 14h8" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </a>
            <span className="social-by">by&nbsp;<b>MrMojitoTV</b></span>
          </div>
          <div className="footer-right muted">
            {t('ui.footer.updated','Updated data on {date}', { date: prettyGeneratedAt })}
          </div>
        </footer>
      </div>
    </LocaleContext.Provider>
  )
}
