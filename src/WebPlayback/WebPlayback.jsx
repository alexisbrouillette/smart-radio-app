import React, { useRef, useState } from 'react';
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

    const current_track = props.currentTrack || defaultTrack;
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
                            onPlay={() => console.log("🔊 [AUDIO DEVTOOLS LOG] Stream started playing:", streamUrl)}
                            onPause={() => console.log("⏸️ [AUDIO DEVTOOLS LOG] Stream paused")}
                            onEnded={() => {
                                console.log("🏁 [AUDIO DEVTOOLS LOG] Stream ENDED! Triggering advanceToNextTrack()...");
                                logger.add('event', "[AUDIO DEVTOOLS LOG] Stream ended, advancing to next track...");
                                if (props.advanceToNextTrack) props.advanceToNextTrack();
                            }}
                            onError={(e) => console.error("❌ [AUDIO DEVTOOLS ERROR] Stream audio element error:", e)}
                            onStalled={() => console.warn("⚠️ [AUDIO DEVTOOLS WARNING] Stream stalled / waiting for data...")}
                            onWaiting={() => console.warn("⏳ [AUDIO DEVTOOLS WARNING] Stream buffer empty / waiting...")}
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
