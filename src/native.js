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
