# A Human's Guide to the Universe

Authoritative recovery of the deployed static site at `https://www.humansguidebook.com/`.

## Recovery

The source and media in this repository were recovered from the live deployment on
September 17, 2026 after the previous local Git repository was found not to have
been pushed to GitHub.

Recovered application assets:

- `index.html` — single-page reader shell
- `book-data.js` — 56 recovered sections, including the introduction, 43 numbered chapters,
  10 Earth Cuisine entries, Pointing, and the appendix
- `behavior-data.js` — 8 Human Survival Behavior field entries
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

## Exi narration

New narration uses the ElevenLabs voice **Exi** (`z78r5be3XfFdGOPQefrh`). The
generator sends only the selected entry's title and reading text, writes the MP3
to the filename already expected by the website, and enables that entry's player
only after a complete audio response is saved.

Keep the API key outside Git. Copy `.env.example` to an untracked `.env` if your
shell loads environment files, or export the values directly in the shell.

```sh
node scripts/generate-narration.mjs --list
node scripts/generate-narration.mjs behavior-catastrophizing --dry-run
node scripts/generate-narration.mjs behavior-catastrophizing
node scripts/generate-narration.mjs --all-behaviors
```

Existing audio is protected unless `--force` is supplied. The generator defaults
to ElevenLabs' multilingual v2 model and 44.1 kHz, 128 kbps MP3 output. It omits
voice-setting overrides so the saved Exi voice configuration remains authoritative.

API references: [Text to Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
and [Voices](https://elevenlabs.io/docs/api-reference/voices/search).
