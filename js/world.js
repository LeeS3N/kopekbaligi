import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const TANK = {
  w: 4.4,
  h: 2.22,
  d: 1.72,
  glass: 0.03,
  water: 2.06,
  sand: 0.08,
};

export function detectQuality() {
  const ua = navigator.userAgent || "";
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || window.innerWidth < 740;
  const dprCap = mobile ? 1.2 : 1.7;
  return {
    mobile,
    dpr: Math.min(window.devicePixelRatio || 1, dprCap),
    bloom: !mobile,
    shadows: true,
    shadowSize: mobile ? 512 : 1024,
    bubbles: mobile ? 40 : 90,
    fish: mobile ? 12 : 26,
    kelp: mobile ? 9 : 16,
    snow: mobile ? 160 : 420,
    godrays: mobile ? 4 : 7,
    transmission: false,
  };
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
    t.anisotropy = 8;
    t.repeat.set(repeat, repeat);
    return t;
  };
}

const WATER_CHUNK = /* glsl */ `
varying vec3 vWorldPos;
uniform float uTime;
uniform float uNight;
uniform vec3 uWaterColor;
uniform float uFogDensity;

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
  vec2 uv1 = uv * 2.4 + vec2(uTime * 0.11, uTime * 0.05);
  vec2 uv2 = uv * 3.1 + vec2(-uTime * 0.07, uTime * 0.09);
  float n1 = noise(uv1) * noise(uv2 * 1.3);
  float n2 = noise(uv2.yx + 2.4) * noise(uv1.yx * 0.8);
  float c = pow(clamp(n1 * 1.6 + n2 * 0.8, 0.0, 1.0), 3.0);
  return c;
}
`;

export function applyUnderwater(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uWaterColor = uniforms.uWaterColor;
    shader.uniforms.uFogDensity = uniforms.uFogDensity;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WATER_CHUNK}`)
      .replace(
        "#include <opaque_fragment>",
        `
        {
          float dist = length(vViewPosition);
          float depthFade = smoothstep(2.05, 0.15, vWorldPos.y);
          float absorb = 1.0 - exp(-dist * uFogDensity);
          absorb = clamp(absorb + depthFade * 0.22, 0.0, 0.82);
          vec3 deep = uWaterColor * mix(0.55, 0.22, uNight);
          outgoingLight = mix(outgoingLight, deep, absorb);
          float c = caustic(vWorldPos.xz);
          float up = clamp(dot(normalize(normal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
          float sun = (1.0 - uNight * 0.7) * (0.22 + 0.85 * c) * up;
          outgoingLight += vec3(0.75, 0.95, 1.0) * sun * 1.55 * (1.0 - absorb * 0.45);
        }
        #include <opaque_fragment>`
      );
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => "underwater-v2";
}

const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 0.85 },
    darkness: { value: 0.55 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset, offset);
      float v = smoothstep(0.0, 0.9, dot(uv, uv));
      c.rgb = mix(c.rgb, c.rgb * (1.0 - darkness), v);
      gl_FragColor = c;
    }`,
};

export async function createWorld(canvas, quality, manager) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d10);

  const camera = new THREE.PerspectiveCamera(quality.mobile ? 46 : 36, 1, 0.08, 40);
  camera.position.set(0.0, 1.18, 4.35);
  camera.lookAt(0, 0.82, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !quality.mobile,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "";
  quality.software = /swiftshader|llvmpipe|software/i.test(String(gpu));
  if (quality.software) {
    quality.bloom = false;
    renderer.toneMappingExposure = 1.25;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  canvas.parentElement.appendChild(labels.domElement);

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uWaterColor: { value: new THREE.Color(0x0a4a62) },
    uFogDensity: { value: 0.16 },
  };

  const load = texLoader(manager);
  const sandDiff = load("./textures/coast_sand_01_diff_1k.jpg", true, 3.2);
  const sandNor = load("./textures/coast_sand_01_nor_gl_1k.jpg", false, 3.2);
  const sandRough = load("./textures/coast_sand_01_rough_1k.jpg", false, 3.2);
  const rockDiff = load("./textures/rock_face_03_diff_1k.jpg", true, 1.4);
  const rockNor = load("./textures/rock_face_03_nor_gl_1k.jpg", false, 1.4);
  const rockRough = load("./textures/rock_face_03_rough_1k.jpg", false, 1.4);
  const woodDiff = load("./textures/wood_cabinet_worn_long_diff_1k.jpg", true, 1);
  const woodNor = load("./textures/wood_cabinet_worn_long_nor_gl_1k.jpg", false, 1);
  const woodRough = load("./textures/wood_cabinet_worn_long_rough_1k.jpg", false, 1);

  const root = new THREE.Group();
  scene.add(root);

  buildRoom(root, { woodDiff, woodNor, woodRough });
  const interior = new THREE.Group();
  interior.name = "interior";
  root.add(interior);

  const sandMat = new THREE.MeshStandardMaterial({
    map: sandDiff,
    normalMap: sandNor,
    roughnessMap: sandRough,
    roughness: 0.9,
    metalness: 0,
    color: 0xe8d4a8,
  });
  sandMat.normalScale.set(0.7, 0.7);
  applyUnderwater(sandMat, uniforms);
  const sand = makeSand();
  sand.material = sandMat;
  sand.receiveShadow = true;
  interior.add(sand);

  const rocks = makeRocks({ rockDiff, rockNor, rockRough }, uniforms);
  interior.add(rocks);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w - 0.04, TANK.h - 0.04),
    new THREE.MeshStandardMaterial({
      color: 0x0c3a4c,
      roughness: 0.92,
      metalness: 0,
    })
  );
  backdrop.position.set(0, TANK.h / 2, -TANK.d / 2 + 0.01);
  applyUnderwater(backdrop.material, uniforms);
  interior.add(backdrop);

  const waterSurface = makeWaterSurface();
  root.add(waterSurface);

  const glass = makeGlass(quality);
  root.add(glass);
  const frame = makeFrame();
  root.add(frame);

  const lights = makeLights(root, quality);
  const rays = makeGodRays(quality.godrays);
  interior.add(rays);

  const decorations = new THREE.Group();
  decorations.name = "decorations";
  interior.add(decorations);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 0.82, 0);
  controls.minDistance = 2.6;
  controls.maxDistance = 6.2;
  controls.minAzimuthAngle = -0.72;
  controls.maxAzimuthAngle = 0.72;
  controls.minPolarAngle = Math.PI / 2 - 0.42;
  controls.maxPolarAngle = Math.PI / 2 + 0.18;
  controls.enablePan = false;
  controls.update();

  let lastInteract = performance.now();
  controls.addEventListener("start", () => { lastInteract = performance.now(); });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (quality.bloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.55, 0.82);
    composer.addPass(bloom);
  }
  composer.addPass(new ShaderPass(VIGNETTE_SHADER));
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labels.setSize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  return {
    scene, camera, renderer, composer, controls, labels,
    uniforms, quality, lights, rays, waterSurface,
    interior, decorations, rocks, sand,
    lastInteract: () => lastInteract,
    markInteract: () => { lastInteract = performance.now(); },
    resize,
  };
}

function buildRoom(root, tex) {
  const wood = new THREE.MeshStandardMaterial({
    map: tex.woodDiff,
    normalMap: tex.woodNor,
    roughnessMap: tex.woodRough,
    roughness: 0.62,
    metalness: 0.02,
    color: 0x8a6a4a,
  });
  // cabinet body
  const cab = new THREE.Mesh(new THREE.BoxGeometry(TANK.w + 0.28, 0.92, TANK.d + 0.28), wood);
  cab.position.set(0, -0.46, 0.02);
  cab.castShadow = true;
  cab.receiveShadow = true;
  root.add(cab);
  // plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(TANK.w + 0.36, 0.08, TANK.d + 0.36), wood);
  plinth.position.set(0, -0.96, 0.02);
  root.add(plinth);
  // drawer hints
  const darkWood = wood.clone();
  darkWood.color = new THREE.Color(0x6a4e36);
  for (const x of [-1.05, 0, 1.05]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.04), darkWood);
    d.position.set(x, -0.38, TANK.d / 2 + 0.16);
    root.add(d);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(x, -0.38, TANK.d / 2 + 0.2);
    root.add(knob);
  }
  // room floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.0;
  floor.receiveShadow = true;
  root.add(floor);
  // back wall and side walls of the room
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.92 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), wallMat);
  back.position.set(0, 2.0, -TANK.d / 2 - 0.55);
  root.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-TANK.w / 2 - 1.6, 2.0, 0);
  root.add(left);
  const right = left.clone();
  right.position.x = TANK.w / 2 + 1.6;
  right.rotation.y = -Math.PI / 2;
  root.add(right);
  // ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.4;
  root.add(ceil);
}

function makeSand() {
  const g = new THREE.PlaneGeometry(TANK.w - 0.04, TANK.d - 0.04, 80, 40);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const h =
      Math.sin(x * 2.1) * 0.03 +
      Math.cos(y * 3.3) * 0.02 +
      Math.sin(x * 5.2 + y * 4.0) * 0.015;
    const edge = Math.max(Math.abs(x) / (TANK.w / 2), Math.abs(y) / (TANK.d / 2));
    pos.setZ(i, h + (edge > 0.86 ? (edge - 0.86) * 0.2 : 0));
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = TANK.sand;
  mesh.receiveShadow = true;
  return mesh;
}

function makeRocks(tex, uniforms) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.rockDiff,
    normalMap: tex.rockNor,
    roughnessMap: tex.rockRough,
    roughness: 0.85,
    metalness: 0.02,
    color: 0xbbb09f,
  });
  applyUnderwater(mat, uniforms);
  const rng = mulberry(1337);
  const spots = [
    [-1.55, -0.45, 0.55, 0.32],
    [1.7, 0.35, 0.62, 0.38],
    [1.35, -0.5, 0.4, 0.22],
    [-1.9, 0.4, 0.36, 0.2],
    [0.2, -0.62, 0.28, 0.16],
    [-0.7, 0.55, 0.22, 0.14],
  ];
  for (const [x, z, rx, ry] of spots) {
    const geo = rockGeo(rng, rx, ry);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, TANK.sand + ry * 0.35, z);
    m.rotation.y = rng() * Math.PI;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

function rockGeo(rng, rx, ry) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const s = 0.72 + 0.38 * fbm3(n.x * 2.2 + rng(), n.y * 2.2, n.z * 2.2);
    v.multiply(new THREE.Vector3(rx, ry, rx * 0.85)).multiplyScalar(s);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  boxProjectUv(g);
  return g;
}

function boxProjectUv(geo) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    if (ny >= nx && ny >= nz) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (nx >= nz) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function makeWaterSurface() {
  const g = new THREE.PlaneGeometry(TANK.w - 0.05, TANK.d - 0.05, 48, 24);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vView;
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(position.x * 3.2 + uTime * 1.4) * 0.012 + sin(position.y * 4.1 - uTime * 1.1) * 0.01;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vView;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uNight;
      void main() {
        vec3 V = normalize(vView);
        vec3 N = normalize(vec3(
          sin(vWorld.x * 6.0 + uTime * 1.6) * 0.12,
          1.0,
          cos(vWorld.z * 5.0 - uTime * 1.2) * 0.12
        ));
        float fres = pow(1.0 - abs(dot(N, V)), 3.0);
        vec3 water = mix(vec3(0.07, 0.32, 0.42), vec3(0.03, 0.08, 0.14), uNight);
        vec3 highlight = mix(vec3(0.75, 0.9, 1.0), vec3(0.4, 0.55, 0.7), uNight);
        vec3 col = mix(water, highlight, fres);
        float glitter = pow(max(dot(N, normalize(vec3(0.2, 0.9, 0.4))), 0.0), 80.0);
        col += highlight * glitter * (1.0 - uNight * 0.5);
        float alpha = 0.18 + fres * 0.55;
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = TANK.water;
  mesh.renderOrder = 3;
  return mesh;
}

function makeGlass(quality) {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe8f2,
    metalness: 0,
    roughness: 0.04,
    transmission: quality.software ? 0 : 0.55,
    thickness: 0.08,
    ior: 1.5,
    transparent: true,
    opacity: quality.software ? 0.14 : 0.28,
    envMapIntensity: 1.4,
    depthWrite: false,
  });
  const t = TANK.glass;
  const w = TANK.w, h = TANK.h, d = TANK.d;
  const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
  front.position.set(0, h / 2, d / 2);
  const left = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), mat);
  left.position.set(-w / 2, h / 2, 0);
  const right = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), mat);
  right.position.set(w / 2, h / 2, 0);
  // skip back (opaque backdrop) and mostly skip top so we see the water surface
  group.add(front, left, right);
  group.renderOrder = 4;
  return group;
}

function makeFrame() {
  const group = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.45, metalness: 0.35 });
  const w = TANK.w, h = TANK.h, d = TANK.d;
  const thick = 0.055, depth = 0.07;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, thick, depth), black);
  top.position.set(0, h + thick / 2, d / 2 + 0.01);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, thick, depth), black);
  bot.position.set(0, -thick / 2 + 0.01, d / 2 + 0.01);
  const l = new THREE.Mesh(new THREE.BoxGeometry(thick, h + thick * 2, depth), black);
  l.position.set(-w / 2 - thick / 2 + 0.01, h / 2, d / 2 + 0.01);
  const r = l.clone();
  r.position.x = w / 2 + thick / 2 - 0.01;
  group.add(top, bot, l, r);
  // hood
  const hood = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.12), black);
  hood.position.set(0, h + 0.07, 0);
  group.add(hood);
  return group;
}

function makeLights(root, quality) {
  const hemi = new THREE.HemisphereLight(0x9ad4e8, 0x3a2a18, 0.45);
  root.add(hemi);
  const room = new THREE.PointLight(0xffe0b8, 4, 12, 2);
  room.position.set(-2.6, 2.6, 3.2);
  root.add(room);
  const sun = new THREE.DirectionalLight(0xcfefff, 2.1);
  sun.position.set(0.4, 4.2, 2.4);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 12;
  sun.shadow.camera.left = -3;
  sun.shadow.camera.right = 3;
  sun.shadow.camera.top = 3;
  sun.shadow.camera.bottom = -3;
  sun.shadow.bias = -0.0008;
  root.add(sun);
  // aquarium hood light
  const hood = new THREE.SpotLight(0xd8f0ff, 28, 8, Math.PI / 3.2, 0.55, 1.1);
  hood.position.set(0, TANK.h + 0.05, 0.1);
  hood.target.position.set(0, 0.2, 0);
  hood.castShadow = quality.shadows && !quality.mobile;
  root.add(hood);
  root.add(hood.target);
  const fill = new THREE.PointLight(0x7ec8d4, 3.5, 6, 1.6);
  fill.position.set(0, 1.4, 0.2);
  root.add(fill);
  return { hemi, room, sun, hood, fill };
}

function makeGodRays(n) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uNight;
      uniform float uGain;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        float beam = smoothstep(1.0, 0.0, x);
        beam = pow(beam, 1.6);
        beam *= smoothstep(1.0, 0.05, vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        beam *= 0.7 + 0.3 * sin(uTime * 0.7 + vUv.y * 8.0);
        vec3 col = mix(vec3(0.65, 0.85, 1.0), vec3(0.35, 0.5, 0.8), uNight);
        float a = beam * mix(0.28, 0.12, uNight) * uGain;
        gl_FragColor = vec4(col, a);
      }`,
  });
  for (let i = 0; i < n; i++) {
    const w = 0.28 + (i % 3) * 0.08;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, TANK.water - 0.05), mat);
    const x = -1.6 + (i / Math.max(1, n - 1)) * 3.2;
    mesh.position.set(x, TANK.water / 2, (i % 2 === 0 ? 0.15 : -0.2));
    mesh.rotation.y = (i - n / 2) * 0.06;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  group.userData.mat = mat;
  return group;
}

export function setDayNight(world, nightT) {
  world.uniforms.uNight.value = nightT;
  world.waterSurface.material.uniforms.uNight.value = nightT;
  if (world.rays.userData.mat) world.rays.userData.mat.uniforms.uNight.value = nightT;
  const L = world.lights;
  L.sun.intensity = THREE.MathUtils.lerp(2.1, 0.35, nightT);
  L.hood.intensity = THREE.MathUtils.lerp(28, 10, nightT);
  L.hood.color.set(nightT > 0.5 ? 0xa8c4ff : 0xd8f0ff);
  L.fill.intensity = THREE.MathUtils.lerp(3.5, 1.2, nightT);
  L.room.intensity = THREE.MathUtils.lerp(4, 1.1, nightT);
  L.hemi.intensity = THREE.MathUtils.lerp(0.45, 0.18, nightT);
  world.scene.background.copy(
    new THREE.Color(0x0a0d10).lerp(new THREE.Color(0x05060a), nightT)
  );
  world.uniforms.uWaterColor.value.set(nightT > 0.5 ? 0x061828 : 0x0a4a62);
  world.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.12, 0.92, nightT);
}

export function updateCameraIdle(world, now, dt) {
  const idle = now - world.lastInteract() > 2200;
  if (idle) {
    const t = now * 0.00015;
    world.controls.azimuthAngle = world.controls.getAzimuthalAngle() + Math.sin(t) * 0.00015;
    // use setAzimuthal? OrbitControls has no setter; rotate via spherical
    const off = new THREE.Vector3().subVectors(world.camera.position, world.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t) * 0.04 * dt);
    world.camera.position.copy(world.controls.target).add(off);
  }
  world.controls.update();
}

export function updateWorldTime(world, t, nightT) {
  world.uniforms.uTime.value = t;
  world.waterSurface.material.uniforms.uTime.value = t;
  if (world.rays.userData.mat) {
    world.rays.userData.mat.uniforms.uTime.value = t;
  }
  setDayNight(world, nightT);
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
function fbm3(x, y, z) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    v += a * (0.5 + 0.5 * Math.sin(x) * Math.cos(y) * Math.sin(z + x * 0.3));
    x *= 2.03; y *= 2.07; z *= 1.97; a *= 0.5;
  }
  return v;
}
