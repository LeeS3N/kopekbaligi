import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

export const TANK = {
  w: 4.4,
  h: 2.22,
  d: 1.72,
  glass: 0.03,
  water: 2.06,
  sand: 0.08,
};

export const ROOM = {
  floorY: -1.02,
  ceilY: 2.92,
  minX: -5.4,
  maxX: 5.4,
  minZ: -2.25,
  maxZ: 7.35,
};

export const QUALITY_KEY = "askAkvaryumu:quality";

const PRESETS = {
  ultra: {
    bloom: true, shadows: true, shadowSize: 2048, bubbles: 110, fish: 42, kelp: 12,
    snow: 720, godrays: 9, transmission: true, gtao: true, dof: true, smaa: true,
    fxaa: false, post: true, tex1k: false, simpleWater: false, simpleGlass: false,
    hdri: true, hdriPath: "./hdri/fireplace_2k.hdr", grade: true, exposure: 1.12, tone: "agx",
  },
  high: {
    bloom: true, shadows: true, shadowSize: 1024, bubbles: 80, fish: 32, kelp: 10,
    snow: 480, godrays: 7, transmission: true, gtao: false, dof: false, smaa: false,
    fxaa: true, post: true, tex1k: false, simpleWater: false, simpleGlass: false,
    hdri: true, hdriPath: "./hdri/fireplace_1k.hdr", grade: false, exposure: 1.15, tone: "aces",
  },
  medium: {
    bloom: false, shadows: false, shadowSize: 512, bubbles: 50, fish: 22, kelp: 8,
    snow: 220, godrays: 4, transmission: false, gtao: false, dof: false, smaa: false,
    fxaa: false, post: true, tex1k: true, simpleWater: true, simpleGlass: true,
    hdri: false, hdriPath: "./hdri/fireplace_1k.hdr", grade: false, exposure: 1.18, tone: "aces",
  },
};

function readQualityChoice() {
  const params = new URLSearchParams(location.search);
  const q = (params.get("q") || "").toLowerCase();
  if (q === "ultra" || q === "high" || q === "medium" || q === "orta" || q === "low") {
    return q === "orta" || q === "low" ? "medium" : q;
  }
  try {
    const stored = localStorage.getItem(QUALITY_KEY);
    if (stored === "ultra" || stored === "high" || stored === "medium") return stored;
  } catch (e) {}
  return "auto";
}

export function detectQuality() {
  const ua = navigator.userAgent || "";
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || window.innerWidth < 740;
  const dprCap = mobile ? 1.2 : 1.85;
  const choice = readQualityChoice();
  let preset = choice;
  if (preset === "auto") preset = mobile ? "medium" : "ultra";
  const src = PRESETS[preset] || PRESETS.medium;
  const quality = {
    mobile,
    dpr: Math.min(window.devicePixelRatio || 1, dprCap),
    choice,
    preset,
    software: false,
    room: true,
    ...src,
  };
  return applyUrlFlags(quality);
}

export function applyUrlFlags(quality) {
  const p = new URLSearchParams(location.search);
  if (p.has("nopost")) quality.post = false;
  if (p.has("nogtao")) quality.gtao = false;
  if (p.has("nodof")) quality.dof = false;
  if (p.has("notrans")) quality.transmission = false;
  if (p.has("nobloom")) quality.bloom = false;
  if (p.has("noroom")) quality.room = false;
  if (p.has("nofxaa") || p.has("noxaa")) quality.fxaa = false;
  if (p.has("noshadow")) quality.shadows = false;
  if (p.has("nohdri")) quality.hdri = false;
  return quality;
}

export function finalizeQuality(quality, gpuStr) {
  quality.software = /swiftshader|llvmpipe|software/i.test(String(gpuStr || ""));
  quality.gpu = String(gpuStr || "");
  // Software GL cannot reliably run GTAO/DOF/transmission/SMAA. Ultra still gets ACES + vignette + bright tank.
  if (quality.software) {
    if (quality.choice === "auto") {
      Object.assign(quality, PRESETS.medium, { preset: "medium", mobile: quality.mobile, dpr: quality.dpr, choice: "auto", software: true, room: quality.room });
    }
    quality.gtao = false;
    quality.dof = false;
    quality.transmission = false;
    quality.smaa = false;
    quality.fxaa = false;
    quality.simpleGlass = true;
    quality.simpleWater = true;
    quality.hdri = false;
    quality.shadows = false;
    quality.tex1k = true;
    quality.tone = "aces";
    quality.exposure = Math.max(quality.exposure || 1, 1.18);
  }
  return applyUrlFlags(quality);
}

export function tankBounds() {
  const m = 0.28;
  return {
    minX: -TANK.w / 2 + m,
    maxX: TANK.w / 2 - m,
    minY: TANK.sand + 0.22,
    maxY: TANK.water - 0.28,
    minZ: -TANK.d / 2 + m,
    maxZ: TANK.d / 2 - m,
  };
}

function texLoader(manager) {
  const l = new THREE.TextureLoader(manager);
  return (url, srgb = true, repeat = 1) => {
    const t = l.load(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.repeat.set(repeat, repeat);
    return t;
  };
}

const WATER_HELPERS = /* glsl */ `
varying vec3 vWorldPos;
uniform float uTime;
uniform float uNight;
uniform vec3 uWaterColor;
uniform float uFogDensity;
uniform vec3 uCausticColor;
uniform float uWaterLevel;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float caustic(vec2 uv) {
  vec2 uv1 = uv * 2.6 + vec2(uTime * 0.16, uTime * 0.07);
  vec2 uv2 = uv * 3.4 + vec2(-uTime * 0.11, uTime * 0.13);
  vec2 uv3 = uv * 5.2 + vec2(uTime * 0.05, -uTime * 0.09);
  float n1 = noise(uv1);
  float n2 = noise(uv2);
  float n3 = noise(uv3);
  float ridges = 1.0 - abs(n1 * 0.6 + n2 * 0.4 - 0.5) * 2.0;
  float web = pow(clamp(n1 * n2 * 2.4, 0.0, 1.0), 2.2);
  float spark = pow(clamp(n3, 0.0, 1.0), 8.0);
  return clamp(web * 0.85 + pow(ridges, 5.0) * 0.7 + spark * 0.55, 0.0, 1.6);
}
`;


export function dequantizeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const src = o.geometry;
    let changed = false;
    const geo = src.clone();
    for (const name of Object.keys(geo.attributes)) {
      const attr = geo.attributes[name];
      if (!attr || attr.array instanceof Float32Array) continue;
      const item = attr.itemSize;
      const out = new Float32Array(attr.count * item);
      for (let i = 0; i < attr.count; i++) {
        const i3 = i * item;
        if (item >= 1) out[i3] = attr.getX(i);
        if (item >= 2) out[i3 + 1] = attr.getY(i);
        if (item >= 3) out[i3 + 2] = attr.getZ(i);
        if (item >= 4) out[i3 + 3] = attr.getW(i);
      }
      const next = new THREE.BufferAttribute(out, item);
      next.normalized = false;
      if (attr.usage) next.usage = attr.usage;
      geo.setAttribute(name, next);
      changed = true;
    }
    if (changed) {
      if (geo.attributes.position && !geo.attributes.normal) geo.computeVertexNormals();
      else if (geo.attributes.position) geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      o.geometry = geo;
    }
  });
  return root;
}

export let USE_UNDERWATER_SHADERS = true;

export function applyUnderwater(material, uniforms, hooks = {}) {
  if (!USE_UNDERWATER_SHADERS) return;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uWaterColor = uniforms.uWaterColor;
    shader.uniforms.uFogDensity = uniforms.uFogDensity;
    if (uniforms.uCausticColor) shader.uniforms.uCausticColor = uniforms.uCausticColor;
    if (hooks.uniforms) Object.assign(shader.uniforms, hooks.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorldPos;\n" + (hooks.vertexCommon || "")
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        ${hooks.vertexBend || ""}`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + WATER_HELPERS)
      .replace(
        "#include <opaque_fragment>",
        `{
        float dist = length(vViewPosition);
        float depthFade = smoothstep(2.05, 0.12, vWorldPos.y);
        float absorb = 1.0 - exp(-clamp(dist, 0.0, 40.0) * uFogDensity);
        absorb = clamp(absorb + depthFade * 0.18, 0.0, 0.78);
        vec3 deep = uWaterColor * mix(0.42, 0.20, uNight);
        outgoingLight = mix(outgoingLight, deep, absorb);
        float c = caustic(vWorldPos.xz);
        float up = clamp(dot(normalize(normal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
        vec3 cauCol = vec3(0.55, 0.95, 0.92);
        outgoingLight += cauCol * (0.28 + 1.15 * c) * up * mix(1.0, 0.28, uNight) * (1.0 - absorb * 0.35);
        }
        #include <opaque_fragment>`
      );
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => "uw-safe-" + (hooks.key || "base");
}

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uGrain: { value: 0.028 },
    uTime: { value: 0 },
    uContrast: { value: 1.12 },
    uSat: { value: 1.18 },
    uVignette: { value: 0.32 },
    uTeal: { value: 0.16 },
    uWarm: { value: 0.12 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGrain, uTime, uContrast, uSat, uVignette, uTeal, uWarm;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      c = (c - 0.5) * uContrast + 0.48;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSat);
      c.gb += vec2(uTeal, uTeal * 1.15) * (1.0 - smoothstep(0.15, 0.55, luma));
      c.r  *= 1.0 - uTeal * 0.55 * (1.0 - smoothstep(0.1, 0.5, luma));
      c *= mix(vec3(1.0), vec3(1.08, 1.0, 0.86), smoothstep(0.55, 1.05, luma) * uWarm * 4.0);
      float n = hash(vUv * vec2(1920.0, 1080.0) + uTime * 12.0);
      c += (n - 0.5) * uGrain;
      float r = distance(vUv, vec2(0.5, 0.48));
      c *= 1.0 - smoothstep(0.35, 0.95, r) * uVignette;
      gl_FragColor = vec4(max(c, vec3(0.0)), src.a);
    }
  `,
};

export async function createWorld(canvas, quality, manager) {
  RectAreaLightUniformsLib.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0808);
  scene.fog = null;

  const camera = new THREE.PerspectiveCamera(quality.mobile ? 52 : 42, 1, 0.1, 60);
  camera.position.set(1.55, 1.42, 5.65);
  camera.lookAt(0.0, 0.68, 0.2);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !quality.mobile,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const gpu = renderer.getContext().getExtension("WEBGL_debug_renderer_info");
  const gpuStr = gpu
    ? renderer.getContext().getParameter(gpu.UNMASKED_RENDERER_WEBGL)
    : "";
  finalizeQuality(quality, gpuStr);
  USE_UNDERWATER_SHADERS = true;
  renderer.toneMapping = quality.tone === "agx" ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = quality.exposure;
  renderer.shadowMap.enabled = !!quality.shadows;
  if (quality.software) renderer.setPixelRatio(Math.min(quality.dpr, 1.25));
  if (quality.noroom) quality.room = false;

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uWaterColor: { value: new THREE.Color(0x0a4e60) },
    uFogDensity: { value: 0.14 },
    uCausticColor: { value: new THREE.Color(0x5ef0d8) },
    uWaterLevel: { value: TANK.water },
  };

  const load = texLoader(manager);
  const tex = {
    sandDiff: load(quality.tex1k ? "./textures/coast_sand_01_diff_1k.jpg" : "./textures/coast_sand_01_diff_2k.jpg", true, 3.2),
    sandNor: load(quality.tex1k ? "./textures/coast_sand_01_nor_gl_1k.jpg" : "./textures/coast_sand_01_nor_gl_2k.jpg", false, 3.2),
    sandRough: load("./textures/coast_sand_01_rough_1k.jpg", false, 3.2),
    rockDiff: load("./textures/rock_face_03_diff_1k.jpg", true, 1.4),
    rockNor: load("./textures/rock_face_03_nor_gl_1k.jpg", false, 1.4),
    rockRough: load("./textures/rock_face_03_rough_1k.jpg", false, 1.4),
    woodDiff: load("./textures/wood_cabinet_worn_long_diff_1k.jpg", true, 1),
    woodNor: load("./textures/wood_cabinet_worn_long_nor_gl_1k.jpg", false, 1),
    woodRough: load("./textures/wood_cabinet_worn_long_rough_1k.jpg", false, 1),
    floorDiff: load("./textures/wood_floor_diff_2k.jpg", true, 4.2),
    floorNor: load("./textures/wood_floor_nor_gl_2k.jpg", false, 4.2),
    floorArm: load("./textures/wood_floor_arm_2k.jpg", false, 4.2),
    wallDiff: load("./textures/plaster_diff_2k.jpg", true, 2.4),
    wallNor: load("./textures/plaster_nor_gl_2k.jpg", false, 2.4),
    wallArm: load("./textures/plaster_arm_2k.jpg", false, 2.4),
  };

  await loadEnvironment(renderer, scene, quality, manager);

  const root = new THREE.Group();
  scene.add(root);

  let room = null;
  if (quality.room) {
    room = buildLivingRoom(tex, quality);
    root.add(room);
    await loadSofa(room, manager);
  }

  const cabinet = makeCabinet(tex);
  root.add(cabinet);

  const sand = makeSand(tex, quality);
  applyUnderwater(sand.material, uniforms);
  root.add(sand);

  const interior = new THREE.Group();
  interior.name = "interior";
  root.add(interior);

  const tankBackMat = new THREE.MeshStandardMaterial({
    color: 0x0c5a68,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.2,
    emissive: new THREE.Color(0x083844),
    emissiveIntensity: 0.22,
  });
  applyUnderwater(tankBackMat, uniforms, { key: "tank-back" });
  const tankBack = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w - 0.08, TANK.water - TANK.sand),
    tankBackMat
  );
  tankBack.position.set(0, (TANK.water + TANK.sand) / 2, -TANK.d / 2 + 0.03);
  tankBack.receiveShadow = true;
  interior.add(tankBack);


  const decorations = new THREE.Group();
  decorations.name = "decorations";
  interior.add(decorations);

  const waterSurface = quality.simpleWater ? makeSimpleWater() : makeWaterSurface();
  root.add(waterSurface);

  const glass = makeGlass(quality);
  root.add(glass);

  const frame = makeFrame();
  root.add(frame);

  const lights = makeLights(root, quality);
  const rays = quality.godrays ? makeGodRays(quality.godrays) : new THREE.Group();
  interior.add(rays);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.target.set(0.0, 0.68, 0.2);
  controls.minDistance = 1.35;
  controls.maxDistance = 8.0;
  controls.minPolarAngle = 0.78;
  controls.maxPolarAngle = 1.48;
  controls.minAzimuthAngle = -1.05;
  controls.maxAzimuthAngle = 1.15;
  controls.enablePan = false;
  controls.update();

  let lastInteract = 0;
  const mark = () => { lastInteract = performance.now(); };
  renderer.domElement.addEventListener("pointerdown", mark);
  renderer.domElement.addEventListener("wheel", mark, { passive: true });
  controls.addEventListener("start", mark);

  const labels = new CSS2DRenderer();
  labels.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  const host = canvas.parentElement || document.body;
  host.appendChild(labels.domElement);

  const composer = buildComposer(renderer, scene, camera, quality, uniforms);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    labels.setSize(w, h);
    if (composer.passes) {
      composer.passes.forEach((p) => {
        if (p.material && p.material.uniforms && p.material.uniforms.resolution) {
          p.material.uniforms.resolution.value.set(w, h);
        }
      });
    }
  }
  window.addEventListener("resize", resize);
  resize();

  return {
    scene, camera, renderer, composer, controls, labels,
    root, interior, decorations, waterSurface, rays, lights,
    uniforms, quality, room,
    lastInteract: () => lastInteract,
  };
}

async function loadEnvironment(renderer, scene, quality, manager) {
  if (quality.software || !quality.hdri) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.35;
    pmrem.dispose();
    return;
  }
  try {
    const hdr = await new HDRLoader(manager).loadAsync(quality.hdriPath || "./hdri/fireplace_1k.hdr");
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = env;
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.32;
    hdr.dispose();
    pmrem.dispose();
  } catch (err) {
    console.warn("HDRI failed, using RoomEnvironment", err);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.28;
    pmrem.dispose();
  }
}

function buildComposer(renderer, scene, camera, quality, uniforms) {
  // Default composer (HalfFloat + linear) matches the known-good v2 path.
  // A custom UnsignedByte/sRGB target was causing posterization on software GL.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.userData = {};

  if (quality.post === false) {
    composer.addPass(new OutputPass());
    return composer;
  }

  if (quality.gtao) {
    try {
      const gtao = new GTAOPass(scene, camera);
      gtao.output = 0;
      gtao.blendIntensity = 0.85;
      composer.addPass(gtao);
    } catch (e) {
      console.warn("GTAO unavailable", e);
      quality.gtao = false;
    }
  }

  if (quality.dof) {
    try {
      const bokeh = new BokehPass(scene, camera, {
        focus: 5.0,
        aperture: 0.00016,
        maxblur: 0.01,
      });
      composer.addPass(bokeh);
      composer.userData.bokeh = bokeh;
    } catch (e) {
      console.warn("DOF unavailable", e);
      quality.dof = false;
    }
  }

  if (quality.bloom) {
    try {
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.5, 0.8);
      composer.addPass(bloom);
    } catch (e) {
      console.warn("Bloom unavailable", e);
      quality.bloom = false;
    }
  }

  // Mild vignette like v2 (stable on SwiftShader / llvmpipe)
  const vignette = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      offset: { value: 0.85 },
      darkness: { value: 0.52 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float offset, darkness; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 uv = (vUv - 0.5) * vec2(offset, offset);
        float v = smoothstep(0.0, 0.9, dot(uv, uv));
        c.rgb = mix(c.rgb, c.rgb * (1.0 - darkness), v);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(vignette);

  composer.addPass(new OutputPass());

  if (quality.grade) {
    try {
      const grade = new ShaderPass(GRADE_SHADER);
      grade.uniforms.uGrain.value = quality.mobile ? 0.016 : 0.025;
      composer.addPass(grade);
      composer.userData.grade = grade;
    } catch (e) {
      console.warn("Grade unavailable", e);
    }
  }

  if (quality.smaa) {
    try { composer.addPass(new SMAAPass()); }
    catch (e) {
      if (quality.fxaa) try { composer.addPass(new FXAAPass()); } catch (e2) {}
    }
  } else if (quality.fxaa) {
    try { composer.addPass(new FXAAPass()); } catch (e) {}
  }

  return composer;
}

function buildLivingRoom(tex, quality) {
  const g = new THREE.Group();
  g.name = "livingRoom";
  const { floorY, ceilY, minX, maxX, minZ, maxZ } = ROOM;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const h = ceilY - floorY;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const floorMat = new THREE.MeshStandardMaterial({
    map: tex.floorDiff,
    normalMap: quality && quality.software ? null : tex.floorNor,
    roughnessMap: tex.floorArm,
    metalnessMap: tex.floorArm,
    color: 0x5a3c26,
    roughness: 0.62,
    metalness: 0.04,
    envMapIntensity: 0.22,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, floorY, cz);
  floor.receiveShadow = true;
  g.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({
    map: tex.wallDiff,
    normalMap: quality && quality.software ? null : tex.wallNor,
    roughnessMap: tex.wallArm,
    color: 0x6a5848,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.08,
  });
  const ceilMat = wallMat.clone();
  ceilMat.color = new THREE.Color(0x2c2824);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
  back.position.set(cx, floorY + h / 2, minZ);
  back.receiveShadow = true;
  g.add(back);

  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat.clone());
  front.position.set(cx, floorY + h / 2, maxZ);
  front.rotation.y = Math.PI;
  front.receiveShadow = true;
  g.add(front);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(d, h), wallMat.clone());
  left.position.set(minX, floorY + h / 2, cz);
  left.rotation.y = Math.PI / 2;
  left.receiveShadow = true;
  g.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(d, h), wallMat.clone());
  right.position.set(maxX, floorY + h / 2, cz);
  right.rotation.y = -Math.PI / 2;
  right.receiveShadow = true;
  g.add(right);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, ceilY, cz);
  g.add(ceil);

  // skirting
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.5 });
  const addSkirt = (x, z, rw, rd, rotY) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.08, rd), skirtMat);
    m.position.set(x, floorY + 0.04, z);
    m.rotation.y = rotY || 0;
    g.add(m);
  };
  addSkirt(cx, minZ + 0.03, w, 0.06);
  addSkirt(minX + 0.03, cz, d, 0.06, Math.PI / 2);
  addSkirt(maxX - 0.03, cz, d, 0.06, Math.PI / 2);

  // rug
  const rug = makeRug();
  rug.position.set(0.35, floorY + 0.008, 2.05);
  g.add(rug);

  // coffee table
  const table = makeCoffeeTable(tex);
  table.position.set(0.15, floorY, 1.85);
  g.add(table);

  // floor lamp
  const lamp = makeFloorLamp();
  lamp.position.set(-2.35, floorY, 2.15);
  g.add(lamp);

  // plant
  const plant = makePlant();
  plant.position.set(-3.15, floorY, 0.15);
  g.add(plant);
  const plant2 = makePlant();
  plant2.scale.setScalar(0.82);
  plant2.position.set(3.35, floorY, -0.35);
  g.add(plant2);

  // picture frames
  g.add(makeFrames(wallMat));

  // evening window on the right wall
  g.add(makeWindow());

  return g;
}

async function loadSofa(group, manager) {
  try {
    const gltf = await new GLTFLoader(manager).loadAsync("./models/room/sofa.glb");
    const sofa = gltf.scene;
    dequantizeObject(sofa);
    sofa.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          o.material.envMapIntensity = 0.35;
          o.material.color = new THREE.Color(0x5a4638);
          o.material.roughness = 0.7;
        }
      }
    });
    sofa.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sofa);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2.35 / Math.max(size.x, 0.001);
    sofa.scale.setScalar(scale);
    sofa.rotation.y = Math.PI + 0.18;
    sofa.position.set(2.05, ROOM.floorY - box.min.y * scale, 2.05);
    group.add(sofa);
  } catch (e) {
    console.warn("Sofa failed", e);
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.72, 0.92),
      new THREE.MeshStandardMaterial({ color: 0x4a382e, roughness: 0.75 })
    );
    fallback.position.set(1.85, ROOM.floorY + 0.36, 3.55);
    fallback.castShadow = true;
    group.add(fallback);
  }
}

function makeRug() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 768;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2a1610";
  ctx.fillRect(0, 0, 512, 768);
  ctx.strokeStyle = "#8a3a28";
  ctx.lineWidth = 18;
  ctx.strokeRect(24, 24, 464, 720);
  ctx.strokeStyle = "#c4a05a";
  ctx.lineWidth = 6;
  ctx.strokeRect(40, 40, 432, 688);
  ctx.fillStyle = "#6b2a1e";
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(256, 80 + i * 70);
    ctx.lineTo(200, 120 + i * 70);
    ctx.lineTo(256, 160 + i * 70);
    ctx.lineTo(312, 120 + i * 70);
    ctx.closePath();
    ctx.globalAlpha = 0.55;
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.9, metalness: 0, color: 0xffffff,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.6), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function makeCoffeeTable(tex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.woodDiff, normalMap: tex.woodNor, roughnessMap: tex.woodRough,
    color: 0x3a2a1c, roughness: 0.4, metalness: 0.05, envMapIntensity: 0.4,
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.62), mat);
  top.position.y = 0.38;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  for (const [x, z] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.05), mat);
    leg.position.set(x, 0.19, z);
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

function makeFloorLamp() {
  const g = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb08a4a, roughness: 0.28, metalness: 0.85, envMapIntensity: 1.0,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.55, 12), brass);
  pole.position.y = 0.775;
  pole.castShadow = true;
  g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 16), brass);
  base.position.y = 0.02;
  g.add(base);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xf0d6a8,
    emissive: new THREE.Color(0xffc070),
    emissiveIntensity: 0.9,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 16, 1, true), shadeMat);
  shade.position.y = 1.52;
  g.add(shade);
  const bulb = new THREE.PointLight(0xffc070, 2.4, 5.5, 1.8);
  bulb.position.set(0, 1.42, 0);
  bulb.castShadow = false;
  g.add(bulb);
  return g;
}

function makePlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.13, 0.28, 16),
    new THREE.MeshStandardMaterial({ color: 0x6a3a2a, roughness: 0.7, metalness: 0.05 })
  );
  pot.position.y = 0.14;
  pot.castShadow = true;
  g.add(pot);
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.145, 0.04, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 })
  );
  soil.position.y = 0.27;
  g.add(soil);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.028, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a4a22, roughness: 0.8 })
  );
  stem.position.y = 0.6;
  stem.castShadow = true;
  g.add(stem);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x1f5a32, roughness: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.3,
  });
  const leafGeo = new THREE.SphereGeometry(0.16, 8, 6);
  leafGeo.scale(0.55, 1.15, 0.12);
  for (let i = 0; i < 14; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.2;
    const y = 0.55 + (i % 5) * 0.16;
    leaf.position.set(Math.cos(a) * 0.18, y, Math.sin(a) * 0.18);
    leaf.lookAt(leaf.position.x * 2, y + 0.4, leaf.position.z * 2);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

function makeFrames() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.45, metalness: 0.1 });
  const arts = [0x1a3040, 0x4a2018, 0x2a3a28];
  const xs = [-2.4, 0.0, 2.4];
  arts.forEach((col, i) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.52, 0.03), wood);
    frame.position.set(xs[i], 1.55, ROOM.minZ + 0.02);
    g.add(frame);
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.42),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: col, emissiveIntensity: 0.04 })
    );
    art.position.set(xs[i], 1.55, ROOM.minZ + 0.04);
    g.add(art);
  });
  return g;
}

function makeWindow() {
  const g = new THREE.Group();
  const night = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.7),
    new THREE.MeshBasicMaterial({ color: 0x0a1520 })
  );
  night.position.set(ROOM.maxX - 0.03, 1.25, 1.8);
  night.rotation.y = -Math.PI / 2;
  g.add(night);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.82, 1.72),
    new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.5 })
  );
  frame.position.set(ROOM.maxX - 0.06, 1.25, 1.8);
  g.add(frame);
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0x4a3028, roughness: 0.85, side: THREE.DoubleSide,
  });
  for (const z of [1.05, 2.55]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2.15, 1, 8), curtainMat);
    const pos = c.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + Math.sin(pos.getY(i) * 8.0) * 0.03);
    c.geometry.computeVertexNormals();
    c.position.set(ROOM.maxX - 0.12, 1.05, z);
    c.rotation.y = -Math.PI / 2;
    g.add(c);
  }
  return g;
}

function makeCabinet(tex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.woodDiff, normalMap: tex.woodNor, roughnessMap: tex.woodRough,
    color: 0x5a3e28, roughness: 0.48, metalness: 0.06, envMapIntensity: 0.4,
  });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(TANK.w + 0.28, 0.92, TANK.d + 0.28), mat);
  cab.position.set(0, -0.46, 0.0);
  cab.castShadow = true;
  cab.receiveShadow = true;
  g.add(cab);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(TANK.w + 0.22, 0.08, TANK.d + 0.22), mat);
  plinth.position.set(0, -0.96, 0.0);
  g.add(plinth);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.35, metalness: 0.6 });
  for (const x of [-1.35, 0, 1.35]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.02), metal);
    d.position.set(x, -0.38, TANK.d / 2 + 0.15);
    g.add(d);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), metal);
    knob.position.set(x, -0.38, TANK.d / 2 + 0.18);
    g.add(knob);
  }
  return g;
}

function makeSand(tex, quality) {
  const segs = quality && (quality.software || quality.tex1k) ? 8 : 64;
  const geo = new THREE.PlaneGeometry(TANK.w - 0.06, TANK.d - 0.06, segs, Math.max(4, (segs / 2) | 0));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const h = (Math.sin(x * 3.2) * 0.01 + Math.cos(y * 4.1) * 0.008) + (Math.abs(x) > 1.6 ? 0.03 : 0);
    pos.setZ(i, h);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.sandDiff,
    normalMap: tex.sandNor,
    roughnessMap: tex.sandRough,
    color: 0xd4bc8a,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.25,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = TANK.sand;
  mesh.receiveShadow = true;
  return mesh;
}


function makeSimpleWater() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a6a78,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: 0.28,
    envMapIntensity: 0.5,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w - 0.08, TANK.d - 0.08), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = TANK.water - 0.01;
  mesh.renderOrder = 2;
  return mesh;
}

function makeWaterSurface() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vN;
      uniform float uTime;
      void main() {
        vec3 p = position;
        p.z += sin(p.x * 3.2 + uTime * 1.1) * 0.008 + cos(p.y * 4.0 + uTime * 0.8) * 0.006;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vN;
      uniform float uTime;
      uniform float uNight;
      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vN);
        float ndv = abs(dot(N, V));
        // ~48.6° critical angle water→air
        float tir = 1.0 - smoothstep(0.62, 0.82, ndv);
        vec3 deep = vec3(0.01, 0.05, 0.07);
        vec3 sky = mix(vec3(0.55, 0.72, 0.85), vec3(0.12, 0.16, 0.22), uNight);
        vec3 glow = vec3(1.0, 0.78, 0.42) * (0.15 + 0.1 * sin(uTime + vWorldPos.x * 2.0));
        vec3 refl = mix(deep, sky, tir) + glow * tir * 0.35;
        float fres = pow(1.0 - ndv, 3.0);
        vec3 col = mix(vec3(0.05, 0.22, 0.28) * 0.35, refl, mix(0.35, 1.0, fres));
        float alpha = mix(0.28, 0.78, max(fres, tir * 0.7));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w - 0.08, TANK.d - 0.08, 48, 24),
    mat
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = TANK.water - 0.01;
  mesh.renderOrder = 2;
  return mesh;
}

function makeGlass(quality) {
  const g = new THREE.Group();
  const w = TANK.w, h = TANK.h, d = TANK.d, t = TANK.glass;
  const mat = quality.transmission
    ? new THREE.MeshPhysicalMaterial({
        color: 0xd8eef2,
        roughness: 0.04,
        metalness: 0.0,
        transmission: 0.78,
        thickness: 0.03,
        ior: 1.45,
        transparent: true,
        opacity: 0.14,
        envMapIntensity: 1.2,
        attenuationColor: new THREE.Color(0x8ed8d0),
        attenuationDistance: 4.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xc8e6ee,
        roughness: 0.08,
        metalness: 0.0,
        transparent: true,
        opacity: 0.07,
        envMapIntensity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 3;
    g.add(m);
  };
  add(new THREE.BoxGeometry(w, h, t), 0, h / 2, d / 2);
  add(new THREE.BoxGeometry(w, h, t), 0, h / 2, -d / 2);
  add(new THREE.BoxGeometry(t, h, d), -w / 2, h / 2, 0);
  add(new THREE.BoxGeometry(t, h, d), w / 2, h / 2, 0);
  return g;
}

function makeFrame() {
  const g = new THREE.Group();
  const w = TANK.w, h = TANK.h, d = TANK.d;
  const thick = 0.055;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x141210,
    roughness: 0.32,
    metalness: 0.72,
    envMapIntensity: 0.9,
  });
  const bar = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  // front frame
  bar(w + thick * 2, thick, thick, 0, h + thick / 2, d / 2 + 0.01);
  bar(w + thick * 2, thick, thick, 0, -thick / 2 + 0.01, d / 2 + 0.01);
  bar(thick, h + thick * 2, thick, -w / 2 - thick / 2 + 0.01, h / 2, d / 2 + 0.01);
  bar(thick, h + thick * 2, thick, w / 2 + thick / 2 - 0.01, h / 2, d / 2 + 0.01);
  // back
  bar(w + thick * 2, thick, thick, 0, h + thick / 2, -d / 2 - 0.01);
  bar(thick, h + thick * 2, thick, -w / 2 - thick / 2, h / 2, -d / 2 - 0.01);
  bar(thick, h + thick * 2, thick, w / 2 + thick / 2, h / 2, -d / 2 - 0.01);
  // hood
  const hoodMat = new THREE.MeshStandardMaterial({
    color: 0x1a1612, roughness: 0.4, metalness: 0.5,
  });
  const hood = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.08, d + 0.08), hoodMat);
  hood.position.set(0, h + 0.08, 0);
  hood.castShadow = false;
  g.add(hood);
  // warm emitter strip under hood
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.92, 0.01, d * 0.7),
    new THREE.MeshBasicMaterial({ color: 0xffe0a8 })
  );
  strip.position.set(0, h + 0.03, 0);
  g.add(strip);
  return g;
}

function makeLights(root, quality) {
  // Proven v2 aquarium lighting: bright cool hemi + strong hood + fill,
  // plus dimmer living-room practicals so the tank stays the dominant source.
  const hemi = new THREE.HemisphereLight(0x7eb8c8, 0x1a120c, 0.22);
  root.add(hemi);

  const sun = new THREE.DirectionalLight(0xcfefff, 1.15);
  sun.position.set(0.4, 4.2, 2.4);
  sun.castShadow = !!quality.shadows;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 14;
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -4;
    sun.shadow.bias = -0.0008;
  }
  root.add(sun);

  const hood = new THREE.SpotLight(0xd8f0ff, 38, 8, Math.PI / 3.2, 0.5, 1.05);
  hood.position.set(0, TANK.h + 0.05, 0.1);
  hood.target.position.set(0, 0.2, 0);
  hood.castShadow = !!quality.shadows && !quality.mobile && !quality.software;
  root.add(hood);
  root.add(hood.target);

  const hood2 = new THREE.SpotLight(0xffe0a0, 8, 6.0, Math.PI / 4.0, 0.6, 1.15);
  hood2.position.set(-1.1, TANK.h + 0.04, -0.1);
  hood2.target.position.set(-0.6, 0.3, 0);
  root.add(hood2);
  root.add(hood2.target);

  const hood3 = new THREE.SpotLight(0xffe0a0, 8, 6.0, Math.PI / 4.0, 0.6, 1.15);
  hood3.position.set(1.1, TANK.h + 0.04, -0.1);
  hood3.target.position.set(0.6, 0.3, 0);
  root.add(hood3);
  root.add(hood3.target);

  const fill = new THREE.PointLight(0x7ec8d4, 2.6, 6, 1.5);
  fill.position.set(0, 1.4, 0.2);
  root.add(fill);

  const rect = new THREE.RectAreaLight(0xffd090, quality.software ? 0 : 5, TANK.w * 0.85, TANK.d * 0.55);
  rect.position.set(0, TANK.h - 0.08, 0);
  rect.lookAt(0, 0.4, 0);
  if (!quality.software) root.add(rect);

  const spill = new THREE.SpotLight(0x5ee0d0, 14, 10.0, Math.PI / 2.8, 0.62, 1.0);
  spill.position.set(0, 1.35, 0.55);
  spill.target.position.set(0.3, 0.15, 3.2);
  spill.castShadow = false;
  root.add(spill);
  root.add(spill.target);

  const roomFill = new THREE.PointLight(0xffb060, 1.6, 7, 1.8);
  roomFill.position.set(-2.25, 1.35, 2.15);
  root.add(roomFill);

  const amb = new THREE.AmbientLight(0x1a140e, 0.05);
  root.add(amb);

  return { hemi, sun, hood, hood2, hood3, fill, rect, spill, roomFill, amb };
}

function makeGodRays(n) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uNight;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
      }
      void main() {
        float x = vUv.x - 0.5;
        float shaft = exp(-pow(x * 9.0, 2.0));
        float bands = 0.55 + 0.45 * noise(vec2(vUv.x * 18.0, uTime * 0.15));
        float flicker = 0.75 + 0.25 * sin(uTime * 1.3 + vUv.x * 20.0);
        float fall = pow(1.0 - vUv.y, 1.15);
        float a = shaft * bands * flicker * fall * mix(0.42, 0.18, uNight);
        vec3 teal = vec3(0.28, 0.92, 0.82);
        vec3 warm = vec3(1.0, 0.78, 0.42);
        vec3 col = mix(teal, warm, smoothstep(0.7, 1.0, 1.0 - vUv.y) * 0.55);
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, TANK.water - 0.05), mat);
    const x = -1.7 + (i / Math.max(1, n - 1)) * 3.4;
    mesh.position.set(x, TANK.water / 2, (i % 2 === 0 ? 0.18 : -0.22));
    mesh.rotation.y = (i % 2 === 0 ? 0.15 : -0.12);
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  group.userData.mat = mat;
  return group;
}

export function setDayNight(world, nightT) {
  const L = world.lights;
  const q = world.quality || {};
  L.hemi.intensity = THREE.MathUtils.lerp(0.22, 0.08, nightT);
  if (L.sun) L.sun.intensity = THREE.MathUtils.lerp(1.15, 0.2, nightT);
  L.hood.intensity = THREE.MathUtils.lerp(38, 16, nightT);
  L.hood.color.set(nightT > 0.5 ? 0xa8c4ff : 0xd8f0ff);
  if (L.hood2) L.hood2.intensity = THREE.MathUtils.lerp(8, 4, nightT);
  if (L.hood3) L.hood3.intensity = THREE.MathUtils.lerp(8, 4, nightT);
  L.fill.intensity = THREE.MathUtils.lerp(2.6, 1.2, nightT);
  if (L.rect) L.rect.intensity = THREE.MathUtils.lerp(q.software ? 0 : 5, 2, nightT);
  if (L.spill) L.spill.intensity = THREE.MathUtils.lerp(14, 6, nightT);
  if (L.roomFill) L.roomFill.intensity = THREE.MathUtils.lerp(1.6, 0.7, nightT);
  world.scene.background.copy(
    new THREE.Color(0x0a0d10).lerp(new THREE.Color(0x05060a), nightT)
  );
  world.uniforms.uWaterColor.value.set(nightT > 0.5 ? 0x061828 : 0x0a4e60);
  world.uniforms.uNight.value = nightT;
  const dayExp = q.exposure || 1.15;
  world.renderer.toneMappingExposure = THREE.MathUtils.lerp(dayExp, dayExp * 0.82, nightT);
  if (world.waterSurface?.material?.uniforms?.uNight) {
    world.waterSurface.material.uniforms.uNight.value = nightT;
  }
  if (world.rays?.userData?.mat) {
    world.rays.userData.mat.uniforms.uNight.value = nightT;
  }
}

export function updateCameraIdle(world, now, dt) {
  const idle = now - world.lastInteract() > 2200;
  if (idle) {
    const t = now * 0.00012;
    const off = new THREE.Vector3().subVectors(world.camera.position, world.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t) * 0.035 * dt);
    world.camera.position.copy(world.controls.target).add(off);
  }
  world.controls.update();
}

export function updateWorldTime(world, t, nightT) {
  world.uniforms.uTime.value = t;
  if (world.waterSurface?.material?.uniforms?.uTime) {
    world.waterSurface.material.uniforms.uTime.value = t;
  }
  if (world.rays?.userData?.mat) {
    world.rays.userData.mat.uniforms.uTime.value = t;
  }
  if (world.composer?.userData?.grade) {
    world.composer.userData.grade.uniforms.uTime.value = t;
  }
  const bokeh = world.composer?.userData?.bokeh;
  if (bokeh) {
    const focus = world.camera.position.distanceTo(world.controls.target);
    bokeh.uniforms.focus.value = focus;
  }
  setDayNight(world, nightT);
}
