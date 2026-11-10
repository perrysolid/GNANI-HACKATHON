import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from ..auth import current_user
from ..db import User
from ..services import gnani, llm
from ..services.languages import LANGUAGES, is_language

router = APIRouter(prefix="/api", tags=["voice"])

MAX_AUDIO = 2_000_000  # ~60 s of 16 kHz mono WAV; Prisma REST takes 30 s per request

# Opening line in the caller's language. Neutral phrasing so it fits any voice.
ADDRESS_INTRO = {
    "hi-IN": "नमस्ते! {name} जी का पता सुनिए।",
    "en-IN": "Hello! Here is {name}'s address.",
    "kn-IN": "ನಮಸ್ಕಾರ! {name} ಅವರ ವಿಳಾಸ ಕೇಳಿ.",
    "ta-IN": "வணக்கம்! {name} அவர்களின் முகவரி இதோ.",
    "te-IN": "నమస్కారం! {name} గారి చిరునామా వినండి.",
    "ml-IN": "നമസ്കാരം! {name} ന്റെ വിലാസം കേൾക്കൂ.",
    "mr-IN": "नमस्कार! {name} यांचा पत्ता ऐका.",
    "bn-IN": "নমস্কার! {name}-এর ঠিকানা শুনুন।",
    "gu-IN": "નમસ્તે! {name}નું સરનામું સાંભળો.",
    "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! {name} ਦਾ ਪਤਾ ਸੁਣੋ।",
}


def _address_text(user: User) -> str:
    a = (user.profile or {}).get("address") or {}
    parts = [a.get("house"), a.get("area")]
    line = ", ".join(p for p in parts if p)
    if a.get("landmark"):
        line += f". Landmark: {a['landmark']}"
    if a.get("note"):
        line += f". {a['note']}"
    return line.strip(". ")


async def _read_audio(audio: UploadFile) -> bytes:
    data = await audio.read()
    if not data:
        raise HTTPException(400, "No audio received")
    if len(data) > MAX_AUDIO:
        raise HTTPException(413, "Keep it under 30 seconds")
    return data


def _gnani_error(e: Exception) -> HTTPException:
    return HTTPException(502, str(e))


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    language: str
    voice: str = "Shivani"


@router.post("/voice/speak")
async def speak(body: SpeakIn, user: User = Depends(current_user)):
    if not is_language(body.language):
        raise HTTPException(400, "Unsupported language")
    try:
        wav = await gnani.speak(body.text, body.language, body.voice)
    except gnani.GnaniError as e:
        raise _gnani_error(e)
    return Response(wav, media_type="audio/wav")


@router.post("/voice/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("indic-auto"),
    user: User = Depends(current_user),
):
    if language != "indic-auto" and not is_language(language):
        raise HTTPException(400, "Unsupported language")
    data = await _read_audio(audio)
    try:
        return await gnani.transcribe(data, "speech.wav", language)
    except gnani.GnaniError as e:
        raise _gnani_error(e)


async def _translate(text: str, target: str) -> str:
    lang = LANGUAGES[target]["name"]
    return await llm.chat([
        {"role": "system", "content": (
            f"Translate what the user sends into natural spoken {lang}, the way a local "
            f"would say it on the phone. Keep names of places, shops and people as they are, "
            f"written in {lang} script. Output only the translation."
        )},
        {"role": "user", "content": text},
    ], max_tokens=1024)


@router.post("/voice/address-preview")
async def address_preview(user: User = Depends(current_user)):
    p = user.profile or {}
    target = p.get("local_language") or "hi-IN"
    address = _address_text(user)
    if not address:
        raise HTTPException(400, "Add your address first")
    name = user.name or "Customer"

    mode = "rules"
    text = f"{ADDRESS_INTRO[target].format(name=name)} {address}"
    if llm.available():
        try:
            text = await _translate(f"Hello! Here is {name}'s address. {address}", target)
            mode = llm.backend()
        except (llm.LlmUnavailable, KeyError, ValueError):
            pass
    try:
        wav = await gnani.speak(text, target, p.get("voice") or "Shivani")
    except gnani.GnaniError as e:
        raise _gnani_error(e)
    return {"text": text, "language": target, "mode": mode,
            "audio": base64.b64encode(wav).decode()}
