const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;

let controlMode = null;
let ws = null;
let playerId = null;
let gameState = { snakes: {}, balls: [] };
let playerData = { points: 0, highScore: 0, ownedSkins: ['default'] };
let camera = { x: 0, y: 0 };
let direction = { x: 1, y: 0 };
let currentUsername = '';
let chatUnlocked = false;
let mouseX = 0, mouseY = 0;
let joystickActive = false;

let judeImage = new Image();
judeImage.src = 'jude.png';
let imageLoaded = false;
judeImage.onload = () => { imageLoaded = true; };
judeImage.onerror = () => { imageLoaded = false; };

const skins = [
    { id: 'default', name: 'Default', hue: 0, cost: 0 },
    { id: 'crimson', name: 'Crimson', hue: 0, cost: 50 },
    { id: 'sunset', name: 'Sunset', hue: 30, cost: 100 },
    { id: 'golden', name: 'Golden', hue: 60, cost: 150 },
    { id: 'emerald', name: 'Emerald', hue: 120, cost: 200 },
    { id: 'ocean', name: 'Ocean', hue: 180, cost: 300 },
    { id: 'sapphire', name: 'Sapphire', hue: 240, cost: 400 },
    { id: 'royal', name: 'Royal', hue: 280, cost: 500 },
    { id: 'rose', name: 'Rose', hue: 320, cost: 600 }
];

document.querySelectorAll('.control-card').forEach(card => {
    card.addEventListener('click', () => {
        controlMode = card.dataset.mode;
        document.getElementById('control-select').style.display = 'none';
        document.getElementById('connection-panel').style.display = 'block';
        if (controlMode === 'mobile') {
            document.getElementById('mobile-controls').style.display = 'block';
        }
    });
});

document.getElementById('connect-btn').addEventListener('click', connect);
document.getElementById('shop-btn').addEventListener('click', () => {
    document.getElementById('shop-panel').style.display = 'block';
    updateShop();
});
document.getElementById('close-shop').addEventListener('click', () => {
    document.getElementById('shop-panel').style.display = 'none';
});
document.getElementById('chat-toggle').addEventListener('click', () => {
    const chat = document.getElementById('chat-box');
    chat.style.display = chat.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

if (controlMode === 'wasd') {
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'w') direction = { x: 0, y: -1 };
        else if (e.key.toLowerCase() === 's') direction = { x: 0, y: 1 };
        else if (e.key.toLowerCase() === 'a') direction = { x: -1, y: 0 };
        else if (e.key.toLowerCase() === 'd') direction = { x: 1, y: 0 };
        else return;
        sendDirection();
    });
}

document.addEventListener('keydown', (e) => {
    if (controlMode !== 'wasd') return;
    if (e.key.toLowerCase() === 'w') direction = { x: 0, y: -1 };
    else if (e.key.toLowerCase() === 's') direction = { x: 0, y: 1 };
    else if (e.key.toLowerCase() === 'a') direction = { x: -1, y: 0 };
    else if (e.key.toLowerCase() === 'd') direction = { x: 1, y: 0 };
    else return;
    sendDirection();
});

document.addEventListener('mousemove', (e) => {
    if (controlMode === 'cursor') {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }
});

const joystick = document.getElementById('joystick');
const handle = document.getElementById('joystick-handle');

joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joystickActive = true;
});

document.addEventListener('touchmove', (e) => {
    if (!joystickActive || controlMode !== 'mobile') return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 45;
    
    if (dist > 0) {
        const angle = Math.atan2(dy, dx);
        const limitedDist = Math.min(dist, maxDist);
        handle.style.transform = `translate(calc(-50% + ${Math.cos(angle) * limitedDist}px), calc(-50% + ${Math.sin(angle) * limitedDist}px))`;
        direction = { x: dx / dist, y: dy / dist };
        sendDirection();
    }
});

document.addEventListener('touchend', () => {
    if (controlMode === 'mobile') {
        joystickActive = false;
        handle.style.transform = 'translate(-50%, -50%)';
    }
});

function sendDirection() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', direction }));
    }
}

function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || !chatUnlocked) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chatMessage', message }));
        input.value = '';
    }
}

function addChat(user, msg) {
    const chat = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="user">${user}:</span> ${msg}`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    while (chat.children.length > 50) chat.removeChild(chat.firstChild);
}

function connect() {
    const username = document.getElementById('username').value.trim();
    const url = document.getElementById('ws-url').value.trim();
    if (!username || !url) {
        alert('Enter username and URL');
        return;
    }
    currentUsername = username;
    ws = new WebSocket(url);
    ws.onopen = () => {
        document.getElementById('status').textContent = 'Connected';
        ws.send(JSON.stringify({ type: 'setUsername', username }));
    };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'banned' || msg.type === 'error') {
            alert(msg.message);
        } else if (msg.type === 'welcome') {
            playerId = msg.id;
            playerData = msg.playerData;
            document.getElementById('connection-panel').style.display = 'none';
            document.getElementById('game-container').style.display = 'block';
            checkChatUnlock();
            startGame();
        } else if (msg.type === 'autoRespawn') {
            // Auto respawn - update points and check chat unlock
            playerData.points = msg.points;
            playerData.highScore = msg.highScore;
            checkChatUnlock();
            updateHUD();
        } else if (msg.type === 'state') {
            gameState.snakes = {};
            for (const id in msg.snakes) {
                const s = msg.snakes[id];
                gameState.snakes[id] = {
                    body: s.b.map(p => ({ x: p[0], y: p[1] })),
                    color: s.c,
                    score: s.s,
                    isBot: s.i,
                    username: s.u
                };
            }
            gameState.balls = msg.balls.map(b => ({ x: b.x, y: b.y, color: b.c }));
            updateHUD();
        } else if (msg.type === 'skinPurchased') {
            playerData.ownedSkins.push(msg.skinId);
            playerData.points = msg.points;
            updateShop();
        } else if (msg.type === 'chatMessage') {
            addChat(msg.username, msg.message);
        } else if (msg.type === 'chatBanned') {
            alert(msg.message);
            playerData = { points: 0, highScore: 0, ownedSkins: ['default'] };
            chatUnlocked = false;
            document.getElementById('chat-toggle').style.display = 'none';
        }
    };
}

function checkChatUnlock() {
    if (!chatUnlocked && playerData.points >= 50) {
        chatUnlocked = true;
        document.getElementById('chat-toggle').style.display = 'block';
        document.getElementById('chat-unlock').style.display = 'block';
        setTimeout(() => {
            document.getElementById('chat-unlock').style.display = 'none';
        }, 5000);
    }
}

function startGame() {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const minimap = document.getElementById('minimap');
    const mmCtx = minimap.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
    
    function gameLoop() {
        if (!playerId || !gameState.snakes[playerId]) {
            requestAnimationFrame(gameLoop);
            return;
        }
        
        const player = gameState.snakes[playerId];
        if (player && player.body.length > 0) {
            camera.x = player.body[0].x - canvas.width / 2;
            camera.y = player.body[0].y - canvas.height / 2;
            
            if (controlMode === 'cursor') {
                const worldX = camera.x + mouseX;
                const worldY = camera.y + mouseY;
                const dx = worldX - player.body[0].x;
                const dy = worldY - player.body[0].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 10) {
                    direction = { x: dx / dist, y: dy / dist };
                    sendDirection();
                }
            }
        }
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(-camera.x, -camera.y);
        
        // Grid
        ctx.strokeStyle = 'rgba(0,255,136,0.1)';
        ctx.lineWidth = 1;
        for (let x = 0; x < WORLD_WIDTH; x += 100) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, WORLD_HEIGHT);
            ctx.stroke();
        }
        for (let y = 0; y < WORLD_HEIGHT; y += 100) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(WORLD_WIDTH, y);
            ctx.stroke();
        }
        
        // Balls
        gameState.balls.forEach(ball => {
            ctx.fillStyle = ball.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = ball.color;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });
        
        // Snakes
        Object.values(gameState.snakes).forEach(snake => {
            ctx.strokeStyle = snake.color;
            ctx.lineWidth = 14;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowBlur = 15;
            ctx.shadowColor = snake.color;
            
            if (snake.body.length > 1) {
                ctx.beginPath();
                for (let i = 1; i < snake.body.length; i++) {
                    const seg = snake.body[i];
                    if (i === 1) ctx.moveTo(seg.x, seg.y);
                    else ctx.lineTo(seg.x, seg.y);
                }
                ctx.stroke();
                
                for (let i = 1; i < snake.body.length; i++) {
                    ctx.fillStyle = snake.color;
                    ctx.beginPath();
                    ctx.arc(snake.body[i].x, snake.body[i].y, 7, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            
            const head = snake.body[0];
            if (imageLoaded) {
                const next = snake.body[1] || head;
                const angle = Math.atan2(head.y - next.y, head.x - next.x);
                ctx.save();
                ctx.translate(head.x, head.y);
                ctx.rotate(angle);
                ctx.shadowBlur = 20;
                ctx.drawImage(judeImage, -25, -25, 50, 50);
                ctx.restore();
            } else {
                ctx.fillStyle = snake.color;
                ctx.beginPath();
                ctx.arc(head.x, head.y, 12, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            
            ctx.fillStyle = '#00ffff';
            ctx.font = 'bold 14px Orbitron';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 4;
            const text = `${snake.username} [${snake.score}]`;
            ctx.strokeText(text, head.x, head.y - 30);
            ctx.fillText(text, head.x, head.y - 30);
        });
        
        ctx.restore();
        drawMinimap(mmCtx);
        updatePlayerList();
        requestAnimationFrame(gameLoop);
    }
    gameLoop();
}

function drawMinimap(ctx) {
    const mm = document.getElementById('minimap');
    const sx = mm.width / WORLD_WIDTH;
    const sy = mm.height / WORLD_HEIGHT;
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, mm.width, mm.height);
    
    Object.entries(gameState.snakes).forEach(([id, snake]) => {
        if (!snake.isBot && snake.body[0]) {
            ctx.fillStyle = id === playerId ? '#ffff00' : snake.color;
            ctx.shadowBlur = 5;
            ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath();
            ctx.arc(snake.body[0].x * sx, snake.body[0].y * sy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    });
}

function updateHUD() {
    if (playerId && gameState.snakes[playerId]) {
        const p = gameState.snakes[playerId];
        document.getElementById('score').textContent = p.score;
        document.getElementById('points').textContent = playerData.points;
        document.getElementById('highscore').textContent = playerData.highScore;
        if (playerData.points >= 50) checkChatUnlock();
    }
}

function updatePlayerList() {
    const container = document.getElementById('players-container');
    container.innerHTML = '';
    const players = Object.values(gameState.snakes).filter(s => !s.isBot);
    players.sort((a, b) => b.score - a.score);
    players.slice(0, 10).forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `<span>${p.username}</span><span>${p.score}</span>`;
        container.appendChild(div);
    });
}

function updateShop() {
    const grid = document.getElementById('skins-grid');
    grid.innerHTML = '';
    skins.forEach(skin => {
        const card = document.createElement('div');
        card.className = 'skin-card';
        
        const preview = document.createElement('div');
        preview.className = 'skin-preview';
        preview.style.background = `hsl(${skin.hue}, 70%, 50%)`;
        
        const title = document.createElement('h4');
        title.textContent = skin.name;
        
        const cost = document.createElement('div');
        cost.className = 'cost';
        cost.textContent = `${skin.cost} points`;
        
        const owned = playerData.ownedSkins.includes(skin.id);
        const btn = document.createElement('button');
        btn.textContent = owned ? 'OWNED' : 'BUY';
        btn.disabled = owned || playerData.points < skin.cost;
        
        btn.onclick = () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'buySkin', skinId: skin.id, cost: skin.cost }));
            }
        };
        
        card.appendChild(preview);
        card.appendChild(title);
        card.appendChild(cost);
        card.appendChild(btn);
        
        if (owned) {
            const selectBtn = document.createElement('button');
            selectBtn.textContent = 'SELECT';
            selectBtn.className = 'select';
            selectBtn.onclick = () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const color = `hsl(${skin.hue}, 70%, 50%)`;
                    ws.send(JSON.stringify({ type: 'selectSkin', skinId: skin.id, color }));
                }
            };
            card.appendChild(selectBtn);
        }
        
        grid.appendChild(card);
    });
}
