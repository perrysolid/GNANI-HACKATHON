"""Call guard: the phone sits next to a call on speaker. Haanji listens to both sides,
and the moment it hears a scam it warns out loud in the user's language.

WebSocket /api/guard. First message {"type":"start","token":..}, then 16 kHz PCM16 audio,
then {"type":"stop"}. Server sends: ready, heard, verdict, alarm (+ audio: 1-byte turn id + PCM).
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect

from ..config import get_settings
from ..db import Call, SessionLocal
from ..services import gnani
from ..services.languages import is_language
from ..services.scam_rules import RANK, analyse
from .live import _user_from, call_context
from .shield import _second_opinion

router = APIRouter()
log = logging.getLogger("haanji.guard")
MAX_SECONDS = 30 * 60
FRAME = 1024

WARN = {
    "hi-IN": "सावधान! यह फ्रॉड कॉल है। फ़ोन अभी काट दीजिए। किसी को ओटीपी, पिन या पैसे मत दीजिए।",
    "en-IN": "Careful! This is a fraud call. Hang up now. Don't share any OTP, PIN or money.",
    "kn-IN": "ಎಚ್ಚರಿಕೆ! ಇದು ವಂಚನೆ ಕರೆ. ಈಗಲೇ ಫೋನ್ ಕಟ್ ಮಾಡಿ. ಯಾರಿಗೂ ಓಟಿಪಿ, ಪಿನ್ ಅಥವಾ ಹಣ ಕೊಡಬೇಡಿ.",
    "ta-IN": "எச்சரிக்கை! இது மோசடி அழைப்பு. உடனே போனை வையுங்கள். யாருக்கும் ஓடிபி, பின் அல்லது பணம் கொடுக்காதீர்கள்.",
    "te-IN": "జాగ్రత్త! ఇది మోసపూరిత కాల్. వెంటనే ఫోన్ కట్ చేయండి. ఎవరికీ ఓటీపీ, పిన్ లేదా డబ్బు ఇవ్వకండి.",
    "mr-IN": "सावधान! हा फसवणुकीचा कॉल आहे. आत्ताच फोन ठेवा. कोणालाही ओटीपी, पिन किंवा पैसे देऊ नका.",
    "bn-IN": "সাবধান! এটা প্রতারণার ফোন। এখনই ফোন কেটে দিন। কাউকে ওটিপি, পিন বা টাকা দেবেন না।",
    "gu-IN": "સાવધાન! આ છેતરપિંડીનો કૉલ છે. હમણાં જ ફોન કાપી નાખો. કોઈને ઓટીપી, પિન કે પૈસા ન આપો.",
    "ml-IN": "ശ്രദ്ധിക്കുക! ഇത് തട്ടിപ്പ് കോളാണ്. ഇപ്പോൾ തന്നെ ഫോൺ കട്ട് ചെയ്യൂ. ആർക്കും ഒടിപി, പിൻ, പണം നൽകരുത്.",
    "pa-IN": "ਸਾਵਧਾਨ! ਇਹ ਧੋਖੇ ਵਾਲੀ ਕਾਲ ਹੈ। ਹੁਣੇ ਫ਼ੋਨ ਕੱਟ ਦਿਓ। ਕਿਸੇ ਨੂੰ ਓਟੀਪੀ, ਪਿੰਨ ਜਾਂ ਪੈਸੇ ਨਾ ਦਿਓ।",
}


@router.websocket("/api/guard")
async def guard(ws: WebSocket):
    await ws.accept()
    try:
        start = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        await ws.close(code=1008)
        return
    uid = _user_from(str(start.get("token", "")))
    ctx = call_context(uid, "rider") if uid else None
    s = get_settings()
    if not ctx or not s.gnani_api_key:
        await ws.send_json({"type": "error", "message": "Sign in again to use the guard"})
        await ws.close(code=1008)
        return
    lang = ctx[1].get("my_language") or "hi-IN"
    lang = lang if lang in WARN else "hi-IN"

    lock = asyncio.Lock()

    async def send(m: dict | bytes):
        async with lock:
            try:
                await (ws.send_bytes(m) if isinstance(m, bytes) else ws.send_json(m))
            except Exception:
                pass

    heard: list[str] = []
    state = {"level": "no_signs", "signals": [], "note": "", "alarmed": False, "checking": False}
    done = asyncio.Event()

    async def raise_alarm():
        state["alarmed"] = True
        await send({"type": "alarm", "language": lang, "text": WARN[lang]})
        try:
            wav = await gnani.speak(WARN[lang], lang, voice=ctx[1].get("voice") or "Shivani")
            await send({"type": "reply_start", "turn": 1, "language": lang})
            await send(bytes([1]) + wav[44:])  # strip the WAV header: raw 16 kHz PCM16
        except gnani.GnaniError as e:
            log.info("guard warning voice failed: %s", e)

    async def judge():
        text = " ".join(heard)
        v = analyse(text)
        level, note = v.level, state["note"]
        if RANK[level] < RANK["scam"] and not state["checking"]:
            state["checking"] = True
            try:
                second = await _second_opinion(text)
            finally:
                state["checking"] = False
            if second and RANK[second["level"]] > RANK[level]:
                level, note = second["level"], str(second.get("why", ""))[:200]
        if RANK[level] >= RANK[state["level"]]:
            state.update(level=level, note=note, signals=[{"category": f.category, "phrase": f.phrase} for f in v.findings])
            await send({"type": "verdict", "level": level, "signals": state["signals"], "note": note})
        if state["level"] == "scam" and not state["alarmed"]:
            await raise_alarm()

    headers = {"x-api-key-id": s.gnani_api_key, "model": "prisma-v3.0", "language_code": "indic-auto",
               "format": "codemix", "x-sample-rate": "16000", "x-idle-timeout-sec": "300",
               "x-min-silence-ms": "450", "x-min-speech-ms": "180"}

    async with connect("wss://api.vachana.ai/stt/v3/stream", additional_headers=headers, max_size=2**20) as stt:
        await send({"type": "ready"})

        async def read_stt():
            try:
                async for raw in stt:
                    m = json.loads(raw)
                    if m.get("type") == "transcript" and (m.get("text") or "").strip():
                        t = m["text"].strip()
                        heard.append(t)
                        code = m.get("detected_language_code") or ""
                        await send({"type": "heard", "text": t, "language": code if is_language(code) else ""})
                        asyncio.create_task(judge())
            except Exception as e:
                log.info("guard stt closed: %s", e)
            done.set()

        async def pump():
            buf = bytearray()
            try:
                while not done.is_set():
                    m = await ws.receive()
                    if m["type"] == "websocket.disconnect":
                        break
                    if m.get("bytes"):
                        buf.extend(m["bytes"])
                        while len(buf) >= FRAME:
                            await stt.send(bytes(buf[:FRAME]))
                            del buf[:FRAME]
                    elif m.get("text") and json.loads(m["text"]).get("type") == "stop":
                        break
            except (WebSocketDisconnect, RuntimeError, ValueError):
                pass
            done.set()

        tasks = [asyncio.create_task(read_stt()), asyncio.create_task(pump())]
        try:
            await asyncio.wait_for(done.wait(), timeout=MAX_SECONDS)
        except asyncio.TimeoutError:
            pass
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    if heard:
        labels = sorted({sig["category"] for sig in state["signals"]})
        summary = ("Fraud call: " if state["level"] == "scam" else "Call checked: ") + (
            f"signs of {', '.join(labels)}." if labels else "no scam signs heard.") + (f" {state['note']}" if state["note"] else "")
        with SessionLocal() as db:
            db.add(Call(user_id=uid, direction="in", kind="guard", counterpart="Call on speaker", language=lang,
                        verdict="scam" if state["level"] == "scam" else ("suspicious" if state["level"] == "suspicious" else "ok"),
                        summary=summary, transcript=[{"who": "call", "text": t} for t in heard]))
            db.commit()
        await send({"type": "summary", "text": summary, "level": state["level"]})
    try:
        await ws.close()
    except RuntimeError:
        pass
