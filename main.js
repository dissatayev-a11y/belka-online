// =============================================
// БЕЛКА — полная версия с правилами
// =============================================

const suits = ["♣","♥","♠","♦"];
const suitsMap = { "♣":"C", "♥":"H", "♠":"S", "♦":"D" };
const ranksMap = { "7":"7","8":"8","9":"9","Д":"Q","К":"K","10":"10","Т":"A","В":"J" };
const ranks = ["7","8","9","Д","К","10","Т","В"];
const pointsMap = { "Т":11, "10":10, "К":4, "Д":3, "В":2 };
const rankPower = { "7":1,"8":2,"9":3,"Д":4,"К":5,"10":6,"Т":7,"В":8 };

// Позиции: 0=я(низ), 1=левый, 2=верх, 3=правый
// По часовой стрелке: 0 → 3(право) → 2(верх) → 1(лево) → 0
// Но у нас индексы: 0=низ, 1=лево, 2=верх, 3=право
// Порядок хода по часовой: 0→3→2→1→0
const PLAYER = 0;
const BOT_NAMES = ["Вы", "Бот Саша", "Бот Даша", "Бот Миша"];
// 0=низ(я), 1=лево(Саша), 2=верх(Даша), 3=право(Миша)
// По часовой: низ→право→верх→лево → 0→3→2→1

// Следующий ход по часовой стрелке
function nextTurn(current) {
  // 0→3→2→1→0
  const order = [3, 1, 0, 2]; // order[i] = следующий после i
  return order[current];
}

// Команды: (0,2) vs (1,3)
// Козырь по держателю JC:
// держатель JC → ♣, слева от него → ♥, напротив → ♠, справа → ♦
// По часовой: держатель=♣, следующий(право)=♦, напротив=♠, предыдущий(лево)=♥
const TRUMP_FOR_OFFSET = { 0:"♣", 3:"♦", 2:"♠", 1:"♥" };
// offset = (playerIndex - jcHolder + 4) % 4

let state = null;
let dealing = false;
let gameScore = [0, 0];
let jcHolderGlobal = -1; // кто держит JC — фиксируется на первую партию и далее

let ysdk = null;
let playerData = { rating: 1000, coins: 0, lastLogin: null, skin: "default" };

// =============================================
// СКИНЫ
// =============================================

const SKINS = {
  table: [
    { id:"default", name:"Классик", price:0,   color:"radial-gradient(ellipse at center,#2e7d32 0%,#1a4a1e 60%,#0d2b10 100%)" },
    { id:"blue",    name:"Океан",   price:100,  color:"radial-gradient(ellipse at center,#1565c0 0%,#0d3b6e 60%,#071f3a 100%)" },
    { id:"purple",  name:"Ночь",    price:150,  color:"radial-gradient(ellipse at center,#4a148c 0%,#2a0a5e 60%,#120030 100%)" },
    { id:"dark",    name:"Бархат",  price:200,  color:"radial-gradient(ellipse at center,#212121 0%,#111111 60%,#000000 100%)" },
    { id:"gold",    name:"Золото",  price:300,  color:"radial-gradient(ellipse at center,#5d4037 0%,#3e2723 60%,#1c0f0a 100%)" },
  ]
};

function applySkin() {
  const skin = SKINS.table.find(s => s.id === (playerData.skin||"default")) || SKINS.table[0];
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
      applySkin(); checkDailyBonus(); updateHUD();
    }).catch(() => { checkDailyBonus(); updateHUD(); });
  }).catch(() => { checkDailyBonus(); updateHUD(); });
} else {
  checkDailyBonus(); updateHUD();
}

// =============================================
// КОЗЫРЬ И ВАЛЕТЫ
// =============================================

function isJack(card) { return card.rank === "В"; }
function isJC(card)   { return card.rank === "В" && card.suit === "♣"; }

function isTrump(card, trump) {
  return isJack(card) || card.suit === trump;
}

function trumpPower(card) {
  if (card.rank === "В") {
    const j = { "♣":40, "♠":39, "♦":38, "♥":37 };
    return j[card.suit] || 36;
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

// Козырь для игрока по смещению от держателя JC
function trumpForPlayer(playerIndex, jcHolder) {
  const offset = (playerIndex - jcHolder + 4) % 4;
  return TRUMP_FOR_OFFSET[offset];
}

// =============================================
// КОЛОДА
// =============================================

function createDeck() {
  let deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({ suit:s, rank:r })));
  for (let i = deck.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// =============================================
// СОРТИРОВКА: козыри справа налево (сильнейший слева), масти справа налево
// =============================================

function sortHand(hand, trump) {
  const sorted = [...hand].sort((a, b) => {
    const aT = isTrump(a, trump);
    const bT = isTrump(b, trump);
    if (aT && !bT) return -1;
    if (!aT && bT) return 1;
    if (aT && bT) return trumpPower(b) - trumpPower(a); // сильнейший первый
    // некозырные: сортируем по масти, внутри по убыванию
    if (a.suit !== b.suit) return suits.indexOf(a.suit) - suits.indexOf(b.suit);
    return rankPower[b.rank] - rankPower[a.rank];
  });
  // Переворачиваем: отображение идёт справа налево
  // (сильная карта слева = первый в массиве = leftmost при flex-direction:row-reverse)
  return sorted;
}

// =============================================
// СТАРТ ПАРТИИ
// =============================================

function startGame() {
  const deck = createDeck();
  const hands = [
    deck.slice(0,8), deck.slice(8,16), deck.slice(16,24), deck.slice(24,32)
  ];

  // Первая партия: козырь ♣, JC holder = тот у кого JC
  // Последующие: козырь определяется по зафиксированному держателю JC
  let jcHolder = -1;
  for (let i = 0; i < 4; i++) {
    if (hands[i].some(c => isJC(c))) { jcHolder = i; break; }
  }
  if (jcHolder === -1) jcHolder = 0;

  // Первая партия игры: фиксируем держателя JC
  if (gameScore[0] === 0 && gameScore[1] === 0 && jcHolderGlobal === -1) {
    jcHolderGlobal = jcHolder;
  }

  // Козырь определяется по ТЕКУЩЕМУ держателю JC в этой раздаче
  // В первой партии козырь всегда ♣ (держатель JC имеет ♣)
  const trump = trumpForPlayer(jcHolder, jcHolder); // всегда ♣ для держателя

  for (let i = 0; i < 4; i++) {
    hands[i] = sortHand(hands[i], trump);
  }

  state = {
    trump,
    jcHolder,
    hands,
    table: [],
    turn: 0,        // всегда начинает игрок 0 (можно менять)
    scores: [0, 0],
    tricks: [0, 0], // количество взяток [команда 0-2, команда 1-3]
    gameOver: false,
    roundOver: false,
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
    const hasTrump = hand.some(c => isTrump(c, state.trump));
    if (hasTrump && !isTrump(card, state.trump)) return false;
  } else {
    const leadSuit = leadCard.suit;
    const hasSuited = hand.some(c => c.suit === leadSuit && !isTrump(c, state.trump));
    if (hasSuited && (card.suit !== leadSuit || isTrump(card, state.trump))) return false;
  }
  return true;
}

function playCard(playerIndex, card) {
  state.table.push({ playerIndex, card });
  state.turn = nextTurn(playerIndex); // по часовой стрелке

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
  state.tricks[winTeam]++;

  renderScores();
  showStatus(BOT_NAMES[winner.playerIndex] + " берёт взятку (+" + pts + ")");

  setTimeout(() => {
    state.table = [];
    state.turn = winner.playerIndex;
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
// КОНЕЦ ПАРТИИ
// =============================================

function endRound() {
  showAd();

  const s0 = state.scores[0];
  const s1 = state.scores[1];
  const t0 = state.tricks[0]; // взятки команды 0
  const t1 = state.tricks[1]; // взятки команды 1

  const jcTeam = state.jcHolder % 2; // команда держателя JC
  const jcTeamScore   = jcTeam === 0 ? s0 : s1;
  const otherTeamScore= jcTeam === 0 ? s1 : s0;

  let points0 = 0, points1 = 0;
  let roundMsg = "";

  // Проверка: кто-то забрал все взятки
  if (t0 === 8) {
    // Команда 0 забрала все взятки
    gameScore[0] = 12;
    gameScore[1] = 0;
    roundMsg = "🏆 Вы забрали все взятки! Мгновенная победа!";
    renderGameScore();
    showRoundResult(roundMsg, `Счёт игры: Вы 12 : 0 Боты`);
    setTimeout(endGame, 2500);
    return;
  } else if (t1 === 8) {
    // Команда 1 забрала все взятки
    gameScore[0] = 0;
    gameScore[1] = 12;
    roundMsg = "😔 Боты забрали все взятки! Они побеждают!";
    renderGameScore();
    showRoundResult(roundMsg, `Счёт игры: Вы 0 : 12 Боты`);
    setTimeout(endGame, 2500);
    return;
  }

  // Обычный подсчёт
  if (jcTeam === 1) {
    // JC у ботов
    if (jcTeamScore < 30) {
      points0 = 3; points1 = 0;
      roundMsg = "Боты набрали меньше 30! +3 очка вам!";
    } else if (jcTeamScore >= 60) {
      points0 = 0; points1 = 2;
      roundMsg = "Боты победили в партии. +2 очка ботам.";
    } else {
      points0 = 2; points1 = 0;
      roundMsg = "Вы победили в партии! +2 очка!";
    }
  } else {
    // JC у нашей команды
    if (s0 >= 60) {
      if (otherTeamScore > 30) {
        points0 = 1; points1 = 0;
        roundMsg = "Победа, но боты набрали >30. Только +1 очко.";
      } else {
        points0 = 2; points1 = 0;
        roundMsg = "Вы победили в партии! +2 очка!";
      }
    } else {
      points0 = 0; points1 = 2;
      roundMsg = "Боты победили в партии. +2 очка ботам.";
    }
  }

  gameScore[0] += points0;
  gameScore[1] += points1;

  playerData.rating += points0 > points1 ? 10 : -5;
  playerData.coins  += points0 > points1 ? 8  :  3;
  if (playerData.rating < 0) playerData.rating = 0;
  saveData();

  renderGameScore();
  showRoundResult(roundMsg, `Счёт игры: Вы ${gameScore[0]} : ${gameScore[1]} Боты`);

  // Автоматически начинаем следующую партию через 3 секунды
  if (gameScore[0] >= 12 || gameScore[1] >= 12) {
    setTimeout(endGame, 3000);
  } else {
    setTimeout(() => {
      document.getElementById("roundResult").style.display = "none";
      startGame();
    }, 3000);
  }
}

function showRoundResult(title, sub) {
  document.getElementById("roundResultText").innerText = title;
  document.getElementById("roundScoreText").innerText = sub;
  document.getElementById("roundResult").style.display = "flex";
}

function endGame() {
  const weWon = gameScore[0] >= 12;
  playerData.rating += weWon ? 50 : -20;
  playerData.coins  += weWon ? 50 :  10;
  if (playerData.rating < 0) playerData.rating = 0;
  saveData();

  document.getElementById("roundResult").style.display = "none";
  const div  = document.getElementById("result");
  const text = document.getElementById("resultText");
  text.innerText = (weWon ? "🏆 Победа в игре!" : "😔 Поражение в игре.") +
    `\nСчёт: Вы ${gameScore[0]} : ${gameScore[1]} Боты`;
  div.style.display = "flex";
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
  const valid = hand.filter(c => isValidPlay(botIndex, c));

  if (state.table.length === 0) {
    // Первый ход — слабую некозырную
    const nonTrump = valid.filter(c => !isTrump(c, trump));
    const pool = nonTrump.length > 0 ? nonTrump : valid;
    return pool[pool.length - 1];
  }

  const leadSuit = state.table[0].card.suit;
  const currentWinner = state.table.reduce((best, e) =>
    compareCards(e.card, best.card, leadSuit, trump) > 0 ? e : best, state.table[0]);
  const partnerWinning = currentWinner.playerIndex % 2 === botIndex % 2;

  if (partnerWinning) {
    return valid[valid.length - 1]; // скидываем слабую
  }

  const winning = valid.filter(c => compareCards(c, currentWinner.card, leadSuit, trump) > 0);
  if (winning.length > 0) return winning[winning.length - 1];
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

  // Отображаем справа налево: последний элемент массива — крайний левый на экране
  // Используем flex-direction: row-reverse в CSS
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

// Позиции карт на столе — ромбом
// 0=низ(я), 1=лево, 2=верх, 3=право
const TABLE_POSITIONS = [
  { top:"60%", left:"50%", transform:"translate(-50%, 0)" },      // 0 = я
  { top:"38%", left:"32%", transform:"translate(-100%, -50%)" },  // 1 = лево
  { top:"18%", left:"50%", transform:"translate(-50%, 0)" },      // 2 = верх
  { top:"38%", left:"68%", transform:"translate(0, -50%)" },      // 3 = право
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
  // 0=низ(я), 1=лево, 2=верх, 3=право
  const positions = [
    { el: document.querySelector(".player.me"),    index: 0 },
    { el: document.querySelector(".player.left"),  index: 1 },
    { el: document.querySelector(".player.top"),   index: 2 },
    { el: document.querySelector(".player.right"), index: 3 },
  ];

  positions.forEach(({ el, index }) => {
    if (!el) return;
    const cards = state ? state.hands[index].length : 0;
    const isActive = state && state.turn === index && !state.gameOver && !state.roundOver;
    const isJCH = state && state.jcHolder === index;
    el.innerText = BOT_NAMES[index] + (state ? ` (${cards})` : "") + (isJCH ? " ♣J" : "");
    el.style.color = isActive ? "#FFD700" : "white";
    el.style.fontWeight = isActive ? "bold" : "normal";
    el.style.textShadow = isActive ? "0 0 8px #FFD700" : "none";
  });
}

function renderTrump() {
  const el = document.getElementById("trump");
  if (!el || !state) return;
  const c = { "♥":"#ff5555","♦":"#ff5555","♣":"#aaffaa","♠":"#aaaaff" };
  el.innerHTML = `Козырь: <span style="color:${c[state.trump]||'#fff'};font-size:22px">${state.trump}</span>`;
}

function renderScores() {
  const el = document.getElementById("scores");
  if (el && state) el.innerText = `Партия — Вы: ${state.scores[0]} | Боты: ${state.scores[1]}`;
}

function renderGameScore() {
  const el = document.getElementById("gameScore");
  if (el) el.innerHTML = `Игра: <b>${gameScore[0]}</b> : <b>${gameScore[1]}</b> (до 12)`;
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

function openShop()  { renderShop(); document.getElementById("shop").style.display = "flex"; }
function closeShop() { document.getElementById("shop").style.display = "none"; }

function buySkin(skinId) {
  const skin = SKINS.table.find(s => s.id === skinId);
  if (!skin) return;
  if (skin.price > 0 && playerData.coins < skin.price) {
    showStatus("Не хватает монет!"); setTimeout(() => showStatus(""), 2000); return;
  }
  playerData.coins -= skin.price;
  playerData.skin = skinId;
  saveData(); applySkin(); renderShop();
  showStatus("Скин применён!"); setTimeout(() => showStatus(""), 2000);
}

function renderShop() {
  const container = document.getElementById("shopItems");
  if (!container) return;
  container.innerHTML = "";

  SKINS.table.forEach(skin => {
    const active = playerData.skin === skin.id;
    const canAfford = playerData.coins >= skin.price;

    const item = document.createElement("div");
    item.className = "shop-item";
    item.style.background = skin.color;

    const name = document.createElement("div");
    name.className = "shop-item-name";
    name.innerText = skin.name;

    const btn = document.createElement("button");
    btn.className = "btn shop-btn";

    if (active) {
      btn.innerText = "✓ Выбран"; btn.disabled = true;
      btn.style.background = "rgba(100,200,100,0.5)";
    } else if (canAfford || skin.price === 0) {
      btn.innerText = skin.price === 0 ? "Выбрать" : `${skin.price} 💰`;
      btn.onclick = () => buySkin(skin.id);
    } else {
      btn.innerText = `${skin.price} 💰`; btn.disabled = true; btn.style.opacity = "0.5";
    }

    item.appendChild(name); item.appendChild(btn); container.appendChild(item);
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
      onRewarded: () => { playerData.coins += 100; saveData(); showStatus("+100 монет!"); setTimeout(() => showStatus(""), 2000); },
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
    jcHolderGlobal = -1;
    startGame();
  };
  document.getElementById("restart").onclick = () => {
    gameScore = [0, 0];
    jcHolderGlobal = -1;
    document.getElementById("result").style.display = "none";
    startGame();
  };
  document.getElementById("rewardAd").onclick = watchAdForCoins;
  document.getElementById("shopBtn").onclick = openShop;
  document.getElementById("shopClose").onclick = closeShop;

  applySkin(); updateHUD(); renderGameScore();
});
