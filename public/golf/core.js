// Flagcast: the scoring math, shared by every golf page (the cart, the screens, the desk and the live page).
// The server only stores what was entered; each page works out the leaderboard from it with these functions,
// so they all show the same numbers.
//
// event.format = { type: 'bestball' | 'stroke' | 'scramble' | 'stableford', count: 1 | 2 (best balls per hole),
//                  allowance: 0–100 (% of each playing handicap), show: 'net' | 'gross' }
// event.course.holes = [{ n: 1–18, par, yds, hcp: 1–18 (stroke index) }]
// event.teams = [{ id, name, flight, start (hole), hcp (scramble team handicap), players: [{ id, name, hcp }] }]
// scores[teamId] = { [playerId or 'T' for a scramble team]: [18 values: null = not yet, 0 = picked up, else strokes] }

export const FORMATS = {
  bestball: 'Best ball',
  stroke: 'Stroke play',
  scramble: 'Scramble',
  stableford: 'Stableford',
};

export function defaultHoles() {
  const par = [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5];
  const hcp = [7, 3, 11, 15, 1, 9, 17, 5, 13, 8, 16, 2, 4, 12, 10, 18, 6, 14];
  const yds = { 3: 165, 4: 385, 5: 520 };
  return par.map((p, i) => ({ n: i + 1, par: p, yds: yds[p], hcp: hcp[i] }));
}

// strokes a player with this playing handicap gets on a hole with this stroke index (plus handicaps give strokes back)
export function strokesOn(h, si) {
  if (!h) return 0;
  if (h > 0) return Math.floor(h / 18) + (si <= h % 18 ? 1 : 0);
  const p = -h;
  return -(Math.floor(p / 18) + (si > 18 - (p % 18) ? 1 : 0));
}

export const playing = (hcp, allowance) => Math.round((Number(hcp) || 0) * (allowance ?? 100) / 100);

const isScore = (v) => typeof v === 'number' && v >= 0;

// one team's card, hole by hole: what counts on each hole for this format
export function teamCard(ev, team, sc) {
  const f = ev.format || {}, holes = ev.course.holes, allow = f.allowance ?? 100;
  const type = f.type || 'bestball';
  const count = type === 'stroke' ? 1 : Math.max(1, Math.min(4, f.count || 1));
  const s = sc || {};
  const rows = [];
  for (let i = 0; i < 18; i++) {
    const hole = holes[i];
    let gross = null, net = null, pts = null, done = false, parFor = hole.par;
    if (type === 'scramble') {
      const v = (s.T || [])[i];
      if (v !== null && v !== undefined) {
        done = true;
        const st = strokesOn(playing(team.hcp, allow), hole.hcp);
        if (isScore(v) && v > 0) { gross = v; net = v - st; } else { gross = hole.par + 2 + st; net = hole.par + 2; }
      }
    } else {
      const ps = team.players || [];
      const entered = ps.map((p) => (s[p.id] || [])[i]);
      done = ps.length > 0 && entered.every((v) => v !== null && v !== undefined);
      if (done) {
        const each = ps.map((p, k) => {
          const v = entered[k];
          const st = strokesOn(playing(p.hcp, allow), hole.hcp);
          // picked up: counts as net double bogey (the handicap system's most on a hole), and 0 Stableford points
          if (!isScore(v) || v === 0) return { g: hole.par + 2 + st, n: hole.par + 2, pts: 0, gpts: 0, pu: true };
          const n = v - st;
          return { g: v, n, pts: Math.max(0, 2 + hole.par - n), gpts: Math.max(0, 2 + hole.par - v) };
        });
        const take = Math.min(count, each.length);
        if (type === 'stableford') {
          pts = [...each].sort((a, b) => b.pts - a.pts).slice(0, take).reduce((t, e) => t + e.pts, 0);
          const gp = [...each].sort((a, b) => b.gpts - a.gpts).slice(0, take).reduce((t, e) => t + e.gpts, 0);
          gross = gp; net = pts; // for Stableford these are points
        } else if (take === count) {
          gross = [...each].sort((a, b) => a.g - b.g).slice(0, take).reduce((t, e) => t + e.g, 0);
          net = [...each].sort((a, b) => a.n - b.n).slice(0, take).reduce((t, e) => t + e.n, 0);
        } else { gross = null; net = null; } // not enough balls holed: counts as no score
        parFor = hole.par * count;
      }
    }
    rows.push({ hole: hole.n, par: parFor, gross, net, done });
  }
  return rows;
}

// every line on the leaderboard (a stroke play event lists players, the rest list teams)
export function entries(ev) {
  if ((ev.format || {}).type === 'stroke') {
    const out = [];
    for (const t of ev.teams || []) for (const p of t.players || []) {
      out.push({ key: `${t.id}:${p.id}`, teamId: t.id, name: p.name, sub: t.name, flight: t.flight || '', start: t.start || 1,
        team: { ...t, players: [p] } });
    }
    return out;
  }
  return (ev.teams || []).map((t) => ({ key: t.id, teamId: t.id, name: t.name || (t.players || []).map((p) => last(p.name)).join(' / '),
    sub: (t.players || []).map((p) => p.name).join(', '), flight: t.flight || '', start: t.start || 1, team: t }));
}

const last = (n) => String(n || '').trim().split(/\s+/).pop();

// the leaderboard: sorted, with positions (ties shown as T2) and holes played
export function leaderboard(ev, scores, opts = {}) {
  const f = ev.format || {}, stab = f.type === 'stableford';
  const mode = opts.mode || f.show || 'net';
  const lines = entries(ev).map((e) => {
    const sc = (scores || {})[e.teamId] || {};
    const card = teamCard(ev, e.team, f.type === 'stroke' ? { [e.team.players[0].id]: sc[e.team.players[0].id] } : sc);
    let toPar = 0, total = 0, played = 0, nr = false;
    for (const r of card) {
      if (!r.done) continue;
      played++;
      const v = mode === 'gross' ? r.gross : r.net;
      if (v === null) { nr = !stab; continue; }
      total += v;
      if (!stab) toPar += v - r.par;
    }
    return { ...e, card, played, total, toPar, nr, score: stab ? total : toPar };
  });
  const filtered = opts.flight ? lines.filter((l) => l.flight === opts.flight) : lines;
  const back = (l, from) => l.card.slice(from - 1).reduce((t, r) => t + (r.done ? ((mode === 'gross' ? r.gross : r.net) ?? 0) - (stab ? 0 : r.par) : 0), 0);
  filtered.sort((a, b) => {
    if (!a.played !== !b.played) return a.played ? -1 : 1;
    if (a.nr !== b.nr) return a.nr ? 1 : -1;
    const d = stab ? b.score - a.score : a.score - b.score;
    if (d) return d;
    // card-off for players who finished: back 9, back 6, back 3, last hole
    if (a.played === 18 && b.played === 18) {
      for (const from of [10, 13, 16, 18]) {
        const x = back(a, from), y = back(b, from);
        if (x !== y) return stab ? y - x : x - y;
      }
    }
    return b.played - a.played || a.name.localeCompare(b.name);
  });
  let pos = 0;
  filtered.forEach((l, i) => {
    const prev = filtered[i - 1];
    const tied = (o) => o && o.played && l.played && o.nr === l.nr && o.score === l.score;
    if (!tied(prev)) pos = i + 1;
    l.pos = l.played ? (tied(prev) || tied(filtered[i + 1]) ? `T${pos}` : String(pos)) : '';
    l.thru = l.played === 18 ? 'F' : l.played ? String(l.played) : (l.start && l.start !== 1 ? `Starts ${l.start}` : '—');
  });
  return filtered;
}

export function fmtPar(n, stab) {
  if (stab) return `${n} pts`;
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `−${-n}`;
}

// how a single hole went for everyone, for the par 3 screens
export function holeStats(ev, scores, holeNo) {
  const i = holeNo - 1, par = ev.course.holes[i].par;
  const out = { holeNo, par, eagle: 0, birdie: 0, par0: 0, bogey: 0, worse: 0, aces: [], n: 0, total: 0 };
  for (const t of ev.teams || []) {
    const sc = (scores || {})[t.id] || {};
    const who = ev.format?.type === 'scramble' ? [{ id: 'T', name: t.name }] : (t.players || []);
    for (const p of who) {
      const v = (sc[p.id] || [])[i];
      if (!isScore(v) || v === 0) continue;
      out.n++; out.total += v;
      const d = v - par;
      if (v === 1) out.aces.push({ name: p.name, team: t.name });
      if (d <= -2) out.eagle++; else if (d === -1) out.birdie++; else if (d === 0) out.par0++; else if (d === 1) out.bogey++; else out.worse++;
    }
  }
  out.avg = out.n ? out.total / out.n : null;
  return out;
}

// gross skins: a hole is won when one player has the lowest score alone; ties carry over when carry is on
export function skins(ev, scores, carry = true) {
  if (ev.format?.type === 'scramble') return [];
  const res = []; let pot = 1;
  for (let i = 0; i < 18; i++) {
    let best = Infinity, who = [], all = true;
    for (const t of ev.teams || []) for (const p of t.players || []) {
      const v = ((scores || {})[t.id]?.[p.id] || [])[i];
      if (v === null || v === undefined) { all = false; continue; }
      if (!isScore(v) || v === 0) continue;
      if (v < best) { best = v; who = [{ name: p.name, team: t.name }]; } else if (v === best) who.push({ name: p.name, team: t.name });
    }
    if (!all || !who.length) { res.push({ hole: i + 1, open: true }); pot = 1; continue; }
    if (who.length === 1) { res.push({ hole: i + 1, won: who[0], score: best, worth: pot }); pot = 1; }
    else { res.push({ hole: i + 1, tied: who.length, score: best }); pot = carry ? pot + 1 : 1; }
  }
  return res;
}

// contest standings: closest to the pin (shortest distance wins) and long drive (longest wins)
export function contestLeader(c) {
  const list = (c.entries || []).filter((e) => e && e.name && Number(e.dist) > 0);
  list.sort((a, b) => (c.kind === 'ld' ? b.dist - a.dist : a.dist - b.dist));
  return list;
}

export function fmtDist(c, d) {
  d = Number(d) || 0;
  if (c.kind === 'ld') return `${Math.round(d)} yds`;
  const inches = Math.round(d * 12), ft = Math.floor(inches / 12), inch = inches % 12;
  return `${ft} ft ${inch} in`;
}

// the scorecard mark for a score: circle for birdie, double circle for eagle or better, square for bogey, double square worse
export function mark(v, par) {
  if (typeof v !== 'number' || v <= 0) return '';
  const d = v - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
}
