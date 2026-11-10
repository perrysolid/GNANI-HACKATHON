# Haanji: product notes

## Users
1. **The mover**: 22–35, moved to Bengaluru/Chennai/Hyderabad for work or study. Speaks Hindi/Bengali/Marathi; callers speak Kannada/Tamil/Telugu.
2. **The worried child**: lives away from parents (60+) who get fraud calls.

## Jobs
- “When a rider calls in Kannada, get him to my gate without me struggling.”
- “Stop scammers from reaching my mother, and tell me if someone tries.”

## Onboarding (one question per screen)
Name → phone → OTP (SMS, or a voice call for people who can’t read SMS easily) → what Haanji should do → your language → city (sets the callers’ language) → address the Indian way (typed or spoken) → hear what callers hear → parent, their language, protections → switch on (call-forwarding code).

## Principles
- Voice first, Indian languages first. No feature needs typing.
- Rules decide safety, the model writes the words. The shield never says “safe”.
- Haanji says it’s an assistant, asks who’s calling before sharing the address, never shares OTPs or money details.

## Metrics
- Rider calls resolved without the user picking up
- Scam calls ended by Haanji; time to alert the family
- Turn latency (caller stops → Haanji speaks), target < 1.5 s

## Next
- Phone bridge: Exotel/Twilio Indian number + busy-forwarding (`**67*<number>#`, Jio `*405*<number>`)
- Evon on a GPU host as the reasoning model
- Daily check-in calls for parents; WhatsApp alerts
