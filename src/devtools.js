import * as THREE from 'three';
import { figurineInfo } from './figurines.js';

// Dev-only helpers for poking at the game from the console / automated checks (loaded by main.js
// only under `vite dev`). The browser pane throttles rAF, so these drive the loop by hand.
//   __dev.setup('blaster', 1)   solo match on map #1 with that brawler, bots frozen, loop stopped
//   __dev.run(60)               advance 60 frames
//   __dev.isolate()             hide the bots, put the player in the most open spot
//   __dev.pose(phase, amp, aim, recoil, facing, yaw, dist, h)   freeze a figurine pose + close-up
//   __dev.weights(true)         colour the player's figurine by bone

export function installDevtools(A) {
  let ts = performance.now();
  const player = () => A.game.brawlers.find(b => b.isPlayer);
  const dev = {
    run(n = 1) { for (let i = 0; i < n; i++) { ts += 1000 / 60; A.frame(ts); } },
    setup(type = 'blaster', mapIndex = 1) {
      [...document.querySelectorAll('.card')].find(c => c.textContent.toLowerCase().includes(type))?.click();
      [...document.querySelectorAll('#maps > *')][mapIndex]?.click();
      document.querySelector('#play').click();
      A.renderer.setAnimationLoop(null);
      A.timer.disconnect(); // manual stepping must advance even while the pane is hidden
      ts = performance.now(); // never behind the game clock: a negative dt blows up the camera
      A.game.brains.clear();
      dev.run(30);
      return A.game.brawlers.map(b => b.type.key);
    },
    openSpot() {
      const ar = A.game.arena, G = ar.grid;
      let best = null, bs = -1;
      for (let j = 2; j < G.length - 2; j++) for (let i = 2; i < G[0].length - 2; i++) {
        if (G[j][i] !== '.') continue;
        let sc = 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (G[j + dj][i + di] === '.') sc++;
        if (sc > bs) { bs = sc; best = [i, j]; }
      }
      const v = new THREE.Vector3();
      ar.center(best[0], best[1], v);
      return v;
    },
    isolate() {
      const p = player(), v = dev.openSpot();
      A.game.brawlers.forEach(b => { if (b !== p) b.setVisible(false); });
      p.pos.set(v.x, 0, v.z);
      p.vel.set(0, 0, 0);
      dev.run(90);
      p.pos.set(v.x, 0, v.z);
      return p.pos.toArray();
    },
    lineup() {
      const v = dev.openSpot();
      A.game.brawlers.forEach((b, k) => { b.setVisible(true); b.pos.set(v.x - 4 + (k % 4) * 2.6, 0, v.z - 1 + Math.floor(k / 4) * 2.6); b.facing = 0; });
      dev.run(90);
    },
    // renders right away (a hidden pane never fires requestAnimationFrame)
    close(dist = 5, yaw = 0, h = 0.3, target = player()) {
      const c = A.camera, p = target.pos;
      c.position.set(p.x + Math.sin(yaw) * dist, dist * h + 1.1, p.z + Math.cos(yaw) * dist);
      c.lookAt(p.x, 1.1, p.z);
      A.composer.render();
      document.body.style.outline = document.body.style.outline ? '' : '0px solid transparent'; // forces a composite so screenshots refresh
      return 'ok';
    },
    pose(phase = 0, amp = 0, aim = 0, recoil = 0, facing = 0.9, yaw = 1.6, dist = 4.5, h = 0.3) {
      const p = player();
      Object.assign(p, { walkAmp: amp, walkPhase: phase, aimHold: aim, recoil });
      p.root.rotation.y = facing;
      p.poseFigurine(1);
      p.root.updateMatrixWorld(true);
      return dev.close(dist, yaw, h);
    },
    weights(on = true) {
      const m = player().model.mesh;
      if (!on) { if (m.userData.mat) { m.material = m.userData.mat; m.geometry = m.userData.geo; } return; }
      const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const pal = [[1, 1, 1], [1, 0.5, 0], [1, 1, 0], [0, 0.8, 1], [1, 0, 0], [0.5, 0, 0], [0, 1, 0], [0, 0.45, 0], [1, 0, 1], [0.5, 0, 0.6], [0, 0, 1], [0.3, 0.6, 1]];
      const col = new Float32Array(si.count * 3);
      for (let i = 0; i < si.count; i++) for (let j = 0; j < 4; j++) {
        const c = pal[si.getComponent(i, j)], w = sw.getComponent(i, j);
        col[i * 3] += c[0] * w; col[i * 3 + 1] += c[1] * w; col[i * 3 + 2] += c[2] * w;
      }
      m.userData.mat = m.material; m.userData.geo = g;
      m.geometry = g.clone();
      m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    },
    // joint fit of a figurine, heights as fractions of the model height
    joints(key = 'blaster') {
      const J = figurineInfo(key)?.joints;
      if (!J) return null;
      const f = v => +(v / 2.5).toFixed(3), prof = e => Array.from(e).filter((_, b) => b % 4 === 0 && b < 64).map(f).join(' ');
      return { crotch: f(J.crotch), knee: f(J.knee), neck: f(J.neck), shoulder: f(J.shoulderY), elbow: f(J.elbow), cut: J.cutFaces, L: prof(J.edge.L), R: prof(J.edge.R) };
    },
    info: figurineInfo, // raw template (geo, joints) of a figurine

    // Film from the renderer at a fixed size (independent of the window), saving JPEG frames through
    // the dev server's /__capture endpoint (vite.config.js) into .ai3d/capture/<dir>/.
    //   shots: [{ map, tod, warm, frames, camera(cam, u, game), setup(game) }]
    async film(shots, { w = 1920, h = 1080, fps = 30, dir = 'trailer', quality = 0.9, offset = 0 } = {}) {
      A.renderer.setAnimationLoop(null);
      A.timer.disconnect();
      ts = Math.max(ts, performance.now());
      document.querySelectorAll('.overlay, #hud').forEach(el => el.classList.add('hidden'));
      dev.frameSize(w, h);
      let n = offset; // first frame number (re-recording a shot in place)
      for (const shot of shots) {
        if (shot.map) { A.game.newMatch({ mapKey: shot.map }); }
        if (shot.tod !== undefined) A.lighting.setPreset(shot.tod, true);
        shot.setup?.(A.game);
        // the shot's camera already runs while the simulation warms up (u = 0)
        A.game.cinematic = (cam, dt) => shot.camera(cam, 0, A.game, dt);
        for (let i = 0; i < (shot.warm || 0); i++) { ts += 1000 / fps; A.frame(ts); }
        for (let f = 0; f < shot.frames; f++) {
          const u = shot.frames > 1 ? f / (shot.frames - 1) : 0;
          A.game.cinematic = (cam, dt) => shot.camera(cam, u, A.game, dt);
          ts += 1000 / fps;
          A.frame(ts);
          await dev.save(`${dir}/f${String(n++).padStart(5, '0')}.jpg`, quality);
        }
      }
      A.game.cinematic = null;
      return n;
    },
    frameSize(w, h) {
      A.renderer.setPixelRatio(1);
      A.renderer.setSize(w, h, false);
      A.composer.setPixelRatio(1);
      A.composer.setSize(w, h);
      A.camera.aspect = w / h;
      A.camera.updateProjectionMatrix();
    },
    // the drawing buffer is still valid right after A.frame() in the same task
    save(path, quality = 0.9) {
      return new Promise(resolve => A.renderer.domElement.toBlob(blob =>
        fetch(`/__capture/${path}`, { method: 'POST', body: blob }).then(resolve), 'image/jpeg', quality));
    },
    // one still: set up, warm the simulation, frame with camera(cam, 0, game), save
    async still(path, shot, { w = 1600, h = 900 } = {}) {
      await dev.film([{ ...shot, frames: 1 }], { w, h, dir: '_still' });
      A.game.cinematic = cam => shot.camera(cam, 0, A.game);
      ts += 1000 / 30;
      A.frame(ts);
      A.game.cinematic = null;
      return dev.save(path, 0.92);
    },
    errors: [],
  };
  const oe = console.error;
  console.error = (...a) => { dev.errors.push(String(a[0]).slice(0, 300)); oe(...a); };
  window.__dev = dev;
}
