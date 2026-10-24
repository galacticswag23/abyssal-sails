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

let storm = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  radius: MAP_SIZE * 0.68,
  minRadius: 420,
  shrinkSpeed: 1.1
};

// Boss Mondiale PvE al centro della mappa
let boss = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  hp: 1500,
  maxHp: 1500,
  radius: 75,
  angle: 0,
  alive: true,
  respawnTimer: 0,
  lastAttack: 0
};

// Genera Scogli Maledetti (lontani dal centro del Boss)
for (let i = 0; i < ROCK_COUNT; i++) {
  let rx, ry, distCenter;
  do {
    rx = Math.random() * (MAP_SIZE - 500) + 250;
    ry = Math.random() * (MAP_SIZE - 500) + 250;
    distCenter = Math.hypot(rx - MAP_SIZE / 2, ry - MAP_SIZE / 2);
  } while (distCenter < 420);

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

for (let i = 0; i < MAX_SOULS; i++) spawnSoul();

function createShip(id, name, isBot = false) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 480 + Math.random() * (storm.radius * 0.55);
  return {
    id,
    name: name || 'Pirata Maledetto',
    isBot,
    shipClass: null, // 'juggernaut' | 'phantom' | 'necromancer'
    x: storm.x + Math.cos(angle) * dist,
    y: storm.y + Math.sin(angle) * dist,
    angle: Math.random() * Math.PI * 2,
    speed: 0,
    maxSpeed: 5.5,
    turnSpeed: 0.045,
    hp: 110,
    maxHp: 110,
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

function emitDamageNumber(x, y, amount, color = '#f87171') {
  io.emit('dmgNum', { x, y, amount: Math.round(amount), color });
}

function fireBroadsides(ship) {
  const now = Date.now();
  if (now - ship.lastShot < ship.reloadTime) return;
  ship.lastShot = now;

  // Il Galeone Negromante spara 5 colpi per lato invece di 3
  const sides = [-Math.PI / 2, Math.PI / 2];
  const spreadAngles = ship.shipClass === 'necromancer'
    ? [-0.24, -0.12, 0, 0.12, 0.24]
    : [-0.14, 0, 0.14];

  sides.forEach(sideOffset => {
    spreadAngles.forEach(spread => {
      const fireAngle = ship.angle + sideOffset + spread;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        lifesteal: ship.shipClass === 'necromancer',
        x: ship.x + Math.cos(fireAngle) * 30,
        y: ship.y + Math.sin(fireAngle) * 30,
        vx: Math.cos(fireAngle) * 13.5 + Math.cos(ship.angle) * (ship.speed * 0.3),
        vy: Math.sin(fireAngle) * 13.5 + Math.sin(ship.angle) * (ship.speed * 0.3),
        damage: ship.damage,
        color: ship.shipClass === 'necromancer' ? '#c084fc' : '#99f6e4',
        life: 58
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
    // Carica del Leviatano: Speronamento ad alta velocità per 1.6s
    ship.activeBuffUntil = now + 1600;
    ship.speed = ship.maxSpeed * 2.15;
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'juggernaut' });
  } else if (ship.shipClass === 'phantom') {
    // Velo Ombra: Intangibilità + Velocità per 3.5s
    ship.activeBuffUntil = now + 3500;
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'phantom' });
  } else if (ship.shipClass === 'necromancer') {
    // Maelstrom delle Anime: Nova circolare di 16 colpi vampirici
    ship.activeBuffUntil = now + 800;
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16;
      bullets.push({
        ownerId: ship.id,
        isBossBullet: false,
        lifesteal: true,
        x: ship.x + Math.cos(a) * 32,
        y: ship.y + Math.sin(a) * 32,
        vx: Math.cos(a) * 12,
        vy: Math.sin(a) * 12,
        damage: ship.damage * 0.9,
        color: '#e879f9',
        life: 50
      });
    }
    io.emit('abilityFx', { x: ship.x, y: ship.y, type: 'necromancer' });
  }
}

function applyClassEvolution(p, chosenClass) {
  if (p.level < 4 || p.shipClass) return;
  if (!['juggernaut', 'phantom', 'necromancer'].includes(chosenClass)) return;

  p.shipClass = chosenClass;
  if (chosenClass === 'juggernaut') {
    p.maxHp += 85;
    p.hp += 85;
    p.abilityCd = 8000;
  } else if (chosenClass === 'phantom') {
    p.maxSpeed += 1.2;
    p.turnSpeed += 0.01;
    p.abilityCd = 11000;
  } else if (chosenClass === 'necromancer') {
    p.damage += 4;
    p.abilityCd = 10000;
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
      p.reloadTime = Math.max(420, p.reloadTime - 140);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

function updateBotAI(bot) {
  bot.botTimer++;
  // Se il bot arriva al livello 4 sceglie una classe casuale
  if (bot.level >= 4 && !bot.shipClass) {
    const classes = ['juggernaut', 'phantom', 'necromancer'];
    applyClassEvolution(bot, classes[Math.floor(Math.random() * classes.length)]);
  }
  // Spende i punti abilità in automatico
  if (bot.skillPoints > 0) {
    const stats = ['hull', 'cannons', 'sails', 'reload'];
    const st = stats[Math.floor(Math.random() * stats.length)];
    bot.skillPoints--;
    if (st === 'hull') { bot.maxHp += 25; bot.hp += 25; }
    if (st === 'cannons') bot.damage += 4;
  }

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

  for (let id in players) {
    if (id === bot.id) continue;
    const target = players[id];
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    if (d < 420) {
      fireBroadsides(bot);
      if (bot.shipClass && Math.random() < 0.05) activateAbility(bot);
      break;
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

  // 2. Logica Boss Leviatano Abissale
  if (boss.alive) {
    boss.angle += 0.015;
    if (now - boss.lastAttack > 2600) {
      boss.lastAttack = now;
      // Spara 12 dardi abissali in cerchio se c'è qualcuno nel raggio di 750px
      const someoneClose = Object.values(players).some(p => Math.hypot(p.x - boss.x, p.y - boss.y) < 750);
      if (someoneClose) {
        for (let i = 0; i < 12; i++) {
          const a = boss.angle + (Math.PI * 2 * i) / 12;
          bullets.push({
            ownerId: 'boss',
            isBossBullet: true,
            x: boss.x + Math.cos(a) * 65,
            y: boss.y + Math.sin(a) * 65,
            vx: Math.cos(a) * 8.5,
            vy: Math.sin(a) * 8.5,
            damage: 24,
            color: '#a855f7',
            life: 85
          });
        }
      }
    }
  } else if (now > boss.respawnTimer) {
    boss.alive = true;
    boss.hp = boss.maxHp;
  }

  // 3. Aggiorna Navi
  for (let id in players) {
    const p = players[id];
    if (p.isBot) updateBotAI(p);

    const isBuffActive = now < p.activeBuffUntil;
    const effectiveMaxSpeed = (p.shipClass === 'phantom' && isBuffActive)
      ? p.maxSpeed * 1.45
      : (p.shipClass === 'juggernaut' && isBuffActive ? p.maxSpeed * 1.85 : p.maxSpeed);

    if (p.inputs.up) p.speed = Math.min(effectiveMaxSpeed, p.speed + 0.2);
    else if (p.inputs.down) p.speed = Math.max(-effectiveMaxSpeed * 0.35, p.speed - 0.12);
    else p.speed *= 0.96;

    if (p.inputs.left) p.angle -= p.turnSpeed;
    if (p.inputs.right) p.angle += p.turnSpeed;

    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;

    p.x = Math.max(80, Math.min(MAP_SIZE - 80, p.x));
    p.y = Math.max(80, Math.min(MAP_SIZE - 80, p.y));

    // Collisione con Scogli Maledetti
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

    // Collisione / Speronamento tra Navi (Juggernaut fa danni enormi)
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
          const ramDmg = (p.shipClass === 'juggernaut' && isBuffActive) ? 55 : (p.shipClass === 'juggernaut' ? 28 : 10);
          other.hp -= ramDmg;
          p.ramCooldownUntil = now + 700;
          emitDamageNumber(other.x, other.y, ramDmg, '#fb923c');
          io.emit('hitEffect', { x: other.x, y: other.y });
        }
      }
    }

    // Danno Nebbia Battle Royale
    const distFromStormCenter = Math.hypot(p.x - storm.x, p.y - storm.y);
    if (distFromStormCenter > storm.radius) {
      p.hp -= 0.38;
    } else if (p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + 0.05);
    }

    // Raccolta Anime
    for (let i = souls.length - 1; i >= 0; i--) {
      const s = souls[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < 44) {
        p.xp += s.value;
        const healAmt = s.isBossDrop ? 20 : 7;
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

    // Morte Nave
    if (p.hp <= 0) {
      for (let k = 0; k < 6; k++) {
        spawnSoul(p.x + (Math.random() - 0.5) * 100, p.y + (Math.random() - 0.5) * 100, 40, true);
      }
      if (p.isBot) {
        players[id] = createShip(id, p.name, true);
      } else {
        io.to(id).emit('died', { level: p.level, kills: p.kills });
        delete players[id];
      }
    }
  }

  // 4. Aggiorna Proiettili
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    if (b.life <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    // Impatto contro Scogli
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

    // Impatto contro il Boss Leviatano
    if (!b.isBossBullet && boss.alive && Math.hypot(b.x - boss.x, b.y - boss.y) < boss.radius) {
      boss.hp -= b.damage;
      emitDamageNumber(b.x, b.y, b.damage, '#fbbf24');
      io.emit('hitEffect', { x: b.x, y: b.y });

      if (boss.hp <= 0) {
        boss.alive = false;
        boss.respawnTimer = now + 45000; // Rinasce dopo 45s
        if (players[b.ownerId]) {
          players[b.ownerId].xp += 220;
          players[b.ownerId].kills += 2;
        }
        // Esplosione di Reliquie Dorate
        for (let k = 0; k < 18; k++) {
          const ang = (Math.PI * 2 * k) / 18;
          const dist = 40 + Math.random() * 90;
          spawnSoul(boss.x + Math.cos(ang) * dist, boss.y + Math.sin(ang) * dist, 55, true);
        }
      }
      bullets.splice(i, 1);
      continue;
    }

    // Impatto contro Navi
    for (let id in players) {
      if (id === b.ownerId) continue;
      const target = players[id];

      // Se la Fregata Spettrale ha Velo Ombra attivo, i colpi le passano attraverso!
      if (target.shipClass === 'phantom' && now < target.activeBuffUntil) continue;

      if (Math.hypot(target.x - b.x, target.y - b.y) < 35) {
        // La Corazzata Juggernaut riduce i danni subiti del 20%
        const finalDmg = target.shipClass === 'juggernaut' ? b.damage * 0.8 : b.damage;
        target.hp -= finalDmg;
        emitDamageNumber(target.x, target.y - 15, finalDmg, '#f87171');
        io.emit('hitEffect', { x: b.x, y: b.y });

        // Lifesteal per il Galeone Negromante
        if (b.lifesteal && players[b.ownerId]) {
          const healer = players[b.ownerId];
          const heal = Math.round(finalDmg * 0.35);
          healer.hp = Math.min(healer.maxHp, healer.hp + heal);
          emitDamageNumber(healer.x, healer.y - 20, heal, '#4ade80');
        }

        if (target.hp <= 0 && players[b.ownerId]) {
          players[b.ownerId].kills++;
          players[b.ownerId].xp += 75;
        }
        bullets.splice(i, 1);
        break;
      }
    }
  }

  io.emit('state', { players, bullets, souls, storm, boss, serverTime: now });
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏴‍☠️ Abyssal Sails RPG v0.3 attivo su http://localhost:${PORT}`);
});