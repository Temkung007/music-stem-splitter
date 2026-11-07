"""Request-local TH/EN system messages. Never translate music names or user notes."""

import json
import re
from contextvars import ContextVar
from pathlib import Path

from fastapi.responses import JSONResponse

language = ContextVar("stemora_language", default="th")
MESSAGES = json.loads(Path(__file__).with_name("translations.json").read_text())
ALIASES = {}
PATTERNS = []
for key, message in MESSAGES.items():
    for value in {key, message["th"], message["en"]}:
        ALIASES[value] = message
        if re.search(r"\{\d+\}", value):
            names = []
            parts = []
            for part in re.split(r"(\{\d+\})", value):
                if re.fullmatch(r"\{\d+\}", part):
                    names.append(part[1:-1])
                    parts.append("([\\s\\S]*?)")
                else:
                    parts.append(re.escape(part))
            PATTERNS.append((re.compile("^" + "".join(parts) + "$"), names, message))


def preferred_language(header):
    candidates = []
    for entry in (header or "").split(","):
        tag, *options = entry.strip().lower().split(";")
        try:
            quality = next(
                (
                    float(option.strip()[2:])
                    for option in options
                    if option.strip().startswith("q=")
                ),
                1,
            )
        except ValueError:
            quality = 0
        locale = tag.split("-")[0]
        if locale in {"th", "en"} and quality > 0:
            candidates.append((quality, locale))
    return (
        max(enumerate(candidates), key=lambda entry: (entry[1][0], -entry[0]))[1][1]
        if candidates
        else "th"
    )


def t(source, locale=None):
    locale = locale or language.get()
    if source in ALIASES:
        return ALIASES[source][locale]
    for pattern, names, message in PATTERNS:
        match = pattern.fullmatch(source)
        if match:
            values = dict(zip(names, match.groups()))
            return re.sub(r"\{(\d+)\}", lambda found: values[found[1]], message[locale])
    return source


def system_payload(value):
    if isinstance(value, list):
        return [system_payload(entry) for entry in value]
    if isinstance(value, dict):
        result = {}
        for key, entry in value.items():
            if key in {"detail", "message"} and isinstance(entry, str):
                result[key] = t(entry)
            elif key == "analysis" and isinstance(entry, dict):
                result[key] = {
                    **entry,
                    **(
                        {"note": t(entry["note"])}
                        if isinstance(entry.get("note"), str)
                        else {}
                    ),
                }
            else:
                result[key] = system_payload(entry)
        return result
    return value


class LocalizedJSONResponse(JSONResponse):
    def render(self, content):
        return super().render(system_payload(content))
