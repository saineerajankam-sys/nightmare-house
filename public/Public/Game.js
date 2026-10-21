
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

const $ = (id) => document.getElementById(id);
const lobby = $("lobby");
const game = $("game");
const message = $("message");
const canvasHost = $("gameCanvas");

let socket;
let scene, camera, renderer, clock;
let player, monster;
let roomCode = "";
let playerId = "";
let connected = false;
let caught = false;
let positioned = false;
let lastSent = 0;
let yaw = 0;
let pitch = 0;
let moveX = 0;
let moveZ = 0;
let joystickPointer = null;
let lookPointer = null;
let lastLookX = 0;
let lastLookY = 0;
const players = new Map();
const keys = {};
const playerPos = new THREE.Vector3(0, 0, 3);
const remoteData = new Map();

function send(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function setMessage(text) {
  message.textContent = text;
}

function connect() {
  if (connected) return;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener("open", () => {
    connected = true;
    const name = $("playerName").value.trim() || "Survivor";

    if (window.pendingRoom) {
      send({ type: "join", room: window.pendingRoom, name });
      window.pendingRoom = "";
    } else {
      send({
        type: "create",
        name,
        maxPlayers: Number($("playerCount").value)
      });
    }
  });

  socket.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "error") {
      setMessage(data.text);
      return;
    }

    if (data.type === "joined") {
      roomCode = data.room;
      playerId = data.playerId;
      $("currentRoom").textContent = roomCode;
      lobby.hidden = true;
      game.hidden = false;
      init3D();
      setMessage("");
      $("playerStatus").textContent = "Find a way out!";
      return;
    }

    if (data.type === "state") updateState(data);

    if (data.type === "notice") {
      $("playerStatus").textContent = data.text;
    }

    if (data.type === "caught") {
      caught = true;
      $("playerStatus").textContent = "THE MONSTER CAUGHT YOU!";
      $("respawn").hidden = false;
    }

    if (data.type === "left") {
      location.reload();
    }
  });

  socket.addEventListener("close", () => {
    connected = false;
    if (!game.hidden) {
      $("playerStatus").textContent = "Connection lost. Reload to retry.";
    }
  });

  socket.addEventListener("error", () => {
    setMessage("Could not connect. Try again.");
  });
}

$("createRoom").addEventListener("click", () => {
  window.pendingRoom = "";
  setMessage("Connecting to the house...");
  connect();
});

$("joinRoom").addEventListener("click", () => {
  const code = $("roomCode").value.trim().toUpperCase();

  if (code.length !== 5) {
    setMessage("Enter the 5-letter room code.");
    return;
  }

  window.pendingRoom = code;
  setMessage("Joining your friends...");
  connect();
});

$("leaveRoom").addEventListener("click", () => {
  send({ type: "leave" });
  if (!connected) location.reload();
});

$("respawn").addEventListener("click", () => {
  caught = false;
  $("respawn").hidden = true;
  send({ type: "respawn" });
  $("playerStatus").textContent = "Run!";
});

function material(color, roughness = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function addBox(x, y, z, w, h, d, color, parent = scene) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material(color)
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildHouse() {
  const wall = 0x302b29;
  const floor = material(0x171615);
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    floor
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.05;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // Four outer walls, with an open doorway area.
  addBox(0, 2, -12, 24, 4, 0.5, wall);
  addBox(-12, 2, 0, 0.5, 4, 24, wall);
  addBox(12, 2, 0, 0.5, 4, 24, wall);
  addBox(-5, 2, 12, 14, 4, 0.5, wall);
  addBox(10, 2, 12, 4, 4, 0.5, wall);

  // Interior partitions make corridors and rooms.
  addBox(-4, 1.5, -5, 0.3, 3, 10, 0x25211f);
  addBox(4, 1.5, 2, 0.3, 3, 9, 0x25211f);
  addBox(0, 1.5, 5, 8, 3, 0.3, 0x25211f);
  addBox(-8, 1.5, 2, 0.3, 3, 6, 0x25211f);

  // Broken furniture.
  addBox(-8, 0.5, -7, 2, 1, 1, 0x382e28);
  addBox(8, 0.5, -7, 2, 1, 1, 0x382e28);
  addBox(7, 0.6, 7, 2, 1.2, 1, 0x241d1a);
  addBox(-8, 0.15, 7, 3, 0.3, 2, 0x51453b);

  // Ceiling beams.
  for (let x = -9; x <= 9; x += 6) {
    addBox(x, 3.85, 0, 0.25, 0.25, 23, 0x100f0f);
  }

  // Flickering red lights.
  const light = new THREE.PointLight(0xff2020, 18, 9);
  light.position.set(0, 2.8, -5);
  scene.add(light);
  scene.userData.redLight = light;

  const lamp = new THREE.PointLight(0xffb56b, 12, 8);
  lamp.position.set(-8, 2.5, 1);
  scene.add(lamp);
}

function createPerson(color, isMonster = false) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new BoxGeometrySafe(0.55, 0.85, 0.35),
    material(isMonster ? 0x171313 : color)
  );
  body.position.y = 1;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(isMonster ? 0.35 : 0.25, 12, 10),
    material(isMonster ? 0x090707 : 0xb58a6b)
  );
  head.position.y = 1.65;
  head.castShadow = true;
  group.add(head);

  if (isMonster) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    for (const x of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 8),
        eyeMat
      );
      eye.position.set(x, 1.69, -0.25);
      group.add(eye);
    }
    const armMat = material(0x090707);
    for (const x of [-0.45, 0.45]) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.9, 0.2),
        armMat
      );
      arm.position.set(x, 0.95, 0);
      arm.rotation.z = x < 0 ? -0.15 : 0.15;
      group.add(arm);
    }
  }

  scene.add(group);
  return group;
}

function BoxGeometrySafe(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function init3D() {
  if (renderer) {
    renderer.dispose();
    canvasHost.innerHTML = "";
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030303);
  scene.fog = new THREE.Fog(0x030303, 4, 20);

  camera = new THREE.PerspectiveCamera(
    72,
    canvasHost.clientWidth / Math.max(1, canvasHost.clientHeight),
    0.1,
    100
  );

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
  renderer.shadowMap.enabled = true;
  canvasHost.appendChild(renderer.domElement);

  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0x78808c, 0x18100d, 1.1));

  const flashlight = new THREE.SpotLight(0xffe5c2, 45, 17, Math.PI / 5, 0.45, 1.5);
  flashlight.position.set(0, 1.6, 0);
  camera.add(flashlight);
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight.target);
  scene.add(camera);

  buildHouse();

  player = createPerson(0x2676bc);
  monster = createPerson(0x211010, true);
  monster.position.set(0, 0, -5);

  camera.position.set(playerPos.x, 1.65, playerPos.z);
  camera.rotation.order = "YXZ";

  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("pointerdown", startLook);
  renderer.domElement.addEventListener("pointermove", moveLook);
  renderer.domElement.addEventListener("pointerup", stopLook);
  renderer.domElement.addEventListener("pointercancel", stopLook);

  setupJoystick();
  animate();
}

function resize() {
  if (!renderer || !camera) return;
  const w = Math.max(1, canvasHost.clientWidth);
  const h = Math.max(1, canvasHost.clientHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function startLook(event) {
  if (event.target.closest("#joystickArea")) return;
  lookPointer = event.pointerId;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
}

function moveLook(event) {
  if (event.pointerId !== lookPointer) return;
  const dx = event.clientX - lastLookX;
  const dy = event.clientY - lastLookY;
  yaw -= dx * 0.004;
  pitch -= dy * 0.004;
  pitch = Math.max(-1.1, Math.min(1.1, pitch));
  lastLookX = event.clientX;
  lastLookY = event.clientY;
}

function stopLook(event) {
  if (event.pointerId === lookPointer) lookPointer = null;
}

function setupJoystick() {
  const area = $("joystickArea");
  const knob = $("joystick");
  const radius = 35;

  function update(event) {
    const rect = area.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const length = Math.hypot(dx, dy);

    if (length > radius) {
      dx = dx / length * radius;
      dy = dy / length * radius;
    }

    knob.style.left = `${rect.width / 2 - 29 + dx}px`;
    knob.style.top = `${rect.height / 2 - 29 + dy}px`;
    moveX = dx / radius;
    moveZ = dy / radius;
  }

  area.addEventListener("pointerdown", event => {
    joystickPointer = event.pointerId;
    area.setPointerCapture(event.pointerId);
    update(event);
  });

  area.addEventListener("pointermove", event => {
    if (event.pointerId === joystickPointer) update(event);
  });

  function release(event) {
    if (event.pointerId !== joystickPointer) return;
    joystickPointer = null;
    moveX = 0;
    moveZ = 0;
    knob.style.left = `${area.clientWidth / 2 - 29}px`;
    knob.style.top = `${area.clientHeight / 2 - 29}px`;
  }

  area.addEventListener("pointerup", release);
  area.addEventListener("pointercancel", release);
}

function updateState(data) {
  const seen = new Set();

  for (const p of data.players || []) {
    seen.add(p.id);

    if (p.id === playerId) {
      if (!positioned) {
        playerPos.set(p.x, 0, p.z);
        positioned = true;
      }
      continue;
    }

    let model = players.get(p.id);
    if (!model) {
      model = createPerson(0x46a8d9);
      players.set(p.id, model);
    }

    model.position.set(p.x, 0, p.z);
    model.rotation.y = p.rot || 0;
  }

  for (const [id, model] of players) {
    if (!seen.has(id)) {
      scene.remove(model);
      players.delete(id);
    }
  }

  if (data.monster && monster) {
    monster.position.set(data.monster.x, 0, data.monster.z);
  }
}

function animate() {
  if (!renderer || !scene) return;
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (!caught) {
    let forward = -moveZ;
    let side = moveX;

    if (keys.KeyW || keys.ArrowUp) forward = 1;
    if (keys.KeyS || keys.ArrowDown) forward = -1;
    if (keys.KeyA || keys.ArrowLeft) side = -1;
    if (keys.KeyD || keys.ArrowRight) side = 1;

    const length = Math.hypot(forward, side);
    if (length > 1) {
      forward /= length;
      side /= length;
    }

    const speed = 3.2 * dt;
    playerPos.x += (Math.cos(yaw) * side + Math.sin(yaw) * forward) * speed;
    playerPos.z += (-Math.sin(yaw) * side + Math.cos(yaw) * forward) * speed;

    playerPos.x = THREE.MathUtils.clamp(playerPos.x, -10.8, 10.8);
    playerPos.z = THREE.MathUtils.clamp(playerPos.z, -10.8, 10.8);

    if (player) {
      player.position.set(playerPos.x, 0, playerPos.z);
      player.rotation.y = yaw;
    }

    if (camera) {
      camera.position.set(playerPos.x, 1.65, playerPos.z);
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    }

    const now = performance.now();
    if (now - lastSent > 70 && connected) {
      lastSent = now;
      send({
        type: "move",
        x: playerPos.x,
        z: playerPos.z,
        rot: yaw
      });
    }
  }

  if (scene.userData.redLight) {
    scene.userData.redLight.intensity = 13 + Math.random() * 8;
  }

  renderer.render(scene, camera);
}

window.addEventListener("keydown", e => {
  keys[e.code] = true;
});

window.addEventListener("keyup", e => {
  keys[e.code] = false;
});
  
