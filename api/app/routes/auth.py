from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import issue_token
from ..config import get_settings
from ..db import OtpSession, User, get_db, now
from ..services import twofactor

router = APIRouter(prefix="/api/auth", tags=["auth"])

PHONE = r"^[6-9]\d{9}$"
OTP_TTL = timedelta(minutes=10)


class SendIn(BaseModel):
    phone: str = Field(pattern=PHONE)
    channel: str = Field(default="sms", pattern="^(sms|voice)$")


class VerifyIn(BaseModel):
    session_id: str = Field(min_length=4, max_length=80)
    code: str = Field(pattern=r"^\d{4,6}$")
    name: str = Field(default="", max_length=80)


def _aware(dt):
    # SQLite drops tzinfo; treat stored times as UTC.
    return dt if dt.tzinfo else dt.replace(tzinfo=now().tzinfo)


@router.post("/send")
async def send_code(body: SendIn, db: Session = Depends(get_db)):
    recent = db.scalars(
        select(OtpSession).where(OtpSession.phone == body.phone).order_by(OtpSession.created_at.desc())
    ).first()
    if recent and now() - _aware(recent.created_at) < timedelta(seconds=30):
        raise HTTPException(429, "Wait a few seconds before asking for another code")
    hour = db.scalar(
        select(func.count()).select_from(OtpSession).where(
            OtpSession.phone == body.phone, OtpSession.created_at > now() - timedelta(hours=1)
        )
    )
    if hour and hour >= 5:
        raise HTTPException(429, "Too many codes. Try again in an hour")

    try:
        session_id = await twofactor.send(body.phone, body.channel)
    except twofactor.OtpError as e:
        raise HTTPException(502, str(e))
    db.add(OtpSession(session_id=session_id, phone=body.phone, channel=body.channel))
    db.commit()
    return {
        "session_id": session_id,
        "dev_code": twofactor.DEV_CODE if session_id.startswith("dev-") else None,
    }


@router.post("/verify")
async def verify_code(body: VerifyIn, db: Session = Depends(get_db)):
    otp = db.get(OtpSession, body.session_id)
    if not otp or now() - _aware(otp.created_at) > OTP_TTL:
        raise HTTPException(400, "This code has expired. Ask for a new one")
    if otp.attempts >= 5:
        raise HTTPException(429, "Too many wrong tries. Ask for a new code")
    otp.attempts += 1
    db.commit()

    try:
        ok = await twofactor.verify(body.session_id, body.code, otp.channel)
    except twofactor.OtpError as e:
        raise HTTPException(502, str(e))
    if not ok:
        raise HTTPException(400, "That code didn't match")

    phone = otp.phone
    db.delete(otp)
    user = _sign_in(db, phone, body.name)
    user.profile = {**(user.profile or {}), "verified": True}
    db.commit()
    return {"token": issue_token(user.id), "onboarded": user.onboarded, "name": user.name}


def _sign_in(db: Session, phone: str, name: str) -> User:
    user = db.scalar(select(User).where(User.phone == phone))
    if not user:
        user = User(phone=phone, name=name.strip(), profile={})
        db.add(user)
    elif name.strip() and not user.name:
        user.name = name.strip()
    return user


class DemoIn(BaseModel):
    phone: str = Field(pattern=PHONE)
    name: str = Field(default="", max_length=80)


@router.post("/demo")
def demo_sign_in(body: DemoIn, db: Session = Depends(get_db)):
    """Demo: continue with just a phone number. The number is still the account (and the
    caller ID Haanji recognises). Numbers that were verified by SMS can't be entered this way."""
    if not get_settings().demo_login:
        raise HTTPException(403, "Demo sign-in is off. Use the code we text you")
    existing = db.scalar(select(User).where(User.phone == body.phone))
    if existing and (existing.profile or {}).get("verified"):
        raise HTTPException(403, "This number was verified by SMS. Sign in with the code")
    user = _sign_in(db, body.phone, body.name)
    db.commit()
    return {"token": issue_token(user.id), "onboarded": user.onboarded, "name": user.name}


@router.get("/config")
def public_config():
    s = get_settings()
    return {"haanji_number": s.haanji_number, "otp_dev_mode": not s.twofactor_api_key, "demo_login": s.demo_login}
