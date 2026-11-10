"""Calls Haanji makes for you ("book a table for four at 8"). Kept in memory while they run;
the finished call is saved as a Call row (kind "errand")."""

import itertools
import time
from dataclasses import dataclass, field

import httpx

from ..config import get_settings

DIAL_TIMEOUT_S = 75  # no stream by then: nobody picked up
_ids = itertools.count(1)
_all: dict[int, "Errand"] = {}


@dataclass
class Errand:
    id: int
    uid: int
    to_phone: str
    to_name: str
    task: str
    language: str
    share_number: bool
    owner_phone: str
    status: str = "dialing"  # dialing | on_call | done | failed | no_answer
    result: str = ""
    transcript: list = field(default_factory=list)
    created: float = field(default_factory=time.monotonic)
    call_sid: str = ""

    def view(self) -> dict:
        if self.status == "dialing" and time.monotonic() - self.created > DIAL_TIMEOUT_S:
            self.status = "no_answer"
        return {"id": self.id, "to_phone": self.to_phone, "to_name": self.to_name, "task": self.task,
                "status": self.status, "result": self.result, "transcript": self.transcript[-30:]}


def new(**kw) -> Errand:
    e = Errand(id=next(_ids), **kw)
    _all[e.id] = e
    return e


def get(eid: int) -> Errand | None:
    return _all.get(eid)


def active(uid: int) -> list[Errand]:
    return [e for e in _all.values() if e.uid == uid and time.monotonic() - e.created < 3600]


def claim(*numbers: str) -> Errand | None:
    """The outgoing call that just connected: matched by the number dialled, else the only one dialling."""
    dialing = [e for e in _all.values() if e.status == "dialing" and time.monotonic() - e.created < DIAL_TIMEOUT_S]
    tails = {"".join(c for c in n if c.isdigit())[-10:] for n in numbers if n}
    hit = next((e for e in dialing if e.to_phone in tails), None) or (dialing[0] if len(dialing) == 1 else None)
    if hit:
        hit.status = "on_call"
    return hit


def by_sid(sid: str) -> Errand | None:
    return next((e for e in _all.values() if e.call_sid == sid), None)


class DialError(Exception):
    pass


async def dial(to_phone: str, status_url: str = "") -> str:
    """Exotel: ring `to_phone`; when they answer, the call runs the Haanji flow (voicebot stream)."""
    s = get_settings()
    if not (s.exotel_api_key and s.exotel_api_token and s.exotel_sid and s.haanji_number and s.exotel_flow_id):
        raise DialError("Outgoing calls aren’t set up on this server")
    data = {
        "From": "0" + to_phone, "CallerId": s.haanji_number, "CallType": "trans",
        "Url": f"http://my.exotel.com/{s.exotel_sid}/exoml/start_voice/{s.exotel_flow_id}",
        "TimeLimit": "600", "TimeOut": "40",
    }
    if status_url:
        data["StatusCallback"] = status_url
    url = f"https://{s.exotel_subdomain}/v1/Accounts/{s.exotel_sid}/Calls/connect.json"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(url, data=data, auth=(s.exotel_api_key, s.exotel_api_token))
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 300:
        msg = (body.get("RestException") or {}).get("Message") or r.text[:200]
        raise DialError(f"Couldn’t place the call: {msg}")
    return (body.get("Call") or {}).get("Sid", "")
