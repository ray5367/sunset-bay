// vehicles.js — car physics, traffic that follows the road grid, parked
// cars to steal, collisions, damage, fire and explosions.

import { clamp, dist, pick, randRange, turnToward } from './util.js';
import { ROADS, blockedAt, lightState, surfaceAt } from './world.js';

export const VEHICLE_TYPES = {
  sedan: { name: 'Bayside Sedan', length: 46, width: 22, accel: 240, maxSpeed: 340, handling: 2.4, brake: 420, colors: ['#7f8c8d', '#5b6b7a', '#8d6e63', '#4a6572', '#6d7c5f'] },
  coupe: { name: 'Sunset Coupe', length: 44, width: 21, accel: 300, maxSpeed: 400, handling: 2.8, brake: 460, colors: ['#c0392b', '#2980b9', '#f39c12', '#8e44ad', '#16a085'] },
  taxi: { name: 'Bay Cab', length: 46, width: 22, accel: 250, maxSpeed: 350, handling: 2.5, brake: 430, colors: ['#f1c40f'] },
  van: { name: 'Cargo Van', length: 52, width: 24, accel: 190, maxSpeed: 280, handling: 2.0, brake: 360, colors: ['#ecf0f1', '#95a5a6', '#7f8c8d'] },
  pickup: { name: 'Rancher Pickup', length: 50, width: 23, accel: 230, maxSpeed: 320, handling: 2.2, brake: 400, colors: ['#a93226', '#1e8449', '#2c3e50'] },
  sports: { name: 'Vortex GT', length: 44, width: 21, accel: 380, maxSpeed: 520, handling: 3.2, brake: 520, colors: ['#e74c3c', '#f5f6fa', '#e67e22', '#00cec9'] },
  muscle: { name: 'Road King', length: 48, width: 23, accel: 320, maxSpeed: 420, handling: 2.5, brake: 440, colors: ['#2d3436', '#d63031', '#0984e3'] },
  cruiser: { name: 'Police Cruiser', length: 47, width: 22, accel: 330, maxSpeed: 470, handling: 2.9, brake: 500, colors: ['#1e3799'] },
  truck: { name: 'Haul Truck', length: 58, width: 25, accel: 160, maxSpeed: 260, handling: 1.8, brake: 330, colors: ['#f0932b', '#eb4d4b', '#6ab04c'] },
};

let nextCarId = 1;

export function createCar(type, x, y, angle, opts) {
  const def = VEHICLE_TYPES[type];
  const o = opts || {};
  return {
    id: nextCarId,
    type,
    name: def.name,
    x, y, angle,
    vx: 0, vy: 0,
    speed: 0,
    health: o.health === undefined ? 100 : o.health,
    maxHealth: 100,
    color: o.color || def.colors[0],
    driver: o.driver || 'none', // player | traffic | parked | police | none
    owned: !!o.owned,
    mission: !!o.mission,
    dead: false,
    onFire: false,
    explodeTimer: -1,
    smokeTimer: 0,
    honkTimer: 0,
    waypoint: null,
    cruiseSpeed: 0,
    brakeLights: false,
    siren: false,
    lastSkid: 0,
  };
}

export function carSpeed(car) {
  return Math.hypot(car.vx, car.vy);
}

// Traffic cars pick neighbouring intersections as waypoints.
export function spawnTrafficCars(world, rng, count) {
  const cars = [];
  const types = ['sedan', 'coupe', 'taxi', 'van', 'pickup', 'truck'];
  for (let i = 0; i < count; i += 1) {
    const ix = Math.floor(rng() * ROADS.length);
    const iy = Math.floor(rng() * ROADS.length);
    const type = pick(rng, types);
    const car = createCar(type, ROADS[ix], ROADS[iy], 0, { driver: 'traffic' });
    car.color = pick(rng, VEHICLE_TYPES[type].colors);
    car.cruiseSpeed = randRange(rng, 110, 160);
    pickNextWaypoint(car, rng);
    cars.push(car);
  }
  return cars;
}

function pickNextWaypoint(car, rng) {
  const ix = nearestRoadIndex(car.x);
  const iy = nearestRoadIndex(car.y);
  const options = [];
  if (ix > 0) options.push([ix - 1, iy]);
  if (ix < ROADS.length - 1) options.push([ix + 1, iy]);
  if (iy > 0) options.push([ix, iy - 1]);
  if (iy < ROADS.length - 1) options.push([ix, iy + 1]);
  const [nx, ny] = pick(rng, options);
  const tx = ROADS[nx];
  const ty = ROADS[ny];
  // Right-hand lane: offset the target to the right of travel.
  const dx = tx - car.x;
  const dy = ty - car.y;
  const len = Math.hypot(dx, dy) || 1;
  const rx = -dy / len;
  const ry = dx / len;
  car.waypoint = { x: tx + rx * 22, y: ty + ry * 22, ix: nx, iy: ny };
}

function nearestRoadIndex(value) {
  let best = 0;
  for (let i = 0; i < ROADS.length; i += 1) {
    if (Math.abs(value - ROADS[i]) < Math.abs(value - ROADS[best])) best = i;
  }
  return best;
}

export function spawnParkedCars(world, rng, count) {
  const cars = [];
  const types = ['sedan', 'coupe', 'van', 'pickup', 'muscle', 'sports'];
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 40) {
    guard += 1;
    const lot = world.lots[Math.floor(rng() * world.lots.length)];
    const useLot = lot && rng() < 0.6;
    let x;
    let y;
    let angle;
    if (useLot) {
      x = randRange(rng, lot.x0 + 30, lot.x1 - 30);
      y = randRange(rng, lot.y0 + 30, lot.y1 - 30);
      angle = rng() < 0.5 ? 0 : Math.PI / 2;
    } else {
      const road = pick(rng, ROADS);
      const along = randRange(rng, 120, 3480);
      const side = rng() < 0.5 ? 1 : -1;
      if (rng() < 0.5) {
        x = along;
        y = road + side * (45 + 14);
        angle = side > 0 ? 0 : Math.PI;
      } else {
        x = road + side * (45 + 14);
        y = along;
        angle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    if (blockedAt(world, x, y, 26)) continue;
    const type = pick(rng, types);
    const car = createCar(type, x, y, angle, { driver: 'parked' });
    car.color = pick(rng, VEHICLE_TYPES[type].colors);
    cars.push(car);
    placed += 1;
  }
  return cars;
}

function carRadius(car) {
  return VEHICLE_TYPES[car.type].length * 0.42;
}

function collideWithWorld(G, car, nx, ny) {
  const def = VEHICLE_TYPES[car.type];
  const half = def.length / 2 - 4;
  const noseX = nx + Math.cos(car.angle) * half;
  const noseY = ny + Math.sin(car.angle) * half;
  const tailX = nx - Math.cos(car.angle) * half;
  const tailY = ny - Math.sin(car.angle) * half;
  const r = def.width / 2;
  if (blockedAt(G.world, noseX, noseY, r) || blockedAt(G.world, tailX, tailY, r) || blockedAt(G.world, nx, ny, r)) {
    return true;
  }
  return false;
}

function collideCars(G, car) {
  for (const other of G.cars) {
    if (other === car || other.dead) continue;
    const rr = carRadius(car) + carRadius(other);
    const d = dist(car.x, car.y, other.x, other.y);
    if (d < rr && d > 0.01) {
      const push = (rr - d) / 2;
      const ux = (car.x - other.x) / d;
      const uy = (car.y - other.y) / d;
      car.x += ux * push;
      car.y += uy * push;
      other.x -= ux * push;
      other.y -= uy * push;
      const impact = Math.abs(carSpeed(car) - carSpeed(other));
      if (impact > 60) {
        damageCar(G, car, impact * 0.05, 'crash');
        damageCar(G, other, impact * 0.05, 'crash');
        G.particles.sparks((car.x + other.x) / 2, (car.y + other.y) / 2, G.rng);
        G.audio.crash(impact / 400);
        if (G.player.car === car || G.player.car === other) G.camera.shake(0.25, 6);
      }
      // Exchange some velocity along the impact normal.
      const avg = (carSpeed(car) + carSpeed(other)) / 2;
      car.vx = ux * avg * 0.4;
      car.vy = uy * avg * 0.4;
      other.vx = -ux * avg * 0.4;
      other.vy = -uy * avg * 0.4;
    }
  }
}

// Shared arcade driving model. throttle -1..1, steer -1..1 (left positive).
export function driveCar(G, car, throttle, steer, dt) {
  const def = VEHICLE_TYPES[car.type];
  const surface = surfaceAt(car.x, car.y);
  const grip = surface === 'sand' ? 0.45 : surface === 'road' ? 1 : 0.8;
  const maxSpeed = def.maxSpeed * grip;
  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const speedAlong = car.vx * forwardX + car.vy * forwardY;
  const accel = throttle >= 0 ? def.accel * throttle : def.brake * throttle;
  let newAlong = speedAlong + accel * dt;
  newAlong = clamp(newAlong, -def.maxSpeed * 0.35, maxSpeed);
  // Steering: sharper at moderate speed, none standing still.
  const speedFactor = clamp(Math.abs(newAlong) / 160, 0, 1);
  car.angle += steer * def.handling * speedFactor * dt * (newAlong < 0 ? -1 : 1);
  const nfx = Math.cos(car.angle);
  const nfy = Math.sin(car.angle);
  // Lateral grip: bleed sideways velocity, more on road, less drifting.
  const latX = car.vx - speedAlong * forwardX;
  const latY = car.vy - speedAlong * forwardY;
  const gripBlend = clamp(6 * grip * dt, 0, 1);
  car.vx = nfx * newAlong + latX * (1 - gripBlend);
  car.vy = nfy * newAlong + latY * (1 - gripBlend);
  // Rolling drag.
  const drag = Math.pow(0.55, dt);
  car.vx *= drag;
  car.vy *= drag;
  car.speed = carSpeed(car);
  const nx = car.x + car.vx * dt;
  const ny = car.y + car.vy * dt;
  if (!collideWithWorld(G, car, nx, ny)) {
    car.x = nx;
    car.y = ny;
  } else {
    const impact = car.speed;
    car.vx *= -0.25;
    car.vy *= -0.25;
    car.speed = carSpeed(car);
    if (impact > 90) {
      damageCar(G, car, impact * 0.06, 'crash');
      G.particles.sparks(nx, ny, G.rng);
      G.audio.crash(impact / 450);
      if (G.player.car === car) G.camera.shake(0.3, 8);
    }
  }
  collideCars(G, car);
  // Skid marks while sliding hard.
  const lateral = Math.abs(car.vx * -nfy + car.vy * nfx);
  if (car.speed > 200 && lateral > 60) {
    const bx = car.x - nfx * (def.length / 2);
    const by = car.y - nfy * (def.length / 2);
    if (car.lastSkid) G.particles.addSkid(car.lastSkid.x, car.lastSkid.y, bx, by);
    car.lastSkid = { x: bx, y: by };
  } else {
    car.lastSkid = 0;
  }
  car.brakeLights = throttle < -0.1 || (throttle < 0.1 && car.speed > 60 && car.driver === 'traffic');
}

export function updateTraffic(G, dt) {
  for (const car of G.cars) {
    if (car.driver !== 'traffic' || car.dead) continue;
    if (!car.waypoint) pickNextWaypoint(car, G.rng);
    const wp = car.waypoint;
    const d = dist(car.x, car.y, wp.x, wp.y);
    if (d < 26) {
      pickNextWaypoint(car, G.rng);
      continue;
    }
    const targetAngle = Math.atan2(wp.y - car.y, wp.x - car.x);
    const steer = clamp((() => {
      let diff = targetAngle - car.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      return -diff * 2;
    })(), -1, 1);
    let throttle = 0.55;
    // Red lights: stop before the intersection.
    for (const light of G.world.lights) {
      const ld = dist(car.x, car.y, light.x, light.y);
      if (ld > 40 && ld < 110) {
        const state = lightState(light, G.time);
        const movingAlongX = Math.abs(Math.cos(car.angle)) > 0.7;
        const redForMe = (movingAlongX && state === 0) || (!movingAlongX && state === 1);
        const approaching = (light.x - car.x) * Math.cos(car.angle) + (light.y - car.y) * Math.sin(car.angle) > 0;
        if (redForMe && approaching) throttle = -0.6;
      }
    }
    // Car ahead: slow down.
    for (const other of G.cars) {
      if (other === car || other.dead) continue;
      const ahead = (other.x - car.x) * Math.cos(car.angle) + (other.y - car.y) * Math.sin(car.angle);
      const side = Math.abs((other.x - car.x) * -Math.sin(car.angle) + (other.y - car.y) * Math.cos(car.angle));
      if (ahead > 0 && ahead < 70 && side < 26) {
        throttle = Math.min(throttle, carSpeed(other) > car.speed ? 0.3 : -0.5);
      }
    }
    // Pedestrian ahead: brake.
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      const ahead = (ped.x - car.x) * Math.cos(car.angle) + (ped.y - car.y) * Math.sin(car.angle);
      const side = Math.abs((ped.x - car.x) * -Math.sin(car.angle) + (ped.y - car.y) * Math.cos(car.angle));
      if (ahead > 0 && ahead < 55 && side < 20) throttle = -0.7;
    }
    if (car.speed > car.cruiseSpeed) throttle = Math.min(throttle, 0.1);
    driveCar(G, car, throttle, steer, dt);
    // Honk when stuck behind the player.
    if (car.speed < 20 && throttle < 0) {
      car.honkTimer -= dt;
      if (car.honkTimer <= 0) {
        car.honkTimer = 3;
        if (dist(car.x, car.y, G.player.x, G.player.y) < 300) G.audio.horn();
      }
    }
  }
}

export function damageCar(G, car, amount, cause) {
  if (car.dead || amount <= 0) return;
  car.health -= amount;
  if (car.health <= 35 && !car.onFire && car.health > 0) {
    car.onFire = true;
  }
  if (car.health <= 0 && car.explodeTimer < 0) {
    car.explodeTimer = 1.6;
    car.onFire = true;
  }
}

export function updateCarDamage(G, dt) {
  for (const car of G.cars) {
    if (car.dead) continue;
    if (car.onFire) {
      car.smokeTimer -= dt;
      if (car.smokeTimer <= 0) {
        car.smokeTimer = 0.08;
        G.particles.smoke(car.x + randRange(G.rng, -8, 8), car.y + randRange(G.rng, -8, 8), G.rng);
        if (car.health <= 0) {
          G.particles.burst(car.x, car.y, 2, {
            minSpeed: 10, maxSpeed: 50, minLife: 0.3, maxLife: 0.6,
            minSize: 4, maxSize: 9, color: '#ff7a2a', glow: true,
          }, G.rng);
        }
      }
    }
    if (car.explodeTimer >= 0) {
      car.explodeTimer -= dt;
      if (car.explodeTimer < 0) explodeCar(G, car);
    }
  }
}

export function explodeCar(G, car) {
  if (car.dead) return;
  car.dead = true;
  car.health = 0;
  G.particles.explosion(car.x, car.y, G.rng);
  G.audio.explosion();
  G.camera.shake(0.5, 14);
  G.pendingExplosions.push({ x: car.x, y: car.y, radius: 130, damage: 70, cause: 'car' });
  if (G.player.car === car) {
    G.player.car = null;
    G.player.x = car.x + 40;
    G.player.y = car.y;
  }
  // Burning wreck stays on the street for a while.
  G.wrecks.push({ x: car.x, y: car.y, angle: car.angle, type: car.type, life: 25 });
}

export function findNearestCar(G, x, y, maxDist, filter) {
  let best = null;
  let bestD = maxDist;
  for (const car of G.cars) {
    if (car.dead) continue;
    if (filter && !filter(car)) continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

export function steerTowardPoint(car, tx, ty, maxTurn, dt) {
  const target = Math.atan2(ty - car.y, tx - car.x);
  car.angle = turnToward(car.angle, target, maxTurn * dt);
}
