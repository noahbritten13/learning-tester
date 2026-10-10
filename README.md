# Learning Tester

A personal spaced-repetition flashcard app. It's designed for the iPhone, works
offline, and syncs through a private GitHub repository. Scheduling uses FSRS via
[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT licence).

- **[SETUP.md](SETUP.md):** how to install it (GitHub, iPhone, Mac).
- **[coach/INSTRUCTIONS.md](coach/INSTRUCTIONS.md):** instructions for an AI
  learning coach that produces cards in the app's import format.

## How it's built

The app is plain HTML, CSS and JavaScript modules, with no build step and no
framework.

| Path | What it does |
|---|---|
| `index.html`, `css/app.css` | The page and its styles (light and dark). |
| `js/app.js` | Start-up and switching between screens. |
| `js/views/*.js` | The screens: home, review, cards, import, settings. |
| `js/store.js` | This device's data (IndexedDB) and sync orchestration. |
| `js/model.js` | The data format: how cards, entries and reviews become files. |
| `js/sync.js` | Reading and writing the private GitHub repository. |
| `js/scheduler.js` | FSRS scheduling, daily limits and review sessions. |
| `js/importer.js` | Reading pasted JSON or `Q:`/`A:` text. |
| `js/rules.js` | Hints from the card-writing rules. |
| `js/match.js` | Marking typed answers (capitals, spaces, accents). |
| `sw.js` | Offline support. **Bump `VERSION` whenever files change.** |
| `vendor/ts-fsrs.mjs` | ts-fsrs 5.4.2 (MIT, see `vendor/ts-fsrs.LICENSE`). |
| `tests/` | Automated tests that run in the browser. |
| `tools/make_icons.py` | Draws the app icons. |

## Running it on the Mac

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open <http://localhost:8765/> for the app, or
<http://localhost:8765/tests/> for the tests.
