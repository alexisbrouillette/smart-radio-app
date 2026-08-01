import { currentToken, getRedirectUri } from "../spotifyTokenHandling";
import { clientId, tokenEndpoint } from "../const/spotify";
import { Track } from "@spotify/web-api-ts-sdk";
import {Buffer} from 'buffer';


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const simplifyQueue = (rawQueue: Track[]) => {
  const queue: any[] = [];
  rawQueue.forEach((item, i) => {
    queue.push({
      "name": item.name,
      "release_year": item.album?.release_date ? item.album.release_date.split("-")[0] : "",
      "album": item.album.name,
      "artists": item.artists.map(obj => obj.name).join(", "),
      "id": item.id
    });
  });
  return queue;
}
export async function getUserQueue() {
  try {
    const token = currentToken.access_token;
    if (!token) {
      console.warn("getUserQueue called with no active Spotify access token");
      return undefined;
    }

    const url = "https://api.spotify.com/v1/me/player/queue";
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.status === 204 || response.status === 401) {
      console.warn(`Spotify Queue API returned HTTP ${response.status}`);
      return undefined;
    }

    if (!response.ok) {
      console.error(`Spotify Queue API error HTTP ${response.status}: ${response.statusText}`);
      return undefined;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`getUserQueue exception: ${error}`);
    return undefined;
  }
}

export async function getCurrentlyPlaying() {
  try {
    const token = currentToken.access_token;
    if (!token) return null;

    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (response.status === 204 || response.status === 401) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (err) {
    return null;
  }
}

export async function getToken(code:any) {
    let code_verifier = localStorage.getItem('code_verifier');
    console.log("CALLING GET TOKEN");
    code_verifier = code_verifier ? code_verifier : '';
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: getRedirectUri(),
        code_verifier: code_verifier,
      }),
    });
  
    return await response.json();
}

export const getTokenFromrefreshToken = async () => {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken || refreshToken === 'undefined' || refreshToken === 'null') {
    console.error('No valid refresh token in storage');
    return null;
  }

  const url = "https://accounts.spotify.com/api/token";
  const payload = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    }),
  };

  try {
    const body = await fetch(url, payload);
    const response = await body.json();

    if (response.error) {
      console.error('Spotify token refresh error:', response);
      return null;
    }

    currentToken.save(response);
    return response;
  } catch (err) {
    console.error('Failed to fetch Spotify token refresh:', err);
    return null;
  }
}

const concatUint8Arrays = (a: Uint8Array, b: Uint8Array) => {
  const res = new Uint8Array(a.length + b.length);
  res.set(a);
  res.set(b, a.length);
  return res;
}

const readWAV = async (stream: ReadableStreamDefaultReader<Uint8Array>) => {
  let read_stream = await stream.read();
  let wav: Uint8Array = new Uint8Array();

  while (read_stream && read_stream.done === false) {
    wav = concatUint8Arrays(wav, read_stream.value);
    read_stream = await stream.read();
  }

  const b64_wav = Buffer.from(wav).toString('base64');
  return b64_wav;
  //const audio = new Audio(`data:audio/wav;base64,${b64_wav}`);
  //await audio.play();
}

export async function generate_queue_texts(queue: Track[], history: any[] = []) {
  const serverAddress = 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run';
  const prev = queue[0];
  const nxt = queue.length > 1 ? queue[1] : queue[0];
  const beforeTrackId = queue.length > 1 ? queue[1].id : queue[0].id;
  
  const fallbackText = prev && nxt 
    ? `C'était ${prev.name} par ${prev.artists.map((a: any) => a.name).join(", ")}. Place maintenant à ${nxt.name} par ${nxt.artists.map((a: any) => a.name).join(", ")} !`
    : "Restez à l'écoute sur Smart Radio !";

  try {
    const simplifyTracks = (rawQueue: Track[]) => {
      return rawQueue.slice(0, 2).map((item) => ({
        name: item.name,
        release_year: item.album?.release_date ? item.album.release_date.split("-")[0] : "",
        album: item.album?.name || "",
        artists: item.artists ? item.artists.map((obj: any) => obj.name).join(", ") : "",
        id: item.id
      }));
    };

    const payload = {
      tracks: simplifyTracks(queue),
      history: history
    };

    console.log("Calling Modal API /get_radio_text for French text generation...", payload);
    const response = await fetch(`${serverAddress}/get_radio_text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.text) {
        console.log("Received French radio text from Modal:", data.text);
        return {
          beforeTrackId: data.beforeTrackId || beforeTrackId,
          afterTrackId: data.afterTrackId || (prev ? prev.id : beforeTrackId),
          text: data.text,
          audio: data.audio
        };
      }
    }
  } catch (error) {
    console.error("Error fetching radio text from Modal API:", error);
  }

  return {
    beforeTrackId: beforeTrackId,
    afterTrackId: prev ? prev.id : beforeTrackId,
    text: fallbackText,
    audio: null
  };
}
export async function generate_queue_audio(text: string): Promise<string | null> {
  const serverAddress = 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run';
  try {
    console.log("Calling Modal API for audio synthesis:", `${serverAddress}/get_radio_audio`);
    const response = await fetch(`${serverAddress}/get_radio_audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(text)
    });
    const body = response.body?.getReader();
    if (body !== undefined) {
       return await readWAV(body);
    }
    return null;
  } catch (error) {
    console.error('Error generating audio:', error);
    return null;
  }
}



export async function playOnSDK(deviceId: string) {
  console.log("PLAYING ON SDK");
  // const response = await fetch("https://api.spotify.com/v1/me/player/devices ", {
  //   method: 'GET',
  //   headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
  // })

  // const body =  await response.json();
  // const devices = body.devices;

  // if (devices.length > 0) {
  //   const sdkDevice = devices.find((device: any) => device.name === "Web Playback SDK");
  //   console.log(sdkDevice);
  //   if (sdkDevice) {
  //     const response = await fetch(`https://api.spotify.com/v1/me/player`, {
  //       method: 'PUT',
  //       headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
  //       body: JSON.stringify({ device_ids: [sdkDevice.id] })
  //     });
  //   }
  // }

  await fetch(`https://api.spotify.com/v1/me/player`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
    body: JSON.stringify({ device_ids: [deviceId] })
  });
}

export async function pausePlayback() {
  try {
    const token = currentToken.access_token;
    if (!token) return;
    await fetch("https://api.spotify.com/v1/me/player/pause", {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  } catch (e) {}
}

export async function resumePlayback() {
  try {
    const token = currentToken.access_token;
    if (!token) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/play", {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.status === 403 || res.status === 404) {
      console.warn("Spotify play: No active device found. Please start playing a song in your Spotify app first.");
    }
  } catch (e) {
    console.error("Error resuming Spotify playback:", e);
  }
}

export async function skipToNext() {
  try {
    const token = currentToken.access_token;
    if (!token) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/next", {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.status === 403 || res.status === 404) {
      console.warn("Spotify skip: No active device found");
    }
  } catch (e) {
    console.error("Error skipping Spotify track:", e);
  }
}

export async function skipToPrevious() {
  try {
    const token = currentToken.access_token;
    if (!token) return;
    const res = await fetch("https://api.spotify.com/v1/me/player/previous", {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.status === 403 || res.status === 404) {
      console.warn("Spotify previous: No active device found");
    }
  } catch (e) {
    console.error("Error skipping to previous Spotify track:", e);
  }
}

