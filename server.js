// Козёл: online server. Serves the game page and runs rooms over WebSocket.
// The server owns the deck and the rules; each player only ever receives their own hand.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./engine.js');

const PORT = process.env.PORT || 3000;
const PAGE = path.join(__dirname, 'public', 'index.html');
const NAMES_BOT = ['Бот Запад', 'Бот Север', 'Бот Восток', 'Бот Юг'];
const BOT_DELAY = 1100; // ms between a bot's turn and its move (clients animate meanwhile)
const NEXT_TIMEOUT = 45000; // start the next round even if someone does not press "Дальше"
const ROOM_TTL = 30 * 60 * 1000; // empty rooms are removed after 30 minutes

const rooms = new Map();

/* ---------- HTTP: the game page ---------- */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const STATIC = { '/manifest.webmanifest': 'application/manifest+json', '/sw.js': 'application/javascript', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png' };
  if (STATIC[url]) {
    fs.readFile(path.join(__dirname, 'public', url), (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': STATIC[url], 'cache-control': url === '/sw.js' ? 'no-cache' : 'public, max-age=86400' });
      res.end(buf);
    });
    return;
  }
  if (url === '/' || url === '/index.html') {
    fs.readFile(PAGE, (err, buf) => {
      if (err) { res.writeHead(500); res.end('page missing'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

/* ---------- rooms ---------- */
function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join(''); } while (rooms.has(c));
  return c;
}
function makeRoom() {
  const room = {
    code: newCode(), host: null, level: 2,
    seats: [null, null, null, null], // {pid, name, ws} for humans; null = bot
    phase: 'lobby', m: null, st: null, log: [], round: 0, carry: 0,
    ready: new Set(), timer: null, last: Date.now(), roundEnd: null,
  };
  rooms.set(room.code, room);
  return room;
}
const seatOf = (room, pid) => room.seats.findIndex((s) => s && s.pid === pid);
const isBot = (room, s) => !room.seats[s] || !room.seats[s].ws; // empty or disconnected seats play as bots
const nameOf = (room, s) => (room.seats[s] ? room.seats[s].name : NAMES_BOT[(s + 3) % 4]);

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function eachHuman(room, fn) { room.seats.forEach((p, s) => { if (p && p.ws) fn(p, s); }); }

function lobbyMsg(room) {
  return {
    t: 'lobby', code: room.code, phase: room.phase, level: room.level,
    host: room.host,
    seats: room.seats.map((p, s) => ({ name: nameOf(room, s), human: !!p, online: !!(p && p.ws), pid: p ? p.pid : null })),
  };
}
function broadcastLobby(room) { eachHuman(room, (p) => send(p.ws, lobbyMsg(room))); }

// Everything a player at `seat` may see right now.
function viewFor(room, seat) {
  const st = room.st;
  return {
    t: 'state', round: room.round, seat,
    names: [0, 1, 2, 3].map((s) => nameOf(room, s)),
    humans: room.seats.map((p) => !!p),
    hand: st.hands[seat].slice(),
    counts: st.hands.map((h) => h.length),
    chain: st.chain, ends: st.ends, played: st.played,
    turn: st.turn, starter: st.starter, mustOpenWith11: st.mustOpenWith11, passes: st.passes,
    over: st.over,
    score: room.m.score, pend: room.m.pend, rounds: room.m.rounds, open: room.m.open,
    carry: room.carry, level: room.level,
    roundEnd: room.phase === 'roundEnd' || room.phase === 'gameOver' ? room.roundEnd : null,
  };
}
function sendState(room, fresh) {
  eachHuman(room, (p, s) => send(p.ws, Object.assign(viewFor(room, s), { fresh: !!fresh })));
}

/* ---------- game flow ---------- */
function startMatch(room) {
  room.m = D.newMatch();
  room.round = 0; room.carry = 0;
  beginRound(room, null);
}
function beginRound(room, starter) {
  clearTimeout(room.timer);
  room.round++;
  room.st = D.newRound({ starter });
  room.log = [];
  room.phase = 'playing';
  room.ready.clear();
  room.roundEnd = null;
  sendState(room, true);
  // clients play the shuffle animation first
  room.timer = setTimeout(() => step(room), 2400);
}
function step(room) {
  clearTimeout(room.timer);
  const st = room.st;
  if (room.phase !== 'playing') return;
  if (st.over) return finishRound(room);
  const seat = st.turn;
  const moves = D.legalMoves(st.hands[seat], st.ends, st.mustOpenWith11);
  if (isBot(room, seat)) {
    room.timer = setTimeout(() => {
      const mv = D.botChoose(st, seat, room.level, room.log);
      if (mv) play(room, seat, mv); else doPass(room, seat);
    }, BOT_DELAY + Math.random() * 400);
    return;
  }
  if (!moves.length) {
    // the player presses "Пропуск" (or their page passes automatically); fallback if they never do
    room.timer = setTimeout(() => doPass(room, seat), 60000);
  }
  // otherwise wait for the player's move
}
function play(room, seat, mv) {
  const st = room.st;
  const r = D.applyMove(st, mv);
  eachHuman(room, (p) => send(p.ws, { t: 'played', seat, bone: r.bone, side: r.side }));
  room.last = Date.now();
  room.timer = setTimeout(() => step(room), st.over ? 900 : 650);
}
function doPass(room, seat) {
  const st = room.st;
  room.log.push({ pass: true, seat, ends: st.ends.slice() });
  D.pass(st);
  eachHuman(room, (p) => send(p.ws, { t: 'pass', seat }));
  room.timer = setTimeout(() => step(room), 700);
}
function finishRound(room) {
  const st = room.st, r = st.result;
  let loseTeam = null, pts = 0, carried = 0;
  if (r.kind === 'out' || !r.draw) { loseTeam = r.loseTeam; carried = room.carry; pts = r.points + carried; room.carry = 0; }
  else room.carry += r.total;
  const info = D.scoreRound(room.m, loseTeam, pts);
  const gameEnd = room.m.score[0] >= 101 || room.m.score[1] >= 101;
  // next starter: winner after going out; after a fish whoever made it; 1:1 again while nobody has points
  let next;
  if (room.m.score[0] === 0 && room.m.score[1] === 0) next = null;
  else if (r.kind === 'out') next = r.winner;
  else next = D.fishMaker(st);
  room.next = next;
  room.roundEnd = { result: r, hands: st.hands, loseTeam, pts, carried, info, carry: room.carry, gameEnd };
  room.phase = gameEnd ? 'gameOver' : 'roundEnd';
  room.ready.clear();
  eachHuman(room, (p) => send(p.ws, Object.assign({ t: 'roundEnd' }, room.roundEnd, {
    score: room.m.score, pend: room.m.pend, rounds: room.m.rounds, open: room.m.open,
  })));
  if (!gameEnd) room.timer = setTimeout(() => beginRound(room, room.next), NEXT_TIMEOUT);
}
function maybeNext(room) {
  if (room.phase !== 'roundEnd') return;
  let all = true;
  eachHuman(room, (p) => { if (!room.ready.has(p.pid)) all = false; });
  if (all) beginRound(room, room.next);
}

/* ---------- messages ---------- */
function onMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') return;
  const name = String(msg.name || '').trim().slice(0, 16) || 'Игрок';
  if (msg.t === 'create') {
    const room = makeRoom();
    const pid = msg.pid || crypto.randomUUID();
    room.host = pid;
    room.seats[0] = { pid, name, ws };
    ws.room = room; ws.pid = pid;
    send(ws, { t: 'joined', code: room.code, pid });
    broadcastLobby(room);
    return;
  }
  if (msg.t === 'join') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'error', text: 'Комната не найдена. Проверьте код.' });
    const pid = msg.pid || crypto.randomUUID();
    let s = seatOf(room, pid);
    if (s >= 0) {
      // the same player coming back: take the seat over again
      const old = room.seats[s].ws;
      if (old && old !== ws) { old.room = null; try { old.close(); } catch (e) {} }
      room.seats[s].ws = ws; room.seats[s].name = name;
    } else {
      if (room.phase !== 'lobby') {
        // mid-game newcomers may take a seat that a bot is playing
        s = room.seats.findIndex((p) => !p);
        if (s < 0) return send(ws, { t: 'error', text: 'Все места заняты.' });
      } else {
        s = room.seats.findIndex((p) => !p);
        if (s < 0) return send(ws, { t: 'error', text: 'Все четыре места заняты.' });
      }
      room.seats[s] = { pid, name, ws };
    }
    ws.room = room; ws.pid = pid;
    if (!room.host || seatOf(room, room.host) < 0) room.host = pid;
    send(ws, { t: 'joined', code: room.code, pid });
    broadcastLobby(room);
    if (room.phase !== 'lobby') {
      send(ws, Object.assign(viewFor(room, s), { fresh: false }));
      // a human took over from a bot mid-turn: let them move
      if (room.phase === 'playing') step(room);
    }
    return;
  }
  const room = ws.room;
  if (!room) return;
  room.last = Date.now();
  const me = seatOf(room, ws.pid);
  if (me < 0) return;
  const host = room.host === ws.pid;
  switch (msg.t) {
    case 'seat': { // move to an empty seat in the lobby
      const s = msg.seat | 0;
      if (room.phase !== 'lobby' || s < 0 || s > 3 || room.seats[s]) return;
      room.seats[s] = room.seats[me]; room.seats[me] = null;
      broadcastLobby(room);
      break;
    }
    case 'level':
      if (host && room.phase === 'lobby') { room.level = Math.max(0, Math.min(3, msg.level | 0)); broadcastLobby(room); }
      break;
    case 'start':
      if (host && room.phase === 'lobby') startMatch(room);
      break;
    case 'move': {
      const st = room.st;
      if (room.phase !== 'playing' || !st || st.over || st.turn !== me) return;
      const bone = msg.bone || [];
      const i = st.hands[me].findIndex((b) => (b[0] === bone[0] && b[1] === bone[1]) || (b[0] === bone[1] && b[1] === bone[0]));
      const legal = D.legalMoves(st.hands[me], st.ends, st.mustOpenWith11).filter((m) => m.i === i);
      let mv = legal.find((m) => m.side === msg.side) || null;
      if (!mv && st.ends && st.ends[0] === st.ends[1]) mv = legal[0] || null;
      if (!mv) return send(ws, Object.assign(viewFor(room, me), { fresh: false, resync: true }));
      clearTimeout(room.timer);
      play(room, me, mv);
      break;
    }
    case 'pass': {
      const st = room.st;
      if (room.phase !== 'playing' || !st || st.over || st.turn !== me) return;
      if (D.legalMoves(st.hands[me], st.ends, st.mustOpenWith11).length) return;
      clearTimeout(room.timer);
      doPass(room, me);
      break;
    }
    case 'next':
      room.ready.add(ws.pid);
      maybeNext(room);
      break;
    case 'again':
      if (host && room.phase === 'gameOver') startMatch(room);
      break;
    case 'leave':
      room.seats[me] = null;
      ws.room = null;
      if (room.host === ws.pid) { const h = room.seats.find((p) => p); room.host = h ? h.pid : null; }
      broadcastLobby(room);
      if (room.phase === 'playing') step(room);
      if (room.phase === 'roundEnd') maybeNext(room);
      break;
    case 'chat': {
      const text = String(msg.text || '').slice(0, 40);
      if (text) eachHuman(room, (p) => send(p.ws, { t: 'chat', seat: me, text }));
      break;
    }
    default:
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch (e) { return; }
    try { onMessage(ws, msg); } catch (e) { console.error(e); }
  });
  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    const s = seatOf(room, ws.pid);
    if (s >= 0 && room.seats[s].ws === ws) {
      if (room.phase === 'lobby') {
        room.seats[s] = null;
        if (room.host === ws.pid) { const h = room.seats.find((p) => p); room.host = h ? h.pid : null; }
      } else {
        room.seats[s].ws = null; // a bot plays until they return
        if (room.phase === 'playing' && room.st && room.st.turn === s) step(room);
        if (room.phase === 'roundEnd') maybeNext(room);
      }
      broadcastLobby(room);
    }
  });
});
// keep connections alive through proxies, drop dead ones, and clean up empty rooms
setInterval(() => {
  wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) {} });
  const now = Date.now();
  rooms.forEach((room, code) => {
    let anyone = false; eachHuman(room, () => { anyone = true; });
    if (!anyone && now - room.last > ROOM_TTL) { clearTimeout(room.timer); rooms.delete(code); }
    if (anyone) room.last = Math.max(room.last, now - 1);
  });
}, 25000);

server.listen(PORT, () => console.log('Козёл: http://localhost:' + PORT));
