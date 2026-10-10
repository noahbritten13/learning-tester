# Setting up Learning Tester

This guide gets the app onto your iPhone and Mac, syncing through GitHub.
Allow about 30 minutes. You only do this once.

**What you'll end up with:**

- **`learning-tester`**: a *public* GitHub repository holding the app's code,
  published as a web page by GitHub Pages. It contains no personal data.
- **`learning-data`**: a *private* GitHub repository holding your cards,
  library and review history as plain-text files.
- The app on your iPhone's home screen and in your Mac's browser, both syncing
  with `learning-data`.

---

## Part A: Create a GitHub account

1. Go to <https://github.com/signup> and create a free account.
2. Note your **username** (shown at the top right when signed in). You'll need
   it later.

## Part B: Create the two repositories

**The data repository (private):**

1. Go to <https://github.com/new>.
2. Repository name: `learning-data`
3. Choose **Private**.
4. Tick **Add a README file**.
5. Click **Create repository**.

**The app repository (public):**

1. Go to <https://github.com/new> again.
2. Repository name: `learning-tester`
3. Choose **Public**. (GitHub Pages is free for public repositories. The app's
   code is public, but your data never goes here.)
4. Leave everything else unticked (no README).
5. Click **Create repository**.

## Part C: Publish the app

**1. Create an access key for publishing the code.**

1. Go to <https://github.com/settings/personal-access-tokens/new>. (Or: your
   profile picture → **Settings** → **Developer settings** → **Personal access
   tokens** → **Fine-grained tokens** → **Generate new token**.)
2. Token name: `Mac: publish app`
3. Expiration: the longest option offered.
4. Repository access: **Only select repositories** → choose both
   `learning-tester` **and** `learning-data`. (The second lets your Mac keep
   the project plan, PLAN.md, in your private repository rather than the
   public one.)
5. Permissions: find **Contents** and set it to **Read and write**.
6. Click **Generate token** and copy it. GitHub shows it only once.

**2. Push the code.** Tell Claude "publish the app" and it will prepare the
code. Then run the push command it gives you in Terminal. When asked:

- **Username:** your GitHub username
- **Password:** paste the access key from step 1. Nothing appears as you
  paste; that's normal. Press Return.

Your Mac remembers the key in its Keychain, so you won't be asked again.

**3. Turn on GitHub Pages.**

1. Open `https://github.com/YOUR-USERNAME/learning-tester/settings/pages`.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
4. After a minute or two, the app is live at
   `https://YOUR-USERNAME.github.io/learning-tester/`.

## Part D: Create an access key for the app

This key lets the app read and write your data repository, and nothing else.
Make **one per device**, so if you lose your phone you can cancel just its key.

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. Token name: `Learning Tester: iPhone` (and later another one for `Mac`)
3. Expiration: the longest option offered. The app will tell you when a key
   stops working, and you can make a new one in a minute.
4. Repository access: **Only select repositories** → choose **`learning-data`**
   only.
5. Permissions: find **Contents** and set it to **Read and write**.
6. Click **Generate token** and copy it.

Keep it somewhere safe until you've pasted it into the app, for example in the
Passwords app. Don't put it in a chat, an email or a note that syncs elsewhere.

## Part E: Install on your iPhone

1. On your iPhone, open **Safari** and go to
   `https://YOUR-USERNAME.github.io/learning-tester/`.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. **Open the app from the new home-screen icon.** Don't use the Safari tab:
   the home-screen app keeps its own storage, separate from Safari.
4. On the welcome screen:
   - Name for this device: `iPhone`
   - GitHub username: your username
   - Data repository name: `learning-data`
   - Access key: paste the iPhone key from Part D
5. Tap **Connect**. You should see "Connected and synced."

## Part F: Set up your Mac

1. Open `https://YOUR-USERNAME.github.io/learning-tester/` in Safari or Chrome.
   In Safari you can also use **File → Add to Dock** to make it an app.
2. Name it `Mac` and connect with a Mac key from Part D (make a second key).

## Part G: Add the coach instructions to Claude

1. In the app, go to **Settings → Instructions for Claude** and tap
   **Copy instructions**.
2. In claude.ai, open your **Learning library & tester** Project, edit its
   **instructions**, and paste them in.
3. In a chat in that Project, try: "Help me make cards on what an API is." Claude
   should ask you to draft your own cards first.

---

## What to check in phase 1

- [ ] The app opens from the iPhone home screen without Safari's address bar.
- [ ] **Import:** paste the JSON Claude gives you. Your cards are ticked,
      Claude's suggestions are hidden until you choose to see them, and hints
      appear on cards that break the card-writing rules.
- [ ] **Review:** type an answer, check it, and rate it. An "Again" card comes
      back after the others. For a "marked automatically" card, try leaving
      off an accent: it should be accepted, with the correct spelling shown.
- [ ] **Offline:** turn on Airplane Mode, review a few cards, then turn it
      off. The status should go from "Offline · saved here" to "Synced."
- [ ] **Two devices:** review on the iPhone, then open the app on your Mac.
      Your reviews and the "Today" panel should match.
- [ ] **Archive:** archive a card from the review screen (⋯ menu), find it
      under Cards → Archived, and restore it.
- [ ] **GitHub:** open your `learning-data` repository on github.com. You
      should see `cards/`, `reviews/` and `themes.json`, all readable.
- [ ] **Backup:** Settings → Download everything saves a file.

## If something goes wrong

- **"GitHub rejected the access key":** the key was mistyped, has expired, or
  was deleted. Make a new one (Part D) and reconnect in Settings.
- **"Repository not found":** check the username and repository name, and
  that the key was given access to `learning-data`.
- **The app looks out of date after an update:** close it fully (swipe it away
  in the app switcher) and reopen it. A "Reload" message may also appear.
- **Nothing is lost if sync fails:** your reviews are kept on the device and
  sync next time it works.
