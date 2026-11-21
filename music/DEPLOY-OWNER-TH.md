# My Music Library — Secure owner deployment (2026-11-21)

Live static site: https://checkfile2568-ops.github.io/rta-tuning/music/

## Current state

The website code, responsive 3D UI, owner-only login gate, and Cloud Functions Passkey backend source are committed to GitHub. **Passkey backend and Firebase authentication are NOT deployed or connected yet.** The two starter songs are visible only in unconfigured local-demo mode. Avoid interpreting a rendered biometric button as proof of a working authenticator.

## Reusing court-media-controller

The existing `court-media-controller` Realtime Database is used by the court-media game. You may reuse the Firebase project, but create a **separate Firestore namespace** for music. Check project access, permissions, Authentication, Firestore availability, billing status and any existing rules first. DO NOT replace or open existing Realtime Database Rules. DO NOT overwrite an existing Firestore rules file without first merging the specific music match blocks.

## Bootstrap

1. Open Firebase Console and select the verified project. Enable **Authentication > Email/Password**. Create the **single owner account** using console controls; record its UID (not the password). Enable Firestore if not already present. Cloud Functions v2 deployment normally requires the Blaze billing plan; review charges/quotas before enabling billing.
2. In Project Settings > Your apps, register a Web app and copy only its public `apiKey`, `authDomain`, `projectId`, `appId` etc. into `music/firebase-config.js`, replacing `null`. Never commit a service-account key or password.
3. In Firestore **merge** `music/firestore.rules` song-match logic into the project's existing rules, replacing `REPLACE_WITH_OWNER_UID` with the verified owner UID. The file in the repo is a standalone template, NOT a safe blanket replacement for a shared project. Publish and test that all other applications still work.
4. Locally install Node.js 20 and Firebase CLI (`npm install -g firebase-tools`). Sign in with the project owner (`firebase login`). Under the `music/` folder run `cd functions && npm install && cd ..`. **Do not commit node_modules**.
5. In the `music/functions/` folder, create a local `.env.<PROJECT_ID>` containing `OWNER_UID=<uid>` and `WEB_ORIGIN=https://checkfile2568-ops.github.io`. Keep it out of Git. It is important that `OWNER_UID` matches the Firestore rules.
6. Verify other existing Firebase Cloud Functions and deploy only the new named function from `music/`: `firebase deploy --only functions:musicPasskeyApi --project <PROJECT_ID>`. If project config or CLI refuses this targeted deployment, STOP and inspect deployment plan instead of using `--only functions` broadly.
7. Update `music/passkey-config.js` to `{enabled:true,apiBaseUrl:'https://asia-southeast1-<PROJECT_ID>.cloudfunctions.net/musicPasskeyApi'}`. Actual endpoint may differ by project; confirm its deployed URL and CORS.
8. Go to the website, sign in once with your Firebase owner email/password, then open **◎ จัดการ Passkey** and enroll a passkey. Sign out; use Passkey to access your personal playlist.
9. Test on Android Chrome, iPhone Safari, iPad and desktop. Passkeys might use fingerprint, face unlock, device PIN or cross-device authentication depending on OS. A website cannot mandate a specific person's fingerprint, but can restrict the playlist to an owner UID.
10. To migrate existing local music after Cloud sign-in, import the previously exported JSON backup. Local/demo data is not uploaded automatically. Keep backups until cross-device synchronization is verified.

## Security

- Authentication requires trusted server-side WebAuthn signature verification. Public GitHub Pages alone cannot do this.
- The API accepts registrations only after a valid Firebase ID token for the configured owner UID, and issues a Firebase custom token only after a verified existing passkey.
- Challenges expire after five minutes and are consumed once. Add Firestore TTL retention and audit monitoring for expired challenge documents.
- Cloud playlist is not rendered while signed out. A public link reveals the public interface, not the authenticated playlist.
- If multiple devices change the playlist simultaneously, this prototype's full-list synchronization can produce conflicts. Back up JSON and do not rely on it for concurrent multi-user editing.
- No audio extraction, decoding, re-encoding or download occurs; YouTube determines playback quality and background restrictions.

## Pending verification

Deployment of backend, Firebase project configuration, real passkey enrollment and cross-device tests require access to the selected Firebase project. These have **not** been completed yet.
