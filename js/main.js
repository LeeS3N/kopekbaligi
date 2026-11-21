import * as THREE from "three";
import { detectQuality, createWorld, updateWorldTime, updateCameraIdle } from "./world.js";
import { preloadActors, loadSharkGltf } from "./actors.js";
import { createGame } from "./sim.js";

const STEPS = [
  "Camlar siliniyor…",
  "Su dolduruluyor…",
  "Kaptan ve İnci uyanıyor…",
  "Işıklar açılıyor…",
];

function setProgress(p, text) {
  const bar = document.getElementById("progbar");
  const el = document.getElementById("progtext");
  if (bar) bar.style.width = Math.round(p * 100) + "%";
  if (el && text) el.textContent = text;
}

async function boot() {
  const canvas = document.getElementById("tank");
  const quality = detectQuality();
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => {
    const p = total ? loaded / total : 0;
    setProgress(0.08 + p * 0.75, STEPS[Math.min(STEPS.length - 1, Math.floor(p * STEPS.length))]);
  };

  setProgress(0.05, STEPS[0]);
  const assetsP = preloadActors(manager);
  const world = await createWorld(canvas, quality, manager);
  setProgress(0.15, STEPS[2]);
  await assetsP;

  let gltf = null;
  try {
    gltf = await loadSharkGltf(world.renderer, manager);
  } catch (e) {
    console.warn(e);
  }

  setProgress(0.92, STEPS[3]);
  const game = createGame(world, gltf);
  window.__world = world;
  window.__game = game;

  // reveal UI
  document.getElementById("loader").classList.add("done");
  document.querySelectorAll(".hidden-until-ready").forEach((el) => el.classList.add("show"));

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const nightT = game.tick(dt);
    updateWorldTime(world, game.state.t, nightT);
    if (!window.__lockCam) updateCameraIdle(world, now, dt);
    world.composer.render();
    world.labels.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById("progtext");
  if (el) el.textContent = "Akvaryum yüklenemedi. Sayfayı yenilemeyi dene.";
});
