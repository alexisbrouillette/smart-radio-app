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
    const allTracks = [track];
    if (queue && Array.isArray(queue)) {
        allTracks.push(...queue);
    }
    const trackNames = allTracks.map(t => `${t.name} ${t.artists[0]?.name || ''}`);
    const trackIds = allTracks.map(t => t.id || '');
    const tracksParam = `tracks=${encodeURIComponent(trackNames.join('|||'))}`;
    const trackIdsParam = `&trackIds=${encodeURIComponent(trackIds.join('|||'))}`;

    const activeRadioItem = radioItems && radioItems.length > 0
        ? radioItems.find(item => item.beforeTrackId === track.id)
        : null;
    const hostTextParam = activeRadioItem
        ? `&hostText=${encodeURIComponent(activeRadioItem.text)}`
        : '';

    return `${API_BASE}/stream/live.mp3?ngrok-skip-browser-warning=true&${tracksParam}${trackIdsParam}${hostTextParam}`;
}

function WebPlayback(props) {
    const [isPlaying, setIsPlaying] = useState(true);
    const streamAudioRef = useRef(null);
    const transitioningRef = useRef(false);
    // Track the current stream URL in a ref so it's stable across renders
    const sessionStreamUrlRef = useRef('');
    const [sessionStreamUrl, setSessionStreamUrl] = useState('');

    const current_track = props.currentTrack || defaultTrack;

    const segmentIndexRef = useRef(0);
    const cumulativeBoundariesRef = useRef([]);

    // ── Core imperative function: load a new track stream into the audio element ──
    const loadTrackIntoStream = useCallback((track, queue, radioItems) => {
        if (!track || !track.name) return;
        segmentIndexRef.current = 0;
        
        // Calculate cumulative segment boundaries for all tracks in this stream session
        const allTracks = [track];
        if (queue && Array.isArray(queue)) {
            allTracks.push(...queue);
        }

        let runningTotal = 0;
        const boundaries = allTracks.map((trk) => {
            const songSec = (trk.duration_ms || 180000) / 1000;
            const activeRadio = radioItems && radioItems.find(item => item.beforeTrackId === trk.id);
            const speechSec = activeRadio ? 10 : 0;
            runningTotal += (songSec + speechSec);
            return runningTotal;
        });

        cumulativeBoundariesRef.current = boundaries;

        const url = buildStreamUrl(track, queue, radioItems);
        sessionStreamUrlRef.current = url;
        setSessionStreamUrl(url);
        logger.add('info', `📻 [CONTINUOUS STREAM LOAD] Loading stream for: "${track.name}" with ${queue?.length || 0} queued tracks. Total calculated stream boundaries: ${boundaries.length}`);

        const audio = streamAudioRef.current;
        if (audio) {
            audio.src = url;
            audio.play().catch(err => {
                if (err.name !== 'AbortError') {
                    logger.add('warn', `▶️ [STREAM PLAY ERR] ${err.name}: ${err.message}`);
                }
            });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Initialize stream once when the first track arrives ──
    useEffect(() => {
        if (props.currentTrack && !sessionStreamUrlRef.current) {
            loadTrackIntoStream(props.currentTrack, props.queue, props.radioItems);
        }
    }, [props.currentTrack, props.queue, props.radioItems, loadTrackIntoStream]);



    // ── Update MediaSession lock screen metadata ──
    const updateMediaSession = useCallback((track) => {
        if (!('mediaSession' in navigator) || !track || !track.name) return;
        try {
            const images = track.album?.images?.map(img => ({
                src: img.url,
                sizes: `${img.width || 512}x${img.height || 512}`,
                type: 'image/jpeg'
            })) || [];

            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: track.name,
                artist: track.artists?.[0]?.name || "Smart Radio Host",
                album: track.album?.name || "Smart Radio Station",
                artwork: images
            });
            navigator.mediaSession.playbackState = 'playing';
            logger.add('info', `📱 [LOCK SCREEN UPDATED] "${track.name}" - ${track.artists?.[0]?.name || 'Artist'}`);
        } catch (e) {
            console.error("MediaSession update error:", e);
        }
    }, []);

    useEffect(() => {
        if (current_track.name) {
            updateMediaSession(current_track);
        }
    }, [current_track, updateMediaSession]);

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
            try {
                navigator.mediaSession.setActionHandler('play', () => handlePlayPauseToggle());
                navigator.mediaSession.setActionHandler('pause', () => handlePlayPauseToggle());
                navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
                navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevious());
            } catch (e) {}
        }
        if (current_track.name) {
            updateMediaSession(current_track);
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
                                const currentTime = audio.currentTime;
                                const boundaries = cumulativeBoundariesRef.current;
                                const currentIdx = segmentIndexRef.current;

                                // Log progress every ~15 seconds
                                const roundedTime = Math.floor(currentTime);
                                if (roundedTime > 0 && roundedTime % 15 === 0 && (audio.dataset.lastLoggedTime !== String(roundedTime))) {
                                    audio.dataset.lastLoggedTime = String(roundedTime);
                                    const nextBoundary = boundaries[currentIdx] || 0;
                                    logger.add('info', `⏱️ [STREAM PROGRESS] ${currentTime.toFixed(0)}s (Next boundary: ${nextBoundary.toFixed(0)}s) | Segment #${currentIdx + 1}`);
                                }

                                // Advance UI card whenever stream audio reaches next track boundary
                                if (currentIdx < boundaries.length && currentTime >= boundaries[currentIdx] && !transitioningRef.current) {
                                    transitioningRef.current = true;
                                    segmentIndexRef.current += 1;
                                    logger.add('event', `⏱️ [UI SYNC ADVANCE] Audio reached boundary #${currentIdx + 1} (${currentTime.toFixed(1)}s / ${boundaries[currentIdx].toFixed(1)}s). Advancing UI card.`);
                                    if (props.advanceToNextTrack) {
                                        props.advanceToNextTrack();
                                    }
                                    setTimeout(() => { transitioningRef.current = false; }, 4000);
                                }
                            }}
                            onPlay={() => logger.add('info', `🔊 [STREAM PLAYING] Started continuous broadcast`)}
                            onPause={() => logger.add('warn', `⏸️ [STREAM PAUSED] Paused at: ${streamAudioRef.current?.currentTime?.toFixed(1)}s`)}
                            onEnded={() => {
                                logger.add('event', `🏁 [STREAM ENDED] Full queue stream finished.`);
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
