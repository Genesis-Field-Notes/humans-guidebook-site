# A Human's Guide to the Universe

Authoritative recovery of the deployed static site at `https://www.humansguidebook.com/`.

## Recovery

The source and media in this repository were recovered from the live deployment on
September 17, 2026 after the previous local Git repository was found not to have
been pushed to GitHub.

Recovered application assets:

- `index.html` — single-page reader shell
- `book-data.js` — 56 sections, including the introduction, 43 numbered chapters,
  10 Earth Cuisine entries, Pointing, and the appendix
- `app.js` — navigation, search, bookmarks, narration, settings, and visual models
- `styles.css` — complete site presentation
- `favicon.svg`
- `audio/` — one narration MP3 for every section

The Cloudflare browser-check script injected into the served HTML was deliberately
excluded because it is deployment infrastructure, not application source.

## Verification

```sh
node --check app.js
node --check book-data.js
python3 -m http.server 4173
```

Open `http://localhost:4173/` and test chapter navigation, search, bookmarks,
reading settings, animations, and narration before deployment.
