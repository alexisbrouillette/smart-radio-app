import React from "react";
import { currentToken } from "../spotifyTokenHandling";
import { clientId, tokenEndpoint } from "../const/spotify";
import { Track } from "@spotify/web-api-ts-sdk";
import {Buffer} from 'buffer';
import { RadioItem } from "../App";


const simplifyQueue = (rawQueue: Track[]) => {
  const queue: any[] = [];
  rawQueue.forEach((item, i) => {
    queue.push({
      "name": item.name,
      "release_year": item.album.release_date.split("-")[0],
      "album": item.album.name,
      "artists": item.artists.map(obj => obj.name).join(", "),
      "id": item.id
    });
  });
  return queue;
}
export async function getUserQueue() {
    const response = await fetch("https://api.spotify.com/v1/me/player/queue", {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
    });
  
    return await response.json();
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
        redirect_uri: process.env.REACT_APP_FRONTEND_URL ?? '',
        code_verifier: code_verifier,
      }),
    });
  
    return await response.json();
}

export const getTokenFromrefreshToken = async () => {

  // refresh token that has been previously stored
  const refreshToken = localStorage.getItem('refresh_token');
  const url = "https://accounts.spotify.com/api/token";

   const payload = {
     method: 'POST',
     headers: {
       'Content-Type': 'application/x-www-form-urlencoded'
     },
     body: new URLSearchParams({
       grant_type: 'refresh_token',
       refresh_token: refreshToken ?? '',
       client_id: clientId
     }),
   }
   const body = await fetch(url, payload);
   const response = await body.json();

   return response;
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

export async function generate_queue_texts(queue: Track[]) {
  try {
    const response = await fetch(`${process.env.REACT_APP_SERVER_ADRESS}/get_radio_text`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(simplifyQueue(queue)),
    });
    //const body = response.body?.getReader();
    const body = await response.json();
    if (body !== undefined) {
      return body;
      //await readWAV(body);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}
export async function generate_queue_audio(text: string): Promise<string | null> {
  //console.log("GENERATING AUDIO")
  try {
    const response = await fetch(`${process.env.REACT_APP_HUGGING_FACE_URL}/get_radio_audio`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(text)
    });
    const body = response.body?.getReader();
    //const body = await response.json();
    if (body !== undefined) {
       return await readWAV(body);
    }
    return null;
    
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

export async function getCurrentlyPlaying() {
  const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
  });

  return await response.json();
}

export async function playOnSDK() {
  console.log("PLAYING ON SDK");
  const response = await fetch("https://api.spotify.com/v1/me/player/devices ", {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
  })

  const body =  await response.json();
  const devices = body.devices;

  if (devices.length > 0) {
    const sdkDevice = devices.find((device: any) => device.name === "Web Playback SDK");
    console.log(sdkDevice);
    if (sdkDevice) {
      const response = await fetch(`https://api.spotify.com/v1/me/player`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
        body: JSON.stringify({ device_ids: [sdkDevice.id] })
      });
    }
  }
}
