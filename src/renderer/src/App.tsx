import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useApp } from '@renderer/store/app'
import { useShortcut } from '@renderer/lib/shortcuts'
import { DialogHost, Toaster, toast } from '@renderer/components/ui'
import { Sidebar } from '@renderer/components/Sidebar'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { ShortcutsOverlay } from '@renderer/components/ShortcutsOverlay'
import { ReadOnlyBanner, StartupGate } from '@renderer/components/StartupGate'
import DecksPage from '@renderer/pages/DecksPage'
import AddPage from '@renderer/pages/AddPage'
import BrowsePage from '@renderer/pages/BrowsePage'
import StudyPage from '@renderer/pages/StudyPage'
import StatsPage from '@renderer/pages/StatsPage'
import SettingsPage from '@renderer/pages/SettingsPage'
import ImportPage from '@renderer/pages/ImportPage'
import { playSound } from '@renderer/lib/sound'

function CurrentPage(): React.JSX.Element {
  const route = useApp((s) => s.route)
  switch (route.name) {
    case 'decks':
      return <DecksPage />
    case 'add':
      return <AddPage deckId={route.deckId} editNoteId={route.editNoteId} />
    case 'browse':
      return <BrowsePage deckId={route.deckId} />
    case 'study':
      return <StudyPage deckId={route.deckId} mode={route.mode} />
    case 'stats':
      return <StatsPage deckId={route.deckId} />
    case 'settings':
      return <SettingsPage tab={route.tab} deckId={route.deckId} />
    case 'import':
      return <ImportPage deckId={route.deckId} />
  }
}

export default function App(): React.JSX.Element {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.startup !== null)
  const routeName = useApp((s) => s.route.name)
  const navigate = useApp((s) => s.navigate)
  const paletteOpen = useApp((s) => s.paletteOpen)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const helpOpen = useApp((s) => s.helpOpen)
  const setHelpOpen = useApp((s) => s.setHelpOpen)
  const toggleHints = useApp((s) => s.toggleHints)

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('sidebar-collapsed', c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })
  }, [])

  useEffect(() => {
    void init()
      .then(() => window.api.runAutoBackup())
      .then((file) => {
        if (file) toast('Backup saved to your Downloads folder', { kind: 'info' })
      })
      .catch(() => {})
  }, [init])

  useShortcut('app.search', () => setPaletteOpen(!paletteOpen), { allowInInputs: true })
  useShortcut(
    'app.toggleHints',
    () => {
      playSound('toggle') // same click as flipping the switch
      toggleHints()
    },
    { allowInInputs: true }
  )
  useShortcut('app.help', () => setHelpOpen(!helpOpen))
  useShortcut('nav.decks', () => navigate({ name: 'decks' }), { allowInInputs: true })
  useShortcut('nav.add', () => navigate({ name: 'add' }), { allowInInputs: true })
  useShortcut('nav.browse', () => navigate({ name: 'browse' }), { allowInInputs: true })
  useShortcut('nav.stats', () => navigate({ name: 'stats' }), { allowInInputs: true })
  useShortcut('nav.settings', () => navigate({ name: 'settings' }), { allowInInputs: true })

  const studying = routeName === 'study'

  return (
    <div className="flex h-full text-text">
      {ready && (
        <>
          {!studying && <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />}
          {/* Collapsed rail is 4.5rem + 1rem margin; mirror it on the right so content is centred on the window. */}
          <div className={clsx('flex min-w-0 flex-1 flex-col', collapsed && !studying && 'pr-[5.5rem]')}>
            <ReadOnlyBanner />
            <main className="min-h-0 flex-1 overflow-y-auto p-6">
              <div key={routeName} className="anim-page h-full">
                <CurrentPage />
              </div>
            </main>
          </div>
          <StartupGate />
          <CommandPalette />
          <ShortcutsOverlay />
        </>
      )}
      <DialogHost />
      <Toaster />
    </div>
  )
}
