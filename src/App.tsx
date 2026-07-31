import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import { Button, Stack } from '@chakra-ui/react';
import { currentToken, redirectToSpotifyAuthorize } from './spotifyTokenHandling';
import { getToken, getUserQueue, generate_queue_texts, getTokenFromrefreshToken, skipToNext } from './network/spotify';
import { SongCard } from './songCard';

import { Track } from "@spotify/web-api-ts-sdk";
import WebPlayback from './WebPlayback/WebPlayback';
import { RadioItemCard } from './radioItemCard';
import { DebugConsole, logger } from './components/DebugConsole';

export interface RadioItem {
  text: string;
  beforeTrackId: string;
  audio: string | null;
  status?: 'synthesizing' | 'ready';
}

const API_BASE = process.env.REACT_APP_API_SERVER || 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run';

async function scheduleTTS(trackKey: string, text: string, trackId?: string) {
  try {
    await fetch(`${API_BASE}/tts/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ trackKey, hostText: text, trackId: trackId || '' }),
    });
    logger.add('info', `🔥 [TTS SCHEDULE] Scheduled host speech for: "${trackKey}" (ID: ${trackId})`);
  } catch (e) {
    logger.add('warn', `[TTS SCHEDULE] Failed: ${e}`);
  }
}

function App() {
  const [queue, setQueue] = useState<Track []>([]);
  const trackChanged = useRef(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [fetchingRadioFor, setFetchingRadioFor] = useState<Track[]>([]);
  const [, setGotToken] = useState<boolean>(false);

  const [radioItems, setRadioItems] = useState<RadioItem[]>([]);
  const radioItemsRef = useRef<RadioItem[]>([]);
  const pastTransitions = useRef<{song: string, artist: string, text: string}[]>([]);
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

  // Root-level Radio Engine References
  const [currentTrack, setCurrentTrackState] = useState<Track | null>(null);
  const currentTrackRef = useRef<Track | null>(null);
  const songCounterRef = useRef<number>(1);

  const setCurrentTrack = (track: Track | null) => {
    currentTrackRef.current = track;
    setCurrentTrackState(track);
  };

  // Clear stale local storage cache on mount so live Spotify queue is always fetched fresh
  useEffect(() => {
    try {
      localStorage.removeItem('smart_radio_station_state');
    } catch (e) {}
  }, []);

  const [cachedTrackNames, setCachedTrackNames] = useState<string[]>([]);

  useEffect(() => {
    if (queue.length === 0) return;
    const fetchCacheStatus = async () => {
      const targetTracks = queue.slice(0, 4);
      const trackQuery = targetTracks.map(t => `${t.name} ${t.artists[0]?.name || ''}`).join('|||');
      const trackIdQuery = targetTracks.map(t => t.id || '').join('|||');
      const API_BASE = process.env.REACT_APP_API_SERVER || 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run';
      try {
        const res = await fetch(`${API_BASE}/cache/status?tracks=${encodeURIComponent(trackQuery)}&trackIds=${encodeURIComponent(trackIdQuery)}`, {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.cached_tracks) {
          setCachedTrackNames(data.cached_tracks);
        }
      } catch (e) {}
    };

    fetchCacheStatus();
    const interval = setInterval(fetchCacheStatus, 4000);
    return () => clearInterval(interval);
  }, [queue]);

  const transitionTimerRef = useRef<any>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const pwaWorkerRef = useRef<Worker | null>(null);

  const initializeLiveKeepAlive = () => {
    if (!silentAudioRef.current) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const dst = ctx.createMediaStreamDestination();
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, ctx.currentTime);
          gain.gain.setValueAtTime(0.00001, ctx.currentTime);
          
          osc.connect(gain);
          gain.connect(dst);

          const audio = new Audio();
          audio.srcObject = dst.stream;
          audio.volume = 0.01;
          silentAudioRef.current = audio;

          const startStream = async () => {
            try {
              if (ctx.state === 'suspended') await ctx.resume();
              try { osc.start(); } catch (e) {}
              await audio.play();
              logger.add('info', "Root Live MediaStream Keep-Alive Active");
              if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
              }
            } catch (e) {}
          };

          window.addEventListener('click', startStream, { once: true });
          window.addEventListener('touchstart', startStream, { once: true });
        }
      } catch (e) {}
    }
  };

  useEffect(() => {
    logger.add('info', "[STATE] App mounted - initializing Radio Station...");
    
    // Check Spotify Auth Tokens
    const t = async () => {
      const token = currentToken.access_token;
      if (!token || token === 'undefined' || token === 'null') {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
          try {
            logger.add('info', "[STATE] Exchanging Spotify Auth Code for Access Token...");
            const data = await getToken(code);
            if (data.access_token) {
              currentToken.save(data);
              setGotToken(true);
              logger.add('info', "[STATE] Spotify Token exchange successful!");
              window.history.replaceState({}, document.title, "/");
            }
          } catch (e) {
            logger.add('error', `Token exchange error: ${e}`);
          }
        }
      } else {
        try {
          const refreshToken = localStorage.getItem('refresh_token');
          if (refreshToken && refreshToken !== 'undefined' && refreshToken !== 'null') {
            const data = await getTokenFromrefreshToken();
            if (data && data.access_token) {
              currentToken.save(data);
              setGotToken(true);
              logger.add('info', "[STATE] Spotify Token refreshed via RefreshToken!");
            }
          } else {
            logger.add('warn', "[STATE] No refresh_token found - redirecting to Spotify login...");
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            redirectToSpotifyAuthorize();
          }
        } catch (e) {
          logger.add('warn', "[STATE] Spotify token refresh error - redirecting to Spotify Login...");
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          redirectToSpotifyAuthorize();
        }
      }
    };

    // Instantiate Web Worker for unthrottled background PWA clock
    try {
      if (window.Worker) {
        const worker = new Worker('/pwaWorker.js');
        pwaWorkerRef.current = worker;
        worker.onmessage = async (e) => {
          if (e.data && e.data.event === 'trackEndTrigger') {
            logger.add('event', `[STATE] Live broadcast continuous stream handling track transition...`);
          }
        };
        logger.add('info', "[STATE] PWA Unthrottled Worker Clock Initialized");
      }
    } catch (err) {
      logger.add('warn', "[STATE] Web Worker initialization fallback");
    }

    t().then(() => {
      // Fetch initial Spotify Queue ONCE at session start
      logger.add('info', "[STATE] Fetching Spotify queue ONCE for initial station setup...");
      getQueue();
    });
    initializeLiveKeepAlive();

    const currentTimer = transitionTimerRef.current;
    const currentWorker = pwaWorkerRef.current;

    return () => {
      if (currentTimer) clearTimeout(currentTimer);
      if (currentWorker) currentWorker.postMessage({ command: 'cancel' });
    };

  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate AI Host announcement texts for visual UI cards
  useEffect(() => {
    const getRadioTexts = async (tracks: Track[]) => {
      // 1. Check if Pair 1 target track is an EVEN song in station count!
      const targetTrack1 = tracks[1];
      if (targetTrack1) {
        const targetIndexInQueue = queue.findIndex(t => t.id === targetTrack1.id);
        const songNum1 = (songCounterRef.current) + 1 + (targetIndexInQueue > -1 ? targetIndexInQueue : 0);
        if (songNum1 % 2 === 0) {
          const radioText1 = await generate_queue_texts(tracks, pastTransitions.current);
          if (radioText1 && radioText1.text && radioText1.beforeTrackId) {
            const isDup1 = radioItemsRef.current.some(item => item.beforeTrackId === radioText1.beforeTrackId);
            if (!isDup1) {
              const item1: RadioItem = {
                text: radioText1.text,
                beforeTrackId: radioText1.beforeTrackId,
                audio: null,
                status: 'synthesizing'
              };
              radioItemsRef.current = [...radioItemsRef.current, item1];
              setRadioItems([...radioItemsRef.current]);
              // Schedule TTS with track name & track ID so server injects speech before Song B
              const trackKey1 = targetTrack1.name + " " + (targetTrack1.artists[0]?.name || "");
              scheduleTTS(trackKey1, radioText1.text, targetTrack1.id);

              setTimeout(() => {
                radioItemsRef.current = radioItemsRef.current.map(item =>
                  item.beforeTrackId === radioText1.beforeTrackId ? { ...item, status: 'ready' } : item
                );
                setRadioItems([...radioItemsRef.current]);
              }, 2500);
            }
          }
        }
      }

      // 2. Check if Pair 2 target track (queue[2]) is an EVEN song in station count!
      if (queue.length >= 3) {
        const targetTrack2 = queue[2];
        if (targetTrack2) {
          const songNum2 = (songCounterRef.current) + 1 + 2;
          if (songNum2 % 2 === 0) {
            const pair2 = [queue[1], queue[2]];
            const radioText2 = await generate_queue_texts(pair2, pastTransitions.current);
            if (radioText2 && radioText2.text && radioText2.beforeTrackId) {
              const isDup2 = radioItemsRef.current.some(item => item.beforeTrackId === radioText2.beforeTrackId);
              if (!isDup2) {
                const item2: RadioItem = {
                  text: radioText2.text,
                  beforeTrackId: radioText2.beforeTrackId,
                  audio: null,
                  status: 'synthesizing'
                };
                radioItemsRef.current = [...radioItemsRef.current, item2];
                setRadioItems([...radioItemsRef.current]);
                // Schedule TTS with track name & track ID so server injects speech before that track
                const targetTrack2Item = queue[2];
                const trackKey2 = targetTrack2Item.name + " " + (targetTrack2Item.artists[0]?.name || "");
                scheduleTTS(trackKey2, radioText2.text, targetTrack2Item.id);

                setTimeout(() => {
                  radioItemsRef.current = radioItemsRef.current.map(item =>
                    item.beforeTrackId === radioText2.beforeTrackId ? { ...item, status: 'ready' } : item
                  );
                  setRadioItems([...radioItemsRef.current]);
                }, 3500);
              }
            }
          }
        }
      }
    };
    if (fetchingRadioFor.length > 0) {
      getRadioTexts(fetchingRadioFor);
    }
  }, [fetchingRadioFor, queue]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }

  const lastRadioTrackPairRef = useRef<string>("");

  const getQueue = async () => {
    logger.add('info', "[STATE] Fetching initial user queue from Spotify API...");
    const res = await getUserQueue();
    if (!res) {
      logger.add('warn', "Queue returned empty or invalid response from Spotify API");
      return;
    }

    const rawList: Track[] = [];
    if (res.currently_playing && 'album' in res.currently_playing) {
      rawList.push(res.currently_playing);
    }
    if (res.queue && Array.isArray(res.queue)) {
      rawList.push(...res.queue.filter((t: Track) => 'album' in t));
    }

    if (rawList.length === 0) {
      logger.add('warn', "No valid music tracks found in Spotify player queue");
      return;
    }

    const uniqueTracks = rawList.filter((track: Track, index: number, self: Track[]) =>
      index === self.findIndex((t) => t.id === track.id)
    );
    
    // Set initial station state with fresh Spotify queue
    if (!currentTrackRef.current) {
      setCurrentTrack(uniqueTracks[0]);
      setQueue(uniqueTracks.slice(1));
    }

    if (uniqueTracks.length >= 2) {
      const pairId = `${uniqueTracks[0].id}_${uniqueTracks[1].id}`;
      if (pairId !== lastRadioTrackPairRef.current) {
        lastRadioTrackPairRef.current = pairId;
        logger.add('event', `[STATE] Station Queue Initialized: ${uniqueTracks.length} tracks. Now playing: "${uniqueTracks[0]?.name}"`);
        setFetchingRadioFor(uniqueTracks.slice(0, 2));
      }
    }
    return uniqueTracks;
  }

  const advanceToNextTrack = () => {
    if (queue.length > 0) {
      const nextTrack = queue[0];
      const newQueue = queue.slice(1);
      songCounterRef.current += 1;
      
      // Strict 2-song cadence: DJ host speaks every 2 songs (Song 2, Song 4, Song 6...)
      const isHostTurn = (songCounterRef.current % 2 === 0);
      logger.add('event', `[STATION] Advancing to Track #${songCounterRef.current}: "${nextTrack.name}" | DJ Host Interlude: ${isHostTurn ? "YES 🎙️" : "NO 🎵"}`);
      
      const prevTrack = currentTrackRef.current || nextTrack;
      setCurrentTrack(nextTrack);
      setQueue(newQueue);
      
      // Remove ONLY old/expired radio items for previous tracks that are done!
      // KEEP radio item for nextTrack so WebPlayback can attach hostText to stream URL!
      const updatedRadioItems = radioItemsRef.current.filter(item => item.beforeTrackId !== prevTrack.id);
      radioItemsRef.current = updatedRadioItems;
      setRadioItems(updatedRadioItems);
      
      if (isHostTurn && newQueue.length > 0) {
        setFetchingRadioFor([prevTrack, nextTrack]);
      }
    }
  };

  const sdkPlayerStarted = async (player: any) => {
    const newQueue = await getQueue();
    if (newQueue && newQueue.length > 0) {
      setCurrentTrack(newQueue[0] as Track);
      setQueue(newQueue.slice(1) as Track[]);
      if (newQueue.length >= 2) {
        setFetchingRadioFor(newQueue.slice(0, 2) as Track[]);
      }
    }
  }

  const renderQueue = () => {
    if (queue.length > 0) {
      const renderList: (RadioItem | Track)[] = [...queue];

      // Insert radio transition cards directly before their target track ID if present in remaining queue
      for (let i = 0; i < radioItems.length; i++) {
        const radioItem = radioItems[i];
        const index = renderList.findIndex((item) => 'name' in item && item.id === radioItem.beforeTrackId);
        if (index > -1) {
          renderList.splice(index, 0, radioItem);
        }
      }

      return renderList.map((elem, idx) => {
        if ('album' in elem) {
          const fullTrackQuery = `${elem.name} ${elem.artists[0]?.name || ''}`;
          const isPreCached = cachedTrackNames.includes(fullTrackQuery);
          return <SongCard song={elem} isPreCached={isPreCached} key={elem.id + "_" + idx} />;
        } else {
          return <RadioItemCard radioItem={elem} key={(elem as RadioItem).beforeTrackId + "_radio_" + idx} />;
        }
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
            advanceToNextTrack={advanceToNextTrack}
            currentTrack={currentTrack}
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
