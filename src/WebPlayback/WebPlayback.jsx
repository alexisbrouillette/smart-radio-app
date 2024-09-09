import React, { useState, useEffect, useRef } from 'react';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
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
    const playerStarted = useRef(false);
    const player = useRef(null);
    const [current_track, setCurrentTrack] = useState(track);
    const current_track_name = useRef("");


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
        if (webPlayerLoaded() == false) {
            const script = document.createElement("script");
            script.src = "https://sdk.scdn.co/spotify-player.js";
            script.async = true;

            document.body.appendChild(script);

            window.onSpotifyWebPlaybackSDKReady = () => {
                try{
                    player.current = new window.Spotify.Player({
                        name: 'Web Playback SDK',
                        getOAuthToken: cb => {
                                cb(props.token);
                        },
                        volume: 1
                    });
    
                    //setPlayer(player);
                    //player.current = player;
    
                    player.current.addListener('ready', ({ device_id }) => {
                        console.log('Ready with Device ID', device_id);
                    });
    
                    player.current.addListener('not_ready', ({ device_id }) => {
                        console.log('Device ID has gone offline', device_id);
                    });
                    player.current.on('authentication_error', ({ message }) => {
                        console.error('Failed to authenticate', message);
                      });
                    addPlayerStateChangedListener();
    
                    player.current.connect().catch(e => console.error('I suck'));
                    window.addEventListener('beforeunload', () => cleanup());
                }
                catch(e){
                    console.log("im sad");
                    console.log(e);
                }

                return () => {
                    cleanup();
                }

            };
        }

    }, []);

    const addPlayerStateChangedListener = () => {
        player.current.addListener('player_state_changed', (state => {
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
    if (!is_active) { 
        return (
            <>
                <div className="container">
                    <div className="main-wrapper">
                        <b> Instance not active. Transfer your playback using your Spotify app </b>
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
                                <button className="btn-spotify" onClick={() => {toggleTrackPlay()} } >
                                    {
                                        is_paused
                                            ? <PlayArrowIcon fontSize="large" margin={10}/>
                                            : <PauseIcon fontSize="large"  margin={10}/>
                                    }
                                </button>
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
