import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import { Button, Stack } from '@chakra-ui/react';
import { currentToken, redirectToSpotifyAuthorize } from './spotifyTokenHandling';
import { getToken, getUserQueue, generate_queue_texts, generate_queue_audio, getTokenFromrefreshToken, skipToNext } from './network/spotify';
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
  const trackChanged = useRef(false); // eslint-disable-line @typescript-eslint/no-unused-vars
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
  const [debugText] = useState<string>("");

  const playSound = async (audioOrText: string) => {
    logger.add('event', "Playing Host Voice Speech...");
    
    // Check if it is base64 audio WAV
    if (audioOrText && audioOrText.length > 200 && !audioOrText.startsWith("That was")) {
      try {
        const audioTune = new Audio(`data:audio/wav;base64,${audioOrText}`);
        await audioTune.play();
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(null);
            logger.add('info', "Finished playing WAV audio");
          }, (audioTune.duration || 3) * 1000);
        });
      } catch (err) {
        logger.add('warn', `WAV audio play failed: ${err}. Falling back to browser TTS speech...`);
      }
    }

    // Fallback: Web Speech API (synthesizes speech directly in browser out loud)
    return new Promise((resolve) => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // clear previous
        const utterance = new SpeechSynthesisUtterance(audioOrText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onend = () => {
          logger.add('info', "Finished browser speech synthesis out loud");
          resolve(null);
        };
        utterance.onerror = (e) => {
          logger.add('error', `Speech synthesis error: ${e.error}`);
          resolve(null);
        };
        window.speechSynthesis.speak(utterance);
      } else {
        logger.add('warn', "SpeechSynthesis not supported on this browser");
        setTimeout(resolve, 3000);
      }
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
        try {
          const res = await getTokenFromrefreshToken();
          if (res && res.access_token) {
            currentToken.save(res);
            setGotToken(true);
          } else {
            logger.add('warn', "No valid Spotify token - redirecting to Spotify Login...");
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            redirectToSpotifyAuthorize();
          }
        } catch (e) {
          logger.add('warn', "Spotify token refresh error - redirecting to Spotify Login...");
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          redirectToSpotifyAuthorize();
        }
      }

    }

    t();

  }, []);

  useEffect(() => {
    const getRadioTexts = async (tracks: Track[]) => {
      const radioText = await generate_queue_texts(tracks, pastTransitions.current);
      if (radioText && radioText.text && radioText.beforeTrackId) {
        // Prevent duplicate radio items for the same track ID
        const isDuplicate = radioItemsRef.current.some(item => item.beforeTrackId === radioText.beforeTrackId);
        if (!isDuplicate) {
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

          const newRadioItems = [...radioItemsRef.current, radioText];
          const newTextToAudioQueue = [...radioTextToAudioQueue, {text: radioText.text, beforeTrackId: radioText.beforeTrackId}];
          setRadioTextToAudioQueue(newTextToAudioQueue);
          radioTextToAudioQueueRef.current = newTextToAudioQueue;
          radioItemsRef.current = newRadioItems;
          setRadioItems(newRadioItems);
        }
      }
    }
    if (fetchingRadioFor.length > 0) {
      getRadioTexts(fetchingRadioFor);
    }
  }, [fetchingRadioFor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const getAudio = async (radioText: {text: string, beforeTrackId: string}) => {
      logger.add('info', `Synthesizing Kokoro TTS audio for: "${radioText.text}"...`);
      const audio = await generate_queue_audio(radioText.text);
      if (audio) {
        logger.add('event', "Kokoro TTS audio voice synthesized successfully! (WAV ready)");
      } else {
        logger.add('error', "Kokoro TTS audio synthesis returned null - check Modal backend");
      }
      const newRadioItems = [...radioItemsRef.current];
      const radioItemToUpdateIndex = newRadioItems.findIndex((radioItem) => radioItem.beforeTrackId === radioText.beforeTrackId);
      if (radioItemToUpdateIndex > -1) {
        newRadioItems[radioItemToUpdateIndex] = {...newRadioItems[radioItemToUpdateIndex], audio: audio};
      }
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
    if (fetchedNewRadioItems) {
      setFetchedNewRadioItems(false);
      
      if (queue.length === 0) return;

      let newFetchingRadioFor: Track[] = [];

      if (radioItems.length === 0) {
        // First radio item is placed before Song 3 (introducing transition between Song 2 and Song 3)
        if (queue.length >= 3) {
          newFetchingRadioFor = [queue[1], queue[2]];
        } else if (queue.length === 2) {
          newFetchingRadioFor = [queue[0], queue[1]];
        }
      } else {
        const lastRadioItem = radioItems[radioItems.length - 1];
        const lastIndex = queue.findIndex((track) => track.id === lastRadioItem.beforeTrackId);
        
        // Advance by 2 songs (Song 2 -> Song 3, then Song 4 -> Song 5)
        if (lastIndex > -1 && lastIndex + 2 < queue.length) {
          newFetchingRadioFor = [queue[lastIndex + 1], queue[lastIndex + 2]];
        }
      }

      if (newFetchingRadioFor.length > 0) {
        logger.add('info', `Queueing AI host transition between "${newFetchingRadioFor[0].name}" and "${newFetchingRadioFor[1].name}"`);
        setFetchingRadioFor(newFetchingRadioFor);
      }
    }
  }, [fetchedNewRadioItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseSong = async (player: any) => {
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
    logger.add('event', `Track changed to: "${track.name}" (ID: ${track.id})`);
    
    // Re-fetch live Spotify queue so queue state stays updated across track changes
    await getQueue();

    // STRICT MATCH: Only play radio item intended specifically for this track
    const radioItemIndex = radioItemsRef.current.findIndex(item => item.beforeTrackId === track.id);
    
    if (radioItemIndex > -1) {
      const activeRadioItem = radioItemsRef.current[radioItemIndex];
      logger.add('info', `Playing matching radio host announcement for "${track.name}": "${activeRadioItem.text}"`);
      await pauseSong(player);
      
      const contentToPlay = (activeRadioItem.audio && activeRadioItem.audio !== 'empty') 
        ? activeRadioItem.audio 
        : activeRadioItem.text;

      await playSound(contentToPlay);
      
      if (player.current) {
        logger.add('info', "Resuming Spotify music playback...");
        player.current.resume().catch((err: any) => logger.add('error', `Resume error: ${err}`));
      }

      // Remove played radio item
      const updatedRadioItems = radioItemsRef.current.filter((_, idx) => idx !== radioItemIndex);
      setRadioItems(updatedRadioItems);
      radioItemsRef.current = updatedRadioItems;
    } else {
      logger.add('info', `No matching radio host announcement for: "${track.name}" (Target ID: ${track.id})`);
    }

    setFetchedNewRadioItems(true);
  }

  const triggerRadioHostAndSkip = async () => {
    if (radioItemsRef.current.length > 0) {
      const activeRadioItem = radioItemsRef.current[0];
      logger.add('info', `Playing end-of-song radio host announcement: "${activeRadioItem.text}"`);
      
      const contentToPlay = (activeRadioItem.audio && activeRadioItem.audio !== 'empty') 
        ? activeRadioItem.audio 
        : activeRadioItem.text;

      await playSound(contentToPlay);

      const updatedRadioItems = radioItemsRef.current.slice(1);
      setRadioItems(updatedRadioItems);
      radioItemsRef.current = updatedRadioItems;
    }
    
    logger.add('info', "Host speech finished! Skipping to next song...");
    await skipToNext();
    setFetchedNewRadioItems(true);
  }

  const getQueue = async () => {
    logger.add('info', "Fetching user queue from Spotify API...");
    const res = await getUserQueue();
    if (!res || !res.queue || res.queue.length === 0 || !('album' in res.queue[0])) {
      logger.add('warn', "Queue returned empty or non-music tracks from Spotify API");
      return;
    }

    const uniqueTracks = res.queue.filter((track: Track, index: number, self: Track[]) =>
      index === self.findIndex((t) => t.id === track.id)
    );
    logger.add('event', `Queue updated: ${uniqueTracks.length} tracks. Now playing: "${uniqueTracks[0]?.name}"`);
    setQueue(uniqueTracks);
    setFetchedNewRadioItems(true);
    return uniqueTracks;
  }

  const sdkPlayerStarted = async (player: any) => {
    const newQueue = await getQueue();
    if (newQueue && newQueue.length > 0) {
      setQueue(newQueue as Track[]);
      setFetchingRadioFor(newQueue.slice(0, Math.min(2, newQueue.length)));
    }
  }

  const renderQueue = () => {
    if (queue.length > 0) {
      const renderList: (RadioItem | Track)[] = [...queue];

      // Insert radio transition cards directly before their target track ID
      for (let i = 0; i < radioItems.length; i++) {
        const radioItem = radioItems[i];
        const index = renderList.findIndex((item) => 'name' in item && item.id === radioItem.beforeTrackId);
        if (index > -1) {
          renderList.splice(index, 0, radioItem);
        }
      }

      return renderList.map((elem, idx) => {
        if ('album' in elem)
          return <SongCard song={elem} key={elem.id + "_" + idx} />;
        else
          return <RadioItemCard radioItem={elem} key={(elem as RadioItem).beforeTrackId + "_radio_" + idx} />;
      });
    }
    return null;
  }

  const connectToSpotify = async () => {
    redirectToSpotifyAuthorize();
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
            radioItems={radioItems}
            onPlayerChange={onPlayerChange}
            sdkPlayerStarted={sdkPlayerStarted}
            triggerRadioHostAndSkip={triggerRadioHostAndSkip}
            queue={queue}
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
