const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Configurazione Mondo di Gioco
const MAP_SIZE = 4000;
const TICK_RATE = 30;
const MAX_SOULS = 120;
const BOT_COUNT = 5;

let players = {};
let bullets = [];
let souls = []; // Globuli di XP / Bottino
let storm = {
  x: MAP_SIZE / 2,
  y: MAP_SIZE / 2,
  radius: MAP_SIZE * 0.65,
  minRadius: 350,
  shrinkSpeed: 1.2
};

// Genera Anime Abissali (XP)
function spawnSoul(x = null, y = null, value = 15, isBossDrop = false) {
  souls.push({
    id: Math.random().toString(36).substr(2, 9),
    x: x !== null ? x : Math.random() * (MAP_SIZE - 400) + 200,
    y: y !== null ? y : Math.random() * (MAP_SIZE - 400) + 200,
    value,
    isBossDrop
  });
}

for (let i = 0; i < MAX_SOULS; i++) spawnSoul();

// Crea struttura nave (Giocatore o Bot)
function createShip(id, name, isBot = false) {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * (storm.radius * 0.6);
  return {
    id,
    name: name || 'Pirata Maledetto',
    isBot,
    x: storm.x + Math.cos(angle) * dist,
    y: storm.y + Math.sin(angle) * dist,
    angle: Math.random() * Math.PI * 2,
    speed: 0,
    maxSpeed: 5.5,
    turnSpeed: 0.045,
    hp: 100,
    maxHp: 100,
    damage: 18,
    reloadTime: 1400,
    lastShot: 0,
    level: 1,
    xp: 0,
    maxXp: 50,
    skillPoints: 0,
    kills: 0,
    inputs: { up: false, down: false, left: false, right: false },
    botTimer: 0
  };
}

// Inizializza Vascelli Fantasma (Bot per testare subito)
const botNames = ['Vascello di Caronte', 'Olandese Nero', 'Spina Abissale', 'Mietitore Salmastro', 'Regina delle Ossa'];
for (let i = 0; i < BOT_COUNT; i++) {
  const botId = `bot_${i}`;
  players[botId] = createShip(botId, botNames[i], true);
}

// Sparo Bordate (Sinistra + Destra)
function fireBroadsides(ship) {
  const now = Date.now();
  if (now - ship.lastShot < ship.reloadTime) return;
  ship.lastShot = now;

  // Sparo sia a Babordo (-90°) che a Tribordo (+90°) con 3 cannoni per lato
  const sides = [-Math.PI / 2, Math.PI / 2];
  const spreadAngles = [-0.14, 0, 0.14];

  sides.forEach(sideOffset => {
    spreadAngles.forEach(spread => {
      const fireAngle = ship.angle + sideOffset + spread;
      bullets.push({
        ownerId: ship.id,
        x: ship.x + Math.cos(fireAngle) * 28,
        y: ship.y + Math.sin(fireAngle) * 28,
        vx: Math.cos(fireAngle) * 13 + Math.cos(ship.angle) * (ship.speed * 0.3),
        vy: Math.sin(fireAngle) * 13 + Math.sin(ship.angle) * (ship.speed * 0.3),
        damage: ship.damage,
        life: 55
      });
    });
  });

  io.emit('cannonFired', { x: ship.x, y: ship.y, id: ship.id });
}

// Connessioni Socket.IO
io.on('connection', (socket) => {
  console.log(`Nuovo vascello in mare: ${socket.id}`);

  socket.on('joinGame', (playerName) => {
    const cleanName = (playerName || 'Capitano Senza Nome').trim().slice(0, 18);
    players[socket.id] = createShip(socket.id, cleanName, false);
    socket.emit('init', { id: socket.id, mapSize: MAP_SIZE });
  });

  socket.on('inputs', (inputs) => {
    if (players[socket.id]) {
      players[socket.id].inputs = inputs;
    }
  });

  socket.on('shoot', () => {
    if (players[socket.id]) {
      fireBroadsides(players[socket.id]);
    }
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
      p.maxSpeed += 0.65;
      p.turnSpeed += 0.004;
    } else if (stat === 'reload') {
      p.reloadTime = Math.max(450, p.reloadTime - 150);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

// Logica AI per i Vascelli Fantasma
function updateBotAI(bot) {
  bot.botTimer++;
  const distToCenter = Math.hypot(bot.x - storm.x, bot.y - storm.y);

  // Se è vicino alla tempesta, torna verso il centro
  if (distToCenter > storm.radius * 0.75) {
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

  // Spara se un bersaglio è a portata di tiro
  for (let id in players) {
    if (id === bot.id) continue;
    const target = players[id];
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    if (d < 420) {
      fireBroadsides(bot);
      break;
    }
  }
}

// Game Loop Autoritativo
setInterval(() => {
  // 1. Restringi la Nebbia Maledetta (Battle Royale)
  if (storm.radius > storm.minRadius) {
    storm.radius -= storm.shrinkSpeed / TICK_RATE;
  } else {
    // Quando il cerchio arriva al minimo, dopo un po' si rigenera per ciclo continuo .io
    storm.radius = MAP_SIZE * 0.65;
  }

  // 2. Aggiorna Navi
  for (let id in players) {
    const p = players[id];
    if (p.isBot) updateBotAI(p);

    // Accelerazione e Attrito dell'acqua
    if (p.inputs.up) p.speed = Math.min(p.maxSpeed, p.speed + 0.18);
    else if (p.inputs.down) p.speed = Math.max(-p.maxSpeed * 0.35, p.speed - 0.12);
    else p.speed *= 0.96;

    // Rotazione del timone
    if (p.inputs.left) p.angle -= p.turnSpeed;
    if (p.inputs.right) p.angle += p.turnSpeed;

    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;

    // Limiti mappa
    p.x = Math.max(80, Math.min(MAP_SIZE - 80, p.x));
    p.y = Math.max(80, Math.min(MAP_SIZE - 80, p.y));

    // Danno da Nebbia Abissale fuori dal cerchio
    const distFromStormCenter = Math.hypot(p.x - storm.x, p.y - storm.y);
    if (distFromStormCenter > storm.radius) {
      p.hp -= 0.35;
    }

    // Rigenerazione lenta fuori dal combattimento
    if (p.hp < p.maxHp && distFromStormCenter <= storm.radius) {
      p.hp = Math.min(p.maxHp, p.hp + 0.04);
    }

    // Raccolta Anime (XP + Lieve Cura)
    for (let i = souls.length - 1; i >= 0; i--) {
      const s = souls[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < 42) {
        p.xp += s.value;
        p.hp = Math.min(p.maxHp, p.hp + 6);
        souls.splice(i, 1);
        if (souls.length < MAX_SOULS) spawnSoul();

        // Level Up RPG
        while (p.xp >= p.maxXp) {
          p.xp -= p.maxXp;
          p.level++;
          p.skillPoints++;
          p.maxXp = Math.floor(p.maxXp * 1.35);
          p.maxHp += 10;
          p.hp = p.maxHp;
        }
      }
    }

    // Controllo Morte
    if (p.hp <= 0) {
      // Rilascia il bottino di anime in mare
      for (let k = 0; k < 5; k++) {
        spawnSoul(
          p.x + (Math.random() - 0.5) * 90,
          p.y + (Math.random() - 0.5) * 90,
          35,
          true
        );
      }

      if (p.isBot) {
        players[id] = createShip(id, p.name, true);
      } else {
        io.to(id).emit('died', { level: p.level, kills: p.kills });
        delete players[id];
      }
    }
  }

  // 3. Aggiorna Palle di Cannone e Collisioni
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    if (b.life <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    for (let id in players) {
      if (id === b.ownerId) continue;
      const target = players[id];
      if (Math.hypot(target.x - b.x, target.y - b.y) < 34) {
        target.hp -= b.damage;
        io.emit('hitEffect', { x: b.x, y: b.y });

        if (target.hp <= 0 && players[b.ownerId]) {
          players[b.ownerId].kills++;
          players[b.ownerId].xp += 60;
        }
        bullets.splice(i, 1);
        break;
      }
    }
  }

  // 4. Invia stato ai client
  io.emit('state', { players, bullets, souls, storm });
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏴‍☠️ Server Abyssal Sails attivo su http://localhost:${PORT}`);
});