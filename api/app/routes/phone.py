"""Real phone calls via Exotel (or Twilio, below)'s Voicebot applet (bidirectional stream).

Exotel flow: incoming call on the ExoPhone -> Voicebot applet with URL
    wss://<api-host>/api/phone/exotel?owner=<10-digit user phone>&persona=rider|screen&sample-rate=16000
Auth: Basic auth in the URL (wss://haanji:<PHONE_STREAM_SECRET>@host/...) or &secret=<PHONE_STREAM_SECRET>.

Protocol (JSON text frames): connected, start, media (base64 PCM16 LE mono), dtmf, mark, stop.
We send media (chunks: multiples of 320 bytes, at least 3200), mark, and clear (barge-in).
"""

import asyncio
import audioop  # stdlib up to Python 3.12 (Render pins 3.12)
import base64
import binascii
import json
import logging
import secrets
from html import escape

from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..config import get_settings
from ..db import Call, SessionLocal, User
from ..services.live import RATE, LiveCall
from ..services.ownership import number_owner
from ..services import hub
from .live import MAX_CALL_SECONDS, call_context

router = APIRouter()
log = logging.getLogger("haanji.phone")

MIN_CHUNK = 3200  # Exotel: >= 3.2 KB, <= 100 KB, multiple of 320 bytes
OWNER_SPEECH_RMS = 700  # 16-bit PCM level that counts as the owner talking
OWNER_HANG_FRAMES = 20  # keep sending ~0.6 s after they stop, so words aren't clipped
STEP = 320


def frames(buf: bytes, final: bool = False, size: int = MIN_CHUNK) -> tuple[list[bytes], bytes]:
    """Cut 16 kHz PCM into Exotel-sized chunks. With final=True, pad the tail with silence."""
    out = [buf[i:i + size] for i in range(0, len(buf) - len(buf) % size, size)]
    rest = buf[len(out) * size:]
    if final and rest:
        out.append(rest + b"\x00" * (size - len(rest)))
        rest = b""
    return out, rest


def upsample_2x(pcm: bytes) -> bytes:
    """8 kHz -> 16 kHz PCM16 (linear interpolation)."""
    import array
    a = array.array("h"); a.frombytes(pcm[: len(pcm) & ~1])
    o = array.array("h")
    for i, v in enumerate(a):
        nxt = a[i + 1] if i + 1 < len(a) else v
        o.append(v); o.append((v + nxt) // 2)
    return o.tobytes()


def downsample_2x(pcm: bytes) -> bytes:
    """16 kHz -> 8 kHz PCM16 (average pairs)."""
    import array
    a = array.array("h"); a.frombytes(pcm[: len(pcm) & ~3])
    return array.array("h", [(a[i] + a[i + 1]) // 2 for i in range(0, len(a), 2)]).tobytes()


def _authorised(ws: WebSocket, secret_param: str) -> bool:
    want = get_settings().phone_stream_secret
    if not want:
        return not get_settings().is_prod  # open only in local dev
    auth = ws.headers.get("authorization", "")
    if auth.lower().startswith("basic "):
        try:
            pw = base64.b64decode(auth[6:]).decode().split(":", 1)[1]
            if secrets.compare_digest(pw, want):
                return True
        except (binascii.Error, UnicodeDecodeError, IndexError):
            pass
    return bool(secret_param) and secrets.compare_digest(secret_param, want)


def _resolve_owner(caller: str, owner_param: str) -> int | None:
    """The shared number answers for whoever signed up (or claimed it) most recently;
    PHONE_OWNER only if nobody has finished setup yet."""
    with SessionLocal() as db:
        uid = number_owner(db)
    return uid or _owner_id(owner_param or get_settings().phone_owner)


def _owner_id(phone: str) -> int | None:
    digits = "".join(c for c in phone if c.isdigit())[-10:]
    if len(digits) != 10:
        return None
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.phone.like(f"%{digits}")))


@router.websocket("/api/phone/exotel")
async def exotel(ws: WebSocket):
    q = ws.query_params
    await ws.accept()
    if not _authorised(ws, q.get("secret", "")):
        log.warning("exotel stream rejected: bad secret (auth header %s, PHONE_STREAM_SECRET %s)",
                    "present" if ws.headers.get("authorization") else "missing",
                    "set" if get_settings().phone_stream_secret else "NOT SET")
        await ws.close(code=1008)
        return

    # Wait for "start" (after "connected"); custom params may arrive there too.
    start: dict = {}
    try:
        while not start:
            m = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
            if m.get("event") == "start":
                start = m.get("start") or {}
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        await ws.close(code=1008)
        return
    params = {**dict(q), **(start.get("custom_parameters") or {})}
    log.info("exotel start: params=%s keys=%s format=%s",
             {k: v for k, v in params.items() if k != "secret"}, sorted(start), start.get("media_format"))
    sid = start.get("stream_sid") or start.get("streamSid") or ""
    caller = str(start.get("from", ""))
    rate = int((start.get("media_format") or {}).get("sample_rate") or 8000)
    persona = "screen" if params.get("persona") == "screen" else "rider"
    uid = _resolve_owner(caller, str(params.get("owner") or ""))
    ctx = call_context(uid, persona) if uid else None
    if not ctx or not get_settings().gnani_api_key:
        log.warning("exotel stream: no signed-up user for owner=%r (PHONE_OWNER=%r)",
                    params.get("owner"), get_settings().phone_owner)
        await ws.close(code=1008)
        return
    await bridge(ws, Wire("exotel", sid, rate), uid, persona, ctx, caller)


class Wire:
    """Message shapes and audio format for one provider."""

    def __init__(self, kind: str, sid: str, rate: int):
        self.kind, self.sid, self.rate = kind, sid, rate
        # We hold 16 kHz PCM; chunk so the wire chunk is ~100 ms.
        self.size = MIN_CHUNK * 2 if kind == "exotel" and rate == 8000 else MIN_CHUNK

    def out(self, event: str, **kw) -> str:
        key = "streamSid" if self.kind == "twilio" else "stream_sid"
        return json.dumps({"event": event, key: self.sid, **kw})

    def encode(self, pcm16k: bytes) -> str:
        if self.kind == "twilio":
            return base64.b64encode(audioop.lin2ulaw(downsample_2x(pcm16k), 2)).decode()
        return base64.b64encode(downsample_2x(pcm16k) if self.rate == 8000 else pcm16k).decode()

    def decode(self, payload: str) -> bytes:
        raw = base64.b64decode(payload or "")
        if self.kind == "twilio":
            return upsample_2x(audioop.ulaw2lin(raw, 2))
        return upsample_2x(raw) if self.rate == 8000 else raw


async def bridge(ws: WebSocket, wire: Wire, uid: int, persona: str, ctx, caller: str) -> None:
    owner, profile, protected = ctx
    log.info("%s call %s from %s, persona=%s", wire.kind, wire.sid, caller, persona)

    lock = asyncio.Lock()
    state = {"turn": -1, "buf": b"", "marks": 0}
    size = wire.size
    played = asyncio.Event()

    async def send(event: str, **kw):
        async with lock:
            try:
                await ws.send_text(wire.out(event, **kw))
            except Exception:
                pass

    async def push(chunks: list[bytes]):
        for c in chunks:
            await send("media", media={"payload": wire.encode(c)})

    async def on_event(e: dict):
        kind = e.get("type")
        if kind in ("heard", "reply_start", "reply_text", "interrupted", "shield", "error"):
            hub.publish(uid, e)
        if kind == "reply_start":
            state["turn"], state["buf"] = e["turn"], b""
        elif kind == "speech_start" and state["turn"] != -1:
            # Caller talked over Haanji: drop queued audio on Exotel and cancel the reply.
            # (The phone line's echo cancellation keeps Haanji's own voice out of this track.)
            state["turn"], state["buf"] = -1, b""
            await send("clear")
            await call.interrupt()
        elif kind == "reply_end" and e.get("turn") == state["turn"]:
            chunks, state["buf"] = frames(state["buf"], final=True, size=size)
            await push(chunks)
            state["marks"] += 1
            played.clear()
            await send("mark", mark={"name": f"turn-{e['turn']}"})
        elif kind == "ended":
            call.ended.set()

    async def on_audio(b: bytes):
        if not b or b[0] != state["turn"]:
            return
        hub.publish_audio(uid, 1, b[1:])
        chunks, state["buf"] = frames(state["buf"] + b[1:], size=size)
        await push(chunks)

    # The owner on the call: their voice goes straight to the caller. Only speech is sent
    # (silence would queue behind Haanji's audio), and speaking cuts Haanji off.
    voice = {"buf": b"", "hang": 0}

    async def owner_audio(pcm: bytes):
        loud = audioop.rms(pcm, 2) > OWNER_SPEECH_RMS
        if loud:
            if voice["hang"] == 0 and state["turn"] != -1:
                state["turn"], state["buf"] = -1, b""
                await send("clear")
                await call.interrupt()
            voice["hang"] = OWNER_HANG_FRAMES
            call.owner_spoke()
        elif voice["hang"] == 0:
            return
        else:
            voice["hang"] -= 1
        chunks, voice["buf"] = frames(voice["buf"] + pcm, final=voice["hang"] == 0, size=size)
        await push(chunks)

    call = LiveCall(persona=persona, owner_name=owner, profile=profile, protected=protected,
                    send_json=on_event, send_audio=on_audio)

    async def pump():
        try:
            while not call.ended.is_set():
                m = json.loads(await ws.receive_text())
                ev = m.get("event")
                if ev == "media":
                    pcm = wire.decode((m.get("media") or {}).get("payload") or "")
                    hub.publish_audio(uid, 0, pcm)
                    await call.feed(pcm)
                elif ev == "mark":
                    played.set()
                elif ev == "stop":
                    break
        except (WebSocketDisconnect, RuntimeError, ValueError, KeyError):
            pass
        call.ended.set()

    call.owner_audio = owner_audio
    hub.attach(uid, call)
    hub.publish(uid, {"type": "call_start", "caller": caller, "language": call.home_lang, "manual": call.manual})
    runner = asyncio.create_task(call.run())
    pumper = asyncio.create_task(pump())
    try:
        await asyncio.wait_for(asyncio.shield(runner), timeout=MAX_CALL_SECONDS)
    except asyncio.TimeoutError:
        call.ended.set()
    except Exception:
        log.exception("phone call failed")
        call.ended.set()
    finally:
        hub.detach(uid, call)

    # Let the goodbye finish playing before we drop the line.
    if call.verdict == "scam" and not pumper.done():
        try:
            await asyncio.wait_for(played.wait(), timeout=15)
        except asyncio.TimeoutError:
            pass
    pumper.cancel()
    await asyncio.gather(runner, pumper, return_exceptions=True)

    summary = await call.summary(profile.get("my_language") or "en-IN")
    with SessionLocal() as db:
        db.add(Call(user_id=uid, direction="in", kind=f"phone-{persona}", counterpart=caller or "Unknown number",
                    language=call.caller_lang, verdict="scam" if call.verdict == "scam" else "ok",
                    summary=summary or "", transcript=call.transcript))
        db.commit()
    hub.publish(uid, {"type": "call_end", "summary": summary or "", "verdict": call.verdict})
    try:
        await ws.close()
    except RuntimeError:
        pass


# ---- Twilio Media Streams ----------------------------------------------------------
# Number's "A call comes in" webhook (POST):
#   https://<api-host>/api/phone/twilio/voice?owner=<10-digit>&persona=rider|screen&secret=<PHONE_STREAM_SECRET>


@router.post("/api/phone/twilio/voice")
async def twilio_voice(request: Request):
    q = request.query_params
    want = get_settings().phone_stream_secret
    if want and not secrets.compare_digest(q.get("secret", ""), want):
        return Response("<Response><Reject/></Response>", media_type="application/xml")
    form = await request.form()
    host = request.headers.get("x-forwarded-host") or request.url.netloc
    params = {"owner": q.get("owner", ""), "persona": q.get("persona", "rider"),
              "secret": q.get("secret", ""), "from": str(form.get("From", ""))}
    tags = "".join(f'<Parameter name="{k}" value="{escape(v, quote=True)}"/>' for k, v in params.items())
    xml = (f'<?xml version="1.0" encoding="UTF-8"?><Response><Connect>'
           f'<Stream url="wss://{host}/api/phone/twilio">{tags}</Stream></Connect></Response>')
    return Response(xml, media_type="application/xml")


@router.websocket("/api/phone/twilio")
async def twilio_stream(ws: WebSocket):
    await ws.accept()
    start: dict = {}
    try:
        while not start:
            m = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
            if m.get("event") == "start":
                start = m.get("start") or {}
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        await ws.close(code=1008)
        return
    params = start.get("customParameters") or {}
    want = get_settings().phone_stream_secret
    ok = secrets.compare_digest(str(params.get("secret", "")), want) if want else not get_settings().is_prod
    persona = "screen" if params.get("persona") == "screen" else "rider"
    uid = _resolve_owner(str(params.get("from", "")), str(params.get("owner") or "")) if ok else None
    ctx = call_context(uid, persona) if uid else None
    if not ctx or not get_settings().gnani_api_key:
        log.warning("twilio stream rejected (auth=%s, owner=%r)", ok, params.get("owner"))
        await ws.close(code=1008)
        return
    await bridge(ws, Wire("twilio", start.get("streamSid", ""), 8000), uid, persona, ctx, str(params.get("from", "")))
