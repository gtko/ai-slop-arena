import { registerPlugin } from '@capacitor/core';
import { ACHIEVEMENTS } from './achievements.js';

// Google Play Games (Android app only, loaded by main.js): mirrors the achievements to Play.
// The native side is android/app/src/main/java/ch/gtko/aisloparena/PlayGamesPlugin.java.
const Play = registerPlugin('PlayGames');

// Play Console names the id resources after the English achievement names ("Jack of All Slops"
// > achievement_jack_of_all_slops), which is what Play's games-ids.xml contains.
const key = id => 'achievement_' + ACHIEVEMENTS[id].name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
// Incremental on Play: progress bars follow these stats, and reaching the total unlocks them.
const STEPS = { VETERAN: 'MATCHES', CENTURION: 'KOS', CRATE_CRUSHER: 'CRATES', CHAMPION: 'WINS' };

// Resolves to an achievements sink, or null when Play Games is not set up in this build.
export async function setupPlayGames() {
  const info = await Play.info().catch(() => ({ available: false }));
  if (!info.available) return null;
  return {
    achieve(id) { if (!STEPS[id]) Play.unlock({ key: key(id) }).catch(() => {}); },
    setStats(stats) {
      for (const [id, stat] of Object.entries(STEPS)) if (stats[stat] > 0) Play.setSteps({ key: key(id), steps: stats[stat] }).catch(() => {});
    },
    // Play's achievements screen. Signs in first when the automatic sign-in did not happen, then
    // calls onSignedIn (to send what was earned before) and shows the screen.
    async open(onSignedIn) {
      const { signedIn } = await Play.signIn();
      if (!signedIn) return;
      onSignedIn();
      await Play.showAchievements();
    },
  };
}
