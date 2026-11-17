# Flashcards

Spaced-repetition flashcards (FSRS) with nested decks, math and images.

Vibe-coded in about a day with Claude Code. I directed it and tested it.

## Use it

- **Web:** https://tymonwojcicki.github.io/flashcards/ (use Chrome or Edge, and click **Install** in the address bar if you want it as an app; on Firefox and Safari your cards stay in that browser only)
- **Desktop (Windows):** download `Flashcards-Setup-x.y.z.exe` from [Releases](https://github.com/tymonwojcicki/flashcards/releases/latest). Windows will warn about an unknown publisher: click **More info → Run anyway**. The app updates itself after that.

## Features

- Nested decks e.g. Economics -> Microeconomics -> Elasticity 
- Cards with text, math (visual editor, Σ button) and pasted images
- Study modes: Study, Review only, Learn new, Practice all, Weak spots
- CSV / TSV import
- Keyboard-first, with on-screen hotkey hints (toggle with `Ctrl+/`, list with `?`)

## Sync across devices

Settings → Data → **Change folder** → pick a folder in OneDrive, Google Drive or Dropbox. Do the same on your other devices. Use one device at a time.

There are no accounts and no server, and the app works fully offline.

## Sharing

Deck menu (`⋯`) → **Export…** → **Deck file**. This saves one `.fdeck` file with the cards and images. Send it; the other person clicks **Import deck file** on the Decks page.

## CSV format

Columns: `front, back, deck, tags`. Only front and back are required. Use `::` in `deck` for sub-decks.
