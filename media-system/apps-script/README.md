# MMs Android / YTDLnis bridge

This is a separate Google Apps Script Web App for recording an Android handoff. It does **not** change the existing legacy media deployment.

## What it records

Each accepted request creates a row in MediaJobs with handoff_opened. The Android app downloads locally, so this value means only that the handoff page was opened; it must not be displayed as a completed download.

## Setup

1. Create a new standalone Apps Script project and add YTDLnisBridge.gs.
2. Create or choose the spreadsheet used for the audit log.
3. In Project Settings → Script properties, add:
   - MEDIA_JOBS_SPREADSHEET_ID: the spreadsheet ID.
   - YTDLNIS_ALLOWED_EMAILS: comma-separated Google account email addresses allowed to submit requests.
4. Deploy as a Web App. Use Execute as: User accessing the web app, so the allow-list receives the requester’s identity. Restrict access to the intended accounts or domain.
5. Copy the deployed /exec URL into CONFIG.bridgeUrl in /ytdlnis.html, then publish GitHub Pages.

The bridge opens top-level rather than inside the MMs iframe. This keeps Google authorization and the Android Intent reliable, and avoids cross-origin browser hangs.

## Security boundary

Do not put a shared secret in GitHub Pages. The bridge validates only YouTube URLs and an allow-listed return origin, and it requires the signed-in Google account to be in YTDLNIS_ALLOWED_EMAILS.
