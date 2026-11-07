import os
import unittest
from unittest.mock import patch

from playlists import ComposeInput, understand


class BriefTests(unittest.IsolatedAsyncioTestCase):
    async def test_thai_hours_genre_and_bpm_range(self):
        with patch.dict(os.environ, {"AI_PROVIDER": "ollama", "AI_BASE_URL": ""}):
            result, used = await understand(
                ComposeInput(prompt="House 1 ชั่วโมง 30 นาที ค่อยเพิ่มพลัง 118-126 BPM"),
                ["House", "Techno"],
            )
        self.assertEqual(result.target_minutes, 90)
        self.assertEqual(result.genre, "House")
        self.assertEqual(result.bpm_min, 118)
        self.assertEqual(result.bpm_max, 126)
        self.assertEqual(result.profile, "build")
        self.assertFalse(used)

    async def test_no_invented_genre(self):
        with patch.dict(os.environ, {"AI_PROVIDER": "ollama", "AI_BASE_URL": ""}):
            result, _ = await understand(
                ComposeInput(prompt="จัด Techno สองชั่วโมง", genre="House"), ["House"]
            )
        self.assertEqual(result.genre, "House")
