# Media Library upload fix — 2026-08-15

- Replaced hand-written TUS upload flow with tus-js-client 4.3.1.
- Added retry, resume, pause, cancel, percent progress, bytes sent, transfer speed and ETA.
- Added persistent upload progress state via mms-upload-api.
- Added clear distinction between browser upload and background worker processing.
- Root cause observed before fix: Supabase Storage `/upload/resumable` returned HTTP 400 during TUS creation; no object was created while the database row remained `uploading`.
