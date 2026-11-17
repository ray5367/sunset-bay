// world.js — Sunset Bay: a 3600x3600 coastal city on a road grid, with
// districts, buildings, parks, a beach, docks, props, traffic lights and
// collision. Generation is seeded, so the same seed builds the same city.

import { mulberry32, pick, randInt, randRange } from './util.js';

export const WORLD_SIZE = 3600;
export const ROADS = [225, 675, 1125, 1575, 2025, 2475, 2925, 3375];
export const ROAD_HALF = 45;
export const BEACH_TOP = 3400;
export const WATER_TOP = 3520;

const DISTRICTS = [
  { name: 'Palm Heights', x0: 0, y0: 0, x1: 900, y1: 1350 },
  { name: 'Downtown', x0: 900, y0: 0, x1: 2700, y1: 1350 },
  { name: 'Port Del Rey', x0: 2700, y0: 0, x1: 3600, y1: 1350 },
  { name: 'Old Town', x0: 0, y0: 1350, x1: 900, y1: 2925 },
  { name: 'Sunset Strip', x0: 2700, y0: 1350, x1: 3600, y1: 2925 },
  { name: 'Marina Beach', x0: 0, y0: 2925, x1: 3600, y1: 3600 },
];

const BILLBOARDS = [
  'SUNSET COLA — TASTE THE BAY',
  'BAY FM 88.5 — ALL HITS',
  'GOLDEN PALM CASINO',
  'VISIT MARINA BEACH',
  'BAY CUSTOMS — RESPRAY TODAY',
  'SUNSET DINER — OPEN 24H',
];

const TREE_SPOTS = [];
for (let i = 0; i < 7; i += 1) {
  for (let j = 0; j < 7; j += 1) TREE_SPOTS.push([i, j]);
}

function blockRect(i, j) {
  return {
    x0: ROADS[i] + ROAD_HALF + 14,
    y0: ROADS[j] + ROAD_HALF + 14,
    x1: ROADS[i + 1] - ROAD_HALF - 14,
    y1: ROADS[j + 1] - ROAD_HALF - 14,
  };
}

function districtOf(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d.name;
  }
  return 'Sunset Bay';
}

export function buildWorld(seed) {
  const rng = mulberry32(seed);
  const buildings = [];
  const props = [];
  const parks = [];
  const lots = [];
  const specials = {};

  const specialBlocks = {
    '3,1': 'police',
    '4,1': 'hospital',
    '3,3': 'bank',
    '5,4': 'casino',
    '2,3': 'diner',
    '2,4': 'garage',
    '4,4': 'gunshop',
    '1,4': 'customs',
    '1,1': 'safehouse',
  };

  for (let i = 0; i < 7; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      const key = i + ',' + j;
      const r = blockRect(i, j);
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      const special = specialBlocks[key];
      if (special) {
        const b = makeSpecialBuilding(special, r, cx, cy);
        buildings.push(b);
        specials[special] = b;
        continue;
      }
      const roll = rng();
      const downtown = i >= 2 && i <= 4 && j >= 1 && j <= 3;
      if (roll < 0.14) {
        parks.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
        scatterTrees(props, r, rng, 9);
        props.push({ kind: 'fountain', x: cx, y: cy });
      } else if (roll < 0.26) {
        lots.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
        scatterTrees(props, r, rng, 2);
      } else if (roll < 0.33) {
        props.push({ kind: 'plaza', x: cx, y: cy, w: r.x1 - r.x0, h: r.y1 - r.y0 });
        scatterTrees(props, r, rng, 4);
        props.push({ kind: 'bench', x: cx - 40, y: cy });
        props.push({ kind: 'bench', x: cx + 40, y: cy });
      } else if (downtown && rng() < 0.6) {
        buildings.push(makeBuilding(rng, r.x0 + 20, r.y0 + 20, r.x1 - r.x0 - 40, r.y1 - r.y0 - 40, 3, 6));
      } else {
        // Four quarters with an alley cross between them.
        const mx = (r.x0 + r.x1) / 2;
        const my = (r.y0 + r.y1) / 2;
        const gap = 26;
        const quads = [
          [r.x0, r.y0, mx - gap, my - gap],
          [mx + gap, r.y0, r.x1, my - gap],
          [r.x0, my + gap, mx - gap, r.y1],
          [mx + gap, my + gap, r.x1, r.y1],
        ];
        for (const [x0, y0, x1, y1] of quads) {
          if (rng() < 0.12) {
            scatterTrees(props, { x0, y0, x1, y1 }, rng, 2);
            continue;
          }
          buildings.push(makeBuilding(rng, x0 + 8, y0 + 8, x1 - x0 - 16, y1 - y0 - 16, 1, downtown ? 4 : 2));
        }
      }
    }
  }

  // Docks: warehouses and cranes along the east strip.
  for (let k = 0; k < 4; k += 1) {
    const y = 500 + k * 420;
    buildings.push({
      x: 3430, y, w: 150, h: 240, hue: 30, stories: 1, roof: 'warehouse',
      label: '', special: k === 1 ? 'docks' : '',
    });
    props.push({ kind: 'crane', x: 3500, y: y + 300 });
    props.push({ kind: 'crate', x: 3440 + rng() * 120, y: y + 280 });
    props.push({ kind: 'crate', x: 3440 + rng() * 120, y: y + 320 });
  }

  // Sidewalk trees, lamps, hydrants and benches along every road.
  for (const road of ROADS) {
    for (let t = 120; t < WORLD_SIZE; t += 300) {
      if (rng() < 0.7) props.push({ kind: 'tree', x: road + ROAD_HALF + 22, y: t });
      if (rng() < 0.7) props.push({ kind: 'tree', x: t, y: road + ROAD_HALF + 22 });
      props.push({ kind: 'lamp', x: road - ROAD_HALF - 10, y: t + 150 });
      props.push({ kind: 'lamp', x: t + 150, y: road - ROAD_HALF - 10 });
      if (rng() < 0.3) props.push({ kind: 'hydrant', x: road + ROAD_HALF + 16, y: t + 80 });
    }
  }

  // Palms and beach life on the boardwalk and sand.
  for (let x = 120; x < WORLD_SIZE; x += 170) {
    props.push({ kind: 'palm', x: x + randRange(rng, -20, 20), y: 3430 + randRange(rng, -8, 8) });
    if (rng() < 0.5) props.push({ kind: 'umbrella', x: x + 60, y: 3470 + rng() * 30 });
  }
  for (let k = 0; k < 6; k += 1) {
    props.push({ kind: 'boat', x: 300 + k * 540 + rng() * 120, y: 3560 + rng() * 20, bob: rng() * 6 });
  }
  for (let k = 0; k < 8; k += 1) {
    props.push({ kind: 'buoy', x: 200 + k * 420, y: 3545 });
  }

  // Billboards facing the main avenues.
  BILLBOARDS.forEach((text, k) => {
    const road = ROADS[(k % 4) * 2];
    props.push({
      kind: 'billboard', x: road + ROAD_HALF + 30, y: 500 + k * 430, text,
    });
  });

  // Traffic lights at every third intersection.
  const lights = [];
  for (let i = 0; i < ROADS.length; i += 1) {
    for (let j = 0; j < ROADS.length; j += 1) {
      if ((i + j) % 3 === 0) lights.push({ x: ROADS[i], y: ROADS[j], offset: (i * 3 + j) % 4 });
    }
  }

  const markers = [
    marker('garage', specials.garage, 'Mara\u2019s Garage', '#ffd23f'),
    marker('diner', specials.diner, 'Sunset Diner', '#ff9f43'),
    marker('bank', specials.bank, 'Bay Trust Bank', '#7bed9f'),
    marker('hospital', specials.hospital, 'St. Marina Hospital', '#ff6b81'),
    marker('police', specials.police, 'Sunset Bay PD', '#70a1ff'),
    marker('gunshop', specials.gunshop, 'Bay Arms', '#eccc68'),
    marker('customs', specials.customs, 'Bay Customs', '#a29bfe'),
    marker('safehouse', specials.safehouse, 'Safehouse', '#2ed573'),
    marker('casino', specials.casino, 'Golden Palm Casino', '#fd79a8'),
    { kind: 'docks', x: 3500, y: 1080, label: 'Port Del Rey Docks', color: '#f0932b' },
    { kind: 'marina', x: 1800, y: 3470, label: 'Marina', color: '#48dbfb' },
  ];

  const packages = [
    [560, 560], [1680, 340], [3040, 560], [340, 1680], [2360, 1900],
    [3050, 2360], [560, 3050], [1800, 3480], [3480, 1480], [1240, 2580],
  ].map(([x, y], i) => ({ id: i, x, y, collected: false }));

  return {
    size: WORLD_SIZE,
    seed,
    buildings,
    props,
    parks,
    lots,
    lights,
    markers,
    packages,
    specials,
    spawn: { x: 1125, y: 1470 },
  };
}

function marker(kind, building, label, color) {
  return {
    kind,
    x: building.x + building.w / 2,
    y: building.y + building.h + 26,
    label,
    color,
  };
}

function makeSpecialBuilding(kind, r, cx, cy) {
  const defs = {
    police: { w: 220, h: 150, hue: 215, stories: 2, roof: 'flat', label: 'POLICE', sign: '#70a1ff' },
    hospital: { w: 240, h: 160, hue: 0, stories: 3, roof: 'flat', label: 'HOSPITAL', sign: '#ff6b81' },
    bank: { w: 200, h: 170, hue: 45, stories: 2, roof: 'flat', label: 'BAY TRUST', sign: '#7bed9f' },
    casino: { w: 260, h: 180, hue: 300, stories: 2, roof: 'flat', label: 'GOLDEN PALM', sign: '#fd79a8' },
    diner: { w: 170, h: 110, hue: 25, stories: 1, roof: 'flat', label: 'DINER', sign: '#ff9f43' },
    garage: { w: 200, h: 130, hue: 200, stories: 1, roof: 'garage', label: 'GARAGE', sign: '#ffd23f' },
    gunshop: { w: 160, h: 110, hue: 90, stories: 1, roof: 'flat', label: 'BAY ARMS', sign: '#eccc68' },
    customs: { w: 200, h: 130, hue: 260, stories: 1, roof: 'garage', label: 'CUSTOMS', sign: '#a29bfe' },
    safehouse: { w: 130, h: 110, hue: 150, stories: 1, roof: 'house', label: 'HOME', sign: '#2ed573' },
  };
  const d = defs[kind];
  return {
    x: cx - d.w / 2, y: cy - d.h / 2, w: d.w, h: d.h,
    hue: d.hue, stories: d.stories, roof: d.roof, label: d.label,
    sign: d.sign, special: kind,
  };
}

function makeBuilding(rng, x, y, w, h, minStories, maxStories) {
  return {
    x, y, w, h,
    hue: pick(rng, [20, 35, 45, 190, 200, 210, 220, 280, 340]),
    stories: randInt(rng, minStories, maxStories),
    roof: rng() < 0.3 ? 'ac' : 'flat',
    label: '',
    special: '',
  };
}

function scatterTrees(props, r, rng, count) {
  for (let k = 0; k < count; k += 1) {
    props.push({
      kind: rng() < 0.25 ? 'palm' : 'tree',
      x: randRange(rng, r.x0 + 20, r.x1 - 20),
      y: randRange(rng, r.y0 + 20, r.y1 - 20),
    });
  }
}

export function districtAt(x, y) {
  return districtOf(x, y);
}

export function surfaceAt(x, y) {
  if (y > WATER_TOP) return 'water';
  if (y > BEACH_TOP) return 'sand';
  for (const road of ROADS) {
    if (Math.abs(x - road) < ROAD_HALF || Math.abs(y - road) < ROAD_HALF) return 'road';
  }
  return 'pavement';
}

export function blockedAt(world, x, y, radius) {
  if (x < radius || y < radius || x > WORLD_SIZE - radius || y > WORLD_SIZE - radius) return true;
  if (y > WATER_TOP - radius) return true;
  for (const b of world.buildings) {
    if (x > b.x - radius && x < b.x + b.w + radius && y > b.y - radius && y < b.y + b.h + radius) {
      return true;
    }
  }
  for (const p of world.props) {
    if ((p.kind === 'crate' || p.kind === 'fountain' || p.kind === 'crane') && Math.abs(x - p.x) < 26 + radius && Math.abs(y - p.y) < 26 + radius) {
      return true;
    }
  }
  return false;
}

// Axis-separated movement: slide along walls instead of sticking to them.
export function moveCircle(world, x, y, dx, dy, radius) {
  let nx = x;
  let ny = y;
  if (!blockedAt(world, x + dx, y, radius)) nx = x + dx;
  if (!blockedAt(world, nx, y + dy, radius)) ny = y + dy;
  return { x: nx, y: ny };
}

// Traffic-light state at a given time: 0 = north-south green, 1 = east-west.
export function lightState(light, time) {
  const cycle = (time + light.offset * 3) % 12;
  if (cycle < 5) return 0;
  if (cycle < 6) return 2; // all red, clearing
  if (cycle < 11) return 1;
  return 2;
}

export function nearestRoadCoord(value) {
  let best = ROADS[0];
  for (const road of ROADS) {
    if (Math.abs(value - road) < Math.abs(value - best)) best = road;
  }
  return best;
}
