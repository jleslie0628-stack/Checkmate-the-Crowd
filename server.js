const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

let votes = {}, userVotes = {}, resignVotes = new Set();
let theOneSocketId = null, gameStarted = false, turnEndTime = null;
let timerInterval = null;
const TURN_TIME_LIMIT = 30;

app.use(express.static(__dirname));

function checkAndBroadcastStatus() {
    if (chess.isCheckmate()) {
        const winner = chess.turn() === 'w' ? "The 100 (Black)" : "The One (White)";
        endGame(`CHECKMATE! ${winner} wins the match!`);
        return true;
    }
    if (chess.inCheck()) {
        const target = chess.turn() === 'w' ? "The One (White)" : "The 100 (Black)";
        io.emit('broadcastChatMessage', { role: 'Game System', message: `CHECK! ${target} is under attack.` });
    }
    return false;
}

function endGame(message) {
    gameStarted = false;
    clearInterval(timerInterval);
    io.emit('broadcastChatMessage', { role: 'Game System', message: message });
    io.emit('gameOver');
}

function startTimer() {
    if (!gameStarted) return;
    clearInterval(timerInterval);
    let timeRemaining = TURN_TIME_LIMIT;
    io.emit('timeUpdate', timeRemaining);
    timerInterval = setInterval(() => {
        timeRemaining--;
        io.emit('timeUpdate', timeRemaining);
        if (timeRemaining <= 0) handleTurnTimeout();
    }, 1000);
}

function handleTurnTimeout() {
    if (chess.turn() === 'b') {
        if (Object.keys(votes).length > 0) {
            const moveStr = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
            chess.move({ from: moveStr.substring(0, 2), to: moveStr.substring(2, 4), promotion: 'q' });
        } else {
            const moves = chess.moves({ verbose: true });
            if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
        }
    } else {
        const moves = chess.moves({ verbose: true });
        if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
    }
    votes = {}; userVotes = {};
    io.emit('gameState', chess.fen());
    io.emit('voteUpdate', votes);
    if (!checkAndBroadcastStatus() && !chess.isGameOver()) startTimer();
}

io.on('connection', (socket) => {
    socket.emit('gameState', chess.fen());
    socket.emit('roleStatus', { theOneTaken: theOneSocketId !== null });

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneSocketId === null) {
                theOneSocketId = socket.id;
                socket.emit('roleAssigned', 'theOne');
                io.emit('roleStatus', { theOneTaken: true });
            } else return socket.emit('roleDenied', 'The One is already taken!');
        } else {
            socket.emit('roleAssigned', 'the100');
        }
        if (!gameStarted && theOneSocketId !== null) { gameStarted = true; startTimer(); }
    });

    socket.on('submitMove', (data) => {
        // Strict Turn & Role Enforcement
        if (chess.turn() === 'w' && socket.id !== theOneSocketId) return;
        if (chess.turn() === 'b' && socket.id === theOneSocketId) return;

        try {
            if (chess.turn() === 'w') {
                if (chess.move({ from: data.from, to: data.to, promotion: 'q' })) {
                    io.emit('gameState', chess.fen());
                    if (!checkAndBroadcastStatus()) startTimer();
                } else socket.emit('invalidMove');
            } else {
                // Crowd Voting Logic
                const moveStr = data.from + data.to;
                userVotes[socket.id] = moveStr;
                votes[moveStr] = (Object.values(userVotes).filter(v => v === moveStr)).length;
                io.emit('voteUpdate', votes);
            }
        } catch (e) { socket.emit('invalidMove'); }
    });

    socket.on('disconnect', () => {
        if (socket.id === theOneSocketId) { theOneSocketId = null; io.emit('roleStatus', { theOneTaken: false }); }
    });
});

http.listen(PORT, () => console.log(`Server running on ${PORT}`));