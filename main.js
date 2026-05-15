// =============================================
// БЕЛКА — полная версия с правилами
// =============================================

// Масти
const suits = ["♣","♥","♠","♦"];
const suitsMap = { "♣":"C", "♥":"H", "♠":"S", "♦":"D" };
const ranksMap = { "7":"7","8":"8","9":"9","Д":"Q","К":"K","10":"10","Т":"A","В":"J" };

// Ранги (В = валет — всегда козырь)
const ranks = ["7","8","9","Д","К","10","Т","В"];
const pointsMap = { "Т":11, "10":10, "К":4, "Д":3, "В":2 };

// Сила карт в масти (без учёта козыря)
const rankPower = { "7":1,"8":2,"9":3,"Д":4,"К":5,"10":6,"Т":7,"В":8 };

// Позиции: 0=я, 1=правый бот, 2=верхний бот, 3=левый бот
const PLAYER = 0;
const BOT_NAMES = ["Вы", "Бот Миша", "Бот Даша", "Бот Саша"];

// Команды: 0 и 2 против 1 и 3
// Козырная масть по позиции держателя JC:
// держатель JC → козырь ♣
// напротив (партнёр) → ♠
// справа от держателя → ♦
// слева от держателя → ♥
const TRUMP_BY_POSITION = ["♣","♦","♠","♥"]; // индекс = смещение от держателя JC

let state = null;
let dealing = false;
let gameScore = [0, 0]; // очки всей игры [команда 0-2, команда 1-3]
let jcHolderTeam = -1;  // команда, у которой JC в текущей партии

let ysdk = null;
let playerData = { rating: 1000, coins: 0, lastLogin: null, skin: "default" };

// =============================================
// СКИНЫ
// =============================================

const SKINS = {
  table: [
    { id: "default",  name: "Классик",   price: 0,    color: "radial-gradient(ellipse at center, #2e7d32 0%, #1a4a1e 60%, #0d2b10 100%)" },
    { id: "blue",     name: "Океан",     price: 100,  color: "radial-gradient(ellipse at center, #1565c0 0%, #0d3b6e 60%, #071f3a 100%)" },
    { id: "purple",   name: "Ночь",      price: 150,  color: "radial-gradient(ellipse at center, #4a148c 0%, #2a0a5e 60%, #120030 100%)" },
    { id: "dark",     name: "Бархат",    price: 200,  color: "radial-gradient(ellipse at center, #212121 0%, #111111 60%, #000000 100%)" },
    { id: "gold",     name: "Золото",    price: 300,  color: "radial-gradient(ellipse at center, #5d4037 0%, #3e2723 60%, #1c0f0a 100%)" },
  ],
  cardBack: [
    { id: "default",  name: "Синяя",     price: 0 },
    { id: "red",      name: "Красная",   price: 100 },
    { id: "gold",     name: "Золотая",   price: 250 },
  ]
};

function applySkin() {
  const skinId = playerData.skin || "default";
  const skin = SKINS.table.find(s => s.id === skinId) || SKINS.table[0];
  document.body.style.background = skin.color;
}

// =============================================
// ЯНДЕКС SDK
// =============================================

if (typeof YaGames !== "undefined") {
  YaGames.init().then(sdk => {
    ysdk = sdk;
    sdk.getPlayer().then(p => p.getData()).then(data => {
      if (data && Object.keys(data).length > 0) playerData = { ...playerData, ...data };
      applySkin();
      checkDailyBonus();
      updateHUD();
    }).catch(() => { checkDailyBonus(); updateHUD(); });
  }).catch(() => { checkDailyBonus(); updateHUD(); });
} else {
  checkDailyBonus();
  updateHUD();
}

// =============================================
// КОЗЫРЬ И ВАЛЕТЫ
// =============================================

// Валет всегда козырь независимо от масти
function isJack(card) { return card.rank === "В"; }

// Крестовый валет
function isJC(card) { return card.rank === "В" && card.suit === "♣"; }

function isTrump(card, trump) {
  return isJack(card) || card.suit === trump;
}

// Сила козырной карты: JC > JD > JS > JH > A > 10 > K > Q > 9 > 8 > 7
function trumpPower(card) {
  if (card.rank === "В") {
    // Валеты: JC=40, JS=39, JD=38, JH=37 (по правилам Белки)
    const jackOrder = { "♣":40, "♠":39, "♦":38, "♥":37 };
    return jackOrder[card.suit] || 36;
  }
  return rankPower[card.rank];
}

function cardPower(card, leadSuit, trump) {
  if (isTrump(card, trump)) return 100 + trumpPower(card);
  if (card.suit === leadSuit) return 50 + rankPower[card.rank];
  return rankPower[card.rank];
}

function compareCards(a, b, leadSuit, trump) {
  return cardPower(a, leadSuit, trump) - cardPower(b, leadSuit, trump);
}

// Определить козырь по держателю JC
function determineTrump(jcHolder) {
  // jcHolder — индекс игрока (0-3)
  // 0 смещение = ♣, +1 = ♦, +2 = ♠, +3 = ♥
  return TRUMP_BY_POSITION[jcHolder % 4];
}

// =============================================
// КОЛОДА И РАЗДАЧА
// =============================================

function createDeck() {
  let deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// =============================================
// СОРТИРОВКА РУКИ
// =============================================

function sortHand(hand, trump) {
  return [...hand].sort((a, b) => {
    const aT = isTrump(a, trump);
    const bT = isTrump(b, trump);

    // Козыри первыми
    if (aT && !bT) return -1;
    if (!aT && bT) return 1;

    if (aT && bT) {
      // Среди козырей: валеты первыми по силе, потом остальные по убыванию
      return trumpPower(b) - trumpPower(a);
    }

    // Некозырные: группируем по масти, внутри по убыванию очков
    if (a.suit !== b.suit) {
      return a.suit.localeCompare(b.suit);
    }
    return rankPower[b.rank] - rankPower[a.rank];
  });
}

// =============================================
// СТАРТ ПАРТИИ
// =============================================

function startGame() {
  const deck = createDeck();
  const hands = [
    deck.slice(0, 8),
    deck.slice(8, 16),
    deck.slice(16, 24),
    deck.slice(24, 32)
  ];

  // Найти держателя JC
  let jcHolder = -1;
  for (let i = 0; i < 4; i++) {
    if (hands[i].some(c => isJC(c))) { jcHolder = i; break; }
  }
  if (jcHolder === -1) jcHolder = 0; // fallback

  const trump = determineTrump(jcHolder);
  jcHolderTeam = jcHolder % 2; // команда держателя JC

  // Сортируем руки
  for (let i = 0; i < 4; i++) {
    hands[i] = sortHand(hands[i], trump);
  }

  state = {
    trump,
    jcHolder,
    hands,
    table: [],
    turn: 0,
    scores: [0, 0],   // очки взяток [команда 0-2, команда 1-3]
    gameOver: false,
    roundOver: false,
    trickWinner: null
  };

  document.getElementById("result").style.display = "none";
  document.getElementById("roundResult").style.display = "none";
  showStatus("");
  renderAll();
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
      // Если первый ход — бот
      if (state.turn !== PLAYER) setTimeout(botPlay, 800);
      return;
    }
    state.hands[PLAYER].push(fullHand[i]);
    renderHand();
    i++;
  }, 100);
}

// =============================================
// ХОДЫ
// =============================================

function playerPlay(cardIndex) {
  if (dealing || state.gameOver || state.roundOver) return;
  if (state.turn !== PLAYER) return;

  const card = state.hands[PLAYER][cardIndex];
  if (!card) return;

  if (!isValidPlay(PLAYER, card)) {
    showStatus("Нужно ходить в масть!");
    setTimeout(() => showStatus(""), 1500);
    return;
  }

  state.hands[PLAYER].splice(cardIndex, 1);
  state.hands[PLAYER] = sortHand(state.hands[PLAYER], state.trump);
  playCard(PLAYER, card);
}

function isValidPlay(playerIndex, card) {
  if (state.table.length === 0) return true;

  const leadCard = state.table[0].card;
  const leadIsTrump = isTrump(leadCard, state.trump);
  const hand = state.hands[playerIndex];

  if (leadIsTrump) {
    // Ведут козырем — нужно козырять
    const hasTrump = hand.some(c => isTrump(c, state.trump));
    if (hasTrump && !isTrump(card, state.trump)) return false;
  } else {
    // Ведут мастью
    const leadSuit = leadCard.suit;
    const hasSuited = hand.some(c => c.suit === leadSuit && !isTrump(c, state.trump));
    if (hasSuited && (card.suit !== leadSuit || isTrump(card, state.trump))) return false;
  }
  return true;
}

function playCard(playerIndex, card) {
  state.table.push({ playerIndex, card });
  state.turn = (state.turn + 1) % 4;

  renderTable();
  renderHand();
  renderPlayers();

  if (state.table.length === 4) {
    setTimeout(resolveTrick, 1200);
  } else {
    if (state.turn !== PLAYER) setTimeout(botPlay, 750);
  }
}

// =============================================
// ВЗЯТКА
// =============================================

function resolveTrick() {
  const leadSuit = state.table[0].card.suit;
  let winner = state.table[0];
  state.table.forEach(e => {
    if (compareCards(e.card, winner.card, leadSuit, state.trump) > 0) winner = e;
  });

  let pts = 0;
  state.table.forEach(e => pts += pointsMap[e.card.rank] || 0);

  const winTeam = winner.playerIndex % 2;
  state.scores[winTeam] += pts;
  state.trickWinner = winner.playerIndex;

  renderScores();
  showStatus(BOT_NAMES[winner.playerIndex] + " берёт взятку (+" + pts + ")");

  setTimeout(() => {
    state.table = [];
    state.turn = winner.playerIndex;
    state.trickWinner = null;
    showStatus("");
    renderTable();
    renderPlayers();

    if (state.hands[PLAYER].length === 0) {
      state.roundOver = true;
      setTimeout(endRound, 600);
    } else {
      if (state.turn !== PLAYER) setTimeout(botPlay, 650);
      else renderHand();
    }
  }, 1300);
}

// =============================================
// КОНЕЦ ПАРТИИ — ОЧКИ
// =============================================

function endRound() {
  showAd();

  const s0 = state.scores[0]; // очки команды игрока (0+2)
  const s1 = state.scores[1]; // очки команды ботов (1+3)

  // Команда JC holder
  const jcTeam = jcHolderTeam; // 0 или 1
  const otherTeam = 1 - jcTeam;

  let points0 = 0; // очки партии для команды 0
  let points1 = 0;

  const jcTeamScore  = jcTeam === 0 ? s0 : s1;
  const otherScore   = jcTeam === 0 ? s1 : s0;

  let roundMsg = "";

  if (jcTeam === 1) {
    // JC у соперников (команда 1)
    if (jcTeamScore < 30) {
      // Соперники набрали < 30 — наша команда получает 3 очка
      points0 = 3; points1 = 0;
      roundMsg = "Боты набрали меньше 30! Вы получаете 3 очка!";
    } else if (jcTeamScore >= 60) {
      points0 = 0; points1 = 2;
      roundMsg = "Боты победили в партии. +2 очка ботам.";
    } else {
      points0 = 2; points1 = 0;
      roundMsg = "Вы победили в партии! +2 очка вам!";
    }
  } else {
    // JC у нашей команды (команда 0)
    if (otherScore > 30) {
      // Соперники набрали > 30 — мы получаем только 1 очко
      points0 = 1; points1 = 0;
      roundMsg = "Соперники набрали больше 30. Вы получаете только 1 очко.";
    } else if (s0 >= 60) {
      points0 = 2; points1 = 0;
      roundMsg = "Вы победили в партии! +2 очка!";
    } else {
      points0 = 0; points1 = 2;
      roundMsg = "Боты победили в партии. +2 очка ботам.";
    }
  }

  gameScore[0] += points0;
  gameScore[1] += points1;

  renderGameScore();

  // Показать результат партии
  const div = document.getElementById("roundResult");
  const txt = document.getElementById("roundResultText");
  const sc  = document.getElementById("roundScoreText");
  txt.innerText = roundMsg;
  sc.innerText  = `Счёт игры: Вы ${gameScore[0]} : ${gameScore[1]} Боты`;
  div.style.display = "flex";

  // Обновить рейтинг и монеты
  const weWon = points0 > points1;
  playerData.rating += weWon ? 10 : -5;
  playerData.coins  += weWon ? 8  :  3;
  if (playerData.rating < 0) playerData.rating = 0;
  saveData();

  // Проверить победу в игре
  if (gameScore[0] >= 12 || gameScore[1] >= 12) {
    setTimeout(endGame, 2000);
  }
}

function endGame() {
  const weWon = gameScore[0] >= 12;
  playerData.rating += weWon ? 50 : -20;
  playerData.coins  += weWon ? 50 :  10;
  if (playerData.rating < 0) playerData.rating = 0;
  saveData();

  const div  = document.getElementById("result");
  const text = document.getElementById("resultText");
  text.innerText = (weWon ? "🏆 Победа в игре!" : "😔 Поражение в игре.") +
    `\nСчёт: Вы ${gameScore[0]} : ${gameScore[1]} Боты`;
  div.style.display = "flex";
  gameScore = [0, 0];
}

// =============================================
// БОТ
// =============================================

function botPlay() {
  if (!state || state.gameOver || state.roundOver || state.turn === PLAYER) return;

  const botIndex = state.turn;
  const hand = state.hands[botIndex];
  if (!hand || hand.length === 0) return;

  const card = chooseBotCard(botIndex, hand);
  state.hands[botIndex] = sortHand(
    hand.filter(c => !(c.rank === card.rank && c.suit === card.suit)),
    state.trump
  );
  playCard(botIndex, card);
}

function chooseBotCard(botIndex, hand) {
  const trump = state.trump;

  if (state.table.length === 0) {
    // Первый ход — некозырную слабую
    const nonTrump = hand.filter(c => !isTrump(c, trump));
    const pool = nonTrump.length > 0 ? nonTrump : hand;
    return pool[pool.length - 1]; // рука отсортирована по убыванию силы → берём последнюю (слабую)
  }

  const leadCard = state.table[0].card;
  const leadSuit = leadCard.suit;
  const leadIsTrump = isTrump(leadCard, trump);

  // Валидные карты
  const valid = hand.filter(c => isValidPlay(botIndex, c));

  // Текущий победитель
  const currentWinner = state.table.reduce((best, e) =>
    compareCards(e.card, best.card, leadSuit, trump) > 0 ? e : best, state.table[0]);
  const partnerWinning = currentWinner.playerIndex % 2 === botIndex % 2;

  if (partnerWinning) {
    // Партнёр выигрывает — скидываем слабую
    return valid[valid.length - 1];
  }

  // Пробуем перебить
  const winning = valid.filter(c => compareCards(c, currentWinner.card, leadSuit, trump) > 0);
  if (winning.length > 0) return winning[winning.length - 1]; // минимально перебиваем

  // Не можем перебить — скидываем слабую
  return valid[valid.length - 1];
}

// =============================================
// РЕНДЕР
// =============================================

function getCardImage(card) {
  return `assets/cards/${ranksMap[card.rank]}${suitsMap[card.suit]}.png`;
}

function renderAll() {
  renderHand();
  renderTable();
  renderPlayers();
  renderTrump();
  renderScores();
  renderGameScore();
}

function renderHand() {
  const div = document.getElementById("hand");
  if (!div) return;
  div.innerHTML = "";

  const hand = state ? state.hands[PLAYER] : [];
  const canPlay = state && !dealing && !state.gameOver && !state.roundOver &&
                  state.turn === PLAYER && state.table.length < 4;

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

// Карты на столе — ромбом: верх, право, низ, лево
// Порядок хода: 0(низ), 1(право), 2(верх), 3(лево)
const TABLE_POSITIONS = [
  { top: "55%",  left: "50%", transform: "translate(-50%, 0)" },      // 0 = я (низ)
  { top: "35%",  left: "65%", transform: "translate(0, -50%)" },      // 1 = правый
  { top: "15%",  left: "50%", transform: "translate(-50%, 0)" },      // 2 = верх
  { top: "35%",  left: "35%", transform: "translate(-100%, -50%)" },  // 3 = левый
];

function renderTable() {
  const div = document.getElementById("table");
  if (!div) return;
  div.innerHTML = "";
  if (!state) return;

  state.table.forEach(e => {
    const pos = TABLE_POSITIONS[e.playerIndex];

    const wrapper = document.createElement("div");
    wrapper.style.position = "absolute";
    wrapper.style.top = pos.top;
    wrapper.style.left = pos.left;
    wrapper.style.transform = pos.transform;
    wrapper.style.textAlign = "center";

    const label = document.createElement("div");
    label.style.color = "#fff";
    label.style.fontSize = "10px";
    label.style.marginBottom = "2px";
    label.style.textShadow = "0 1px 3px rgba(0,0,0,0.9)";
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
  const positions = [
    { el: document.querySelector(".player.me"),    index: 0 },
    { el: document.querySelector(".player.right"), index: 1 },
    { el: document.querySelector(".player.top"),   index: 2 },
    { el: document.querySelector(".player.left"),  index: 3 }
  ];

  positions.forEach(({ el, index }) => {
    if (!el) return;
    const cards = state ? state.hands[index].length : 0;
    const isActive = state && state.turn === index && !state.gameOver && !state.roundOver;
    const isJCHolder = state && state.jcHolder === index;
    el.innerText = BOT_NAMES[index] + (state ? ` (${cards})` : "") + (isJCHolder ? " ♣J" : "");
    el.style.color = isActive ? "#FFD700" : "white";
    el.style.fontWeight = isActive ? "bold" : "normal";
    el.style.textShadow = isActive ? "0 0 8px #FFD700" : "none";
  });
}

function renderTrump() {
  const el = document.getElementById("trump");
  if (!el || !state) return;
  const suitColors = { "♥":"#ff5555", "♦":"#ff5555", "♣":"#aaffaa", "♠":"#aaaaff" };
  el.innerHTML = `Козырь: <span style="color:${suitColors[state.trump]||'#fff'};font-size:22px">${state.trump}</span>`;
}

function renderScores() {
  const el = document.getElementById("scores");
  if (el && state) el.innerText = `Очки партии — Вы: ${state.scores[0]} | Боты: ${state.scores[1]}`;
}

function renderGameScore() {
  const el = document.getElementById("gameScore");
  if (el) {
    el.innerHTML = `Игра: <b>${gameScore[0]}</b> : <b>${gameScore[1]}</b> (до 12)`;
  }
}

function showStatus(msg) {
  const el = document.getElementById("status");
  if (!el) return;
  el.innerText = msg;
  el.style.display = msg ? "block" : "none";
}

// =============================================
// МАГАЗИН
// =============================================

function openShop() {
  document.getElementById("shop").style.display = "flex";
}

function closeShop() {
  document.getElementById("shop").style.display = "none";
}

function buySkin(skinId) {
  const skin = SKINS.table.find(s => s.id === skinId);
  if (!skin) return;
  if (skin.price > 0 && playerData.coins < skin.price) {
    showStatus("Не хватает монет!");
    setTimeout(() => showStatus(""), 2000);
    return;
  }
  playerData.coins -= skin.price;
  playerData.skin = skinId;
  saveData();
  applySkin();
  renderShop();
  showStatus("Скин применён!");
  setTimeout(() => showStatus(""), 2000);
}

function renderShop() {
  const container = document.getElementById("shopItems");
  if (!container) return;
  container.innerHTML = "";

  SKINS.table.forEach(skin => {
    const owned = skin.price === 0 || (playerData.ownedSkins || []).includes(skin.id) || playerData.skin === skin.id;
    const active = playerData.skin === skin.id;

    const item = document.createElement("div");
    item.className = "shop-item";
    item.style.background = skin.color;

    const name = document.createElement("div");
    name.className = "shop-item-name";
    name.innerText = skin.name;

    const btn = document.createElement("button");
    btn.className = "btn shop-btn";

    if (active) {
      btn.innerText = "✓ Выбран";
      btn.disabled = true;
      btn.style.background = "rgba(100,200,100,0.5)";
    } else if (playerData.coins >= skin.price || skin.price === 0) {
      btn.innerText = skin.price === 0 ? "Выбрать" : `${skin.price} 💰`;
      btn.onclick = () => buySkin(skin.id);
    } else {
      btn.innerText = `${skin.price} 💰`;
      btn.disabled = true;
      btn.style.opacity = "0.5";
    }

    item.appendChild(name);
    item.appendChild(btn);
    container.appendChild(item);
  });
}

// =============================================
// HUD / ДАННЫЕ
// =============================================

function getLeague(r) {
  if (r < 900)  return "🥉 Бронза";
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
  if (!ysdk) { showStatus("Реклама недоступна"); setTimeout(() => showStatus(""), 2000); return; }
  ysdk.adv.showRewardedVideo({
    callbacks: {
      onRewarded: () => {
        playerData.coins += 100;
        saveData();
        showStatus("+100 монет!");
        setTimeout(() => showStatus(""), 2000);
      },
      onError: () => {}
    }
  });
}

// =============================================
// СТАРТ
// =============================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("startBtn").onclick = () => {
    gameScore = [0, 0];
    startGame();
  };
  document.getElementById("nextRound").onclick = () => {
    document.getElementById("roundResult").style.display = "none";
    startGame();
  };
  document.getElementById("restart").onclick = () => {
    gameScore = [0, 0];
    document.getElementById("result").style.display = "none";
    startGame();
  };
  document.getElementById("rewardAd").onclick = watchAdForCoins;
  document.getElementById("shopBtn").onclick = () => { renderShop(); openShop(); };
  document.getElementById("shopClose").onclick = closeShop;

  applySkin();
  updateHUD();
  renderGameScore();
});
