// Domino "Kozel" engine: 4 seats, teams 0&2 vs 1&3. Seat 0 = human (south), 1 = west, 2 = north (partner), 3 = east.
(function (root) {
  const TEAM = (s) => s % 2;
  const pips = (b) => b[0] + b[1];
  const isDouble = (b) => b[0] === b[1];

  function allBones() {
    const r = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) r.push([a, b]);
    return r;
  }
  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function deal(rnd) {
    const s = shuffle(allBones(), rnd);
    return [0, 1, 2, 3].map((i) => s.slice(i * 7, i * 7 + 7));
  }

  // chain: array of {a, b} oriented left-to-right; ends: [leftValue, rightValue] or null
  function newRound(opts) {
    opts = opts || {};
    const hands = deal(opts.rnd);
    let starter = opts.starter;
    let mustOpenWith11 = false;
    if (starter == null) {
      starter = hands.findIndex((h) => h.some((b) => b[0] === 1 && b[1] === 1));
      mustOpenWith11 = true;
    }
    return {
      hands,
      chain: [],
      ends: null,
      turn: starter,
      starter,
      mustOpenWith11,
      passes: 0,
      over: false,
      result: null,
      played: [], // log of {seat, bone, side}
    };
  }

  function legalMoves(hand, ends, mustOpenWith11) {
    const m = [];
    if (!ends) {
      hand.forEach((b, i) => {
        if (mustOpenWith11 && !(b[0] === 1 && b[1] === 1)) return;
        m.push({ i, side: 'R' });
      });
      return m;
    }
    hand.forEach((b, i) => {
      if (b[0] === ends[0] || b[1] === ends[0]) m.push({ i, side: 'L' });
      if (ends[0] !== ends[1] || true) {
        if (b[0] === ends[1] || b[1] === ends[1]) m.push({ i, side: 'R' });
      }
    });
    return m;
  }

  function clone(st) {
    return {
      hands: st.hands.map((h) => h.map((b) => b.slice())),
      chain: st.chain.map((c) => ({ a: c.a, b: c.b })),
      ends: st.ends ? st.ends.slice() : null,
      turn: st.turn,
      starter: st.starter,
      mustOpenWith11: st.mustOpenWith11,
      passes: st.passes,
      over: st.over,
      result: st.result,
      played: st.played.slice(),
    };
  }

  // A lone 0:0 left in hand counts as 10 points instead of 0.
  function sumHand(h) {
    if (h.length === 1 && h[0][0] === 0 && h[0][1] === 0) return 10;
    return h.reduce((s, b) => s + pips(b), 0);
  }

  // Apply a move for st.turn. mv = {i, side}. Mutates st. Returns info.
  function applyMove(st, mv) {
    const seat = st.turn;
    const bone = st.hands[seat].splice(mv.i, 1)[0];
    let piece;
    if (!st.ends) {
      piece = { a: bone[0], b: bone[1] };
      st.chain.push(piece);
      st.ends = [bone[0], bone[1]];
    } else if (mv.side === 'L') {
      const v = st.ends[0];
      const other = bone[0] === v ? bone[1] : bone[0];
      piece = { a: other, b: v };
      st.chain.unshift(piece);
      st.ends[0] = other;
    } else {
      const v = st.ends[1];
      const other = bone[0] === v ? bone[1] : bone[0];
      piece = { a: v, b: other };
      st.chain.push(piece);
      st.ends[1] = other;
    }
    st.mustOpenWith11 = false;
    st.passes = 0;
    st.played.push({ seat, bone, side: mv.side });
    if (st.hands[seat].length === 0) {
      finishOut(st, seat, bone);
    } else if (!st.noFishCheck && st.hands.every((h) => !legalMoves(h, st.ends, false).length)) {
      // nobody can move any more: the fish ends the round at once
      st.turn = (seat + 1) % 4;
      finishFish(st);
    } else {
      st.turn = (seat + 1) % 4;
    }
    return { seat, bone, piece, side: mv.side };
  }

  function finishOut(st, seat, lastBone) {
    const winTeam = TEAM(seat);
    const loseTeam = 1 - winTeam;
    let pts = 0;
    [0, 1, 2, 3].forEach((s) => {
      if (TEAM(s) === loseTeam) pts += sumHand(st.hands[s]);
    });
    let bonus = 0;
    st.over = true;
    st.result = { kind: 'out', winner: seat, winTeam, loseTeam, points: pts + bonus, bonus, handPoints: pts };
  }

  function pass(st) {
    st.passes++;
    st.turn = (st.turn + 1) % 4;
    if (st.passes >= 4) finishFish(st);
  }

  function finishFish(st) {
    // The team with the lower combined total of its two hands wins; the whole sum
    // of all four hands is written to the losing team. Equal totals: a draw.
    const sums = st.hands.map(sumHand);
    const total = sums.reduce((a, b) => a + b, 0);
    const teamSums = [sums[0] + sums[2], sums[1] + sums[3]];
    st.over = true;
    if (teamSums[0] === teamSums[1]) {
      st.result = { kind: 'fish', draw: true, points: 0, total, sums, teamSums };
    } else {
      const winTeam = teamSums[0] < teamSums[1] ? 0 : 1;
      const mates = [winTeam, winTeam + 2];
      const winner = sums[mates[0]] <= sums[mates[1]] ? mates[0] : mates[1];
      st.result = { kind: 'fish', draw: false, winTeam, loseTeam: 1 - winTeam, winner, points: total, total, sums, teamSums };
    }
  }

  function hasMove(st, seat) {
    return legalMoves(st.hands[seat], st.ends, st.mustOpenWith11 && seat === st.turn).length > 0;
  }

  // ---------- Bots ----------
  function countSeen(st, forSeat) {
    // count how many of each suit are visible to forSeat (own hand + board)
    const c = [0, 0, 0, 0, 0, 0, 0];
    st.played.forEach((p) => {
      c[p.bone[0]]++;
      if (p.bone[1] !== p.bone[0]) c[p.bone[1]]++;
      else c[p.bone[0]] += 0;
    });
    st.hands[forSeat].forEach((b) => {
      c[b[0]]++;
      if (b[1] !== b[0]) c[b[1]]++;
    });
    return c;
  }

  // Which suits each seat has shown to lack (passed when that suit was an end)
  function buildVoids(log) {
    const voids = [new Set(), new Set(), new Set(), new Set()];
    (log || []).forEach((e) => {
      if (e.pass) e.ends.forEach((v) => voids[e.seat].add(v));
    });
    return voids;
  }

  function simulateEnd(st, mv) {
    const s = clone(st);
    applyMove(s, mv);
    return s;
  }

  function moveKey(hand, mv) {
    return hand[mv.i];
  }

  function chooseRandom(st, seat, moves) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  function chooseGreedy(st, seat, moves) {
    // play heaviest bone, prefer doubles
    let best = null;
    let bs = -1;
    moves.forEach((mv) => {
      const b = st.hands[seat][mv.i];
      const sc = pips(b) + (isDouble(b) ? 3 : 0) + Math.random() * 0.5;
      if (sc > bs) {
        bs = sc;
        best = mv;
      }
    });
    return best;
  }

  function evalMove(st, seat, mv, ctx) {
    const hand = st.hands[seat];
    const b = hand[mv.i];
    let score = 0;
    const rest = hand.filter((_, i) => i !== mv.i);
    // dump heavy bones
    score += pips(b) * 1.0;
    if (isDouble(b)) score += 3;
    // resulting ends
    let nl, nr;
    if (!st.ends) {
      nl = b[0];
      nr = b[1];
    } else if (mv.side === 'L') {
      nl = b[0] === st.ends[0] ? b[1] : b[0];
      nr = st.ends[1];
    } else {
      nr = b[0] === st.ends[1] ? b[1] : b[0];
      nl = st.ends[0];
    }
    const mySuits = new Array(7).fill(0);
    rest.forEach((x) => {
      mySuits[x[0]]++;
      if (x[1] !== x[0]) mySuits[x[1]]++;
    });
    // keep ends we can continue on
    score += (mySuits[nl] + mySuits[nr]) * 1.5;
    if (rest.length && mySuits[nl] === 0 && mySuits[nr] === 0) score -= 4;
    // exploit opponents' voids; help partner voids
    const next = (seat + 1) % 4;
    const prev = (seat + 3) % 4;
    const partner = (seat + 2) % 4;
    [nl, nr].forEach((v) => {
      if (ctx.voids[next].has(v)) score += 3;
      if (ctx.voids[prev].has(v)) score += 3;
      if (ctx.voids[partner].has(v)) score -= 4;
    });
    // how many of this suit are left unseen (fewer = more likely to block)
    [nl, nr].forEach((v) => {
      const left = 7 - ctx.seen[v];
      if (left <= 1) score += 1.5;
    });
    // opening: prefer suit we hold many of
    if (!st.ends) score += mySuits[b[0]] * 1 + mySuits[b[1]] * 1;
    // going out sooner
    if (rest.length === 0) score += 100;
    if (rest.length === 1) score += 2;
    return score + Math.random() * 0.3;
  }

  function chooseHeuristic(st, seat, moves, log) {
    const ctx = { voids: buildVoids(log), seen: countSeen(st, seat) };
    let best = null;
    let bs = -1e9;
    moves.forEach((mv) => {
      const sc = evalMove(st, seat, mv, ctx);
      if (sc > bs) {
        bs = sc;
        best = mv;
      }
    });
    return best;
  }

  // Determinize hidden hands consistent with voids, then roll out with heuristic-lite policy.
  function determinize(st, seat, voids) {
    const known = new Set();
    st.played.forEach((p) => known.add(p.bone[0] * 10 + p.bone[1]));
    st.hands[seat].forEach((b) => known.add(b[0] * 10 + b[1]));
    const pool = allBones().filter((b) => !known.has(b[0] * 10 + b[1]));
    const others = [0, 1, 2, 3].filter((s) => s !== seat);
    const sizes = {};
    others.forEach((s) => (sizes[s] = st.hands[s].length));
    for (let attempt = 0; attempt < 30; attempt++) {
      const p = shuffle(pool.slice());
      const hands = {};
      let ok = true;
      let idx = 0;
      for (const s of others) {
        const h = p.slice(idx, idx + sizes[s]);
        idx += sizes[s];
        if (h.some((b) => voids[s].has(b[0]) || voids[s].has(b[1]))) {
          ok = false;
          break;
        }
        hands[s] = h;
      }
      if (ok) return hands;
      if (attempt === 29) {
        const p2 = shuffle(pool.slice());
        let i2 = 0;
        const hh = {};
        for (const s of others) {
          hh[s] = p2.slice(i2, i2 + sizes[s]);
          i2 += sizes[s];
        }
        return hh;
      }
    }
  }

  function rolloutMove(s, seat) {
    const moves = legalMoves(s.hands[seat], s.ends, false);
    if (!moves.length) return null;
    let best = moves[0];
    let bs = -1;
    for (const mv of moves) {
      const b = s.hands[seat][mv.i];
      const sc = pips(b) + (isDouble(b) ? 2 : 0) + Math.random() * 3;
      if (sc > bs) {
        bs = sc;
        best = mv;
      }
    }
    return best;
  }

  function rollout(s, seat) {
    let guard = 0;
    while (!s.over && guard++ < 60) {
      const mv = rolloutMove(s, s.turn);
      if (mv) applyMove(s, mv);
      else pass(s);
    }
    // value for team of seat: positive = good (opponents take points)
    const r = s.result;
    if (!r || r.draw) return 0;
    const myTeam = TEAM(seat);
    return r.loseTeam === myTeam ? -r.points : r.points;
  }

  function chooseMonteCarlo(st, seat, moves, log, iterations) {
    const voids = buildVoids(log);
    // collapse equivalent moves (same bone, same resulting ends) cheaply: keep all
    const totals = new Array(moves.length).fill(0);
    const n = iterations || 40;
    for (let k = 0; k < n; k++) {
      const hid = determinize(st, seat, voids);
      for (let m = 0; m < moves.length; m++) {
        const s = clone(st);
        Object.keys(hid).forEach((sd) => (s.hands[sd] = hid[sd].map((b) => b.slice())));
        s.mustOpenWith11 = false;
        applyMove(s, moves[m]);
        totals[m] += rollout(s, seat);
      }
    }
    let bi = 0;
    for (let m = 1; m < moves.length; m++) if (totals[m] > totals[bi]) bi = m;
    // light heuristic tie-break
    return moves[bi];
  }

  // ---------- Expert: memory, partner awareness, Monte-Carlo ----------
  const expertConfig = { lambda: 1.0, iters: 45, itersLate: 80 };

  // What the player can infer: unseen bones, suits each seat passed on (voids), and how
  // many bones of each suit every other seat probably holds.
  function beliefs(st, seat, log) {
    const voids = buildVoids(log);
    const known = new Set();
    st.played.forEach((p) => known.add(p.bone[0] * 10 + p.bone[1]));
    st.hands[seat].forEach((b) => known.add(b[0] * 10 + b[1]));
    const unseen = allBones().filter((b) => !known.has(b[0] * 10 + b[1]));
    const others = [0, 1, 2, 3].filter((x) => x !== seat);
    const cnt = {};
    const strength = {};
    others.forEach((x) => { cnt[x] = st.hands[x].length; strength[x] = new Array(7).fill(0); });
    unseen.forEach((b) => {
      const poss = others.filter((x) => !voids[x].has(b[0]) && !voids[x].has(b[1]));
      const denom = poss.reduce((acc, x) => acc + cnt[x], 0) || 1;
      poss.forEach((x) => {
        const pr = cnt[x] / denom;
        strength[x][b[0]] += pr;
        if (b[1] !== b[0]) strength[x][b[1]] += pr;
      });
    });
    return { voids, strength, cnt, unseen, others };
  }

  function resultingEnds(st, bone, side) {
    if (!st.ends) return [bone[0], bone[1]];
    if (side === 'L') return [bone[0] === st.ends[0] ? bone[1] : bone[0], st.ends[1]];
    return [st.ends[0], bone[0] === st.ends[1] ? bone[1] : bone[0]];
  }

  // Team-aware preference for a move. Uses only what this player can know.
  function expertHeuristic(st, seat, mv, bel) {
    const hand = st.hands[seat];
    const b = hand[mv.i];
    const rest = hand.filter((_, i) => i !== mv.i);
    const ends = resultingEnds(st, b, mv.side);
    const partner = (seat + 2) % 4, o1 = (seat + 1) % 4, o2 = (seat + 3) % 4;
    const pc = bel.cnt[partner], c1 = bel.cnt[o1], c2 = bel.cnt[o2], myc = hand.length;
    const oppMin = Math.min(c1, c2);
    let score = 0;
    const ps = ends.reduce((acc, v) => acc + bel.strength[partner][v], 0);
    const os = ends.reduce((acc, v) => acc + bel.strength[o1][v] + bel.strength[o2][v], 0) / 2;
    const nextOpp = ends.reduce((acc, v) => acc + bel.strength[o1][v], 0);
    // the fewer bones the partner has left, the more the move should leave him something to play
    const wp = pc <= 2 ? 3.2 : pc <= 4 ? 1.8 : 1.0;
    const wo = oppMin <= 2 ? 2.6 : 1.3;
    score += wp * ps - wo * os - 0.6 * nextOpp;
    ends.forEach((v) => {
      if (bel.voids[o1].has(v)) score += 2.5;
      if (bel.voids[o2].has(v)) score += 2.5;
      if (bel.voids[partner].has(v)) score -= 3.5;
    });
    const mySuits = new Array(7).fill(0);
    rest.forEach((x) => { mySuits[x[0]]++; if (x[1] !== x[0]) mySuits[x[1]]++; });
    score += 1.2 * (mySuits[ends[0]] + mySuits[ends[1]]);
    if (rest.length && mySuits[ends[0]] === 0 && mySuits[ends[1]] === 0) score -= 5;
    // dumping heavy bones matters when opponents are close to going out,
    // and matters less when the partner is about to go out himself
    let dumpW = oppMin <= 3 ? 1.1 : 0.55;
    if (pc <= 2 && pc < myc && pc <= oppMin) dumpW *= 0.4;
    score += dumpW * pips(b) + (isDouble(b) ? 2.5 : 0);
    if (b[0] === 0 && b[1] === 0 && rest.length > 0) score += 3; // a lone 0:0 costs 10
    if (rest.length === 1 && rest[0][0] === 0 && rest[0][1] === 0) score -= 6;
    if (rest.length === 0) score += 100;
    return score;
  }

  // Sample hidden hands that respect every pass seen so far.
  function determinize2(st, seat, bel) {
    const others = bel.others;
    const pool = bel.unseen.slice();
    for (let attempt = 0; attempt < 25; attempt++) {
      const caps = {};
      const hands = {};
      others.forEach((x) => { caps[x] = st.hands[x].length; hands[x] = []; });
      const order = shuffle(pool.slice()).map((b) => ({ b, poss: others.filter((x) => !bel.voids[x].has(b[0]) && !bel.voids[x].has(b[1])) }));
      order.sort((p, q) => p.poss.length - q.poss.length);
      let ok = true;
      for (const it of order) {
        const cand = it.poss.filter((x) => caps[x] > 0);
        if (!cand.length) { ok = false; break; }
        let tot = 0;
        cand.forEach((x) => (tot += caps[x]));
        let r = Math.random() * tot;
        let pick = cand[cand.length - 1];
        for (const x of cand) { r -= caps[x]; if (r <= 0) { pick = x; break; } }
        hands[pick].push(it.b);
        caps[pick]--;
      }
      if (ok) return hands;
    }
    // fallback: ignore voids
    const p2 = shuffle(pool.slice());
    const hh = {};
    let i2 = 0;
    others.forEach((x) => { hh[x] = p2.slice(i2, i2 + st.hands[x].length); i2 += st.hands[x].length; });
    return hh;
  }

  function chooseExpert(st, seat, moves, log) {
    const bel = beliefs(st, seat, log);
    const n = st.hands[seat].length >= 6 ? expertConfig.iters : expertConfig.itersLate;
    const totals = new Array(moves.length).fill(0);
    for (let k = 0; k < n; k++) {
      const hid = determinize2(st, seat, bel);
      for (let m = 0; m < moves.length; m++) {
        const s = clone(st);
        Object.keys(hid).forEach((sd) => (s.hands[sd] = hid[sd].map((bb) => bb.slice())));
        s.mustOpenWith11 = false;
        applyMove(s, moves[m]);
        totals[m] += rollout(s, seat);
      }
    }
    let best = 0, bs = -1e9;
    for (let m = 0; m < moves.length; m++) {
      const sc = totals[m] / n + expertConfig.lambda * expertHeuristic(st, seat, moves[m], bel);
      if (sc > bs) { bs = sc; best = m; }
    }
    return moves[best];
  }

  // ---------- Expert v2: likelihood-weighted worlds, stronger rollouts, exact endgame ----------
  const expert2Config = { worlds: 140, iters: 48, itersLate: 72, temp: 5, tempering: 1.0, endgameBones: 9, nodeBudget: 14000, timeMs: 0, lambda: 1.25, useWeights: true, useEndgame: false, rollout: 'old', useCtx: false };

  // cheap move model used both to judge how plausible past plays were and to drive rollouts
  function moveModel(handArr, ends, bi, side) {
    const b = handArr[bi];
    let nl, nr;
    if (!ends) { nl = b[0]; nr = b[1]; }
    else if (side === 'L') { nl = b[0] === ends[0] ? b[1] : b[0]; nr = ends[1]; }
    else { nr = b[0] === ends[1] ? b[1] : b[0]; nl = ends[0]; }
    let keep = 0;
    for (let i = 0; i < handArr.length; i++) {
      if (i === bi) continue;
      const x = handArr[i];
      if (x[0] === nl || x[1] === nl) keep++;
      if (x[0] === nr || x[1] === nr) keep++;
    }
    let sc = 0.7 * (b[0] + b[1]) + (b[0] === b[1] ? 2 : 0) + 1.1 * keep;
    if (handArr.length > 1 && keep === 0) sc -= 4;
    return sc;
  }

  // weight of a sampled world = how likely the other players' past plays were under the move model
  function worldLogWeight(st, seat, hands, endsBefore, temp) {
    const H = {};
    [0, 1, 2, 3].forEach((q) => { H[q] = (q === seat ? st.hands[q] : hands[q]).map((b) => b); });
    let lw = 0;
    for (let i = st.played.length - 1; i >= 1; i--) {
      const pl = st.played[i];
      const q = pl.seat;
      const before = H[q].concat([pl.bone]);
      if (q !== seat) {
        const ends = endsBefore[i];
        const opts = [];
        let chosen = -1;
        for (let bi = 0; bi < before.length; bi++) {
          const b = before[bi];
          if (b[0] === ends[0] || b[1] === ends[0]) { opts.push([bi, 'L']); }
          if (ends[0] !== ends[1] && (b[0] === ends[1] || b[1] === ends[1])) { opts.push([bi, 'R']); }
          else if (ends[0] === ends[1] && false) {}
        }
        if (opts.length > 1) {
          let tot = 0, mine = 0;
          opts.forEach((o) => {
            const e = Math.exp(moveModel(before, ends, o[0], o[1]) / temp);
            tot += e;
            if (before[o[0]] === pl.bone && o[1] === (pl.side === 'L' ? 'L' : 'R')) mine = e;
            else if (before[o[0]] === pl.bone && mine === 0 && ends[0] === ends[1]) mine = e;
          });
          if (mine === 0) {
            // side mismatch for symmetric ends; fall back to any option with this bone
            opts.forEach((o) => { if (before[o[0]] === pl.bone) mine += Math.exp(moveModel(before, ends, o[0], o[1]) / temp); });
          }
          if (mine > 0) lw += Math.log(mine / tot);
        }
      }
      H[q] = before;
    }
    return lw;
  }

  function endsTimeline(st) {
    const out = [null];
    let ends = null;
    st.played.forEach((pl, i) => {
      if (i > 0) out[i] = ends.slice();
      const b = pl.bone;
      if (!ends) ends = [b[0], b[1]];
      else if (pl.side === 'L') ends = [b[0] === ends[0] ? b[1] : b[0], ends[1]];
      else ends = [ends[0], b[0] === ends[1] ? b[1] : b[0]];
    });
    return out;
  }

  function resample(worlds, logw, k, tempering) {
    const mx = Math.max(...logw);
    const w = logw.map((x) => Math.exp((x - mx) * tempering));
    const tot = w.reduce((a, b) => a + b, 0);
    const out = [];
    const step = tot / k;
    let u = Math.random() * step, acc = 0, i = 0;
    for (let j = 0; j < k; j++) {
      const target = u + j * step;
      while (i < w.length - 1 && acc + w[i] < target) { acc += w[i]; i++; }
      out.push(worlds[i]);
    }
    return out;
  }

  function rolloutMove2(s, seat) {
    const hand = s.hands[seat];
    const moves = legalMoves(hand, s.ends, false);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    let best = moves[0], bs = -1e9;
    for (const mv of moves) {
      const sc = moveModel(hand, s.ends, mv.i, mv.side) + Math.random() * 2.2;
      if (sc > bs) { bs = sc; best = mv; }
    }
    return best;
  }

  function rollout2(s, seat) {
    let guard = 0;
    const smart = expert2Config.rollout === 'smart';
    while (!s.over && guard++ < 60) {
      const mv = smart ? rolloutMove2(s, s.turn) : rolloutMove(s, s.turn);
      if (mv) applyMove(s, mv); else pass(s);
    }
    const r = s.result;
    if (!r || r.draw) return 0;
    return r.loseTeam === TEAM(seat) ? -r.points : r.points;
  }

  // exact perfect-information search (alpha-beta) from the sampled world; null if over budget
  function exactValue(s, rootTeam, budget) {
    let nodes = 0;
    const hands = s.hands.map((h) => h.map((b) => b));
    const sumH = (h) => (h.length === 1 && h[0][0] === 0 && h[0][1] === 0 ? 10 : h.reduce((a, b) => a + b[0] + b[1], 0));
    function terminalOut(seat, last) {
      const win = TEAM(seat);
      let pts = 0;
      for (let q = 0; q < 4; q++) if (TEAM(q) !== win) pts += sumH(hands[q]);
      return win === rootTeam ? pts : -pts;
    }
    function terminalFish() {
      const sums = hands.map(sumH);
      const t = [sums[0] + sums[2], sums[1] + sums[3]];
      if (t[0] === t[1]) return 0;
      const total = t[0] + t[1];
      const winTeam = t[0] < t[1] ? 0 : 1;
      return winTeam === rootTeam ? total : -total;
    }
    function rec(ends, turn, passes, alpha, beta) {
      if (++nodes > budget) throw new Error('budget');
      const hand = hands[turn];
      const maxing = TEAM(turn) === rootTeam;
      const cand = [];
      for (let i = 0; i < hand.length; i++) {
        const b = hand[i];
        if (b[0] === ends[0] || b[1] === ends[0]) cand.push([i, 'L']);
        if (b[0] === ends[1] || b[1] === ends[1]) { if (ends[0] !== ends[1]) cand.push([i, 'R']); }
      }
      if (!cand.length) {
        if (passes + 1 >= 4) return terminalFish();
        return rec(ends, (turn + 1) % 4, passes + 1, alpha, beta);
      }
      let best = maxing ? -1e9 : 1e9;
      for (const [i, side] of cand) {
        const b = hand[i];
        const ne = side === 'L' ? [b[0] === ends[0] ? b[1] : b[0], ends[1]] : [ends[0], b[0] === ends[1] ? b[1] : b[0]];
        hand.splice(i, 1);
        let v;
        if (hand.length === 0) v = terminalOut(turn, b);
        else v = rec(ne, (turn + 1) % 4, 0, alpha, beta);
        hand.splice(i, 0, b);
        if (maxing) { if (v > best) best = v; if (best > alpha) alpha = best; }
        else { if (v < best) best = v; if (best < beta) beta = best; }
        if (alpha >= beta) break;
      }
      return best;
    }
    return { rec, hands, count: () => nodes };
  }

  function exactAfterMove(st, world, seat, mv, budget) {
    // returns exact value for team of `seat` after playing mv in sampled world, or null
    const s = clone(st);
    Object.keys(world).forEach((sd) => (s.hands[sd] = world[sd].map((b) => b.slice())));
    s.mustOpenWith11 = false;
    applyMove(s, mv);
    if (s.over) {
      const r = s.result;
      return r.draw ? 0 : (r.loseTeam === TEAM(seat) ? -r.points : r.points);
    }
    const ex = exactValue(s, TEAM(seat), budget);
    try {
      return ex.rec(s.ends.slice(), s.turn, 0, -1e9, 1e9);
    } catch (e) {
      return null;
    }
  }

  // Points near the 101 limit hurt more: value a swing by how it moves each team along that scale.
  function matchUtility(v, ctx) {
    if (!ctx || !expert2Config.useCtx) return v;
    const g = (x) => x + (x > 70 ? 1.2 * (x - 70) : 0) + (x >= 101 ? 40 : 0);
    if (v >= 0) return g(ctx.opp + v) - g(ctx.opp);
    return -(g(ctx.my - v) - g(ctx.my));
  }

  function chooseExpert2(st, seat, moves, log, ctx) {
    const cfg = expert2Config;
    const bel = beliefs(st, seat, log);
    const remaining = st.hands.reduce((a, h) => a + h.length, 0);
    const endgame = cfg.useEndgame && remaining <= cfg.endgameBones;
    const k = st.hands[seat].length >= 6 ? cfg.iters : cfg.itersLate;
    let worlds = [];
    let logw = [];
    const n0 = cfg.useWeights && st.played.length > 4 ? cfg.worlds : k;
    const timeline = cfg.useWeights ? endsTimeline(st) : null;
    for (let i = 0; i < n0; i++) {
      const w = determinize2(st, seat, bel);
      worlds.push(w);
      logw.push(cfg.useWeights && st.played.length > 4 ? worldLogWeight(st, seat, w, timeline, cfg.temp) : 0);
    }
    if (n0 > k) worlds = resample(worlds, logw, k, cfg.tempering);
    const totals = new Array(moves.length).fill(0);
    for (const hid of worlds) {
      for (let m = 0; m < moves.length; m++) {
        let v = null;
        if (endgame) v = exactAfterMove(st, hid, seat, moves[m], cfg.nodeBudget);
        if (v == null) {
          const s = clone(st);
          Object.keys(hid).forEach((sd) => (s.hands[sd] = hid[sd].map((bb) => bb.slice())));
          s.mustOpenWith11 = false;
          applyMove(s, moves[m]);
          v = rollout2(s, seat);
        }
        totals[m] += matchUtility(v, ctx);
      }
    }
    let best = 0, bs = -1e9;
    for (let m = 0; m < moves.length; m++) {
      const sc = totals[m] / worlds.length + cfg.lambda * expertHeuristic(st, seat, moves[m], bel);
      if (sc > bs) { bs = sc; best = m; }
    }
    return moves[best];
  }

  // level: 0 новичок, 1 любитель, 2 опытный, 3 эксперт (4 = previous expert, kept for tests)
  function botChoose(st, seat, level, log, ctx) {
    const moves = legalMoves(st.hands[seat], st.ends, st.mustOpenWith11);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    if (level <= 0) return chooseRandom(st, seat, moves);
    if (level === 1) {
      if (Math.random() < 0.15) return chooseRandom(st, seat, moves);
      return chooseGreedy(st, seat, moves);
    }
    if (level === 2) return chooseHeuristic(st, seat, moves, log);
    if (level === 4) return chooseMonteCarlo(st, seat, moves, log, st.hands[seat].length >= 6 ? 30 : 60);
    if (level === 5) return chooseExpert(st, seat, moves, log);
    return chooseExpert2(st, seat, moves, log, ctx);
  }

  // Match scoring with the "13 to open" rule: a team's first points are held back until the
  // pending total reaches 13. If three rounds pass without reaching 13, pending points burn
  // and a new three-round window starts. After opening, points are added as usual.
  const OPEN_AT = 13, WINDOW = 3;
  function newMatch() {
    return { score: [0, 0], pend: [0, 0], rounds: [0, 0], open: [false, false] };
  }
  function scoreRound(m, loseTeam, pts) {
    const info = [{ kind: 'none', pts: 0 }, { kind: 'none', pts: 0 }];
    for (let t = 0; t < 2; t++) {
      const got = t === loseTeam ? pts : 0;
      if (m.open[t]) {
        m.score[t] += got;
        info[t] = { kind: got ? 'add' : 'none', pts: got };
        continue;
      }
      m.rounds[t]++;
      m.pend[t] += got;
      if (m.pend[t] >= OPEN_AT) {
        m.open[t] = true;
        m.score[t] = m.pend[t];
        info[t] = { kind: 'open', pts: got, total: m.pend[t] };
        m.pend[t] = 0;
      } else if (m.rounds[t] >= WINDOW) {
        info[t] = m.pend[t] > 0 ? { kind: 'burn', pts: got, lost: m.pend[t] } : { kind: 'none', pts: 0 };
        m.pend[t] = 0;
        m.rounds[t] = 0;
      } else {
        info[t] = got ? { kind: 'hold', pts: got, pend: m.pend[t], left: WINDOW - m.rounds[t] } : { kind: 'none', pts: 0, left: WINDOW - m.rounds[t], pend: m.pend[t] };
      }
    }
    return info;
  }

  // Who made the fish: the last player whose bone closed the table. A double does not change
  // the open ends, so if the last bone was a double the fish was made by the move before it.
  function fishMaker(st) {
    for (let k = st.played.length - 1; k >= 0; k--) {
      const b = st.played[k].bone;
      if (b[0] !== b[1]) return st.played[k].seat;
    }
    return st.played.length ? st.played[st.played.length - 1].seat : 0;
  }
  const api = {
    OPEN_AT, WINDOW, newMatch, scoreRound, expertConfig, expert2Config,
    TEAM, pips, isDouble, allBones, deal, newRound, legalMoves, applyMove, pass, hasMove, clone, sumHand, botChoose, buildVoids, fishMaker,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Domino = api;
})(typeof window !== 'undefined' ? window : globalThis);
