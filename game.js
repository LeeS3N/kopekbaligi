/* Aşk Akvaryumu — Kaptan & İnci */
(() => {
  "use strict";

  const SAVE_KEY = "askAkvaryumu:v1";
  const canvas = document.getElementById("tank");
  const ctx = canvas.getContext("2d", { alpha: false });

  const FOODS = [
    { id: "krill", name: "Kril", price: 0, hunger: 14, happy: 4, love: 0, coins: 2, color: "#e07a5f", size: 7, hint: "Hafif atıştırmalık" },
    { id: "fish", name: "Küçük Balık", price: 5, hunger: 28, happy: 8, love: 1, coins: 5, color: "#f2cc8f", size: 11, hint: "Doyurucu ve taze" },
    { id: "mackerel", name: "Palamut", price: 12, hunger: 50, happy: 14, love: 3, coins: 9, color: "#8eb4c8", size: 15, hint: "Ziyafet gibi" },
    { id: "treat", name: "Aşk Lokması", price: 18, hunger: 32, happy: 18, love: 12, coins: 7, color: "#f080a0", size: 12, hint: "Kalpleri ısıtır" },
  ];

  const DECORS = [
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

  const state = {
    w: 0,
    h: 0,
    t: 0,
    night: false,
    nightT: 0,
    muted: false,
    coins: 55,
    selectedFood: "krill",
    owned: {},
    feedCount: 0,
    kissCount: 0,
    bornAt: Date.now(),
    last: Date.now(),
    seenIntro: false,
    foods: [],
    bubbles: [],
    particles: [],
    fish: [],
    weeds: [],
    rocks: [],
    jellies: [],
    sharks: [],
    kissCool: 8,
    kissing: 0,
    hint: "Akvaryuma dokun, mama bırak.",
  };

  let renameTarget = 0;
  let toastTimer = 0;

  const $ = (id) => document.getElementById(id);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const now = () => Date.now();

  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2));
    if (d < 0) d += Math.PI * 2;
    d -= Math.PI;
    return a + d * t;
  }

  /* -------------------- persistence -------------------- */
  function defaultSharks() {
    return [
      { name: "Kaptan", gender: "m", scale: 1.08, hunger: 86, happiness: 74, love: 58 },
      { name: "İnci", gender: "f", scale: 0.94, hunger: 84, happiness: 76, love: 62 },
    ];
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function save() {
    const payload = {
      names: state.sharks.map((s) => s.name),
      sharks: state.sharks.map((s) => ({
        hunger: s.hunger,
        happiness: s.happiness,
        love: s.love,
      })),
      coins: state.coins,
      owned: state.owned,
      night: state.night,
      muted: state.muted,
      selectedFood: state.selectedFood,
      feedCount: state.feedCount,
      kissCount: state.kissCount,
      bornAt: state.bornAt,
      last: now(),
      seenIntro: state.seenIntro,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function applyOfflineDecay(data, elapsedMs) {
    const sec = Math.max(0, Math.min(elapsedMs / 1000, 7 * 86400));
    data.sharks.forEach((s) => {
      s.hunger = clamp(s.hunger - sec * HUNGER_PER_SEC, 0, 100);
      let happyLoss = sec * HAPPY_PER_SEC;
      if (s.hunger < 30) happyLoss *= 1.8;
      s.happiness = clamp(s.happiness - happyLoss, 5, 100);
      let loveLoss = sec * LOVE_PER_SEC * (s.hunger < 40 || s.happiness < 40 ? 1.6 : 0.45);
      s.love = clamp(s.love - loveLoss, 8, 100);
    });
  }

  /* -------------------- audio -------------------- */
  const audio = {
    ctx: null,
    master: null,
    started: false,
    muted: false,
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
        const white = Math.random() * 2 - 1;
        last = (last + 0.018 * white) / 1.018;
        data[i] = last * 3.2;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 480;
      filter.Q.value = 0.65;
      const ng = this.ctx.createGain();
      ng.gain.value = 0.32;
      const lfo = this.ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.06;
      const lfoG = this.ctx.createGain();
      lfoG.gain.value = 160;
      lfo.connect(lfoG);
      lfoG.connect(filter.frequency);
      src.connect(filter);
      filter.connect(ng);
      ng.connect(this.master);
      src.start();
      lfo.start();

      const drone = this.ctx.createOscillator();
      drone.type = "sine";
      drone.frequency.value = 46;
      const dg = this.ctx.createGain();
      dg.gain.value = 0.035;
      drone.connect(dg);
      dg.connect(this.master);
      drone.start();

      this.started = true;
      this._bubbles();
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
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      const f = c.createBiquadFilter();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), c.currentTime + dur);
      f.type = "lowpass";
      f.frequency.value = freq * 3;
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(f);
      f.connect(g);
      g.connect(this.master);
      o.start();
      o.stop(c.currentTime + dur + 0.05);
    },
    pop() {
      this._tone(rand(520, 880), 0.16, "sine", 0.03, rand(180, 320));
    },
    eat() {
      this._tone(140, 0.12, "triangle", 0.07, 70);
      this._tone(rand(400, 600), 0.14, "sine", 0.025, 200);
    },
    kiss() {
      this._tone(392, 0.35, "sine", 0.05, 392);
      setTimeout(() => this._tone(494, 0.45, "sine", 0.045, 494), 120);
    },
    drop() {
      this._tone(240, 0.08, "sine", 0.025, 140);
    },
    _bubbles() {
      const loop = () => {
        if (!this.started) return;
        const wait = rand(900, 2600);
        setTimeout(() => {
          if (!this.muted) this.pop();
          loop();
        }, wait);
      };
      loop();
    },
  };

  /* -------------------- world layout -------------------- */
  function bounds() {
    const w = state.w, h = state.h;
    const top = w < 740 ? Math.max(h * 0.30, 250) : Math.max(h * 0.22, 210);
    return {
      left: w * 0.06,
      right: w * 0.94,
      top,
      bottom: h * 0.80,
      sand: h * 0.86,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.w = Math.max(1, window.innerWidth);
    state.h = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(state.w * dpr);
    canvas.height = Math.floor(state.h * dpr);
    canvas.style.width = state.w + "px";
    canvas.style.height = state.h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state.weeds.length) seedScenery();
    else layoutScenery();
  }

  function seedScenery() {
    const b = bounds();
    state.weeds = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      state.weeds.push({
        x: lerp(state.w * 0.04, state.w * 0.96, i / (n - 1)) + rand(-18, 18),
        h: rand(state.h * 0.16, state.h * 0.34),
        segs: 8 + (Math.random() * 5) | 0,
        hue: rand(90, 155),
        thick: rand(5, 11),
        phase: rand(0, 6.28),
        extra: false,
      });
    }
    state.rocks = [];
    for (let i = 0; i < 9; i++) {
      state.rocks.push({
        x: rand(20, state.w - 20),
        y: b.sand + rand(-8, 18),
        rx: rand(12, 34),
        ry: rand(7, 16),
        c: rand(0.35, 0.55),
      });
    }
    seedFish();
    seedBubbles();
    seedJellies();
  }

  function layoutScenery() {
    const b = bounds();
    state.rocks.forEach((r) => { r.y = b.sand + (r.y % 30) - 8; });
  }

  function seedFish() {
    state.fish = [];
    const palettes = [
      ["#f0c14a", "#e07a3d"],
      ["#5dade2", "#1a5276"],
      ["#e8e8e8", "#b0bec5"],
      ["#ff7f50", "#c0392b"],
      ["#58d68d", "#1e8449"],
    ];
    for (let s = 0; s < 3; s++) {
      const pal = palettes[s % palettes.length];
      const cx = rand(state.w * 0.2, state.w * 0.8);
      const cy = rand(state.h * 0.28, state.h * 0.62);
      const n = 5 + (Math.random() * 3) | 0;
      for (let i = 0; i < n; i++) {
        state.fish.push({
          x: cx + rand(-60, 60),
          y: cy + rand(-24, 24),
          vx: rand(-18, 18) || 12,
          vy: rand(-6, 6),
          size: rand(5, 9),
          pal,
          phase: rand(0, 6.28),
          school: s,
        });
      }
    }
  }

  function seedBubbles() {
    state.bubbles = [];
    for (let i = 0; i < 36; i++) {
      state.bubbles.push({
        x: rand(0, state.w),
        y: rand(0, state.h),
        r: rand(1.2, 5.5),
        vy: rand(12, 32),
        wob: rand(0.4, 1.4),
        ph: rand(0, 6.28),
      });
    }
  }

  function seedJellies() {
    state.jellies = [];
    for (let i = 0; i < 3; i++) {
      state.jellies.push({
        x: state.w * (0.2 + i * 0.28) + rand(-30, 30),
        y: state.h * rand(0.28, 0.55),
        s: rand(16, 26),
        ph: rand(0, 6.28),
        hue: pick([190, 280, 170]),
      });
    }
  }

  /* -------------------- sharks -------------------- */
  function makeShark(spec, i) {
    const b = bounds();
    return {
      id: i,
      name: spec.name,
      gender: spec.gender,
      scale: spec.scale,
      hunger: spec.hunger,
      happiness: spec.happiness,
      love: spec.love,
      x: i === 0 ? state.w * 0.35 : state.w * 0.65,
      y: (b.top + b.bottom) / 2 + (i ? 30 : -20),
      vx: i ? -20 : 22,
      vy: 0,
      angle: i ? Math.PI : 0,
      phase: rand(0, 6.28),
      state: "wander",
      tx: 0,
      ty: 0,
      retarget: 0,
      mouth: 0,
      eatCool: 0,
      length: 1,
    };
  }

  function sharkLen(s) {
    return Math.min(state.w, state.h) * 0.21 * s.scale;
  }

  function canBond() {
    return state.sharks.every((s) => s.hunger > 60 && s.happiness > 55 && s.love > 40);
  }

  function updateShark(s, dt, mate) {
    const b = bounds();
    const L = sharkLen(s);
    s.length = L;
    s.eatCool = Math.max(0, s.eatCool - dt);
    s.mouth = lerp(s.mouth, 0, 1 - Math.pow(0.001, dt));

    s.hunger = clamp(s.hunger - HUNGER_PER_SEC * dt, 0, 100);
    const hungry = s.hunger < 35;
    s.happiness = clamp(s.happiness - HAPPY_PER_SEC * dt * (hungry ? 1.7 : 1) + (canBond() && Math.hypot(s.x - mate.x, s.y - mate.y) < 180 ? dt * 0.9 : 0), 0, 100);
    const close = Math.hypot(s.x - mate.x, s.y - mate.y) < 160;
    if (canBond() && close) s.love = clamp(s.love + dt * 1.15, 0, 100);
    else s.love = clamp(s.love - LOVE_PER_SEC * dt * (hungry ? 1.5 : 0.5), 0, 100);

    let targetFood = null;
    let best = 1e9;
    if (s.hunger < 94 && s.eatCool <= 0) {
      for (const f of state.foods) {
        const d = Math.hypot(f.x - s.x, f.y - s.y);
        const bias = f.y < b.top ? 80 : 0;
        if (d + bias < best) {
          best = d + bias;
          targetFood = f;
        }
      }
    }

    let maxSp = lerp(58, 86, s.happiness / 100);
    if (targetFood) maxSp = hungry ? 175 : 150;
    if (s.state === "kiss") maxSp = 42;
    else if (s.state === "couple" && !targetFood) maxSp = 62;
    if (s.hunger < 18) maxSp *= 0.72;

    if (targetFood) {
      s.state = "hunt";
      s.tx = targetFood.x;
      s.ty = targetFood.y;
    } else if (state.kissing > 0 || (canBond() && state.kissCool <= 0 && close && Math.random() < 0.003)) {
      s.state = "kiss";
      const midX = clamp((s.x + mate.x) / 2, b.left + 40, b.right - 40);
      const midY = clamp((s.y + mate.y) / 2, b.top + 20, b.bottom - 20);
      const side = s.id === 0 ? -1 : 1;
      s.tx = midX + side * 52;
      s.ty = midY;
    } else if (canBond()) {
      s.state = "couple";
      const behind = mate.angle + (s.id === 0 ? 0.9 : -0.9);
      s.tx = clamp(mate.x + Math.cos(behind) * 120, b.left, b.right);
      s.ty = clamp(mate.y + Math.sin(behind) * 40 + (s.id ? 18 : -18), b.top, b.bottom);
    } else {
      s.state = "wander";
      s.retarget -= dt;
      if (s.retarget <= 0) {
        s.tx = rand(b.left, b.right);
        s.ty = rand(b.top, b.bottom);
        s.retarget = rand(1.6, 3.6);
      }
    }

    let ax = s.tx - s.x;
    let ay = s.ty - s.y;
    const dist = Math.hypot(ax, ay) || 1;
    ax /= dist;
    ay /= dist;

    if (s.x < b.left + 20) ax += 1.2;
    if (s.x > b.right - 20) ax -= 1.2;
    if (s.y < b.top + 16) ay += 1.4;
    if (s.y > b.bottom - 16) ay -= 1.6;

    const desiredX = ax * maxSp;
    const desiredY = ay * maxSp;
    const steer = 2.6 + (s.state === "hunt" ? 1.4 : 0);
    s.vx = lerp(s.vx, desiredX, 1 - Math.pow(0.012, dt * steer * 0.35));
    s.vy = lerp(s.vy, desiredY, 1 - Math.pow(0.012, dt * steer * 0.35));

    const sp = Math.hypot(s.vx, s.vy);
    if (sp > maxSp) {
      s.vx = (s.vx / sp) * maxSp;
      s.vy = (s.vy / sp) * maxSp;
    }

    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.x = clamp(s.x, 16, state.w - 16);
    s.y = clamp(s.y, 20, b.sand - 18);

    if (sp > 8) s.angle = lerpAngle(s.angle, Math.atan2(s.vy, s.vx), 1 - Math.pow(0.02, dt * 2.2));

    if (targetFood) {
      const d = Math.hypot(targetFood.x - s.x, targetFood.y - s.y);
      const reach = L * 0.42;
      if (d < reach) eatFood(s, targetFood);
    }
  }

  function eatFood(s, food) {
    const typ = FOODS.find((f) => f.id === food.id) || FOODS[0];
    s.hunger = clamp(s.hunger + typ.hunger, 0, 100);
    s.happiness = clamp(s.happiness + typ.happy, 0, 100);
    s.love = clamp(s.love + typ.love, 0, 100);
    s.mouth = 1;
    s.eatCool = 0.35;
    state.coins += typ.coins;
    state.feedCount += 1;
    state.foods = state.foods.filter((f) => f !== food);
    audio.eat();
    for (let i = 0; i < 10; i++) {
      state.particles.push({
        kind: "crumb",
        x: food.x,
        y: food.y,
        vx: rand(-50, 50),
        vy: rand(-40, 20),
        life: rand(0.3, 0.7),
        max: 0.7,
        c: typ.color,
        r: rand(1.2, 2.8),
      });
    }
    if (typ.id === "treat") {
      burstHearts((state.sharks[0].x + state.sharks[1].x) / 2, (state.sharks[0].y + state.sharks[1].y) / 2, 8);
      state.sharks.forEach((sh) => {
        sh.love = clamp(sh.love + 4, 0, 100);
      });
    }
    updateHUD();
    save();
  }

  function maybeKiss(dt) {
    state.kissCool = Math.max(0, state.kissCool - dt);
    if (state.kissing > 0) {
      state.kissing -= dt;
      if (Math.random() < 0.25) {
        const a = state.sharks[0], b = state.sharks[1];
        burstHearts((a.x + b.x) / 2, (a.y + b.y) / 2 - 10, 1);
      }
      if (state.kissing <= 0) state.kissCool = rand(22, 38);
      return;
    }
    if (!canBond() || state.kissCool > 0) return;
    const a = state.sharks[0], b = state.sharks[1];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const facing = Math.abs(Math.cos(a.angle) - Math.cos(b.angle)) > 1.1 || d < 90;
    if (d < 110 && a.state === "kiss" && b.state === "kiss" && facing) {
      state.kissing = 2.1;
      state.kissCount += 1;
      a.love = clamp(a.love + 6, 0, 100);
      b.love = clamp(b.love + 6, 0, 100);
      a.happiness = clamp(a.happiness + 5, 0, 100);
      b.happiness = clamp(b.happiness + 5, 0, 100);
      burstHearts((a.x + b.x) / 2, (a.y + b.y) / 2, 16);
      audio.kiss();
      toast(`${a.name} ve ${b.name} birbirine sarıldı.`);
      updateHUD();
      save();
    }
  }

  function burstHearts(x, y, n) {
    for (let i = 0; i < n; i++) {
      state.particles.push({
        kind: "heart",
        x: x + rand(-16, 16),
        y: y + rand(-10, 10),
        vx: rand(-18, 18),
        vy: rand(-40, -16),
        life: rand(0.9, 1.6),
        max: 1.6,
        s: rand(0.7, 1.3),
        c: pick(["#ff8fab", "#ffb4c8", "#ff6b8a", "#f3d2d8"]),
      });
    }
  }

  /* -------------------- food & input -------------------- */
  function dropFood(x, y) {
    const typ = FOODS.find((f) => f.id === state.selectedFood) || FOODS[0];
    if (typ.price > 0 && state.coins < typ.price) {
      toast("Yeterli midye yok.");
      return;
    }
    if (typ.price > 0) {
      state.coins -= typ.price;
      updateHUD();
    }
    state.foods.push({
      id: typ.id,
      x,
      y: Math.min(y, bounds().top + 10),
      vy: 18,
      phase: rand(0, 6.28),
      color: typ.color,
      size: typ.size,
    });
    audio.drop();
    save();
  }

  function updateFoods(dt) {
    const sand = bounds().sand;
    for (const f of state.foods) {
      f.vy = Math.min(f.vy + 28 * dt, 46);
      f.y += f.vy * dt;
      f.x += Math.sin(state.t * 2 + f.phase) * 10 * dt;
      if (f.y > sand - 6) {
        f.y = sand - 6;
        f.vy = 0;
        f.sink = (f.sink || 0) + dt;
      }
    }
    state.foods = state.foods.filter((f) => (f.sink || 0) < 14);
  }

  /* -------------------- ambient motion -------------------- */
  function updateAmbient(dt) {
    const b = bounds();
    for (const bu of state.bubbles) {
      bu.y -= bu.vy * dt;
      bu.x += Math.sin(state.t * bu.wob + bu.ph) * 12 * dt;
      if (bu.y < -10) {
        bu.y = state.h + rand(0, 40);
        bu.x = rand(0, state.w);
      }
    }
    for (const f of state.fish) {
      const cx = state.fish.filter((k) => k.school === f.school).reduce((a, k) => a + k.x, 0) / 6 || f.x;
      const cy = state.fish.filter((k) => k.school === f.school).reduce((a, k) => a + k.y, 0) / 6 || f.y;
      f.vx += (cx - f.x) * 0.15 * dt;
      f.vy += (cy - f.y) * 0.15 * dt;
      f.vx += Math.sin(state.t * 0.7 + f.phase) * 8 * dt;
      f.vy += Math.cos(state.t * 0.5 + f.phase) * 5 * dt;
      for (const s of state.sharks) {
        const d = Math.hypot(s.x - f.x, s.y - f.y);
        if (d < 120) {
          f.vx -= ((s.x - f.x) / d) * 80 * dt;
          f.vy -= ((s.y - f.y) / d) * 80 * dt;
        }
      }
      const sp = Math.hypot(f.vx, f.vy);
      const max = 38;
      if (sp > max) {
        f.vx = (f.vx / sp) * max;
        f.vy = (f.vy / sp) * max;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < b.left) f.vx += 30 * dt;
      if (f.x > b.right) f.vx -= 30 * dt;
      if (f.y < b.top) f.vy += 24 * dt;
      if (f.y > b.bottom) f.vy -= 24 * dt;
    }
    if (state.owned.jelly) {
      for (const j of state.jellies) {
        j.y += Math.sin(state.t * 0.6 + j.ph) * 10 * dt;
        j.x += Math.sin(state.t * 0.25 + j.ph) * 8 * dt;
        j.x = clamp(j.x, 40, state.w - 40);
        j.y = clamp(j.y, b.top, b.bottom - 40);
      }
    }
    for (const p of state.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "crumb") p.vy += 50 * dt;
      if (p.kind === "heart") p.vy *= 0.99;
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  /* -------------------- drawing -------------------- */
  function col(day, night) {
    const t = state.nightT;
    if (typeof day === "string") return mixHex(day, night, t);
    return lerp(day, night, t);
  }

  function mixHex(a, b, t) {
    const pa = hexToRgb(a), pb = hexToRgb(b);
    const r = Math.round(lerp(pa[0], pb[0], t));
    const g = Math.round(lerp(pa[1], pb[1], t));
    const bl = Math.round(lerp(pa[2], pb[2], t));
    return `rgb(${r},${g},${bl})`;
  }
  function hexToRgb(h) {
    const s = h.replace("#", "");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function drawWater() {
    const { w, h } = state;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, col("#2a86a8", "#143048"));
    g.addColorStop(0.22, col("#156380", "#0b2434"));
    g.addColorStop(0.6, col("#0c3c52", "#07151f"));
    g.addColorStop(1, col("#08202d", "#03090d"));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // light shafts
    const rays = 6;
    for (let i = 0; i < rays; i++) {
      const x = ((i + 0.5) / rays) * w + Math.sin(state.t * 0.15 + i) * 40;
      const sway = Math.sin(state.t * 0.2 + i * 1.3) * 50;
      const grd = ctx.createLinearGradient(x, 0, x + sway, h * 0.85);
      const a = (0.07 + i * 0.008) * (1 - state.nightT * 0.45);
      grd.addColorStop(0, `rgba(200,235,255,${a})`);
      grd.addColorStop(1, "rgba(200,235,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(x - 18, 0);
      ctx.lineTo(x + 28, 0);
      ctx.lineTo(x + 90 + sway, h);
      ctx.lineTo(x - 70 + sway, h);
      ctx.closePath();
      ctx.fill();
    }

    // caustics
    ctx.save();
    ctx.globalAlpha = 0.06 * (1 - state.nightT * 0.4);
    ctx.strokeStyle = "#d7f3ff";
    ctx.lineWidth = 2.2;
    for (let layer = 0; layer < 3; layer++) {
      const y0 = h * (0.18 + layer * 0.2);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0
          + Math.sin(x * 0.018 + state.t * (0.7 + layer * 0.2) + layer) * 16
          + Math.sin(x * 0.04 - state.t * 0.5 + layer * 2) * 8;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // night motes
    if (state.nightT > 0.15) {
      ctx.save();
      ctx.globalAlpha = 0.35 * state.nightT;
      for (let i = 0; i < 40; i++) {
        const x = ((i * 97.3) + state.t * 4) % w;
        const y = ((i * 53.1) + Math.sin(state.t * 0.3 + i) * 20) % h;
        ctx.fillStyle = i % 3 === 0 ? "#9cf0ff" : "#d7f0ff";
        ctx.beginPath();
        ctx.arc(x, y * 0.7 + h * 0.15, i % 5 === 0 ? 1.6 : 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawSand() {
    const { w, h } = state;
    const sandY = bounds().sand;
    const g = ctx.createLinearGradient(0, sandY - 40, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.15, col("#c7ab72", "#5a4630"));
    g.addColorStop(1, col("#8b6a3c", "#2e2418"));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, sandY);
    for (let x = 0; x <= w; x += 16) {
      const y = sandY + Math.sin(x * 0.03) * 5 + Math.sin(x * 0.01) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = col("#d8c08a", "#6a5538");
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 70; i++) {
      const x = (i * 89.4) % w;
      const y = sandY + 8 + ((i * 17) % (h - sandY - 6));
      ctx.beginPath();
      ctx.ellipse(x, y, 1.4 + (i % 3), 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const r of state.rocks) {
      ctx.fillStyle = col(
        `rgb(${Math.round(70 + r.c * 50)},${Math.round(62 + r.c * 40)},${Math.round(52 + r.c * 28)})`,
        `rgb(${Math.round(36 + r.c * 22)},${Math.round(32 + r.c * 18)},${Math.round(28 + r.c * 14)})`
      );
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.rx, r.ry, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWeed(w) {
    const sandY = bounds().sand + 4;
    const t = state.t;
    const amp = 12 + w.h * 0.045;
    const pts = [];
    for (let i = 0; i <= w.segs; i++) {
      const p = i / w.segs;
      const sway = Math.sin(t * 0.9 + w.phase + p * 2.2) * amp * p;
      pts.push({
        x: w.x + sway,
        y: sandY - w.h * p,
        r: Math.max(1.6, w.thick * (1 - p * 0.62)),
      });
    }
    const light = lerp(28, 18, state.nightT);
    ctx.beginPath();
    ctx.moveTo(pts[0].x - pts[0].r, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - pts[i].r * 0.85, pts[i].y);
    const tip = pts[pts.length - 1];
    ctx.quadraticCurveTo(tip.x, tip.y - 10, tip.x + tip.r * 0.85, tip.y);
    for (let i = pts.length - 2; i >= 0; i--) ctx.lineTo(pts[i].x + pts[i].r, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = `hsla(${w.hue}, 48%, ${light}%, 0.95)`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${w.hue + 16}, 52%, ${light + 16}%, 0.35)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // side blades
    for (const side of [-1, 1]) {
      const mid = pts[Math.floor(pts.length * 0.45)];
      if (!mid) continue;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y + 8);
      const lx = mid.x + side * (18 + w.thick);
      const ly = mid.y - 22;
      ctx.quadraticCurveTo(mid.x + side * 8, mid.y - 6, lx + Math.sin(t + w.phase) * 4, ly);
      ctx.quadraticCurveTo(mid.x + side * 10, mid.y, mid.x, mid.y + 4);
      ctx.closePath();
      ctx.fillStyle = `hsla(${w.hue + 8}, 46%, ${light + 6}%, 0.85)`;
      ctx.fill();
    }
  }

  function drawWeeds(extraOnly) {
    for (const w of state.weeds) {
      if (!!w.extra !== extraOnly) continue;
      if (w.extra && !state.owned.kelp) continue;
      drawWeed(w);
    }
  }

  function ensureExtraKelp() {
    if (state.weeds.some((w) => w.extra)) return;
    for (let i = 0; i < 6; i++) {
      state.weeds.push({
        x: state.w * (0.62 + i * 0.05) + rand(-10, 10),
        h: rand(state.h * 0.28, state.h * 0.42),
        segs: 10 + (Math.random() * 4) | 0,
        hue: rand(100, 145),
        thick: rand(6, 12),
        phase: rand(0, 6.28),
        extra: true,
      });
    }
  }

  function drawDecorations() {
    const b = bounds();
    const sand = b.sand;
    const w = state.w, h = state.h;
    if (state.owned.column) drawColumn(w * 0.88, sand);
    if (state.owned.castle) drawCastle(w * 0.64, sand);
    if (state.owned.coral) drawCoral(w * 0.15, sand);
    if (state.owned.chest) drawChest(w * 0.42, sand);
    if (state.owned.oyster) drawOyster(w * 0.30, sand);
    if (state.owned.starfish) drawStarfish(w * 0.5, sand + 4);
    if (state.owned.jelly) state.jellies.forEach(drawJelly);
  }

  function drawColumn(x, sand) {
    ctx.save();
    ctx.translate(x, sand);
    ctx.fillStyle = col("#cfc3a8", "#4d463a");
    ctx.fillRect(-16, -110, 32, 110);
    ctx.fillRect(-24, -118, 48, 12);
    ctx.fillRect(-22, -10, 44, 12);
    ctx.fillStyle = col("#9aa88a", "#3a4a38");
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(-6, -50, 8, 22, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCastle(x, sand) {
    ctx.save();
    ctx.translate(x, sand);
    const stone = col("#b7c3c8", "#3c4a52");
    const dark = col("#8c9aa0", "#2a3338");
    ctx.fillStyle = stone;
    ctx.fillRect(-70, -86, 140, 86);
    ctx.fillStyle = dark;
    ctx.fillRect(-86, -124, 42, 124);
    ctx.fillRect(44, -112, 36, 112);
    ctx.fillRect(-18, -150, 36, 64);
    const merlon = (x0, y0, n, ww) => {
      ctx.fillStyle = stone;
      for (let i = 0; i < n; i++) ctx.fillRect(x0 + i * ww, y0, ww * 0.55, 10);
    };
    merlon(-86, -134, 4, 11);
    merlon(44, -122, 3, 12);
    merlon(-70, -96, 8, 17);
    ctx.fillStyle = "#1a2430";
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-12, -36);
    ctx.quadraticCurveTo(0, -54, 12, -36);
    ctx.lineTo(12, 0);
    ctx.fill();
    ctx.fillRect(-6, -140, 8, 10);
    ctx.fillStyle = col("#d7a85a", "#7a5a20");
    ctx.fillRect(-5, -158, 6, 18);
    ctx.restore();
  }

  function drawCoral(x, sand) {
    ctx.save();
    ctx.translate(x, sand);
    const arms = [
      [0, -18, -26, -70, "#d46a6a"],
      [6, -12, 10, -86, "#e08a6a"],
      [-8, -10, -48, -50, "#c45a6e"],
      [12, -8, 40, -54, "#ef9a7a"],
      [0, -8, 4, -48, "#f2b39a"],
    ];
    ctx.lineCap = "round";
    for (const [x1, y1, x2, y2, c] of arms) {
      ctx.strokeStyle = col(c, "#6a3a40");
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(x1, y1, x2 + Math.sin(state.t * 0.7) * 3, y2);
      ctx.stroke();
      ctx.fillStyle = col(c, "#6a3a40");
      ctx.beginPath();
      ctx.arc(x2 + Math.sin(state.t * 0.7) * 3, y2, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawChest(x, sand) {
    ctx.save();
    ctx.translate(x, sand);
    ctx.fillStyle = col("#8a5a2c", "#3a2814");
    ctx.fillRect(-28, -24, 56, 24);
    const open = 0.35 + Math.sin(state.t * 0.6) * 0.15;
    ctx.fillStyle = col("#a56b34", "#4a3018");
    ctx.beginPath();
    ctx.ellipse(0, -24, 28, 12, 0, Math.PI, 0);
    ctx.fill();
    ctx.save();
    ctx.translate(0, -24);
    ctx.rotate(-open);
    ctx.fillStyle = col("#c48948", "#5a3a1c");
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 13, 0, Math.PI, 0, true);
    ctx.fill();
    ctx.restore();
    const glow = ctx.createRadialGradient(0, -20, 2, 0, -20, 28);
    glow.addColorStop(0, `rgba(255,210,90,${0.55 + open})`);
    glow.addColorStop(1, "rgba(255,210,90,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -18, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = varGold();
    ctx.fillRect(-4, -16, 8, 10);
    ctx.restore();
  }
  function varGold() { return col("#e8c988", "#8a7040"); }

  function drawOyster(x, sand) {
    const open = 0.4 + Math.sin(state.t * 0.55) * 0.4;
    ctx.save();
    ctx.translate(x, sand - 2);
    ctx.fillStyle = col("#b9b0a4", "#4a453e");
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.rotate(-open * 0.7);
    ctx.beginPath();
    ctx.ellipse(0, -2, 22, 8, 0, Math.PI, 0);
    ctx.fillStyle = col("#d8d0c6", "#5a554c");
    ctx.fill();
    ctx.restore();
    if (open > 0.45) {
      const g = ctx.createRadialGradient(0, -6, 1, 0, -6, 9);
      g.addColorStop(0, "#fff");
      g.addColorStop(1, "#e8d2f0");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -6, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStarfish(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(state.t * 0.2) * 0.05);
    ctx.fillStyle = col("#e07a3d", "#7a3e22");
    starPath(ctx, 0, 0, 7, 16, 5);
    ctx.fill();
    ctx.fillStyle = col("#f0a070", "#8a5230");
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function starPath(ctx, x, y, r0, r1, n) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? r0 : r1;
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawJelly(j) {
    const pulse = 1 + Math.sin(state.t * 1.6 + j.ph) * 0.08;
    ctx.save();
    ctx.translate(j.x, j.y);
    const a = 0.35 + state.nightT * 0.4;
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, j.s * 1.8);
    glow.addColorStop(0, `hsla(${j.hue}, 80%, 80%, ${a})`);
    glow.addColorStop(1, `hsla(${j.hue}, 80%, 70%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, j.s * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${j.hue}, 70%, 80%, 0.55)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, j.s * pulse, j.s * 0.7 * pulse, 0, Math.PI, 0);
    ctx.ellipse(0, 0, j.s * pulse, j.s * 0.35, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = `hsla(${j.hue}, 70%, 85%, 0.45)`;
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-j.s * 0.6 + i * (j.s * 0.3), 4);
      for (let k = 1; k < 8; k++) {
        const yy = 4 + k * 7;
        const xx = -j.s * 0.6 + i * (j.s * 0.3) + Math.sin(state.t * 2 + i + k * 0.6 + j.ph) * 4;
        ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMiniFish(f) {
    const ang = Math.atan2(f.vy, f.vx || 1);
    const wag = Math.sin(state.t * 12 + f.phase) * 0.4;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1);
    ctx.fillStyle = f.pal[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, f.size, f.size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.pal[1];
    ctx.beginPath();
    ctx.moveTo(-f.size * 0.8, 0);
    ctx.lineTo(-f.size * 1.5, f.size * 0.5 + wag * 3);
    ctx.lineTo(-f.size * 1.5, -f.size * 0.5 - wag * 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(f.size * 0.5, -f.size * 0.1, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFood(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(Math.sin(state.t * 2 + f.phase) * 0.3);
    if (f.id === "krill") {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size, f.size * 0.4, 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (f.id === "treat") {
      ctx.fillStyle = f.color;
      starPath(ctx, 0, 0, 4, 8, 5);
      ctx.fill();
    } else {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size, f.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(f.size * 0.4, 0, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.moveTo(-f.size, 0);
      ctx.lineTo(-f.size * 1.4, 4);
      ctx.lineTo(-f.size * 1.4, -4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawShark(s) {
    const L = s.length || sharkLen(s);
    const sp = Math.hypot(s.vx, s.vy);
    const wag = Math.sin(state.t * (6.5 + sp * 0.035) + s.phase) * (0.16 + Math.min(sp, 160) / 260);
    const female = s.gender === "f";

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    if (Math.cos(s.angle) < 0) ctx.scale(1, -1);

    const bodyGrad = ctx.createLinearGradient(0, -L * 0.2, 0, L * 0.2);
    if (female) {
      bodyGrad.addColorStop(0, "#5a6570");
      bodyGrad.addColorStop(0.35, "#9aa8b4");
      bodyGrad.addColorStop(0.7, "#e4d5d8");
      bodyGrad.addColorStop(1, "#f7eef0");
    } else {
      bodyGrad.addColorStop(0, "#243846");
      bodyGrad.addColorStop(0.35, "#4d7388");
      bodyGrad.addColorStop(0.72, "#c5d6de");
      bodyGrad.addColorStop(1, "#e7eef2");
    }

    // tail
    ctx.save();
    ctx.translate(-L * 0.46, 0);
    ctx.rotate(wag);
    ctx.fillStyle = female ? "#6a5a62" : "#2a3e4c";
    ctx.beginPath();
    ctx.moveTo(L * 0.05, 0);
    ctx.quadraticCurveTo(-L * 0.02, -L * 0.07, -L * 0.18, -L * 0.22);
    ctx.quadraticCurveTo(-L * 0.05, 0, -L * 0.16, L * 0.13);
    ctx.quadraticCurveTo(-L * 0.02, L * 0.04, L * 0.05, 0);
    ctx.fill();
    ctx.restore();

    // body
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    const h = L * 0.17;
    ctx.moveTo(L * 0.54, 0);
    ctx.bezierCurveTo(L * 0.44, -h * 0.35, L * 0.22, -h * 1.05, L * 0.02, -h * 1.08);
    ctx.bezierCurveTo(-L * 0.16, -h * 0.98, -L * 0.34, -h * 0.5, -L * 0.46, -h * 0.18 + wag * 8);
    ctx.quadraticCurveTo(-L * 0.5, wag * 10, -L * 0.46, h * 0.2 + wag * 8);
    ctx.bezierCurveTo(-L * 0.3, h * 0.78, L * 0.08, h * 0.92, L * 0.3, h * 0.42);
    ctx.bezierCurveTo(L * 0.42, h * 0.2, L * 0.5, h * 0.06, L * 0.54, 0);
    ctx.closePath();
    ctx.fill();

    if (female) {
      ctx.save();
      ctx.clip();
      const ir = ctx.createLinearGradient(-L * 0.2, -h, L * 0.4, h);
      ir.addColorStop(0, "rgba(255,190,210,0.0)");
      ir.addColorStop(0.5, "rgba(255,210,230,0.28)");
      ir.addColorStop(1, "rgba(200,230,255,0.12)");
      ctx.fillStyle = ir;
      ctx.fillRect(-L, -L, L * 2, L * 2);
      ctx.restore();
    } else {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "rgba(20,40,55,0.18)";
      ctx.beginPath();
      ctx.ellipse(-L * 0.02, -h * 0.2, L * 0.18, h * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // dorsal
    ctx.fillStyle = female ? "#4a4550" : "#1c2e3a";
    ctx.beginPath();
    ctx.moveTo(L * 0.04, -h * 1.0);
    ctx.quadraticCurveTo(L * 0.02, -h * 2.15, -L * 0.14, -h * 2.35);
    ctx.quadraticCurveTo(-L * 0.08, -h * 1.4, -L * 0.1, -h * 0.95);
    ctx.closePath();
    ctx.fill();
    if (!female) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-L * 0.04, -h * 1.5);
      ctx.lineTo(-L * 0.08, -h * 2.1);
      ctx.stroke();
    }

    // pectoral
    ctx.save();
    ctx.translate(L * 0.08, h * 0.35);
    ctx.rotate(0.5 + wag * 0.25);
    ctx.fillStyle = female ? "#c8b0b6" : "#3d5a6a";
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.16, L * 0.055, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // pelvic
    ctx.fillStyle = female ? "#b8a4aa" : "#355060";
    ctx.beginPath();
    ctx.moveTo(-L * 0.16, h * 0.55);
    ctx.quadraticCurveTo(-L * 0.2, h * 0.9, -L * 0.08, h * 0.72);
    ctx.closePath();
    ctx.fill();

    // gills
    ctx.strokeStyle = "rgba(30,30,30,0.35)";
    ctx.lineWidth = 1.15;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const gx = L * (0.22 - i * 0.035);
      ctx.arc(gx, 0, h * 0.55, 0.35, 1.15);
      ctx.stroke();
    }

    // mouth
    ctx.strokeStyle = "rgba(40,20,24,0.65)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const m = s.mouth;
    ctx.moveTo(L * 0.42, h * 0.06);
    ctx.quadraticCurveTo(L * 0.5, h * (0.08 + m * 0.18), L * 0.54, 0);
    ctx.stroke();
    if (m > 0.2) {
      ctx.fillStyle = `rgba(80,20,30,${m * 0.7})`;
      ctx.beginPath();
      ctx.ellipse(L * 0.49, h * 0.06, L * 0.04, h * 0.1 * m, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // eye
    const ex = L * 0.34, ey = -h * 0.28;
    ctx.fillStyle = "#f5f7f4";
    ctx.beginPath();
    ctx.ellipse(ex, ey, L * 0.038, L * 0.032, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = female ? "#5a2e32" : "#102028";
    ctx.beginPath();
    ctx.arc(ex + L * 0.008, ey, L * 0.018, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex + L * 0.004, ey - L * 0.008, L * 0.007, 0, Math.PI * 2);
    ctx.fill();

    // pearl mark on İnci
    if (female) {
      const pg = ctx.createRadialGradient(L * 0.18, h * 0.05, 1, L * 0.18, h * 0.05, L * 0.05);
      pg.addColorStop(0, "rgba(255,255,255,0.9)");
      pg.addColorStop(1, "rgba(255,220,230,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(L * 0.18, h * 0.05, L * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // nameplate when close to top? always a faint name under when not kissing
    drawNameplate(s);
  }

  function drawNameplate(s) {
    const mate = state.sharks[1 - s.id];
    if (state.kissing > 0) return;
    if (mate && Math.hypot(s.x - mate.x, s.y - mate.y) < 130) return;
    if (s.y < bounds().top + 8) return;
    const label = s.name;
    ctx.save();
    ctx.font = "600 12px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const y = s.y + (s.length || 80) * 0.22 + 6;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(4,12,18,0.4)";
    ctx.beginPath();
    roundRect(ctx, s.x - tw / 2 - 8, y - 2, tw + 16, 18, 9);
    ctx.fill();
    ctx.fillStyle = s.gender === "f" ? "#f3b3c4" : "#b8d4e8";
    ctx.fillText(label, s.x, y);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBubbles() {
    for (const b of state.bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(220,245,255,${0.25 + state.nightT * 0.1})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = `rgba(200,230,255,${0.08})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const a = clamp(p.life / (p.max || 1), 0, 1);
      if (p.kind === "heart") {
        ctx.fillStyle = p.c;
        ctx.globalAlpha = a;
        drawHeart(p.x, p.y, p.s * 5, a);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHeart(x, y, s, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 6, s / 6);
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(0, 3.2);
    ctx.bezierCurveTo(-5.2, -1.2, -4.8, -5.8, 0, -3.2);
    ctx.bezierCurveTo(4.8, -5.8, 5.2, -1.2, 0, 3.2);
    ctx.fill();
    ctx.restore();
  }

  function drawCoupleHearts() {
    if (!canBond()) return;
    const a = state.sharks[0], b = state.sharks[1];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 200) return;
    if (Math.sin(state.t * 2) > 0.6 && Math.random() < 0.03) {
      burstHearts((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, 1);
    }
  }

  function drawSurfaceAndGlass() {
    const { w, h } = state;
    // surface ripple
    ctx.save();
    const sg = ctx.createLinearGradient(0, 0, 0, h * 0.16);
    sg.addColorStop(0, `rgba(210,240,255,${0.18 * (1 - state.nightT * 0.5)})`);
    sg.addColorStop(1, "rgba(210,240,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, 8);
    for (let x = 0; x <= w; x += 10) {
      ctx.lineTo(x, 8 + Math.sin(x * 0.04 + state.t * 1.6) * 2.5);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // vignette / glass
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.2, w * 0.5, h * 0.5, h * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(0,0,0,${0.28 + state.nightT * 0.2})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 10;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    if (state.nightT > 0.5) {
      const moonX = w * 0.82, moonY = h * 0.1;
      const mg = ctx.createRadialGradient(moonX, moonY, 4, moonX, moonY, 80);
      mg.addColorStop(0, `rgba(210,230,255,${0.45 * state.nightT})`);
      mg.addColorStop(1, "rgba(210,230,255,0)");
      ctx.fillStyle = mg;
      ctx.fillRect(moonX - 80, moonY - 80, 160, 160);
      ctx.fillStyle = `rgba(230,238,255,${0.8 * state.nightT})`;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    drawWater();
    drawWeeds(false);
    drawDecorations();
    drawWeeds(true);
    drawSand();
    for (const f of state.fish) drawMiniFish(f);
    for (const f of state.foods) drawFood(f);
    const ordered = [...state.sharks].sort((a, b) => a.y - b.y);
    for (const s of ordered) drawShark(s);
    drawBubbles();
    drawParticles();
    drawSurfaceAndGlass();
  }

  /* -------------------- HUD -------------------- */
  function setNames() {
    const a = state.sharks[0], b = state.sharks[1];
    $("name-0").textContent = a.name;
    $("name-1").textContent = b.name;
    $("card-name-0").textContent = a.name;
    $("card-name-1").textContent = b.name;
    document.title = `Aşk Akvaryumu — ${a.name} & ${b.name}`;
  }

  function updateHUD() {
    $("coin-count").textContent = Math.floor(state.coins);
    state.sharks.forEach((s, i) => {
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
    const hungry = state.sharks.find((s) => s.hunger < 28);
    if (state.kissing > 0) $("hint").textContent = `${state.sharks[0].name} ve ${state.sharks[1].name} dans ediyor.`;
    else if (hungry) $("hint").textContent = `${hungry.name} acıktı. Bir mama bırak.`;
    else if (canBond()) $("hint").textContent = "İkisi de mutlu. Birlikte yüzüyorlar.";
    else $("hint").textContent = "Akvaryuma dokun, mama bırak.";
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
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
        if (f.price > 0 && state.coins < f.price) {
          toast("Yeterli midye yok.");
          return;
        }
        state.selectedFood = f.id;
        updateHUD();
        save();
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
        if (owned) {
          toast("Bu süs zaten akvaryumda.");
          return;
        }
        if (state.coins < d.price) {
          toast("Yeterli midye yok.");
          return;
        }
        state.coins -= d.price;
        state.owned[d.id] = true;
        if (d.id === "kelp") ensureExtraKelp();
        toast(`${d.name} akvaryuma eklendi.`);
        buildShop();
        updateHUD();
        save();
      });
      root.appendChild(btn);
    });
    const stats = document.createElement("p");
    stats.className = "sheet-lead";
    const days = Math.max(1, Math.round((now() - state.bornAt) / 86400000));
    stats.style.gridColumn = "1 / -1";
    stats.textContent = `Birlikte ${days} gün · ${state.feedCount} mama · ${state.kissCount} öpücük`;
    root.appendChild(stats);
  }

  /* -------------------- loop & init -------------------- */
  let lastTs = 0;
  let hudAcc = 0;
  let saveAcc = 0;
  let hungryToastAt = 0;

  function tick(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    state.t += dt;
    state.nightT = lerp(state.nightT, state.night ? 1 : 0, 1 - Math.pow(0.02, dt * 1.2));

    updateFoods(dt);
    updateShark(state.sharks[0], dt, state.sharks[1]);
    updateShark(state.sharks[1], dt, state.sharks[0]);
    maybeKiss(dt);
    updateAmbient(dt);
    drawCoupleHearts();
    render();

    hudAcc += dt;
    if (hudAcc > 0.25) {
      hudAcc = 0;
      updateHUD();
      const starving = state.sharks.find((s) => s.hunger < 18);
      if (starving && now() - hungryToastAt > 45000) {
        toast(`${starving.name} çok acıktı.`);
        hungryToastAt = now();
      }
    }
    saveAcc += dt;
    if (saveAcc > 4) {
      saveAcc = 0;
      save();
    }
    requestAnimationFrame(tick);
  }

  function initWorldFromSave() {
    const data = load();
    const specs = defaultSharks();
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
      state.bornAt = data.bornAt || now();
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
      applyOfflineDecay({ sharks: specs }, now() - (data.last || now()));
    }
    resize();
    state.sharks = specs.map((sp, i) => makeShark(sp, i));
    if (state.owned.kelp) ensureExtraKelp();
    setNames();
    buildFoods();
    updateHUD();
    if (!state.seenIntro) $("intro").classList.remove("hidden");
  }

  /* events */
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  canvas.addEventListener("pointerdown", (e) => {
    audio.start();
    const r = canvas.getBoundingClientRect();
    dropFood(e.clientX - r.left, e.clientY - r.top);
  });

  $("btn-enter").addEventListener("click", () => {
    state.seenIntro = true;
    $("intro").classList.add("hidden");
    audio.start();
    save();
  });

  $("btn-day").addEventListener("click", () => {
    state.night = !state.night;
    updateHUD();
    save();
  });

  $("btn-mute").addEventListener("click", () => {
    state.muted = !state.muted;
    audio.start();
    audio.setMuted(state.muted);
    updateHUD();
    save();
  });

  $("btn-shop").addEventListener("click", () => {
    buildShop();
    $("shop").classList.remove("hidden");
  });
  $("btn-close-shop").addEventListener("click", () => $("shop").classList.add("hidden"));
  $("shop").addEventListener("click", (e) => {
    if (e.target.id === "shop") $("shop").classList.add("hidden");
  });

  function openRename(i) {
    renameTarget = i;
    $("rename-title").textContent = state.sharks[i].name + " için yeni isim";
    $("rename-input").value = state.sharks[i].name;
    $("rename").classList.remove("hidden");
    setTimeout(() => $("rename-input").focus(), 50);
  }
  $("name-0").addEventListener("click", () => openRename(0));
  $("name-1").addEventListener("click", () => openRename(1));
  $("card-name-0").addEventListener("click", () => openRename(0));
  $("card-name-1").addEventListener("click", () => openRename(1));
  $("btn-close-rename").addEventListener("click", () => $("rename").classList.add("hidden"));
  $("rename").addEventListener("click", (e) => {
    if (e.target.id === "rename") $("rename").classList.add("hidden");
  });
  $("rename-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("rename-input").value.trim().replace(/\s+/g, " ");
    if (!v) return;
    state.sharks[renameTarget].name = v.slice(0, 16);
    setNames();
    $("rename").classList.add("hidden");
    save();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save();
    else {
      const data = load();
      if (data && data.last) {
        const elapsed = now() - data.last;
        if (elapsed > 2000) {
          applyOfflineDecay({ sharks: state.sharks }, elapsed);
          updateHUD();
        }
      }
    }
  });
  window.addEventListener("beforeunload", save);

  initWorldFromSave();
  requestAnimationFrame(tick);
})();
