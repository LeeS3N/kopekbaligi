import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TANK, tankBounds, applyUnderwater } from "./world.js";

export async function loadSharkGltf(renderer, manager) {
  const ktx2 = new KTX2Loader(manager)
    .setTranscoderPath("./vendor/three/addons/libs/basis/");
  ktx2.detectSupport(renderer);
  const loader = new GLTFLoader(manager);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync("./models/shark.glb");
    return gltf;
  } catch (err) {
    console.warn("Shark glTF failed, using procedural mesh.", err);
    return null;
  }
}

function normalizeModel(root, length) {
  root.updateMatrixWorld(true);
  const box0 = new THREE.Box3().setFromObject(root);
  const size0 = box0.getSize(new THREE.Vector3());
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  wrap.add(inner);
  inner.add(root);
  // Keep bones and mesh in the same group while we aim the body down +X.
  if (size0.z >= size0.x && size0.z >= size0.y) inner.rotation.y = Math.PI / 2;
  else if (size0.y >= size0.x) inner.rotation.z = -Math.PI / 2;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const center = box.getCenter(new THREE.Vector3());
  inner.position.sub(center);
  const size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(length / Math.max(size.x, 0.001));
  wrap.updateMatrixWorld(true);
  return wrap;
}

function findClips(gltf) {
  const clips = gltf?.animations || [];
  const swim = clips.find((c) => /swim(?!2)/i.test(c.name)) || clips.find((c) => /swim/i.test(c.name));
  const swim2 = clips.find((c) => /swim2/i.test(c.name));
  const bite = clips.find((c) => /bite/i.test(c.name));
  return { swim, swim2, bite, all: clips };
}

export function createSharkActor(spec, gltf, uniforms, length) {
  const pivot = new THREE.Group();
  let model, mixer, actions = {};
  let procedural = false;

  if (gltf) {
    const cloned = skeletonClone(gltf.scene);
    cloned.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            m = m.clone();
            if (spec.gender === "f") {
              m.color = new THREE.Color(0xffc4bc);
              if (m.emissive) m.emissive = new THREE.Color(0x221016);
            } else {
              m.color = new THREE.Color(0xe8eef2);
            }
            m.envMapIntensity = 0.45;
            if ("roughness" in m) m.roughness = Math.min(m.roughness ?? 0.6, 0.55);
            if ("metalness" in m) m.metalness = 0.05;
            applyUnderwater(m, uniforms);
            if (Array.isArray(o.material)) {
              /* replace later */
            }
            o.material = m;
          });
        }
      }
    });
    model = normalizeModel(cloned, length);
    // After normalize, check nose direction using a temporary box and possibly flip
    model.updateMatrixWorld(true);
    mixer = new THREE.AnimationMixer(cloned);
    const clips = findClips(gltf);
    if (clips.swim) {
      actions.swim = mixer.clipAction(clips.swim);
      actions.swim.play();
      actions.swim.setLoop(THREE.LoopRepeat);
    }
    if (clips.bite) {
      actions.bite = mixer.clipAction(clips.bite);
      actions.bite.setLoop(THREE.LoopOnce);
      actions.bite.clampWhenFinished = true;
    }
  } else {
    procedural = true;
    model = createProceduralShark(spec.gender, length, uniforms);
  }

  if (spec.gender === "f") model.scale.multiplyScalar(0.9);
  else model.scale.multiplyScalar(1.04);

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
  // heading 0 = +X
  shark.pivot.rotation.x = THREE.MathUtils.lerp(shark.pivot.rotation.x, -targetPitch, 1 - Math.pow(0.05, dt));
  const sp = Math.hypot(shark.vx, shark.vy, shark.vz);
  if (shark.mixer) {
    const rate = THREE.MathUtils.clamp(0.7 + sp * 0.9, 0.6, 2.1);
    if (shark.actions.swim) shark.actions.swim.setEffectiveTimeScale(rate);
    shark.mixer.update(dt);
  }
  if (shark.procedural) {
    const sh = shark.model.userData.shader;
    if (sh) {
      sh.uniforms.uTime.value += dt;
      sh.uniforms.uAmp.value = 0.18 + Math.min(sp, 1.6) * 0.2;
    }
  }
  shark.label.position.set(0, 0.32, 0);
}

/* -------------------- procedural fallback -------------------- */
export function createProceduralShark(gender, length, uniforms) {
  const group = new THREE.Group();
  const female = gender === "f";
  const geo = buildSharkGeometry(length);
  const mat = new THREE.MeshStandardMaterial({
    color: female ? 0xd8c4c8 : 0x6a8494,
    roughness: 0.42,
    metalness: 0.08,
    vertexColors: true,
  });
  applyUnderwater(mat, uniforms);
  // swim bend
  mat.onBeforeCompile = (shader) => {
    // chain after applyUnderwater? last assignment wins. Re-apply water + bend.
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uWaterColor = uniforms.uWaterColor;
    shader.uniforms.uFogDensity = uniforms.uFogDensity;
    shader.uniforms.uAmp = { value: 0.22 };
    shader.uniforms.uPhase = { value: Math.random() * 6.28 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uAmp;
        uniform float uPhase;
      `)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float along = (position.x + 0.5);
        float wag = sin(uTime * 6.5 + along * 4.0 + uPhase) * uAmp * along * along;
        transformed.z += wag * 0.35;
        transformed.x += wag * 0.02;`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    // keep water fragment from applyUnderwater by also injecting here
    if (!shader.fragmentShader.includes("uWaterColor")) {
      // water chunk already in world.js via applyUnderwater, but we overwrote onBeforeCompile
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform float uNight;
        uniform vec3 uWaterColor;
        uniform float uFogDensity;
        float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
        float caustic(vec2 uv){float n1=noise(uv*2.4+vec2(uTime*0.11,uTime*0.05))*noise(uv*3.1+vec2(-uTime*0.07,uTime*0.09));return pow(clamp(n1*1.6,0.0,1.0),3.0);}
      `)
      .replace("#include <opaque_fragment>", `{
        float dist=length(vViewPosition);
        float absorb=clamp(1.0-exp(-dist*uFogDensity)+smoothstep(2.05,0.15,vWorldPos.y)*0.22,0.0,0.82);
        outgoingLight=mix(outgoingLight,uWaterColor*mix(0.55,0.22,uNight),absorb);
        float c=caustic(vWorldPos.xz);
        float up=clamp(dot(normalize(normal),vec3(0,1,0)),0.0,1.0);
        outgoingLight+=vec3(0.55,0.82,1.0)*(1.0-uNight*0.7)*(0.22+0.85*c)*up*(1.0-absorb*0.5);
      }
      #include <opaque_fragment>`);
    mat.userData.shader = shader;
    group.userData.shader = shader;
  };
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // eye
  const eyeW = new THREE.Mesh(new THREE.SphereGeometry(length * 0.018, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf4f6f2, roughness: 0.3 }));
  const iris = new THREE.Mesh(new THREE.SphereGeometry(length * 0.01, 12, 10), new THREE.MeshStandardMaterial({ color: female ? 0x5a2e32 : 0x101820, roughness: 0.25 }));
  const hl = new THREE.Mesh(new THREE.SphereGeometry(length * 0.004, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }));
  const placeEye = (sign) => {
    const g = new THREE.Group();
    g.add(eyeW);
    const ir = iris.clone(); ir.position.set(length * 0.006, 0, 0); g.add(ir);
    const h = hl.clone(); h.position.set(length * 0.01, length * 0.004, length * 0.003); g.add(h);
    g.position.set(length * 0.28, length * 0.045, sign * length * 0.08);
    group.add(g);
  };
  placeEye(1); placeEye(-1);
  addFins(group, length, mat);
  return group;
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

/* -------------------- kelp, fish, bubbles, snow -------------------- */
export function createKelp(quality, uniforms) {
  const group = new THREE.Group();
  const blade = bladeGeo();
  const n = quality.kelp;
  const rng = (i) => ((Math.sin(i * 78.23) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < n; i++) {
    // Keep the mid-front of the tank open so the sharks stay visible.
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (0.9 + rng(i) * 1.15);
    const z = -TANK.d / 2 + 0.28 + rng(i + 9) * (TANK.d * 0.45);
    const blades = 2 + (rng(i + 3) * 2) | 0;
    for (let b = 0; b < blades; b++) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.32 + rng(i + b) * 0.06, 0.55, 0.22 + rng(i * b + 2) * 0.08),
        roughness: 0.7,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      applyUnderwater(mat, uniforms);
      mat.onBeforeCompile = chainSway(mat, uniforms, rng(i + b) * 6.28);
      const mesh = new THREE.Mesh(blade, mat);
      const h = 0.55 + rng(i + b + 5) * 0.55;
      mesh.scale.set(0.7 + rng(i) * 0.5, h, 1);
      mesh.position.set(x + (b - 1) * 0.05, TANK.sand, z + (b - 1) * 0.04);
      mesh.rotation.y = rng(i + b) * Math.PI;
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

function bladeGeo() {
  const g = new THREE.PlaneGeometry(0.09, 1, 1, 24);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 0.5; // 0..1
    const x = pos.getX(i);
    pos.setX(i, x * (1.1 - y * 0.7));
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

function chainSway(material, uniforms, phase) {
  return (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uWaterColor = uniforms.uWaterColor;
    shader.uniforms.uFogDensity = uniforms.uFogDensity;
    shader.uniforms.uPhase = { value: phase };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWorldPos; uniform float uTime; uniform float uPhase;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float h = position.y;
        transformed.x += sin(uTime * 1.15 + uPhase + h * 2.6) * h * 0.18;
        transformed.z += cos(uTime * 0.9 + uPhase + h * 1.8) * h * 0.1;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWorldPos; uniform float uTime; uniform float uNight;
        uniform vec3 uWaterColor; uniform float uFogDensity;
        float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
        float caustic(vec2 uv){float n1=noise(uv*2.4+vec2(uTime*0.11,uTime*0.05))*noise(uv*3.1+vec2(-uTime*0.07,uTime*0.09));return pow(clamp(n1*1.6,0.0,1.0),3.0);}
      `)
      .replace("#include <opaque_fragment>", `{
        float dist=length(vViewPosition);
        float absorb=clamp(1.0-exp(-dist*uFogDensity)+smoothstep(2.05,0.15,vWorldPos.y)*0.22,0.0,0.82);
        outgoingLight=mix(outgoingLight,uWaterColor*mix(0.55,0.22,uNight),absorb);
        outgoingLight+=vec3(0.55,0.82,1.0)*(1.0-uNight*0.7)*caustic(vWorldPos.xz)*0.25*(1.0-absorb*0.5);
      }
      #include <opaque_fragment>`);
  };
}

export function createFishSchool(quality, uniforms) {
  const geo = fishGeo();
  const pals = [0xf0c14a, 0x5dade2, 0xff7f50, 0xe8e8e8, 0x58d68d];
  const group = new THREE.Group();
  const schools = [];
  const per = Math.ceil(quality.fish / 3);
  for (let s = 0; s < 3; s++) {
    const mat = new THREE.MeshStandardMaterial({ color: pals[s], roughness: 0.45, metalness: 0.1 });
    applyUnderwater(mat, uniforms);
    const inst = new THREE.InstancedMesh(geo, mat, per);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.castShadow = true;
    group.add(inst);
    const members = [];
    const cx = (s - 1) * 1.1, cy = 0.7 + s * 0.25, cz = (s - 1) * 0.2;
    for (let i = 0; i < per; i++) {
      members.push({
        x: cx + (Math.random() - 0.5) * 0.8,
        y: cy + (Math.random() - 0.5) * 0.4,
        z: cz + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.2,
        vy: 0,
        vz: (Math.random() - 0.5) * 0.2,
        phase: Math.random() * 6.28,
      });
    }
    schools.push({ inst, members });
  }
  return { group, schools };
}

function fishGeo() {
  const body = new THREE.SphereGeometry(0.045, 12, 8);
  body.scale(1.7, 0.7, 0.5);
  const tail = new THREE.ConeGeometry(0.028, 0.05, 8);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.085, 0, 0);
  const fin = new THREE.ConeGeometry(0.014, 0.028, 6);
  fin.translate(0.0, 0.03, 0);
  const geo = mergeGeometries([body, tail, fin], false);
  geo.computeVertexNormals();
  return geo;
}

export function updateFish(schools, sharks, dt) {
  const b = tankBounds();
  const dummy = new THREE.Object3D();
  for (const school of schools) {
    let cx = 0, cy = 0, cz = 0;
    for (const f of school.members) { cx += f.x; cy += f.y; cz += f.z; }
    const n = school.members.length;
    cx /= n; cy /= n; cz /= n;
    school.members.forEach((f, i) => {
      f.vx += (cx - f.x) * 0.5 * dt;
      f.vy += (cy - f.y) * 0.5 * dt;
      f.vz += (cz - f.z) * 0.5 * dt;
      f.vx += Math.sin(performance.now() * 0.001 + f.phase) * 0.15 * dt;
      f.vy += Math.cos(performance.now() * 0.0008 + f.phase) * 0.1 * dt;
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
      if (sp > 0.55) { f.vx *= 0.55 / sp; f.vy *= 0.55 / sp; f.vz *= 0.55 / sp; }
      f.x += f.vx; f.y += f.vy; f.z += f.vz;
      dummy.position.set(f.x, f.y, f.z);
      dummy.lookAt(f.x + f.vx, f.y + f.vy, f.z + f.vz);
      dummy.rotateY(Math.PI / 2);
      dummy.updateMatrix();
      school.inst.setMatrixAt(i, dummy.matrix);
    });
    school.inst.instanceMatrix.needsUpdate = true;
  }
}

export function createBubbles(quality) {
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xcfefff,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.6,
    thickness: 0.1,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const inst = new THREE.InstancedMesh(geo, mat, quality.bubbles);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
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
    size: 0.012,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
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

/* decorations */
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
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xb8f0ff,
    roughness: 0.2,
    transmission: 0.5,
    thickness: 0.1,
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
