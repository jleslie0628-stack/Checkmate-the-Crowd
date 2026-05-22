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
    const moves = chess.moves({ verbose: true });
    let move;

    if (Object.keys(votes).length > 0) {
        let topMove = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
        move = moves.find(m => (m.from + m.to) === topMove);
    }
    if (!move) move = moves[Math.floor(Math.random() * moves.length)];
    
    if (move) {
        chess.move(move);
        io.emit('gameState', chess.fen());
        
        if (chess.isGameOver()) {
            endGame("Game Over - Checkmate!");
        } else {
            votes = {}; 
            userVotes = {};
            io.emit('voteUpdate', votes);
            startTimer();
        }
    }
}

function endGame(message) {
    gameStarted = false;
    turnEndTime = null;
    io.emit('broadcastChatMessage', { role: 'Game System', message: message });
    io.emit('gameOver');
}

io.on('connection', (socket) => {
    socket.emit('gameState', chess.fen());
    socket.emit('timerSync', turnEndTime);
    socket.emit('roleStatus', { theOneTaken });

    socket.on('requestSync', () => {
        socket.emit('gameState', chess.fen());
        socket.emit('timerSync', turnEndTime);
    });

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneTaken) {
                socket.emit('roleDenied', 'The One is already playing on another device.');
                return;
            }
            theOneTaken = true;
            theOneSocketId = socket.id;
        }
        socket.emit('roleAssigned', role);
        io.emit('roleStatus', { theOneTaken });
        if (!gameStarted) { gameStarted = true; startTimer(); }
    });

    socket.on('sendChatMessage', (msg) => {
        let role = (socket.id === theOneSocketId) ? 'The One' : 'The 100';
        io.emit('broadcastChatMessage', { role, message: msg });
    });

    // Validated Move Handling for "The One"
    socket.on('submitMove', (data) => {
        if (socket.id === theOneSocketId) {
            const piece = chess.get(data.from);
            let moveAttempt = { from: data.from, to: data.to };
            
            // Only promote if it's a pawn reaching the end
            if (piece && piece.type === 'p' && (data.to[1] === '1' || data.to[1] === '8')) {
                moveAttempt.promotion = 'q';
            }

            const move = chess.move(moveAttempt);
            if (move) {
                io.emit('gameState', chess.fen());
                if (chess.isGameOver()) {
                    endGame("Game Over - Checkmate!");
                } else {
                    startTimer();
                }
            }
        }
    });

    // Crowd Voting Logic
    socket.on('submitVote', (move) => {
        if (socket.id === theOneSocketId) return; 
        userVotes[socket.id] = move;
        votes = {};
        for (let user in userVotes) {
            let m = userVotes[user];
            votes[m] = (votes[m] || 0) + 1;
        }
        io.emit('voteUpdate', votes);
    });

    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) {
            endGame("The One resigned.");
        } else {
            resignVotes.add(socket.id);
            if (resignVotes.size >= Math.ceil(io.engine.clientsCount * 0.51)) {
                endGame("Crowd resigned.");
            }
        }
    });

    socket.on('disconnect', () => {
        if (socket.id === theOneSocketId) {
            theOneTaken = false;
            theOneSocketId = null;
            io.emit('roleStatus', { theOneTaken });
        }
    });
});

http.listen(PORT, () => console.log(`Server running on ${PORT}`));