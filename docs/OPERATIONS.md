# STEMORA operations — 3 November 2026

Email and offsite backups are deferred by the owner. This release enables local VPS backups, operator-only monitoring and a daily source-audio allowance. It does not configure mail, external storage or an outbound notification service.

## Local backups

`stemora-backup.timer` runs daily at 03:15 Asia/Bangkok, with up to five minutes of random delay. `scripts/operations.py backup` snapshots the portable database, private objects and legacy manifests, and creates a native PostgreSQL dump. It validates checksums, referenced objects, SQLite integrity/foreign keys, a portable restore into a separate directory, and a native dump restore into a temporary PostgreSQL database. The production database is never a restore target.

Snapshots live under `/var/www/stemora/ops-backups`, accessible only to root. Seven verified automatic snapshots are retained; existing manual/deployment backups are preserved. A failed attempt does not replace the last verified snapshot. The tool reserves space for container staging, a host copy, an isolated restore and at least 5.5 GB of free disk before starting.

These copies share the VPS failure domain. An independent recovery copy remains deferred until the owner chooses a destination.

## Monitoring

`stemora-monitor.timer` checks every two minutes. State changes go to the private system journal and `operations-state`; operator messages are included only in the machine-authenticated `/api/worker/queue` response and appear in Worker 1.5.1. Nothing diagnostic is added to customer pages.

Checks include HTTPS/API availability with normal TLS hostname validation, DB, private object storage, disk usage >=85% or <2 GB free, queued work with no online worker, waits >15 minutes, >=3 failures in 30 minutes, abandoned leases, and missing/failed/stale backups. Idle workers do not generate warnings without waiting work. A stale monitor state is itself visible to the operator. No emails are sent.

```sh
systemctl list-timers stemora-backup.timer stemora-monitor.timer
systemctl status stemora-backup.service stemora-monitor.service
journalctl -u stemora-backup.service -u stemora-monitor.service --since today
```

## Daily allowance

`DAILY_PROCESSING_MINUTES=60`, resetting at midnight Asia/Bangkok. It measures the source duration, not inference time, and is separate from 200 MB cloud storage. Server and Worker processing share the allowance. On-device processing and local downloads do not consume it.

Admission and reservation happen in the same transaction as queue creation. Replayed upload requests do not reserve twice. Cancelling unstarted work or infrastructure failure refunds minutes. Cancelling a job after it has started consumes its source duration. Deleting completed outputs never restores spent minutes. Previously queued work remains runnable and is not charged retroactively. Account & storage displays the remaining allowance.

The schema change is additive (`processing_usage`) and included in portable/native backups. A previous app image may ignore this table during rollback; do not drop it.
