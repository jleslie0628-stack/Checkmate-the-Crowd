const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

// State management
let votes = {};
let userVotes = {}; 
let theOneSocketId = null; 
let gameStarted = false; 

// Timer configuration
const TURN_TIME_LIMIT = 30; 
let timeRemaining = TURN_TIME_LIMIT;
let timerInterval = null;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Helper to check board status
function getGameStatus() {
    if (chess.isCheckmate()) return "CHECKMATE! " + (chess.turn() === 'w' ? "Black" : "White") + " wins!";
    if (chess.inCheck()) return "CHECK! (" + (chess.turn() === 'w' ? "White" : "Black") + " is in check)";
    return null;
}

function startTimer() {
    if (!gameStarted) return;
    
    clearInterval(timerInterval);
    timeRemaining = TURN_TIME_LIMIT;
    io.emit('timeUpdate', timeRemaining);

    timerInterval = setInterval(() => {
        timeRemaining--;
        io.emit('timeUpdate', timeRemaining);

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            handleTurnTimeout();
        }
    }, 1000);
}

function handleTurnTimeout() {
    if (io.engine.clientsCount === 0) {
        gameStarted = false;
        return;
    }

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

    // Announce status
    const status = getGameStatus();
    if (status) io.emit('broadcastChatMessage', { role: 'Game System', message: status });

    if (chess.isGameOver()) {
        gameStarted = false;
        io.emit('gameState', chess.fen());
    } else {
        votes = {};
        userVotes = {}; 
        io.emit('gameState', chess.fen());
        io.emit('voteUpdate', votes);
        startTimer();
    }
}

io.on('connection', (socket) => {
    socket.emit('gameState', chess.fen());
    socket.emit('voteUpdate', votes);
    socket.emit('timeUpdate', timeRemaining);
    socket.emit('roleStatus', { theOneTaken: theOneSocketId !== null });

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneSocketId === null) {
                theOneSocketId = socket.id;
                socket.emit('roleAssigned', 'theOne');
                io.emit('roleStatus', { theOneTaken: true });
            } else {
                socket.emit('roleDenied', 'The One position is already taken!');
            }
        } else {
            socket.emit('roleAssigned', 'the100');
        }

        if (!gameStarted) {
            gameStarted = true;
            startTimer();
        }
    });

    socket.on('sendChatMessage', (text) => {
        let senderRole = (socket.id === theOneSocketId) ? 'The One' : 'The 100';
        io.emit('broadcastChatMessage', { role: senderRole, message: text });
    });

    socket.on('submitMove', (moveData) => {
        if (chess.turn() === 'w') {
            if (socket.id !== theOneSocketId) return socket.emit('invalidRoleAction', "Not The One!");
            
            const move = chess.move({ from: moveData.from, to: moveData.to, promotion: 'q' });
            if (move) {
                const status = getGameStatus();
                if (status) io.emit('broadcastChatMessage', { role: 'Game System', message: status });
                
                if (chess.isGameOver()) {
                    gameStarted = false;
                } else {
                    votes = {}; userVotes = {};
                    startTimer();
                }
                io.emit('gameState', chess.fen());
                io.emit('voteUpdate', votes);
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
    });
});

http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});