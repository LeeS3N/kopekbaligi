import * as THREE from "three";
import { detectQuality, QUALITY_KEY, createWorld, updateWorldTime, updateCameraIdle } from "./world.js";
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

function bindQualitySelect() {
  const sel = document.getElementById("quality-select");
  if (!sel) return;
  let stored = "auto";
  try { stored = localStorage.getItem(QUALITY_KEY) || "auto"; } catch (e) {}
  if (["auto", "ultra", "high", "medium"].includes(stored)) sel.value = stored;
  sel.addEventListener("change", () => {
    try { localStorage.setItem(QUALITY_KEY, sel.value); } catch (e) {}
    location.reload();
  });
}

async function boot() {
  bindQualitySelect();
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
  window.__quality = quality;

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
