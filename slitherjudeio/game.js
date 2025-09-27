let socket;

function joinGame() {
  const name = document.getElementById("username").value;
  if (!name) {
    alert("Please enter a name");
    return;
  }

  // Connect to backend server (will replace URL later)
  socket = io("http://localhost:5000");

  socket.emit("join", { username: name });

  socket.on("joined", (data) => {
    alert(`You joined as ${data.name}`);
    startGame(); // placeholder to start the game loop
  });

  socket.on("waiting_room", (msg) => {
    alert(msg.message);
  });
}

function startGame() {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  // Example placeholder: draw a single worm
  let x = 100, y = 100;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "lime";
    ctx.fillRect(x, y, 20, 20);
    requestAnimationFrame(draw);
  }

  draw();
}
