export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  config TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES decks(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  preset_id  TEXT REFERENCES presets(id) ON DELETE SET NULL,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decks_parent ON decks(parent_id);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  deck_id    TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  front      TEXT NOT NULL,
  back       TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_deck ON notes(deck_id);

CREATE TABLE IF NOT EXISTS cards (
  id             TEXT PRIMARY KEY,
  note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL DEFAULT 'fwd',
  state          INTEGER NOT NULL DEFAULT 0,
  due            INTEGER NOT NULL,
  stability      REAL NOT NULL DEFAULT 0,
  difficulty     REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  fsrs           TEXT,
  reps           INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  last_review    INTEGER,
  suspended      INTEGER NOT NULL DEFAULT 0,
  buried_until   INTEGER,
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(state, due);

CREATE TABLE IF NOT EXISTS review_log (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL,
  state          INTEGER NOT NULL,
  due            INTEGER NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  scheduled_days REAL NOT NULL,
  revlog         TEXT,
  review_ms      INTEGER NOT NULL DEFAULT 0,
  ts             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_card ON review_log(card_id);
CREATE INDEX IF NOT EXISTS idx_log_ts ON review_log(ts);
`
