@"
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const socket = io('http://localhost:5000');

const wormImg = new Image();
wormImg.src = 'assets/worm.png';

let worm = { x: 400, y: 300, size: 20, body: [], length: 5, dx: 0, dy: 0 };
let foods = [];
for (let i = 0; i < 20; i++) {
    foods.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: 10 });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'w') { worm.dx = 0; worm.dy = -2; }
    if (e.key === 'ArrowDown' || e.key === 's') { worm.dx = 0; worm.dy = 2; }
    if (e.key === 'ArrowLeft' || e.key === 'a') { worm.dx = -2; worm.dy = 0; }
    if (e.key === 'ArrowRight' || e.key === 'd') { worm.dx = 2; worm.dy = 0; }
});

function joinGame() {
    const username = document.getElementById('username').value || 'Player';
    socket.emit('join', { username });
}

wormImg.onload = () => { gameLoop(); };

function gameLoop() {
    worm.x += worm.dx; worm.y += worm.dy;
    worm.x = Math.max(0, Math.min(canvas.width - worm.size, worm.x));
    worm.y = Math.max(0, Math.min(canvas.height - worm.size, worm.y));
    worm.body.push({ x: worm.x, y: worm.y });
    while (worm.body.length > worm.length) { worm.body.shift(); }

    foods.forEach((food,index) => {
        const dx = worm.x - food.x; const dy = worm.y - food.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if(dist < worm.size){ worm.length+=3; foods.splice(index,1); foods.push({x:Math.random()*canvas.width,y:Math.random()*canvas.height,size:10}); }
    });

    ctx.clearRect(0,0,canvas.width,canvas.height);
    foods.forEach(food=>{ctx.fillStyle='red';ctx.fillRect(food.x,food.y,food.size,food.size);});
    worm.body.forEach(seg=>{ctx.drawImage(wormImg,seg.x,seg.y,worm.size,worm.size);});
    requestAnimationFrame(gameLoop);
}
"@ | Set-Content (Join-Path $frontendPath "game.js")
