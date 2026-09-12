const socket = io();

const DEFAULT_QUESTIONS = `What is the capital of France? | London | Paris | Berlin | Madrid | 1
Which planet is known as the Red Planet? | Venus | Mars | Jupiter | Saturn | 1
Who painted the Mona Lisa? | Van Gogh | Picasso | Leonardo da Vinci | Michelangelo | 2
What is the largest ocean on Earth? | Atlantic | Indian | Arctic | Pacific | 3
How many continents are there? | 5 | 6 | 7 | 8 | 2
What is the chemical symbol for gold? | Go | Gd | Au | Ag | 2
Which country invented tea? | India | China | Japan | England | 1
What is the fastest land animal? | Lion | Cheetah | Leopard | Tiger | 1
How many sides does a hexagon have? | 5 | 6 | 7 | 8 | 1
What is the smallest prime number? | 0 | 1 | 2 | 3 | 2`;

function parseQuestions(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 6) throw new Error('Invalid line: ' + line);
    const [q, a, b, c, d, correct] = parts;
    const idx = parseInt(correct, 10);
    if (isNaN(idx) || idx < 0 || idx > 3) throw new Error('Correct index must be 0-3: ' + line);
    out.push({ q, options: [a, b, c, d], answer: idx });
  }
  if (!out.length) throw new Error('No questions');
  return out;
}

const setupView = document.getElementById('setupView');
const lobbyView = document.getElementById('lobbyView');
const questionView = document.getElementById('questionView');
const revealView = document.getElementById('revealView');

function show(v) {
  [setupView, lobbyView, questionView, revealView].forEach(x => x.classList.add('hidden'));
  v.classList.remove('hidden');
}

document.getElementById('questions').value = DEFAULT_QUESTIONS;

let currentQuestion = null;
let questionCount = 0;

document.getElementById('createBtn').onclick = () => {
  const title = document.getElementById('title').value.trim() || 'Live Trivia';
  let questions;
  try { questions = parseQuestions(document.getElementById('questions').value); }
  catch (e) { document.getElementById('setupError').textContent = e.message; return; }
  document.getElementById('setupError').textContent = '';
  questionCount = questions.length;

  socket.emit('createGame', { title, questions }, (res) => {
    if (res.error) { document.getElementById('setupError').textContent = res.error; return; }
    document.getElementById('gameCode').textContent = res.code;
    const joinUrl = `${location.origin}/play.html?code=${res.code}`;
    document.getElementById('joinUrl').textContent = joinUrl;
    document.getElementById('qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`;
    show(lobbyView);
  });
};

socket.on('playerList', ({ players, count }) => {
  document.getElementById('playerCount').textContent = count;
  document.getElementById('playerList').innerHTML = players
    .map(p => `<div class="player-chip">${escapeHtml(p.name)}</div>`).join('');
  document.getElementById('startBtn').disabled = count === 0;
});

document.getElementById('startBtn').onclick = () => socket.emit('startGame');
document.getElementById('revealBtn').onclick = () => socket.emit('revealNow');

socket.on('question', (data) => {
  currentQuestion = data;
  document.getElementById('qProgress').textContent = `Question ${data.index + 1} / ${data.total}`;
  document.getElementById('questionText').textContent = data.question;
  document.getElementById('answerCount').textContent = `0 / ?`;
  document.getElementById('optionsHost').innerHTML = data.options
    .map((o, i) => `<div class="option">${String.fromCharCode(65 + i)}. ${escapeHtml(o)}</div>`).join('');

  const timerEl = document.getElementById('hostTimer');
  let t = data.timeLimit;
  timerEl.textContent = t;
  clearInterval(window._hostTimerIv);
  window._hostTimerIv = setInterval(() => {
    t--;
    timerEl.textContent = Math.max(0, t);
    if (t <= 0) clearInterval(window._hostTimerIv);
  }, 1000);

  show(questionView);
});

socket.on('answerCount', ({ count, total }) => {
  document.getElementById('answerCount').textContent = `${count} / ${total}`;
});

socket.on('reveal', ({ correctIndex, counts, correctCount, totalPlayers, leaderboard }) => {
  clearInterval(window._hostTimerIv);
  document.getElementById('revealTitle').textContent =
    `Correct: ${String.fromCharCode(65 + correctIndex)} — ${correctCount}/${totalPlayers} correct`;
  document.getElementById('revealOptions').innerHTML = currentQuestion.options.map((o, i) => {
    const cls = i === correctIndex ? 'option correct' : 'option';
    const c = counts[i] || 0;
    return `<div class="${cls}">${String.fromCharCode(65 + i)}. ${escapeHtml(o)} <span class="count">${c}</span></div>`;
  }).join('');
  renderLeaderboard('leaderboard', leaderboard);
  const isLast = currentQuestion.index + 1 >= currentQuestion.total;
  document.getElementById('continueBtn').textContent = isLast ? 'Finish Game' : 'Next Question';
  show(revealView);
});

document.getElementById('continueBtn').onclick = () => socket.emit('nextQuestion');

socket.on('gameEnded', ({ leaderboard }) => {
  document.getElementById('revealTitle').textContent = '🏆 Final Results';
  document.getElementById('revealOptions').innerHTML = '';
  renderLeaderboard('leaderboard', leaderboard);
  document.getElementById('continueBtn').style.display = 'none';
  show(revealView);
});

function renderLeaderboard(elId, lb) {
  document.getElementById(elId).innerHTML = lb.slice(0, 50).map((p, i) =>
    `<div class="lb-row"><span class="rank">${i + 1}</span><span class="name">${escapeHtml(p.name)}</span><span class="score">${p.score}</span></div>`
  ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}