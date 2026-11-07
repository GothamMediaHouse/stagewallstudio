// Showcaller Sessions: the take's transcript, and the edit made from it. Used by the app (main.js, for files) and the
// editor window (renderer, as window.SessionsText), so both cut in exactly the same places.
// Times are seconds on the take's clock (0 = when the room said "record"). An edit is a list of cut ranges [[a, b]];
// everything outside them is kept, on every track at once, so everyone stays in sync.
(function (root, make) { if (typeof module === 'object' && module.exports) module.exports = make(); else root.SessionsText = make(); })(this, function () {
  const FILLERS = new Set(['um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'hm', 'mm', 'mmm', 'ah', 'ahh', 'eh']);
  const bare = (w) => String(w).toLowerCase().replace(/[^a-z'-]/g, '');
  const isFiller = (w) => FILLERS.has(bare(w));
  const ends = (w) => /[.?!…]["')\]]*$/.test(w);

  // tracks: [{ pid, name, off, words: [{ s, e, w }] (seconds from the WAV's start), env (20 ms loudness, see post-audio) }]
  // A word is kept on the track where it's loudest: the same sentence picked up by someone else's mic (people in one
  // room, or a camera's own mic) is left out, and so is anything whisper "heard" in near-silence.
  function merge(tracks, o = {}) {
    const lvl = (env, s, e) => { if (!env) return 1; const a = Math.max(0, Math.floor(s / 0.02)), b = Math.min(env.length, Math.max(a + 1, Math.ceil(e / 0.02))); let sum = 0; for (let i = a; i < b; i++) sum += env[i]; return b > a ? sum / (b - a) : 0; };
    const db = (x) => 10 * Math.log10(x + 1e-12), floor = o.floor ?? -58, margin = o.margin ?? 6;
    const out = [];
    for (const t of tracks) {
      for (const w of t.words) {
        const s = w.s + t.off, e = w.e + t.off;
        if (tracks.length > 1 && t.env) {
          const me = db(lvl(t.env, w.s, w.e));
          if (me < floor) continue;
          let best = -200; for (const u of tracks) if (u !== t && u.env) best = Math.max(best, db(lvl(u.env, s - u.off, e - u.off)));
          if (me < best - margin) continue;
        }
        out.push({ s: r3(s), e: r3(e), w: w.w, sp: t.pid });
      }
    }
    out.sort((a, b) => a.s - b.s || a.e - b.e);
    return out;
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;

  // paragraphs: one speaker's run of words (a new one after a 2.5 s gap)
  function paragraphs(words) {
    const out = []; let cur = null;
    words.forEach((w, i) => {
      if (!cur || cur.sp !== w.sp || w.s - words[i - 1].e > 2.5) { cur = { sp: w.sp, s: w.s, from: i, to: i }; out.push(cur); }
      cur.to = i; cur.e = w.e;
    });
    return out;
  }

  // ---------- the edit ----------
  function norm(cuts) {
    const c = cuts.filter((x) => x && x[1] - x[0] > 0.001).map((x) => [r3(x[0]), r3(x[1])]).sort((a, b) => a[0] - b[0]), out = [];
    for (const x of c) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 0.001) l[1] = Math.max(l[1], x[1]); else out.push(x.slice()); }
    return out;
  }
  // kept ranges within [from, to]
  function keeps(cuts, to, from = 0) {
    const out = []; let t = from;
    for (const [a, b] of norm(cuts)) { if (b <= from || a >= to) continue; if (a > t) out.push([t, Math.min(a, to)]); t = Math.max(t, b); }
    if (t < to) out.push([t, to]);
    return out.filter(([a, b]) => b - a > 0.01);
  }
  // take time → time in the edited version (null inside a cut)
  function mapper(ks) {
    const acc = []; let sum = 0; for (const [a, b] of ks) { acc.push(sum); sum += b - a; }
    const f = (t) => { for (let i = 0; i < ks.length; i++) if (t >= ks[i][0] - 1e-6 && t <= ks[i][1] + 1e-6) return acc[i] + (t - ks[i][0]); return null; };
    f.total = sum; return f;
  }
  const isCut = (cuts, w) => { const m = (w.s + w.e) / 2; return cuts.some(([a, b]) => m >= a && m < b); };
  // cutting words i…j: from the first one's start to just before the next kept word, so the gap after goes too
  function cutWords(words, i, j, cuts = []) {
    let k = j + 1; while (k < words.length && isCut(cuts, words[k])) k++;
    const a = words[i].s, b = k < words.length ? Math.max(words[j].e, words[k].s - 0.06) : words[j].e + 0.15;
    return [r3(Math.max(0, a - 0.02)), r3(b)];
  }
  function fillerCuts(words) { const out = []; words.forEach((w, i) => { if (isFiller(w.w)) out.push(cutWords(words, i, i)); }); return out; }
  // silences longer than `over` (nobody talking) brought down to `keep`
  function pauseCuts(words, over = 1.5, keep = 0.5) {
    const out = []; let lastEnd = null;
    for (const w of words) { if (lastEnd !== null && w.s - lastEnd > over) out.push([r3(lastEnd + keep / 2), r3(w.s - keep / 2)]); lastEnd = Math.max(lastEnd ?? 0, w.e); }
    return out;
  }

  // ---------- files ----------
  const hms = (t, ms) => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), f = Math.round((t % 1) * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return ms ? `${p(h)}:${p(m)}:${p(s)},${p(Math.min(999, f), 3)}` : `${h ? h + ':' : ''}${p(m)}:${p(s)}`; };
  const join = (ws) => ws.map((w) => w.w).join(' ').replace(/\s+([,.!?;:…])/g, '$1');
  // words with times already in the output's clock → plain text with speakers and times
  function toText(words, names, title) {
    const lines = title ? [title, ''] : [];
    for (const p of paragraphs(words)) lines.push(`[${hms(p.s)}] ${names[p.sp] || p.sp}`, join(words.slice(p.from, p.to + 1)), '');
    return lines.join('\n');
  }
  // subtitles: up to 2 lines of ~42 characters, at most 6 s, a new cue at a new speaker or after a sentence
  function cues(words, o = {}) {
    const max = o.chars || 84, dur = o.dur || 6, out = []; let cur = [];
    const flush = () => { if (cur.length) out.push({ s: cur[0].s, e: cur[cur.length - 1].e, sp: cur[0].sp, words: cur }); cur = []; };
    for (const w of words) {
      if (cur.length && (w.sp !== cur[0].sp || w.s - cur[cur.length - 1].e > 1.2 || join([...cur, w]).length > max || w.e - cur[0].s > dur || (o.maxWords && cur.length >= o.maxWords))) flush();
      cur.push(w); if (ends(w.w) && join(cur).length > max * 0.4) flush();
    }
    flush();
    for (let i = 0; i < out.length - 1; i++) out[i].e = Math.min(Math.max(out[i].e, out[i].s + 0.6), out[i + 1].s);
    return out;
  }
  function wrap(text, n = 42) { if (text.length <= n) return text; const mid = text.lastIndexOf(' ', Math.ceil(text.length / 2) + 6); return mid > 0 ? text.slice(0, mid) + '\n' + text.slice(mid + 1) : text; }
  function toSrt(words, names, o = {}) {
    const many = new Set(words.map((w) => w.sp)).size > 1;
    return cues(words, o).map((c, i) => `${i + 1}\n${hms(c.s, true)} --> ${hms(c.e, true)}\n${wrap((many && names ? `${names[c.sp] || c.sp}: ` : '') + join(c.words))}\n`).join('\n');
  }
  // the kept words, moved onto the edit's clock
  function editedWords(words, cuts, end, from = 0) {
    const m = mapper(keeps(cuts, end, from)), out = [];
    for (const w of words) { if (w.e <= from || w.s >= end || isCut(cuts, w)) continue; const s = m(w.s), e = m(Math.min(w.e, end)); if (s === null) continue; out.push({ ...w, s: r3(s), e: r3(e === null ? s + (w.e - w.s) : e) }); }
    return out;
  }

  // ---------- who's talking (for the active-speaker video) ----------
  // shots: [{ a, b, sp }] covering [from, to], at least `min` seconds each, following whoever talks most
  function shots(words, from, to, o = {}) {
    const min = o.min || 2, ws = words.filter((w) => w.e > from && w.s < to), out = [];
    if (!ws.length) return [{ a: from, b: to, sp: o.fallback || null }];
    let cur = { a: from, sp: ws[0].sp };
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i]; if (w.sp === cur.sp) continue;
      // switch when the new speaker says at least 2 words (or one long one) and the shot has run long enough
      const run = ws.slice(i, i + 3).filter((x) => x.sp === w.sp), long = run.length >= 2 || w.e - w.s > 0.6;
      const at = Math.max(from, w.s - 0.25);
      if (long && at - cur.a >= min) { cur.b = at; out.push(cur); cur = { a: at, sp: w.sp }; }
    }
    cur.b = to; out.push(cur);
    return out.filter((s) => s.b - s.a > 0.04);
  }

  // ---------- suggested clips ----------
  // Not AI: a score from the host's marks, questions answered, pace, laughs and clean starts and ends, over whole
  // sentences of 20 to 60 seconds. Good enough to find the moments worth a look.
  function suggest(words, o = {}) {
    const marks = o.marks || [], minD = o.min || 20, maxD = o.max || 60, n = o.count || 6;
    const sent = []; let cur = null;
    words.forEach((w, i) => { if (!cur || (i > 0 && w.s - words[i - 1].e > 0.9)) { cur = { from: i, to: i }; sent.push(cur); } cur.to = i; if (ends(w.w)) cur = null; });
    for (const s of sent) { s.a = words[s.from].s; s.b = words[s.to].e; s.q = /\?/.test(words[s.to].w); s.sp = words[s.from].sp; }
    const cands = [];
    for (let i = 0; i < sent.length; i++) {
      for (let j = i; j < sent.length; j++) {
        const a = sent[i].a, b = sent[j].b, d = b - a; if (d > maxD) break; if (d < minD) continue;
        const ws = words.slice(sent[i].from, sent[j].to + 1), text = join(ws);
        let score = ws.length / d; const why = [];
        let gaps = 0; for (let k = 1; k < ws.length; k++) if (ws[k].s - ws[k - 1].e > 1.2) gaps++;
        score -= gaps * 0.4;
        const m = marks.filter((t) => t >= a - 5 && t <= b + 2).length; if (m) { score += 2.5 * m; why.push('your mark'); }
        if (sent.slice(i, j).some((s, k) => s.q && sent[i + k + 1] && sent[i + k + 1].sp !== s.sp)) { score += 0.8; why.push('a question answered'); }
        if (/laugh/i.test(text)) { score += 0.8; why.push('laughs'); }
        if (/!/.test(text)) score += 0.3;
        if (/^(and|but|so|because|or|um|uh)\b/i.test(ws[0].w)) score -= 0.6;
        if (ends(ws[ws.length - 1].w)) score += 0.3;
        if (!why.length) why.push(ws.length / d > 2.6 ? 'lively' : 'a complete thought');
        cands.push({ a: r3(Math.max(0, a - 0.15)), b: r3(b + 0.3), score, why, text });
      }
    }
    cands.sort((x, y) => y.score - x.score);
    const pick = []; for (const c of cands) { if (pick.length >= n) break; if (pick.some((p) => c.a < p.b && c.b > p.a)) continue; pick.push(c); }
    return pick.sort((x, y) => x.a - y.a);
  }

  return { FILLERS, isFiller, merge, paragraphs, norm, keeps, mapper, isCut, cutWords, fillerCuts, pauseCuts, hms, join, toText, cues, toSrt, wrap, editedWords, shots, suggest };
});
