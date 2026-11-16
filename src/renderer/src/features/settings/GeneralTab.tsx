import { Monitor, Moon, Sun } from 'lucide-react'
import { Panel, Slider, Switch } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { Segmented, SettingRow } from './common'
import { ShortcutsEditor } from './ShortcutsEditor'
import { AccentPicker } from './AccentPicker'
import type { Theme } from '@shared/types'

export function GeneralTab(): React.JSX.Element {
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)

  return (
    <div className="flex flex-col gap-6">
      <Panel className="divide-y divide-muted/15 py-1">
        <SettingRow title="Theme" desc="Light, dark, or match the system.">
          <Segmented<Theme>
            label="Theme"
            value={prefs.theme}
            onChange={(theme) => void setPrefs({ theme })}
            options={[
              { value: 'light', label: <><Sun size={14} /> Light</> },
              { value: 'dark', label: <><Moon size={14} /> Dark</> },
              { value: 'system', label: <><Monitor size={14} /> System</> }
            ]}
          />
        </SettingRow>

        <SettingRow title="Accent colour" desc="Colour of highlights and charts.">
          <AccentPicker value={prefs.accent} onChange={(accent) => void setPrefs({ accent })} />
        </SettingRow>

        <SettingRow
          title="Hotkey hints"
          desc="Show key badges on buttons and menus. Toggle with Ctrl+/."
        >
          <Switch
            aria-label="Hotkey hints"
            checked={prefs.showHotkeyHints}
            onCheckedChange={(showHotkeyHints) => void setPrefs({ showHotkeyHints })}
          />
        </SettingRow>

        <SettingRow title="Font size" desc="Scales all text in the app.">
          <div className="flex items-center gap-3">
            <Slider
              aria-label="Font size"
              min={0.85}
              max={1.3}
              step={0.05}
              value={prefs.fontScale}
              onValueChange={(fontScale) => void setPrefs({ fontScale: Math.round(fontScale * 100) / 100 })}
            />
            <span className="w-12 text-right text-sm font-semibold tabular-nums">
              {Math.round(prefs.fontScale * 100)}%
            </span>
          </div>
        </SettingRow>
        <div className="px-0 pt-3 pb-3">
          <div className="neu-inset rounded-2xl p-4">
            <div className="text-xs text-muted">Preview</div>
            <div className="mt-1 font-semibold">What is the law of demand?</div>
            <div className="text-sm">As the price of a good rises, the quantity demanded falls.</div>
          </div>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Keyboard shortcuts</h3>
        <ShortcutsEditor />
      </Panel>
    </div>
  )
}
