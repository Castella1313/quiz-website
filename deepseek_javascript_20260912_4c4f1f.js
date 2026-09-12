const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
const QUESTION_TIME = 20;   // seconds
const MAX_POINTS = 1000;
const MIN_POINTS = 100;

const games = new Map();

function generateCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (games.has(code));
  return code;
}

function publicLeaderboard(game) {
  return [...game.players.values()]
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function clearTimer(game) {
  if (game.timerHandle) {
    clearTimeout(game.timerHandle);
    game.timerHandle = null;
  }
}

function sendQuestion(game) {
  const q = game.questions[game.currentQ];
  game.state = 'question';
  game.questionStartTime = Date.now();
  game.answerCount = 0;

  for (const p of game.players.values()) {
    p.answered = false;
    p.lastAnswer = null;
  }

  io.to(game.code).emit('question', {
    index: game.currentQ,
    total: game.questions.length,
    question: q.q,
    options: q.options,
    timeLimit: QUESTION_TIME
  });

  clearTimer(game);
  game.timerHandle = setTimeout(() => revealAnswer(game), QUESTION_TIME * 1000 + 800);
}

function revealAnswer(game) {
  if (game.state !== 'question') return;
  clearTimer(game);
  const q = game.questions[game.currentQ];
  game.state = 'reveal';

  const counts = q.options.map(() => 0);
  let correctCount = 0;
  for (const p of game.players.values()) {
    if (p.lastAnswer !== null && p.lastAnswer !== undefined) {
      counts[p.lastAnswer] = (counts[p.lastAnswer] || 0) + 1;
      if (p.lastAnswer === q.answer) correctCount++;
    }
  }

  io.to(game.code).emit('reveal', {
    correctIndex: q.answer,
    counts,
    correctCount,
    totalPlayers: game.players.size,
    leaderboard: publicLeaderboard(game)
  });
}

io.on('connection', (socket) => {
  socket.on('createGame', ({ title, questions }, cb) => {
    try {
      if (!Array.isArray(questions) || questions.length === 0) {
        return cb({ error: 'No questions provided' });
      }
      const code = generateCode();
      const game = {
        code,
        title: title || 'Live Trivia',
        hostSocketId: socket.id,
        players: new Map(),
        questions,
        currentQ: -1,
        state: 'lobby',
        questionStartTime: 0,
        timerHandle: null,
        answerCount: 0
      };
      games.set(code, game);
      socket.join(code);
      socket.data.gameCode = code;
      socket.data.isHost = true;
      console.log(`Game created: ${code} (${questions.length} questions)`);
      cb({ code });
    } catch (e) {
      console.error(e);
      cb({ error: 'Failed to create game' });
    }
  });

  socket.on('joinGame', ({ code, name, playerId }, cb) => {
    const game = games.get(String(code));
    if (!game) return cb({ error: 'Game not found. Check the code.' });
    if (!name || !name.trim()) return cb({ error: 'Enter your name' });

    const pid = playerId || socket.id;
    let player = game.players.get(pid);
    if (!player) {
      player = { name: name.trim().slice(0, 20), score: 0, socketId: socket.id, answered: false, lastAnswer: null };
      game.players.set(pid, player);
      console.log(`+ ${player.name} joined ${game.code} (total ${game.players.size})`);
    } else {
      player.socketId = socket.id;
      player.name = name.trim().slice(0, 20);
    }

    socket.join(game.code);
    socket.data.gameCode = game.code;
    socket.data.playerId = pid;
    socket.data.isHost = false;

    io.to(game.hostSocketId).emit('playerList', {
      players: [...game.players.values()].map(p => ({ name: p.name, score: p.score })),
      count: game.players.size
    });

    const payload = { ok: true, state: game.state, title: game.title, name: player.name, score: player.score };
    if (game.state === 'question') {
      const q = game.questions[game.currentQ];
      payload.question = {
        index: game.currentQ,
        total: game.questions.length,
        question: q.q,
        options: q.options,
        timeLimit: QUESTION_TIME
      };
    } else if (game.state === 'reveal') {
      const q = game.questions[game.currentQ];
      payload.reveal = { correctIndex: q.answer, leaderboard: publicLeaderboard(game) };
    } else if (game.state === 'ended') {
      payload.leaderboard = publicLeaderboard(game);
    }
    cb(payload);
  });

  socket.on('startGame', () => {
    const game = games.get(socket.data.gameCode);
    if (!game || game.hostSocketId !== socket.id) return;
    if (game.players.size === 0) return;
    game.currentQ = 0;
    sendQuestion(game);
  });

  socket.on('revealNow', () => {
    const game = games.get(socket.data.gameCode);
    if (!game || game.hostSocketId !== socket.id) return;
    revealAnswer(game);
  });

  socket.on('nextQuestion', () => {
    const game = games.get(socket.data.gameCode);
    if (!game || game.hostSocketId !== socket.id) return;
    if (game.currentQ + 1 >= game.questions.length) {
      game.state = 'ended';
      clearTimer(game);
      io.to(game.code).emit('gameEnded', { leaderboard: publicLeaderboard(game) });
      return;
    }
    game.currentQ++;
    sendQuestion(game);
  });

  socket.on('submitAnswer', ({ optionIndex }) => {
    const game = games.get(socket.data.gameCode);
    if (!game || game.state !== 'question') return;
    const player = game.players.get(socket.data.playerId);
    if (!player || player.answered) return;

    player.answered = true;
    player.lastAnswer = optionIndex;
    game.answerCount++;

    const q = game.questions[game.currentQ];
    if (optionIndex === q.answer) {
      const elapsed = (Date.now() - game.questionStartTime) / 1000;
      const timeLeft = Math.max(0, QUESTION_TIME - elapsed);
      const points = Math.max(MIN_POINTS, Math.round(MAX_POINTS * (timeLeft / QUESTION_TIME)));
      player.score += points;
      socket.emit('answerResult', { correct: true, points, total: player.score });
    } else {
      socket.emit('answerResult', { correct: false, points: 0, total: player.score });
    }

    io.to(game.hostSocketId).emit('answerCount', {
      count: game.answerCount,
      total: game.players.size
    });

    if (game.answerCount >= game.players.size && game.players.size > 0) {
      revealAnswer(game);
    }
  });

  socket.on('endGame', () => {
    const game = games.get(socket.data.gameCode);
    if (!game || game.hostSocketId !== socket.id) return;
    game.state = 'ended';
    clearTimer(game);
    io.to(game.code).emit('gameEnded', { leaderboard: publicLeaderboard(game) });
  });

  socket.on('disconnect', () => {
    const code = socket.data.gameCode;
    if (!code) return;
    const game = games.get(code);
    if (!game) return;
    if (socket.data.isHost) console.log(`Host disconnected from ${code}`);
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));