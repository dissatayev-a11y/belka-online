// =============================================
// БЕЛКА ОНЛАЙН — PeerJS мультиплеер + боты
// =============================================

const suitsMap = { "♣":"C", "♥":"H", "♠":"S", "♦":"D" };
const suits = ["♣","♥","♠","♦"];
const ranks = ["7","8","9","Д","К","10","Т","В"];

const pointsMap = { "Т":11, "10":10, "К":4, "Д":3, "В":2 };
const rankPower = { "7":1,"8":2,"9":3,"Д":4,"К":5,"10":6,"Т":7,"В":8 };

// =============================================
// ИГРОВОЕ СОСТОЯНИЕ
// =============================================

let state = {
  trump: null,
  hands: [[],[],[],[]],
  table: [],
  turn: 0,
  scores: [0, 0],
  started: false,
  gameOver: false
};

let myIndex = 0;
let isHost = false;
let peers = [];
let peer = null;
let roomCode = null;
let playerCount = 1;
let botSlots = [];

let ysdk = null;
let playerData = { rating: 1000, coins: 0, lastLogin: null };

// =============================================
// ЯНДЕКС SDK
// =============================================

if (typeof YaGames !== "undefined") {
  YaGames.init().then(sdk => {
    ysdk = sdk;
    sdk.getPlayer().then(p => p.getData()).then(data => {
      if (data && Object.keys(data).length > 0) playerData = { ...playerData, ...data };
      checkDailyBonus();
      updateUI();
    }).catch(() => { checkDailyBonus(); updateUI(); });
  }).catch(() => { checkDailyBonus(); updateUI(); });
} else {
  checkDailyBonus();
  updateUI();
}

// =============================================
// PEERJS
// =============================================

function initPeer(id, onOpen) {
  if (peer) { peer.destroy(); peer = null; }

  peer = new Peer(id, {
    host: "0.peerjs.com",
    port: 443,
    secure: true,
    path: "/"
  });

  peer.on("open", (myId) => {
    console.log("PeerJS ID:", myId);
    if (onOpen) onOpen(myId);
  });

  peer.on("error", (err) => {
    console.error("PeerJS:", err);
    if (err.type === "unavailable-id") {
      showStatus("Код занят, попробуйте другой");
    } else {
      showStatus("Ошибка соединения: " + err.type);
    }
  });

  peer.on("connection", (conn) => {
    if (!isHost) return;
    if (playerCount >= 4) {
      conn.on("open", () => conn.send({ type: "error", message: "Комната заполнена" }));
      return;
    }
    const slot = playerCount;
    setupHostConn(conn, slot);
  });
}

function setupHostConn(conn, slot) {
  conn.on("open", () => {
    peers[slot] = conn;
    playerCount++;

    conn.send({ type: "yourIndex", index: slot });
    broadcastToAll({ type: "playerCount", count: playerCount });
    showStatus("Игроков: " + playerCount + " / 4. " +
      (playerCount < 4 ? 'Ожидаем или нажмите "Начать с ботами"' : "Начинаем!"));

    if (playerCount === 4) {
      setTimeout(startGameAsHost, 500);
    }
  });

  conn.on("data", (data) => {
    if (data.type === "play") {
      processPlay(data.playerIndex, data.card);
    }
  });

  conn.on("close", () => {
    peers[slot] = null;
    playerCount--;
    showStatus("Игрок отключился");
  });
}

// =============================================
// КНОПКИ МЕНЮ
// =============================================

function quickGame() {
  showStatus("Создаём игру с ботами...");
  isHost = true;
  myIndex = 0;
  botSlots = [1, 2, 3];
  playerCount = 4;
  peers = [null, null, null, null];

  const code = "Q" + Math.random().toString(36).substr(2,4).toUpperCase();
  roomCode = code;

  initPeer("belka-" + code + "-0", () => {
    setTimeout(startGameAsHost, 300);
  });
}

function createRoom() {
  isHost = true;
  myIndex = 0;
  playerCount = 1;
  botSlots = [];
  peers = [null, null, null, null];

  const code = Math.random().toString(36).substr(2,5).toUpperCase();
  roomCode = code;

  initPeer("belka-" + code + "-0", () => {
    const display = document.getElementById("roomCodeDisplay");
    if (display) {
      display.innerText = "Код комнаты: " + code;
      display.style.display = "block";
    }
    showStatus("Ожидаем игроков... (1/4)");

    // Показываем кнопку "Начать с ботами"
    const btn = document.getElementById("startWithBots");
    if (btn) btn.style.display = "inline-block";
  });
}

function joinRoom() {
  const code = prompt("Введи код комнаты:");
  if (!code) return;

  isHost = false;
  roomCode = code.trim().toUpperCase();
  peers = [];

  const mySlot = "C" + Date.now().toString(36).substr(-4);
  showStatus("Подключаемся...");

  initPeer("belka-" + roomCode + "-" + mySlot, () => {
    const hostConn = peer.connect("belka-" + roomCode + "-0", { reliable: true });

    hostConn.on("open", () => {
      peers[0] = hostConn;
      showStatus("Подключились! Ожидаем начала...");
    });

    hostConn.on("data", (data) => {
      if (data.type === "yourIndex") {
        myIndex = data.index;
        showStatus("Вы игрок " + (myIndex + 1) + ". Ожидаем...");
      }
      if (data.type === "playerCount") {
        showStatus("Игроков: " + data.count + " / 4");
      }
      if (data.type === "gameState") {
        applyState(data.state);
      }
      if (data.type === "error") {
        showStatus(data.message);
      }
    });

    hostConn.on("close", () => showStatus("Соединение с хостом потеряно"));
    hostConn.on("error", () => showStatus("Не удалось подключиться. Проверьте код."));
  });
}

function startWithBots() {
  if (!isHost) return;
  for (let i = 1; i < 4; i++) {
    if (!peers[i] || !peers[i].open) {
      botSlots.push(i);
    }
  }
  playerCount = 4;

  const btn = document.getElementById("startWithBots");
  if (btn) btn.style.display = "none";

  startGameAsHost();
}

// =============================================
// ИГРОВАЯ ЛОГИКА (только хост)
// =============================================

function createDeck() {
  let deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({suit:s, rank:r})));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function isTrump(card, trump) {
  return card.rank === "В" || card.suit === trump;
}

function compare(a, b, leadSuit, trump) {
  if (isTrump(a, trump) && !isTrump(b, trump)) return 1;
  if (!isTrump(a, trump) && isTrump(b, trump)) return -1;
  if (a.suit === b.suit) return rankPower[a.rank] - rankPower[b.rank];
  if (a.suit === leadSuit) return 1;
  if (b.suit === leadSuit) return -1;
  return 0;
}

function startGameAsHost() {
  const deck = createDeck();

  state = {
    trump: suits[Math.floor(Math.random() * 4)],
    hands: [],
    table: [],
    turn: 0,
    scores: [0, 0],
    started: true,
    gameOver: false
  };

  for (let i = 0; i < 4; i++) {
    state.hands[i] = deck.slice(i * 8, i * 8 + 8);
  }

  showStatus("");
  const display = document.getElementById("roomCodeDisplay");
  if (display) display.style.display = "none";

  broadcastState();
  scheduleBotMove();
}

function processPlay(playerIndex, card) {
  if (!isHost) return;
  if (playerIndex !== state.turn) return;
  if (state.gameOver) return;

  const before = state.hands[playerIndex].length;
  state.hands[playerIndex] = state.hands[playerIndex].filter(
    c => !(c.rank === card.rank && c.suit === card.suit)
  );
  if (state.hands[playerIndex].length === before) return;

  state.table.push({ playerIndex, card });
  state.turn = (state.turn + 1) % 4;

  if (state.table.length === 4) {
    broadcastState();
    setTimeout(() => {
      resolveTrick();
      broadcastState();
      if (!state.gameOver) scheduleBotMove();
    }, 1200);
  } else {
    broadcastState();
    if (!state.gameOver) scheduleBotMove();
  }
}

function resolveTrick() {
  const leadSuit = state.table[0].card.suit;
  let winner = state.table[0];
  state.table.forEach(e => {
    if (compare(e.card, winner.card, leadSuit, state.trump) > 0) winner = e;
  });

  let pts = 0;
  state.table.forEach(e => pts += pointsMap[e.card.rank] || 0);
  state.scores[winner.playerIndex % 2] += pts;
  state.turn = winner.playerIndex;
  state.table = [];

  if (state.hands[0].length === 0) state.gameOver = true;
}

function scheduleBotMove() {
  if (!isHost || state.gameOver) return;
  if (!botSlots.includes(state.turn)) return;
  setTimeout(() => botPlay(state.turn), 900);
}

function botPlay(botIndex) {
  if (!isHost || botIndex !== state.turn || state.gameOver) return;

  const hand = state.hands[botIndex];
  if (!hand || hand.length === 0) return;

  let card;

  if (state.table.length === 0) {
    // Первый ход — играем некозырную карту с наименьшим значением
    const nonTrump = hand.filter(c => !isTrump(c, state.trump));
    const pool = nonTrump.length > 0 ? nonTrump : hand;
    card = pool.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
  } else {
    const leadSuit = state.table[0].card.suit;
    const suited = hand.filter(c => c.suit === leadSuit && !isTrump(c, state.trump));
    const trumpCards = hand.filter(c => isTrump(c, state.trump));
    const others = hand.filter(c => !isTrump(c, state.trump) && c.suit !== leadSuit);

    if (suited.length > 0) {
      card = suited.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
    } else if (others.length > 0) {
      card = others.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
    } else {
      card = trumpCards.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
    }
  }

  processPlay(botIndex, card);
}

// =============================================
// СИНХРОНИЗАЦИЯ
// =============================================

function broadcastState() {
  applyState(state);
  broadcastToAll({ type: "gameState", state });
}

function broadcastToAll(data) {
  for (let i = 1; i < 4; i++) {
    if (peers[i] && peers[i].open) {
      peers[i].send(data);
    }
  }
}

function applyState(s) {
  state = JSON.parse(JSON.stringify(s));
  renderAll();
  if (state.gameOver) {
    setTimeout(() => handleGameEnd(state.scores), 800);
  }
}

// =============================================
// ХОД ИГРОКА
// =============================================

function play(i) {
  if (myIndex !== state.turn || !state.started || state.gameOver) return;

  const card = state.hands[myIndex][i];
  if (!card) return;

  if (isHost) {
    processPlay(myIndex, card);
  } else {
    if (!peers[0] || !peers[0].open) { showStatus("Нет связи с хостом"); return; }
    // Оптимистично убираем карту из руки
    state.hands[myIndex].splice(i, 1);
    renderHand();
    peers[0].send({ type: "play", playerIndex: myIndex, card });
  }
}

// =============================================
// РЕНДЕР
// =============================================

function renderAll() {
  renderHand();
  renderTable();
  renderPlayers();
  renderTrump();
  renderScores();
}

function getCardImage(card) {
  return `assets/cards/${card.rank}${suitsMap[card.suit]}.png`;
}

function renderHand() {
  const div = document.getElementById("hand");
  if (!div) return;
  div.innerHTML = "";

  const myHand = state.hands[myIndex] || [];
  const canPlay = myIndex === state.turn && state.started && !state.gameOver;

  myHand.forEach((card, i) => {
    const img = document.createElement("img");
    img.src = getCardImage(card);
    img.className = "card";
    img.style.opacity = canPlay ? "1" : "0.6";
    img.style.cursor = canPlay ? "pointer" : "default";
    if (canPlay) img.onclick = () => play(i);
    div.appendChild(img);
  });
}

function renderTable() {
  const div = document.getElementById("table");
  if (!div) return;
  div.innerHTML = "";

  state.table.forEach(e => {
    const img = document.createElement("img");
    img.src = getCardImage(e.card);
    img.className = "card table-card";
    img.style.opacity = 0;
    setTimeout(() => img.style.opacity = 1, 50);
    div.appendChild(img);
  });
}

function renderPlayers() {
  const playerEls = document.querySelectorAll(".player");
  const names = ["Вы", "Игрок 2", "Игрок 3", "Игрок 4"];

  playerEls.forEach((el, i) => {
    const cardCount = state.started ? ` (${(state.hands[i]||[]).length})` : "";
    const bot = botSlots.includes(i) ? " 🤖" : "";
    el.innerText = names[i] + bot + cardCount;
    el.style.color = i === state.turn && state.started ? "yellow" : "white";
    el.style.fontWeight = i === state.turn && state.started ? "bold" : "normal";
  });
}

function renderTrump() {
  const el = document.getElementById("trump");
  if (el) el.innerText = state.trump ? "Козырь: " + state.trump : "Козырь: —";
}

function renderScores() {
  const el = document.getElementById("scores");
  if (el) el.innerText = "Счёт: " + state.scores[0] + " : " + state.scores[1];
}

// =============================================
// КОНЕЦ ИГРЫ
// =============================================

function handleGameEnd(scores) {
  showAd();
  const myTeam = myIndex % 2;
  const win = scores[myTeam] > scores[myTeam ^ 1];
  playerData.rating += win ? 30 : -15;
  playerData.coins += win ? 20 : 5;
  saveData();

  const div = document.getElementById("result");
  const text = document.getElementById("resultText");
  if (div && text) {
    text.innerText = (win ? "🏆 Победа! " : "😔 Поражение. ") +
      `Счёт: ${scores[0]} : ${scores[1]}`;
    div.style.display = "block";
  }
}

// =============================================
// ДАННЫЕ / БОНУСЫ / РЕКЛАМА
// =============================================

function saveData() {
  if (ysdk) ysdk.getPlayer().then(p => p.setData(playerData)).catch(console.error);
  updateUI();
}

function checkDailyBonus() {
  const today = new Date().toDateString();
  if (playerData.lastLogin !== today) {
    playerData.lastLogin = today;
    playerData.coins += 50;
    saveData();
    showStatus("Ежедневный бонус +50 монет!");
    setTimeout(() => showStatus(""), 3000);
  }
}

function showAd() {
  if (!ysdk) return;
  try { ysdk.adv.showFullscreenAdv(); } catch(e) {}
}

function watchAdForCoins() {
  if (!ysdk) { showStatus("Реклама недоступна"); return; }
  ysdk.adv.showRewardedVideo({
    callbacks: {
      onRewarded: () => { playerData.coins += 100; saveData(); showStatus("+100 монет!"); },
      onError: () => {}
    }
  });
}

function showStatus(msg) {
  const el = document.getElementById("status");
  if (!el) return;
  el.innerText = msg;
  el.style.display = msg ? "block" : "none";
}

function updateUI() {
  const r = document.getElementById("rating");
  const l = document.getElementById("league");
  const c = document.getElementById("coins");
  if (r) r.innerText = "Рейтинг: " + playerData.rating;
  if (l) l.innerText = "Лига: " + getLeague(playerData.rating);
  if (c) c.innerText = "Монеты: " + playerData.coins;
}

function getLeague(rating) {
  if (rating < 900) return "Бронза";
  if (rating < 1200) return "Серебро";
  if (rating < 1500) return "Золото";
  if (rating < 2000) return "Платина";
  return "Элита";
}

// =============================================
// DOM
// =============================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("restart").onclick = () => {
    state = { trump:null, hands:[[],[],[],[]], table:[], turn:0, scores:[0,0], started:false, gameOver:false };
    myIndex = 0; isHost = false; peers = []; playerCount = 1; botSlots = [];
    if (peer) { peer.destroy(); peer = null; }
    document.getElementById("result").style.display = "none";
    const d = document.getElementById("roomCodeDisplay");
    if (d) d.style.display = "none";
    const b = document.getElementById("startWithBots");
    if (b) b.style.display = "none";
    renderAll();
    showStatus("");
  };

  document.getElementById("rewardAd").onclick = watchAdForCoins;

  renderAll();
});
