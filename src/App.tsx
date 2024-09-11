import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Alert, AlertDescription, AlertIcon, AlertTitle, Button, Card, CardBody, CircularProgress, Heading, Skeleton, Stack, Text } from '@chakra-ui/react';
import { currentToken, redirectToSpotifyAuthorize } from './spotifyTokenHandling';
import { getToken, getUserQueue, playOnSDK, generate_queue_texts, generate_queue_audio, getTokenFromrefreshToken } from './network/spotify';
import { SongCard } from './songCard';

import { SpotifyApi, Track } from "@spotify/web-api-ts-sdk";
import WebPlayback from './WebPlayback/WebPlayback';
import { RadioItemCard } from './radioItemCard';


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export interface RadioItem {
  text: string;
  beforeTrackId: string;
  audio: string | null;
}

function App() {
  //const express = require('express');
  const [queue, setQueue] = useState<Track []>([]);

  const [fetchedNewRadioItems, setFetchedNewRadioItems] = useState<boolean>(false);
  const trackChanged = useRef(false);
  const [fetchingRadioFor, setFetchingRadioFor] = useState<Track[]>([]);
  const [gotToken, setGotToken] = useState<boolean>(false);

  //this is not sexy but i need to acces it in the useEffect fo fetch the audio and the state is not up to date so i used ref too.. but i need
  // the rerenders of the state sooo.. yeah
  const [radioItems, setRadioItems] = useState<RadioItem[]>([]);
  const radioItemsRef = useRef<RadioItem[]>([]);
  const [radioTextToAudioQueue, setRadioTextToAudioQueue] = useState<{text: string, beforeTrackId: string}[]>([]);

  const radioTextToAudioQueueRef = useRef<{text: string, beforeTrackId: string}[]>([]);
  const [generatingAudio, setGeneratingAudio] = useState<boolean>(false);
  const [debugText, setDebugText] = useState<string>("");

  const playSound = async (b64Audio: string) => {
    //const audioTune = new Audio('./valid1.wav');
    const audioTune = new Audio(`data:audio/wav;base64,${b64Audio}`);
    await audioTune.play();
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(null);
        console.log("played valid1")
      }, audioTune.duration * 1000);
    });
  }
  useEffect(() => {
    console.log("COMPONENT DID MOUNT");
    const t = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      let code = urlParams.get('code');
      if (code) {
        const token = await getToken(code);
        currentToken.save(token);
        setGotToken(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("code");

        const updatedUrl = url.search ? url.href : url.href.replace('?', '');
        window.history.replaceState({}, document.title, updatedUrl);
      }
      //else refresh the token
      else {
        const res = await getTokenFromrefreshToken();
        currentToken.save(res);
        setGotToken(true);
      }

    }

    t();

  }, []);

  useEffect(() => {
    const getRadioTexts = async (tracks: Track[]) => {
      const radioText = await generate_queue_texts(tracks);
      //const radioText = {text: tracks.map(t => t.name).join(", "), beforeTrackId: tracks[tracks.length-1].id, audio: null};
      //await sleep(2000);
      const newRadioItems = [...radioItemsRef.current];
      newRadioItems.push(radioText);
      const newTextToAudioQueue = [...radioTextToAudioQueue, {text: radioText.text, beforeTrackId: radioText.beforeTrackId}]
      setRadioTextToAudioQueue(newTextToAudioQueue);
      radioTextToAudioQueueRef.current = newTextToAudioQueue;
      radioItemsRef.current = newRadioItems;
      setRadioItems(newRadioItems);
      setFetchedNewRadioItems(true);
    }
    if (fetchingRadioFor.length > 0) {
      getRadioTexts(fetchingRadioFor);
    }
  }, [fetchingRadioFor]);

  useEffect(() => {
    const getAudio = async (radioText: {text: string, beforeTrackId: string}) => {
      const audio = await generate_queue_audio(radioText.text);
      const newRadioItems = [...radioItemsRef.current];
      const radioItemToUpdateIndex = newRadioItems.findIndex((radioItem) => radioItem.beforeTrackId == radioText.beforeTrackId);
      newRadioItems[radioItemToUpdateIndex] = {...newRadioItems[radioItemToUpdateIndex], audio: audio}; //replace for audio
      setRadioItems(newRadioItems);
      radioItemsRef.current = newRadioItems;
      const newTextToAudioQueue = radioTextToAudioQueueRef.current.slice(1);
      setRadioTextToAudioQueue(newTextToAudioQueue);
      radioTextToAudioQueueRef.current = newTextToAudioQueue;
      setGeneratingAudio(false);
    }
    if(radioTextToAudioQueue.length > 0 && !generatingAudio) {
      setGeneratingAudio(true);
      getAudio(radioTextToAudioQueue[0]);
    }

  }, [radioTextToAudioQueue, generatingAudio]);


  useEffect(() => {
    //previousRadioItems.current = radioItems;
    if(fetchedNewRadioItems) {
      setFetchedNewRadioItems(false);
      //check if there is a radio item to fetch (don't fetch if it is associated with the last track)
      const nextTrackToFetchRadio = queue.findIndex((track) => track.id == radioItems[radioItems.length - 1].beforeTrackId);
      if(nextTrackToFetchRadio != queue.length -1){
        
       
        //we already generated audio for the beforeTrack so we need to add 1 to the index
        if (nextTrackToFetchRadio > -1 && nextTrackToFetchRadio < queue.length-1) {
          const newFetchingRadioFor = [queue[nextTrackToFetchRadio+1]];
          //usually give 2 tracks per request but if it's the last track, only give 1
          if(nextTrackToFetchRadio < queue.length - 2) {
            newFetchingRadioFor.push(queue[nextTrackToFetchRadio + 2]);
          }
          setFetchingRadioFor(newFetchingRadioFor);
        }
      }

    }
  }, [fetchedNewRadioItems]);

  useEffect(() => {
    if (trackChanged.current) {
      console.log("trackChanged");
      trackChanged.current = false;
    }
  }, [trackChanged.current]);


  const connectToSpotify = async () => {
    redirectToSpotifyAuthorize();
    //const token = getToken();
    // const res = await SpotifyApi.performUserAuthorization(clientId, redirectUrl, scopeArr, "");
    // console.log("BItch: ");
    // console.log(res);
    // currentToken.save({
    //   access_token: res.accessToken.access_token,
    //   refresh_token: res.accessToken.refresh_token,
    //   expires_in: res.accessToken.expires_in
    // });
    // console.log(currentToken);
    //console.log("Token: ", token);

    //setSpotifyApi(SpotifyApi.withClientCredentials(clientId, res.accessToken.access_token));

  }

  const getQueue = async () => {
    const res = await getUserQueue();
    //checking if it returned a track or an episode(episode don't have an album)
    if (res === undefined || !('album' in res.queue[0])) return;
    return res.queue;
  }



  const renderQueue = () => {
    if (queue.length > 0) {
      const renderList: (RadioItem | Track)[] = [...queue];
      for (let i = 0; i < radioItems.length; i++) {
        const radioItem = radioItems[i];
        const index = renderList.findIndex((item) => 'name' in item && item.id === radioItem.beforeTrackId);
        renderList.splice(index, 0, radioItem);

      }
      return renderList.map((elem) => {
        if ('album' in elem)
          return <SongCard song={elem} key={elem.id} />;
        else
          return <RadioItemCard radioItem={elem} key={elem.beforeTrackId+"radio"} />;
      });
    }
    return null;
  }
  const pauseSong = async (player:any) => {
    let state = await player.current.getCurrentState();
    while(state.paused == false){
      player.current.pause();
      state = await player.current.getCurrentState();
    }
    return null;
  }

  //a dumb way to do it. but could not pause because of the loading state of the track -.-
  const onPlayerChange = async (track: Track, player: any) => {
    if(radioItems.length > 0 && track.id == radioItems[0].beforeTrackId){
      console.log("PLAYING RADIO");
      pauseSong(player);
      
      if(radioItems[0].audio != null && radioItems[0].audio != 'empty'){
        await playSound(radioItems[0].audio);
        player.current.resume();
      }
      //removing the radio item that was played from the queue
      radioItems.shift();
      setRadioItems(radioItems);
      radioItemsRef.current = radioItems;
    }

    //removing the track that was played from the queue
    const newQueue = [...queue];
    newQueue.shift();
    setQueue(newQueue);
  }

  const generate_radio = async (queue: Track[]) => {
    //generate radio for the next 2 tracks at a time
    await sleep(5000);
    const queueElements = queue.slice(0, 2);
    const radioText = await generate_queue_texts(queueElements);
    //const radioAudio = await generate_queue_audios(queueElements);
    console.log(radioItems);
    const newRadioItems = [...radioItems];
    newRadioItems.push(radioText);
    return newRadioItems;
  }

  const sdkPlayerStarted = async (player: any) => {
    console.log("SDK player started 111111111!!!!");
    player.current.activateElement();
    player.current.resume();
    setDebugText(player.current.state);
    const newQueue = await getQueue();
    setQueue(newQueue as Track[]);

    if (newQueue === undefined) return;
    setFetchingRadioFor([newQueue[0], newQueue[1]]);//for the first two tracks
  }
  

  const startRadio = async () => {
    await playOnSDK();
  }
  const render = () => {
    try{
      if (currentToken.access_token == null || currentToken.access_token == "" || currentToken.access_token == 'undefined') {
        return (
          <div>
            <Button colorScheme='blue' onClick={()=> connectToSpotify()}>Connect to spotify!</Button>
          </div>
        );
      }
      return (
        <div >
          {/* {queue.length == 0  ? <Button colorScheme='blue' onClick={() => startRadio()}>Start!</Button> : null} */}
          <WebPlayback 
            token={currentToken.access_token} 
            onPlayerChange={onPlayerChange}
            sdkPlayerStarted={sdkPlayerStarted}
            queue={queue}
            radioItems={radioItems}
          />
          <Stack direction='column' spacing={4}>
            {renderQueue()}
          </Stack>
        </div>
      );
    }
    catch(e){
      console.log('Got you bitch');
      throw e;
    }

  }

  return (
    <div className="App">
      <header className="App-header">
        Smart radio
      </header>
      <h1 style={{ color: 'red' }}>{debugText}</h1>
      <div className='Content'>
        {render()}
      </div>
    </div>
  );
}

export default App;
