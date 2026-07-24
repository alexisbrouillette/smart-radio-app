import React, { useState, useEffect, useRef } from 'react';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { Button } from '@chakra-ui/react';
import { playOnSDK, getTokenFromrefreshToken } from '../network/spotify';
import { currentToken } from '../spotifyTokenHandling';
import "./style.css";

import { logger } from '../components/DebugConsole';

const track = {
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
    const [deviceId, setDeviceId] = useState("");
    const playerStarted = useRef(false);
    const player = useRef(null);
    const [current_track, setCurrentTrack] = useState(track);
    const current_track_name = useRef("");
    const audioContext = useRef(null);
    const lowVolumeSound = useRef(null);

    const cleanup = () => {
        logger.add('warn', "Cleanup triggered - disconnecting WebPlayback player");
        if (player.current){
            try {
                player.current.removeListener("ready");
                player.current.removeListener("not_ready");
                player.current.removeListener("player_state_changed");
                player.current.disconnect();
            } catch (e) {
                logger.add('error', `Cleanup error: ${e}`);
            }
        }
    }

    const webPlayerLoaded = () => {
        let scripts = document.getElementsByTagName('script');
        for (let i = scripts.length; i--;) {
            if (scripts[i].src === "https://sdk.scdn.co/spotify-player.js") return true;
        }
        return false;
    }

    useEffect(() => {
        console.log("webPlayerMounted");
        
        const initializePlayer = () => {
            try {
                player.current = new window.Spotify.Player({
                    name: 'Web Playback SDK',
                    getOAuthToken: async cb => {
                        try {
                            const res = await getTokenFromrefreshToken();
                            if (res && res.access_token) {
                                currentToken.save(res);
                                cb(res.access_token);
                            } else {
                                cb(currentToken.access_token || props.token);
                            }
                        } catch (e) {
                            cb(currentToken.access_token || props.token);
                        }
                    },
                    volume: 1
                });

                player.current.addListener('ready', async ({ device_id }) => {
                    logger.add('event', `Player ready with Device ID: ${device_id}`);
                    setDeviceId(device_id);
                    if (playerStarted.current) {
                        logger.add('event', "Auto-resuming active playback on device reconnect...");
                        try {
                            await playOnSDK(device_id);
                            if (player.current) {
                                player.current.activateElement();
                                player.current.resume();
                            }
                        } catch (err) {
                            logger.add('error', `Auto-resume error: ${err}`);
                        }
                    }
                });

                player.current.addListener('not_ready', ({ device_id }) => {
                    logger.add('warn', `Player gone offline (Device ID: ${device_id})`);
                });

                player.current.addListener('autoplay_failed', () => {
                    logger.add('warn', "Autoplay failed by browser autoplay policy");
                });

                player.current.on('initialization_error', ({ message }) => {
                    logger.add('error', `Initialization error: ${message}`);
                    initializePlayer();
                });

                player.current.on('authentication_error', async ({ message }) => {
                    logger.add('error', `Authentication error: ${message}. Refreshing token...`);
                    try {
                        if (player.current) {
                            try { player.current.disconnect(); } catch (err) {}
                        }
                        const res = await getTokenFromrefreshToken();
                        if (res && res.access_token) {
                            currentToken.save(res);
                            logger.add('event', "Token refreshed successfully. Reconnecting player...");
                            initializePlayer();
                        } else {
                            logger.add('error', "Token refresh returned no access token");
                        }
                    } catch (e) {
                        logger.add('error', `Token refresh failed: ${e}`);
                    }
                });

                addPlayerStateChangedListener();

                player.current.connect().catch(e => logger.add('error', `Connect error: ${e}`));
                window.addEventListener('beforeunload', () => {
                    logger.add('warn', "beforeunload window event triggered");
                    cleanup();
                });

                // Proactive Keep-Alive Heartbeat: Pings Spotify SDK every 15s to keep WebSocket session alive
                const heartbeatInterval = setInterval(() => {
                    if (player.current) {
                        player.current.getCurrentState().then(state => {
                            if (state) {
                                logger.add('info', "Heartbeat ping sent to Spotify SDK (session active)");
                            }
                        }).catch(() => {});
                    }
                }, 15000);

                // Background Token Refresh: Refresh OAuth token proactively every 30 mins to prevent token drops
                const tokenRefreshInterval = setInterval(async () => {
                    try {
                        logger.add('info', "Proactively refreshing Spotify OAuth token...");
                        const res = await getTokenFromrefreshToken();
                        if (res && res.access_token) {
                            currentToken.save(res);
                            logger.add('event', "OAuth token proactively refreshed");
                        }
                    } catch (err) {
                        logger.add('warn', `Proactive token refresh error: ${err}`);
                    }
                }, 30 * 60 * 1000);

                return () => {
                    clearInterval(heartbeatInterval);
                    clearInterval(tokenRefreshInterval);
                };
            } catch (e) {
                logger.add('error', `Initialization Exception: ${e}`);
            }
        };

        if (webPlayerLoaded() === false) {
            const script = document.createElement("script");
            script.src = "https://sdk.scdn.co/spotify-player.js";
            script.async = true;

            document.body.appendChild(script);

            window.onSpotifyWebPlaybackSDKReady = () => {
                logger.add('info', "onSpotifyWebPlaybackSDKReady event received");
                initializePlayer();
            };
        } else {
            initializePlayer();
        }

        return () => {
            cleanup();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const addPlayerStateChangedListener = () => {
        player.current.addListener('player_state_changed', (state => {
            if (!state) {
                logger.add('warn', "player_state_changed received null state");
                return;
            }
            if (state.track_window.current_track.name !== current_track_name.current) {
                logger.add('event', `Track changed to: ${state.track_window.current_track.name}`);
                current_track_name.current = state.track_window.current_track.name;
                props.onPlayerChange(state.track_window.current_track, player);
                setCurrentTrack(state.track_window.current_track);
            }

            player.current.getCurrentState().then(state => {
                if (state && !playerStarted.current) {
                    logger.add('event', "Player started playing active track");
                    setActive(true);
                    playerStarted.current = true;
                    props.sdkPlayerStarted(player);
                } else if (!state) {
                    logger.add('warn', "getCurrentState() returned null");
                }
            });

        }));
    }

    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
                console.log("Screen Wake Lock acquired");
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

    useEffect(() => {
        if (player.current) {
            player.current.removeListener("player_state_changed");
            addPlayerStateChangedListener();
        }
        initializeAudioContext();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleTrackPlay = () => { // eslint-disable-line no-unused-vars
        player.current.togglePlay();
        setPaused(!is_paused);
    }
    const pause = () => {
        console.log("pause");
        player.current.pause();
        setPaused(true);
    }
    const play = () => {
        console.log("play");
        player.current.resume();
        setPaused(false);
    }

    const startRadio = async () => {
        await playOnSDK(deviceId);
        if (player.current) {
            player.current.activateElement();
            player.current.resume();
            setPaused(false);
        }
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
                        onClick={() => startRadio()}
                        isLoading={deviceId === ""}
                        loadingText='Locating Spotify...'>
                        Launch AI Host
                    </Button>
                </div>
            </div>
        );
    } else {
        return (
            <div className="glass-panel player-container">
                <img src={current_track.album.images[0].url} className="now-playing__cover" alt="Album Cover" />

                <div className="now-playing__side">
                    <div className="now-playing__name">{current_track.name}</div>
                    <div className="now-playing__artist">{current_track.artists[0].name}</div>

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
                        <button className="btn-spotify" onClick={() => { player.current.nextTrack() }} >
                            <SkipNextIcon fontSize="large"/>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default WebPlayback
