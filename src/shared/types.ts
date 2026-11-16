// Shared domain types used by main, preload and renderer.

export type Id = string

/** FSRS card state (mirrors ts-fsrs State enum values). */
export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3
}

/** Rating (mirrors ts-fsrs Rating enum values). */
export enum Rating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4
}

export interface Deck {
  id: Id
  parentId: Id | null
  name: string
  presetId: Id | null
  collapsed: boolean
  createdAt: number
}

export interface DeckCounts {
  /** New cards available to study today (after daily limit). */
  new: number
  /** Learning/relearning cards due within the learn-ahead limit from now. */
  learning: number
  /** Review cards due today (after daily limit). */
  review: number
  /** Total non-suspended cards in subtree. */
  total: number
}

export interface DeckNode extends Deck {
  /** Full path of names from root, e.g. ["Economics","Micro"]. */
  path: string[]
  depth: number
  children: DeckNode[]
  /** Counts include the whole subtree. */
  counts: DeckCounts
}

export interface Note {
  id: Id
  deckId: Id
  front: string // HTML
  back: string // HTML
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface Card {
  id: Id
  noteId: Id
  direction: 'fwd' | 'rev'
  state: CardState
  due: number // ms epoch
  stability: number
  difficulty: number
  scheduledDays: number
  reps: number
  lapses: number
  lastReview: number | null
  suspended: boolean
  buriedUntil: number | null
}

/** A card ready to be shown in a study session. */
export interface StudyCard {
  card: Card
  note: Note
  deckPath: string[]
  /** Question / answer HTML, already flipped for reverse cards. */
  question: string
  answer: string
}

export type StudyMode = 'mixed' | 'review' | 'learn' | 'cram' | 'weak'

export interface StudySession {
  mode: StudyMode
  deckId: Id
  cards: StudyCard[]
  /** Whether answers in this mode change the schedule. */
  affectsSchedule: boolean
  /** Learn-ahead limit: a waiting learning card due within this many ms is shown right away. */
  learnAheadMs: number
}

export interface AnswerResult {
  card: Card
  /** True if the card should come back later in this session (learning step). */
  requeue: boolean
}

/** Human labels for the next interval of each rating, e.g. {1:"1m",2:"6m",3:"10m",4:"4d"}. */
export type IntervalPreview = Record<Rating, string>

export interface PresetConfig {
  desiredRetention: number // 0.7 - 0.99
  learningSteps: string[] // e.g. ["1m","10m"]
  relearningSteps: string[] // e.g. ["10m"]
  maximumInterval: number // days
  newPerDay: number
  reviewsPerDay: number
  enableFuzz: boolean
  newOrder: 'sequential' | 'random'
  burySiblings: boolean
  /** Optional custom FSRS weights (from optimiser). */
  weights?: number[]
}

export interface Preset {
  id: Id
  name: string
  config: PresetConfig
}

export const DEFAULT_PRESET_CONFIG: PresetConfig = {
  desiredRetention: 0.9,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  maximumInterval: 36500,
  newPerDay: 20,
  reviewsPerDay: 200,
  enableFuzz: true,
  newOrder: 'sequential',
  burySiblings: true
}

/** Settings stored with the collection (synced across devices). */
export interface CollectionSettings {
  dayStartHour: number // 0-23, default 4
  learnAheadMinutes: number // default 20
}

export const DEFAULT_COLLECTION_SETTINGS: CollectionSettings = {
  dayStartHour: 4,
  learnAheadMinutes: 20
}

export type Theme = 'light' | 'dark' | 'system'

/** Accent palette (independent of light/dark). */
export type Accent = 'ember' | 'aqua' | 'iris' | 'rose'

/** Per-device preferences (NOT synced; stored in userData). */
export interface Prefs {
  dataDir: string | null
  theme: Theme
  accent: Accent
  showHotkeyHints: boolean
  fontScale: number // 0.85 - 1.3
  /** Shortcut id -> key combo override, e.g. { "study.reveal": "Enter" } */
  shortcutOverrides: Record<string, string>
  lastDeckId: Id | null
  creatorReverse: boolean
  /** Short synthesized UI sounds. */
  soundEffects: boolean
  /** 0 - 1 */
  soundVolume: number
}

export const DEFAULT_PREFS: Prefs = {
  dataDir: null,
  theme: 'system',
  accent: 'ember',
  showHotkeyHints: true,
  fontScale: 1,
  shortcutOverrides: {},
  lastDeckId: null,
  creatorReverse: false,
  soundEffects: true,
  soundVolume: 0.6
}

export interface BrowseQuery {
  deckId?: Id | null // includes subtree
  search?: string
  tag?: string
  state?: CardState | 'suspended' | 'due'
  limit?: number
  offset?: number
}

export interface BrowseRow {
  cardId: Id
  noteId: Id
  deckId: Id
  deckPath: string[]
  front: string
  back: string
  tags: string[]
  direction: 'fwd' | 'rev'
  state: CardState
  due: number
  reps: number
  lapses: number
  suspended: boolean
  updatedAt: number
}

export interface ImportRow {
  front: string
  back: string
  deckPath?: string // "A::B::C"
  tags?: string[]
}

export interface ImportResult {
  notes: number
  cards: number
  decksCreated: number
  skipped: number
}

export interface PickedTextFile {
  path: string
  name: string
  text: string
}

export type LockStatus =
  | { kind: 'ok' }
  | { kind: 'locked'; device: string; since: number }
  | { kind: 'readonly'; device: string }

export interface StartupState {
  dataDir: string
  lock: LockStatus
  /** Conflicted copies created by a cloud sync client, e.g. "collection-PC-2.db". */
  conflicts: { file: string; modified: number; size: number }[]
  readOnly: boolean
}

export interface DayStats {
  day: string // YYYY-MM-DD
  reviews: number
  again: number
  newCards: number
  timeMs: number
}

export interface Stats {
  days: DayStats[] // last 365 days
  forecast: { day: string; due: number }[] // next 30 days
  totals: { cards: number; new: number; learning: number; review: number; suspended: number }
  retention30d: number | null
  streak: number
}
