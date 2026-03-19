# Sign Language Detection System

## Current State
A browser-based ASL detector with webcam-powered hand gesture recognition (A-Z + Yes/No/Thank You/Hello/I Love You). Has Home, Detector, and Contact pages with dark/light mode. Detection is rule-based using TensorFlow.js handpose landmarks.

## Requested Changes (Diff)

### Add
- **Voice Recognition panel** in the Detector page: mic button to start/stop speech recognition using the Web Speech API (SpeechRecognition). Shows live interim transcript and final results. Allow clearing the transcript. Show a running word-by-word history.
- **Premium Mode**: Unlockable feature set with a demo unlock button. Premium adds:
  - Extra gesture reference entries: numbers 1-10, plus common phrases (Please, Sorry, Help, Good, Bad, More, Stop, Eat, Drink, Me, You, Together)
  - Additional classifier rules for numbers 1-5 and a few new gestures
  - Premium badge in header and detector panel
  - Locked state shows a preview with blur + unlock prompt

### Modify
- Detector layout: add Voice Recognition card below/alongside existing panels
- SIGN_REFERENCE data: extend with premium gestures when unlocked
- classifyASL: add number detection and extra gestures for premium
- NAV_TABS: optionally show Premium badge when unlocked

### Remove
- Nothing removed

## Implementation Plan
1. Add isPremium state with localStorage persistence
2. Add voice recognition state: isListening, transcript (interim + final), history
3. Add SpeechRecognition hook with onresult/onend handlers
4. Add premium gesture data (numbers + phrases) to SIGN_REFERENCE when unlocked
5. Add classifier rules for numbers 1-5 (index only = 1, V = 2, W = 3, 4 fingers = 4, all = 5/B)
6. Add VoicePanel component in detector section
7. Add PremiumPanel / premium unlock button with modal or inline prompt
8. Add Lock/Unlock/Mic/MicOff/Star icons from lucide
