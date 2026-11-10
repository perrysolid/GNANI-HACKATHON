"""Deterministic scam signals for Indian phone fraud.

Covers English, Hinglish (Latin script) and Hindi/Marathi (Devanagari), the way
Prisma transcribes them. The verdict never says "safe": the best it says is
that no known signs were heard.
"""

import re
from dataclasses import dataclass

# category -> (weight, patterns)
SIGNALS: dict[str, tuple[int, list[str]]] = {
    "credential": (4, [
        r"\botp\b", r"ओटीपी", r"\bpin\b", r"पिन", r"\bcvv\b", r"password", r"पासवर्ड",
        r"code (batao|bataiye|bolo|share)", r"कोड (बताओ|बताइए|बोलो)",
        r"anydesk", r"any desk", r"teamviewer", r"screen ?share", r"स्क्रीन शेयर",
        r"(app|apk) (download|install)", r"(ऐप|एप) (डाउनलोड|इंस्टॉल)",
        r"(link|लिंक) (pe|par|पर) (click|क्लिक)", r"remote (app|access)", r"\bapk\b",
    ]),
    "authority": (2, [
        r"\bcbi\b", r"सीबीआई", r"police", r"पुलिस", r"पोलीस", r"customs?", r"कस्टम",
        r"\bed\b officer", r"enforcement directorate", r"narcotics", r"नारकोटिक्स",
        r"\brbi\b", r"आरबीआई", r"\btrai\b", r"ट्राई", r"income tax", r"इनकम टैक्स",
        r"cyber (cell|crime)", r"साइबर", r"court", r"कोर्ट", r"judge", r"जज",
        r"fedex",
        r"crime branch", r"क्राइम ब्रांच", r"bank (manager|se bol)", r"बैंक (मैनेजर|से बोल)",
        r"telecom (department|ministry)", r"\bdot\b", r"\bdhl\b", r"customer care",
    ]),
    "threat": (2, [
        r"digital arrest", r"डिजिटल अरेस्ट", r"arrest", r"अरेस्ट", r"गिरफ्तार", r"warrant", r"वारंट",
        r"(account|khata|खाता|अकाउंट).{0,20}(block|freeze|band|बंद|ब्लॉक|फ्रीज)",
        r"(sim|सिम).{0,15}(block|band|बंद|ब्लॉक)",
        r"(bijli|light|electricity|बिजली|लाइट).{0,30}(cut|kat|कट|काट)",
        r"drugs?", r"ड्रग्स", r"money laundering", r"मनी लॉन्ड्रिंग", r"illegal", r"अवैध",
        r"\bfir\b", r"एफआईआर", r"case (darj|register)", r"केस",
        r"(kyc|केवाईसी).{0,25}(pending|update|expire|band|block|बंद|अपडेट|ब्लॉक)",
        r"(pan|aadha?ar|आधार|पैन).{0,20}(link|block|misuse|बंद|लिंक|गलत)",
        r"(number|नंबर|mobile|मोबाइल).{0,20}(disconnect|band ho|बंद हो|डिस्कनेक्ट)",
        r"(card|कार्ड).{0,15}(block|बंद|ब्लॉक)", r"video (viral|leak)", r"वीडियो (वायरल|लीक)",
    ]),
    "payment": (2, [
        r"transfer", r"ट्रांसफर", r"\bupi\b", r"यूपीआई", r"paise? (bhejo|bhejiye|daalo)",
        r"पैसे (भेजो|भेजिए|डालो)", r"fine", r"penalty", r"जुर्माना", r"गोल्ड लोन",
        r"verification (fee|charge)", r"security deposit", r"gift card", r"refund",
        r"रिफंड", r"processing fee", r"(safe|secure|rbi) account",
        r"(qr|क्यूआर).{0,20}(scan|स्कैन)", r"collect request", r"galti se (paise|payment)",
        r"गलती से (पैसे|पेमेंट)", r"customs duty", r"(hospital|अस्पताल).{0,20}(fees|bill|बिल|पैसे)",
        r"\bbail\b", r"जमानत", r"\bdeposit\b", r"डिपॉजिट",
    ]),
    "secrecy": (3, [
        r"(kisi|किसी) ?(ko|को) (mat|मत|na|ना) (batana|batao|बताना|बताओ)",
        r"don'?t tell anyone", r"(video|वीडियो) (call|कॉल) (pe|par|पे|पर) (raho|rahiye|रहो|रहिए)",
        r"(call|phone|कॉल|फोन) (mat|मत) (kaatna|kaato|काटना|काटो)",
        r"do not disconnect", r"stay on the (call|line)", r"(ghar|घर) (walon|वालों) (ko|को)",
    ]),
    # "Your son has been arrested / had an accident" calls (often with a cloned voice).
    "relative": (3, [
        r"(aapka|aapke|your|आपका|आपके) (beta|bete|son|daughter|beti|बेटा|बेटे|बेटी).{0,40}(arrest|pakda|accident|police|गिरफ्तार|पकड़ा|एक्सीडेंट|पुलिस)",
        r"(beta|बेटा|beti|बेटी).{0,20}(thane|थाने|lock ?up|लॉकअप)",
    ]),
    "urgency": (1, [
        r"\babhi\b", r"अभी", r"turant", r"तुरंत", r"immediately", r"right now",
        r"(do|2|two) (ghante|घंटे|hours?)", r"aaj raat", r"आज रात", r"last (warning|chance)",
    ]),
    "lure": (2, [
        r"lottery", r"लॉटरी", r"prize", r"इनाम", r"\bkbc\b", r"cashback", r"कैशबैक",
        r"work from home", r"part ?time job", r"(double|दोगुना)", r"stock tips?",
        r"investment (plan|scheme)", r"task (job|based)", r"like (and|&) earn",
        r"reward points?", r"रिवॉर्ड", r"credit limit", r"\bipo\b", r"trading (app|group)",
        r"(youtube|hotel|google).{0,15}(like|review|rating)", r"policy bonus",
        r"(gift|गिफ्ट).{0,25}(customs|कस्टम|foreign|विदेश)",
    ]),
}

# Phrases that are a scam on their own.
DECISIVE = [r"digital arrest", r"डिजिटल अरेस्ट", r"anydesk", r"any desk", r"teamviewer"]

_compiled = {
    cat: (w, [re.compile(p, re.I) for p in pats]) for cat, (w, pats) in SIGNALS.items()
}
_decisive = [re.compile(p, re.I) for p in DECISIVE]


@dataclass
class Finding:
    category: str
    phrase: str


@dataclass
class Verdict:
    level: str  # scam | suspicious | no_signs
    score: int
    findings: list[Finding]


def analyse(text: str) -> Verdict:
    findings: list[Finding] = []
    score = 0
    for cat, (weight, patterns) in _compiled.items():
        for p in patterns:
            m = p.search(text)
            if m:
                findings.append(Finding(cat, m.group(0)))
                score += weight
                break  # one hit per category

    cats = {f.category for f in findings}
    decisive = any(p.search(text) for p in _decisive)
    if (
        decisive
        or score >= 6
        or ("credential" in cats and len(cats) >= 2)
        or ({"authority", "payment"} <= cats)
        or ({"threat", "secrecy"} <= cats)
        or ({"relative", "payment"} <= cats)
        or ({"authority", "threat"} <= cats)
        or ({"lure", "payment"} <= cats)
    ):
        level = "scam"
    elif score >= 2:
        level = "suspicious"
    else:
        level = "no_signs"
    return Verdict(level, score, findings)


RANK = {"no_signs": 0, "suspicious": 1, "scam": 2}
