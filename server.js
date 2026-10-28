const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 4000;
const TICK_RATE = 30;
const MAX_SOULS = 115;
const ROCK_COUNT = 18;
const MAX_CONSUMABLES = 10;
const MAX_BARRELS = 12;

const MATCH_DURATION_MS = 6 * 60 * 1000;
const INTERMISSION_MS = 10 * 1000;

const STEALTH_MAX_DURATION_MS = 8000;
const LANTERN_COOLDOWN_MS = 6000;

let players = {};
let bullets = [];
let souls = [];
let rocks = [];
let relics = [];
let consumables = [];
let seaMines = [];
let barrels = [];

let botRespawnCooldownUntil = 0;

let lobbyState = {
  phase: 'playing',
  matchEndTime: Date.now() + MATCH_DURATION_MS,
  intermissionEndTime: 0,
  weather: 'calm',
  nextWeatherChange: Date.now() + 75000,
  podium: []
};

let extractionPortal = {
  active: false,
  x: 2800,
  y: 2800,
  radius: 110,
  nextSpawnTime: Date.now() + 45000
};

let blackMerchant = {
  x: 1100,
  y: 2900,
  radius: 130,
  angle: 0
};

// =========================================================
// POOL GACHA ROGUELIKE (25 CARTE + 5 RARITÀ + 5 CATEGORIE)
// =========================================================
const POWERUP_POOL = [
  // --- CATEGORIA 1: 🔥 ARTIGLIERIA INFERNALE (artillery) ---
  { id: 'art_1', name: 'Polvere Nera Pressata', cat: 'artillery', catName: '🔥 Artiglieria', rarity: 'common', icon: '💣', desc: '+4 Danno alle Bordate', stats: { dmg: 4 } },
  { id: 'art_2', name: 'Palle Incandescenti', cat: 'artillery', catName: '🔥 Artiglieria', rarity: 'rare', icon: '☄️', desc: '+7 Danno e +15% Dimensione Proiettili', stats: { dmg: 7, bulletSize: 0.15 } },
  { id: 'art_3', name: 'Culatte Rinforzate', cat: 'artillery', catName: '🔥 Artiglieria', rarity: 'epic', icon: '🔥', desc: '+11 Danno e +15% Velocità Proiettili', stats: { dmg: 11, bulletSpeed: 2.0 } },
  { id: 'art_4', name: 'Batteria del Demone', cat: 'artillery', catName: '🔥 Artiglieria', rarity: 'legendary', icon: '🌋', desc: '+1 Cannone Extra per lato e +8 Danno!', stats: { extraCannons: 1, dmg: 8 } },
  { id: 'art_5', name: 'APOCALISSE DI FUOCO', cat: 'artillery', catName: '🔥 Artiglieria', rarity: 'mythic', icon: '👹', desc: 'MITICA: +2 Cannoni per lato, +14 Danno e Palle Giganti!', stats: { extraCannons: 2, dmg: 14, bulletSize: 0.35 } },

  // --- CATEGORIA 2: 🛡️ COLOSSO ABISSALE (colossus) ---
  { id: 'col_1', name: 'Assi di Quercia Nera', cat: 'colossus', catName: '🛡️ Colosso', rarity: 'common', icon: '🪵', desc: '+35 HP Massimi', stats: { hp: 35 } },
  { id: 'col_2', name: 'Piastre di Ferro Maledetto', cat: 'colossus', catName: '🛡️ Colosso', rarity: 'rare', icon: '🛡️', desc: '+50 HP Massimi e +7% Corazza', stats: { hp: 50, armor: 0.07 } },
  { id: 'col_3', name: 'Sperone Frantuma-Ossa', cat: 'colossus', catName: '🛡️ Colosso', rarity: 'epic', icon: '🦏', desc: '+75 HP Massimi e +45% Danno Speronamento', stats: { hp: 75, ramMult: 0.45 } },
  { id: 'col_4', name: 'Scudo del Behemoth', cat: 'colossus', catName: '🛡️ Colosso', rarity: 'legendary', icon: '🏰', desc: '+120 HP Massimi, +12% Corazza e +15% Riflessione Spine', stats: { hp: 120, armor: 0.12, thorns: 0.15 } },
  { id: 'col_5', name: 'CUORE DELL\'IMMORTALE', cat: 'colossus', catName: '🛡️ Colosso', rarity: 'mythic', icon: '💎', desc: 'MITICA: +190 HP Massimi, +18% Corazza e Rigenerazione Continua!', stats: { hp: 190, armor: 0.18, regen: 0.22 } },

  // --- CATEGORIA 3: ⚡ ARALDO DELLA TEMPESTA (tempest) ---
  { id: 'tmp_1', name: 'Vele Tagliavento', cat: 'tempest', catName: '⚡ Tempesta', rarity: 'common', icon: '⛵', desc: '+0.45 Velocità e Timone più rapido', stats: { speed: 0.45, turn: 0.003 } },
  { id: 'tmp_2', name: 'oleatura degli Argani', cat: 'tempest', catName: '⚡ Tempesta', rarity: 'rare', icon: '⚙️', desc: '-12% Tempo di Ricarica Cannoni', stats: { reloadMult: 0.88 } },
  { id: 'tmp_3', name: 'Verricello Elettrico', cat: 'tempest', catName: '⚡ Tempesta', rarity: 'epic', icon: '🪝', desc: '-35% Ricarica Rampino [V] e +0.65 Velocità', stats: { harpoonCdMult: 0.65, speed: 0.65 } },
  { id: 'tmp_4', name: 'Sovraccarico del Tuono', cat: 'tempest', catName: '⚡ Tempesta', rarity: 'legendary', icon: '⚡', desc: '-22% Ricarica Cannoni e -25% Cooldown Abilità [E]', stats: { reloadMult: 0.78, abilityCdMult: 0.75 } },
  { id: 'tmp_5', name: 'SIGNORE DEL FULMINE', cat: 'tempest', catName: '⚡ Tempesta', rarity: 'mythic', icon: '🌪️', desc: 'MITICA: +1.2 Velocità, -28% Ricarica e Scossa su ogni colpo!', stats: { speed: 1.2, reloadMult: 0.72, forceShock: true } },

  // --- CATEGORIA 4: 💀 CULTO DEI DANNATI (cursed) ---
  { id: 'cur_1', name: ' Sussurro delle Anime', cat: 'cursed', catName: '💀 Dannati', rarity: 'common', icon: '🕯️', desc: '+9% Rubavita sui colpi di cannone', stats: { lifesteal: 0.09 } },
  { id: 'cur_2', name: 'Bussola dell\'Ossario', cat: 'cursed', catName: '💀 Dannati', rarity: 'rare', icon: '💀', desc: '+14% Rubavita e +80px Magnete Anime', stats: { lifesteal: 0.14, magnet: 80 } },
  { id: 'cur_3', name: 'Maledizione Vampirica', cat: 'cursed', catName: '💀 Dannati', rarity: 'epic', icon: '🦇', desc: '+20% Rubavita e +6 Danno Cannoni', stats: { lifesteal: 0.20, dmg: 6 } },
  { id: 'cur_4', name: 'Grimorio del Negromante', cat: 'cursed', catName: '💀 Dannati', rarity: 'legendary', icon: '📖', desc: '+25% Rubavita e +25% XP da ogni Anima raccolta!', stats: { lifesteal: 0.25, xpMult: 0.25 } },
  { id: 'cur_5', name: 'TRONO DI CARONTE', cat: 'cursed', catName: '💀 Dannati', rarity: 'mythic', icon: '👑', desc: 'MITICA: +32% Rubavita, +90 HP e Spara 1 Teschio Homing a ogni salva!', stats: { lifesteal: 0.32, hp: 90, bonusHomingSkull: 1 } },

  // --- CATEGORIA 5: 🪙 FORTUNA DEL CONTRABBANDIERE (fortune) ---
  { id: 'for_1', name: 'Moneta Bucata', cat: 'fortune', catName: '🪙 Fortuna', rarity: 'common', icon: '🪙', desc: '+10% Probabilità di Colpo Critico (Danno 2x)', stats: { crit: 0.10 } },
  { id: 'for_2', name: 'Velo dell\'Illusione', cat: 'fortune', catName: '🪙 Fortuna', rarity: 'rare', icon: '💨', desc: '+10% Schivata Colpi e +8% Critico', stats: { dodge: 0.10, crit: 0.08 } },
  { id: 'for_3', name: 'Dadi Truccati del Pirata', cat: 'fortune', catName: '🪙 Fortuna', rarity: 'epic', icon: '🎲', desc: '+18% Probabilità Critico e +25 Dobloni Immediati!', stats: { crit: 0.18, instantDoubloons: 25 } },
  { id: 'for_4', name: 'Bussola dell\'Oro Maledetto', cat: 'fortune', catName: '🪙 Fortuna', rarity: 'legendary', icon: '🧭', desc: '+24% Critico, +14% Schivata e +50 Dobloni Immediati!', stats: { crit: 0.24, dodge: 0.14, instantDoubloons: 50 } },
  { id: 'for_5', name: 'MANO DEL RE PIRATA', cat: 'fortune', catName: '🪙 Fortuna', rarity: 'mythic', icon: '🎰', desc: 'MITICA: +35% Critico (2x), +18% Schivata e +100 Dobloni Immediati!', stats: { crit: 0.35, dodge: 0.18, instantDoubloons: 100 } }
];

function rollRarity(shipLevel, fortuneCount) {
  const luckBonus = Math.min(0.15, (shipLevel - 1) * 0.012 + fortuneCount * 0.03);
  const r = Math.random();
  if (r < 0.02 + luckBonus * 0.35) return 'mythic';
  if (r < 0.08 + luckBonus * 0.8) return 'legendary';
  if (r < 0.24 + luckBonus * 1.2) return 'epic';
  if (r < 0.54 + luckBonus) return 'rare';
  return 'common';
}

function generateDraftOptions(ship) {
  const fortuneCount = (ship.traits && ship.traits.fortune) || 0;
  const chosenIds = new Set();
  const options = [];

  for (let i = 0; i < 3; i++) {
    const targetRarity = rollRarity(ship.level, fortuneCount);
    let candidates = POWERUP_POOL.filter(c => c.rarity === targetRarity && !chosenIds.has(c.id));
    if (candidates.length === 0) {
      candidates = POWERUP_POOL.filter(c => !chosenIds.has(c.id));
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    chosenIds.add(picked.id);
    options.push(picked);
  }
  return options;
}

const RELIC_TYPES = [
  { id: 'chalice', name: 'Calice di Sangue', icon: '🩸', color: '#f43f5e', baseDesc: 'Rubavita' },
  { id: 'powder', name: 'Polvere Abissale', icon: '⚡', color: '#38bdf8', baseDesc: 'Ricarica Rapida' },
  { id: 'bone', name: 'Corazza d\'Ossa', icon: '🦴', color: '#a3e635', baseDesc: 'HP & Corazza' },
  { id: 'compass', name: 'Bussola Spettrale', icon: '🌬️', color: '#2dd4bf', baseDesc: 'Velocità' },
  { id: 'lantern', name: 'Lanterna Maledetta', icon: '🔥', color: '#fb923c', baseDesc: 'Danno Cannoni' }
];
const BOSS_MYTHIC_RELIC = {
  id: 'leviathan_heart',
  name: 'Cuore del Leviatano',
  icon: '👑',
  color: '#c084fc',
  baseDesc: 'MITICA: HP, Danno & Regen'
};

const CONSUMABLE_TYPES = [
  { id: 'mine', name: 'Mina Abissale', icon: '💣', color: '#f97316', desc: '[Q] Rilascia una mina esplosiva (95 Danni)' },
  { id: 'nitro', name: 'Vento Stregato', icon: '💨', color: '#38bdf8', desc: '[Q] Turbo istantaneo per 2.5s' },
  { id: 'hellfire', name: 'Fuoco Greco', icon: '🧪', color: '#a855f7', desc: '[Q] Spara una salva incendiaria potenziata' }
];

let storm = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  radius: MAP_SIZE * 0.68,
  minRadius: 360,
  shrinkSpeed: 1.1
};

let boss = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  hp: 2800,
  maxHp: 2800,
  radius: 82,
  angle: 0,
  alive: true,
  enraged: false,
  respawnTimer: 0,
  lastAttack: 0,
  attackCounter: 0
};

let treasureIsland = {
  active: false,
  x: 1200,
  y: 1200,
  radius: 190,
  progress: 0,
  capturingId: null,
  contested: false,
  nextSpawnTime: Date.now() + 20000
};

let treasureGalleon = {
  active: false,
  x: 200,
  y: 2000,
  targetX: 3800,
  targetY: 2000,
  angle: 0,
  hp: 1400,
  maxHp: 1400,
  nextSpawnTime: Date.now() + 35000
};

let whirlpools = [
  { id: 'wp_1', x: 1300, y: 2600, vx: 0.7, vy: -0.5, radius: 165, angle: 0 },
  { id: 'wp_2', x: 2700, y: 1400, vx: -0.6, vy: 0.65, radius: 165, angle: 0 }
];

function generateMapRocks() {
  rocks = [];
  for (let i = 0; i < ROCK_COUNT; i++) {
    let rx, ry, distCenter;
    do {
      rx = Math.round(Math.random() * (MAP_SIZE - 500) + 250);
      ry = Math.round(Math.random() * (MAP_SIZE - 500) + 250);
      distCenter = Math.hypot(rx - MAP_SIZE / 2, ry - MAP_SIZE / 2);
    } while (distCenter < 460);

    rocks.push({
      id: `rock_${i}`,
      x: rx,
      y: ry,
      radius: Math.floor(Math.random() * 35) + 45,
      seed: Number((Math.random() * 100).toFixed(2))
    });
  }
}

function spawnSoul(x = null, y = null, value = 18, isBossDrop = false) {
  let sx = x;
  let sy = y;
  if (sx === null || sy === null) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * Math.max(300, storm.radius * 0.88);
    sx = Math.max(150, Math.min(MAP_SIZE - 150, storm.x + Math.cos(a) * r));
    sy = Math.max(150, Math.min(MAP_SIZE - 150, storm.y + Math.sin(a) * r));
  }
  souls.push({
    id: Math.random().toString(36).substr(2, 6),
    x: Math.round(sx),
    y: Math.round(sy),
    value,
    isBossDrop
  });
}

function spawnConsumable() {
  const t = CONSUMABLE_TYPES[Math.floor(Math.random() * CONSUMABLE_TYPES.length)];
  const a = Math.random() * Math.PI * 2;
  const r = 250 + Math.random() * Math.max(250, storm.radius * 0.75);
  consumables.push({
    uid: Math.random().toString(36).substr(2, 6),
    x: Math.round(storm.x + Math.cos(a) * r),
    y: Math.round(storm.y + Math.sin(a) * r),
    ...t
  });
}

function spawnBarrel() {
  const a = Math.random() * Math.PI * 2;
  const r = 300 + Math.random() * Math.max(300, storm.radius * 0.78);
  barrels.push({
    id: Math.random().toString(36).substr(2, 6),
    x: Math.round(storm.x + Math.cos(a) * r),
    y: Math.round(storm.y + Math.sin(a) * r),
    radius: 22
  });
}

function triggerBarrelExplosion(barrel, attackerId) {
  const bx = barrel.x;
  const by = barrel.y;
  const blastRadius = 175;
  const blastDmg = 105;

  io.emit('barrelExploded', { x: bx, y: by });

  for (let id in players) {
    const t = players[id];
    const d = Math.hypot(t.x - bx, t.y - by);
    if (d <= blastRadius) {
      t.hp -= blastDmg;
      revealShipLantern(t, Date.now());
      if (t.isRepairing) interruptRepair(t, 'Esplosione Barile!');
      emitDamageNumber(t.x, t.y - 20, blastDmg, '#f97316', '🧨 ');

      if (d > 1) {
        const force = (1 - d / blastRadius) * 14 + 5;
        t.momX += ((t.x - bx) / d) * force;
        t.momY += ((t.y - by) / d) * force;
      }

      if (t.hp <= 0 && attackerId && players[attackerId] && attackerId !== id) {
        const killer = players[attackerId];
        killer.kills++;
        killer.xp += 85;
        io.emit('killfeed', { killer: killer.name, victim: t.name, weapon: '🧨 Barile Esplosivo' });
        if (!killer.isBot) {
          io.to(killer.id).emit('questEvent', { type: 'kill', amount: 1, doubloons: 15 });
        }
      }
    }
  }

  if (boss.alive && Math.hypot(boss.x - bx, boss.y - by) <= blastRadius + boss.radius) {
    boss.hp -= blastDmg;
    emitDamageNumber(boss.x, boss.y - 20, blastDmg, '#f97316', '🧨 ');
  }
}

function spawnRelicDrop(x, y, forceMythic = false) {
  const template = forceMythic
    ? BOSS_MYTHIC_RELIC
    : RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
  relics.push({
    uid: Math.random().toString(36).substr(2, 6),
    x: Math.round(x),
    y: Math.round(y),
    ...template
  });
}

const botNames = [
  'Vascello di Caronte',
  'Olandese Nero',
  'Spina Abissale',
  'Mietitore Salmastro',
  'Regina delle Ossa',
  'Furia di Sangue'
];

function findBestSpawnPosition() {
  let bestX = storm.x + 600;
  let bestY = storm.y + 600;
  let maxMinDist = -1;

  const minAllowedRadius = 420;
  const maxAllowedRadius = Math.max(520, storm.radius * 0.78);

  for (let attempt = 0; attempt < 12; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const dist = minAllowedRadius + Math.random() * (maxAllowedRadius - minAllowedRadius);
    const cx = Math.max(160, Math.min(MAP_SIZE - 160, storm.x + Math.cos(a) * dist));
    const cy = Math.max(160, Math.min(MAP_SIZE - 160, storm.y + Math.sin(a) * dist));

    let nearestShipDist = 99999;
    for (let id in players) {
      const p = players[id];
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < nearestShipDist) nearestShipDist = d;
    }

    if (nearestShipDist > maxMinDist) {
      maxMinDist = nearestShipDist;
      bestX = cx;
      bestY = cy;
    }
  }
  return { x: Math.round(bestX), y: Math.round(bestY) };
}

function createShip(id, name, isBot = false, meta = {}, isElite = false) {
  const spawnPos = findBestSpawnPosition();

  const hullLv = Math.min(10, Math.max(0, Number(meta.hullLv) || 0));
  const cannonLv = Math.min(10, Math.max(0, Number(meta.cannonLv) || 0));
  const sailLv = Math.min(10, Math.max(0, Number(meta.sailLv) || 0));
  const soulLv = Math.min(10, Math.max(0, Number(meta.soulLv) || 0));

  const baseHp = (isElite ? 185 : 115) + hullLv * 5;
  const baseDmg = (isElite ? 22 : 18) + cannonLv * 0.6;
  const baseSpeed = 5.45 + sailLv * 0.08;

  const ship = {
    id,
    name: name || 'Pirata Maledetto',
    isBot,
    isElite,
    meta,
    skin: isElite ? 'crimson' : (meta.skin || (isBot ? 'void' : 'emerald')),
    shipClass: null,
    x: spawnPos.x,
    y: spawnPos.y,
    angle: Number((Math.random() * Math.PI * 2).toFixed(3)),
    speed: 0,
    momX: 0,
    momY: 0,
    mass: isElite ? 1.35 : 1.0,
    tether: null,
    baseMaxSpeed: baseSpeed,
    maxSpeed: baseSpeed,
    baseTurnSpeed: 0.044 + sailLv * 0.0008,
    turnSpeed: 0.044 + sailLv * 0.0008,
    baseMaxHp: baseHp,
    hp: baseHp,
    maxHp: baseHp,
    baseDamage: baseDmg,
    damage: baseDmg,
    baseReloadTime: 1350,
    reloadTime: 1350,
    lastShot: 0,
    shotsFiredCount: 0,
    level: isElite ? 3 : 1,
    xp: soulLv * 10,
    maxXp: isElite ? 78 : 42,
    // SISTEMA ROGUELIKE GACHA (Sostituisce i vecchi skillPoints manuali)
    draftQueue: 0,
    currentDraft: null, // Array di 3 carte Gacha da scegliere
    rerollsLeft: 2,
    collectedCards: [],
    traits: { artillery: 0, colossus: 0, tempest: 0, cursed: 0, fortune: 0 },
    gachaBonuses: {
      hp: 0,
      dmg: 0,
      speed: 0,
      turn: 0,
      reloadMult: 1.0,
      harpoonCdMult: 1.0,
      abilityCdMult: 1.0,
      armor: 0,
      lifesteal: 0,
      crit: 0,
      dodge: 0,
      thorns: 0,
      regen: 0,
      ramMult: 0,
      magnet: 0,
      xpMult: 0,
      extraCannons: 0,
      bulletSize: 0,
      bulletSpeed: 0,
      bonusHomingSkull: 0,
      forceShock: false
    },
    levelUpShieldUntil: 0,
    kills: 0,
    soulsCollected: 0,
    isMostWanted: false,
    lanternOn: true,
    stealthSince: 0,
    lanternLockUntil: 0,
    lastHarpoon: 0,
    baseHarpoonCd: 9500,
    harpoonCd: 9500,
    shockedUntil: 0,
    miniShockUntil: 0,
    extractProgress: 0,
    emote: null,
    emoteUntil: 0,
    lastMerchantUse: 0,
    baseAbilityCd: 10000,
    abilityCd: 10000,
    lastAbility: 0,
    activeBuffUntil: 0,
    nitroUntil: 0,
    hellfireCharged: false,
    lastNecroPulse: 0,
    isRepairing: false,
    repairUntil: 0,
    lastRepair: 0,
    repairCd: 18000,
    inventory: [],
    pendingRelic: null,
    pendingRelicUntil: 0,
    activeSynergies: [],
    consumable: null,
    lifestealBonus: 0,
    armorBonus: 0,
    ramCooldownUntil: 0,
    inputs: { up: false, down: false, left: false, right: false },
    botTimer: Math.floor(Math.random() * 100),
    patrolAngle: Math.random() * Math.PI * 2
  };

  if (isElite) {
    const r1 = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
    const r2 = RELIC_TYPES[(RELIC_TYPES.indexOf(r1) + 2) % RELIC_TYPES.length];
    ship.inventory.push({ id: r1.id, name: r1.name, icon: r1.icon, color: r1.color, level: 1, desc: r1.baseDesc });
    ship.inventory.push({ id: r2.id, name: r2.name, icon: r2.icon, color: r2.color, level: 1, desc: r2.baseDesc });
    recalculateShipStats(ship);
    ship.hp = ship.maxHp;
  }

  return ship;
}

function applyGachaCardToShip(p, card) {
  p.collectedCards.push({ id: card.id, name: card.name, rarity: card.rarity, icon: card.icon, cat: card.cat });
  p.traits[card.cat] = (p.traits[card.cat] || 0) + 1;

  const st = card.stats || {};
  const gb = p.gachaBonuses;
  if (st.hp) gb.hp += st.hp;
  if (st.dmg) gb.dmg += st.dmg;
  if (st.speed) gb.speed += st.speed;
  if (st.turn) gb.turn += st.turn;
  if (st.reloadMult) gb.reloadMult *= st.reloadMult;
  if (st.harpoonCdMult) gb.harpoonCdMult *= st.harpoonCdMult;
  if (st.abilityCdMult) gb.abilityCdMult *= st.abilityCdMult;
  if (st.armor) gb.armor += st.armor;
  if (st.lifesteal) gb.lifesteal += st.lifesteal;
  if (st.crit) gb.crit += st.crit;
  if (st.dodge) gb.dodge += st.dodge;
  if (st.thorns) gb.thorns += st.thorns;
  if (st.regen) gb.regen += st.regen;
  if (st.ramMult) gb.ramMult += st.ramMult;
  if (st.magnet) gb.magnet += st.magnet;
  if (st.xpMult) gb.xpMult += st.xpMult;
  if (st.extraCannons) gb.extraCannons += st.extraCannons;
  if (st.bulletSize) gb.bulletSize += st.bulletSize;
  if (st.bulletSpeed) gb.bulletSpeed += st.bulletSpeed;
  if (st.bonusHomingSkull) gb.bonusHomingSkull += st.bonusHomingSkull;
  if (st.forceShock) gb.forceShock = true;

  if (st.instantDoubloons && !p.isBot) {
    io.to(p.id).emit('questEvent', { type: 'gacha', amount: 1, doubloons: st.instantDoubloons });
  }

  recalculateShipStats(p);

  const rarityColors = {
    common: '#94a3b8',
    rare: '#38bdf8',
    epic: '#c084fc',
    legendary: '#facc15',
    mythic: '#f43f5e'
  };
  io.emit('dmgNum', {
    x: Math.round(p.x),
    y: Math.round(p.y - 42),
    text: `${card.icon} ${card.name}!`,
    color: rarityColors[card.rarity] || '#5eead4'
  });
}

function triggerNextDraftIfAvailable(p) {
  if (p.isBot) {
    while (p.draftQueue > 0) {
      p.draftQueue--;
      const opts = generateDraftOptions(p);
      applyGachaCardToShip(p, opts[Math.floor(Math.random() * opts.length)]);
    }
    return;
  }

  if (!p.currentDraft && p.draftQueue > 0) {
    p.draftQueue--;
    p.currentDraft = generateDraftOptions(p);
    io.to(p.id).emit('draftRolled', { options: p.currentDraft, rerollsLeft: p.rerollsLeft });
  }
}

function revealShipLantern(ship, now) {
  ship.lanternOn = true;
  ship.stealthSince = 0;
  ship.lanternLockUntil = Math.max(ship.lanternLockUntil || 0, now + LANTERN_COOLDOWN_MS);
}

function getTargetBotCount() {
  const allShips = Object.values(players);
  const humanCount = allShips.filter(p => !p.isBot).length;
  const areaRatio = Math.max(0.18, storm.radius / (MAP_SIZE * 0.68));
  let maxComfortableShips = Math.max(2, Math.round(5 * areaRatio));

  if (lobbyState.phase === 'eclipse') {
    maxComfortableShips = Math.min(2, maxComfortableShips);
  }
  return Math.max(1, maxComfortableShips - humanCount);
}

function manageBotPopulation(now) {
  if (lobbyState.phase === 'intermission') return;

  const targetBots = getTargetBotCount();
  const currentBots = Object.values(players).filter(p => p.isBot);

  if (currentBots.length < targetBots && now >= botRespawnCooldownUntil) {
    const hasEliteAlive = currentBots.some(b => b.isElite);
    const spawnAsElite = !hasEliteAlive && Math.random() < 0.32;

    const usedNames = new Set(currentBots.map(b => b.name));
    const availableName = spawnAsElite
      ? 'Capitano Rinnegato'
      : (botNames.find(n => !usedNames.has(n)) || 'Spettro Errante');

    const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
    players[botId] = createShip(botId, availableName, true, {}, spawnAsElite);
    botRespawnCooldownUntil = now + 7500;

    if (spawnAsElite) {
      io.emit('worldAnnouncement', {
        title: '👹 UN CAPITANO RINNEGATO ELITE È ENTRATO NELL\'ARENA!',
        subtitle: 'Naviga con 2 Reliquie Maledette: affondalo per saccheggiare il suo tesoro!',
        color: '#fb7185'
      });
    }
  }

  if (currentBots.length > targetBots) {
    const humanList = Object.values(players).filter(p => !p.isBot);
    for (let b of currentBots) {
      if (b.isElite) continue;
      const closeToHuman = humanList.some(h => Math.hypot(h.x - b.x, h.y - b.y) < 620);
      if (!closeToHuman) {
        delete players[b.id];
        break;
      }
    }
  }
}

function triggerLobbyIntermission() {
  lobbyState.phase = 'intermission';
  lobbyState.intermissionEndTime = Date.now() + INTERMISSION_MS;

  const sorted = Object.values(players).sort(
    (a, b) => (b.level * 65 + b.kills * 120) - (a.level * 65 + a.kills * 120)
  );
  const podiumRewards = [150, 80, 40];

  lobbyState.podium = sorted.slice(0, 3).map((p, idx) => {
    const reward = podiumRewards[idx] || 20;
    if (!p.isBot) {
      io.to(p.id).emit('questEvent', { type: 'podium', amount: 1, doubloons: reward });
    }
    return {
      rank: idx + 1,
      name: p.name,
      level: p.level,
      kills: p.kills,
      reward
    };
  });

  io.emit('lobbyEnd', { podium: lobbyState.podium, nextResetIn: INTERMISSION_MS });
}

function resetEntireLobby() {
  const now = Date.now();
  lobbyState.phase = 'playing';
  lobbyState.matchEndTime = now + MATCH_DURATION_MS;
  lobbyState.weather = 'calm';
  lobbyState.nextWeatherChange = now + 75000;
  lobbyState.podium = [];

  storm.radius = MAP_SIZE * 0.68;
  storm.shrinkSpeed = 1.1;

  boss.alive = true;
  boss.enraged = false;
  boss.hp = boss.maxHp;

  bullets = [];
  relics = [];
  seaMines = [];
  souls = [];
  consumables = [];
  barrels = [];

  generateMapRocks();
  for (let i = 0; i < MAX_SOULS; i++) spawnSoul();
  for (let i = 0; i < MAX_CONSUMABLES; i++) spawnConsumable();
  for (let i = 0; i < MAX_BARRELS; i++) spawnBarrel();

  extractionPortal.active = false;
  extractionPortal.nextSpawnTime = now + 45000;

  blackMerchant.x = Math.round(900 + Math.random() * 2200);
  blackMerchant.y = Math.round(900 + Math.random() * 2200);

  const currentIds = Object.keys(players);
  currentIds.forEach(id => {
    const old = players[id];
    if (old.isBot) {
      delete players[id];
    } else {
      players[id] = createShip(id, old.name, false, old.meta || {});
    }
  });

  botRespawnCooldownUntil = now + 1500;

  io.emit('lobbyReset', { rocks });
  io.emit('worldAnnouncement', {
    title: '⚓ NUOVA SPEDIZIONE INIZIATA! MARE RIGENERATO!',
    subtitle: 'Tutti i vascelli ripartono dal Livello 1. Hai 6 minuti prima dell\'Eclissi Abissale!',
    color: '#2dd4bf'
  });
}

generateMapRocks();
for (let i = 0; i < MAX_SOULS; i++) spawnSoul();
for (let i = 0; i < MAX_CONSUMABLES; i++) spawnConsumable();
for (let i = 0; i < MAX_BARRELS; i++) spawnBarrel();

// =========================================================
// RICALCOLO STATISTICHE + SINERGIE DI CATEGORIA GACHA (2 & 4 PEZZI)
// =========================================================
function recalculateShipStats(p) {
  const gb = p.gachaBonuses;
  const tr = p.traits || {};

  let maxHp = p.baseMaxHp + (p.level - 1) * 12 + gb.hp;
  let dmg = p.baseDamage + gb.dmg;
  let maxSpd = p.baseMaxSpeed + gb.speed;
  let turnSpd = p.baseTurnSpeed + gb.turn;
  let reload = p.baseReloadTime * gb.reloadMult;
  let lifesteal = gb.lifesteal;
  let armor = gb.armor;
  let mass = p.isElite ? 1.35 : 1.0;

  if (p.shipClass === 'juggernaut') { maxHp += 95; armor += 0.20; mass = 1.65; }
  if (p.shipClass === 'phantom') { maxSpd += 1.0; turnSpd += 0.009; mass = 0.78; }
  if (p.shipClass === 'necromancer') { maxHp += 45; dmg += 4.5; lifesteal += 0.35; mass = 1.1; }
  if (p.shipClass === 'stormcaller') { maxHp += 55; dmg += 4.5; reload *= 0.90; mass = 1.05; }

  const synergies = [];

  // SINERGIE DI ARCHEOTIPO GACHA (2 e 4 Pezzi della stessa Categoria!)
  if (tr.artillery >= 2) {
    dmg *= 1.15;
    synergies.push(tr.artillery >= 4
      ? '🔥 Artiglieria (4): Colpi Esplosivi AoE!'
      : '🔥 Artiglieria (2): +15% Danno');
  }
  if (tr.colossus >= 2) {
    maxHp += 70;
    armor += 0.10;
    mass += 0.25;
    synergies.push(tr.colossus >= 4
      ? '🛡️ Colosso (4): Corazza di Spine (35% Riflesso)!'
      : '🛡️ Colosso (2): +70 HP & +10% Corazza');
  }
  if (tr.tempest >= 2) {
    maxSpd *= 1.12;
    reload *= 0.85;
    synergies.push(tr.tempest >= 4
      ? '⚡ Tempesta (4): Fulmine Automatico ogni 3ª salva!'
      : '⚡ Tempesta (2): +12% Vel & -15% Ricarica');
  }
  if (tr.cursed >= 2) {
    lifesteal += 0.15;
    synergies.push(tr.cursed >= 4
      ? '💀 Dannati (4): 2 Teschi Homing ogni 2ª salva!'
      : '💀 Dannati (2): +15% Rubavita & Magnete');
  }
  if (tr.fortune >= 2) {
    synergies.push(tr.fortune >= 4
      ? '🪙 Fortuna (4): I Critici curano +12 HP e danno +4 🪙!'
      : '🪙 Fortuna (2): +18% Colpo Critico (2x)');
  }

  // Reliquie Maledette in mare
  const ids = new Set();
  p.inventory.forEach(r => {
    ids.add(r.id);
    const lv = r.level || 1;
    if (r.id === 'chalice') {
      lifesteal += 0.14 * lv;
      r.desc = `+${Math.round(14 * lv)}% Rubavita`;
    } else if (r.id === 'powder') {
      reload *= Math.pow(0.86, lv);
      r.desc = `-${Math.round((1 - Math.pow(0.86, lv)) * 100)}% Ricarica`;
    } else if (r.id === 'bone') {
      maxHp += 55 * lv;
      armor += 0.09 * lv;
      mass += 0.1 * lv;
      r.desc = `+${55 * lv} HP & +${Math.round(9 * lv)}% Corazza`;
    } else if (r.id === 'compass') {
      maxSpd += 0.55 * lv;
      turnSpd += 0.0035 * lv;
      r.desc = `+${Math.round(10 * lv)}% Velocità`;
    } else if (r.id === 'lantern') {
      dmg += 4.5 * lv;
      r.desc = `+${Math.round(4.5 * lv)} Danno Bordate`;
    } else if (r.id === 'leviathan_heart') {
      maxHp += 75 * lv;
      dmg += 5.5 * lv;
      lifesteal += 0.12 * lv;
      r.desc = `MITICA Lv.${lv}: +${75 * lv} HP & Danno`;
    }
  });

  if (ids.has('chalice') && ids.has('lantern')) {
    synergies.push('🩸🔥 Set Reliquie: Patto del Vampiro');
    dmg *= 1.15;
  }
  if (ids.has('bone') && ids.has('leviathan_heart')) {
    synergies.push('🦴👑 Set Reliquie: Fortezza Immortale');
    armor += 0.15;
  }
  if (ids.has('powder') && ids.has('compass')) {
    synergies.push('⚡🌬️ Set Reliquie: Tempesta Perfetta');
    maxSpd += 0.4;
    reload *= 0.92;
  }

  const hpDiff = maxHp - p.maxHp;
  p.maxHp = Math.round(maxHp);
  if (hpDiff > 0) p.hp = Math.min(p.maxHp, p.hp + hpDiff);
  else p.hp = Math.min(p.maxHp, p.hp);

  p.damage = dmg;
  p.maxSpeed = Math.min(9.8, maxSpd);
  p.turnSpeed = turnSpd;
  p.reloadTime = Math.max(340, Math.round(reload));
  p.harpoonCd = Math.max(3500, Math.round(p.baseHarpoonCd * gb.harpoonCdMult));
  p.abilityCd = Math.max(4000, Math.round(p.baseAbilityCd * gb.abilityCdMult));
  p.lifestealBonus = Math.min(0.60, lifesteal);
  p.armorBonus = Math.min(0.65, armor);
  p.mass = mass;
  p.activeSynergies = synergies;
}

function handleRelicPickup(p, relic) {
  const existing = p.inventory.find(r => r.id === relic.id);
  if (existing) {
    if (existing.level < 3) {
      existing.level++;
      recalculateShipStats(p);
      io.emit('dmgNum', {
        x: Math.round(p.x),
        y: Math.round(p.y - 38),
        text: `⬆️ ${relic.icon} ${relic.name} GRADO ${existing.level}!`,
        color: '#facc15'
      });
      if (!p.isBot) io.to(p.id).emit('questEvent', { type: 'relic', amount: 1, doubloons: 6 });
      return true;
    } else {
      p.xp += 45;
      p.hp = Math.min(p.maxHp, p.hp + 30);
      io.emit('dmgNum', { x: Math.round(p.x), y: Math.round(p.y - 35), text: `✨ Reliquia Max (+45 XP)`, color: '#5eead4' });
      return true;
    }
  }

  if (p.inventory.length < 3) {
    p.inventory.push({
      id: relic.id,
      name: relic.name,
      icon: relic.icon,
      color: relic.color,
      level: 1,
      desc: relic.baseDesc
    });
    recalculateShipStats(p);
    io.emit('dmgNum', { x: Math.round(p.x), y: Math.round(p.y - 35), text: `${relic.icon} ${relic.name}!`, color: relic.color });
    if (!p.isBot) io.to(p.id).emit('questEvent', { type: 'relic', amount: 1, doubloons: 5 });
    return true;
  }

  if (p.isBot) {
    const idx = p.inventory.findIndex(r => r.level === 1);
    if (idx !== -1) {
      p.inventory[idx] = { id: relic.id, name: relic.name, icon: relic.icon, color: relic.color, level: 1, desc: relic.baseDesc };
      recalculateShipStats(p);
    }
    return true;
  }

  p.pendingRelic = {
    id: relic.id,
    name: relic.name,
    icon: relic.icon,
    color: relic.color,
    level: 1,
    desc: relic.baseDesc
  };
  p.pendingRelicUntil = Date.now() + 8000;
  io.emit('dmgNum', { x: Math.round(p.x), y: Math.round(p.y - 35), text: `🎒 Inventario Pieno! Scegli Slot [Z/X/C]`, color: '#fbbf24' });
  return true;
}

function emitDamageNumber(x, y, amount, color = '#f87171', prefix = '') {
  io.emit('dmgNum', { x: Math.round(x), y: Math.round(y), text: `${prefix}${Math.round(amount)}`, color });
}

function interruptRepair(ship, reasonText = 'Riparazione Interrotta!') {
  if (!ship.isRepairing) return;
  ship.isRepairing = false;
  ship.repairUntil = 0;
  io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: reasonText, color: '#fb923c' });
}

function getSkinBulletColor(skin, shipClass, isHellfire) {
  if (isHellfire) return '#f97316';
  if (shipClass === 'stormcaller') return '#38bdf8';
  if (shipClass === 'necromancer') return '#c084fc';
  if (skin === 'crimson') return '#fb7185';
  if (skin === 'gold') return '#fde047';
  if (skin === 'void') return '#a855f7';
  return '#99f6e4';
}

function fireBroadsides(ship) {
  if (lobbyState.phase === 'intermission') return;
  const now = Date.now();
  if (now - ship.lastShot < ship.reloadTime) return;
  ship.lastShot = now;
  ship.shotsFiredCount = (ship.shotsFiredCount || 0) + 1;

  if (ship.isRepairing) interruptRepair(ship);

  let ambushMult = 1.0;
  if (!ship.lanternOn) {
    if (now - ship.stealthSince >= 2000) {
      ambushMult = 1.25;
      io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 42), text: '🎯 IMBOSCATA (+25% DANNO)!', color: '#facc15' });
    }
  }
  revealShipLantern(ship, now);

  const isHellfire = ship.hellfireCharged;
  ship.hellfireCharged = false;

  // Numero dinamico di cannoni per fianco (Base 3 + Negromante + Carte Gacha ExtraCannons!)
  const baseCannons = ship.shipClass === 'necromancer' ? 5 : 3;
  const totalCannonsPerSide = Math.min(8, baseCannons + (ship.gachaBonuses.extraCannons || 0));
  const spreadAngles = [];
  const maxSpread = 0.14 + (totalCannonsPerSide - 3) * 0.045;
  for (let c = 0; c < totalCannonsPerSide; c++) {
    const frac = totalCannonsPerSide === 1 ? 0 : (c / (totalCannonsPerSide - 1)) * 2 - 1;
    spreadAngles.push(frac * maxSpread);
  }

  const sides = [-Math.PI / 2, Math.PI / 2];
  const weatherSpdBonus = lobbyState.weather === 'gale' ? 2.0 : 0;
  const bulletSpeed = (ship.inventory.some(r => r.id === 'powder') ? 15.5 : 13.5) + weatherSpdBonus + (ship.gachaBonuses.bulletSpeed || 0);

  const necroBroadsideBalance = ship.shipClass === 'necromancer' ? 0.80 : 1.0;
  const dmgMult = (isHellfire ? 1.45 : 1.0) * ambushMult * necroBroadsideBalance;

  const shipVelX = Math.cos(ship.angle) * ship.speed + ship.momX;
  const shipVelY = Math.sin(ship.angle) * ship.speed + ship.momY;

  const isExplosive = (ship.traits && ship.traits.artillery >= 4);
  const bRadius = Math.round((4.5 * (1 + (ship.gachaBonuses.bulletSize || 0))) * 10) / 10;

  sides.forEach(sideOffset => {
    spreadAngles.forEach(spread => {
      const fireAngle = ship.angle + sideOffset + spread;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        homing: false,
        isHarpoon: false,
        explosive: isExplosive,
        radius: bRadius,
        shockOnHit: ship.shipClass === 'stormcaller' || ship.gachaBonuses.forceShock,
        lifestealRatio: ship.lifestealBonus,
        x: Math.round(ship.x + Math.cos(fireAngle) * 30),
        y: Math.round(ship.y + Math.sin(fireAngle) * 30),
        vx: Math.cos(fireAngle) * bulletSpeed + shipVelX * 0.3,
        vy: Math.sin(fireAngle) * bulletSpeed + shipVelY * 0.3,
        damage: ship.damage * dmgMult,
        color: isExplosive ? '#fb923c' : getSkinBulletColor(ship.skin, ship.shipClass, isHellfire),
        life: 58
      });
    });
  });

  // SINERGIA TEMPESTA (4 Pezzi): Ogni 3ª bordata scarica un Fulmine Automatico sul nemico più vicino!
  if (ship.traits && ship.traits.tempest >= 4 && ship.shotsFiredCount % 3 === 0) {
    let closest = null;
    let minD = 350;
    for (let id in players) {
      if (id === ship.id) continue;
      const t = players[id];
      const d = Math.hypot(t.x - ship.x, t.y - ship.y);
      if (d < minD) { minD = d; closest = t; }
    }
    if (closest) {
      const zapDmg = Math.round(ship.damage * 1.15);
      closest.hp -= zapDmg;
      closest.miniShockUntil = now + 900;
      emitDamageNumber(closest.x, closest.y - 20, zapDmg, '#38bdf8', '⚡ ');
      io.emit('lightningFx', {
        fromX: Math.round(ship.x),
        fromY: Math.round(ship.y),
        targets: [{ x: Math.round(closest.x), y: Math.round(closest.y) }]
      });
    }
  }

  // SINERGIA DANNATI (4 Pezzi) o Carta Mitica Trono di Caronte: Evoca Teschi Spettrali Homing!
  const skullCount = ((ship.traits && ship.traits.cursed >= 4 && ship.shotsFiredCount % 2 === 0) ? 2 : 0) + (ship.gachaBonuses.bonusHomingSkull || 0);
  for (let s = 0; s < skullCount; s++) {
    const a = ship.angle + (s % 2 === 0 ? 0.5 : -0.5);
    bullets.push({
      ownerId: ship.id,
      isBossBullet: false,
      homing: true,
      isHarpoon: false,
      radius: 6.5,
      lifestealRatio: ship.lifestealBonus,
      x: Math.round(ship.x + Math.cos(a) * 34),
      y: Math.round(ship.y + Math.sin(a) * 34),
      vx: Math.cos(a) * 9.5,
      vy: Math.sin(a) * 9.5,
      damage: ship.damage * 0.85,
      color: '#e879f9',
      life: 85
    });
  }

  io.emit('cannonFired', { x: Math.round(ship.x), y: Math.round(ship.y), id: ship.id });
}

function fireHarpoon(ship, targetAngle = null) {
  if (lobbyState.phase === 'intermission') return;
  const now = Date.now();

  if (ship.tether) {
    ship.tether = null;
    io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 35), text: '✂️ Cavo Sganciato!', color: '#fde047' });
    return;
  }

  if (now - ship.lastHarpoon < ship.harpoonCd) return;
  ship.lastHarpoon = now;

  revealShipLantern(ship, now);

  const fireAngle = (typeof targetAngle === 'number' && !isNaN(targetAngle)) ? targetAngle : ship.angle;
  const speed = 22;

  bullets.push({
    ownerId: ship.id,
    isBossBullet: false,
    homing: false,
    isHarpoon: true,
    radius: 6,
    lifestealRatio: 0,
    x: Math.round(ship.x + Math.cos(fireAngle) * 34),
    y: Math.round(ship.y + Math.sin(fireAngle) * 34),
    vx: Math.cos(fireAngle) * speed,
    vy: Math.sin(fireAngle) * speed,
    damage: 22,
    color: '#fde047',
    life: 24
  });

  io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: '🪝 Arpione!', color: '#fde047' });
}

function useConsumableItem(ship) {
  if (!ship.consumable || lobbyState.phase === 'intermission') return;
  const item = ship.consumable;
  ship.consumable = null;
  const now = Date.now();

  if (item.id === 'mine') {
    seaMines.push({
      id: Math.random().toString(36).substr(2, 6),
      ownerId: ship.id,
      x: Math.round(ship.x - Math.cos(ship.angle) * 45),
      y: Math.round(ship.y - Math.sin(ship.angle) * 45),
      radius: 26,
      damage: 95,
      life: 450
    });
    io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: '💣 Mina Piazzata!', color: '#f97316' });
  } else if (item.id === 'nitro') {
    ship.nitroUntil = now + 2500;
    ship.speed = ship.maxSpeed * 1.6;
    ship.momX += Math.cos(ship.angle) * 6;
    ship.momY += Math.sin(ship.angle) * 6;
    io.emit('abilityFx', { x: Math.round(ship.x), y: Math.round(ship.y), type: 'phantom' });
    io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: '💨 Vento Stregato!', color: '#38bdf8' });
  } else if (item.id === 'hellfire') {
    ship.hellfireCharged = true;
    ship.lastShot = 0;
    io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: '🧪 Fuoco Greco Pronto!', color: '#a855f7' });
  }
}

function interactBlackMerchant(ship) {
  const now = Date.now();
  if (now - ship.lastMerchantUse < 8000) return;
  const dist = Math.hypot(ship.x - blackMerchant.x, ship.y - blackMerchant.y);
  if (dist > blackMerchant.radius + 30) return;

  const hpCost = Math.round(ship.maxHp * 0.32);
  if (ship.hp <= hpCost + 15) {
    io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: '❌ Troppi pochi HP per il Patto!', color: '#ef4444' });
    return;
  }

  ship.lastMerchantUse = now;
  ship.hp -= hpCost;
  const randomRelic = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
  handleRelicPickup(ship, randomRelic);
  io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 50), text: `⚖️ Patto di Sangue (-${hpCost} HP)`, color: '#c084fc' });
}

function activateAbility(ship) {
  if (!ship.shipClass || lobbyState.phase === 'intermission') return;
  const now = Date.now();
  if (now - ship.lastAbility < ship.abilityCd) return;
  ship.lastAbility = now;

  if (ship.shipClass === 'juggernaut') {
    ship.activeBuffUntil = now + 1800;
    ship.shockedUntil = 0;
    ship.miniShockUntil = 0;
    ship.speed = ship.maxSpeed * 1.9;
    ship.momX += Math.cos(ship.angle) * 5.5;
    ship.momY += Math.sin(ship.angle) * 5.5;
    io.emit('abilityFx', { x: Math.round(ship.x), y: Math.round(ship.y), type: 'juggernaut' });
  } else if (ship.shipClass === 'phantom') {
    ship.activeBuffUntil = now + 3600;
    io.emit('abilityFx', { x: Math.round(ship.x), y: Math.round(ship.y), type: 'phantom' });
  } else if (ship.shipClass === 'necromancer') {
    ship.activeBuffUntil = now + 4500;
    for (let i = 0; i < 6; i++) {
      const a = ship.angle + (Math.PI * 2 * i) / 6;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        homing: true,
        isHarpoon: false,
        radius: 6.5,
        lifestealRatio: Math.min(0.60, 0.50 + ship.lifestealBonus),
        x: Math.round(ship.x + Math.cos(a) * 36),
        y: Math.round(ship.y + Math.sin(a) * 36),
        vx: Math.cos(a) * 9.2,
        vy: Math.sin(a) * 9.2,
        damage: ship.damage * 1.05,
        color: '#e879f9',
        life: 88
      });
    }
    io.emit('abilityFx', { x: Math.round(ship.x), y: Math.round(ship.y), type: 'necromancer' });
  } else if (ship.shipClass === 'stormcaller') {
    ship.activeBuffUntil = now + 2200;
    const zappedTargets = [];
    const zapDmg = Math.round(34 + ship.damage * 1.2);

    for (let id in players) {
      if (id === ship.id) continue;
      const t = players[id];
      if (Math.hypot(t.x - ship.x, t.y - ship.y) <= 370 && zappedTargets.length < 4) {
        t.hp -= zapDmg;
        if (!(t.shipClass === 'juggernaut' && now < t.activeBuffUntil)) {
          t.shockedUntil = now + 2200;
        }
        revealShipLantern(t, now);
        if (t.isRepairing) interruptRepair(t, 'Folgorato!');
        emitDamageNumber(t.x, t.y - 20, zapDmg, '#38bdf8', '⚡ ');
        zappedTargets.push({ x: Math.round(t.x), y: Math.round(t.y) });

        if (t.hp <= 0 && !ship.isBot) {
          ship.kills++;
          ship.xp += 80;
          io.emit('killfeed', { killer: ship.name, victim: t.name, weapon: '⚡ Catena di Fulmini' });
          io.to(ship.id).emit('questEvent', { type: 'kill', amount: 1, doubloons: 12 });
        }
      }
    }

    if (boss.alive && Math.hypot(boss.x - ship.x, boss.y - ship.y) <= 400 && zappedTargets.length < 4) {
      boss.hp -= zapDmg;
      emitDamageNumber(boss.x, boss.y - 20, zapDmg, '#38bdf8', '⚡ ');
      zappedTargets.push({ x: Math.round(boss.x), y: Math.round(boss.y) });
    }

    io.emit('lightningFx', {
      fromX: Math.round(ship.x),
      fromY: Math.round(ship.y),
      targets: zappedTargets
    });
  }
}

function startShipRepair(ship) {
  const now = Date.now();
  if (ship.isRepairing || ship.hp >= ship.maxHp) return;
  if (now - ship.lastRepair < ship.repairCd) return;

  ship.lastRepair = now;
  ship.isRepairing = true;
  ship.repairUntil = now + 4000;
  io.emit('dmgNum', { x: Math.round(ship.x), y: Math.round(ship.y - 30), text: '🛠️ Riparazione...', color: '#4ade80' });
}

function applyClassEvolution(p, chosenClass) {
  if (p.level < 4 || p.shipClass) return;
  if (!['juggernaut', 'phantom', 'necromancer', 'stormcaller'].includes(chosenClass)) return;

  p.shipClass = chosenClass;
  if (chosenClass === 'juggernaut') p.baseAbilityCd = 8000;
  else if (chosenClass === 'phantom') p.baseAbilityCd = 10500;
  else if (chosenClass === 'necromancer') p.baseAbilityCd = 9500;
  else if (chosenClass === 'stormcaller') p.baseAbilityCd = 8500;

  recalculateShipStats(p);
  p.hp = p.maxHp;
}

const EMOTES_LIST = ['☠️ ALL\'ARREMBAGGIO!', '🤝 TREGUA?', '🦑 AL LEVIATANO!', '😂 AHAHAH!'];

io.on('connection', (socket) => {
  socket.on('joinGame', (payload) => {
    const isObj = typeof payload === 'object' && payload !== null;
    const rawName = isObj ? payload.name : payload;
    const meta = isObj ? payload.meta : {};
    const cleanName = (rawName || 'Capitano Senza Nome').trim().slice(0, 18);

    players[socket.id] = createShip(socket.id, cleanName, false, meta, false);
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, rocks });
  });

  socket.on('inputs', (inputs) => {
    if (players[socket.id]) players[socket.id].inputs = inputs;
  });

  socket.on('shoot', () => {
    if (players[socket.id]) fireBroadsides(players[socket.id]);
  });

  socket.on('useHarpoon', (aimAngle) => {
    if (players[socket.id]) fireHarpoon(players[socket.id], aimAngle);
  });

  socket.on('useAbility', () => {
    if (players[socket.id]) activateAbility(players[socket.id]);
  });

  socket.on('useConsumable', () => {
    if (players[socket.id]) useConsumableItem(players[socket.id]);
  });

  socket.on('toggleLantern', () => {
    const p = players[socket.id];
    if (!p) return;
    const now = Date.now();

    if (p.lanternOn) {
      if (now < p.lanternLockUntil) {
        const rem = Math.ceil((p.lanternLockUntil - now) / 1000);
        io.to(p.id).emit('dmgNum', {
          x: Math.round(p.x),
          y: Math.round(p.y - 32),
          text: `⏳ Ricarica Lanterna: ${rem}s`,
          color: '#f87171'
        });
        return;
      }
      p.lanternOn = false;
      p.stealthSince = now;
      io.emit('dmgNum', {
        x: Math.round(p.x),
        y: Math.round(p.y - 32),
        text: '🌑 Furtività Attiva (Max 8s)',
        color: '#94a3b8'
      });
    } else {
      revealShipLantern(p, now);
      io.emit('dmgNum', {
        x: Math.round(p.x),
        y: Math.round(p.y - 32),
        text: '🔦 Lanterna Accesa (6s Ricarica)',
        color: '#fde047'
      });
    }
  });

  socket.on('useMerchant', () => {
    if (players[socket.id]) interactBlackMerchant(players[socket.id]);
  });

  socket.on('sendEmote', () => {
    const p = players[socket.id];
    if (!p) return;
    p.emote = EMOTES_LIST[Math.floor(Math.random() * EMOTES_LIST.length)];
    p.emoteUntil = Date.now() + 3200;
  });

  socket.on('swapRelicSlot', (slotIndex) => {
    const p = players[socket.id];
    if (!p || !p.pendingRelic || Date.now() > p.pendingRelicUntil) return;
    const idx = Number(slotIndex);
    if (idx >= 0 && idx < 3) {
      p.inventory[idx] = p.pendingRelic;
      p.pendingRelic = null;
      recalculateShipStats(p);
      io.emit('dmgNum', { x: Math.round(p.x), y: Math.round(p.y - 35), text: `🔄 Slot ${idx + 1} Aggiornato!`, color: '#5eead4' });
    }
  });

  socket.on('startRepair', () => {
    if (players[socket.id]) startShipRepair(players[socket.id]);
  });

  socket.on('chooseClass', (chosenClass) => {
    if (players[socket.id]) applyClassEvolution(players[socket.id], chosenClass);
  });

  // SELEZIONE CARTA GACHA ROGUELIKE (Tasti 1, 2, 3 o Click)
  socket.on('selectDraftCard', (cardIdx) => {
    const p = players[socket.id];
    if (!p || !p.currentDraft) return;
    const idx = Number(cardIdx);
    if (idx < 0 || idx >= p.currentDraft.length) return;

    const chosenCard = p.currentDraft[idx];
    p.currentDraft = null;
    applyGachaCardToShip(p, chosenCard);

    // Se aveva accumulato altri level up in coda, lancia subito la prossima estrazione!
    triggerNextDraftIfAvailable(p);
  });

  // REROLL DELLE 3 CARTE GACHA (Tasto G)
  socket.on('rerollDraft', () => {
    const p = players[socket.id];
    if (!p || !p.currentDraft || p.rerollsLeft <= 0) return;
    p.rerollsLeft--;
    p.currentDraft = generateDraftOptions(p);
    socket.emit('draftRolled', { options: p.currentDraft, rerollsLeft: p.rerollsLeft });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

function updateBotAI(bot) {
  bot.botTimer++;
  if (bot.level >= 4 && !bot.shipClass) {
    const classes = ['juggernaut', 'phantom', 'necromancer', 'stormcaller'];
    applyClassEvolution(bot, classes[Math.floor(Math.random() * classes.length)]);
  }
  if (bot.draftQueue > 0) {
    triggerNextDraftIfAvailable(bot);
  }

  if (bot.hp < bot.maxHp * 0.4) startShipRepair(bot);
  if (bot.consumable && Math.random() < 0.02) useConsumableItem(bot);

  const distToCenter = Math.hypot(bot.x - storm.x, bot.y - storm.y);
  let avoidX = 0;
  let avoidY = 0;

  for (let otherId in players) {
    if (otherId === bot.id) continue;
    const other = players[otherId];
    const d = Math.hypot(bot.x - other.x, bot.y - other.y);
    const minSpace = other.isBot ? 360 : 210;
    if (d < minSpace && d > 1) {
      avoidX += ((bot.x - other.x) / d) * 2.2;
      avoidY += ((bot.y - other.y) / d) * 2.2;
    }
  }

  if (boss.alive) {
    const dBoss = Math.hypot(bot.x - boss.x, bot.y - boss.y);
    if (dBoss < 320 && dBoss > 1) {
      avoidX += ((bot.x - boss.x) / dBoss) * 3.0;
      avoidY += ((bot.y - boss.y) / dBoss) * 3.0;
    }
  }

  let desiredAngle = bot.patrolAngle;

  if (distToCenter > storm.radius * 0.78) {
    desiredAngle = Math.atan2(storm.y - bot.y, storm.x - bot.x);
  } else if (Math.hypot(avoidX, avoidY) > 0.2) {
    desiredAngle = Math.atan2(avoidY, avoidX);
    bot.patrolAngle = desiredAngle;
  } else if (bot.botTimer % 75 === 0) {
    bot.patrolAngle += (Math.random() - 0.5) * 1.4;
    desiredAngle = bot.patrolAngle;
  }

  const angleDiff = Math.atan2(Math.sin(desiredAngle - bot.angle), Math.cos(desiredAngle - bot.angle));
  bot.inputs.left = angleDiff < -0.08;
  bot.inputs.right = angleDiff > 0.08;
  bot.inputs.up = true;

  if (!bot.isRepairing) {
    for (let id in players) {
      if (id === bot.id) continue;
      const target = players[id];
      const d = Math.hypot(target.x - bot.x, target.y - bot.y);
      const canSeeTarget = target.lanternOn || d < 175;
      if (canSeeTarget && d < 410) {
        fireBroadsides(bot);
        if (bot.shipClass && Math.random() < 0.05) activateAbility(bot);
        break;
      }
    }
  }
}

function calculateExtractionPayout(p, rewardMult) {
  const relicStars = (p.inventory || []).reduce((acc, r) => acc + (r.level || 1), 0);
  return (25 + p.level * 12 + p.kills * 18 + relicStars * 24) * rewardMult;
}

setInterval(() => {
  const now = Date.now();

  if (lobbyState.phase === 'intermission') {
    if (now >= lobbyState.intermissionEndTime) {
      resetEntireLobby();
    }
    io.emit('state', {
      players,
      bullets,
      souls,
      relics,
      consumables,
      seaMines,
      barrels,
      storm,
      boss,
      treasureIsland,
      treasureGalleon,
      whirlpools,
      extractionPortal,
      blackMerchant,
      lobbyState,
      serverTime: now
    });
    return;
  }

  manageBotPopulation(now);

  const timeRemaining = lobbyState.matchEndTime - now;

  if (lobbyState.phase === 'playing' && timeRemaining <= 60000) {
    lobbyState.phase = 'eclipse';
    storm.shrinkSpeed = 3.2;
    io.emit('worldAnnouncement', {
      title: '🌑 L\'ECLISSI ABISSALE È INIZIATA! ULTIMI 60 SECONDI!',
      subtitle: 'La Nebbia si chiude rapidamente! Tutti i Dobloni ottenuti ora valgono DOPPIO (2x)!',
      color: '#ef4444'
    });
  }

  if (timeRemaining <= 0) {
    triggerLobbyIntermission();
    return;
  }

  if (now >= lobbyState.nextWeatherChange) {
    lobbyState.nextWeatherChange = now + 75000;
    const weathers = ['calm', 'gale', 'bloodfog'];
    lobbyState.weather = weathers[Math.floor(Math.random() * weathers.length)];

    const weatherTitles = {
      calm: ['🌊 LE ACQUE SI PLACANO: MARE CALMO', 'Condizioni di navigazione standard ristabilite.', '#38bdf8'],
      gale: ['🌬️ VENTI DI BURRASCA SULL\'ABISSO!', 'Tutte le vele ricevono +25% Velocità e proiettili più rapidi!', '#2dd4bf'],
      bloodfog: ['🌫️ CALA LA NEBBIA DI SANGUE!', 'Visibilità ridotta! Ogni vascello affondato rigenera il 30% degli HP!', '#f43f5e']
    };
    const [wTitle, wSub, wCol] = weatherTitles[lobbyState.weather];
    io.emit('worldAnnouncement', { title: wTitle, subtitle: wSub, color: wCol });
  }

  if (storm.radius > storm.minRadius) {
    storm.radius -= storm.shrinkSpeed / TICK_RATE;
  }

  const rewardMult = lobbyState.phase === 'eclipse' ? 2 : 1;

  if (!extractionPortal.active && now >= extractionPortal.nextSpawnTime) {
    const a = Math.random() * Math.PI * 2;
    const d = 400 + Math.random() * (storm.radius * 0.55);
    extractionPortal.x = Math.round(storm.x + Math.cos(a) * d);
    extractionPortal.y = Math.round(storm.y + Math.sin(a) * d);
    extractionPortal.active = true;

    io.emit('worldAnnouncement', {
      title: '🌀 UN PORTALE DI ESTRAZIONE SI È APERTO!',
      subtitle: 'Il bonus Dobloni scala con il tuo Livello e le Reliquie equipaggiate!',
      color: '#4ade80'
    });
  }

  let topPlayerId = null;
  let bestScore = -1;
  for (let id in players) {
    players[id].isMostWanted = false;
    const sc = players[id].level * 65 + players[id].kills * 120;
    if (players[id].level >= 3 && sc > bestScore) {
      bestScore = sc;
      topPlayerId = id;
    }
  }
  if (topPlayerId && players[topPlayerId]) {
    players[topPlayerId].isMostWanted = true;
    players[topPlayerId].lanternOn = true;
  }

  if (!treasureGalleon.active && now >= treasureGalleon.nextSpawnTime) {
    treasureGalleon.active = true;
    treasureGalleon.hp = treasureGalleon.maxHp;
    treasureGalleon.x = 350;
    treasureGalleon.y = Math.round(900 + Math.random() * 2200);
    treasureGalleon.targetX = MAP_SIZE - 350;
    treasureGalleon.targetY = Math.round(900 + Math.random() * 2200);
    treasureGalleon.angle = Number(Math.atan2(treasureGalleon.targetY - treasureGalleon.y, treasureGalleon.targetX - treasureGalleon.x).toFixed(3));

    io.emit('worldAnnouncement', {
      title: '🚢 IL GALEONE DEL TESORO IMPERIALE STA ATTRAVERSANDO L\'ABISSO!',
      subtitle: 'Intercettalo sulla minimappa prima che raggiunga il bordo opposto!',
      color: '#fde047'
    });
  } else if (treasureGalleon.active) {
    treasureGalleon.x += Math.cos(treasureGalleon.angle) * 2.1;
    treasureGalleon.y += Math.sin(treasureGalleon.angle) * 2.1;

    if (Math.hypot(treasureGalleon.targetX - treasureGalleon.x, treasureGalleon.targetY - treasureGalleon.y) < 80) {
      treasureGalleon.active = false;
      treasureGalleon.nextSpawnTime = now + 75000;
    }
  }

  if (!treasureIsland.active && now >= treasureIsland.nextSpawnTime) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 450 + Math.random() * Math.max(250, storm.radius * 0.5);
    treasureIsland.x = Math.round(MAP_SIZE / 2 + Math.cos(angle) * dist);
    treasureIsland.y = Math.round(MAP_SIZE / 2 + Math.sin(angle) * dist);
    treasureIsland.progress = 0;
    treasureIsland.capturingId = null;
    treasureIsland.contested = false;
    treasureIsland.active = true;

    io.emit('worldAnnouncement', {
      title: '🏝️ L\'ISOLA DEL TESORO MALEDETTA È EMERSA!',
      subtitle: 'Mantieni la posizione nell\'anello dorato per sbloccare il Forziere Antico!',
      color: '#facc15'
    });
  } else if (treasureIsland.active) {
    const shipsInside = Object.values(players).filter(
      p => Math.hypot(p.x - treasureIsland.x, p.y - treasureIsland.y) < treasureIsland.radius &&
           !(p.shipClass === 'phantom' && now < p.activeBuffUntil)
    );

    if (shipsInside.length === 1) {
      treasureIsland.contested = false;
      const capShip = shipsInside[0];
      treasureIsland.capturingId = capShip.id;
      treasureIsland.progress = Math.min(100, treasureIsland.progress + 0.55);

      if (treasureIsland.progress >= 100) {
        treasureIsland.active = false;
        treasureIsland.nextSpawnTime = now + 65000;

        io.emit('worldAnnouncement', {
          title: `💰 ${capShip.name.toUpperCase()} HA SACCHEGGIATO L'ISOLA DEL TESORO!`,
          subtitle: 'Il Forziere Antico è stato aperto!',
          color: '#facc15'
        });

        capShip.xp += 180;
        if (!capShip.isBot) {
          io.to(capShip.id).emit('questEvent', { type: 'island', amount: 1, doubloons: 120 * rewardMult });
        }
        spawnRelicDrop(treasureIsland.x - 40, treasureIsland.y, false);
        spawnRelicDrop(treasureIsland.x + 40, treasureIsland.y, false);
        for (let k = 0; k < 10; k++) {
          spawnSoul(
            treasureIsland.x + (Math.random() - 0.5) * 140,
            treasureIsland.y + (Math.random() - 0.5) * 140,
            45,
            true
          );
        }
      }
    } else if (shipsInside.length > 1) {
      treasureIsland.contested = true;
    } else {
      treasureIsland.contested = false;
      treasureIsland.progress = Math.max(0, treasureIsland.progress - 0.2);
    }
  }

  whirlpools.forEach(wp => {
    wp.x += wp.vx;
    wp.y += wp.vy;
    wp.angle = Number((wp.angle + 0.04).toFixed(3));
    if (wp.x < 500 || wp.x > MAP_SIZE - 500) wp.vx *= -1;
    if (wp.y < 500 || wp.y > MAP_SIZE - 500) wp.vy *= -1;
  });

  for (let i = seaMines.length - 1; i >= 0; i--) {
    const m = seaMines[i];
    m.life--;
    if (m.life <= 0) {
      seaMines.splice(i, 1);
      continue;
    }
    for (let id in players) {
      if (id === m.ownerId) continue;
      const target = players[id];
      if (Math.hypot(target.x - m.x, target.y - m.y) < m.radius + 32) {
        target.hp -= m.damage;
        revealShipLantern(target, now);
        if (target.isRepairing) interruptRepair(target, 'Esplosione Mina!');
        emitDamageNumber(target.x, target.y, m.damage, '#f97316', '💥 ');
        io.emit('hitEffect', { x: m.x, y: m.y });
        seaMines.splice(i, 1);
        break;
      }
    }
  }

  // Boss Leviatano
  if (boss.alive) {
    boss.angle = Number((boss.angle + (boss.enraged ? 0.028 : 0.015)).toFixed(3));

    if (!boss.enraged && boss.hp <= boss.maxHp * 0.5) {
      boss.enraged = true;
      io.emit('worldAnnouncement', {
        title: '⚠️ IL LEVIATANO È IN PREDA ALLA FURIA ABISSALE!',
        subtitle: 'I suoi attacchi al centro della mappa sono raddoppiati!',
        color: '#f43f5e'
      });
    }

    const attackInterval = boss.enraged ? 1750 : 2500;
    if (now - boss.lastAttack > attackInterval) {
      boss.lastAttack = now;
      boss.attackCounter++;
      const someoneClose = Object.values(players).some(p => Math.hypot(p.x - boss.x, p.y - boss.y) < 850);

      if (someoneClose) {
        const count = boss.enraged ? 16 : 12;
        for (let i = 0; i < count; i++) {
          const a = boss.angle + (Math.PI * 2 * i) / count;
          const speed = (boss.attackCounter % 2 === 0) ? 10.5 : 8.0;
          bullets.push({
            ownerId: 'boss',
            isBossBullet: true,
            homing: false,
            isHarpoon: false,
            radius: 7.5,
            x: Math.round(boss.x + Math.cos(a) * 70),
            y: Math.round(boss.y + Math.sin(a) * 70),
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            damage: boss.enraged ? 32 : 25,
            color: boss.enraged ? '#f43f5e' : '#a855f7',
            life: 85
          });
        }
      }
    }
  } else if (now > boss.respawnTimer) {
    boss.alive = true;
    boss.enraged = false;
    boss.hp = boss.maxHp;
    io.emit('worldAnnouncement', {
      title: '🦑 IL LEVIATANO ABISSALE È EMERSO DAGLI ABISSI!',
      subtitle: 'Dirigiti al centro della mappa per dare la caccia alle Reliquie Mitiche!',
      color: '#c084fc'
    });
  }

  // Aggiorna Navi
  for (let id in players) {
    const p = players[id];
    if (p.isBot) updateBotAI(p);

    if (p.pendingRelic && now > p.pendingRelicUntil) p.pendingRelic = null;
    if (p.emote && now > p.emoteUntil) p.emote = null;

    if (!p.lanternOn && now - p.stealthSince >= STEALTH_MAX_DURATION_MS) {
      revealShipLantern(p, now);
      io.emit('dmgNum', {
        x: Math.round(p.x),
        y: Math.round(p.y - 32),
        text: '🔦 Olio d\'Ombra Esaurito (6s Ricarica)',
        color: '#fde047'
      });
    }

    const isBuffActive = now < p.activeBuffUntil;
    const isNitroActive = now < p.nitroUntil;
    const isJuggernautCharging = p.shipClass === 'juggernaut' && isBuffActive;
    const isPhantomIntangible = p.shipClass === 'phantom' && isBuffActive;
    const isShocked = !isJuggernautCharging && now < p.shockedUntil;
    const isMiniShocked = !isJuggernautCharging && now < p.miniShockUntil;

    if (p.isRepairing) {
      if (now >= p.repairUntil || p.hp >= p.maxHp) {
        p.isRepairing = false;
      } else {
        const healPerTick = (p.maxHp * 0.45) / (4 * TICK_RATE);
        p.hp = Math.min(p.maxHp, p.hp + healPerTick);
      }
    }

    // Fisica Cavo Rampino (Tether)
    if (p.tether) {
      if (now >= p.tether.until) {
        p.tether = null;
      } else if (p.tether.type === 'rock') {
        const dx = p.tether.x - p.x;
        const dy = p.tether.y - p.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= (p.tether.minReleaseDist || 85)) {
          p.tether = null;
        } else {
          const nx = dx / dist;
          const ny = dy / dist;
          const cross = Math.cos(p.angle) * ny - Math.sin(p.angle) * nx;
          const swingDir = cross >= 0 ? 1 : -1;
          const tx = -ny * swingDir;
          const ty = nx * swingDir;

          const pullForce = 0.85;
          const swingForce = 0.72 + (Math.abs(p.speed) / p.maxSpeed) * 0.55;

          p.momX += nx * pullForce + tx * swingForce;
          p.momY += ny * pullForce + ty * swingForce;

          const velAngle = Math.atan2(Math.sin(p.angle) * p.speed + p.momY, Math.cos(p.angle) * p.speed + p.momX);
          const diffA = Math.atan2(Math.sin(velAngle - p.angle), Math.cos(velAngle - p.angle));
          p.angle += diffA * 0.14;
        }
      } else if (p.tether.type === 'ship') {
        const target = players[p.tether.targetId];
        if (!target) {
          p.tether = null;
        } else {
          p.tether.x = Math.round(target.x);
          p.tether.y = Math.round(target.y);
          const dx = target.x - p.x;
          const dy = target.y - p.y;
          const dist = Math.hypot(dx, dy);

          if (dist < 75) {
            p.tether = null;
          } else {
            const nx = dx / dist;
            const ny = dy / dist;
            const totalMass = p.mass + target.mass;
            const myPull = (target.mass / totalMass) * 1.45;
            const targetPull = (p.mass / totalMass) * 1.65;

            p.momX += nx * myPull;
            p.momY += ny * myPull;
            target.momX -= nx * targetPull;
            target.momY -= ny * targetPull;
          }
        }
      } else if (p.tether.type === 'boss') {
        if (!boss.alive) {
          p.tether = null;
        } else {
          p.tether.x = Math.round(boss.x);
          p.tether.y = Math.round(boss.y);
          const dx = boss.x - p.x;
          const dy = boss.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < boss.radius + 45) {
            p.tether = null;
          } else {
            const nx = dx / dist;
            const ny = dy / dist;
            p.momX += nx * 1.5;
            p.momY += ny * 1.5;
          }
        }
      }
    }

    if (!p.isBot && extractionPortal.active) {
      const distPortal = Math.hypot(p.x - extractionPortal.x, p.y - extractionPortal.y);
      if (distPortal < extractionPortal.radius) {
        if (!isPhantomIntangible) {
          p.extractProgress = Math.min(100, p.extractProgress + (100 / (5 * TICK_RATE)));
          if (p.extractProgress >= 100) {
            extractionPortal.active = false;
            extractionPortal.nextSpawnTime = now + 75000;
            const extractBonus = calculateExtractionPayout(p, rewardMult);
            io.to(id).emit('extracted', {
              level: p.level,
              kills: p.kills,
              earnedDoubloons: extractBonus
            });
            delete players[id];
            continue;
          }
        }
      } else {
        p.extractProgress = Math.max(0, p.extractProgress - 1.5);
      }
    }

    whirlpools.forEach(wp => {
      const dx = wp.x - p.x;
      const dy = wp.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < wp.radius && d > 5) {
        p.momX += (dx / d) * 0.35;
        p.momY += (dy / d) * 0.35;
        p.angle += 0.025;
        if (d < 55) {
          p.hp -= 0.45;
          if (p.isRepairing) interruptRepair(p, 'Vortice Maelstrom!');
        }
      }
    });

    if (p.shipClass === 'necromancer' && isBuffActive && now - p.lastNecroPulse > 550) {
      p.lastNecroPulse = now;
      for (let otherId in players) {
        if (otherId === id) continue;
        const enemy = players[otherId];
        if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < 260) {
          const drain = 12;
          enemy.hp -= drain;
          if (!(enemy.shipClass === 'juggernaut' && now < enemy.activeBuffUntil)) {
            enemy.speed *= 0.68;
          }
          p.hp = Math.min(p.maxHp, p.hp + drain);
          emitDamageNumber(enemy.x, enemy.y - 15, drain, '#e879f9', '-');
          emitDamageNumber(p.x, p.y - 25, drain, '#4ade80', '+');
        }
      }
    }

    let speedMult = lobbyState.weather === 'gale' ? 1.25 : 1.0;
    if (isPhantomIntangible) speedMult *= 1.38;
    if (isJuggernautCharging) speedMult *= 1.85;
    if (isNitroActive) speedMult = Math.max(speedMult, 1.55);
    if (p.isRepairing) speedMult *= 0.65;
    if (!p.lanternOn) speedMult *= 0.90;
    if (isShocked) speedMult *= 0.45;
    else if (isMiniShocked) speedMult *= 0.82;

    const effectiveMaxSpeed = p.maxSpeed * speedMult;

    if (p.inputs.up) p.speed = Math.min(effectiveMaxSpeed, p.speed + 0.19);
    else if (p.inputs.down) p.speed = Math.max(-effectiveMaxSpeed * 0.35, p.speed - 0.12);
    else p.speed *= 0.955;

    if (p.inputs.left) p.angle -= p.turnSpeed;
    if (p.inputs.right) p.angle += p.turnSpeed;

    p.momX *= 0.91;
    p.momY *= 0.91;
    if (Math.abs(p.momX) < 0.02) p.momX = 0;
    if (Math.abs(p.momY) < 0.02) p.momY = 0;

    p.x += Math.cos(p.angle) * p.speed + p.momX;
    p.y += Math.sin(p.angle) * p.speed + p.momY;

    p.x = Math.max(80, Math.min(MAP_SIZE - 80, p.x));
    p.y = Math.max(80, Math.min(MAP_SIZE - 80, p.y));

    rocks.forEach(r => {
      const dx = p.x - r.x;
      const dy = p.y - r.y;
      const dist = Math.hypot(dx, dy);
      const minDist = r.radius + 32;
      if (dist < minDist && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const push = minDist - dist;
        p.x += nx * push;
        p.y += ny * push;

        const dot = p.momX * nx + p.momY * ny;
        if (dot < 0) {
          p.momX -= nx * dot * 1.1;
          p.momY -= ny * dot * 1.1;
        }
        p.speed *= 0.72;
        if (p.tether && p.tether.rockId === r.id) p.tether = null;
      }
    });

    for (let otherId in players) {
      if (otherId === id) continue;
      const other = players[otherId];
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 64 && dist > 0) {
        const overlap = (64 - dist) * 0.5;
        p.x -= (dx / dist) * overlap;
        p.y -= (dy / dist) * overlap;
        other.x += (dx / dist) * overlap;
        other.y += (dy / dist) * overlap;

        const totalVel = Math.hypot(Math.cos(p.angle) * p.speed + p.momX, Math.sin(p.angle) * p.speed + p.momY);
        if (now > p.ramCooldownUntil && totalVel > 3.6) {
          const ramMult = 1 + (p.gachaBonuses.ramMult || 0) + (p.traits.colossus >= 4 ? 0.5 : 0);
          const ramDmg = Math.round((isJuggernautCharging ? 58 : (p.shipClass === 'juggernaut' ? 30 : 12)) * ramMult);
          other.hp -= ramDmg;
          other.momX += (dx / dist) * 5.5;
          other.momY += (dy / dist) * 5.5;
          revealShipLantern(other, now);
          if (other.isRepairing) interruptRepair(other);
          p.ramCooldownUntil = now + 700;
          emitDamageNumber(other.x, other.y, ramDmg, '#fb923c');
          io.emit('hitEffect', { x: Math.round(other.x), y: Math.round(other.y) });
        }
      }
    }

    const distFromStormCenter = Math.hypot(p.x - storm.x, p.y - storm.y);
    if (distFromStormCenter > storm.radius) {
      p.hp -= lobbyState.phase === 'eclipse' ? 0.75 : 0.4;
    } else if (p.hp < p.maxHp) {
      const hasMythic = p.inventory.some(r => r.id === 'leviathan_heart');
      const regenTick = (hasMythic ? 0.16 : 0.05) + (p.gachaBonuses.regen || 0);
      p.hp = Math.min(p.maxHp, p.hp + regenTick);
    }

    // Magnete Anime (Passiva Negromante o Carte Culto dei Dannati!)
    const magnetRadius = (p.shipClass === 'necromancer' ? 220 : 0) + (p.gachaBonuses.magnet || 0) + (p.traits.cursed >= 2 ? 75 : 0);
    if (magnetRadius > 0) {
      souls.forEach(s => {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < magnetRadius && d > 10) {
          s.x = Math.round(s.x + ((p.x - s.x) / d) * 5.4);
          s.y = Math.round(s.y + ((p.y - s.y) / d) * 5.4);
        }
      });
    }

    // Raccolta Anime + Trigger Estrazione Gacha al Level Up!
    for (let i = souls.length - 1; i >= 0; i--) {
      const s = souls[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < 46) {
        const xpGain = Math.round(s.value * (1 + (p.gachaBonuses.xpMult || 0)));
        p.xp += xpGain;
        p.soulsCollected++;
        const healAmt = (s.isBossDrop ? 22 : 8) + (p.shipClass === 'necromancer' ? 5 : 0);
        p.hp = Math.min(p.maxHp, p.hp + healAmt);
        souls.splice(i, 1);
        if (souls.length < MAX_SOULS) spawnSoul();

        if (!p.isBot) {
          io.to(p.id).emit('questEvent', { type: 'soul', amount: 1, doubloons: (s.isBossDrop ? 4 : 0) * rewardMult });
        }

        let leveledUp = false;
        while (p.xp >= p.maxXp) {
          p.xp -= p.maxXp;
          p.level++;
          p.draftQueue++;
          p.maxXp = Math.floor(p.maxXp * 1.30);
          leveledUp = true;
        }
        if (leveledUp) {
          recalculateShipStats(p);
          p.hp = Math.min(p.maxHp, p.hp + 25);
          p.levelUpShieldUntil = now + 2200; // 2.2s di Scudo Invulnerabile da Level-Up mentre scegli la carta!
          triggerNextDraftIfAvailable(p);
        }
      }
    }

    for (let i = consumables.length - 1; i >= 0; i--) {
      const c = consumables[i];
      if (!p.consumable && Math.hypot(p.x - c.x, p.y - c.y) < 44) {
        p.consumable = { id: c.id, name: c.name, icon: c.icon, color: c.color, desc: c.desc };
        io.emit('dmgNum', { x: Math.round(p.x), y: Math.round(p.y - 32), text: `${c.icon} ${c.name} [Q]`, color: c.color });
        consumables.splice(i, 1);
        if (consumables.length < MAX_CONSUMABLES) spawnConsumable();
      }
    }

    for (let i = relics.length - 1; i >= 0; i--) {
      const rel = relics[i];
      if (Math.hypot(p.x - rel.x, p.y - rel.y) < 48) {
        if (handleRelicPickup(p, rel)) {
          relics.splice(i, 1);
        }
      }
    }

    p.x = Math.round(p.x * 10) / 10;
    p.y = Math.round(p.y * 10) / 10;
    p.angle = Number(p.angle.toFixed(3));
    p.hp = Math.round(p.hp);

    if (p.hp <= 0) {
      for (let k = 0; k < (p.isElite ? 9 : 5); k++) {
        spawnSoul(p.x + (Math.random() - 0.5) * 100, p.y + (Math.random() - 0.5) * 100, 40, true);
      }
      if (p.isElite || Math.random() < 0.45) {
        spawnRelicDrop(p.x, p.y, false);
      }

      if (p.isBot) {
        delete players[id];
        botRespawnCooldownUntil = now + 8000;
      } else {
        const earnedDoubloons = (p.kills * 12 + Math.max(0, (p.level - 1) * 6)) * rewardMult;
        io.to(id).emit('died', {
          level: p.level,
          kills: p.kills,
          souls: p.soulsCollected,
          earnedDoubloons
        });
        delete players[id];
      }
    }
  }

  // Intercettazione Teschi Homing
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b1 = bullets[i];
    if (!b1 || !b1.homing) continue;
    for (let j = bullets.length - 1; j >= 0; j--) {
      if (i === j) continue;
      const b2 = bullets[j];
      if (!b2 || b2.homing || b2.isBossBullet || b2.ownerId === b1.ownerId) continue;
      if (Math.hypot(b1.x - b2.x, b1.y - b2.y) < 20) {
        io.emit('hitEffect', { x: Math.round(b1.x), y: Math.round(b1.y) });
        io.emit('dmgNum', { x: Math.round(b1.x), y: Math.round(b1.y - 10), text: '💥 Teschio Distrutto!', color: '#e879f9' });
        bullets.splice(Math.max(i, j), 1);
        bullets.splice(Math.min(i, j), 1);
        break;
      }
    }
  }

  // Aggiorna Proiettili
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    if (b.homing) {
      let closestTarget = null;
      let minDist = 420;
      for (let tid in players) {
        if (tid === b.ownerId) continue;
        const t = players[tid];
        if (!t.lanternOn && Math.hypot(t.x - b.x, t.y - b.y) > 170) continue;
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        if (d < minDist) { minDist = d; closestTarget = t; }
      }
      if (!closestTarget && boss.alive && Math.hypot(boss.x - b.x, boss.y - b.y) < 450) {
        closestTarget = boss;
      }
      if (closestTarget) {
        const desiredAngle = Math.atan2(closestTarget.y - b.y, closestTarget.x - b.x);
        const curSpeed = Math.hypot(b.vx, b.vy);
        b.vx = b.vx * 0.88 + Math.cos(desiredAngle) * curSpeed * 0.12;
        b.vy = b.vy * 0.88 + Math.sin(desiredAngle) * curSpeed * 0.12;
      }
    }

    b.x = Math.round((b.x + b.vx) * 10) / 10;
    b.y = Math.round((b.y + b.vy) * 10) / 10;
    b.life--;

    if (b.life <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    if (b.isHarpoon && players[b.ownerId]) {
      const shooter = players[b.ownerId];
      let hookedItem = false;
      for (let rIdx = relics.length - 1; rIdx >= 0; rIdx--) {
        if (Math.hypot(b.x - relics[rIdx].x, b.y - relics[rIdx].y) < 38) {
          if (handleRelicPickup(shooter, relics[rIdx])) relics.splice(rIdx, 1);
          hookedItem = true;
          break;
        }
      }
      if (!hookedItem && !shooter.consumable) {
        for (let cIdx = consumables.length - 1; cIdx >= 0; cIdx--) {
          if (Math.hypot(b.x - consumables[cIdx].x, b.y - consumables[cIdx].y) < 38) {
            const c = consumables[cIdx];
            shooter.consumable = { id: c.id, name: c.name, icon: c.icon, color: c.color, desc: c.desc };
            io.emit('dmgNum', { x: Math.round(shooter.x), y: Math.round(shooter.y - 32), text: `🪝 ${c.icon} Catturato!`, color: c.color });
            consumables.splice(cIdx, 1);
            if (consumables.length < MAX_CONSUMABLES) spawnConsumable();
            hookedItem = true;
            break;
          }
        }
      }
      if (hookedItem) {
        bullets.splice(i, 1);
        continue;
      }
    }

    let hitBarrel = false;
    if (!b.isBossBullet) {
      for (let brIdx = barrels.length - 1; brIdx >= 0; brIdx--) {
        const br = barrels[brIdx];
        if (Math.hypot(b.x - br.x, b.y - br.y) < br.radius + 8) {
          barrels.splice(brIdx, 1);
          triggerBarrelExplosion(br, b.ownerId);
          if (barrels.length < MAX_BARRELS) spawnBarrel();
          hitBarrel = true;
          break;
        }
      }
    }
    if (hitBarrel) {
      bullets.splice(i, 1);
      continue;
    }

    let hitRock = false;
    for (let r of rocks) {
      if (Math.hypot(b.x - r.x, b.y - r.y) < r.radius) {
        if (b.isHarpoon && players[b.ownerId]) {
          const shooter = players[b.ownerId];
          shooter.tether = {
            type: 'rock',
            rockId: r.id,
            x: Math.round(b.x),
            y: Math.round(b.y),
            minReleaseDist: r.radius + 48,
            until: now + 1300
          };
          io.emit('dmgNum', {
            x: Math.round(shooter.x),
            y: Math.round(shooter.y - 35),
            text: '🪝 Rampino Agganciato! ([V] per Sganciare)',
            color: '#fde047'
          });
        }
        io.emit('hitEffect', { x: Math.round(b.x), y: Math.round(b.y) });
        hitRock = true;
        break;
      }
    }
    if (hitRock) {
      bullets.splice(i, 1);
      continue;
    }

    if (!b.isBossBullet && treasureGalleon.active && Math.hypot(b.x - treasureGalleon.x, b.y - treasureGalleon.y) < 52) {
      treasureGalleon.hp -= b.damage;
      emitDamageNumber(b.x, b.y, b.damage, '#fde047');
      io.emit('hitEffect', { x: Math.round(b.x), y: Math.round(b.y) });

      if (treasureGalleon.hp <= 0) {
        treasureGalleon.active = false;
        treasureGalleon.nextSpawnTime = now + 80000;
        const killer = players[b.ownerId];
        const killerName = killer ? killer.name : 'Un Pirata';

        io.emit('worldAnnouncement', {
          title: `🚢 ${killerName.toUpperCase()} HA AFFONDATO IL GALEONE DEL TESORO!`,
          subtitle: 'Il carico imperiale di Reliquie e Dobloni è in mare!',
          color: '#fde047'
        });

        if (killer && !killer.isBot) {
          io.to(killer.id).emit('questEvent', { type: 'island', amount: 1, doubloons: 95 * rewardMult });
        }
        spawnRelicDrop(treasureGalleon.x - 35, treasureGalleon.y, false);
        spawnRelicDrop(treasureGalleon.x + 35, treasureGalleon.y, false);
        for (let k = 0; k < 12; k++) {
          spawnSoul(
            treasureGalleon.x + (Math.random() - 0.5) * 110,
            treasureGalleon.y + (Math.random() - 0.5) * 110,
            45,
            true
          );
        }
      }
      bullets.splice(i, 1);
      continue;
    }

    if (!b.isBossBullet && boss.alive && Math.hypot(b.x - boss.x, b.y - boss.y) < boss.radius) {
      boss.hp -= b.damage;
      emitDamageNumber(b.x, b.y, b.damage, '#fbbf24');
      io.emit('hitEffect', { x: Math.round(b.x), y: Math.round(b.y) });

      if (b.isHarpoon && players[b.ownerId]) {
        players[b.ownerId].tether = {
          type: 'boss',
          x: Math.round(boss.x),
          y: Math.round(boss.y),
          until: now + 950
        };
      }

      if (b.lifestealRatio > 0 && players[b.ownerId]) {
        const healer = players[b.ownerId];
        const heal = Math.round(b.damage * b.lifestealRatio * 0.5);
        healer.hp = Math.min(healer.maxHp, healer.hp + heal);
      }

      if (boss.hp <= 0) {
        boss.alive = false;
        boss.respawnTimer = now + 55000;
        const killer = players[b.ownerId];
        const killerName = killer ? killer.name : 'Un Pirata';

        io.emit('worldAnnouncement', {
          title: `👑 ${killerName.toUpperCase()} HA ABBATUTO IL LEVIATANO!`,
          subtitle: 'Reliquie Mitiche e Anime Antiche galleggiano al centro della mappa!',
          color: '#fbbf24'
        });

        if (killer) {
          killer.xp += 260;
          killer.kills += 2;
          if (!killer.isBot) {
            io.to(killer.id).emit('questEvent', { type: 'boss', amount: 1, doubloons: 65 * rewardMult });
          }
        }

        spawnRelicDrop(boss.x, boss.y, true);
        spawnRelicDrop(boss.x - 65, boss.y + 40, false);
        spawnRelicDrop(boss.x + 65, boss.y - 40, false);

        for (let k = 0; k < 16; k++) {
          const ang = (Math.PI * 2 * k) / 16;
          const dist = 45 + Math.random() * 95;
          spawnSoul(boss.x + Math.cos(ang) * dist, boss.y + Math.sin(ang) * dist, 55, true);
        }
      }
      bullets.splice(i, 1);
      continue;
    }

    for (let id in players) {
      if (id === b.ownerId) continue;
      const target = players[id];

      if (target.shipClass === 'phantom' && now < target.activeBuffUntil) continue;
      // Scudo di 2.2s quando sali di livello!
      if (now < (target.levelUpShieldUntil || 0)) continue;

      if (Math.hypot(target.x - b.x, target.y - b.y) < 32 + (b.radius || 4.5)) {
        // CONTROLLO SCHIVATA GACHA (Dodge Chance)
        const dodgeChance = Math.min(0.45, (target.gachaBonuses && target.gachaBonuses.dodge) || 0);
        if (dodgeChance > 0 && Math.random() < dodgeChance) {
          io.emit('dmgNum', { x: Math.round(target.x), y: Math.round(target.y - 25), text: '💨 SCHIVATO!', color: '#38bdf8' });
          bullets.splice(i, 1);
          break;
        }

        const shooter = players[b.ownerId];
        // CONTROLLO COLPO CRITICO GACHA (2x Danno!)
        let critMult = 1.0;
        let isCrit = false;
        if (shooter) {
          const critChance = Math.min(0.75, (shooter.gachaBonuses.crit || 0) + (shooter.traits.fortune >= 2 ? 0.18 : 0));
          if (critChance > 0 && Math.random() < critChance) {
            critMult = 2.0;
            isCrit = true;
            // Sinergia Fortuna (4 Pezzi): I Critici curano +12 HP e danno +4 Dobloni!
            if (shooter.traits.fortune >= 4) {
              shooter.hp = Math.min(shooter.maxHp, shooter.hp + 12);
              if (!shooter.isBot) io.to(shooter.id).emit('questEvent', { type: 'crit_jackpot', amount: 1, doubloons: 4 });
            }
          }
        }

        const dmgReduction = Math.min(0.65, target.armorBonus);
        const finalDmg = b.damage * critMult * (1 - dmgReduction);
        target.hp -= finalDmg;
        target.extractProgress = 0;

        revealShipLantern(target, now);

        // SINERGIA COLOSSO (4 Pezzi) o Spine: Riflette parte del danno contro chi ha sparato!
        const thornsRatio = (target.gachaBonuses.thorns || 0) + (target.traits.colossus >= 4 ? 0.35 : 0);
        if (thornsRatio > 0 && shooter) {
          const reflectDmg = Math.round(finalDmg * thornsRatio);
          shooter.hp -= reflectDmg;
          emitDamageNumber(shooter.x, shooter.y - 15, reflectDmg, '#a3e635', '🌵 ');
        }

        // SINERGIA ARTIGLIERIA (4 Pezzi): Bordata Esplosiva AoE!
        if (b.explosive) {
          for (let nearId in players) {
            if (nearId === b.ownerId || nearId === target.id) continue;
            const nearShip = players[nearId];
            if (Math.hypot(nearShip.x - b.x, nearShip.y - b.y) < 115) {
              const splashDmg = Math.round(finalDmg * 0.35);
              nearShip.hp -= splashDmg;
              emitDamageNumber(nearShip.x, nearShip.y - 15, splashDmg, '#fb923c', '💥 ');
            }
          }
        }

        if (b.isHarpoon && shooter) {
          shooter.tether = {
            type: 'ship',
            targetId: target.id,
            x: Math.round(target.x),
            y: Math.round(target.y),
            until: now + 950
          };
          target.miniShockUntil = now + 950;
          emitDamageNumber(target.x, target.y - 30, finalDmg, '#fde047', '🪝 ARPIONATO! -');
        } else if (isCrit) {
          emitDamageNumber(target.x, target.y - 22, finalDmg, '#facc15', '💥 CRITICO! -');
        } else {
          emitDamageNumber(target.x, target.y - 15, finalDmg, '#f87171');
        }

        if (b.shockOnHit && !(target.shipClass === 'juggernaut' && now < target.activeBuffUntil)) {
          target.miniShockUntil = Math.max(target.miniShockUntil, now + 500);
        }

        if (target.isRepairing) interruptRepair(target, 'Colpito! Riparazione Interrotta!');

        io.emit('hitEffect', { x: Math.round(b.x), y: Math.round(b.y) });

        if (b.lifestealRatio > 0 && shooter) {
          const heal = Math.round(finalDmg * b.lifestealRatio);
          shooter.hp = Math.min(shooter.maxHp, shooter.hp + heal);
          emitDamageNumber(shooter.x, shooter.y - 20, heal, '#4ade80', '+');
        }

        if (target.hp <= 0 && shooter) {
          shooter.kills++;
          shooter.xp += target.isElite ? 140 : 80;

          io.emit('killfeed', {
            killer: shooter.name,
            victim: target.name,
            weapon: b.isHarpoon ? '🪝 Arpione' : (isCrit ? '💥 Colpo Critico' : '💣 Bordata')
          });

          if (lobbyState.weather === 'bloodfog') {
            const bloodHeal = Math.round(shooter.maxHp * 0.3);
            shooter.hp = Math.min(shooter.maxHp, shooter.hp + bloodHeal);
            emitDamageNumber(shooter.x, shooter.y - 25, bloodHeal, '#f43f5e', '🩸 +');
          }

          let bountyBonus = (target.isMostWanted ? 80 : (target.isElite ? 45 : 10)) * rewardMult;
          if (target.isMostWanted) {
            io.emit('worldAnnouncement', {
              title: `💀 TAGLIA RISCOSSA! ${shooter.name.toUpperCase()} HA AFFONDATO IL TERRORE DEI MARI!`,
              subtitle: `Incassa una taglia speciale di +${bountyBonus} Dobloni Abissali!`,
              color: '#fbbf24'
            });
          } else if (target.isElite) {
            io.emit('worldAnnouncement', {
              title: `👹 ${shooter.name.toUpperCase()} HA SCONFITTO IL CAPITANO RINNEGATO ELITE!`,
              subtitle: `Ottiene +${bountyBonus} Dobloni e Reliquie Maledette!`,
              color: '#fb7185'
            });
          }

          if (!shooter.isBot) {
            io.to(shooter.id).emit('questEvent', { type: 'kill', amount: 1, doubloons: bountyBonus });
          }
        }
        bullets.splice(i, 1);
        break;
      }
    }
  }

  io.emit('state', {
    players,
    bullets,
    souls,
    relics,
    consumables,
    seaMines,
    barrels,
    storm,
    boss,
    treasureIsland,
    treasureGalleon,
    whirlpools,
    extractionPortal,
    blackMerchant,
    lobbyState,
    serverTime: now
  });
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏴‍☠️ Abyssal Sails RPG v1.3 (Gacha Roguelike Draft & Synergies) attivo su http://localhost:${PORT}`);
});