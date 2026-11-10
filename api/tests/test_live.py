from app.services.live import split_sentences


def test_split_sentences_streaming():
    done, rest = split_sentences("ನಮಸ್ಕಾರ. ಶನಿ ದೇವಸ್ಥಾನದ ಎದುರು ಬನ್ನಿ")
    assert done == ["ನಮಸ್ಕಾರ."]
    assert rest.strip() == "ಶನಿ ದೇವಸ್ಥಾನದ ಎದುರು ಬನ್ನಿ"


def test_split_hindi_danda():
    done, rest = split_sentences("सीधे आइए। नीला गेट है। ")
    assert done == ["सीधे आइए।", "नीला गेट है।"]
    assert rest == ""


def test_long_clause_is_flushed():
    done, _ = split_sentences("word " * 60)
    assert done and len(done[0]) <= 140
