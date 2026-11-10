export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी' },
  { code: 'en-IN', name: 'English', native: 'English' },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు' },
  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
]

export const langName = (code?: string) => LANGUAGES.find((l) => l.code === code)?.name ?? ''
export const langNative = (code?: string) => LANGUAGES.find((l) => l.code === code)?.native ?? ''

export const CITIES: { name: string; lang: string }[] = [
  { name: 'Bengaluru', lang: 'kn-IN' },
  { name: 'Chennai', lang: 'ta-IN' },
  { name: 'Hyderabad', lang: 'te-IN' },
  { name: 'Pune', lang: 'mr-IN' },
  { name: 'Mumbai', lang: 'mr-IN' },
  { name: 'Kolkata', lang: 'bn-IN' },
  { name: 'Kochi', lang: 'ml-IN' },
  { name: 'Ahmedabad', lang: 'gu-IN' },
  { name: 'Vellore', lang: 'ta-IN' },
  { name: 'Delhi', lang: 'hi-IN' },
  { name: 'Gurugram', lang: 'hi-IN' },
  { name: 'Chandigarh', lang: 'pa-IN' },
]

export const RELATIONS = ['Mummy', 'Papa', 'Dadi', 'Dada', 'Nani', 'Nana', 'Other']

export const VOICES = [
  { id: 'Shivani', label: 'Shivani', hint: 'Warm' },
  { id: 'Avinash', label: 'Avinash', hint: 'Calm' },
]

export const SIGNAL_LABEL: Record<string, string> = {
  credential: 'Asked for an OTP, PIN or app install',
  authority: 'Claimed to be police, CBI, bank or courier',
  threat: 'Threatened arrest, a blocked account or a cut connection',
  payment: 'Asked for money or a transfer',
  secrecy: 'Told them to keep it secret or stay on the call',
  urgency: 'Pushed them to act right now',
  lure: 'Promised a prize, refund or easy money',
}

/** `#` must be encoded inside a tel: link or the dialler drops it. */
export const telLink = (code: string) => `tel:${code.replace(/#/g, '%23')}`
