"""Localization keeps request state separate and preserves user-entered text."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from i18n import language, preferred_language, system_payload, t


class LocalizationTests(unittest.TestCase):
    def test_system_messages_preserve_user_content(self):
        token = language.set("en")
        try:
            result = system_payload(
                {
                    "name": "ถังขยะ",
                    "title": "บันทึก",
                    "items": [{"note": "กำลังวิเคราะห์เสียง"}],
                    "message": "กำลังวิเคราะห์เสียง",
                }
            )
            self.assertEqual(result["message"], "Analyzing audio")
            self.assertEqual(result["name"], "ถังขยะ")
            self.assertEqual(result["title"], "บันทึก")
            self.assertEqual(result["items"][0]["note"], "กำลังวิเคราะห์เสียง")
            self.assertEqual(t("BPM ต่าง 2.5"), "BPM difference 2.5")
            self.assertEqual(t("BPM difference 2.5", "th"), "BPM ต่าง 2.5")
        finally:
            language.reset(token)

    def test_language_negotiation(self):
        self.assertEqual(preferred_language("en-US,en;q=0.8,th;q=0.5"), "en")
        self.assertEqual(preferred_language("en;q=0,th-TH;q=0.8"), "th")
        self.assertEqual(preferred_language("th;q=0.3,en;q=0.9"), "en")
        self.assertEqual(preferred_language("fr,ja;q=0.5"), "th")

    def test_catalog_is_complete_and_synced(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / "frontend/src/lib/translations.json").read_bytes()
        self.assertEqual(source, (root / "backend/translations.json").read_bytes())
        import re

        for key, message in json.loads(source).items():
            self.assertTrue(message["th"] and message["en"], key)
            self.assertEqual(
                sorted(re.findall(r"\{\d+\}", message["th"])),
                sorted(re.findall(r"\{\d+\}", message["en"])),
                key,
            )
            self.assertIsNone(re.search(r"[\u0e00-\u0e7f]", message["en"]), key)
