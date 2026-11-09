// Showcaller Sessions 1.8: background blur and replace, for the host and for guests (shared by the app and the guest page).
// Google MediaPipe's selfie segmenter (fx/, Apache 2.0) finds the person in each camera frame on this computer; the
// background is blurred or swapped for a picture and the result is what the call sees and what's recorded.
// Nothing leaves the computer for this.
(function (root) {
  'use strict';
  const BASE = (() => { try { return new URL('fx/', document.currentScript.src).href; } catch { return 'fx/'; } })();
  let segP = null;
  function segmenter() {
    if (!segP) segP = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import(BASE + 'vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(BASE.replace(/\/$/, ''));
      const make = (delegate) => ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: BASE + 'selfie_segmenter.tflite', delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
      try { return await make('GPU'); } catch { return make('CPU'); }
    })().catch((e) => { segP = null; throw e; });
    return segP;
  }
  // the built-in backgrounds, drawn here so they're sharp at any size
  const PRESETS = {
    studio: { name: 'Studio', draw(g, W, H) { const r = g.createRadialGradient(W * 0.5, H * 0.35, H * 0.05, W * 0.5, H * 0.5, W * 0.75); r.addColorStop(0, '#3b3f4a'); r.addColorStop(1, '#0d0e12'); g.fillStyle = r; g.fillRect(0, 0, W, H); } },
    warm: { name: 'Warm', draw(g, W, H) { const l = g.createLinearGradient(0, 0, W, H); l.addColorStop(0, '#6b3a2a'); l.addColorStop(0.55, '#c27a4a'); l.addColorStop(1, '#f0c48a'); g.fillStyle = l; g.fillRect(0, 0, W, H); for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(255,235,200,${0.05 + i * 0.012})`; g.beginPath(); g.arc(W * (0.1 + i * 0.14), H * (0.25 + (i % 3) * 0.2), H * (0.08 + (i % 4) * 0.03), 0, 7); g.fill(); } } },
    cool: { name: 'Cool', draw(g, W, H) { const l = g.createLinearGradient(0, H, W, 0); l.addColorStop(0, '#0b2a3a'); l.addColorStop(0.6, '#1d6f86'); l.addColorStop(1, '#7fd3d9'); g.fillStyle = l; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < W; x += W / 12) g.fillRect(x, 0, W / 48, H); } },
    brand: { name: 'Brand colour', draw(g, W, H, color) { const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#0f9f8c'; const l = g.createLinearGradient(0, 0, W, H); l.addColorStop(0, c); l.addColorStop(1, '#0d0e12'); g.fillStyle = l; g.fillRect(0, 0, W, H); } },
  };
  // modes: 'off' | 'blur' | 'blur2' (stronger) | 'studio' | 'warm' | 'cool' | 'brand' | 'image'
  class Fx {
    constructor(raw) {
      this.raw = raw; const vt = raw.getVideoTracks()[0]; this.inTrack = vt;
      const s = vt.getSettings(), k = Math.min(1, 1080 / (s.height || 720));
      this.W = Math.round((s.width || 1280) * k) & ~1; this.H = Math.round((s.height || 720) * k) & ~1; this.fps = s.frameRate || 30;
      this.v = document.createElement('video'); this.v.muted = true; this.v.playsInline = true; this.v.srcObject = new MediaStream([vt]);
      this.cv = document.createElement('canvas'); this.cv.width = this.W; this.cv.height = this.H; this.g = this.cv.getContext('2d');
      this.tmp = document.createElement('canvas'); this.tmp.width = this.W; this.tmp.height = this.H; this.tg = this.tmp.getContext('2d');
      this.mk = document.createElement('canvas'); this.mg = this.mk.getContext('2d');
      this.bg = document.createElement('canvas'); this.bg.width = this.W; this.bg.height = this.H;
      this.mode = 'off'; this.seg = null; this.last = -1;
      const out = this.cv.captureStream(this.fps).getVideoTracks()[0]; out.contentHint = 'motion';
      // (the camera's label goes with it, so the mirror rule for webcams still applies)
      try { Object.defineProperty(out, 'label', { value: vt.label }); } catch {}
      this.track = out; this.stream = new MediaStream([out, ...raw.getAudioTracks()]);
      this.g.fillStyle = '#000'; this.g.fillRect(0, 0, this.W, this.H);
      this.v.play().catch(() => {}); this.loop(); root.SessionsFx.current = this; // (for tests)
    }
    async set(mode, o = {}) {
      if (mode !== 'off' && !this.seg) this.seg = await segmenter();
      if (o.image) { const im = await load(o.image); const g = this.bg.getContext('2d'), s = Math.max(this.W / im.width, this.H / im.height); g.drawImage(im, (this.W - im.width * s) / 2, (this.H - im.height * s) / 2, im.width * s, im.height * s); }
      else if (PRESETS[mode]) PRESETS[mode].draw(this.bg.getContext('2d'), this.W, this.H, o.color);
      this.mode = mode; this.warned = false;
      if (mode !== 'off') { await new Promise((r) => setTimeout(r, 500)); if (this.warned) { this.mode = 'off'; throw new Error('this computer’s graphics can’t run background effects'); } }
    }
    loop() {
      if (this.stopped) return;
      const next = () => (this.v.requestVideoFrameCallback ? this.v.requestVideoFrameCallback(() => this.loop()) : setTimeout(() => this.loop(), 1000 / this.fps));
      try { this.frame(); } catch (e) { if (!this.warned) { this.warned = String(e && e.stack || e).slice(0, 400); console.warn('background effect', e); } }
      next();
    }
    frame() {
      const v = this.v, g = this.g, W = this.W, H = this.H;
      if (!v.videoWidth) return;
      if (this.mode === 'off' || !this.seg) { g.drawImage(v, 0, 0, W, H); return; }
      let t = performance.now(); if (t <= this.last) t = this.last + 1; this.last = t;
      // the model looks at 256 px anyway: hand it a small copy (also keeps it off the GPU where there's no WebGL)
      if (!this.sm) { this.sm = document.createElement('canvas'); this.sm.width = 256; this.sm.height = Math.round(256 * H / W); this.sg = this.sm.getContext('2d', { willReadFrequently: true }); }
      this.sg.drawImage(v, 0, 0, this.sm.width, this.sm.height);
      const r = this.seg.segmentForVideo(this.sg.getImageData(0, 0, this.sm.width, this.sm.height), t), m = r.confidenceMasks && r.confidenceMasks[0];
      if (m) {
        const mw = m.width, mh = m.height, f = m.getAsFloat32Array();
        if (this.mk.width !== mw || this.mk.height !== mh) { this.mk.width = mw; this.mk.height = mh; this.id = this.mg.createImageData(mw, mh); }
        const d = this.id.data; for (let i = 0, j = 3; i < f.length; i++, j += 4) d[j] = f[i] < 0.25 ? 0 : f[i] > 0.75 ? 255 : (f[i] - 0.25) * 510;
        this.mg.putImageData(this.id, 0, 0);
      }
      r.close && r.close();
      // the person: the camera frame, kept where the mask is (soft edges)
      const tg = this.tg; tg.globalCompositeOperation = 'copy'; tg.filter = 'blur(2px)'; tg.drawImage(this.mk, 0, 0, W, H); tg.filter = 'none';
      tg.globalCompositeOperation = 'source-in'; tg.drawImage(v, 0, 0, W, H); tg.globalCompositeOperation = 'source-over';
      // the background: the frame blurred, or the picture
      if (this.mode === 'blur' || this.mode === 'blur2') { g.filter = `blur(${Math.round(H / (this.mode === 'blur2' ? 40 : 90))}px)`; g.drawImage(v, -8, -8, W + 16, H + 16); g.filter = 'none'; }
      else g.drawImage(this.bg, 0, 0);
      g.drawImage(this.tmp, 0, 0);
    }
    stop() { this.stopped = true; this.track.stop(); this.inTrack.stop(); this.v.srcObject = null; }
  }
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture can’t be read')); i.src = src; });
  const MODES = [['off', 'No effect'], ['blur', 'Blur'], ['blur2', 'Strong blur'], ['studio', 'Studio'], ['warm', 'Warm'], ['cool', 'Cool'], ['brand', 'Brand colour'], ['image', 'Your picture…']];
  root.SessionsFx = { Fx, PRESETS, MODES, BASE, preload: () => segmenter() };
})(typeof window !== 'undefined' ? window : globalThis);
