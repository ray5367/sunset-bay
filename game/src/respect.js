// respect.js — Respect ranks and per-district standing: the progression
// layer that rewards play. Missions, taxi fares, hidden packages and race
// wins earn Respect; five ranks from Rook to Legend of the Bay. Standing
// is tracked per district and makes the city react: higher standing slows
// wanted-heat build-up and raises taxi tips in that district.

import { districtAt } from './world.js';

export const RESPECT_RANKS = [
  { name: 'Rook', at: 0, bonus: 0, unlock: 'Earn Respect by working the city' },
  { name: 'Hustler', at: 150, bonus: 250, unlock: 'Bay Customs engine tune' },
  { name: 'Made', at: 400, bonus: 500, unlock: 'Taxi tips +50%' },
  { name: 'Kingpin', at: 800, bonus: 1000, unlock: 'Heat builds 25% slower' },
  { name: 'Legend of the Bay', at: 1500, bonus: 2000, unlock: 'The whole city fears you' },
];

export const STANDING_NAMES = ['Stranger', 'Known', 'Respected', 'Feared', 'Untouchable'];
const STANDING_STEP = 25; // standing points per level, capped at 100

export function createRespect() {
  return { points: 0, rank: 0, standing: {} };
}

export function respectProgress(state) {
  const next = RESPECT_RANKS[state.rank + 1];
  if (!next) return 1;
  return (state.points - RESPECT_RANKS[state.rank].at) / (next.at - RESPECT_RANKS[state.rank].at);
}

export function standingLevel(state, district) {
  return Math.min(4, Math.floor((state.standing[district] || 0) / STANDING_STEP));
}

export function standingName(state, district) {
  return STANDING_NAMES[standingLevel(state, district)];
}

// Heat multiplier for the district the player is in: standing slows the
// build-up, and Kingpin rank slows it further everywhere.
export function heatMultiplier(G) {
  if (!G.respect) return 1;
  const s = standingLevel(G.respect, districtAt(G.player.x, G.player.y));
  let m = 1 - 0.08 * s;
  if (G.respect.rank >= 3) m *= 0.75;
  return m;
}

// Taxi tip multiplier for the district where the fare ends.
export function tipMultiplier(G) {
  if (!G.respect) return 1;
  const s = standingLevel(G.respect, districtAt(G.player.x, G.player.y));
  let m = 1 + 0.1 * s;
  if (G.respect.rank >= 2) m *= 1.5;
  return m;
}

// Award Respect for a deed done in the player's current district. A rank-up
// pays its cash bonus, shows the RESPECT UP banner and plays the fanfare.
export function awardRespect(G, points, why) {
  const r = G.respect;
  r.points += points;
  const d = districtAt(G.player.x, G.player.y);
  r.standing[d] = Math.min(100, (r.standing[d] || 0) + points);
  let up = false;
  while (r.rank < RESPECT_RANKS.length - 1 && r.points >= RESPECT_RANKS[r.rank + 1].at) {
    r.rank += 1;
    up = true;
    const rank = RESPECT_RANKS[r.rank];
    if (rank.bonus) G.player.cash += rank.bonus;
    G.hud.showBanner('RESPECT UP', rank.name + ' — ' + rank.unlock + (rank.bonus ? ' · +$' + rank.bonus : ''), true);
    G.hud.showMessage('Respect rank up: ' + rank.name + ' (' + why + ')', 'good');
    G.audio.missionPass();
  }
  if (!up) G.hud.showMessage('+' + points + ' Respect (' + why + ') — ' + RESPECT_RANKS[r.rank].name, 'good');
  return up;
}

export function saveRespect(state) {
  return { points: state.points, rank: state.rank, standing: state.standing };
}

export function loadRespect(state, data) {
  if (!data) return;
  state.points = Math.max(0, data.points || 0);
  // Clamp the rank: a stale or hand-edited save must never index past
  // RESPECT_RANKS (the HUD reads it every frame).
  state.rank = Math.min(Math.max(0, data.rank || 0), RESPECT_RANKS.length - 1);
  state.standing = {};
  for (const [d, v] of Object.entries(data.standing || {})) {
    state.standing[d] = Math.min(100, Math.max(0, v || 0));
  }
}
