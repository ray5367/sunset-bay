// particles.js — short-lived visual effects: smoke, sparks, muzzle flashes,
// explosion fire, dust puffs and tyre skid marks left on the asphalt.

import { randRange } from './util.js';

const MAX_PARTICLES = 600;

export class ParticleSystem {
  constructor() {
    this.list = [];
    this.skids = [];
  }

  spawn(x, y, opts) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push({
      x,
      y,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      life: opts.life || 0.5,
      maxLife: opts.life || 0.5,
      size: opts.size || 4,
      grow: opts.grow || 0,
      color: opts.color || '#ffffff',
      drag: opts.drag === undefined ? 0.9 : opts.drag,
      gravity: opts.gravity || 0,
      glow: !!opts.glow,
    });
  }

  burst(x, y, count, opts, rng) {
    const random = rng || Math.random;
    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = randRange(random, opts.minSpeed || 20, opts.maxSpeed || 120);
      this.spawn(x, y, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randRange(random, opts.minLife || 0.3, opts.maxLife || 0.8),
        size: randRange(random, opts.minSize || 2, opts.maxSize || 6),
        grow: opts.grow || 0,
        color: opts.color || '#ffffff',
        drag: opts.drag,
        gravity: opts.gravity || 0,
        glow: opts.glow,
      });
    }
  }

  smoke(x, y, rng) {
    this.burst(x, y, 2, {
      minSpeed: 8, maxSpeed: 30, minLife: 0.7, maxLife: 1.4,
      minSize: 6, maxSize: 12, grow: 14, color: '#55555c', drag: 0.92,
    }, rng);
  }

  sparks(x, y, rng) {
    this.burst(x, y, 8, {
      minSpeed: 80, maxSpeed: 260, minLife: 0.15, maxLife: 0.4,
      minSize: 1, maxSize: 3, color: '#ffd76a', drag: 0.9, glow: true,
    }, rng);
  }

  muzzle(x, y, angle, rng) {
    const mx = x + Math.cos(angle) * 20;
    const my = y + Math.sin(angle) * 20;
    this.spawn(mx, my, {
      vx: Math.cos(angle) * 30, vy: Math.sin(angle) * 30,
      life: 0.07, size: 9, color: '#ffe9a3', glow: true,
    });
    this.burst(mx, my, 3, {
      minSpeed: 40, maxSpeed: 120, minLife: 0.1, maxLife: 0.25,
      minSize: 1, maxSize: 2, color: '#ffcf5c', glow: true,
    }, rng);
  }

  dustPuff(x, y, rng) {
    this.burst(x, y, 6, {
      minSpeed: 20, maxSpeed: 70, minLife: 0.3, maxLife: 0.6,
      minSize: 3, maxSize: 7, grow: 8, color: '#c9b896', drag: 0.88,
    }, rng);
  }

  explosion(x, y, rng) {
    this.burst(x, y, 26, {
      minSpeed: 40, maxSpeed: 300, minLife: 0.4, maxLife: 1.1,
      minSize: 5, maxSize: 16, grow: 10, color: '#ff7a2a', drag: 0.9, glow: true,
    }, rng);
    this.burst(x, y, 14, {
      minSpeed: 20, maxSpeed: 160, minLife: 0.6, maxLife: 1.5,
      minSize: 8, maxSize: 18, grow: 20, color: '#3a3a3f', drag: 0.92,
    }, rng);
    this.burst(x, y, 18, {
      minSpeed: 100, maxSpeed: 420, minLife: 0.2, maxLife: 0.5,
      minSize: 1, maxSize: 3, color: '#fff3b0', drag: 0.92, glow: true,
    }, rng);
  }

  addSkid(x1, y1, x2, y2) {
    this.skids.push({ x1, y1, x2, y2, life: 6 });
    if (this.skids.length > 400) this.skids.shift();
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
    }
    for (let i = this.skids.length - 1; i >= 0; i -= 1) {
      this.skids[i].life -= dt;
      if (this.skids[i].life <= 0) this.skids.splice(i, 1);
    }
  }

  drawSkids(ctx) {
    ctx.save();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const s of this.skids) {
      ctx.strokeStyle = `rgba(20, 20, 24, ${Math.min(0.5, s.life * 0.12)})`;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx) {
    for (const p of this.list) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
