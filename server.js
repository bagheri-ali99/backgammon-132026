const express = require(‘express’);
const http = require(‘http’);
const { Server } = require(‘socket.io’);
const cors = require(‘cors’);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
cors: { origin: ‘*’, methods: [‘GET’, ‘POST’] }
});

const WIN_AMOUNTS = { 76: 140, 152: 280, 304: 560 };
const SUPABASE_URL = ‘https://bmfxcrgaavbeidakeqiw.supabase.co’;
const SUPABASE_KEY = ‘eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZnhjcmdhYXZiZWlkYWtlcWl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMDQ2MzQsImV4cCI6MjA5MzY4MDYzNH0.Sucl9zCtlu433X0nEjOkJ3fSD_drRtWJIGyrNJZkOfA’;

const waitingPlayers = {};
const rooms = {};
const playerRoom = {};

async function supaFetch(path, method=‘GET’, body=null) {
const res = await fetch(SUPABASE_URL + ‘/rest/v1/’ + path, {
method,
headers: {
‘apikey’: SUPABASE_KEY,
‘Authorization’: ’Bearer ’ + SUPABASE_KEY,
‘Content-Type’: ‘application/json’,
‘Prefer’: method === ‘POST’ ? ‘return=representation’ : ‘’
},
body: body ? JSON.stringify(body) : null
});
return res.json();
}

async function getUser(tid) {
const data = await supaFetch(‘users?telegram_id=eq.’ + tid + ‘&select=*’);
return data[0] || null;
}

async function upsertUser(tid, username) {
let user = await getUser(tid);
if (!user) {
const data = await supaFetch(‘users’, ‘POST’, { telegram_id: tid, username, balance: 0 });
return data[0];
}
return user;
}

async function addBalance(tid, amount, type, desc) {
const user = await getUser(tid);
if (!user) return;
const newBal = (user.balance || 0) + amount;
await supaFetch(‘users?telegram_id=eq.’ + tid, ‘PATCH’, { balance: newBal });
await supaFetch(‘transactions’, ‘POST’, { telegram_id: tid, amount, type, description: desc });
return newBal;
}

io.on(‘connection’, (socket) => {
console.log(‘connected:’, socket.id);

socket.on(‘init_user’, async ({ telegramId, username }) => {
const user = await upsertUser(telegramId, username);
socket.data.telegramId = telegramId;
socket.emit(‘user_data’, { balance: user ? user.balance : 0 });
});

socket.on(‘join_queue’, async ({ name, bet, telegramId }) => {
socket.data.name = name;
socket.data.bet = bet;
socket.data.telegramId = telegramId;

```
if (!waitingPlayers[bet]) waitingPlayers[bet] = [];
const waiting = waitingPlayers[bet].find(s => s.id !== socket.id && s.connected);

if (waiting) {
  waitingPlayers[bet] = waitingPlayers[bet].filter(s => s.id !== waiting.id);
  const roomId = Math.random().toString(36).substr(2, 8);

  rooms[roomId] = {
    id: roomId, bet,
    players: {
      p1: { id: socket.id, name, telegramId },
      p2: { id: waiting.id, name: waiting.data.name, telegramId: waiting.data.telegramId }
    },
    choices: {}, scores: { [socket.id]: 0, [waiting.id]: 0 }
  };

  playerRoom[socket.id] = roomId;
  playerRoom[waiting.id] = roomId;
  socket.join(roomId);
  waiting.join(roomId);

  io.to(roomId).emit('match_found', {
    roomId,
    white: rooms[roomId].players.p1,
    black: rooms[roomId].players.p2,
    bet
  });
} else {
  waitingPlayers[bet].push(socket);
  socket.emit('waiting', {});
}
```

});

socket.on(‘cancel_queue’, () => {
const bet = socket.data.bet;
if (bet && waitingPlayers[bet]) {
waitingPlayers[bet] = waitingPlayers[bet].filter(s => s.id !== socket.id);
}
});

socket.on(‘rps_choice’, async ({ roomId, choice }) => {
const room = rooms[roomId];
if (!room || room.settled) return;

```
// Validate choice
if (!['rock','paper','scissors'].includes(choice)) return;

room.choices[socket.id] = choice;
socket.to(roomId).emit('opponent_choice', { choice });

const ids = Object.keys(room.choices);
if (ids.length === 2) {
  const [a, b] = ids;
  const ca = room.choices[a];
  const cb = room.choices[b];

  // Server decides winner
  let roundWinner = null;
  if (ca !== cb) {
    if ((ca==='rock'&&cb==='scissors') || (ca==='scissors'&&cb==='paper') || (ca==='paper'&&cb==='rock')) {
      roundWinner = a;
    } else {
      roundWinner = b;
    }
    room.scores[roundWinner] = (room.scores[roundWinner] || 0) + 1;
  }

  room.choices = {};

  io.to(roomId).emit('round_resolved', {
    p1id: a, p1choice: ca,
    p2id: b, p2choice: cb,
    roundWinner,
    scores: room.scores
  });

  // Check if match over (first to 3)
  const winnerId = Object.keys(room.scores).find(id => room.scores[id] >= 3);
  if (winnerId && !room.settled) {
    room.settled = true;
    const loserId = Object.keys(room.scores).find(id => id !== winnerId);
    const bet = room.bet;
    const winAmount = WIN_AMOUNTS[bet] || bet * 2;
    const winner = Object.values(room.players).find(p => p.id === winnerId);
    const loser = Object.values(room.players).find(p => p.id === loserId);

    // Update balances in Supabase
    if (winner && winner.telegramId) {
      await addBalance(winner.telegramId, winAmount, 'win', 'Won RPS bet:' + bet);
    }
    if (loser && loser.telegramId) {
      await addBalance(loser.telegramId, -bet, 'lose', 'Lost RPS bet:' + bet);
    }

    io.to(roomId).emit('match_over', { winnerId, loserId, winAmount, bet });
    setTimeout(() => delete rooms[roomId], 5000);
  }
}
```

});

// game_over from client is now ignored - server decides
socket.on(‘game_over’, () => {});

socket.on(‘get_online’, () => {
socket.emit(‘online_count’, { count: io.engine.clientsCount });
});

socket.on(‘disconnect’, () => {
const bet = socket.data.bet;
if (bet && waitingPlayers[bet]) waitingPlayers[bet] = waitingPlayers[bet].filter(s => s.id !== socket.id);
const roomId = playerRoom[socket.id];
if (roomId && rooms[roomId]) socket.to(roomId).emit(‘opponent_left’);
delete rooms[roomId];
delete playerRoom[socket.id];
});
});

app.get(’/’, (req, res) => res.json({ status: ‘ok’, players: io.engine.clientsCount }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(‘Server on port’, PORT));
