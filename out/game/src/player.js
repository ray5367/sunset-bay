// player.js — the protagonist on foot: movement, health and armor, cash,
// weapons inventory, getting in and out of cars, and taking damage.

import { clamp, dist } from './util.js';
import { moveCircle } from './world.js';
import { findNearestCar } from './vehicles.js';

export function createPlayer(x, y) {
  return {
    x, y,
    angle: -Math.PI / 2,
    aimAngle: -Math.PI / 2,
    speed: 0,
    walkPhase: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    maxArmor: 100,
    cash: 250,
    car: null,
    weapon: 'pistol',
    weapons: {
      fists: { unlocked: true, mag: Infinity, reserve: Infinity },
      pistol: { unlocked: true, mag: 12, reserve: 60 },
      smg: { unlocked: false, mag: 30, reserve: 90 },
      shotgun: { unlocked: false, mag: 6, reserve: 24 },
      rifle: { unlocked: false, mag: 30, reserve: 90 },
    },
    fireTimer: 0,
    reloadTimer: 0,
    meleeTimer: 0,
    hurtTimer: 0,
    deadTimer: 0,
  };
}

export function unlockWeapon(player, name) {
  if (player.weapons[name]) player.weapons[name].unlocked = true;
}

export function addCash(G, amount) {
  G.player.cash += amount;
  if (amount > 0) G.audio.cash();
}

export function spendCash(G, amount) {
  if (G.player.cash < amount) return false;
  G.player.cash -= amount;
  return true;
}

export function damagePlayer(G, amount, cause) {
  const player = G.player;
  if (G.state !== 'playing' || player.deadTimer > 0) return;
  let remaining = amount;
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, remaining * 0.6);
    player.armor -= absorbed;
    remaining -= absorbed;
  }
  player.health -= remaining;
  player.hurtTimer = 0.5;
  G.camera.shake(0.2, 5);
  if (player.health <= 0) {
    player.health = 0;
    player.deadTimer = 2.2;
    G.audio.missionFail();
  }
}

export function healPlayer(player, amount) {
  player.health = clamp(player.health + amount, 0, player.maxHealth);
}

export function updatePlayerOnFoot(G, dt) {
  const player = G.player;
  const input = G.input;
  if (player.deadTimer > 0) {
    player.deadTimer -= dt;
    if (player.deadTimer <= 0) G.onWasted();
    return;
  }
  player.fireTimer = Math.max(0, player.fireTimer - dt);
  player.meleeTimer = Math.max(0, player.meleeTimer - dt);
  player.hurtTimer = Math.max(0, player.hurtTimer - dt);
  if (player.reloadTimer > 0) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) finishReload(G);
  }

  const mx = input.moveX();
  const my = input.moveY();
  const moving = mx !== 0 || my !== 0;
  const speed = input.running ? 265 : 175;
  if (moving) {
    const len = Math.hypot(mx, my);
    const dx = (mx / len) * speed * dt;
    const dy = (my / len) * speed * dt;
    const next = moveCircle(G.world, player.x, player.y, dx, dy, 12);
    player.x = next.x;
    player.y = next.y;
    player.speed = speed;
    player.walkPhase += dt * (input.running ? 11 : 7);
    if (!input.mouse.down) player.angle = Math.atan2(my, mx);
  } else {
    player.speed = 0;
  }
  // Aim follows the mouse while firing or aiming.
  if (input.mouse.down || input.mouse.rightDown || player.weapon !== 'fists') {
    const worldMouse = G.camera.screenToWorld(input.mouse.x, input.mouse.y);
    player.aimAngle = Math.atan2(worldMouse.y - player.y, worldMouse.x - player.x);
    if (input.mouse.down || input.mouse.rightDown) player.angle = player.aimAngle;
  }

  // Weapon switching.
  const slots = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];
  slots.forEach((name, i) => {
    if (input.wasPressed('Digit' + (i + 1)) && player.weapons[name].unlocked) {
      player.weapon = name;
      player.reloadTimer = 0;
      G.audio.click();
    }
  });
  if (input.wasPressed('KeyR')) startReload(G);
  if (input.wasPressed('KeyF') && player.meleeTimer <= 0) {
    player.meleeTimer = 0.45;
    G.combat.meleeAttack(G);
  }
}

export function startReload(G) {
  const player = G.player;
  const def = G.combat.WEAPONS[player.weapon];
  const state = player.weapons[player.weapon];
  if (!def || !def.magSize || state.mag >= def.magSize || state.reserve <= 0) return;
  if (player.reloadTimer > 0) return;
  player.reloadTimer = def.reloadTime;
  G.audio.reload();
}

function finishReload(G) {
  const player = G.player;
  const def = G.combat.WEAPONS[player.weapon];
  const state = player.weapons[player.weapon];
  const need = def.magSize - state.mag;
  const take = Math.min(need, state.reserve);
  state.mag += take;
  state.reserve -= take;
}

export function tryEnterExitCar(G) {
  const player = G.player;
  if (player.car) {
    exitCar(G);
    return;
  }
  const car = findNearestCar(G, player.x, player.y, 64);
  if (!car) return;
  if (car.driver === 'traffic' || car.driver === 'parked') {
    // Stealing a car the player does not own draws the law.
    const wasOwned = car.owned;
    car.driver = 'player';
    player.car = car;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    if (!wasOwned && !car.mission) {
      car.stolen = true;
      G.police.addHeat(G, 22, 'Grand theft auto');
      G.hud.showMessage('Car stolen — witnesses called the police!', 'bad');
      G.missions.onCarStolen(G, car);
    } else {
      G.hud.showMessage('You got in the ' + car.name + '.', 'info');
    }
    G.audio.click();
  } else if (car.driver === 'none' || car.driver === 'player') {
    car.driver = 'player';
    player.car = car;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    G.audio.click();
  }
}

export function exitCar(G) {
  const player = G.player;
  const car = player.car;
  if (!car) return;
  player.car = null;
  car.driver = 'none';
  car.vx *= 0.2;
  car.vy *= 0.2;
  const sideX = car.x - Math.sin(car.angle) * 34;
  const sideY = car.y + Math.cos(car.angle) * 34;
  const next = moveCircle(G.world, car.x, car.y, sideX - car.x, sideY - car.y, 12);
  player.x = next.x;
  player.y = next.y;
  player.speed = 0;
  G.audio.click();
}

export function nearestInteractable(G) {
  const player = G.player;
  for (const marker of G.world.markers) {
    if (dist(player.x, player.y, marker.x, marker.y) < 70) return marker;
  }
  return null;
}
