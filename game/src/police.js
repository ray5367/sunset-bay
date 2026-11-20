// police.js — the wanted system: heat, stars, pursuing cruisers, cops on
// foot, busts, and the police helicopter at five stars.

import { clamp, dist, randRange, turnToward } from './util.js';
import { ROADS, blockedAt, moveCircle } from './world.js';
import { createCar, carSpeed, driveCar } from './vehicles.js';
import { createPed, scarePeds } from './pedestrians.js';
import { heatMultiplier } from './respect.js';

const STAR_HEAT = [12, 30, 50, 70, 88];

export function createWanted() {
  return { heat: 0, stars: 0, unseenTimer: 0, bustProgress: 0, evading: false };
}

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 0; i < STAR_HEAT.length; i += 1) {
    if (heat >= STAR_HEAT[i]) stars = i + 1;
  }
  return stars;
}

export function addHeat(G, amount, reason) {
  const wanted = G.wanted;
  const before = wanted.stars;
  // District standing (and Kingpin rank) slows how fast heat builds.
  wanted.heat = clamp(wanted.heat + amount * heatMultiplier(G), 0, 100);
  wanted.stars = starsForHeat(wanted.heat);
  wanted.unseenTimer = 0;
  if (wanted.stars > before) {
    G.hud.showMessage('Wanted level ' + wanted.stars + ' — ' + (reason || 'the heat is on') + '!', 'bad');
    G.audio.blip(520, 0.15, 'square', 0.15, 780);
  }
}

export function clearWanted(G, reason) {
  G.wanted.heat = 0;
  G.wanted.stars = 0;
  G.wanted.bustProgress = 0;
  G.wanted.evading = false;
  G.cops.length = 0;
  G.heli = null;
  G.audio.siren(false);
  if (reason) G.hud.showMessage(reason, 'good');
}

function desiredCopCount(stars) {
  return [0, 1, 2, 3, 4, 5][stars] || 0;
}

function spawnCop(G) {
  // Spawn on a road ring around the player, never in a wall.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const angle = G.rng() * Math.PI * 2;
    const radius = randRange(G.rng, 480, 700);
    const x = G.player.x + Math.cos(angle) * radius;
    const y = G.player.y + Math.sin(angle) * radius;
    if (x < 60 || y < 60 || x > 3540 || y > 3480) continue;
    const roadX = ROADS.reduce((a, b) => (Math.abs(x - b) < Math.abs(x - a) ? b : a));
    const roadY = ROADS.reduce((a, b) => (Math.abs(y - b) < Math.abs(y - a) ? b : a));
    const snapX = Math.abs(x - roadX) < Math.abs(y - roadY);
    const sx = snapX ? roadX : x;
    const sy = snapX ? y : roadY;
    if (blockedAt(G.world, sx, sy, 26)) continue;
    const car = createCar('cruiser', sx, sy, Math.atan2(G.player.y - sy, G.player.x - sx), { driver: 'police' });
    car.siren = true;
    G.cars.push(car);
    const ped = createPed(sx, sy, G.rng);
    ped.isCop = true;
    ped.shirt = '#1e3799';
    ped.pants = '#2c3e50';
    ped.state = 'idle';
    G.cops.push({ car, ped, state: 'pursue', shootTimer: 1, bustTimer: 0, inCar: true });
    return;
  }
}

export function updateWanted(G, dt) {
  const wanted = G.wanted;
  if (wanted.stars === 0) {
    wanted.heat = Math.max(0, wanted.heat - dt * 3);
    return;
  }
  // Seen if any cop or the helicopter is close enough to watch the player.
  let seen = !!G.heli;
  for (const cop of G.cops) {
    const px = cop.inCar ? cop.car.x : cop.ped.x;
    const py = cop.inCar ? cop.car.y : cop.ped.y;
    if (dist(px, py, G.player.x, G.player.y) < 460) {
      seen = true;
      break;
    }
  }
  if (seen) {
    wanted.unseenTimer = 0;
    wanted.evading = false;
  } else {
    wanted.unseenTimer += dt;
    if (wanted.unseenTimer > 2 && !wanted.evading) {
      wanted.evading = true;
      G.hud.showMessage('Evade the police — stay out of sight!', 'warn');
    }
    if (wanted.unseenTimer > 6) {
      wanted.heat = Math.max(0, wanted.heat - dt * 5);
      const stars = starsForHeat(wanted.heat);
      if (stars < wanted.stars) {
        wanted.stars = stars;
        G.hud.showMessage('Wanted level down to ' + stars + '.', 'good');
      }
      if (wanted.heat <= 0) {
        wanted.stars = 0;
        wanted.evading = false;
        G.cops.length = 0;
        G.heli = null;
        G.audio.siren(false);
        G.hud.showMessage('You lost the cops.', 'good');
      }
    }
  }
}

export function updatePolice(G, dt) {
  const want = desiredCopCount(G.wanted.stars);
  // Remove downed cops' units slowly; spawn up to the desired count.
  for (let i = G.cops.length - 1; i >= 0; i -= 1) {
    const cop = G.cops[i];
    if (cop.ped.state === 'down' && cop.car.dead) G.cops.splice(i, 1);
  }
  if (G.cops.length < want && G.wanted.stars > 0) {
    spawnCop(G);
  }
  if (G.cops.length > want) {
    // Extra units give up the chase when heat falls.
    const extra = G.cops[G.cops.length - 1];
    const d = dist(extra.car.x, extra.car.y, G.player.x, G.player.y);
    if (d > 700) {
      // The car may already be gone (wrecked/exploded): indexOf -1 would
      // make splice remove the last car in the list instead.
      const ci = G.cars.indexOf(extra.car);
      if (ci >= 0) G.cars.splice(ci, 1);
      G.cops.pop();
    }
  }
  G.audio.siren(G.cops.length > 0);
  G.audio.updateSirenTone(G.time);

  // Helicopter at five stars: follows overhead, keeps the player seen.
  if (G.wanted.stars >= 5) {
    if (!G.heli) G.heli = { x: G.player.x - 300, y: G.player.y - 300, angle: 0 };
    const heli = G.heli;
    heli.x += (G.player.x - heli.x) * Math.min(1, dt * 0.9);
    heli.y += (G.player.y - heli.y) * Math.min(1, dt * 0.9);
    heli.angle += dt * 0.4;
  } else if (G.heli) {
    G.heli = null;
  }

  for (const cop of G.cops) {
    updateCop(G, cop, dt);
  }
  updateBust(G, dt);
}

function updateCop(G, cop, dt) {
  const player = G.player;
  if (cop.ped.state === 'down') return;
  const dCar = dist(cop.car.x, cop.car.y, player.x, player.y);

  if (cop.inCar) {
    // Leave the car to chase on foot when the player is on foot and close.
    if (!player.car && dCar < 130 && G.wanted.stars >= 1) {
      cop.inCar = false;
      cop.ped.x = cop.car.x + 30;
      cop.ped.y = cop.car.y;
      cop.ped.state = 'walk';
      cop.car.driver = 'none';
      cop.car.vx = 0;
      cop.car.vy = 0;
      return;
    }
    // Pursuit driving: seek the player, probe ahead for walls.
    const targetAngle = Math.atan2(player.y - cop.car.y, player.x - cop.car.x);
    let steerAngle = targetAngle;
    const probe = 70;
    const px = cop.car.x + Math.cos(targetAngle) * probe;
    const py = cop.car.y + Math.sin(targetAngle) * probe;
    if (blockedAt(G.world, px, py, 20)) {
      for (const offset of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const ax = cop.car.x + Math.cos(targetAngle + offset) * probe;
        const ay = cop.car.y + Math.sin(targetAngle + offset) * probe;
        if (!blockedAt(G.world, ax, ay, 20)) {
          steerAngle = targetAngle + offset;
          break;
        }
      }
    }
    let diff = steerAngle - cop.car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(-diff * 2.2, -1, 1);
    let throttle = 0.9;
    if (dCar < 60) throttle = 0.3;
    if (player.car && dCar < 40) throttle = 1; // ram the getaway car
    driveCar(G, cop.car, throttle, steer, dt);
    cop.car.siren = true;
    // Ram damage to the player's car.
    if (player.car && dCar < 44 && carSpeed(cop.car) > 120) {
      G.camera.shake(0.15, 4);
    }
  } else {
    // On foot: chase, shoot at 3+ stars, return to the car if it drives off.
    const ped = cop.ped;
    const d = dist(ped.x, ped.y, player.x, player.y);
    if (player.car && d > 260) {
      const cd = dist(ped.x, ped.y, cop.car.x, cop.car.y);
      if (cd < 40) {
        cop.inCar = true;
        cop.car.driver = 'police';
        ped.state = 'idle';
        return;
      }
      const target = Math.atan2(cop.car.y - ped.y, cop.car.x - ped.x);
      ped.angle = turnToward(ped.angle, target, 6 * dt);
      const next = moveCircle(G.world, ped.x, ped.y, Math.cos(ped.angle) * 250 * dt, Math.sin(ped.angle) * 250 * dt, 10);
      ped.x = next.x;
      ped.y = next.y;
      ped.walkPhase += dt * 12;
      return;
    }
    const target = Math.atan2(player.y - ped.y, player.x - ped.x);
    ped.angle = turnToward(ped.angle, target, 6 * dt);
    const speed = d > 30 ? 235 : 0;
    const next = moveCircle(G.world, ped.x, ped.y, Math.cos(ped.angle) * speed * dt, Math.sin(ped.angle) * speed * dt, 10);
    ped.x = next.x;
    ped.y = next.y;
    ped.speed = speed;
    ped.walkPhase += dt * 11;
    if (G.wanted.stars >= 3 && d < 380 && d > 40) {
      cop.shootTimer -= dt;
      if (cop.shootTimer <= 0) {
        cop.shootTimer = randRange(G.rng, 0.7, 1.4);
        G.combat.enemyShootAt(G, ped.x, ped.y, player.x, player.y, 'pistol', 0.16);
      }
    }
  }
}

function updateBust(G, dt) {
  const wanted = G.wanted;
  if (wanted.stars === 0) {
    wanted.bustProgress = 0;
    return;
  }
  const player = G.player;
  let closing = false;
  if (!player.car && player.speed < 70) {
    for (const cop of G.cops) {
      if (!cop.inCar && cop.ped.state !== 'down' && dist(cop.ped.x, cop.ped.y, player.x, player.y) < 52) {
        closing = true;
        break;
      }
    }
  } else if (player.car && carSpeed(player.car) < 25) {
    let near = 0;
    for (const cop of G.cops) {
      if (dist(cop.car.x, cop.car.y, player.x, player.y) < 90) near += 1;
    }
    closing = near >= 2;
  }
  if (closing) {
    wanted.bustProgress += dt / 2.6;
    if (wanted.bustProgress >= 1) {
      wanted.bustProgress = 0;
      G.onBusted();
    }
  } else {
    wanted.bustProgress = Math.max(0, wanted.bustProgress - dt * 0.8);
  }
}

export function damageCop(G, cop, amount) {
  const ped = cop.ped;
  if (ped.state === 'down') return;
  ped.health -= amount;
  addHeat(G, 8, 'Attacking an officer');
  if (ped.health <= 0) {
    ped.health = 0;
    ped.state = 'down';
    ped.downTimer = 99999;
    G.particles.dustPuff(ped.x, ped.y, G.rng);
    scarePeds(G, ped.x, ped.y, 300, 80);
    addHeat(G, 40, 'Officer down');
    G.stats.copsDown += 1;
    G.missions.onCopDown(G, cop);
    if (cop.inCar) {
      cop.inCar = false;
      cop.car.driver = 'none';
      cop.car.vx = 0;
      cop.car.vy = 0;
    }
  }
}
