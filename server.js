const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 10000;
const chess = new Chess();

let votes = {};
let userVotes = {};
let resignVotes = new Set();
let theOneSocketId = null;
let gameStarted = false;
let activeConnections = 0;

const TURN_TIME_LIMIT = 30;
let turnEndTime = null;
let timerInterval = null;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const lastMessageTime = new Map();


io.on('connection', (socket) => {
    activeConnections++;

    console.log(`🔌 New WebSocket connection: ${socket.id}`);
    console.log(`👥 Active connections: ${activeConnections}`);

    // Initial State Broadcasts
    socket.emit('gameState', chess.fen());
    socket.emit('voteUpdate', votes);
    socket.emit('roleStatus', { theOneTaken: theOneSocketId !== null });

    // Chat Logic
    socket.on('sendChatMessage', (message) => {
        const now = Date.now();
        const lastTime = lastMessageTime.get(socket.id) || 0;
        const cooldown = 2000;

        if (now - lastTime < cooldown) {
            socket.emit('broadcastChatMessage', {
                role: 'Game System',
                message: 'Slow down! Please wait a moment before sending another message.'
            });
            return;
        }

        lastMessageTime.set(socket.id, now);
        let senderRole = (socket.id === theOneSocketId) ? 'The One' : 'The 100';
        io.emit('broadcastChatMessage', { role: senderRole, message: message });
    });

    // Role Claiming
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

    // Move Submission
    
socket.on('submitMove', (moveData) => {
    console.log(`♟ Move from ${socket.id}:`, moveData);

        if (chess.turn() === 'w') {
            if (socket.id !== theOneSocketId) return socket.emit('invalidRoleAction', "Not your turn!");
            
            try {
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
            } catch (error) {
                socket.emit('invalidMove');
            }
        } else {
            if (socket.id === theOneSocketId) return socket.emit('invalidRoleAction', "You cannot vote!");
            
            try {
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
            } catch (error) {
                socket.emit('invalidMove');
            }
        }
    });

    // Resignation
    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) endGame("The One has resigned! Black wins.");
        else {
            resignVotes.add(socket.id);
            const threshold = Math.ceil(io.engine.clientsCount * 0.51);
            io.emit('resignProgress', { count: resignVotes.size, needed: threshold });
            if (resignVotes.size >= threshold) endGame("The 100 have voted to resign! White wins.");
        }
    });

    // Restart
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

    // Disconnect
    socket.on('disconnect', (reason) => {
    activeConnections--;

    console.log(`❌ Disconnected: ${socket.id} (${reason})`);
    console.log(`👥 Active connections: ${activeConnections}`);

    lastMessageTime.delete(socket.id);
    if (socket.id === theOneSocketId) {
        theOneSocketId = null;
        io.emit('roleStatus', { theOneTaken: false });
    }
    delete userVotes[socket.id];
    resignVotes.delete(socket.id);
});
});

// Helper Functions
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
    turnEndTime = Date.now() + (TURN_TIME_LIMIT * 1000);
    io.emit('timerStarted', turnEndTime);
    timerInterval = setInterval(() => {
        if (Date.now() >= turnEndTime) handleTurnTimeout();
    }, 500);
}

function handleTurnTimeout() {
    clearInterval(timerInterval);
    if (io.engine.clientsCount === 0) { gameStarted = false; return; }
    
    if (chess.turn() === 'b') {
        if (Object.keys(votes).length > 0) {
            const winningMoveStr = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
            try { chess.move({ from: winningMoveStr.substring(0, 2), to: winningMoveStr.substring(2, 4), promotion: 'q' }); } 
            catch (e) { const moves = chess.moves({ verbose: true }); if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]); }
        } else {
            const moves = chess.moves({ verbose: true });
            if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
        }
    } else {
        const moves = chess.moves({ verbose: true });
        if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
    }
    
    votes = {}; userVotes = {};
    io.emit('voteUpdate', votes);
    const isOver = checkAndBroadcastStatus();
    io.emit('gameState', chess.fen());
    if (!isOver && !chess.isGameOver()) {
        startTimer();
}

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));