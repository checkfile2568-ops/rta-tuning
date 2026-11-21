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
