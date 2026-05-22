const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

let votes = {}, userVotes = {}, resignVotes = new Set();
let theOneSocketId = null, gameStarted = false, turnEndTime = null;
let theOneTaken = false;

app.use(express.static(__dirname));

function startTimer() {
    if (!gameStarted) return;
    turnEndTime = Date.now() + 30000;
    io.emit('timerSync', turnEndTime);
    
    // Safety net: Force move if timer expires
    setTimeout(() => {
        if (gameStarted && Date.now() >= turnEndTime) {
            handleTurnTimeout();
        }
    }, 30000);
}

function handleTurnTimeout() {
    if (chess.isGameOver()) return;
    
    // Logic: If crowd turn, pick most voted move; otherwise random
    const moves = chess.moves({ verbose: true });
    if (moves.length > 0) {
        chess.move(moves[Math.floor(Math.random() * moves.length)]);
    }

    if (chess.isGameOver()) {
        endGame("Game Over - Checkmate!");
    } else {
        votes = {}; userVotes = {};
        io.emit('gameState', chess.fen());
        startTimer();
    }
}

function endGame(message) {
    gameStarted = false;
    io.emit('broadcastChatMessage', { role: 'Game System', message: message });
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
        if (chess.move({ from: data.from, to: data.to, promotion: 'q' })) {
            io.emit('gameState', chess.fen());
            startTimer();
        }
    });

    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) endGame("The One resigned.");
        else {
            resignVotes.add(socket.id);
            if (resignVotes.size >= Math.ceil(io.engine.clientsCount * 0.51)) endGame("Crowd resigned.");
        }

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneTaken) {
                // Reject the attempt if it's already taken
                socket.emit('roleDenied', 'The One is already playing on another device.');
                return;
            }
            theOneTaken = true;
            theOneSocketId = socket.id;
        }
        
    socket.emit('roleAssigned', role);
        io.emit('roleStatus', { theOneTaken }); // Notify everyone to update buttons
        
        if (!gameStarted) { gameStarted = true; startTimer(); }
    });

    // CRITICAL: Release the role if the player disconnects
    socket.on('disconnect', () => {
        if (socket.id === theOneSocketId) {
            theOneTaken = false;
            theOneSocketId = null;
            io.emit('roleStatus', { theOneTaken });
        }
    });
});

http.listen(PORT, () => console.log(`Server running on ${PORT}`));