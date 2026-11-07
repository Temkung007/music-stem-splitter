"""Exercise PostgreSQL import, exact data preservation and portable restore against a real server."""

import importlib.util
import os
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


@unittest.skipUnless(
    os.environ.get("STEMORA_TEST_DATABASE") == "postgresql",
    "PostgreSQL test server required",
)
class PostgresMigrationTests(unittest.TestCase):
    def test_import_snapshot_and_refuse_overwrite(self):
        import psycopg
        from psycopg import sql

        schema = "migration_" + uuid.uuid4().hex
        with psycopg.connect() as connection:
            connection.execute(
                sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema))
            )
        try:
            with (
                tempfile.TemporaryDirectory() as directory,
                patch.dict(
                    os.environ,
                    {
                        "DATABASE_DRIVER": "postgresql",
                        "PGOPTIONS": "-c search_path=" + schema,
                        "STEMORA_DATA_DIR": directory,
                    },
                ),
            ):
                spec = importlib.util.spec_from_file_location(
                    "migration_test_database",
                    Path(__file__).resolve().parents[1] / "database.py",
                )
                database = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(database)
                source = Path(directory) / "source.sqlite3"
                with sqlite3.connect(source) as connection:
                    connection.executescript(database.SCHEMA)
                    connection.execute(
                        "INSERT INTO users VALUES(?,?,?,?,?)",
                        (
                            "u1",
                            "dj@example.test",
                            "ดีเจ ทดสอบ ' ? %",
                            "scrypt$preserved$hash",
                            "2026-10-29",
                        ),
                    )
                    connection.execute(
                        "INSERT INTO sessions VALUES(?,?,?)",
                        ("session-hash", "u1", 1793331234.123456),
                    )
                    connection.execute(
                        "INSERT INTO attempts VALUES(?,?,?)",
                        ("login:dj@example.test", 2, 1793331234.123456),
                    )
                    connection.execute(
                        "INSERT INTO tracks(id,user_id,filename,title,object_key,sha256,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)",
                        (
                            "t1",
                            "u1",
                            "เพลง.wav",
                            "เพลง % ? ' ทดสอบ",
                            "users/u1/song.wav",
                            "digest",
                            6 * 1024**3,
                            "2026-10-29",
                        ),
                    )
                    connection.execute(
                        "INSERT INTO assets VALUES(?,?,?,?)",
                        ("users/u1/stem.wav", "u1", "task1", 42),
                    )
                    connection.execute(
                        "INSERT INTO playlists(id,user_id,name,items,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                        (
                            "p1",
                            "u1",
                            "เซ็ตส่วนตัว",
                            '[{"track_id":"t1","locked":true}]',
                            "2026-10-29",
                            "2026-10-29",
                        ),
                    )
                    connection.execute(
                        "INSERT INTO playlist_versions VALUES(?,?,?,?)",
                        ("p1", 1, '{"name":"เซ็ตเก่า"}', "2026-10-29"),
                    )
                with sqlite3.connect(source) as connection:
                    connection.execute("UPDATE tracks SET energy=?", (2**40,))
                with self.assertRaises(psycopg.errors.NumericValueOutOfRange):
                    database.import_sqlite(source)
                with database.connect() as connection:
                    for table in database.TABLES:
                        self.assertEqual(
                            connection.execute(
                                f"SELECT COUNT(*) FROM {table}"
                            ).fetchone()[0],
                            0,
                        )
                with sqlite3.connect(source) as connection:
                    connection.execute("UPDATE tracks SET energy=NULL")
                report = database.import_sqlite(source)
                self.assertTrue(
                    all(
                        entry["rows"] == (0 if table in {"workers", "stem_jobs", "sync_tokens"} else 1)
                        for table, entry in report.items()
                    )
                )
                with self.assertRaisesRegex(RuntimeError, "not empty"):
                    database.import_sqlite(source)
                portable = Path(directory) / "restored.sqlite3"
                database.sqlite_snapshot(portable)
                with (
                    sqlite3.connect(source) as original,
                    sqlite3.connect(portable) as restored,
                ):
                    original.row_factory = restored.row_factory = sqlite3.Row
                    for table in database.TABLES:
                        self.assertEqual(
                            database.table_digest(
                                original.execute(f"SELECT * FROM {table}").fetchall()
                            ),
                            database.table_digest(
                                restored.execute(f"SELECT * FROM {table}").fetchall()
                            ),
                        )
                with database.connect() as connection:
                    self.assertEqual(
                        connection.execute(
                            "SELECT name FROM users WHERE id=?", ("u1",)
                        ).fetchone()[0],
                        "ดีเจ ทดสอบ ' ? %",
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                        1,
                    )
        finally:
            with psycopg.connect() as connection:
                connection.execute(
                    sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema))
                )
