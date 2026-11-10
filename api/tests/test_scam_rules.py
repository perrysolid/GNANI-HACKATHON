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
