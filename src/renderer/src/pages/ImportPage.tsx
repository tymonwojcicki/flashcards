// Prop contract: { deckId?: string (default target deck) }
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, Check, FileText, FolderOpen, Layers, Upload } from 'lucide-react'
import { Button, Field, Input, Panel, Select, Switch, Well, toastError } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { playSound } from '@renderer/lib/sound'
import { flattenDecks } from '@renderer/lib/decks'
import { plural } from '@renderer/lib/format'
import { RichHtml } from '@renderer/lib/html'
import {
  DELIMITERS,
  detectDelimiter,
  dirName,
  guessHeader,
  guessRoles,
  mapRows,
  parseTable
} from '@renderer/features/import/parse'
import type { ColumnRole } from '@renderer/features/import/parse'
import type { ImportResult, ImportTarget, PickedTextFile } from '@shared/types'

const NEW_DECK = '__new__'

const ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'deck', label: 'Deck path' },
  { value: 'tags', label: 'Tags' },
  { value: 'ignore', label: 'Ignore' }
]

const STEPS = ['Choose file', 'Map columns', 'Done']

function Stepper({ step }: { step: number }): React.JSX.Element {
  return (
    <ol className="flex items-center gap-2" aria-label="Import steps">
      {STEPS.map((label, i) => {
        const done = i < step
        const active = i === step
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all',
                active ? 'bg-accent text-accent-contrast neu-accent' : done ? 'neu-raised-sm text-accent' : 'neu-inset text-muted'
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check size={14} /> : i + 1}
            </span>
            <span className={clsx('text-sm font-semibold', active ? 'text-text' : 'text-muted')}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-muted/30" />}
          </li>
        )
      })}
    </ol>
  )
}

function HelpCard(): React.JSX.Element {
  return (
    <Panel className="flex flex-col gap-3 text-sm">
      <h2 className="text-base font-semibold">File format</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
        <li>
          One card per row. Columns: <b className="text-text">front</b>, <b className="text-text">back</b>, and
          optionally <b className="text-text">deck</b> and <b className="text-text">tags</b> (space separated).
        </li>
        <li>
          Use <code className="rounded bg-bg px-1">A::B::C</code> in the deck column to create sub-decks.
        </li>
        <li>
          Math: write LaTeX between <code className="rounded bg-bg px-1">$</code> signs, or{' '}
          <code className="rounded bg-bg px-1">$$</code> for a centered formula.
        </li>
        <li>
          Images: <code className="rounded bg-bg px-1">{'<img src="images/x.png">'}</code>, relative to the file.
        </li>
        <li>
          Sample files are in the <code className="rounded bg-bg px-1">samples</code> folder of the app (economics.csv,
          spanish.tsv).
        </li>
      </ul>
    </Panel>
  )
}

export default function ImportPage({ deckId }: { deckId?: string }): React.JSX.Element {
  const deckTree = useApp((s) => s.deckTree)
  const navigate = useApp((s) => s.navigate)
  const refreshDecks = useApp((s) => s.refreshDecks)
  const flat = useMemo(() => flattenDecks(deckTree), [deckTree])

  const [step, setStep] = useState(0)
  const [file, setFile] = useState<PickedTextFile | null>(null)
  const [delimiter, setDelimiter] = useState(',')
  const [hasHeader, setHasHeader] = useState(false)
  const [roles, setRoles] = useState<ColumnRole[]>([])
  const [target, setTarget] = useState<string>(deckId ?? flat[0]?.id ?? NEW_DECK)
  const [newDeckName, setNewDeckName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [burst, setBurst] = useState(false)
  const [pasted, setPasted] = useState('')
  const [result, setResult] = useState<{ res: ImportResult; deckId: string } | null>(null)

  const table = useMemo(() => (file ? parseTable(file.text, delimiter) : []), [file, delimiter])
  const colCount = useMemo(() => table.reduce((m, r) => Math.max(m, r.length), 0), [table])
  const rows = useMemo(() => mapRows(table, hasHeader, roles), [table, hasHeader, roles])
  const header = hasHeader ? (table[0] ?? null) : null
  const importTarget = useMemo<ImportTarget>(
    () => (target === NEW_DECK ? { newDeck: newDeckName } : { deckId: target }),
    [target, newDeckName]
  )
  // Counts come from the backend, by the same rules the import uses.
  const [preview, setPreview] = useState<ImportResult | null>(null)
  useEffect(() => {
    let live = true
    if (importTarget && 'newDeck' in importTarget && !importTarget.newDeck.trim()) setPreview(null)
    else
      window.api.previewImport(rows, importTarget).then(
        (p) => live && setPreview(p),
        () => live && setPreview(null)
      )
    return () => {
      live = false
    }
  }, [rows, importTarget, deckTree])

  const loadFile = useCallback((f: PickedTextFile) => {
    const d = detectDelimiter(f.text)
    const t = parseTable(f.text, d)
    const h = guessHeader(t[0])
    const cols = t.reduce((m, r) => Math.max(m, r.length), 0)
    setFile(f)
    setDelimiter(d)
    setHasHeader(h)
    setRoles(guessRoles(h ? (t[0] ?? null) : null, cols))
    setNewDeckName(f.name.replace(/\.[^.]+$/, ''))
    setStep(1)
  }, [])

  const browse = async (): Promise<void> => {
    try {
      const f = await window.api.pickTextFile()
      if (f) loadFile(f)
    } catch (e) {
      toastError(e, 'Could not open file')
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    try {
      const text = await f.text()
      let path = ''
      try {
        path = window.api.pathForFile(f)
      } catch {
        /* unknown path */
      }
      loadFile({ path, name: f.name, text })
    } catch (err) {
      toastError(err, 'Could not read file')
    }
  }

  // Re-run role guess when header toggle or delimiter changes.
  const changeDelimiter = (d: string): void => {
    if (!file) return
    const t = parseTable(file.text, d)
    const cols = t.reduce((m, r) => Math.max(m, r.length), 0)
    setDelimiter(d)
    setRoles(guessRoles(hasHeader ? (t[0] ?? null) : null, cols))
  }
  const changeHeader = (h: boolean): void => {
    setHasHeader(h)
    setRoles(guessRoles(h ? (table[0] ?? null) : null, colCount))
  }
  const setRole = (i: number, role: ColumnRole): void =>
    setRoles((prev) => prev.map((r, j) => (j === i ? role : role !== 'ignore' && r === role ? 'ignore' : r)))

  const hasFront = roles.includes('front')
  const needsNewName = target === NEW_DECK
  const cards = preview?.notes ?? 0
  const canImport = !busy && cards > 0 && hasFront && (!needsNewName || newDeckName.trim().length > 0)

  const doImport = async (): Promise<void> => {
    if (!file || !canImport) return
    setBusy(true)
    try {
      const res = await window.api.importRows(rows, importTarget, dirName(file.path))
      await refreshDecks()
      setResult({ res, deckId: res.deckId ?? target })
      setStep(2)
      playSound('import')
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setBurst(true)
    } catch (e) {
      toastError(e, 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const reset = (): void => {
    setFile(null)
    setResult(null)
    setStep(0)
  }

  const deckOptions = [
    ...flat.map((d) => ({ value: d.id, label: `${'  '.repeat(d.depth)}${d.name}` })),
    { value: NEW_DECK, label: 'Create new deck…' }
  ]

  const previewRows = (hasHeader ? table.slice(1) : table).slice(0, 5)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {burst && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center">
          <div className="anim-burst absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--accent)_38%,transparent)_0%,color-mix(in_srgb,var(--accent)_12%,transparent)_40%,transparent_70%)]" />
          <div
            className="anim-burst-icon neu-raised relative flex h-36 w-36 items-center justify-center rounded-full text-success"
            onAnimationEnd={() => setBurst(false)}
          >
            <Check size={72} strokeWidth={2.5} />
          </div>
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Import cards</h1>
        <Stepper step={step} />
      </header>

      {step === 0 && (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => void browse()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                void browse()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => void onDrop(e)}
            className={clsx(
              'neu-inset flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed px-6 py-16 text-center transition-all',
              dragging ? 'border-accent bg-accent/10 text-accent' : 'border-muted/40 text-muted hover:border-accent/70'
            )}
          >
            <Upload size={40} className={dragging ? 'text-accent' : 'text-muted'} />
            <p className="text-base font-semibold text-text">
              Drop a .csv / .tsv / .txt file here or click to browse
            </p>
            <p className="text-sm">Comma, semicolon, tab and pipe separated files are detected automatically.</p>
          </div>
          <Panel className="flex flex-col gap-3">
            <label htmlFor="import-paste" className="text-sm font-semibold text-text">
              Or paste text
            </label>
            <p className="-mt-2 text-xs text-muted">For example, CSV from a spreadsheet or from an AI assistant.</p>
            <textarea
              id="import-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={'front,back,deck,tags\nWhat is 2 + 2?,4,Math,'}
              className="neu-inset w-full resize-y rounded-2xl border border-transparent bg-transparent px-4 py-3 font-mono text-sm text-text outline-none placeholder:text-muted/70 focus:border-accent"
            />
            <div className="flex justify-end">
              <Button
                disabled={!pasted.trim()}
                onClick={() => loadFile({ path: '', name: 'Pasted cards', text: pasted.replace(/^\s*```[a-z]*\s*\n|\n\s*```\s*$/gi, '') })}
              >
                Continue
              </Button>
            </div>
          </Panel>
          <HelpCard />
        </>
      )}

      {step === 1 && file && (
        <>
          <Panel className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <FileText className="shrink-0 text-accent" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{file.name}</div>
                <div className="text-xs text-muted">
                  {plural(table.length, 'row')} · {plural(colCount, 'column')}
                </div>
              </div>
            </div>
            <Field label="Delimiter" className="w-40">
              <Select
                aria-label="Delimiter"
                value={delimiter}
                onValueChange={changeDelimiter}
                options={DELIMITERS.map((d) => ({ value: d.value, label: d.label }))}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <Switch checked={hasHeader} onCheckedChange={changeHeader} aria-label="First row is a header" />
              First row is a header
            </label>
          </Panel>

          <Panel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Columns and preview</h2>
            <p className="text-sm text-muted">Choose what each column contains using the menus in the header.</p>
            <Well className="overflow-x-auto p-0">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="align-bottom">
                    {Array.from({ length: colCount }, (_, i) => {
                      const role = roles[i] ?? 'ignore'
                      return (
                        <th
                          key={i}
                          className={clsx(
                            'min-w-44 px-3 pt-3 pb-2 text-left font-normal transition-opacity duration-200',
                            role === 'ignore' && 'opacity-60'
                          )}
                        >
                          <div className="mb-1.5 truncate text-xs text-muted">
                            {header?.[i] ? header[i] : `Column ${i + 1}`}
                          </div>
                          <Select
                            aria-label={`Column ${i + 1} contains`}
                            value={role}
                            onValueChange={(v) => setRole(i, v as ColumnRole)}
                            options={ROLE_OPTIONS}
                            className="h-9"
                          />
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, ri) => (
                    <tr key={ri} className="border-t border-muted/15 align-top">
                      {Array.from({ length: colCount }, (_, i) => {
                        const role = roles[i] ?? 'ignore'
                        const cell = (r[i] ?? '').trim()
                        return (
                          <td
                            key={i}
                            className={clsx(
                              'max-w-72 px-3 py-2.5 transition-opacity duration-200',
                              role === 'ignore' ? 'text-muted opacity-45' : 'text-text',
                              (role === 'deck' || role === 'tags') && 'text-xs'
                            )}
                          >
                            {role === 'front' || role === 'back' ? (
                              <RichHtml html={cell} />
                            ) : role === 'deck' && !cell ? (
                              <span className="text-muted">(target deck)</span>
                            ) : (
                              <span className="break-words">{cell}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Well>
            {!hasFront && (
              <p className="flex items-center gap-2 text-sm text-danger">
                <AlertTriangle size={16} /> Choose one column as Front to continue.
              </p>
            )}
            {preview && (
              <p className="text-sm font-semibold">
                {plural(preview.notes, 'card')} will be imported
                {preview.decksCreated > 0 && `, creating ${plural(preview.decksCreated, 'new deck')}`}
              </p>
            )}
            {!!preview?.skipped && (
              <p className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangle size={16} /> {plural(preview.skipped, 'row')} with an empty front will be skipped.
              </p>
            )}
          </Panel>

          <Panel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Target deck</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Deck for rows without a deck value"
                hint="Rows with a deck column value go to that deck path instead."
              >
                <Select aria-label="Target deck" value={target} onValueChange={setTarget} options={deckOptions} />
              </Field>
              {needsNewName && (
                <Field label="New deck name">
                  <Input
                    value={newDeckName}
                    onChange={(e) => setNewDeckName(e.target.value)}
                    placeholder="e.g. Spanish"
                  />
                </Field>
              )}
            </div>
          </Panel>

          <div className="flex justify-between">
            <Button icon={<ArrowLeft size={16} />} onClick={reset}>
              Choose another file
            </Button>
            <Button variant="primary" size="lg" disabled={!canImport} onClick={() => void doImport()}>
              {busy ? 'Importing…' : `Import ${plural(cards, 'card')}`}
            </Button>
          </div>
        </>
      )}

      {step === 2 && result && (
        <Panel className="flex flex-col items-center gap-5 py-10 text-center">
          <div className="neu-raised flex h-20 w-20 items-center justify-center rounded-full text-success">
            <Check size={36} />
          </div>
          <h2 className="text-xl font-semibold">Import complete</h2>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Stat label="Notes" value={result.res.notes} />
            <Stat label="Cards" value={result.res.cards} />
            <Stat label="Decks created" value={result.res.decksCreated} />
            <Stat label="Skipped" value={result.res.skipped} />
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="primary"
              icon={<Layers size={16} />}
              onClick={() => navigate({ name: 'study', deckId: result.deckId, mode: 'mixed' })}
            >
              Study now
            </Button>
            <Button icon={<FolderOpen size={16} />} onClick={() => navigate({ name: 'browse', deckId: result.deckId })}>
              Browse imported
            </Button>
            <Button onClick={reset}>Import another</Button>
          </div>
        </Panel>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="neu-inset min-w-28 rounded-2xl px-5 py-3">
      <div className="font-display text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}
