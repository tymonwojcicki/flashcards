// The IPC contract. Every method is invoked from the renderer via window.api.<method>(...)
// and handled in the main process (src/main/ipc.ts). All return Promises.
import type {
  AnswerResult,
  BrowseQuery,
  BrowseRow,
  CollectionSettings,
  Deck,
  DeckNode,
  Id,
  ImportResult,
  ImportRow,
  ImportTarget,
  IntervalPreview,
  Note,
  PickedTextFile,
  Preset,
  PresetConfig,
  Prefs,
  Rating,
  StartupState,
  Stats,
  StudyMode,
  StudySession
} from './types'
import type { AutoBackupState, TrashItem } from './dataSafety'

export interface Api {
  // ---- app / startup ----
  getStartupState(): StartupState
  /** Take over a lock held by another device. */
  forceUnlock(): StartupState
  openReadOnly(): StartupState
  /** Replace the main collection with a conflicted copy (current one is backed up), or delete the copy. */
  resolveConflict(file: string, action: 'use' | 'discard'): StartupState
  /** Open folder picker; switches data folder. If folder has no collection, current data is copied there. */
  chooseDataDir(): StartupState | null
  openDataDir(): void
  backupNow(): string
  /** Browser-only storage: download a backup if enabled and the last one is 7+ days old. Returns the file name, else null. */
  runAutoBackup(): string | null
  getAutoBackup(): AutoBackupState
  setAutoBackup(enabled: boolean): void
  /** Pick a backup file and check it. Returns its name, or null if cancelled. Throws if it is not a backup. */
  pickBackup(): string | null
  /** Replace all data with the file chosen by pickBackup. The current data is backed up first. */
  restoreBackup(): void

  // ---- trash (30 days) ----
  listTrash(): TrashItem[]
  restoreTrash(id: string): void
  deleteTrashForever(id: string): void
  emptyTrash(): void

  // ---- prefs (per device) ----
  getPrefs(): Prefs
  setPrefs(patch: Partial<Prefs>): Prefs

  // ---- collection settings (synced) ----
  getCollectionSettings(): CollectionSettings
  setCollectionSettings(patch: Partial<CollectionSettings>): CollectionSettings

  // ---- decks ----
  getDeckTree(): DeckNode[]
  createDeck(name: string, parentId: Id | null): Deck
  /** Creates the missing decks of a path like "A::B::C" together (or none). Returns the deepest deck's id. */
  createDeckPath(path: string, parentId: Id | null): Id
  renameDeck(id: Id, name: string): void
  moveDeck(id: Id, newParentId: Id | null): void
  /** Moves the deck to the Trash. Returns the trash id (pass to restoreTrash to undo). */
  deleteDeck(id: Id): string | null
  setDeckCollapsed(id: Id, collapsed: boolean): void
  /** null = inherit from parent */
  setDeckPreset(id: Id, presetId: Id | null): void
  /** Resolved preset (inherits up the tree). */
  getDeckPreset(id: Id): Preset

  // ---- presets ----
  listPresets(): Preset[]
  createPreset(name: string, config?: PresetConfig): Preset
  updatePreset(id: Id, patch: { name?: string; config?: Partial<PresetConfig> }): Preset
  deletePreset(id: Id): void

  // ---- notes / cards ----
  createNote(input: { deckId: Id; front: string; back: string; tags: string[]; reverse: boolean }): Note
  updateNote(id: Id, patch: { front?: string; back?: string; tags?: string[]; deckId?: Id }): Note
  getNote(id: Id): Note | null
  /** Moves the notes to the Trash. Returns the trash id. */
  deleteNotes(ids: Id[]): string | null
  moveNotes(ids: Id[], deckId: Id): void
  setSuspended(cardIds: Id[], suspended: boolean): void
  addTags(noteIds: Id[], tags: string[]): void
  resetCards(cardIds: Id[]): void
  browse(q: BrowseQuery): { rows: BrowseRow[]; total: number }
  listTags(deckId?: Id | null): string[]

  // ---- study ----
  getSession(deckId: Id, mode: StudyMode): StudySession
  answer(cardId: Id, rating: Rating, durationMs: number): AnswerResult
  previewIntervals(cardId: Id): IntervalPreview
  /** Undo the last answer; returns the card id that was restored, or null. */
  undo(): Id | null
  buryCard(cardId: Id): void

  // ---- media ----
  /** Save an image (base64 without data: prefix). Returns the URL to embed: "media://<hash>.<ext>" */
  saveMedia(base64: string, ext: string): string
  pickImage(): string | null

  // ---- import / export ----
  pickTextFile(): PickedTextFile | null
  /** What importRows would create for these rows, without writing. */
  previewImport(rows: ImportRow[], target: ImportTarget): ImportResult
  importRows(rows: ImportRow[], target: ImportTarget, baseDir: string | null): ImportResult
  exportDeck(deckId: Id, format: 'fdeck' | 'csv', includeProgress: boolean): string | null
  importDeckFile(parentId: Id | null, includeProgress: boolean): ImportResult | null

  // ---- stats ----
  getStats(deckId: Id | null): Stats
}

export type ApiMethod = keyof Api

/** Runtime list of methods (the preload needs names; contextBridge can't expose a Proxy). */
export const API_METHODS = [
  'getStartupState', 'forceUnlock', 'openReadOnly', 'resolveConflict', 'chooseDataDir', 'openDataDir', 'backupNow', 'runAutoBackup', 'getAutoBackup', 'setAutoBackup', 'pickBackup', 'restoreBackup',
  'listTrash', 'restoreTrash', 'deleteTrashForever', 'emptyTrash',
  'getPrefs', 'setPrefs', 'getCollectionSettings', 'setCollectionSettings',
  'getDeckTree', 'createDeck', 'createDeckPath', 'renameDeck', 'moveDeck', 'deleteDeck', 'setDeckCollapsed', 'setDeckPreset', 'getDeckPreset',
  'listPresets', 'createPreset', 'updatePreset', 'deletePreset',
  'createNote', 'updateNote', 'getNote', 'deleteNotes', 'moveNotes', 'setSuspended', 'addTags', 'resetCards', 'browse', 'listTags',
  'getSession', 'answer', 'previewIntervals', 'undo', 'buryCard',
  'saveMedia', 'pickImage',
  'pickTextFile', 'previewImport', 'importRows', 'exportDeck', 'importDeckFile',
  'getStats'
] as const satisfies readonly ApiMethod[]

// Compile-time check that API_METHODS lists every method.
type _Missing = Exclude<ApiMethod, (typeof API_METHODS)[number]>
export const _apiMethodsComplete: [_Missing] extends [never] ? true : _Missing = true

/** Wire format for IPC results (so errors keep their message). */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** What the renderer sees: every method returns a Promise. */
export type RendererApi = {
  [K in keyof Api]: (...args: Parameters<Api[K]>) => Promise<ReturnType<Api[K]>>
} & {
  /** Subscribe to main-process events. Returns unsubscribe fn. */
  on(event: MainEvent, cb: () => void): () => void
}

/** Events pushed from main -> renderer. */
export type MainEvent = 'collection-reloaded' | 'collection-changed' | 'lock-lost'
