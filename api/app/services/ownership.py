"""Who the shared phone number answers for: whoever finished setup most recently,
or most recently tapped "Answer this number for me"."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import User


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _since(u: User) -> str:
    created = u.created_at.replace(tzinfo=u.created_at.tzinfo or timezone.utc).isoformat() if u.created_at else ""
    return (u.profile or {}).get("number_since") or created


def number_owner(db: Session) -> int | None:
    users = db.scalars(select(User).where(User.onboarded.is_(True))).all()
    return max(users, key=_since).id if users else None
