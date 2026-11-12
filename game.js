import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const $ = (id) => document.getElementById(id);
const canvas = $("gameCanvas");
const arena = $("arena");
const minimap = $("minimapCanvas");
const minimapContext = minimap.getContext("2d");
const messageBanner = $("messageBanner");
const weaponSelect = $("weaponSelect");
const weaponValue = $("weaponValue");
const healthValue = $("healthValue");
const shieldValue = $("shieldValue");
const healthBar = $("healthBar");
const shieldBar = $("shieldBar");
const aliveCount = $("aliveCount");
const killsCount = $("killsCount");
const zoneValue = $("zoneValue");
const avatarNameInput = $("avatarName");
const avatarColorInput = $("avatarColor");
const avatarStyleSelect = $("avatarStyle");

function getWeaponCatalog() {
  const legacySource = $("legacyGameCode").textContent;
  const start = legacySource.indexOf("const weaponCatalog = [");
  const end = legacySource.indexOf("const state = {", start);
  if (start < 0 || end < 0) {
    throw new Error("The existing weapon catalog could not be loaded.");
  }

  const catalogSource = legacySource.slice(start, end);
  const mockDocument = { createElement: () => ({}) };
  const mockSelect = { append() {} };
  const weapons = new Function(
    "document",
    "weaponSelectEl",
    `${catalogSource}\nreturn weaponCatalog;`
  )(mockDocument, mockSelect);
  if (weapons.length !== 200) {
    throw new Error(`Expected 200 weapons but loaded ${weapons.length}.`);
  }
  return weapons;
}

const weaponCatalog = getWeaponCatalog();
weaponCatalog.forEach((weapon, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = `${index + 1}. ${weapon.name} — ${weapon.type}`;
  weaponSelect.append(option);
});

const scene = new THREE.Scene();
scene.background = new THREE.Color("#91a99f");
scene.fog = new THREE.FogExp2("#91a99f", 0.009);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
} catch (error) {
  messageBanner.textContent = "3D graphics are unavailable in this browser.";
  throw new Error("Arena Royale needs WebGL support to render the 3D game.", {
    cause: error,
  });
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const camera = new THREE.PerspectiveCamera(76, 1, 0.08, 180);
scene.add(camera);

const hemisphereLight = new THREE.HemisphereLight("#e3f4ea", "#465640", 2.1);
scene.add(hemisphereLight);
const sun = new THREE.DirectionalLight("#fff0d3", 3.2);
sun.position.set(-25, 45, -18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.bias = -0.00015;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);
const scenery = new THREE.Group();
world.add(scenery);

const MAP_WIDTH = 90;
const MAP_DEPTH = 56;
const HALF_WIDTH = MAP_WIDTH / 2;
const HALF_DEPTH = MAP_DEPTH / 2;
const mapFeatures = [
  { x: 74, y: 82, width: 142, height: 82, type: "building", label: "FUEL DEPOT" },
  { x: 670, y: 82, width: 146, height: 92, type: "building", label: "RADAR BASE" },
  { x: 66, y: 396, width: 148, height: 88, type: "building", label: "OLD QUARRY" },
  { x: 680, y: 390, width: 144, height: 94, type: "building", label: "GREENHOUSE" },
  { x: 380, y: 76, width: 118, height: 64, type: "building", label: "LOOKOUT" },
  { x: 300, y: 222, width: 72, height: 30, type: "container" },
  { x: 520, y: 310, width: 78, height: 30, type: "container" },
  { x: 294, y: 404, width: 62, height: 48, type: "rock" },
  { x: 544, y: 104, width: 58, height: 45, type: "rock" },
  { x: 236, y: 286, width: 42, height: 40, type: "rock" },
  { x: 638, y: 274, width: 48, height: 42, type: "rock" },
  { x: 390, y: 448, width: 48, height: 40, type: "rock" },
  { x: 486, y: 180, width: 36, height: 44, type: "tree" },
  { x: 148, y: 250, width: 36, height: 44, type: "tree" },
  { x: 756, y: 246, width: 36, height: 44, type: "tree" },
];
const vehicleStarts = [
  { x: 450, y: 190, angle: -Math.PI / 2, color: "#bd594a" },
  { x: 490, y: 346, angle: Math.PI / 2, color: "#497f98" },
  { x: 612, y: 278, angle: 0, color: "#b79b4d" },
];
const chestStarts = [
  { x: 258, y: 172 },
  { x: 586, y: 188 },
  { x: 286, y: 352 },
  { x: 616, y: 352 },
  { x: 454, y: 492 },
  { x: 818, y: 306 },
];
const obstacles = [];
const blockerMeshes = [];
const enemies = [];
const vehicles = [];
const chests = [];
const enemyProjectiles = [];
const grenades = [];
const tracers = [];
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const keys = new Set();
const state = {
  running: true,
  yaw: 0,
  pitch: 0,
  aiming: false,
  thirdPerson: false,
  kills: 0,
  elapsed: 0,
  zoneRadius: 26,
  zoneStartRadius: 26,
  zoneEndRadius: 8,
  zoneShrinkStart: 10,
  zoneShrinkDuration: 150,
  selectedWeapon: 0,
  ammo: 0,
  reserveAmmo: 0,
  reloadTimer: 0,
  shotCooldown: 0,
  grenadeCount: 3,
  audio: null,
};
const player = {
  position: new THREE.Vector3(0, 0, 0),
  velocity: new THREE.Vector3(),
  health: 100,
  armor: 35,
  jumpVelocity: 0,
  grounded: true,
  vehicle: null,
  callsign: "Rookie",
  color: "#4de2a5",
  silhouette: "scout",
  body: null,
  weaponModel: null,
};
let playerNameSprite;
let stormRing;

function worldPoint(x, z) {
  return new THREE.Vector3(x, terrainHeight(x, z), z);
}

function mapPoint(x, y) {
  return new THREE.Vector2(x / 10 - HALF_WIDTH, y / 10 - HALF_DEPTH);
}

function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.105) * 0.19 +
    Math.cos(z * 0.13) * 0.16 +
    Math.sin((x + z) * 0.058) * 0.12
  );
}

function seededNoise(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createGroundTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 512;
  textureCanvas.height = 512;
  const context = textureCanvas.getContext("2d");
  const random = seededNoise(42);
  context.fillStyle = "#526847";
  context.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 14500; i += 1) {
    const hue = 72 + Math.floor(random() * 28);
    const lightness = 23 + Math.floor(random() * 24);
    context.fillStyle = `hsla(${hue}, 21%, ${lightness}%, ${0.08 + random() * 0.3})`;
    const size = 1 + random() * 4;
    context.fillRect(random() * 512, random() * 512, size, size * 0.7);
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function standardMaterial(color, roughness = 0.88, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

const groundMaterial = new THREE.MeshStandardMaterial({
  map: createGroundTexture(),
  roughness: 1,
  color: "#b1bd9b",
});
const concreteMaterial = standardMaterial("#77776a");
const darkConcreteMaterial = standardMaterial("#494e49");
const roofMaterial = standardMaterial("#585d52");
const glassMaterial = new THREE.MeshStandardMaterial({
  color: "#8eb2ad",
  roughness: 0.2,
  metalness: 0.18,
  transparent: true,
  opacity: 0.72,
});

function addMesh(geometry, material, parent = scenery, position = null) {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBox(parent, width, height, depth, material, x, y, z) {
  const mesh = addMesh(
    new THREE.BoxGeometry(width, height, depth),
    material,
    parent,
    new THREE.Vector3(x, y, z)
  );
  return mesh;
}

function createGround() {
  const geometry = new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH, 90, 56);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, terrainHeight(positions.getX(i), -positions.getZ(i)));
  }
  geometry.computeVertexNormals();
  const ground = addMesh(geometry, groundMaterial);
  ground.receiveShadow = true;

  const roadMaterial = standardMaterial("#77735f", 0.97);
  const roadLineMaterial = standardMaterial("#b9aa78", 0.95);
  const roadA = addMesh(
    new THREE.PlaneGeometry(6.6, MAP_DEPTH + 3),
    roadMaterial,
    scenery,
    new THREE.Vector3(-0.2, 0.12, 0)
  );
  roadA.rotation.x = -Math.PI / 2;
  roadA.rotation.z = -0.05;
  const roadB = addMesh(
    new THREE.PlaneGeometry(MAP_WIDTH + 3, 5.4),
    roadMaterial,
    scenery,
    new THREE.Vector3(0, 0.14, 0.1)
  );
  roadB.rotation.x = -Math.PI / 2;
  roadB.rotation.z = 0.035;

  for (let x = -44; x <= 44; x += 2.7) {
    const mark = addMesh(
      new THREE.PlaneGeometry(1.05, 0.12),
      roadLineMaterial,
      scenery,
      new THREE.Vector3(x, 0.18, 0.1)
    );
    mark.rotation.x = -Math.PI / 2;
    mark.rotation.z = 0.035;
  }

  const river = addMesh(
    new THREE.PlaneGeometry(74, 2.1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: "#36767a",
      roughness: 0.2,
      metalness: 0.16,
      transparent: true,
      opacity: 0.8,
    }),
    scenery,
    new THREE.Vector3(-8.5, 0.2, -9.4)
  );
  river.rotation.x = -Math.PI / 2;
  river.rotation.z = -0.3;
  river.receiveShadow = false;

  const shore = addMesh(
    new THREE.PlaneGeometry(75, 4.2),
    standardMaterial("#8a8864", 1),
    scenery,
    new THREE.Vector3(-8.5, 0.13, -9.4)
  );
  shore.rotation.x = -Math.PI / 2;
  shore.rotation.z = -0.3;
  river.position.y = 0.2;
  shore.position.y = 0.14;

  const boundaryMaterial = standardMaterial("#39483d");
  for (const [x, z, width, depth] of [
    [0, -HALF_DEPTH - 0.6, MAP_WIDTH + 2, 1.2],
    [0, HALF_DEPTH + 0.6, MAP_WIDTH + 2, 1.2],
    [-HALF_WIDTH - 0.6, 0, 1.2, MAP_DEPTH + 2],
    [HALF_WIDTH + 0.6, 0, 1.2, MAP_DEPTH + 2],
  ]) {
    addBox(scenery, width, 2, depth, boundaryMaterial, x, 0.65, z);
    obstacles.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  }
}

function addBuilding(feature) {
  const [center] = [mapPoint(feature.x + feature.width / 2, feature.y + feature.height / 2)];
  const width = feature.width / 10;
  const depth = feature.height / 10;
  const height = feature.label === "LOOKOUT" ? 4.8 : 3.7;
  const group = new THREE.Group();
  group.position.set(center.x, terrainHeight(center.x, center.y), center.y);
  scenery.add(group);

  const wallMat = standardMaterial(feature.label === "GREENHOUSE" ? "#6d796a" : "#726f62");
  const wall = addBox(group, width, height, depth, wallMat, 0, height / 2, 0);
  wall.castShadow = true;
  const roof = addBox(group, width + 0.34, 0.38, depth + 0.34, roofMaterial, 0, height + 0.14, 0);
  roof.material = roofMaterial;

  const roofTrim = standardMaterial("#797b6b");
  for (const [x, z, w, d] of [
    [0, -depth / 2 - 0.12, width + 0.3, 0.14],
    [0, depth / 2 + 0.12, width + 0.3, 0.14],
    [-width / 2 - 0.12, 0, 0.14, depth],
    [width / 2 + 0.12, 0, 0.14, depth],
  ]) {
    addBox(group, w, 0.32, d, roofTrim, x, height + 0.47, z);
  }

  const windowRows = Math.max(1, Math.floor(width / 2.2));
  for (let i = 0; i < windowRows; i += 1) {
    const windowX = -width * 0.38 + (i / Math.max(1, windowRows - 1)) * width * 0.76;
    const window = addBox(group, 0.62, 0.72, 0.08, glassMaterial, windowX, 2.05, depth / 2 + 0.045);
    window.castShadow = false;
    if (i % 2 === 0) {
      addBox(group, 0.07, 0.82, 0.12, darkConcreteMaterial, windowX, 2.05, depth / 2 + 0.11);
    }
  }

  const door = addBox(group, 0.9, 1.8, 0.12, darkConcreteMaterial, 0, 0.9, depth / 2 + 0.08);
  door.castShadow = false;
  obstacles.push({
    minX: center.x - width / 2 - 0.25,
    maxX: center.x + width / 2 + 0.25,
    minZ: center.y - depth / 2 - 0.25,
    maxZ: center.y + depth / 2 + 0.25,
  });
  blockerMeshes.push(wall, roof);

  if (feature.label === "RADAR BASE") {
    const tower = new THREE.Group();
    tower.position.set(width * 0.35, height, 0);
    group.add(tower);
    const mast = addBox(tower, 0.16, 5.6, 0.16, darkConcreteMaterial, 0, 2.8, 0);
    addBox(tower, 2.7, 0.12, 0.12, concreteMaterial, 0, 4.5, 0);
    const dish = addMesh(
      new THREE.SphereGeometry(0.82, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      standardMaterial("#a6aaa0", 0.55, { metalness: 0.35 }),
      tower,
      new THREE.Vector3(0, 4.55, 0.18)
    );
    dish.rotation.x = Math.PI / 2;
    blockerMeshes.push(mast);
  }
}

function addContainer(feature) {
  const point = mapPoint(feature.x + feature.width / 2, feature.y + feature.height / 2);
  const width = feature.width / 10;
  const depth = feature.height / 10;
  const group = new THREE.Group();
  group.position.set(point.x, terrainHeight(point.x, point.y), point.y);
  scenery.add(group);
  const body = addBox(group, width, 1.15, depth, standardMaterial("#596d50"), 0, 0.6, 0);
  const ribMaterial = standardMaterial("#84916a");
  for (let x = -width / 2 + 0.24; x < width / 2; x += 0.62) {
    addBox(group, 0.08, 1.2, depth + 0.08, ribMaterial, x, 0.6, 0);
  }
  obstacles.push({
    minX: point.x - width / 2,
    maxX: point.x + width / 2,
    minZ: point.y - depth / 2,
    maxZ: point.y + depth / 2,
  });
  blockerMeshes.push(body);
}

function addRock(feature) {
  const point = mapPoint(feature.x + feature.width / 2, feature.y + feature.height / 2);
  const radius = Math.max(feature.width, feature.height) / 22;
  const geometry = new THREE.DodecahedronGeometry(radius, 1);
  geometry.scale(1.25, 0.8, 0.92);
  const rock = addMesh(
    geometry,
    standardMaterial("#74796a", 0.98),
    scenery,
    new THREE.Vector3(point.x, terrainHeight(point.x, point.y) + radius * 0.55, point.y)
  );
  obstacles.push({
    minX: point.x - radius * 1.3,
    maxX: point.x + radius * 1.3,
    minZ: point.y - radius,
    maxZ: point.y + radius,
  });
  blockerMeshes.push(rock);
}

function addTree(feature) {
  const point = mapPoint(feature.x + feature.width / 2, feature.y + feature.height / 2);
  const groundY = terrainHeight(point.x, point.y);
  const group = new THREE.Group();
  group.position.set(point.x, groundY, point.y);
  scenery.add(group);
  const trunk = addMesh(
    new THREE.CylinderGeometry(0.16, 0.24, 2.1, 7),
    standardMaterial("#574938"),
    group,
    new THREE.Vector3(0, 1.05, 0)
  );
  const leafMaterial = standardMaterial("#365b3b", 0.98);
  addMesh(new THREE.ConeGeometry(1.05, 2.2, 8), leafMaterial, group, new THREE.Vector3(0, 2.15, 0));
  addMesh(new THREE.ConeGeometry(0.78, 1.8, 8), standardMaterial("#496b42"), group, new THREE.Vector3(0, 3.0, 0));
  obstacles.push({
    minX: point.x - 0.7,
    maxX: point.x + 0.7,
    minZ: point.y - 0.7,
    maxZ: point.y + 0.7,
  });
  blockerMeshes.push(trunk);
}

function buildScenery() {
  createGround();
  for (const feature of mapFeatures) {
    if (feature.type === "building") addBuilding(feature);
    else if (feature.type === "container") addContainer(feature);
    else if (feature.type === "tree") addTree(feature);
    else addRock(feature);
  }

  for (let i = 0; i < 85; i += 1) {
    const x = (seededNoise(i + 8)() - 0.5) * 84;
    const z = (seededNoise(i + 78)() - 0.5) * 50;
    if (obstacles.some((item) => x > item.minX - 1 && x < item.maxX + 1 && z > item.minZ - 1 && z < item.maxZ + 1)) continue;
    const tuft = addMesh(
      new THREE.ConeGeometry(0.04, 0.35, 3),
      standardMaterial("#879267"),
      scenery,
      worldPoint(x, z).add(new THREE.Vector3(0, 0.14, 0))
    );
    tuft.rotation.z = (i % 4) * 0.08;
    tuft.castShadow = false;
  }
}

function createHumanoid(color, silhouette = "scout", isPlayer = false) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.04,
  });
  const dark = standardMaterial("#303b3b", 0.8);
  const skin = standardMaterial("#c7b39d", 0.8);
  const vest = standardMaterial("#424b42", 0.94);
  const torsoWidth = silhouette === "vanguard" ? 0.78 : silhouette === "recon" ? 0.54 : 0.65;

  const torso = addMesh(
    new THREE.CapsuleGeometry(torsoWidth / 2, 0.75, 4, 8),
    vest,
    group,
    new THREE.Vector3(0, 1.25, 0)
  );
  torso.scale.z = 0.62;
  const chestPlate = addMesh(
    new THREE.BoxGeometry(torsoWidth * 0.75, 0.42, 0.14),
    suit,
    group,
    new THREE.Vector3(0, 1.46, -0.27)
  );
  chestPlate.rotation.x = -0.08;

  const head = addMesh(
    new THREE.SphereGeometry(0.27, 16, 12),
    skin,
    group,
    new THREE.Vector3(0, 2.02, 0)
  );
  head.scale.y = 1.14;
  addMesh(
    new THREE.SphereGeometry(0.275, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    dark,
    group,
    new THREE.Vector3(0, 2.12, 0)
  );
  const visor = addMesh(
    new THREE.BoxGeometry(0.36, 0.1, 0.2),
    standardMaterial("#6e9593", 0.26, { metalness: 0.22 }),
    group,
    new THREE.Vector3(0, 2.08, -0.24)
  );
  visor.castShadow = false;

  const legGeometry = new THREE.CapsuleGeometry(0.13, 0.56, 4, 7);
  const leftLeg = addMesh(legGeometry, dark, group, new THREE.Vector3(-0.19, 0.48, 0));
  const rightLeg = addMesh(legGeometry, dark, group, new THREE.Vector3(0.19, 0.48, 0));
  const armGeometry = new THREE.CapsuleGeometry(0.105, 0.54, 4, 7);
  const leftArm = addMesh(armGeometry, suit, group, new THREE.Vector3(-0.43, 1.3, -0.02));
  const rightArm = addMesh(armGeometry, suit, group, new THREE.Vector3(0.43, 1.3, -0.08));
  leftArm.rotation.z = -0.16;
  rightArm.rotation.z = 0.16;

  const backpack = addMesh(
    new THREE.BoxGeometry(0.38, 0.55, 0.24),
    vest,
    group,
    new THREE.Vector3(0, 1.28, 0.28)
  );
  backpack.castShadow = true;

  if (isPlayer) {
    group.userData = { torso, leftLeg, rightLeg, leftArm, rightArm, visor };
  }
  return group;
}

function createPlayerNameSprite(text) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const context = labelCanvas.getContext("2d");
  context.fillStyle = "rgba(10, 18, 20, .74)";
  context.beginPath();
  context.roundRect(4, 5, 248, 54, 18);
  context.fill();
  context.font = "700 26px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#eff8f2";
  context.fillText(text.slice(0, 16), 128, 33);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

function makeGunModel(color) {
  const group = new THREE.Group();
  const metal = standardMaterial("#303638", 0.42, { metalness: 0.55 });
  const polymer = standardMaterial(color || "#525952", 0.7);
  addBox(group, 0.16, 0.18, 0.58, polymer, 0, 0, -0.08);
  addBox(group, 0.12, 0.1, 0.48, metal, 0, 0.045, -0.47);
  addBox(group, 0.055, 0.055, 0.62, metal, 0, 0.02, -0.98);
  addBox(group, 0.12, 0.23, 0.14, polymer, 0, -0.17, 0.06);
  addBox(group, 0.12, 0.07, 0.21, metal, 0, -0.07, -0.27);
  addBox(group, 0.07, 0.18, 0.07, metal, 0, 0.16, -0.21);
  addBox(group, 0.045, 0.11, 0.045, metal, 0, 0.2, -0.66);
  return group;
}

function createPlayer() {
  player.position.copy(worldPoint(0, 0));
  player.body = createHumanoid(player.color, player.silhouette, true);
  player.body.position.copy(player.position);
  world.add(player.body);

  player.weaponModel = makeGunModel("#424a42");
  player.weaponModel.position.set(0.3, -0.26, -0.58);
  camera.add(player.weaponModel);

  playerNameSprite = createPlayerNameSprite(player.callsign);
  playerNameSprite.position.set(0, 2.8, 0);
  player.body.add(playerNameSprite);
  updateAvatar();

  stormRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.075, 8, 128),
    new THREE.MeshBasicMaterial({ color: "#91ffcf", transparent: true, opacity: 0.9 })
  );
  stormRing.rotation.x = Math.PI / 2;
  stormRing.position.y = 0.12;
  world.add(stormRing);
}

function updateAvatar() {
  player.callsign = avatarNameInput.value.trim().slice(0, 16) || "Rookie";
  player.color = avatarColorInput.value;
  player.silhouette = ["scout", "vanguard", "recon"].includes(avatarStyleSelect.value)
    ? avatarStyleSelect.value
    : "scout";
  if (player.body) {
    player.body.traverse((object) => {
      if (object.isMesh && object.material.color?.getHex() === 0x4de2a5) {
        object.material.color.set(player.color);
      }
    });
    player.body.remove(playerNameSprite);
    playerNameSprite?.material.map.dispose();
    playerNameSprite?.material.dispose();
    playerNameSprite = createPlayerNameSprite(player.callsign);
    playerNameSprite.position.set(0, 2.8, 0);
    player.body.add(playerNameSprite);
  }
  if (player.weaponModel) {
    player.weaponModel.traverse((object) => {
      if (object.isMesh && object.material.color?.getHex() === 0x424a42) {
        object.material.color.set(player.color);
      }
    });
  }
}

function addBuildingLabel(name, x, z) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 96;
  const context = labelCanvas.getContext("2d");
  context.font = "800 42px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillStyle = "rgba(8, 14, 12, 0.76)";
  context.fillRect(0, 15, 512, 66);
  context.fillStyle = "#e8ead7";
  context.fillText(name, 256, 60);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.position.set(x, 8, z);
  sprite.scale.set(8, 1.5, 1);
  scenery.add(sprite);
}

function buildVehicles() {
  for (const start of vehicleStarts) {
    const point = mapPoint(start.x, start.y);
    const group = new THREE.Group();
    group.position.set(point.x, terrainHeight(point.x, point.y), point.y);
    group.rotation.y = -start.angle;
    world.add(group);

    const paint = standardMaterial(start.color, 0.36, { metalness: 0.3 });
    addBox(group, 1.8, 0.7, 3.5, paint, 0, 0.62, 0);
    addBox(group, 1.48, 0.66, 1.55, glassMaterial, 0, 1.23, -0.18);
    addBox(group, 1.82, 0.15, 1.3, darkConcreteMaterial, 0, 0.98, 0.82);
    addBox(group, 0.18, 0.22, 0.48, standardMaterial("#d4c8a4"), 0.72, 0.75, -1.58);
    addBox(group, 0.18, 0.22, 0.48, standardMaterial("#bc5747"), -0.72, 0.75, -1.58);
    const wheelMat = standardMaterial("#232726", 0.95);
    for (const x of [-0.95, 0.95]) {
      for (const z of [-1.12, 1.12]) {
        const wheel = addMesh(
          new THREE.CylinderGeometry(0.39, 0.39, 0.22, 12),
          wheelMat,
          group,
          new THREE.Vector3(x, 0.4, z)
        );
        wheel.rotation.z = Math.PI / 2;
      }
    }
    const vehicle = {
      group,
      position: new THREE.Vector3(point.x, terrainHeight(point.x, point.y), point.y),
      angle: -start.angle,
      startPosition: new THREE.Vector3(point.x, terrainHeight(point.x, point.y), point.y),
      startAngle: -start.angle,
      color: start.color,
      speed: 10,
      radius: 1.5,
    };
    vehicles.push(vehicle);
  }
}

function buildChests() {
  const gold = standardMaterial("#c99438", 0.48, { metalness: 0.3 });
  const trim = standardMaterial("#eed276", 0.38, { metalness: 0.4 });
  for (const start of chestStarts) {
    const point = mapPoint(start.x, start.y);
    const group = new THREE.Group();
    group.position.set(point.x, terrainHeight(point.x, point.y), point.y);
    world.add(group);
    addBox(group, 1.08, 0.62, 0.74, gold, 0, 0.38, 0);
    addBox(group, 1.12, 0.12, 0.78, trim, 0, 0.7, 0);
    addBox(group, 0.1, 0.46, 0.8, trim, 0, 0.4, 0);
    const glow = new THREE.PointLight("#ffc768", 1.2, 4.5, 2);
    glow.position.set(0, 1.3, 0);
    group.add(glow);
    chests.push({ position: new THREE.Vector3(point.x, 0, point.y), group, opened: false, glow });
  }
}

function spawnEnemy(index) {
  const angle = (index / 12) * Math.PI * 2 + Math.random() * 0.4;
  const distance = 14 + Math.random() * 13;
  let x = Math.sin(angle) * distance;
  let z = Math.cos(angle) * distance;
  for (let attempt = 0; attempt < 30 && isBlocked(x, z, 0.7); attempt += 1) {
    x = (Math.random() - 0.5) * 78;
    z = (Math.random() - 0.5) * 46;
  }

  const colors = ["#9f5447", "#6d7782", "#84724d", "#54705f", "#635a71"];
  const body = createHumanoid(colors[index % colors.length], ["scout", "vanguard", "recon"][index % 3]);
  const bot = {
    body,
    position: new THREE.Vector3(x, terrainHeight(x, z), z),
    velocity: new THREE.Vector3(),
    health: 100,
    armor: index % 3 === 0 ? 20 : 0,
    speed: 2.4 + Math.random() * 0.65,
    fireTimer: 0.4 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
    alive: true,
  };
  body.position.copy(bot.position);
  world.add(body);
  enemies.push(bot);
}

function addDust(position, count = 8, color = "#c5b88e") {
  const material = new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 0.75 });
  const points = [];
  for (let i = 0; i < count; i += 1) {
    points.push(position.x + (Math.random() - 0.5), position.y + Math.random() * 1.1, position.z + (Math.random() - 0.5));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const particles = new THREE.Points(geometry, material);
  world.add(particles);
  setTimeout(() => {
    world.remove(particles);
    geometry.dispose();
    material.dispose();
  }, 650);
}

function addTracer(start, end, color = "#ffd26d") {
  const geometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geometry, material);
  world.add(line);
  tracers.push({ line, life: 0.1 });
}

function showMessage(message, duration = 1.7) {
  messageBanner.textContent = message;
  messageBanner.dataset.timer = String(duration);
  messageBanner.classList.remove("flash");
}

function addAudio() {
  if (state.audio) {
    if (state.audio.context.state === "suspended") state.audio.context.resume();
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededNoise(781);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (random() * 2 - 1) * 0.15;
  }
  const ambience = context.createBufferSource();
  ambience.buffer = buffer;
  ambience.loop = true;
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 350;
  const ambienceGain = context.createGain();
  ambienceGain.gain.value = 0.08;
  ambience.connect(lowpass).connect(ambienceGain).connect(context.destination);
  ambience.start();
  state.audio = { context, buffer, ambience };
}

function playShotSound() {
  if (!state.audio) addAudio();
  const audio = state.audio;
  if (!audio || audio.context.state !== "running") return;
  const context = audio.context;
  const weapon = weaponCatalog[state.selectedWeapon];
  const source = context.createBufferSource();
  source.buffer = audio.buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = weapon.type.includes("Sniper") ? 520 : weapon.type.includes("Shotgun") ? 780 : 1150;
  filter.Q.value = 0.7;
  const gain = context.createGain();
  gain.gain.setValueAtTime(weapon.type.includes("Sniper") ? 0.42 : 0.2, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.11);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  source.stop(context.currentTime + 0.12);
}

function updateHUD() {
  const weapon = weaponCatalog[state.selectedWeapon];
  $("healthValue").textContent = String(Math.max(0, Math.round(player.health)));
  $("shieldValue").textContent = String(Math.max(0, Math.round(player.armor)));
  $("healthBar").style.width = `${THREE.MathUtils.clamp(player.health, 0, 100)}%`;
  $("shieldBar").style.width = `${THREE.MathUtils.clamp((player.armor / 35) * 100, 0, 100)}%`;
  weaponValue.textContent = `${state.reloadTimer > 0 ? "RELOADING" : weapon.name} · ${state.ammo}/${state.reserveAmmo}`;
  weaponValue.title = `${weapon.type}: ${weapon.description}`;
  weaponSelect.value = String(state.selectedWeapon);
  aliveCount.textContent = String(enemies.filter((enemy) => enemy.alive).length + 1);
  killsCount.textContent = String(state.kills);
  const zonePercent = Math.round((state.zoneRadius / state.zoneStartRadius) * 100);
  zoneValue.textContent = `${zonePercent}%`;
}

function selectWeapon(index) {
  if (!Number.isInteger(index) || index < 0 || index >= weaponCatalog.length) return;
  state.selectedWeapon = index;
  const weapon = weaponCatalog[index];
  state.ammo = weapon.ammo;
  state.reserveAmmo = weapon.reserveAmmo;
  state.shotCooldown = 0;
  state.reloadTimer = 0;
  rebuildFirstPersonGun();
  showMessage(`${weapon.name} equipped`, 1.1);
  updateHUD();
}

function rebuildFirstPersonGun() {
  if (!player.weaponModel) return;
  camera.remove(player.weaponModel);
  player.weaponModel.traverse((object) => {
    if (object.isMesh) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
  const color = weaponCatalog[state.selectedWeapon].color;
  player.weaponModel = makeGunModel(color);
  camera.add(player.weaponModel);
}

function reload() {
  const weapon = weaponCatalog[state.selectedWeapon];
  if (state.reloadTimer > 0 || state.ammo >= weapon.magSize || state.reserveAmmo <= 0) return;
  state.reloadTimer = weapon.reloadTime || 1.25;
  showMessage("Reloading", state.reloadTimer);
  if (state.audio) {
    const oscillator = state.audio.context.createOscillator();
    const gain = state.audio.context.createGain();
    oscillator.frequency.value = 175;
    gain.gain.setValueAtTime(0.06, state.audio.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audio.context.currentTime + 0.16);
    oscillator.connect(gain).connect(state.audio.context.destination);
    oscillator.start();
    oscillator.stop(state.audio.context.currentTime + 0.17);
  }
}

function fireWeapon() {
  if (!state.running || state.reloadTimer > 0 || state.shotCooldown > 0 || player.vehicle) return;
  if (state.ammo <= 0) {
    reload();
    return;
  }

  const weapon = weaponCatalog[state.selectedWeapon];
  state.ammo -= 1;
  state.shotCooldown = weapon.fireCooldown;
  playShotSound();

  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const spreadFactor = weapon.type === "Shotgun" ? 0.024 : weapon.type.includes("Sniper") ? 0.001 : 0.006;
  const hitTargets = new Set();
  let tracerEnd = origin.clone().addScaledVector(direction, 75);

  for (let shot = 0; shot < weapon.bulletsPerShot; shot += 1) {
    const shotDirection = direction.clone();
    shotDirection.x += (Math.random() - 0.5) * spreadFactor;
    shotDirection.y += (Math.random() - 0.5) * spreadFactor;
    shotDirection.z += (Math.random() - 0.5) * spreadFactor;
    shotDirection.normalize();
    raycaster.set(origin, shotDirection);
    raycaster.far = 75;

    const intersections = raycaster.intersectObjects([...blockerMeshes, ...enemies.filter((enemy) => enemy.alive).map((enemy) => enemy.body)], true);
    let impact = null;
    if (intersections.length > 0) {
      const nearest = intersections[0];
      impact = nearest.point;
      const hitEnemy = enemies.find((enemy) => enemy.alive && isDescendantOf(nearest.object, enemy.body));
      if (hitEnemy) hitTargets.add(hitEnemy);
    }
    if (shot === 0 && impact) tracerEnd = impact.clone();
    if (weapon.bulletsPerShot > 1 && impact) addDust(impact, 3, "#dfc38b");
  }

  for (const enemy of hitTargets) {
    const damage = weapon.damage * (weapon.type === "Shotgun" ? 1 : 1);
    enemy.health -= damage;
    addDust(enemy.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 6, "#bb514b");
    if (enemy.health <= 0) eliminateEnemy(enemy, true);
  }

  addTracer(origin.clone().addScaledVector(direction, 0.65), tracerEnd, weapon.color);
  if (state.ammo === 0 && state.reserveAmmo > 0) reload();
  updateHUD();
}

function isDescendantOf(object, parent) {
  let current = object;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
}

function eliminateEnemy(enemy, byPlayer) {
  if (!enemy.alive) return;
  enemy.alive = false;
  world.remove(enemy.body);
  if (byPlayer) {
    state.kills += 1;
    if (Math.random() < 0.62) spawnLooseLoot(enemy.position);
    showMessage("Rival eliminated", 1.2);
  }
  updateHUD();
}

function spawnLooseLoot(position) {
  const itemIndex = Math.floor(Math.random() * 3);
  const colors = ["#61df90", "#6dbbec", "#ffd26d"];
  const item = addMesh(
    new THREE.BoxGeometry(0.45, 0.45, 0.45),
    standardMaterial(colors[itemIndex], 0.35, { emissive: colors[itemIndex], emissiveIntensity: 0.18 }),
    world,
    position.clone().add(new THREE.Vector3(0, 0.4, 0))
  );
  item.userData = { type: ["medkit", "armor", "ammo"][itemIndex], pulse: Math.random() * 6 };
  looseItems.push(item);
}

const looseItems = [];

function isBlocked(x, z, radius = 0.45, ignoredVehicle = null) {
  if (x < -HALF_WIDTH + radius || x > HALF_WIDTH - radius || z < -HALF_DEPTH + radius || z > HALF_DEPTH - radius) {
    return true;
  }
  if (obstacles.some((obstacle) =>
    x + radius > obstacle.minX &&
    x - radius < obstacle.maxX &&
    z + radius > obstacle.minZ &&
    z - radius < obstacle.maxZ
  )) return true;
  return vehicles.some((vehicle) =>
    vehicle !== ignoredVehicle &&
    Math.hypot(x - vehicle.position.x, z - vehicle.position.z) < radius + vehicle.radius * 0.58
  );
}

function tryMove(position, dx, dz, radius = 0.45, ignoredVehicle = null) {
  const nextX = position.x + dx;
  if (!isBlocked(nextX, position.z, radius, ignoredVehicle)) position.x = nextX;
  const nextZ = position.z + dz;
  if (!isBlocked(position.x, nextZ, radius, ignoredVehicle)) position.z = nextZ;
  position.y = terrainHeight(position.x, position.z);
}

function updatePlayer(dt) {
  if (player.vehicle) {
    updateDriving(dt);
    return;
  }

  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const desired = new THREE.Vector3();
  if (keys.has("KeyW")) desired.add(forward);
  if (keys.has("KeyS")) desired.sub(forward);
  if (keys.has("KeyD")) desired.add(right);
  if (keys.has("KeyA")) desired.sub(right);
  if (desired.lengthSq() > 0) desired.normalize();

  const speed = keys.has("ShiftLeft") ? 7.2 : 5.1;
  const acceleration = desired.multiplyScalar(speed);
  player.velocity.x = THREE.MathUtils.damp(player.velocity.x, acceleration.x, 11, dt);
  player.velocity.z = THREE.MathUtils.damp(player.velocity.z, acceleration.z, 11, dt);
  tryMove(player.position, player.velocity.x * dt, player.velocity.z * dt);

  if (!player.grounded) {
    player.jumpVelocity -= 18 * dt;
    player.position.y += player.jumpVelocity * dt;
    const ground = terrainHeight(player.position.x, player.position.z);
    if (player.position.y <= ground) {
      player.position.y = ground;
      player.jumpVelocity = 0;
      player.grounded = true;
    }
  }

  player.body.position.copy(player.position);
  player.body.rotation.y = state.yaw;
  animateHumanoid(player.body, state.elapsed, desired.lengthSq() > 0 && player.grounded);
}

function updateDriving(dt) {
  const vehicle = player.vehicle;
  const direction = keys.has("KeyW") ? 1 : keys.has("KeyS") ? -0.55 : 0;
  const steering = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  vehicle.angle += steering * dt * 1.5 * (direction < 0 ? -1 : 1);
  vehicle.speed = THREE.MathUtils.damp(vehicle.speed, direction * 11, 3.5, dt);
  const dx = -Math.sin(vehicle.angle) * vehicle.speed * dt;
  const dz = -Math.cos(vehicle.angle) * vehicle.speed * dt;
  const candidate = vehicle.position.clone();
  tryMove(candidate, dx, dz, 1.25, vehicle);
  if (!isBlocked(candidate.x, candidate.z, 1.25, vehicle)) vehicle.position.copy(candidate);
  vehicle.group.position.set(vehicle.position.x, terrainHeight(vehicle.position.x, vehicle.position.z), vehicle.position.z);
  vehicle.group.rotation.y = vehicle.angle;
  player.position.copy(vehicle.position);
  player.position.y = terrainHeight(player.position.x, player.position.z);
  if (Math.abs(vehicle.speed) > 2.5) addDust(player.position, 1, "#9a9075");
}

function animateHumanoid(body, time, moving) {
  const data = body.userData;
  if (!data?.leftLeg) return;
  const swing = moving ? Math.sin(time * 10) * 0.42 : 0;
  data.leftLeg.rotation.x = swing;
  data.rightLeg.rotation.x = -swing;
  data.leftArm.rotation.x = -swing * 0.45;
  data.rightArm.rotation.x = swing * 0.45;
}

function updateCamera(dt) {
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const target = player.position.clone();
  if (!player.vehicle && state.thirdPerson) {
    const desiredPosition = target.clone()
      .addScaledVector(forward, -5.3)
      .add(new THREE.Vector3(0, 2.55, 0));
    const lookTarget = target.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(forward, 1.5);
    camera.position.lerp(desiredPosition, 1 - Math.exp(-7 * dt));
    camera.lookAt(lookTarget);
    player.body.visible = true;
    player.weaponModel.visible = false;
  } else if (player.vehicle) {
    const behind = new THREE.Vector3(
      -Math.sin(player.vehicle.angle),
      0,
      -Math.cos(player.vehicle.angle)
    );
    camera.position.lerp(
      player.position.clone().addScaledVector(behind, -7).add(new THREE.Vector3(0, 3.5, 0)),
      1 - Math.exp(-5 * dt)
    );
    camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 0.9, 0)));
    player.body.visible = false;
    player.weaponModel.visible = false;
  } else {
    camera.position.set(player.position.x, player.position.y + (player.grounded ? 1.68 : 2.05), player.position.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(state.pitch, state.yaw, 0);
    player.body.visible = false;
    player.weaponModel.visible = true;
    const weapon = weaponCatalog[state.selectedWeapon];
    const bob = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
    const bobAmount = bob ? Math.sin(state.elapsed * 9) * 0.018 : 0;
    player.weaponModel.position.set(state.aiming ? 0.1 : 0.3, (state.aiming ? -0.21 : -0.27) + bobAmount, state.aiming ? -0.42 : -0.58);
    player.weaponModel.rotation.set(0, 0, Math.sin(state.elapsed * 6) * (bob ? 0.012 : 0));
    const targetFov = state.aiming ? 48 : 76;
    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 10, dt);
    camera.updateProjectionMatrix();
    if (state.reloadTimer > 0) {
      player.weaponModel.rotation.x = Math.sin(state.elapsed * 25) * 0.12;
    } else {
      player.weaponModel.rotation.x = 0;
    }
  }
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    enemy.fireTimer -= dt;
    enemy.phase += dt * 5;
    const toPlayer = player.position.clone().sub(enemy.position);
    const distance = Math.hypot(toPlayer.x, toPlayer.z);
    const direction = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();

    if (distance > 8) {
      const oldX = enemy.position.x;
      const oldZ = enemy.position.z;
      tryMove(enemy.position, direction.x * enemy.speed * dt, direction.z * enemy.speed * dt, 0.42);
      if (oldX === enemy.position.x && oldZ === enemy.position.z) {
        const side = new THREE.Vector3(-direction.z, 0, direction.x);
        tryMove(enemy.position, side.x * enemy.speed * dt, side.z * enemy.speed * dt, 0.42);
      }
    }

    enemy.position.y = terrainHeight(enemy.position.x, enemy.position.z);
    enemy.body.position.copy(enemy.position);
    enemy.body.rotation.y = Math.atan2(-direction.x, -direction.z);
    animateHumanoid(enemy.body, state.elapsed + enemy.phase, distance > 8);

    if (distance < 24 && enemy.fireTimer <= 0) {
      enemy.fireTimer = 1.1 + Math.random() * 1.2;
      const start = enemy.position.clone().add(new THREE.Vector3(0, 1.42, 0));
      const target = player.position.clone().add(new THREE.Vector3(0, player.vehicle ? 1.1 : 1.2, 0));
      const velocity = target.sub(start).normalize().multiplyScalar(22);
      const projectile = addMesh(
        new THREE.SphereGeometry(0.075, 8, 8),
        new THREE.MeshBasicMaterial({ color: "#ff765f" }),
        world,
        start.clone()
      );
      enemyProjectiles.push({ mesh: projectile, velocity, life: 2.2 });
      addTracer(start, start.clone().addScaledVector(velocity.clone().normalize(), 0.8), "#ff765f");
    }
  }
}

function damagePlayer(amount) {
  const absorbed = Math.min(player.armor, amount * 0.65);
  player.armor -= absorbed;
  player.health -= amount - absorbed;
  addDust(player.position.clone().add(new THREE.Vector3(0, 1, 0)), 4, "#bb514b");
  if (player.health <= 0) finishMatch(false);
  updateHUD();
}

function updateEnemyProjectiles(dt) {
  for (let index = enemyProjectiles.length - 1; index >= 0; index -= 1) {
    const projectile = enemyProjectiles[index];
    projectile.mesh.position.addScaledVector(projectile.velocity, dt);
    projectile.life -= dt;
    const target = player.position.clone().add(new THREE.Vector3(0, player.vehicle ? 1 : 1.15, 0));
    if (projectile.mesh.position.distanceTo(target) < (player.vehicle ? 1.15 : 0.65)) {
      damagePlayer(8 + Math.random() * 5);
      world.remove(projectile.mesh);
      enemyProjectiles.splice(index, 1);
      continue;
    }
    if (projectile.life <= 0 || projectile.mesh.position.y < terrainHeight(projectile.mesh.position.x, projectile.mesh.position.z)) {
      world.remove(projectile.mesh);
      enemyProjectiles.splice(index, 1);
    }
  }
}

function throwGrenade() {
  if (state.grenadeCount <= 0 || player.vehicle) {
    showMessage(player.vehicle ? "Exit the vehicle to throw a grenade" : "No grenades left", 1);
    return;
  }
  state.grenadeCount -= 1;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const mesh = addMesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    standardMaterial("#465249", 0.45, { metalness: 0.32 }),
    world,
    camera.position.clone().addScaledVector(direction, 0.65)
  );
  grenades.push({
    mesh,
    velocity: direction.multiplyScalar(13).add(new THREE.Vector3(0, 4.2, 0)),
    fuse: 1.3,
  });
  showMessage(`Grenade thrown · ${state.grenadeCount} remaining`, 1.1);
}

function updateGrenades(dt) {
  for (let index = grenades.length - 1; index >= 0; index -= 1) {
    const grenade = grenades[index];
    grenade.fuse -= dt;
    grenade.velocity.y -= 9.8 * dt;
    grenade.mesh.position.addScaledVector(grenade.velocity, dt);
    const floor = terrainHeight(grenade.mesh.position.x, grenade.mesh.position.z) + 0.16;
    if (grenade.mesh.position.y < floor) {
      grenade.mesh.position.y = floor;
      grenade.velocity.y *= -0.38;
      grenade.velocity.x *= 0.72;
      grenade.velocity.z *= 0.72;
    }
    if (grenade.fuse <= 0) {
      const center = grenade.mesh.position.clone();
      addDust(center, 28, "#ffc66d");
      for (const enemy of enemies) {
        if (enemy.alive && enemy.position.distanceTo(center) < 6.5) {
          enemy.health -= 70;
          if (enemy.health <= 0) eliminateEnemy(enemy, true);
        }
      }
      if (player.position.distanceTo(center) < 4.5) damagePlayer(18);
      world.remove(grenade.mesh);
      grenades.splice(index, 1);
    }
  }
}

function openChest() {
  if (player.vehicle) {
    showMessage("Exit the vehicle to search a chest", 1);
    return;
  }
  let nearest = null;
  let distance = 2.2;
  for (const chest of chests) {
    if (chest.opened) continue;
    const d = Math.hypot(chest.position.x - player.position.x, chest.position.z - player.position.z);
    if (d < distance) {
      nearest = chest;
      distance = d;
    }
  }
  if (!nearest) {
    showMessage("No unopened chest nearby", 1);
    return;
  }

  nearest.opened = true;
  nearest.group.rotation.x = -0.3;
  nearest.glow.intensity = 0.15;
  const weaponIndex = Math.floor(Math.random() * weaponCatalog.length);
  selectWeapon(weaponIndex);
  const gear = Math.floor(Math.random() * 4);
  let gearName;
  if (gear === 0) {
    player.health = Math.min(100, player.health + 30);
    gearName = "medkit";
  } else if (gear === 1) {
    player.armor = Math.min(35, player.armor + 20);
    gearName = "shield";
  } else if (gear === 2) {
    state.grenadeCount = Math.min(6, state.grenadeCount + 1);
    gearName = "grenade";
  } else {
    const weapon = weaponCatalog[state.selectedWeapon];
    state.reserveAmmo = Math.min(weapon.maxReserveAmmo, state.reserveAmmo + weapon.magSize);
    weapon.reserveAmmo = state.reserveAmmo;
    gearName = "ammo";
  }
  showMessage(`Supply crate: ${weaponCatalog[weaponIndex].name} + ${gearName}`, 2.2);
  updateHUD();
}

function toggleVehicle() {
  if (player.vehicle) {
    const vehicle = player.vehicle;
    const side = new THREE.Vector3(Math.cos(vehicle.angle), 0, -Math.sin(vehicle.angle));
    const exits = [
      vehicle.position.clone().addScaledVector(side, 2.4),
      vehicle.position.clone().addScaledVector(side, -2.4),
    ];
    const exit = exits.find((point) => !isBlocked(point.x, point.z, 0.45, vehicle));
    if (!exit) {
      showMessage("No room to exit here", 1);
      return;
    }
    player.position.set(exit.x, terrainHeight(exit.x, exit.z), exit.z);
    player.vehicle = null;
    player.body.visible = !state.thirdPerson;
    showMessage("Vehicle exited", 1);
    return;
  }

  let nearest = null;
  let distance = 2.5;
  for (const vehicle of vehicles) {
    const d = Math.hypot(vehicle.position.x - player.position.x, vehicle.position.z - player.position.z);
    if (d < distance) {
      nearest = vehicle;
      distance = d;
    }
  }
  if (!nearest) {
    showMessage("Move closer to a vehicle · F to enter", 1);
    return;
  }
  player.vehicle = nearest;
  state.thirdPerson = true;
  player.position.copy(nearest.position);
  showMessage("Vehicle ready · WASD to drive · F to exit", 1.5);
}

function updateStorm(dt) {
  state.elapsed += dt;
  const progress = THREE.MathUtils.clamp(
    (state.elapsed - state.zoneShrinkStart) / state.zoneShrinkDuration,
    0,
    1
  );
  state.zoneRadius = THREE.MathUtils.lerp(state.zoneStartRadius, state.zoneEndRadius, progress);
  stormRing.scale.setScalar(state.zoneRadius);
  stormRing.position.set(0, 0.13, 0);
  const distance = Math.hypot(player.position.x, player.position.z);
  if (distance > state.zoneRadius) {
    state.zoneDamageTimer = (state.zoneDamageTimer || 0) - dt;
    if (state.zoneDamageTimer <= 0) {
      damagePlayer(4);
      state.zoneDamageTimer = 0.6;
      showMessage("Outside the safe zone!", 0.8);
    }
  }
}

function finishMatch(won) {
  if (!state.running) return;
  state.running = false;
  document.exitPointerLock?.();
  messageBanner.textContent = won ? "VICTORY · LAST ONE STANDING" : "ELIMINATED · MATCH OVER";
  messageBanner.classList.add("flash");
}

function updateLooseItems(dt) {
  for (let index = looseItems.length - 1; index >= 0; index -= 1) {
    const item = looseItems[index];
    item.rotation.y += dt * 1.6;
    item.position.y = terrainHeight(item.position.x, item.position.z) + 0.55 + Math.sin(state.elapsed * 3 + index) * 0.12;
    if (item.position.distanceTo(player.position) < 1.25) {
      const type = item.userData.type;
      if (type === "medkit") player.health = Math.min(100, player.health + 20);
      else if (type === "armor") player.armor = Math.min(35, player.armor + 15);
      else {
        const weapon = weaponCatalog[state.selectedWeapon];
        state.reserveAmmo = Math.min(weapon.maxReserveAmmo, state.reserveAmmo + 20);
      }
      world.remove(item);
      item.geometry.dispose();
      item.material.dispose();
      looseItems.splice(index, 1);
      showMessage(`${type.toUpperCase()} collected`, 1);
    }
  }
}

function renderMinimap() {
  const context = minimapContext;
  const width = minimap.width;
  const height = minimap.height;
  const sx = width / MAP_WIDTH;
  const sy = height / MAP_DEPTH;
  const px = (x) => (x + HALF_WIDTH) * sx;
  const py = (z) => (z + HALF_DEPTH) * sy;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#546c4d";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#81785f";
  context.fillRect(px(-3.4), 0, 6.6 * sx, height);
  context.fillRect(0, py(-2.6), width, 5.4 * sy);
  context.strokeStyle = "#43848b";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(px(-44), py(-17));
  context.quadraticCurveTo(px(-12), py(-8), px(29), py(-2));
  context.stroke();

  for (const feature of mapFeatures) {
    const point = mapPoint(feature.x, feature.y);
    context.fillStyle = feature.type === "building" ? "#929181" : feature.type === "tree" ? "#426c42" : feature.type === "rock" ? "#97978a" : "#74815d";
    context.fillRect(px(point.x), py(point.y), Math.max(2, feature.width / 10 * sx), Math.max(2, feature.height / 10 * sy));
  }
  for (const chest of chests) {
    context.fillStyle = chest.opened ? "#87724a" : "#ffd26d";
    context.fillRect(px(chest.position.x) - 2, py(chest.position.z) - 2, 4, 4);
  }
  for (const vehicle of vehicles) {
    context.fillStyle = vehicle.color;
    context.fillRect(px(vehicle.position.x) - 3, py(vehicle.position.z) - 2, 6, 4);
  }
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    context.fillStyle = "#ff6378";
    context.beginPath();
    context.arc(px(enemy.position.x), py(enemy.position.z), 2.2, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = "rgba(145, 255, 207, .9)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(px(0), py(0), state.zoneRadius * sx, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#8cf8b7";
  context.beginPath();
  context.arc(px(player.position.x), py(player.position.z), 3.3, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#effff7";
  context.lineWidth = 1;
  context.stroke();
}

function update(dt) {
  if (!state.running) return;
  state.elapsed += dt;
  state.shotCooldown = Math.max(0, state.shotCooldown - dt);
  if (state.reloadTimer > 0) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) {
      const weapon = weaponCatalog[state.selectedWeapon];
      const needed = weapon.magSize - state.ammo;
      const amount = Math.min(needed, state.reserveAmmo);
      state.ammo += amount;
      state.reserveAmmo -= amount;
      weapon.ammo = state.ammo;
      weapon.reserveAmmo = state.reserveAmmo;
      showMessage("Reload complete", 0.9);
    }
  }

  updatePlayer(dt);
  updateCamera(dt);
  updateEnemies(dt);
  updateEnemyProjectiles(dt);
  updateGrenades(dt);
  updateLooseItems(dt);
  updateStorm(dt);

  for (let index = tracers.length - 1; index >= 0; index -= 1) {
    const tracer = tracers[index];
    tracer.life -= dt;
    tracer.line.material.opacity = Math.max(0, tracer.life / 0.1);
    if (tracer.life <= 0) {
      world.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.line.material.dispose();
      tracers.splice(index, 1);
    }
  }

  const remaining = enemies.filter((enemy) => enemy.alive).length;
  if (player.health <= 0) finishMatch(false);
  else if (remaining === 0) finishMatch(true);

  const bannerTimer = Number(messageBanner.dataset.timer || 0);
  if (bannerTimer > 0) messageBanner.dataset.timer = String(Math.max(0, bannerTimer - dt));
  updateHUD();
  renderMinimap();
}

function resize() {
  const rect = arena.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  update(dt);
  renderer.render(scene, camera);
}

function bindControls() {
  canvas.addEventListener("click", () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
      addAudio();
    } else {
      fireWeapon();
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("mousedown", (event) => {
    if (event.button === 2) {
      state.aiming = true;
      addAudio();
    }
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas || player.vehicle) return;
    state.yaw -= event.movementX * 0.00225;
    state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.0018, -1.2, 1.18);
  });
  window.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      addAudio();
      showMessage("Deployed · survive and be the last one standing", 2);
    } else {
      state.aiming = false;
    }
  });
  window.addEventListener("keydown", (event) => {
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space"].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;

    if (event.code === "KeyV") {
      state.thirdPerson = !state.thirdPerson;
      showMessage(state.thirdPerson ? "Third-person view" : "First-person view", 1);
    } else if (event.code === "KeyR") {
      reload();
    } else if (event.code === "KeyG") {
      throwGrenade();
    } else if (event.code === "KeyF") {
      toggleVehicle();
    } else if (event.code === "Enter" && ![avatarNameInput, avatarColorInput, avatarStyleSelect, weaponSelect].includes(event.target)) {
      event.preventDefault();
      openChest();
    } else if (event.code === "KeyQ") {
      selectWeapon((state.selectedWeapon - 1 + weaponCatalog.length) % weaponCatalog.length);
    } else if (event.code === "KeyE") {
      selectWeapon((state.selectedWeapon + 1) % weaponCatalog.length);
    } else if (event.code === "Space" && player.grounded && !player.vehicle) {
      player.jumpVelocity = 7.3;
      player.grounded = false;
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear();
    state.aiming = false;
  });
  weaponSelect.addEventListener("change", () => selectWeapon(Number(weaponSelect.value)));
  avatarNameInput.addEventListener("input", updateAvatar);
  avatarColorInput.addEventListener("input", updateAvatar);
  avatarStyleSelect.addEventListener("change", updateAvatar);
  $("restartButton").addEventListener("click", () => window.location.reload());
  window.addEventListener("resize", resize);
}

function buildScene() {
  buildScenery();
  buildVehicles();
  buildChests();
  createPlayer();
  for (let i = 0; i < 12; i += 1) spawnEnemy(i);
  for (const feature of mapFeatures.filter((item) => item.label)) {
    const point = mapPoint(feature.x + feature.width / 2, feature.y + feature.height / 2);
    addBuildingLabel(feature.label, point.x, point.y);
  }
  selectWeapon(0);
  updateHUD();
  renderMinimap();
}

try {
  bindControls();
  buildScene();
  resize();
  showMessage("Click the arena to deploy · V changes view", 4);
  animate();
} catch (error) {
  messageBanner.textContent = "Could not initialize the 3D match.";
  throw error;
}
