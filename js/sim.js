import * as THREE from "three";
import { TANK, tankBounds, setDayNight } from "./world.js";
import {
  createSharkActor, playBite, updateSharkVisual,
  createKelp, createFishSchool, updateFish, createReefScenery,
  createBubbles, updateBubbles, createSnow, updateSnow,
  makeDecoration, updateJellies, createFoodMesh, createHeartSprite, createFeedBurst, updateFeedBursts,
} from "./actors.js";

export const SAVE_KEY = "askAkvaryumu:v1";

export const FOODS = [
  { id: "krill", name: "Kril", price: 0, hunger: 14, happy: 4, love: 0, coins: 2, color: "#e07a5f", hint: "Hafif atıştırmalık" },
  { id: "fish", name: "Küçük Balık", price: 5, hunger: 28, happy: 8, love: 1, coins: 5, color: "#f2cc8f", hint: "Doyurucu ve taze" },
  { id: "mackerel", name: "Palamut", price: 12, hunger: 50, happy: 14, love: 3, coins: 9, color: "#8eb4c8", hint: "Ziyafet gibi" },
  { id: "treat", name: "Aşk Lokması", price: 18, hunger: 32, happy: 18, love: 12, coins: 7, color: "#f080a0", hint: "Kalpleri ısıtır" },
];

export const DECORS = [
  { id: "coral", name: "Mercan Bahçesi", price: 45, desc: "Sıcak renkli mercan kümesi, tabanda durur." },
  { id: "kelp", name: "Yosun Koruluğu", price: 35, desc: "Ekstra uzun, salınan yosunlar." },
  { id: "starfish", name: "Deniz Yıldızı", price: 25, desc: "Kumun üstünde duran turuncu bir yıldız." },
  { id: "column", name: "Antik Sütun", price: 60, desc: "Yosun tutmuş mermer bir sütun." },
  { id: "oyster", name: "İnci İstiridyesi", price: 70, desc: "Arada bir incisini açar, parıldar." },
  { id: "chest", name: "Hazine Sandığı", price: 85, desc: "Yarı açık sandık, altın ışıltısı." },
  { id: "jelly", name: "Denizanası Lambası", price: 95, desc: "Yavaşça süzülen ışıklı denizanaları." },
  { id: "castle", name: "Mini Kale", price: 130, desc: "Akvaryumun gururu, taş bir şato." },
];

const HUNGER_PER_SEC = 100 / (3.6 * 3600);
const HAPPY_PER_SEC = 100 / (6 * 3600);
const LOVE_PER_SEC = 100 / (10 * 3600);

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

export function createAudio() {
  return {
    ctx: null, master: null, started: false, muted: false,
    start() {
      if (this.started) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.2;
      this.master.connect(this.ctx.destination);
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr * 4, sr);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + 0.018 * (Math.random() * 2 - 1)) / 1.018;
        data[i] = last * 3.2;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass"; filter.frequency.value = 480;
      const ng = this.ctx.createGain(); ng.gain.value = 0.32;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 160;
      lfo.connect(lfoG); lfoG.connect(filter.frequency);
      src.connect(filter); filter.connect(ng); ng.connect(this.master);
      src.start(); lfo.start();
      const drone = this.ctx.createOscillator();
      drone.type = "sine"; drone.frequency.value = 46;
      const dg = this.ctx.createGain(); dg.gain.value = 0.035;
      drone.connect(dg); dg.connect(this.master); drone.start();
      this.started = true;
      const loop = () => {
        setTimeout(() => { if (!this.muted) this.pop(); loop(); }, rand(900, 2600));
      };
      loop();
    },
    setMuted(m) {
      this.muted = m;
      if (this.master) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.linearRampToValueAtTime(m ? 0 : 0.2, t + 0.12);
      }
    },
    _tone(freq, dur, type, gain, slide) {
      if (!this.started || this.muted) return;
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), c.currentTime + dur);
      f.type = "lowpass"; f.frequency.value = freq * 3;
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(); o.stop(c.currentTime + dur + 0.05);
    },
    pop() { this._tone(rand(520, 880), 0.16, "sine", 0.03, rand(180, 320)); },
    eat() { this._tone(140, 0.12, "triangle", 0.07, 70); this._tone(rand(400, 600), 0.14, "sine", 0.025, 200); },
    kiss() { this._tone(392, 0.35, "sine", 0.05, 392); setTimeout(() => this._tone(494, 0.45, "sine", 0.045, 494), 120); },
    drop() { this._tone(240, 0.08, "sine", 0.025, 140); },
  };
}

export function defaultSpecs() {
  return [
    { name: "Kaptan", gender: "m", hunger: 86, happiness: 74, love: 58 },
    { name: "İnci", gender: "f", hunger: 84, happiness: 76, love: 62 },
  ];
}

export function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); }
  catch { return null; }
}

function applyOfflineDecay(sharks, elapsedMs) {
  const sec = Math.max(0, Math.min(elapsedMs / 1000, 7 * 86400));
  sharks.forEach((s) => {
    s.hunger = clamp(s.hunger - sec * HUNGER_PER_SEC, 0, 100);
    let happyLoss = sec * HAPPY_PER_SEC;
    if (s.hunger < 30) happyLoss *= 1.8;
    s.happiness = clamp(s.happiness - happyLoss, 5, 100);
    const loveLoss = sec * LOVE_PER_SEC * (s.hunger < 40 || s.happiness < 40 ? 1.6 : 0.45);
    s.love = clamp(s.love - loveLoss, 8, 100);
  });
}

export function createGame(world, gltf) {
  const audio = createAudio();
  const state = {
    night: false,
    nightT: 0,
    muted: false,
    coins: 55,
    selectedFood: "krill",
    owned: {},
    feedCount: 0,
    kissCount: 0,
    bornAt: Date.now(),
    seenIntro: false,
    foods: [],
    hearts: [], bursts: [],
    kissCool: 8,
    kissing: 0,
    t: 0,
  };

  const data = loadSave();
  const specs = defaultSpecs();
  if (data) {
    state.coins = data.coins ?? 55;
    state.owned = data.owned || {};
    state.night = !!data.night;
    state.nightT = state.night ? 1 : 0;
    state.muted = !!data.muted;
    audio.muted = state.muted;
    state.selectedFood = data.selectedFood || "krill";
    state.feedCount = data.feedCount || 0;
    state.kissCount = data.kissCount || 0;
    state.bornAt = data.bornAt || Date.now();
    state.seenIntro = !!data.seenIntro;
    if (data.names) {
      specs[0].name = data.names[0] || specs[0].name;
      specs[1].name = data.names[1] || specs[1].name;
    }
    if (data.sharks) {
      data.sharks.forEach((s, i) => {
        if (!specs[i]) return;
        specs[i].hunger = s.hunger;
        specs[i].happiness = s.happiness;
        specs[i].love = s.love;
      });
    }
    applyOfflineDecay(specs, Date.now() - (data.last || Date.now()));
  }

  const sharks = specs.map((sp, i) => {
    const actor = createSharkActor({ ...sp, id: i, x: i ? 0.55 : -0.55, y: 0.95, z: 0.05 }, gltf, world.uniforms, i === 0 ? 1.22 : 1.08);
    world.interior.add(actor.pivot);
    return actor;
  });

  const reef = createReefScenery(world.quality, world.uniforms);
  world.interior.add(reef);
  const kelp = createKelp(world.quality, world.uniforms);
  world.interior.add(kelp);
  const fish = createFishSchool(world.quality, world.uniforms);
  world.interior.add(fish.group);
  const bubbles = createBubbles(world.quality);
  world.interior.add(bubbles.inst);
  const snow = createSnow(world.quality);
  world.interior.add(snow);

  const decorMeshes = {};
  Object.keys(state.owned).forEach((id) => {
    if (state.owned[id]) {
      const d = makeDecoration(id, world.uniforms);
      decorMeshes[id] = d;
      world.decorations.add(d);
    }
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  // invisible volume for raycast
  const volume = new THREE.Mesh(
    new THREE.BoxGeometry(TANK.w - 0.08, TANK.water - TANK.sand, TANK.d - 0.08),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  volume.visible = false;
  volume.position.set(0, (TANK.water + TANK.sand) / 2, 0);
  world.scene.add(volume);

  let toastTimer = 0;
  let renameTarget = 0;
  let hungryToastAt = 0;

  function save() {
    const payload = {
      names: sharks.map((s) => s.name),
      sharks: sharks.map((s) => ({ hunger: s.hunger, happiness: s.happiness, love: s.love })),
      coins: state.coins,
      owned: state.owned,
      night: state.night,
      muted: state.muted,
      selectedFood: state.selectedFood,
      feedCount: state.feedCount,
      kissCount: state.kissCount,
      bornAt: state.bornAt,
      last: Date.now(),
      seenIntro: state.seenIntro,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); } catch {}
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function setNames() {
    sharks.forEach((s, i) => {
      $(`name-${i}`).textContent = s.name;
      $(`card-name-${i}`).textContent = s.name;
      s.labelEl.textContent = s.name;
    });
    document.title = `Aşk Akvaryumu — ${sharks[0].name} & ${sharks[1].name}`;
  }

  function updateHUD() {
    $("coin-count").textContent = Math.floor(state.coins);
    sharks.forEach((s, i) => {
      const H = Math.round(s.hunger), S = Math.round(s.happiness), L = Math.round(s.love);
      $(`h${i}`).textContent = H;
      $(`s${i}`).textContent = S;
      $(`l${i}`).textContent = L;
      $(`bar-h${i}`).style.width = H + "%";
      $(`bar-s${i}`).style.width = S + "%";
      $(`bar-l${i}`).style.width = L + "%";
      document.querySelector(`.card[data-shark="${i}"]`).classList.toggle("low", s.hunger < 25);
    });
    $("icon-sun").classList.toggle("hidden", state.night);
    $("icon-moon").classList.toggle("hidden", !state.night);
    $("icon-on").classList.toggle("hidden", state.muted);
    $("icon-off").classList.toggle("hidden", !state.muted);
    document.querySelectorAll(".food").forEach((el) => {
      const typ = FOODS.find((f) => f.id === el.dataset.id);
      el.classList.toggle("on", typ.id === state.selectedFood);
      el.classList.toggle("off", typ.price > 0 && state.coins < typ.price);
    });
    const hungry = sharks.find((s) => s.hunger < 28);
    if (state.kissing > 0) $("hint").textContent = `${sharks[0].name} ve ${sharks[1].name} dans ediyor.`;
    else if (hungry) $("hint").textContent = `${hungry.name} acıktı. Bir mama bırak.`;
    else if (canBond()) $("hint").textContent = "İkisi de mutlu. Birlikte yüzüyorlar.";
    else $("hint").textContent = "Akvaryuma dokun, mama bırak.";
  }

  function buildFoods() {
    const root = $("foods");
    root.innerHTML = "";
    FOODS.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "food" + (f.id === state.selectedFood ? " on" : "");
      btn.dataset.id = f.id;
      btn.innerHTML = `<span class="ico"></span><span class="nm">${f.name}</span><span class="pr">${f.price === 0 ? "Ücretsiz" : f.price + " midye"}</span>`;
      const ico = btn.querySelector(".ico");
      ico.style.background = f.color;
      ico.style.borderRadius = "99px";
      ico.style.width = "22px";
      ico.style.height = "8px";
      btn.title = f.hint;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (f.price > 0 && state.coins < f.price) { toast("Yeterli midye yok."); return; }
        state.selectedFood = f.id;
        updateHUD(); save();
      });
      root.appendChild(btn);
    });
  }

  function buildShop() {
    const root = $("shop-grid");
    root.innerHTML = "";
    DECORS.forEach((d) => {
      const owned = !!state.owned[d.id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item" + (owned ? " owned" : "");
      btn.innerHTML = `<span class="tag">${owned ? "Sahipsin" : "Dekor"}</span><h3>${d.name}</h3><p>${d.desc}</p><div class="row"><span>${owned ? "Yerleştirildi" : d.price + " midye"}</span></div>`;
      btn.addEventListener("click", () => {
        if (owned) { toast("Bu süs zaten akvaryumda."); return; }
        if (state.coins < d.price) { toast("Yeterli midye yok."); return; }
        state.coins -= d.price;
        state.owned[d.id] = true;
        const mesh = makeDecoration(d.id, world.uniforms);
        decorMeshes[d.id] = mesh;
        world.decorations.add(mesh);
        toast(`${d.name} akvaryuma eklendi.`);
        buildShop(); updateHUD(); save();
      });
      root.appendChild(btn);
    });
    const stats = document.createElement("p");
    stats.className = "sheet-lead";
    const days = Math.max(1, Math.round((Date.now() - state.bornAt) / 86400000));
    stats.style.gridColumn = "1 / -1";
    stats.textContent = `Birlikte ${days} gün · ${state.feedCount} mama · ${state.kissCount} öpücük`;
    root.appendChild(stats);
  }

  function canBond() {
    return sharks.every((s) => s.hunger > 60 && s.happiness > 55 && s.love > 40);
  }

  function dist3(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function burstHearts(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const s = createHeartSprite();
      s.position.set(x + rand(-0.08, 0.08), y + rand(-0.04, 0.08), z + rand(-0.08, 0.08));
      const sc = rand(0.16, 0.28);
      s.scale.setScalar(sc);
      world.interior.add(s);
      state.hearts.push({ sprite: s, vy: rand(0.18, 0.38), life: rand(1.1, 1.9), max: 1.9, baseScale: sc });
    }
  }

  function dropFoodAt(point) {
    const typ = FOODS.find((f) => f.id === state.selectedFood) || FOODS[0];
    if (typ.price > 0 && state.coins < typ.price) { toast("Yeterli midye yok."); return; }
    if (typ.price > 0) { state.coins -= typ.price; updateHUD(); }
    const b = tankBounds();
    const x = clamp(point.x, b.minX, b.maxX);
    const y = clamp(point.y, TANK.water - 0.15, TANK.water - 0.02);
    const z = clamp(point.z, b.minZ, b.maxZ);
    const mesh = createFoodMesh(typ.id, typ.color);
    mesh.position.set(x, y, z);
    world.interior.add(mesh);
    const burst = createFeedBurst(typ.color, 14);
    burst.position.set(x, y, z);
    world.interior.add(burst);
    state.bursts.push(burst);
    state.foods.push({ id: typ.id, mesh, x, y, z, vy: 0.12, sink: 0, typ });
    audio.drop();
    save();
  }

  function tryDropFromEvent(e) {
    const rect = world.renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, world.camera);
    const hits = raycaster.intersectObject(volume);
    if (hits.length) dropFoodAt(hits[0].point);
  }

  function updateSharks(dt) {
    const b = tankBounds();
    const a = sharks[0], c = sharks[1];
    sharks.forEach((s) => {
      const mate = s.id === 0 ? c : a;
      s.eatCool = Math.max(0, s.eatCool - dt);
      s.hunger = clamp(s.hunger - HUNGER_PER_SEC * dt, 0, 100);
      const hungry = s.hunger < 35;
      const close = dist3(s, mate) < 1.0;
      s.happiness = clamp(s.happiness - HAPPY_PER_SEC * dt * (hungry ? 1.7 : 1) + (canBond() && close ? dt * 0.9 : 0), 0, 100);
      if (canBond() && close) s.love = clamp(s.love + dt * 1.15, 0, 100);
      else s.love = clamp(s.love - LOVE_PER_SEC * dt * (hungry ? 1.5 : 0.5), 0, 100);

      let targetFood = null, best = 1e9;
      if (s.hunger < 94 && s.eatCool <= 0) {
        for (const f of state.foods) {
          const d = Math.hypot(f.x - s.x, f.y - s.y, f.z - s.z);
          if (d < best) { best = d; targetFood = f; }
        }
      }
      let maxSp = lerp(0.45, 0.7, s.happiness / 100);
      if (targetFood) maxSp = hungry ? 1.25 : 1.05;
      if (s.state === "kiss") maxSp = 0.32;
      else if (s.state === "couple" && !targetFood) maxSp = 0.48;
      if (s.hunger < 18) maxSp *= 0.72;

      if (targetFood) {
        s.state = "hunt";
        s.tx = targetFood.x; s.ty = targetFood.y; s.tz = targetFood.z;
      } else if (state.kissing > 0 || (canBond() && state.kissCool <= 0 && close && Math.random() < 0.004)) {
        s.state = "kiss";
        const midX = lerp(s.x, mate.x, 0.5);
        const midY = lerp(s.y, mate.y, 0.5);
        const midZ = lerp(s.z, mate.z, 0.5);
        const side = s.id === 0 ? -1 : 1;
        s.tx = clamp(midX + side * 0.38, b.minX, b.maxX);
        s.ty = clamp(midY, b.minY, b.maxY);
        s.tz = clamp(midZ, b.minZ, b.maxZ);
      } else if (canBond()) {
        s.state = "couple";
        const behind = mate.heading + (s.id === 0 ? 0.9 : -0.9);
        s.tx = clamp(mate.x + Math.cos(behind) * 0.7, b.minX, b.maxX);
        s.ty = clamp(mate.y + (s.id ? 0.1 : -0.1), b.minY, b.maxY);
        s.tz = clamp(mate.z + Math.sin(behind) * 0.25, b.minZ, b.maxZ);
      } else {
        s.state = "wander";
        s.retarget -= dt;
        if (s.retarget <= 0) {
          s.tx = rand(b.minX, b.maxX);
          s.ty = rand(b.minY, b.maxY);
          s.tz = rand(b.minZ, b.maxZ);
          s.retarget = rand(1.8, 4.0);
        }
      }

      let ax = s.tx - s.x, ay = s.ty - s.y, az = s.tz - s.z;
      const dist = Math.hypot(ax, ay, az) || 1;
      ax /= dist; ay /= dist; az /= dist;
      if (s.x < b.minX + 0.1) ax += 1.2;
      if (s.x > b.maxX - 0.1) ax -= 1.2;
      if (s.y < b.minY + 0.08) ay += 1.4;
      if (s.y > b.maxY - 0.08) ay -= 1.4;
      if (s.z < b.minZ + 0.1) az += 1.2;
      if (s.z > b.maxZ - 0.1) az -= 1.2;

      const steer = 2.2 + (s.state === "hunt" ? 1.2 : 0);
      s.vx = lerp(s.vx, ax * maxSp, 1 - Math.pow(0.02, dt * steer * 0.4));
      s.vy = lerp(s.vy, ay * maxSp, 1 - Math.pow(0.02, dt * steer * 0.4));
      s.vz = lerp(s.vz, az * maxSp, 1 - Math.pow(0.02, dt * steer * 0.4));
      const sp = Math.hypot(s.vx, s.vy, s.vz);
      if (sp > maxSp) { s.vx *= maxSp / sp; s.vy *= maxSp / sp; s.vz *= maxSp / sp; }
      s.x = clamp(s.x + s.vx * dt, b.minX - 0.05, b.maxX + 0.05);
      s.y = clamp(s.y + s.vy * dt, TANK.sand + 0.18, TANK.water - 0.18);
      s.z = clamp(s.z + s.vz * dt, b.minZ - 0.05, b.maxZ + 0.05);
      if (sp > 0.05) {
        s.heading = Math.atan2(s.vz, s.vx);
        s.pitch = Math.atan2(s.vy, Math.hypot(s.vx, s.vz));
      }
      if (targetFood) {
        const d = Math.hypot(targetFood.x - s.x, targetFood.y - s.y, targetFood.z - s.z);
        if (d < 0.38) eatFood(s, targetFood);
      }
      updateSharkVisual(s, dt);
      const hideLabel = state.kissing > 0 || dist3(s, mate) < 0.7;
      s.labelEl.style.opacity = hideLabel ? "0" : "1";
    });
  }

  function eatFood(s, food) {
    const typ = food.typ;
    s.hunger = clamp(s.hunger + typ.hunger, 0, 100);
    s.happiness = clamp(s.happiness + typ.happy, 0, 100);
    s.love = clamp(s.love + typ.love, 0, 100);
    s.eatCool = 0.4;
    state.coins += typ.coins;
    state.feedCount += 1;
    const burst = createFeedBurst(typ.color, 16);
    burst.position.copy(food.mesh.position);
    world.interior.add(burst);
    state.bursts.push(burst);
    world.interior.remove(food.mesh);
    state.foods = state.foods.filter((f) => f !== food);
    playBite(s);
    audio.eat();
    if (typ.id === "treat") {
      burstHearts((sharks[0].x + sharks[1].x) / 2, (sharks[0].y + sharks[1].y) / 2, (sharks[0].z + sharks[1].z) / 2, 8);
      sharks.forEach((sh) => { sh.love = clamp(sh.love + 4, 0, 100); });
    }
    updateHUD(); save();
  }

  function maybeKiss(dt) {
    state.kissCool = Math.max(0, state.kissCool - dt);
    if (canBond() && dist3(sharks[0], sharks[1]) < 1.15 && state.kissing <= 0 && Math.random() < 0.04) {
      const a = sharks[0], b = sharks[1];
      burstHearts((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.16, (a.z + b.z) / 2, 1);
    }
    if (state.kissing > 0) {
      state.kissing -= dt;
      if (Math.random() < 0.25) {
        burstHearts((sharks[0].x + sharks[1].x) / 2, sharks[0].y + 0.1, (sharks[0].z + sharks[1].z) / 2, 1);
      }
      if (state.kissing <= 0) state.kissCool = rand(22, 38);
      return;
    }
    if (!canBond() || state.kissCool > 0) return;
    const a = sharks[0], b = sharks[1];
    const d = dist3(a, b);
    if (d < 0.85 && a.state === "kiss" && b.state === "kiss") {
      state.kissing = 2.1;
      state.kissCount += 1;
      a.love = clamp(a.love + 6, 0, 100);
      b.love = clamp(b.love + 6, 0, 100);
      a.happiness = clamp(a.happiness + 5, 0, 100);
      b.happiness = clamp(b.happiness + 5, 0, 100);
      burstHearts((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.1, (a.z + b.z) / 2, 14);
      audio.kiss();
      toast(`${a.name} ve ${b.name} birbirine sarıldı.`);
      updateHUD(); save();
    }
  }

  function updateFoods(dt) {
    for (const f of state.foods) {
      f.vy = Math.min(f.vy + 0.35 * dt, 0.45);
      f.y -= f.vy * dt;
      if (f.y <= TANK.sand + 0.04) { f.y = TANK.sand + 0.04; f.vy = 0; f.sink = (f.sink || 0) + dt; }
      f.mesh.position.set(f.x, f.y, f.z);
      f.mesh.rotation.y += dt * 1.2;
    }
    state.foods = state.foods.filter((f) => {
      if ((f.sink || 0) < 14) return true;
      world.interior.remove(f.mesh);
      return false;
    });
  }

  function updateHearts(dt) {
    state.hearts = state.hearts.filter((h) => {
      h.life -= dt;
      h.sprite.position.y += h.vy * dt;
      h.sprite.position.x += Math.sin((h.max - h.life) * 6 + h.vy) * 0.08 * dt;
      const k = clamp(h.life / h.max, 0, 1);
      h.sprite.material.opacity = k;
      const s = (h.baseScale || h.sprite.scale.x) * (0.85 + 0.25 * Math.sin((h.max - h.life) * 8));
      h.sprite.scale.setScalar(s);
      h.sprite.material.rotation += dt * 0.6;
      if (h.life <= 0) { world.interior.remove(h.sprite); return false; }
      return true;
    });
  }

  let hudAcc = 0, saveAcc = 0;
  function tick(dt) {
    state.t += dt;
    state.nightT = lerp(state.nightT, state.night ? 1 : 0, 1 - Math.pow(0.02, dt * 1.2));
    updateFoods(dt);
    updateSharks(dt);
    maybeKiss(dt);
    updateFish(fish.schools, sharks, dt);
    updateBubbles(bubbles, state.t, dt);
    updateSnow(snow, dt);
    updateHearts(dt);
    if (state.bursts) {
      const keep = updateFeedBursts(state.bursts, dt);
      state.bursts.filter((b) => !keep.includes(b)).forEach((b) => world.interior.remove(b));
      state.bursts = keep;
    }
    if (decorMeshes.jelly) updateJellies(decorMeshes.jelly, state.t);
    if (canBond() && Math.sin(state.t * 2) > 0.7 && Math.random() < 0.02) {
      const a = sharks[0], b = sharks[1];
      if (dist3(a, b) < 1.2) burstHearts((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.15, (a.z + b.z) / 2, 1);
    }
    hudAcc += dt;
    if (hudAcc > 0.25) {
      hudAcc = 0;
      updateHUD();
      const starving = sharks.find((s) => s.hunger < 18);
      if (starving && Date.now() - hungryToastAt > 45000) {
        toast(`${starving.name} çok acıktı.`);
        hungryToastAt = Date.now();
      }
    }
    saveAcc += dt;
    if (saveAcc > 4) { saveAcc = 0; save(); }
    return state.nightT;
  }

  function bindUI() {
    buildFoods();
    setNames();
    updateHUD();
    $("btn-enter").addEventListener("click", () => {
      state.seenIntro = true;
      $("intro").classList.add("hidden");
      audio.start();
      save();
    });
    $("btn-day").addEventListener("click", () => { state.night = !state.night; updateHUD(); save(); });
    $("btn-mute").addEventListener("click", () => {
      state.muted = !state.muted;
      audio.start();
      audio.setMuted(state.muted);
      updateHUD(); save();
    });
    $("btn-shop").addEventListener("click", () => { buildShop(); $("shop").classList.remove("hidden"); });
    $("btn-close-shop").addEventListener("click", () => $("shop").classList.add("hidden"));
    $("shop").addEventListener("click", (e) => { if (e.target.id === "shop") $("shop").classList.add("hidden"); });

    const openRename = (i) => {
      renameTarget = i;
      $("rename-title").textContent = sharks[i].name + " için yeni isim";
      $("rename-input").value = sharks[i].name;
      $("rename").classList.remove("hidden");
      setTimeout(() => $("rename-input").focus(), 50);
    };
    $("name-0").addEventListener("click", () => openRename(0));
    $("name-1").addEventListener("click", () => openRename(1));
    $("card-name-0").addEventListener("click", () => openRename(0));
    $("card-name-1").addEventListener("click", () => openRename(1));
    $("btn-close-rename").addEventListener("click", () => $("rename").classList.add("hidden"));
    $("rename").addEventListener("click", (e) => { if (e.target.id === "rename") $("rename").classList.add("hidden"); });
    $("rename-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("rename-input").value.trim().replace(/\s+/g, " ");
      if (!v) return;
      sharks[renameTarget].name = v.slice(0, 16);
      setNames();
      $("rename").classList.add("hidden");
      save();
    });

    // food drop: pointerup without significant drag
    const canvas = world.renderer.domElement;
    let down = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      audio.start();
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      const short = Math.hypot(dx, dy) < 8 && performance.now() - down.t < 500;
      down = null;
      if (short && $("intro").classList.contains("hidden") && $("shop").classList.contains("hidden") && $("rename").classList.contains("hidden")) {
        tryDropFromEvent(e);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) save();
      else {
        const d = loadSave();
        if (d && d.last) {
          const elapsed = Date.now() - d.last;
          if (elapsed > 2000) { applyOfflineDecay(sharks, elapsed); updateHUD(); }
        }
      }
    });
    window.addEventListener("beforeunload", save);
    if (!state.seenIntro) $("intro").classList.remove("hidden");
  }

  bindUI();
  setDayNight(world, state.nightT);

  return { state, sharks, tick, save, audio, fish, burstHearts, dropFoodAt };
}
