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
            try {
                chess.move({ from: winningMoveStr.substring(0, 2), to: winningMoveStr.substring(2, 4), promotion: 'q' });
            } catch (e) {
                // Fallback to random if the highest voted move somehow became illegal
                const moves = chess.moves({ verbose: true });
                if (moves.length > 0) chess.move(moves[Math.floor(Math.random() * moves.length)]);
            }
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
    io.emit('voteUpdate',