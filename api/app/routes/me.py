from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import Call, Family, User, get_db
from ..services.languages import CITIES, LANGUAGES, VOICES, is_language
from ..services.ownership import number_owner, stamp

router = APIRouter(prefix="/api", tags=["me"])


class Address(BaseModel):
    house: str = Field(default="", max_length=120)
    area: str = Field(default="", max_length=160)
    landmark: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=200)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    purposes: list[str] | None = None
    my_language: str | None = None
    city: str | None = Field(default=None, max_length=60)
    local_language: str | None = None
    address: Address | None = None
    voice: str | None = None
    knowledge: dict | None = None  # what Haanji may tell callers; see services/knowledge.py
    onboarded: bool | None = None

    @field_validator("knowledge")
    @classmethod
    def _knowledge(cls, v):
        if v is None:
            return v
        from ..services.knowledge import clean
        return clean(v)

    @field_validator("purposes")
    @classmethod
    def _purposes(cls, v):
        if v is not None and not set(v) <= {"general", "away", "family"}:
            raise ValueError("unknown purpose")
        return v

    @field_validator("my_language", "local_language")
    @classmethod
    def _lang(cls, v):
        if v is not None and not is_language(v):
            raise ValueError("unsupported language")
        return v

    @field_validator("voice")
    @classmethod
    def _voice(cls, v):
        if v is not None and v not in VOICES:
            raise ValueError("unknown voice")
        return v


class FamilyIn(BaseModel):
    relation: str = Field(min_length=1, max_length=30)
    name: str = Field(default="", max_length=80)
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    language: str
    screen_unknown: bool = True
    block_scams: bool = True
    translate: bool = True
    checkin: bool = False
    checkin_time: str = Field(default="09:00", pattern=r"^\d{2}:\d{2}$")

    @field_validator("language")
    @classmethod
    def _lang(cls, v):
        if not is_language(v):
            raise ValueError("unsupported language")
        return v


def _family_out(f: Family) -> dict:
    return {"id": f.id, "relation": f.relation, "name": f.name, "phone": f.phone,
            "language": f.language, **f.settings}


def _me(user: User, db: Session) -> dict:
    fam = db.scalars(select(Family).where(Family.user_id == user.id)).all()
    return {
        "id": user.id,
        "name": user.name,
        "phone": user.phone,
        "onboarded": user.onboarded,
        "owns_number": user.onboarded and number_owner(db) == user.id,
        "profile": user.profile or {},
        "family": [_family_out(f) for f in fam],
    }


@router.get("/catalog")
def catalog():
    from ..services.knowledge import PROFESSIONS
    return {"languages": LANGUAGES, "cities": CITIES, "voices": VOICES,
            "professions": [{"id": k, "label": v["label"], "questions": [{"id": q, "text": t} for q, t in v["questions"]]}
                            for k, v in PROFESSIONS.items()]}


@router.get("/me")
def get_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _me(user, db)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_none=True)
    if "name" in data:
        user.name = data.pop("name").strip()
    just_finished = data.get("onboarded") is True and not user.onboarded
    if "onboarded" in data:
        user.onboarded = data.pop("onboarded")
    if just_finished:
        data["number_since"] = stamp()  # newest sign-up takes over the shared number
    user.profile = {**(user.profile or {}), **data}  # new dict so SQLAlchemy sees the change
    db.commit()
    return _me(user, db)


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = Field(default=0, ge=0, le=100_000)


@router.post("/me/location")
async def share_location(body: LocationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Live location from the phone. Landmarks are looked up again only after moving ~40 m."""
    from datetime import datetime, timezone
    from ..services.places import describe, distance_m
    live = dict((user.profile or {}).get("live") or {})
    moved = "lat" not in live or distance_m(live["lat"], live["lng"], body.lat, body.lng) > 40
    if moved or not live.get("place"):
        live.update(await describe(body.lat, body.lng))
    live.update(lat=body.lat, lng=body.lng, acc=round(body.accuracy), at=datetime.now(timezone.utc).isoformat())
    user.profile = {**(user.profile or {}), "live": live}
    db.commit()
    return {"place": live.get("place", ""), "near": live.get("near", []), "at": live["at"]}


@router.delete("/me/location")
def stop_location(user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.profile = {k: v for k, v in (user.profile or {}).items() if k != "live"}
    db.commit()
    return {"ok": True}


@router.post("/me/number")
def claim_number(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Make the shared Haanji number answer for this user."""
    if not user.onboarded:
        raise HTTPException(400, "Finish setup first")
    user.profile = {**(user.profile or {}), "number_since": stamp()}
    db.commit()
    return _me(user, db)


@router.post("/family")
def add_family(body: FamilyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.scalar(select(Family).where(Family.user_id == user.id, Family.phone == body.phone)):
        raise HTTPException(409, "This number is already protected")
    s = body.model_dump()
    f = Family(user_id=user.id, relation=s.pop("relation"), name=s.pop("name"),
               phone=s.pop("phone"), language=s.pop("language"), settings=s)
    db.add(f)
    db.commit()
    return _family_out(f)


@router.patch("/family/{fid}")
def update_family(fid: int, body: FamilyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.get(Family, fid)
    if not f or f.user_id != user.id:
        raise HTTPException(404, "Not found")
    s = body.model_dump()
    f.relation, f.name, f.phone, f.language = s.pop("relation"), s.pop("name"), s.pop("phone"), s.pop("language")
    f.settings = s
    db.commit()
    return _family_out(f)


@router.delete("/family/{fid}")
def delete_family(fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.get(Family, fid)
    if not f or f.user_id != user.id:
        raise HTTPException(404, "Not found")
    db.delete(f)
    db.commit()
    return {"ok": True}


@router.get("/calls")
def list_calls(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Call).where(Call.user_id == user.id).order_by(Call.created_at.desc()).limit(50)
    ).all()
    return [
        {"id": c.id, "direction": c.direction, "kind": c.kind, "counterpart": c.counterpart,
         "language": c.language, "verdict": c.verdict, "summary": c.summary,
         "family_id": c.family_id, "created_at": c.created_at.isoformat()}
        for c in rows
    ]
