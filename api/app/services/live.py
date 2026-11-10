"""A live phone-style conversation: Gnani streaming STT -> reasoning model -> Gnani streaming TTS.

Transport-agnostic: the caller's audio comes in as 16 kHz PCM16 frames and
Haanji's voice goes out the same way, through the `send_json` / `send_audio`
callbacks. The browser practice call uses it today; a phone bridge (Twilio
media streams, converting 8 kHz mu-law) plugs into the same class.

Barge-in: Gnani STT emits `speech_start` the moment the caller talks. The
client stops playback and sends `interrupt`; we cancel the reply in flight
(LLM stream + TTS socket) so Haanji goes quiet mid-sentence and listens.
"""

import asyncio
import base64
import json
import logging
import re
from collections.abc import Awaitable, Callable

from websockets.asyncio.client import connect

from ..config import get_settings
from . import knowledge, llm
from .gnani import tts_lock
from .languages import LANGUAGES, is_language
from .scam_rules import analyse

log = logging.getLogger("haanji.live")

FRAME = 1024  # bytes per STT frame: 512 samples of 16-bit PCM
RATE = 16000

GREETING = {
    "hi-IN": "नमस्ते, यह {name} जी का फ़ोन है, हाँजी बोल रहे हैं। बताइए?",
    "en-IN": "Hello, this is Haanji answering for {name}. How can I help?",
    "kn-IN": "ನಮಸ್ಕಾರ, ಇದು {name} ಅವರ ಫೋನ್, ಹಾಂಜಿ ಮಾತಾಡ್ತಿದೀನಿ. ಹೇಳಿ?",
    "ta-IN": "வணக்கம், இது {name} அவர்களின் போன், ஹாஞ்சி பேசுறேன். சொல்லுங்க?",
    "te-IN": "నమస్కారం, ఇది {name} గారి ఫోన్, హాంజీ మాట్లాడుతున్నాను. చెప్పండి?",
    "ml-IN": "നമസ്കാരം, ഇത് {name} ന്റെ ഫോൺ ആണ്, ഹാൻജി സംസാരിക്കുന്നു. പറയൂ?",
    "mr-IN": "नमस्कार, हा {name} यांचा फोन आहे, हांजी बोलत आहे. बोला?",
    "bn-IN": "নমস্কার, এটা {name}-এর ফোন, হাঁজি বলছি। বলুন?",
    "gu-IN": "નમસ્તે, આ {name}નો ફોન છે, હાંજી બોલું છું. બોલો?",
    "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ {name} ਦਾ ਫ਼ੋਨ ਹੈ, ਹਾਂਜੀ ਬੋਲ ਰਹੇ ਹਾਂ। ਦੱਸੋ?",
}

GOODBYE = {
    "hi-IN": "{name} जी अभी उपलब्ध नहीं हैं। वे खुद आपको कॉल करेंगे। धन्यवाद।",
    "en-IN": "{name} is not available and will call you back. Thank you.",
}

_SENTENCE_END = re.compile(r"(?<=[.!?।॥])\s+|\n+")


def split_sentences(buf: str) -> tuple[list[str], str]:
    """Complete sentences out of a streaming buffer, plus the unfinished rest."""
    parts = _SENTENCE_END.split(buf)
    done, rest = [p.strip() for p in parts[:-1] if p.strip()], parts[-1]
    if len(rest) > 140 and " " in rest:  # long clause with no stop: speak what we have
        cut = rest.rfind(" ", 0, 140)
        done.append(rest[:cut].strip())
        rest = rest[cut:]
    return done, rest


# After the owner speaks on a shared call, Haanji leaves the next replies to them for this long.
OWNER_HOLD_S = 10.0


class LiveCall:
    def __init__(
        self,
        *,
        persona: str,  # rider | screen
        owner_name: str,
        profile: dict,
        protected: dict | None,
        send_json: Callable[[dict], Awaitable[None]],
        send_audio: Callable[[bytes], Awaitable[None]],
    ):
        self.persona = persona
        self.owner = owner_name or "Customer"
        self.profile = profile
        self.protected = protected or {}
        self.send_json = send_json
        self.send_audio = send_audio

        self.home_lang = (
            self.protected.get("language") if persona == "screen" else profile.get("local_language")
        ) or "hi-IN"
        self.voice = profile.get("voice") or "Shivani"
        self.history: list[dict] = []
        self.transcript: list[dict] = []
        self.caller_lang = self.home_lang
        self.turn = 0
        self.reply_task: asyncio.Task | None = None
        self.verdict = "no_signs"
        self.ended = asyncio.Event()
        self._pcm = bytearray()
        self._stt = None
        # Typing mode (deaf users): the owner types, Haanji only speaks what they type.
        self.manual = False
        # Scam guard: only when the owner turned it on (or in the scam practice call).
        self.guard = persona == "screen" or bool(profile.get("scam_guard"))
        # Owner joined the call ("on the call with me"): Haanji steps back while they talk.
        self.owner_spoke_at = 0.0

    # ---- who Haanji is speaking for -------------------------------------------------

    @property
    def speaking_for(self) -> str:
        if self.persona == "screen":
            rel = self.protected.get("relation") or "them"
            return self.protected.get("name") or rel if rel == "Other" else rel
        return self.owner

    def _address(self) -> str:
        a = self.profile.get("address") or {}
        bits = [a.get("house"), a.get("area")]
        line = ", ".join(b for b in bits if b)
        if a.get("landmark"):
            line += f". Landmark: {a['landmark']}"
        if a.get("note"):
            line += f". {a['note']}"
        return line or "not shared"

    def _system(self) -> str:
        lang = LANGUAGES[self.caller_lang]["name"]
        common = (
            f"You are Haanji, a polite phone assistant. You are ON A LIVE PHONE CALL, so reply "
            f"ONLY in spoken {lang}, in one or two short sentences (under 25 words). No lists, no "
            f"markdown, no emojis. Write numbers as words. If the caller switches language, follow them. "
            f"Never share OTPs, bank details, Aadhaar, or anything not given to you here."
        )
        if self.persona == "screen":
            return (
                f"{common} You answer calls from unknown numbers for {self.speaking_for}, an elderly "
                f"person. Find out who is calling and why. If it is genuine (family, doctor, known "
                f"shop), say you will pass the message on. If the caller claims to be police, CBI, "
                f"customs, bank or KYC, threatens arrest or a blocked account, or asks for money, OTP "
                f"or an app install, say {self.speaking_for} will not continue this call and end politely."
            )
        return (
            f"{common} You answer calls for {self.owner}, who can't pick up. Callers can be anyone: "
            f"a delivery rider or cab driver who needs directions, a courier, a friend, a colleague, "
            f"a shop. First understand who is calling and what they need, then help using ONLY the "
            f"facts below. For deliveries, ask which app or service they're from before giving the "
            f"address. If CURRENT LOCATION is given, deliveries, orders and rides go THERE (not home): "
            f"name the place, ask what the caller can see, and guide them turn by turn using the "
            f"landmarks around it (distances and directions are given). If THEIR WORK is listed, also act "
            f"as the receptionist: answer customers or patients from those answers, and for a booking "
            f"take their name, preferred time and reason, then say {self.owner} will confirm. Never give "
            f"medical advice or diagnoses. If something isn't covered, take a message and say {self.owner} will call back. "
            f"If they ask for money or an OTP, refuse politely.\n\nFacts about {self.owner}:\n"
            f"{knowledge.facts(self.profile)}"
        )

    # ---- audio in -------------------------------------------------------------------

    async def feed(self, pcm: bytes) -> None:
        if not self._stt:
            return
        self._pcm.extend(pcm)
        while len(self._pcm) >= FRAME:
            frame = bytes(self._pcm[:FRAME])
            del self._pcm[:FRAME]
            try:
                await self._stt.send(frame)
            except Exception:  # STT socket closed; the reader reports it
                return

    async def interrupt(self) -> None:
        """Caller started talking over Haanji: stop the reply in flight."""
        if self.reply_task and not self.reply_task.done():
            self.reply_task.cancel()
            await asyncio.gather(self.reply_task, return_exceptions=True)
            await self.send_json({"type": "interrupted"})

    # ---- main loop ------------------------------------------------------------------

    async def run(self) -> None:
        s = get_settings()
        headers = {
            "x-api-key-id": s.gnani_api_key,
            "model": "prisma-v3.0",
            # The live endpoint takes one locale or indic-auto (a candidate list is rejected).
            "language_code": "indic-auto",
            "format": "codemix",
            "x-sample-rate": str(RATE),
            "x-idle-timeout-sec": "120",
            "x-min-silence-ms": "550",
            "x-min-speech-ms": "180",
        }
        async with connect("wss://api.vachana.ai/stt/v3/stream", additional_headers=headers, max_size=2**20) as stt:
            self._stt = stt
            await self.send_json({"type": "ready", "language": self.home_lang, "speaking_for": self.speaking_for})
            greeting = GREETING[self.home_lang].format(name=self.speaking_for)
            self._start_reply(fixed=greeting)
            reader = asyncio.create_task(self._read_stt(stt))
            await self.ended.wait()
            reader.cancel()
            await self.interrupt()
            await asyncio.gather(reader, return_exceptions=True)

    async def _read_stt(self, stt) -> None:
        try:
            async for raw in stt:
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "speech_start":
                    await self.send_json({"type": "speech_start"})
                elif kind == "processing":
                    await self.send_json({"type": "thinking"})
                elif kind == "transcript":
                    text = (msg.get("text") or "").strip()
                    if text:
                        lang = msg.get("detected_language_code") or ""
                        await self._on_utterance(text, lang)
                elif kind == "error":
                    log.warning("stt error: %s", msg.get("message"))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # socket closed / idle timeout
            log.info("stt closed: %s", e)
            await self.send_json({"type": "ended", "reason": "listening stopped"})
            self.ended.set()

    async def _on_utterance(self, text: str, lang: str) -> None:
        if is_language(lang):
            self.caller_lang = lang
        self.transcript.append({"who": "caller", "text": text, "lang": self.caller_lang})
        self.history.append({"role": "user", "content": text})
        await self.send_json({"type": "heard", "text": text, "language": self.caller_lang})

        caller_text = " ".join(t["text"] for t in self.transcript if t["who"] == "caller")
        if self.guard:
            self.verdict = analyse(caller_text).level
        if self.verdict == "scam":
            goodbye = GOODBYE.get(self.caller_lang, GOODBYE["en-IN"]).format(name=self.speaking_for)
            lang = self.caller_lang if self.caller_lang in GOODBYE else "en-IN"
            await self.send_json({"type": "shield", "level": "scam"})
            self._start_reply(fixed=goodbye, lang=lang, then_end=True)
            return
        owner_talking = asyncio.get_running_loop().time() - self.owner_spoke_at < OWNER_HOLD_S
        if not self.manual and not owner_talking:
            self._start_reply()

    def owner_spoke(self) -> None:
        self.owner_spoke_at = asyncio.get_running_loop().time()

    async def say(self, text: str, from_lang: str) -> None:
        """Speak the owner's typed reply to the caller, in the caller's language."""
        text = text.strip()[:400]
        if not text:
            return
        out = text
        if from_lang != self.caller_lang and llm.available():
            try:
                out = (await llm.chat([
                    {"role": "system", "content": (
                        f"Translate into natural spoken {LANGUAGES[self.caller_lang]['name']} for a phone call. "
                        f"Reply with the translation only.")},
                    {"role": "user", "content": text}], 200)).strip() or text
            except Exception:
                out = text
        self._start_reply(fixed=out)

    # ---- audio out ------------------------------------------------------------------

    def _start_reply(self, fixed: str | None = None, lang: str | None = None, then_end: bool = False) -> None:
        if self.reply_task and not self.reply_task.done():
            self.reply_task.cancel()
        self.turn = (self.turn + 1) % 256
        self.reply_task = asyncio.create_task(self._reply(self.turn, fixed, lang or self.caller_lang, then_end))

    async def _sentences(self, fixed: str | None):
        if fixed is not None:
            yield fixed
            return
        if not llm.available():
            # No reasoning model: read the saved address (rider) or ask again (screen).
            yield (
                f"{self.speaking_for}. {self._address()}"
                if self.persona == "rider"
                else GREETING[self.caller_lang].format(name=self.speaking_for)
            )
            return
        buf = ""
        async for chunk in llm.stream([{"role": "system", "content": self._system()}, *self.history[-12:]], 400):
            buf += chunk
            done, buf = split_sentences(buf)
            for sent in done:
                yield sent
        if buf.strip():
            yield buf.strip()

    async def _reply(self, turn: int, fixed: str | None, lang: str, then_end: bool) -> None:
        s = get_settings()
        spoken: list[str] = []
        try:
            await self.send_json({"type": "reply_start", "turn": turn, "language": lang})
            async with connect(
                "wss://api.vachana.ai/api/v1/tts",
                additional_headers={"X-API-Key-ID": s.gnani_api_key},
                max_size=2**22,
            ) as tts:
                async for sentence in self._sentences(fixed):
                    spoken.append(sentence)
                    await self.send_json({"type": "reply_text", "turn": turn, "text": sentence})
                    # One TTS request per key at a time: hold the shared lock for this sentence.
                    await tts_lock.acquire()
                    try:
                        await self._speak(tts, turn, sentence, lang)
                    finally:
                        tts_lock.release()
            await self.send_json({"type": "reply_end", "turn": turn})
        except asyncio.CancelledError:
            raise
        except llm.LlmUnavailable as e:
            await self.send_json({"type": "error", "message": str(e)})
        except Exception as e:
            log.exception("reply failed")
            await self.send_json({"type": "error", "message": f"Voice error: {e}"})
        finally:
            # Keep what was actually said, even if cut off, so the model knows.
            if spoken:
                said = " ".join(spoken)
                self.transcript.append({"who": "haanji", "text": said, "lang": lang})
                if fixed is None or self.history:
                    self.history.append({"role": "assistant", "content": said})
        if then_end:
            await self.send_json({"type": "ended", "reason": "scam"})
            self.ended.set()

    async def _speak(self, tts, turn: int, sentence: str, lang: str) -> None:
        request = json.dumps({
            "text": sentence,
            "model": "timbre-v3.0",
            "voice": self.voice,
            "language": lang,
            "audio_config": {"sample_rate": RATE, "num_channels": 1, "sample_width": 2,
                             "encoding": "linear_pcm", "container": "raw"},
        })
        for attempt in range(3):
            await tts.send(request)
            async for raw in tts:
                msg = json.loads(raw)
                if msg.get("type") == "audio":
                    pcm = base64.b64decode(msg["data"]["audio"] or "")
                    if pcm:
                        await self.send_audio(bytes([turn]) + pcm)
                elif msg.get("type") == "complete":
                    return
                elif msg.get("type") == "error":
                    text = str(msg.get("message", ""))
                    log.warning("tts error: %s", text)
                    # A just-cancelled reply can still count as active for a moment.
                    if "active request" in text.lower() or "rate" in text.lower():
                        await asyncio.sleep(0.4 * (attempt + 1))
                        break
                    return

    # ---- after the call -------------------------------------------------------------

    async def summary(self, my_lang: str) -> str:
        said = [t for t in self.transcript if t["who"] == "caller"]
        if not said:
            return ""
        if llm.available():
            lines = "\n".join(f"{'Caller' if t['who'] == 'caller' else 'Haanji'}: {t['text']}" for t in self.transcript)
            try:
                return (await llm.chat([
                    {"role": "system", "content": (
                        f"You write call notes for {self.owner}. Write ONLY in {LANGUAGES[my_lang]['name']} "
                        f"(even though the call was in another language), one or two plain sentences: who "
                        f"called, what they wanted, what Haanji told them. If it looked like a scam, say so first."
                    )},
                    {"role": "user", "content": (
                        f"Call transcript:\n{lines[:4000]}\n\nWrite the call notes in "
                        f"{LANGUAGES[my_lang]['name']} ({LANGUAGES[my_lang]['native']}) only."
                    )},
                ], max_tokens=400))[:900]
            except llm.LlmUnavailable:
                pass
        return f"Caller said: {said[0]['text']}"[:900]
