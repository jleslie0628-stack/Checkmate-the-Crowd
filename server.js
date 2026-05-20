const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

const PORT = process.env.PORT || 3000;
const chess = new Chess();

let votes = {};
let userVotes = {};
let resignVotes = new Set(); // Tracks unique voters for resignation
let theOneSocketId = null;
let gameStarted = false;

const TURN_TIME_LIMIT = 30;
let timeRemaining = TURN_TIME_LIMIT;
let timerInterval = null;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

function getGameStatus() {
    if (chess.isCheckmate()) return "CHECKMATE! " + (chess.turn() === 'w' ? "Black" : "White") + " wins!";
    if (chess.inCheck()) return "CHECK! (" + (chess.turn() === 'w' ? "White" : "Black") + " is in check)";
    return null;
}

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

    const status = getGameStatus();
    if (status) io.emit('broadcastChatMessage', { role: 'Game System', message: status });

    if (chess.isGameOver()) {
        endGame(status || "Game Over");
    } else {
        votes = {}; userVotes = {};
        io.emit('gameState', chess.fen());
        io.emit('voteUpdate', votes);
        startTimer();
    }
}

io.on('connection', (socket) => {
    socket.emit('gameState', (fen) => {
	document.getElementById('restartBtn').style.display = 'none';
	document.getElementById('resignStatus').innerText = '';

	//Ensure board exists before updating
	if (board) {
	   board.position(fen);
	}
    });

    socket.emit('voteUpdate', votes);
    socket.emit('timeUpdate', timeRemaining);
    socket.emit('roleStatus', { theOneTaken: theOneSocketId !== null });

    socket.on('claimRole', (role) => {
        if (role === 'theOne') {
            if (theOneSocketId === null) {
                theOneSocketId = socket.id;
                socket.emit('roleAssigned', 'theOne');
                io.emit('roleStatus', { theOneTaken: true });
            } else socket.emit('roleDenied', 'The One position is already taken!');
        } else socket.emit('roleAssigned', 'the100');

        if (!gameStarted) {
            gameStarted = true;
            startTimer();
        }
    });

    socket.on('voteResign', () => {
        if (socket.id === theOneSocketId) {
            endGame("The One has resigned! Black wins.");
        } else {
            resignVotes.add(socket.id);
            const threshold = Math.ceil(io.engine.clientsCount * 0.51);
            io.emit('resignProgress', { count: resignVotes.size, needed: threshold });
            if (resignVotes.size >= threshold) {
                endGame("The 100 have voted to resign! White wins.");
            }
        }
    });

    socket.on('restartGame', () => {
        chess.reset();
        votes = {}; userVotes = {}; resignVotes.clear();
        gameStarted = true;
        io.emit('gameState', chess.fen());
        io.emit('voteUpdate', votes);
        io.emit('broadcastChatMessage', { role: 'Game System', message: "Game restarted!" });
        startTimer();
    });

    socket.on('submitMove', (moveData) => {
        // ... (existing move logic here)
        // Ensure you call getGameStatus() and check chess.isGameOver() here too!
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

http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
