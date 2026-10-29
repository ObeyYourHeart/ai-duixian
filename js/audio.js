// 声音：配乐（循环、说话时压低）、音效池、配音（每个角色一条声道）
// 音频对象全部复用、不再每次 new：iPad 的 Safari 每个 Audio 背后挂一个播放器、回收很慢，以前每局新建约 65 个，玩几局就越来越卡
window.Sound = (function () {
  const DEF = { musicVol: 0.32, sfxVol: 0.7, voiceVol: 1.0 };
  const S = Object.assign({ music: true, sfx: true }, DEF);
  try { Object.assign(S, JSON.parse(localStorage.getItem("duixian_sound") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("duixian_sound", JSON.stringify(S)); } catch (e) {} };
  const src = (p) => (window.ASSET && window.ASSET[p]) || p;
  let bgm = null, duck = 0, duckTimer = null, kind = null, lastPick = "";
  const decks = [new Audio(), new Audio()];                      // 配乐两台来回切：淡出一台、淡入另一台
  const pools = {};
  const voices = {};
  // 配乐：按场景换曲，切换时淡入淡出；对局曲每局随机一首
  const TRACKS = {
    menu: ["menu", "menu2", "menu3"],
    battle: ["bgm", "battle2", "battle3", "battle4", "battle5", "battle6", "battle7", "battle8", "battle9"], rage: ["rage"], win: ["win"], lose: ["lose"],
  };
  const level = () => S.musicVol * (duck ? 0.45 : 1);
  function fade(a, to, ms, done) {
    const from = a.volume, t0 = performance.now(), id = a._fade = (a._fade || 0) + 1;   // 同一台又开始新的渐变：旧的这条自己停下
    const step = () => {
      if (a._fade !== id) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    };
    step();
  }
  // 换到某个场景的曲子（同一场景不重复切）
  function track(next) {
    if (next === kind && bgm) { if (S.music && bgm.paused) bgm.play().catch(() => {}); return; }
    kind = next;
    const list = TRACKS[next] || TRACKS.battle;
    const old = bgm, a = old === decks[0] ? decks[1] : decks[0];
    const pool = list.length > 1 ? list.filter((n) => n !== lastPick) : list;   // 曲库多了：不连着放同一首
    lastPick = pool[Math.floor(Math.random() * pool.length)];
    a.pause(); a.src = src(`assets/music/${lastPick}.mp3`);
    a.loop = true; a.volume = 0; bgm = a;
    if (old) fade(old, 0, 700, () => { if (old !== bgm) old.pause(); });
    if (S.music) { a.play().catch(() => {}); fade(a, level(), 900); }
  }
  function music(on) {
    if (on !== undefined) { S.music = on; save(); }
    if (!bgm) track(kind || "menu");
    if (S.music) { bgm.play().catch(() => {}); fade(bgm, level(), 400); } else bgm.pause();
    return S.music;
  }
  function setDuck(ms) {
    duck = 1; if (bgm) bgm.volume = level();
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { duck = 0; if (bgm) fade(bgm, level(), 300); }, ms);
  }
  function sfx(name, vol = 1) {
    if (!S.sfx) return;
    const p = pools[name] || (pools[name] = []);
    let a = p.find((x) => x.paused || x.ended);
    if (!a && p.length < 4) { a = new Audio(src(`assets/sfx/${name}.mp3`)); p.push(a); }
    if (!a) { a = p.shift(); p.push(a); }                          // 4 个都在响：重用最早那个，不再新建
    a.volume = Math.min(1, S.sfxVol * vol);
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
  }
  // 配音：同一角色新话会打断旧话。返回时长（毫秒，估算）
  function voice(charKey, lineKey, idx) {
    if (!S.sfx || !S.voiceVol) return 0;
    const name = `${charKey}_${lineKey}${idx}`;
    if (!((window.VOICES || {})[name])) return 0;   // 还没配音的台词不发请求（VOICES：台词名 → 时长毫秒）
    const a = voices[charKey] || (voices[charKey] = new Audio());   // 每个角色一台，换句话只换音源
    a.pause(); a.src = src(`assets/voice/${name}.mp3`);
    a.volume = S.voiceVol;
    a.play().catch(() => {});
    setDuck(2200);
    return a;
  }
  function toggleSfx() { S.sfx = !S.sfx; save(); return S.sfx; }
  // 设置面板拖音量条：音乐实时变，音效 / 配音下一声生效
  function setVol(k, v) { S[k] = Math.max(0, Math.min(1, v)); save(); if (k === "musicVol" && bgm && S.music) bgm.volume = level(); }
  return { S, DEF, music, track, sfx, voice, toggleSfx, setVol };
})();
