# Flashcards

> **Vibe code:** This project was vibe-coded in a day with Claude Code. I directed it and tested the result, but I did not write or review code by hand

Spaced-repetition flashcards (FSRS) with nested decks, math and images.

**Use it:** https://tymonwojcicki.github.io/flashcards/ — open in Chrome or Edge, click **Install** in the address bar.

**Browser:** use Chrome or Edge on a computer. Firefox and Safari can't open folders, so syncing won't work there: your data stays inside that browser only.

## Features

- Nested decks (`Economics::Micro::Elasticity`)
- Cards with text, math (`$x^2$`) and pasted images
- Study modes: Study, Review only, Learn new, Practice all, Weak spots
- CSV / TSV import
- Keyboard-first, with on-screen hotkey hints (toggle with `Ctrl+/`, list with `?`)

## Sync

Settings → Data → **Change folder** → pick a folder in OneDrive, Dropbox or Google Drive. Do the same on your other PCs. Use one PC at a time.

Your data stays in that folder. There are no accounts and no server.

## Sharing

Deck menu (`⋯`) → **Export…** → `.fdeck`. Send the file; the other person uses **Import .fdeck**.

## CSV format

Columns: `front, back, deck, tags`. Only front and back are required. Use `::` in `deck` for sub-decks.

## Development

```bash
npm install
npm run dev:web     # web app at http://localhost:5199
npm test
```

Pushing to `main` deploys the web app to GitHub Pages. A Windows `.exe` is built when a `v*` tag is pushed (unsigned, so Smart App Control blocks it — use the web app).
