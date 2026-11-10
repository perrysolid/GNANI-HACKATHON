"""What Haanji is allowed to tell callers, set by the user on the Teach screen.

Shape (every leaf is a short string or bool; unknown keys are dropped):
  places:   work/other {name, address, landmark, note}; now {label, address, at}
  delivery: food/grocery/parcel {leave, call_first, note}
  rides:    {pickup, custom, identify, note}
  status:   {state, back_at, message}
  notes:    {say, never}
"""

from datetime import datetime, timedelta, timezone

# Receptionist questions per line of work. The app renders these; calls answer from them.
PROFESSIONS: dict[str, dict] = {
    "clinic": {"label": "Doctor or clinic", "questions": [
        ("doctor", "Doctor’s name and speciality"), ("timings", "Days and timings"),
        ("fee", "Consultation fee"), ("booking", "How do patients get an appointment?"),
        ("emergency", "What should someone do in an emergency?"), ("other", "Anything patients often ask")]},
    "shop": {"label": "Shop or kirana", "questions": [
        ("sells", "What do you sell?"), ("hours", "Opening hours"), ("delivery", "Home delivery? Which areas?"),
        ("payment", "Payment options"), ("other", "Anything customers often ask")]},
    "tutor": {"label": "Tutor or classes", "questions": [
        ("subjects", "Subjects and classes"), ("batches", "Batch timings"), ("fees", "Fees"),
        ("mode", "At home, at a centre or online?"), ("demo", "Demo class or admission process")]},
    "services": {"label": "Repairs and home services", "questions": [
        ("jobs", "Which jobs do you take?"), ("areas", "Areas you cover"), ("charges", "Visit charge and rates"),
        ("when", "When are you available?"), ("urgent", "Same-day or emergency work?")]},
    "salon": {"label": "Salon or parlour", "questions": [
        ("services", "Services and prices"), ("hours", "Timings"), ("booking", "Appointments or walk-in?")]},
    "food": {"label": "Food, tiffin or restaurant", "questions": [
        ("menu", "What’s on the menu?"), ("hours", "Timings"), ("delivery", "Delivery area and charges"),
        ("order", "How do people order?"), ("payment", "Payment options")]},
    "other": {"label": "Something else", "questions": [
        ("what", "What do you do?"), ("hours", "When are you available?"),
        ("booking", "How should people book or reach you?")]},
}

PLACE = ("name", "address", "landmark", "note")
SCHEMA: dict[str, dict[str, tuple[str, ...]]] = {
    "places": {"work": PLACE, "other": PLACE, "now": ("label", "address", "at")},
    "delivery": {k: ("to", "leave", "call_first", "note") for k in ("food", "grocery", "parcel")},
    "rides": {"_": ("pickup", "custom", "identify", "note")},
    "status": {"_": ("state", "back_at", "message")},
    "notes": {"_": ("say", "never")},
}
MAX_LEN = 300


def _leaf(v):
    if isinstance(v, bool):
        return v
    return str(v or "").strip()[:MAX_LEN]


def clean(raw: dict) -> dict:
    """Keep only known keys, trim strings. Flat groups (rides/status/notes) live at the top level."""
    out: dict = {}
    b = raw.get("business")
    if isinstance(b, dict) and b.get("kind") in PROFESSIONS:
        qids = {q for q, _ in PROFESSIONS[b["kind"]]["questions"]}
        answers = b.get("answers") if isinstance(b.get("answers"), dict) else {}
        out["business"] = {"kind": b["kind"], "name": _leaf(b.get("name")),
                           "answers": {q: _leaf(v) for q, v in answers.items() if q in qids}}
    for group, subs in SCHEMA.items():
        src = raw.get(group) or {}
        if not isinstance(src, dict):
            continue
        if "_" in subs:
            out[group] = {k: _leaf(src.get(k)) for k in subs["_"] if k in src}
        else:
            out[group] = {
                sub: {k: _leaf(src[sub].get(k)) for k in fields if k in src[sub]}
                for sub, fields in subs.items()
                if isinstance(src.get(sub), dict)
            }
    return out


LEAVE = {
    "door": "leave it at the door",
    "guard": "hand it to the security guard at the gate",
    "reception": "leave it at reception",
    "me": "hand it to them personally",
    "neighbour": "leave it with the neighbour",
}
STATE = {
    "available": "available, but busy right now",
    "meeting": "in a meeting",
    "driving": "driving",
    "sleeping": "asleep",
    "travelling": "travelling",
    "busy": "busy",
}


def facts(profile: dict, now: datetime | None = None) -> str:
    """Plain-English facts for the call prompt. Empty sections are left out."""
    k = profile.get("knowledge") or {}
    lines: list[str] = []

    a = profile.get("address") or {}
    home = ", ".join(x for x in (a.get("house"), a.get("area")) if x)
    if home:
        bits = [f"Home: {home}"]
        if a.get("landmark"):
            bits.append(f"landmark: {a['landmark']}")
        if a.get("note"):
            bits.append(a["note"])
        lines.append("; ".join(bits) + ".")

    places = k.get("places") or {}
    for key, label in (("work", "Work"), ("other", "Other place")):
        p = places.get(key) or {}
        if p.get("address"):
            name = f" ({p['name']})" if p.get("name") else ""
            extra = "".join(f"; {p[f]}" for f in ("landmark", "note") if p.get(f))
            lines.append(f"{label}{name}: {p['address']}{extra}.")
    live = profile.get("live") or {}
    if live.get("at"):
        at = datetime.fromisoformat(live["at"])
        hours = ((now or datetime.now(timezone.utc)) - at).total_seconds() / 3600
        if hours <= 12:
            ist = at.astimezone(timezone(timedelta(hours=5, minutes=30))).strftime("%-I:%M %p").lower()
            line = f"CURRENT LOCATION (shared from their phone at {ist}): {live.get('place') or 'unknown street'}."
            if live.get("near"):
                line += " Landmarks around it: " + "; ".join(
                    f"{p['name']} ({p['kind']}) {p['m']} m {p['dir']}" for p in live["near"]) + "."
            lines.append(line)
    n = places.get("now") or {}
    if n.get("address") or n.get("label"):
        when = f" (shared at {n['at']})" if n.get("at") else ""
        lines.append(f"Where they are right now{when}: {', '.join(x for x in (n.get('label'), n.get('address')) if x)}.")

    for key, label in (("food", "Food delivery"), ("grocery", "Grocery delivery"), ("parcel", "Parcels and couriers")):
        d = (k.get("delivery") or {}).get(key) or {}
        bits = []
        if d.get("to") == "now":
            bits.append("deliver to where they are right now (their CURRENT LOCATION), not home")
        if d.get("leave"):
            bits.append(LEAVE.get(d["leave"], d["leave"]))
        if d.get("call_first"):
            bits.append("call before reaching")
        if d.get("note"):
            bits.append(d["note"])
        if bits:
            lines.append(f"{label}: {'; '.join(bits)}.")

    r = k.get("rides") or {}
    pickup = {"home": "home", "work": "work", "now": "where they are right now"}.get(r.get("pickup", ""), "")
    pickup = r.get("custom") if r.get("pickup") == "custom" else pickup
    bits = [f"pick up from {pickup}"] if pickup else []
    bits += [f"how to spot them: {r['identify']}"] if r.get("identify") else []
    bits += [r["note"]] if r.get("note") else []
    if bits:
        lines.append(f"Cab rides: {'; '.join(bits)}.")

    st = k.get("status") or {}
    if st.get("state") or st.get("message"):
        line = f"Right now they are {STATE.get(st.get('state', ''), 'busy')}"
        if st.get("back_at"):
            line += f", free after {st['back_at']}"
        lines.append(line + "." + (f" Message for callers: {st['message']}" if st.get("message") else ""))

    b = k.get("business") or {}
    if b.get("kind") in PROFESSIONS:
        prof = PROFESSIONS[b["kind"]]
        head = f"THEIR WORK: {prof['label']}" + (f", called {b['name']}" if b.get("name") else "") + "."
        qa = [f"{q} {b['answers'][qid]}" for qid, q in prof["questions"] if (b.get("answers") or {}).get(qid)]
        lines.append(head + (" Answers for callers: " + " | ".join(qa) if qa else ""))

    notes = k.get("notes") or {}
    if notes.get("say"):
        lines.append(f"Other things you may tell callers: {notes['say']}")
    if notes.get("never"):
        lines.append(f"Never tell callers: {notes['never']}")
    return "\n".join(lines) or "Nothing has been shared yet."
