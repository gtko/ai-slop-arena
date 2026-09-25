// Server build of src/audio.js: no sound on the server.
const noop = () => {};
export const settings = { master: 0, music: 0, sfx: 0, amb: 0, muted: true, track: 'off' };
export const initAudio = noop, sfx = noop, playMusic = noop, setAmbience = noop, setWeatherBed = noop;
export const setVolume = noop, setMuted = noop, toggleMute = noop, setTrack = noop, duckMusic = noop, setDanger = noop;
