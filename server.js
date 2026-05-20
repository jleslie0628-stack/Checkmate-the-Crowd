const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

let votes = {};
let resignVotes = new Set();
let theOneSocketId = null;
let gameStarted = false;

const TURN_TIME_LIMIT = 30;
let timeRemaining = TURN_TIME_LIMIT;
let timerInterval = null;

app.use(express.static(__dirname));

function endGame(message) {
    gameStarted = false;
    resignVotes.clear();
    io.emit('broadcastChatMessage', { role: 'Game System', message: message });
    io.emit('gameOver');
}

function startTimer() {
    if (!gameStarted) return;
    clearInterval(timerInterval);
    timeRemaining = TURN_TIME_LIMIT;
    io.emit('timeUpdate', timeRemaining);
    timerInterval = setInterval(() => {
        timeRemaining--;
        io.emit('timeUpdate', timeRemaining);
        if (timeRemaining <= 0) handleTurnTimeout();
    }, 1000);
}

function handleTurnTimeout() {
    if (io.engine.clientsCount === 0) { gameStarted = false; return; }
    
    // Auto-move logic for 100s or random for One
    const moves = chess.moves({ verbose: true });
    if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);

    if (chess.isGameOver()) {
        endGame("Game Over - Checkmate!");
    } else {
        io.emit('gameState', chess.fen());
        startTimer();
    }
}

io.on('connection', (socket) => {
    socket.emit('gameState', chess.fen());
    socket.emit('roleStatus', { theOneTaken: theOneSocketId !== null });

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneSocketId === null) {
                theOneSocketId = socket.id;
                socket.emit('roleAssigned', 'theOne');
            } else socket.emit('roleDenied', 'Taken!');
        } else socket.emit('roleAssigned', 'the100');

        if (!gameStarted) { gameStarted = true; startTimer(); }
    });

    socket.on('sendChatMessage', (text) => {
        let senderRole = (socket.id === theOneSocketId) ? 'The One' : 'The 100';
        io.emit('broadcastChatMessage', { role: senderRole, message: text });
    });

    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) endGame("The One resigned! Black wins.");
        else {
            resignVotes.add(socket.id);
            const threshold = Math.ceil(io.engine.clientsCount * 0.51);
            io.emit('resignProgress', { count: resignVotes.size, needed: threshold });
            if (resignVotes.size >= threshold) endGame("The 100 resigned! White wins.");
        }
    });

    socket.on('restartGame', () => {
        chess.reset(); resignVotes.clear();
        gameStarted = true;
        io.emit('restartGame');
        io.emit('gameState', chess.fen());
        startTimer();
    });

    socket.on('submitMove', (moveData) => {
        if (chess.turn() === 'w' && socket.id === theOneSocketId) {
            chess.move({ from: moveData.from, to: moveData.to, promotion: 'q' });
            io.emit('gameState', chess.fen());
        }
    });
});

http.listen(PORT, () => console.log('Server running on port', PORT));