# Shelfmark Agent Notes

This file is for future coding agents working in this repository. It summarizes the current implementation, important architectural choices, known limitations, and the expected workflow for making changes safely.

## Product Summary

Shelfmark is a Chrome extension for:

- bookmarking the current page or a pasted URL
- auto-enriching links with metadata and tags
- organizing bookmarks into projects
- attaching notes, screenshots, and uploaded images to projects
- exporting projects to HTML and print-to-PDF
- annotating exported HTML with highlights and comments
- backing up and restoring raw extension data

Supported content types currently include:

- YouTube videos
- X posts and X articles
- blogs and generic webpages
- PDFs and papers

## Current Branch / Repo State

Recent commits:

- `5b75270` Move large captured content to IndexedDB
- `e48e728` Add backup import and improve YouTube export
- `a3fa359` Initial Shelfmark extension

GitHub repo:

- `https://github.com/prdeepakbabu/shelfmark`

Default workflow for future features:

- create a separate branch with prefix `codex/`
- implement and test there
- push branch
- open PR into `main`

## Key Files

Core extension:

- `manifest.json`
- `background.js`
- `shared.js`
- `content-script.js`
- `popup.html`
- `popup.js`
- `popup.css`
- `dashboard.html`
- `dashboard.js`
- `dashboard.css`

Storage:

- `content-store.js`

Tests:

- `tests/run-tests.mjs`

Docs:

- `README.md`
- `CITATION.cff`
- `docs/`

## Storage Architecture

There are now two storage layers.

### 1. `chrome.storage.local`

Used for lightweight metadata only:

- bookmark records
- project records
- notes
- tags
- project image metadata / image data URLs
- references to large source content

Storage keys are defined in `shared.js`:

- `shelfmarkBookmarks`
- `shelfmarkProjects`

### 2. IndexedDB

Used for heavy captured source content via `content-store.js`.

This stores the large text payloads that used to live inline on bookmarks:

- full source title
- full source description
- captured article/page text

Bookmarks now point to content records via:

- `bookmark.contentRef`

This was introduced to reduce pressure on `chrome.storage.local`.

### Migration Behavior

Old bookmarks may still have legacy inline fields from earlier versions:

- `capturedContent`
- `fullTitle`
- `fullDescription`

On extension initialization, `background.js` runs migration logic that:

- creates IndexedDB content records from legacy inline fields
- assigns `contentRef` to bookmarks
- removes the legacy heavy inline fields from bookmark records

Reloading the extension is expected to trigger and complete this migration.

## Permissions

Important manifest permissions:

- `activeTab`
- `storage`
- `tabs`
- `scripting`
- `unlimitedStorage`

`unlimitedStorage` was added because the extension now relies on IndexedDB for larger local-first content storage.

## Bookmark Model

Bookmark cards in the dashboard intentionally keep short fields for UI readability:

- `title`
- `summary`

Full export-quality source data is stored indirectly in IndexedDB via `contentRef`.

Important bookmark fields:

- `id`
- `url`
- `normalizedUrl`
- `title`
- `summary`
- `notes`
- `tags`
- `contentType`
- `runtimeMinutes`
- `pageCount`
- `thumbnailUrl`
- `contentRef`

Do not reintroduce large full-text payloads directly into bookmark objects unless there is a deliberate architecture change.

## Project Model

Projects are stored in `chrome.storage.local` and include:

- `id`
- `name`
- `description`
- `learnings`
- `bookmarkIds`
- `images`

Project images are still stored locally and can be large. This is a current known pressure point.

## Export Behavior

Project export is implemented in `background.js`.

Current behavior:

- project HTML is generated on demand
- project notes are rendered first
- each linked bookmark becomes a source section
- if a source has thumbnail metadata, export renders a media-style header card
- video sources currently export title, full description, thumbnail, and runtime
- X content prefers live page-captured text if available
- exported HTML supports inline highlight/comment annotations
- exported HTML supports print-to-PDF

### Important export rules

- export should prefer full source content from IndexedDB, not just short dashboard summaries
- YouTube exports should not fall back to generic YouTube boilerplate
- X exports should not dump the “JavaScript disabled” fallback page
- if X blocks background fetching, export should prefer cached live-page text captured at save time

## Current Known Limits

### X / X Articles

Current state:

- full X capture is best when the user bookmarks while actively viewing the page
- later background fetches can be blocked by X and return fallback pages
- full image capture for X articles is not implemented
- text-only is the current strategy

If future work touches X export:

- preserve the current blocked-page detection
- prefer captured text from live DOM extraction over background HTML fetch

### YouTube

Current state:

- title, runtime, description, and thumbnail are captured when possible
- export uses a media card instead of generic scraped page footer text
- description should remain full in export even if dashboard summary is shortened

### Images

Project images and screenshots are still stored locally and can grow large. If future work needs many images, reconsider how image blobs are stored.

## Backup / Restore

Dashboard backup UI exists in the sidebar.

Messages handled in `background.js`:

- `EXPORT_DATA`
- `IMPORT_DATA`

Backup format currently includes:

- bookmarks
- projects
- content records from IndexedDB

Import behavior is merge-oriented, not destructive replacement.

If future work changes schema:

- keep import backward-compatible if possible
- update migration logic and tests together

## Content Extraction Notes

### Popup save flow

When saving the current page:

- popup asks content script for metadata
- content script extracts metadata from the actual rendered page
- background worker enriches and stores the bookmark

This is especially important for:

- X pages
- pages with meaningful DOM text not recoverable from a simple later fetch

### Manual URL save flow

When saving a pasted URL:

- no live page DOM is available
- metadata comes from background fetches
- this is less reliable for X than saving while actually viewing the page

## Tests

Run before finishing meaningful changes:

```bash
npm test
npm run check
```

Tests are in `tests/run-tests.mjs`.

Current coverage includes:

- URL normalization
- classification
- bookmark save flow
- project creation and assignment
- screenshot plumbing
- HTML export
- PDF metadata flow
- X blocked export fallback behavior
- YouTube metadata/export behavior
- raw backup export/import behavior

If you change:

- storage model
- export logic
- YouTube/X handling
- migration behavior

then update tests in the same change.

## Documentation

`README.md` is now product-oriented and includes screenshots.

Documentation assets:

- `docs/screenshots/popup.png`
- `docs/screenshots/bookmarks.png`
- `docs/screenshots/projects.png`

Static demo pages used to generate screenshots:

- `docs/popup-demo.html`
- `docs/bookmarks-demo.html`
- `docs/projects-demo.html`

If UI changes materially, screenshots and README should be updated.

## Publishing / Update Safety

Important user expectation:

- reloading the same installed extension should not wipe bookmarks/projects
- removing the extension can clear local extension data
- changing extension identity would break continuity

When making updates:

- preserve storage keys unless you add migration support
- preserve bookmark/project compatibility
- prefer additive schema changes

## Development Guidelines For Future Agents

- Keep heavy source content out of `chrome.storage.local`
- Prefer storing references and stitching content together at export time
- Treat X and YouTube as special-case sources; generic HTML scraping is not enough
- Preserve export quality even if UI cards remain intentionally compact
- If a feature risks data continuity, add backup or migration support in the same branch
- If multiple features touch the same file or subsystem, use separate `codex/*` branches and do an explicit integration pass before merge

## Safe Next Steps

Reasonable future improvements:

- explicit migration version marker
- live browser UI verification for migration flow
- better import conflict reporting
- more structured X article capture while viewing the page
- move heavy project images to a more scalable local storage strategy if needed
