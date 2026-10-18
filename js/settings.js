// 设置：速度、思考时间、出牌方式、自动结束回合、快捷键（音量存在 Sound.S 里）。存 localStorage，读不到就用默认值
window.Settings = (function () {
  const DEF = { speed: 2, timer: 6, click: 2, autoEnd: true, respond: "ask", keys: true };
  const SPEEDS = [{ name: "慢", v: 1.3 }, { name: "正常", v: 1 }, { name: "快", v: 0.6 }, { name: "极快", v: 0.35 }];
  const S = Object.assign({}, DEF);
  try {
    if (localStorage.getItem("duixian_fast") === "0") S.speed = 1;      // 旧版只有快 / 慢
    Object.assign(S, JSON.parse(localStorage.getItem("duixian_settings") || "{}"));
  } catch (e) {}
  const save = () => { try { localStorage.setItem("duixian_settings", JSON.stringify(S)); } catch (e) {} };
  const subs = [];
  function set(k, v) { S[k] = v; save(); subs.forEach((f) => f(k, v)); }
  function reset() {
    Object.assign(S, DEF); save();
    for (const [k, v] of Object.entries(Sound.DEF)) Sound.setVol(k, v);
    subs.forEach((f) => f());
  }
  const speed = () => (SPEEDS[S.speed] || SPEEDS[2]).v;

  // ---------------------------------------------------------------- 全屏
  const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const canFull = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const standalone = () => { try { return window.navigator.standalone === true || matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches; } catch (e) { return false; } };
  const IOS = /iPhone|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.platform || "") && navigator.maxTouchPoints > 1 && !canFull());
  function toggleFull() {
    if (!canFull()) {
      UI.toast(IOS ? "iPhone 浏览器不支持网页全屏：在 Safari 点「分享 → 添加到主屏幕」，以后从桌面图标打开就是全屏"
        : "这个浏览器不支持全屏，可以试试「添加到主屏幕」", 5200);
      return;
    }
    const d = document.documentElement;
    try {
      if (fsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const r = (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: "hide" }); if (r && r.catch) r.catch(() => UI.toast("没能进入全屏")); }
    } catch (e) { UI.toast("没能进入全屏"); }
  }

  // ---------------------------------------------------------------- 设置面板（借用 #modal）
  const $ = (s) => document.querySelector(s);
  function seg(k, opts) {
    return `<div class="seg" data-k="${k}">${opts.map(([v, label]) => `<button data-v="${v}">${label}</button>`).join("")}</div>`;
  }
  function vol(k, label) {
    return `<div class="set-row"><label>${label}</label><input type="range" min="0" max="100" step="1" data-vol="${k}"><span class="val" data-val="${k}"></span></div>`;
  }
  function open() {
    $("#modal-body").innerHTML = `<h2>设置</h2>
      <div class="settings">
        <div class="set-col">
          <h3>声音</h3>
          ${vol("musicVol", "音乐")}${vol("sfxVol", "音效")}${vol("voiceVol", "配音")}
          <h3>节奏</h3>
          <div class="set-row"><label>游戏速度</label>${seg("speed", SPEEDS.map((s, i) => [i, s.name]))}</div>
          <div class="set-row"><label>思考时间</label>${seg("timer", [[4, "4 秒"], [6, "6 秒"], [10, "10 秒"], [0, "不限时"]])}</div>
          <p class="set-note">被吐槽、要不要发动技能时的倒计时；时间到了按默认处理。</p>
        </div>
        <div class="set-col">
          <h3>出牌</h3>
          <div class="set-row"><label>出牌方式</label>${seg("click", [[2, "点两下"], [1, "点一下"]])}</div>
          <p class="set-note">点两下：先选中看清效果，再点一次出牌。点一下：直接出（要选目标的牌仍然要点对手）。也可以把牌拖到对手身上。</p>
          <div class="set-row"><label>被吐槽时</label>${seg("respond", [["ask", "每次问我"], ["auto", "自动应对"]])}</div>
          <div class="set-row"><label>自动结束回合</label>${seg("autoEnd", [["1", "开"], ["0", "关"]])}</div>
          <p class="set-note">没有能出的牌、也没有能用的技能时，自动帮你结束回合。</p>
          <div class="set-row"><label>键盘快捷键</label>${seg("keys", [["1", "开"], ["0", "关"]])}</div>
          <p class="set-note keys">数字键 1–9 选牌，再按一次出牌 · 选目标时按对手头上的数字 · 空格 结束回合 · Enter 确认 · Esc 取消 · Q / W 技能</p>
        </div>
      </div>
      <div class="set-foot"><button class="btn small" id="set-full">全屏</button><button class="btn small" id="set-reset">恢复默认</button></div>`;
    const body = $("#modal-body");
    body.querySelectorAll("input[data-vol]").forEach((r) => {
      const k = r.dataset.vol, out = body.querySelector(`[data-val="${k}"]`);
      const show = () => { out.textContent = r.value; };
      r.value = Math.round(Sound.S[k] * 100); show();
      r.oninput = () => { Sound.setVol(k, r.value / 100); show(); };
      r.onchange = () => { if (k === "sfxVol") Sound.sfx("chime", 0.6); if (k === "voiceVol") Sound.voice(window.__game ? window.__game.human.key : "claude", "greet", 0); };
    });
    body.querySelectorAll(".seg").forEach((sg) => {
      const k = sg.dataset.k;
      const cur = () => String(typeof S[k] === "boolean" ? (S[k] ? 1 : 0) : S[k]);
      const paint = () => sg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === cur()));
      sg.querySelectorAll("button").forEach((b) => b.onclick = () => {
        const v = b.dataset.v;
        set(k, typeof DEF[k] === "boolean" ? v === "1" : typeof DEF[k] === "number" ? +v : v);
        Sound.sfx("click", 0.5); paint();
      });
      paint();
    });
    $("#set-reset").onclick = () => { reset(); Sound.sfx("click", 0.5); open(); UI.toast("已恢复默认设置"); };
    const fs = $("#set-full");
    fs.textContent = fsOn() ? "退出全屏" : "全屏";
    fs.classList.toggle("hidden", standalone());
    fs.onclick = () => { toggleFull(); setTimeout(() => { fs.textContent = fsOn() ? "退出全屏" : "全屏"; }, 400); };
    $("#modal-close").style.display = "";
    $("#modal").classList.remove("hidden");
  }

  return { S, DEF, SPEEDS, set, reset, speed, open, on: (f) => subs.push(f), fsOn, canFull, standalone, toggleFull };
})();
