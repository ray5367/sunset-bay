// render.js — the camera and every drawing routine: the city, the beach,
// vehicles, people, the police helicopter, mission markers, lighting and
// the waypoint arrow. All art is drawn in code; no image files are used.

import { clamp, dist, lerp } from './util.js';
import { ROADS, ROAD_HALF, BEACH_TOP, WATER_TOP, WORLD_SIZE, lightState } from './world.js';
import { VEHICLE_TYPES, carSpeed } from './vehicles.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.shakeT = 0;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  shake(time, mag) {
    this.shakeT = Math.max(this.shakeT, time);
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  update(followX, followY, speed, driving, dt, viewW, viewH, settings) {
    const targetZoom = driving ? 0.86 : 1;
    this.zoom = lerp(this.zoom, targetZoom, Math.min(1, dt * 2));
    const vw = viewW / this.zoom;
    const vh = viewH / this.zoom;
    const tx = clamp(followX - vw / 2, 0, WORLD_SIZE - vw);
    const ty = clamp(followY - vh / 2, 0, WORLD_SIZE - vh);
    this.x = lerp(this.x, tx, Math.min(1, dt * 5));
    this.y = lerp(this.y, ty, Math.min(1, dt * 5));
    if (this.shakeT > 0 && settings.screenShake) {
      this.shakeT -= dt;
      this.shakeX = (Math.random() - 0.5) * 2 * this.shakeMag * (this.shakeT > 0 ? 1 : 0);
      this.shakeY = (Math.random() - 0.5) * 2 * this.shakeMag * (this.shakeT > 0 ? 1 : 0);
      if (this.shakeT <= 0) this.shakeMag = 0;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  apply(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom, -(this.x + this.shakeX) * this.zoom, -(this.y + this.shakeY) * this.zoom);
  }

  screenToWorld(mx, my) {
    return {
      x: this.x + this.shakeX + mx / this.zoom,
      y: this.y + this.shakeY + my / this.zoom,
    };
  }

  visibleRect(viewW, viewH) {
    return {
      x0: this.x - 60, y0: this.y - 60,
      x1: this.x + viewW / this.zoom + 60, y1: this.y + viewH / this.zoom + 60,
    };
  }
}

export function daylight(minutes) {
  const hour = (minutes / 60) % 24;
  // Daylight holds full strength through the afternoon, fades over
  // 17:00-20:00 into night, and returns over 05:00-07:00.
  let day = 0;
  if (hour >= 7 && hour <= 17) day = 1;
  else if (hour > 17 && hour < 20) day = 1 - (hour - 17) / 3;
  else if (hour >= 5 && hour < 7) day = (hour - 5) / 2;
  const golden = hour >= 16 && hour <= 19 ? 1 - Math.abs(hour - 17.5) / 1.5 : 0;
  const darkness = clamp((1 - day) * 0.52, 0, 0.52);
  return { sun: day, golden: clamp(golden, 0, 1), darkness };
}

function inView(rect, x, y, pad) {
  return x > rect.x0 - pad && x < rect.x1 + pad && y > rect.y0 - pad && y < rect.y1 + pad;
}

export function drawScene(G, ctx, viewW, viewH) {
  const camera = G.camera;
  const rect = camera.visibleRect(viewW, viewH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a2233';
  ctx.fillRect(0, 0, viewW, viewH);
  camera.apply(ctx);

  drawGround(G, ctx, rect);
  drawRoads(G, ctx, rect);
  drawProps(G, ctx, rect);
  drawBuildings(G, ctx, rect);
  G.particles.drawSkids(ctx);
  drawMarkers(G, ctx);
  drawPickups(G, ctx, rect);
  drawWrecks(G, ctx, rect);
  for (const car of G.cars) {
    if (!car.dead && inView(rect, car.x, car.y, 80)) drawCarFigure(ctx, car, G.time);
  }
  for (const ped of G.peds) {
    if (inView(rect, ped.x, ped.y, 40)) drawPedFigure(ctx, ped, G.time);
  }
  for (const cop of G.cops) {
    if (!cop.inCar && cop.ped.state !== 'down' && inView(rect, cop.ped.x, cop.ped.y, 40)) drawCopFigure(ctx, cop.ped, G.time);
    if (!cop.inCar && cop.ped.state === 'down' && inView(rect, cop.ped.x, cop.ped.y, 40)) drawDownFigure(ctx, cop.ped);
  }
  for (const enemy of G.enemies) {
    if (enemy.health > 0 && inView(rect, enemy.x, enemy.y, 40)) drawEnemyFigure(ctx, enemy, G.time);
  }
  if (!G.player.car) drawPlayerFigure(ctx, G.player, G.time);
  drawBullets(G, ctx);
  G.particles.draw(ctx);
  if (G.heli) drawHelicopter(ctx, G.heli, G.player, G.time);
  drawLighting(G, ctx, rect, viewW, viewH);
  drawWaypointArrow(G, ctx, viewW, viewH);
}

function drawGround(G, ctx, rect) {
  // Base pavement.
  ctx.fillStyle = '#a8a49a';
  ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  // Parks.
  for (const park of G.world.parks) {
    ctx.fillStyle = '#7fae5c';
    ctx.fillRect(park.x0, park.y0, park.x1 - park.x0, park.y1 - park.y0);
    ctx.fillStyle = '#8fbf6b';
    ctx.fillRect(park.x0 + 14, park.y0 + 14, park.x1 - park.x0 - 28, park.y1 - park.y0 - 28);
  }
  // Parking lots.
  for (const lot of G.world.lots) {
    ctx.fillStyle = '#8f8b82';
    ctx.fillRect(lot.x0, lot.y0, lot.x1 - lot.x0, lot.y1 - lot.y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    for (let x = lot.x0 + 30; x < lot.x1 - 10; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, lot.y0 + 12);
      ctx.lineTo(x, lot.y0 + 40);
      ctx.stroke();
    }
  }
  // Beach sand and water.
  ctx.fillStyle = '#e8d5a3';
  ctx.fillRect(rect.x0, BEACH_TOP, rect.x1 - rect.x0, WATER_TOP - BEACH_TOP);
  const wave = Math.sin(G.time * 1.4) * 4;
  ctx.fillStyle = '#3f8fbf';
  ctx.fillRect(rect.x0, WATER_TOP + wave, rect.x1 - rect.x0, WORLD_SIZE - WATER_TOP);
  ctx.fillStyle = '#5aa8d6';
  for (let x = Math.floor(rect.x0 / 90) * 90; x < rect.x1; x += 90) {
    const wobble = Math.sin(G.time * 1.8 + x * 0.05) * 3;
    ctx.fillRect(x, WATER_TOP + 14 + wobble, 46, 3);
    ctx.fillRect(x + 30, WATER_TOP + 34 - wobble, 40, 3);
  }
  // Docks concrete.
  ctx.fillStyle = '#9a938a';
  ctx.fillRect(3420, rect.y0, WORLD_SIZE - 3420, rect.y1 - rect.y0);
}

function drawRoads(G, ctx, rect) {
  ctx.fillStyle = '#3c414c';
  for (const road of ROADS) {
    ctx.fillRect(rect.x0, road - ROAD_HALF, rect.x1 - rect.x0, ROAD_HALF * 2);
    ctx.fillRect(road - ROAD_HALF, rect.y0, ROAD_HALF * 2, rect.y1 - rect.y0);
  }
  // Sidewalk edges.
  ctx.fillStyle = '#c9c4b8';
  for (const road of ROADS) {
    ctx.fillRect(rect.x0, road - ROAD_HALF - 8, rect.x1 - rect.x0, 8);
    ctx.fillRect(rect.x0, road + ROAD_HALF, rect.x1 - rect.x0, 8);
    ctx.fillRect(road - ROAD_HALF - 8, rect.y0, 8, rect.y1 - rect.y0);
    ctx.fillRect(road + ROAD_HALF, rect.y0, 8, rect.y1 - rect.y0);
  }
  // Center dashes.
  ctx.strokeStyle = '#e8c85a';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  for (const road of ROADS) {
    ctx.beginPath();
    ctx.moveTo(rect.x0, road);
    ctx.lineTo(rect.x1, road);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(road, rect.y0);
    ctx.lineTo(road, rect.y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Crosswalks at intersections.
  ctx.fillStyle = 'rgba(240, 240, 235, 0.75)';
  for (const rx of ROADS) {
    for (const ry of ROADS) {
      if (!inView(rect, rx, ry, 120)) continue;
      for (let k = -2; k <= 2; k += 1) {
        ctx.fillRect(rx - ROAD_HALF + 6, ry + k * 14 - 4, 18, 8);
        ctx.fillRect(rx + ROAD_HALF - 24, ry + k * 14 - 4, 18, 8);
        ctx.fillRect(rx + k * 14 - 4, ry - ROAD_HALF + 6, 8, 18);
        ctx.fillRect(rx + k * 14 - 4, ry + ROAD_HALF - 24, 8, 18);
      }
    }
  }
  // Traffic lights.
  for (const light of G.world.lights) {
    if (!inView(rect, light.x, light.y, 60)) continue;
    const state = lightState(light, G.time);
    ctx.fillStyle = '#22252c';
    ctx.fillRect(light.x + ROAD_HALF - 4, light.y + ROAD_HALF - 4, 8, 26);
    ctx.fillStyle = '#111318';
    ctx.beginPath();
    ctx.arc(light.x + ROAD_HALF, light.y + ROAD_HALF - 8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = state === 0 ? '#2ed573' : state === 1 ? '#ff4757' : '#f1c40f';
    ctx.beginPath();
    ctx.arc(light.x + ROAD_HALF, light.y + ROAD_HALF - 8, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProps(G, ctx, rect) {
  for (const prop of G.world.props) {
    if (!inView(rect, prop.x, prop.y, 90)) continue;
    switch (prop.kind) {
      case 'tree': drawTree(ctx, prop.x, prop.y, 22, '#3e7d3a', '#4c9a4a'); break;
      case 'palm': drawPalm(ctx, prop.x, prop.y); break;
      case 'lamp': drawLamp(ctx, prop.x, prop.y, G); break;
      case 'hydrant':
        ctx.fillStyle = '#d63031';
        ctx.fillRect(prop.x - 3, prop.y - 5, 6, 10);
        break;
      case 'bench':
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(prop.x - 14, prop.y - 4, 28, 8);
        break;
      case 'crate':
        ctx.fillStyle = '#a67c52';
        ctx.fillRect(prop.x - 12, prop.y - 12, 24, 24);
        ctx.strokeStyle = '#7d5a3a';
        ctx.strokeRect(prop.x - 12, prop.y - 12, 24, 24);
        break;
      case 'crane': {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(prop.x - 4, prop.y - 4, 60, 8);
        ctx.fillStyle = '#e67e22';
        ctx.fillRect(prop.x - 5, prop.y - 5, 10, 10);
        ctx.fillRect(prop.x, prop.y - 2, 56, 4);
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(prop.x + 52, prop.y);
        ctx.lineTo(prop.x + 52, prop.y + 26);
        ctx.stroke();
        break;
      }
      case 'billboard': {
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(prop.x - 4, prop.y - 4, 8, 30);
        ctx.fillStyle = '#f5f6fa';
        ctx.fillRect(prop.x - 46, prop.y - 34, 92, 30);
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 2;
        ctx.strokeRect(prop.x - 46, prop.y - 34, 92, 30);
        ctx.fillStyle = '#e84118';
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(prop.text, prop.x, prop.y - 14, 88);
        break;
      }
      case 'umbrella': {
        ctx.fillStyle = '#ff6b81';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f5f6fa';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 14, 0, Math.PI);
        ctx.fill();
        break;
      }
      case 'boat': {
        const bob = Math.sin(G.time * 1.2 + prop.bob) * 3;
        ctx.fillStyle = '#ecf0f1';
        ctx.beginPath();
        ctx.roundRect(prop.x - 26, prop.y + bob - 8, 52, 16, 6);
        ctx.fill();
        ctx.fillStyle = '#0984e3';
        ctx.fillRect(prop.x - 8, prop.y + bob - 12, 16, 8);
        break;
      }
      case 'buoy':
        ctx.fillStyle = '#e84118';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y + Math.sin(G.time * 2 + prop.x) * 2, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'fountain': {
        ctx.fillStyle = '#7f8c8d';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#74b9ff';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 19, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'plaza':
        ctx.fillStyle = '#b5ae9f';
        ctx.fillRect(prop.x - prop.w / 2, prop.y - prop.h / 2, prop.w, prop.h);
        break;
      default:
        break;
    }
  }
}

function drawTree(ctx, x, y, r, dark, light) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 5, y + 6, r, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawPalm(ctx, x, y) {
  ctx.strokeStyle = '#7d5a3a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x + 3, y - 8);
  ctx.stroke();
  ctx.strokeStyle = '#27ae60';
  ctx.lineWidth = 3;
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 8);
    ctx.quadraticCurveTo(x + 3 + Math.cos(a) * 12, y - 8 + Math.sin(a) * 12, x + 3 + Math.cos(a) * 20, y - 8 + Math.sin(a) * 20 + 5);
    ctx.stroke();
  }
}

function drawLamp(ctx, x, y, G) {
  ctx.fillStyle = '#2f3542';
  ctx.fillRect(x - 2, y - 2, 4, 12);
  ctx.fillStyle = '#f1f2f6';
  ctx.beginPath();
  ctx.arc(x, y - 4, 4, 0, Math.PI * 2);
  ctx.fill();
  const { darkness } = daylight(G.clock);
  if (darkness > 0.25) {
    const glow = ctx.createRadialGradient(x, y - 4, 2, x, y - 4, 46);
    glow.addColorStop(0, 'rgba(255, 220, 130, 0.35)');
    glow.addColorStop(1, 'rgba(255, 220, 130, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y - 4, 46, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBuildings(G, ctx, rect) {
  for (const b of G.world.buildings) {
    if (!inView(rect, b.x + b.w / 2, b.y + b.h / 2, 120)) continue;
    const lift = b.stories * 4;
    // Drop shadow and extruded side faces sell the height.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + lift * 0.7, b.y + lift * 0.7, b.w, b.h);
    ctx.fillStyle = `hsl(${b.hue}, 18%, 42%)`;
    ctx.fillRect(b.x + lift, b.y + lift, b.w, b.h);
    ctx.fillStyle = `hsl(${b.hue}, 24%, 62%)`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(b.x, b.y, b.w, 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    if (b.roof === 'ac') {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(b.x + b.w * 0.2, b.y + b.h * 0.25, 22, 16);
      ctx.fillRect(b.x + b.w * 0.6, b.y + b.h * 0.55, 22, 16);
    } else if (b.roof === 'house') {
      ctx.fillStyle = `hsl(${b.hue}, 30%, 48%)`;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, b.y + 8);
      ctx.lineTo(b.x + b.w - 8, b.y + b.h / 2);
      ctx.lineTo(b.x + b.w / 2, b.y + b.h - 8);
      ctx.lineTo(b.x + 8, b.y + b.h / 2);
      ctx.closePath();
      ctx.fill();
    } else if (b.roof === 'garage') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(b.x + 14, b.y + b.h - 16, b.w - 28, 10);
    }
    if (b.label) {
      ctx.fillStyle = b.sign || '#ffffff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 5, b.w - 12);
    }
  }
}

function drawMarkers(G, ctx) {
  const pulse = 1 + Math.sin(G.time * 4) * 0.15;
  const drawBeam = (x, y, color, letter) => {
    const grad = ctx.createLinearGradient(x, y - 130, x, y);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, color + '55');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 8, y - 130, 16, 130);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, 26 * pulse, 12 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, x, y - 44);
  };
  const mission = G.missionState.active;
  const start = G.missions.missionStartMarker(G);
  if (start) drawBeam(start.x, start.y, '#ffd23f', 'M');
  if (mission) {
    const step = mission.def.steps[mission.stepIndex];
    if (step && (step.type === 'goto' || step.type === 'deliver' || step.type === 'hold' || step.type === 'escape')) {
      drawBeam(step.x, step.y, '#ffd23f', '◎');
    }
  }
  // Hidden packages glow gold.
  for (const pkg of G.world.packages) {
    if (pkg.collected) continue;
    const bob = Math.sin(G.time * 3 + pkg.id) * 3;
    ctx.fillStyle = '#ffd700';
    ctx.save();
    ctx.translate(pkg.x, pkg.y + bob - 10);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-7, -7, 14, 14);
    ctx.restore();
  }
  // Race start flag at the marina.
  const race = G.missionState.race;
  if (race.state === 'idle') {
    ctx.fillStyle = '#00cec9';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏁 RACE', 1800, 3440);
  }
}

function drawPickups(G, ctx, rect) {
  for (const p of G.pickups) {
    if (!inView(rect, p.x, p.y, 40)) continue;
    const bob = Math.sin(G.time * 3) * 2;
    if (p.kind === 'cash') {
      ctx.fillStyle = '#2ed573';
      ctx.beginPath();
      ctx.arc(p.x, p.y + bob, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('$', p.x, p.y + bob + 4);
    } else if (p.kind === 'package') {
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(p.x - 9, p.y + bob - 9, 18, 18);
      ctx.strokeStyle = '#7d4a12';
      ctx.strokeRect(p.x - 9, p.y + bob - 9, 18, 18);
    } else if (p.kind === 'health') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x - 10, p.y + bob - 10, 20, 20);
      ctx.fillStyle = '#e84118';
      ctx.fillRect(p.x - 3, p.y + bob - 7, 6, 14);
      ctx.fillRect(p.x - 7, p.y + bob - 3, 14, 6);
    } else if (p.kind === 'armor') {
      ctx.fillStyle = '#70a1ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y + bob, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWrecks(G, ctx, rect) {
  for (const wreck of G.wrecks) {
    if (!inView(rect, wreck.x, wreck.y, 60)) continue;
    ctx.save();
    ctx.translate(wreck.x, wreck.y);
    ctx.rotate(wreck.angle);
    ctx.fillStyle = '#1c1c20';
    ctx.beginPath();
    ctx.roundRect(-23, -11, 46, 22, 6);
    ctx.fill();
    ctx.restore();
  }
}

export function drawCarFigure(ctx, car, time) {
  const def = VEHICLE_TYPES[car.type];
  const half = def.length / 2;
  const halfW = def.width / 2;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.roundRect(-half + 3, -halfW + 4, def.length, def.width, 6);
  ctx.fill();
  // Wheels.
  ctx.fillStyle = '#15181f';
  ctx.fillRect(-half + 6, -halfW - 3, 11, 5);
  ctx.fillRect(-half + 6, halfW - 2, 11, 5);
  ctx.fillRect(half - 17, -halfW - 3, 11, 5);
  ctx.fillRect(half - 17, halfW - 2, 11, 5);
  // Body.
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(-half, -halfW, def.length, def.width, 7);
  ctx.fill();
  if (car.type === 'cruiser') {
    ctx.fillStyle = '#f5f6fa';
    ctx.fillRect(-half + 4, -halfW, def.length - 8, 5);
    ctx.fillRect(-half + 4, halfW - 5, def.length - 8, 5);
    // Flashing light bar.
    const phase = Math.floor(time * 6) % 2;
    ctx.fillStyle = phase === 0 ? '#ff4757' : '#2e86ff';
    ctx.fillRect(-6, -halfW + 2, 12, 5);
    ctx.fillStyle = phase === 0 ? '#2e86ff' : '#ff4757';
    ctx.fillRect(-6, halfW - 7, 12, 5);
  }
  if (car.type === 'taxi') {
    ctx.fillStyle = '#222';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 7px system-ui, sans-serif';
    ctx.textAlign = 'center';
  }
  // Cabin glass.
  ctx.fillStyle = 'rgba(210, 232, 250, 0.9)';
  ctx.beginPath();
  ctx.roundRect(-half * 0.25, -halfW + 3, half * 0.7, def.width - 6, 3);
  ctx.fill();
  // Headlights and brake lights.
  ctx.fillStyle = '#fff9c4';
  ctx.fillRect(half - 2, -halfW + 3, 3, 5);
  ctx.fillRect(half - 2, halfW - 8, 3, 5);
  ctx.fillStyle = car.brakeLights ? '#ff2d2d' : '#8c1d1d';
  ctx.fillRect(-half - 1, -halfW + 3, 3, 5);
  ctx.fillRect(-half - 1, halfW - 8, 3, 5);
  // Damage: dents show as dark patches.
  if (car.health < 60) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(half * 0.5, 0, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Siren halo.
  if (car.siren && car.driver === 'police') {
    const phase = Math.floor(time * 6) % 2;
    const glow = ctx.createRadialGradient(car.x, car.y, 4, car.x, car.y, 60);
    glow.addColorStop(0, phase === 0 ? 'rgba(255,60,60,0.25)' : 'rgba(60,120,255,0.25)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(car.x, car.y, 60, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFigureBase(ctx, x, y, angle, radius) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(2, 3, radius, radius * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  return ctx;
}

export function drawPedFigure(ctx, ped, time) {
  if (ped.state === 'down') {
    drawDownFigure(ctx, ped);
    return;
  }
  const bob = Math.sin(ped.walkPhase) * 1.5;
  drawFigureBase(ctx, ped.x, ped.y + bob * 0.3, ped.angle, 10);
  ctx.fillStyle = ped.pants;
  ctx.fillRect(-7, -6, 14, 12);
  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(3, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDownFigure(ctx, ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.rotate(ped.angle + Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(11, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCopFigure(ctx, ped, time) {
  const bob = Math.sin(ped.walkPhase) * 1.5;
  drawFigureBase(ctx, ped.x, ped.y + bob * 0.3, ped.angle, 10);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(-7, -6, 14, 12);
  ctx.fillStyle = '#1e3799';
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(-2, -9, 4, 3);
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(3, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  // Cap brim and sidearm.
  ctx.fillStyle = '#0c2461';
  ctx.fillRect(2, -5, 7, 10);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, 4);
  ctx.lineTo(14, 6);
  ctx.stroke();
  ctx.restore();
}

function drawEnemyFigure(ctx, enemy, time) {
  const bob = Math.sin(enemy.walkPhase) * 1.5;
  drawFigureBase(ctx, enemy.x, enemy.y + bob * 0.3, enemy.angle, enemy.boss ? 13 : 10);
  ctx.fillStyle = '#2d3436';
  ctx.fillRect(-7, -6, 14, 12);
  ctx.fillStyle = enemy.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, enemy.boss ? 12 : 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.arc(3, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, 3);
  ctx.lineTo(18, 5);
  ctx.stroke();
  ctx.restore();
  // Health bar for the boss.
  if (enemy.boss) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(enemy.x - 26, enemy.y - 30, 52, 6);
    ctx.fillStyle = '#e84118';
    ctx.fillRect(enemy.x - 25, enemy.y - 29, 50 * (enemy.health / enemy.maxHealth), 4);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VICTOR KANE', enemy.x, enemy.y - 36);
  }
}

function drawPlayerFigure(ctx, player, time) {
  const bob = player.speed > 0 ? Math.sin(player.walkPhase) * 1.5 : 0;
  drawFigureBase(ctx, player.x, player.y + bob * 0.3, player.angle, 11);
  ctx.fillStyle = '#20242e';
  ctx.fillRect(-8, -6, 16, 12);
  ctx.fillStyle = '#f2c14e'; // signature yellow jacket
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d3436';
  ctx.fillRect(-10, -2, 6, 4);
  ctx.fillStyle = '#ffdbac';
  ctx.beginPath();
  ctx.arc(3, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  // Gun in the aim direction.
  if (player.weapon !== 'fists') {
    const aim = player.aimAngle - player.angle;
    ctx.save();
    ctx.rotate(aim);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(6, 4);
    ctx.lineTo(18, 4);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawBullets(G, ctx) {
  ctx.strokeStyle = '#ffe9a3';
  ctx.lineWidth = 2;
  for (const b of G.bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    ctx.stroke();
  }
}

function drawHelicopter(ctx, heli, player, time) {
  // Searchlight on the ground.
  const grad = ctx.createRadialGradient(player.x, player.y, 10, player.x, player.y, 110);
  grad.addColorStop(0, 'rgba(255, 250, 200, 0.28)');
  grad.addColorStop(1, 'rgba(255, 250, 200, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(player.x, player.y, 110, 0, Math.PI * 2);
  ctx.fill();
  // Shadow, then the body offset upward (it flies high).
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(heli.x + 30, heli.y + 40, 26, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(heli.x, heli.y);
  ctx.rotate(heli.angle * 0.2);
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#74b9ff';
  ctx.beginPath();
  ctx.ellipse(12, 0, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  const rotor = time * 30;
  ctx.beginPath();
  ctx.moveTo(Math.cos(rotor) * -34, Math.sin(rotor) * -8);
  ctx.lineTo(Math.cos(rotor) * 34, Math.sin(rotor) * 8);
  ctx.stroke();
  ctx.restore();
}

function drawLighting(G, ctx, rect, viewW, viewH) {
  const { darkness, golden } = daylight(G.clock);
  if (golden > 0.15) {
    ctx.fillStyle = `rgba(255, 150, 60, ${golden * 0.08})`;
    ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  }
  if (darkness > 0.05) {
    ctx.fillStyle = `rgba(8, 12, 34, ${darkness})`;
    ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  }
  // Headlight cones only once it is genuinely dark, never in daylight.
  if (darkness > 0.28) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const car of G.cars) {
      if (car.dead || !inView(rect, car.x, car.y, 160)) continue;
      const def = VEHICLE_TYPES[car.type];
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      const nx = car.x + fx * (def.length / 2);
      const ny = car.y + fy * (def.length / 2);
      const grad = ctx.createRadialGradient(nx, ny, 10, nx, ny, 150);
      grad.addColorStop(0, 'rgba(255, 240, 180, 0.30)');
      grad.addColorStop(1, 'rgba(255, 240, 180, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.arc(nx, ny, 150, car.angle - 0.42, car.angle + 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawWaypointArrow(G, ctx, viewW, viewH) {
  if (G.state !== 'playing') return;
  const objective = G.objective;
  if (!objective || objective.hidden) return;
  const camera = G.camera;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sx = (objective.x - camera.x) * camera.zoom;
  const sy = (objective.y - camera.y) * camera.zoom;
  const margin = 56;
  const onScreen = sx > margin && sx < viewW - margin && sy > margin && sy < viewH - margin;
  const cx = viewW / 2;
  const cy = viewH / 2;
  const angle = Math.atan2(sy - cy, sx - cx);
  const ax = onScreen ? sx : cx + Math.cos(angle) * (Math.min(viewW, viewH) / 2 - 70);
  const ay = onScreen ? sy - 46 : cy + Math.sin(angle) * (Math.min(viewW, viewH) / 2 - 70);
  const distance = Math.round(dist(G.player.x, G.player.y, objective.x, objective.y));
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = objective.color || '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(10, 10);
  ctx.lineTo(0, 4);
  ctx.lineTo(-10, 10);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-(angle + Math.PI / 2));
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeText(distance + 'm', 0, 30);
  ctx.fillText(distance + 'm', 0, 30);
  ctx.restore();
}
