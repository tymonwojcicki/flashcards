import { create } from 'zustand'
import { DEFAULT_PREFS } from '@shared/types'
import type { DeckNode, Prefs, StartupState, StudyMode } from '@shared/types'
import { toast } from '@renderer/components/ui/Toast'
import { playSound } from '@renderer/lib/sound'

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
  const theme = resolveTheme(prefs.theme)
  const accent = ['ember', 'aqua', 'iris'].includes(prefs.accent) ? prefs.accent : 'ember'
  const started = root.classList.contains('font-anim') // false on the first apply at startup
  const themeChanged = started && root.dataset.theme !== theme
  const accentChanged = started && root.dataset.accent !== accent
  const swap = (): void => {
    root.dataset.theme = theme
    root.dataset.accent = accent
  }
  if (themeChanged || accentChanged) {
    playSound(themeChanged ? (theme === 'dark' ? 'themeDark' : 'themeLight') : 'accent')
    // Soft diagonal sweep into the new colours (View Transitions; instant where unsupported).
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (vt && !reduce) {
      root.classList.add('theme-sweep')
      const t = vt.call(document, swap) as { finished?: Promise<void> }
      void t.finished?.finally(() => root.classList.remove('theme-sweep'))
    } else swap()
  } else swap()
  root.style.setProperty('--font-scale', String(prefs.fontScale || 1))
  // Animate later font-size changes, but not the first apply at startup (no zoom on launch).
  if (!root.classList.contains('font-anim')) {
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('font-anim')))
  }
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
    toast(on ? 'Hotkey hints on' : 'Hotkey hints off', { kind: 'info', key: 'hints' })
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
