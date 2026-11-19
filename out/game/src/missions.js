// missions.js — the story arc, side activities and mission enemies.
// Missions are step lists: go somewhere, talk, steal, deliver, survive,
// eliminate, collect. The step engine drives the objective tracker and
// the waypoint; failing a step fails the mission, and it can be retried.

import { clamp, dist, pick, randRange } from './util.js';
import { createCar, VEHICLE_TYPES } from './vehicles.js';
import { addCash, unlockWeapon } from './player.js';

export function createMissionState() {
  return {
    completed: [],
    active: null,
    taxi: { state: 'idle', dest: null, timer: 0, fare: 0, passenger: null },
    race: { state: 'idle', checkpoint: 0, timer: 0, best: null },
    packagesFound: 0,
    briefing: null,
  };
}

const DIALOG = {
  m1: [
    ['Mara Quinn', 'Rook. You want work in Sunset Bay, you start with wheels.'],
    ['Mara Quinn', 'There is a coupe parked behind the diner. Take it. Quietly would be nice — quietly is optional.'],
    ['Mara Quinn', 'Bring it to my garage. Do that, and we will talk about real money.'],
  ],
  m2: [
    ['Mara Quinn', 'Danny ran a card game at the Golden Palm and forgot whose money it was.'],
    ['Mara Quinn', 'Pick him up at the casino, lose the cops, and get him to the safehouse. Three stops. Drive like you mean it.'],
  ],
  m3: [
    ['Mara Quinn', 'A Vortex GT is sitting at the marina. Belongs to Victor Kane. It should belong to us.'],
    ['Mara Quinn', 'Kane keeps guards around his toys. Bring the car back with the paint mostly on.'],
  ],
  m4: [
    ['Priya Nair', 'I run the night deliveries nobody asks about. Three stops, one timer, no questions.'],
    ['Priya Nair', 'The package is at the docks. The clock starts when you pick it up.'],
  ],
  m5: [
    ['Mara Quinn', 'Bay Trust keeps the weekend take in the back room. Friday night, skeleton crew.'],
    ['Mara Quinn', 'Walk in, hold the room, walk out rich. The whole city will know your name after this one.'],
  ],
  m6: [
    ['Mara Quinn', 'Kane has run this city too long. Tonight his crew meets at the docks.'],
    ['Mara Quinn', 'Finish it, Rook. Then Sunset Bay is ours.'],
  ],
};

export const MISSION_DEFS = [
  {
    id: 'm1', title: 'First Wheels', giver: 'Mara Quinn', reward: 400,
    start: { x: 1125, y: 1470, label: 'Mara\u2019s Garage' },
    steps: [
      { type: 'goto', x: 1125, y: 1470, label: 'Meet Mara at the garage', radius: 60 },
      { type: 'steal', carType: 'coupe', x: 1000, y: 1560, label: 'Steal the coupe behind the diner' },
      { type: 'deliver', x: 1125, y: 1470, label: 'Deliver the coupe to the garage', radius: 70 },
    ],
  },
  {
    id: 'm2', title: 'The Getaway', giver: 'Mara Quinn', reward: 700, unlocks: ['smg'],
    start: { x: 1125, y: 1470, label: 'Mara\u2019s Garage' },
    steps: [
      { type: 'goto', x: 2830, y: 2050, label: 'Pick up Danny at the Golden Palm', radius: 70 },
      { type: 'chase', points: [[2025, 1125], [1125, 675], [675, 2475]], label: 'Lose the cops — hit the checkpoints', heat: 34 },
      { type: 'deliver', x: 620, y: 620, label: 'Drop Danny at the safehouse', radius: 80, anyCar: true },
    ],
  },
  {
    id: 'm3', title: 'Repo at the Marina', giver: 'Mara Quinn', reward: 900, unlocks: ['shotgun'],
    start: { x: 1125, y: 1470, label: 'Mara\u2019s Garage' },
    steps: [
      { type: 'eliminate', count: 2, at: [[1740, 3440], [1880, 3450]], label: 'Deal with Kane\u2019s guards at the marina' },
      { type: 'steal', carType: 'sports', x: 1800, y: 3470, label: 'Steal the Vortex GT' },
      { type: 'deliver', x: 1125, y: 1470, label: 'Deliver the Vortex GT — keep it above half health', radius: 70, minHealth: 50 },
    ],
  },
  {
    id: 'm4', title: 'Hot Delivery', giver: 'Priya Nair', reward: 1100, unlocks: ['rifle'],
    start: { x: 3500, y: 1080, label: 'Port Del Rey Docks' },
    steps: [
      { type: 'collect', count: 1, at: [[3500, 1080]], label: 'Pick up the package at the docks' },
      { type: 'timed', seconds: 240, points: [[675, 675], [2925, 1125], [1575, 2925]], label: 'Deliver to all three stops before the timer ends' },
    ],
  },
  {
    id: 'm5', title: 'The Bay Trust Job', giver: 'Mara Quinn', reward: 2500,
    start: { x: 1125, y: 1470, label: 'Mara\u2019s Garage' },
    steps: [
      { type: 'goto', x: 1575, y: 1230, label: 'Get to Bay Trust Bank', radius: 70 },
      { type: 'hold', x: 1575, y: 1230, seconds: 8, label: 'Hold the room — grab the cash', radius: 80 },
      { type: 'escape', x: 620, y: 620, label: 'Escape to the safehouse', heat: 72, radius: 80 },
    ],
  },
  {
    id: 'm6', title: 'King of Sunset Bay', giver: 'Mara Quinn', reward: 5000,
    start: { x: 1125, y: 1470, label: 'Mara\u2019s Garage' },
    steps: [
      { type: 'goto', x: 3500, y: 1080, label: 'Get to the docks', radius: 90 },
      { type: 'eliminate', count: 6, at: [[3440, 900], [3500, 1100], [3440, 1300], [3520, 1500], [3450, 1700], [3500, 1900]], label: 'Take down Kane\u2019s crew' },
      { type: 'eliminate', count: 1, at: [[3500, 1080]], boss: true, label: 'Victor Kane is here. Finish it.' },
      { type: 'goto', x: 1125, y: 1470, label: 'Return to the garage — the city is yours', radius: 70 },
    ],
  },
];

export function nextMissionId(G) {
  for (const def of MISSION_DEFS) {
    if (!G.missionState.completed.includes(def.id)) return def.id;
  }
  return null;
}

export function missionStartMarker(G) {
  const id = nextMissionId(G);
  if (!id || G.missionState.active) return null;
  const def = MISSION_DEFS.find((d) => d.id === id);
  return { x: def.start.x, y: def.start.y, label: def.title, missionId: id };
}

export function startMission(G, id) {
  const def = MISSION_DEFS.find((d) => d.id === id);
  if (!def) return;
  G.missionState.active = {
    def, stepIndex: 0, stepState: {}, timer: 0, spawnedCars: [], spawnedEnemies: [],
  };
  G.hud.showDialog(DIALOG[id] || [[def.giver, def.title]], () => {
    enterStep(G, G.missionState.active);
  });
  G.audio.click();
  updateObjective(G);
}

// Jump straight into a mission step (used by the ?shot= staging scenes
// and for testing); skips the briefing dialog.
export function forceMissionStep(G, id, stepIndex) {
  const def = MISSION_DEFS.find((d) => d.id === id);
  if (!def) return;
  G.missionState.active = {
    def, stepIndex, stepState: {}, timer: 0, spawnedCars: [], spawnedEnemies: [],
  };
  enterStep(G, G.missionState.active);
  // Dismiss any step dialog so the scene renders unblocked.
  while (G.hud.dialogOpen) G.hud.advanceDialog();
}

function enterStep(G, mission) {
  const step = mission.def.steps[mission.stepIndex];
  if (!step) {
    completeMission(G);
    return;
  }
  mission.stepState = { checkpoint: 0, holdTime: 0, collected: 0, killed: 0 };
  mission.timer = step.seconds || 0;
  if (step.type === 'steal') {
    const car = createCar(step.carType, step.x, step.y, 0, { driver: 'parked', mission: true });
    car.color = pick(G.rng, VEHICLE_TYPES[step.carType].colors);
    G.cars.push(car);
    mission.stepState.targetCar = car;
    mission.spawnedCars.push(car);
  }
  if (step.type === 'eliminate') {
    for (const [x, y] of step.at) {
      const enemy = spawnEnemy(G, x, y, { boss: step.boss });
      mission.spawnedEnemies.push(enemy);
    }
  }
  if (step.type === 'collect') {
    for (const [x, y] of step.at) {
      G.pickups.push({ x, y, kind: 'package', amount: 0, life: 9999 });
    }
  }
  if (step.type === 'chase' || step.type === 'escape') {
    G.police.addHeat(G, step.heat || 30, 'The heat is on');
  }
  updateObjective(G);
}

function stepTarget(G, mission) {
  const step = mission.def.steps[mission.stepIndex];
  const st = mission.stepState;
  if (step.type === 'chase' || step.type === 'timed') {
    const p = step.points[st.checkpoint];
    return p ? { x: p[0], y: p[1] } : null;
  }
  if (step.type === 'steal' && st.targetCar) return { x: st.targetCar.x, y: st.targetCar.y };
  if (step.type === 'eliminate') {
    const alive = mission.spawnedEnemies.find((e) => e.health > 0);
    return alive ? { x: alive.x, y: alive.y } : null;
  }
  if (step.x !== undefined) return { x: step.x, y: step.y };
  return null;
}

export function updateObjective(G) {
  const mission = G.missionState.active;
  if (mission) {
    const step = mission.def.steps[mission.stepIndex];
    const target = stepTarget(G, mission);
    let label = step.label;
    if (step.type === 'eliminate') {
      const left = mission.spawnedEnemies.filter((e) => e.health > 0).length;
      label += ' — ' + left + ' left';
    }
    if (step.type === 'timed') label += ' — ' + Math.ceil(mission.timer) + 's';
    G.objective = target ? { x: target.x, y: target.y, label, color: '#ffd23f' } : { x: 0, y: 0, label, color: '#ffd23f', hidden: true };
    return;
  }
  const marker = missionStartMarker(G);
  if (marker) {
    G.objective = { x: marker.x, y: marker.y, label: 'New mission: ' + marker.label + ' — go to M', color: '#ffd23f' };
    return;
  }
  if (G.missionState.taxi.state !== 'idle') {
    const taxi = G.missionState.taxi;
    G.objective = { x: taxi.dest.x, y: taxi.dest.y, label: taxi.state === 'toPickup' ? 'Pick up the passenger' : 'Drop off the passenger — ' + Math.ceil(taxi.timer) + 's', color: '#f1c40f' };
    return;
  }
  G.objective = null;
}

export function updateMissions(G, dt) {
  updateTaxi(G, dt);
  updateRace(G, dt);
  updateEnemies(G, dt);
  updatePickups(G, dt);
  checkPackages(G);
  const mission = G.missionState.active;
  if (!mission) {
    updateObjective(G);
    return;
  }
  const step = mission.def.steps[mission.stepIndex];
  const st = mission.stepState;
  const player = G.player;
  let done = false;

  if (step.type === 'goto' || step.type === 'escape') {
    if (dist(player.x, player.y, step.x, step.y) < (step.radius || 60)) done = true;
  } else if (step.type === 'steal') {
    if (st.targetCar && player.car === st.targetCar) done = true;
    if (st.targetCar && st.targetCar.dead) return failMission(G, 'The car was destroyed.');
  } else if (step.type === 'deliver') {
    const car = step.anyCar ? player.car : st.targetCar;
    const okCar = step.anyCar ? !!player.car : player.car === st.targetCar;
    if (okCar && dist(player.x, player.y, step.x, step.y) < (step.radius || 70) && Math.hypot(player.car.vx, player.car.vy) < 40) {
      if (step.minHealth && player.car.health < step.minHealth) {
        return failMission(G, 'The car took too much damage.');
      }
      done = true;
    }
    if (!step.anyCar && st.targetCar && st.targetCar.dead) return failMission(G, 'The car was destroyed.');
  } else if (step.type === 'chase' || step.type === 'timed') {
    if (step.type === 'timed') {
      mission.timer -= dt;
      if (mission.timer <= 0) return failMission(G, 'Out of time.');
    }
    const p = step.points[st.checkpoint];
    if (p && dist(player.x, player.y, p[0], p[1]) < 80) {
      st.checkpoint += 1;
      G.audio.pickup();
      G.hud.showMessage('Checkpoint ' + st.checkpoint + '/' + step.points.length, 'good');
      if (st.checkpoint >= step.points.length) done = true;
    }
  } else if (step.type === 'eliminate') {
    const left = mission.spawnedEnemies.filter((e) => e.health > 0).length;
    if (left === 0) done = true;
  } else if (step.type === 'collect') {
    if (st.collected >= step.count) done = true;
  } else if (step.type === 'hold') {
    if (dist(player.x, player.y, step.x, step.y) < (step.radius || 80)) {
      st.holdTime += dt;
      if (st.holdTime >= step.seconds) done = true;
    } else {
      st.holdTime = Math.max(0, st.holdTime - dt);
    }
  }
  if (done) {
    mission.stepIndex += 1;
    if (mission.stepIndex >= mission.def.steps.length) completeMission(G);
    else enterStep(G, mission);
  }
  updateObjective(G);
}

function completeMission(G) {
  const mission = G.missionState.active;
  if (!mission) return;
  const def = mission.def;
  G.missionState.completed.push(def.id);
  G.missionState.active = null;
  addCash(G, def.reward);
  if (def.unlocks) {
    for (const name of def.unlocks) {
      unlockWeapon(G.player, name);
      G.hud.showMessage('Unlocked: ' + name.toUpperCase() + ' — buy ammo at Bay Arms.', 'good');
    }
  }
  G.stats.missionsDone += 1;
  G.hud.showBanner('MISSION PASSED', def.title + '  ·  +' + def.reward, true);
  G.audio.missionPass();
  G.police.clearWanted(G, '');
  G.saveGame();
  updateObjective(G);
}

export function failMission(G, reason) {
  const mission = G.missionState.active;
  if (!mission) return;
  for (const enemy of mission.spawnedEnemies) enemy.health = 0;
  G.enemies = G.enemies.filter((e) => e.health > 0);
  G.missionState.active = null;
  G.hud.showBanner('MISSION FAILED', reason, false);
  G.audio.missionFail();
  updateObjective(G);
}

export function onPlayerDown(G) {
  if (G.missionState.active) failMission(G, 'The job fell apart.');
}

export function spawnEnemy(G, x, y, opts) {
  const o = opts || {};
  const enemy = {
    x, y,
    angle: 0,
    health: o.boss ? 320 : 100,
    maxHealth: o.boss ? 320 : 100,
    weapon: o.boss ? 'rifle' : 'smg',
    shootTimer: randRange(G.rng, 0.5, 1.5),
    strafeDir: G.rng() < 0.5 ? 1 : -1,
    strafeTimer: 0,
    walkPhase: 0,
    boss: !!o.boss,
    shirt: o.boss ? '#2d3436' : '#6c5ce7',
    name: o.boss ? 'Victor Kane' : 'Kane crew',
  };
  G.enemies.push(enemy);
  return enemy;
}

export function damageEnemy(G, enemy, amount) {
  if (enemy.health <= 0) return;
  enemy.health -= amount;
  if (enemy.health <= 0) {
    enemy.health = 0;
    G.particles.dustPuff(enemy.x, enemy.y, G.rng);
    G.pickups.push({ x: enemy.x, y: enemy.y, kind: 'cash', amount: enemy.boss ? 300 : randRange(G.rng, 20, 60), life: 30 });
    G.stats.enemiesDown += 1;
    const mission = G.missionState.active;
    if (mission) {
      const left = mission.spawnedEnemies.filter((e) => e.health > 0).length;
      if (left > 0) G.hud.showMessage(left + ' hostiles left.', 'warn');
    }
  }
}

function updateEnemies(G, dt) {
  for (const enemy of G.enemies) {
    if (enemy.health <= 0) continue;
    const player = G.player;
    const d = dist(enemy.x, enemy.y, player.x, player.y);
    enemy.strafeTimer -= dt;
    if (enemy.strafeTimer <= 0) {
      enemy.strafeTimer = randRange(G.rng, 1, 2.5);
      enemy.strafeDir *= -1;
    }
    let moveAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    if (d < 200) moveAngle += (Math.PI / 2) * enemy.strafeDir;
    if (d > 320 || d < 200) {
      const speed = 150;
      enemy.angle = moveAngle;
      enemy.x += Math.cos(moveAngle) * speed * dt;
      enemy.y += Math.sin(moveAngle) * speed * dt;
      enemy.walkPhase += dt * 8;
    } else {
      enemy.angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    }
    enemy.shootTimer -= dt;
    if (enemy.shootTimer <= 0 && d < 420) {
      enemy.shootTimer = randRange(G.rng, 0.8, 1.6);
      G.combat.enemyShootAt(G, enemy.x, enemy.y, player.x, player.y, enemy.weapon, 0.18);
    }
  }
  G.enemies = G.enemies.filter((e) => e.health > 0 || e.deathTimer > 0);
}

function updatePickups(G, dt) {
  for (let i = G.pickups.length - 1; i >= 0; i -= 1) {
    const p = G.pickups[i];
    p.life -= dt;
    if (p.life <= 0) {
      G.pickups.splice(i, 1);
      continue;
    }
    if (dist(p.x, p.y, G.player.x, G.player.y) < 34) {
      if (p.kind === 'cash') {
        addCash(G, p.amount);
        G.hud.showMessage('+$' + Math.round(p.amount), 'good');
      } else if (p.kind === 'package') {
        const mission = G.missionState.active;
        if (mission) mission.stepState.collected += 1;
        G.hud.showMessage('Package collected.', 'good');
        G.audio.pickup();
      } else if (p.kind === 'health') {
        G.player.health = clamp(G.player.health + 50, 0, G.player.maxHealth);
        G.hud.showMessage('Health restored.', 'good');
      } else if (p.kind === 'armor') {
        G.player.armor = clamp(G.player.armor + 50, 0, G.player.maxArmor);
        G.hud.showMessage('Armor picked up.', 'good');
      }
      G.pickups.splice(i, 1);
    }
  }
}

function checkPackages(G) {
  for (const pkg of G.world.packages) {
    if (pkg.collected) continue;
    if (dist(pkg.x, pkg.y, G.player.x, G.player.y) < 40) {
      pkg.collected = true;
      G.missionState.packagesFound += 1;
      addCash(G, 100);
      G.audio.pickup();
      G.hud.showMessage('Hidden package ' + G.missionState.packagesFound + '/10 — +$100', 'good');
      if (G.missionState.packagesFound >= 10) {
        addCash(G, 1500);
        G.hud.showBanner('COLLECTOR', 'All 10 hidden packages — bonus $1,500', true);
      }
    }
  }
}

// --- Taxi side job -------------------------------------------------------

const TAXI_SPOTS = [[675, 675], [1575, 225], [2925, 675], [3375, 2025], [675, 2925], [2475, 2925], [225, 1575], [2025, 3375]];

function updateTaxi(G, dt) {
  const taxi = G.missionState.taxi;
  const player = G.player;
  const inTaxi = player.car && player.car.type === 'taxi';
  if (!inTaxi) {
    if (taxi.state !== 'idle') {
      taxi.state = 'idle';
      G.hud.showMessage('Taxi job ended — you left the cab.', 'warn');
    }
    return;
  }
  if (taxi.state === 'idle') {
    const [x, y] = pick(G.rng, TAXI_SPOTS);
    taxi.state = 'toPickup';
    taxi.dest = { x, y };
    taxi.passenger = null;
    G.hud.showMessage('Taxi fare: pick up the passenger.', 'info');
    updateObjective(G);
    return;
  }
  taxi.timer -= dt;
  if (taxi.state === 'toPickup') {
    if (dist(player.x, player.y, taxi.dest.x, taxi.dest.y) < 70) {
      const [x, y] = pick(G.rng, TAXI_SPOTS);
      taxi.state = 'toDest';
      taxi.dest = { x, y };
      const distance = dist(player.x, player.y, x, y);
      taxi.timer = 60 + distance / 12;
      taxi.fare = 60 + Math.round(distance / 18);
      G.hud.showMessage('Passenger aboard — drive to the destination!', 'info');
      updateObjective(G);
    }
  } else if (taxi.state === 'toDest') {
    if (dist(player.x, player.y, taxi.dest.x, taxi.dest.y) < 70 && Math.hypot(player.car.vx, player.car.vy) < 40) {
      const tip = taxi.timer > 0 ? Math.round(taxi.timer) : 0;
      const total = taxi.fare + tip;
      addCash(G, total);
      G.hud.showMessage('Fare complete — earned $' + total + ' (tip $' + tip + ').', 'good');
      G.stats.fares += 1;
      taxi.state = 'idle';
      updateObjective(G);
    } else if (taxi.timer <= 0) {
      G.hud.showMessage('The passenger stormed out — too slow!', 'bad');
      taxi.state = 'idle';
      updateObjective(G);
    }
  }
}

// --- Checkpoint race -----------------------------------------------------

const RACE_POINTS = [[3375, 3375], [3375, 225], [225, 225], [225, 3375], [1575, 3375], [1575, 1575], [2925, 1575], [2925, 3375]];

export function startRace(G) {
  const race = G.missionState.race;
  if (race.state !== 'idle') return;
  race.state = 'running';
  race.checkpoint = 0;
  race.timer = 0;
  G.objective = { x: RACE_POINTS[0][0], y: RACE_POINTS[0][1], label: 'Sunset GP — checkpoint 1/8', color: '#00cec9' };
  G.hud.showMessage('Sunset GP started! Hit all 8 checkpoints. Par: 2:30.', 'info');
  G.audio.missionPass();
}

function updateRace(G, dt) {
  const race = G.missionState.race;
  if (race.state !== 'running') return;
  race.timer += dt;
  const p = RACE_POINTS[race.checkpoint];
  if (dist(G.player.x, G.player.y, p[0], p[1]) < 90) {
    race.checkpoint += 1;
    G.audio.pickup();
    if (race.checkpoint >= RACE_POINTS.length) {
      race.state = 'idle';
      const t = race.timer;
      const isBest = race.best === null || t < race.best;
      if (isBest) race.best = t;
      const mins = Math.floor(t / 60);
      const secs = (t - mins * 60).toFixed(1);
      if (t < 150) {
        addCash(G, 300);
        G.hud.showBanner('RACE WON', 'Sunset GP in ' + mins + ':' + secs.padStart(4, '0') + ' — +$300', true);
      } else {
        G.hud.showBanner('RACE DONE', 'Sunset GP in ' + mins + ':' + secs.padStart(4, '0') + (isBest ? ' — new best!' : ''), true);
      }
      G.saveGame();
      updateObjective(G);
    } else {
      G.objective = { x: RACE_POINTS[race.checkpoint][0], y: RACE_POINTS[race.checkpoint][1], label: 'Sunset GP — checkpoint ' + (race.checkpoint + 1) + '/8', color: '#00cec9' };
    }
  }
}

// Hooks other systems call; kept small so missions stay decoupled.
export function onCarStolen(G, car) {
  G.stats.carsStolen += 1;
}

export function onPedDown(G, ped) {
  // Reserved: story consequences for harming civilians live here.
}

export function onCopDown(G, cop) {
  // Reserved: story consequences for downing officers live here.
}
