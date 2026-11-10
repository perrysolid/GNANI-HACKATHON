import asyncio
import json
import logging

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..config import get_settings
from ..db import Call, Family, SessionLocal, User
from ..services.live import LiveCall

router = APIRouter()
log = logging.getLogger("haanji.live")
MAX_CALL_SECONDS = 300


def _user_from(token: str) -> int | None:
    try:
        return int(jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def call_context(uid: int, persona: str) -> tuple[str, dict, dict | None] | None:
    """Owner name, profile and the protected family member for a call."""
    with SessionLocal() as db:
        user = db.get(User, uid)
        if not user:
            return None
        fam = db.scalars(select(Family).where(Family.user_id == uid)).first()
        protected = {"relation": fam.relation, "name": fam.name, "language": fam.language} if fam else None
        if persona == "screen" and not protected:
            protected = {"relation": "Other", "name": "your parent", "language": "hi-IN"}
        return user.name, dict(user.profile or {}), protected


@router.websocket("/api/live")
async def live(ws: WebSocket):
    """Browser practice call. First message: {"type":"start","token":..,"persona":"rider"|"screen"}.
    Then binary 16 kHz PCM16 mic audio; JSON {"type":"interrupt"} or {"type":"hangup"}.
    Server sends JSON events and binary audio: 1 byte turn id + 16 kHz PCM16."""
    await ws.accept()
    try:
        start = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        await ws.close(code=1008)
        return
    uid = _user_from(str(start.get("token", "")))
    if not uid or not get_settings().gnani_api_key:
        await ws.send_json({"type": "error", "message": "Sign in again to start a call"})
        await ws.close(code=1008)
        return

    persona = "screen" if start.get("persona") == "screen" else "rider"
    ctx = call_context(uid, persona)
    if not ctx:
        await ws.close(code=1008)
        return
    owner, profile, protected = ctx

    lock = asyncio.Lock()

    async def send_json(m: dict):
        async with lock:
            try:
                await ws.send_json(m)
            except Exception:
                pass

    async def send_audio(b: bytes):
        async with lock:
            try:
                await ws.send_bytes(b)
            except Exception:
                pass

    call = LiveCall(persona=persona, owner_name=owner, profile=profile, protected=protected,
                    send_json=send_json, send_audio=send_audio)

    async def pump():
        try:
            while not call.ended.is_set():
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    await call.feed(msg["bytes"])
                elif msg.get("text"):
                    kind = json.loads(msg["text"]).get("type")
                    if kind == "interrupt":
                        await call.interrupt()
                    elif kind == "hangup":
                        break
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        call.ended.set()

    runner = asyncio.create_task(call.run())
    pumper = asyncio.create_task(pump())
    try:
        await asyncio.wait_for(asyncio.shield(runner), timeout=MAX_CALL_SECONDS)
    except asyncio.TimeoutError:
        call.ended.set()
    except Exception as e:
        log.exception("live call failed")
        await send_json({"type": "error", "message": f"Call failed: {e}"})
        call.ended.set()
    pumper.cancel()
    await asyncio.gather(runner, pumper, return_exceptions=True)

    summary = await call.summary(profile.get("my_language") or "en-IN")
    if summary:
        with SessionLocal() as db:
            db.add(Call(user_id=uid, direction="in", kind=f"practice-{persona}", counterpart="Practice call",
                        language=call.caller_lang, verdict="scam" if call.verdict == "scam" else "ok",
                        summary=summary, transcript=call.transcript))
            db.commit()
        await send_json({"type": "summary", "text": summary})
    try:
        await ws.close()
    except RuntimeError:
        pass
