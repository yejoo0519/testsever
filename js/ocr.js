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
    stat: [[10, 697, 115, 38], [135, 697, 115, 38], [260, 697, 115, 38]]
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
      const v = Math.max(p[i], p[i + 1], p[i + 2]) > thr ? 0 : 255;
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

  let wText = null, wNum = null;
  async function workers(onProgress) {
    if (!w.Tesseract) throw new Error('글자 인식 엔진을 불러오지 못했어요');
    if (!wNum) {
      onProgress && onProgress('글자 인식 엔진 준비 중… (처음 한 번만 걸려요)');
      wNum = await Tesseract.createWorker('eng', 1, TOPT);
      await wNum.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' });
    }
    if (!wText) {
      wText = await Tesseract.createWorker(['kor', 'eng'], 1, TOPT);
      await wText.setParameters({ tessedit_pageseg_mode: '7' });
    }
  }
  const txt = async (wk, cv) => (await wk.recognize(cv)).data.text.replace(/\s+/g, ' ').trim();

  async function read(file, onProgress) {
    await workers(onProgress);
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
      slots.push({ hp: v[0], atk: v[1], def: v[2], img: thumb(R, [cx + L.art[0], L.art[1], L.art[2], L.art[3]]) });
    }
    return { nick, slots };
  }

  w.BvOCR = { read };
})(window);
