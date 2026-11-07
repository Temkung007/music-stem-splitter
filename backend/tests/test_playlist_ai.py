import io
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import playlist_ai
from playlists import ComposeInput, understand


def response(plan=None, *, reason="STOP", parts=None):
    return io.BytesIO(
        json.dumps(
            {
                "candidates": [
                    {
                        "finishReason": reason,
                        "content": {
                            "parts": parts
                            if parts is not None
                            else [{"text": json.dumps(plan)}]
                        },
                    }
                ],
                "usageMetadata": {"promptTokenCount": 123, "candidatesTokenCount": 20},
            }
        ).encode()
    )


class GeminiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "AI_PROVIDER": "gemini",
                "GEMINI_API_KEY": "unit-test-secret-key",
                "GEMINI_MODEL": "gemini-3.8-flash",
                "GEMINI_FALLBACK_MODEL": "gemini-3.5-flash-lite",
            },
            clear=True,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        playlist_ai._health_cache = (None, 0.0, False)
        self.defaults = {"target_minutes": 60, "profile": "build"}

    def test_private_header_schema_and_thought_filter(self):
        plan = {"target_minutes": 90, "profile": "closing"}
        with patch(
            "playlist_ai.urlopen",
            return_value=response(
                parts=[
                    {"text": "internal reasoning", "thought": True},
                    {"text": json.dumps(plan)},
                ]
            ),
        ) as send:
            self.assertEqual(
                playlist_ai.extract_plan("ปิดงานเก้าสิบนาที", self.defaults), plan
            )
        request = send.call_args.args[0]
        self.assertNotIn("unit-test-secret-key", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "unit-test-secret-key")
        payload = json.loads(request.data)
        self.assertEqual(payload["generationConfig"]["maxOutputTokens"], 1024)
        self.assertEqual(
            payload["generationConfig"]["thinkingConfig"], {"thinkingLevel": "low"}
        )
        self.assertEqual(
            payload["generationConfig"]["responseFormat"],
            {
                "text": {"mimeType": "APPLICATION_JSON", "schema": playlist_ai.SCHEMA},
            },
        )
        sent = json.loads(payload["contents"][0]["parts"][0]["text"])
        self.assertEqual(set(sent), {"brief", "defaults"})
        self.assertEqual(sent["brief"], "ปิดงานเก้าสิบนาที")

    def test_quota_error_uses_backup_without_logging_provider_body(self):
        error = HTTPError(
            "https://provider.invalid",
            429,
            "quota",
            {},
            io.BytesIO(b"unit-test-secret-key"),
        )
        with patch(
            "playlist_ai.urlopen", side_effect=[error, response(self.defaults)]
        ) as send:
            with self.assertLogs("stemora.playlist_ai", level="INFO") as messages:
                self.assertEqual(
                    playlist_ai.extract_plan("one hour", self.defaults), self.defaults
                )
        self.assertIn("gemini-3.5-flash-lite", send.call_args_list[1].args[0].full_url)
        self.assertNotIn("unit-test-secret-key", " ".join(messages.output))

    def test_invalid_or_partial_result_uses_backup(self):
        for bad in [
            {"target_minutes": True, "profile": "build"},
            {"target_minutes": 481, "profile": "build"},
            {"target_minutes": 60, "profile": "unknown"},
            {**self.defaults, "track_ids": ["foreign-track"]},
        ]:
            with (
                self.subTest(bad=bad),
                patch(
                    "playlist_ai.urlopen",
                    side_effect=[response(bad), response(self.defaults)],
                ),
            ):
                self.assertEqual(
                    playlist_ai.extract_plan("brief", self.defaults), self.defaults
                )
        with patch(
            "playlist_ai.urlopen",
            side_effect=[
                response(self.defaults, reason="MAX_TOKENS"),
                response(self.defaults),
            ],
        ):
            self.assertEqual(
                playlist_ai.extract_plan("brief", self.defaults), self.defaults
            )

    def test_invalid_key_stops_after_one_request(self):
        error = HTTPError(
            "https://provider.invalid",
            403,
            "denied",
            {},
            io.BytesIO(b"private provider error"),
        )
        with patch("playlist_ai.urlopen", side_effect=error) as send:
            with self.assertRaises(playlist_ai.ProviderUnavailable) as caught:
                playlist_ai.extract_plan("brief", self.defaults)
        self.assertEqual(send.call_count, 1)
        self.assertNotIn("private", str(caught.exception))

    def test_timeout_uses_backup(self):
        with patch(
            "playlist_ai.urlopen",
            side_effect=[URLError("timeout"), response(self.defaults)],
        ):
            self.assertEqual(
                playlist_ai.extract_plan("brief", self.defaults), self.defaults
            )

    def test_metadata_probe_is_cached_and_never_generates(self):
        metadata = {
            "name": "models/gemini-3.8-flash",
            "supportedGenerationMethods": ["generateContent"],
        }
        with patch(
            "playlist_ai.urlopen",
            return_value=io.BytesIO(json.dumps(metadata).encode()),
        ) as send:
            self.assertTrue(playlist_ai.ready())
            self.assertTrue(playlist_ai.ready())
        self.assertEqual(send.call_count, 1)
        request = send.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertNotIn(":generateContent", request.full_url)

    def test_missing_key_and_invalid_model_never_send_requests(self):
        with patch("playlist_ai.urlopen") as send:
            with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
                self.assertFalse(playlist_ai.configured())
                self.assertFalse(playlist_ai.ready())
            with patch.dict(os.environ, {"GEMINI_MODEL": "../other-host?key=leak"}):
                with self.assertRaises(playlist_ai.ProviderUnavailable):
                    playlist_ai.extract_plan("brief", self.defaults)
        send.assert_not_called()

    def test_ollama_compatibility(self):
        with patch.dict(
            os.environ,
            {"AI_PROVIDER": "ollama", "AI_BASE_URL": "http://assistant:11434"},
        ):
            with patch(
                "playlist_ai.urlopen",
                return_value=io.BytesIO(
                    json.dumps(
                        {
                            "message": {"content": json.dumps(self.defaults)},
                        }
                    ).encode()
                ),
            ) as send:
                self.assertEqual(
                    playlist_ai.extract_plan("brief", self.defaults), self.defaults
                )
        self.assertEqual(
            send.call_args.args[0].full_url, "http://assistant:11434/api/chat"
        )
        self.assertNotIn("X-goog-api-key", dict(send.call_args.args[0].header_items()))


class PlanningFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_outage_preserves_local_owned_library_filters(self):
        with patch.dict(
            os.environ, {"AI_PROVIDER": "gemini", "GEMINI_API_KEY": "test"}
        ):
            with (
                patch("playlists.rate_limit"),
                patch(
                    "playlist_ai.extract_plan",
                    side_effect=playlist_ai.ProviderUnavailable("offline"),
                ),
            ):
                plan, used = await understand(
                    ComposeInput(
                        prompt="House 1 ชั่วโมง 30 นาที ค่อยเพิ่มพลัง 118-126 BPM",
                        excluded_ids=["keep-excluded"],
                    ),
                    ["House"],
                )
        self.assertFalse(used)
        self.assertEqual(plan.target_minutes, 90)
        self.assertEqual(plan.genre, "House")
        self.assertEqual((plan.bpm_min, plan.bpm_max), (118, 126))
        self.assertEqual(plan.excluded_ids, ["keep-excluded"])
