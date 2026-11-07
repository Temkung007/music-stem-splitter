"""Private workspace persistence: PostgreSQL in Docker, SQLite for native use."""

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

DATA = Path(os.environ.get("STEMORA_DATA_DIR", Path(__file__).resolve().parent))
DATA.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA / "workspace.sqlite3"
DRIVER = os.environ.get("DATABASE_DRIVER", "sqlite")
if DRIVER not in {"sqlite", "postgresql"}:
    raise RuntimeError("DATABASE_DRIVER must be sqlite or postgresql")
INTEGRITY_ERRORS = (sqlite3.IntegrityError, psycopg.IntegrityError)
TABLES = (
    "users",
    "sessions",
    "attempts",
    "tracks",
    "assets",
    "playlists",
    "playlist_versions",
    "workers",
    "stem_jobs",
    "processing_usage",
    "sync_tokens",
)
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL,
  title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]', object_key TEXT NOT NULL, sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL, duration DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued', message TEXT NOT NULL DEFAULT '',
  bpm DOUBLE PRECISION, musical_key TEXT, key_confidence DOUBLE PRECISION, bpm_confidence DOUBLE PRECISION,
  energy INTEGER, peaks TEXT NOT NULL DEFAULT '[]', analysis TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE(user_id, sha256)
);
CREATE INDEX IF NOT EXISTS tracks_user ON tracks(user_id, deleted_at);
CREATE TABLE IF NOT EXISTS assets (
  object_key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL, size_bytes BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '',
  target_minutes INTEGER NOT NULL DEFAULT 60, profile TEXT NOT NULL DEFAULT 'build',
  items TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS playlist_versions (
  playlist_id TEXT NOT NULL REFERENCES playlists(id), revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(playlist_id, revision)
);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, last_seen DOUBLE PRECISION NOT NULL DEFAULT 0,
  device TEXT NOT NULL DEFAULT '', accepting INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stem_jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  spec TEXT NOT NULL, source_key TEXT NOT NULL, source_bytes BIGINT NOT NULL,
  source_sha256 TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 5,
  message TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}', worker_id TEXT,
  lease_hash TEXT, lease_until DOUBLE PRECISION NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  updated_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS processing_usage (
  job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL,
  seconds DOUBLE PRECISION NOT NULL, charged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS processing_usage_day ON processing_usage(user_id, day);
CREATE INDEX IF NOT EXISTS stem_jobs_queue ON stem_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS stem_jobs_owner ON stem_jobs(owner_id, created_at);
CREATE TABLE IF NOT EXISTS sync_tokens (
  token TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'rekordbox-sync',
  created_at TEXT NOT NULL,
  last_used_at DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS sync_tokens_user ON sync_tokens(user_id);
"""


class Record(dict):
    """Keep mapping access and positional access identical across DB drivers."""

    def __getitem__(self, key):
        return (
            tuple(self.values())[key]
            if isinstance(key, int)
            else super().__getitem__(key)
        )


class Cursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def fetchone(self):
        row = self.cursor.fetchone()
        return Record(row) if row is not None else None

    def fetchall(self):
        return [Record(row) for row in self.cursor.fetchall()]

    def __iter__(self):
        return (Record(row) for row in self.cursor)


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    @staticmethod
    def statement(sql):
        # Application-owned SQL uses qmark placeholders; user input is always bound.
        # There are no question-mark literals in these fixed SQL templates.
        return sql.replace("%", "%%").replace("?", "%s")

    def execute(self, sql, parameters=()):
        return Cursor(self.connection.execute(self.statement(sql), parameters))

    def executemany(self, sql, parameters):
        cursor = self.connection.cursor()
        cursor.executemany(self.statement(sql), parameters)
        return Cursor(cursor)


@contextmanager
def connect():
    if DRIVER == "postgresql":
        with psycopg.connect(row_factory=dict_row, connect_timeout=10) as connection:
            yield PostgresConnection(connection)
    else:
        connection = sqlite3.connect(DB_PATH, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def lock_writes(db):
    """Serialize short quota, rate-limit and revision decisions in a transaction."""
    if DRIVER == "postgresql":
        db.execute("SELECT pg_advisory_xact_lock(736836742815)")
    else:
        db.execute("BEGIN IMMEDIATE")


def initialize():
    with connect() as db:
        if DRIVER == "sqlite":
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
        else:
            for statement in SCHEMA.split(";"):
                if statement.strip():
                    db.execute(statement)


def table_digest(rows):
    records = sorted(
        json.dumps(dict(row), ensure_ascii=False, sort_keys=True) for row in rows
    )
    return hashlib.sha256("\n".join(records).encode()).hexdigest()


def sqlite_snapshot(destination):
    """Portable consistent snapshot, also usable by the existing restore tool."""
    if DRIVER == "sqlite":
        with sqlite3.connect(DB_PATH) as source, sqlite3.connect(destination) as target:
            source.backup(target)
        return
    with connect() as source, sqlite3.connect(destination) as target:
        source.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        target.executescript(SCHEMA)
        for table in TABLES:
            rows = source.execute(f"SELECT * FROM {table}").fetchall()
            if rows:
                columns = list(rows[0])
                target.executemany(
                    f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                    [tuple(row[column] for column in columns) for row in rows],
                )
        assert not target.execute("PRAGMA foreign_key_check").fetchall()


def import_sqlite(source_path):
    """Import once into an empty PostgreSQL DB; rollback the whole copy on any mismatch."""
    if DRIVER != "postgresql":
        raise RuntimeError("Import target must be PostgreSQL")
    source_path = Path(source_path).resolve(strict=True)
    report = {}
    with (
        sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True) as source,
        connect() as target,
    ):
        source.row_factory = sqlite3.Row
        source.execute("BEGIN")
        if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        if source.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("SQLite foreign-key check failed")
        target.execute("LOCK TABLE " + ",".join(TABLES) + " IN ACCESS EXCLUSIVE MODE")
        for table in TABLES:
            if target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
                raise RuntimeError("Target is not empty; refusing to overwrite data")
        for table in TABLES:
            columns = [
                entry[1] for entry in source.execute(f"PRAGMA table_info({table})")
            ]
            if not columns and table in {"workers", "stem_jobs", "processing_usage"}:
                report[table] = {"rows": 0, "sha256": table_digest([])}
                continue
            if not columns or any(
                not column.replace("_", "").isalnum() for column in columns
            ):
                raise RuntimeError("Invalid source schema")
            # Validate the source column names against the target before using them in SQL.
            probe = target.execute(f"SELECT * FROM {table} LIMIT 0")
            if columns != [column.name for column in probe.cursor.description]:
                raise RuntimeError("Incompatible source schema: " + table)
            rows = source.execute(f"SELECT * FROM {table}").fetchall()
            if rows:
                target.executemany(
                    f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                    [tuple(row) for row in rows],
                )
            copied = target.execute(f"SELECT * FROM {table}").fetchall()
            if len(rows) != len(copied) or table_digest(rows) != table_digest(copied):
                raise RuntimeError("Import verification failed: " + table)
            report[table] = {"rows": len(rows), "sha256": table_digest(copied)}
    return report


initialize()
