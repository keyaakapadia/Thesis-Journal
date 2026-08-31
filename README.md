# Thesis Journal

A reference library + weekly process log for the thesis. Three files, no build
step, no framework. Data lives in your browser (IndexedDB) and — once you turn on
GitHub sync — in a `data.json` file in a repo, one commit per change.

## Open it

Double-click `index.html`. If `file://` ever misbehaves, serve the folder:

```bash
cd "/Users/keyaa/Desktop/Thesis/Thesis Journal" && python3 -m http.server 8000
```

then visit <http://localhost:8000>.

## Look

One grotesque sans-serif throughout (Helvetica Neue / Inter), small type, lots of
air, hierarchy from weight + whitespace rather than rules, live clock — after
**bysuhani.com**. Structure and voice after **openstudioprocess.xyz** — warm
paper ground, the *"Keyaa is currently"* weekly note with an archive, and the
Journal as a dated log.

## What it does

### Weekly status — "Keyaa is currently"
- The block under the title holds **one short, human note per week** about what
  you're working on.
- **add this week's note** — writes a new note dated to this week's Monday
  (change the date if you like). ⌘/Ctrl+Enter saves.
- **archive (N)** — every past week's note, newest first, each editable.
- The newest note is always what shows as "currently".

### Entries
- Six kinds: **Reading, Reference, Resource / Website, Image, Annotated document**
  (PDF + notes), and **Journal** (a full dated process entry — longer than the
  weekly status note, with its own title, projects, tags and attachments).
- In any note, lines starting with `-`, `>` or `•` render as `↳` sub-points.
- **Date** — every entry has one; blank defaults to the day you add it. The ISO
  week (`2026 · Week 35`) is shown automatically.
- **Projects** — 256, Prototype 1, Prototype 2, Thesis Proposal, General.
  Multi-select; an entry appears under every project it belongs to.
- **Tags** — free-form, become filter chips once used.
- **Attachments** — drag / pick / paste images and PDFs. On a phone the picker
  offers the camera and photo library. Every image, wherever it's attached, also
  shows in the **Images** view grouped by project. PDFs open in a new tab; paste
  their text into notes to make it searchable.

### Views
All · Readings · Resources · Images · Documents · Journal · Calendar.
Calendar is a month grid — tap any day with entries to expand it. Journal is a
reverse-chronological log with a full-date header per day.

### Search & sort
Search matches titles, authors, publications, URLs, notes, tags, project names
and filenames. Sort by date, recently added, or title. Last view / sort / theme
are remembered. Light / dark toggle (◐).

## GitHub sync + phone  (⇅ button)

This makes the journal shared across devices and version-controlled: the app
keeps a `data.json` in a GitHub repo and **commits it on every change**, so the
commits show up in GitHub Desktop after it fetches.

### One-time setup

1. **Make the repo.** In GitHub Desktop: `File ▸ Add Local Repository…` → pick
   this folder (it's already a git repo) → **Publish repository** (Private is
   fine). Or publish an empty repo on github.com and copy these files in.
2. **Create a token.** github.com → *Settings ▸ Developer settings ▸
   Personal access tokens ▸ Fine-grained tokens ▸ Generate new token*. Limit it
   to **only this repository**, permission **Contents: Read and write**. Copy the
   token (starts with `github_pat_…`).
3. **Connect.** In the app, click **⇅**, enter `owner/repo` (e.g.
   `keyaa/thesis-journal`), branch `main`, path `data.json`, paste the token,
   **Connect**. If GitHub already has data it asks which copy to keep.

Repeat step 3 on every device — laptop, phone — using the same repo + a token.
For the phone you need the app on a URL: enable **GitHub Pages** for the repo
(*Settings ▸ Pages ▸ Deploy from branch ▸ main*), then open the Pages URL on the
phone and connect there too. Add refs, images and notes from the phone; they
commit to the repo and appear everywhere.

### Notes & caveats
- The token is stored in that browser's local storage only — it is never sent
  anywhere except api.github.com. Use a fine-grained token scoped to this one
  repo so a leak can't touch anything else. Don't enable sync on a shared
  computer.
- One writer at a time is safest. If two devices edit while both are offline,
  the last one to sync wins for `data.json` (a stale-commit conflict is retried
  once automatically).
- GitHub Desktop won't auto-refresh — hit **Fetch origin** / **Pull** to see the
  commits the app pushed, and to send local edits to `data.json` back up.
- Without a token, a hosted copy still **reads** `data.json` on load, so the
  Pages URL shows the current journal even before you connect.

## Backups

Even with sync on, **Export** (top bar) downloads a full
`thesis-journal-YYYY-MM-DD.json` — entries, attachments and the weekly archive.
**Import** merges one back (same-id items overwritten, the rest kept).

## Files

| file | purpose |
|------|---------|
| `index.html` | markup |
| `styles.css` | all styling (light + dark) |
| `app.js` | logic, storage, GitHub sync |
| `data.json` | the synced journal file (starts empty) |
