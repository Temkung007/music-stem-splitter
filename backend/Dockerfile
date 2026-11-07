FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STEMORA_DATA_DIR=/data NUMBA_CACHE_DIR=/tmp/numba
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY requirements.txt requirements-ai.txt ./
RUN pip install --no-cache-dir -r requirements.txt
ARG INSTALL_AUDIO_AI=true
# sphn has no Linux ARM wheel. Build it against the system Opus library;
# build tools stay in this stage and are absent from the runtime image.
RUN if [ "$INSTALL_AUDIO_AI" = "true" ] && [ "$(uname -m)" != "x86_64" ]; then \
      apt-get update && apt-get install -y --no-install-recommends build-essential cargo rustc pkg-config cmake libssl-dev libopus-dev && rm -rf /var/lib/apt/lists/*; \
    fi
RUN --mount=type=cache,id=stemora-pip,target=/root/.cache/pip \
    --mount=type=cache,id=stemora-cargo,target=/root/.cargo/registry \
    set -eu; if [ "$INSTALL_AUDIO_AI" = "true" ]; then \
      if [ "$(uname -m)" = "x86_64" ]; then \
        pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu; \
      fi; \
      pip install -r requirements-ai.txt; \
    fi

FROM base AS runtime
COPY --from=dependencies /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=dependencies /usr/local/bin /usr/local/bin
RUN useradd --uid 10001 --create-home studio && mkdir -p /data /home/studio/.cache && chown -R studio:studio /data /home/studio/.cache
COPY --chown=studio:studio *.py translations.json ./
USER studio
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD curl --fail --silent http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
