# FFmpeg Worker / Large-file Split Fix — 2026-08-16

Status: SOURCE FIX APPLIED / ANDROID RETEST REQUIRED

## Symptom
Android/Chromium UI failed before any Part upload with:
`Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js' cannot be accessed from origin 'https://checkfile2568-ops.github.io'.`

## Root cause
`mms-splitter.js` dynamically imported `@ffmpeg/ffmpeg` from jsDelivr and called `ffmpeg.load()` without `classWorkerURL`. In @ffmpeg/ffmpeg v0.12.10 the default class worker is resolved relative to the imported package URL, so Chromium attempted to construct a Worker directly from the CDN origin. Worker construction was blocked before local splitting began.

## Fix
- Added a same-origin FFmpeg class worker under `vendor/ffmpeg-0.12.10/`.
- Added local `worker.js`, `const.js`, and `errors.js` derived from upstream v0.12.10 runtime source.
- `mms-splitter.js` now passes `classWorkerURL` resolved from `import.meta.url`, therefore the class worker is served from the GitHub Pages origin.
- Core JS and WASM remain fetched through `toBlobURL`, preserving the existing single-thread core flow.
- A rejected FFmpeg initialization now clears `ffmpegPromise`, allowing a retry without requiring a permanently poisoned promise state.
- Added explicit FFmpeg exit-code validation and clearer Thai initialization error text.

## Large-file pipeline (canonical)
1. Create media set and reserve workspace.
2. Initialize FFmpeg and split locally into valid video Parts (~40 MB, max 45 MB).
3. Register/upload strictly sequentially: Part 1 ready -> Part 2 -> ...
4. Complete each Part in Storage and DB.
5. When all Parts are ready, media set advances to analysis.

## Important residual risk
A 100+ MB source still has to be read into browser/WASM memory during local splitting. Low-memory Android devices can still fail later with memory/wasm errors even after the Worker-origin issue is fixed. If that occurs, the next architectural fix is to move large-file splitting out of the mobile browser (backend/desktop worker), while preserving the same Part manifest and sequential upload contract.

## Files changed
- `mms-splitter.js`
- `vendor/ffmpeg-0.12.10/worker.js`
- `vendor/ffmpeg-0.12.10/const.js`
- `vendor/ffmpeg-0.12.10/errors.js`
