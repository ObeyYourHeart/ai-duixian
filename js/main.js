// 页面流程：标题 → 选人 → 对局 → 结算
window.Main = (function () {
  const D = window.GAME_DATA, CH = D.chars, CD = D.cards;
  const $ = (s) => document.querySelector(s);
  const keys = Object.keys(CH);
  let pickKey = "claude", players = 3, lastOpp = null, game = null, applySpeed = () => {};

  // 舞台跟着屏幕比例走，不留空条：
  // 横屏 16:9 正好 1600x900；16:10、4:3 加高（最多 1200），超宽屏加宽（最多 2133）。
  // 竖屏（高比宽长）换竖排布局：宽 760、高按比例（至少 1300，最多 2000；偏方的屏幕改成加宽）。
  function fit() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    if (!w || !h) return;                       // 窗口还没显示出来（后台标签页、隐藏的框）：等 resize 再算
    const portrait = a < 1;
    let W, H;
    if (portrait) {
      W = 760; H = Math.round(760 / a);
      if (H < 1300) { H = 1300; W = Math.round(1300 * a); }
      H = Math.min(H, 2000);
    } else {
      W = 1600; H = 900;
      if (a < 16 / 9) H = Math.min(1200, Math.round(1600 / a)); else W = Math.min(2133, Math.round(900 * a));
    }
    const st = $("#stage");
    st.classList.toggle("portrait", portrait);
    st.style.width = W + "px"; st.style.height = H + "px";
    st.style.setProperty("--w", W + "px");
    st.style.setProperty("--dx", portrait ? "0px" : (W - 1600) / 2 + "px");
    st.style.setProperty("--dy", (portrait ? H - 1300 : H - 900) + "px");
    st.style.transform = `scale(${Math.min(w / W, h / H)})`;
    UI.layout(W, H, portrait);
  }
  function show(id) { document.querySelectorAll(".screen").forEach((e) => e.classList.toggle("active", e.id === id)); }

  function title() {
    const par = $("#title-parade"); par.innerHTML = "";
    const order = ["qwen", "kimi", "gemini", "gpt", "claude", "xds", "deepseek", "doubao", "grok", "glm"];
    order.forEach((k, i) => {
      const img = document.createElement("img"); img.src = UI.portrait(k, "base"); img.style.animationDelay = (i * 0.25) + "s";
      img.style.zIndex = Math.round(10 - Math.abs(i - 4.5) * 2); par.appendChild(img);
    });
    show("scr-title");
    Sound.track("menu");
  }

  function select() {
    const grid = $("#sel-grid"); grid.innerHTML = "";
    for (const k of keys) {
      const c = CH[k];
      const d = document.createElement("div"); d.className = "pick" + (k === pickKey ? " on" : "");
      d.style.setProperty("--c", c.color); d.style.setProperty("--l", c.light);
      d.innerHTML = `<img src="${UI.portrait(k, "base")}" alt=""><div class="pn${c.name.length > 7 ? " long" : ""}">${c.name}</div>`;
      d.onclick = () => { pickKey = k; Sound.sfx("click", 0.5); select(); Sound.voice(k, "greet", 0); };
      grid.appendChild(d);
    }
    const c = CH[pickKey];
    const det = $("#sel-detail"); det.style.setProperty("--c", c.color); det.style.setProperty("--l", c.light);
    $("#sd-img").src = UI.portrait(pickKey, "smug");
    $("#sd-name").textContent = c.name; $("#sd-name").style.whiteSpace = "nowrap"; $("#sd-name").style.fontSize = c.name.length > 7 ? "36px" : ""; $("#sd-title").textContent = c.title;
    $("#sd-bio").textContent = c.bio || "";
    $("#sd-hp").textContent = "心态 " + "❤".repeat(c.hp);
    $("#sd-skills").innerHTML = c.skills.map((s) => `<div class="sd-skill"><b>【${s.name}】</b><em>${s.type === "active" ? "主动" : "被动"}</em><p>${s.desc}</p></div>`).join("");
    show("scr-select");
  }

  function start(sameOpp) {
    let opp;
    if (sameOpp && lastOpp && !lastOpp.includes(pickKey)) opp = lastOpp;
    else {
      const pool = keys.filter((k) => k !== pickKey);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      opp = pool.slice(0, players - 1);
    }
    lastOpp = opp;
    show("scr-game");
    Sound.track("battle");
    UI.detach();
    applySpeed();                                       // 上一局观战加速过，这里恢复
    const mode = { 2: "duel", 3: "ffa", 4: "team", 5: "id5" }[players];
    game = window.__game = new Engine.Game([pickKey, ...opp], UI, { mode });
    UI.attach(game);
    game.run().catch((e) => console.error(e));
  }

  function rules() {
    const cards = Object.entries(CD).map(([k, d]) => `<div class="rc"><img src="${(window.ASSET && window.ASSET[`assets/img/card_${k}.webp`]) || `assets/img/card_${k}.webp`}" alt=""><b>${d.name}</b>
      <span>${d.desc}</span><small>${{ basic: "基本牌", trick: "锦囊牌", equip: "装备牌", bomb: "炸弹" }[d.type]} ${d.type === "bomb" ? "按人数埋" : "×" + d.n}</small></div>`).join("");
    modal(`<h2>玩法说明</h2>
      <p>${D.world || ""}</p>
      <p>AI娘们在群里吵起来了！每人有几点<b>心态</b>（❤），被【吐槽】又没能【反驳】就破防掉 1 点，心态掉光就<b>破防退群</b>。最后留在群里的人成为<b>群主</b>。</p>
      <h3>💣 宕机（炸弹猫玩法）</h3>
      <ul><li>开局牌堆里随机埋着【宕机】（单挑 1 张，三人 2 张，2v2 3 张，抢群主 2 张），每人先发 1 张【重启】。</li>
      <li>谁摸到【宕机】谁炸：心态 −2，宕机再被随机塞回牌堆。手里有【重启】就能拆掉，然后<b>自己决定</b>把它偷偷塞回牌堆的哪里——比如下家马上要摸的最上面。手里有【甩锅】也能把宕机甩给别人。</li>
      <li>顶栏的 💣 是牌堆里还剩几张宕机，后面是下一张摸到宕机的概率。牌越摸越少，概率越来越高。</li>
      <li>【剧透】偷看牌堆顶 3 张；【插队】把牌堆顶 3 张重新排；【重新生成】洗乱牌堆；【摸鱼】从牌堆底摸牌。看过的牌会一直显示在牌桌上，直到有人动了牌堆。</li></ul>
      <h3>回合流程</h3>
      <ol><li>摸 2 张牌</li><li>出牌：想出几张出几张，但【吐槽】每回合只能用 1 次（第 3 轮起大家吵上头了，可以用 2 次）</li><li>弃牌：手牌不能超过当前心态（有的角色上限更高）</li></ol>
      <h3>模式</h3>
      <ul><li><b>三人乱斗</b>：最后留在群里的人当群主。</li><li><b>单挑</b>：一对一。</li>
      <li><b>2v2</b>：座位是 你—对手—对手—队友，把对面两人都踢出群就赢；单体牌和点名技能不能对队友用；先手第一回合多摸 1 张。</li>
      <li><b>抢群主</b>（5 人）：随机身份。<b>群主</b>公开、多 2 点心态、先手，要和暗中的<b>管理员</b>一起踢掉所有<b>黑粉</b>和<b>潜水党</b>；两个<b>黑粉</b>要把群主踢出群；<b>潜水党</b>要先帮群主清掉黑粉，最后单挑踢掉群主，自己当新群主。除了群主，身份退群后才翻开。踢掉黑粉奖励摸 3 张；群主踢了自己的管理员要弃光手牌。你退群后会加速观战到结束。</li></ul>
      <h3>操作</h3>
      <ul><li>点一张牌看效果，再点一次出牌；也可以直接把牌往上拖出去。要选目标的牌，点对手或把牌拖到她身上。</li>
      <li>主动技能在右下角按钮。被吐槽时会弹出提示，倒计时结束按默认处理。</li>
      <li>键盘：数字键 1–9 选牌（选目标时按对手头上的数字），Enter 确认，空格 结束回合，Esc 取消，Q / W 技能。</li>
      <li>右上角 ⚙ 设置：音量、速度、思考时间、“点一下就出”、自动应对、自动结束回合。</li>
      <li>手机竖着、横着都能玩，画面自动铺满。首页右上角和对局工具栏有【全屏】按钮；iPhone 不支持网页全屏，可以在 Safari 点「分享 → 添加到主屏幕」，从桌面图标打开就是全屏。</li></ul>
      <h3>人物关系</h3>
      <ul>${(D.relations || []).map(([a, b, t, note]) => `<li><b>${{ ally: "盟友", friend: "交好", rival: "宿敌" }[t]}</b>：${CH[a].name} × ${CH[b].name}——${note}</li>`).join("")}</ul>
      <p>三人乱斗和单挑里：盟友在场上还有别人时互不吐槽，只剩她俩时「协议到期」；宿敌会优先针对对方；交好的下手轻一点。</p>
      <h3>装备与特殊牌</h3>
      <ul><li><b>装备</b>（绿色牌名）用了就放进自己的装备栏，一直生效；装备栏只有一格，换新的旧的就弃掉。【白嫖】【撤回】也能拿走或弃掉对方的装备。</li>
      <li><b>【甩锅】</b>在被吐槽时打出，把吐槽转给别人；<b>【截图】</b>过的人这回合挡不了你的吐槽。</li>
      <li><b>【甩锅】</b>摸到【宕机】时也能用：把宕机甩给另一名角色，让她拆或者炸。</li></ul>
      <p>心态降到 0 时，手里有【奶茶】会自动喝掉自救。把别人怼到退群，你摸 2 张牌作为奖励。每位 AI娘 都有两个技能：<b>主动技</b>在出牌阶段点左下角的技能按钮发动，<b>被动技</b>自动生效。点角色卡上的技能名可以查看说明。</p>
      <h3>卡牌（共 ${Object.values(CD).reduce((s, d) => s + d.n, 0)} 张）</h3><div class="rules-cards">${cards}</div>`);
  }
  function credits() {
    const sfx = (window.CREDITS || []).map((c) => `<li>“${c.title}” by ${c.creator} — ${c.license.toUpperCase()}</li>`).join("");
    modal(`<h2>素材署名</h2>
      <h3>配乐</h3><ul><li>“Idempotence” by Social Bot 73XT — CC BY 3.0</li><li>其余配乐为免版税音乐</li></ul>
      <h3>音效（CC BY）</h3><ul>${sfx}</ul><p>其余音效为 CC0 公共领域素材。</p>
      <h3>美术与配音</h3><p>角色立绘、插画与配音均为 AI 生成。字体：阿里妈妈方圆体、阿里巴巴普惠体 2.0。</p>`);
  }
  function modal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }

  function boot() {
    fit(); window.addEventListener("resize", fit);
    UI.bindButtons();
    $("#btn-start").onclick = () => { Sound.track("menu"); Sound.music(Sound.S.music); Sound.sfx("click"); select(); };
    $("#btn-rules").onclick = () => { Sound.sfx("click"); rules(); };
    $("#btn-credits").onclick = () => { Sound.sfx("click"); credits(); };
    $("#btn-go").onclick = () => { Sound.sfx("click"); start(false); };
    $("#btn-back").onclick = () => { Sound.sfx("click"); title(); };
    $("#modal-close").onclick = () => $("#modal").classList.add("hidden");
    document.querySelectorAll(".mode").forEach((b) => b.onclick = () => {
      players = +b.dataset.mode; document.querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b)); Sound.sfx("click", 0.5);
    });
    // 速度四档：工具栏点一下换档，设置面板里也能选
    const sp = $("#tb-speed");
    const paintSpeed = () => { Engine.speed = Settings.speed(); sp.textContent = Settings.SPEEDS[Settings.S.speed].name; };
    paintSpeed();
    applySpeed = paintSpeed;
    Settings.on((k) => { if (!k || k === "speed") paintSpeed(); if (game && !game.over) UI.sync(); });
    sp.onclick = () => { Settings.set("speed", (Settings.S.speed + 1) % Settings.SPEEDS.length); Sound.sfx("click", 0.5); UI.toast(`速度：${Settings.SPEEDS[Settings.S.speed].name}`); };
    $("#tb-set").onclick = () => { Sound.sfx("click", 0.5); Settings.open(); };
    // 全屏：首页右上角和对局工具栏都有；iPhone 不支持网页全屏，就教她“添加到主屏幕”
    const paintFull = () => {
      const on = Settings.fsOn();
      $("#btn-full").querySelector("span").textContent = on ? "退出全屏" : "全屏";
      $("#tb-full").classList.toggle("on", on); $("#tb-full").title = on ? "退出全屏" : "全屏";
      const hide = Settings.standalone();          // 已经从主屏幕图标打开（本来就是全屏）
      $("#btn-full").classList.toggle("hidden", hide); $("#tb-full").classList.toggle("hidden", hide);
    };
    $("#btn-full").onclick = () => { Sound.sfx("click", 0.5); Settings.toggleFull(); };
    $("#tb-full").onclick = () => { Sound.sfx("click", 0.5); Settings.toggleFull(); };
    document.addEventListener("fullscreenchange", paintFull); document.addEventListener("webkitfullscreenchange", paintFull);
    paintFull();
    $("#btn-settings").onclick = () => { Sound.sfx("click"); Settings.open(); };
    const mu = $("#tb-music"); mu.classList.toggle("off", !Sound.S.music);
    mu.onclick = () => { const on = Sound.music(!Sound.S.music); mu.classList.toggle("off", !on); };
    const sf = $("#tb-sfx"); sf.classList.toggle("off", !Sound.S.sfx);
    sf.onclick = () => { const on = Sound.toggleSfx(); sf.classList.toggle("off", !on); };
    $("#tb-rules").onclick = rules;
    let quitT = 0;
    $("#tb-quit").onclick = () => {
      if (performance.now() - quitT > 2000) { quitT = performance.now(); UI.toast("再点一次退出这一局"); return; }
      if (game) { game.over = true; game.ui = new Proxy({}, { get: () => () => new Promise(() => {}) }); }
      UI.detach(); title();
    };
    title();
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { again: () => start(true), toSelect: () => select() };
})();
