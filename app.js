import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// RNG
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randRange = (rng, a, b) => a + (b - a) * rng();
const randInt = (rng, a, b) => Math.floor(randRange(rng, a, b + 1));

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x98b3d1, 0.0022);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);
const controls = new PointerLockControls(camera, renderer.domElement);
camera.position.set(0, 2, 5);

const ui = document.getElementById('ui');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');
const densitySlider = document.getElementById('density');
const densityVal = document.getElementById('densityVal');
const toggleDayBtn = document.getElementById('toggleDay');
const weatherSel = document.getElementById('weather');

startBtn.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => ui.classList.add('hidden'));
controls.addEventListener('unlock', () => ui.classList.remove('hidden'));

// Invert horizontal mouse look (left/right) only: compensate yaw after controls update
// PointerLockControls applies yaw: -movementX * 0.002 * pointerSpeed
// We add +2x to flip the net effect to +movementX * 0.002 * pointerSpeed
// Avoid affecting pitch (up/down)
document.addEventListener('mousemove', (e) => {
  if (!controls.isLocked) return;
  const k = 0.002 * (controls.pointerSpeed ?? 1);
  controls.getObject().rotation.y += 2 * e.movementX * k;
}, { passive: true });

// Lights
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x334455, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(100, 200, 80);
scene.add(sun);
scene.background = new THREE.Color(0x83a6cf);
let isNight = false;
let weatherMode = 'clear';
let rainSystem = null;

function setDayNight(night) {
  isNight = night;
  if (night) {
    scene.background.set(0x0b1020);
    scene.fog.color.set(0x0b1020);
    hemi.intensity = 0.2;
    sun.intensity = 0.15;
  } else {
    scene.background.set(0x83a6cf);
    scene.fog.color.set(0x98b3d1);
    hemi.intensity = 0.7;
    sun.intensity = 1.2;
  }
  if (city?.materials) {
    city.materials.building.emissiveIntensity = night ? 0.7 : 0.12;
  }
}

function setWeather(mode) {
  weatherMode = mode;
  const baseFog = isNight ? 0x0b1020 : 0x98b3d1;
  scene.fog.color.set(baseFog);
  scene.fog.density = (mode === 'clear') ? 0.0018 : (mode === 'foggy') ? 0.006 : 0.003;
  if (rainSystem) {
    scene.remove(rainSystem.points);
    rainSystem.points.geometry?.dispose?.();
    rainSystem.points.material?.dispose?.();
    rainSystem = null;
  }
  if (mode === 'rain') {
    const count = 9000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const area = 260; // keep near camera for visibility
    for (let i = 0; i < count; i++) {
      pos[i*3+0] = (Math.random() - 0.5) * area;
      pos[i*3+1] = Math.random() * 120 + 20;
      pos[i*3+2] = (Math.random() - 0.5) * area;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaad5ff,
      size: 3.0, // pixel size (since sizeAttenuation is false)
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    rainSystem = { points, count };
  }
}

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ color: 0x365a43, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI/2;
scene.add(ground);

// Movement
const keys = { w:false,a:false,s:false,d:false,shift:false,q:false,e:false };
const SPEED = 18, SPRINT = 34, FRICTION = 8;
let speed = 0;

function updateMovement(dt) {
  const forward = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  // Invert left/right strafing
  const right = (keys.d ? -1 : 0) + (keys.a ? 1 : 0);
  const target = (keys.shift ? SPRINT : SPEED) * (forward || right ? 1 : 0);
  speed += (target - speed) * Math.min(1, dt * (target > speed ? 6 : FRICTION));

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0; dir.normalize();
  const r = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).negate();
  const vel = new THREE.Vector3()
    .addScaledVector(dir, forward)
    .addScaledVector(r, right)
    .normalize()
    .multiplyScalar(speed * dt || 0);

  const obj = controls.getObject();
  // Vertical free-fly via E/Q
  vel.y += ((keys.e ? 1 : 0) + (keys.q ? -1 : 0)) * (keys.shift ? SPRINT : SPEED) * 0.6 * dt;
  obj.position.add(vel);
  obj.position.y = Math.min(220, Math.max(1.5, obj.position.y));
}

addEventListener('keydown', e => {
  if (e.code === 'KeyW') keys.w = true;
  if (e.code === 'KeyA') keys.a = true;
  if (e.code === 'KeyS') keys.s = true;
  if (e.code === 'KeyD') keys.d = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
  if (e.code === 'KeyE') keys.e = true;
  if (e.code === 'KeyQ') keys.q = true;
  if (e.code === 'KeyR') regenerate();
  if (e.code === 'KeyN') setDayNight(!isNight);
});
addEventListener('keyup', e => {
  if (e.code === 'KeyW') keys.w = false;
  if (e.code === 'KeyA') keys.a = false;
  if (e.code === 'KeyS') keys.s = false;
  if (e.code === 'KeyD') keys.d = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
  if (e.code === 'KeyE') keys.e = false;
  if (e.code === 'KeyQ') keys.q = false;
});

// Textures
function makeFacadeTexture({ rng, w = 256, h = 256, cols = 8, rows = 16, base = '#7b8aa0' }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2000; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random()*0.02})`;
    g.fillRect(Math.random()*w, Math.random()*h, 1, 1);
  }
  const padX = 10, padY = 10;
  const cellW = (w - padX*2) / cols;
  const cellH = (h - padY*2) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const x = padX + c2 * cellW + 2;
      const y = padY + r * cellH + 2;
      const ww = cellW - 4, hh = cellH - 4;
      const lit = Math.random() < 0.3;
      const shade = lit ? (isNight ? 1.0 : 0.35) : (isNight ? 0.1 : 0.12);
      g.fillStyle = `rgba(200,220,255,${shade})`;
      g.fillRect(x, y, ww, hh);
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(x, y + hh*0.65, ww, hh*0.35);
    }
  }
  const tx = new THREE.CanvasTexture(c);
  tx.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 8);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

function makeRoadTexture() {
  const w = 512, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f35'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random()*0.02})`;
    g.fillRect(Math.random()*w, Math.random()*h, 1, 1);
  }
  g.strokeStyle = '#e6e6e6';
  g.lineWidth = 6; g.setLineDash([24, 24]);
  g.beginPath(); g.moveTo(0, h/2); g.lineTo(w, h/2); g.stroke();
  const tx = new THREE.CanvasTexture(c);
  tx.wrapS = THREE.RepeatWrapping; tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(10, 1);
  return tx;
}

// City
let city = null;
let buildingDensity = 1.0;

function createCity(seed = Math.floor(Math.random()*1e9)) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();

  const config = {
    blocksX: 12,
    blocksZ: 12,
    blockSize: 70,
  roadWidth: 36, // wider roads so lanes are well within
    lotPadding: 4,
    buildingCountEstimate: Math.round(12 * buildingDensity),
    densityFactor: buildingDensity,
    laneOffset: 6.0, // keep lanes centered within wider roads
    parkChance: 0.14,
  };

  const citySizeX = config.blocksX * config.blockSize;
  const citySizeZ = config.blocksZ * config.blockSize;

  // Roads
  const roadMat = new THREE.MeshStandardMaterial({
    map: makeRoadTexture(), color: 0xffffff, roughness: 0.95, metalness: 0.0
  });
  const roadGeoH = new THREE.PlaneGeometry(citySizeX + config.blockSize, config.roadWidth);
  const roadGeoV = new THREE.PlaneGeometry(config.roadWidth, citySizeZ + config.blockSize);
  const roadGroup = new THREE.Group();
  for (let zi = 0; zi <= config.blocksZ; zi++) {
    const z = zi * config.blockSize - citySizeZ/2;
    const m = new THREE.Mesh(roadGeoH, roadMat); m.rotation.x = -Math.PI/2; m.position.z = z;
    roadGroup.add(m);
  }
  for (let xi = 0; xi <= config.blocksX; xi++) {
    const x = xi * config.blockSize - citySizeX/2;
    const m = new THREE.Mesh(roadGeoV, roadMat); m.rotation.x = -Math.PI/2; m.position.x = x;
    roadGroup.add(m);
  }
  group.add(roadGroup);

  // Sidewalks
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 1, metalness: 0 });
  for (let bx = 0; bx < config.blocksX; bx++) {
    for (let bz = 0; bz < config.blocksZ; bz++) {
      const cx = bx * config.blockSize - citySizeX/2 + config.blockSize/2;
      const cz = bz * config.blockSize - citySizeZ/2 + config.blockSize/2;
      const side = new THREE.Mesh(
        new THREE.PlaneGeometry(config.blockSize - 2, config.blockSize - 2),
        sidewalkMat
      );
      side.rotation.x = -Math.PI/2;
      side.position.set(cx, 0.02, cz);
      group.add(side);
    }
  }

  // Parks and Buildings (instanced)
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const facadeTex = makeFacadeTexture({
    rng, cols: randInt(rng, 6, 10), rows: randInt(rng, 12, 20),
    base: ['#7c8ea5','#8aa0b8','#6f8197','#7a8fab'][randInt(rng,0,3)]
  });
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: facadeTex, roughness: 0.85, metalness: 0.05,
    emissive: new THREE.Color(0xaab8ff), emissiveMap: facadeTex, emissiveIntensity: isNight ? 0.7 : 0.12
  });
  const totalEst = config.blocksX * config.blocksZ * config.buildingCountEstimate;
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, totalEst);
  buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const treesGroup = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8);
  const leafGeo = new THREE.SphereGeometry(1.2, 10, 10);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7b5a3e, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 1 });

  let idx = 0;
  const temp = new THREE.Object3D();

  for (let bx = 0; bx < config.blocksX; bx++) {
    for (let bz = 0; bz < config.blocksZ; bz++) {
      const blockMinX = bx*config.blockSize - citySizeX/2 + config.roadWidth/2 + config.lotPadding;
      const blockMaxX = (bx+1)*config.blockSize - citySizeX/2 - config.roadWidth/2 - config.lotPadding;
      const blockMinZ = bz*config.blockSize - citySizeZ/2 + config.roadWidth/2 + config.lotPadding;
      const blockMaxZ = (bz+1)*config.blockSize - citySizeZ/2 - config.roadWidth/2 - config.lotPadding;

      // Decide if this block is a park
      const isPark = rng() < config.parkChance;
      if (isPark) {
        const park = new THREE.Mesh(
          new THREE.PlaneGeometry((blockMaxX - blockMinX) * 0.92, (blockMaxZ - blockMinZ) * 0.92),
          new THREE.MeshStandardMaterial({ color: 0x3e7f56, roughness: 1 })
        );
        park.rotation.x = -Math.PI/2;
        park.position.set((blockMinX + blockMaxX)/2, 0.03, (blockMinZ + blockMaxZ)/2);
        group.add(park);
        // add a few trees
        const treeCount = randInt(rng, 6, 14);
        for (let t = 0; t < treeCount; t++) {
          const tx = randRange(rng, blockMinX + 2, blockMaxX - 2);
          const tz = randRange(rng, blockMinZ + 2, blockMaxZ - 2);
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.set(tx, 1.1, tz);
          treesGroup.add(trunk);
          const leaves = new THREE.Mesh(leafGeo, leafMat);
          leaves.position.set(tx, 2.4, tz);
          treesGroup.add(leaves);
        }
        continue; // skip buildings on park blocks
      }

      let lots = randInt(rng, 8, 18);
      lots = Math.max(2, Math.round(lots * config.densityFactor));
      for (let i = 0; i < lots; i++) {
        if (idx >= totalEst) break;
        const x = randRange(rng, blockMinX, blockMaxX);
        const z = randRange(rng, blockMinZ, blockMaxZ);
        const footprint = randRange(rng, 8, 16);
        const depth = randRange(rng, 8, 16);
        const h = Math.pow(randRange(rng, 0.2, 1.0), 1.8) * randRange(rng, 20, 150);

        temp.position.set(x, h/2, z);
        temp.scale.set(footprint, h, depth);
        temp.rotation.y = randRange(rng, -0.07, 0.07);
        temp.updateMatrix();
        buildings.setMatrixAt(idx++, temp.matrix);
      }
    }
  }
  buildings.count = idx;
  group.add(buildings);
  group.add(treesGroup);

  // Cars (body + roof + wheels)
  const carCount = Math.min(160, Math.floor((config.blocksX + config.blocksZ) * 6));
  const bodyGeo = new THREE.BoxGeometry(1.8, 0.8, 3.6);
  const roofGeo = new THREE.BoxGeometry(1.4, 0.5, 1.8);
  roofGeo.translate(0, 0.65, 0);
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
  wheelGeo.rotateZ(Math.PI/2);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.15, metalness: 1.0, transparent: true, opacity: 0.7 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0, metalness: 0.2 });
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, carCount);
  const roofMesh = new THREE.InstancedMesh(roofGeo, glassMat, carCount);
  const wheelMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, carCount * 4);
  bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  roofMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(bodyMesh, roofMesh, wheelMesh);

  const lanes = [];
  for (let zi = 0; zi <= config.blocksZ; zi++) {
    const z = zi * config.blockSize - citySizeZ/2;
    lanes.push({ axis: 'x', z: z - config.laneOffset, dir: 1 });
    lanes.push({ axis: 'x', z: z + config.laneOffset, dir: -1 });
  }
  for (let xi = 0; xi <= config.blocksX; xi++) {
    const x = xi * config.blockSize - citySizeX/2;
    lanes.push({ axis: 'z', x: x - config.laneOffset, dir: 1 });
    lanes.push({ axis: 'z', x: x + config.laneOffset, dir: -1 });
  }

  const cars = [];
  for (let i = 0; i < carCount; i++) {
    const lane = lanes[randInt(rng, 0, lanes.length - 1)];
    const color = new THREE.Color().setHSL(randRange(rng, 0, 1), 0.6, 0.5);
    const speed = randRange(rng, 12, 26);
    const length = (lane.axis === 'x') ? citySizeX + config.blockSize : citySizeZ + config.blockSize;
    const t0 = randRange(rng, 0, 1);
    cars.push({ lane, color, speed, t: t0, length });
    bodyMesh.setColorAt(i, color);
  }
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;

  return {
    group,
    config,
    buildings,
    carsMeshes: { bodyMesh, roofMesh, wheelMesh },
    cars,
    lanes,
    materials: { building: buildingMat, road: roadMat, sidewalk: sidewalkMat, carBody: bodyMat, carGlass: glassMat, carWheel: wheelMat },
    seed
  };
}

function disposeCity(c) {
  if (!c) return;
  scene.remove(c.group);
  c.group.traverse(obj => {
    obj.geometry?.dispose?.();
    const m = obj.material;
    if (Array.isArray(m)) m.forEach(mm => mm.dispose?.());
    else m?.dispose?.();
  });
  Object.values(c.materials).forEach(m => {
    m.map?.dispose?.();
    m.emissiveMap?.dispose?.();
  });
}

function regenerate(seed) {
  const s = seed ?? Math.floor(Math.random()*1e9);
  disposeCity(city);
  city = createCity(s);
  scene.add(city.group);
  hud.textContent = `Cars: ${city.cars.length} • Blocks: ${city.config.blocksX * city.config.blocksZ} • Seed: ${city.seed}`;
}

// Animate
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  updateMovement(dt);
  updateTraffic(dt);
  if (rainSystem) {
    const pos = rainSystem.points.geometry.getAttribute('position');
    for (let i = 0; i < rainSystem.count; i++) {
  let y = pos.getY(i) - 140 * dt; // faster fall for visibility
  if (y < -10) y = Math.random() * 120 + 80;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    // Keep rain around the camera so it stays visible
    rainSystem.points.position.set(camera.position.x, 0, camera.position.z);
  }
  const t = performance.now() * 0.00005;
  sun.position.set(Math.cos(t) * 150, 200 + Math.sin(t) * 50, Math.sin(t) * 150);
  renderer.render(scene, camera);
}

function updateTraffic(dt) {
  if (!city) return;
  const tmp = new THREE.Object3D();
  const { bodyMesh, roofMesh, wheelMesh } = city.carsMeshes;
  for (let i = 0; i < city.cars.length; i++) {
    const car = city.cars[i];
    car.t = (car.t + (car.speed * dt) / car.length) % 1;
    const pos = car.t * (car.length) - (car.length/2);
    if (car.lane.axis === 'x') {
      const x = car.lane.dir > 0 ? pos : -pos;
      const z = car.lane.z;
      tmp.position.set(x, 0.6, z);
      // Geometry faces +Z by default, so rotate -/+90deg to face +X/-X
      tmp.rotation.y = car.lane.dir > 0 ? -Math.PI/2 : Math.PI/2;
    } else {
      const z = car.lane.dir > 0 ? pos : -pos;
      const x = car.lane.x;
      tmp.position.set(x, 0.6, z);
      // Along Z lanes, face +Z/-Z (0 or 180deg)
      tmp.rotation.y = car.lane.dir > 0 ? 0 : Math.PI;
    }
    tmp.updateMatrix();
    bodyMesh.setMatrixAt(i, tmp.matrix);
    roofMesh.setMatrixAt(i, tmp.matrix);
    const wheelOffsets = [
      new THREE.Vector3(-0.8, -0.25, 1.3),
      new THREE.Vector3(0.8, -0.25, 1.3),
      new THREE.Vector3(-0.8, -0.25, -1.3),
      new THREE.Vector3(0.8, -0.25, -1.3),
    ];
    for (let w = 0; w < 4; w++) {
      const off = wheelOffsets[w].clone();
      off.applyAxisAngle(new THREE.Vector3(0,1,0), tmp.rotation.y);
      const wheel = new THREE.Object3D();
      wheel.position.copy(tmp.position).add(off);
      wheel.rotation.y = tmp.rotation.y;
      wheel.updateMatrix();
      wheelMesh.setMatrixAt(i*4 + w, wheel.matrix);
    }
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  roofMesh.instanceMatrix.needsUpdate = true;
  wheelMesh.instanceMatrix.needsUpdate = true;
}

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Wire UI
densitySlider?.addEventListener('input', () => {
  densityVal.textContent = `${Number(densitySlider.value).toFixed(1)}x`;
});
densitySlider?.addEventListener('change', () => {
  buildingDensity = Number(densitySlider.value);
  regenerate(city?.seed);
});
toggleDayBtn?.addEventListener('click', () => setDayNight(!isNight));
weatherSel?.addEventListener('change', () => setWeather(weatherSel.value));

// Boot
regenerate();
setWeather('clear');
animate();
