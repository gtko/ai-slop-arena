import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { ScreenOrientation } from '@capacitor/screen-orientation';

// Android / iOS only (loaded by platform.js): the game is a landscape, full-screen app.
export async function setupNative() {
  await Promise.allSettled([
    StatusBar.hide(),
    StatusBar.setOverlaysWebView({ overlay: true }),
    ScreenOrientation.lock({ orientation: 'landscape' }),
  ]);
}

// Android back button / back gesture: onBack() returns true when the game used it (closed a
// panel, paused the match); otherwise the app goes to the background instead of quitting,
// so a stray swipe never throws a match away. onHide: the app left the screen.
export function bindAppEvents({ onBack, onHide }) {
  App.addListener('backButton', () => { if (!onBack()) App.minimizeApp(); });
  App.addListener('pause', onHide);
}
