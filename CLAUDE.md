# CLAUDE.md

Instructions for Claude Code when you work on this repository.

**This repository is public.** Do not write personal data, access keys or
private notes in any file here.

## Who you are working with

- The owner is not a programmer. He is learning Python, and he does not know
  JavaScript.
- Explain each change in plain English: what changed, why, and what he will
  see in the app. Use short sentences, simple words and the active voice.
  Explain technical words the first time you use them.
- Before you make a large change or a change that is difficult to undo, give a
  short plan and ask for approval. For small, clear changes, do the work and
  then explain it.
- Ask before you add a library, a build tool or any new dependency.

## What the app is

Learning Tester is a personal spaced-repetition flashcard app, similar to
Anki. It is made for the iPhone (as a home-screen web app) and also works in a
browser on the Mac.

- **Scheduling:** FSRS, from `vendor/ts-fsrs.mjs` (ts-fsrs 5.4.2, MIT licence).
- **Offline first:** each device keeps its own copy of the data in IndexedDB.
- **Sync:** through the GitHub API to a separate, **private** data repository
  (`learning-data`). This repository (`learning-tester`) holds only the app's
  code. GitHub Pages publishes it from the `main` branch.
- **Cards come from AI coaching:** the user writes cards, an AI coach critiques
  them, then the user pastes the result into the import screen.
  `coach/INSTRUCTIONS.md` defines the import format and the coaching rules.

## Main design rules (do not break these)

1. **No build step and no framework.** The app is plain HTML, CSS and
   JavaScript modules, and it runs directly from its files. Node.js is not
   installed on the owner's Mac.
2. **The user writes first.** Cards that Claude suggested
   (`"author": "claude"`) stay hidden until the user has added their own.
   Nothing that AI wrote is scheduled before the user approves it.
3. **Schedules are never stored.** A card's schedule is calculated each time
   by replaying its review log through FSRS (`js/scheduler.js`). This makes
   offline reviews on several devices combine correctly.
4. **Reviews are only added, never changed.** Each device writes only to its
   own files: `reviews/<device>/<YYYY-MM>.jsonl`.
5. **Sync never overwrites blindly.** `js/sync.js` reads, merges, then writes.
   If another device committed in the meantime, it starts again.
6. **Nothing is deleted from the review screen.** Cards are archived. They can
   be deleted permanently only from the Archive, after a confirmation.
7. **The data stays readable.** The data repository holds plain JSON, JSONL
   and Markdown files, which any person or AI can read. If the data format
   changes, update `README` text in `js/texts.js` as well.
8. **Hints, not blocks.** The card-writing rules in `js/rules.js` give gentle
   hints. They never stop the user from saving.

## Where things are

| Path | What it does |
|---|---|
| `index.html`, `css/app.css` | The page and its styles (light and dark). |
| `js/app.js` | Start-up and switching between screens (`#/home`, `#/review`, ...). |
| `js/views/*.js` | The screens: home, review, cards, import, settings. |
| `js/store.js` | This device's data (IndexedDB) and control of sync. |
| `js/model.js` | The data format. Pure functions with no storage and no network, so they can be tested. |
| `js/sync.js` | Reading and writing the private GitHub repository. |
| `js/scheduler.js` | FSRS scheduling, daily limits and review sessions. |
| `js/importer.js` | Reading pasted JSON, `Q:`/`A:` text and word lines. |
| `js/rules.js` | Hints from the card-writing rules. |
| `js/match.js` | Marking typed answers (capitals, spaces, accents). |
| `js/texts.js` | Long fixed texts, such as the data repository's README. |
| `js/util.js` | Small shared helpers. A "learning day" starts at 4 am. |
| `sw.js` | Offline support (service worker). |
| `coach/INSTRUCTIONS.md` | Instructions for the AI learning coach, and the import format. |
| `tests/` | Automated tests that run in a browser. |
| `tools/make_icons.py` | Draws the app icons. |

The full build plan (`PLAN.md`) is private. It is in the `learning-data`
repository as `docs/PLAN.md`, and `.gitignore` keeps it out of this
repository. If you need it and cannot see it, ask the owner.

## Checklist for every change

1. **Bump the version in two places,** with the same number:
   - `VERSION` in `sw.js` (for example `'v1.2.3'`). If you do not bump it,
     phones keep the old files.
   - `APP_VERSION` in `js/views/settings.js` (for example
     `'1.2.3 (short description)'`).
2. **If you add a new file that the app loads,** add it to the `FILES` list in
   `sw.js`, so that it works offline.
3. **If you change `coach/INSTRUCTIONS.md`,** increase the number in its first
   line (`<!-- learning-tester:coach v5 -->`). The app then copies the new
   version into the data repository.
4. **If you change the data README in `js/texts.js`,** increase its version
   marker (`learning-tester:data-readme v3`), and change the same marker in
   `js/store.js`.
5. **If you change marking, scheduling, importing, the data format or sync,**
   add or update tests in `tests/tests.js`.
6. **Run the tests,** and make sure that they all pass (see below).
7. **Write a short commit message** that says what changed for the user, with
   the version, for example: `Imports reuse words you already have (v1.2.2)`.

## Running the app and the tests

From the repository folder:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

- App: <http://localhost:8765/>
- Tests: <http://localhost:8765/tests/>. The page shows a summary of passed and
  failed tests.

The tests run in a browser, not in the terminal. If a headless browser (for
example Playwright with Chromium) is available, use it to open the tests page
and read the summary. If no browser is available, tell the owner to open the
tests page on his Mac, and say which tests to look at.

## Publishing

- Changes on `main` go live on GitHub Pages after a minute or two.
- On the iPhone, the owner closes the app fully, opens it again and taps
  **Reload**.
- Commits use GitHub's noreply email address. Do not use a personal email
  address.
