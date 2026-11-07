# STEMORA — decisions and next work

## Deferred by the owner — 3 November 2026

- Email delivery, account recovery by email, email verification and email alerts: **deferred**. Do not configure a sender or turn these on until the owner revisits the decision. An unfinished local draft is parked in the ignored `dist/deferred-email-20261103` directory; it is not deployed.
- Backups outside the VPS: **deferred**. Destination has not been chosen. Do not copy backups to a different VPS, Mac, S3 or NAS by assumption. Current automated backups remain on the STEMORA VPS, so a loss of that VPS remains a recovery limitation.

## Current operations work

- Daily local backups at 03:15 Asia/Bangkok with checksum, database/reference checks and isolated portable-restore verification; retain the seven most recent verified automatic snapshots, preserving older manual/deployment backups.
- Operator-only health checks every two minutes; warnings appear in STEMORA Worker. Email alerts remain off.
- Free server/Worker allowance: 60 source-audio minutes per account per Thai calendar day, separate from 200 MB cloud storage. Queued work reserves minutes; cancelling unstarted work or infrastructure failure refunds them. Client-side processing does not consume this allowance.

## Still to validate before broader rollout

- Listening comparison across multiple genres using the exact same original mix, matching playback loudness. No claim of best model or guaranteed full-song processing times.
- Peak-load tests across multiple real worker computers and a Windows worker installer if needed.
- Offsite backup destination and email sender/recipient when the owner is ready.
