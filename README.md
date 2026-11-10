# Haanji

**Every call. Every language.** Haanji picks up your phone when the caller speaks a language you don’t, and keeps scammers away from your parents.

Built for the Gnani AI voice hackathon on **Gnani Prisma** (speech-to-text), **Gnani Timbre** (text-to-speech) and a reasoning model (Gnani **Evon**, or Claude Haiku 5.5 while Evon isn’t hosted).

## The problem
- ~450M Indians live away from their home state. In Bengaluru, Chennai or Hyderabad, the rider, the auto driver, the landlord and the hospital desk speak a language they don’t.
- Phone fraud (“digital arrest”, fake KYC, fake police/customs) targets elderly parents, on calls, in their own language.

## What Haanji does
| | |
|---|---|
| **Rider & driver calls** | You reject the call, Haanji answers in the caller’s language (Prisma auto-detects it), asks which app they’re from, and guides them with your landmarks. You get call notes in your language. |
| **Scam shield for parents** | Haanji answers unknown numbers on your parent’s phone, hears the scam signals (authority + threat + secrecy + OTP/money), ends the call politely and alerts you. |
| **Check a call** | Say or paste what a caller said; get a verdict with the reasons and the 1930 helpline. |
| **Live practice call** | A real-time call in the browser: interrupt Haanji any time and it stops mid-sentence and listens. |

## How the live call works
```
mic (16 kHz PCM, 32 ms frames) ─► Gnani Prisma streaming STT (indic-auto, codemix)
                                     │ speech_start → barge-in: stop playback, cancel reply
                                     │ transcript (+ detected language)
                                     ▼
                         scam rules ─► reasoning model (streamed, sentence by sentence)
                                     ▼
                         Gnani Timbre streaming TTS (one sentence at a time) ─► speaker
```
- Barge-in: Prisma emits `speech_start`; the client checks its own mic level (so Haanji’s echo can’t interrupt itself), stops audio and the server cancels the LLM stream and the TTS socket.
- The scam verdict is deterministic rules (English, Hinglish, Devanagari). The model can raise a verdict, never lower it.
- `api/app/services/live.py` is transport-agnostic: the phone bridge (Twilio/Exotel media streams, 8 kHz μ-law) plugs into the same class.

## Repo
```
api/   FastAPI · Gnani STT/TTS · live call engine · 2Factor OTP · scam rules · tests
web/   React + Vite + Tailwind · framer-motion · react-three-fiber · phone-first UI
```

## Run locally
```bash
# backend
cd api && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # add GNANI_API_KEY, ANTHROPIC_API_KEY; leave TWOFACTOR_API_KEY empty for test OTP 123456
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q tests

# frontend
cd web && npm install && npm run dev   # http://localhost:5173
```

## Deploy
- **Backend → Render**: `render.yaml` (root `api/`). Set `DATABASE_URL` (Neon Postgres), `CORS_ORIGINS` (your Vercel URL), `GNANI_API_KEY`, `TWOFACTOR_API_KEY`, `ANTHROPIC_API_KEY`.
- **Frontend → Vercel**: root directory `web/`, env `VITE_API_URL=https://<render-app>.onrender.com`.

## Serving Evon
Evon v3.3 (30B MoE, ~3.5B active) needs an 80 GB GPU. On a GPU host:
```bash
vllm serve gnani/gnani-evon-v3.3 --served-model-name model --trust-remote-code \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser nano_v3
```
Then set `LLM_BASE_URL=https://<host>/v1` on the backend. Evon takes over from Claude automatically.
