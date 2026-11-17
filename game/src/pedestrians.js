// pedestrians.js — city folk: sidewalk wanderers, beach idlers and
// shoppers who flee gunfire, dive out of the way of speeding cars, and
// call the police when they witness a crime.

import { clamp, dist, pick, randRange, turnToward } from './util.js';
import { ROADS, moveCircle, surfaceAt } from './world.js';

const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1', '#fd79a8', '#fdcb6e'];
const PANTS = ['#2c3e50', '#34495e', '#7f8c8d', '#5d4037', '#37474f'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

export function spawnPeds(world, rng, count) {
  const peds = [];
  let guard = 0;
  while (peds.length < count && guard < count * 30) {
    guard += 1;
    const x = randRange(rng, 60, 3540);
    const y = randRange(rng, 60, 3500);
    if (surfaceAt(x, y) === 'water') continue;
    const ped = createPed(x, y, rng);
    peds.push(ped);
  }
  return peds;
}

export function createPed(x, y, rng) {
  return {
    x, y,
    angle: rng() * Math.PI * 2,
    speed: 0,
    state: 'walk', // walk | idle | flee | down
    target: null,
    waitTimer: randRange(rng, 0, 4),
    walkPhase: rng() * 6,
    shirt: pick(rng, SHIRTS),
    pants: pick(rng, PANTS),
    skin: pick(rng, SKINS),
    panic: 0,
    downTimer: 0,
    isCop: false,
    isEnemy: false,
    health: 100,
  };
}

function pickWanderTarget(ped, rng) {
  // Prefer walking along sidewalks: snap one axis to a road offset.
  if (rng() < 0.6) {
    const road = pick(rng, ROADS);
    const along = randRange(rng, 100, 3500);
    const side = rng() < 0.5 ? 1 : -1;
    if (rng() < 0.5) return { x: along, y: road + side * (45 + 20) };
    return { x: road + side * (45 + 20), y: along };
  }
  return { x: randRange(rng, 80, 3520), y: randRange(rng, 80, 3480) };
}

export function scarePeds(G, x, y, radius, amount) {
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    const d = dist(x, y, ped.x, ped.y);
    if (d < radius) {
      ped.panic = clamp(ped.panic + amount * (1 - d / radius), 0, 100);
      if (ped.panic > 40) ped.state = 'flee';
    }
  }
}

export function updatePeds(G, dt) {
  for (const ped of G.peds) {
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0 && ped.health > 0) {
        ped.state = 'flee';
        ped.panic = 80;
      }
      continue;
    }
    ped.panic = Math.max(0, ped.panic - dt * 6);
    if (ped.state === 'flee' && ped.panic <= 5) ped.state = 'walk';

    if (ped.state === 'flee') {
      // Run away from the nearest threat: the player when armed, else the
      // last scare point stored on the ped.
      const threat = ped.fleeFrom || { x: G.player.x, y: G.player.y };
      const away = Math.atan2(ped.y - threat.y, ped.x - threat.x);
      ped.angle = turnToward(ped.angle, away, 6 * dt);
      const next = moveCircle(G.world, ped.x, ped.y, Math.cos(ped.angle) * 240 * dt, Math.sin(ped.angle) * 240 * dt, 10);
      ped.x = next.x;
      ped.y = next.y;
      ped.speed = 240;
      ped.walkPhase += dt * 12;
      continue;
    }

    if (ped.state === 'idle') {
      ped.waitTimer -= dt;
      ped.speed = 0;
      if (ped.waitTimer <= 0) {
        ped.state = 'walk';
        ped.target = pickWanderTarget(ped, G.rng);
      }
      continue;
    }

    // Walking: head for the target, pause sometimes, dodge traffic.
    if (!ped.target || dist(ped.x, ped.y, ped.target.x, ped.target.y) < 20) {
      if (G.rng() < 0.3) {
        ped.state = 'idle';
        ped.waitTimer = randRange(G.rng, 2, 7);
      } else {
        ped.target = pickWanderTarget(ped, G.rng);
      }
      continue;
    }
    // Dive aside when a fast car bears down.
    for (const car of G.cars) {
      if (car.dead) continue;
      const ahead = (ped.x - car.x) * Math.cos(car.angle) + (ped.y - car.y) * Math.sin(car.angle);
      const side = Math.abs((ped.x - car.x) * -Math.sin(car.angle) + (ped.y - car.y) * Math.cos(car.angle));
      if (ahead > 0 && ahead < 90 && side < 24 && Math.hypot(car.vx, car.vy) > 140) {
        ped.state = 'flee';
        ped.fleeFrom = { x: car.x, y: car.y };
        ped.panic = 70;
        break;
      }
    }
    if (ped.state !== 'walk') continue;
    const targetAngle = Math.atan2(ped.target.y - ped.y, ped.target.x - ped.x);
    ped.angle = turnToward(ped.angle, targetAngle, 4 * dt);
    const step = 62;
    const next = moveCircle(G.world, ped.x, ped.y, Math.cos(ped.angle) * step * dt, Math.sin(ped.angle) * step * dt, 10);
    if (next.x === ped.x && next.y === ped.y) {
      ped.target = pickWanderTarget(ped, G.rng);
    }
    ped.x = next.x;
    ped.y = next.y;
    ped.speed = step;
    ped.walkPhase += dt * 6;
  }
}

export function damagePed(G, ped, amount, cause) {
  if (ped.state === 'down') return;
  ped.health -= amount;
  if (ped.health <= 0) {
    ped.health = 0;
    ped.state = 'down';
    ped.downTimer = 99999;
    ped.speed = 0;
    G.particles.dustPuff(ped.x, ped.y, G.rng);
    scarePeds(G, ped.x, ped.y, 320, 80);
    if (cause === 'player') {
      G.police.addHeat(G, 45, 'Pedestrian down');
      G.stats.pedsDown += 1;
    }
    G.missions.onPedDown(G, ped);
  } else {
    ped.state = 'flee';
    ped.fleeFrom = { x: G.player.x, y: G.player.y };
    ped.panic = 100;
  }
}

// Cars running over pedestrians: handled from the car update so the
// impact speed is known.
export function checkCarPedCollisions(G) {
  for (const car of G.cars) {
    if (car.dead) continue;
    const speed = Math.hypot(car.vx, car.vy);
    if (speed < 60) continue;
    for (const ped of G.peds) {
      if (ped.state === 'down' || ped.isCop) continue;
      if (dist(car.x, car.y, ped.x, ped.y) < 26) {
        damagePed(G, ped, 120, car.driver === 'player' ? 'player' : 'traffic');
        if (car.driver === 'player') {
          G.camera.shake(0.2, 5);
          G.audio.crash(0.25);
        }
      }
    }
  }
}
