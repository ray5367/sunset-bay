// combat.js — weapons, bullets, melee, explosions and enemy gunfire.
// Bullets are projectiles with travel time; cars, pedestrians, police and
// the player all take damage from the same code path.

import { clamp, dist, randRange } from './util.js';
import { blockedAt } from './world.js';
import { damageCar } from './vehicles.js';
import { damagePed, scarePeds } from './pedestrians.js';
import { damagePlayer } from './player.js';

export const WEAPONS = {
  fists: { name: 'Fists', damage: 18, rate: 2.2, spread: 0, range: 46, magSize: 0, reloadTime: 0, auto: false, pellets: 1, bulletSpeed: 0 },
  pistol: { name: 'Pistol', damage: 26, rate: 3.2, spread: 0.03, range: 520, magSize: 12, reloadTime: 1.1, auto: false, pellets: 1, bulletSpeed: 900 },
  smg: { name: 'SMG', damage: 15, rate: 10, spread: 0.09, range: 420, magSize: 30, reloadTime: 1.4, auto: true, pellets: 1, bulletSpeed: 950 },
  shotgun: { name: 'Shotgun', damage: 13, rate: 1.3, spread: 0.16, range: 300, magSize: 6, reloadTime: 1.8, auto: false, pellets: 6, bulletSpeed: 820 },
  rifle: { name: 'Rifle', damage: 42, rate: 5.5, spread: 0.02, range: 700, magSize: 30, reloadTime: 1.6, auto: true, pellets: 1, bulletSpeed: 1200 },
};

export function spawnBullet(G, x, y, angle, opts) {
  const o = opts || {};
  const speed = o.speed || 900;
  G.bullets.push({
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: (o.range || 500) / speed,
    damage: o.damage || 20,
    from: o.from || 'player',
    kind: o.kind || 'pistol',
  });
}

export function tryPlayerShoot(G) {
  const player = G.player;
  if (player.car || player.reloadTimer > 0 || player.fireTimer > 0) return;
  const def = WEAPONS[player.weapon];
  if (!def || player.weapon === 'fists') return;
  const state = player.weapons[player.weapon];
  const wantFire = def.auto ? G.input.mouse.down : G.input.mouse.clicked;
  if (!wantFire) return;
  if (state.mag <= 0) {
    G.audio.click();
    G.hud.showMessage('Reload! Press R — or buy ammo at Bay Arms.', 'warn');
    player.fireTimer = 0.3;
    return;
  }
  state.mag -= 1;
  player.fireTimer = 1 / def.rate;
  const gx = player.x + Math.cos(player.aimAngle) * 18;
  const gy = player.y + Math.sin(player.aimAngle) * 18;
  for (let i = 0; i < def.pellets; i += 1) {
    const angle = player.aimAngle + randRange(G.rng, -def.spread, def.spread);
    spawnBullet(G, gx, gy, angle, {
      damage: def.damage, range: def.range, speed: def.bulletSpeed,
      from: 'player', kind: player.weapon,
    });
  }
  G.particles.muzzle(gx, gy, player.aimAngle, G.rng);
  G.audio.shot(player.weapon);
  G.camera.shake(0.08, 2);
  scarePeds(G, player.x, player.y, 420, 70);
  G.police.addHeat(G, 4, 'Shots fired');
  G.stats.shotsFired += 1;
}

export function meleeAttack(G) {
  const player = G.player;
  if (player.car) return;
  G.audio.blip(200, 0.1, 'square', 0.15, 90);
  const reach = 52;
  const arc = 1.1;
  const hit = (x, y) => {
    const d = dist(player.x, player.y, x, y);
    if (d > reach) return false;
    const a = Math.atan2(y - player.y, x - player.x);
    let diff = a - player.aimAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) < arc;
  };
  for (const ped of G.peds) {
    if (ped.state !== 'down' && !ped.isCop && hit(ped.x, ped.y)) {
      damagePed(G, ped, 22, 'player');
      G.particles.dustPuff(ped.x, ped.y, G.rng);
    }
  }
  for (const cop of G.cops) {
    if (cop.ped && cop.ped.state !== 'down' && hit(cop.ped.x, cop.ped.y)) {
      G.police.damageCop(G, cop, 22);
    }
  }
  for (const enemy of G.enemies) {
    if (enemy.health > 0 && hit(enemy.x, enemy.y)) {
      G.missions.damageEnemy(G, enemy, 22);
    }
  }
}

export function enemyShootAt(G, fromX, fromY, targetX, targetY, weaponName, inaccuracy) {
  const def = WEAPONS[weaponName] || WEAPONS.pistol;
  const base = Math.atan2(targetY - fromY, targetX - fromX);
  const angle = base + randRange(G.rng, -inaccuracy, inaccuracy);
  spawnBullet(G, fromX + Math.cos(angle) * 18, fromY + Math.sin(angle) * 18, angle, {
    damage: def.damage * 0.7, range: def.range, speed: def.bulletSpeed,
    from: 'enemy', kind: weaponName,
  });
  G.particles.muzzle(fromX, fromY, angle, G.rng);
  G.audio.shot(weaponName);
}

export function updateBullets(G, dt) {
  for (let i = G.bullets.length - 1; i >= 0; i -= 1) {
    const b = G.bullets[i];
    b.life -= dt;
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;
    let dead = b.life <= 0;
    if (!dead && blockedAt(G.world, nx, ny, 2)) {
      G.particles.sparks(nx, ny, G.rng);
      dead = true;
    }
    if (!dead && b.from === 'player') {
      dead = hitTargets(G, b, nx, ny);
    } else if (!dead && b.from === 'enemy') {
      if (dist(nx, ny, G.player.x, G.player.y) < 14) {
        damagePlayer(G, b.damage, 'shot');
        G.particles.dustPuff(nx, ny, G.rng);
        dead = true;
      }
    }
    if (dead) {
      G.bullets.splice(i, 1);
    } else {
      b.x = nx;
      b.y = ny;
    }
  }
}

function hitTargets(G, b, nx, ny) {
  for (const car of G.cars) {
    if (car.dead) continue;
    if (dist(nx, ny, car.x, car.y) < 26) {
      damageCar(G, car, b.damage, 'shot');
      G.particles.sparks(nx, ny, G.rng);
      if (car.driver === 'traffic' && b.from === 'player') G.police.addHeat(G, 3, 'Shooting at traffic');
      return true;
    }
  }
  for (const ped of G.peds) {
    if (ped.state === 'down' || ped.isCop) continue;
    if (dist(nx, ny, ped.x, ped.y) < 13) {
      damagePed(G, ped, b.damage, 'player');
      G.particles.dustPuff(nx, ny, G.rng);
      return true;
    }
  }
  for (const cop of G.cops) {
    if (cop.ped && cop.ped.state !== 'down' && dist(nx, ny, cop.ped.x, cop.ped.y) < 13) {
      G.police.damageCop(G, cop, b.damage);
      G.particles.dustPuff(nx, ny, G.rng);
      return true;
    }
  }
  for (const enemy of G.enemies) {
    if (enemy.health > 0 && dist(nx, ny, enemy.x, enemy.y) < 13) {
      G.missions.damageEnemy(G, enemy, b.damage);
      G.particles.dustPuff(nx, ny, G.rng);
      return true;
    }
  }
  return false;
}

export function updateExplosions(G) {
  while (G.pendingExplosions.length > 0) {
    const ex = G.pendingExplosions.shift();
    const damageAt = (x, y) => {
      const d = dist(ex.x, ex.y, x, y);
      if (d >= ex.radius) return 0;
      return ex.damage * (1 - (d / ex.radius) * 0.7);
    };
    for (const car of G.cars) {
      if (car.dead) continue;
      const dmg = damageAt(car.x, car.y);
      if (dmg > 5) damageCar(G, car, dmg, 'explosion');
    }
    for (const ped of G.peds) {
      if (ped.state === 'down') continue;
      const dmg = damageAt(ped.x, ped.y);
      if (dmg > 5) damagePed(G, ped, dmg, 'explosion');
    }
    for (const cop of G.cops) {
      if (cop.ped && cop.ped.state !== 'down') {
        const dmg = damageAt(cop.ped.x, cop.ped.y);
        if (dmg > 5) G.police.damageCop(G, cop, dmg);
      }
    }
    for (const enemy of G.enemies) {
      if (enemy.health > 0) {
        const dmg = damageAt(enemy.x, enemy.y);
        if (dmg > 5) G.missions.damageEnemy(G, enemy, dmg);
      }
    }
    const playerDmg = damageAt(G.player.x, G.player.y);
    if (playerDmg > 5) damagePlayer(G, playerDmg, 'explosion');
    scarePeds(G, ex.x, ex.y, 480, 90);
  }
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}
