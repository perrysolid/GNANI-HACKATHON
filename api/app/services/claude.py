"""Claude Haiku 5.5 as Haanji's reasoning model (Anthropic SDK)."""

import anthropic

from ..config import get_settings

MODEL = "claude-haiku-5-5"

_client: anthropic.AsyncAnthropic | None = None


class ClaudeError(Exception):
    pass


def available() -> bool:
    return bool(get_settings().anthropic_api_key)


def _get() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=get_settings().anthropic_api_key, timeout=30, max_retries=1)
    return _client


async def chat(messages: list[dict], max_tokens: int) -> str:
    """messages may start with {'role': 'system'}; it becomes the system prompt."""
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    turns = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
    try:
        r = await _get().messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=turns,
            # Phone replies need speed, not deliberation.
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
        )
    except anthropic.RateLimitError as e:
        raise ClaudeError("Reasoning model is busy, try again") from e
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"Reasoning model error {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError("Can't reach the reasoning model") from e
    if r.stop_reason == "refusal":
        raise ClaudeError("Reasoning model declined")
    return "".join(b.text for b in r.content if b.type == "text").strip()


async def stream(messages: list[dict], max_tokens: int):
    """Yields text as Claude writes it, so speech can start on the first sentence."""
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    turns = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
    try:
        async with _get().messages.stream(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=turns,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
        ) as s:
            async for text in s.text_stream:
                yield text
            final = await s.get_final_message()
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"Reasoning model error {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError("Can't reach the reasoning model") from e
    if final.stop_reason == "refusal":
        raise ClaudeError("Reasoning model declined")
