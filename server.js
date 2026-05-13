const WebSocket = require("ws");

const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port });
console.log("Сервер запущен на порту", port);

let rooms = [];
let roomsByCode = {};

function createDeck() {
  const suits = ["♣","♥","♠","♦"];
  const ranks = ["7","8","9","Д","К","10","Т","В"];
  let deck = [];

  suits.forEach(s => {
    ranks.forEach(r => {
      deck.push({suit:s, rank:r});
    });
  });

  return shuffle(deck);
}

function shuffle(deck) {
  // Алгоритм Фишера-Йетса — равномерное перемешивание
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const pointsMap = {
  "Т":11, "10":10, "К":4, "Д":3, "В":2
};

const rankPower = {
  "7":1,"8":2,"9":3,"Д":4,"К":5,"10":6,"Т":7,"В":8
};

function isTrump(card, trump) {
  return card.rank === "В" || card.suit === trump;
}

function compare(a, b, leadSuit, trump) {
  if (isTrump(a, trump) && !isTrump(b, trump)) return 1;
  if (!isTrump(a, trump) && isTrump(b, trump)) return -1;

  if (a.suit === b.suit) {
    return rankPower[a.rank] - rankPower[b.rank];
  }

  if (a.suit === leadSuit) return 1;
  if (b.suit === leadSuit) return -1;

  return 0;
}

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

wss.on("connection", (ws) => {
  ws.room = null;

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch(e) {
      return;
    }

    if (data.type === "quick") {
      // Быстрая игра — найти открытую комнату или создать новую
      let room = rooms.find(r => r.open && r.players.length < 4);
      if (!room) {
        room = { players: [], state: null, open: true, code: null };
        rooms.push(room);
      }
      joinRoom(ws, room);

    } else if (data.type === "createRoom") {
      // Создать приватную комнату с кодом
      const code = generateRoomCode();
      const room = { players: [], state: null, open: false, code };
      rooms.push(room);
      roomsByCode[code] = room;
      joinRoom(ws, room);
      ws.send(JSON.stringify({ type: "roomCreated", roomId: code }));

    } else if (data.type === "joinRoom") {
      // Войти по коду
      const room = roomsByCode[data.roomId];
      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "Комната не найдена" }));
        return;
      }
      if (room.players.length >= 4) {
        ws.send(JSON.stringify({ type: "error", message: "Комната заполнена" }));
        return;
      }
      joinRoom(ws, room);

    } else if (data.type === "play") {
      handlePlay(ws, data.card);
    }
  });

  ws.on("close", () => {
    const room = ws.room;
    if (!room) return;
    // Уведомить остальных об отключении
    room.players = room.players.filter(p => p !== ws);
    broadcast(room, { type: "playerLeft" });
    // Убрать пустые комнаты
    rooms = rooms.filter(r => r.players.length > 0);
    if (room.code) delete roomsByCode[room.code];
  });
});

function joinRoom(ws, room) {
  room.players.push(ws);
  ws.room = room;

  // Сообщить всем сколько игроков
  broadcast(room, {
    type: "roomUpdate",
    players: room.players.length
  });

  if (room.players.length === 4) {
    startGame(room);
  }
}

function startGame(room) {
  const deck = createDeck();
  const suits = ["♣","♥","♠","♦"];

  // FIX: козырь выбирается случайно
  const trump = suits[Math.floor(Math.random() * suits.length)];

  room.state = {
    trump,
    hands: [],
    table: [],
    turn: 0,
    scores: [0, 0]
  };

  room.players.forEach((p, i) => {
    const hand = deck.slice(i * 8, i * 8 + 8);
    room.state.hands[i] = hand;

    p.send(JSON.stringify({
      type: "start",
      hand,
      playerIndex: i,
      trump
    }));
  });
}

function handlePlay(ws, card) {
  const room = ws.room;
  if (!room || !room.state) return;

  const state = room.state;
  const playerIndex = room.players.indexOf(ws);

  if (playerIndex !== state.turn) return;

  // FIX: удаляем карту из руки игрока
  const handBefore = state.hands[playerIndex].length;
  state.hands[playerIndex] = state.hands[playerIndex].filter(
    c => !(c.rank === card.rank && c.suit === card.suit)
  );
  // Карта не найдена в руке — читерство или ошибка
  if (state.hands[playerIndex].length === handBefore) return;

  state.table.push({ playerIndex, card });
  state.turn = (state.turn + 1) % 4;

  if (state.table.length === 4) {
    // FIX: сначала отправляем финальный стол, потом резолвим
    broadcast(room, {
      type: "update",
      table: state.table,
      turn: state.turn
    });
    resolveTrick(room);
  } else {
    broadcast(room, {
      type: "update",
      table: state.table,
      turn: state.turn
    });
  }
}

function resolveTrick(room) {
  const state = room.state;
  const leadSuit = state.table[0].card.suit;

  let winner = state.table[0];

  state.table.forEach(entry => {
    if (compare(entry.card, winner.card, leadSuit, state.trump) > 0) {
      winner = entry;
    }
  });

  let trickPoints = 0;
  state.table.forEach(e => {
    trickPoints += pointsMap[e.card.rank] || 0;
  });

  const team = winner.playerIndex % 2;
  state.scores[team] += trickPoints;

  state.turn = winner.playerIndex;
  state.table = [];

  // FIX: проверяем руку победителя взятки, а не только игрока 0
  if (state.hands[winner.playerIndex].length === 0) {
    endRound(room);
  } else {
    // Сообщить кто забрал взятку и чей ход
    broadcast(room, {
      type: "trickWon",
      winnerIndex: winner.playerIndex,
      scores: state.scores,
      turn: state.turn
    });
  }
}

function endRound(room) {
  const state = room.state;

  broadcast(room, {
    type: "end",
    result: { scores: state.scores }
  });

  // Почистить комнату для возможной переигровки
  room.state = null;
  room.open = true;
}

function broadcast(room, data) {
  room.players.forEach(p => {
    if (p.readyState === WebSocket.OPEN) {
      p.send(JSON.stringify(data));
    }
  });
}
