# My Music Library (GitHub Pages)

Public web app: https://checkfile2568-ops.github.io/rta-tuning/music/

The player uses the official YouTube IFrame API. Controls: play/pause, skip, seek, volume, shuffle/repeat; URL-based song addition; category filtering; JSON export/import. Playback may be blocked by YouTube embed restrictions and browser background/autoplay policies.

## Firebase setup (not connected yet)

1. Firebase Console > Project Settings > Your apps > Register a **Web** app. Copy the web config object.
2. Authentication > Sign-in method > enable Email/Password.
3. Firestore Database > create database and paste **music/firestore.rules** into Rules, then publish. Do not use public read/write rules.
4. Authentication > Settings > Authorized domains > add **checkfile2568-ops.github.io** if absent.
5. Replace `window.MY_MUSIC_FIREBASE_CONFIG = null` in `music/firebase-config.js` with the public config object. Do not include admin/service-account credentials.
6. Sign in using the same account on each device. Import local JSON export after login if needed.

**Important**: The GitHub Pages URL is public. Personal playlists are private to authenticated users only after correct Firebase rules are deployed. Before then, items remain local to each browser. Never share passwords in source code.

## Release caveats

This is a deployed web prototype, not a verified cross-device Firebase setup. Check iOS Safari/Android Chrome and Firestore rules in actual use before relying on synchronization. Do not assume the links shown in a screenshot are complete or verified.

## Passkey / biometric login (UI added, backend not yet deployed)

- The login dialog now shows Passkey sign-in and registration controls styled to match the Glassy 3D theme.
- `passkey-config.js` ships with `enabled: false`. The buttons must remain disabled until a trusted WebAuthn relying-party backend is configured. NEVER claim that a local biometric prompt alone grants access.
- Backend contract expected by the frontend:
  - POST `/webauthn/register/options` with Firebase ID token -> `{requestId,options}`
  - POST `/webauthn/register/verify` with Firebase ID token and `{requestId,credential}` -> verify and store credential public key against authenticated UID
  - POST `/webauthn/login/options` with `{email}` -> `{requestId,options}`
  - POST `/webauthn/login/verify` with `{requestId,credential}` -> verify signature, challenge, origin, RP ID, UV, counter; return short-lived `firebaseCustomToken` for the matched UID
- Use an audited server-side WebAuthn library and enforce replay protection, rate limits, credential uniqueness, account binding, trusted origins, and session expiry. Configure CORS specifically for `https://checkfile2568-ops.github.io`.
- WebAuthn lets a device use biometric verification, face recognition, PIN, or other local methods; it does NOT prove that a particular fingerprint was scanned. Do not promise fingerprint-only authentication.
- GitHub Pages is static hosting; it cannot perform server-side WebAuthn verification on its own. A backend is required even if Firebase is not used.
- Existing `court-media-controller` Realtime Database is used by a separate game application. Reusing its Firebase project is technically possible, but only after verifying project ownership, authentication providers, Firestore enablement and security rules; do not copy permissive legacy Realtime Database rules.
- For this app, use Firebase Authentication + Firestore or a different secured API/data store. Keeping the URL in GitHub Pages does not require Firebase Hosting.

## YouTube-only / screen-awake update

- Continue using official YouTube embedded player only. No audio downloads, re-encoding, hidden audio extraction, or bypass of locked-screen/background playback restrictions.
- Screen Wake Lock is optional and only attempts to keep the screen on while this page is visible. It can be denied/released by the browser or OS. Reacquires on visibility return if the toggle was left enabled.
- Touch seeking, previous/next, shuffle avoidance of immediate repeats, repeat-on-end, and queued selection before player readiness have been updated.
- Local six-digit PIN remains a browser-only screen gate, not secure cross-device authentication. Cloud playlists and Passkey remain unconfigured.
- Test on real iOS Safari, Android Chrome, tablet orientation changes and desktop before treating behavior as verified.

## Playlist Manager (2026-11-21)

The GitHub Pages website now has a local Playlist Manager: create, select, rename and delete multiple playlists; add an existing library video to a selected playlist; paste a new YouTube URL directly into the selected playlist; edit a library song title/category; remove a song from only its playlist or delete from the entire local library. Playlist ordering follows addition order and the Next/Previous player buttons use the currently selected playlist.

The collapsed YouTube addition panel includes a keyword search button that opens YouTube search results in a new tab. This is **not** in-app YouTube search API integration: YouTube Data API credentials and quota handling are required for native search results inside the dashboard. Search terms cannot provide verified video IDs by themselves. Select a video in YouTube and paste its share link back into the app.

Playlists are stored in browser localStorage under `my-music-playlists-v1`. Song records continue using the prior `my-music-library-v2-web` key, so prior data is preserved. JSON export now includes `songs` plus `playlists`; importing prior songs-only arrays remains supported. The local PIN is browser-scoped. Cross-device playlist synchronization **is not yet active**, because no secured cloud backend is connected. Do not confuse GitHub source deployment with persistent cloud writes.

## Audit fixes (2026-11-22)

- Seek bar no longer freezes on desktop after seeking (UI pauses only while dragging, not while the slider keeps focus).
- "ลืมรหัส PIN?" on the unlock screen removes only the PIN record (`my-music-pin-v1`); songs, Playlists and other apps on this GitHub Pages origin are kept. The PIN remains a local screen gate, not security.
- Firebase SDK is loaded on demand only when `firebase-config.js` contains a real config, so the page no longer downloads ~150 KB of unused scripts before showing the PIN screen.
- Add-song checks duplicates first (no false "added" message); add/delete/new-category use the in-app dialogs instead of `alert/confirm/prompt`.
- Next/Previous/Repeat follow the selected Playlist and category, ignoring the text search box; Repeat always replays the current song.
- YouTube error 101/150 explains all common causes (embed off, region/age limits, sign-in check), not only "owner disabled embedding".
- Failed in-page API search shows a tappable YouTube link instead of a popup that browsers block.
- Links without `https://` are accepted; user categories are remembered (`music-custom-categories-v1`); the ＋ button lists only Playlists that do not contain the song yet; app icons added for home-screen install.
- Not changed: Cloud mode still syncs songs only — Playlists stay in this browser until a cloud Playlist store is added.

## Themes (2026-11-22)

🎨 button in the header opens a theme picker (saved per browser in `music-theme-v1`) with 4 themes: **สว่าง ฟ้า-ขาว (default)**, กรมท่า-ทอง, ฟ้าครามกระจก, ดำล้วน (OLED, no blur). A browser with no saved theme — or with an old/removed theme value — opens in the white/blue default, including the PIN screen. Themes only override colours via `--t-*` variables on `html[data-theme=…]`. To add a theme: one variable block in the CSS theme layer + its id in the head script list + one entry in `THEMES`.

## Search placement and car key reuse (2026-11-22)

- Main library: YouTube search stays visible above the player. Selecting a search result opens the existing add-song form; library filtering stays separate.
- Car page: search appears directly above the video results, with a clear key-setup status.
- Both pages reuse `music-youtube-search-api-v1` on the same origin and browser. Existing car keys migrate on first use. Empty shared values deliberately disable the key rather than restoring an older car key. Different devices and browser profiles require separate setup.
- No live YouTube API credential is included. Create a key in the owner's Google Cloud project, enable YouTube Data API v3, restrict the key to that API and the website referrer `https://checkfile2568-ops.github.io/*`, then enter it using the page's settings. A global cross-device credential requires a separately configured backend; local browser storage does not provide cross-device synchronization.
- Validation: inline JavaScript syntax and DOM simulation passed for search placement, mocked API parameters/results, result selection, shared-key save/read/clear, legacy migration, no-key fallback and unique element IDs. Live Google search and rendered car/mobile layouts were not tested. Headless Chromium could not start in this execution environment.
- Rollback: restore only `music/index.html`, `music/car.html` and this README from commit `be153715bc6301620793f5e155edc1d938a3cce2`; leave stored music and playlists intact.

### Validated, locked key settings

New keys are checked against the YouTube Data API videos endpoint before saving. After a successful persistent write, both pages clear and disable the key field and hide the save button. Use **เปลี่ยนคีย์** to deliberately edit: the library asks for confirmation; the car page requires a second tap within six seconds. The existing key remains active until a new key passes validation and storage succeeds. Blank or invalid keys cannot erase it. This prevents accidental UI edits; it is not a server-enforced security boundary or a guarantee against browser storage deletion.

DOM simulation covers valid saves, intentional unlock/cancel, invalid and empty keys preserving the original, storage denial, migration/reload, shared settings and mocked search results. No live credential was recovered or created in this release. Earlier records indicate `YOUTUBE_API_KEY` in the old Elderly AI Hub Apps Script properties, with a historical reference to Google Cloud project **My First Project**; its current value and validity remain unverified. Google Cloud Console could not be opened from the available browser.

This release also restores the complete YouTube player initialization from the local verified source after detecting a truncation marker in the previous GitHub upload. Release verification must compare the GitHub blobs byte-for-byte with the local source and re-run JavaScript syntax checks against those fetched blobs.

## Shared search, 2026-11-23

Both the library and car page use `search-config.js` to reach the shared YouTube search service. Browsers no longer need a locally configured API key; the API key is a runtime secret in the search service and is not present in this GitHub repository. The manual key controls are hidden while the shared endpoint is configured. Existing saved local keys and music are retained for rollback.

The car and Kid/Music screens remain available without a PIN. The library's existing local PIN code and stored record are unchanged. This is the user's existing device-local screen gate, not shared account authentication. Playback still uses the official YouTube player. Search quota is shared by all devices; cached identical queries can be reused for 15 minutes.

Service URL: https://pop-music-search-gateway.chaninposri.chatgpt.site
Health endpoint: `/api/health`; search endpoint: `/api/search?q=...` (CORS for this GitHub Pages origin only). Service project: `appgprj_6b0320e5084081919264eb69e2364c07`.

Rollback: restore only `music/index.html`, `music/car.html` and this README from `3dc3e8c9eb713797b49752afe483dde092a06eb1`, then remove `music/search-config.js`. No data migration or clearing is needed. Keep the previous saved local keys; they will again be used by the old source.

## Private code profiles and global device limit (2026-11-23)

The mobile library now uses server-verified six-digit code profiles. New codes start with no saved songs or Playlists. The same code opens only that profile across registered browsers. Codes are unique: an existing code must be used through login, not new-code registration. The mobile page requires an online connection for authentication and library synchronization. The car page continues to open without a PIN and uses the same server-side YouTube key.

The central registry accepts at most **10 registered browser identities in total**, including car and mobile. Another browser or browser profile counts separately. Clearing browser storage does not automatically release the old entry. Use **ยกเลิกเครื่องนี้** on the old browser before retiring it; the account's stored music remains. This is a registered-browser cap, not a hardware identifier.

To keep old saved songs: on the browser that has them, choose login and enter its **old PIN**. Only a verified old PIN can migrate the unscoped local songs and Playlists to an empty central profile. The migration retains an encrypted local backup before removing old shared keys. A newly created different code starts empty and cannot import the old owner's collection. A local old PIN cannot be recovered or reset to claim another person's central library.

Logout clears private song rows, Playlist options, dialogs, forms and the player. Returning through browser history also locks the page. Writes are scoped by the server session and use revision checks; if another device changes the same profile, choose **โหลดคลังล่าสุด** before editing further. Unsaved changes are reported and page-close warnings prevent silent loss where supported.

Account interface files: `device-client.js`, `accounts-client.js`. Backend schema and tests live in the existing search service source repository. No PIN or API key is embedded in this repository. Search uses the one existing runtime key for all devices.

## Brave-only welcome entry v2 (2026-11-23)

The welcome screen is shown in every browser with, in order: **เข้าระบบ**, a browser status line, **ติดตั้ง Brave** (Google Play / App Store / brave.com/download depending on the device; hidden when already in Brave, where the PWA "ติดตั้งแอป" button shows instead) and, as the last line, **ยังไม่มีรหัส? สร้างรหัสผ่าน**. Brave is now required on computers too. In another browser, เข้าระบบ / สร้างรหัสผ่าน open the Brave sheet (open-with-Brave on Android/iOS, copy link, install, legacy-song migration, release device) with a ← กลับ button instead of the PIN screen. In Brave, เข้าระบบ opens the PIN screen in login mode and สร้างรหัสผ่าน in create-code mode (`window.musicPinMode`). Install links live in `BRAVE_LINKS` in `brave-gate.js`. Detection is client-side (UA, UA-CH brands, `navigator.brave.isBrave()`), so it is a usage policy, not a security boundary.
