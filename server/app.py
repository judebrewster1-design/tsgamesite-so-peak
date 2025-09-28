from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import eventlet

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Simple game state
players = {}
food = {"x": 50, "y": 50}

@app.route("/")
def index():
    return "Slither backend is running!"

@socketio.on("connect")
def on_connect():
    print("A player connected:", request.sid)
    players[request.sid] = {"x": 100, "y": 100, "length": 1}
    emit("init", {"id": request.sid, "players": players, "food": food}, broadcast=True)

@socketio.on("move")
def on_move(data):
    if request.sid in players:
        players[request.sid]["x"] = data.get("x", players[request.sid]["x"])
        players[request.sid]["y"] = data.get("y", players[request.sid]["y"])
        emit("update", {"players": players, "food": food}, broadcast=True)

@socketio.on("disconnect")
def on_disconnect():
    print("A player disconnected:", request.sid)
    if request.sid in players:
        del players[request.sid]
        emit("update", {"players": players, "food": food}, broadcast=True)

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=10000)

