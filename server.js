const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

let votes = {}, userVotes = {}, resignVotes = new Set();
let theOneSocketId = null, gameStarted = false, turnEndTime = null;

app.use(express.static(__dirname));

function startTimer() {
    if (!gameStarted) return;
    turnEndTime = Date.now() + 30000;
    io.emit('timerSync', turnEndTime);
}

function endGame(message) {
    gameStarted = false;
    io.emit('broadcastChatMessage', { role: 'System', message: message });
    io.emit('gameOver');
}

io.on('connection', (socket) => {
    socket.emit('gameState', chess.fen());
    socket.emit('timerSync', turnEndTime);

    socket.on('requestSync', () => {
        socket.emit('gameState', chess.fen());
        socket.emit('timerSync', turnEndTime);
    });

    socket.on('claimRole', (role) => {
        if (role === 'theOne' && !theOneSocketId) theOneSocketId = socket.id;
        socket.emit('roleAssigned', role);
        if (!gameStarted) { gameStarted = true; startTimer(); }
    });

    socket.on('sendChatMessage', (msg) => {
        let role = (socket.id === theOneSocketId) ? 'The One' : 'The 100';
        io.emit('broadcastChatMessage', { role, message: msg });
    });

    socket.on('submitMove', (data) => {
        try {
            if (chess.move({ from: data.from, to: data.to, promotion: 'q' })) {
                io.emit('gameState', chess.fen());
                startTimer();
            }
        } catch(e) { socket.emit('invalidMove'); }
    });

    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) endGame("The One resigned.");
        else {
            resignVotes.add(socket.id);
            if (resignVotes.size >= Math.ceil(io.engine.clientsCount * 0.51)) endGame("Crowd resigned.");
        }
    });

    socket.on('disconnect', () => { if (socket.id === theOneSocketId) theOneSocketId = null; });
});

http.listen(PORT, () => console.log(`Server running on ${PORT}`));