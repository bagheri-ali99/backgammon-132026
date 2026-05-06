const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ===== STATE =====
const waitingPlayers = {}; // bet -> [socket]
const rooms = {}; // roomId -> {players, gameState, ...}
const playerRoom = {}; // socketId -> roomId

// ===== MATCHMAKING =====
io.on('connection', (socket) => {
console.log('✅ connected:', socket.id);

// Player joins queue
socket.on('join_queue', ({ name, bet, stars }) => {
socket.data.name = name;
socket.data.bet = bet;
socket.data.stars = stars;

if (!waitingPlayers[bet]) waitingPlayers[bet] = [];

// Check if someone is already waiting with same bet
const waiting = waitingPlayers[bet].find(s => s.id !== socket.id && s.connected);

if (waiting) {
// Match found!
waitingPlayers[bet] = waitingPlayers[bet].filter(s => s.id !== waiting.id);

const roomId = Math.random().toString(36).substr(2, 8);
const whitePlayer = Math.random() > 0.5 ? socket : waiting;
const blackPlayer = whitePlayer.id === socket.id ? waiting : socket;

rooms[roomId] = {
id: roomId,
bet,
players: {
white: { id: whitePlayer.id, name: whitePlayer.data.name },
black: { id: blackPlayer.id, name: blackPlayer.data.name }
},
turn: 'white',
gameState: null,
chat: []
};

playerRoom[socket.id] = roomId;
playerRoom[waiting.id] = roomId;

socket.join(roomId);
waiting.join(roomId);

// Notify both players
io.to(roomId).emit('match_found', {
roomId,
white: rooms[roomId].players.white,
black: rooms[roomId].players.black,
bet
});

console.log(`🎲 Match: ${whitePlayer.data.name} vs ${blackPlayer.data.name} | bet:${bet}`);
} else {
// Wait for opponent
waitingPlayers[bet].push(socket);
socket.emit('waiting', { message: 'دنبال حریف می‌گردیم...' });
}
});

// Cancel queue
socket.on('cancel_queue', () => {
const bet = socket.data.bet;
if (bet && waitingPlayers[bet]) {
waitingPlayers[bet] = waitingPlayers[bet].filter(s => s.id !== socket.id);
}
socket.emit('queue_cancelled');
});

// Game move
socket.on('game_move', ({ roomId, from, to, diceUsed }) => {
socket.to(roomId).emit('opponent_move', { from, to, diceUsed });
});

// Dice roll
socket.on('dice_rolled', ({ roomId, dice }) => {
socket.to(roomId).emit('opponent_dice', { dice });
});

// Pass turn
socket.on('pass_turn', ({ roomId }) => {
socket.to(roomId).emit('opponent_passed');
});

// Game over
socket.on('game_over', ({ roomId, winnerId }) => {
const room = rooms[roomId];
if (!room) return;
io.to(roomId).emit('game_result', { winnerId, bet: room.bet });
delete rooms[roomId];
// cleanup playerRoom
Object.keys(playerRoom).forEach(k => {
if (playerRoom[k] === roomId) delete playerRoom[k];
});
});

// Chat
socket.on('chat_message', ({ roomId, text }) => {
socket.to(roomId).emit('opponent_chat', {
name: socket.data.name,
text
});
});

// Get online count
socket.on('get_online', () => {
socket.emit('online_count', { count: io.engine.clientsCount });
});

// Disconnect
socket.on('disconnect', () => {
console.log('❌ disconnected:', socket.id);

// Remove from queue
const bet = socket.data.bet;
if (bet && waitingPlayers[bet]) {
waitingPlayers[bet] = waitingPlayers[bet].filter(s => s.id !== socket.id);
}

// Notify room opponent
const roomId = playerRoom[socket.id];
if (roomId && rooms[roomId]) {
socket.to(roomId).emit('opponent_left');
delete rooms[roomId];
}
delete playerRoom[socket.id];
});
});

// Health check
app.get('/', (req, res) => {
res.json({
status: 'ok',
players: io.engine.clientsCount,
rooms: Object.keys(rooms).length
});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
