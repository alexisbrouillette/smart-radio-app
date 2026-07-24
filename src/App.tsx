import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import { Button, Stack } from '@chakra-ui/react';
import { currentToken, redirectToSpotifyAuthorize } from './spotifyTokenHandling';
import { getToken, getUserQueue, generate_queue_texts, generate_queue_audio, getTokenFromrefreshToken } from './network/spotify';
import { SongCard } from './songCard';

import { Track } from "@spotify/web-api-ts-sdk";
import WebPlayback from './WebPlayback/WebPlayback';
import { RadioItemCard } from './radioItemCard';
import { DebugConsole, logger } from './components/DebugConsole';



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
  const [, setGotToken] = useState<boolean>(false);

  //this is not sexy but i need to acces it in the useEffect fo fetch the audio and the state is not up to date so i used ref too.. but i need
  // the rerenders of the state sooo.. yeah
  const [radioItems, setRadioItems] = useState<RadioItem[]>([]);
  const radioItemsRef = useRef<RadioItem[]>([]);
  const [radioTextToAudioQueue, setRadioTextToAudioQueue] = useState<{text: string, beforeTrackId: string}[]>([]);

  const radioTextToAudioQueueRef = useRef<{text: string, beforeTrackId: string}[]>([]);
  const pastTransitions = useRef<{song: string, artist: string, text: string}[]>([]);
  const [generatingAudio, setGeneratingAudio] = useState<boolean>(false);
  const [debugText, setDebugText] = useState<string>("");

  const playSound = async (b64Audio: string) => {
    logger.add('event', "Playing TTS Audio...");
    const audioTune = new Audio(`data:audio/wav;base64,${b64Audio}`);
    await audioTune.play().catch(err => logger.add('error', `Audio play error: ${err}`));
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(null);
        logger.add('info', "Finished playing TTS Audio");
      }, (audioTune.duration || 3) * 1000);
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
      const radioText = await generate_queue_texts(tracks, pastTransitions.current);
      if (radioText && radioText.text) {
        const nextTrack = tracks[1];
        if (nextTrack) {
          pastTransitions.current.push({
            song: nextTrack.name,
            artist: nextTrack.artists.map((a: any) => a.name).join(", "),
            text: radioText.text
          });
          if (pastTransitions.current.length > 5) {
            pastTransitions.current.shift();
          }
        }
      }
      //const radioText = {text: tracks.map(t => t.name).join(", "), beforeTrackId: tracks[tracks.length-1].id, audio: null};
      //await sleep(2000);
      const newRadioItems = [...radioItemsRef.current];
      newRadioItems.push(radioText);
      const newTextToAudioQueue = [...radioTextToAudioQueue, {text: radioText.text, beforeTrackId: radioText.beforeTrackId}]
      setRadioTextToAudioQueue(newTextToAudioQueue);
      radioTextToAudioQueueRef.current = newTextToAudioQueue;
      radioItemsRef.current = newRadioItems;
      setRadioItems(newRadioItems);
      //setFetchedNewRadioItems(true); //need to only update this when the song is changed
    }
    if (fetchingRadioFor.length > 0) {
      getRadioTexts(fetchingRadioFor);
    }
  }, [fetchingRadioFor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const getAudio = async (radioText: {text: string, beforeTrackId: string}) => {
      const audio = await generate_queue_audio(radioText.text);
      const newRadioItems = [...radioItemsRef.current];
      const radioItemToUpdateIndex = newRadioItems.findIndex((radioItem) => radioItem.beforeTrackId === radioText.beforeTrackId);
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
      const nextTrackToFetchRadio = queue.findIndex((track) => track.id === radioItems[radioItems.length - 1].beforeTrackId);
      if(nextTrackToFetchRadio !== queue.length - 1){
        
       
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
  }, [fetchedNewRadioItems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (trackChanged.current) {
      trackChanged.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


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

    // removes duplicates
    const uniqueTracks = res.queue.filter((track: Track, index: number, self: Track[]) =>
      index === self.findIndex((t) => t.id === track.id)
    );
    setQueue(uniqueTracks);
    return uniqueTracks;
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
    try {
      if (player.current) {
        logger.add('info', "Pausing Spotify track for radio host transition...");
        await player.current.pause();
      }
    } catch (e) {
      logger.add('error', `Pause error: ${e}`);
    }
    return null;
  }

  //this fn is called ONLY when the track is changed
  const onPlayerChange = async (track: Track, player: any) => {
    logger.add('event', `onPlayerChange triggered for: ${track.name} (id: ${track.id})`);
    
    if(radioItems.length > 0 && track.id === radioItems[0].beforeTrackId){
      logger.add('info', `Matched radio item for beforeTrackId: ${track.id}`);
      await pauseSong(player);
      
      if(radioItems[0].audio !== null && radioItems[0].audio !== 'empty'){
        await playSound(radioItems[0].audio);
      } else {
        logger.add('warn', "Radio item audio was empty/null - skipping audio play");
      }
      
      // Always resume music playback so Spotify session never gets stuck paused
      if (player.current) {
        logger.add('info', "Resuming Spotify music playback...");
        player.current.resume().then(() => {
          logger.add('event', "Spotify music resumed successfully");
        }).catch((err: any) => {
          logger.add('error', `Resume failed: ${err}`);
        });
      }

      //removing the radio item that was played from the queue
      radioItems.shift();
      setRadioItems(radioItems);
      radioItemsRef.current = radioItems;
    } else {
      logger.add('info', `No radio item matched for track: ${track.name} (pending radio items: ${radioItems.length})`);
    }

    //removing the track that was played from the queue
    const newQueue = [...queue];
    newQueue.shift();
    setQueue(newQueue);

    //ready to fetch radio for the next track
    setFetchedNewRadioItems(true);
  }

  const sdkPlayerStarted = async (player: any) => {
    player.current.activateElement();
    player.current.resume();
    setDebugText(player.current.state);
    const newQueue = await getQueue();
    setQueue(newQueue as Track[]);

    if (newQueue === undefined) return;
    setFetchingRadioFor([newQueue[0], newQueue[1]]);//for the first two tracks
  }

  const render = () => {
    try{
      if (currentToken.access_token === null || currentToken.access_token === "" || currentToken.access_token === 'undefined') {
        return (
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '40px 20px' }}>
            <span style={{ fontSize: '3rem' }}>📻</span>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'white', margin: 0 }}>Smart Radio</h2>
            <p style={{ color: '#a7a7a7', fontSize: '0.9rem', maxWidth: '300px', margin: '0 auto', textAlign: 'center', lineHeight: '1.5' }}>
              Connect your Spotify Premium account to hear your personalized AI radio host.
            </p>
            <Button 
              backgroundColor="#1DB954" 
              color="black"
              borderRadius="full"
              _hover={{ backgroundColor: '#1ed760', transform: 'scale(1.03)' }}
              _active={{ transform: 'scale(0.98)' }}
              fontWeight="800"
              size="lg"
              px="8"
              onClick={()=> connectToSpotify()}>
              Connect to Spotify
            </Button>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* {queue.length == 0  ? <Button colorScheme='blue' onClick={() => startRadio()}>Start!</Button> : null} */}
          <WebPlayback 
            token={currentToken.access_token} 
            onPlayerChange={onPlayerChange}
            sdkPlayerStarted={sdkPlayerStarted}
            queue={queue}
            radioItems={radioItems}
          />
          {queue.length > 0 && (
            <div>
              <div className="section-title">
                <span>🎵</span> Up Next
              </div>
              <Stack direction='column' spacing={3}>
                {renderQueue()}
              </Stack>
            </div>
          )}
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
        📻 <span className="App-logo-text">Smart Radio</span>
      </header>
      <div className='Content'>
        {render()}
      </div>
      {debugText && <div style={{ fontSize: '0.7rem', color: '#555', position: 'fixed', bottom: '10px', right: '10px' }}>{debugText}</div>}
      <DebugConsole />
    </div>
  );
}

export default App;
