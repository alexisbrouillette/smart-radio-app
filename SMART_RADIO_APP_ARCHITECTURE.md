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

### 4.1 2-Song Interval Cadence
The AI Host speaks **exactly once every 2 songs**:
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
  1. `WebPlayback.jsx` polls Spotify's `GET /v1/me/player/currently-playing` every 2 seconds.
  2. Calculates remaining track duration: `remainingMs = duration_ms - progress_ms`.
  3. Schedules a local JavaScript timer (`setTimeout`) **300ms before track end**.
  4. When the timer fires:
     - Issues `pausePlayback()` (pauses Song A right at the track boundary).
     - Plays pre-synthesized Kokoro TTS WAV audio / Web Speech API speech out loud (*"That was Song A. Up next, Song B!"*).
     - Once speech completes, issues `skipToNext()` to start Song B with zero audio overlap.
  5. If the user seeks forward/backward in Spotify, the progress jump (>3s) is detected, and the precision timer automatically re-synchronizes.

---

## 5. State Management & React Ref Integrity

### 5.1 React Closures & `useRef`
- Async event listeners and interval loops capture state variables at closure creation time.
- Mutable state references (`radioItemsRef.current`, `radioTextToAudioQueueRef.current`) are maintained alongside React state (`radioItems`, `radioTextToAudioQueue`) to ensure async event callbacks always read up-to-date data.

### 5.2 HTTP 204 No Content Handling
- When Spotify is idle or paused, `/v1/me/player/currently-playing` and `/v1/me/player/queue` return **HTTP 204 No Content** with an empty body.
- Both `getCurrentlyPlaying()` and `getUserQueue()` check `response.status === 204 || response.status === 401` before executing `.json()`, avoiding `SyntaxError: Unexpected end of JSON input`.

---

## 6. Progressive Web App (PWA) Setup
- `public/manifest.json`: Configured with `"display": "standalone"`.
- Service Worker (`public/service-worker.js`): Caches static shell assets.
- Auto-Update Reloader (`src/index.tsx`): Listens for `registration.onupdatefound` and reloads `window.location` automatically when new Vercel builds are deployed.

---

## 7. Key Files Directory
- `src/App.tsx`: Central state coordinator, queue renderer, and radio item manager.
- `src/WebPlayback/WebPlayback.jsx`: Polling engine, precision track-end timer, and remote playback controller.
- `src/network/spotify.ts`: Spotify Web API network requests (`getUserQueue`, `getCurrentlyPlaying`, `pausePlayback`, `skipToNext`, `getToken`, `getTokenFromrefreshToken`, `generate_queue_texts`, `generate_queue_audio`).
- `src/spotifyTokenHandling/index.ts`: PKCE token handling, localStorage persistence, and dynamic `redirect_uri` resolution.
