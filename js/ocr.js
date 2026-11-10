/* 길드전 배치 화면 스크린샷 판독
   → { nick, slots:[{hp,atk,def,img}] × 3 }  (왼쪽부터 1번용·2번용·3번용)
   좌표는 게임 화면 높이 1080 기준, x는 게임 화면 가로 중앙 기준. */
(function (w) {
  'use strict';
  const BASE = new URL('.', document.currentScript.src).href.replace(/js\/$/, '');
  const TOPT = {
    workerPath: BASE + 'vendor/tesseract/worker.min.js',
    corePath: BASE + 'vendor/tesseract/core/',
    langPath: BASE + 'vendor/tesseract/lang',
    gzip: true
  };
  const L = {
    nick: [-500, 145, 1000, 70],
    cards: [-610, -193, 224],
    art: [8, 338, 370, 262],
    stat: [[10, 697, 115, 38], [135, 697, 115, 38], [260, 697, 115, 38]],
    eval: [190, 610, 120, 38]   // 'Eval : 7740' 의 숫자 부분 (초록 글자)
  };

  function load(file) {
    return new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => no(new Error('이미지를 열 수 없어요'));
      img.src = URL.createObjectURL(file);
    });
  }

  // 양옆 검은 여백(노치·내비 버튼 포함)을 빼고 게임 화면 영역을 찾는다
  function gameRect(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;
    const step = Math.max(1, H >> 7);
    const dark = x => {
      let n = 0, t = 0;
      for (let y = 0; y < H; y += step) { t++; const i = (y * W + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 60) n++; }
      return n < t * 0.25;
    };
    let l = 0, r = W - 1;
    while (l < W / 3 && dark(l)) l++;
    while (r > W * 2 / 3 && dark(r)) r--;
    return { c, x: l, w: r - l + 1, h: H };
  }

  function region(R, x, y, wd, ht) {
    const u = R.h / 1080, cx = R.x + R.w / 2;
    return [cx + x * u, y * u, wd * u, ht * u];
  }

  // 글자만 검게 남긴 흑백 이미지 (thr: 이 밝기보다 밝은 픽셀 = 글자)
  function textCanvas(R, rect, thr) {
    const [sx, sy, sw, sh] = region(R, ...rect);
    const S = Math.max(2, Math.round(96 / sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * S); c.height = Math.round(sh * S);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(R.c, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const im = g.getImageData(0, 0, c.width, c.height), p = im.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const on = thr === 'green' ? (g > 90 && g > r + 25 && g > b + 25) : Math.max(r, g, b) > thr;
      const v = on ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const pad = document.createElement('canvas');
    pad.width = c.width + 40; pad.height = c.height + 40;
    const pg = pad.getContext('2d');
    pg.fillStyle = '#fff'; pg.fillRect(0, 0, pad.width, pad.height); pg.drawImage(c, 20, 20);
    return pad;
  }

  function thumb(R, rect) {
    const [sx, sy, sw, sh] = region(R, ...rect);
    const c = document.createElement('canvas');
    c.width = 120; c.height = Math.round(120 * sh / sw);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(R.c, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }

  // 엔진은 한 번만 받는다 (두 번째부터는 브라우저 캐시). 페이지에 들어오자마자 미리 받기 시작한다
  let wText = null, wNum = null, ready = null;
  const prog = { pct: 0, msg: '' }, subs = new Set();
  const emit = () => subs.forEach(f => { try { f(prog); } catch (_) {} });
  function warm(onProgress) {
    if (onProgress) { subs.add(onProgress); onProgress(prog); }
    if (ready) return ready;
    if (!w.Tesseract) return (ready = Promise.reject(new Error('글자 인식 엔진을 불러오지 못했어요')));
    const part = {};
    const logger = key => m => {
      if (typeof m.progress === 'number') part[key] = /loading|load/.test(m.status || '') ? m.progress : (part[key] || 0);
      const v = Object.values(part); prog.pct = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / 2 * 100) : 0;
      prog.msg = '글자 인식 엔진 받는 중… ' + Math.min(99, prog.pct) + '% (처음 한 번만, 다음부턴 바로 돼요)'; emit();
    };
    prog.msg = '글자 인식 엔진 받는 중… (처음 한 번만, 다음부턴 바로 돼요)'; emit();
    const timeout = new Promise((_, no) => setTimeout(() => no(new Error('글자 인식 엔진을 받지 못했어요 (인터넷이 느리거나 이 브라우저에서 안 돼요). 숫자를 직접 넣어 주세요')), 90000));
    ready = Promise.race([Promise.all([
      Tesseract.createWorker('eng', 1, { ...TOPT, logger: logger('n') }).then(async wk => { await wk.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' }); wNum = wk; }),
      Tesseract.createWorker(['kor', 'eng'], 1, { ...TOPT, logger: logger('t') }).then(async wk => { await wk.setParameters({ tessedit_pageseg_mode: '7' }); wText = wk; })
    ]), timeout]).then(() => { prog.pct = 100; prog.msg = ''; prog.done = true; emit(); }, err => { prog.msg = err.message; prog.err = true; emit(); ready = null; throw err; });
    return ready;
  }
  async function workers() { await warm(); }
  const txt = async (wk, cv) => (await wk.recognize(cv)).data.text.replace(/\s+/g, ' ').trim();

  // 카드의 Eval = 체력 + 4×공격 + 4×방어. 이걸로 읽은 숫자를 검증하고, 한 칸만 틀렸으면 고친다
  const evalOf = (h, a, d) => h + 4 * a + 4 * d;
  function lev1(a, b) {
    a = String(a); b = String(b); if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  const MAXV = [9999, 2999, 2999];               // 이보다 크면 숫자를 잘못 읽은 것 (예: 846 → 8460)
  function reconcile(h, a, d, ev) {
    const v = [h, a, d];
    const odd = v.map((x, k) => !x || x > MAXV[k]);
    if (ev && evalOf(h, a, d) === ev) return { v, check: 'ok' };
    if (!ev || !odd.some(Boolean)) return { v, check: odd.some(Boolean) ? 'bad' : (ev ? 'bad' : 'none') };
    // 말이 안 되는 칸이 있을 때만 Eval 로 고친다 (Eval 자체를 잘못 읽은 경우에 멀쩡한 값을 망치지 않게)
    const cands = [];
    const w = [1, 4, 4];
    for (let k = 0; k < 3; k++) {
      const rest = ev - v.reduce((s, x, j) => j === k ? s : s + w[j] * x, 0);
      if (rest <= 0 || rest % w[k]) continue;
      const c = rest / w[k];
      if (odd[k] && c > 0 && c <= MAXV[k] && lev1(c, v[k])) cands.push([k, c]);
    }
    if (cands.length === 1) { v[cands[0][0]] = cands[0][1]; return { v, check: 'fixed' }; }
    return { v, check: 'bad' };
  }

  async function read(file, onProgress) {
    await workers();
    const img = await load(file);
    const R = gameRect(img);
    URL.revokeObjectURL(img.src);
    if (R.h < 300 || R.w < R.h) throw new Error('가로 화면 스크린샷이 아니에요');
    const nick = (await txt(wText, textCanvas(R, L.nick, 150))).replace(/[|]/g, '').trim();
    const slots = [];
    for (const cx of L.cards) {
      const v = [];
      for (const s of L.stat) {
        v.push(parseInt((await txt(wNum, textCanvas(R, [cx + s[0], s[1], s[2], s[3]], 115))).replace(/\D/g, ''), 10) || 0);
      }
      const ev = parseInt((await txt(wNum, textCanvas(R, [cx + L.eval[0], L.eval[1], L.eval[2], L.eval[3]], 'green'))).replace(/\D/g, ''), 10) || 0;
      const fixd = reconcile(v[0], v[1], v[2], ev);
      slots.push({ hp: fixd.v[0], atk: fixd.v[1], def: fixd.v[2], eval: ev, check: fixd.check, img: thumb(R, [cx + L.art[0], L.art[1], L.art[2], L.art[3]]) });
    }
    return { nick, slots };
  }

  w.BvOCR = { read, warm };
})(window);
