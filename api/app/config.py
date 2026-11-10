import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    env: str = os.getenv("ENV", "development")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./haanji.db")
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-secret-change-me")
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]

    # Gnani (Prisma STT, Timbre TTS)
    gnani_api_key: str = os.getenv("GNANI_API_KEY", "")
    gnani_base_url: str = os.getenv("GNANI_BASE_URL", "https://api.vachana.ai")

    # 2Factor.in OTP
    twofactor_api_key: str = os.getenv("TWOFACTOR_API_KEY", "")

    # Reasoning model: any OpenAI-compatible endpoint. Evon served by vLLM/SGLang
    # is the primary; leave empty to run with rules only.
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "model")
    # Claude Haiku 5.5, used when no Evon endpoint is set.
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")

    # The number calls are forwarded to (telephony provider number).
    haanji_number: str = os.getenv("HAANJI_NUMBER", "")
    # Shared secret the telephony provider sends (Basic auth password or ?secret=) on the stream socket.
    phone_stream_secret: str = os.getenv("PHONE_STREAM_SECRET", "")
    # Whose Haanji answers when the provider doesn't pass ?owner= (10-digit phone of a signed-up user).
    phone_owner: str = os.getenv("PHONE_OWNER", "")
    # Hackathon demo: sign in with just a phone number (no SMS). Accounts verified by SMS still need the code.
    demo_login: bool = os.getenv("DEMO_LOGIN", "1") == "1"

    @property
    def is_prod(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_prod and s.jwt_secret.startswith("dev-only"):
        raise RuntimeError("JWT_SECRET must be set in production")
    return s
