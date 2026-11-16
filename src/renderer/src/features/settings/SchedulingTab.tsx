import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  Field,
  Input,
  Panel,
  Select,
  Slider,
  Switch,
  confirm,
  toast
} from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { flattenDecks } from '@renderer/lib/decks'
import { NumberField, Segmented, SettingRow } from './common'
import { DEFAULT_PRESET_ID, formatYears, parseSteps, workloadMultiplier } from './steps'
import { DEFAULT_COLLECTION_SETTINGS } from '@shared/types'
import type { CollectionSettings, Preset, PresetConfig } from '@shared/types'

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

function StepsField({
  label,
  value,
  onCommit
}: {
  label: string
  value: string[]
  onCommit: (steps: string[]) => void
}): React.JSX.Element {
  const [text, setText] = useState(value.join(' '))
  useEffect(() => {
    setText((t) => (parseSteps(t).steps.join(' ') === value.join(' ') ? t : value.join(' ')))
  }, [value])
  const { steps, invalid } = parseSteps(text)
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        aria-label={label}
        aria-invalid={invalid.length > 0}
        className={clsx(invalid.length > 0 && 'border-danger')}
        value={text}
        placeholder="e.g. 1m 10m"
        onChange={(e) => {
          setText(e.target.value)
          const p = parseSteps(e.target.value)
          if (p.invalid.length === 0) onCommit(p.steps)
        }}
        onBlur={() => invalid.length > 0 && setText(value.join(' '))}
      />
      {invalid.length > 0 ? (
        <p className="text-xs text-danger">
          Not valid: {invalid.join(', ')}. Use a number and s, m, h or d (e.g. 30s, 10m, 1h, 1d).
        </p>
      ) : (
        <p className="text-xs text-muted">{steps.length === 0 ? 'No steps' : steps.join(' → ')}</p>
      )}
    </div>
  )
}

export function SchedulingTab({ deckId }: { deckId?: string }): React.JSX.Element {
  const deckTree = useApp((s) => s.deckTree)
  const refreshDecks = useApp((s) => s.refreshDecks)
  const flat = useMemo(() => flattenDecks(deckTree), [deckTree])

  const [presets, setPresets] = useState<Preset[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PresetConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [resolved, setResolved] = useState<Record<string, Preset>>({})
  const [collection, setCollection] = useState<CollectionSettings>(DEFAULT_COLLECTION_SETTINGS)
  const [nameDialog, setNameDialog] = useState<{ mode: 'new' | 'rename'; name: string } | null>(null)

  const pending = useRef<Partial<PresetConfig>>({})
  const pendingId = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    const patch = pending.current
    const id = pendingId.current
    pending.current = {}
    if (!id || Object.keys(patch).length === 0) return
    try {
      const updated = await window.api.updatePreset(id, { config: patch })
      setPresets((ps) => ps.map((p) => (p.id === id ? updated : p)))
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 1800)
    } catch (e) {
      toast(errMsg(e, 'Could not save preset'), { kind: 'error' })
    }
  }, [])

  useEffect(
    () => () => {
      void flush()
      clearTimeout(savedTimer.current)
    },
    [flush]
  )

  const loadResolved = useCallback(async (): Promise<void> => {
    try {
      const decks = flattenDecks(await window.api.getDeckTree())
      const entries = await Promise.all(decks.map(async (d) => [d.id, await window.api.getDeckPreset(d.id)] as const))
      setResolved(Object.fromEntries(entries))
    } catch (e) {
      toast(errMsg(e, 'Could not load deck presets'), { kind: 'error' })
    }
  }, [])

  // Initial load.
  useEffect(() => {
    void (async () => {
      try {
        const [list, cs] = await Promise.all([window.api.listPresets(), window.api.getCollectionSettings()])
        setPresets(list)
        setCollection(cs)
        let first = list[0]
        if (deckId) {
          const p = await window.api.getDeckPreset(deckId)
          first = list.find((x) => x.id === p.id) ?? first
        }
        if (first) {
          setSelectedId(first.id)
          setDraft(first.config)
        }
      } catch (e) {
        toast(errMsg(e, 'Could not load presets'), { kind: 'error' })
      }
    })()
    void loadResolved()
  }, [deckId, loadResolved])

  // Scroll to the requested deck.
  const [highlightDone, setHighlightDone] = useState(false)
  const deckRowRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (deckId && Object.keys(resolved).length > 0 && deckRowRef.current) {
      deckRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const t = setTimeout(() => setHighlightDone(true), 2500)
      return () => clearTimeout(t)
    }
    return undefined
  }, [deckId, resolved])

  const select = async (id: string): Promise<void> => {
    await flush()
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setSelectedId(id)
    setDraft(p.config)
  }

  const change = (patch: Partial<PresetConfig>): void => {
    if (!selectedId) return
    setDraft((d) => (d ? { ...d, ...patch } : d))
    pending.current = { ...pending.current, ...patch }
    pendingId.current = selectedId
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 400)
  }

  const submitName = async (): Promise<void> => {
    if (!nameDialog) return
    const name = nameDialog.name.trim()
    if (!name) return
    try {
      if (nameDialog.mode === 'new') {
        await flush()
        const p = await window.api.createPreset(name, draft ?? undefined)
        setPresets((ps) => [...ps, p])
        setSelectedId(p.id)
        setDraft(p.config)
      } else if (selectedId) {
        const p = await window.api.updatePreset(selectedId, { name })
        setPresets((ps) => ps.map((x) => (x.id === p.id ? p : x)))
        void loadResolved()
      }
      setNameDialog(null)
    } catch (e) {
      toast(errMsg(e, 'Could not save preset'), { kind: 'error' })
    }
  }

  const remove = async (): Promise<void> => {
    const sel = presets.find((p) => p.id === selectedId)
    if (!sel || sel.id === DEFAULT_PRESET_ID) return
    const ok = await confirm({
      title: `Delete preset "${sel.name}"?`,
      message: 'Decks using it will fall back to their parent preset (or the default).',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      pending.current = {}
      await window.api.deletePreset(sel.id)
      const list = presets.filter((p) => p.id !== sel.id)
      setPresets(list)
      const next = list.find((p) => p.id === DEFAULT_PRESET_ID) ?? list[0]
      if (next) {
        setSelectedId(next.id)
        setDraft(next.config)
      }
      await refreshDecks()
      await loadResolved()
    } catch (e) {
      toast(errMsg(e, 'Could not delete preset'), { kind: 'error' })
    }
  }

  const assign = async (id: string, presetId: string): Promise<void> => {
    try {
      await window.api.setDeckPreset(id, presetId === '__inherit__' ? null : presetId)
      await refreshDecks()
      await loadResolved()
    } catch (e) {
      toast(errMsg(e, 'Could not assign preset'), { kind: 'error' })
    }
  }

  const saveCollection = async (patch: Partial<CollectionSettings>): Promise<void> => {
    setCollection((c) => ({ ...c, ...patch }))
    try {
      setCollection(await window.api.setCollectionSettings(patch))
    } catch (e) {
      toast(errMsg(e, 'Could not save'), { kind: 'error' })
    }
  }

  const selected = presets.find((p) => p.id === selectedId)
  const retention = draft?.desiredRetention ?? 0.9
  const mult = workloadMultiplier(retention)

  return (
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Preset" className="w-64">
            <Select
              aria-label="Preset"
              value={selectedId ?? ''}
              onValueChange={(id) => void select(id)}
              options={presets.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Loading…"
            />
          </Field>
          <Button icon={<Plus size={16} />} onClick={() => setNameDialog({ mode: 'new', name: '' })}>
            New preset
          </Button>
          <Button
            icon={<Pencil size={16} />}
            disabled={!selected}
            onClick={() => selected && setNameDialog({ mode: 'rename', name: selected.name })}
          >
            Rename
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            disabled={!selected || selected.id === DEFAULT_PRESET_ID}
            onClick={() => void remove()}
          >
            Delete
          </Button>
          <span
            className={clsx(
              'ml-auto flex items-center gap-1 text-sm font-semibold text-success transition-opacity',
              saved ? 'opacity-100' : 'opacity-0'
            )}
            aria-live="polite"
          >
            <Check size={16} /> Saved
          </span>
        </div>

        {draft && (
          <div className="divide-y divide-muted/15">
            <SettingRow
              title="Desired retention"
              desc="Higher retention increases the number of reviews. Default: 90%."
              stacked
            >
              <div className="flex items-center gap-4">
                <Slider
                  aria-label="Desired retention"
                  min={0.7}
                  max={0.99}
                  step={0.01}
                  value={draft.desiredRetention}
                  onValueChange={(v) => change({ desiredRetention: Math.round(v * 100) / 100 })}
                />
                <span className="w-14 text-right text-lg font-bold tabular-nums">
                  {Math.round(retention * 100)}%
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Workload: approx. {mult.toFixed(1)}× the reviews of 90% retention.
              </p>
            </SettingRow>

            <SettingRow
              title="Learning steps"
              desc="Delays before a new card graduates to normal reviews. Example: 1m 10m."
            >
              <StepsField label="Learning steps" value={draft.learningSteps} onCommit={(s) => change({ learningSteps: s })} />
            </SettingRow>

            <SettingRow
              title="Relearning steps"
              desc="Delays after a review card is answered Again. Example: 10m."
            >
              <StepsField
                label="Relearning steps"
                value={draft.relearningSteps}
                onCommit={(s) => change({ relearningSteps: s })}
              />
            </SettingRow>

            <SettingRow title="New cards per day" desc="The most new cards introduced each day.">
              <NumberField
                aria-label="New cards per day"
                value={draft.newPerDay}
                min={0}
                max={9999}
                onCommit={(n) => change({ newPerDay: n })}
              />
            </SettingRow>

            <SettingRow title="Maximum reviews per day" desc="Maximum due reviews shown per day.">
              <NumberField
                aria-label="Maximum reviews per day"
                value={draft.reviewsPerDay}
                min={0}
                max={99999}
                onCommit={(n) => change({ reviewsPerDay: n })}
              />
            </SettingRow>

            <SettingRow title="Maximum interval" desc="Longest allowed time between reviews.">
              <NumberField
                aria-label="Maximum interval in days"
                value={draft.maximumInterval}
                min={1}
                max={36500}
                suffix={`days (${formatYears(draft.maximumInterval)})`}
                onCommit={(n) => change({ maximumInterval: n })}
              />
            </SettingRow>

            <SettingRow
              title="Fuzz"
              desc="Adds small random variation to intervals."
            >
              <Switch aria-label="Fuzz" checked={draft.enableFuzz} onCheckedChange={(v) => change({ enableFuzz: v })} />
            </SettingRow>

            <SettingRow title="New card order" desc="Order in which new cards are introduced.">
              <Segmented
                label="New card order"
                value={draft.newOrder}
                onChange={(v) => change({ newOrder: v })}
                options={[
                  { value: 'sequential', label: 'Sequential' },
                  { value: 'random', label: 'Random' }
                ]}
              />
            </SettingRow>

            <SettingRow
              title="Bury siblings"
              desc="After one side of a two-way card is answered, hide the other side until tomorrow."
            >
              <Switch
                aria-label="Bury siblings"
                checked={draft.burySiblings}
                onCheckedChange={(v) => change({ burySiblings: v })}
              />
            </SettingRow>
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Collection</h3>
        <div className="divide-y divide-muted/15">
          <SettingRow title="Next day starts at" desc="Reviews done before this hour still count as the previous day.">
            <Select
              aria-label="Next day starts at"
              value={String(collection.dayStartHour)}
              onValueChange={(v) => void saveCollection({ dayStartHour: Number(v) })}
              options={Array.from({ length: 24 }, (_, h) => ({
                value: String(h),
                label: `${String(h).padStart(2, '0')}:00`
              }))}
            />
          </SettingRow>
          <SettingRow
            title="Learn ahead limit"
            desc="Learning cards due within this time are shown early."
          >
            <NumberField
              aria-label="Learn ahead limit in minutes"
              value={collection.learnAheadMinutes}
              min={0}
              max={1440}
              suffix="minutes"
              onCommit={(n) => void saveCollection({ learnAheadMinutes: n })}
            />
          </SettingRow>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Deck assignment</h3>
        <p className="text-xs text-muted">
          Each deck uses its own preset, or inherits from its parent deck.
        </p>
        {flat.length === 0 && <p className="text-sm text-muted">No decks yet.</p>}
        <div className="flex flex-col gap-1">
          {flat.map((d) => {
            const parentName = d.parentId ? resolved[d.parentId]?.name : presets.find((p) => p.id === DEFAULT_PRESET_ID)?.name
            const isTarget = d.id === deckId
            return (
              <div
                key={d.id}
                ref={isTarget ? deckRowRef : undefined}
                className={clsx(
                  'flex items-center justify-between gap-3 rounded-2xl px-3 py-2 transition-colors',
                  isTarget && !highlightDone && 'bg-accent/15 ring-2 ring-accent'
                )}
                style={{ paddingLeft: `${0.75 + d.depth * 1.25}rem` }}
              >
                <span className="min-w-0 truncate text-sm font-medium">{d.name}</span>
                <Select
                  aria-label={`Preset for ${d.name}`}
                  className="w-64"
                  value={d.presetId ?? '__inherit__'}
                  onValueChange={(v) => void assign(d.id, v)}
                  options={[
                    { value: '__inherit__', label: `Inherit (${parentName ?? 'default'})` },
                    ...presets.map((p) => ({ value: p.id, label: p.name }))
                  ]}
                />
              </div>
            )
          })}
        </div>
      </Panel>

      <Dialog
        open={nameDialog !== null}
        onOpenChange={(o) => !o && setNameDialog(null)}
        title={nameDialog?.mode === 'new' ? 'New preset' : 'Rename preset'}
        description={nameDialog?.mode === 'new' ? 'The new preset starts as a copy of the current settings.' : undefined}
        footer={
          <>
            <Button onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={!nameDialog?.name.trim()} onClick={() => void submitName()}>
              {nameDialog?.mode === 'new' ? 'Create' : 'Rename'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submitName()
          }}
        >
          <Input
            autoFocus
            aria-label="Preset name"
            placeholder="Preset name"
            value={nameDialog?.name ?? ''}
            onChange={(e) => setNameDialog((n) => (n ? { ...n, name: e.target.value } : n))}
          />
        </form>
      </Dialog>
    </div>
  )
}
