const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const wormImg = new Image();
wormImg.src = "assets/worm.png"; // put your PNG here

let worm = {
    x: 400,
    y: 300,
    size: 20,
    body: [], // array of segments
    length: 5,
    dx: 0,
    dy: 0
};

let foods = [];

// Spawn some food
for (let i = 0; i < 20; i++) {
    foods.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: 10
    });
}

// Handle keyboard input
document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "w") {
        worm.dx = 0; worm.dy = -2;
    }
    if (e.key === "ArrowDown" || e.key === "s") {
        worm.dx = 0; worm.dy = 2;
    }
    if (e.key === "ArrowLeft" || e.key === "a") {
        worm.dx = -2; worm.dy = 0;
    }
    if (e.key === "ArrowRight" || e.key === "d") {
        worm.dx = 2; worm.dy = 0;
    }
});

function gameLoop() {
    // Move worm
    worm.x += worm.dx;
    worm.y += worm.dy;

    // Keep inside canvas
    worm.x = Math.max(0, Math.min(canvas.width - worm.size, worm.x));
    worm.y = Math.max(0, Math.min(canvas.height - worm.size, worm.y));

    // Add current head to body
    worm.body.push({ x: worm.x, y: worm.y });

    // Limit body length
    while (worm.body.length > worm.length) {
        worm.body.shift();
    }

    // Check for food collisions
    foods.forEach((food, index) => {
        const dx = worm.x - food.x;
        const dy = worm.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < worm.size) {
            worm.length += 3; // grow
            foods.splice(index, 1); // remove food
            foods.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: 10 });
        }
    });

    // Draw everything
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw food
    foods.forEach(food => {
        ctx.fillStyle = "red";
        ctx.fillRect(food.x, food.y, food.size, food.size);
    });

    // Draw worm
    worm.body.forEach(segment => {
        ctx.drawImage(wormImg, segment.x, segment.y, worm.size, worm.size);
    });

    requestAnimationFrame(gameLoop);
}

// Start game when worm image loads
wormImg.onload = () => {
    gameLoop();
};
