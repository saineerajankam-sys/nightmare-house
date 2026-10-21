
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true }));

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const p of room.players.values()) {
    send(p.ws, data);
  }
}

function snapshot(room) {
  return {
    type: "state",
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      rot: p.rot,
      caught: p.caught
    })),
    monster: { x: room.mx, z: room.mz }
  };
}

function createCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function removePlayer(ws) {
  if (!ws.roomCode) return;

  const room = rooms.get(ws.roomCode);
  if (!room) return;

  room.players.delete(ws.playerId);
  ws.roomCode = null;

  if (room.players.size === 0) {
    rooms.delete(room.code);
  } else {
    broadcast(room, {
      type: "notice",
      text: "A player disconnected."
    });
    broadcast(room, snapshot(room));
  }
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "create") {
      if (ws.roomCode) return;

      const max = Number(msg.maxPlayers);
      if (![2, 4].includes(max)) {
        return send(ws, {
          type: "error",
          text: "Choose 2 or 4 players."
        });
      }

      const code = createCode();
      const id = crypto.randomUUID();

      const room = {
        code,
        maxPlayers: max,
        players: new Map(),
        mx: 0,
        mz: -5
      };

      rooms.set(code, room);
      room.players.set(id, {
        id,
        ws,
        name: String(msg.name || "Player").slice(0, 16),
        x: 0,
        z: 3,
        rot: 0,
        caught: false
      });

      ws.roomCode = code;
      ws.playerId = id;

      send(ws, {
        type: "joined",
        room: code,
        playerId: id,
        maxPlayers: max
      });

      broadcast(room, snapshot(room));
      return;
    }

    if (msg.type === "join") {
      if (ws.roomCode) return;

      const code = String(msg.room || "")
        .toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          text: "Room not found."
        });
      }

      if (room.players.size >= room.maxPlayers) {
        return send(ws, {
          type: "error",
          text: "Room is full."
        });
      }

      const id = crypto.randomUUID();

      room.players.set(id, {
        id,
        ws,
        name: String(msg.name || "Player").slice(0, 16),
        x: Math.random() * 4 - 2,
        z: 3,
        rot: 0,
        caught: false
      });

      ws.roomCode = code;
      ws.playerId = id;

      send(ws, {
        type: "joined",
        room: code,
        playerId: id,
        maxPlayers: room.maxPlayers
      });

      broadcast(room, snapshot(room));
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    const p = room.players.get(ws.playerId);
    if (!p) return;

    if (msg.type === "move") {
      const x = Number(msg.x);
      const z = Number(msg.z);
      const rot = Number(msg.rot);

      if (![x, z, rot].every(Number.isFinite)) return;

      p.x = Math.max(-11, Math.min(11, x));
      p.z = Math.max(-11, Math.min(11, z));
      p.rot = rot;
    }

    if (msg.type === "respawn") {
      p.x = Math.random() * 4 - 2;
      p.z = 4;
      p.caught = false;
    }

    if (msg.type === "leave") {
      removePlayer(ws);
      send(ws, { type: "left" });
    }
  });

  ws.on("close", () => removePlayer(ws));
  ws.on("error", () => removePlayer(ws));
});

setInterval(() => {
  for (const room of rooms.values()) {
    const targets = [...room.players.values()]
      .filter(p => !p.caught);

    if (targets.length) {
      targets.sort((a, b) =>
        Math.hypot(a.x - room.mx, a.z - room.mz) -
        Math.hypot(b.x - room.mx, b.z - room.mz)
      );

      const target = targets[0];
      const dx = target.x - room.mx;
      const dz = target.z - room.mz;
      const distance = Math.hypot(dx, dz);

      if (distance > 0.01) {
        const speed = distance < 4 ? 0.075 : 0.045;
        room.mx += dx / distance * speed;
        room.mz += dz / distance * speed;
      }

      if (distance < 1.15) {
        target.caught = true;
        send(target.ws, { type: "caught" });
      }
    } else {
      room.mx += (Math.random() - 0.5) * 0.07;
      room.mz += (Math.random() - 0.5) * 0.07;
      room.mx = Math.max(-9, Math.min(9, room.mx));
      room.mz = Math.max(-9, Math.min(9, room.mz));
    }

    broadcast(room, snapshot(room));
  }
}, 100);

const port = process.env.PORT || 10000;

server.listen(port, "0.0.0.0", () => {
  console.log("NIGHTMARE HOUSE running on port " + port);
});
    
