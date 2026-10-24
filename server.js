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

let players = {};
let bullets = [];
let souls = [];
let rocks = [];
let relics = []; // Reliquie galleggianti in mare

// Catalogo Reliquie RPG
const RELIC_TYPES = [
  { id: 'chalice', name: 'Calice di Sangue', icon: '🩸', color: '#f43f5e', desc: '+20% Rubavita' },
  { id: 'powder', name: 'Polvere Abissale', icon: '⚡', color: '#38bdf8', desc: '-18% Ricarica' },
  { id: 'bone', name: 'Corazza d\'Ossa', icon: '🦴', color: '#a3e635', desc: '+60 HP & Corazza' },
  { id: 'compass', name: 'Bussola Spettrale', icon: '🌬️', color: '#2dd4bf', desc: '+15% Velocità' },
  { id: 'lantern', name: 'Lanterna Maledetta', icon: '🔥', color: '#fb923c', desc: '+22% Danno' }
];
const BOSS_MYTHIC_RELIC = {
  id: 'leviathan_heart',
  name: 'Cuore del Leviatano',
  icon: '👑',
  color: '#c084fc',
  desc: 'MITICA: +80 HP, +25% Danno & Regen'
};

let storm = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  radius: MAP_SIZE * 0.68,
  minRadius: 420,
  shrinkSpeed: 1.1
};

// Boss Mondiale Potenziato
let boss = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  hp: 2600,
  maxHp: 2600,
  radius: 82,
  angle: 0,
  alive: true,
  enraged: false,
  respawnTimer: 0,
  lastAttack: 0,
  attackCounter: 0
};

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

function spawnSoul(x = null, y = null, value = 18, isBossDrop = false) {
  souls.push({
    id: Math.random().toString(36).substr(2, 9),
    x: x !== null ? x : Math.random() * (MAP_SIZE - 400) + 200,
    y: y !== null ? y : Math.random() * (MAP_SIZE - 400) + 200,
    value,
    isBossDrop
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

for (let i = 0; i < MAX_SOULS; i++) spawnSoul();

function createShip(id, name, isBot = false) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 520 + Math.random() * (storm.radius * 0.55);
  return {
    id,
    name: name || 'Pirata Maledetto',
    isBot,
    shipClass: null,
    x: storm.x + Math.cos(angle) * dist,
    y: storm.y + Math.sin(angle) * dist,
    angle: Math.random() * Math.PI * 2,
    speed: 0,
    maxSpeed: 5.5,
    turnSpeed: 0.045,
    hp: 115,
    maxHp: 115,
    damage: 18,
    reloadTime: 1350,
    lastShot: 0,
    level: 1,
    xp: 0,
    maxXp: 45,
    skillPoints: 0,
    kills: 0,
    abilityCd: 10000,
    lastAbility: 0,
    activeBuffUntil: 0,
    lastNecroPulse: 0,
    // Sistema di Riparazione [R]
    isRepairing: false,
    repairUntil: 0,
    lastRepair: 0,
    repairCd: 18000,
    // Equipaggiamento Reliquie (Max 3 slot)
    inventory: [],
    lifestealBonus: 0,
    armorBonus: 0,
    ramCooldownUntil: 0,
    inputs: { up: false, down: false, left: false, right: false },
    botTimer: 0
  };
}

const botNames = ['Vascello di Caronte', 'Olandese Nero', 'Spina Abissale', 'Mietitore Salmastro', 'Regina delle Ossa', 'Furia di Sangue'];
for (let i = 0; i < BOT_COUNT; i++) {
  const botId = `bot_${i}`;
  players[botId] = createShip(botId, botNames[i], true);
}

function emitDamageNumber(x, y, amount, color = '#f87171', prefix = '') {
  io.emit('dmgNum', { x, y, text: `${prefix}${Math.round(amount)}`, color });
}

function applyRelicToShip(p, relic) {
  if (p.inventory.length >= 3) {
    // Sostituisce la reliquia più vecchia (tranne se mitica)
    const removed = p.inventory.shift();
    if (removed.id === 'chalice') p.lifestealBonus -= 0.2;
    if (removed.id === 'powder') p.reloadTime = Math.min(1800, p.reloadTime / 0.82);
    if (removed.id === 'bone') { p.maxHp -= 60; p.hp = Math.min(p.hp, p.maxHp); p.armorBonus -= 0.12; }
    if (removed.id === 'compass') { p.maxSpeed -= 0.8; p.turnSpeed -= 0.005; }
    if (removed.id === 'lantern') p.damage -= 4;
  }

  p.inventory.push({ id: relic.id, name: relic.name, icon: relic.icon, color: relic.color, desc: relic.desc });

  if (relic.id === 'chalice') p.lifestealBonus += 0.2;
  if (relic.id === 'powder') p.reloadTime = Math.max(380, p.reloadTime * 0.82);
  if (relic.id === 'bone') { p.maxHp += 60; p.hp += 60; p.armorBonus += 0.12; }
  if (relic.id === 'compass') { p.maxSpeed += 0.8; p.turnSpeed += 0.005; }
  if (relic.id === 'lantern') p.damage += 4;
  if (relic.id === 'leviathan_heart') {
    p.maxHp += 80;
    p.hp += 80;
    p.damage += 6;
    p.lifestealBonus += 0.15;
  }

  io.emit('dmgNum', { x: p.x, y: p.y - 35, text: `${relic.icon} ${relic.name}!`, color: relic.color });
}

function interruptRepair(ship, reasonText = 'Riparazione Interrotta!') {
  if (!ship.isRepairing) return;
  ship.isRepairing = false;
  ship.repairUntil = 0;
  io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: reasonText, color: '#fb923c' });
}

function fireBroadsides(ship) {
  const now = Date.now();
  if (now - ship.lastShot < ship.reloadTime) return;
  ship.lastShot = now;

  // Sparare interrompe la riparazione
  if (ship.isRepairing) interruptRepair(ship);

  const sides = [-Math.PI / 2, Math.PI / 2];
  const spreadAngles = ship.shipClass === 'necromancer'
    ? [-0.22, -0.11, 0, 0.11, 0.22]
    : [-0.14, 0, 0.14];

  const bulletSpeed = ship.inventory.some(r => r.id === 'powder') ? 15.5 : 13.5;

  sides.forEach(sideOffset => {
    spreadAngles.forEach(spread => {
      const fireAngle = ship.angle + sideOffset + spread;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        homing: false,
        lifestealRatio: (ship.shipClass === 'necromancer' ? 0.45 : 0) + ship.lifestealBonus,
        x: ship.x + Math.cos(fireAngle) * 30,
        y: ship.y + Math.sin(fireAngle) * 30,
        vx: Math.cos(fireAngle) * bulletSpeed + Math.cos(ship.angle) * (ship.speed * 0.3),
        vy: Math.sin(fireAngle) * bulletSpeed + Math.sin(ship.angle) * (ship.speed * 0.3),
        damage: ship.damage,
        color: ship.shipClass === 'necromancer' ? '#c084fc' : '#99f6e4',
        life: 60
      });
    });
  });

  io.emit('cannonFired', { x: ship.x, y: ship.y, id: ship.id });
}

function activateAbility(ship) {
  if (!ship.shipClass) return;
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
    // REWORK NEGROMANTE: Campo Drenante (4.5s) + 6 Teschi Spettrali a Ricerca (Homing)!
    ship.activeBuffUntil = now + 4500;
    for (let i = 0; i < 6; i++) {
      const a = ship.angle + (Math.PI * 2 * i) / 6;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        homing: true, // Insegue automaticamente i bersagli!
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
  ship.repairUntil = now + 4000; // 4 secondi di riparazione canalizzata
  io.emit('dmgNum', { x: ship.x, y: ship.y - 30, text: '🛠️ Riparazione...', color: '#4ade80' });
}

function applyClassEvolution(p, chosenClass) {
  if (p.level < 4 || p.shipClass) return;
  if (!['juggernaut', 'phantom', 'necromancer'].includes(chosenClass)) return;

  p.shipClass = chosenClass;
  if (chosenClass === 'juggernaut') {
    p.maxHp += 90;
    p.hp += 90;
    p.armorBonus += 0.2;
    p.abilityCd = 8000;
  } else if (chosenClass === 'phantom') {
    p.maxSpeed += 1.25;
    p.turnSpeed += 0.01;
    p.abilityCd = 10500;
  } else if (chosenClass === 'necromancer') {
    p.maxHp += 45;
    p.hp += 45;
    p.damage += 5;
    p.abilityCd = 9500;
  }
}

io.on('connection', (socket) => {
  socket.on('joinGame', (playerName) => {
    const cleanName = (playerName || 'Capitano Senza Nome').trim().slice(0, 18);
    players[socket.id] = createShip(socket.id, cleanName, false);
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

  socket.on('startRepair', () => {
    if (players[socket.id]) startShipRepair(players[socket.id]);
  });

  socket.on('chooseClass', (chosenClass) => {
    if (players[socket.id]) applyClassEvolution(players[socket.id], chosenClass);
  });

  socket.on('upgradeStat', (stat) => {
    const p = players[socket.id];
    if (!p || p.skillPoints <= 0) return;

    p.skillPoints--;
    if (stat === 'hull') {
      p.maxHp += 30;
      p.hp = Math.min(p.maxHp, p.hp + 30);
    } else if (stat === 'cannons') {
      p.damage += 5;
    } else if (stat === 'sails') {
      p.maxSpeed += 0.6;
      p.turnSpeed += 0.004;
    } else if (stat === 'reload') {
      p.reloadTime = Math.max(400, p.reloadTime - 140);
    }
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
    if (st === 'hull') { bot.maxHp += 25; bot.hp += 25; }
    if (st === 'cannons') bot.damage += 4;
  }

  // I Bot usano la riparazione se sono sotto il 40% di vita
  if (bot.hp < bot.maxHp * 0.4) startShipRepair(bot);

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

  // 1. Nebbia Battle Royale
  if (storm.radius > storm.minRadius) {
    storm.radius -= storm.shrinkSpeed / TICK_RATE;
  } else {
    storm.radius = MAP_SIZE * 0.68;
  }

  // 2. Logica Boss Leviatano Potenziato (Fase 1 + Fase 2 Enrage + Warning)
  if (boss.alive) {
    boss.angle += boss.enraged ? 0.028 : 0.015;

    // Passaggio in Fase 2 (Enrage sotto il 50% HP)
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
        // Alterna Doppia Spirale e Onda d'Urto Mirata
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

  // 3. Aggiorna Navi
  for (let id in players) {
    const p = players[id];
    if (p.isBot) updateBotAI(p);

    const isBuffActive = now < p.activeBuffUntil;

    // Gestione Riparazione Attiva [R]
    if (p.isRepairing) {
      if (now >= p.repairUntil || p.hp >= p.maxHp) {
        p.isRepairing = false;
      } else {
        // Cura il 45% degli HP massimi nell'arco di 4 secondi
        const healPerTick = (p.maxHp * 0.45) / (4 * TICK_RATE);
        p.hp = Math.min(p.maxHp, p.hp + healPerTick);
      }
    }

    // Campo Rituale del Negromante: Drena vita e rallenta i nemici entro 260px
    if (p.shipClass === 'necromancer' && isBuffActive && now - p.lastNecroPulse > 550) {
      p.lastNecroPulse = now;
      for (let otherId in players) {
        if (otherId === id) continue;
        const enemy = players[otherId];
        if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < 260) {
          const drain = 12;
          enemy.hp -= drain;
          enemy.speed *= 0.65; // Rallenta il nemico
          p.hp = Math.min(p.maxHp, p.hp + drain);
          emitDamageNumber(enemy.x, enemy.y - 15, drain, '#e879f9', '-');
          emitDamageNumber(p.x, p.y - 25, drain, '#4ade80', '+');
        }
      }
    }

    let speedMult = 1.0;
    if (p.shipClass === 'phantom' && isBuffActive) speedMult = 1.45;
    if (p.shipClass === 'juggernaut' && isBuffActive) speedMult = 1.85;
    if (p.isRepairing) speedMult = 0.65; // Rallenta leggermente mentre ripara

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

    // Collisione con Scogli
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

    // Speronamento tra Navi
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

    // Nebbia Maledetta
    const distFromStormCenter = Math.hypot(p.x - storm.x, p.y - storm.y);
    if (distFromStormCenter > storm.radius) {
      p.hp -= 0.4;
    } else if (p.hp < p.maxHp) {
      const hasMythic = p.inventory.some(r => r.id === 'leviathan_heart');
      p.hp = Math.min(p.maxHp, p.hp + (hasMythic ? 0.14 : 0.05));
    }

    // Passiva Negromante: Magnetismo delle Anime (attira le anime nel raggio di 220px)
    if (p.shipClass === 'necromancer') {
      souls.forEach(s => {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < 220 && d > 10) {
          s.x += ((p.x - s.x) / d) * 5.2;
          s.y += ((p.y - s.y) / d) * 5.2;
        }
      });
    }

    // Raccolta Anime
    for (let i = souls.length - 1; i >= 0; i--) {
      const s = souls[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < 46) {
        p.xp += s.value;
        const healAmt = (s.isBossDrop ? 22 : 8) + (p.shipClass === 'necromancer' ? 5 : 0);
        p.hp = Math.min(p.maxHp, p.hp + healAmt);
        souls.splice(i, 1);
        if (souls.length < MAX_SOULS) spawnSoul();

        while (p.xp >= p.maxXp) {
          p.xp -= p.maxXp;
          p.level++;
          p.skillPoints++;
          p.maxXp = Math.floor(p.maxXp * 1.32);
          p.maxHp += 12;
          p.hp = p.maxHp;
        }
      }
    }

    // Raccolta Reliquie Maledette
    for (let i = relics.length - 1; i >= 0; i--) {
      const rel = relics[i];
      if (Math.hypot(p.x - rel.x, p.y - rel.y) < 48) {
        applyRelicToShip(p, rel);
        relics.splice(i, 1);
      }
    }

    // Morte Nave
    if (p.hp <= 0) {
      for (let k = 0; k < 6; k++) {
        spawnSoul(p.x + (Math.random() - 0.5) * 100, p.y + (Math.random() - 0.5) * 100, 40, true);
      }
      // 45% di probabilità di rilasciare una Reliquia Maledetta alla morte
      if (Math.random() < 0.45) {
        spawnRelicDrop(p.x, p.y, false);
      }

      if (p.isBot) {
        players[id] = createShip(id, p.name, true);
      } else {
        io.to(id).emit('died', { level: p.level, kills: p.kills });
        delete players[id];
      }
    }
  }

  // 4. Aggiorna Proiettili (Inclusi i Teschi Homing del Negromante)
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    // Se è un Teschio Spettrale Homing, curva verso il nemico più vicino (o il Boss)
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

    // Impatto Scogli
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
        boss.respawnTimer = now + 50000;
        const killerName = players[b.ownerId] ? players[b.ownerId].name : 'Un Pirata';
        io.emit('worldAnnouncement', {
          title: `👑 ${killerName.toUpperCase()} HA ABBATUTO IL LEVIATANO!`,
          subtitle: 'Reliquie Mitiche e Anime Antiche galleggiano al centro della mappa!',
          color: '#fbbf24'
        });

        if (players[b.ownerId]) {
          players[b.ownerId].xp += 260;
          players[b.ownerId].kills += 2;
        }
        // Rilascia 1 Reliquia Mitica + 2 Reliquie Rare + 18 Anime d'Oro
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
        const dmgReduction = Math.min(0.55, target.armorBonus);
        const finalDmg = b.damage * (1 - dmgReduction);
        target.hp -= finalDmg;

        // Subire un colpo di cannone interrompe la riparazione!
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
          players[b.ownerId].kills++;
          players[b.ownerId].xp += 80;
        }
        bullets.splice(i, 1);
        break;
      }
    }
  }

  io.emit('state', { players, bullets, souls, relics, storm, boss, serverTime: now });
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏴‍☠️ Abyssal Sails RPG v0.4 attivo su http://localhost:${PORT}`);
});