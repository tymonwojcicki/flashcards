# Flashcards

A desktop flashcard app for Windows that uses spaced repetition (FSRS) to schedule your reviews, so you spend less time on what you already know and more on what you're about to forget.

## What it is

- **Spaced repetition** powered by the FSRS algorithm
- **Nested decks**, e.g. `Economics::Microeconomics::Elasticity`
- **Math** rendered with KaTeX (`$inline$` and `$$block$$`)
- **Images** on cards
- **CSV and TSV import** with column mapping
- **Study modes**:
  - **Study**: mixed reviews from all due cards
  - **Review**: only cards that are due
  - **Learn**: new cards in short learning steps
  - **Cram**: review anything, without affecting schedules
  - **Weak spots**: focus on cards you keep missing

## Install

### Option A — Web app (recommended, works everywhere)

1. Open the app's GitHub Pages link (`https://<your-username>.github.io/<repo>/`) in **Chrome or Edge**.
2. Click the **Install** icon in the address bar (or menu → *Install Flashcards*). It now opens in its own window from the Start menu, works offline, and updates itself.

No `.exe` is involved, so Windows **Smart App Control** can't block it — the easiest way to share with friends: just send them the link.

### Option B — Desktop app (.exe)

1. Go to the **Releases** page of this repository on GitHub.
2. Download either `Flashcards-Setup-x.y.z.exe` (installer) or `Flashcards-x.y.z-portable.exe`.
3. The app is unsigned: SmartScreen shows a warning — click **More info → Run anyway**. On PCs with **Smart App Control** turned on, unsigned apps are blocked entirely; use the web app instead.

## Using it on multiple PCs

1. On each PC, open **Settings → Data → Change folder** and choose a folder inside OneDrive, Dropbox, or Google Drive. (Without this, the web app keeps data in the browser only.)
2. Your decks and progress sync through that folder. The web app and the desktop app use the **same folder format**, so you can mix them.
3. **Don't use the app on two PCs at the same time.** It warns you if another PC already has it open.
4. Automatic backups are saved to the `backups` folder.
5. In the web app, the browser may ask you once per visit to allow access to the folder ("Open my folder") — choose *Allow on every visit* when offered.

## Sharing decks with friends

1. Right-click a deck and choose **Export**. This creates a `.fdeck` file.
2. Send the file to your friend.
3. They open the app and choose **Import**.

## CSV format

- The header row is optional. If you include one, use the columns below.
- Columns: `front`, `back`, `deck`, `tags`
- `deck` uses `::` for sub-decks, e.g. `Economics::Microeconomics::Supply and Demand`
- `tags` are separated by spaces
- Math: `$...$` for inline, `$$...$$` for block
- Images: `<img src="images/foo.png">`, relative to the CSV file
- Encoding: UTF-8
- Delimiter: comma, semicolon, or tab. The importer lets you map columns.

Sample files are in the [`samples`](samples) folder: `economics.csv` and `spanish.tsv`.

## Keyboard shortcuts

### Studying

| Key | Action |
| --- | --- |
| `Space` | Reveal answer |
| `1` / `2` / `3` / `4` | Again / Hard / Good / Easy |
| `Ctrl+Z` | Undo |
| `E` | Edit card |
| `B` | Bury card |
| `S` | Suspend card |
| `Esc` | Exit study |

### Editing

| Key | Action |
| --- | --- |
| `Ctrl+Enter` | Save card and go to next |
| `Tab` | Switch field |
| `Ctrl+M` | Insert math |
| `Ctrl+Shift+I` | Insert image |
| `Ctrl+D` | Choose deck |
| `Ctrl+R` | Toggle reverse card |

### General

| Key | Action |
| --- | --- |
| `Ctrl+K` | Command palette |
| `Ctrl+/` | Toggle hotkey hints |
| `?` | Show all shortcuts |
| `Ctrl+1` to `Ctrl+4` | Navigate between sections |
| `Ctrl+,` | Open settings |

## Development

Requires **Node.js 24+**.

```bash
npm install        # install dependencies
npm run dev        # start the desktop app in development mode
npm run dev:web    # start the web app at http://localhost:5199
npm test           # run tests
npm run build:win  # build the Windows installer and portable app
npm run build:web  # build the web app into dist-web/
```

Desktop build output goes to `release/<version>/`.

Project layout: `src/main` (desktop backend; `db/core.ts` and `services/` are platform-neutral and shared with the web build), `src/web` (browser backend + PWA), `src/renderer` (the React UI shared by both), `src/shared` (types and the API contract).

## Releasing

**Web app:** every push to `main` deploys to GitHub Pages automatically (one-time setup: repo **Settings → Pages → Source: GitHub Actions**).

**Desktop app:**


1. Bump `version` in `package.json`.
2. Create and push a tag:
   ```bash
   git tag v0.1.0
   git push --tags
   ```
3. GitHub Actions builds the installer and attaches it to a new GitHub Release.
4. Installed copies of the app update automatically from these releases.
