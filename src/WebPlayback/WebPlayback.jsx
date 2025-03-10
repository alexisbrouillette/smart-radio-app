import React, { useState, useEffect, useRef } from 'react';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { Button } from '@chakra-ui/react';
import {playOnSDK} from '../network/spotify';
import "./style.css";

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
        alert("cleanup");
        if (player){
            player.removeListener("ready");
            player.removeListener("not_ready");
            player.removeListener("player_state_changed");
            player.disconnect();
        }
            
    }

    const webPlayerLoaded = () => {
        let scripts = document.getElementsByTagName('script');
        for (let i = scripts.length; i--;) {
            if (scripts[i].src == "https://sdk.scdn.co/spotify-player.js") return true;
        }
        return false;
    }

    useEffect(() => {
        console.log("webPlayerMounted");
        window.ReactNativeWebView.postMessage("webPlayerMounted");
        const initializePlayer = () => {
            window.ReactNativeWebView.postMessage("initializePlayer");
            try {
                window.ReactNativeWebView.postMessage(window.Spotify);
                player.current = new window.Spotify.Player({
                    name: 'Web Playback SDK',
                    getOAuthToken: cb => {
                        cb(props.token);
                    },
                    volume: 1,
                    debug: true
                });
                window.ReactNativeWebView.postMessage("player created");
                player.current.addListener('ready', ({ device_id }) => {
                    console.log('Ready with Device ID', device_id);
                    window.ReactNativeWebView.postMessage("Ready with Device ID: " + device_id);
                    setDeviceId(device_id);
                });

                player.current.addListener('not_ready', ({ device_id }) => {
                    console.log('Device ID has gone offline', device_id);
                    window.ReactNativeWebView.postMessage("Device ID has gone offline: " + device_id);
                });

                player.current.addListener('autoplay_failed', () => {
                    alert('Autoplay is not allowed by the browser autoplay rules');
                    window.ReactNativeWebView.postMessage("Autoplay is not allowed by the browser autoplay rules");
                });

                player.current.on('initialization_error', ({ message }) => {
                    console.error('Failed to initialize', message);
                    window.ReactNativeWebView.postMessage("Failed to initialize: " + message);
                    initializePlayer();
                });

                player.current.on('authentication_error', ({ message }) => {
                    console.error('Failed to authenticate', message);
                    window.ReactNativeWebView.postMessage("Failed to authenticate: " + message);
                    initializePlayer();
                });

                addPlayerStateChangedListener();

                player.current.connect().catch(e => console.error('I suck'));
                window.addEventListener('beforeunload', () => cleanup());
            } catch (e) {
                console.log("im sad");
                window.ReactNativeWebView.postMessage("im sad");
                console.log(e);
                window.ReactNativeWebView.postMessage(e);
            }
        };

        if (webPlayerLoaded() == false) {
            const script = document.createElement("script");
            window.ReactNativeWebView.postMessage("injecting script" + script.src);
            window.ReactNativeWebView.postMessage("Spotify: " + window.Spotify);
            script.src = "https://sdk.scdn.co/spotify-player.js";
            window.ReactNativeWebView.postMessage("script.src: " + script.src);
            window.ReactNativeWebView.postMessage("Spotify: " + window.Spotify);
            script.async = true;

            document.body.appendChild(script);

            window.onSpotifyWebPlaybackSDKReady = () => {
                console.log("onSpotifyWebPlaybackSDKReady");
                window.ReactNativeWebView.postMessage("onSpotifyWebPlaybackSDKReady");
                initializePlayer();
            };
        } else {
            initializePlayer();
        }

        return () => {
            cleanup();
        };
    }, []);

    const addPlayerStateChangedListener = () => {
        player.current.addListener('player_state_changed', (state => {
            window.ReactNativeWebView.postMessage("player_state_changed");
            if (!state) {
                return;
            }
            if (state.track_window.current_track.name != current_track_name.current) {
                current_track_name.current = state.track_window.current_track.name;
                props.onPlayerChange(state.track_window.current_track, player);
                setCurrentTrack(state.track_window.current_track);
            }

            player.current.getCurrentState().then(state => {
                if (!state)
                    setActive(false);
                else if (!playerStarted.current) {
                    setActive(true);
                    playerStarted.current = true;
                    props.sdkPlayerStarted(player);
                }
                //(!state) ? setActive(false) : setActive(true);

            });

        }));
    }

    const initializeAudioContext = () => {
        console.log("initializeAudioContext: ", audioContext.current);
        window.ReactNativeWebView.postMessage("initializeAudioContext: " + audioContext.current);
        if (!audioContext.current) {
            audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.current.createOscillator();
            const gainNode = audioContext.current.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(440, audioContext.current.currentTime);
            gainNode.gain.setValueAtTime(0.1, audioContext.current.currentTime);
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.current.destination);
            oscillator.start();
            lowVolumeSound.current = oscillator;
        }
    }

    useEffect(() => {
        if (player.current) {
            player.current.removeListener("player_state_changed");
            addPlayerStateChangedListener();
        }
    }, [player.current, props.queue, props.radioItems]);//needs to reattach the listener so the state is updated inside the callack for the listener

    const toggleTrackPlay = () => {
        player.current.togglePlay();
        setPaused(!is_paused);
    }
    const pause = () => {
        console.log("pause");
        window.ReactNativeWebView.postMessage("pause");
        player.current.pause();
        setPaused(true);
    }
    const play = () => {
        console.log("play");
        window.ReactNativeWebView.postMessage("play");
        player.current.resume();
        setPaused(false);
    }

    const startRadio = async () => {
        initializeAudioContext();
        await playOnSDK(deviceId);
        if (player.current) {
            player.current.activateElement();
            player.current.resume();
            setPaused(false);
        }
    }
    if (!is_active) { 
        return (
            <>
                <div className="container">
                    <div className="main-wrapper">
                        
                        <b style={{whiteSpace: "pre-line", color: "white"}}> { `Hi! Thanks for trying my app:) \n 
                                Please before clicking this sweet button, make sure you have started a playlist in your Spotify app.\n
                                This is really early stage so things might break. \n
                                If you think of any upgrades or want to report bugs, please do!\n
                                Enjoy it:)\n
                        `} </b>
                        <Button
                            colorScheme='blue'
                            onClick={() => startRadio()}
                            isLoading={deviceId == ""}
                            loadingText='Gimme a sec'>
                            Start!
                        </Button>
                    </div>
                </div>
            </>)
    } else {
        return (
            <>
                <div className="container">
                    <div className="main-wrapper">

                        <img src={current_track.album.images[0].url} className="now-playing__cover" alt="" />

                        <div className="now-playing__side">
                            <div className="now-playing__name">{current_track.name}</div>
                            <div className="now-playing__artist">{current_track.artists[0].name}</div>

                            {/* <button className="btn-spotify" onClick={() => { player.current.previousTrack() }} >
                                &lt;&lt;
                            </button> */}
                            <div className='btn-spotify-container'>
                                {is_paused ? 
                                 <button className="btn-spotify" onClick={() => play() } >
                                    <PlayArrowIcon fontSize="large"  margin={10}/> 
                                 </button>
                                
                                : 
                                <button className="btn-spotify" onClick={() => pause() } >
                                    <PauseIcon fontSize="large"  margin={10}/> 
                                 </button>
    }
                                <button className="btn-spotify" onClick={() => { player.current.nextTrack() }} >
                                    <SkipNextIcon fontSize="large"/>
                                </button>
                            </div>




                        </div>
                    </div>
                </div>
            </>
        );
    }
}

export default WebPlayback
