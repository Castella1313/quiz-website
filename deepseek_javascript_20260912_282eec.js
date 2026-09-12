const socket = io();

let playerId = localStorage.getItem('triviaPlayerId');
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('triviaPlayerId', playerId);
}

const joinView = document.getElementById('joinView');
const lobbyView = document.getElementById('lobbyView');
const questionView = document.getElementById('questionView');
const revealView = document.getElementById('revealView');
const endView = document.getElementById('endView');

function show(v) {
  [joinView, lobbyView, questionView, revealView, endView].forEach(x => x.classList.add('hidden'));
  v.classList.remove('hidden');
}

const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) document.getElementById('code').value = urlCode;
const savedName = localStorage.getItem('triviaName');
if (savedName) document.getElementById('name').value = savedName;

let currentGameCode = null;
let currentPlayerName = null;
let hasJoinedOnce = false;
let answered = false;

document.getElementById('joinBtn').onclick = () => {
  const code = document.getElementById('code').value.trim();
  const name = document.getElementById('name').value.trim();
  if (!code || !name) { document.getElementById('joinError').textContent = 'Enter code and name'; return; }
  localStorage.setItem('triviaName', name);
  currentGameCode = code;
  currentPlayerName = name;

  socket.emit('joinGame', { code, name, playerId }, (res) => {
    if (res.error) { document.getElementById('joinError').textContent = res.error; return; }
    hasJoinedOnce = true;
    document.getElementById('lobbyCode').textContent = code;
    handleState(res);
  });
};

socket.on('connect', () => {
  if (hasJoinedOnce && currentGameCode && currentPlayerName) {
    socket.emit('joinGame', { code: currentGameCode, name: currentPlayerName, playerId }, () => {});
  }
});

function handleState(res) {
  if (res.state === 'lobby') show(lobbyView);
  else if (res.state === 'question' && res.question) { renderQuestion(res.question); show(questionView); }
  else if (res.state === 'reveal' && res.reveal) { renderReveal(res.reveal); show(revealView); }
  else if (res.state === 'ended') { renderLeaderboard('pFinalLeaderboard', res.leaderboard); show(endView); }
}

socket.on('question', (data) => {
  answered = false;
  renderQuestion(data);
  show(questionView);
});

function renderQuestion(data) {
  document.getElementById('pProgress').textContent = `Q ${data.index + 1}/${data.total}`;
  document.getElementById('pQuestion').textContent = data.question;
  document.getElementById('pResult').textContent = '';
  const opts = document.getElementById('pOptions');
  opts.innerHTML = data.options.map((o, i) =>
    `<button class="option-btn" data-i="${i}">${escapeHtml(o)}</button>`).join('');

  opts.querySelectorAll('.option-btn').forEach(btn => {
    btn.onclick = () => {
      if (answered) return;
      answered = true;
      const i = parseInt(btn.dataset.i, 10);
      opts.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
      btn.classList.add('selected');
      socket.emit('submitAnswer', { optionIndex: i });
    };
  });

  let t = data.timeLimit;
  const timerEl = document.getElementById('pTimer');
  timerEl.textContent = t;
  clearInterval(window._pTimerIv);
  window._pTimerIv = setInterval(() => {
    t--;
    timerEl.textContent = Math.max(0, t);
    if (t <= 0) clearInterval(window._pTimerIv);
  }, 1000);
}

socket.on('answerResult', ({ correct, points, total }) => {
  document.getElementById('pScore').textContent = total;
  const el = document.getElementById('pResult');
  if (correct) { el.textContent = `✅ Correct! +${points}`; el.style.color = '#22c55e'; }
  else { el.textContent = `❌ Wrong`; el.style.color = '#ef4444'; }
});

socket.on('reveal', ({ correctIndex, leaderboard }) => {
  renderReveal({ correctIndex, leaderboard });
  show(revealView);
});

function renderReveal({ correctIndex, leaderboard }) {
  document.getElementById('pRevealTitle').textContent = `Correct answer: ${String.fromCharCode(65 + correctIndex)}`;
  renderLeaderboard('pLeaderboard', leaderboard);
}

socket.on('gameEnded', ({ leaderboard }) => {
  renderLeaderboard('pFinalLeaderboard', leaderboard);
  show(endView);
});

function renderLeaderboard(elId, lb) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = lb.slice(0, 50).map((p, i) =>
    `<div class="lb-row"><span class="rank">${i + 1}</span><span class="name">${escapeHtml(p.name)}</span><span class="score">${p.score}</span></div>`
  ).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}