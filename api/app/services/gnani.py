"""Gnani Prisma (STT) and Timbre (TTS) over REST."""

import asyncio

import httpx

from ..config import get_settings


class GnaniError(Exception):
    pass


# Gnani TTS allows one active request per API key; queue ours instead of failing with 429.
tts_lock = asyncio.Lock()


def _headers() -> dict:
    key = get_settings().gnani_api_key
    if not key:
        raise GnaniError("GNANI_API_KEY is not set")
    return {"X-API-Key-ID": key}


async def speak(text: str, language: str, voice: str = "Shivani", sample_rate: int = 16000) -> bytes:
    body = {
        "text": text,
        "voice": voice,
        "model": "timbre-v3.0",
        "language": language,
        "audio_config": {
            "sample_rate": sample_rate,
            "num_channels": 1,
            "sample_width": 2,
            "encoding": "linear_pcm",
            "container": "wav",
        },
    }
    for attempt in range(3):
        async with tts_lock:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    f"{get_settings().gnani_base_url}/api/v1/tts/inference", json=body, headers=_headers()
                )
        if r.status_code == 429 and attempt < 2:
            await asyncio.sleep(0.6 * (attempt + 1))
            continue
        break
    if r.status_code == 429:
        raise GnaniError("Voice is busy right now. Try again in a moment.")
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("audio"):
        raise GnaniError(f"Couldn't make the voice ({r.status_code})")
    return r.content


async def transcribe(audio: bytes, filename: str, language: str = "indic-auto", fmt: str = "codemix") -> dict:
    """Returns {'transcript': str, 'language': str}."""
    data = {"model": "prisma-v3.0", "language_code": language, "format": fmt}
    files = {"audio_file": (filename, audio, "audio/wav")}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{get_settings().gnani_base_url}/stt/v3", data=data, files=files, headers=_headers()
        )
    body = r.json() if r.content else {}
    if r.status_code != 200 or not body.get("success"):
        raise GnaniError(f"Couldn't understand the audio ({r.status_code})")
    return {
        "transcript": body.get("transcript", "").strip(),
        "language": body.get("detected_language_code") or (language if language != "indic-auto" else ""),
    }
