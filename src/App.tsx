import React, { useEffect, useState } from 'react';
import logo from './logo.svg';
import './App.css';
import { Button, Stack } from '@chakra-ui/react';
import { currentToken, redirectToSpotifyAuthorize } from './spotifyTokenHandling';
import { getToken, getUserQueue, sendRequest } from './network/spotify';
import { SongCard } from './songCard';



import { SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import { clientId, redirectUrl, scope, scopeArr } from './const/spotify';





function App() {
  //const express = require('express');
  const [queue, setQueue] = useState<Track[]>([]);
  const [spotifyApi, setSpotifyApi] = useState<SpotifyApi | null>(null);

  // useEffect(() => {
  //   const code = new URLSearchParams(window.location.search).get('code');
  //   if (code) {

  //     console.log(code);
  //     getToken(code).then((data) => {
  //       currentToken.save({
  //         access_token: data.access_token,
  //         refresh_token: data.refresh_token,
  //         expires_in: data.expires_in
  //       });
  //     });
  //     // Remove code from URL so we can refresh correctly.
  //     const url = new URL(window.location.href);
  //     url.searchParams.delete("code");

  //     const updatedUrl = url.search ? url.href : url.href.replace('?', '');
  //     window.history.replaceState({}, document.title, updatedUrl);
  //   }
  // })
  const playSound = () =>{
    const audioTune = new Audio('./valid1.wav');
    audioTune.play();
  }


  useEffect(()=>{
    console.log("send request queue");
    if(queue.length > 0)
      sendRequest(queue)
  //}, [])
  }, [queue])

  const connectToSpotify = async () => {
    //redirectToSpotifyAuthorize();
    const res = await SpotifyApi.performUserAuthorization(clientId, redirectUrl, scopeArr, "");
    console.log("BItch: ");
    console.log(res);
    currentToken.save({
      access_token: res.accessToken.access_token,
      refresh_token: res.accessToken.refresh_token,
      expires_in: res.accessToken.expires_in
    });

    setSpotifyApi(SpotifyApi.withClientCredentials(clientId, res.accessToken.access_token));

  }

  const getQueue = async () => {
    try {
      const res = await getUserQueue();
      console.log(res);
      //checking if it returned a track or an episode(episode don't have an album)
      if (res === undefined || !('album' in res.queue[0])) return;
      setQueue(res.queue as Track[]);

    }
    catch{
      await connectToSpotify().catch((error) => console.error(error));
      const res = await getUserQueue();
      console.log(res);
      //checking if it returned a track or an episode(episode don't have an album)
      if (res === undefined || !('album' in res.queue[0])) return;
      setQueue(res.queue as Track[]);
    }

  }

  const renderQueue = () => {
    if (queue.length > 0) {
      return queue.map((track)=> <SongCard song={track}/>)
    }
    return null;
  }
  const render = () => {
    
    if (currentToken.access_token == null || currentToken.access_token == "") {
      return (
        <div>
          <Button colorScheme='blue' onClick={()=> connectToSpotify()}>Connect to spotify!</Button>
        </div>
      );
    }
    return (
      <div >
        <Button colorScheme='blue' onClick={() =>getQueue()}>You are connected</Button>
        <Stack direction='column' spacing={4}>
          {renderQueue()}
        </Stack>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        Smart radio
      </header>
      <div className='Content'>
        <Button colorScheme='blue' onClick={() => playSound()}>Play sound!</Button>
        {render()}
      </div>
    </div>
  );
}

export default App;
