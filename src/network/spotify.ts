import React from "react";
import { currentToken } from "../spotifyTokenHandling";
import { clientId, redirectUrl, tokenEndpoint } from "../const/spotify";
import { Track } from "@spotify/web-api-ts-sdk";
import {Buffer} from 'buffer';


const simplifyQueue = (raw_queue: Track[]) => {
  const queue: any[] = [];

  raw_queue.forEach((item, i) => {
    queue.push({
      "name": item.name,
      "release_year": item.album.release_date.split("-")[0],
      "album": item.album.name,
      "artists": item.artists.map(obj => obj.name).join(", ")
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
        redirect_uri: redirectUrl,
        code_verifier: code_verifier,
      }),
    });
  
    return await response.json();
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
  const audio = new Audio(`data:audio/wav;base64,${b64_wav}`);
  await audio.play();
}

export async function sendRequest(queue: Track[]) {
  console.log(simplifyQueue(queue));
  try {
    const response = await fetch('http://127.0.0.1:8000/get_queue_radio/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(simplifyQueue(queue))
    });
    const body = response.body?.getReader();
    console.log(body);
    if (body !== undefined) {
      await readWAV(body);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}