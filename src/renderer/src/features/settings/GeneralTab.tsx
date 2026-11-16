import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Panel, Slider, Switch } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { Segmented, SettingRow } from './common'
import { ShortcutsEditor } from './ShortcutsEditor'
import { AccentPicker } from './AccentPicker'
import { playSound } from '@renderer/lib/sound'
import type { Theme } from '@shared/types'

let lastPreview = 0

export function GeneralTab(): React.JSX.Element {
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const [fontDraft, setFontDraft] = useState<number | null>(null)

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

        <SettingRow
          title="Sound effects"
          desc="Play short sounds when you reveal, rate and add cards."
        >
          <Switch
            aria-label="Sound effects"
            checked={prefs.soundEffects}
            onCheckedChange={(soundEffects) => {
              void setPrefs({ soundEffects })
              if (soundEffects) playSound('preview')
            }}
          />
        </SettingRow>

        {prefs.soundEffects && (
          <SettingRow title="Volume" desc="How loud the sounds are.">
            <div className="flex items-center gap-3">
              <Slider
                aria-label="Sound volume"
                sound={false}
                min={0}
                max={1}
                step={0.05}
                value={prefs.soundVolume}
                onValueChange={(v) => {
                  void setPrefs({ soundVolume: Math.round(v * 100) / 100 })
                  const now = Date.now()
                  if (now - lastPreview > 140) {
                    lastPreview = now
                    playSound('preview')
                  }
                }}
              />
              <span className="w-12 text-right text-sm font-semibold tabular-nums">
                {Math.round(prefs.soundVolume * 100)}%
              </span>
            </div>
          </SettingRow>
        )}

        <SettingRow title="Font size" desc="Scales all text in the app.">
          <div className="flex items-center gap-3">
            <Slider
              aria-label="Font size"
              min={0.85}
              max={1.3}
              step={0.05}
              value={fontDraft ?? prefs.fontScale}
              onValueChange={(v) => setFontDraft(Math.round(v * 100) / 100)}
              onValueCommit={(v) => {
                setFontDraft(null)
                void setPrefs({ fontScale: Math.round(v * 100) / 100 })
              }}
            />
            <span className="w-12 text-right text-sm font-semibold tabular-nums">
              {Math.round((fontDraft ?? prefs.fontScale) * 100)}%
            </span>
          </div>
        </SettingRow>
        <div className="px-0 pt-3 pb-3">
          {/* While dragging only the preview resizes (cheap); the app applies the size on release. */}
          <div
            className="neu-inset origin-top-left rounded-2xl p-4"
            style={{ zoom: (fontDraft ?? prefs.fontScale) / prefs.fontScale }}
          >
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
