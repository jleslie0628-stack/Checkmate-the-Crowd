const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

let votes = {};
let userVotes = {};
let resignVotes = new Set();
let theOneSocketId = null;
let gameStarted = false;

const TURN_TIME_LIMIT = 30;
let timeRemaining = TURN_TIME_LIMIT;
let timerInterval = null;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Referee Status Checker
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
    
    if (chess.turn() === 'b') {
        if (Object.keys(votes).length > 0) {
            const winningMoveStr = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
            chess.move({ from: winningMoveStr.substring(0, 2), to: winningMoveStr.substring(2, 4), promotion: 'q' });
        } else {
            const moves = chess.moves({ verbose: true });
            if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
        }
    } else {
        const moves = chess.moves({ verbose: true });
        if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
    }

    votes = {}; 
    userVotes = {};
    io.emit('voteUpdate', votes);
    
    const isOver = checkAndBroadcastStatus();
    io.emit('gameState', chess.fen());
    
    if (!isOver && !chess.isGameOver()) {
        startTimer();
    }
}

io.on('connection', (socket) => {
    socket.emit('gameState', chess.fen());
    socket.emit('voteUpdate', votes);
    socket.emit('roleStatus', { theOneTaken: theOneSocketId !== null });

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneSocketId === null) {
                theOneSocketId = socket.id;
                socket.emit('roleAssigned', 'theOne');
                io.emit('roleStatus', { theOneTaken: true });
            } else socket.emit('roleDenied', 'The One position is already taken!');
        } else {
            socket.emit('roleAssigned', 'the100');
        }

        if (!gameStarted && theOneSocketId !== null) { 
            gameStarted = true; 
            startTimer(); 
        }
    });

    socket.on('sendChatMessage', (text) => {
        let senderRole = (socket.id === theOneSocketId) ? 'The One' : 'The 100';
        io.emit('broadcastChatMessage', { role: senderRole, message: text });
    });

    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) endGame("The One has resigned! Black wins.");
        else {
            resignVotes.add(socket.id);
            const threshold = Math.ceil(io.engine.clientsCount * 0.51);
            io.emit('resignProgress', { count: resignVotes.size, needed: threshold });
            if (resignVotes.size >= threshold) endGame("The 100 have voted to resign! White wins.");
        }
    });

    socket.on('restartGame', () => {
        chess.reset(); 
        votes = {}; 
        userVotes = {}; 
        resignVotes.clear();
        gameStarted = true;
        io.emit('gameState', chess.fen());
        io.emit('voteUpdate', votes);
        io.emit('broadcastChatMessage', { role: 'Game System', message: "Game restarted! Good luck." });
        startTimer();
    });

    socket.on('submitMove', (moveData) => {
        if (chess.turn() === 'w') {
            if (socket.id !== theOneSocketId) return socket.emit('invalidRoleAction', "Not your turn!");
            
            const move = chess.move({ from: moveData.from, to: moveData.to, promotion: 'q' });
            if (move) {
                votes = {}; 
                userVotes = {};
                io.emit('gameState', chess.fen());
                io.emit('voteUpdate', votes);
                
                const isOver = checkAndBroadcastStatus();
                if (!isOver && !chess.isGameOver()) startTimer();
            } else {
                socket.emit('invalidMove');
            }
        } else {
            if (socket.id === theOneSocketId) return socket.emit('invalidRoleAction', "You cannot vote!");
            
            const tempChess = new Chess(chess.fen());
            if (tempChess.move({ from: moveData.from, to: moveData.to, promotion: 'q' })) {
                const moveStr = moveData.from + moveData.to;
                if (userVotes[socket.id]) {
                    const oldMove = userVotes[socket.id].move;
                    if (votes[oldMove] > 0) votes[oldMove]--;
                }
                userVotes[socket.id] = { move: moveStr };
                votes[moveStr] = (votes[moveStr] || 0) + 1;
                io.emit('voteUpdate', votes);
            } else {
                socket.emit('invalidMove');
            }
        }
    });

    socket.on('disconnect', () => {
        if (socket.id === theOneSocketId) {
            theOneSocketId = null;
            io.emit('roleStatus', { theOneTaken: false });
        }
        delete userVotes[socket.id];
        resignVotes.delete(socket.id);
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));