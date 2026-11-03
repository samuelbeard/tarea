# Tarea

A day-to-day todo app for macOS that saves everything as plain markdown files in a folder you choose.

## Installing the beta

1. Download `Tarea_<version>_universal.dmg` from the latest release and drag Tarea to Applications.
2. The beta isn't notarized by Apple, so the first launch needs a right-click (or Control-click) on Tarea → **Open** → **Open**. After that it opens normally.
3. Tarea checks for updates when it starts, and from **Tarea → Check for Updates…**. Accept the update and it restarts on the new version.

Requires macOS 11 or later.

## Where your data lives

On first launch Tarea asks for a folder and keeps its files in a `Tarea` folder inside it. A folder synced by iCloud Drive or Dropbox works, so you can edit todos from other apps too.

```
Tarea/
  2026-10-21/
    buy-milk.md      one file per todo
    note.md          the day's own notes (optional)
```

Each todo is markdown with YAML frontmatter; anything after the frontmatter is the todo's notes:

```markdown
---
id: 1761040000000-000000
title: Buy milk
status: incomplete   # incomplete, in_progress, blocked, complete or cancelled
priority: high       # left out when normal
created: '2026-10-21'
project: Errands     # optional
---

Oat, not dairy.
```

Unfinished todos (incomplete, in progress, blocked) from past days move to today when Tarea starts or the date changes. Deleting a todo moves its file to the Trash. Fields Tarea doesn't know about are kept when it saves.

## Reporting problems

Open an issue or message Sam with what you did, what you expected, and what happened. If a todo file looks wrong, include it (it's plain text). Tarea's own setting (the chosen folder) is in `~/Library/Application Support/xyz.samuelbeard.tarea/settings.json`.

## Development

```bash
bun install
bun run tauri dev
```

Tests and checks: `bun run build`, then `cargo test` and `cargo clippy --all-targets -- -D warnings` in `src-tauri`.

### Releasing

Bump `version` in `package.json` and `src-tauri/Cargo.toml`, commit, then push a tag such as `v0.1.1`. The Release workflow builds a universal app, signs the update with the `TAURI_SIGNING_PRIVATE_KEY` secret, and drafts a GitHub release with `latest.json`. Publishing the draft makes it the update testers receive.

Local release build: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tarea.key)" bun run tauri build`.
