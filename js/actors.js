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
  jobs.push(load("./models/fish/tropical.glb").then((g) => { CACHE.fish.gaitkitClown = g; }));
  const REEF_FILES = {
    bluetang: "./models/fish/reef/bluetang.glb",
    tang: "./models/fish/reef/tang.glb",
    butterfly: "./models/fish/reef/butterfly.glb",
    moorish: "./models/fish/reef/moorish.glb",
    parrot: "./models/fish/reef/parrot.glb",
    cardinal: "./models/fish/reef/cardinal.glb",
    mandarin: "./models/fish/reef/mandarin.glb",
    clown: "./models/fish/reef/clown.glb",
  };
  for (const [k, url] of Object.entries(REEF_FILES)) {
    jobs.push(load(url).then((g) => { CACHE.fish[k] = g; }));
  }
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
  let minY = Infinity, maxY = -Infinity;
  let maxSide = 0;
  wrap.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const xs = new Float32Array(pos.count);
    const ys = new Float32Array(pos.count);
    const zs = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      o.localToWorld(v);
      v.applyMatrix4(inv);
      xs[i] = v.x; ys[i] = v.y; zs[i] = v.z;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      maxSide = Math.max(maxSide, Math.abs(v.z));
    }
    buckets.push({ o, xs, ys, zs });
  });
  const spanX = Math.max(1e-4, maxX - minX);
  const spanY = Math.max(1e-4, maxY - minY);
  const spanZ = Math.max(1e-4, maxSide);
  for (const { o, xs, ys, zs } of buckets) {
    const along = new Float32Array(xs.length);
    const lift = new Float32Array(xs.length);
    const side = new Float32Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      along[i] = (xs[i] - minX) / spanX;
      lift[i] = (ys[i] - minY) / spanY;
      side[i] = Math.abs(zs[i]) / spanZ;
    }
    o.geometry = o.geometry.clone();
    o.geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
    o.geometry.setAttribute("aLift", new THREE.BufferAttribute(lift, 1));
    o.geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  }
}

function upgradeSharkMaterial(src, gender) {
  const p = new THREE.MeshStandardMaterial();
  const name = (src?.name || "").toLowerCase();
  const srcCol = src?.color ? src.color.clone() : new THREE.Color(0x6a7074);
  const lum = srcCol.r * 0.22 + srcCol.g * 0.5 + srcCol.b * 0.14;
  const isDark = name.includes("dark") || lum < 0.16;
  const isCream = name.includes("cream") || lum > 0.62;
  if (src?.map) {
    p.map = src.map;
    p.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (isDark) {
    p.color.set(0x07080a);
    p.roughness = 0.16;
    p.metalness = 0.42;
    p.envMapIntensity = 1.25;
    p.emissive = new THREE.Color(0x101218);
    p.emissiveIntensity = 0.12;
    p.userData.role = "eye";
  } else if (isCream) {
    p.color.set(gender === "f" ? 0xb89a7e : 0x9ea094);
    p.roughness = 0.55;
    p.metalness = 0.03;
    p.envMapIntensity = 0.32;
    p.userData.role = "belly";
  } else {
    p.color.set(gender === "f" ? 0x4a382c : 0x2a2e2c);
    p.roughness = 0.34;
    p.metalness = 0.12;
    p.envMapIntensity = 0.7;
    p.emissive = new THREE.Color(gender === "f" ? 0x140e08 : 0x080c0e);
    p.emissiveIntensity = 0.025;
    p.userData.role = "body";
  }
  return p;
}

const SWIM_VERT = `
  float along = clamp(aAlong, 0.0, 1.0);
  float tail = pow(smoothstep(0.22, 1.0, along), 1.25);
  float wag = sin(uTime * 5.15 + along * 3.6 + uPhase);
  float wag2 = sin(uTime * 7.1 + along * 5.8 + uPhase) * 0.18;
  transformed.z += (wag + wag2) * uAmp * tail * 0.48;
  transformed.x += wag * uAmp * tail * 0.016;
  float pec = smoothstep(0.26, 0.44, along) * (1.0 - smoothstep(0.50, 0.74, along));
  transformed.y += sin(uTime * 6.2 + uPhase) * pec * uAmp * 0.10;
  float bite = uBite;
  if (bite > 0.001) {
    float head = 1.0 - smoothstep(0.0, 0.22, along);
    float lower = 1.0 - smoothstep(0.32, 0.58, aLift);
    transformed.y -= head * lower * bite * 0.09;
    transformed.x += head * bite * 0.025;
  }
  vAlong = along;
  vLift = aLift;
  vSide = aSide;
`;

const SHARK_MARKS = `
  float dorsal = smoothstep(0.48, 0.78, vLift);
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.46, 0.44, 0.36), dorsal * 0.82);
  outgoingLight = min(outgoingLight, mix(vec3(1.15), vec3(0.42, 0.40, 0.34), dorsal * 0.55));
  float belly = 1.0 - smoothstep(0.32, 0.60, vLift);
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.10, 1.07, 1.02) + vec3(0.015, 0.014, 0.012), belly * 0.22);
  float tailTip = smoothstep(0.80, 0.93, vAlong) * smoothstep(0.12, 0.50, max(vLift, vSide));
  float dorsalTip = smoothstep(0.74, 0.90, vLift) * smoothstep(0.28, 0.48, vAlong) * (1.0 - smoothstep(0.62, 0.84, vAlong));
  float pecTip = smoothstep(0.68, 0.88, vSide) * (1.0 - smoothstep(0.58, 0.84, vLift)) * smoothstep(0.18, 0.38, vAlong) * (1.0 - smoothstep(0.52, 0.76, vAlong));
  float caudal = smoothstep(0.82, 0.94, vAlong);
  float tip = clamp(max(max(tailTip, dorsalTip), max(pecTip, caudal)), 0.0, 1.0);
  float collar = clamp(max(max(
    smoothstep(0.72, 0.82, vAlong) * (1.0 - smoothstep(0.86, 0.94, vAlong)) * smoothstep(0.12, 0.50, max(vLift, vSide)),
    smoothstep(0.66, 0.76, vLift) * (1.0 - smoothstep(0.86, 0.95, vLift)) * smoothstep(0.28, 0.48, vAlong) * (1.0 - smoothstep(0.62, 0.84, vAlong))
  ), smoothstep(0.58, 0.72, vSide) * (1.0 - smoothstep(0.80, 0.92, vSide)) * (1.0 - smoothstep(0.58, 0.84, vLift)) * smoothstep(0.18, 0.38, vAlong) * (1.0 - smoothstep(0.52, 0.76, vAlong))), 0.0, 1.0);
  if (uMark > 0.5) {
    float dTipW = smoothstep(0.70, 0.88, vLift) * smoothstep(0.26, 0.50, vAlong) * (1.0 - smoothstep(0.62, 0.84, vAlong));
    float tailW = smoothstep(0.76, 0.92, vAlong) * smoothstep(0.12, 0.55, max(vLift, vSide));
    float tipF = clamp(max(tip, max(dTipW, tailW)), 0.0, 1.0);
    outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.22, 0.20, 0.16), collar * 0.8);
    outgoingLight = mix(outgoingLight, vec3(0.97, 0.98, 0.95), tipF * 0.99);
  } else {
    outgoingLight = mix(outgoingLight, vec3(0.01, 0.01, 0.012), tip * 0.97);
  }
  float shine = pow(clamp(dot(normalize(normal), vec3(0.15, 0.75, 0.64)), 0.0, 1.0), 32.0);
  outgoingLight += vec3(0.50, 0.58, 0.62) * shine * 0.22;
`;

export function createSharkActor(spec, gltf, uniforms, length) {
  const pivot = new THREE.Group();
  let model, mixer, actions = {};
  let procedural = false;
  const swimU = {
    uAmp: { value: 0.2 },
    uPhase: { value: Math.random() * 6.28 },
    uBite: { value: 0 },
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
            key: "shark-swim-" + spec.gender + "-" + (p.userData.role || "body"),
            uniforms: {
              uAmp: swimU.uAmp,
              uPhase: swimU.uPhase,
              uBite: swimU.uBite,
              uMark: { value: spec.gender === "f" ? 1 : 0 },
              uCauGain: { value: 0.26 },
            },
            vertexCommon: "attribute float aAlong; attribute float aLift; attribute float aSide; varying float vAlong; varying float vLift; varying float vSide; uniform float uAmp; uniform float uPhase; uniform float uTime; uniform float uBite;",
            fragmentCommon: "varying float vAlong; varying float vLift; varying float vSide; uniform float uMark;",
            vertexBend: SWIM_VERT,
            fragmentExtra: p.userData.role === "eye" ? `
              float glint = pow(clamp(dot(normalize(normal), normalize(vec3(0.2, 0.6, 0.75))), 0.0, 1.0), 40.0);
              outgoingLight += vec3(0.85, 0.9, 0.95) * glint * 0.8;
            ` : SHARK_MARKS,
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
  if (shark.model?.userData?.swim?.uBite) shark.model.userData.swim.uBite.value = 0.15;
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
    if (shark.biteT > 0) {
      shark.biteT = Math.max(0, shark.biteT - dt);
      const open = shark.biteT > 0.22 ? (0.45 - shark.biteT) / 0.23 : shark.biteT / 0.22;
      if (swim.uBite) swim.uBite.value = Math.max(0, Math.min(1, open));
    } else if (swim.uBite) {
      swim.uBite.value = 0;
    }
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

let ROCK_TEX = null;
function rockTextures() {
  if (ROCK_TEX) return ROCK_TEX;
  const loader = new THREE.TextureLoader();
  const load = (url, srgb, repeat) => {
    const tex = loader.load(url);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
    return tex;
  };
  ROCK_TEX = {
    diff: load("./textures/rock_face_03_diff_1k.jpg", true, 1.6),
    nor: load("./textures/rock_face_03_nor_gl_1k.jpg", false, 1.6),
    rough: load("./textures/rock_face_03_rough_1k.jpg", false, 1.6),
  };
  return ROCK_TEX;
}

function ensureProjectedUv(geometry) {
  if (geometry.attributes.uv) return;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm ? nrm.getX(i) : 0);
    const ny = Math.abs(nrm ? nrm.getY(i) : 1);
    const nz = Math.abs(nrm ? nrm.getZ(i) : 0);
    if (ny >= nx && ny >= nz) { uv[i * 2] = x * 0.55; uv[i * 2 + 1] = z * 0.55; }
    else if (nx >= nz) { uv[i * 2] = z * 0.55; uv[i * 2 + 1] = y * 0.55; }
    else { uv[i * 2] = x * 0.55; uv[i * 2 + 1] = y * 0.55; }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function styleCoralMaterial(m, name, opts, quality) {
  const matName = (m.name || "").toLowerCase();
  const isRock = matName.includes("rock") || name === "boulders" || name === "rock_outcrop" || (name === "bommie" && !matName.includes("coral"));
  if (isRock) {
    const tex = rockTextures();
    if (m.geometry) ensureProjectedUv(m.geometry);
    m.map = tex.diff;
    if (!(quality && quality.software)) m.normalMap = tex.nor;
    m.roughnessMap = tex.rough;
    m.color.set(0x9a8a78);
    m.roughness = 0.92;
    m.metalness = 0.02;
    m.envMapIntensity = 0.25;
    return;
  }
  const NATURAL = {
    brain: 0xc47a48,
    mushroom: 0xb06a4a,
    table: 0xa87848,
    lettuce: 0x5a7a32,
    bubble: 0xc48a38,
    staghorn: 0xb07a52,
    elkhorn: 0xb89860,
    pillar: 0xb07a48,
    finger: 0x9a5e38,
    seafan: 0xa85a42,
    softbush: 0x8a6a38,
    carnation: 0xa84830,
    barrel_sponge: 0xa85a28,
    vase_sponge: 0xb86838,
    anemone: 0xd4a078,
    anemone_carpet: 0xc49070,
    clam: 0xc8b090,
    starfish: 0xc45a2a,
    featherduster: 0xc8b8a0,
  };
  if (opts && opts.tint) m.color?.multiply(new THREE.Color(opts.tint));
  else if (NATURAL[name]) m.color?.set(NATURAL[name]);
  if (matName.includes("pink")) m.color?.set(0xa85a48);
  if (m.roughness !== undefined) m.roughness = Math.min(Math.max(m.roughness ?? 0.62, 0.45), 0.8);
  m.envMapIntensity = 0.5;
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
    if (o.geometry) ensureProjectedUv(o.geometry);
    // attach geometry to material helper via a dummy
    m.userData._geo = o.geometry;
    styleCoralMaterial(Object.assign(m, { geometry: o.geometry, name: srcMat?.name || m.name }), name, opts, opts.quality);
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
    ["brain", 0.42, -1.35, 0.35, 0.2],
    ["brain", 0.32, 1.15, -0.45, 1.1],
    ["mushroom", 0.34, -0.95, -0.58, 0.6],
    ["table", 0.55, 0.15, -0.62, 0.3],
    ["lettuce", 0.3, 0.55, -0.5, 0.9],
    ["bubble", 0.28, -0.45, -0.55, 0.1],
    ["staghorn", 0.72, -1.9, -0.25, 0.5],
    ["elkhorn", 0.7, 1.95, -0.3, -0.4],
    ["pillar", 0.7, -1.7, -0.6, 0.0],
    ["finger", 0.4, 0.85, -0.58, 0.7],
    ["seafan", 0.55, -1.15, -0.62, 0.9, { sway: true }],
    ["seafan", 0.42, 1.25, -0.6, -0.8, { sway: true, tint: 0xa85838 }],
    ["softbush", 0.38, -0.2, -0.58, 0.4, { sway: true }],
    ["carnation", 0.32, 0.35, -0.48, 1.4, { sway: true }],
    ["barrel_sponge", 0.28, -1.05, -0.35, 0.3, { tint: 0xb04a22 }],
    ["vase_sponge", 0.24, 1.15, -0.38, 0.8, { tint: 0xa85028 }],
    ["clam", 0.28, -0.15, 0.5, 0.4],
    ["starfish", 0.16, 0.55, 0.52, 0.2],
    ["featherduster", 0.28, -1.05, 0.38, 0.6, { sway: true }],
    ["anemone", 0.42, -1.25, 0.22, 0.3, { sway: true }],
    ["anemone", 0.34, 1.35, 0.28, -0.5, { sway: true, tint: 0xc49868 }],
    ["anemone_carpet", 0.5, -0.55, -0.4, 0.8, { sway: true }],
  ];
  for (const item of layout) {
    const [name, size, x, z, rot, opts] = item;
    if (n < 1 && /elkhorn|pillar/.test(name)) continue;
    const mesh = cloneCoral(name, size * (0.9 + rng() * 0.2), uniforms, {
      ...(opts || {}),
      phase: rng() * 6.28,
      quality,
    });
    place(group, mesh, x, z, rot);
  }
  // extra mid-tank colonies and pebbles for a denser, less empty sand bed
  const extras = [
    ["finger", 0.28, -0.55, 0.22, 0.4],
    ["lettuce", 0.26, 0.22, 0.42, 1.1],
    ["mushroom", 0.26, 1.0, 0.38, 0.2],
    ["brain", 0.28, -0.82, 0.40, 0.9],
    ["softbush", 0.22, 0.55, 0.28, 0.6, { sway: true }],
    ["lettuce", 0.2, -0.2, 0.48, 0.3],
    ["starfish", 0.12, -0.4, 0.55, 1.3],
  ];
  for (const item of extras) {
    const [name, size, x, z, rot, opts] = item;
    const mesh = cloneCoral(name, size * (0.9 + rng() * 0.2), uniforms, { ...(opts || {}), phase: rng() * 6.28, quality });
    place(group, mesh, x, z, rot);
  }
  addPebbles(group, uniforms, quality, rng);
  return group;
}

function addPebbles(group, uniforms, quality, rng) {
  const tex = rockTextures();
  const geo = new THREE.DodecahedronGeometry(0.04, 0);
  ensureProjectedUv(geo);
  const mat = new THREE.MeshStandardMaterial({
    map: tex.diff,
    roughnessMap: tex.rough,
    color: 0x8a7a68,
    roughness: 0.92,
    metalness: 0.02,
  });
  applyUnderwater(mat, uniforms, { key: "pebble" });
  const n = quality.mobile ? 10 : 18;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    const s = 0.5 + rng() * 1.4;
    m.scale.set(s, s * (0.5 + rng() * 0.5), s * (0.7 + rng() * 0.5));
    m.position.set((rng() - 0.5) * 3.6, TANK.sand, (rng() - 0.5) * 1.2);
    m.rotation.set(rng() * 1.5, rng() * 6.28, rng() * 1.5);
    sitOnSand(m);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

export function createKelp(quality, uniforms) {
  const group = new THREE.Group();
  const n = quality.kelp;
  const rng = mulberry(11);
  if (CACHE.coral.kelp) {
    const count = quality.software ? Math.min(n, 6) : n;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (1.55 + rng() * 0.55);
      const z = -TANK.d / 2 + 0.22 + rng() * (TANK.d * 0.4);
      const mesh = cloneCoral("kelp", 0.85 + rng() * 0.55, uniforms, { sway: true, phase: rng() * 6.28, tint: 0x6a8a34 });
      place(group, mesh, x, z, rng() * Math.PI * 2);
    }
  } else {
    const blade = bladeGeo();
    const count = Math.max(n, quality.software ? 12 : n);
    for (let i = 0; i < count; i++) {
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
  if (CACHE.coral.seagrass) {
    const count = quality.software ? 5 : (quality.mobile ? 4 : 8);
    for (let i = 0; i < count; i++) {
      const x = (rng() - 0.5) * 3.6;
      const z = -TANK.d / 2 + 0.2 + rng() * 0.45;
      const mesh = cloneCoral("seagrass", 0.28 + rng() * 0.18, uniforms, { sway: true, phase: rng() * 6.28, tint: 0x5a8a38 });
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

const REEF_SCHOOLS = [
  { id: "bluetang",  len: 0.20, n: [6, 3], spread: 0.75, base: { cx: -0.95, cy: 0.95, cz: -0.10 } },
  { id: "tang",      len: 0.17, n: [5, 3], spread: 0.70, base: { cx:  1.05, cy: 1.15, cz:  0.15 } },
  { id: "butterfly", len: 0.14, n: [5, 3], spread: 0.65, base: { cx:  0.15, cy: 0.72, cz:  0.28 } },
  { id: "moorish",   len: 0.16, n: [3, 2], spread: 0.55, base: { cx:  0.85, cy: 1.35, cz: -0.25 } },
  { id: "parrot",    len: 0.22, n: [3, 2], spread: 0.60, base: { cx: -0.35, cy: 1.25, cz:  0.05 } },
  { id: "cardinal",  len: 0.075,n: [14, 8],spread: 0.50, base: { cx: -0.20, cy: 1.05, cz:  0.22 } },
  { id: "mandarin",  len: 0.10, n: [4, 2], spread: 0.45, base: { cx:  1.20, cy: 0.55, cz: -0.15 } },
  { id: "clown",     len: 0.11, n: [4, 2], spread: 0.35, base: { cx: -1.15, cy: 0.48, cz:  0.18 } },
];

function pickSwimClip(gltf) {
  const clips = gltf?.animations || [];
  return (
    clips.find((c) => /swimming_normal/i.test(c.name)) ||
    clips.find((c) => /swimming/i.test(c.name)) ||
    clips.find((c) => /swim|loop/i.test(c.name)) ||
    clips[0] ||
    null
  );
}

function styleReefFish(root, uniforms, key) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const src = o.material;
    const list = Array.isArray(src) ? src : src ? [src] : [];
    const out = list.map((m) => {
      const mat = m.clone();
      mat.roughness = Math.min(mat.roughness ?? 0.45, 0.45);
      mat.metalness = Math.min(mat.metalness ?? 0.08, 0.12);
      mat.envMapIntensity = 0.7;
      if (mat.color && !/eye/i.test(mat.name || "")) {
        mat.color.offsetHSL(0, 0.06, 0.06);
      }
      applyUnderwater(mat, uniforms, { key: "reef-" + key });
      return mat;
    });
    o.material = Array.isArray(src) ? out : out[0];
  });
}

function spawnReefFish(gltf, uniforms, length, key, phase) {
  const cloned = skeletonClone(gltf.scene);
  styleReefFish(cloned, uniforms, key);
  const wrap = normalizeModel(cloned, length);
  const mixer = new THREE.AnimationMixer(cloned);
  const clip = pickSwimClip(gltf);
  if (clip) {
    const act = mixer.clipAction(clip);
    act.play();
    act.setLoop(THREE.LoopRepeat);
    act.time = (phase || 0) * (clip.duration || 1);
    act.setEffectiveTimeScale(0.9 + Math.random() * 0.4);
  }
  return { wrap, mixer };
}

export function createFishSchool(quality, uniforms) {
  const group = new THREE.Group();
  const schools = [];
  const light = !!(quality.mobile || quality.software || quality.tex1k);
  const hasReef = REEF_SCHOOLS.some((s) => CACHE.fish[s.id]);

  if (hasReef) {
    for (const spec of REEF_SCHOOLS) {
      const gltf = CACHE.fish[spec.id];
      if (!gltf?.scene) continue;
      const n = light ? spec.n[1] : spec.n[0];
      const members = [];
      for (let i = 0; i < n; i++) {
        const scale = 0.86 + Math.random() * 0.28;
        const phase = Math.random() * 6.28;
        const spawned = spawnReefFish(gltf, uniforms, spec.len * scale, spec.id, phase);
        group.add(spawned.wrap);
        members.push({
          x: spec.base.cx + (Math.random() - 0.5) * spec.spread,
          y: spec.base.cy + (Math.random() - 0.5) * 0.32,
          z: spec.base.cz + (Math.random() - 0.5) * 0.42,
          vx: (Math.random() - 0.5) * 0.18,
          vy: 0,
          vz: (Math.random() - 0.5) * 0.18,
          phase,
          scale,
          object: spawned.wrap,
          mixer: spawned.mixer,
        });
      }
      schools.push({ inst: null, members, objects: true, id: spec.id });
    }
  } else {
    // procedural fallback if reef models fail to load
    const counts = light
      ? { tang: 3, yellowtang: 3, butterfly: 3, angel: 2, tetra: 10 }
      : { tang: 6, yellowtang: 5, butterfly: 5, angel: 3, tetra: 18 };
    const bases = {
      tang: { cx: -0.9, cy: 0.85, cz: -0.1 },
      yellowtang: { cx: 1.0, cy: 1.15, cz: 0.15 },
      butterfly: { cx: 0.2, cy: 0.7, cz: 0.25 },
      angel: { cx: 0.7, cy: 1.35, cz: -0.2 },
      tetra: { cx: -0.3, cy: 1.05, cz: 0.2 },
    };
    for (const [name, n] of Object.entries(counts)) {
      const spec = SPECIES[name];
      const geo = speciesGeo(spec);
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.38, metalness: 0.08, envMapIntensity: 0.55,
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
          vx: (Math.random() - 0.5) * 0.2, vy: 0, vz: (Math.random() - 0.5) * 0.2,
          phase: Math.random() * 6.28, scale: 0.85 + Math.random() * 0.3,
        });
      }
      schools.push({ inst, members });
    }
  }

  // Orange Gaitkit clownfish near the anemone (distinct from the zebra clown)
  if (CACHE.fish.gaitkitClown) {
    const n = light ? 2 : 3;
    const members = [];
    for (let i = 0; i < n; i++) {
      const cloned = skeletonClone(CACHE.fish.gaitkitClown.scene);
      styleReefFish(cloned, uniforms, "gaitkit-clown");
      const wrap = normalizeModel(cloned, 0.11 + i * 0.008);
      group.add(wrap);
      const mixer = new THREE.AnimationMixer(cloned);
      const clip = pickSwimClip(CACHE.fish.gaitkitClown);
      if (clip) {
        const act = mixer.clipAction(clip);
        act.play();
        act.setLoop(THREE.LoopRepeat);
        act.time = i * 0.4;
      }
      members.push({
        x: -1.15 + (Math.random() - 0.5) * 0.28,
        y: 0.45 + Math.random() * 0.18,
        z: 0.18 + (Math.random() - 0.5) * 0.18,
        vx: 0.05, vy: 0, vz: 0,
        phase: Math.random() * 6.28,
        scale: 1,
        object: wrap,
        mixer,
      });
    }
    schools.push({ inst: null, members, objects: true, id: "gaitkit-clown" });
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
      f.vx += (cx - f.x) * 0.55 * dt;
      f.vy += (cy - f.y) * 0.45 * dt;
      f.vz += (cz - f.z) * 0.55 * dt;
      f.vx += Math.sin(now * 0.001 + f.phase) * 0.16 * dt;
      f.vy += Math.cos(now * 0.0008 + f.phase) * 0.1 * dt;
      // separation
      for (const o of school.members) {
        if (o === f) continue;
        const sx = f.x - o.x, sy = f.y - o.y, sz = f.z - o.z;
        const sd = Math.hypot(sx, sy, sz) || 0.001;
        if (sd < 0.16) {
          f.vx += (sx / sd) * 0.9 * dt;
          f.vy += (sy / sd) * 0.9 * dt;
          f.vz += (sz / sd) * 0.9 * dt;
        }
      }
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
        const lookX = f.x + f.vx, lookY = f.y + f.vy, lookZ = f.z + f.vz;
        if (Math.hypot(f.vx, f.vy, f.vz) > 0.01) {
          f.object.lookAt(lookX, lookY, lookZ);
          f.object.rotateY(Math.PI / 2);
        }
        if (f.mixer) {
          f.mixer.timeScale = 0.8 + Math.min(sp, 0.55) * 1.4;
          f.mixer.update(dt);
        }
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
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color), emissiveIntensity: id === "treat" ? 0.55 : 0.22,
    roughness: 0.4, metalness: 0.08,
  });
  let core;
  if (id === "treat") {
    core = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), mat);
  } else if (id === "krill") {
    core = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), mat);
    core.scale.set(1.8, 0.55, 0.7);
  } else {
    const g = fishGeo();
    g.scale(0.75, 0.75, 0.75);
    core = new THREE.Mesh(g, mat);
  }
  core.castShadow = true;
  group.add(core);
  group.userData.foodCore = core;
  return group;
}

export function createFeedBurst(color, n = 12) {
  const group = new THREE.Group();
  const col = new THREE.Color(color);
  const items = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
      transparent: true, opacity: 0.95, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.012 + Math.random() * 0.014, 6, 5), mat);
    group.add(m);
    items.push({
      mesh: m,
      vx: (Math.random() - 0.5) * 0.55,
      vy: 0.12 + Math.random() * 0.35,
      vz: (Math.random() - 0.5) * 0.55,
      life: 0.45 + Math.random() * 0.4,
      max: 0.85,
    });
  }
  group.userData.burst = items;
  return group;
}

export function updateFeedBursts(bursts, dt) {
  return bursts.filter((b) => {
    let alive = false;
    for (const p of b.userData.burst) {
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      alive = true;
      p.vy -= 0.55 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const k = Math.max(0, p.life / p.max);
      p.mesh.material.opacity = k;
      p.mesh.scale.setScalar(0.5 + k * 0.8);
    }
    return alive;
  });
}

export function createHeartSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grd.addColorStop(0, "rgba(255,180,200,0.0)");
  grd.addColorStop(1, "rgba(255,80,120,0.0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  ctx.translate(64, 58);
  ctx.beginPath();
  ctx.moveTo(0, 22);
  ctx.bezierCurveTo(-36, -10, -32, -40, 0, -22);
  ctx.bezierCurveTo(32, -40, 36, -10, 0, 22);
  ctx.fillStyle = "#ff5a86";
  ctx.shadowColor = "rgba(255,90,140,0.85)";
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,230,240,0.7)";
  ctx.beginPath();
  ctx.ellipse(-10, -10, 8, 5, -0.6, 0, 6.28);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Sprite(mat);
}

// attach fins for procedural sharks
export function finalizeProceduralShark(group, length) {
  const mat = group.children[0]?.material;
  if (mat) addFins(group, length, mat);
  return group;
}
