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
from . import knowledge, llm, places
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

FILLER = {
    "hi-IN": "एक मिनट, मैप पर देखकर बताते हैं।",
    "en-IN": "One moment, let me check the map for you.",
    "kn-IN": "ಒಂದು ನಿಮಿಷ, ಮ್ಯಾಪ್ ನೋಡಿ ಹೇಳ್ತೀನಿ.",
    "ta-IN": "ஒரு நிமிஷம், மேப்ல பார்த்து சொல்றேன்.",
    "te-IN": "ఒక్క నిమిషం, మ్యాప్‌లో చూసి చెప్తాను.",
    "ml-IN": "ഒരു മിനിറ്റ്, മാപ്പിൽ നോക്കി പറയാം.",
    "mr-IN": "एक मिनिट, मॅपवर बघून सांगू.",
    "bn-IN": "এক মিনিট, ম্যাপে দেখে বলছি।",
    "gu-IN": "એક મિનિટ, મેપમાં જોઈને કહું છું.",
    "pa-IN": "ਇੱਕ ਮਿੰਟ, ਮੈਪ ਤੇ ਦੇਖ ਕੇ ਦੱਸਦੇ ਹਾਂ।",
}

FALLBACK = {
    "hi-IN": "आपको यहाँ आना है: {addr}. आसपास कौन सी बड़ी दुकान या सड़क दिख रही है?",
    "en-IN": "You need to come to {addr}. What big shop or main road can you see near you?",
    "kn-IN": "ನೀವು ಇಲ್ಲಿಗೆ ಬರಬೇಕು: {addr}. ಹತ್ತಿರ ಯಾವ ದೊಡ್ಡ ಅಂಗಡಿ ಅಥವಾ ರಸ್ತೆ ಕಾಣ್ತಿದೆ?",
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
        persona: str,  # rider | screen | errand
        owner_name: str,
        profile: dict,
        protected: dict | None,
        send_json: Callable[[dict], Awaitable[None]],
        send_audio: Callable[[bytes], Awaitable[None]],
        errand=None,  # services.errands.Errand: an outgoing call Haanji makes for the owner
    ):
        self.persona = persona
        self.errand = errand
        self.end_after = False  # the model said [END]: hang up after this reply
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
        if errand is not None:
            self.home_lang = errand.language
        self.caller_lang = self.home_lang
        self._lang_vote = ""  # a language the caller used once; switch if they keep using it
        self.turn = 0
        self.reply_task: asyncio.Task | None = None
        self.verdict = "no_signs"
        self.ended = asyncio.Event()
        self._pcm = bytearray()
        self._stt = None
        # Typing mode (deaf users): the owner types, Haanji only speaks what they type.
        self.manual = False
        # Scam guard: only when the owner turned it on (or in the scam practice call).
        self.guard = persona == "screen" or (persona != "errand" and bool(profile.get("scam_guard")))
        # Owner joined the call ("on the call with me"): Haanji steps back while they talk.
        self.owner_spoke_at = 0.0
        # Caller said where they are: the route from there, found on the map (one at a time).
        self.route_note = ""
        self._dest: tuple[float, float] | None = None

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

    def _system(self, allow_lookup: bool = True) -> str:
        lang = LANGUAGES[self.caller_lang]["name"]
        common = (
            f"You are Haanji, a polite phone assistant. You are ON A LIVE PHONE CALL, so reply "
            f"ONLY in spoken {lang}, in one or two short sentences (under 25 words). No lists, no "
            f"markdown, no emojis. Write numbers as words. Stay in {lang} even if they use a few English words. "
            f"Never share OTPs, bank details, Aadhaar, or anything not given to you here."
        )
        if self.persona == "errand" and self.errand is not None:
            e = self.errand
            contact = (f" If they need a contact number for {self.owner}, give {' '.join(e.owner_phone)}."
                       if e.share_number and e.owner_phone else f" Don't give out {self.owner}'s phone number.")
            return (
                f"{common} This is an OUTGOING call: you called {e.to_name or 'this business'} on behalf of "
                f"{self.owner}. YOUR TASK: {e.task}\nOpen by greeting, saying you are Haanji calling for "
                f"{self.owner}, and asking for it in one sentence. Answer their questions only from the task. "
                f"If they offer something different (another time, another table), accept only if the task "
                f"allows it; otherwise say {self.owner} will call back. Before finishing, repeat the agreed "
                f"details back (name, day, time, number of people, anything else).{contact} Never agree to "
                f"pay or share card numbers or OTPs. Talk like a person making the call: never mention 'the task', instructions or limits. When the task is done, or clearly not possible, thank them, "
                f"say goodbye and end that reply with [END]."
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
            f"facts below. RIDERS AND DRIVERS are in a hurry: talk like a helpful local, short and casual "
            f"(call them bhaiya in Hindi, anna in Kannada, Tamil or Telugu, dada in Bengali). Don't ask which app or for an order name. As soon as they say "
            f"they're coming, ask where they are right now ('कहाँ हो भैया, आसपास क्या दिख रहा है?'). "
            f"If CURRENT LOCATION is given, deliveries, orders and rides go THERE (not home): "
            f"name the place, ask what the caller can see, and guide them turn by turn using the "
            f"landmarks around it (distances and directions are given). When you give an address, ALWAYS say "
            f"the ADDRESS exactly as written first (flat or house number, building, street, area), then one or "
            f"two landmarks to help find it; landmarks never replace the address. If THEIR WORK is listed, also act "
            f"as the receptionist: answer customers or patients from those answers, and for a booking "
            f"take their name, preferred time and reason, then say {self.owner} will confirm. Never give "
            f"medical advice or diagnoses. If something isn't covered, take a message and say {self.owner} will call back. "
            f"If they ask for money or an OTP, refuse politely."
            f"{self._lookup_rule(allow_lookup)}\n\nFacts about {self.owner}:\n"
            f"{knowledge.facts(self.profile)}{self.route_note}"
        )

    def _lookup_rule(self, allow: bool) -> str:
        if not get_settings().google_maps_key or self.persona != "rider":
            return ""
        if not allow:
            return " Do NOT write LOOKUP now: use the ROUTE below, or ask for a bigger landmark if it says not found."
        return (
            " MAP: if the caller (a rider or driver) tells you where they are right now - a shop, landmark, "
            "signal, road or area - and needs the way, reply with ONLY one line: LOOKUP: <that place in English "
            "letters, with the area if they said it>. Nothing else. You will then get the route from there and guide "
            "them. If a ROUTE is already below and they now name another road, shop or landmark, IMMEDIATELY write "
            "LOOKUP: <that place> (don't ask them again). Never LOOKUP the same place twice."
        )

    async def _destination(self) -> dict | None:
        """Where riders should come: {'lat','lng','label','near'}. The current location if it was set in the
        last 12 h, else the pin on the home address (or the home address found on the map)."""
        from datetime import datetime, timezone
        live = self.profile.get("live") or {}
        if live.get("lat") and live.get("at"):
            age = datetime.now(timezone.utc) - datetime.fromisoformat(live["at"])
            if age.total_seconds() < 12 * 3600:
                typed = ((self.profile.get("knowledge") or {}).get("places") or {}).get("now", {}).get("address")
                return {"lat": live["lat"], "lng": live["lng"], "label": typed or live.get("place") or "their current location",
                        "near": live.get("near") or []}
        if self._dest is None:
            a = self.profile.get("address") or {}
            label = ", ".join(x for x in (a.get("house"), a.get("area")) if x)
            if a.get("landmark"):
                label += f" ({a['landmark']})"
            ll = (a["lat"], a["lng"]) if a.get("lat") and a.get("lng") else None
            if not ll:
                line = ", ".join(x for x in (a.get("house"), a.get("area"), self.profile.get("city")) if x)
                ll = await places.geocode(line, get_settings().google_maps_key) if line else None
            self._dest = {"lat": ll[0], "lng": ll[1], "label": label or "their home", "near": []} if ll else {}
        return self._dest or None

    async def _lookup(self, query: str) -> None:
        dest = await self._destination()
        key = get_settings().google_maps_key
        city = self.profile.get("city") or ""
        q = query if not city or city.lower() in query.lower() else f"{query}, {city}"
        r = await places.route_from(q, (dest["lat"], dest["lng"]), key) if dest else None
        if r and dest:
            near = "; ".join(f"{p['name']} {p['m']} m {p['dir']}" for p in dest["near"][:3])
            self.route_note = (
                f"\n\nROUTE (from Google Maps). The caller is at: {r['from']} ({r['from_address']}). "
                f"They must come to: {dest['label']}" + (f" (nearby: {near})" if near else "") + ". "
                f"Distance {r['distance']}, about {r['time']} by bike or car. Steps: " + " | ".join(r["steps"]) + ".\n"
                f"How to guide: in your FIRST reply after this, say where they are and where they need to come, "
                f"and how far it is (for example: 'You're at Agara Lake, you need to come to 17th Cross, HSR "
                f"Layout, about one and a half kilometres, five minutes'), using the address exactly as written. Then give only the first one or two "
                f"steps (keep it under 30 words) the way Google Maps says them: which road to take and towards which road or landmark (never "
                f"north/south/east/west), how far, then turn "
                f"left or right, and the landmark they'll see on the left or right. Ask them to tell you when "
                f"they reach it, then give the next steps. At the end, describe the gate using the landmark. "
                f"If they say they are on a road or at a place that is NOT on these steps, don't argue: reply "
                f"with LOOKUP: <that place> to get a fresh route from there."
            )
            await self.send_json({"type": "route", "from": r["from"], "distance": r["distance"], "time": r["time"]})
        elif not dest:
            self.route_note = "\n\nROUTE: no saved location to guide them to. Give the address from the facts."
        else:
            self.route_note = (f"\n\nROUTE: '{query}' was not found on the map. Ask for a bigger landmark, "
                               f"a main road or a well-known shop near them.")
        log.info("lookup %r -> %s to %s", q, (r or {}).get("from_address", "not found"), (dest or {}).get("label"))

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
            if self.errand is not None:
                asyncio.create_task(self._open_errand())
            else:
                greeting = GREETING[self.home_lang].format(name=self.speaking_for)
                self._start_reply(fixed=greeting)
            reader = asyncio.create_task(self._read_stt(stt))
            await self.ended.wait()
            reader.cancel()
            await self.interrupt()
            await asyncio.gather(reader, return_exceptions=True)

    async def _open_errand(self) -> None:
        """Outgoing call: they usually say hello first; if they don't within 3 s, Haanji starts."""
        await asyncio.sleep(3)
        if not self.history and not self.ended.is_set():
            self.history.append({"role": "user", "content": "(They picked up but haven't said anything yet.)"})
            self._start_reply()

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
        if is_language(lang) and lang != self.caller_lang:
            # Stay in the language the call started in. Switch only when the caller really changes
            # language: a long sentence (8+ words) in the new one, or two turns in a row. One English
            # word ("okay", "location", "sir") never switches.
            words = len(text.split())
            if words >= 3 and self._lang_vote == lang or words >= 8:
                self.caller_lang = lang
                self._lang_vote = ""
            else:
                self._lang_vote = lang
        else:
            self._lang_vote = ""
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
        for allow in (True, False):
            buf, lookup, decided = "", False, False
            t0 = asyncio.get_running_loop().time()
            async for chunk in llm.stream([{"role": "system", "content": self._system(allow)}, *self.history[-12:]], 700):
                buf += chunk
                if not decided:
                    head = buf.lstrip().upper()
                    if len(head) < 7 and "LOOKUP:".startswith(head):
                        continue  # might be a map lookup: don't speak yet
                    decided, lookup = True, head.startswith("LOOKUP")
                if not lookup and "LOOKUP:" in buf:
                    # "Okay bhaiya. LOOKUP: Agara signal": say the words before it, then look it up.
                    before, after = buf.split("LOOKUP:", 1)
                    done, rest = split_sentences(before)
                    for sent in [*done, rest.strip()]:
                        if sent := self._strip_end(sent):
                            yield sent
                    buf, lookup = "LOOKUP:" + after, True
                if lookup:
                    continue
                done, buf = split_sentences(buf)
                for sent in done:
                    if sent := self._strip_end(sent):
                        yield sent
            if not lookup:
                if (last := self._strip_end(buf.strip())):
                    yield last
                return
            query = buf.split(":", 1)[-1].strip().splitlines()[0][:120] if ":" in buf else ""
            if not query or not allow:
                # Asked for a map lookup it can't do now: never leave the line silent.
                dest = await self._destination() if get_settings().google_maps_key else None
                yield FALLBACK.get(self.caller_lang, FALLBACK["en-IN"]).format(
                    addr=(dest or {}).get("label") or self._address())
                return
            # Say something while the map lookup runs, so the line isn't silent.
            task = asyncio.create_task(self._lookup(query))
            yield FILLER.get(self.caller_lang, FILLER["en-IN"])
            await task
            log.info("lookup turn took %.1fs (model + map)", asyncio.get_running_loop().time() - t0)

    def _strip_end(self, text: str) -> str:
        if "[END]" in text:
            self.end_after = True
            text = text.replace("[END]", "").strip()
        return text

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
        if then_end or self.end_after:
            await self.send_json({"type": "ended", "reason": "scam" if then_end else "done"})
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
        if llm.available() and self.errand is not None:
            lines = "\n".join(f"{'Them' if t['who'] == 'caller' else 'Haanji'}: {t['text']}" for t in self.transcript)
            try:
                return (await llm.chat([
                    {"role": "system", "content": (
                        f"Haanji phoned {self.errand.to_name or 'a business'} for {self.owner} to do this: "
                        f"{self.errand.task}\nWrite ONLY in {LANGUAGES[my_lang]['name']}, one or two plain sentences "
                        f"for {self.owner}: start with Done, Not done or Partly done, then the exact final details "
                        f"agreed (day, time, people, name, conditions), or why not and what to do next.")},
                    {"role": "user", "content": f"Call transcript:\n{lines[:4000]}"},
                ], max_tokens=300))[:900]
            except llm.LlmUnavailable:
                pass
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
