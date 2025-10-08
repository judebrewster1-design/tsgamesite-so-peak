const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = 30900;
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;
const MAX_BOTS = 20;
const BALL_COUNT = 60;
const MAX_BALL_COUNT = 150;
const BOT_SIZE_LIMIT = 90;
const TICK_RATE = 30;
const SAVE_INTERVAL = 30000;
const SPRINT_BALL_COST = 1;
const SPRINT_INTERVAL = 1500;
const STATE_COMPRESSION_THRESHOLD = 50;

// Happy Hour System - 6 PM to 7 PM daily
const HAPPY_HOUR_START = 18; // 6 PM
const HAPPY_HOUR_END = 19; // 7 PM
const HAPPY_HOUR_MULTIPLIER = 3;
let happyHourActive = false;
let happyHourEndTime = null;
let happyHourNextStart = null;

const TELEGRAM_BOT_TOKEN = '8292490263:AAEYk-3nwnFeyxgza6HXSi1DGNlormA3_qQ';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_PASSWORD = 'breakingbad1';

let snakes = {};
let balls = [];
let accounts = {};
let bannedIPs = {};
let chatBannedIPs = {};
let bannedUsernames = new Set();
let telegramChatId = null;
let telegramAuthenticated = false;
let nextBotId = 1;
let frameCount = 0;

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'saves.json');
const BANNED_USERNAMES_FILE = path.join(DATA_DIR, 'banned_usernames.json');

const SKINS = [
  { id: 'chase', name: 'Chase', cost: 1500, img: 'chase.png' },
  { id: 'caleb', name: 'Caleb', cost: 1200, img: 'caleb.png' },
  { id: 'brody', name: 'Brody', cost: 1000, img: 'brody.png' },
  { id: 'connorV', name: 'Connor', cost: 900, img: 'sixseven.png' },
  { id: 'jaxon', name: 'Jaxon', cost: 800, img: 'jaxon.png' },
  { id: 'luca', name: 'Luca', cost: 400, img: 'luca.png' },
  { id: 'charlie', name: 'Charlie', cost: 300, img: 'charlie.png' },
  { id: 'harly', name: 'Harly', cost: 250, img: 'harly.png' },
  { id: 'ollie', name: 'Ollie', cost: 200, img: 'ollie.png' },
  { id: 'connorD', name: 'connor', cost: 175, img: 'connord.png' },
  { id: 'jackn', name: 'Jackn', cost: 150, img: 'jackn.png' },
  { id: 'liam', name: 'Liam', cost: 125, img: 'liam.png' },
  { id: 'jet', name: 'Jet', cost: 100, img: 'jet.png' },
  { id: 'gavin', name: 'Gavin', cost: 75, img: 'gavin.png' },
  { id: 'ginger', name: 'Ginger', cost: 50, img: 'ginger.png' },
  { id: 'chay', name: 'Chay', cost: 25, img: 'chay.png' },
  { id: 'jude', name: 'Jude', cost: 0, img: 'jude.png' }
];

let BANNED_WORDS = [];
try {
  BANNED_WORDS = require('./banned-words.js');
} catch (e) {
  BANNED_WORDS = [];
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Happy Hour Functions
function getHappyHourStatus() {
  return {
    active: happyHourActive,
    endsAt: happyHourEndTime,
    nextStart: happyHourNextStart
  };
}

function broadcastHappyHourUpdate() {
  const msg = JSON.stringify({
    type: 'happyHourUpdate',
    happyHour: getHappyHourStatus()
  });
  
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(msg);
    }
  });
}

function startHappyHour() {
  happyHourActive = true;
  const now = new Date();
  const endTime = new Date(now);
  endTime.setHours(HAPPY_HOUR_END, 0, 0, 0);
  happyHourEndTime = endTime.getTime();
  happyHourNextStart = null;
  
  console.log('🎉 HAPPY HOUR STARTED! 3X POINTS UNTIL 7 PM');
  queueTelegramMessage('🎉 <b>HAPPY HOUR STARTED!</b>\n3X Points until 7 PM!');
  
  broadcastHappyHourUpdate();
  
  // Schedule end at 7 PM
  const timeUntilEnd = happyHourEndTime - Date.now();
  setTimeout(endHappyHour, timeUntilEnd);
}

function endHappyHour() {
  happyHourActive = false;
  happyHourEndTime = null;
  
  // Calculate next 6 PM
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(HAPPY_HOUR_START, 0, 0, 0);
  happyHourNextStart = tomorrow.getTime();
  
  console.log('Happy Hour ended. Next one tomorrow at 6 PM.');
  queueTelegramMessage('⏰ Happy Hour ended. Next one tomorrow at 6 PM.');
  
  broadcastHappyHourUpdate();
  
  // Schedule next Happy Hour at 6 PM tomorrow
  const timeUntilNext = happyHourNextStart - Date.now();
  setTimeout(startHappyHour, timeUntilNext);
}

// Initialize Happy Hour schedule
function initHappyHour() {
  const now = new Date();
  const currentHour = now.getHours();
  
  if (currentHour >= HAPPY_HOUR_START && currentHour < HAPPY_HOUR_END) {
    // We're currently in Happy Hour - start it
    startHappyHour();
  } else if (currentHour < HAPPY_HOUR_START) {
    // Happy Hour is later today
    const today = new Date(now);
    today.setHours(HAPPY_HOUR_START, 0, 0, 0);
    happyHourNextStart = today.getTime();
    const timeUntilNext = happyHourNextStart - Date.now();
    console.log(`Happy Hour starts today at 6 PM (in ${Math.round(timeUntilNext / 60000)} minutes)`);
    setTimeout(startHappyHour, timeUntilNext);
  } else {
    // Happy Hour is tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(HAPPY_HOUR_START, 0, 0, 0);
    happyHourNextStart = tomorrow.getTime();
    const timeUntilNext = happyHourNextStart - Date.now();
    console.log(`Happy Hour starts tomorrow at 6 PM (in ${Math.round(timeUntilNext / 60000)} minutes)`);
    setTimeout(startHappyHour, timeUntilNext);
  }
}

let telegramQueue = [];
let telegramSending = false;

function queueTelegramMessage(text) {
  if (!telegramChatId || !telegramAuthenticated) return;
  telegramQueue.push(text);
  processTelegramQueue();
}

function processTelegramQueue() {
  if (telegramSending || telegramQueue.length === 0) return;
  telegramSending = true;
  
  const text = telegramQueue.shift();
  const data = JSON.stringify({
    chat_id: telegramChatId,
    text: text,
    parse_mode: 'HTML'
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(`${TELEGRAM_API}/sendMessage`, options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      telegramSending = false;
      setTimeout(processTelegramQueue, 100);
    });
  });

  req.on('error', (e) => {
    console.error('Telegram request error:', e);
    telegramSending = false;
  });
  
  req.write(data);
  req.end();
}

function setupTelegramBot() {
  function pollUpdates(offset = 0) {
    https.get(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const updates = JSON.parse(data);
          if (updates.ok && updates.result.length > 0) {
            updates.result.forEach(update => {
              if (update.message && update.message.text) {
                handleTelegramCommand(update.message);
              }
              offset = Math.max(offset, update.update_id + 1);
            });
          }
          setTimeout(() => pollUpdates(offset), 100);
        } catch (e) {
          console.error('Error parsing Telegram updates:', e);
          setTimeout(() => pollUpdates(offset), 1000);
        }
      });
    }).on('error', (e) => {
      console.error('Telegram polling error:', e);
      setTimeout(() => pollUpdates(offset), 5000);
    });
  }

  pollUpdates();
  console.log('Telegram bot polling started. Waiting for authentication...');
}

function handleTelegramCommand(message) {
  const chatId = message.chat.id;
  telegramChatId = chatId;
  
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  if (!telegramAuthenticated) {
    if (text === TELEGRAM_PASSWORD) {
      telegramAuthenticated = true;
      queueTelegramMessage('✅ <b>Authentication successful!</b>\n\nType /help to see available commands.');
      return;
    } else {
      const authMsg = JSON.stringify({
        chat_id: chatId,
        text: '🔒 <b>Authentication Required</b>\n\nPlease send the password to use this bot.',
        parse_mode: 'HTML'
      });
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': authMsg.length
        }
      };

      const req = https.request(`${TELEGRAM_API}/sendMessage`, options);
      req.write(authMsg);
      req.end();
      return;
    }
  }

  switch (command) {
    case '/help':
      queueTelegramMessage('📋 <b>Bot Commands:</b>\n\n' +
        '/ban [username] - Temp ban for 5 min\n' +
        '/hardban [username] - Delete account permanently\n' +
        '/give [username] [amount] - Give points\n' +
        '/banusername [username] - Block username\n' +
        '/unbanusername [username] - Unblock username\n' +
        '/stats - Server statistics\n' +
        '/accounts - List all accounts\n' +
        '/happyhour - Check Happy Hour status');
      break;

    case '/ban':
      if (parts.length < 2) {
        queueTelegramMessage('❌ Usage: /ban username');
        return;
      }
      const banUser = parts[1].toLowerCase();
      const account = accounts[banUser];
      if (!account) {
        queueTelegramMessage(`❌ Account "${parts[1]}" not found`);
        return;
      }
      account.tempBanned = Date.now() + 300000;
      saveAccountsAsync();
      queueTelegramMessage(`⛔ Banned "${parts[1]}" for 5 minutes`);
      break;

    case '/hardban':
      if (parts.length < 2) {
        queueTelegramMessage('❌ Usage: /hardban username');
        return;
      }
      const hardbanUser = parts[1].toLowerCase();
      if (!accounts[hardbanUser]) {
        queueTelegramMessage(`❌ Account "${parts[1]}" not found`);
        return;
      }
      delete accounts[hardbanUser];
      saveAccountsAsync();
      queueTelegramMessage(`💀 Hard banned and deleted account "${parts[1]}"`);
      break;

    case '/give':
      if (parts.length < 3) {
        queueTelegramMessage('❌ Usage: /give username amount');
        return;
      }
      const giveUser = parts[1].toLowerCase();
      const amount = parseInt(parts[2]);
      if (isNaN(amount)) {
        queueTelegramMessage('❌ Invalid amount');
        return;
      }
      const giveAccount = accounts[giveUser];
      if (!giveAccount) {
        queueTelegramMessage(`❌ Account "${parts[1]}" not found`);
        return;
      }
      giveAccount.points += amount;
      saveAccountsAsync();
      queueTelegramMessage(`💰 Gave ${amount} points to "${parts[1]}"\nNew balance: ${giveAccount.points}`);
      break;

    case '/banusername':
      if (parts.length < 2) {
        queueTelegramMessage('❌ Usage: /banusername username');
        return;
      }
      bannedUsernames.add(parts[1].toLowerCase());
      saveBannedUsernamesAsync();
      queueTelegramMessage(`🚫 Username "${parts[1]}" is now blocked`);
      break;

    case '/unbanusername':
      if (parts.length < 2) {
        queueTelegramMessage('❌ Usage: /unbanusername username');
        return;
      }
      bannedUsernames.delete(parts[1].toLowerCase());
      saveBannedUsernamesAsync();
      queueTelegramMessage(`✅ Username "${parts[1]}" is now unblocked`);
      break;

    case '/stats':
      const playerCount = Object.keys(snakes).filter(id => !snakes[id].isBot).length;
      const totalAccounts = Object.keys(accounts).length;
      const hhStatus = happyHourActive ? ' 🎉 HAPPY HOUR ACTIVE (3X POINTS)' : '';
      let hhNext = '';
      if (happyHourNextStart) {
        const hoursUntil = Math.floor((happyHourNextStart - Date.now()) / 3600000);
        const minsUntil = Math.round(((happyHourNextStart - Date.now()) % 3600000) / 60000);
        hhNext = `\n⏰ Next HH: ${hoursUntil}h ${minsUntil}m (6 PM)`;
      }
      queueTelegramMessage(`📊 <b>Server Stats</b>${hhStatus}\n\n` +
        `👥 Active Players: ${playerCount}\n` +
        `🤖 Bots: ${Object.keys(snakes).filter(id => snakes[id].isBot).length}\n` +
        `📝 Total Accounts: ${totalAccounts}\n` +
        `⚽ Balls: ${balls.length}${hhNext}`);
      break;

    case '/accounts':
      const accountList = Object.values(accounts)
        .sort((a, b) => b.points - a.points)
        .slice(0, 10)
        .map((a, i) => `${i + 1}. ${a.username} - ${a.points} pts`)
        .join('\n');
      queueTelegramMessage(`👥 <b>Top Accounts:</b>\n\n${accountList}`);
      break;

    case '/happyhour':
      if (happyHourActive) {
        const now = new Date();
        const endTime = new Date(happyHourEndTime);
        const minsLeft = Math.round((happyHourEndTime - Date.now()) / 60000);
        queueTelegramMessage(`🎉 <b>HAPPY HOUR ACTIVE!</b>\n\n3X Points\nEnds at: 7:00 PM\nTime left: ${minsLeft} minutes`);
      } else {
        const nextTime = new Date(happyHourNextStart);
        const hoursUntil = Math.floor((happyHourNextStart - Date.now()) / 3600000);
        const minsUntil = Math.round(((happyHourNextStart - Date.now()) % 3600000) / 60000);
        queueTelegramMessage(`⏰ Happy Hour inactive\n\nNext Happy Hour: 6:00 PM\nStarts in: ${hoursUntil}h ${minsUntil}m`);
      }
      break;

    default:
      queueTelegramMessage('❓ Unknown command. Type /help for commands.');
  }
}

function loadAccounts() {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(accounts).length} accounts`);
    } catch (e) {
      console.error('Error loading accounts:', e);
      accounts = {};
    }
  }
}

let saveTimeout = null;
function saveAccountsAsync() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    } catch (e) {
      console.error('Error saving accounts:', e);
    }
  }, 1000);
}

function loadBannedUsernames() {
  if (fs.existsSync(BANNED_USERNAMES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(BANNED_USERNAMES_FILE, 'utf8'));
      bannedUsernames = new Set(data);
    } catch (e) {
      console.error('Error loading banned usernames:', e);
      bannedUsernames = new Set();
    }
  }
}

function saveBannedUsernamesAsync() {
  setTimeout(() => {
    try {
      fs.writeFileSync(BANNED_USERNAMES_FILE, JSON.stringify([...bannedUsernames], null, 2));
    } catch (e) {
      console.error('Error saving banned usernames:', e);
    }
  }, 1000);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createAccount(username, password) {
  const hash = hashPassword(password);
  accounts[username.toLowerCase()] = {
    username: username,
    passwordHash: hash,
    points: 0,
    highScore: 0,
    ownedSkins: ['jude'],
    currentSkin: 'jude',
    createdAt: Date.now()
  };
  saveAccountsAsync();
  return accounts[username.toLowerCase()];
}

function verifyAccount(username, password) {
  const account = accounts[username.toLowerCase()];
  if (!account) return null;
  
  if (account.tempBanned && Date.now() < account.tempBanned) {
    return { error: 'Account temporarily banned' };
  }
  
  const hash = hashPassword(password);
  if (account.passwordHash === hash) {
    return account;
  }
  return null;
}

function getLeaderboard() {
  return Object.values(accounts)
    .filter(a => a.highScore > 0)
    .sort((a, b) => b.highScore - a.highScore)
    .slice(0, 10)
    .map(a => ({ username: a.username, highScore: a.highScore }));
}

function containsBannedWord(text) {
  if (!BANNED_WORDS || BANNED_WORDS.length === 0) return false;
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return BANNED_WORDS.some(w => clean.includes(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
}

function isPlayerBanned(ip) {
  if (bannedIPs[ip] && Date.now() < bannedIPs[ip]) return true;
  delete bannedIPs[ip];
  return false;
}

function isChatBanned(ip) {
  if (chatBannedIPs[ip] && Date.now() < chatBannedIPs[ip]) return true;
  delete chatBannedIPs[ip];
  return false;
}

const randomPos = () => ({
  x: Math.random() * (WORLD_WIDTH - 200) + 100,
  y: Math.random() * (WORLD_HEIGHT - 200) + 100
});

function createSnake(id, isBot = false, username = null, skinId = 'jude') {
  const pos = randomPos();
  return {
    id,
    body: [pos, { x: pos.x - 10, y: pos.y }, { x: pos.x - 20, y: pos.y }],
    direction: { x: 1, y: 0 },
    score: 0,
    points: 0,
    isBot,
    speed: 4,
    targetBall: null,
    username: username || (isBot ? `Bot${id.substring(3)}` : `Player`),
    skinId: skinId,
    lastUpdate: Date.now(),
    accountUsername: username,
    isSprinting: false,
    lastSprintDrop: 0
  };
}

const spawnBall = () => ({
  x: Math.random() * WORLD_WIDTH,
  y: Math.random() * WORLD_HEIGHT,
  radius: 6
});

function initBalls() {
  balls = Array.from({ length: BALL_COUNT }, spawnBall);
}

function maintainBallCount() {
  if (balls.length > MAX_BALL_COUNT) balls.length = MAX_BALL_COUNT;
  while (balls.length < BALL_COUNT) balls.push(spawnBall());
}

function initBots() {
  for (let i = 0; i < MAX_BOTS; i++) {
    const botId = `bot${nextBotId++}`;
    snakes[botId] = createSnake(botId, true);
  }
}

const distanceSq = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

function updateBot(bot) {
  if (bot.score >= BOT_SIZE_LIMIT) {
    Object.assign(bot, createSnake(bot.id, true));
    return;
  }

  if (Math.random() < 0.015) {
    const angle = Math.random() * Math.PI * 2;
    bot.direction = { x: Math.cos(angle), y: Math.sin(angle) };
    bot.targetBall = null;
  }

  if (!bot.targetBall || Math.random() < 0.03) {
    const head = bot.body[0];
    let nearest = null;
    let minDistSq = 160000;
    
    for (const ball of balls) {
      const distSq = distanceSq(head, ball);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = ball;
      }
    }
    
    if (nearest) {
      bot.targetBall = nearest;
      const dx = nearest.x - head.x;
      const dy = nearest.y - head.y;
      const dist = Math.sqrt(minDistSq);
      bot.direction = { x: dx / dist, y: dy / dist };
    }
  }

  moveSnake(bot);
}

function moveSnake(snake) {
  if (!snake?.body?.length) return;
  
  const head = snake.body[0];
  const speedMultiplier = snake.isSprinting ? 1.5 : 1;
  const newHead = {
    x: Math.max(10, Math.min(WORLD_WIDTH - 10, head.x + snake.direction.x * snake.speed * speedMultiplier)),
    y: Math.max(10, Math.min(WORLD_HEIGHT - 10, head.y + snake.direction.y * snake.speed * speedMultiplier))
  };

  snake.body.unshift(newHead);
  snake.body.pop();

  for (let i = balls.length - 1; i >= 0; i--) {
    if (distanceSq(newHead, balls[i]) < 225) {
      const multiplier = happyHourActive ? HAPPY_HOUR_MULTIPLIER : 1;
      const scoreGain = 1 * multiplier;
      snake.score += scoreGain;
      snake.points += scoreGain;
      snake.body.push({ ...snake.body[snake.body.length - 1] });
      balls[i] = spawnBall();
      break;
    }
  }
  
  snake.lastUpdate = Date.now();
}

function checkCollisions() {
  const ids = Object.keys(snakes);
  const dead = [];

  for (let i = 0; i < ids.length; i++) {
    const snake = snakes[ids[i]];
    if (!snake?.body?.length) continue;

    const head = snake.body[0];
    let isDead = false;

    for (let j = 0; j < ids.length && !isDead; j++) {
      if (i === j) continue;
      const other = snakes[ids[j]];
      if (!other?.body) continue;

      for (const part of other.body) {
        if (distanceSq(head, part) < 100) {
          dead.push(ids[i]);
          isDead = true;
          break;
        }
      }
    }
  }

  dead.forEach(id => {
    const snake = snakes[id];
    if (!snake) return;

    const ballsToSpawn = Math.min(Math.floor(snake.score / 2), 30);
    for (let i = 0; i < ballsToSpawn && balls.length < MAX_BALL_COUNT; i++) {
      const seg = snake.body[Math.floor(i * snake.body.length / ballsToSpawn) % snake.body.length];
      balls.push({
        x: seg.x + (Math.random() - 0.5) * 50,
        y: seg.y + (Math.random() - 0.5) * 50,
        radius: 6
      });
    }

    if (snake.accountUsername && accounts[snake.accountUsername.toLowerCase()]) {
      const account = accounts[snake.accountUsername.toLowerCase()];
      account.points += snake.points;
      
      if (snake.score > account.highScore) {
        account.highScore = snake.score;
        const hhLabel = happyHourActive ? ' 🎉 (HAPPY HOUR)' : '';
        queueTelegramMessage(`🏆 <b>NEW HIGH SCORE!</b>\n${snake.username}: ${snake.score}${hhLabel}`);
      }
      
      saveAccountsAsync();
      const hhLabel = happyHourActive ? ' 🎉' : '';
      queueTelegramMessage(`💀 ${snake.username} died${hhLabel} | Score: ${snake.score} | Total: ${account.points}`);
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.playerId === id) {
          client.send(JSON.stringify({
            type: 'death',
            score: snake.score,
            points: snake.points,
            highScore: account.highScore,
            totalPoints: account.points
          }));
        }
      });
      
      broadcastLeaderboard();
    }

    delete snakes[id];
    
    if (snake.isBot) {
      snakes[id] = createSnake(id, true);
    }
  });
}

function broadcastLeaderboard() {
  const leaderboard = getLeaderboard();
  const msg = JSON.stringify({
    type: 'leaderboardUpdate',
    leaderboard: leaderboard
  });
  
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(msg);
    }
  });
}

function gameLoop() {
  frameCount++;

  const now = Date.now();
  for (const id in snakes) {
    const snake = snakes[id];
    if (!snake) continue;
    
    if (snake.isSprinting && snake.score > 0 && now - snake.lastSprintDrop >= SPRINT_INTERVAL) {
      snake.score--;
      if (snake.body.length > 3) {
        const tail = snake.body.pop();
        if (balls.length < MAX_BALL_COUNT) {
          balls.push({
            x: tail.x + (Math.random() - 0.5) * 20,
            y: tail.y + (Math.random() - 0.5) * 20,
            radius: 6
          });
        }
      }
      snake.lastSprintDrop = now;
      
      if (snake.score <= 0) {
        snake.isSprinting = false;
      }
    }
    
    if (snake.isBot) {
      updateBot(snake);
    } else {
      if (now - snake.lastUpdate < 5000) {
        moveSnake(snake);
      }
    }
  }

  checkCollisions();
  if (frameCount % 60 === 0) maintainBallCount();

  broadcastState();
}

function broadcastState() {
  const state = {
    type: 'state',
    snakes: {},
    balls: balls.map(b => ({ x: b.x | 0, y: b.y | 0 }))
  };

  for (const id in snakes) {
    const s = snakes[id];
    if (!s?.body) continue;
    
    state.snakes[id] = {
      b: s.body.map(p => [p.x | 0, p.y | 0]),
      s: s.score,
      i: s.isBot,
      u: s.username,
      sk: s.skinId
    };
  }

  const msg = JSON.stringify(state);
  
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(msg, { binary: false });
    }
  });
}

const server = app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`Slither Arena Server (OPTIMIZED)`);
  console.log(`Port: ${PORT}`);
  console.log(`Tick Rate: ${TICK_RATE}fps`);
  console.log(`Max Bots: ${MAX_BOTS}`);
  console.log(`Happy Hour: Daily 6-7 PM (${HAPPY_HOUR_MULTIPLIER}x points)`);
  console.log(`=================================`);
  
  loadAccounts();
  loadBannedUsernames();
  initBalls();
  initBots();
  setInterval(gameLoop, 1000 / TICK_RATE);
  setInterval(saveAccountsAsync, SAVE_INTERVAL);
  setupTelegramBot();
  
  // Initialize Happy Hour schedule
  initHappyHour();
});

const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false
});

wss.on('connection', (ws, req) => {
  const playerIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  if (isPlayerBanned(playerIP)) {
    ws.send(JSON.stringify({
      type: 'banned',
      message: 'You are temporarily banned'
    }));
    ws.close();
    return;
  }

  ws.once('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'register') {
        const username = msg.username.trim();
        const password = msg.password.trim();
        
        if (username.length < 3) {
          ws.send(JSON.stringify({
            type: 'authError',
            message: 'Username must be 3+ characters'
          }));
          return;
        }
        
        if (bannedUsernames.has(username.toLowerCase())) {
          ws.send(JSON.stringify({
            type: 'authError',
            message: 'This username is not allowed'
          }));
          return;
        }
        
        if (containsBannedWord(username)) {
          bannedIPs[playerIP] = Date.now() + 300000;
          ws.send(JSON.stringify({
            type: 'authError',
            message: 'Username contains inappropriate content'
          }));
          ws.close();
          queueTelegramMessage(`🚫 Blocked registration | Username: ${username} | IP: ${playerIP}`);
          return;
        }
        
        if (accounts[username.toLowerCase()]) {
          ws.send(JSON.stringify({
            type: 'authError',
            message: 'Username already taken'
          }));
          return;
        }
        
        const account = createAccount(username, password);
        queueTelegramMessage(`✅ New registration: ${username}`);
        
        ws.send(JSON.stringify({
          type: 'authSuccess',
          playerData: {
            points: account.points,
            highScore: account.highScore,
            ownedSkins: account.ownedSkins
          },
          currentSkin: account.currentSkin,
          skins: SKINS,
          leaderboard: getLeaderboard(),
          happyHour: getHappyHourStatus()
        }));
        
        setupGameHandlers(ws, username, playerIP);
        
      } else if (msg.type === 'login') {
        const username = msg.username.trim();
        const password = msg.password.trim();
        
        const account = verifyAccount(username, password);
        if (!account) {
          ws.send(JSON.stringify({
            type: 'authError',
            message: 'Invalid username or password'
          }));
          return;
        }
        
        if (account.error) {
          ws.send(JSON.stringify({
            type: 'authError',
            message: account.error
          }));
          return;
        }
        
        queueTelegramMessage(`🔑 Login: ${username}`);
        
        ws.send(JSON.stringify({
          type: 'authSuccess',
          playerData: {
            points: account.points,
            highScore: account.highScore,
            ownedSkins: account.ownedSkins
          },
          currentSkin: account.currentSkin,
          skins: SKINS,
          leaderboard: getLeaderboard(),
          happyHour: getHappyHourStatus()
        }));
        
        setupGameHandlers(ws, username, playerIP);
      }
    } catch (e) {
      console.error('Auth error:', e);
      ws.close();
    }
  });
});

function setupGameHandlers(ws, accountUsername, playerIP) {
  let playerId = null;
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'spawn') {
        playerId = `p${Date.now()}${Math.random() * 1000 | 0}`;
        const account = accounts[accountUsername.toLowerCase()];
        const skinId = msg.skinId || account.currentSkin || 'jude';
        
        snakes[playerId] = createSnake(playerId, false, accountUsername, skinId);
        ws.playerId = playerId;
        
        ws.send(JSON.stringify({
          type: 'welcome',
          id: playerId,
          playerData: {
            points: account.points,
            highScore: account.highScore,
            ownedSkins: account.ownedSkins
          }
        }));
        
        const hhLabel = happyHourActive ? ' 🎉' : '';
        queueTelegramMessage(`🎮 ${accountUsername} spawned${hhLabel}`);
        
      } else if (msg.type === 'input' && playerId && snakes[playerId]) {
        const snake = snakes[playerId];
        const dir = msg.direction;
        
        if (dir?.x !== undefined && dir?.y !== undefined) {
          const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
          if (len > 0) {
            snake.direction = { x: dir.x / len, y: dir.y / len };
            snake.lastUpdate = Date.now();
          }
        }
        
        if (msg.sprinting !== undefined) {
          if (msg.sprinting && snake.score > 0) {
            snake.isSprinting = true;
          } else {
            snake.isSprinting = false;
          }
        }
        
      } else if (msg.type === 'chatMessage' && playerId && snakes[playerId]) {
        if (isChatBanned(playerIP)) {
          ws.send(JSON.stringify({
            type: 'chatBanned',
            message: 'You are chat banned'
          }));
          return;
        }
        
        if (containsBannedWord(msg.message)) {
          chatBannedIPs[playerIP] = Date.now() + 600000;
          const account = accounts[accountUsername.toLowerCase()];
          account.points = 0;
          account.highScore = 0;
          account.ownedSkins = ['jude'];
          account.currentSkin = 'jude';
          saveAccountsAsync();
          
          ws.send(JSON.stringify({
            type: 'chatBanned',
            message: 'Banned for inappropriate language. Progress reset.'
          }));
          
          if (snakes[playerId]) delete snakes[playerId];
          queueTelegramMessage(`⚠️ Chat ban: ${accountUsername} | Progress reset`);
          return;
        }
        
        const chatMsg = {
          type: 'chatMessage',
          username: accountUsername,
          message: msg.message.substring(0, 200)
        };
        
        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(chatMsg));
          }
        });
        
        queueTelegramMessage(`💬 ${accountUsername}: ${msg.message.substring(0, 100)}`);
        
      } else if (msg.type === 'buySkin') {
        const account = accounts[accountUsername.toLowerCase()];
        const skin = SKINS.find(s => s.id === msg.skinId);
        
        if (account && skin && account.points >= skin.cost && !account.ownedSkins.includes(msg.skinId)) {
          account.points -= skin.cost;
          account.ownedSkins.push(msg.skinId);
          saveAccountsAsync();
          
          ws.send(JSON.stringify({
            type: 'skinPurchased',
            skinId: msg.skinId,
            points: account.points
          }));
          
          queueTelegramMessage(`🛍️ ${accountUsername} bought ${skin.name} for ${skin.cost} pts`);
        }
        
      } else if (msg.type === 'selectSkin') {
        const account = accounts[accountUsername.toLowerCase()];
        
        if (account && account.ownedSkins.includes(msg.skinId)) {
          account.currentSkin = msg.skinId;
          saveAccountsAsync();
          
          if (snakes[playerId]) {
            snakes[playerId].skinId = msg.skinId;
          }
        }
        
      } else if (msg.type === 'getLeaderboard') {
        ws.send(JSON.stringify({
          type: 'leaderboardUpdate',
          leaderboard: getLeaderboard()
        }));
      }
      
    } catch (e) {
      console.error('Message error:', e);
    }
  });
  
  ws.on('close', () => {
    if (playerId && snakes[playerId]) {
      const snake = snakes[playerId];
      const account = accounts[accountUsername.toLowerCase()];
      
      if (account) {
        account.points += snake.points;
        account.highScore = Math.max(account.highScore, snake.score);
        saveAccountsAsync();
      }
      
      delete snakes[playerId];
      queueTelegramMessage(`👋 ${accountUsername} disconnected`);
    }
  });
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  saveAccountsAsync();
  saveBannedUsernamesAsync();
  queueTelegramMessage('🛑 Server shutting down...');
  setTimeout(() => process.exit(0), 2000);
});
