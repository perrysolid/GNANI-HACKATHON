from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..auth import current_user
from ..db import User
from ..services import gnani, llm
from ..services.scam_rules import RANK, analyse

router = APIRouter(prefix="/api/shield", tags=["shield"])


async def _second_opinion(text: str) -> dict | None:
    """The reasoning model can raise the verdict, never lower it below the rules."""
    if not llm.available():
        return None
    try:
        out = await llm.chat_json([
            {"role": "system", "content": (
                "You protect elderly Indians from phone fraud (digital arrest, fake KYC, fake "
                "police/CBI/customs, electricity cut, lottery, investment, OTP and screen-share "
                "scams). Given a call transcript, answer JSON only: "
                '{"level": "scam" | "suspicious" | "no_signs", "why": "<one short sentence in English>"}'
            )},
            {"role": "user", "content": text[:3000]},
        ], max_tokens=150)
    except (llm.LlmUnavailable, ValueError):
        return None
    return out if out.get("level") in RANK else None


@router.post("/check")
async def check(
    text: str = Form(""),
    audio: UploadFile | None = File(None),
    user: User = Depends(current_user),
):
    heard_language = ""
    if audio is not None:
        data = await audio.read()
        if len(data) > 2_000_000:
            raise HTTPException(413, "Keep it under 30 seconds")
        try:
            heard = await gnani.transcribe(data, "call.wav")
        except gnani.GnaniError as e:
            raise HTTPException(502, str(e))
        text, heard_language = heard["transcript"], heard["language"]
    text = text.strip()
    if not text:
        raise HTTPException(400, "Say or paste what the caller said")
    if len(text) > 4000:
        raise HTTPException(413, "That's too long. Paste the main part")

    v = analyse(text)
    level, why = v.level, ""
    second = await _second_opinion(text)
    if second and RANK[second["level"]] > RANK[level]:
        level, why = second["level"], str(second.get("why", ""))[:200]

    return {
        "text": text,
        "heard_language": heard_language,
        "level": level,
        "signals": [{"category": f.category, "phrase": f.phrase} for f in v.findings],
        "model_note": why,
    }
