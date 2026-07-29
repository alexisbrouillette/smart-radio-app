import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button, IconButton, Flex, Text } from '@chakra-ui/react';
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

const API_BASE = process.env.REACT_APP_API_SERVER || (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'https://127.0.0.1:8000'
        : 'https://alexisbrouillette--smart-radio-api-fastapi-app.modal.run'
);

function buildStreamUrl(track, queue, radioItems) {
    const nextTrackItem = queue && queue.length > 0 ? queue[0] : null;
    const thirdTrackItem = queue && queue.length > 1 ? queue[1] : null;
    const activeRadioItem = radioItems && radioItems.length > 0
        ? radioItems.find(item => item.beforeTrackId === track.id)
        : null;

    const trackParam = `track=${encodeURIComponent(track.name + " " + (track.artists[0]?.name || ""))}`;
    const nextTrackParam = nextTrackItem
        ? `&nextTrack=${encodeURIComponent(nextTrackItem.name + " " + (nextTrackItem.artists[0]?.name || ""))}`
        : '';
    const thirdTrackParam = thirdTrackItem
        ? `&thirdTrack=${encodeURIComponent(thirdTrackItem.name + " " + (thirdTrackItem.artists[0]?.name || ""))}`
        : '';
    const hostTextParam = activeRadioItem
        ? `&hostText=${encodeURIComponent(activeRadioItem.text)}`
        : '';

    return `${API_BASE}/stream/live.mp3?ngrok-skip-browser-warning=true&${trackParam}${nextTrackParam}${thirdTrackParam}${hostTextParam}`;
}

function WebPlayback(props) {
    const [isPlaying, setIsPlaying] = useState(true);
    const streamAudioRef = useRef(null);
    const transitioningRef = useRef(false);
    const [exactSegmentSec, setExactSegmentSec] = useState(0);
    // Track the current stream URL in a ref so it's stable across renders
    const sessionStreamUrlRef = useRef('');
    const [sessionStreamUrl, setSessionStreamUrl] = useState('');

    const current_track = props.currentTrack || defaultTrack;

    // ── Core imperative function: load a new track into the audio element ──
    // Called on: initial session start, manual skip, auto-advance from onTimeUpdate.
    const loadTrackIntoStream = useCallback((track, queue, radioItems) => {
        if (!track || !track.name) return;
        const url = buildStreamUrl(track, queue, radioItems);
        if (url === sessionStreamUrlRef.current) {
            logger.add('warn', `[STREAM] Skipping reload — same URL already active`);
            return;
        }
        sessionStreamUrlRef.current = url;
        setSessionStreamUrl(url);
        logger.add('info', `📻 [STREAM LOAD] Loading track: "${track.name}" → ${url}`);

        const audio = streamAudioRef.current;
        if (audio) {
            audio.src = url;
            audio.load();
            audio.play().catch(err => {
                logger.add('warn', `▶️ [STREAM PLAY ERR] ${err.name}: ${err.message}`);
            });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Initialize stream once when the first track arrives ──
    useEffect(() => {
        if (props.currentTrack && !sessionStreamUrlRef.current) {
            loadTrackIntoStream(props.currentTrack, props.queue, props.radioItems);
        }
    }, [props.currentTrack, props.queue, props.radioItems, loadTrackIntoStream]);

    // ── Fetch exact segment duration from server for this track ──
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

            try {
                const url = `${API_BASE}/stream/duration?track=${encodeURIComponent(trackName)}${activeRadioItem ? `&hostText=${encodeURIComponent(activeRadioItem.text)}` : ''}`;
                const res = await fetch(url, { headers: { 'ngrok-skip-browser-warning': 'true' } });
                const data = await res.json();
                if (isMounted && data.total_segment_sec > 60) {
                    logger.add('info', `⏱️ [EXACT DURATION] ${data.total_segment_sec.toFixed(2)}s for "${current_track.name}"`);
                    setExactSegmentSec(data.total_segment_sec);
                    return;
                }
            } catch (e) {}

            if (isMounted) {
                logger.add('info', `⏱️ [SPOTIFY DURATION FALLBACK] Using Spotify duration: ${defaultLimit.toFixed(1)}s (Song: ${songSec.toFixed(1)}s + Speech: ${hostSpeechSec}s)`);
                setExactSegmentSec(defaultLimit);
            }
        };
        fetchExactDuration();
        return () => { isMounted = false; };
    }, [current_track, props.radioItems]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Update MediaSession lock screen metadata when track changes ──
    useEffect(() => {
        if ('mediaSession' in navigator && current_track.name) {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: current_track.name,
                artist: current_track.artists[0]?.name || "Smart Radio Host",
                album: "Smart Radio Station",
                artwork: current_track.album?.images?.map(img => ({ src: img.url, sizes: '512x512', type: 'image/jpeg' })) || []
            });
        }
        logger.add('event', `[TRACK UI] Now showing: "${current_track.name}"`);
    }, [current_track.id, current_track.name]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Wake Lock ──
    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
                logger.add('info', "Screen Wake Lock acquired");
            }
        } catch (err) {}
    };

    // ── Silent AudioContext keep-alive (prevents background kill on iOS/Android) ──
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
                            if (ctx.state === 'suspended') await ctx.resume();
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
                navigator.mediaSession.setActionHandler('play', () => handlePlayPauseToggle());
                navigator.mediaSession.setActionHandler('pause', () => handlePlayPauseToggle());
                navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
                navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevious());
            } catch (e) {}
        }
        requestWakeLock();
    };

    const is_active = !!props.currentTrack;

    const startRadio = async () => {
        logger.add('event', "Connecting Remote AI Radio Host...");
        initializeAudioContext();
        if (props.sdkPlayerStarted) {
            props.sdkPlayerStarted({ current: { pause: () => {}, resume: () => {} } });
        }
    };

    const handlePlayPauseToggle = async () => {
        if (streamAudioRef.current) {
            if (isPlaying) {
                streamAudioRef.current.pause();
                setIsPlaying(false);
                logger.add('info', "Local stream playback paused");
            } else {
                streamAudioRef.current.play().catch(() => {});
                setIsPlaying(true);
                logger.add('info', "Local stream playback resumed");
            }
        }
    };

    // Manual skip: advance UI state AND reload stream to the new track immediately
    const handleNext = () => {
        logger.add('event', "⏭️ [MANUAL SKIP] User skipped to next track");
        if (!props.queue || props.queue.length === 0) {
            logger.add('warn', "Skip ignored — queue is empty");
            return;
        }
        const nextTrack = props.queue[0];
        const newQueue = props.queue.slice(1);
        // Advance UI
        if (props.advanceToNextTrack) {
            props.advanceToNextTrack();
        }
        // Reload audio stream to new track — user gesture allows this even on mobile
        loadTrackIntoStream(nextTrack, newQueue, props.radioItems);
        transitioningRef.current = true;
        setTimeout(() => { transitioningRef.current = false; }, 4000);
    };

    const handlePrevious = () => {
        logger.add('event', "⏮️ [MANUAL PREV] Skip previous not supported in continuous stream mode");
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
        const activeRadioItem = (props.radioItems && props.radioItems.length > 0)
            ? props.radioItems.find(item => item.beforeTrackId === current_track.id)
            : null;

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
                            src={sessionStreamUrl}
                            onCanPlay={() => {
                                logger.add('info', `🎵 [AUDIO CAN PLAY] Stream ready for: "${current_track.name}"`);
                                if (isPlaying && streamAudioRef.current && streamAudioRef.current.paused) {
                                    streamAudioRef.current.play().catch(err => {
                                        logger.add('warn', `⚠️ [AUDIO PLAY RETRY ERR] ${err.name}: ${err.message}`);
                                    });
                                }
                            }}
                            onTimeUpdate={(e) => {
                                const audio = e.currentTarget;
                                const songSec = (current_track.duration_ms || 180000) / 1000;
                                const hostSpeechSec = activeRadioItem ? 10 : 0;
                                const fallbackLimit = songSec + hostSpeechSec;
                                const targetLimit = (exactSegmentSec > 60) ? exactSegmentSec : fallbackLimit;

                                // Log progress every ~15 seconds
                                const roundedTime = Math.floor(audio.currentTime);
                                if (roundedTime > 0 && roundedTime % 15 === 0 && (audio.dataset.lastLoggedTime !== String(roundedTime))) {
                                    audio.dataset.lastLoggedTime = String(roundedTime);
                                    logger.add('info', `⏱️ [STREAM PROGRESS] ${audio.currentTime.toFixed(0)}s / ${targetLimit.toFixed(0)}s | Playing: "${current_track.name}"`);
                                }

                                // Auto-advance UI when segment limit reached
                                if (audio.currentTime >= targetLimit && !transitioningRef.current) {
                                    transitioningRef.current = true;
                                    logger.add('event', `⏱️ [AUTO ADVANCE] Segment limit reached (${audio.currentTime.toFixed(1)}s / ${targetLimit.toFixed(1)}s). Advancing UI...`);
                                    if (props.advanceToNextTrack) {
                                        props.advanceToNextTrack();
                                    }
                                    // The stream itself keeps playing — no src change needed for auto-advance
                                    // The server already streams Song A → Host Speech → Song B continuously
                                    setTimeout(() => { transitioningRef.current = false; }, 4000);
                                }
                            }}
                            onPlay={() => logger.add('info', `🔊 [STREAM PLAYING] Started: "${current_track.name}"`)}
                            onPause={() => logger.add('warn', `⏸️ [STREAM PAUSED] Paused at: ${streamAudioRef.current?.currentTime?.toFixed(1)}s`)}
                            onEnded={() => {
                                logger.add('event', `🏁 [STREAM ENDED] Stream ended. Advancing UI...`);
                                if (props.advanceToNextTrack) props.advanceToNextTrack();
                            }}
                            onError={(e) => {
                                const errObj = e.currentTarget.error;
                                const errMsg = errObj ? `Code ${errObj.code}: ${errObj.message}` : 'Unknown HTMLMediaElement error';
                                logger.add('error', `❌ [STREAM AUDIO ERROR] ${errMsg}`);
                            }}
                            onStalled={() => logger.add('warn', `⚠️ [STREAM STALLED] Data stalled for: "${current_track.name}"`)}
                            onWaiting={() => {
                                logger.add('warn', `⏳ [STREAM WAITING] Buffer empty, waiting for data...`);
                                if (streamAudioRef.current && !streamAudioRef.current.paused) {
                                    setTimeout(() => {
                                        if (streamAudioRef.current && streamAudioRef.current.readyState < 3 && !streamAudioRef.current.paused) {
                                            logger.add('info', "🔄 [STREAM RECOVERY] Retrying play on stalled stream...");
                                            streamAudioRef.current.play().catch(err => logger.add('error', `Recovery play failed: ${err.message}`));
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
