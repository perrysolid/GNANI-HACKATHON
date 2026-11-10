"""'Haanji calls for you': book a table, an appointment, ask if a shop is open."""

from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..config import get_settings
from ..db import Call, User, get_db
from ..services import errands
from ..services.languages import is_language

router = APIRouter(prefix="/api/errands", tags=["errands"])


class ErrandIn(BaseModel):
    to_phone: str = Field(pattern=r"^[0-9]{10}$")
    to_name: str = Field(default="", max_length=60)
    task: str = Field(min_length=5, max_length=800)
    language: str = "en-IN"
    share_number: bool = True

    @field_validator("language")
    @classmethod
    def _lang(cls, v: str) -> str:
        if not is_language(v):
            raise ValueError("Unknown language")
        return v


def _status_url(request: Request) -> str:
    host = request.url.hostname or ""
    if host in ("localhost", "127.0.0.1"):
        return ""  # Exotel can't reach a laptop
    secret = get_settings().phone_stream_secret
    return f"https://{request.url.netloc}/api/errands/exotel-status" + (f"?secret={secret}" if secret else "")


@router.post("")
async def start(body: ErrandIn, request: Request, user: User = Depends(current_user)):
    busy = [e for e in errands._all.values() if e.view()["status"] in ("dialing",)]
    if busy:
        raise HTTPException(409, "Haanji is already placing a call. Try again in a minute.")
    e = errands.new(uid=user.id, to_phone=body.to_phone, to_name=body.to_name.strip(), task=body.task.strip(),
                    language=body.language, share_number=body.share_number, owner_phone=user.phone[-10:])
    try:
        e.call_sid = await errands.dial(body.to_phone, _status_url(request))
    except errands.DialError as err:
        e.status, e.result = "failed", str(err)
        raise HTTPException(502, str(err))
    return e.view()


@router.get("")
def list_errands(user: User = Depends(current_user), db: Session = Depends(get_db)):
    past = db.scalars(select(Call).where(Call.user_id == user.id, Call.kind == "errand")
                      .order_by(Call.created_at.desc()).limit(10)).all()
    return {
        "active": [e.view() for e in errands.active(user.id) if e.status in ("dialing", "on_call")],
        "past": [{"id": c.id, "to": c.counterpart, "result": c.summary, "at": c.created_at.isoformat()} for c in past],
    }


@router.get("/{eid}")
def one(eid: int, user: User = Depends(current_user)):
    e = errands.get(eid)
    if not e or e.uid != user.id:
        raise HTTPException(404, "Not found")
    return e.view()


@router.post("/exotel-status")
async def exotel_status(request: Request):
    """Exotel StatusCallback: the call ended without being answered (busy, no-answer, failed)."""
    s = get_settings()
    if s.phone_stream_secret and request.query_params.get("secret") != s.phone_stream_secret:
        raise HTTPException(403, "Forbidden")
    form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
    e = errands.by_sid(form.get("CallSid", ""))
    status = form.get("Status", "")
    if e and e.status == "dialing" and status in ("busy", "no-answer", "failed", "canceled"):
        e.status = "no_answer" if status in ("busy", "no-answer") else "failed"
    return {"ok": True}
