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
