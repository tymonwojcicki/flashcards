# Flashcards

> **Vibe code:** This project was vibe-coded in a day with Claude Code. I directed it and tested the result, but I did not write or review code by hand

Spaced-repetition flashcards (FSRS) with nested decks, math and images.

**Use it:** https://tymonwojcicki.github.io/flashcards/ — open in Chrome or Edge, click **Install** in the address bar.

**Browser:** use Chrome or Edge on a computer. Firefox and Safari can't open folders, so syncing won't work there: your data stays inside that browser only.

## Features

- Nested decks (`Economics::Micro::Elasticity`)
- Cards with text, math (visual editor, Σ button) and pasted images
- Study modes: Study, Review only, Learn new, Practice all, Weak spots
- CSV / TSV import
- Keyboard-first, with on-screen hotkey hints (toggle with `Ctrl+/`, list with `?`)

## Sync

Settings → Data → **Change folder** → pick a folder in OneDrive, Dropbox or Google Drive. Do the same on your other PCs. Use one PC at a time.

Your data stays in that folder. There are no accounts and no server.

## Sharing

Deck menu (`⋯`) → **Export…** → **Deck file**. This saves one `.fdeck` file with the cards and images. Send it; the other person clicks **Import deck file** on the Decks page.

## CSV format

Columns: `front, back, deck, tags`. Only front and back are required. Use `::` in `deck` for sub-decks.
