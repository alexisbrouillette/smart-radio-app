import React, { useRef } from 'react';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { Button } from '@chakra-ui/react';
import { pausePlayback, resumePlayback, skipToNext } from '../network/spotify';
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

    const silentAudioRef = useRef(null);
    const audioCtxRef = useRef(null);

    const initializeAudioContext = async () => {
        if (!silentAudioRef.current) {
            try {
                // Create a real Web Audio MediaStreamDestination live audio stream
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    const ctx = new AudioCtx();
                    audioCtxRef.current = ctx;
                    
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const dst = ctx.createMediaStreamDestination();
                    
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, ctx.currentTime);
                    gain.gain.setValueAtTime(0.00001, ctx.currentTime); // Inaudible background tone
                    
                    osc.connect(gain);
                    gain.connect(dst);
                    osc.start();

                    const audio = new Audio();
                    audio.srcObject = dst.stream;
                    audio.volume = 0.01;
                    silentAudioRef.current = audio;

                    const startLiveStream = async () => {
                        try {
                            if (ctx.state === 'suspended') {
                                await ctx.resume();
                            }
                            await audio.play();
                            logger.add('info', "Live MediaStream Keep-Alive active (Screen-off execution granted)");
                            if ('mediaSession' in navigator) {
                                navigator.mediaSession.playbackState = 'playing';
                            }
                        } catch (e) {}
                    };

                    startLiveStream();
                    window.addEventListener('click', startLiveStream, { once: true });
                    window.addEventListener('touchstart', startLiveStream, { once: true });
                }
            } catch (e) {
                console.error("Live MediaStream initialization error:", e);
            }
        }

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: "Smart Radio Host",
                artist: "AI Radio Host",
                album: "Live Broadcast Station"
            });
            try {
                navigator.mediaSession.setActionHandler('play', () => {
                    if (silentAudioRef.current) silentAudioRef.current.play();
                });
                navigator.mediaSession.setActionHandler('pause', () => {
                    if (silentAudioRef.current) silentAudioRef.current.pause();
                });
            } catch (e) {}
        }
        requestWakeLock();
    }

    const current_track = props.currentTrack || defaultTrack;
    const is_paused = false;
    const is_active = !!props.currentTrack;

    const startRadio = async () => {
        logger.add('event', "Connecting Remote AI Radio Host...");
        initializeAudioContext();
        if (props.sdkPlayerStarted) {
            props.sdkPlayerStarted({ current: { pause: pausePlayback, resume: resumePlayback } });
        }
    }

    const pause = async () => {
        logger.add('info', "Pausing Spotify via Remote API...");
        await pausePlayback();
    }

    const play = async () => {
        logger.add('info', "Resuming Spotify via Remote API...");
        await resumePlayback();
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
