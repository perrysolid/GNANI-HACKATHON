"""Links a user's live phone call to their open app (captions, typed replies).
In-process: fine for one API instance, which is what we run."""

import asyncio
from collections import defaultdict

_watchers: dict[int, set[asyncio.Queue]] = defaultdict(set)
_calls: dict[int, object] = {}  # user id -> LiveCall in progress
manual: dict[int, bool] = {}  # user id -> typing mode chosen in the app


def watch(uid: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _watchers[uid].add(q)
    return q


def unwatch(uid: int, q: asyncio.Queue) -> None:
    _watchers[uid].discard(q)


def watching(uid: int) -> bool:
    return bool(_watchers.get(uid))


def publish(uid: int, event: dict) -> None:
    for q in list(_watchers.get(uid, ())):
        if not q.full():
            q.put_nowait(event)


def attach(uid: int, call) -> None:
    _calls[uid] = call
    call.manual = manual.get(uid, False) and watching(uid)


def detach(uid: int, call) -> None:
    if _calls.get(uid) is call:
        del _calls[uid]


def active(uid: int):
    return _calls.get(uid)
