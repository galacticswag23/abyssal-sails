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
const MAX_SOULS = 130;
const BOT_COUNT = 6;
const ROCK_COUNT = 18;
const MAX_CONSUMABLES = 12;

// Durata Ciclo Lobby: 6 Minuti di battaglia + 10 Secondi di Podio/Reset
const MATCH_DURATION_MS = 6 * 60 * 1000;
const INTERMISSION_MS = 10 * 1000;

let players = {};
let bullets = [];
let souls = [];
let rocks = [];
let relics = [];
let consumables = [];
let seaMines = [];

// Stato Globale della Lobby & Meteo
let lobbyState = {
  phase: 'playing', // 'playing' | 'eclipse' | 'intermission'
  matchEndTime: Date.now() + MATCH_DURATION_MS,
  intermissionEndTime: 0,
  weather: 'calm', // 'calm' | 'gale' | 'bloodfog'
  nextWeatherChange: Date.now() + 75000,
  podium: []
};

// Portale di Estrazione ("Fuga dall'Abisso")
let extractionPortal = {
  active: false,
  x: 2800,
  y: 2800,
  radius: 110,
  nextSpawnTime: Date.now() + 45000
};

// Mercante Nero ("Il Traghettatore d'Ossa")
let blackMerchant = {
  x: 1100,
  y: 2900,
  radius: 130,
  angle: 0
};

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
      rx = Math.random() * (MAP_SIZE - 500) + 250;
      ry = Math.random() * (MAP_SIZE - 500) + 250;
      distCenter = Math.hypot(rx - MAP_SIZE / 2, ry - MAP_SIZE / 2);
    } while (distCenter < 460);

    rocks.push({
      id: `rock_${i}`,
      x: rx,
      y: ry,
      radius: Math.floor(Math.random() * 35) + 45,
      seed: Math.random() * 100
    });
  }
}

function spawnSoul(x = null, y = null, value = 18, isBossDrop = false) {
  souls.push({
    id: Math.random().toString(36).substr(2, 9),
    x: x !== null ? x : Math.random() * (MAP_SIZE - 400) + 200,
    y: y !== null ? y : Math.random() * (MAP_SIZE - 400) + 200,
    value,
    isBossDrop
  });
}

function spawnConsumable() {
  const t = CONSUMABLE_TYPES[Math.floor(Math.random() * CONSUMABLE_TYPES.length)];
  consumables.push({
    uid: Math.random().toString(36).substr(2, 9),
    x: Math.random() * (MAP_SIZE - 600) + 300,
    y: Math.random() * (MAP_SIZE - 600) + 300,
    ...t
  });
}

function spawnRelicDrop(x, y, forceMythic = false) {
  const template = forceMythic
    ? BOSS_MYTHIC_RELIC
    : RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
  relics.push({
    uid: Math.random().toString(36).substr(2, 9),
    x,
    y,
    ...template
  });
}

const botNames = ['Vascello di Caronte', 'Olandese Nero', 'Spina Abissale', 'Mietitore Salmastro', 'Regina delle Ossa', 'Furia di Sangue'];

function createShip(id, name, isBot = false, meta = {}) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 520 + Math.random() * (storm.radius * 0.55);

  const hullLv = Math.min(10, Math.max(0, Number(meta.hullLv) || 0));
  const cannonLv = Math.min(10, Math.max(0, Number(meta.cannonLv) || 0));
  const sailLv = Math.min(10, Math.max(0, Number(meta.sailLv) || 0));
  const soulLv = Math.min(10, Math.max(0, Number(meta.soulLv) || 0));

  const baseHp = 115 + hullLv * 8;
  const baseDmg = 18 + cannonLv * 1.0;
  const baseSpeed = 5.5 + sailLv * 0.14;

  return {
    id,
    name: name || 'Pirata Maledetto',
    isBot,
    meta, // Memorizzato per il reset automatico della lobby
    skin: meta.skin || (isBot ? 'void' : 'emerald'),
    shipClass: null,
    x: storm.x + Math.cos(angle) * dist,
    y: storm.y + Math.sin(angle) * dist,
    angle: Math.random() * Math.PI * 2,
    speed: 0,
    baseMaxSpeed: baseSpeed,
    maxSpeed: baseSpeed,
    baseTurnSpeed: 0.045 + sailLv * 0.001,
    turnSpeed: 0.045 + sailLv * 0.001,
    baseMaxHp: baseHp,
    hp: baseHp,
    maxHp: baseHp,
    baseDamage: baseDmg,
    damage: baseDmg,
    baseReloadTime: 1350,
    reloadTime: 1350,
    lastShot: 0,
    level: 1,
    xp: soulLv * 10,
    maxXp: 45,
    skillPoints: 0,
    statUpgrades: { hull: 0, cannons: 0, sails: 0, reload: 0 },
    kills: 0,
    soulsCollected: 0,
    isMostWanted: false,
    extractProgress: 0, // 0..100% dentro il Portale di Estrazione
    emote: null,
    emoteUntil: 0,
    lastMerchantUse: 0,
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
    botTimer: 0
  };
}

// =========================================================
// SISTEMA DI RESET DELLA LOBBY & FINE PARTITA
// =========================================================
function triggerLobbyIntermission() {
  lobbyState.phase = 'intermission';
  lobbyState.intermissionEndTime = Date.now() + INTERMISSION_MS;

  // Calcola il Podio dei migliori 3 Vascelli della spedizione
  const sorted = Object.values(players).sort((a, b) => (b.level * 100 + b.kills * 60) - (a.level * 100 + a.kills * 60));
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

  generateMapRocks();
  for (let i = 0; i < MAX_SOULS; i++) spawnSoul();
  for (let i = 0; i < MAX_CONSUMABLES; i++) spawnConsumable();

  extractionPortal.active = false;
  extractionPortal.nextSpawnTime = now + 45000;

  blackMerchant.x = 900 + Math.random() * 2200;
  blackMerchant.y = 900 + Math.random() * 2200;

  // Rigenera tutti i giocatori umani connessi (mantenendo i loro upgrade del Porto) e i Bot al Livello 1!
  const currentIds = Object.keys(players);
  currentIds.forEach(id => {
    const old = players[id];
    players[id] = createShip(id, old.name, old.isBot, old.meta || {});
  });

  // Assicura che i Bot siano sempre presenti
  for (let i = 0; i < BOT_COUNT; i++) {
    const botId = `bot_${i}`;
    if (!players[botId]) {
      players[botId] = createShip(botId, botNames[i], true);
    }
  }

  io.emit('lobbyReset', { rocks });
  io.emit('worldAnnouncement', {
    title: '⚓ NUOVA SPEDIZIONE INIZIATA! MARE RIGENERATO!',
    subtitle: 'Tutti i vascelli ripartono dal Livello 1. Hai 6 minuti prima dell\'Eclissi Abissale!',
    color: '#2dd4bf'
  });
}

// Inizializzazione Avvio Server
generateMapRocks();
for (let i = 0; i < MAX_SOULS; i++) spawnSoul();
for (let i = 0; i < MAX_CONSUMABLES; i++) spawnConsumable();
for (let i = 0; i < BOT_COUNT; i++) {
  const botId = `bot_${i}`;
  players[botId] = createShip(botId, botNames[i], true);
}

function recalculateShipStats(p) {
  let maxHp = p.baseMaxHp + (p.level - 1) * 12 + p.statUpgrades.hull * 30;
  let dmg = p.baseDamage + p.statUpgrades.cannons * 5;
  let maxSpd = p.baseMaxSpeed + p.statUpgrades.sails * 0.6;
  let turnSpd = p.baseTurnSpeed + p.statUpgrades.sails * 0.004;
  let reload = Math.max(400, p.baseReloadTime - p.statUpgrades.reload * 140);
  let lifesteal = 0;
  let armor = 0;

  if (p.shipClass === 'juggernaut') { maxHp += 90; armor += 0.20; }
  if (p.shipClass === 'phantom') { maxSpd += 1.25; turnSpd += 0.01; }
  if (p.shipClass === 'necromancer') { maxHp += 45; dmg += 5; lifesteal += 0.45; }

  const ids = new Set();
  p.inventory.forEach(r => {
    ids.add(r.id);
    const lv = r.level || 1;
    if (r.id === 'chalice') {
      lifesteal += 0.16 * lv;
      r.desc = `+${Math.round(16 * lv)}% Rubavita`;
    } else if (r.id === 'powder') {
      reload *= Math.pow(0.85, lv);
      r.desc = `-${Math.round((1 - Math.pow(0.85, lv)) * 100)}% Ricarica`;
    } else if (r.id === 'bone') {
      maxHp += 55 * lv;
      armor += 0.09 * lv;
      r.desc = `+${55 * lv} HP & +${Math.round(9 * lv)}% Corazza`;
    } else if (r.id === 'compass') {
      maxSpd += 0.65 * lv;
      turnSpd += 0.004 * lv;
      r.desc = `+${Math.round(12 * lv)}% Velocità`;
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

  const synergies = [];
  if (ids.has('chalice') && ids.has('lantern')) {
    synergies.push('🩸🔥 Patto del Vampiro (+15% Danno)');
    dmg *= 1.15;
  }
  if (ids.has('bone') && ids.has('leviathan_heart')) {
    synergies.push('🦴👑 Fortezza Immortale (+15% Corazza)');
    armor += 0.15;
  }
  if (ids.has('powder') && ids.has('compass')) {
    synergies.push('⚡🌬️ Tempesta Perfetta (+Velocità & Ricarica)');
    maxSpd += 0.45;
    reload *= 0.92;
  }

  const hpDiff = maxHp - p.maxHp;
  p.maxHp = Math.round(maxHp);
  if (hpDiff > 0) p.hp = Math.min(p.maxHp, p.hp + hpDiff);
  else p.hp = Math.min(p.maxHp, p.hp);

  p.damage = dmg;
  p.maxSpeed = maxSpd;
  p.turnSpeed = turnSpd;
  p.reloadTime = Math.max(340, Math.round(reload));
  p.lifestealBonus = lifesteal;
  p.armorBonus = Math.min(0.65, armor);
  p.activeSynergies = synergies;
}

function handleRelicPickup(p, relic) {
  const existing = p.inventory.find(r => r.id === relic.id);
  if (existing) {
    if (existing.level < 3) {
      existing.level++;
      recalculateShipStats(p);
      io.emit('dmgNum', {
        x: p.x,
        y: p.y - 38,
        text: `⬆️ ${relic.icon} ${relic.name} GRADO ${existing.level}!`,
        color: '#facc15'
      });
      if (!p.isBot) io.to(p.id).emit('questEvent', { type: 'relic', amount: 1, doubloons: 6 });
      return true;
    } else {
      p.xp += 45;
      p.hp = Math.min(p.maxHp, p.hp + 30);
      io.emit('dmgNum', { x: p.x, y: p.y - 35, text: `✨ Reliquia Max (+45 XP)`, color: '#5eead4' });
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
    io.emit('dmgNum', { x: p.x, y: p.y - 35, text: `${relic.icon} ${relic.name}!`, color: relic.color });
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
  io.emit('dmgNum', { x: p.x, y: p.y - 35, text: `🎒 Inventario Pieno! Scegli Slot [Z/X/C]`, color: '#fbbf24' });
  return true;
}

function emitDamageNumber(x, y, amount, color = '#f87171', prefix = '') {
  io.emit('dmgNum', { x, y, text: `${prefix}${Math.round(amount)}`, color });
}

function interruptRepair(ship, reasonText = 'Riparazione Interrotta!') {
  if (!ship.isRepairing) return;
  ship.isRepairing = false;
  ship.repairUntil = 0;
  io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: reasonText, color: '#fb923c' });
}

function getSkinBulletColor(skin, shipClass, isHellfire) {
  if (isHellfire) return '#f97316';
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

  if (ship.isRepairing) interruptRepair(ship);

  const isHellfire = ship.hellfireCharged;
  ship.hellfireCharged = false;

  const sides = [-Math.PI / 2, Math.PI / 2];
  const spreadAngles = ship.shipClass === 'necromancer'
    ? [-0.22, -0.11, 0, 0.11, 0.22]
    : [-0.14, 0, 0.14];

  const weatherSpdBonus = lobbyState.weather === 'gale' ? 2.0 : 0;
  const bulletSpeed = (ship.inventory.some(r => r.id === 'powder') ? 15.5 : 13.5) + weatherSpdBonus;
  const dmgMult = isHellfire ? 1.45 : 1.0;

  sides.forEach(sideOffset => {
    spreadAngles.forEach(spread => {
      const fireAngle = ship.angle + sideOffset + spread;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        homing: false,
        lifestealRatio: ship.lifestealBonus,
        x: ship.x + Math.cos(fireAngle) * 30,
        y: ship.y + Math.sin(fireAngle) * 30,
        vx: Math.cos(fireAngle) * bulletSpeed + Math.cos(ship.angle) * (ship.speed * 0.3),
        vy: Math.sin(fireAngle) * bulletSpeed + Math.sin(ship.angle) * (ship.speed * 0.3),
        damage: ship.damage * dmgMult,
        color: getSkinBulletColor(ship.skin, ship.shipClass, isHellfire),
        life: 60
      });
    });
  });

  io.emit('cannonFired', { x: ship.x, y: ship.y, id: ship.id });
}

function useConsumableItem(ship) {
  if (!ship.consumable || lobbyState.phase === 'intermission') return;
  const item = ship.consumable;
  ship.consumable = null;
  const now = Date.now();

  if (item.id === 'mine') {
    seaMines.push({
      id: Math.random().toString(36).substr(2, 9),
      ownerId: ship.id,
      x: ship.x - Math.cos(ship.angle) * 45,
      y: ship.y - Math.sin(ship.angle) * 45,
      radius: 26,
      damage: 95,
      life: 450
    });
    io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: '💣 Mina Piazzata!', color: '#f97316' });
  } else if (item.id === 'nitro') {
    ship.nitroUntil = now + 2500;
    ship.speed = ship.maxSpeed * 1.9;
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'phantom' });
    io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: '💨 Vento Stregato!', color: '#38bdf8' });
  } else if (item.id === 'hellfire') {
    ship.hellfireCharged = true;
    ship.lastShot = 0;
    io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: '🧪 Fuoco Greco Pronto!', color: '#a855f7' });
  }
}

// Interazione col Mercante Nero [F]: Sacrifica il 35% degli HP per una Reliquia Maledetta
function interactBlackMerchant(ship) {
  const now = Date.now();
  if (now - ship.lastMerchantUse < 8000) return;
  const dist = Math.hypot(ship.x - blackMerchant.x, ship.y - blackMerchant.y);
  if (dist > blackMerchant.radius + 30) return;

  const hpCost = Math.round(ship.maxHp * 0.32);
  if (ship.hp <= hpCost + 15) {
    io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: '❌ Troppi pochi HP per il Patto!', color: '#ef4444' });
    return;
  }

  ship.lastMerchantUse = now;
  ship.hp -= hpCost;
  const randomRelic = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
  handleRelicPickup(ship, randomRelic);
  io.emit('dmgNum', { x: ship.x, y: ship.y - 50, text: `⚖️ Patto di Sangue (-${hpCost} HP)`, color: '#c084fc' });
}

function activateAbility(ship) {
  if (!ship.shipClass || lobbyState.phase === 'intermission') return;
  const now = Date.now();
  if (now - ship.lastAbility < ship.abilityCd) return;
  ship.lastAbility = now;

  if (ship.shipClass === 'juggernaut') {
    ship.activeBuffUntil = now + 1700;
    ship.speed = ship.maxSpeed * 2.2;
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'juggernaut' });
  } else if (ship.shipClass === 'phantom') {
    ship.activeBuffUntil = now + 3600;
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'phantom' });
  } else if (ship.shipClass === 'necromancer') {
    ship.activeBuffUntil = now + 4500;
    for (let i = 0; i < 6; i++) {
      const a = ship.angle + (Math.PI * 2 * i) / 6;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        homing: true,
        lifestealRatio: 0.65 + ship.lifestealBonus,
        x: ship.x + Math.cos(a) * 36,
        y: ship.y + Math.sin(a) * 36,
        vx: Math.cos(a) * 9.5,
        vy: Math.sin(a) * 9.5,
        damage: ship.damage * 1.15,
        color: '#e879f9',
        life: 95
      });
    }
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'necromancer' });
  }
}

function startShipRepair(ship) {
  const now = Date.now();
  if (ship.isRepairing || ship.hp >= ship.maxHp) return;
  if (now - ship.lastRepair < ship.repairCd) return;

  ship.lastRepair = now;
  ship.isRepairing = true;
  ship.repairUntil = now + 4000;
  io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: '🛠️ Riparazione...', color: '#4ade80' });
}

function applyClassEvolution(p, chosenClass) {
  if (p.level < 4 || p.shipClass) return;
  if (!['juggernaut', 'phantom', 'necromancer'].includes(chosenClass)) return;

  p.shipClass = chosenClass;
  if (chosenClass === 'juggernaut') p.abilityCd = 8000;
  else if (chosenClass === 'phantom') p.abilityCd = 10500;
  else if (chosenClass === 'necromancer') p.abilityCd = 9500;

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

    players[socket.id] = createShip(socket.id, cleanName, false, meta);
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE, rocks });
  });

  socket.on('inputs', (inputs) => {
    if (players[socket.id]) players[socket.id].inputs = inputs;
  });

  socket.on('shoot', () => {
    if (players[socket.id]) fireBroadsides(players[socket.id]);
  });

  socket.on('useAbility', () => {
    if (players[socket.id]) activateAbility(players[socket.id]);
  });

  socket.on('useConsumable', () => {
    if (players[socket.id]) useConsumableItem(players[socket.id]);
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
      io.emit('dmgNum', { x: p.x, y: p.y - 35, text: `🔄 Slot ${idx + 1} Aggiornato!`, color: '#5eead4' });
    }
  });

  socket.on('startRepair', () => {
    if (players[socket.id]) startShipRepair(players[socket.id]);
  });

  socket.on('chooseClass', (chosenClass) => {
    if (players[socket.id]) applyClassEvolution(players[socket.id], chosenClass);
  });

  socket.on('upgradeStat', (stat) => {
    const p = players[socket.id];
    if (!p || p.skillPoints <= 0) return;
    if (!['hull', 'cannons', 'sails', 'reload'].includes(stat)) return;

    p.skillPoints--;
    p.statUpgrades[stat]++;
    recalculateShipStats(p);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

function updateBotAI(bot) {
  bot.botTimer++;
  if (bot.level >= 4 && !bot.shipClass) {
    const classes = ['juggernaut', 'phantom', 'necromancer'];
    applyClassEvolution(bot, classes[Math.floor(Math.random() * classes.length)]);
  }
  if (bot.skillPoints > 0) {
    const stats = ['hull', 'cannons', 'sails', 'reload'];
    const st = stats[Math.floor(Math.random() * stats.length)];
    bot.skillPoints--;
    bot.statUpgrades[st]++;
    recalculateShipStats(bot);
  }

  if (bot.hp < bot.maxHp * 0.4) startShipRepair(bot);
  if (bot.consumable && Math.random() < 0.02) useConsumableItem(bot);

  const distToCenter = Math.hypot(bot.x - storm.x, bot.y - storm.y);
  if (distToCenter > storm.radius * 0.78) {
    const targetAngle = Math.atan2(storm.y - bot.y, storm.x - bot.x);
    let diff = Math.atan2(Math.sin(targetAngle - bot.angle), Math.cos(targetAngle - bot.angle));
    bot.inputs.left = diff < -0.1;
    bot.inputs.right = diff > 0.1;
    bot.inputs.up = true;
  } else {
    bot.inputs.up = true;
    if (bot.botTimer % 45 === 0) {
      bot.inputs.left = Math.random() < 0.4;
      bot.inputs.right = !bot.inputs.left && Math.random() < 0.4;
    }
  }

  if (!bot.isRepairing) {
    for (let id in players) {
      if (id === bot.id) continue;
      const target = players[id];
      const d = Math.hypot(target.x - bot.x, target.y - bot.y);
      if (d < 430) {
        fireBroadsides(bot);
        if (bot.shipClass && Math.random() < 0.06) activateAbility(bot);
        break;
      }
    }
  }
}

setInterval(() => {
  const now = Date.now();

  // GESTIONE FASE DI FINE PARTITA & RESET DELLA LOBBY
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

  const timeRemaining = lobbyState.matchEndTime - now;

  // Ultimi 60 Secondi: Attiva L'Eclissi Abissale (2x Dobloni + Tempesta Rapida)
  if (lobbyState.phase === 'playing' && timeRemaining <= 60000) {
    lobbyState.phase = 'eclipse';
    storm.shrinkSpeed = 3.2;
    io.emit('worldAnnouncement', {
      title: '🌑 L\'ECLISSI ABISSALE È INIZIATA! ULTIMI 60 SECONDI!',
      subtitle: 'La Nebbia si chiude rapidamente! Tutti i Dobloni ottenuti ora valgono DOPPIO (2x)!',
      color: '#ef4444'
    });
  }

  // Scadenza Timer 6 Minuti -> Podio & Reset Lobby
  if (timeRemaining <= 0) {
    triggerLobbyIntermission();
    return;
  }

  // Cambio Meteo Globale ogni 75s
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

  // Portale di Estrazione ("Fuga dall'Abisso")
  if (!extractionPortal.active && now >= extractionPortal.nextSpawnTime) {
    const a = Math.random() * Math.PI * 2;
    const d = 400 + Math.random() * (storm.radius * 0.55);
    extractionPortal.x = storm.x + Math.cos(a) * d;
    extractionPortal.y = storm.y + Math.sin(a) * d;
    extractionPortal.active = true;

    io.emit('worldAnnouncement', {
      title: '🌀 UN PORTALE DI ESTRAZIONE SI È APERTO!',
      subtitle: 'Resta nel vortice verde per 5s per tornare al Porto con +50 Dobloni Bonus!',
      color: '#4ade80'
    });
  }

  // Most Wanted
  let topPlayerId = null;
  let bestScore = -1;
  for (let id in players) {
    players[id].isMostWanted = false;
    const sc = players[id].level * 100 + players[id].kills * 50;
    if (players[id].level >= 3 && sc > bestScore) {
      bestScore = sc;
      topPlayerId = id;
    }
  }
  if (topPlayerId && players[topPlayerId]) {
    players[topPlayerId].isMostWanted = true;
  }

  // Galeone del Tesoro Imperiale
  if (!treasureGalleon.active && now >= treasureGalleon.nextSpawnTime) {
    treasureGalleon.active = true;
    treasureGalleon.hp = treasureGalleon.maxHp;
    treasureGalleon.x = 350;
    treasureGalleon.y = 900 + Math.random() * 2200;
    treasureGalleon.targetX = MAP_SIZE - 350;
    treasureGalleon.targetY = 900 + Math.random() * 2200;
    treasureGalleon.angle = Math.atan2(treasureGalleon.targetY - treasureGalleon.y, treasureGalleon.targetX - treasureGalleon.x);

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

  // Isola del Tesoro Maledetta
  if (!treasureIsland.active && now >= treasureIsland.nextSpawnTime) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 500 + Math.random() * 700;
    treasureIsland.x = MAP_SIZE / 2 + Math.cos(angle) * dist;
    treasureIsland.y = MAP_SIZE / 2 + Math.sin(angle) * dist;
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
      p => Math.hypot(p.x - treasureIsland.x, p.y - treasureIsland.y) < treasureIsland.radius
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
    wp.angle += 0.04;
    if (wp.x < 500 || wp.x > MAP_SIZE - 500) wp.vx *= -1;
    if (wp.y < 500 || wp.y > MAP_SIZE - 500) wp.vy *= -1;
  });

  // Mine Abissali
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
    boss.angle += boss.enraged ? 0.028 : 0.015;

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
            x: boss.x + Math.cos(a) * 70,
            y: boss.y + Math.sin(a) * 70,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            damage: boss.enraged ? 32 : 25,
            color: boss.enraged ? '#f43f5e' : '#a855f7',
            life: 90
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

    const isBuffActive = now < p.activeBuffUntil;
    const isNitroActive = now < p.nitroUntil;

    if (p.isRepairing) {
      if (now >= p.repairUntil || p.hp >= p.maxHp) {
        p.isRepairing = false;
      } else {
        const healPerTick = (p.maxHp * 0.45) / (4 * TICK_RATE);
        p.hp = Math.min(p.maxHp, p.hp + healPerTick);
      }
    }

    // Controllo Portale di Estrazione (Solo Giocatori Umani)
    if (!p.isBot && extractionPortal.active) {
      const distPortal = Math.hypot(p.x - extractionPortal.x, p.y - extractionPortal.y);
      if (distPortal < extractionPortal.radius) {
        p.extractProgress = Math.min(100, p.extractProgress + (100 / (5 * TICK_RATE)));
        if (p.extractProgress >= 100) {
          extractionPortal.active = false;
          extractionPortal.nextSpawnTime = now + 75000;
          const extractBonus = (p.kills * 15 + p.level * 10 + 50) * rewardMult;
          io.to(id).emit('extracted', {
            level: p.level,
            kills: p.kills,
            earnedDoubloons: extractBonus
          });
          delete players[id];
          continue;
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
        p.x += (dx / d) * 2.1;
        p.y += (dy / d) * 2.1;
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
          enemy.speed *= 0.65;
          p.hp = Math.min(p.maxHp, p.hp + drain);
          emitDamageNumber(enemy.x, enemy.y - 15, drain, '#e879f9', '-');
          emitDamageNumber(p.x, p.y - 25, drain, '#4ade80', '+');
        }
      }
    }

    let speedMult = lobbyState.weather === 'gale' ? 1.25 : 1.0;
    if (p.shipClass === 'phantom' && isBuffActive) speedMult *= 1.45;
    if (p.shipClass === 'juggernaut' && isBuffActive) speedMult *= 1.85;
    if (isNitroActive) speedMult = Math.max(speedMult, 1.55);
    if (p.isRepairing) speedMult *= 0.65;

    const effectiveMaxSpeed = p.maxSpeed * speedMult;

    if (p.inputs.up) p.speed = Math.min(effectiveMaxSpeed, p.speed + 0.2);
    else if (p.inputs.down) p.speed = Math.max(-effectiveMaxSpeed * 0.35, p.speed - 0.12);
    else p.speed *= 0.96;

    if (p.inputs.left) p.angle -= p.turnSpeed;
    if (p.inputs.right) p.angle += p.turnSpeed;

    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;

    p.x = Math.max(80, Math.min(MAP_SIZE - 80, p.x));
    p.y = Math.max(80, Math.min(MAP_SIZE - 80, p.y));

    rocks.forEach(r => {
      const dx = p.x - r.x;
      const dy = p.y - r.y;
      const dist = Math.hypot(dx, dy);
      const minDist = r.radius + 32;
      if (dist < minDist && dist > 0) {
        const push = (minDist - dist);
        p.x += (dx / dist) * push;
        p.y += (dy / dist) * push;
        p.speed *= 0.6;
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

        if (now > p.ramCooldownUntil && Math.abs(p.speed) > 3.5) {
          const ramDmg = (p.shipClass === 'juggernaut' && isBuffActive) ? 58 : (p.shipClass === 'juggernaut' ? 30 : 10);
          other.hp -= ramDmg;
          if (other.isRepairing) interruptRepair(other);
          p.ramCooldownUntil = now + 700;
          emitDamageNumber(other.x, other.y, ramDmg, '#fb923c');
          io.emit('hitEffect', { x: other.x, y: other.y });
        }
      }
    }

    const distFromStormCenter = Math.hypot(p.x - storm.x, p.y - storm.y);
    if (distFromStormCenter > storm.radius) {
      p.hp -= lobbyState.phase === 'eclipse' ? 0.75 : 0.4;
    } else if (p.hp < p.maxHp) {
      const hasMythic = p.inventory.some(r => r.id === 'leviathan_heart');
      p.hp = Math.min(p.maxHp, p.hp + (hasMythic ? 0.16 : 0.05));
    }

    if (p.shipClass === 'necromancer') {
      souls.forEach(s => {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < 220 && d > 10) {
          s.x += ((p.x - s.x) / d) * 5.2;
          s.y += ((p.y - s.y) / d) * 5.2;
        }
      });
    }

    for (let i = souls.length - 1; i >= 0; i--) {
      const s = souls[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < 46) {
        p.xp += s.value;
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
          p.skillPoints++;
          p.maxXp = Math.floor(p.maxXp * 1.32);
          leveledUp = true;
        }
        if (leveledUp) {
          recalculateShipStats(p);
          p.hp = p.maxHp;
        }
      }
    }

    for (let i = consumables.length - 1; i >= 0; i--) {
      const c = consumables[i];
      if (!p.consumable && Math.hypot(p.x - c.x, p.y - c.y) < 44) {
        p.consumable = { id: c.id, name: c.name, icon: c.icon, color: c.color, desc: c.desc };
        io.emit('dmgNum', { x: p.x, y: p.y - 32, text: `${c.icon} ${c.name} [Q]`, color: c.color });
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

    if (p.hp <= 0) {
      for (let k = 0; k < 6; k++) {
        spawnSoul(p.x + (Math.random() - 0.5) * 100, p.y + (Math.random() - 0.5) * 100, 40, true);
      }
      if (Math.random() < 0.45) {
        spawnRelicDrop(p.x, p.y, false);
      }

      if (p.isBot) {
        players[id] = createShip(id, p.name, true);
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

  // Aggiorna Proiettili
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    if (b.homing) {
      let closestTarget = null;
      let minDist = 420;
      for (let tid in players) {
        if (tid === b.ownerId) continue;
        const t = players[tid];
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

    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    if (b.life <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    let hitRock = false;
    for (let r of rocks) {
      if (Math.hypot(b.x - r.x, b.y - r.y) < r.radius) {
        io.emit('hitEffect', { x: b.x, y: b.y });
        hitRock = true;
        break;
      }
    }
    if (hitRock) {
      bullets.splice(i, 1);
      continue;
    }

    // Impatto Galeone Imperiale
    if (!b.isBossBullet && treasureGalleon.active && Math.hypot(b.x - treasureGalleon.x, b.y - treasureGalleon.y) < 52) {
      treasureGalleon.hp -= b.damage;
      emitDamageNumber(b.x, b.y, b.damage, '#fde047');
      io.emit('hitEffect', { x: b.x, y: b.y });

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

    // Impatto Boss Leviatano
    if (!b.isBossBullet && boss.alive && Math.hypot(b.x - boss.x, b.y - boss.y) < boss.radius) {
      boss.hp -= b.damage;
      emitDamageNumber(b.x, b.y, b.damage, '#fbbf24');
      io.emit('hitEffect', { x: b.x, y: b.y });

      if (b.lifestealRatio > 0 && players[b.ownerId]) {
        const healer = players[b.ownerId];
        const heal = Math.round(b.damage * b.lifestealRatio);
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

        for (let k = 0; k < 18; k++) {
          const ang = (Math.PI * 2 * k) / 18;
          const dist = 45 + Math.random() * 95;
          spawnSoul(boss.x + Math.cos(ang) * dist, boss.y + Math.sin(ang) * dist, 55, true);
        }
      }
      bullets.splice(i, 1);
      continue;
    }

    // Impatto Navi
    for (let id in players) {
      if (id === b.ownerId) continue;
      const target = players[id];

      if (target.shipClass === 'phantom' && now < target.activeBuffUntil) continue;

      if (Math.hypot(target.x - b.x, target.y - b.y) < 35) {
        const dmgReduction = Math.min(0.65, target.armorBonus);
        const finalDmg = b.damage * (1 - dmgReduction);
        target.hp -= finalDmg;
        target.extractProgress = 0; // Subire danni azzera l'estrazione nel portale!

        if (target.isRepairing) interruptRepair(target, 'Colpito! Riparazione Interrotta!');

        emitDamageNumber(target.x, target.y - 15, finalDmg, '#f87171');
        io.emit('hitEffect', { x: b.x, y: b.y });

        if (b.lifestealRatio > 0 && players[b.ownerId]) {
          const healer = players[b.ownerId];
          const heal = Math.round(finalDmg * b.lifestealRatio);
          healer.hp = Math.min(healer.maxHp, healer.hp + heal);
          emitDamageNumber(healer.x, healer.y - 20, heal, '#4ade80', '+');
        }

        if (target.hp <= 0 && players[b.ownerId]) {
          const killer = players[b.ownerId];
          killer.kills++;
          killer.xp += 80;

          // Se il meteo è Nebbia di Sangue, ogni kill cura il 30% degli HP!
          if (lobbyState.weather === 'bloodfog') {
            const bloodHeal = Math.round(killer.maxHp * 0.3);
            killer.hp = Math.min(killer.maxHp, killer.hp + bloodHeal);
            emitDamageNumber(killer.x, killer.y - 25, bloodHeal, '#f43f5e', '🩸 +');
          }

          const bountyBonus = (target.isMostWanted ? 80 : 10) * rewardMult;
          if (target.isMostWanted) {
            io.emit('worldAnnouncement', {
              title: `💀 TAGLIA RISCOSSA! ${killer.name.toUpperCase()} HA AFFONDATO IL TERRORE DEI MARI!`,
              subtitle: `Incassa una taglia speciale di +${bountyBonus} Dobloni Abissali!`,
              color: '#fbbf24'
            });
          }

          if (!killer.isBot) {
            io.to(killer.id).emit('questEvent', { type: 'kill', amount: 1, doubloons: bountyBonus });
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
  console.log(`🏴‍☠️ Abyssal Sails RPG v0.8 (Lobby Cycle, Extraction & Weather) attivo su http://localhost:${PORT}`);
});