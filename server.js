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
let gameStarted = false; // Prevents game from running when empty

// Timer configuration
const TURN_TIME_LIMIT = 30; 
let timeRemaining = TURN_TIME_LIMIT;
let timerInterval = null;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

function startTimer() {
    if (!gameStarted) return; // Wait for first player
    
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
    // Stop the game if no one is connected
    if (io.engine.clientsCount === 0) {
        gameStarted = false;
        return;
    }

    if (chess.turn() === 'b') {
        if (Object.keys(votes).length > 0) {
            const winningMoveStr = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
            const fromSquare = winningMoveStr.substring(0, 2);
            const toSquare = winningMoveStr.substring(2, 4);
            try {
                chess.move({ from: fromSquare, to: toSquare, promotion: 'q' });
            } catch (e) {
                console.log("Failed to execute winning vote.");
            }
        } else {
            const moves = chess.moves({ verbose: true });
            if (moves.length > 0) {
                const randomMove = moves[Math.floor(Math.random() * moves.length)];
                chess.move({ from: randomMove.from, to: randomMove.to, promotion: 'q' });
            }
        }
    } else {
        const moves = chess.moves({ verbose: true });
        if (moves.length > 0) {
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            chess.move({ from: randomMove.from, to: randomMove.to, promotion: 'q' });
        }
    }

    votes = {};
    userVotes = {}; 
    io.emit('gameState', chess.fen());
    io.emit('voteUpdate', votes);
    startTimer();
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

        // Trigger game start on first join
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
        const moveStr = moveData.from + moveData.to;

        if (chess.turn() === 'w') {
            if (socket.id !== theOneSocketId) {
                socket.emit('invalidRoleAction', "It is White's turn, but you are not 'The One'!");
                return;
            }
            try {
                const move = chess.move({ from: moveData.from, to: moveData.to, promotion: 'q' });
                if (move) {
                    votes = {};
                    userVotes = {};
                    io.emit('gameState', chess.fen());
                    io.emit('voteUpdate', votes);
                    startTimer(); 
                } else {
                    socket.emit('invalidMove');
                }
            } catch (error) {
                socket.emit('invalidMove');
            }
        } else {
            if (socket.id === theOneSocketId) {
                socket.emit('invalidRoleAction', "You are 'The One'. You cannot vote!");
                return;
            }
            try {
                const tempChess = new Chess(chess.fen());
                const isValid = tempChess.move({ from: moveData.from, to: moveData.to, promotion: 'q' });

                if (isValid) {
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