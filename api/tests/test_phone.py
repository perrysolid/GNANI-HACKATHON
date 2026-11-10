from app.routes.phone import MIN_CHUNK, STEP, downsample_2x, frames, upsample_2x


def test_frames_are_exotel_sized():
    chunks, rest = frames(b"\x01" * 7000)
    assert [len(c) for c in chunks] == [3200, 3200] and len(rest) == 600
    chunks, rest = frames(rest, final=True)
    assert len(chunks) == 1 and len(chunks[0]) == MIN_CHUNK and rest == b""
    assert all(len(c) % STEP == 0 for c in chunks)


def test_resample_lengths():
    pcm8 = b"\x10\x00" * 160
    assert len(upsample_2x(pcm8)) == 640
    assert len(downsample_2x(upsample_2x(pcm8))) == 320


def test_stream_rejects_unknown_owner():
    import pytest
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from app.main import app
    with TestClient(app) as client, pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/phone/exotel?owner=9000000000") as ws:
            ws.send_json({"event": "connected"})
            ws.send_json({"event": "start", "start": {"stream_sid": "s1", "from": "0999", "media_format": {"sample_rate": 16000}}})
            ws.receive_text()
