(function () {
  'use strict';
  const C = window.GO_CONFIG;
  const sb = supabase.createClient(C.url, C.key);
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bvOf = s => (s && s.hp && s.atk && s.def) ? s.hp * s.atk * s.def : 0;
  const M = v => v ? (v / 1e6).toFixed(1) : '—';
  const SLOT = ['1번용', '2번용', '3번용'];

  let me = { session: null, role: null };

  // 아이디로 로그인: 내부적으로는 '아이디@guild.dbryong.com' 이메일 계정으로 저장
  const DOMAIN = '@guild.dbryong.com'; // 실제로 메일은 안 보냄 (Confirm email 꺼둔 상태)
  const ID_RE = /^[a-z0-9_.-]{2,20}$/;
  const toEmail = id => String(id || '').trim().toLowerCase() + DOMAIN;
  const toId = em => String(em || '').toLowerCase().replace(DOMAIN, '');
  const checkId = id => { if (!ID_RE.test(String(id || '').trim().toLowerCase())) throw new Error('아이디는 영문 소문자·숫자·_ . - 2~20자로 만들어 주세요'); };
  const checkPw = pw => { if (String(pw || '').length < 6) throw new Error('비밀번호는 6자 이상이어야 해요'); };
  // 다른 사람 계정을 만들 때 내 로그인이 바뀌지 않게 따로 쓰는 클라이언트
  const sbTemp = () => supabase.createClient(C.url, C.key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'go-temp' } });

  /* ── 공통 ───────────────────────────────────────── */
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function q(p) {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  }
  async function log(action, detail) {
    try { await sb.from('go_logs').insert({ actor: me.session && toId(me.session.user.email), action, detail }); } catch (_) {}
  }
  function monday(d) {
    d = d ? new Date(d) : new Date();
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  const weekLabel = w => (w.title ? w.title + ' · ' : '') + w.start_date.slice(5).replace('-', '/') + ' 주';
  const getWeeks = () => q(sb.from('go_weeks').select('*').order('start_date', { ascending: false }));
  const getMembers = () => q(sb.from('go_members').select('*').order('nickname'));
  const getSpecs = wid => q(sb.from('go_specs').select('*, go_members(nickname, active)').eq('week_id', wid));

  /* ── 로그인 상태 / 메뉴 ─────────────────────────── */
  async function refreshMe() {
    const { data } = await sb.auth.getSession();
    me.session = data.session; me.role = null;
    if (me.session) {
      try {
        const r = await q(sb.from('go_admins').select('role').ilike('email', me.session.user.email).maybeSingle());
        me.role = r ? r.role : null;
      } catch (_) { me.role = null; }
    }
    nav();
  }
  function nav() {
    const r = route().name, n = $('#nav');
    const a = (h, t, extra) => `<a href="#/${h}" class="${r === h ? 'on' : ''}">${t}${extra || ''}</a>`;
    if (me.role) {
      n.innerHTML = a('dashboard', '주간 랭킹') + a('specs', '스펙 입력') + a('members', '길드원') + a('weeks', '주차 · 버프') +
        (me.role === 'master' ? a('accounts', '계정', '<span class="tag">MASTER</span>') + a('logs', '기록', '<span class="tag">MASTER</span>') : '') +
        '<span class="sp"></span>' + a('ranking', '공개 랭킹') + `<button id="chpw">${esc(toId(me.session.user.email))} · 비번 변경</button><button id="logout">로그아웃</button>`;
      $('#chpw').onclick = async () => {
        const pw = prompt('새 비밀번호 (6자 이상)'); if (pw == null) return;
        try { checkPw(pw); const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; toast('비밀번호를 바꿨어요'); } catch (err) { toast(err.message, true); }
      };
      $('#logout').onclick = async () => { await sb.auth.signOut(); await refreshMe(); location.hash = '#/ranking'; };
    } else {
      n.innerHTML = a('ranking', '랭킹') + '<span class="sp"></span>' + a('login', '관리자 로그인');
    }
  }
  $('#menu-btn').onclick = () => $('#nav').classList.toggle('open');

  /* ── 라우터 ─────────────────────────────────────── */
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('?')[0] || 'ranking';
    return { name: h };
  }
  const PAGES = {};
  async function go() {
    $('#nav').classList.remove('open');
    const r = route();
    nav();
    const page = PAGES[r.name] || PAGES.ranking;
    if (page.admin && !me.role) { location.hash = '#/login'; return; }
    if (page.master && me.role !== 'master') { location.hash = '#/dashboard'; return; }
    view.innerHTML = '<div class="empty">불러오는 중…</div>';
    try { await page.render(); } catch (e) { view.innerHTML = `<div class="empty">오류: ${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', go);

  /* ── 랭킹 표 ────────────────────────────────────── */
  function rankRows(specs, mode) {
    const rows = specs.map(s => {
      const sl = (s.slots || []).slice(0, 3);
      return { nick: s.go_members ? s.go_members.nickname : '?', sl, bvs: [0, 1, 2].map(i => bvOf(sl[i])), total: s.total || sl.reduce((a, x) => a + bvOf(x), 0) };
    });
    const key = mode === 'total' ? r => r.total : r => r.bvs[mode];
    return rows.filter(r => key(r) > 0).sort((a, b) => key(b) - key(a));
  }
  function rankTable(specs, mode) {
    const rows = rankRows(specs, mode);
    if (!rows.length) return '<div class="empty">아직 등록된 스펙이 없어요.</div>';
    const cls = i => i < 3 ? ' class="r' + (i + 1) + '"' : '';
    if (mode === 'total') {
      return `<table class="rk"><thead><tr><th></th><th>닉네임</th>${SLOT.map(s => `<th class="hide-m">${s}</th>`).join('')}<th>합산 비밸</th></tr></thead><tbody>` +
        rows.map((r, i) => `<tr${cls(i)}><td><span class="rank">${i + 1}</span></td><td class="nm">${esc(r.nick)}</td>` +
          r.bvs.map((v, k) => `<td class="hide-m"><span class="slotcell">${r.sl[k] && r.sl[k].img ? `<img class="th" src="${r.sl[k].img}" alt="">` : ''}<span class="bv">${M(v)}</span></span></td>`).join('') +
          `<td><span class="bv main">${M(r.total)}</span></td></tr>`).join('') + '</tbody></table>';
    }
    return `<table class="rk"><thead><tr><th></th><th>닉네임</th><th>드래곤</th><th class="hide-m">체 / 공 / 방</th><th>${SLOT[mode]} 비밸</th></tr></thead><tbody>` +
      rows.map((r, i) => {
        const s = r.sl[mode] || {};
        return `<tr${cls(i)}><td><span class="rank">${i + 1}</span></td><td class="nm">${esc(r.nick)}</td><td>${s.img ? `<img class="th" src="${s.img}" alt="">` : ''}</td>` +
          `<td class="hide-m st"><span class="h">${s.hp || 0}</span> / <span class="a">${s.atk || 0}</span> / <span class="d">${s.def || 0}</span></td><td><span class="bv main">${M(r.bvs[mode])}</span></td></tr>`;
      }).join('') + '</tbody></table>';
  }
  async function rankingView(adminView) {
    const weeks = await getWeeks();
    const title = adminView ? '주간 랭킹' : (C.guild || '주간 비밸 랭킹');
    if (!weeks.length) {
      view.innerHTML = `<h1>${esc(title)}</h1><div class="empty">등록된 주차가 없어요.${adminView ? ' <a href="#/weeks">주차 만들기</a>' : ''}</div>`;
      return;
    }
    let wid = +(sessionStorage.getItem('go_week') || 0);
    if (!weeks.some(w => w.id === wid)) wid = weeks[0].id;
    let mode = sessionStorage.getItem('go_mode') || 'total';
    mode = mode === 'total' ? 'total' : +mode;
    view.innerHTML = `<h1>${esc(title)}</h1><div class="sub">길드전 배치 화면 기준 · 비밸 = 체력 × 공격 × 방어 (백만)</div>
      <div class="row"><select class="in" id="wk">${weeks.map(w => `<option value="${w.id}"${w.id === wid ? ' selected' : ''}>${esc(weekLabel(w))}</option>`).join('')}</select><span class="grow"></span></div>
      <div class="buffs" id="buffs"></div>
      ${adminView ? '<div class="chips" id="chips"></div>' : ''}
      <div class="tabs" id="tabs">${['total', 0, 1, 2].map(m => `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${m === 'total' ? '합산' : SLOT[m]}</button>`).join('')}</div>
      <div id="tbl"></div>${adminView ? '<div id="missing"></div>' : ''}`;
    let specs = [];
    const draw = () => {
      $('#tbl').innerHTML = rankTable(specs, mode);
      $('#tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', String(mode) === b.dataset.m));
    };
    const load = async () => {
      const w = weeks.find(x => x.id === wid);
      $('#buffs').innerHTML = w && w.buffs ? '<b>이번 주 버프</b> · ' + esc(w.buffs) : '';
      $('#tbl').innerHTML = '<div class="empty">불러오는 중…</div>';
      specs = await getSpecs(wid);
      draw();
      if (adminView) {
        const mem = (await getMembers()).filter(m => m.active);
        const done = new Set(specs.map(s => s.member_id));
        const miss = mem.filter(m => !done.has(m.id));
        const tot = specs.map(s => s.total).filter(Boolean);
        $('#chips').innerHTML = `<div class="chip"><small>제출</small><b>${specs.length}</b> / ${mem.length}</div>
          <div class="chip"><small>합산 평균</small><b>${M(tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : 0)}</b></div>
          <div class="chip"><small>합산 1위</small><b>${M(tot.length ? Math.max(...tot) : 0)}</b></div>`;
        $('#missing').innerHTML = miss.length ? `<div class="card" style="margin-top:16px"><b>미제출 ${miss.length}명</b><div class="sub" style="margin:6px 0 0">${miss.map(m => esc(m.nickname)).join(' · ')}</div></div>` : '';
      }
    };
    $('#wk').onchange = e => { wid = +e.target.value; sessionStorage.setItem('go_week', wid); load(); };
    $('#tabs').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      mode = b.dataset.m === 'total' ? 'total' : +b.dataset.m; sessionStorage.setItem('go_mode', mode); draw();
    };
    await load();
  }
  PAGES.ranking = { render: () => rankingView(false) };
  PAGES.dashboard = { admin: true, render: () => rankingView(true) };

  /* ── 로그인 ─────────────────────────────────────── */
  PAGES.login = {
    async render() {
      if (me.role) { location.hash = '#/dashboard'; return; }
      let setup = false;
      try { setup = !!(await q(sb.rpc('go_needs_setup'))); } catch (_) {}
      view.innerHTML = setup
        ? `<div class="login card"><h1>처음 설정</h1><div class="sub">아직 관리자가 없어요. 마스터 계정으로 쓸 아이디와 비밀번호를 정해 주세요.</div>
          <form id="lf"><input class="in" id="uid" placeholder="아이디 (영문·숫자)" autocomplete="username" required>
          <input class="in" id="pw" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="new-password" required>
          <input class="in" id="pw2" type="password" placeholder="비밀번호 확인" autocomplete="new-password" required>
          <button class="btn gold" style="width:100%">마스터 계정 만들기</button><div class="status bad" id="lmsg" style="margin-top:8px"></div></form></div>`
        : `<div class="login card"><h1>관리자 로그인</h1><div class="sub">관리자 계정만 들어올 수 있어요.</div>
          <form id="lf"><input class="in" id="uid" placeholder="아이디" autocomplete="username" required>
          <input class="in" id="pw" type="password" placeholder="비밀번호" autocomplete="current-password" required>
          <button class="btn gold" style="width:100%">로그인</button><div class="status bad" id="lmsg" style="margin-top:8px"></div></form>
          ${me.session && !me.role ? '<div class="status bad">로그인은 됐지만 관리자로 등록된 계정이 아니에요.</div>' : ''}</div>`;
      $('#lf').onsubmit = async e => {
        e.preventDefault();
        const msg = $('#lmsg'); msg.textContent = '';
        const id = $('#uid').value.trim().toLowerCase(), pw = $('#pw').value;
        try {
          if (setup) {
            checkId(id); checkPw(pw);
            if (pw !== $('#pw2').value) throw new Error('비밀번호 확인이 달라요');
            const { data, error } = await sb.auth.signUp({ email: toEmail(id), password: pw });
            if (error) throw new Error(/signups? not allowed|disabled/i.test(error.message) ? 'Supabase에서 가입 허용(Allow new users to sign up)을 켜 주세요' : error.message);
            if (!data.session) throw new Error('Supabase에서 이메일 확인(Confirm email)을 꺼 주세요');
            await q(sb.rpc('go_bootstrap'));
          } else {
            const { error } = await sb.auth.signInWithPassword({ email: toEmail(id), password: pw });
            if (error) throw new Error('아이디나 비밀번호가 맞지 않아요');
          }
          await refreshMe();
          if (!me.role) throw new Error('관리자로 등록된 계정이 아니에요');
          log(setup ? 'setup' : 'login', '');
          location.hash = '#/dashboard';
        } catch (err) { msg.textContent = err.message; }
      };
    }
  };

  /* ── 스펙 입력 (스크린샷) ───────────────────────── */
  const norm = s => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function matchMember(nick, members) {
    const n = norm(nick); if (!n) return null;
    const sc = members.map(m => {
      const k = norm(m.nickname); if (!k) return { m, s: 0 };
      let s = 1 - lev(n, k) / Math.max(n.length, k.length);
      if (k.length >= 2 && (n.includes(k) || k.includes(n))) s = Math.max(s, 0.7 + 0.3 * Math.min(n.length, k.length) / Math.max(n.length, k.length));
      return { m, s };
    }).sort((a, b) => b.s - a.s);
    // 비슷한 후보가 둘 이상이면(예: Genesis.주 / Genesis.지용) 잘못 고르지 않게 직접 고르게 둔다
    if (!sc.length || sc[0].s < 0.5 || (sc[1] && sc[0].s - sc[1].s < 0.08)) return null;
    return sc[0].m;
  }

  PAGES.specs = {
    admin: true,
    async render() {
      let weeks = await getWeeks();
      const thisMon = monday();
      let members = await getMembers();
      let wid = +(sessionStorage.getItem('go_week') || 0);
      if (!weeks.some(w => w.id === wid)) wid = weeks.length ? weeks[0].id : 0;
      const items = []; let seq = 0;
      let existing = new Set();

      view.innerHTML = `<h1>스펙 입력</h1><div class="sub">길드전 배치 화면 스크린샷을 올리면 닉네임과 1·2·3번 드래곤 체/공/방을 읽어요. 읽은 값은 저장 전에 고칠 수 있어요.</div>
        <div class="card"><div class="row"><b>주차</b><select class="in" id="wk"></select>
        ${weeks.some(w => w.start_date === thisMon) ? '' : `<button class="btn gold sm" id="mkwk">이번 주(${thisMon.slice(5).replace('-', '/')}) 만들기</button>`}
        <span class="grow"></span><button class="btn sm" id="manual">직접 입력 추가</button></div>
        <label class="drop" id="drop" style="display:block;margin-top:12px"><input type="file" id="file" accept="image/*" multiple hidden>
        <b>스크린샷 선택</b> 또는 여기로 끌어다 놓기 · 여러 장 한 번에 가능</label>
        <div class="status" id="ocrmsg" style="margin-top:8px"></div></div>
        <div class="items" id="items"></div>
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn gold" id="saveall" hidden>전부 저장</button></div>`;

      const fillWeeks = () => {
        $('#wk').innerHTML = weeks.length ? weeks.map(w => `<option value="${w.id}"${w.id === wid ? ' selected' : ''}>${esc(weekLabel(w))}</option>`).join('') : '<option value="">주차 없음</option>';
      };
      const loadExisting = async () => { existing = new Set(wid ? (await getSpecs(wid)).map(s => s.member_id) : []); items.forEach(drawItem); };
      fillWeeks(); await loadExisting();
      $('#wk').onchange = e => { wid = +e.target.value; sessionStorage.setItem('go_week', wid); loadExisting(); };
      if ($('#mkwk')) $('#mkwk').onclick = async () => {
        const w = await q(sb.from('go_weeks').insert({ start_date: thisMon }).select().single());
        log('week.create', thisMon);
        weeks = await getWeeks(); wid = w.id; sessionStorage.setItem('go_week', wid); fillWeeks(); $('#mkwk').remove(); loadExisting();
      };

      const memberOpts = it => {
        const act = members.filter(m => m.active || m.id === it.memberId);
        return `<option value="">길드원 선택</option>` + act.map(m => `<option value="${m.id}"${m.id === it.memberId ? ' selected' : ''}>${esc(m.nickname)}</option>`).join('') +
          `<option value="new"${it.memberId === 'new' ? ' selected' : ''}>＋ 새 길드원 추가…</option>`;
      };
      function drawItem(it) {
        let el = document.getElementById('it-' + it.id);
        if (!el) { el = document.createElement('div'); el.id = 'it-' + it.id; $('#items').prepend(el); }
        el.className = 'item' + (it.saved ? ' saved' : '') + (it.error ? ' err' : '');
        if (it.reading) { el.innerHTML = `<div class="status">${esc(it.fileName)} 읽는 중…</div>`; return; }
        if (it.error) { el.innerHTML = `<div class="item-hd"><b>${esc(it.fileName)}</b><span class="status bad">${esc(it.error)}</span><span class="grow"></span><button class="btn sm" data-act="del">빼기</button></div>`; return; }
        const total = it.slots.reduce((a, s) => a + bvOf(s), 0);
        const dup = typeof it.memberId === 'number' && existing.has(it.memberId);
        el.innerHTML = `<div class="item-hd"><select class="in" data-k="member">${memberOpts(it)}</select>
          ${it.memberId === 'new' ? `<input class="in" data-k="newnick" placeholder="새 닉네임" value="${esc(it.newNick)}">` : ''}
          ${it.ocrNick ? `<span class="ocr">읽은 닉네임: ${esc(it.ocrNick)}</span>` : ''}
          ${dup ? '<span class="badge gold">이번 주 이미 제출 · 저장하면 덮어써요</span>' : ''}<span class="grow"></span></div>
          <div class="slots">${it.slots.map((s, i) => `<div class="slot"><div class="slot-hd"><span class="no">${SLOT[i]}</span></div>
            ${s.img ? `<img src="${s.img}" alt="">` : ''}
            <div class="f"><div><label style="color:var(--hp)">체력</label><input class="in" inputmode="numeric" data-s="${i}" data-f="hp" value="${s.hp || ''}"></div>
            <div><label style="color:var(--atk)">공격</label><input class="in" inputmode="numeric" data-s="${i}" data-f="atk" value="${s.atk || ''}"></div>
            <div><label style="color:var(--def)">방어</label><input class="in" inputmode="numeric" data-s="${i}" data-f="def" value="${s.def || ''}"></div></div>
            <div class="bvl">비밸 <b data-bv="${i}">${M(bvOf(s))}</b></div></div>`).join('')}</div>
          <div class="item-ft"><span class="total">합산 <b data-total>${M(total)}</b></span><span class="status ${it.saved ? 'ok' : ''}">${it.saved ? '저장됨' : esc(it.msg || '')}</span>
          <span class="row"><button class="btn sm" data-act="del">빼기</button><button class="btn gold sm" data-act="save">${it.saved ? '다시 저장' : '저장'}</button></span></div>`;
      }
      const findIt = el => items.find(x => 'it-' + x.id === el.closest('.item').id);
      $('#items').addEventListener('input', e => {
        const it = findIt(e.target); if (!it) return;
        if (e.target.dataset.s != null) {
          const s = it.slots[+e.target.dataset.s];
          s[e.target.dataset.f] = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
          it.saved = false;
          e.target.closest('.item').querySelector(`[data-bv="${e.target.dataset.s}"]`).textContent = M(bvOf(s));
          e.target.closest('.item').querySelector('[data-total]').textContent = M(it.slots.reduce((a, x) => a + bvOf(x), 0));
        } else if (e.target.dataset.k === 'newnick') { it.newNick = e.target.value; }
      });
      $('#items').addEventListener('change', e => {
        if (e.target.dataset.k !== 'member') return;
        const it = findIt(e.target); const v = e.target.value;
        it.memberId = v === 'new' ? 'new' : v ? +v : null;
        if (v === 'new' && !it.newNick) it.newNick = it.ocrNick || '';
        it.saved = false; drawItem(it);
      });
      $('#items').addEventListener('click', async e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const it = findIt(b);
        if (b.dataset.act === 'del') { items.splice(items.indexOf(it), 1); b.closest('.item').remove(); updAll(); return; }
        if (b.dataset.act === 'save') { b.disabled = true; await saveItem(it); b.disabled = false; }
      });
      async function saveItem(it) {
        try {
          if (!wid) throw new Error('주차를 먼저 만들어 주세요');
          if (it.memberId === 'new') {
            const nn = (it.newNick || '').trim(); if (!nn) throw new Error('새 닉네임을 적어 주세요');
            let m = members.find(x => x.nickname === nn);
            if (!m) { m = await q(sb.from('go_members').insert({ nickname: nn }).select().single()); log('member.add', nn); members = await getMembers(); }
            it.memberId = m.id;
          }
          if (typeof it.memberId !== 'number') throw new Error('길드원을 골라 주세요');
          if (!it.slots.some(s => bvOf(s) > 0)) throw new Error('체/공/방을 넣어 주세요');
          const slots = it.slots.map(s => ({ hp: s.hp || 0, atk: s.atk || 0, def: s.def || 0, img: s.img || '' }));
          const total = slots.reduce((a, s) => a + bvOf(s), 0);
          await q(sb.from('go_specs').upsert({ week_id: wid, member_id: it.memberId, slots, total, updated_by: toId(me.session.user.email), updated_at: new Date().toISOString() }, { onConflict: 'week_id,member_id' }));
          const m = members.find(x => x.id === it.memberId);
          log('spec.save', `${weeks.find(w => w.id === wid).start_date} ${m ? m.nickname : it.memberId} ${M(total)}`);
          existing.add(it.memberId);
          it.saved = true; it.msg = '';
        } catch (err) { it.msg = err.message; it.saved = false; }
        drawItem(it); updAll();
        return it.saved;
      }
      function updAll() { $('#saveall').hidden = !items.some(it => !it.saved && !it.error && !it.reading); }
      $('#saveall').onclick = async () => {
        let ok = 0, bad = 0;
        for (const it of items.filter(x => !x.saved && !x.error && !x.reading)) (await saveItem(it)) ? ok++ : bad++;
        toast(bad ? `${ok}개 저장 · ${bad}개는 확인이 필요해요` : `${ok}개 저장했어요`, !!bad);
      };
      $('#manual').onclick = () => {
        const it = { id: ++seq, fileName: '직접 입력', memberId: null, newNick: '', ocrNick: '', slots: [0, 1, 2].map(() => ({ hp: 0, atk: 0, def: 0, img: '' })) };
        items.push(it); drawItem(it); updAll();
      };

      let busy = Promise.resolve();
      const addFiles = files => {
        [...files].filter(f => /^image\//.test(f.type)).forEach(f => {
          const it = { id: ++seq, fileName: f.name, reading: true };
          items.push(it); drawItem(it);
          busy = busy.then(async () => {
            try {
              const r = await BvOCR.read(f, m => { $('#ocrmsg').textContent = m; });
              $('#ocrmsg').textContent = '';
              Object.assign(it, { reading: false, ocrNick: r.nick, slots: r.slots, newNick: '' });
              const m = matchMember(r.nick, members.filter(x => x.active));
              const exact = members.filter(x => x.active).length > 0;
              it.memberId = m ? m.id : (r.nick && !exact ? 'new' : null);
              if (!m) { it.newNick = r.nick; if (exact) it.msg = '길드원을 골라 주세요 (목록에 없으면 ＋ 새 길드원)'; }
              if (!r.slots.some(s => bvOf(s) > 0)) it.msg = '숫자를 못 읽었어요. 직접 넣어 주세요';
            } catch (err) { it.reading = false; it.error = err.message; }
            drawItem(it); updAll();
          });
        });
      };
      $('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
      const drop = $('#drop');
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
      document.onpaste = e => { if (route().name === 'specs' && e.clipboardData) addFiles(e.clipboardData.files); };
    }
  };

  /* ── 길드원 ─────────────────────────────────────── */
  PAGES.members = {
    admin: true,
    async render() {
      const members = await getMembers();
      view.innerHTML = `<h1>길드원</h1><div class="sub">랭킹에 나올 길드원 목록이에요. 탈퇴한 길드원은 '비활성'으로 두면 지난 기록은 남고 미제출 목록에서 빠져요.</div>
        <form class="row card" id="af"><input class="in grow" id="nn" placeholder="닉네임 추가"><button class="btn gold">추가</button></form>
        <div class="list" style="margin-top:12px">${members.length ? members.map(m => `<div class="li${m.active ? '' : ' off'}" data-id="${m.id}">
          <b class="grow">${esc(m.nickname)}</b>${m.active ? '' : '<span class="badge">비활성</span>'}
          <button class="btn sm" data-act="ren">이름 변경</button><button class="btn sm" data-act="act">${m.active ? '비활성' : '활성'}</button><button class="btn sm red" data-act="del">삭제</button></div>`).join('') : '<div class="empty">길드원이 없어요. 스펙 입력에서 새 닉네임으로 저장해도 자동으로 추가돼요.</div>'}</div>`;
      $('#af').onsubmit = async e => {
        e.preventDefault(); const nn = $('#nn').value.trim(); if (!nn) return;
        try { await q(sb.from('go_members').insert({ nickname: nn })); log('member.add', nn); go(); } catch (err) { toast(err.message, true); }
      };
      view.querySelector('.list').onclick = async e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const id = +b.closest('.li').dataset.id, m = members.find(x => x.id === id);
        try {
          if (b.dataset.act === 'ren') {
            const nn = prompt('새 닉네임', m.nickname); if (!nn || nn.trim() === m.nickname) return;
            await q(sb.from('go_members').update({ nickname: nn.trim() }).eq('id', id)); log('member.rename', m.nickname + ' → ' + nn.trim());
          } else if (b.dataset.act === 'act') {
            await q(sb.from('go_members').update({ active: !m.active }).eq('id', id)); log('member.active', m.nickname + ' ' + !m.active);
          } else {
            if (!confirm(`${m.nickname} 님을 삭제할까요? 이 길드원의 모든 주차 기록도 같이 지워져요.`)) return;
            await q(sb.from('go_members').delete().eq('id', id)); log('member.delete', m.nickname);
          }
          go();
        } catch (err) { toast(err.message, true); }
      };
    }
  };

  /* ── 주차 · 버프 ────────────────────────────────── */
  PAGES.weeks = {
    admin: true,
    async render() {
      const weeks = await getWeeks();
      const cnt = {};
      (await q(sb.from('go_specs').select('week_id'))).forEach(s => { cnt[s.week_id] = (cnt[s.week_id] || 0) + 1; });
      view.innerHTML = `<h1>주차 · 버프</h1><div class="sub">주차마다 이번 주 길드전 버프를 적어 두면 랭킹 위에 같이 보여요.</div>
        <form class="card" id="wf"><div class="row"><b>시작일</b><input class="in" type="date" id="sd" value="${monday()}"><input class="in grow" id="tt" placeholder="이름 (선택) 예: 11월 2주차"></div>
        <textarea class="in" id="bf" rows="2" style="width:100%;margin-top:8px" placeholder="버프 (선택) 예: 불·물 체력 40% / 빛 공격 40%, 디버프: 어둠 방어"></textarea>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn gold">주차 만들기</button></div></form>
        <div class="list" style="margin-top:12px">${weeks.map(w => `<div class="li" data-id="${w.id}"><div class="grow"><b>${esc(weekLabel(w))}</b>
          <div class="sub" style="margin:4px 0 0">${w.buffs ? esc(w.buffs) : '버프 미입력'}</div></div><span class="badge gold">제출 ${cnt[w.id] || 0}</span>
          <button class="btn sm" data-act="edit">수정</button><button class="btn sm red" data-act="del">삭제</button></div>`).join('') || '<div class="empty">주차가 없어요.</div>'}</div>`;
      $('#wf').onsubmit = async e => {
        e.preventDefault();
        try {
          const sd = monday($('#sd').value);
          await q(sb.from('go_weeks').insert({ start_date: sd, title: $('#tt').value.trim() || null, buffs: $('#bf').value.trim() || null }));
          log('week.create', sd); go();
        } catch (err) { toast(/duplicate|unique/i.test(err.message) ? '이미 있는 주차예요' : err.message, true); }
      };
      view.querySelector('.list').onclick = async e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const id = +b.closest('.li').dataset.id, w = weeks.find(x => x.id === id);
        try {
          if (b.dataset.act === 'edit') {
            const tt = prompt('주차 이름 (비우면 날짜만)', w.title || ''); if (tt === null) return;
            const bf = prompt('이번 주 버프', w.buffs || ''); if (bf === null) return;
            await q(sb.from('go_weeks').update({ title: tt.trim() || null, buffs: bf.trim() || null }).eq('id', id)); log('week.edit', w.start_date);
          } else {
            if (!confirm(`${weekLabel(w)}를 삭제할까요? 이 주차의 스펙 ${cnt[id] || 0}개도 같이 지워져요.`)) return;
            await q(sb.from('go_weeks').delete().eq('id', id)); log('week.delete', w.start_date);
          }
          go();
        } catch (err) { toast(err.message, true); }
      };
    }
  };

  /* ── 계정 (마스터) ──────────────────────────────── */
  PAGES.accounts = {
    admin: true, master: true,
    async render() {
      const list = await q(sb.from('go_admins').select('*').order('created_at'));
      view.innerHTML = `<h1>계정</h1><div class="sub">관리 화면에 들어올 수 있는 계정이에요. 아이디·비밀번호를 만들어서 운영진에게 알려주면 돼요.</div>
        <form class="row card" id="af"><input class="in grow" id="uid" placeholder="아이디 (영문·숫자)" autocomplete="off" required>
        <input class="in grow" id="pw" type="text" placeholder="비밀번호 (6자 이상)" autocomplete="off" required>
        <select class="in" id="rl"><option value="manager">관리자</option><option value="master">마스터</option></select><button class="btn gold">계정 만들기</button></form>
        <div class="list" style="margin-top:12px">${list.map(a => `<div class="li" data-em="${esc(a.email)}"><b class="grow">${esc(toId(a.email))}</b><span class="badge ${a.role === 'master' ? 'gold' : ''}">${a.role === 'master' ? '마스터' : '관리자'}</span>
          ${a.email.toLowerCase() === me.session.user.email.toLowerCase() ? '<span class="badge">나</span>' : '<button class="btn sm red" data-act="del">권한 삭제</button>'}</div>`).join('')}</div>`;
      $('#af').onsubmit = async e => {
        e.preventDefault();
        const id = $('#uid').value.trim().toLowerCase(), pw = $('#pw').value, role = $('#rl').value;
        try {
          checkId(id); checkPw(pw);
          const { data, error } = await sbTemp().auth.signUp({ email: toEmail(id), password: pw });
          if (error && !/already registered|already exists/i.test(error.message)) throw new Error(/not allowed|disabled/i.test(error.message) ? 'Supabase에서 가입 허용(Allow new users to sign up)을 켜 주세요' : error.message);
          if (error) toast('이미 있는 아이디라 권한만 다시 줬어요 (비밀번호는 그대로)');
          else if (!data.session) throw new Error('Supabase에서 이메일 확인(Confirm email)을 꺼 주세요');
          await q(sb.from('go_admins').upsert({ email: toEmail(id), role }));
          log('admin.add', id + ' ' + role); go();
        } catch (err) { toast(err.message, true); }
      };
      view.querySelector('.list').onclick = async e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const em = b.closest('.li').dataset.em; if (!confirm(toId(em) + ' 의 관리 권한을 뺄까요?')) return;
        try { await q(sb.from('go_admins').delete().eq('email', em)); log('admin.delete', toId(em)); go(); } catch (err) { toast(err.message, true); }
      };
    }
  };

  /* ── 기록 (마스터) ──────────────────────────────── */
  PAGES.logs = {
    admin: true, master: true,
    async render() {
      const rows = await q(sb.from('go_logs').select('*').order('at', { ascending: false }).limit(300));
      view.innerHTML = `<h1>기록</h1><div class="sub">최근 300개</div><div class="list">${rows.map(r => `<div class="li log"><span>${new Date(r.at).toLocaleString('ko-KR')}</span><b>${esc(r.actor || '')}</b><span>${esc(r.action)}</span><span class="grow">${esc(r.detail || '')}</span></div>`).join('') || '<div class="empty">기록이 없어요.</div>'}</div>`;
    }
  };

  sb.auth.onAuthStateChange(() => { setTimeout(refreshMe, 0); });
  refreshMe().then(go);
})();
