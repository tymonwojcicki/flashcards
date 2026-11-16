import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Dialog, Field, Input, Panel, Select, Slider, Switch, confirm, toastError } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { flattenDecks } from '@renderer/lib/decks'
import { NumberField, Segmented, SettingRow } from './common'
import { DEFAULT_PRESET_ID, parseSteps, workloadMultiplier } from './steps'
import { DEFAULT_COLLECTION_SETTINGS } from '@shared/types'
import type { CollectionSettings, Preset, PresetConfig } from '@shared/types'

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
  // Readable preview (or the problem) sits inline, left of the field.
  return (
    <div className="flex items-center justify-end gap-3">
      <span
        className={clsx('text-right text-xs whitespace-nowrap', invalid.length > 0 ? 'text-danger' : 'text-muted')}
        aria-live="polite"
      >
        {invalid.length > 0 ? `Not valid: ${invalid.join(', ')}` : steps.length === 0 ? 'None' : steps.map(readableStep).join(' → ')}
      </span>
      <div className="w-36 shrink-0">
      <Input
        aria-label={label}
        aria-invalid={invalid.length > 0}
        className={clsx(invalid.length > 0 && 'border-danger')}
        value={text}
        placeholder="1m 10m"
        onChange={(e) => {
          setText(e.target.value)
          const p = parseSteps(e.target.value)
          if (p.invalid.length === 0) onCommit(p.steps)
        }}
        onBlur={() => invalid.length > 0 && setText(value.join(' '))}
      />
      </div>
    </div>
  )
}

const UNIT: Record<string, string> = { s: 'sec', m: 'min', h: 'h', d: 'd' }
/** "10m" -> "10 min", "1d" -> "1 d". */
function readableStep(step: string): string {
  const m = /^(\d+(?:\.\d+)?)([smhd])$/.exec(step)
  return m ? `${m[1]} ${UNIT[m[2]]}` : step
}

function HowItWorks(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={clsx('rounded-[24px] transition-all duration-150', open ? 'neu-inset' : 'neu-raised')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-[24px] px-5 py-3.5 text-left text-base font-semibold"
      >
        <ChevronRight size={18} className={clsx('text-muted transition-transform duration-150', open && 'rotate-90')} />
        How scheduling works
      </button>
      {open && (
        <p className="px-5 pb-5 pl-12 text-sm leading-relaxed text-muted">
          Each card has a memory strength. When you rate a card, the scheduler (FSRS) estimates how long you will remember
          it and sets the next review for the day your chance of remembering drops to your desired retention. Good and Easy
          push the card further out; Hard a little; Again brings it back soon. New cards first go through short learning
          steps on the same day before they get intervals in days. If you forget a card you already knew, it goes through
          relearning steps and then back to normal reviews. To see more cards, raise the desired retention or the new cards
          per day. To see fewer, lower them.
        </p>
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
      toastError(e, 'Could not save preset')
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
      toastError(e, 'Could not load deck presets')
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
        toastError(e, 'Could not load presets')
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
      toastError(e, 'Could not save preset')
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
      toastError(e, 'Could not delete preset')
    }
  }

  const assign = async (id: string, presetId: string): Promise<void> => {
    try {
      await window.api.setDeckPreset(id, presetId === '__inherit__' ? null : presetId)
      await refreshDecks()
      await loadResolved()
    } catch (e) {
      toastError(e, 'Could not assign preset')
    }
  }

  const saveCollection = async (patch: Partial<CollectionSettings>): Promise<void> => {
    setCollection((c) => ({ ...c, ...patch }))
    try {
      setCollection(await window.api.setCollectionSettings(patch))
    } catch (e) {
      toastError(e, 'Could not save')
    }
  }

  const selected = presets.find((p) => p.id === selectedId)
  const retention = draft?.desiredRetention ?? 0.9
  const mult = workloadMultiplier(retention)

  return (
    <div className="flex flex-col gap-6">
      <HowItWorks />
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
              info="The chance you still remember a card when it comes up. The app schedules each review for the moment your memory is expected to drop to this level. Higher means shorter gaps and more reviews per day (see the workload line); lower means fewer reviews but more forgetting. 90% suits most people."
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
              info="The short practice a new card gets before it is scheduled in days. With “1m 10m”, pressing Good brings the card back after 1 minute, then after 10 minutes; after the last step it gets its first gap in days. Again restarts the steps and Easy skips them. Units: s, m, h, d."
            >
              <StepsField label="Learning steps" value={draft.learningSteps} onCommit={(s) => change({ learningSteps: s })} />
            </SettingRow>

            <SettingRow
              title="Relearning steps"
              info="The same, for cards you already learned but forgot. When you press Again on a review, the card comes back after these waits (“10m” = 10 minutes), then returns to day-long gaps, shorter than before. Leave empty to skip the extra practice."
            >
              <StepsField
                label="Relearning steps"
                value={draft.relearningSteps}
                onCommit={(s) => change({ relearningSteps: s })}
              />
            </SettingRow>

            <SettingRow title="New cards per day" info="How many cards you see for the first time each day, for each deck using this preset. Every new card brings reviews in the following weeks, so this is the main control for your future workload. 10 to 20 is a common start.">
              <NumberField
                aria-label="New cards per day"
                value={draft.newPerDay}
                min={0}
                max={9999}
                onCommit={(n) => change({ newPerDay: n })}
              />
            </SettingRow>

            <SettingRow title="Maximum reviews per day" info="The most review cards shown per day. Cards over the limit are not lost: they wait until the next day. Keep it above your usual daily number, or a backlog builds up.">
              <NumberField
                aria-label="Maximum reviews per day"
                value={draft.reviewsPerDay}
                min={0}
                max={99999}
                onCommit={(n) => change({ reviewsPerDay: n })}
              />
            </SettingRow>

            <SettingRow title="Maximum interval" info="The longest gap, in days, the app may ever give a card. Even a card you know very well comes back at least this often. The default of 36500 means no practical limit; for example 365 makes every card come back at least once a year.">
              <NumberField
                aria-label="Maximum interval in days"
                value={draft.maximumInterval}
                min={1}
                max={36500}
                suffix="days"
                onCommit={(n) => change({ maximumInterval: n })}
              />
            </SettingRow>

            <SettingRow
              title="Fuzz"
              info="Adds a small random variation to gaps longer than a few days. Cards you added together then spread across nearby days instead of all coming back on the same day. Keep it on."
            >
              <Switch aria-label="Fuzz" checked={draft.enableFuzz} onCheckedChange={(v) => change({ enableFuzz: v })} />
            </SettingRow>

            <SettingRow title="New card order" info="Sequential introduces new cards in the order they were added; an imported file keeps its row order. Random mixes them, which helps when neighbouring cards give each other away.">
              <Segmented
                fill
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
              info="For cards made with “Also create reverse card”. After you answer one direction, the other direction waits until the next day, so you don't answer it right after seeing its answer."
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
          <SettingRow title="Next day starts at" info="When a new study day begins, in your computer's time. Daily limits reset and “due today” is counted from this hour. With 4:00, a session at 1 a.m. still counts toward the previous day.">
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
            info="Cards in their learning steps normally wait for their timer. When nothing else is left in a session, cards due within this many minutes are shown right away instead. 0 means always wait."
          >
            <NumberField
              aria-label="Learn ahead limit in minutes"
              value={collection.learnAheadMinutes}
              min={0}
              max={1440}
              suffix="min"
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
                  'flex items-center justify-between gap-4 rounded-2xl px-3 py-1.5 transition-colors',
                  isTarget && !highlightDone && 'bg-accent/15 ring-2 ring-accent'
                )}
                style={{ paddingLeft: `${0.75 + d.depth * 1.25}rem` }}
              >
                <span className="min-w-0 flex-1 text-sm font-medium break-words">{d.name}</span>
                <div className="w-56 shrink-0">
                  <Select
                    aria-label={`Preset for ${d.name}`}
                    value={d.presetId ?? '__inherit__'}
                    onValueChange={(v) => void assign(d.id, v)}
                    options={[
                      { value: '__inherit__', label: `Inherit (${parentName ?? 'default'})` },
                      ...presets.map((p) => ({ value: p.id, label: p.name }))
                    ]}
                  />
                </div>
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
