import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TANK, tankBounds, applyUnderwater, dequantizeObject } from "./world.js";

export const CACHE = {
  sharks: {},
  coral: {},
  fish: {},
  ready: false,
};

const CORAL_FILES = {
  brain: "./models/coral/brain.glb",
  table: "./models/coral/table.glb",
  staghorn: "./models/coral/staghorn.glb",
  elkhorn: "./models/coral/elkhorn.glb",
  pillar: "./models/coral/pillar.glb",
  finger: "./models/coral/finger.glb",
  lettuce: "./models/coral/lettuce.glb",
  mushroom: "./models/coral/mushroom.glb",
  seafan: "./models/coral/seafan.glb",
  softbush: "./models/coral/softbush.glb",
  bubble: "./models/coral/bubble.glb",
  carnation: "./models/coral/carnation.glb",
  barrel_sponge: "./models/coral/barrel_sponge.glb",
  vase_sponge: "./models/coral/vase_sponge.glb",
  anemone: "./models/coral/anemone.glb",
  anemone_carpet: "./models/coral/anemone_carpet.glb",
  clam: "./models/coral/clam.glb",
  starfish: "./models/coral/starfish.glb",
  featherduster: "./models/coral/featherduster.glb",
  kelp: "./models/coral/kelp.glb",
  seagrass: "./models/coral/seagrass.glb",
  bommie: "./models/coral/bommie.glb",
  rock_outcrop: "./models/coral/rock_outcrop.glb",
  boulders: "./models/coral/boulders.glb",
};

export async function preloadActors(manager) {
  const loader = new GLTFLoader(manager);
  const load = async (url) => {
    try {
      const g = await loader.loadAsync(url);
      if (g?.scene) dequantizeObject(g.scene);
      return g;
    } catch (e) { console.warn("Asset failed", url, e); return null; }
  };
  const jobs = [];
  jobs.push(load("./models/sharks/blacktip.glb").then((g) => { CACHE.sharks.blacktip = g; }));
  jobs.push(load("./models/sharks/whitetip.glb").then((g) => { CACHE.sharks.whitetip = g; }));
  jobs.push(load("./models/fish/tropical.glb").then((g) => { CACHE.fish.clown = g; }));
  for (const [k, url] of Object.entries(CORAL_FILES)) {
    jobs.push(load(url).then((g) => { CACHE.coral[k] = g; }));
  }
  await Promise.all(jobs);
  CACHE.ready = true;
  return CACHE;
}

export async function loadSharkGltf(renderer, manager) {
  if (!CACHE.ready) await preloadActors(manager);
  const { blacktip, whitetip } = CACHE.sharks;
  if (!blacktip && !whitetip) return null;
  return { blacktip: blacktip || whitetip, whitetip: whitetip || blacktip };
}

function pickGltf(pack, gender) {
  if (!pack) return null;
  if (pack.blacktip || pack.whitetip) {
    return gender === "f" ? (pack.whitetip || pack.blacktip) : (pack.blacktip || pack.whitetip);
  }
  // legacy single gltf
  if (pack.scene) return pack;
  return null;
}

function normalizeModel(root, length) {
  root.updateMatrixWorld(true);
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  wrap.add(inner);
  inner.add(root);
  const aimLengthOnX = () => {
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    if (size.z >= size.x && size.z >= size.y) inner.rotation.y += Math.PI / 2;
    else if (size.y >= size.x && size.y >= size.z) inner.rotation.z += -Math.PI / 2;
  };
  aimLengthOnX();
  aimLengthOnX();
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const center = box.getCenter(new THREE.Vector3());
  inner.position.sub(center);
  const size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(length / Math.max(size.x, 0.001));
  wrap.updateMatrixWorld(true);
  return wrap;
}

function addAlongAttribute(wrap) {
  wrap.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
  const v = new THREE.Vector3();
  const buckets = [];
  let minX = Infinity, maxX = -Infinity;
  wrap.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const arr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      o.localToWorld(v);
      v.applyMatrix4(inv);
      arr[i] = v.x;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
    }
    buckets.push({ o, arr });
  });
  const span = Math.max(1e-4, maxX - minX);
  for (const { o, arr } of buckets) {
    const along = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) along[i] = (arr[i] - minX) / span;
    o.geometry = o.geometry.clone();
    o.geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  }
}

function upgradeSharkMaterial(src, gender) {
  const p = new THREE.MeshStandardMaterial();
  if (src) {
    p.color = src.color ? src.color.clone() : new THREE.Color(0x8899aa);
    p.map = src.map || null;
    p.normalMap = src.normalMap || null;
    p.roughnessMap = src.roughnessMap || null;
    p.metalnessMap = src.metalnessMap || null;
    p.aoMap = src.aoMap || null;
    p.roughness = Math.min(src.roughness ?? 0.48, 0.48);
    p.metalness = 0.04;
    if (src.map) p.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (gender === "f") {
    p.color.multiply(new THREE.Color(0.95, 0.82, 0.72));
    p.emissive = new THREE.Color(0x1a100c);
  } else {
    p.color.multiply(new THREE.Color(0.46, 0.52, 0.62));
    p.emissive = new THREE.Color(0x0a1218);
  }
  p.emissiveIntensity = 0.05;
  p.envMapIntensity = 0.55;
  p.roughness = Math.min(Math.max(p.roughness, 0.42), 0.62);
  return p;
}

const SWIM_VERT = `
  float along = aAlong;
  float wag = sin(uTime * 6.15 + along * 5.4 + uPhase) * uAmp * along * along;
  transformed.z += wag * 0.45;
  transformed.x += wag * 0.02;
  float pec = smoothstep(0.32, 0.52, along) * (1.0 - smoothstep(0.52, 0.78, along));
  transformed.y += sin(uTime * 8.2 + uPhase) * pec * uAmp * 0.16;
`;

export function createSharkActor(spec, gltf, uniforms, length) {
  const pivot = new THREE.Group();
  let model, mixer, actions = {};
  let procedural = false;
  const swimU = {
    uAmp: { value: 0.2 },
    uPhase: { value: Math.random() * 6.28 },
  };

  const pack = pickGltf(gltf, spec.gender);
  if (pack) {
    const cloned = skeletonClone(pack.scene);
    cloned.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const src = o.material;
        const mats = Array.isArray(src) ? src : [src];
        const upgraded = mats.map((m) => {
          const p = upgradeSharkMaterial(m, spec.gender);
          applyUnderwater(p, uniforms, {
            key: "shark-swim-" + spec.gender,
            uniforms: { uAmp: swimU.uAmp, uPhase: swimU.uPhase },
            vertexCommon: "attribute float aAlong; uniform float uAmp; uniform float uPhase; uniform float uTime;",
            vertexBend: SWIM_VERT,
          });
          return p;
        });
        o.material = Array.isArray(src) ? upgraded : upgraded[0];
      }
    });
    model = normalizeModel(cloned, length);
    addAlongAttribute(model);
    mixer = new THREE.AnimationMixer(cloned);
    const clips = pack.animations || [];
    const swim = clips.find((c) => /swim/i.test(c.name)) || clips[0];
    const bite = clips.find((c) => /bite/i.test(c.name));
    if (swim && clips.length && /swim|idle|loop/i.test(swim.name)) {
      // only play if the source actually had skeletal clips (reef-animated fallback)
      actions.swim = mixer.clipAction(swim);
      actions.swim.play();
      actions.swim.setLoop(THREE.LoopRepeat);
    }
    if (bite) {
      actions.bite = mixer.clipAction(bite);
      actions.bite.setLoop(THREE.LoopOnce);
      actions.bite.clampWhenFinished = true;
    }
  } else {
    procedural = true;
    model = createProceduralShark(spec.gender, length, uniforms, swimU);
  }

  if (spec.gender === "f") model.scale.multiplyScalar(0.9);
  else model.scale.multiplyScalar(1.06);
  model.userData.swim = swimU;
  pivot.add(model);

  const labelEl = document.createElement("div");
  labelEl.className = "shark-label " + (spec.gender === "f" ? "female" : "male");
  labelEl.textContent = spec.name;
  const label = new CSS2DObject(labelEl);
  label.position.set(0, 0.28, 0);
  pivot.add(label);

  return {
    id: spec.id,
    name: spec.name,
    gender: spec.gender,
    pivot,
    model,
    mixer,
    actions,
    procedural,
    label,
    labelEl,
    hunger: spec.hunger,
    happiness: spec.happiness,
    love: spec.love,
    x: spec.x, y: spec.y, z: spec.z,
    vx: 0, vy: 0, vz: 0,
    heading: spec.id === 0 ? 0 : Math.PI,
    pitch: 0,
    state: "wander",
    tx: 0, ty: 1, tz: 0,
    retarget: 0,
    eatCool: 0,
    biteT: 0,
    phase: Math.random() * Math.PI * 2,
    length,
  };
}

export function playBite(shark) {
  shark.biteT = 0.45;
  const bite = shark.actions.bite;
  const swim = shark.actions.swim;
  if (bite) {
    bite.reset();
    bite.play();
    if (swim) swim.crossFadeTo(bite, 0.08, false);
    const onDone = () => {
      shark.mixer.removeEventListener("finished", onDone);
      if (swim) {
        swim.reset().play();
        bite.crossFadeTo(swim, 0.2, false);
      }
    };
    shark.mixer.addEventListener("finished", onDone);
  }
}

export function updateSharkVisual(shark, dt) {
  shark.pivot.position.set(shark.x, shark.y, shark.z);
  const targetYaw = shark.heading;
  const targetPitch = shark.pitch;
  shark.pivot.rotation.order = "YXZ";
  shark.pivot.rotation.y = THREE.MathUtils.lerp(shark.pivot.rotation.y, targetYaw, 1 - Math.pow(0.018, dt * 2.4));
  shark.pivot.rotation.x = THREE.MathUtils.lerp(shark.pivot.rotation.x, -targetPitch, 1 - Math.pow(0.05, dt));
  const sp = Math.hypot(shark.vx, shark.vy, shark.vz);
  if (shark.mixer && shark.actions.swim) {
    const rate = THREE.MathUtils.clamp(0.7 + sp * 0.9, 0.6, 2.1);
    shark.actions.swim.setEffectiveTimeScale(rate);
    shark.mixer.update(dt);
  } else if (shark.mixer) {
    shark.mixer.update(dt);
  }
  const swim = shark.model?.userData?.swim;
  if (swim) {
    swim.uAmp.value = 0.16 + Math.min(sp, 1.6) * 0.22;
  }
  shark.label.position.set(0, 0.32, 0);
}

export function createProceduralShark(gender, length, uniforms, swimU) {
  const group = new THREE.Group();
  const female = gender === "f";
  const geo = buildSharkGeometry(length);
  const mat = new THREE.MeshStandardMaterial({
    color: female ? 0xc9a090 : 0x6a8494,
    roughness: 0.42,
    metalness: 0.08,
    vertexColors: true,
  });
  const su = swimU || { uAmp: { value: 0.22 }, uPhase: { value: Math.random() * 6.28 } };
  applyUnderwater(mat, uniforms, {
    key: "proc-shark",
    uniforms: { uAmp: su.uAmp, uPhase: su.uPhase },
    vertexCommon: "uniform float uAmp; uniform float uPhase; uniform float uTime;",
    vertexBend: `
      float along = (position.x + 0.5);
      float wag = sin(uTime * 6.5 + along * 4.0 + uPhase) * uAmp * along * along;
      transformed.z += wag * 0.35;
      transformed.x += wag * 0.02;
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  addFins(group, length, mat);
  group.userData.swim = su;
  return group;
}

function sitOnSand(obj, y = TANK.sand) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y += y - box.min.y;
}

function cloneCoral(name, targetSize, uniforms, opts = {}) {
  const src = CACHE.coral[name];
  if (!src) return null;
  const root = src.scene.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const srcMat = o.material;
    const m = srcMat.clone();
    if (opts.tint) m.color?.multiply(new THREE.Color(opts.tint));
    if (m.roughness !== undefined) m.roughness = Math.min(m.roughness ?? 0.6, 0.62);
    m.envMapIntensity = 0.55;
    const sway = opts.sway;
    applyUnderwater(m, uniforms, sway ? {
      key: "sway-" + name,
      uniforms: { uPhase: { value: opts.phase || 0 } },
      vertexCommon: "uniform float uTime; uniform float uPhase;",
      vertexBend: `
        float h = clamp(position.y, 0.0, 2.5);
        transformed.x += sin(uTime * 1.15 + uPhase + h * 2.4) * h * 0.08;
        transformed.z += cos(uTime * 0.9 + uPhase + h * 1.7) * h * 0.06;
      `,
    } : { key: "coral-" + name });
    o.material = m;
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const s = targetSize / maxDim;
  if (!Number.isFinite(s) || s > 20 || s < 1e-4) return null;
  root.scale.setScalar(s);
  return root;
}

function place(group, mesh, x, z, rotY = 0) {
  if (!mesh) return;
  mesh.position.set(x, TANK.sand, z);
  mesh.rotation.y = rotY;
  sitOnSand(mesh);
  group.add(mesh);
}

export function createReefScenery(quality, uniforms) {
  const group = new THREE.Group();
  group.name = "reef";
  const rng = mulberry(7);
  const n = (quality.software || quality.mobile) ? 0.55 : 1;

  const layout = [
    ["boulders", 0.95, -1.85, -0.52, 0.4],
    ["bommie", 0.7, -1.55, -0.15, 0.8],
    ["rock_outcrop", 0.85, 1.75, -0.55, -0.5],
    ["bommie", 0.55, 1.45, 0.05, 1.2],
    ["brain", 0.42, -1.35, 0.35, 0.2, { tint: 0xffc4b0 }],
    ["brain", 0.32, 1.15, -0.45, 1.1, { tint: 0xffd0c4 }],
    ["mushroom", 0.34, -0.95, -0.58, 0.6, { tint: 0xf0a0c0 }],
    ["table", 0.55, 0.15, -0.62, 0.3],
    ["lettuce", 0.3, 0.55, -0.5, 0.9, { tint: 0x90e0a0 }],
    ["bubble", 0.28, -0.45, -0.55, 0.1, { tint: 0xffe8a0 }],
    ["staghorn", 0.72, -1.9, -0.25, 0.5, { tint: 0xf2c4a0 }],
    ["elkhorn", 0.7, 1.95, -0.3, -0.4, { tint: 0xf8d8a8 }],
    ["pillar", 0.7, -1.7, -0.6, 0.0],
    ["finger", 0.4, 0.85, -0.58, 0.7],
    ["seafan", 0.55, -1.15, -0.62, 0.9, { sway: true }],
    ["seafan", 0.42, 1.25, -0.6, -0.8, { sway: true, tint: 0xff88aa }],
    ["softbush", 0.38, -0.2, -0.58, 0.4, { sway: true, tint: 0xff6a8a }],
    ["carnation", 0.32, 0.35, -0.48, 1.4, { sway: true, tint: 0xff4466 }],
    ["barrel_sponge", 0.32, -0.7, 0.48, 0.3, { tint: 0xc45a2a }],
    ["vase_sponge", 0.26, 0.95, 0.42, 0.8, { tint: 0xd07040 }],
    ["clam", 0.28, -0.15, 0.5, 0.4],
    ["starfish", 0.16, 0.55, 0.52, 0.2],
    ["featherduster", 0.28, -1.05, 0.38, 0.6, { sway: true }],
    ["anemone", 0.42, -1.25, 0.22, 0.3, { sway: true, tint: 0xff88aa }],
    ["anemone", 0.34, 1.35, 0.28, -0.5, { sway: true, tint: 0xffc0d0 }],
    ["anemone_carpet", 0.5, -0.55, -0.4, 0.8, { sway: true }],
  ];
  for (const item of layout) {
    const [name, size, x, z, rot, opts] = item;
    if (n < 1 && /featherduster|elkhorn|pillar|carnation|softbush|table/.test(name)) continue;
    const mesh = cloneCoral(name, size * (0.9 + rng() * 0.2), uniforms, {
      ...(opts || {}),
      phase: rng() * 6.28,
    });
    place(group, mesh, x, z, rot);
  }
  return group;
}

export function createKelp(quality, uniforms) {
  const group = new THREE.Group();
  const n = quality.kelp;
  const rng = mulberry(11);
  if (CACHE.coral.kelp && !quality.software) {
    const count = n;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (1.55 + rng() * 0.55);
      const z = -TANK.d / 2 + 0.22 + rng() * (TANK.d * 0.4);
      const mesh = cloneCoral("kelp", 0.85 + rng() * 0.55, uniforms, { sway: true, phase: rng() * 6.28, tint: 0xb8d060 });
      place(group, mesh, x, z, rng() * Math.PI * 2);
    }
  } else {
    const blade = bladeGeo();
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (0.9 + rng() * 1.15);
      const z = -TANK.d / 2 + 0.28 + rng() * (TANK.d * 0.45);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.32 + rng() * 0.06, 0.6, 0.22),
        roughness: 0.7, metalness: 0, side: THREE.DoubleSide,
      });
      applyUnderwater(mat, uniforms, {
        key: "blade",
        uniforms: { uPhase: { value: rng() * 6.28 } },
        vertexCommon: "uniform float uTime; uniform float uPhase;",
        vertexBend: `
          float h = position.y;
          transformed.x += sin(uTime * 1.15 + uPhase + h * 2.6) * h * 0.18;
          transformed.z += cos(uTime * 0.9 + uPhase + h * 1.8) * h * 0.1;
        `,
      });
      const mesh = new THREE.Mesh(blade, mat);
      const h = 0.55 + rng() * 0.55;
      mesh.scale.set(0.7 + rng() * 0.5, h, 1);
      mesh.position.set(x, TANK.sand, z);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  if (CACHE.coral.seagrass && !quality.software) {
    const count = quality.mobile ? 4 : 8;
    for (let i = 0; i < count; i++) {
      const x = (rng() - 0.5) * 3.6;
      const z = -TANK.d / 2 + 0.2 + rng() * 0.45;
      const mesh = cloneCoral("seagrass", 0.28 + rng() * 0.18, uniforms, { sway: true, phase: rng() * 6.28, tint: 0x88c050 });
      place(group, mesh, x, z, rng() * 6.28);
    }
  }
  return group;
}

function bladeGeo() {
  const g = new THREE.PlaneGeometry(0.09, 1, 1, 24);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.5;
    const x = pos.getX(i);
    pos.setX(i, x * (1.1 - y * 0.7));
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

/* -------------------- colorful reef fish -------------------- */
const SPECIES = {
  tang:      { len: 0.16, h: 0.28, w: 0.07,  color: 0x2a5ad6, fin: 0x2652c4, tail: 0xf2cc22, belly: 0x4a76e0, caudal: "fork" },
  yellowtang:{ len: 0.14, h: 0.36, w: 0.05,  color: 0xf4d82a, fin: 0xf0cc20, tail: 0xf0cc20, belly: 0xf6e05a, caudal: "square" },
  butterfly: { len: 0.13, h: 0.34, w: 0.055, color: 0xf2cc2a, fin: 0xf2cc2a, tail: 0xf2cc2a, belly: 0xf4dc6a, caudal: "square", band: 0x141414 },
  angel:     { len: 0.14, h: 0.38, w: 0.055, color: 0xdcdedc, fin: 0xe2e2de, tail: 0xe2e2de, belly: 0xc4c8cc, caudal: "fan", bar: 0x1a1a1c },
  tetra:     { len: 0.055,h: 0.22, w: 0.08,  color: 0x3a1a2a, fin: 0xe05070, tail: 0xe05070, belly: 0xc8a0a8, caudal: "fork", stripe: 0x40e0ff },
};

function speciesGeo(spec) {
  const L = 0.11;
  const body = new THREE.SphereGeometry(0.05, 16, 12);
  body.scale(L * (spec.len / 0.14) * 9.5, 0.05 * spec.h / 0.28 * 1.15, 0.05 * spec.w / 0.07);
  const parts = [body];
  const tail = new THREE.ConeGeometry(0.03 * (spec.h / 0.28), 0.05, 8);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.095 * (spec.len / 0.14) * 1.1, 0, 0);
  parts.push(tail);
  const dorsal = new THREE.ConeGeometry(0.018, 0.04 * (spec.h / 0.28), 6);
  dorsal.translate(0.0, 0.042 * (spec.h / 0.28) * 1.2, 0);
  parts.push(dorsal);
  const geo = mergeGeometries(parts, false);
  geo.computeVertexNormals();
  const col = new THREE.Color(spec.color);
  const belly = new THREE.Color(spec.belly);
  const tailC = new THREE.Color(spec.tail);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    let c = col.clone();
    if (y < -0.01) c.lerp(belly, 0.7);
    if (x < -0.07) c = tailC.clone();
    if (spec.band && Math.abs(x - 0.02) < 0.012) c.set(spec.band);
    if (spec.bar && (Math.abs(x) < 0.01 || Math.abs(x - 0.04) < 0.01)) c.set(spec.bar);
    if (spec.stripe && Math.abs(y) < 0.008) c.set(spec.stripe);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function createFishSchool(quality, uniforms) {
  const group = new THREE.Group();
  const schools = [];
  const counts = quality.mobile
    ? { tang: 3, yellowtang: 3, butterfly: 3, angel: 2, tetra: 10 }
    : { tang: 6, yellowtang: 5, butterfly: 5, angel: 3, tetra: 18 };

  const bases = {
    tang:       { cx: -0.9, cy: 0.85, cz: -0.1 },
    yellowtang: { cx: 1.0,  cy: 1.15, cz: 0.15 },
    butterfly:  { cx: 0.2,  cy: 0.7,  cz: 0.25 },
    angel:      { cx: 0.7,  cy: 1.35, cz: -0.2 },
    tetra:      { cx: -0.3, cy: 1.05, cz: 0.2 },
  };

  for (const [name, n] of Object.entries(counts)) {
    const spec = SPECIES[name];
    const geo = speciesGeo(spec);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.08,
      envMapIntensity: 0.55,
    });
    applyUnderwater(mat, uniforms, { key: "fish-" + name });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.castShadow = true;
    inst.frustumCulled = false;
    group.add(inst);
    const members = [];
    const b = bases[name];
    const spread = name === "tetra" ? 0.55 : 0.7;
    for (let i = 0; i < n; i++) {
      members.push({
        x: b.cx + (Math.random() - 0.5) * spread,
        y: b.cy + (Math.random() - 0.5) * 0.35,
        z: b.cz + (Math.random() - 0.5) * 0.45,
        vx: (Math.random() - 0.5) * 0.2,
        vy: 0,
        vz: (Math.random() - 0.5) * 0.2,
        phase: Math.random() * 6.28,
        scale: 0.85 + Math.random() * 0.3,
      });
    }
    schools.push({ inst, members });
  }

  // Real clownfish models near the anemone
  if (CACHE.fish.clown) {
    const n = quality.mobile ? 2 : 4;
    const objects = [];
    const members = [];
    for (let i = 0; i < n; i++) {
      const cloned = CACHE.fish.clown.scene.clone(true);
      cloned.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
          if (o.material) {
            o.material = o.material.clone();
            applyUnderwater(o.material, uniforms, { key: "clown" });
          }
        }
      });
      const wrap = normalizeModel(cloned, 0.11 + i * 0.008);
      group.add(wrap);
      const mixer = new THREE.AnimationMixer(cloned);
      const clip = CACHE.fish.clown.animations?.[0];
      if (clip) {
        const act = mixer.clipAction(clip);
        act.play();
        act.setLoop(THREE.LoopRepeat);
        act.time = i * 0.4;
      }
      objects.push({ wrap, mixer });
      members.push({
        x: -1.15 + (Math.random() - 0.5) * 0.35,
        y: 0.45 + Math.random() * 0.2,
        z: 0.18 + (Math.random() - 0.5) * 0.2,
        vx: 0.05, vy: 0, vz: 0,
        phase: Math.random() * 6.28,
        scale: 1,
        object: wrap,
        mixer,
      });
    }
    schools.push({ inst: null, members, objects: true });
  }

  return { group, schools };
}

export function updateFish(schools, sharks, dt) {
  const b = tankBounds();
  const dummy = new THREE.Object3D();
  const now = performance.now();
  for (const school of schools) {
    let cx = 0, cy = 0, cz = 0;
    for (const f of school.members) { cx += f.x; cy += f.y; cz += f.z; }
    const n = school.members.length;
    cx /= n; cy /= n; cz /= n;
    school.members.forEach((f, i) => {
      f.vx += (cx - f.x) * 0.5 * dt;
      f.vy += (cy - f.y) * 0.5 * dt;
      f.vz += (cz - f.z) * 0.5 * dt;
      f.vx += Math.sin(now * 0.001 + f.phase) * 0.15 * dt;
      f.vy += Math.cos(now * 0.0008 + f.phase) * 0.1 * dt;
      for (const s of sharks) {
        const dx = f.x - s.x, dy = f.y - s.y, dz = f.z - s.z;
        const d = Math.hypot(dx, dy, dz) || 0.001;
        if (d < 0.7) {
          f.vx += (dx / d) * 2.2 * dt;
          f.vy += (dy / d) * 2.2 * dt;
          f.vz += (dz / d) * 2.2 * dt;
        }
      }
      if (f.x < b.minX) f.vx += dt * 1.4;
      if (f.x > b.maxX) f.vx -= dt * 1.4;
      if (f.y < b.minY) f.vy += dt * 1.2;
      if (f.y > b.maxY) f.vy -= dt * 1.2;
      if (f.z < b.minZ) f.vz += dt * 1.4;
      if (f.z > b.maxZ) f.vz -= dt * 1.4;
      const sp = Math.hypot(f.vx, f.vy, f.vz);
      const maxSp = school.objects ? 0.35 : 0.55;
      if (sp > maxSp) { f.vx *= maxSp / sp; f.vy *= maxSp / sp; f.vz *= maxSp / sp; }
      f.x += f.vx; f.y += f.vy; f.z += f.vz;
      if (f.object) {
        f.object.position.set(f.x, f.y, f.z);
        f.object.lookAt(f.x + f.vx, f.y + f.vy, f.z + f.vz);
        f.object.rotateY(Math.PI / 2);
        if (f.mixer) f.mixer.update(dt);
      } else if (school.inst) {
        dummy.position.set(f.x, f.y, f.z);
        dummy.lookAt(f.x + f.vx, f.y + f.vy, f.z + f.vz);
        dummy.rotateY(Math.PI / 2);
        dummy.scale.setScalar(f.scale || 1);
        dummy.updateMatrix();
        school.inst.setMatrixAt(i, dummy.matrix);
      }
    });
    if (school.inst) school.inst.instanceMatrix.needsUpdate = true;
  }
}

export function createBubbles(quality) {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const Mat = quality.transmission ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new Mat({
    color: 0xcfefff,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    ...(quality.transmission ? { transmission: 0.7, thickness: 0.1 } : {}),
  });
  const inst = new THREE.InstancedMesh(geo, mat, quality.bubbles);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  inst.raycast = () => {};
  const items = [];
  for (let i = 0; i < quality.bubbles; i++) {
    items.push({
      x: (Math.random() - 0.5) * TANK.w * 0.9,
      y: Math.random() * TANK.water,
      z: (Math.random() - 0.5) * TANK.d * 0.9,
      r: 0.008 + Math.random() * 0.022,
      vy: 0.12 + Math.random() * 0.22,
      ph: Math.random() * 6.28,
    });
  }
  const dummy = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    dummy.position.set(b.x, b.y, b.z);
    dummy.scale.setScalar(b.r);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  return { inst, items };
}

export function updateBubbles(bubbles, t, dt) {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < bubbles.items.length; i++) {
    const b = bubbles.items[i];
    b.y += b.vy * dt;
    b.x += Math.sin(t * 1.3 + b.ph) * 0.04 * dt;
    if (b.y > TANK.water - 0.05) {
      b.y = TANK.sand + 0.05;
      b.x = (Math.random() - 0.5) * TANK.w * 0.9;
      b.z = (Math.random() - 0.5) * TANK.d * 0.9;
    }
    dummy.position.set(b.x, b.y, b.z);
    dummy.scale.setScalar(b.r);
    dummy.updateMatrix();
    bubbles.inst.setMatrixAt(i, dummy.matrix);
  }
  bubbles.inst.instanceMatrix.needsUpdate = true;
}

export function createSnow(quality) {
  const g = new THREE.BufferGeometry();
  const n = quality.snow;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * TANK.w;
    pos[i * 3 + 1] = Math.random() * TANK.water;
    pos[i * 3 + 2] = (Math.random() - 0.5) * TANK.d;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xd7eef8,
    size: 0.011,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export function updateSnow(pts, dt) {
  const p = pts.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) - 0.03 * dt;
    let x = p.getX(i) + Math.sin(i + performance.now() * 0.0003) * 0.01 * dt;
    if (y < TANK.sand) y = TANK.water - 0.05;
    p.setXYZ(i, x, y, p.getZ(i));
  }
  p.needsUpdate = true;
}

function mulberry(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


function buildSharkGeometry(L) {
  const rings = 36, segs = 24;
  const positions = [], normals = [], colors = [], indices = [];
  const profile = (t) => {
    // t 0 tail -> 1 nose
    const belly = Math.sin(t * Math.PI);
    if (t < 0.08) return 0.02 + t * 0.6;
    if (t < 0.55) return 0.09 + belly * 0.13;
    if (t < 0.82) return 0.17 * (1.0 - (t - 0.55) * 0.4);
    return 0.12 * (1.0 - (t - 0.82) / 0.18);
  };
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const x = (t - 0.5) * L;
    const r = profile(t) * L * 1.05;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const ny = Math.cos(a), nz = Math.sin(a);
      const rr = r * (1.0 - 0.18 * Math.max(ny, 0.0)); // slightly flatter belly? actually ny+ is up
      const y = ny * rr * 0.9;
      const z = nz * rr;
      positions.push(x, y, z);
      const n = new THREE.Vector3(0.15 * (t - 0.5), ny, nz).normalize();
      normals.push(n.x, n.y, n.z);
      // countershading: dark top, white belly
      const up = ny * 0.5 + 0.5;
      const dark = [0.18, 0.26, 0.32];
      const light = [0.86, 0.89, 0.91];
      const k = Math.pow(1 - up, 1.4);
      colors.push(dark[0] + (light[0] - dark[0]) * k, dark[1] + (light[1] - dark[1]) * k, dark[2] + (light[2] - dark[2]) * k);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // attach fins as merged? we'll just merge with BufferGeometryUtils in a simple way by returning a group later.
  // For a single mesh, add fin vertices:
  const fins = [
    finVerts(L, 0.02, 0.16, 0.0, 0.28, 0.0, "dorsal"),
    finVerts(L, -0.38, 0.02, 0.22, 0.16, 0, "tail"),
  ];
  // simpler: keep body only and add fins as children in createProceduralShark
  // actually already returning body geo; fins added below via extra meshes in builder caller
  return geo;
}

function addFins(group, L, mat) {
  // dorsal
  const dorsal = new THREE.Mesh(finShape(L * 0.22, L * 0.2, 0.03), mat);
  dorsal.position.set(L * 0.02, L * 0.09, 0);
  dorsal.castShadow = true;
  group.add(dorsal);
  // caudal
  const tailU = new THREE.Mesh(finShape(L * 0.2, L * 0.16, 0.025), mat);
  tailU.position.set(-L * 0.48, L * 0.06, 0);
  tailU.rotation.z = 0.5;
  group.add(tailU);
  const tailL = new THREE.Mesh(finShape(L * 0.14, L * 0.1, 0.022), mat);
  tailL.position.set(-L * 0.48, -L * 0.04, 0);
  tailL.rotation.z = -0.7;
  group.add(tailL);
  // pectorals
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(finShape(L * 0.16, L * 0.1, 0.016), mat);
    p.position.set(L * 0.08, -L * 0.02, s * L * 0.08);
    p.rotation.set(s * 0.9, 0, -0.4);
    group.add(p);
  }
}

function finShape(len, height, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(len * 0.4, height * 0.15, len * 0.15, height);
  s.quadraticCurveTo(len * 0.55, height * 0.45, len, 0.02);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, steps: 1 });
  g.translate(0, 0, -thick / 2);
  g.computeVertexNormals();
  return g;
}

// hook fins into procedural - patch createProceduralShark after body
// (we add them here by monkey-patching? better edit the function - already closed.
// I'll add fins in a small post function called from createProceduralShark by editing... 
// I'll append a call: we need to modify createProceduralShark. Let's do it via wrapping at bottom.

const _origProc = createProceduralShark;
// can't reassign export easily. I'll leave a note and fix the file after by search-replace.

export function attachProceduralFins(group, L, mat) {
  addFins(group, L, mat);
}

export function makeDecoration(id, uniforms) {
  const g = new THREE.Group();
  g.name = id;
  const sandY = TANK.sand;
  if (id === "coral") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd46a6a, roughness: 0.6 });
    applyUnderwater(mat, uniforms);
    for (let i = 0; i < 7; i++) {
      const h = 0.18 + Math.random() * 0.28;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, h, 8), mat);
      m.position.set((Math.random() - 0.5) * 0.25, h / 2, (Math.random() - 0.5) * 0.25);
      m.rotation.z = (Math.random() - 0.5) * 0.6;
      m.rotation.x = (Math.random() - 0.5) * 0.6;
      m.castShadow = true;
      g.add(m);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), mat);
      tip.position.copy(m.position).y += h / 2;
      g.add(tip);
    }
    g.position.set(-1.5, sandY, 0.35);
  } else if (id === "starfish") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xe07a3d, roughness: 0.7 });
    applyUnderwater(mat, uniforms);
    const sh = new THREE.Mesh(starGeo(0.07, 0.16, 5), mat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.01;
    g.add(sh);
    g.position.set(0.4, sandY, 0.45);
  } else if (id === "column") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfc3a8, roughness: 0.8 });
    applyUnderwater(mat, uniforms);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 12), mat);
    col.position.y = 0.35;
    col.castShadow = true;
    g.add(col);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12), mat);
    cap.position.y = 0.73;
    g.add(cap);
    g.position.set(1.85, sandY, -0.35);
  } else if (id === "castle") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb7c3c8, roughness: 0.75 });
    applyUnderwater(mat, uniforms);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.4), mat);
    keep.position.y = 0.21;
    keep.castShadow = true;
    g.add(keep);
    const tw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), mat);
    tw.position.set(-0.28, 0.31, 0.12);
    g.add(tw);
    const tw2 = tw.clone(); tw2.position.x = 0.28;
    g.add(tw2);
    g.position.set(1.15, sandY, 0.35);
  } else if (id === "chest") {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a2c, roughness: 0.6 });
    applyUnderwater(mat, uniforms);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.18), mat);
    box.position.y = 0.08;
    box.castShadow = true;
    g.add(box);
    const gold = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8c988, emissive: 0x7a5a10, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.8 }));
    gold.position.set(0, 0.16, 0);
    g.add(gold);
    g.position.set(-0.2, sandY, -0.45);
  } else if (id === "oyster") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9b0a4, roughness: 0.5 });
    applyUnderwater(mat, uniforms);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    sh.rotation.x = Math.PI;
    sh.position.y = 0.02;
    g.add(sh);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff5ff, roughness: 0.15, metalness: 0.2, emissive: 0xeeddcc, emissiveIntensity: 0.2 }));
    pearl.position.y = 0.04;
    g.add(pearl);
    g.position.set(-0.9, sandY, 0.4);
  } else if (id === "jelly") {
    // floating, positions set later
    for (let i = 0; i < 3; i++) {
      const jelly = makeJelly();
      jelly.position.set(-1 + i * 1.0, 1.1 + (i % 2) * 0.25, -0.15);
      g.add(jelly);
    }
  } else if (id === "kelp") {
    // extra kelp cluster
    const k = createKelp({ kelp: 5 }, uniforms);
    k.position.set(1.6, 0, -0.15);
    k.scale.setScalar(0.85);
    g.add(k);
  }
  return g;
}

function starGeo(r0, r1, n) {
  const sh = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r0 : r1;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) sh.moveTo(x, y);
    else sh.lineTo(x, y);
  }
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false });
}

function makeJelly() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8f0ff,
    roughness: 0.2,
    transparent: true,
    opacity: 0.45,
    emissive: 0x3a88aa,
    emissiveIntensity: 0.25,
    depthWrite: false,
  });
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  group.add(bell);
  const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.22, 5), mat);
  for (let i = 0; i < 5; i++) {
    const t = tent.clone();
    t.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.04, -0.12, Math.sin((i / 5) * Math.PI * 2) * 0.04);
    group.add(t);
  }
  group.userData.jelly = true;
  return group;
}

export function updateJellies(group, t) {
  group.traverse((o) => {
    if (o.userData.jelly) {
      o.position.y += Math.sin(t * 0.7 + o.position.x) * 0.002;
      o.rotation.y = Math.sin(t * 0.4 + o.position.x) * 0.2;
    }
  });
}

export function createFoodMesh(id, color) {
  let mesh;
  if (id === "treat") {
    mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.35 }));
  } else if (id === "krill") {
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    mesh.scale.set(1.6, 0.6, 0.7);
  } else {
    const g = fishGeo();
    g.scale(0.7, 0.7, 0.7);
    mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  }
  mesh.castShadow = true;
  return mesh;
}

export function createHeartSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.translate(32, 28);
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-18, -8, -16, -22, 0, -12);
  ctx.bezierCurveTo(16, -22, 18, -8, 0, 10);
  ctx.fillStyle = "#ff8fab";
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Sprite(mat);
}

// attach fins for procedural sharks
export function finalizeProceduralShark(group, length) {
  const mat = group.children[0]?.material;
  if (mat) addFins(group, length, mat);
  return group;
}
