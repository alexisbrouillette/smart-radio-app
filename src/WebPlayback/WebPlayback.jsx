import React, { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Flex, Text } from '@chakra-ui/react';
import { pausePlayback, resumePlayback, skipToNext, skipToPrevious } from '../network/spotify';
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
    const [isPlaying, setIsPlaying] = useState(true);
    const streamAudioRef = useRef(null);
    const transitioningRef = useRef(false);
    const [exactSegmentSec, setExactSegmentSec] = useState(0);

    const current_track = props.currentTrack || defaultTrack;

    useEffect(() => {
        let isMounted = true;
        const fetchExactDuration = async () => {
            if (!current_track.name) return;
            const trackName = current_track.name + " " + (current_track.artists[0]?.name || "");
            const activeRadioItem = (props.radioItems && props.radioItems.length > 0) 
                ? props.radioItems.find(item => item.beforeTrackId === current_track.id)
                : null;

            const songSec = (current_track.duration_ms || 180000) / 1000;
            const hostSpeechSec = activeRadioItem ? 10 : 0;
            const defaultLimit = songSec + hostSpeechSec;

            const API_BASE = process.env.REACT_APP_API_SERVER || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'https://127.0.0.1:8000' : 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run');
            
            try {
                const url = `${API_BASE}/stream/duration?track=${encodeURIComponent(trackName)}${activeRadioItem ? `&hostText=${encodeURIComponent(activeRadioItem.text)}` : ''}`;
                const res = await fetch(url);
                const data = await res.json();
                if (isMounted && data.total_segment_sec > 60) {
                    console.log(`⏱️ [EXACT DURATION API] Received exact segment length: ${data.total_segment_sec.toFixed(2)}s`);
                    setExactSegmentSec(data.total_segment_sec);
                    return;
                }
            } catch (e) {}

            if (isMounted) {
                console.log(`⏱️ [SPOTIFY DURATION FALLBACK] Using Spotify duration: ${defaultLimit.toFixed(1)}s (Song: ${songSec.toFixed(1)}s + Speech: ${hostSpeechSec}s)`);
                setExactSegmentSec(defaultLimit);
            }
        };
        fetchExactDuration();
        return () => { isMounted = false; };
    }, [current_track, props.radioItems]);

    useEffect(() => {
        transitioningRef.current = true;
        if (streamAudioRef.current) {
            try { streamAudioRef.current.currentTime = 0; } catch (e) {}
        }
        const timer = setTimeout(() => {
            transitioningRef.current = false;
        }, 5000);
        return () => clearTimeout(timer);
    }, [current_track.id]);

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
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    const ctx = new AudioCtx();
                    audioCtxRef.current = ctx;
                    
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const dst = ctx.createMediaStreamDestination();
                    
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, ctx.currentTime);
                    gain.gain.setValueAtTime(0.00001, ctx.currentTime);
                    
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
                    handlePlayPauseToggle();
                });
                navigator.mediaSession.setActionHandler('pause', () => {
                    handlePlayPauseToggle();
                });
                navigator.mediaSession.setActionHandler('nexttrack', () => {
                    handleNext();
                });
                navigator.mediaSession.setActionHandler('previoustrack', () => {
                    handlePrevious();
                });
            } catch (e) {}
        }
        requestWakeLock();
    }

    const is_active = !!props.currentTrack;

    const startRadio = async () => {
        logger.add('event', "Connecting Remote AI Radio Host...");
        initializeAudioContext();
        if (props.sdkPlayerStarted) {
            props.sdkPlayerStarted({ current: { pause: pausePlayback, resume: resumePlayback } });
        }
    }

    const handlePlayPauseToggle = async () => {
        if (streamAudioRef.current) {
            if (isPlaying) {
                streamAudioRef.current.pause();
                await pausePlayback();
                setIsPlaying(false);
                logger.add('info', "Playback paused");
            } else {
                streamAudioRef.current.play().catch(() => {});
                await resumePlayback();
                setIsPlaying(true);
                logger.add('info', "Playback resumed");
            }
        }
    };

    const handleNext = async () => {
        logger.add('event', "User clicked Skip Next Track");
        if (props.advanceToNextTrack) {
            props.advanceToNextTrack();
        }
        await skipToNext();
    };

    const handlePrevious = async () => {
        logger.add('event', "User clicked Skip Previous Track");
        await skipToPrevious();
    };

    if (!is_active) { 
        return (
            <div className="glass-panel player-container" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <Text fontSize="1.2rem" fontWeight="600" color="#f1f5f9" mb="20px">
                    📻 Smart AI Radio Station Ready
                </Text>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Button 
                        colorScheme="whatsapp" 
                        size="lg" 
                        borderRadius="full" 
                        fontWeight="800"
                        onClick={() => startRadio()}>
                        Connect AI Host
                    </Button>
                </div>
            </div>
        );
    } else {
        const nextTrackItem = (props.queue && props.queue.length > 0) ? props.queue[0] : null;
        const thirdTrackItem = (props.queue && props.queue.length > 1) ? props.queue[1] : null;

        const nextTrackParam = nextTrackItem 
            ? `&nextTrack=${encodeURIComponent(nextTrackItem.name + " " + (nextTrackItem.artists[0]?.name || ""))}`
            : '';

        const thirdTrackParam = thirdTrackItem 
            ? `&thirdTrack=${encodeURIComponent(thirdTrackItem.name + " " + (thirdTrackItem.artists[0]?.name || ""))}`
            : '';

        const activeRadioItem = (props.radioItems && props.radioItems.length > 0) 
            ? props.radioItems.find(item => item.beforeTrackId === current_track.id)
            : null;
        const hostTextParam = activeRadioItem
            ? `&hostText=${encodeURIComponent(activeRadioItem.text)}`
            : '';

        const trackParam = `track=${encodeURIComponent(current_track.name + " " + (current_track.artists[0]?.name || ""))}`;

        const API_BASE = process.env.REACT_APP_API_SERVER || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'https://127.0.0.1:8000' : 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run');

        const streamUrl = `${API_BASE}/stream/live.mp3?${trackParam}${nextTrackParam}${thirdTrackParam}${hostTextParam}`;

        return (
            <div className="glass-panel player-container">
                <img src={current_track.album.images[0]?.url} className="now-playing__cover" alt="Album Cover" />

                <div className="now-playing__side">
                    <div className="now-playing__name">{current_track.name}</div>
                    <div className="now-playing__artist">{current_track.artists[0]?.name}</div>

                    <div className='btn-spotify-container' style={{ flexDirection: 'column', gap: '16px', width: '100%', alignItems: 'center' }}>
                        <audio 
                            ref={streamAudioRef}
                            controls 
                            autoPlay 
                            src={streamUrl} 
                            onTimeUpdate={(e) => {
                                const audio = e.currentTarget;
                                const songSec = (current_track.duration_ms || 180000) / 1000;
                                const hostSpeechSec = activeRadioItem ? 10 : 0;
                                const fallbackLimit = songSec + hostSpeechSec;

                                const targetLimit = (exactSegmentSec > 60) ? exactSegmentSec : fallbackLimit;

                                if (audio.currentTime >= targetLimit && audio.currentTime > (targetLimit - 5) && !transitioningRef.current) {
                                    transitioningRef.current = true;
                                    console.log(`⏱️ [EXACT STREAM UI SYNC] Segment limit reached (${audio.currentTime.toFixed(1)}s / ${targetLimit.toFixed(1)}s). Advancing UI to next track!`);
                                    logger.add('event', `[EXACT STREAM UI SYNC] Segment finished (${targetLimit.toFixed(1)}s). Advancing frontend UI state...`);
                                    if (props.advanceToNextTrack) {
                                        props.advanceToNextTrack();
                                    }
                                    setTimeout(() => { transitioningRef.current = false; }, 3000);
                                }
                            }}
                            onPlay={() => console.log("🔊 [AUDIO DEVTOOLS LOG] Stream started playing:", streamUrl)}
                            onPause={() => console.log("⏸️ [AUDIO DEVTOOLS LOG] Stream paused")}
                            onEnded={() => {
                                console.log("🏁 [AUDIO DEVTOOLS LOG] Stream ENDED! Triggering advanceToNextTrack()...");
                                logger.add('event', "[AUDIO DEVTOOLS LOG] Stream ended, advancing to next track...");
                                if (props.advanceToNextTrack) props.advanceToNextTrack();
                            }}
                            onError={(e) => console.error("❌ [AUDIO DEVTOOLS ERROR] Stream audio element error:", e)}
                            onStalled={() => console.warn("⚠️ [AUDIO DEVTOOLS WARNING] Stream stalled / waiting for data...")}
                            onWaiting={() => {
                                console.warn("⏳ [AUDIO DEVTOOLS WARNING] Stream buffer empty / waiting...");
                                if (streamAudioRef.current && !streamAudioRef.current.paused) {
                                    setTimeout(() => {
                                        if (streamAudioRef.current && streamAudioRef.current.readyState < 3 && !streamAudioRef.current.paused) {
                                            console.log("🔄 [STREAM RECOVERY] Resuming audio stream...");
                                            streamAudioRef.current.play().catch(() => {});
                                        }
                                    }, 5000);
                                }
                            }}
                            style={{ width: '100%', borderRadius: '12px' }} 
                        />

                        {/* Interactive Playback Control Buttons */}
                        <Flex gap="20px" align="center" justify="center" mt="8px">
                            {/* Skip Previous Button */}
                            <IconButton
                                aria-label="Previous Track"
                                icon={<span style={{ fontSize: '1.4rem' }}>⏮️</span>}
                                onClick={handlePrevious}
                                borderRadius="full"
                                bg="rgba(255, 255, 255, 0.1)"
                                color="white"
                                _hover={{ bg: "rgba(255, 255, 255, 0.2)", transform: "scale(1.1)" }}
                                _active={{ transform: "scale(0.95)" }}
                                transition="all 0.2s"
                                size="lg"
                            />

                            {/* Play / Pause Toggle Button */}
                            <IconButton
                                aria-label={isPlaying ? "Pause" : "Play"}
                                icon={<span style={{ fontSize: '1.6rem' }}>{isPlaying ? '⏸️' : '▶️'}</span>}
                                onClick={handlePlayPauseToggle}
                                borderRadius="full"
                                bg="#1DB954"
                                color="black"
                                _hover={{ bg: "#1ed760", transform: "scale(1.15)" }}
                                _active={{ transform: "scale(0.95)" }}
                                transition="all 0.2s"
                                size="xl"
                                width="64px"
                                height="64px"
                            />

                            {/* Skip Next Button */}
                            <IconButton
                                aria-label="Next Track"
                                icon={<span style={{ fontSize: '1.4rem' }}>⏭️</span>}
                                onClick={handleNext}
                                borderRadius="full"
                                bg="rgba(255, 255, 255, 0.1)"
                                color="white"
                                _hover={{ bg: "rgba(255, 255, 255, 0.2)", transform: "scale(1.1)" }}
                                _active={{ transform: "scale(0.95)" }}
                                transition="all 0.2s"
                                size="lg"
                            />
                        </Flex>

                        <Text style={{ fontSize: '0.8rem', color: '#1DB954', fontWeight: 600 }}>
                            📻 Live Continuous Radio Broadcast Stream Active
                        </Text>
                    </div>
                </div>
            </div>
        );
    }
}

export default WebPlayback;
