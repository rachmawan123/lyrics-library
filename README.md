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
- Shared library published through GitHub Pages

## Shared Library (no backend required)

Lyrics Library can use a repository file named **`library.json`** as its shared published collection. This works with GitHub Pages and does not require a server, cloud database, or account system inside the app.

### Publish your library

1. Open Lyrics Library on the device that currently has your complete collection.
2. Open **Backup & Restore**.
3. Select **Export for GitHub**. The app downloads a file named `library.json`.
4. Open this repository on GitHub.
5. Upload or replace `library.json` in the repository root (the same folder as `index.html`).
6. Commit the change and wait for GitHub Pages to deploy.

### Load it on another device

1. Open [Lyrics Library](https://rachmawan123.github.io/lyrics-library/) on the other device.
2. Open **Backup & Restore**.
3. Select **Load from GitHub** and confirm.
4. The published songs are merged into that device's local library. Matching song IDs are updated; songs that exist only on that device are kept.

On a brand-new browser profile, the app will automatically load `library.json` when its local library is empty. If the file is not present yet, the app starts with its sample entries; use **Load from GitHub** after publishing the file.

## Important: synchronization model

This is **manual one-way publishing**, not automatic two-way cloud sync:

- Each browser keeps its own editable IndexedDB library.
- GitHub Pages serves the published `library.json) to all devices.
- Changes made on a device are local until you export `library.json` and upload the new version to GitHub.
- Other devices can then select **Load from GitHub** to receive the published updates.
- GitHub Pages is static hosting, so the app cannot write changes back to the repository automatically without a separate authenticated backend or GitHub integration.

For privacy, remember that this repository is public: anyone who can access the repository can download a published `library.json`. Do not publish lyrics or other content you do not have permission to share.

## Local backup and restore

- **Export Backup** downloads `lyrics_library.json` for safekeeping or transfer.
- **Choose Backup** restores the JSON into the current browser only.
- Restore merges by song ID; it does not automatically update other devices.
- Artwork is included in the JSON backup.

## Project files

- `index.html` — app structure
- `style.css` — responsive dark interface
- `script.js` — application logic and IndexedDB
- `library.json` — optional shared published song collection

## License / content

This is a personal archive tool. You are responsible for ensuring that any lyrics or artwork you publish or share are permitted by their respective rights holders.
