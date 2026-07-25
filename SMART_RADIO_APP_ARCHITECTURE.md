# Smart Radio App - Architecture & Implementation Guide

## 1. Project Overview & Objective
Smart Radio App is a centralized web application (PWA) designed to transform Spotify playback into an authentic, radio-station experience. 
It pairs live Spotify streaming with an AI Radio Host powered by **Gemini 2.5 Flash** (for context-aware text commentary) and **Kokoro TTS** (for natural voice synthesis).

---

## 2. Core Operational Architecture

### 2.1 Pure Spotify Connect Remote Control Mode
- **No Web Playback SDK / DRM Player**: The web application does **NOT** instantiate `window.Spotify.Player` (Web Playback SDK).
- **Reason**: Mobile web browsers (iOS Safari, Android Chrome) revoke background EME/DRM audio streams when tabs blur or screens lock.
- **Pure Remote Engine**: Music streams natively inside the official Spotify App on the user's phone, PC, or speaker. The web application acts purely as a remote control station, issuing commands via Spotify's Web API (`PUT /v1/me/player/pause`, `PUT /v1/me/player/play`, `POST /v1/me/player/next`).

---

## 3. Spotify Authentication & OAuth Rules (PKCE)

### 3.1 Authorization Code Flow with PKCE
- **Endpoint**: `https://accounts.spotify.com/authorize` & `https://accounts.spotify.com/api/token`
- **Dynamic Redirect URI**: Resolved dynamically via `getRedirectUri()` (`window.location.origin + '/'`). Converts `localhost` to `127.0.0.1` to comply with Spotify Developer Security Policies.
- **Refresh Token Rules**:
  - When refreshing an access token via `grant_type=refresh_token`, Spotify's API returns `access_token` and `expires_in`, but **omits `refresh_token`**.
  - `currentToken.save` preserves existing `refresh_token` in `localStorage` if the response omits it, avoiding corruption.
  - If a refresh token is invalid or missing, `localStorage` is cleared and the app redirects to Spotify Authorization cleanly.

---

## 4. Radio Host Cadence & Timing Engine

### 4.1 2-Song Interval Cadence & Mathematical Index Formula
The AI Host speaks **exactly once every 2 songs** at target indices $k \in \{2, 4, 6, 8 \dots\}$:
- **Currently Playing Track** (Now Playing)
- **Song 1** (Music only)
- **Song 2** (Music only)
- 🎙️ **AI Host Transition**: *"That was [Song 2]. Up next, [Song 3]!"* (`beforeTrackId: Song 3.id`)
- **Song 3** (Music only)
- **Song 4** (Music only)
- 🎙️ **AI Host Transition**: *"That was [Song 4]. Up next, [Song 5]!"* (`beforeTrackId: Song 5.id`)

### 4.2 Precision Track End Timer Engine (0ms Latency)
- **Problem**: Polling Spotify's API after a track changes introduces 1–2.5 seconds of lag, causing the next song to play briefly before pausing.
- **Solution**: 
  1. `App.tsx` root engine reads `duration_ms` and `progress_ms` from Spotify's API.
  2. Calculates remaining track duration: `remainingMs = duration_ms - progress_ms`.
  3. Posts target countdown timestamp (`targetTimeMs = Date.now() + (remainingMs - 300)`) to the background **PWA Web Worker**.
  4. When the Web Worker fires `trackEndTrigger`:
     - Issues `pausePlayback()` (pauses Song A right at the 300ms end boundary).
     - Plays pre-synthesized Kokoro TTS WAV audio out loud (*"That was Song A. Up next, Song B!"*).
     - Once speech completes, issues `skipToNext()` to start Song B with zero audio overlap.

---

## 5. Mobile Background Execution & Screen-Off Experiments Log

### 5.1 Experiment 1: Web Playback SDK Browser DRM Stream
- **Approach**: Instantiate `window.Spotify.Player` in the browser tab.
- **Result**: ❌ **FAILED on Mobile**.
- **Cause**: iOS Safari and Android Chrome revoke EME/DRM audio decryption keys when tabs switch or screen locks.

### 5.2 Experiment 2: Tiny Base64 Silent Audio Data URI
- **Approach**: Loop a 44-byte base64 silent WAV data URI (`data:audio/wav;base64,UklGRjIA...`) in an HTML5 `<audio>` element.
- **Result**: ❌ **FAILED on Mobile**.
- **Cause**: iOS WebKit and Android Chrome inspect audio duration (0.0001s). WebKit classifies short silent data URIs as "fake keep-alives" and suspends CPU execution (0 Hz) when screen locks.

### 5.3 Experiment 3: Continuous Web Audio `MediaStreamDestination` Live Stream
- **Approach**: Create an infinite Web Audio oscillator and connect a `MediaStreamDestination` to `audio.srcObject = dst.stream`, bound to `navigator.mediaSession.playbackState = 'playing'`.
- **Result**: 🟡 **PARTIAL / MIXED**.
- **Cause**: Prevents browser tab discarding, but main-thread `setInterval` callbacks still suffer timer coalescing during prolonged screen-off phases on Android PWA.

### 5.4 Experiment 5: Dedicated Web Worker Background Clock for PWA (ACTIVE / NEW)
- **File**: `public/pwaWorker.js` + `App.tsx` Integration.
- **Approach**: Offload countdown timing to a background Web Worker (`WorkerGlobalScope`) running off the main UI thread at 100ms ticks (`pwaWorker.postMessage({ command: 'schedule', targetTimeMs })`).
- **Status**: 🟢 **ACTIVE / TESTING**.
- **Rationale**: Web Workers execute in an isolated global scope separate from DOM rendering and main-thread UI layout throttling. In standalone PWA mode, background Web Worker timers continue ticking when main-thread timers freeze.

---

## 6. Key Files Directory
- `public/pwaWorker.js`: Dedicated background Web Worker timer running off the main UI thread.
- `src/App.tsx`: Central state coordinator, queue renderer, root polling engine, and Web Worker manager.
- `src/WebPlayback/WebPlayback.jsx`: Presentation component for currently playing song cover art and controls.
- `src/network/spotify.ts`: Spotify Web API network requests (`getUserQueue`, `getCurrentlyPlaying`, `pausePlayback`, `skipToNext`, `getToken`, `getTokenFromrefreshToken`, `generate_queue_texts`, `generate_queue_audio`).
- `src/spotifyTokenHandling/index.ts`: PKCE token handling, localStorage persistence, and dynamic `redirect_uri` resolution.
