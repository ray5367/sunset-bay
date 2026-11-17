// hud.js — the on-screen interface: stats, wanted stars, weapon readout,
// minimap, objective tracker, message feed, dialogs, shop panels, the
// pause menu and the full city map. The HUD is DOM; the minimap is canvas.

import { clamp, dist, formatCash, formatClock } from './util.js';
import { ROADS, ROAD_HALF, BEACH_TOP, WATER_TOP, WORLD_SIZE, districtAt } from './world.js';
import { WEAPONS } from './combat.js';
import { carSpeed } from './vehicles.js';

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['stats', 'cash', 'healthBar', 'healthFill', 'armorFill', 'stars', 'weaponBox', 'weaponName', 'ammo', 'speedBox', 'speed', 'clock', 'district', 'objective', 'messages', 'banner', 'bannerTitle', 'bannerSub', 'dialog', 'dialogSpeaker', 'dialogText', 'panel', 'panelTitle', 'panelOptions', 'vignette', 'bustMeter', 'bustFill', 'minimap', 'bigmap', 'dead', 'deadTitle', 'deadSub', 'hint']) {
      this.el[id] = document.getElementById(id);
    }
    this.miniCtx = this.el.minimap.getContext('2d');
    this.bigCtx = this.el.bigmap.getContext('2d');
    this.messages = [];
    this.bannerTimer = 0;
    this.dialogLines = [];
    this.dialogIndex = 0;
    this.dialogDone = null;
    this.dialogOpen = false;
    this.panelOpen = false;
    this.panelOptions = [];
    this.lastTextUpdate = 0;
  }

  isBlocking() {
    return this.dialogOpen || this.panelOpen;
  }

  showMessage(text, kind) {
    const item = { text, kind: kind || 'info', time: 6 };
    this.messages.unshift(item);
    if (this.messages.length > 4) this.messages.pop();
    this.renderMessages();
  }

  renderMessages() {
    this.el.messages.innerHTML = '';
    for (const m of this.messages) {
      const div = document.createElement('div');
      div.className = 'msg ' + m.kind;
      div.textContent = m.text;
      this.el.messages.appendChild(div);
    }
  }

  showBanner(title, sub, good) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.className = 'show ' + (good ? 'good' : 'bad');
    this.bannerTimer = 3.6;
  }

  showDialog(lines, onDone) {
    this.dialogLines = lines;
    this.dialogIndex = 0;
    this.dialogDone = onDone || null;
    this.dialogOpen = true;
    this.el.dialog.classList.add('show');
    this.renderDialogLine();
  }

  renderDialogLine() {
    const line = this.dialogLines[this.dialogIndex];
    this.el.dialogSpeaker.textContent = line[0];
    this.el.dialogText.textContent = line[1];
  }

  advanceDialog() {
    this.dialogIndex += 1;
    if (this.dialogIndex >= this.dialogLines.length) {
      this.dialogOpen = false;
      this.el.dialog.classList.remove('show');
      const done = this.dialogDone;
      this.dialogDone = null;
      if (done) done();
    } else {
      this.renderDialogLine();
    }
  }

  openPanel(title, options) {
    this.panelOpen = true;
    this.panelOptions = options;
    this.el.panelTitle.textContent = title;
    this.el.panelOptions.innerHTML = '';
    options.forEach((opt, i) => {
      const button = document.createElement('button');
      button.className = 'panel-option' + (opt.disabled ? ' disabled' : '');
      button.innerHTML = '';
      const label = document.createElement('span');
      label.textContent = (i + 1) + '. ' + opt.label;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = opt.price ? formatCash(opt.price) : '';
      button.appendChild(label);
      button.appendChild(price);
      button.addEventListener('click', () => {
        if (!opt.disabled) {
          this.closePanel();
          opt.action();
        }
      });
      this.el.panelOptions.appendChild(button);
    });
    const close = document.createElement('button');
    close.className = 'panel-option close';
    close.textContent = 'Close  (Esc)';
    close.addEventListener('click', () => this.closePanel());
    this.el.panelOptions.appendChild(close);
    this.el.panel.classList.add('show');
  }

  closePanel() {
    this.panelOpen = false;
    this.panelOptions = [];
    this.el.panel.classList.remove('show');
  }

  choosePanelOption(index) {
    const opt = this.panelOptions[index];
    if (opt && !opt.disabled) {
      this.closePanel();
      opt.action();
    }
  }

  showDead(kind, sub) {
    this.el.deadTitle.textContent = kind;
    this.el.deadSub.textContent = sub || '';
    this.el.dead.classList.add('show');
  }

  hideDead() {
    this.el.dead.classList.remove('show');
  }

  update(G, dt) {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      this.messages[i].time -= dt;
      if (this.messages[i].time <= 0) this.messages.splice(i, 1);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.className = '';
    }
    const now = G.time;
    if (now - this.lastTextUpdate > 0.1) {
      this.lastTextUpdate = now;
      this.renderMessages();
      this.updateStats(G);
    }
    this.updateVignette(G);
    this.updateBustMeter(G);
    this.drawMinimap(G);
  }

  updateStats(G) {
    const player = G.player;
    this.el.cash.textContent = formatCash(player.cash);
    this.el.healthFill.style.width = clamp(player.health, 0, 100) + '%';
    this.el.healthFill.className = 'fill' + (player.health < 30 ? ' low' : '');
    this.el.armorFill.style.width = clamp(player.armor, 0, 100) + '%';
    const stars = G.wanted.stars;
    let starText = '';
    for (let i = 0; i < 5; i += 1) starText += i < stars ? '★' : '☆';
    this.el.stars.textContent = starText;
    this.el.stars.className = stars > 0 ? 'wanted' : '';
    const def = WEAPONS[player.weapon];
    const state = player.weapons[player.weapon];
    this.el.weaponName.textContent = def.name;
    if (player.weapon === 'fists') {
      this.el.ammo.textContent = '—';
    } else if (player.reloadTimer > 0) {
      this.el.ammo.textContent = 'RELOADING…';
    } else {
      this.el.ammo.textContent = state.mag + ' / ' + state.reserve;
    }
    const speed = player.car ? Math.round(carSpeed(player.car) * 0.24) : Math.round(player.speed * 0.24);
    this.el.speed.textContent = speed + ' km/h';
    this.el.clock.textContent = formatClock(G.clock);
    this.el.district.textContent = districtAt(player.x, player.y);
    if (G.objective) {
      const d = Math.round(dist(player.x, player.y, G.objective.x, G.objective.y));
      this.el.objective.textContent = '◆ ' + G.objective.label + '  ·  ' + d + 'm';
      this.el.objective.style.display = 'block';
    } else {
      this.el.objective.style.display = 'none';
    }
  }

  updateVignette(G) {
    const player = G.player;
    const hurt = player.hurtTimer > 0 ? 0.45 : 0;
    const lowHealth = player.health < 30 ? 0.35 + Math.sin(G.time * 4) * 0.1 : 0;
    this.el.vignette.style.opacity = Math.max(hurt, lowHealth).toFixed(2);
  }

  updateBustMeter(G) {
    const progress = G.wanted.bustProgress;
    if (progress > 0.02) {
      this.el.bustMeter.style.display = 'block';
      this.el.bustFill.style.width = (progress * 100).toFixed(0) + '%';
    } else {
      this.el.bustMeter.style.display = 'none';
    }
  }

  drawMinimap(G) {
    const size = 200;
    const scale = size / WORLD_SIZE;
    const c = this.miniCtx;
    c.fillStyle = '#16202e';
    c.fillRect(0, 0, size, size);
    c.fillStyle = '#4d7a44';
    for (const park of G.world.parks) {
      c.fillRect(park.x0 * scale, park.y0 * scale, (park.x1 - park.x0) * scale, (park.y1 - park.y0) * scale);
    }
    c.fillStyle = '#e8d5a3';
    c.fillRect(0, BEACH_TOP * scale, size, (WATER_TOP - BEACH_TOP) * scale);
    c.fillStyle = '#3f8fbf';
    c.fillRect(0, WATER_TOP * scale, size, size - WATER_TOP * scale);
    c.fillStyle = '#5b6b82';
    for (const b of G.world.buildings) {
      c.fillRect(b.x * scale, b.y * scale, Math.max(1, b.w * scale), Math.max(1, b.h * scale));
    }
    c.strokeStyle = '#8a94a6';
    c.lineWidth = 2;
    for (const road of ROADS) {
      c.beginPath();
      c.moveTo(0, road * scale);
      c.lineTo(size, road * scale);
      c.stroke();
      c.beginPath();
      c.moveTo(road * scale, 0);
      c.lineTo(road * scale, size);
      c.stroke();
    }
    const blip = (x, y, color, r) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(x * scale, y * scale, r || 3, 0, Math.PI * 2);
      c.fill();
    };
    for (const marker of G.world.markers) blip(marker.x, marker.y, marker.color, 2.5);
    for (const pkg of G.world.packages) {
      if (!pkg.collected) blip(pkg.x, pkg.y, '#ffd700', 2);
    }
    if (G.objective && !G.objective.hidden) {
      const pulse = 4 + Math.sin(G.time * 5) * 1.5;
      blip(G.objective.x, G.objective.y, G.objective.color || '#ffd23f', pulse);
    }
    const flash = Math.floor(G.time * 4) % 2 === 0;
    for (const cop of G.cops) {
      const x = cop.inCar ? cop.car.x : cop.ped.x;
      const y = cop.inCar ? cop.car.y : cop.ped.y;
      blip(x, y, flash ? '#ff4757' : '#2e86ff', 3.5);
    }
    for (const enemy of G.enemies) {
      if (enemy.health > 0) blip(enemy.x, enemy.y, '#e84118', 3);
    }
    if (G.heli) blip(G.heli.x, G.heli.y, '#ff4757', 4);
    // Player arrow.
    const player = G.player;
    c.save();
    c.translate(player.x * scale, player.y * scale);
    c.rotate(player.angle);
    c.fillStyle = '#ffb340';
    c.beginPath();
    c.moveTo(6, 0);
    c.lineTo(-4, -4);
    c.lineTo(-4, 4);
    c.closePath();
    c.fill();
    c.restore();
    // View frame: the rectangle of the world currently on screen.
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    const viewW = (window.innerWidth / G.camera.zoom) * scale;
    const viewH = (window.innerHeight / G.camera.zoom) * scale;
    c.strokeRect(G.camera.x * scale, G.camera.y * scale, viewW, viewH);
  }

  drawBigMap(G) {
    const size = 720;
    const scale = size / WORLD_SIZE;
    const c = this.bigCtx;
    c.fillStyle = '#1b2436';
    c.fillRect(0, 0, size, size);
    c.fillStyle = '#4d7a44';
    for (const park of G.world.parks) {
      c.fillRect(park.x0 * scale, park.y0 * scale, (park.x1 - park.x0) * scale, (park.y1 - park.y0) * scale);
    }
    c.fillStyle = '#e8d5a3';
    c.fillRect(0, BEACH_TOP * scale, size, (WATER_TOP - BEACH_TOP) * scale);
    c.fillStyle = '#3f8fbf';
    c.fillRect(0, WATER_TOP * scale, size, size - WATER_TOP * scale);
    c.fillStyle = '#5b6b82';
    for (const b of G.world.buildings) {
      c.fillRect(b.x * scale, b.y * scale, Math.max(2, b.w * scale), Math.max(2, b.h * scale));
    }
    c.strokeStyle = '#8a94a6';
    c.lineWidth = 4;
    for (const road of ROADS) {
      c.beginPath();
      c.moveTo(0, road * scale);
      c.lineTo(size, road * scale);
      c.stroke();
      c.beginPath();
      c.moveTo(road * scale, 0);
      c.lineTo(road * scale, size);
      c.stroke();
    }
    c.font = 'bold 13px system-ui, sans-serif';
    c.textAlign = 'center';
    for (const marker of G.world.markers) {
      c.fillStyle = marker.color;
      c.beginPath();
      c.arc(marker.x * scale, marker.y * scale, 7, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 3;
      c.strokeText(marker.label, marker.x * scale, marker.y * scale - 12);
      c.fillText(marker.label, marker.x * scale, marker.y * scale - 12);
    }
    if (G.objective && !G.objective.hidden) {
      c.fillStyle = G.objective.color || '#ffd23f';
      c.beginPath();
      c.arc(G.objective.x * scale, G.objective.y * scale, 9, 0, Math.PI * 2);
      c.fill();
    }
    const player = G.player;
    c.save();
    c.translate(player.x * scale, player.y * scale);
    c.rotate(player.angle);
    c.fillStyle = '#ffb340';
    c.beginPath();
    c.moveTo(12, 0);
    c.lineTo(-8, -8);
    c.lineTo(-8, 8);
    c.closePath();
    c.fill();
    c.restore();
  }
}
