"""Reasoning model for Haanji.

Two interchangeable backends:
- Evon (Gnani) on vLLM/SGLang via its OpenAI-compatible endpoint, when LLM_BASE_URL is set:
    vllm serve gnani/gnani-evon-v3.3 --served-model-name model --trust-remote-code \
         --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser nano_v3
- Claude Haiku 5.5 (Anthropic SDK, see claude.py), when ANTHROPIC_API_KEY is set.
Evon wins when both are configured.
"""

import json
import re

import httpx

from ..config import get_settings
from . import claude


class LlmUnavailable(Exception):
    pass


def backend() -> str:
    if get_settings().llm_base_url:
        return "evon"
    if claude.available():
        return "claude"
    return ""


def available() -> bool:
    return bool(backend())


async def _evon(messages: list[dict], max_tokens: int, temperature: float) -> str:
    s = get_settings()
    body = {
        "model": s.llm_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": 0.95,
        # Fast replies on calls: Evon's thinking trace off.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    headers = {"Authorization": f"Bearer {s.llm_api_key}"} if s.llm_api_key else {}
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(f"{s.llm_base_url.rstrip('/')}/chat/completions", json=body, headers=headers)
    except httpx.HTTPError as e:
        raise LlmUnavailable("Can't reach the reasoning model") from e
    if r.status_code != 200:
        raise LlmUnavailable(f"Reasoning model error {r.status_code}")
    text = r.json()["choices"][0]["message"].get("content") or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


async def chat(messages: list[dict], max_tokens: int = 1024, temperature: float = 0.4) -> str:
    which = backend()
    if which == "evon":
        return await _evon(messages, max_tokens, temperature)
    if which == "claude":
        try:
            return await claude.chat(messages, max_tokens)
        except claude.ClaudeError as e:
            raise LlmUnavailable(str(e)) from e
    raise LlmUnavailable("No reasoning model connected")


async def chat_json(messages: list[dict], max_tokens: int = 600) -> dict:
    text = await chat(messages, max_tokens=max_tokens, temperature=0.2)
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        raise LlmUnavailable("Reasoning model returned no JSON")
    return json.loads(m.group(0))


async def stream(messages: list[dict], max_tokens: int = 600):
    """Streams the reply. Evon is called whole and yielded once."""
    if backend() == "claude":
        try:
            async for t in claude.stream(messages, max_tokens):
                yield t
        except claude.ClaudeError as e:
            raise LlmUnavailable(str(e)) from e
        return
    yield await chat(messages, max_tokens)
