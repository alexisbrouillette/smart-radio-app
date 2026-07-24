import React, { useState, useEffect, useRef } from 'react';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { Button } from '@chakra-ui/react';
import { getCurrentlyPlaying, pausePlayback, resumePlayback, skipToNext } from '../network/spotify';
import "./style.css";

import { logger } from '../components/DebugConsole';

const defaultTrack = {
    name: "",
    album: {
        images: [
            { url: "" }
        ]
    },
    artists: [
        { name: "" }
    ]
}

function WebPlayback(props) {

    const [is_paused, setPaused] = useState(false);
    const [is_active, setActive] = useState(false);
    const [current_track, setCurrentTrack] = useState(defaultTrack);
    const current_track_name = useRef("");
    const audioContext = useRef(null);
    const lowVolumeSound = useRef(null);

    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
                logger.add('info', "Screen Wake Lock acquired");
            }
        } catch (err) {
            console.log("Wake Lock error:", err);
        }
    };

    const initializeAudioContext = () => {
        if (!audioContext.current) {
            try {
                audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.current.createOscillator();
                const gainNode = audioContext.current.createGain();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(440, audioContext.current.currentTime);
                gainNode.gain.setValueAtTime(0.0001, audioContext.current.currentTime);
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.current.destination);
                oscillator.start();
                lowVolumeSound.current = oscillator;
            } catch (e) {
                console.error("AudioContext initialization error:", e);
            }
        }
        if (audioContext.current && audioContext.current.state === 'suspended') {
            audioContext.current.resume().catch(() => {});
        }

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: "Smart Radio Host",
                artist: "AI Radio Host",
                album: "Live Station Broadcast"
            });
        }
        requestWakeLock();
    }

    const isActiveRef = useRef(false);

    const pollIntervalRef = useRef(null);
    const transitionTimerRef = useRef(null);
    const scheduledTrackIdRef = useRef(null);
    const lastProgressMsRef = useRef(0);

    const pollSpotifyState = async () => {
        try {
            const data = await getCurrentlyPlaying();
            if (data && data.item) {
                if (!isActiveRef.current) {
                    isActiveRef.current = true;
                    setActive(true);
                    logger.add('event', `Connected to active Spotify player: ${data.item.name}`);
                    current_track_name.current = data.item.name;
                    setCurrentTrack(data.item);
                    props.sdkPlayerStarted({ current: { pause: pausePlayback, resume: resumePlayback } });
                }
                setPaused(!data.is_playing);

                // Precision Local Timer: ONLY schedule pause timer if a radio host item is pending!
                const hasPendingRadioItem = props.radioItems && props.radioItems.length > 0;

                if (hasPendingRadioItem && data.is_playing && data.progress_ms && data.item.duration_ms) {
                    const remainingMs = data.item.duration_ms - data.progress_ms;
                    const progressDelta = Math.abs(data.progress_ms - (lastProgressMsRef.current + 2000));
                    
                    // If track changed, or track seek occurred (>3s jump), re-synchronize precision timer
                    const userSeeked = progressDelta > 3000;
                    const needsScheduling = scheduledTrackIdRef.current !== data.item.id || userSeeked;

                    if (remainingMs > 500 && remainingMs < 600000 && needsScheduling) {
                        scheduledTrackIdRef.current = data.item.id;
                        lastProgressMsRef.current = data.progress_ms;

                        if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
                        
                        const msg = `Precision timer scheduled: ${Math.round(remainingMs / 1000)}s remaining for "${data.item.name}"`;
                        console.log(msg);
                        logger.add('info', msg);
                        
                        transitionTimerRef.current = setTimeout(() => {
                            const fireMsg = `Precision track end timer fired for "${data.item.name}"! Skipping to next track...`;
                            console.log(fireMsg);
                            logger.add('event', fireMsg);
                            skipToNext();
                        }, Math.max(0, remainingMs - 150));
                    }
                } else {
                    console.log(`Poll tick: is_playing=${data.is_playing}, progress=${data.progress_ms}, duration=${data.item?.duration_ms}, pendingRadioItems=${props.radioItems?.length}`);
                }

                if (data.item.name && data.item.name !== current_track_name.current) {
                    logger.add('event', `Spotify track changed: "${current_track_name.current}" -> "${data.item.name}"`);
                    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
                    current_track_name.current = data.item.name;
                    setCurrentTrack(data.item);
                    props.onPlayerChange(data.item, { current: { pause: pausePlayback, resume: resumePlayback } });
                }
            }
        } catch (err) {
            // silent poll catch
        }
    };

    // Spotify Connect Remote Polling Engine
    useEffect(() => {
        initializeAudioContext();

        pollSpotifyState();
        pollIntervalRef.current = setInterval(pollSpotifyState, 2000);

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const startRadio = async () => {
        logger.add('event', "Connecting Remote AI Radio Host...");
        initializeAudioContext();
        try {
            await resumePlayback();
        } catch (e) {}
        const data = await getCurrentlyPlaying();
        if (data && data.item) {
            isActiveRef.current = true;
            setActive(true);
            current_track_name.current = data.item.name;
            setCurrentTrack(data.item);
            props.sdkPlayerStarted({ current: { pause: pausePlayback, resume: resumePlayback } });
            props.onPlayerChange(data.item, { current: { pause: pausePlayback, resume: resumePlayback } });
        } else {
            // Force activate UI if user clicked connect
            isActiveRef.current = true;
            setActive(true);
            props.sdkPlayerStarted({ current: { pause: pausePlayback, resume: resumePlayback } });
        }
    }

    const pause = async () => {
        logger.add('info', "Pausing Spotify via Remote API...");
        await pausePlayback();
        setPaused(true);
    }

    const play = async () => {
        logger.add('info', "Resuming Spotify via Remote API...");
        await resumePlayback();
        setPaused(false);
    }

    const skip = async () => {
        logger.add('info', "Skipping to next track via Remote API...");
        await skipToNext();
    }

    if (!is_active) { 
        return (
            <div className="glass-panel player-container">
                <div style={{ padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <div style={{ fontSize: '3rem', animation: 'pulse 2s infinite' }}>🎙️</div>
                        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'white', margin: 0 }}>Smart Radio Host</h2>
                        <p style={{ color: '#a7a7a7', fontSize: '0.95rem', maxWidth: '380px', margin: '0 auto', lineHeight: '1.6', textAlign: 'center' }}>
                            Experience your music hosted by a smart generative AI host, weaving natural trivia and song meaning.
                        </p>
                    </div>

                    <div style={{ background: 'rgba(29, 185, 84, 0.05)', border: '1px solid rgba(29, 185, 84, 0.15)', padding: '16px 20px', borderRadius: '16px', textAlign: 'left', maxWidth: '400px' }}>
                        <h4 style={{ color: '#1DB954', fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>Quick setup:</h4>
                        <ol style={{ color: '#d1d1d6', margin: 0, paddingLeft: '20px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px', lineHeight: '1.4' }}>
                            <li>Open Spotify on your phone or computer.</li>
                            <li>Start playing any song/playlist.</li>
                            <li>Click the button below to connect the AI host!</li>
                        </ol>
                    </div>

                    <Button
                        size="lg"
                        backgroundColor="#1DB954"
                        color="black"
                        _hover={{ backgroundColor: '#1ed760', transform: 'scale(1.05)' }}
                        _active={{ transform: 'scale(0.98)' }}
                        transition="all 0.2s"
                        borderRadius="full"
                        px="8"
                        py="6"
                        fontWeight="800"
                        onClick={() => startRadio()}>
                        Connect AI Host
                    </Button>
                </div>
            </div>
        );
    } else {
        return (
            <div className="glass-panel player-container">
                <img src={current_track.album.images[0]?.url} className="now-playing__cover" alt="Album Cover" />

                <div className="now-playing__side">
                    <div className="now-playing__name">{current_track.name}</div>
                    <div className="now-playing__artist">{current_track.artists[0]?.name}</div>

                    <div className='btn-spotify-container'>
                        {is_paused ? 
                         <button className="btn-spotify play-pause-btn" onClick={() => play() } >
                            <PlayArrowIcon fontSize="large" /> 
                         </button>
                        : 
                         <button className="btn-spotify play-pause-btn" onClick={() => pause() } >
                            <PauseIcon fontSize="large" /> 
                         </button>
                        }
                        <button className="btn-spotify" onClick={() => skip() } >
                            <SkipNextIcon fontSize="large"/>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default WebPlayback;
