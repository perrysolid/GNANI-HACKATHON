import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .routes import auth, live, me, phone, shield, voice
from .services import llm

logging.basicConfig(level=logging.INFO)

settings = get_settings()


@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="Haanji API", lifespan=lifespan, docs_url=None if settings.is_prod else "/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, me.router, voice.router, shield.router, live.router, phone.router):
    app.include_router(r)


@app.get("/health")
def health():
    return {
        "ok": True,
        "voice": bool(settings.gnani_api_key),
        "otp": bool(settings.twofactor_api_key),
        "reasoning": llm.backend() or None,
    }
