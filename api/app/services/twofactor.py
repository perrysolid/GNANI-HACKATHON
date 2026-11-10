"""2Factor.in OTP over SMS or a voice call.

Without TWOFACTOR_API_KEY (development only) a dev session is issued and the
code is always 123456.
"""

import logging
import secrets
import uuid

import httpx

from ..config import get_settings

log = logging.getLogger("haanji.otp")
_BASE = "https://2factor.in/API/V1"
DEV_CODE = "123456"


class OtpError(Exception):
    pass


def _key() -> str:
    s = get_settings()
    if not s.twofactor_api_key and s.is_prod:
        raise OtpError("OTP service is not configured")
    return s.twofactor_api_key


async def send(phone: str, channel: str) -> str:
    """Returns the 2Factor session id. channel: 'sms' | 'voice'."""
    key = _key()
    if not key:
        return f"dev-{uuid.uuid4().hex}"
    path = "VOICE" if channel == "voice" else "SMS"
    # Our own 6-digit code: AUTOGEN length depends on the account template (often 4).
    otp = f"{secrets.randbelow(900000) + 100000}"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_BASE}/{key}/{path}/{phone}/{otp}")
    data = r.json() if r.content else {}
    if data.get("Status") != "Success":
        log.warning("2factor send failed: %s", data)
        raise OtpError(data.get("Details") or "Could not send the code")
    return data["Details"]


async def verify(session_id: str, code: str, channel: str) -> bool:
    key = _key()
    if session_id.startswith("dev-"):
        return not get_settings().is_prod and code == DEV_CODE
    path = "VOICE" if channel == "voice" else "SMS"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_BASE}/{key}/{path}/VERIFY/{session_id}/{code}")
    data = r.json() if r.content else {}
    return data.get("Status") == "Success" and data.get("Details") == "OTP Matched"
