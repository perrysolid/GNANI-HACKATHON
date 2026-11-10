"""The ten Indian languages Gnani Prisma + Timbre cover, plus city → local language."""

LANGUAGES: dict[str, dict] = {
    "hi-IN": {"name": "Hindi", "native": "हिन्दी"},
    "en-IN": {"name": "English", "native": "English"},
    "kn-IN": {"name": "Kannada", "native": "ಕನ್ನಡ"},
    "ta-IN": {"name": "Tamil", "native": "தமிழ்"},
    "te-IN": {"name": "Telugu", "native": "తెలుగు"},
    "ml-IN": {"name": "Malayalam", "native": "മലയാളം"},
    "mr-IN": {"name": "Marathi", "native": "मराठी"},
    "bn-IN": {"name": "Bengali", "native": "বাংলা"},
    "gu-IN": {"name": "Gujarati", "native": "ગુજરાતી"},
    "pa-IN": {"name": "Punjabi", "native": "ਪੰਜਾਬੀ"},
}

CITIES: dict[str, str] = {
    "Bengaluru": "kn-IN",
    "Mysuru": "kn-IN",
    "Chennai": "ta-IN",
    "Coimbatore": "ta-IN",
    "Vellore": "ta-IN",
    "Hyderabad": "te-IN",
    "Visakhapatnam": "te-IN",
    "Kochi": "ml-IN",
    "Thiruvananthapuram": "ml-IN",
    "Mumbai": "mr-IN",
    "Pune": "mr-IN",
    "Kolkata": "bn-IN",
    "Ahmedabad": "gu-IN",
    "Surat": "gu-IN",
    "Chandigarh": "pa-IN",
    "Ludhiana": "pa-IN",
    "Delhi": "hi-IN",
    "Noida": "hi-IN",
    "Gurugram": "hi-IN",
    "Jaipur": "hi-IN",
    "Lucknow": "hi-IN",
}

# Timbre v3.0 voices speak all ten languages.
VOICES = ["Shivani", "Avinash", "Riyaa", "Devansh"]


def is_language(code: str) -> bool:
    return code in LANGUAGES
