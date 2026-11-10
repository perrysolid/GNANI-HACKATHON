from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import get_settings


def _url(raw: str) -> str:
    # Neon / Render hand out postgres:// URLs; SQLAlchemy wants the psycopg driver.
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    if raw.startswith("postgresql://"):
        raw = "postgresql+psycopg://" + raw[len("postgresql://"):]
    return raw


_settings = get_settings()
engine = create_engine(
    _url(_settings.database_url),
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if _settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    # purposes, my_language, city, local_language, address, voice
    profile: Mapped[dict] = mapped_column(JSON, default=dict)
    onboarded: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Family(Base):
    """A parent or elder this user protects."""

    __tablename__ = "family"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    relation: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(80), default="")
    phone: Mapped[str] = mapped_column(String(10))
    language: Mapped[str] = mapped_column(String(10))
    # screen_unknown, block_scams, translate, checkin, checkin_time
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class OtpSession(Base):
    """Binds a 2Factor session to the phone it was sent to."""

    __tablename__ = "otp_sessions"
    session_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    phone: Mapped[str] = mapped_column(String(10), index=True)
    channel: Mapped[str] = mapped_column(String(8))
    attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Call(Base):
    __tablename__ = "calls"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[int | None] = mapped_column(ForeignKey("family.id", ondelete="SET NULL"))
    direction: Mapped[str] = mapped_column(String(8))  # in | out
    kind: Mapped[str] = mapped_column(String(16))  # rider | errand | screen | checkin
    counterpart: Mapped[str] = mapped_column(String(20), default="")
    language: Mapped[str] = mapped_column(String(10), default="")
    verdict: Mapped[str] = mapped_column(String(12), default="")  # scam | suspicious | ok
    summary: Mapped[str] = mapped_column(String(1000), default="")
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
