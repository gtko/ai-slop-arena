// The only bridge between the game page and the desktop shell (see main.cjs). Exposed as
// window.desktop; the browser build simply does not have it (src/platform.js).
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = channel => fn => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  quit: () => call('app:quit'),
  fullscreen: v => call('app:fullscreen', v),
  steam: {
    info: () => call('steam:info'),
    takePendingLobby: () => call('steam:take-pending-lobby'),
    // lobbies (friends join these from their Steam friends list or an invite)
    createLobby: opts => call('steam:lobby-create', opts),
    joinLobby: id => call('steam:lobby-join', id),
    findLobby: code => call('steam:lobby-find', code),
    lobbyState: () => call('steam:lobby-state'),
    leaveLobby: () => call('steam:lobby-leave'),
    setLobbyData: (k, v) => call('steam:lobby-set', k, v),
    setJoinable: v => call('steam:lobby-joinable', v),
    invite: () => call('steam:invite'),
    overlay: name => call('steam:overlay', name),
    onLobby: subscribe('steam:lobby'),
    onJoinRequested: subscribe('steam:join-requested'),
    // P2P (Steam relays the traffic, no port forwarding, no server of ours)
    send: (to, text, reliable) => ipcRenderer.send('steam:send', to, text, reliable),
    onPackets: subscribe('steam:packets'),
    // achievements, stats, rich presence
    achieve: name => call('steam:achieve', name),
    achieved: name => call('steam:achieved', name),
    setStats: values => call('steam:stats', values),
    presence: values => call('steam:presence', values),
  },
});
