// Types for Trash and automatic backups (kept apart from types.ts).

export interface TrashItem {
  id: string
  kind: 'deck' | 'notes'
  /** Plain description, e.g. `Deck "Economics"` or `3 cards`. */
  label: string
  cardCount: number
  deletedAt: number
}

export const TRASH_DAYS = 30

export interface AutoBackupState {
  /** Only browser-only storage needs automatic download backups. */
  available: boolean
  enabled: boolean
  /** Time of the last automatic backup download. */
  lastAt: number | null
}
