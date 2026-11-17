# Lyrics Library

A personal, offline-first lyrics archive for Japanese, Chinese, Korean, English, and Indonesian songs.

**[Open Lyrics Library](https://rachmawan123.github.io/lyrics-library/)**

## Features

- Song library with fuzzy search
- Favorites and pinned songs
- Recently viewed history
- Song artwork / cover images
- Comfortable lyrics reader
- List, compact, and card layouts
- Local IndexedDB storage
- JSON backup and restore
- Shared default library published through GitHub Pages

## Shared default library (no backend required)

The repository's **`lyrics_library.json`** file is the master collection used by GitHub Pages. It uses the same JSON format as the app's normal backup, so you only need to maintain one file.

### Set up or update the master library

1. Open Lyrics Library on the device that contains the collection you want to publish.
2. Open **Backup & Restore**.
3. Select **Export for GitHub**. It downloads `lyrics_library.json`.
4. In this GitHub repository, upload the downloaded file to the repository root (the same folder as `index.html`), replacing the existing `lyrics_library.json`.
5. Commit the change and wait for GitHub Pages to deploy.

Whenever you add songs in the future, repeat these steps to update the same master file. Keep a separate copy of your JSON backup somewhere safe.

### Load the master library on another device

1. Open [Lyrics Library](https://rachmawan123.github.io/lyrics-library/).
2. On a new browser profile with an empty local database, the app automatically loads `lyrics_library.json`.
3. On a device that already has songs, open **Backup & Restore** and select **Load from GitHub**. Confirm to merge the published collection into its local library.

Matching song IDs are updated. Songs that exist only on the device are kept when using **Load from GitHub**. The app does not automatically overwrite an existing local collection.

## Important: synchronization model

This is **manual one-way publishing**, not automatic two-way cloud sync:

- Each browser stores its editable library in its own IndexedDB.
- GitHub Pages serves the published `lyrics_library.json` as the default collection.
- Changes made on a device remain local until you export and upload the updated JSON file.
- Other devices can load the newly published collection using **Load from GitHub**.
- GitHub Pages is static hosting. It cannot write changes back to this repository automatically without a separate authenticated backend or GitHub integration.

This repository is public. Anyone can download its published `lyrics_library.json`. Do not publish private lyrics, artwork, or other content you do not have permission to share.

## Local backup and restore

- **Export Backup** downloads `lyrics_library.json` as a portable backup.
- **Choose Backup** restores a JSON backup into the current browser only.
- Restore merges by song ID; it does not update other devices.
- Song artwork is included in the JSON.

## Project files

- `index.html` — app structure
- `style.css` — responsive dark interface
- `script.js` — application logic and IndexedDB
- `lyrics_library.json` — shared default song collection and portable backup format

## License / content

This is a personal archive tool. You are responsible for ensuring that any lyrics or artwork you publish or share are permitted by their respective rights holders.
