import { useApp } from '@renderer/store/app'
import { Dialog, Kbd, Switch } from '@renderer/components/ui'
import { SCOPE_LABELS, SHORTCUTS, effectiveKeysFor } from '@renderer/lib/shortcuts'
import type { ShortcutId, ShortcutScope } from '@renderer/lib/shortcuts'

const SCOPE_ORDER: ShortcutScope[] = ['global', 'decks', 'study', 'creator', 'browse']

/** Dialog listing every shortcut, grouped by scope. Mounted once in App; open via useApp().setHelpOpen. */
export function ShortcutsOverlay(): React.JSX.Element {
  const open = useApp((s) => s.helpOpen)
  const setOpen = useApp((s) => s.setHelpOpen)
  const overrides = useApp((s) => s.prefs.shortcutOverrides)
  const showHints = useApp((s) => s.prefs.showHotkeyHints)
  const toggleHints = useApp((s) => s.toggleHints)

  const ids = Object.keys(SHORTCUTS) as ShortcutId[]
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Keyboard shortcuts"
      description="Everything is reachable from the keyboard."
      className="w-[min(40rem,calc(100vw-2rem))]"
    >
      <div className="neu-inset mb-5 flex items-center justify-between rounded-2xl px-4 py-3">
        <label htmlFor="overlay-hints" className="cursor-pointer text-sm font-semibold">
          Show hotkey hints in the interface
        </label>
        <div className="flex items-center gap-3">
          <Kbd hotkey="Ctrl+/" force />
          <Switch id="overlay-hints" checked={showHints} onCheckedChange={() => toggleHints()} />
        </div>
      </div>
      <div className="flex flex-col gap-6">
        {SCOPE_ORDER.map((scope) => {
          const rows = ids.filter((id) => SHORTCUTS[id].scope === scope)
          if (rows.length === 0) return null
          return (
            <section key={scope}>
              <h3 className="mb-2 text-xs font-bold tracking-wider text-muted uppercase">{SCOPE_LABELS[scope]}</h3>
              <ul className="flex flex-col">
                {rows.map((id) => (
                  <li key={id} className="flex items-center justify-between rounded-xl px-2 py-1.5 text-sm hover:bg-text/5">
                    <span>{SHORTCUTS[id].label}</span>
                    <Kbd hotkey={effectiveKeysFor(id, overrides)} force />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Dialog>
  )
}
