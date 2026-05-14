// =============================================
// БЕЛКА — игра против ботов, без сервера
// =============================================

const suitsMap = { "♣":"C", "♥":"H", "♠":"S", "♦":"D" };
const suits = ["♣","♥","♠","♦"];
const ranks = ["7","8","9","Д","К","10","Т","В"];
const pointsMap = { "Т":11, "10":10, "К":4, "Д":3, "В":2 };
const rankPower = { "7":1,"8":2,"9":3,"Д":4,"К":5,"10":6,"Т":7,"В":8 };

const PLAYER = 0;
const BOT_NAMES = ["Вы", "Бот Миша", "Бот Даша", "Бот Саша"];

let state = null;
let dealing = false;

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
      updateHUD();
    }).catch(() => { checkDailyBonus(); updateHUD(); });
  }).catch(() => { checkDailyBonus(); updateHUD(); });
} else {
  checkDailyBonus();
  updateHUD();
}

// =============================================
// ИГРОВАЯ ЛОГИКА
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

function isTrump(card) {
  return card.rank === "В" || card.suit === state.trump;
}

function cardPower(card, leadSuit) {
  if (isTrump(card)) return 100 + rankPower[card.rank];
  if (card.suit === leadSuit) return 50 + rankPower[card.rank];
  return rankPower[card.rank];
}

function compare(a, b, leadSuit) {
  return cardPower(a, leadSuit) - cardPower(b, leadSuit);
}

function startGame() {
  const deck = createDeck();
  state = {
    trump: suits[Math.floor(Math.random() * 4)],
    hands: [
      deck.slice(0, 8),
      deck.slice(8, 16),
      deck.slice(16, 24),
      deck.slice(24, 32)
    ],
    table: [],
    turn: 0,
    scores: [0, 0],
    gameOver: false,
    trickWinner: null
  };

  document.getElementById("result").style.display = "none";
  showStatus("");
  renderTrump();
  renderScores();
  renderPlayers();

  animateDeal();
}

function animateDeal() {
  dealing = true;
  const fullHand = [...state.hands[PLAYER]];
  state.hands[PLAYER] = [];
  renderHand();

  let i = 0;
  const interval = setInterval(() => {
    if (i >= fullHand.length) {
      clearInterval(interval);
      dealing = false;
      renderHand();
      return;
    }
    state.hands[PLAYER].push(fullHand[i]);
    renderHand();
    i++;
  }, 100);
}

function playerPlay(cardIndex) {
  if (dealing || state.gameOver) return;
  if (state.turn !== PLAYER) return;

  const card = state.hands[PLAYER][cardIndex];
  if (!card) return;

  // Проверка масти
  if (!isValidPlay(PLAYER, card)) {
    showStatus("Нужно ходить в масть!");
    setTimeout(() => showStatus(""), 1500);
    return;
  }

  state.hands[PLAYER].splice(cardIndex, 1);
  playCard(PLAYER, card);
}

function isValidPlay(playerIndex, card) {
  if (state.table.length === 0) return true; // первый ход — любая карта

  const leadSuit = state.table[0].card.suit;
  const hand = state.hands[playerIndex];

  // Есть карты в масть (не козыри если масть не козырь)
  const hasSuited = hand.some(c => c.suit === leadSuit && !isTrump(c));
  if (hasSuited && card.suit !== leadSuit) return false;

  // Если нет масти — можно козырь или любую
  return true;
}

function playCard(playerIndex, card) {
  state.table.push({ playerIndex, card });
  state.turn = (state.turn + 1) % 4;

  renderTable();
  renderHand();
  renderPlayers();

  if (state.table.length === 4) {
    // Все походили — резолвим взятку
    setTimeout(resolveTrick, 1000);
  } else {
    // Следующий ход — бот?
    if (state.turn !== PLAYER) {
      setTimeout(botPlay, 700);
    }
  }
}

function resolveTrick() {
  const leadSuit = state.table[0].card.suit;
  let winner = state.table[0];
  state.table.forEach(e => {
    if (compare(e.card, winner.card, leadSuit) > 0) winner = e;
  });

  let pts = 0;
  state.table.forEach(e => pts += pointsMap[e.card.rank] || 0);
  state.scores[winner.playerIndex % 2] += pts;

  state.trickWinner = winner.playerIndex;
  renderScores();

  // Показываем кто забрал
  showStatus(BOT_NAMES[winner.playerIndex] + " забирает взятку (+" + pts + " очков)");

  setTimeout(() => {
    state.table = [];
    state.turn = winner.playerIndex;
    state.trickWinner = null;
    showStatus("");
    renderTable();
    renderPlayers();

    if (state.hands[PLAYER].length === 0) {
      state.gameOver = true;
      setTimeout(endGame, 500);
    } else {
      if (state.turn !== PLAYER) {
        setTimeout(botPlay, 600);
      } else {
        renderHand();
      }
    }
  }, 1200);
}

// =============================================
// БОТ
// =============================================

function botPlay() {
  if (state.gameOver || state.turn === PLAYER) return;

  const botIndex = state.turn;
  const hand = state.hands[botIndex];
  if (!hand || hand.length === 0) return;

  const card = chooseBotCard(botIndex, hand);

  state.hands[botIndex] = hand.filter(
    c => !(c.rank === card.rank && c.suit === card.suit)
  );

  playCard(botIndex, card);
}

function chooseBotCard(botIndex, hand) {
  if (state.table.length === 0) {
    // Первый ход — играем некозырную карту с наименьшим значением
    const nonTrump = hand.filter(c => !isTrump(c));
    const pool = nonTrump.length > 0 ? nonTrump : hand;
    return pool.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
  }

  const leadSuit = state.table[0].card.suit;

  // Карты в масть
  const suited = hand.filter(c => c.suit === leadSuit && !isTrump(c));
  // Козыри
  const trumpCards = hand.filter(c => isTrump(c));
  // Остальные
  const others = hand.filter(c => !isTrump(c) && c.suit !== leadSuit);

  // Текущий победитель взятки
  const currentWinner = state.table.reduce((best, e) =>
    compare(e.card, best.card, leadSuit) > 0 ? e : best, state.table[0]);
  const partnerWinning = currentWinner.playerIndex % 2 === botIndex % 2;

  if (suited.length > 0) {
    if (partnerWinning) {
      // Партнёр выигрывает — скидываем наименьшую
      return suited.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
    } else {
      // Пробуем перебить
      const winning = suited.filter(c => compare(c, currentWinner.card, leadSuit) > 0);
      if (winning.length > 0) return winning.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
      return suited.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
    }
  }

  if (!partnerWinning && trumpCards.length > 0) {
    // Козыряем если партнёр не выигрывает
    return trumpCards.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
  }

  // Скидываем наименьшую не козырную
  if (others.length > 0) return others.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
  return trumpCards.sort((a,b) => rankPower[a.rank] - rankPower[b.rank])[0];
}

// =============================================
// КОНЕЦ ИГРЫ
// =============================================

function endGame() {
  showAd();

  const myScore = state.scores[0];
  const botScore = state.scores[1];
  const win = myScore > botScore;

  playerData.rating += win ? 30 : -15;
  playerData.coins += win ? 20 : 5;
  if (playerData.rating < 0) playerData.rating = 0;

  saveData();

  const div = document.getElementById("result");
  const text = document.getElementById("resultText");
  text.innerText = (win ? "🏆 Победа! " : "😔 Поражение. ") +
    `Ваши: ${myScore} | Боты: ${botScore}`;
  div.style.display = "block";
}

// =============================================
// РЕНДЕР
// =============================================

function getCardImage(card) {
  return `assets/cards/${card.rank}${suitsMap[card.suit]}.png`;
}

function renderHand() {
  const div = document.getElementById("hand");
  div.innerHTML = "";

  const hand = state ? state.hands[PLAYER] : [];
  const canPlay = state && !dealing && !state.gameOver && state.turn === PLAYER && state.table.length < 4;

  hand.forEach((card, i) => {
    const img = document.createElement("img");
    img.src = getCardImage(card);
    img.className = "card";
    img.style.opacity = canPlay ? "1" : "0.65";
    img.style.cursor = canPlay ? "pointer" : "default";
    if (canPlay) {
      img.onclick = () => playerPlay(i);
      img.onmouseenter = () => img.style.transform = "translateY(-14px) scale(1.06)";
      img.onmouseleave = () => img.style.transform = "";
    }
    div.appendChild(img);
  });
}

function renderTable() {
  const div = document.getElementById("table");
  div.innerHTML = "";

  if (!state) return;

  state.table.forEach(e => {
    const wrapper = document.createElement("div");
    wrapper.style.display = "inline-block";
    wrapper.style.textAlign = "center";
    wrapper.style.margin = "4px";

    const label = document.createElement("div");
    label.style.color = "#fff";
    label.style.fontSize = "11px";
    label.style.marginBottom = "2px";
    label.innerText = BOT_NAMES[e.playerIndex];

    const img = document.createElement("img");
    img.src = getCardImage(e.card);
    img.className = "card table-card";
    img.style.opacity = 0;
    img.style.transition = "opacity 0.2s";
    setTimeout(() => img.style.opacity = 1, 30);

    wrapper.appendChild(label);
    wrapper.appendChild(img);
    div.appendChild(wrapper);
  });
}

function renderPlayers() {
  const els = {
    top:   document.querySelector(".player.top"),
    left:  document.querySelector(".player.left"),
    right: document.querySelector(".player.right"),
    me:    document.querySelector(".player.me")
  };

  // Позиции: 0=я (низ), 1=правый, 2=верх, 3=левый
  const positions = [
    { el: els.me,    index: 0 },
    { el: els.right, index: 1 },
    { el: els.top,   index: 2 },
    { el: els.left,  index: 3 }
  ];

  positions.forEach(({ el, index }) => {
    if (!el) return;
    const cards = state ? state.hands[index].length : 0;
    const isActive = state && state.turn === index && !state.gameOver;
    const isTrumpInfo = state ? ` ` : "";
    el.innerText = BOT_NAMES[index] + (state && state.started !== false ? ` (${cards})` : "");
    el.style.color = isActive ? "#FFD700" : "white";
    el.style.fontWeight = isActive ? "bold" : "normal";
    el.style.textShadow = isActive ? "0 0 8px #FFD700" : "none";
  });
}

function renderTrump() {
  const el = document.getElementById("trump");
  if (el && state) {
    const suitColors = { "♥":"#ff4444", "♦":"#ff4444", "♣":"#fff", "♠":"#fff" };
    el.innerHTML = `Козырь: <span style="color:${suitColors[state.trump]||'#fff'};font-size:22px">${state.trump}</span>`;
  }
}

function renderScores() {
  const el = document.getElementById("scores");
  if (el && state) {
    el.innerText = `Вы: ${state.scores[0]} | Боты: ${state.scores[1]}`;
  }
}

function showStatus(msg) {
  const el = document.getElementById("status");
  if (!el) return;
  el.innerText = msg;
  el.style.display = msg ? "block" : "none";
}

// =============================================
// HUD / ДАННЫЕ
// =============================================

function getLeague(r) {
  if (r < 900) return "🥉 Бронза";
  if (r < 1200) return "🥈 Серебро";
  if (r < 1500) return "🥇 Золото";
  if (r < 2000) return "💎 Платина";
  return "👑 Элита";
}

function updateHUD() {
  const r = document.getElementById("rating");
  const l = document.getElementById("league");
  const c = document.getElementById("coins");
  if (r) r.innerText = "Рейтинг: " + playerData.rating;
  if (l) l.innerText = getLeague(playerData.rating);
  if (c) c.innerText = "💰 " + playerData.coins;
}

function saveData() {
  if (ysdk) ysdk.getPlayer().then(p => p.setData(playerData)).catch(console.error);
  updateHUD();
}

function checkDailyBonus() {
  const today = new Date().toDateString();
  if (playerData.lastLogin !== today) {
    playerData.lastLogin = today;
    playerData.coins += 50;
    saveData();
    showStatus("🎁 Ежедневный бонус +50 монет!");
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
      onRewarded: () => { playerData.coins += 100; saveData(); showStatus("+100 монет!"); setTimeout(() => showStatus(""), 2000); },
      onError: () => {}
    }
  });
}

// =============================================
// СТАРТ
// =============================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("startBtn").onclick = startGame;
  document.getElementById("restart").onclick = startGame;
  document.getElementById("rewardAd").onclick = watchAdForCoins;
  updateHUD();
});
