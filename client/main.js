const suitsMap = {
  "♣":"C",
  "♥":"H",
  "♠":"S",
  "♦":"D"
};

let socket;
let hand = [];
let table = [];
let playerIndex = null;
let currentTurn = 0;
let dealing = true;
let trump = null;

let ysdk = null;

let playerData = {
  rating: 1000,
  coins: 0,
  lastLogin: null
};

// ================= ЛИГИ =================

function getLeague(rating) {
  if (rating < 900) return "Бронза";
  if (rating < 1200) return "Серебро";
  if (rating < 1500) return "Золото";
  if (rating < 2000) return "Платина";
  return "Элита";
}

// ================= SDK =================

// FIX: защищаем от падения если SDK недоступен (локальная разработка)
if (typeof YaGames !== "undefined") {
  YaGames.init().then(sdk => {
    ysdk = sdk;
    sdk.getPlayer()
      .then(p => p.getData())
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          playerData = { ...playerData, ...data };
        }
        checkDailyBonus();
        updateUI();
      })
      .catch(() => {
        checkDailyBonus();
        updateUI();
      });
  }).catch(() => {
    checkDailyBonus();
    updateUI();
  });
} else {
  // Локальный запуск без SDK
  checkDailyBonus();
  updateUI();
}

// ================= ПОДКЛЮЧЕНИЕ =================

function connect() {
  // FIX: используем реальный адрес сервера.
  // При локальной разработке — localhost, в продакшене замените на wss://ваш-домен
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const wsUrl = isLocal
    ? "ws://localhost:3000"
    : "wss://" + location.hostname + ":3000";

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("Подключено к серверу");
  };

  socket.onerror = (e) => {
    console.error("Ошибка WebSocket:", e);
    showStatus("Ошибка подключения к серверу");
  };

  socket.onclose = () => {
    showStatus("Соединение разорвано. Перезагрузите страницу.");
  };

  socket.onmessage = (msg) => {
    let data;
    try {
      data = JSON.parse(msg.data);
    } catch(e) {
      return;
    }

    if (data.type === "start") {
      hand = [];
      playerIndex = data.playerIndex;
      trump = data.trump;
      currentTurn = 0;
      table = [];
      document.getElementById("result").style.display = "none";
      showTrump(trump);
      animateDeal(data.hand);
    }

    if (data.type === "update") {
      table = data.table;
      currentTurn = data.turn;
      renderAll();
    }

    if (data.type === "trickWon") {
      currentTurn = data.turn;
      table = [];
      updateScores(data.scores);
      renderAll();
    }

    if (data.type === "end") {
      handleGameEnd(data.result.scores);
    }

    if (data.type === "roomCreated") {
      showStatus("Код комнаты: " + data.roomId);
    }

    if (data.type === "roomUpdate") {
      showStatus("Игроков в комнате: " + data.players + " / 4");
    }

    if (data.type === "playerLeft") {
      showStatus("Игрок отключился. Ожидание...");
    }

    if (data.type === "error") {
      showStatus(data.message);
    }
  };
}

// ================= UI =================

function showStatus(msg) {
  const el = document.getElementById("status");
  if (el) {
    el.innerText = msg;
    el.style.display = "block";
  }
}

function showTrump(t) {
  const el = document.getElementById("trump");
  if (el) el.innerText = "Козырь: " + t;
}

function updateScores(scores) {
  const el = document.getElementById("scores");
  if (el) el.innerText = "Счёт: " + scores[0] + " : " + scores[1];
}

function getCardImage(card) {
  return `assets/cards/${card.rank}${suitsMap[card.suit]}.png`;
}

function renderAll() {
  renderTable();
  renderHand();
  renderPlayers();
}

function renderHand() {
  const div = document.getElementById("hand");
  div.innerHTML = "";

  hand.forEach((card, i) => {
    const img = document.createElement("img");
    img.src = getCardImage(card);
    img.className = "card";

    if (playerIndex !== currentTurn || dealing) {
      img.style.opacity = 0.5;
      img.style.cursor = "default";
    } else {
      img.style.cursor = "pointer";
      img.onclick = () => play(i);
    }

    div.appendChild(img);
  });
}

function renderTable() {
  const div = document.getElementById("table");
  div.innerHTML = "";

  table.forEach(e => {
    const img = document.createElement("img");
    img.src = getCardImage(e.card);
    img.className = "card table-card";

    img.style.opacity = 0;
    setTimeout(() => img.style.opacity = 1, 50);

    div.appendChild(img);
  });
}

function renderPlayers() {
  const players = document.querySelectorAll(".player");

  players.forEach((p, i) => {
    if (i === currentTurn) {
      p.style.color = "yellow";
      p.style.fontWeight = "bold";
    } else {
      p.style.color = "white";
      p.style.fontWeight = "normal";
    }
  });
}

// ================= ХОД =================

function play(i) {
  if (playerIndex !== currentTurn || dealing) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  const card = hand.splice(i, 1)[0];

  socket.send(JSON.stringify({
    type: "play",
    card
  }));

  renderAll();
}

// ================= РАЗДАЧА =================

function animateDeal(newHand) {
  dealing = true;
  hand = [];

  let i = 0;

  const interval = setInterval(() => {
    if (i >= newHand.length) {
      clearInterval(interval);
      dealing = false;
      renderAll();
      showStatus("");
      return;
    }

    hand.push(newHand[i]);
    renderHand();
    i++;
  }, 120);
}

// ================= КОНЕЦ ИГРЫ =================

function handleGameEnd(scores) {
  showAd();

  const myTeam = playerIndex % 2;
  const opponentTeam = myTeam ^ 1;
  const win = scores[myTeam] > scores[opponentTeam];

  if (win) {
    playerData.rating += 30;
    playerData.coins += 20;
  } else {
    playerData.rating -= 15;
    playerData.coins += 5;
  }

  saveData();
  showResult(scores, win);
}

function showResult(scores, win) {
  const div = document.getElementById("result");
  const text = document.getElementById("resultText");

  text.innerText = (win ? "🏆 Победа! " : "😔 Поражение. ") +
    `Счёт: ${scores[0]} : ${scores[1]}`;
  div.style.display = "block";
}

// ================= ДАННЫЕ =================

function saveData() {
  if (ysdk) {
    ysdk.getPlayer().then(player => {
      player.setData(playerData);
    }).catch(console.error);
  }
  updateUI();
}

function updateUI() {
  const r = document.getElementById("rating");
  const l = document.getElementById("league");
  const c = document.getElementById("coins");

  if (r) r.innerText = "Рейтинг: " + playerData.rating;
  if (l) l.innerText = "Лига: " + getLeague(playerData.rating);
  if (c) c.innerText = "Монеты: " + playerData.coins;
}

// ================= БОНУСЫ =================

function checkDailyBonus() {
  const today = new Date().toDateString();

  if (playerData.lastLogin !== today) {
    playerData.lastLogin = today;
    playerData.coins += 50;
    showStatus("Ежедневный бонус +50 монет!");
    saveData();
  }
}

// ================= РЕКЛАМА =================

function showAd() {
  if (!ysdk) return;
  try {
    ysdk.adv.showFullscreenAdv();
  } catch(e) {
    console.warn("Реклама недоступна:", e);
  }
}

function watchAdForCoins() {
  if (!ysdk) {
    showStatus("Реклама недоступна в этом режиме");
    return;
  }

  ysdk.adv.showRewardedVideo({
    callbacks: {
      onRewarded: () => {
        playerData.coins += 100;
        saveData();
        showStatus("+100 монет!");
      },
      onError: (e) => {
        console.warn("Ошибка рекламы:", e);
      }
    }
  });
}

// ================= КНОПКИ =================

function quickGame() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showStatus("Нет соединения с сервером");
    return;
  }
  showStatus("Ищем игроков...");
  socket.send(JSON.stringify({ type: "quick" }));
}

function createRoom() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "createRoom" }));
}

function joinRoom() {
  const id = prompt("Введи код комнаты:");
  if (!id) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "joinRoom", roomId: id.trim().toUpperCase() }));
}

// ================= DOM =================

document.getElementById("restart").onclick = () => {
  quickGame();
};

document.getElementById("rewardAd").onclick = () => {
  watchAdForCoins();
};

// Старт
connect();
