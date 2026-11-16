import { create } from 'zustand'
import { DEFAULT_PREFS } from '@shared/types'
import type { DeckNode, Prefs, StartupState, StudyMode } from '@shared/types'
import { toast } from '@renderer/components/ui/Toast'

export type Route =
  | { name: 'decks' }
  | { name: 'add'; deckId?: string; editNoteId?: string }
  | { name: 'browse'; deckId?: string }
  | { name: 'study'; deckId: string; mode: StudyMode }
  | { name: 'stats'; deckId?: string }
  | { name: 'settings'; tab?: 'general' | 'scheduling' | 'data'; deckId?: string }
  | { name: 'import'; deckId?: string }

interface AppState {
  prefs: Prefs
  deckTree: DeckNode[]
  startup: StartupState | null
  route: Route
  paletteOpen: boolean
  helpOpen: boolean
  init: () => Promise<void>
  refreshDecks: () => Promise<void>
  setPrefs: (patch: Partial<Prefs>) => Promise<void>
  navigate: (route: Route) => void
  setStartup: (s: StartupState) => void
  toggleHints: () => void
  toggleTheme: () => void
  cycleAccent: () => void
  setPaletteOpen: (open: boolean) => void
  setHelpOpen: (open: boolean) => void
}

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(theme: Prefs['theme']): 'light' | 'dark' {
  return theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
}

function applyPrefs(prefs: Prefs): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(prefs.theme)
  root.dataset.accent = ['ember', 'aqua', 'iris'].includes(prefs.accent) ? prefs.accent : 'ember'
  root.style.setProperty('--font-scale', String(prefs.fontScale || 1))
}

let initPromise: Promise<void> | null = null

export const useApp = create<AppState>((set, get) => ({
  prefs: DEFAULT_PREFS,
  deckTree: [],
  startup: null,
  route: { name: 'decks' },
  paletteOpen: false,
  helpOpen: false,

  init: () => {
    if (initPromise) return initPromise
    initPromise = (async () => {
      const [startup, prefs, deckTree] = await Promise.all([
        window.api.getStartupState(),
        window.api.getPrefs(),
        window.api.getDeckTree()
      ])
      applyPrefs(prefs)
      set({ startup, prefs, deckTree })

      media.addEventListener('change', () => applyPrefs(get().prefs))
      let timer: ReturnType<typeof setTimeout> | undefined
      window.api.on('collection-changed', () => {
        clearTimeout(timer)
        timer = setTimeout(() => void get().refreshDecks(), 300)
      })
      window.api.on('collection-reloaded', () => {
        void get().refreshDecks()
        toast('Synced changes loaded', { kind: 'info' })
      })
    })()
    return initPromise
  },

  refreshDecks: async () => {
    try {
      set({ deckTree: await window.api.getDeckTree() })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load decks', { kind: 'error' })
    }
  },

  setPrefs: async (patch) => {
    const prev = get().prefs
    const next = { ...prev, ...patch }
    set({ prefs: next })
    applyPrefs(next)
    try {
      await window.api.setPrefs(patch)
    } catch (e) {
      set({ prefs: prev })
      applyPrefs(prev)
      toast(e instanceof Error ? e.message : 'Could not save settings', { kind: 'error' })
    }
  },

  navigate: (route) => set({ route }),
  setStartup: (startup) => set({ startup }),

  toggleHints: () => {
    const on = !get().prefs.showHotkeyHints
    void get().setPrefs({ showHotkeyHints: on })
    toast(on ? 'Hotkey hints on' : 'Hotkey hints off', { kind: 'info' })
  },

  toggleTheme: () => {
    const cur = resolveTheme(get().prefs.theme)
    void get().setPrefs({ theme: cur === 'dark' ? 'light' : 'dark' })
  },

  cycleAccent: () => {
    const order: Prefs['accent'][] = ['ember', 'aqua', 'iris']
    const next = order[(order.indexOf(get().prefs.accent) + 1) % order.length]
    void get().setPrefs({ accent: next })
    toast(`Accent: ${next[0].toUpperCase()}${next.slice(1)}`, { kind: 'info' })
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen })
}))
