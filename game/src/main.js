// main.js — Sunset Bay bootstrap: builds the game state, runs the loop,
// routes input between play, dialogs, shops, pause and map, handles
// wasted/busted, saving, and staged screenshot scenes (?shot=...).

import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { ParticleSystem } from './particles.js';
import { buildWorld, districtAt } from './world.js';
import { Camera, drawScene } from './render.js';
import { HUD } from './hud.js';
import { createPlayer, updatePlayerOnFoot, tryEnterExitCar, nearestInteractable, addCash } from './player.js';
import { spawnTrafficCars, spawnParkedCars, updateTraffic, updateCarDamage, driveCar, createCar, carSpeed } from './vehicles.js';
import { spawnPeds, updatePeds, checkCarPedCollisions, scarePeds } from './pedestrians.js';
import { createWanted, updateWanted, updatePolice, addHeat, clearWanted, damageCop } from './police.js';
import { WEAPONS, tryPlayerShoot, meleeAttack, enemyShootAt, updateBullets, updateExplosions } from './combat.js';
import {
  createMissionState, startMission, forceMissionStep, updateMissions, missionStartMarker, nextMissionId,
  onCarStolen, onPedDown, onCopDown, damageEnemy, onPlayerDown, startRace, updateObjective,
} from './missions.js';
import { loadSettings, writeSettings, loadSave, writeSave, hasSave, clearSave } from './save.js';
import { mulberry32, clamp, dist } from './util.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const params = new URLSearchParams(window.location.search);
const STAGED_SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') || '20261118', 10) || 20261118;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const settings = loadSettings();
const input = new Input();
input.attach(window, canvas);
const audio = new SoundBank(settings);
const hud = new HUD();

const G = {
  seed: SEED,
  rng: mulberry32(SEED),
  state: 'title',
  time: 0,
  clock: 1050, // 17:30, golden hour over the bay.
  world: null,
  player: null,
  cars: [],
  peds: [],
  cops: [],
  enemies: [],
  bullets: [],
  pickups: [],
  wrecks: [],
  pendingExplosions: [],
  particles: new ParticleSystem(),
  wanted: createWanted(),
  missionState: createMissionState(),
  camera: new Camera(),
  input,
  audio,
  hud,
  settings,
  objective: null,
  heli: null,
  deadOverlayTimer: 0,
  deadKind: '',
  stats: { shotsFired: 0, pedsDown: 0, copsDown: 0, enemiesDown: 0, carsStolen: 0, missionsDone: 0, fares: 0 },
  combat: { WEAPONS, meleeAttack, enemyShootAt },
  police: { addHeat, clearWanted, damageCop },
  missions: { missionStartMarker, onCarStolen, onPedDown, onCopDown, damageEnemy },
  onWasted: null,
  onBusted: null,
  saveGame: null,
};

function buildFreshState(save) {
  G.world = buildWorld(SEED);
  G.cars = [];
  G.peds = spawnPeds(G.world, G.rng, 46);
  G.cops = [];
  G.enemies = [];
  G.bullets = [];
  G.pickups = [];
  G.wrecks = [];
  G.pendingExplosions = [];
  G.particles = new ParticleSystem();
  G.wanted = createWanted();
  G.missionState = createMissionState();
  G.heli = null;
  G.objective = null;
  G.stats = { shotsFired: 0, pedsDown: 0, copsDown: 0, enemiesDown: 0, carsStolen: 0, missionsDone: 0, fares: 0 };
  G.clock = 1050;
  G.time = 0;

  const spawn = G.world.spawn;
  G.player = createPlayer(spawn.x, spawn.y);
  // The player's own starter sedan, parked by the garage.
  const starter = createCar('sedan', spawn.x + 90, spawn.y + 40, Math.PI / 2, { driver: 'none', owned: true });
  starter.color = '#4a6572';
  G.cars.push(starter);
  G.cars.push(...spawnTrafficCars(G.world, G.rng, 14));
  G.cars.push(...spawnParkedCars(G.world, G.rng, 22));

  if (save) applySave(save);
  G.camera.x = clamp(G.player.x - canvas.width / 2, 0, 3600 - canvas.width);
  G.camera.y = clamp(G.player.y - canvas.height / 2, 0, 3600 - canvas.height);
  updateObjective(G);
}

function applySave(save) {
  const player = G.player;
  player.cash = save.cash;
  player.health = save.health;
  player.armor = save.armor || 0;
  player.x = save.x;
  player.y = save.y;
  G.clock = save.clock || 1050;
  G.missionState.completed = save.completed || [];
  G.missionState.packagesFound = save.packagesFound || 0;
  if (save.packages) {
    for (const pkg of G.world.packages) pkg.collected = !!save.packages[pkg.id];
  }
  if (save.weapons) {
    for (const name of Object.keys(save.weapons)) {
      if (player.weapons[name]) Object.assign(player.weapons[name], save.weapons[name]);
    }
  }
  if (save.raceBest) G.missionState.race.best = save.raceBest;
  Object.assign(G.stats, save.stats || {});
}

G.saveGame = function saveGame() {
  const player = G.player;
  const ok = writeSave({
    cash: player.cash,
    health: player.health,
    armor: player.armor,
    x: player.x,
    y: player.y,
    clock: G.clock,
    completed: G.missionState.completed,
    packagesFound: G.missionState.packagesFound,
    packages: G.world.packages.map((p) => p.collected),
    weapons: player.weapons,
    raceBest: G.missionState.race.best,
    stats: G.stats,
    savedAt: Date.now(),
  });
  if (ok) hud.showMessage('Progress saved.', 'good');
  return ok;
};

G.onWasted = function onWasted() {
  onPlayerDown(G);
  G.state = 'dead';
  G.deadKind = 'wasted';
  G.deadOverlayTimer = 2.6;
  hud.showDead('WASTED', 'The paramedics scraped you off the pavement.');
  audio.siren(false);
};

G.onBusted = function onBusted() {
  onPlayerDown(G);
  G.state = 'dead';
  G.deadKind = 'busted';
  G.deadOverlayTimer = 2.6;
  hud.showDead('BUSTED', 'The Sunset Bay PD thanks you for your cooperation.');
  audio.siren(false);
};

function respawn() {
  const player = G.player;
  hud.hideDead();
  clearWanted(G, '');
  if (player.car) {
    player.car.driver = 'none';
    player.car = null;
  }
  const station = G.world.markers.find((m) => m.kind === (G.deadKind === 'wasted' ? 'hospital' : 'police'));
  player.x = station.x;
  player.y = station.y + 40;
  player.health = player.maxHealth;
  player.armor = 0;
  player.deadTimer = 0;
  const fine = G.deadKind === 'wasted'
    ? Math.min(player.cash, Math.round(player.cash * 0.15))
    : Math.min(player.cash, 200);
  player.cash -= fine;
  hud.showMessage('You lost ' + fine + ' in ' + (G.deadKind === 'wasted' ? 'hospital bills.' : 'fines.'), 'bad');
  G.state = 'playing';
  updateObjective(G);
}

// --- Interactions ---------------------------------------------------------

function openShopPanel(marker) {
  const player = G.player;
  const cash = player.cash;
  const opt = (label, price, action, disabled) => ({ label, price, action, disabled: disabled || cash < (price || 0) });
  if (marker.kind === 'gunshop') {
    const w = player.weapons;
    hud.openPanel('BAY ARMS — guns and ammo', [
      opt('Pistol ammo (60 rounds)', 40, () => { player.weapons.pistol.reserve += 60; player.cash -= 40; }),
      w.smg.unlocked
        ? opt('SMG ammo (90 rounds)', 80, () => { w.smg.reserve += 90; player.cash -= 80; })
        : opt('Buy SMG', 600, () => { w.smg.unlocked = true; player.cash -= 600; }),
      w.shotgun.unlocked
        ? opt('Shotgun shells (24)', 70, () => { w.shotgun.reserve += 24; player.cash -= 70; })
        : opt('Buy Shotgun', 800, () => { w.shotgun.unlocked = true; player.cash -= 800; }),
      w.rifle.unlocked
        ? opt('Rifle ammo (90 rounds)', 100, () => { w.rifle.reserve += 90; player.cash -= 100; })
        : opt('Buy Rifle', 1200, () => { w.rifle.unlocked = true; player.cash -= 1200; }),
      opt('Body armor', 150, () => { player.armor = player.maxArmor; player.cash -= 150; }, player.armor >= player.maxArmor),
    ]);
  } else if (marker.kind === 'customs') {
    const car = player.car;
    if (!car) {
      hud.showMessage('Bay Customs: bring a car in to respray or repair it.', 'info');
      return;
    }
    const colors = ['#c0392b', '#2980b9', '#f39c12', '#8e44ad', '#16a085', '#2d3436', '#e67e22', '#00cec9'];
    hud.openPanel('BAY CUSTOMS', [
      opt('Respray + new plates (clears wanted)', 200, () => {
        player.cash -= 200;
        car.color = colors[Math.floor(Math.random() * colors.length)];
        car.owned = true;
        car.stolen = false;
        clearWanted(G, 'Fresh paint, clean plates — the cops lost interest.');
      }),
      opt('Full repair', 150, () => {
        player.cash -= 150;
        car.health = car.maxHealth;
        car.onFire = false;
        car.explodeTimer = -1;
        hud.showMessage('Good as new.', 'good');
      }, car.health >= car.maxHealth),
    ]);
  } else if (marker.kind === 'diner') {
    hud.openPanel('SUNSET DINER', [
      opt('Bay burger + fries (heal 40)', 10, () => { player.health = clamp(player.health + 40, 0, player.maxHealth); player.cash -= 10; }),
      opt('Coffee and pie (heal 15)', 5, () => { player.health = clamp(player.health + 15, 0, player.maxHealth); player.cash -= 5; }),
    ]);
  } else if (marker.kind === 'casino') {
    hud.openPanel('GOLDEN PALM CASINO', [
      opt('Slots — bet $50', 50, () => gamble(50)),
      opt('Slots — bet $200', 200, () => gamble(200)),
      opt('Slots — bet $500', 500, () => gamble(500)),
    ]);
  } else if (marker.kind === 'hospital') {
    hud.openPanel('ST. MARINA HOSPITAL', [
      opt('Full treatment (heal + armor)', 100, () => {
        player.health = player.maxHealth;
        player.armor = player.maxArmor;
        player.cash -= 100;
      }, player.health >= player.maxHealth && player.armor >= player.maxArmor),
    ]);
  } else if (marker.kind === 'safehouse') {
    hud.openPanel('SAFEHOUSE', [
      { label: 'Save game + rest (full heal)', price: 0, action: () => { player.health = player.maxHealth; G.saveGame(); } },
      { label: 'Sleep until morning (8:00 AM)', price: 0, action: () => { G.clock = 480; player.health = player.maxHealth; hud.showMessage('You wake up to a new day in Sunset Bay.', 'info'); } },
    ]);
  }
}

function gamble(bet) {
  const player = G.player;
  player.cash -= bet;
  if (Math.random() < 0.42) {
    const win = Math.round(bet * 2.4);
    player.cash += win;
    hud.showMessage('JACKPOT! You won $' + win + '!', 'good');
    audio.missionPass();
  } else {
    hud.showMessage('The slots ate your $' + bet + '.', 'bad');
    audio.missionFail();
  }
}

function handleInteract() {
  const player = G.player;
  // Mission start takes priority at the M marker.
  const start = missionStartMarker(G);
  if (start && !player.car && dist(player.x, player.y, start.x, start.y) < 80) {
    startMission(G, start.missionId);
    return;
  }
  // Race start at the marina flag.
  if (!player.car && G.missionState.race.state === 'idle' && dist(player.x, player.y, 1800, 3440) < 80) {
    startRace(G);
    return;
  }
  const marker = nearestInteractable(G);
  if (marker && !player.car && ['gunshop', 'customs', 'diner', 'casino', 'hospital', 'safehouse'].includes(marker.kind)) {
    openShopPanel(marker);
    return;
  }
  if (marker && marker.kind === 'customs' && player.car) {
    openShopPanel(marker);
    return;
  }
  tryEnterExitCar(G);
}

// --- Staged screenshot scenes ---------------------------------------------

function applyStaging() {
  const shot = STAGED_SHOT;
  if (!shot || shot === 'start') return;
  G.clock = 1050;
  if (shot === 'drive') {
    // Coastal road, heading east: beach and palms in frame, car centered.
    const car = createCar('sports', 1500, 3375, 0, { driver: 'player', owned: true });
    car.color = '#e74c3c';
    G.cars.push(car);
    G.player.car = car;
    G.player.x = car.x;
    G.player.y = car.y;
    G.player.angle = car.angle;
    car.vx = 260;
    car.vy = 0;
    G.camera.x = clamp(car.x - canvas.width / 2, 0, 3600 - canvas.width);
    G.camera.y = clamp(car.y - canvas.height / 2, 0, 3600 - canvas.height);
    G.hud.showMessage('Cruising the boardwalk boulevard.', 'info');
  } else if (shot === 'chase') {
    const car = createCar('muscle', 1575, 1575, 0, { driver: 'player', owned: true });
    car.color = '#2d3436';
    G.cars.push(car);
    G.player.car = car;
    G.player.x = car.x;
    G.player.y = car.y;
    car.vx = 300;
    for (let i = 0; i < 3; i += 1) {
      const cruiser = createCar('cruiser', 1575 - 160 - i * 90, 1575 + (i - 1) * 40, 0, { driver: 'police' });
      cruiser.siren = true;
      cruiser.vx = 280;
      G.cars.push(cruiser);
      const ped = { x: cruiser.x, y: cruiser.y, angle: 0, state: 'idle', health: 100, isCop: true, shirt: '#1e3799', pants: '#2c3e50', skin: '#f1c27d', walkPhase: 0, speed: 0, downTimer: 0 };
      G.cops.push({ car: cruiser, ped, state: 'pursue', shootTimer: 1, bustTimer: 0, inCar: true });
    }
    // Real mission step: the chase leg of The Getaway, at 3 stars.
    forceMissionStep(G, 'm2', 1);
    addHeat(G, 25);
  } else if (shot === 'mission') {
    startMission(G, 'm1');
    G.player.x = 1125;
    G.player.y = 1520;
    G.camera.x = clamp(G.player.x - canvas.width / 2, 0, 3600 - canvas.width);
    G.camera.y = clamp(G.player.y - canvas.height / 2, 0, 3600 - canvas.height);
  }
  beginGame();
}

function beginGame() {
  document.getElementById('start').style.display = 'none';
  document.getElementById('pause').style.display = 'none';
  document.getElementById('mapOverlay').style.display = 'none';
  document.body.classList.remove('in-title');
  G.state = 'playing';
  audio.ensure();
  audio.startMusic();
}

// --- UI wiring --------------------------------------------------------------

function wireUI() {
  const startEl = document.getElementById('start');
  const btnNew = document.getElementById('btnNew');
  const btnContinue = document.getElementById('btnContinue');
  if (!hasSave()) btnContinue.style.display = 'none';
  btnNew.addEventListener('click', () => {
    clearSave();
    buildFreshState(null);
    beginGame();
    hud.showMessage('Welcome to Sunset Bay. Go to the M marker to meet Mara.', 'info');
  });
  btnContinue.addEventListener('click', () => {
    const save = loadSave();
    buildFreshState(save);
    beginGame();
    hud.showMessage('Welcome back to Sunset Bay.', 'info');
  });
  startEl.addEventListener('click', (event) => {
    if (event.target === startEl) {
      buildFreshState(loadSave());
      beginGame();
    }
  });
  document.getElementById('btnResume').addEventListener('click', () => togglePause(false));
  document.getElementById('btnSave').addEventListener('click', () => {
    G.saveGame();
    togglePause(false);
  });
  document.getElementById('btnQuit').addEventListener('click', () => {
    G.saveGame();
    document.getElementById('pause').style.display = 'none';
    document.getElementById('start').style.display = 'flex';
    document.body.classList.add('in-title');
    G.state = 'title';
    audio.stopMusic();
  });
  const chkSound = document.getElementById('chkSound');
  const chkMusic = document.getElementById('chkMusic');
  const chkShake = document.getElementById('chkShake');
  chkSound.checked = settings.sound;
  chkMusic.checked = settings.music;
  chkShake.checked = settings.screenShake;
  chkSound.addEventListener('change', () => { settings.sound = chkSound.checked; writeSettings(settings); audio.setVolumes(); });
  chkMusic.addEventListener('change', () => { settings.music = chkMusic.checked; writeSettings(settings); audio.setVolumes(); });
  chkShake.addEventListener('change', () => { settings.screenShake = chkShake.checked; writeSettings(settings); });
  document.getElementById('mapOverlay').addEventListener('click', () => toggleMap(false));
}

function togglePause(show) {
  if (G.state !== 'playing' && show) return;
  if (show === undefined) show = G.state === 'playing';
  if (show) {
    G.state = 'paused';
    document.getElementById('pauseStats').textContent =
      'Cash ' + G.player.cash + '  ·  Missions ' + G.missionState.completed.length + '/6' +
      '  ·  Packages ' + G.missionState.packagesFound + '/10' +
      '  ·  Cars stolen ' + G.stats.carsStolen + '  ·  Fares ' + G.stats.fares;
    document.getElementById('pause').style.display = 'flex';
  } else if (G.state === 'paused') {
    G.state = 'playing';
    document.getElementById('pause').style.display = 'none';
  }
}

function toggleMap(show) {
  if (show === undefined) show = G.state === 'playing';
  if (show && G.state === 'playing') {
    G.state = 'map';
    hud.drawBigMap(G);
    document.getElementById('mapOverlay').style.display = 'flex';
  } else if (!show && G.state === 'map') {
    G.state = 'playing';
    document.getElementById('mapOverlay').style.display = 'none';
  }
}

// --- Main loop --------------------------------------------------------------

let lastTime = 0;

function update(dt) {
  G.time += dt;
  G.clock = (G.clock + dt) % 1440;
  const player = G.player;

  // Dialog and panel input routing.
  if (hud.dialogOpen) {
    if (input.wasPressed('KeyE') || input.wasPressed('Enter') || input.wasPressed('Space') || input.mouse.clicked) {
      audio.click();
      hud.advanceDialog();
    }
    hud.update(G, dt);
    return;
  }
  if (hud.panelOpen) {
    for (let i = 0; i < 4; i += 1) {
      if (input.wasPressed('Digit' + (i + 1))) hud.choosePanelOption(i);
    }
    if (input.wasPressed('Escape')) hud.closePanel();
    hud.update(G, dt);
    return;
  }
  if (input.wasPressed('Escape') || input.wasPressed('KeyP')) {
    togglePause(true);
    return;
  }
  if (input.wasPressed('KeyM')) {
    toggleMap(true);
    return;
  }

  if (input.wasPressed('KeyE')) handleInteract();
  if (input.wasPressed('KeyH') && player.car) audio.horn();

  if (player.car) {
    const forward = (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
    const steer = (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0) - (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0);
    driveCar(G, player.car, forward, steer, dt);
    player.x = player.car.x;
    player.y = player.car.y;
    player.angle = player.car.angle;
    player.speed = carSpeed(player.car);
    audio.engine(clamp(player.speed / 500, 0, 1), true);
    if (player.car.health <= 0 && player.car.explodeTimer < 0) player.car.explodeTimer = 1.6;
  } else {
    updatePlayerOnFoot(G, dt);
    tryPlayerShoot(G);
    audio.engine(0, false);
  }

  updateTraffic(G, dt);
  updatePeds(G, dt);
  checkCarPedCollisions(G);
  updateCarDamage(G, dt);
  updateWanted(G, dt);
  updatePolice(G, dt);
  updateBullets(G, dt);
  updateExplosions(G);
  updateMissions(G, dt);
  G.particles.update(dt);
  for (let i = G.wrecks.length - 1; i >= 0; i -= 1) {
    G.wrecks[i].life -= dt;
    if (G.wrecks[i].life <= 0) G.wrecks.splice(i, 1);
  }
  // Respawn traffic and pedestrians that wandered off or died.
  if (G.cars.filter((c) => c.driver === 'traffic' && !c.dead).length < 10) {
    G.cars.push(...spawnTrafficCars(G.world, G.rng, 2));
  }
  if (G.peds.filter((p) => p.state !== 'down').length < 30) {
    G.peds.push(...spawnPeds(G.world, G.rng, 4));
  }
  audio.updateMusic();
  hud.update(G, dt);
}

function frame(now) {
  const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
  lastTime = now;
  if (G.state === 'playing') {
    update(dt);
  } else if (G.state === 'dead') {
    G.deadOverlayTimer -= dt;
    if (G.deadOverlayTimer <= 0) respawn();
  } else if (G.state === 'map') {
    if (input.wasPressed('KeyM') || input.wasPressed('Escape')) toggleMap(false);
    hud.drawBigMap(G);
  } else if (G.state === 'paused') {
    if (input.wasPressed('Escape') || input.wasPressed('KeyP')) togglePause(false);
  } else if (G.state === 'title') {
    // Slow cinematic pan across the city behind the title.
    G.time += dt;
    G.camera.x = 600 + Math.sin(G.time * 0.05) * 500;
    G.camera.y = 900 + Math.cos(G.time * 0.04) * 400;
    G.camera.zoom = 0.9;
  }
  const player = G.player;
  if (G.state === 'playing' || G.state === 'dead') {
    G.camera.update(player.x, player.y, player.speed, !!player.car, dt, canvas.width, canvas.height, settings);
  }
  drawScene(G, ctx, canvas.width, canvas.height);
  input.endFrame();
  requestAnimationFrame(frame);
}

// Boot.
buildFreshState(null);
wireUI();
// Debug handle: lets automated smoke tests inspect live game state.
window.__SUNSET_BAY = G;

applyStaging();
console.log('SUNSET BAY READY');
requestAnimationFrame(frame);
