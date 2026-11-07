"""Test STEMORA Rekordbox Live Sync Engine."""

import json
from urllib.request import build_opener
from test_api import HttpHarness


class SyncTests(HttpHarness):
    def test_sync_agent_and_token_flow(self):
        # 1. Download agent script without auth
        code, body, headers = self.request("/api/sync/agent.py", opener=build_opener())
        self.assertEqual(code, 200)
        self.assertIn(b"STEMORA Rekordbox Live Sync Agent", body)

        # 2. Get or create token with session
        code, body, _ = self.request("/api/sync/token")
        self.assertEqual(code, 200)
        token_info = json.loads(body)
        token = token_info["token"]
        self.assertTrue(token.startswith("st_live_"))

        # 3. Call manifest using Bearer token without session cookie
        code, body, _ = self.request(
            "/api/sync/manifest",
            headers={"Authorization": f"Bearer {token}"},
            opener=build_opener(),
        )
        self.assertEqual(code, 200)
        manifest = json.loads(body)
        self.assertIn("playlists", manifest)
        self.assertIn("tracks", manifest)
        self.assertEqual(manifest["user_id"], self.user["id"])

        # 4. Token rotation
        code, body, _ = self.request("/api/sync/token/rotate", method="POST")
        self.assertEqual(code, 200)
        new_token = json.loads(body)["token"]
        self.assertNotEqual(token, new_token)

        # 5. Old token should fail
        code, _, _ = self.request(
            "/api/sync/manifest",
            headers={"Authorization": f"Bearer {token}"},
            opener=build_opener(),
        )
        self.assertEqual(code, 401)

        # 6. New token should succeed
        code, body, _ = self.request(
            "/api/sync/manifest",
            headers={"Authorization": f"Bearer {new_token}"},
            opener=build_opener(),
        )
        self.assertEqual(code, 200)
