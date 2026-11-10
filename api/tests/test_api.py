from fastapi.testclient import TestClient

from app.main import app


def _login(c: TestClient, phone="9876543210", name="Parth") -> str:
    r = c.post("/api/auth/send", json={"phone": phone})
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    assert r.json()["dev_code"] == "1234"
    r = c.post("/api/auth/verify", json={"session_id": sid, "code": "1234", "name": name})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_otp_flow_and_profile():
    with TestClient(app) as c:
        token = _login(c)
        h = {"Authorization": f"Bearer {token}"}
        r = c.patch("/api/me", headers=h, json={
            "purposes": ["away", "family"], "my_language": "hi-IN", "city": "Bengaluru",
            "local_language": "kn-IN", "address": {"house": "Flat 302", "landmark": "Shani mandir"},
        })
        assert r.status_code == 200
        assert r.json()["profile"]["local_language"] == "kn-IN"
        r = c.post("/api/family", headers=h, json={"relation": "Mummy", "phone": "9123456789", "language": "mr-IN"})
        assert r.status_code == 200
        assert c.get("/api/me", headers=h).json()["family"][0]["block_scams"] is True


def test_wrong_code_and_resend_cooldown():
    with TestClient(app) as c:
        sid = c.post("/api/auth/send", json={"phone": "9000000001"}).json()["session_id"]
        assert c.post("/api/auth/verify", json={"session_id": sid, "code": "000000"}).status_code == 400
        assert c.post("/api/auth/send", json={"phone": "9000000001"}).status_code == 429


def test_rejects_bad_input_and_no_token():
    with TestClient(app) as c:
        assert c.post("/api/auth/send", json={"phone": "12345"}).status_code == 422
        assert c.get("/api/me").status_code == 401
        token = _login(c, phone="9000000002")
        h = {"Authorization": f"Bearer {token}"}
        assert c.patch("/api/me", headers=h, json={"my_language": "fr-FR"}).status_code == 422


def test_shield_text_check():
    with TestClient(app) as c:
        token = _login(c, phone="9000000003")
        r = c.post("/api/shield/check", headers={"Authorization": f"Bearer {token}"},
                   data={"text": "Main CBI se, aapka digital arrest hoga, video call pe raho"})
        assert r.status_code == 200
        assert r.json()["level"] == "scam"


def test_knowledge_is_cleaned_and_used_in_facts():
    from app.services.knowledge import clean, facts
    k = clean({
        "places": {"work": {"name": "Office", "address": "Embassy Tech Village, gate 3", "evil": "x"}},
        "delivery": {"food": {"leave": "guard", "call_first": True}},
        "status": {"state": "meeting", "back_at": "6 pm"},
        "junk": {"a": 1},
    })
    assert "junk" not in k and "evil" not in k["places"]["work"]
    text = facts({"address": {"house": "Flat 302", "area": "HSR Layout"}, "knowledge": k})
    assert "Flat 302" in text and "gate 3" in text and "security guard" in text and "meeting" in text and "6 pm" in text
    with TestClient(app) as c:
        h = {"Authorization": f"Bearer {_login(c, phone='9876500001')}"}
        r = c.patch("/api/me", headers=h, json={"knowledge": {"notes": {"say": "Parcel can wait"}}})
        assert r.status_code == 200 and r.json()["profile"]["knowledge"]["notes"]["say"] == "Parcel can wait"


def test_live_location_feeds_call_facts(monkeypatch):
    import app.services.places as places
    from app.services.knowledge import facts

    async def fake(lat, lng):
        return {"place": "24th Main Road, HSR Layout", "near": [{"name": "Gayatri Temple", "kind": "place of worship", "m": 30, "dir": "east"}]}
    monkeypatch.setattr(places, "describe", fake)
    with TestClient(app) as c:
        h = {"Authorization": f"Bearer {_login(c, phone='9876500003')}"}
        r = c.post("/api/me/location", headers=h, json={"lat": 12.9116, "lng": 77.6474, "accuracy": 12})
        assert r.status_code == 200 and r.json()["near"][0]["name"] == "Gayatri Temple"
        profile = c.get("/api/me", headers=h).json()["profile"]
        text = facts(profile)
        assert "CURRENT LOCATION" in text and "Gayatri Temple" in text and "30 m east" in text
        assert c.delete("/api/me/location", headers=h).status_code == 200
        assert "CURRENT LOCATION" not in facts(c.get("/api/me", headers=h).json()["profile"])


def test_profession_answers_reach_the_call():
    from app.services.knowledge import clean, facts
    k = clean({"business": {"kind": "clinic", "name": "Sharma Clinic",
                            "answers": {"timings": "Mon to Sat, 10 to 1 and 5 to 8", "fee": "500 rupees", "hack": "x"}}})
    assert "hack" not in k["business"]["answers"]
    text = facts({"knowledge": k})
    assert "Sharma Clinic" in text and "Days and timings Mon to Sat" in text and "500 rupees" in text
    with TestClient(app) as c:
        profs = c.get("/api/catalog").json()["professions"]
        assert any(p["id"] == "clinic" and p["questions"] for p in profs)


def test_demo_sign_in_uses_the_number_but_not_for_sms_verified_accounts():
    with TestClient(app) as c:
        r = c.post("/api/auth/demo", json={"phone": "9876500011", "name": "Judge"})
        assert r.status_code == 200 and r.json()["name"] == "Judge"
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        assert c.get("/api/me", headers=h).json()["phone"] == "9876500011"
        _login(c, phone="9876500012")  # verified by SMS code
        assert c.post("/api/auth/demo", json={"phone": "9876500012"}).status_code == 403


def test_scam_guard_is_on_only_for_family_setups():
    with TestClient(app) as c:
        for phone, purposes, want in (("9876500021", ["family"], True), ("9876500022", ["general"], False)):
            h = {"Authorization": f"Bearer {c.post('/api/auth/demo', json={'phone': phone}).json()['token']}"}
            me = c.patch("/api/me", headers=h, json={"purposes": purposes, "onboarded": True}).json()
            assert me["profile"]["scam_guard"] is want
            assert c.patch("/api/me", headers=h, json={"scam_guard": not want}).json()["profile"]["scam_guard"] is (not want)
