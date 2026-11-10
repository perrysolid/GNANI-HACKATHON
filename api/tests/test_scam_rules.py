from app.services.scam_rules import analyse


def test_digital_arrest_hinglish_is_scam():
    v = analyse("Main CBI se bol raha hoon, aapke naam pe parcel mein drugs mile hain, video call pe raho")
    assert v.level == "scam"


def test_digital_arrest_devanagari_is_scam():
    v = analyse("मैं सीबीआई से बोल रहा हूँ, आपका डिजिटल अरेस्ट होगा, किसी को मत बताना")
    assert v.level == "scam"


def test_otp_plus_bank_is_scam():
    v = analyse("Sir your KYC is pending, account block ho jayega, abhi OTP batao")
    assert v.level == "scam"


def test_electricity_cut_is_at_least_suspicious():
    v = analyse("आज रात बिजली कट जाएगी, तुरंत इस नंबर पर कॉल करें")
    assert v.level in {"suspicious", "scam"}


def test_family_call_has_no_signs():
    v = analyse("Haan beta, khana kha liya, kal mandir jaungi")
    assert v.level == "no_signs"
    assert v.findings == []


def test_rider_call_has_no_signs():
    v = analyse("Madam main Swiggy se, aapka order leke gate pe khada hoon")
    assert v.level == "no_signs"


def test_trending_scams_are_caught():
    cases = [
        "Main TRAI se bol raha hoon, aapka number do ghante mein disconnect ho jayega, 9 dabaiye",
        "Aapka beta police ne pakda hai, abhi bail ke paise UPI karo, kisi ko mat batana",
        "Sir aapke credit card ke reward points expire ho rahe hain, OTP bata dijiye",
        "Mumbai crime branch se, aapke Aadhaar ka misuse hua hai, money laundering case hai",
        "मैडम आपको पैसे भेजने हैं, बस क्यूआर स्कैन करके पिन डालिए",
        "Part time job hai, YouTube like karo aur roz 3000 kamao, pehle 500 deposit",
    ]
    for text in cases:
        assert analyse(text).level == "scam", text


def test_everyday_calls_stay_clean():
    for text in ["Beta kal hospital jaana hai, gaadi le aana", "Bhaiya aapka parcel Amazon se hai, gate pe aa jaiye",
                 "Doctor sahab ki timing kya hai, appointment chahiye"]:
        assert analyse(text).level == "no_signs", text


def test_calls_are_only_screened_when_the_guard_is_on():
    from app.services.live import LiveCall

    async def nothing(_):
        return None
    make = lambda persona, profile: LiveCall(persona=persona, owner_name="P", profile=profile, protected=None,
                                             send_json=nothing, send_audio=nothing)
    assert make("rider", {}).guard is False
    assert make("rider", {"scam_guard": True}).guard is True
    assert make("screen", {}).guard is True  # the scam practice call always screens
