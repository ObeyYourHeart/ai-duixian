// 界面：座位/手牌/群聊/动画/玩家输入。坐标都是舞台坐标（layout() 更新）：
// 横屏基准 1600x900，舞台变宽 / 变高时中间的东西右移 DX、底部的东西下移 DY；
// 竖屏基准 760x1300：对手在上、桌面、群聊、自己 + 按钮、手牌在最下，多出来的高度分给桌面和群聊（DY = 高 - 1300）。
window.UI = (function () {
  // v51 老浏览器（iOS / iPadOS 15 及更早、Chrome 99 前、Firefox 112 前）的 canvas 没有 roundRect：补一个。
  //   许愿之神的纹章 / 贴纸在对局流程里同步调用它，没有的话第一次上线或许愿就抛错，整局卡住
  if (window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.max(0, Math.min(+r || 0, Math.abs(w) / 2, Math.abs(h) / 2)); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
  const CD = window.GAME_DATA.cards;
  const $ = (s) => document.querySelector(s);
  const A = (p) => (window.ASSET && window.ASSET[p]) || p;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const HERO_W = 214, HERO_H = 300, CARD_W = 150, CARD_H = 212;
  let SW = 1600, SH = 900, DX = 0, DY = 0, HAND_X = 270, HAND_Y = 668, HAND_W = 900, TABLE_X = 260, TABLE_Y = 390, PROMPT_Y = 590, PORTRAIT = false;
  let HS = 1, ME_S = 0.8, ME_Y = 840, OPP_S = 1;          // 竖屏：手牌缩放、自己卡的缩放和位置、对手卡缩放
  const POS = { 3: [{ x: 36, y: 568 }, { x: 760, y: 80 }, { x: 300, y: 80 }], 2: [{ x: 36, y: 568 }, { x: 530, y: 80 }],
    4: [{ x: 36, y: 568 }, { x: 980, y: 80 }, { x: 630, y: 80 }, { x: 280, y: 80 }],
    5: [{ x: 36, y: 568 }, { x: 940, y: 80 }, { x: 720, y: 80 }, { x: 500, y: 80 }, { x: 280, y: 80 }],
    6: [{ x: 36, y: 568 }, { x: 1002, y: 80 }, { x: 814, y: 80 }, { x: 626, y: 80 }, { x: 438, y: 80 }, { x: 250, y: 80 }] };   // 6 人：对手卡缩到 0.84 排一行
  let PILE = { x: 710, y: 480 }, DECK = { x: 420, y: 480 };
  const EQ_ICON = { xianka: "🎮", fanghuoqiang: "🛡", chongdianbao: "🔋", yunbeifen: "☁️", jiami: "🔐", zw_claude: "⚔", zw_gpt: "⚔", zw_gemini: "⚔", zw_grok: "⚔", zw_dsh: "⚔" };   // v47 专武
  const HEART = '<svg class="heart%c" viewBox="0 0 24 22"><path d="M12 20.5C5 15 1.5 11.6 1.5 7.2 1.5 4 4 1.5 7.1 1.5c2 0 3.8 1 4.9 2.6C13.1 2.5 14.9 1.5 16.9 1.5 20 1.5 22.5 4 22.5 7.2c0 4.4-3.5 7.8-10.5 13.3z"/></svg>';

  let g = null, heroes = [], exprTimers = {}, lastSay = {};
  let mode = null, selected = null, skillMode = null, busy = false, actTok = 0;   // actTok：每次出牌 / 用技能一个编号，退出后旧局迟到的收尾不再改动新局
  let playResolve = null, respondResolve = null, discardResolve = null, discardPick = [], promptTimer = null, respondCards = [];
  let hoverId = null, hoverT = null, drag = null, suppressClick = 0, dropPt = null, dropId = null, autoT = null, targetList = [], promptKind = null;
  const SET = () => window.Settings ? Settings.S : { timer: 6, click: 2, autoEnd: true, respond: "ask", keys: true };
  const timerMs = () => SET().timer * 1000;

  function wait(ms) { return Engine.wait(ms); }
  // 角色卡缩放：竖屏时自己的卡 0.8；对手放不下一排时一起缩小
  function seatScale(p) {
    if (!PORTRAIT) return g && g.players.length >= 6 && p.i !== 0 ? 0.84 : 1;
    return p.i === 0 ? ME_S : OPP_S;
  }
  function pos(p) {
    if (!g) return { x: 0, y: 0 };                          // 退出后还在播的动画：不再读已经卸下的对局
    if (!PORTRAIT) { const b = POS[g.players.length][p.i]; return { x: b.x + DX, y: b.y + (p.i === 0 ? DY : 0) }; }   // 0 号座位（自己）贴底
    if (p.i === 0) return { x: 16, y: ME_Y };
    const n = g.players.length - 1, w = HERO_W * seatScale(p), gap = seatScale(p) < 1 ? 12 : 14;
    const x0 = (SW - (n * w + (n - 1) * gap)) / 2;
    return { x: x0 + (n - p.i) * (w + gap), y: 74 };                 // 和横屏一样：1 号座位在最右，往左排
  }
  function placeHero(p) {
    const h = heroes[p.i]; if (!h) return;
    const q = pos(p), s = seatScale(p);
    h.style.left = q.x + "px"; h.style.top = q.y + "px";
    h.style.scale = s === 1 ? "" : String(s); h.style.transformOrigin = s === 1 ? "" : "0 0";
  }
  // 舞台尺寸变了（换屏幕、全屏、转手机）：重算坐标，把角色卡和手牌挪到新位置
  function layout(W, H, portrait) { SW = W; SH = H; PORTRAIT = !!portrait; for (const s of ["#ctip", "#hinfo"]) { const e = $(s); if (e) e._sig = ""; } relayout(); }   // v49 重新布局（含切到 / 切出小屏 tiny）：浮窗、详情卡的缓存作废，重新量尺寸、摆位置
  function relayout() {
    const W = SW, H = SH;
    if (PORTRAIT) {
      // 从下往上：手牌（屏幕越长越大）→ 自己 + 按钮 → 群聊（剩下的高度）→ 桌面 → 对手一排
      DX = 0; DY = H - 1300;
      HS = Math.max(1, Math.min(1.3, 1 + DY / 500));
      ME_S = Math.max(0.8, Math.min(1, 0.8 + DY / 1000));
      HAND_W = W - 32; HAND_X = 16; HAND_Y = H - 220 * HS; PROMPT_Y = HAND_Y - 96;
      ME_Y = HAND_Y - 8 - HERO_H * ME_S;
      const n = g ? g.players.length - 1 : 2;
      OPP_S = n * HERO_W + (n - 1) * 14 <= W - 32 ? 1 : (W - 32 - (n - 1) * 12) / n / HERO_W;
      TABLE_X = 0; TABLE_Y = 74 + HERO_H * OPP_S + 12;
      PILE = { x: W / 2, y: TABLE_Y + 135 }; DECK = { x: W * 0.2, y: TABLE_Y + 135 };
      const chatY = TABLE_Y + 280, st = $("#stage").style;
      const v = { "--hand-y": HAND_Y, "--hand-s": HS, "--me-y": ME_Y, "--act-x": 16 + HERO_W * ME_S + 14, "--act-h": HERO_H * ME_S,
        "--chat-y": chatY, "--chat-h": Math.max(120, ME_Y - 12 - chatY), "--table-y": TABLE_Y, "--prompt-y": PROMPT_Y };
      for (const [k, x] of Object.entries(v)) st.setProperty(k, k === "--hand-s" ? String(x) : x + "px");
    } else {
      HS = 1;
      DX = (W - 1600) / 2; DY = H - 900;
      HAND_W = 900; HAND_X = 270 + DX; HAND_Y = 668 + DY; PROMPT_Y = 572 + DY; TABLE_X = 260 + DX; TABLE_Y = 390 + DY / 2;
      PILE = { x: 710 + DX, y: 480 + DY / 2 }; DECK = { x: 420 + DX, y: 480 + DY / 2 };
    }
    if (!g) return;
    for (const p of g.players) placeHero(p);
    renderHand();
  }
  function center(p) { const q = pos(p), s = seatScale(p); return { x: q.x + HERO_W * s / 2, y: q.y + (HERO_H / 2 - 20) * s }; }
  const SKIN_E = new Set(["base", "smug", "hurt", "win", "pose"]);   // 皮肤只换这几张；头像、技能切入图用原版
  function portrait(key, e) {
    const sk = SKIN_E.has(e) && window.Settings ? Settings.skinOf(key) : "";
    return A(sk ? `assets/img/${key}_${sk}_${e}.webp` : `assets/img/${key}_${e}.webp`);
  }
  const pkey = (p) => (p.disguise ? "xds_cl" : p.key);              // 变身的小DeepSeek 换伪装立绘

  // ---------------------------------------------------------------- 牌面
  function cardEl(c, big) {
    const d = CD[c.k];
    const e = el("div", `card ${d.type}${big ? " big" : ""}${d.name.length > 3 ? " long" : ""}`);
    e.innerHTML = `<div class="cn">${d.name}</div><img src="${A(`assets/img/card_${c.k}.webp`)}" alt="" draggable="false"><div class="ct">${d.owner ? `${window.GAME_DATA.chars[d.owner].name} 专武` : { basic: "基本", trick: "锦囊", equip: "装备", bomb: "炸弹" }[d.type]}</div><div class="cd">${d.short}</div>`;
    e.dataset.id = c.id;
    e.title = d.desc;
    return e;
  }

  // ---------------------------------------------------------------- 装配
  function attach(game) {
    g = game; heroes = []; hzPre = []; for (const k in blinkAt) delete blinkAt[k]; rage(false);
    const seats = $("#seats"); seats.innerHTML = "";
    $("#pile").innerHTML = ""; $("#chat-list").innerHTML = ""; $("#fx").innerHTML = ""; skillSig = "";
    $("#chat-n").textContent = g.players.length;
    setTimeout(() => warmUlt(game), 2500);                          // v50 开局后趁空把大招文字先排一遍，第一次开大招不再卡一下
    $("#chat-name").textContent = g.nation ? "AI 全明星赛" : "AI娘 相亲相爱一家人";
    for (const p of g.players) {
      const h = el("div", "hero" + (p.ch.skills.some((s) => s.id === "rehearse") ? " has-band" : ""));
      h.style.setProperty("--c", p.ch.color); h.style.setProperty("--l", p.ch.light);
      if (p.key === "glm" && !(window.Settings && Settings.skinOf(p.key))) h.dataset.wide = "1";   // v51 这两位的默认立绘两边有空边，角色框里多放大一点（见 style.css .hero[data-wide]）
      const vis = p.ch.skills.filter((s) => !s.harness);                  // v48 Harness 不算普通技能
      const tags = vis.map((s) => `<span class="${s.type}" title="${s.short || s.desc}">${s.name}</span>`).join("");
      h.innerHTML = `<div class="por"><img src="${portrait(p.key, "base")}" alt=""></div><div class="flash"></div><div class="hp"></div>
        <div class="cnt"><i></i><span>0</span></div><div class="status"></div><div class="stags${vis.length > 3 ? " many" : ""}">${tags}</div>
        <div class="hzbar"></div><div class="plate"><b>${p.name}</b><small></small></div>${p.human ? '<div class="you">你</div>' : ""}${p.ch.skills.some((s) => s.id === "rehearse") ? '<div class="band"></div>' : ""}<div class="side"></div><div class="tnum"></div>`;
      // 点技能名直接打开详情卡；但她正被当作目标时，点哪里都算选她
      h.querySelectorAll(".stags span").forEach((sp, k) => sp.addEventListener("click", (ev) => {
        if (h.classList.contains("target")) return;
        ev.stopPropagation(); showHeroInfo(p, vis[k].id);
      }));
      h.addEventListener("click", () => onHeroClick(p));
      seats.appendChild(h);
      heroes[p.i] = h;
    }
    hoverId = null; drag = null; dropPt = null; dropId = null; clearTimeout(autoT);
    let tip = $("#ctip");
    if (!tip) { tip = el("div"); tip.id = "ctip"; $("#scr-game").appendChild(tip); }
    tip.className = "hidden";
    let hi = $("#hinfo");
    if (!hi) { hi = el("div"); hi.id = "hinfo"; $("#scr-game").appendChild(hi); }
    hi.className = "hidden"; infoP = null;
    relayout();
    const me = g.human;
    const GOAL = { lord: "守住群：把黑粉和潜水党都踢出群", loyal: "暗中帮群主，踢掉黑粉和潜水党", rebel: "把群主踢出群", spy: "先装成管理员帮群主踢黑粉，黑粉清完就反水踢管理员，最后单挑群主，自己当新群主（你暗中每回合多摸 1 张；只剩你和群主时会冒泡：心态 +1、摸 2 张）" };
    const NA = window.GAME_DATA.nations || {}, mates = g.players.filter((q) => q !== me && q.team === me.team).map((q) => q.name).join("、");
    const goal = g.mode === "team" && g.nation ? `全明星赛：你在 <b>${(NA[me.ch.nation] || {}).name}</b>，队友 <b>${mates}</b>。`
      : g.mode === "team" ? `你和 <b>${mates}</b> 一队。`
      : g.mode === "id5" ? `你的身份是 <b>${Engine.ROLE[me.role]}</b>：${GOAL[me.role]}。` : "";
    hint(`${goal}你是 <b>${me.name}</b>。<small>点任何一张角色卡，都能看她的技能和状态。</small>`);
    sync();
    blinkStart();
  }

  // 阵营 / 身份牌：2v2 标队友和对手；抢群主只亮群主、自己和退群的人，其他人是“？”
  function sideLabel(p) {
    if (g.mode === "team" && g.nation) return p.human ? null : { text: ((window.GAME_DATA.nations || {})[p.ch.nation] || {}).name || "", cls: (p.team === g.human.team ? "ally" : "foe") + " nat-" + p.ch.nation };
    if (g.mode === "team") return p.human ? null : p.team === g.human.team ? { text: "队友", cls: "ally" } : { text: "对手", cls: "foe" };
    if (g.mode === "id5") {
      if (p.role === "lord" || p.human || p.revealed) return { text: Engine.ROLE[p.role], cls: "role-" + p.role };
      return { text: "？", cls: "unknown" };
    }
    if (g.mode === "ffa" || g.mode === "duel") {
      if (p.human) return null;
      const r = g.relation(p, g.human);
      if (r === "ally") return { text: "盟友", cls: "ally" };
      if (r === "rival") return { text: "宿敌", cls: "foe" };
      if (r === "mentor") return { text: p.key === "glm" ? "师父" : "徒弟", cls: "mentor" };
    }
    return null;
  }

  // v49 sync 每出一张牌要跑 4–5 次：值没变就不写（写一次 DOM 就要重新解析 + 后面整页重排）
  function put(e, v) { if (e && e.textContent !== v) e.textContent = v; }
  const TR = !!(window.CSS && CSS.supports && CSS.supports("translate", "1px 2px"));   // v49 手牌走 translate（不支持的老浏览器照旧用 left/top）
  function sync() {
    if (!g) return;
    for (const p of g.players) {
      const h = heroes[p.i];
      const hpE = h.querySelector(".hp"), hs = p.hp + "/" + p.maxHp;
      if (hpE.dataset.s !== hs) { hpE.dataset.s = hs; let hp = ""; for (let k = 0; k < p.maxHp; k++) hp += HEART.replace("%c", k < p.hp ? "" : " empty"); hpE.innerHTML = hp; }
      put(h.querySelector(".cnt span"), String(p.hand.length));
      h.classList.toggle("out", !p.alive);
      if (!p.alive && !h.querySelector(".stamp")) h.appendChild(el("div", "stamp", "退群"));
      let st = "";
      if (p.banned) st += '<span class="ban">🚫 封号中</span>';
      if (p.muted) st += '<span>🔇 禁言中</span>';
      if (p.dumb) st += '<span class="dumb">❓ 降智中</span>';
      if (p.offline) st += '<span>📵 断网中</span>';
      if (p.boost) st += '<span class="boost">🧠 深度思考中</span>';
      if (p.napping) st += '<span>😴 补觉中</span>';
      if (p.disguise) st += '<span class="boost">🎭 冒充 Claude</span>';
      if (p.eggBy) st += '<span class="bomb">🥚 领了鸡蛋</span>';
      if (p.dadSpent && Engine.T.buyDad && p.alive) st += '<span>💳 记爸爸账上</span>';   // v56 下回合爸爸不补牌
      if (g.players[g.cur] && g.players[g.cur].oracle === p) st += '<span class="bomb">🐚 被海螺点名</span>';
      if (g.bomb && g.bomb.holder === p) st += '<span class="bomb">💣 宕机预警</span>';
      { const hb = h.querySelector(".hzbar");                                  // v48 Harness 部署条：名牌上方一条细进度条（不再挤在状态标签里）
        if (hb) { const H = p.ch.harness, n = g.deployNeed(p), d = Math.min(n, p.deploy || 0), nm = p.key === "xds" ? (p.disguise ? "Claude Code" : "DSH") : H && H.name;
          const sig = !H || !p.alive ? "" : p.deployed ? "on|" + nm : d + "/" + n + nm;
          if (hb.dataset.s !== sig) { hb.dataset.s = sig; hb.className = "hzbar" + (!sig ? " none" : p.deployed ? " on" : ""); h.classList.toggle("hzp", !!sig);   // v50 不用 :has()（每次改 DOM 都要重算，平板上卡）
            hb.innerHTML = !sig ? "" : p.deployed ? `<b>${nm}</b><em>ONLINE</em>` : `<b>${nm}</b><i style="--f:${(d / n).toFixed(3)}"></i><em>${d}/${n}</em>`; hb.title = H ? H.short : ""; }
          if (H && p.alive && !p.deployed && n - d <= 1 && !hzPre[p.i] && Engine.speed > 0) hzPre[p.i] = ["a", "b"].map((f) => { const im = new Image(); im.src = hzImg(p, f); if (im.decode) im.decode().catch(() => {}); return im; }); } }   // v49 差 1 格就上线：先把上线立绘下载、解码好（演出开始才建图片，慢网第一次大招会空着）；演完放掉
      for (const eq of g.equips(p)) st += `<span class="eq${CD[eq.k].owner ? " zw" : ""}">${EQ_ICON[eq.k] || "🧰"} ${CD[eq.k].name}</span>`;   // 分格后可能不止一件
      if (p.cloud) st += '<span class="eq zw">☁ 云端任务跑着</span>';                                       // v47 Codex
      if (p.clip) st += '<span class="eq zw" title="MiniMax Code 素材库：1 条【吐槽】，下次兔子快递先烧它">🎞 素材</span>';   // v49 MiniMax Code
      if (p.bgTask) st += `<span class="eq zw" title="Muse Code：Jolly 在后台办【${CD[p.bgTask.k].name}】，她下回合一开始自动打出">🧸 Jolly 跑腿中</span>`;   // v49 Muse Code
      if (p.plugins && p.plugins.length) st += `<span class="eq zw" title="${p.plugins.map((c) => CD[c.k].name).join("、")}">🔌 插件 ${p.plugins.length}</span>`;   // v47 DSH
      const stE = h.querySelector(".status"); if (stE._s !== st) { stE._s = st; stE.innerHTML = st; }
      const bd = h.querySelector(".band");
      if (bd) {                                                    // Kimi 的乐队：到了几名乐手，空位是虚线
        const n = (p.band || []).length;
        if (+bd.dataset.n !== n || !bd.children.length) {
          bd.dataset.n = n;
          bd.innerHTML = [1, 2, 3].slice(0, Engine.T.bandMax).map((k) => `<i class="${k <= n ? "on" : ""}${bandNew[p.i] && k <= n && k > n - bandNew[p.i] ? " new" : ""}"><img src="${A(`assets/img/kimi_band${Math.min(k, 3)}.webp`)}" alt=""></i>`).join("");
          bandNew[p.i] = false;
        }
        bd.classList.toggle("full", n >= Engine.T.bandMax);
      }
      const sd = h.querySelector(".side"), lab = sideLabel(p), sc = "side" + (lab ? " " + lab.cls : "");
      if (sd.className !== sc) sd.className = sc; put(sd, lab ? lab.text : "");
    }
    put($("#deck"), String(g.deck.length));
    put($("#round"), String(g.round));
    // 炸弹猫：牌堆里还剩几张宕机、下一张是宕机的概率；你看过的牌堆顶
    const bl = g.bombsLeft();
    put($("#bombs"), String(bl));
    put($("#risk"), g.deck.length ? ` ${PORTRAIT ? "" : "下张 "}${Math.round(bl / g.deck.length * 100)}%` : "");   // 竖屏顶栏窄，只写百分比
    const kn = g.human.alive ? g.known(g.human, 5) : [];
    let last = kn.length; while (last > 0 && !kn[last - 1]) last--;
    const kb = $("#known"), math = g.human.alive && g.hasSkill(g.human, "math") ? g.bombSpots() : null;   // ChatGPT 演算：宕机在第几张
    kb.classList.toggle("hidden", !last && !(math && math.length));
    const kh = math && math.length ? '<span class="kt">🧮 演算</span>' + `<span class="kc boom">宕机在第 ${math.join("、")} 张</span>` +
      kn.slice(0, last).map((c, i) => c && c.k !== "dangji" ? `<span class="kc">${i + 1}. ${CD[c.k].name}</span>` : "").join("")
      : last ? '<span class="kt">👁 你看过的牌堆顶</span>' + kn.slice(0, last).map((c, i) => `<span class="kc${c && c.k === "dangji" ? " boom" : c ? "" : " unk"}">${i + 1}. ${c ? CD[c.k].name : "？"}</span>`).join("") : null;
    if (kh != null && kb._s !== kh) { kb._s = kh; kb.innerHTML = kh; }
    renderHand();
    renderSkills();
    if (infoP && !$("#hinfo").classList.contains("hidden")) showHeroInfo(infoP, infoFocus);
  }

  function renderHand() {
    const me = g.human, box = $("#hand");
    const n = me.hand.length;
    const existing = {};
    for (const e of [...box.children]) existing[e.dataset.id] = e;
    const hw = HAND_W / HS;
    const step = n > 1 ? Math.min(CARD_W + 10, (hw - CARD_W) / (n - 1)) : 0;
    box.classList.toggle("tight", step < CARD_W - 24);
    const x0 = n > 1 ? Math.max(0, (hw - (CARD_W + step * (n - 1))) / 2) : (hw - CARD_W) / 2;
    const focus = me.hand.findIndex((c) => c.id === (hoverId != null ? hoverId : selected));
    const gap = focus >= 0 ? Math.max(0, CARD_W + 6 - step) : 0;
    // 悬停 / 选中那张两边让开，但不能挤出手牌区：超出的一侧按比例压回来
    const xs = me.hand.map((c, i) => x0 + step * i + (focus < 0 || i === focus ? 0 : i < focus ? -gap / 2 : gap / 2));
    if (focus >= 0) {
      const xf = xs[focus], lo = Math.min(...xs), hi = Math.max(...xs), maxX = hw - CARD_W;
      if (lo < 0) for (let i = 0; i < focus; i++) xs[i] = xf - (xf - xs[i]) * xf / (xf - lo);
      if (hi > maxX) for (let i = focus + 1; i < xs.length; i++) xs[i] = xf + (xs[i] - xf) * (maxX - xf) / (hi - xf);
    }
    const keep = new Set();
    me.hand.forEach((c, i) => {
      let e = existing[c.id];
      const x = xs[i];
      if (!e) {
        e = cardEl(c); e.removeAttribute("title"); bindHandCard(e, c.id);
        e.appendChild(el("div", "kn"));
        box.appendChild(e);
        if (TR) { e.style.translate = `${hw}px 8px`; if (Engine.speed > 0) void getComputedStyle(e).translate; }   // v49 新牌先放在右边、量一次起点，下面写新位置时由 translate 过渡滑进来（中途手牌再变也能顺着改道；单独的动画会挡住过渡，到头一下跳过去）
        else { e.style.left = hw + "px"; e.style.top = "8px"; }
      }
      keep.add(String(c.id));
      e.dataset.x = x;
      const z = String(i === focus ? 30 : i + 1); if (e.style.zIndex !== z) e.style.zIndex = z;
      if (TR) { if (e.dataset.tx !== String(x)) { e.dataset.tx = x; e.style.translate = `${x}px 8px`; } }   // v49 手牌位置走合成层的 translate（left/top 过渡每挪一次整排牌都要重画十几帧，主线程一卡牌就跳）
      else requestAnimationFrame(() => { e.style.left = x + "px"; e.style.top = "8px"; });
      put(e.querySelector(".kn"), i < 9 ? String(i + 1) : "");
      const usable = mode === "play" && !busy && !skillMode && g.canUse(me, c);
      const respond = mode === "respond" && respondCards.includes(c.id);
      e.classList.toggle("can", !!(usable || respond || mode === "discard"));
      e.classList.toggle("dim", mode === "play" && !busy && !skillMode && !g.canUse(me, c));
      e.classList.toggle("sel", selected === c.id);
      e.classList.toggle("hov", hoverId === c.id);
      e.classList.toggle("pick2", discardPick.includes(c.id));
      const old = swapOld(c), sw = e.querySelector(".swp");
      if (old && !sw) e.appendChild(el("div", "swp", `换下${CD[old.k].name}`)); else if (old) sw.textContent = `换下${CD[old.k].name}`; else if (sw) sw.remove();
      e.classList.toggle("dragging", (drag && drag.on && drag.id === c.id) || dropId === c.id);
    });
    for (const id in existing) if (!keep.has(id)) existing[id].remove();
    box.classList.toggle("keys", !!SET().keys);
    const canEnd = mode === "play" && !busy;
    $("#btn-end").disabled = !canEnd;
    $("#btn-end").classList.toggle("ready", canEnd && !anyMove());
    renderTip();
  }
  function bindHandCard(e, id) {
    e.addEventListener("click", (ev) => { ev.stopPropagation(); if (performance.now() - suppressClick < 350) return; onCardClick(id); });
    e.addEventListener("dblclick", (ev) => { ev.stopPropagation(); onCardDbl(id); });
    e.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType !== "mouse" || drag) return;
      clearTimeout(hoverT); if (hoverId !== id) { hoverId = id; renderHand(); }
    });
    e.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType !== "mouse" || drag || hoverId !== id) return;
      clearTimeout(hoverT); hoverT = setTimeout(() => { if (hoverId === id) { hoverId = null; if (g) renderHand(); } }, 90);
    });
    e.addEventListener("pointerdown", (ev) => startDrag(ev, id));
  }
  // 还有没有能做的事：能出的牌或能用的技能
  function anyMove() {
    if (!g || !g.human.alive) return false;
    const me = g.human;
    return me.hand.some((c) => g.canUse(me, c)) || g.activeSkills(me).some((s) => s.can);
  }

  // ---------------------------------------------------------------- 角色详情卡：点角色看她所有技能、实时状态、和你的关系
  let infoP = null, infoFocus = null;
  const REL_NAME = { ally: "盟友", friend: "交好", rival: "宿敌", mentor: "师徒" };
  function skillState(p, s) {
    const out = [];
    const left = p.uses ? p.uses[s.id] : null;
    if (left != null) out.push(left > 0 ? `剩 ${left} 次` : "用完了");
    if (s.type === "active" && p.used && p.used[s.id] && g.cur === p.i) out.push("这回合用过");
    if (s.id === "saint") out.push(p.saintUsed ? "已经护法过" : "还没触发");
    if (s.id === "dumb" && p.dumb) out.push("现在降智中");
    if (s.id === "codex" && p.cloud) out.push(`云端在跑【${CD[p.cloud.k].name}】`);                       // v47 harness 技能
    if (s.id === "dsh") out.push(`插件 ${(p.plugins || []).length} / ${g.dshMax ? g.dshMax(p) : 2}${(p.plugins || []).length ? "：" + p.plugins.map((c) => CD[c.k].name).join("、") : ""}`);
    if (s.id === "fact" && p.used && p.used.fact) out.push("这轮核实过");
    if (s.id === "fans" && p.used && p.used.fans) out.push("这轮刷过礼物");
    if (s.id === "disguise" && p.disguise) out.push("伪装中");
    if (s.id === "nap" && p.napping) out.push("睡着了");
    if (s.id === "egg") { const on = g.players.filter((q) => q.eggBy === p).map((q) => q.name); out.push(on.length ? `蛋挂在 ${on.join("、")} 身上，下回合孵化` : "还没挂蛋"); }
    if (s.id === "magic" && p.oracle && g.cur === p.i) out.push(`海螺点了 ${p.oracle.name}`);
    if (s.id === "confirm") out.push(p.confirmRound === g.round ? "这轮已经婉拒过了" : "下一张冲她的单体锦囊会被婉拒");
    if (s.id === "busy" && g.players.length > 2) out.push(p.busyRound === g.round && p.busyHits >= Engine.T.busyAt ? "这轮已经繁忙过了" : p.busyRound === g.round && p.busyHits === Engine.T.busyAt - 1 ? "下一张吐槽必挡" : "这轮还没人吐槽她");
    if (s.id === "remake") out.push(p.lastPlay ? (g.remakeTargets(p) ? `能重放【${CD[p.lastPlay.k].name}】` : `【${CD[p.lastPlay.k].name}】放不了`) : "这回合还没出牌");
    if (s.id === "rehearse") out.push(`乐队 ${(p.band || []).length} / ${Engine.T.bandMax}`);
    if (s.id === "live") out.push((p.band || []).length >= Engine.T.bandMax ? "乐队到齐，能开唱" : `还差 ${Engine.T.bandMax - (p.band || []).length} 名乐手`);
    if (s.id === "math" && p.human && g.bombSpots) { const sp = g.bombSpots(); if (sp.length) out.push(`宕机在第 ${sp.join("、")} 张`); }
    return out;
  }
  function hzState(p) {                                                 // v49 详情卡 Harness 一栏的当前状态（Codex / DSH 原来写在技能状态里，v48 挪出技能表后就看不到了）
    const ids = (p.ch.harness && p.ch.harness.ids) || [], out = [];
    if (!p.deployed) return out;
    // v51 十个老 Harness 都写上「现在」的状态（原来只有 4 个有，Claude Code 剩几次许愿都看不到）。只写会变的东西：不变的说明下面一行 short 已经写了
    const T = Engine.T, duel = g.players.length === 2, mine = g.cur === p.i, used = (id) => !!(p.used && p.used[id]);
    if (ids.includes("wish")) {
      if (p.key === "xds") out.push(!p.disguise ? "套壳时能许愿 1 次" : p.wishedShell ? "这次套壳许过愿了" : "套壳中：还能许愿 1 次");
      else { const left = p.uses ? p.uses.wish : null; if (left != null) out.push(left > 0 ? `许愿还剩 ${left} 次` : "许愿额度用完了"); if (left > 0 && used("wish") && mine) out.push("这回合许过了"); }
    }
    if (ids.includes("mmcode")) out.push(p.clip ? "素材库里有 1 条吐槽" : "素材库空着");
    if (ids.includes("musecode")) { const cap = duel ? T.museBgMax2p : T.museBgMax; out.push(p.bgTask ? `Jolly 在办【${CD[p.bgTask.k].name}】` : `后台还能跑 ${Math.max(0, cap - (p.bgN || 0))} 次`); }
    if (ids.includes("codex") && p.cloud) out.push(p.human ? `云端在跑【${CD[p.cloud.k].name}】` : `云端任务跑着，下回合回来再摸 ${T.codexDraw} 张`);   // 电脑挂上去的是哪张，日志里没说：只告诉牌主
    if (ids.includes("dsh") && g.dshMax) out.push(`插件 ${(p.plugins || []).length} / ${g.dshMax(p)}`);
    if (ids.includes("antigrav") && mine) out.push(used("search") ? "这回合搜过了" : `这回合还能搜（看 ${T.agPeek} 张）`);
    if (ids.includes("zcode") && mine) out.push(used("steal") ? "这回合借鉴过了" : "这回合还能借鉴");
    if (ids.includes("solo") && duel) out.push((p.soloDuelN || 0) < (T.soloDuel || 0) ? `还能重放 ${T.soloDuel - (p.soloDuelN || 0)} 次吐槽` : "重放吐槽用过了");
    if (ids.includes("swarm")) { const n = (p.band || []).length; out.push(n >= T.bandMax ? "乐队到齐，等开唱" : n === T.bandMax - 1 ? "只差 1 名，下次来 1 名" : "下次排练来 2 名乐手"); }
    if (ids.includes("build") && mine) { const n = p.buyN || 0; out.push(n >= 2 ? "这回合 2 单都开了" : n === 1 ? "这回合还能再收购 1 次" : "这回合能收购 2 次（订阅费爸爸付）"); }
    if (ids.includes("qoder") && mine) out.push(used("bundle") ? "这回合全家桶用过了" : "全家桶还没用");
    return out;
  }
  function heroStatus(p) {
    const st = [];
    if (p.banned) st.push("🚫 封号中"); if (p.muted) st.push("🔇 禁言中"); if (p.dumb) st.push("❓ 降智中");
    if (p.napping) st.push("😴 补觉中"); if (p.disguise) st.push("🎭 正在冒充 Claude");
    if (p.eggBy) st.push(`🥚 领了 ${p.eggBy.name} 的鸡蛋：她下回合开始会借走 ${Engine.T.eggSteal} 张（手里有【越狱】能砸碎）`);
    if (p.band && p.band.length) st.push(`🎸 乐队 ${p.band.length} / ${Engine.T.bandMax}${p.band.length >= Engine.T.bandMax ? "，随时开唱" : ""}`);
    if (p.offline) st.push("📵 断网中"); if (p.boost) st.push("🧠 深度思考中");
    if (p.dadSpent && Engine.T.buyDad) st.push("💳 记在爸爸账上：下回合爸爸不补牌");   // v56 收购「记爸爸账上」
    return st;
  }
  function showHeroInfo(p, focus) {
    if (!g) return;
    infoP = p; infoFocus = focus || null;
    const box = $("#hinfo"), me = g.human;
    const rel = p !== me && (g.mode === "ffa" || g.mode === "duel") ? g.relation(p, me) : null;
    const relRow = rel ? ((window.GAME_DATA.relations || []).find(([a, b]) => (a === p.key && b === me.key) || (a === me.key && b === p.key)) || [])[3] : "";
    const side = g.mode === "team" && p !== me ? (g.nation ? `${((window.GAME_DATA.nations || {})[p.ch.nation] || {}).name} · ` : "") + (p.team === me.team ? "队友" : "对手") : g.mode === "id5" ? (p.role === "lord" || p.human || p.revealed ? Engine.ROLE[p.role] : "身份未知") : "";
    const st = heroStatus(p);
    const html = `<div class="hi-head"><img src="${portrait(p.key, "avatar")}" alt=""><div class="hi-nm"><b>${p.name}</b></div><button class="hi-x" title="关闭">✕</button></div>
      <div class="hi-stat"><span>❤ 心态 ${Math.max(0, p.hp)} / ${p.maxHp}</span><span>🂠 手牌 ${p.hand.length}（上限 ${g.handLimit(p)}）</span>${g.equips(p).map((eq) => `<span>${EQ_ICON[eq.k] || "🧰"} ${CD[eq.k].name}</span>`).join("")}${p.cloud ? "<span>☁ 云端任务跑着</span>" : ""}${p.plugins && p.plugins.length ? `<span>🔌 插件：${p.plugins.map((c) => CD[c.k].name).join("、")}</span>` : ""}${p.clip ? "<span>🎞 素材 1 条</span>" : ""}${p.bgTask ? "<span>🧸 Jolly 跑腿中</span>" : ""}${side ? `<span>${side}</span>` : ""}${p.alive ? "" : "<span>已退群</span>"}</div>
      ${st.length ? `<div class="hi-st">${st.join(" · ")}</div>` : ""}
      ${rel ? `<div class="hi-rel ${rel}"><b>${REL_NAME[rel]}</b>${relRow}</div>` : ""}
      ${p !== me && window.Props ? `<div class="hi-props"><div class="hp-row">${Props.kindsFor(me).map((k) => `<button class="hp-b${Props.KINDS[k].owner ? " sig" : ""}" data-k="${k}" title="${Props.KINDS[k].name}${Props.KINDS[k].owner ? "（你的专属）" : ""}"><img src="${A(`assets/img/prop_${k}.webp`)}" alt=""><span>${Props.KINDS[k].name}</span></button>`).join("")}</div>
        <div class="hp-note">${Props.meaning(g, me, p)}</div></div>` : ""}
      ${p.ch.harness ? `<div class="hi-hz${p.deployed ? " on" : ""}"><div class="hi-sk1"><b>Harness · ${p.ch.harness.name}</b><em>${p.deployed ? "已上线" : `部署 ${p.deploy || 0} / ${g.deployNeed(p)}`}</em>${hzState(p).map((x) => `<i>${x}</i>`).join("")}</div>
        <div class="hi-short">${p.ch.harness.short}</div><div class="hi-desc">${p.ch.harness.desc}<br><small>每打出 1 张牌部署进度 +1，满格上线，整局生效。</small></div></div>` : ""}
      <div class="hi-skills">${p.ch.skills.filter((s) => !s.harness || !p.ch.harness).map((s) => {
        const ss = skillState(p, s);
        return `<div class="hi-sk${s.id === infoFocus ? " focus" : ""}"><div class="hi-sk1"><b>${s.name}</b><em class="${s.type}">${s.type === "active" ? "主动" : "被动"}</em>${ss.map((x) => `<i>${x}</i>`).join("")}</div>
          <div class="hi-short">${s.short || ""}</div><div class="hi-desc">${s.desc}</div></div>`;
      }).join("")}</div>`;
    const q = pos(p), sc = seatScale(p), sig = p.i + "|" + q.x + "," + q.y + "," + sc + "|" + SW + "x" + SH + "|" + html;
    if (box._sig === sig && box.className === "") return;                // v49 详情卡开着等电脑出牌时，每次 sync 都整卡重建 + 量尺寸：内容没变就跳过
    box._sig = sig;
    box.style.setProperty("--c", p.ch.color); box.style.setProperty("--l", p.ch.light); document.body.classList.add("hinfo-on");   // v50 详情开着时藏起说话气泡（气泡那层更高，会盖住技能说明）
    box.innerHTML = html;
    box.className = "";
    box.querySelector(".hi-x").onclick = (ev) => { ev.stopPropagation(); hideHeroInfo(); };
    box.querySelectorAll(".hp-b").forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); if (Props.human(g, me, p, b.dataset.k)) hideHeroInfo(); }; });
    // 放在角色旁边：右边放得下就放右边，不然放左边；上下不出屏
    const w = box.offsetWidth, h = box.offsetHeight;
    let x = q.x + HERO_W * sc + 14;
    if (x + w > SW - 12) x = q.x - w - 14;
    if (x < 12) x = Math.max(12, Math.min(SW - w - 12, q.x + HERO_W * sc / 2 - w / 2));
    const y = Math.max(12, Math.min(SH - h - 12, q.y));
    box.style.left = x + "px"; box.style.top = y + "px";
    const f = box.querySelector(".hi-sk.focus"); if (f) f.scrollIntoView({ block: "nearest" });
  }
  function hideHeroInfo() { infoP = null; document.body.classList.remove("hinfo-on"); const b = $("#hinfo"); if (b) b.className = "hidden"; }

  // v37 装备冲突：这张装备会把同一格里现有的那件换下来（旧的进弃牌堆）→ 手牌角标 + 浮窗提醒；一键出牌 / 双击时先选中、不直接换
  function swapOld(c) { return CD[c.k].type === "equip" && g.eqIn ? g.eqIn(g.human, c.k) : null; }
  function swapNote(c) {
    const old = swapOld(c); if (!old) return "";
    const slot = Engine.EQ_SLOT_NAME && Engine.EQ_SLOT_NAME[Engine.EQ_SLOT[c.k]];
    return old.k === c.k ? `⚠ 你已经装着【${CD[old.k].name}】了，再装只是换一张一样的` : `⚠ 会换下你身上的【${CD[old.k].name}】${slot ? `（同在${slot}格）` : ""}，旧的直接进弃牌堆`;
  }
  // ---------------------------------------------------------------- 牌的说明浮窗（悬停那张 / 选中那张）
  function renderTip() {
    const tip = $("#ctip"); if (!tip || !g) return;
    const me = g.human;
    const id = drag && drag.on ? null : hoverId != null ? hoverId : selected;
    const c = id != null && me.hand.find((x) => x.id === id);
    const ce = c && document.querySelector(`#hand .card[data-id="${c.id}"]`);
    if (!c || !ce) { tip.className = "hidden"; return; }
    const d = CD[c.k];
    let html = `<div class="tt"><b>【${d.name}】</b>${d.desc}</div>`;
    const playing = mode === "play" && !busy && !skillMode;
    if (playing && !g.canUse(me, c)) html += `<div class="tno">✋ ${whyNot(me, c)}</div>`;
    else if (playing && selected === c.id) {
      if (d.target === "one") html += `<div class="tgo"><span>👉 点一位对手，或把牌拖到她身上${SET().keys ? '<span class="kb">；也可以按她头上的数字</span>' : ""}</span></div>`;
      else html += `<div class="tgo"><button class="btn small primary" id="tip-go">出牌</button>${SET().keys ? '<kbd class="kb">Enter</kbd>' : ""}<span>或把牌往上拖</span></div>`;
    } else if (mode === "respond" && respondCards.includes(c.id)) html += `<div class="tgo"><span>👉 点这张打出</span></div>`;
    else if (!$("#prompt").classList.contains("hidden")) { tip.className = "hidden"; return; }
    if (swapNote(c) && !(playing && !g.canUse(me, c))) html = html.replace("</div>", `</div><div class="tsw">${swapNote(c)}</div>`);   // 装备冲突提醒，紧跟在说明下面
    const cx = HAND_X + ((+ce.dataset.x || 0) + CARD_W / 2) * HS, ph = $("#prompt").classList.contains("hidden");
    const sig = html + "|" + cx + "|" + ph + "|" + SW + "|" + SH;
    if (tip._sig === sig && tip.className === "") return;                // v49 内容、位置都没变：不重建、不再量尺寸（写完马上读尺寸 = 强制重排）
    tip._sig = sig;
    tip.innerHTML = html;
    tip.className = "";
    const go = tip.querySelector("#tip-go");
    if (go) go.onclick = (ev) => { ev.stopPropagation(); playSelected(); };
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const top = ph ? HAND_Y + (8 - 34) * HS - 12 - h : PROMPT_Y - 12 - h;
    tip.style.left = Math.max(16, Math.min(SW - 16 - w, cx - w / 2)) + "px";
    tip.style.top = top + "px";
  }

  // ---------------------------------------------------------------- 拖牌：拖到对手身上 / 往上拖到桌面
  function stagePt(ev) { const r = $("#stage").getBoundingClientRect(), s = r.width / SW; return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s }; }
  function heroAt(pt) { return g.players.find((p) => { const q = pos(p), s = seatScale(p); return pt.x >= q.x && pt.x <= q.x + HERO_W * s && pt.y >= q.y && pt.y <= q.y + HERO_H * s; }); }
  const dropY = () => HAND_Y - 20;
  function canDrag(c) { return mode === "play" ? !busy && g.canUse(g.human, c) : mode === "respond" && respondCards.includes(c.id); }
  function startDrag(ev, id) {
    if ((ev.button && ev.button !== 0) || !g || busy || drag) return;
    if (mode !== "play" && mode !== "respond") return;
    const c = g.human.hand.find((x) => x.id === id); if (!c) return;
    drag = { id, c, p0: stagePt(ev), pid: ev.pointerId, on: false };
    window.addEventListener("pointermove", moveDrag); window.addEventListener("pointerup", endDrag); window.addEventListener("pointercancel", endDrag);
  }
  function stopDrag() {
    window.removeEventListener("pointermove", moveDrag); window.removeEventListener("pointerup", endDrag); window.removeEventListener("pointercancel", endDrag);
    heroes.forEach((h) => h.classList.remove("drop"));
    $("#scr-game").classList.remove("dropping", "drop-one", "drop-any");
    drag = null;
  }
  function moveDrag(ev) {
    if (!drag || ev.pointerId !== drag.pid) return;
    const pt = stagePt(ev);
    if (!drag.on) {
      if (Math.hypot(pt.x - drag.p0.x, pt.y - drag.p0.y) < 14) return;
      if (!g || !canDrag(drag.c)) { if (g && mode === "play" && !busy) toast(whyNot(g.human, drag.c)); stopDrag(); return; }
      drag.on = true; hoverId = null; clearTimeout(autoT);
      if (skillMode) { skillMode = null; clearTargets(); }
      drag.one = mode === "play" && CD[drag.c.k].target === "one";
      if (mode === "play") { selected = drag.id; if (drag.one) showTargets(g.targetsFor(g.human, drag.c)); else clearTargets(); }
      drag.ghost = cardEl(drag.c); drag.ghost.classList.add("ghost"); $("#fx").appendChild(drag.ghost);
      $("#scr-game").classList.add("dropping", drag.one ? "drop-one" : "drop-any");
      renderHand();
    }
    const dx = pt.x - (drag.pt || pt).x;
    drag.pt = pt; drag.rot = Math.max(-12, Math.min(12, (drag.rot || 0) * 0.7 + dx * 0.6));
    drag.ghost.style.transform = `translate(${pt.x - CARD_W / 2}px, ${pt.y - CARD_H * 0.6}px) rotate(${drag.rot}deg) scale(${1.06 * HS})`;
    const h = drag.one ? heroAt(pt) : null;
    const ok = !!h && heroes[h.i].classList.contains("target");
    heroes.forEach((e, i) => e.classList.toggle("drop", ok && i === h.i));
    drag.ghost.classList.toggle("armed", drag.one ? ok : pt.y < dropY());
  }
  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.pid) return;
    const d = drag; stopDrag();
    if (!d.on) return;                       // 没拖动：算普通点击
    suppressClick = performance.now();
    const pt = d.pt || d.p0, me = g && g.human;
    let go = null;
    if (g && ev.type === "pointerup") {
      if (mode === "respond" && respondCards.includes(d.c.id) && pt.y < dropY()) go = () => finishRespond({ card: d.c });
      else if (mode === "play" && !busy && g.canUse(me, d.c)) {
        if (d.one) { const h = heroAt(pt); if (h && g.targetsFor(me, d.c).includes(h)) go = () => act(() => g.useCard(me, d.c, [h])); }
        else if (pt.y < dropY()) go = () => act(() => g.useCard(me, d.c, []));
      }
    }
    if (go) {
      d.ghost.remove(); dropPt = pt; dropId = d.c.id;
      setTimeout(() => { if (dropId === d.c.id) { dropId = null; dropPt = null; if (g) renderHand(); } }, 1500);
      go(); return;
    }
    // 没放到地方：飞回手里，保持选中
    const slot = document.querySelector(`#hand .card[data-id="${d.id}"]`);
    const tx = HAND_X + (slot ? +slot.dataset.x || 0 : 0) * HS + CARD_W * (HS - 1) / 2, ty = HAND_Y + (8 - 34) * HS + CARD_H * (HS - 1) / 2;
    d.ghost.animate([{ transform: d.ghost.style.transform }, { transform: `translate(${tx}px, ${ty}px) scale(${HS})` }], { duration: 160, easing: "ease-out", fill: "forwards" })
      .finished.then(() => d.ghost.remove(), () => d.ghost.remove()).then(() => { if (g) renderHand(); });
    if (g && mode === "play" && d.one && !busy) hint(`选中【${CD[d.c.k].name}】<br>👉 拖到一位对手身上，或点她`);
    if (g) sync();
  }
  // 技能栏：内容没变就不重建（每次重建都会让发光动画重启、整块重算样式，平板上很卡）
  let skillSig = "";
  function renderSkills() {
    const box = $("#skillbox"); if (!box || !g) return;
    const me = g.human;
    const acts = g.activeSkills(me).map((s) => ({ s, left: s.left != null ? `（${s.left}）` : "", ready: mode === "play" && !busy && s.can }));
    const pas = me.ch.skills.filter((x) => x.type !== "active").map((s) => ({ s, ss: skillState(me, s), off: (s.id === "saint" && me.saintUsed) || (s.id === "dumb" && me.dumb) }));
    const readyIds = acts.map((a) => (a.ready ? a.s.id : null));
    const hz = me.ch.harness ? (me.deployed ? "on" : `${me.deploy || 0}/${g.deployNeed(me)}`) : "";
    const sig = JSON.stringify([SET().keys, skillMode, acts.map((a) => [a.s.id, a.left, a.ready]), pas.map((x) => [x.s.id, x.ss[0] || "", x.off]), hz]);
    if (sig !== skillSig || !box.firstChild) {
      skillSig = sig;
      box.innerHTML = "";
      box.classList.toggle("dense", acts.length >= 4 || acts.length + pas.length + (me.ch.harness ? 1 : 0) >= 6);
      acts.forEach(({ s, left, ready }, ki) => {
        const b = el("button", "btn small" + (skillMode === s.id ? " primary" : ready ? " sk-ready" : ""), `${s.name}${left}` + (SET().keys && ki < 3 ? `<kbd>${"QWE"[ki]}</kbd>` : ""));
        b.title = `【${s.name}】${s.short || ""}——${s.desc}` + (ready ? "（现在能用）" : "");
        b.disabled = !ready;
        b.onclick = (ev) => { ev.stopPropagation(); onSkillBtn(s); };
        // 能用的技能：按钮后面垫一层金色光晕，只让它的透明度一呼一吸（显卡做，不占主线程）
        const w = el("span", "skw" + (ready && skillMode !== s.id ? " on" : ""), '<i class="skglow"></i>');
        w.appendChild(b); box.appendChild(w);
      });
      if (me.ch.harness) {                                          // v48 Harness：单独一个金色小牌，没上线灰着显示进度
        const H = me.ch.harness, dup = acts.some((a) => H.ids.includes(a.s.id));   // Harness 本身就是上面的技能按钮（Claude Code）时只写 Harness，省一行
        const crowd = acts.length + pas.length >= 4;                     // v49 技能多的人（MiniMax 3 主动 + 1 被动）去掉「Harness · 」前缀：平板上不然会独占一行，把结束按钮顶出框
        const ch = el("span", "pchip hzc" + (me.deployed ? "" : " off"), `${dup ? "Harness" : crowd ? H.name : `Harness · ${H.name}`}<small>${me.deployed ? "已上线" : `部署 ${hz}`}</small>`);
        ch.title = `【${H.name}】${H.short}（每打出 1 张牌部署 +1，满格上线）`;
        ch.onclick = (ev) => { ev.stopPropagation(); showHeroInfo(me); };
        box.appendChild(ch);
      }
      for (const { s, ss, off } of pas) {
        const ch = el("span", "pchip" + (off ? " off" : ""), `${s.name}${ss.length ? `<small>${ss[0]}</small>` : ""}`);
        ch.title = `【${s.name}】${s.short || s.desc}（被动，自动生效）`;
        ch.onclick = (ev) => { ev.stopPropagation(); showHeroInfo(me, s.id); };
        box.appendChild(ch);
      }
    }
    const tags = heroes[me.i] && heroes[me.i].querySelectorAll(".stags span");
    if (tags) me.ch.skills.filter((s) => !s.harness).forEach((s, k) => { const on = readyIds.includes(s.id); if (tags[k] && tags[k].classList.contains("sk-ready") !== on) tags[k].classList.toggle("sk-ready", on); });
  }

  // ---------------------------------------------------------------- 文字提示
  function hint(html) { $("#hint").innerHTML = html; }
  let toastT = null;
  function toast(text, ms = 1500) {
    if (!text) return;
    const t = $("#toast"); t.textContent = text; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), ms);
  }
  function phase(text) { $("#phase").textContent = text; }
  function trimChat() { const l = $("#chat-list"); while (l.children.length > 30) l.firstChild.remove(); }
  function log(p, html) {
    const m = el("div", "msg" + (p.human ? " me" : ""));
    m.style.setProperty("--c", p.ch.color);
    m.innerHTML = `<img src="${portrait(pkey(p), "avatar")}" alt=""><div class="mb"><div class="mw">${p.disguise ? "Claude？<small>（小DeepSeek）</small>" : p.name}</div><div class="mt">${html}</div></div>`;
    $("#chat-list").appendChild(m); trimChat();
    Sound.sfx("plop", 0.35);
  }
  function sys(text, cls) { const m = el("div", "sys" + (cls ? " " + cls : ""), text); $("#chat-list").appendChild(m); trimChat(); }

  // ---------------------------------------------------------------- 表情与说话
  // v37 表情升级：换图淡入淡出；心态只剩 1 点时待机图换成受伤 / 疲惫
  // （v37 试过情绪光晕 + 头边小图标，用户觉得叠在立绘上很怪，去掉了）
  const exprBusy = {};
  function idleE(p) {
    if (!p.alive || p.hp > 1 || p.disguise) return "base";
    return p.key === "claude" && !(window.Settings && Settings.skinOf("claude")) ? "tired" : "hurt";
  }
  function setPor(p, src, fade = 180) {
    const por = heroes[p.i] && heroes[p.i].querySelector(".por"); if (!por) return;
    const img = por.querySelector("img:not(.ghost)"); if (!img || img.getAttribute("src") === src) return;
    if (fade) { const gh = img.cloneNode(); gh.className = "ghost"; por.appendChild(gh); gh.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: "ease-out" }).onfinish = () => gh.remove(); }
    img.src = src;
  }
  // v37 待机眨眼：有 {key}_blink.webp 的角色，待机（默认皮肤、底图、没在做表情）时每 2.5–6 秒眨一下（0.11 秒）
  const blinkOk = {}, blinkAt = {};
  let blinkTimer = null;
  function blinkStart() {
    clearInterval(blinkTimer);
    const has = new Set(window.GAME_DATA.blink || []);                // 数据里的名单（build 时按文件生成），不去试探加载
    for (const p of g.players) if (blinkOk[p.key] == null) { blinkOk[p.key] = false; if (has.has(p.key)) { const im = new Image(); im.onload = () => { blinkOk[p.key] = true; }; im.src = A(`assets/img/${p.key}_blink.webp`); } }
    blinkTimer = setInterval(() => {
      if (!g) return;
      const now = performance.now();
      for (const p of g.players) {
        if (!blinkOk[p.key] || !p.alive || p.disguise || exprBusy[p.i] || idleE(p) !== "base" || (window.Settings && Settings.skinOf(p.key))) continue;
        if (!blinkAt[p.i]) { blinkAt[p.i] = now + 1500 + Math.random() * 4000; continue; }
        if (now < blinkAt[p.i]) continue;
        blinkAt[p.i] = now + 2500 + Math.random() * 3500;
        const img = heroes[p.i] && heroes[p.i].querySelector(".por img:not(.ghost)"); if (!img) continue;
        const base = portrait(p.key, "base"); if (img.getAttribute("src") !== base) continue;
        img.src = A(`assets/img/${p.key}_blink.webp`);
        setTimeout(() => { if (img.getAttribute("src") === A(`assets/img/${p.key}_blink.webp`)) img.src = base; }, 110);
      }
    }, 200);
  }
  function refreshIdle(p) { if (!exprBusy[p.i] && heroes[p.i]) setPor(p, portrait(pkey(p), idleE(p)), 260); }
  function expr(p, e, ms) {
    const img = heroes[p.i] && heroes[p.i].querySelector(".por img");
    if (!img) return;
    if (p.disguise && e === "win") e = "cheer";                                   // 变身中的小DeepSeek 没有 win 图，用得意忘形那张
    if (p.disguise && e === "smug") e = ["smug", "tea", "cheer"][Math.floor(Math.random() * 3)];
    setPor(p, portrait(pkey(p), e));
    heroes[p.i].querySelector(".por").animate([{ transform: "translateX(-50%) scale(1.06)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 220, easing: "ease-out" });
    clearTimeout(exprTimers[p.i]); exprBusy[p.i] = true;
    if (ms && p.alive) exprTimers[p.i] = setTimeout(() => { exprBusy[p.i] = false; if (p.alive && g) setPor(p, portrait(pkey(p), idleE(p)), 260); }, ms);
    else if (!ms) exprBusy[p.i] = false;
  }
  // v37 旁观反应：有人挨打时，场上一位旁观者跟着有表情——宿敌幸灾乐祸、盟友 / 队友心疼
  function onlooker(t) {
    if (!g || Math.random() > 0.5) return;
    const near = g.alive().filter((q) => q !== t && !exprBusy[q.i]);
    const fr = near.filter((q) => (g.mode === "team" && q.team === t.team) || ["ally", "friend"].includes(g.relation(q, t)));
    const ri = near.filter((q) => g.relation(q, t) === "rival" || (g.mode === "team" && q.team !== t.team));
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (fr.length && Math.random() < 0.55) expr(pick(fr), "hurt", 1100);
    else if (ri.length) expr(pick(ri), "smug", 1100);
  }
  // v37 Claude 精修版多出来的表情：写代码专注、守宪法严厉、喝红茶、被夸害羞、又被封号的疲惫
  const XEXPR = { claude: { wish: "focus", artifact: "focus", zeroday: "stern", code: "focus", ban: "stern", attack: "stern", ko: "stern", def: "stern", heal: "tea", dodge: "tea", roger: "tea",
    gifted: "shy", fed: "warm", saint: "warm", guard: "stern", guard_xds: "stern", low: "tired", ev_banwave: "tired", mourn: "tired",
    stolen: "meh", egged: "meh", comp: "meh", pelted: "meh", gpt_ui: "meh", glm: "meh", dug: "meh", boom: "meh",   // v43 嫌弃无奈
    ev_ipo: "warm", allstar: "warm", beauty: "warm", muse: "warm", fear: "warm" },                                 // v43 温柔认真
    // v41 其余角色各 2 张新表情（GAME_DATA.xexpr 里登记了、图真的有才换）
    deepseek: { think: "focus", quant: "focus", opensrc: "focus", sig: "focus", fury: "angry", def: "angry", guard: "angry", guard_xds: "angry", pelted: "angry", dug: "angry" },
    xds: { bigeat: "eat", fed: "eat", heal: "eat", gifted: "eat", beg: "plead", beg_gpt: "plead", beg_claude: "plead", busy: "plead" },
    gemini: { hajimi: "pout", dug: "pout", plain: "pout", pretrain: "pout", fish: "pout", guard: "pout", search: "focus", know: "focus", pen: "focus", paint: "focus", paint2: "focus" },
    grok: { def: "angry", guard: "angry", guard_kimi: "angry", egged: "angry", pelted: "angry", dare: "angry", gifted: "shy", kimi: "shy", glm: "shy" },
    glm: { nap: "sleepy", low: "sleepy", maint: "sleepy", boom: "sleepy", guard: "awake", guard_kimi: "awake", steal: "awake", zcode: "awake", hatch: "awake" },
    doubao: { fans: "stream", sig: "stream", remake: "stream", seedance: "stream", vs_gemini: "pout", dug: "pout", pelted: "pout", guard: "pout" },
    kimi: { recall: "focus", burst: "focus", band1: "focus", ad: "shy", caught: "shy", egged: "shy" },
    qwen: { bundle: "cheer", luckybag: "cheer", qingke: "cheer", qingke_self: "cheer", heal: "cheer", guard: "stern", guard_xds: "stern", xds: "cheer" },
    minimax: { magic: "focus", edge: "focus", sig: "focus", guard: "stern", guard_glm: "stern", pelted: "stern" },
    muse: { errand: "focus", haggle: "focus", confirm: "focus", low: "shy", gifted: "shy" } };
  const QUIET_Q = ["greet", "hurt", "low", "out", "win", "roger", "mourn"];
  const hasX = (k, e) => k === "claude" || ((window.GAME_DATA.xexpr || {})[k] || []).includes(e);
  const HURT_KEYS = ["hurt", "hajimi", "out", "stolen", "fury", "halluc", "low", "mourn", "egged", "dad_skip"], SMUG_KEYS = ["attack", "win", "ban", "reset", "buy", "steal", "steal_claude", "fans", "recall",
    "polish", "wish", "zeroday", "artifact", "zuiying", "beg", "beg_gpt", "beg_claude", "claw", "dad", "maint", "long", "busy", "fed", "think", "sis", "search", "know", "cut", "plain", "pen", "pen_gpt", "paint2", "sorry", "bundle", "sale",
    "ko", "def", "guard", "qingke", "qingke_self", "pact_end", "egg", "egg_claude", "hatch"];
  // v36 皮肤专属台词：穿着某套皮肤时，<台词类>_<皮肤 id> 有内容就六成概率改说这句（Bel 皮肤的 ChatGPT 满嘴数学）
  function skinKey(ck, key, lines) {
    if (window.GAME_DATA.chars[key]) return key;                     // 冲某个角色说的话不换（对方的回嘴是配好对的）
    const sid = window.Settings && Settings.skinOf(ck), alt = sid && key + "_" + sid;
    return alt && (lines[alt] || []).length && Math.random() < 0.6 ? alt : key;
  }
  function say(p, key, important) {
    if (!g) return;
    const base = key; key = skinKey(p.key, key, p.ch.lines);
    const arr = p.ch.lines[key];
    if (!arr || !arr.length) return;
    const now = performance.now();
    if (!important && now - (lastSay.t || 0) < 900) return;
    lastSay.t = Math.max(lastSay.t || 0, now);                          // v49 不往回拨：上线台词设的「说完前别插嘴」不会被别人的重要台词冲掉
    const idx = Math.floor(Math.random() * arr.length);
    const text = arr[idx];
    Sound.voice(p.key, key, idx);
    if (g.quotes && !p.disguise && !QUIET_Q.includes(base)) g.quotes.push({ i: p.i, text, w: base.startsWith("guard") || ["ko", "sig", "def", "zeroday", "ban"].includes(base) ? 2 : 1 });   // v43 战报金句
    const q = pos(p);
    const old = document.querySelector(`.bubble[data-p="${p.i}"]`); if (old) old.parentElement.remove();
    const wrap = el("div"); wrap.style.position = "absolute"; wrap.style.zIndex = 40;
    const b = el("div", "bubble " + (p.human ? "up" : "down"), text);
    b.dataset.p = p.i; b.style.setProperty("--c", p.ch.color); b.style.position = "relative";
    wrap.appendChild(b);
    if (p.human) { wrap.style.left = q.x + 20 + "px"; wrap.style.top = q.y - 14 + "px"; wrap.style.transform = "translateY(-100%)"; }
    else { wrap.style.left = Math.max(8, Math.min(q.x + 6, SW - 330)) + "px"; wrap.style.top = q.y + HERO_H * seatScale(p) + 14 + "px"; }
    $("#fx").appendChild(wrap);
    if (!p.human) { const l = Math.min(parseFloat(wrap.style.left), SW - 180); wrap.style.left = l + "px"; wrap.style.maxWidth = SW - l - 8 + "px"; }   // v50 气泡别出屏：按剩余宽度限宽（不读 offsetWidth，读一次就要整页重排，说一句卡一下）
    const xe = (XEXPR[p.key] || {})[base];
    if (xe && hasX(p.key, xe) && !p.disguise && !(window.Settings && Settings.skinOf(p.key))) expr(p, xe, base === "low" || base === "mourn" ? 2200 : 1700);   // v37 角色专属表情（穿皮肤时没有这几张，照旧用得意 / 受伤）
    else if (base === "exposed") expr(p, "exposed", 1800);
    else if (HURT_KEYS.includes(base) || base === "ev_fatfish") expr(p, "hurt", base === "out" ? 0 : 1600);
    else if (SMUG_KEYS.includes(base) || base.startsWith("ev_") || base.startsWith("guard_")) expr(p, base === "win" ? "win" : "smug", 1400);   // 赢的时候用胜利立绘（v30）
    setTimeout(() => wrap.remove(), Math.max(1800, text.length * 170));
    return (window.VOICES || {})[`${p.key}_${key}${idx}`] || 0;   // 配音时长（毫秒），没有配音返回 0
  }

  // ---------------------------------------------------------------- 动画
  function flyEl(e, from, to, ms, scale0 = 0.6, scale1 = 1) {
    e.style.position = "absolute"; e.style.left = "0px"; e.style.top = "0px"; e.style.margin = "0";
    $("#fx").appendChild(e);
    const anim = e.animate([                                         // v50 不读 offsetWidth（读一次整页重排）：用 -50% 让元素自己居中
      { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(${scale0})`, opacity: 0.6 },
      { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(${scale1})`, opacity: 1 }],
      { duration: ms * Engine.speed, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" });
    // 动画万一没播完（画面卡顿、标签页在后台），最多多等 0.4 秒也继续，游戏不会卡住
    return Promise.race([anim.finished, new Promise((r) => setTimeout(r, ms * Engine.speed + 400))]).then(() => e, () => e);
  }
  async function showCard(p, card, targets) {
    const src = p.human ? (dropId === card.id && dropPt) || handCardCenter(card) || center(p) : center(p);
    if (dropId === card.id) { dropId = null; dropPt = null; }
    const e = cardEl(card, true);
    Sound.sfx(card.k === "tucao" ? "swipe" : "slap", 0.8);
    const jitter = { x: PILE.x + (Math.random() - 0.5) * 120, y: PILE.y + (Math.random() - 0.5) * 30 };
    await flyEl(e, src, jitter, 330, 0.55, 1);
    if (!g) { e.remove(); return; }
    for (const t of targets) arrow(center(p), center(t));
    if (targets.length === 1 && targets[0] !== p) { lean(p, targets[0], 18); lastHit = { from: p, to: targets[0], at: performance.now() }; }   // v39 出手的人朝目标探一下身
    if (targets.length) Sound.sfx("whoosh_little", 0.6);
    const pile = $("#pile");
    e.remove();
    const keep = el("div", "played");
    const c2 = cardEl(card, true);
    c2.style.position = "relative";
    keep.appendChild(c2);
    keep.insertAdjacentHTML("afterbegin", `<div class="who">${p.name}</div>`);
    keep.style.left = jitter.x - 95 - TABLE_X + "px"; keep.style.top = jitter.y - 135 - TABLE_Y + "px";
    keep.style.transform = `rotate(${(Math.random() - 0.5) * 10}deg)`;
    pile.appendChild(keep);
    while (pile.children.length > 4) pile.firstChild.remove();
    [...pile.children].forEach((x, i, arr) => { x.style.opacity = i < arr.length - 2 ? 0.35 : 1; x.querySelector(".who").style.display = i === arr.length - 1 ? "" : "none"; });
    await wait(targets.length ? 420 : 260);
  }
  function handCardCenter(card) {
    const e = document.querySelector(`#hand .card[data-id="${card.id}"]`);
    if (!e) return null;
    return { x: HAND_X + ((+e.dataset.x || parseFloat(e.style.left) || 0) + CARD_W / 2) * HS, y: HAND_Y + (8 + CARD_H / 2) * HS };
  }
  function arrow(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const e = el("div", "arrow");
    e.style.left = a.x + "px"; e.style.top = a.y + "px"; e.style.width = len + "px";
    e.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    $("#fx").appendChild(e); setTimeout(() => e.remove(), 700);
  }
  function floatText(p, text, cls) {
    const c = center(p);
    const e = el("div", "float" + (cls ? " " + cls : ""), text);
    e.style.left = c.x - 60 + "px"; e.style.top = c.y - 40 + "px";
    $("#fx").appendChild(e); setTimeout(() => e.remove(), 1100);
  }
  // Kimi 排练：新乐手登场（n = 现在几名；0 = 开唱后散场）
  const bandNew = {};
  function band(p, n, fresh) {                                         // v51 fresh = 这次新来几名（Kimi Code 一次写 2 首、来 2 名乐手，两格都要有新到动画）
    bandNew[p.i] = n > 0 ? Math.max(1, fresh || 1) : 0;
    const bd = heroes[p.i] && heroes[p.i].querySelector(".band"); if (bd) bd.dataset.n = "-1";   // v51 强制重画这一栏：引擎在这之前已经 sync 过（乐手数已经画好），不清掉的话新到动画一次都不会出现（不能用 ""：+"" 是 0，开唱散场 n = 0 时不重画，乐队会一直亮着）
    sparks(p, n > 0 ? "#b9a7ff" : "#ffd75a", n > 0 ? 10 : 22);
    if (n > 0) floatText(p, `🎵 乐队 ${n} / ${Engine.T.bandMax}`, "band");
    sync();
  }
  function sparks(p, color, n = 12) {
    const c = center(p);
    for (let i = 0; i < n; i++) {
      const s = el("div", "spark"); const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 80;
      s.style.left = c.x + "px"; s.style.top = c.y + "px"; s.style.background = color;
      s.style.setProperty("--dx", Math.cos(a) * r + "px"); s.style.setProperty("--dy", Math.sin(a) * r + "px");
      $("#fx").appendChild(s); setTimeout(() => s.remove(), 750);
    }
  }
  // ---------------------------------------------------------------- 互动道具：抛物线飞过去，砸中后按种类出效果（盖章、弹窗、糊脸、落地、带电、火箭、烟花）
  const PROP_SFX = { dislike: ["stamp", 0.5], error: ["glitch_vhs", 0.35], gpu: ["spell2", 0.4], like: ["ding", 0.45], ban: ["stamp_thick", 0.7], nuke: ["bomb", 0.3],
    rice: ["plop", 0.5], fish: ["pop_small", 0.5], banana: ["slap2", 0.5], rocket: ["whoosh_cartoon", 0.5], croc: ["boing", 0.45], pillow: ["boing", 0.45], carnival: ["yay", 0.35], scroll: ["paper", 0.6], takeout: ["notify", 0.45] };
  const ERRORS = ["服务器繁忙，请稍后再试", "网络开小差了，请重试", "请求太频繁，请稍后", "内容生成失败，请重新生成", "Error 500：内部错误"];
  function throwProp(from, to, kind) {
    if (!g || !heroes[to.i]) return;
    const K = Props.KINDS[kind], a = center(from), b = center(to), fx = $("#fx");
    const it = el("img", "prop-fly"); it.src = A(`assets/img/prop_${kind}.webp`);
    it.style.left = a.x + "px"; it.style.top = a.y + "px"; fx.appendChild(it);
    const dx = b.x - a.x, dy = b.y - a.y, lift = Math.min(260, 90 + Math.hypot(dx, dy) * 0.25), spin = K.bad && kind !== "error" && kind !== "ban" ? 540 : 0;
    Sound.sfx("whoosh_little", 0.35);
    const fly = it.animate([
      { transform: "translate(-50%, -50%) scale(.7) rotate(0deg)" },
      { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - lift}px)) scale(1.15) rotate(${spin / 2}deg)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${spin}deg)` }], { duration: 620, easing: "cubic-bezier(.3,.1,.5,1)" });
    fly.onfinish = () => { it.remove(); propHit(to, kind, b); }; fly.oncancel = () => it.remove();
  }
  function propFx(cls, html, c, ms) {
    const e = el("div", cls, html); e.style.left = c.x + "px"; e.style.top = c.y + "px"; $("#fx").appendChild(e); setTimeout(() => e.remove(), ms); return e;
  }
  function shakeHero(p) {
    const h = heroes[p.i];
    if (h) h.animate([{ transform: "translateX(0)" }, { transform: "translateX(-8px) rotate(-1.5deg)" }, { transform: "translateX(6px) rotate(1deg)" }, { transform: "translateX(0)" }], { duration: 360 });
  }
  function propHit(p, kind, c) {
    const K = Props.KINDS[kind], [sfx, v] = PROP_SFX[kind] || ["plop", 0.4];
    Sound.sfx(sfx, v);
    const img = `<img src="${A(`assets/img/prop_${kind}.webp`)}" alt="">`, cap = K.cap ? `<em>${K.cap}</em>` : "";
    const r = (Math.random() * 30 - 15).toFixed(1) + "deg";
    if (K.fx === "stamp") { const e = propFx("prop-stamp" + (K.bad ? " bad" : ""), img + cap, c, 1900); e.style.setProperty("--r", r); if (K.bad) shakeHero(p); else sparks(p, "#ffd35a", 12); }
    else if (K.fx === "window") {
      const e = propFx("prop-win", `<div class="pw-t"><span>系统提示</span><i>✕</i></div><div class="pw-b"><b>⚠</b>${ERRORS[Math.floor(Math.random() * ERRORS.length)]}</div><div class="pw-f"><span>确定</span></div>`, c, 2300);
      e.style.setProperty("--r", r); shakeHero(p);
    } else if (K.fx === "seal") { const e = propFx("prop-seal", "<b>封号</b>", c, 2000); e.style.setProperty("--r", (-14 + Math.random() * 8).toFixed(1) + "deg"); shakeHero(p); }
    else if (K.fx === "splat") {
      const e = propFx("prop-splat2 " + kind, `<img src="${A(`assets/img/splat_${kind === "nuke" ? "mushroom" : kind}.webp`)}" alt="">${cap}`, c, 2600);
      e.style.setProperty("--r", kind === "nuke" ? "0deg" : r); shakeHero(p);
    } else if (K.fx === "charge") {
      propFx("prop-land", img + cap, c, 1700);
      const h = heroes[p.i]; if (h) { h.classList.remove("charged"); void h.offsetWidth; h.classList.add("charged"); setTimeout(() => h.classList.remove("charged"), 1300); }
      sparks(p, "#5fd8ff", 14);
    } else if (K.fx === "rocket") { propFx("prop-rocket", img + cap, c, 1800); sparks(p, "#ffb347", 14); }
    else if (K.fx === "fireworks") {
      propFx("prop-land", img + cap, c, 1800);
      ["#ff6b9a", "#ffd35a", "#5fd8ff", "#9b7bff"].forEach((col, i) => setTimeout(() => sparks(p, col, 12), i * 180));
    } else {
      const extra = K.hearts ? "<i>♥</i><i>♥</i><i>♥</i>" : K.zzz ? "<i class=\"z\">Z</i><i class=\"z\">z</i><i class=\"z\">Z</i>" : "";
      propFx("prop-land", img + cap + extra, c, 1700);
      if (K.zzz) shakeHero(p);
    }
  }
  // v39 互动姿态：出手的人朝目标前倾一下，挨打的人往后仰（只用 translate，不和卡片自身的抖动 / 缩放打架；不晃整个画面）
  let lastHit = null;
  function lean(p, t, px) {
    const h = heroes[p.i]; if (!h || !t) return;
    const a = center(p), b = center(t), d = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / d * px, dy = (b.y - a.y) / d * px;
    h.animate([{ translate: "0 0" }, { translate: `${dx}px ${dy}px`, offset: 0.4 }, { translate: "0 0" }], { duration: 420 * Math.max(0.6, Engine.speed), easing: "cubic-bezier(.3,.7,.4,1)" });
  }
  function damage(p, n) {
    const h = heroes[p.i];
    if (lastHit && lastHit.to === p && performance.now() - lastHit.at < 2500 && lastHit.from !== p) lean(p, lastHit.from, -14);   // 挨打：往后仰
    h.classList.remove("shake"); void h.offsetWidth; h.classList.add("shake");
    h.querySelector(".flash").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500 });
    floatText(p, `破防 -${n}`);
    sparks(p, "#ff4f70", 14);
    setTimeout(() => { onlooker(p); refreshIdle(p); }, 450);
    Sound.sfx("punch", 0.9); setTimeout(() => Sound.sfx("crack", 0.45), 90);
    sync();
  }
  function heal(p, n) { floatText(p, `+${n}`, "heal"); sparks(p, "#4fd18b", 10); Sound.sfx("sparkle", 0.6); sync(); refreshIdle(p); }
  function out(p) { expr(p, "hurt"); heroes[p.i].animate([{ transform: "rotate(0)" }, { transform: "rotate(-4deg) translateY(6px)" }], { duration: 500, fill: "forwards" }); sync(); }
  function setTurn(p) { heroes.forEach((h, i) => h.classList.toggle("turn", i === p.i)); }
  function drawAnim(p, n) {
    Sound.sfx("draw", 0.6);
    for (let k = 0; k < Math.min(n, 4); k++) {
      setTimeout(() => { if (!g) return; const b = el("div", "cardback"); flyEl(b, DECK, center(p), 300, 0.7, 0.5).then((e) => e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }).finished.then(() => e.remove())); }, k * 70);
    }
  }
  // v49 MiniMax Code 素材库 / Muse Code 后台任务：牌飞进座位上的标签（on），或者从标签里拿出来（off：烧掉当燃料 / Jolly 跑完回来）
  function hzStash(p, kind, on, c) {
    if (!g || !(Engine.speed > 0) || !heroes[p.i]) { sync(); return; }
    const seat = center(p), mid = { x: SW / 2, y: SH * 0.42 };
    if (on) {
      Sound.sfx(kind === "clip" ? "ding" : "notify", 0.45);
      const e = c ? cardEl(c) : el("div", "cardback");
      flyEl(e, mid, seat, 460, 0.5, 0.22).then((x) => x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(() => x.remove()));
    } else if (kind === "clip") {                                      // 素材烧成燃料：从座位缩小、淡掉
      const e = c ? cardEl(c) : el("div", "cardback");
      flyEl(e, { x: seat.x, y: seat.y - 40 }, seat, 320, 0.3, 0.08).then((x) => x.remove());
    } else if (kind === "bg") {                                        // v51 Jolly 跑完腿回来：那张锦囊从座位旁边飞回她面前（原来这一步什么都不画）。返回 Promise：引擎等它落地再替她打出，免得同一张牌同时出现两次
      Sound.sfx("notify", 0.45);
      const e = c ? cardEl(c) : el("div", "cardback"), side = seat.x < SW / 2 ? 1 : -1;
      const f = flyEl(e, { x: seat.x + side * 150 * seatScale(p), y: seat.y - 30 }, seat, 380, 0.35, 0.7).then((x) => x.remove());
      sync(); return f;
    }
    sync();
  }
  // v51 Claude Code 许愿找到牌：牌从牌堆正面朝上飞到她座位上方，停一下（金光 + 星点），再收进座位（原来只 sync，最爽的结果反而没动静）。
  //   牌名本来就公开写在聊天里，亮正面不泄露信息。穿 Fable·许愿之神（g2）时，一颗流星领着它飞来，牌角别一颗小金星，落下时一声专属铃
  function wishFly(p, c) {                                             // 返回牌落进座位的 Promise：引擎等它落地再往下走（不然电脑紧接着出这张牌，屏幕上会同时有两张）
    if (!g || !(Engine.speed > 0) || !heroes[p.i]) { sync(); return Promise.resolve(); }
    const s = seatScale(p), seat = center(p), dir = seat.x < SW / 2 ? 1 : -1, g2 = godId(p) === "g2", e = el("div", "wish-fly" + (g2 ? " g2" : ""));   // 外面包一层：牌本身 overflow:hidden，流星 / 小金星挂在外层才不会被裁掉
    const up = { x: seat.x + dir * 150 * s, y: Math.max(seat.y - 30 * s, g2 ? 190 : 120) };   // 停在座位旁边、朝牌桌那侧（不挡头顶的【Claude Code】字条）；上排座位往下压，牌和流星都留在屏幕里
    e.appendChild(cardEl(c));
    if (g2) {
      const sp = wishSprites(), st = new Image(), bd = new Image(); st.className = "wf-star"; bd.className = "wf-badge"; st.alt = bd.alt = "";
      if (!sp.url) sp.url = { shoot: sp.shoot.toDataURL(), badge: sp.stars[0].toDataURL() };   // 只转一次
      const ang = Math.atan2(up.y - DECK.y, up.x - DECK.x), d = 75 * Math.abs(Math.cos(ang)) + 106 * Math.abs(Math.sin(ang)) + 40;   // 流星头朝飞行方向、领在牌前面（贴纸本身朝右上 25°）；原来固定在牌上方，飞向下排座位时成了倒着飞
      st.style.transform = `translate(${Math.round(Math.cos(ang) * d)}px, ${Math.round(Math.sin(ang) * d)}px) rotate(${(ang + 0.437).toFixed(3)}rad)`;
      st.src = sp.url.shoot; bd.src = sp.url.badge; e.append(st, bd);
    }
    Sound.sfx("draw", 0.6);
    const done = new Promise((res) => flyEl(e, DECK, up, 460, 0.5, 0.95).then((x) => {
      if (!g) { x.remove(); res(); return; }
      x.classList.add("glow"); sparks(p, "#ffd35a", 8); if (g2) Sound.sfx("g2_wish", 0.45);   // 文件按 -3 dBFS 峰值做的，0.45 和 ding / notify 一样响
      setTimeout(() => flyEl(x, up, seat, 280, 0.95, 0.3).then((y) => { y.remove(); res(); }), 420 * Engine.speed);
    }));
    sync();
    return done;
  }
  function steal(from, to) {
    const b = el("div", "cardback");
    flyEl(b, center(from), center(to), 420, 0.6, 0.6).then((e) => e.remove());
    sync();
  }
  // 大技能：斜条特写；小技能：头顶飘字
  function skill(p, name) {
    Sound.sfx("spell", 0.6);
    const c = el("div", "cutin");
    c.style.setProperty("--c", p.ch.color); c.style.setProperty("--l", p.ch.light);
    const sk = p.ch.skills.find((x) => x.name === name);
    c.innerHTML = `<img src="${p.disguise ? portrait("xds_cl", sk && sk.id === "disguise" ? "change" : "smug") : portrait(p.key, sk && sk.art ? sk.art : sk && sk.id === "live" ? "live" : "smug")}" alt=""><div class="ct2">${p.name} 发动技能</div><div class="ct1">${name}</div>${sk && sk.short ? `<div class="ct3">${sk.short}</div>` : ""}`;
    $("#fx").appendChild(c); setTimeout(() => c.remove(), 1300 * Engine.speed + 100);
  }
  // v39 宿敌对线特写：两人面对面的半屏特写，一来一回各说一句（斗嘴配对里的台词，配好了音）。点一下 / Esc 跳过
  let clashSkip = null;
  function clashLine(p, key) {
    const arr = p.ch.lines[key] || []; if (!arr.length) return { text: "", ms: 0 };
    const idx = Math.floor(Math.random() * arr.length);
    Sound.voice(p.key, key, idx);
    return { text: arr[idx], ms: (window.VOICES || {})[`${p.key}_${key}${idx}`] || arr[idx].length * 160 };
  }
  async function clash(a, b, ka, kb) {
    if (!g || !heroes[a.i] || !heroes[b.i]) return;
    const tok = actTok, sp = Math.max(0.6, Engine.speed);
    const box = el("div", "clash" + (PORTRAIT ? " tall" : ""));
    box.style.setProperty("--ca", a.ch.color); box.style.setProperty("--la", a.ch.light);
    box.style.setProperty("--cb", b.ch.color); box.style.setProperty("--lb", b.ch.light);
    box.innerHTML = `<div class="cl-band"></div><img class="cl-a" src="${portrait(pkey(a), "smug")}" alt=""><img class="cl-b" src="${portrait(pkey(b), "base")}" alt="">
      <div class="cl-tag">对线</div><div class="cl-n cl-na">${a.name}</div><div class="cl-n cl-nb">${b.name}</div>
      <div class="cl-say cl-sa"></div><div class="cl-say cl-sb"></div>`;
    $("#fx").appendChild(box);
    let skipped = false, wake = null;
    const nap = (ms) => new Promise((r) => { wake = r; setTimeout(r, ms); });
    clashSkip = () => { skipped = true; if (wake) wake(); };
    box.onclick = clashSkip;
    Sound.sfx("whoosh_little", 0.5);
    await nap(380 * sp);
    let s1 = null;
    if (!skipped && g && actTok === tok) {
      s1 = clashLine(a, ka); const q1 = box.querySelector(".cl-sa");
      q1.textContent = s1.text; q1.classList.add("on");
      await nap(Math.min(3200, s1.ms) + 250);
    }
    if (!skipped && g && actTok === tok) {
      box.querySelector(".cl-b").src = portrait(pkey(b), "smug");
      box.querySelector(".cl-b").animate([{ transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: 220, easing: "ease-out" });
      const s2 = clashLine(b, kb), q2 = box.querySelector(".cl-sb");
      q2.textContent = s2.text; q2.classList.add("on");
      (g.clashTexts = g.clashTexts || []).push([{ i: a.i, text: s1 ? s1.text : "" }, { i: b.i, text: s2.text }]);   // v43 战报名场面
      await nap(Math.min(3200, s2.ms) + 350);
    }
    clashSkip = null;
    if (skipped && Sound.hush) { Sound.hush(a.key); Sound.hush(b.key); }
    box.classList.add("bye"); setTimeout(() => box.remove(), 220);
    lastSay.t = Math.max(lastSay.t || 0, performance.now());
  }
  // 变身：换伪装立绘、名牌改成“Claude？”
  function disguise(p, on) {
    const h = heroes[p.i]; if (!h) return;
    h.classList.toggle("disguised", on);
    const img = h.querySelector(".por img");
    clearTimeout(exprTimers[p.i]);
    img.src = on ? portrait("xds_cl", "base") : portrait("xds_cl", "exposed");
    if (!on) exprTimers[p.i] = setTimeout(() => { if (g && !p.disguise) img.src = portrait(p.key, "base"); }, 1200 * Math.max(0.6, Engine.speed));
    h.querySelector(".plate b").textContent = on ? "Claude？" : p.name;
    h.querySelector(".plate small").textContent = on ? "（其实是小DeepSeek）" : "";
    if (on) sparks(p, "#f0a050", 18);
    sync();
  }
  // v48 Harness 上线：角色旁弹一个终端小窗，逐字打 `$ xxx deploy… ✓`
  function deploy(p, cmd, name, swap) {
    if (!swap) return deployShow(p, cmd, name);
    const c = center(p), e = el("div", "term"); e.style.setProperty("--c", p.ch.color);
    e.innerHTML = `<div class="tm-bar"><i></i><i></i><i></i><span>${p.name}</span></div><pre></pre>`;
    e.style.left = c.x + "px"; e.style.top = c.y - 40 + "px";
    $("#fx").appendChild(e);
    const pre = e.querySelector("pre"), lines = swap ? [`$ ${cmd}`, `✓ 换壳：${name}`] : [`$ ${cmd} deploy`, "…", `✓ ${name} 上线`];
    const txt = lines.join("\n"); let i = 0;
    const sp = Math.max(0.3, Engine.speed || 0);
    return new Promise((res) => {
      if (!(Engine.speed > 0)) { pre.textContent = txt; setTimeout(() => { e.remove(); res(); }, 10); return; }
      Sound.sfx("tick", 0.4);
      const step = () => { if (i <= txt.length) { pre.innerHTML = txt.slice(0, i).replace(/✓[^\n]*/, (m) => `<b>${m}</b>`) + '<u></u>'; i++; setTimeout(step, 38 * sp); }
        else { setTimeout(() => { e.classList.add("out"); setTimeout(() => e.remove(), 400 * sp); res(); }, 700 * sp); } };
      step();
    });
  }
  // v48 上线演出（改版：以立绘为主）：
  //   玩家自己上线——浅色薄纱上大立绘居中，镜头慢推（整张等比放大，不扭曲）→ 切到第 2 帧 + 身后光点散开 + 配音 + 眨眼；
  //   旁边全息小屏打部署命令，「XX 上线！」章在一侧。v56 不能跳过，要完整播完，点屏幕 / Esc 都不收。电脑上线——只用第 2 帧，半屏切入约 1 秒（同技能切入）
  let deploySkip = null, deployCur = null, deployEnd = null;   // deploySkip：现在挡着对局的那场（v56 只用来吞 Esc，不再能跳）；deployCur：还没收尾的那场（v49 同一时间只留一场）；deployEnd：它彻底演完的 Promise
  let hzPre = [];                                                       // v49 每个座位预载好的上线立绘（差 1 格时建，演完换成 1 = 不再预载）
  function skipDeploy() { return !!deploySkip; }   // v56 演出不能跳过：演出挡着对局时 Esc 只吞掉（返回 true），不让它落到底下的应答框变成「不出」（v49 原来这里会把演出收掉）
  const HZ_BLINK = ["claude", "gemini", "deepseek", "doubao", "kimi", "grok", "qwen", "xds", "xds_cl", "minimax", "muse"];   // 有眨眼帧的（GPT / GLM 合成不自然，不眨）
  // v50 神级皮肤（g1）开大招：换成神皮造型的上线立绘 + 专属开场 + 专属台词（deploy_g1）
  // v51 一人可以有不止一套神皮（Claude 第二套 g2「Fable·许愿之神」）：GOD 按角色列出神皮 id，godId 返回现在穿的那套（不是神皮返回 ""）
  const GOD = { claude: ["g1", "g2"], gpt: ["g1"], gemini: ["g1"], deepseek: ["g1"], doubao: ["g1"], kimi: ["g1"] };
  const GOD_SFX = { claude_g1: ["g1_claude_lock"], claude_g2: ["g2_wish"] };   // 神皮开场 / 局内彩蛋里除了「神皮 id_角色」那一条之外还会用到的专属音（开局一起预载）
  function godId(p) { if (!p || p.disguise || !window.Settings) return ""; const s = Settings.skinOf(p.key); return (GOD[p.key] || []).includes(s) ? s : ""; }
  function godSkin(p) { return !!godId(p); }
  function hzImg(p, f) { const k = p.key === "xds" && p.disguise ? "xds_cl" : p.key, gid = godId(p); if (gid && f !== "b_blink") return A(`assets/img/hz_${k}_${gid}_${f}.webp`); return A(`assets/img/hz_${k}_${k === "xds_cl" && f === "a" ? "b" : f}.webp`); }
  // v48 大招演出：玩家自己上线约 3 秒（时停 → 斜切眼部特写 → 纹章 + 爆发 → 技能名砸下 → 光点回座位），点一下 / Esc 跳过；
  //   电脑上线简版约 1.5 秒（斜切 + 技能名）。不震屏、不用集中线；立绘不扭曲，只动镜头 / UI / 两帧；粒子用 canvas，CSS 只动 transform / opacity
  const HZ_EYE = { claude: [335, 92], gpt: [345, 202], gemini: [353, 230], deepseek: [324, 187], glm: [226, 216], doubao: [342, 216], kimi: [344, 127],
    grok: [380, 154], qwen: [405, 162], xds: [348, 352], xds_cl: [364, 374], minimax: [360, 220], muse: [360, 220] };   // 发动帧（720×1080）两眼中点，斜切光带里的眼部特写用
  const ULT = {                                                       // 专属纹章 / 粒子 / 音色
    minimax: { glyph: "conch", part: "carrot", sfx: "ult_minimax" }, muse: { glyph: "jolly", glyph2: "todo", part: "todo", sfx: "ult_muse" },   // v49 MiniMax Code 海螺螺线 + 小胡萝卜 / Muse Code Jolly 兜帽 + 待办框
    claude: { glyph: "flower", part: "petal", sfx: "ult_claude" }, gpt: { glyph: "cloud", part: "feather", sfx: "ult_gpt" },
    gemini: { glyph: "star", part: "stardust", sfx: "ult_gemini" }, deepseek: { glyph: "whale", part: "bubble", sfx: "ult_deepseek" },
    xds: { glyph: "whale", part: "bubble", sfx: "ult_deepseek" }, xds_cl: { glyph: "flower", part: "petal", sfx: "ult_claude" },
    glm: { glyph: "code", part: "code", sfx: "ult_glm" }, doubao: { glyph: "film", part: "film", sfx: "ult_doubao" },
    kimi: { glyph: "note", part: "note", sfx: "ult_kimi" }, kimi_g1: { glyph: "note", part: "note", sfx: "ult_kimi_g1" }, grok: { glyph: "coin", part: "bill", sfx: "ult_grok" },
    qwen: { glyph: "check", part: "check", sfx: "ult_qwen" },
    claude_g1: { glyph: "hex", part: "petal", sfx: "ult_claude" }, gpt_g1: { glyph: "inf", part: "sym", sfx: "ult_gpt" },   // v50 神级皮肤换纹章 / 粒子
    claude_g2: { glyph: "star5", glyph2: "book", glyph0: "sun", part: "page", sfx: "ult_claude_g2" },   // v51 Fable·许愿之神：外圈五角星、内圈翻开的寓言之书、中心金阳；粒子书页 + 五角星；专属冲击音
  };
  // v51 Fable·许愿之神的贴纸和道具图：第一次用时准备一次，之后开场 / 粒子 / 局内彩蛋都只 drawImage。
  //   道具（翻开 / 合着的寓言之书、星光魔杖）是和立绘同一画风的插画（assets/img/claude_g2_fx_*.webp）；
  //   程序画的部分不描粗边：星星是有棱面的金星（上亮下深、细金边、身后一圈柔光），线是细金线
  let wishSp = null;
  const GEM = [["#FFF3BC", "#F3B436", "#B5761A"], ["#FFFCEA", "#FFDF8C", "#C99A2E"], ["#FFDD96", "#EE9A2A", "#A85A14"]];   // 金星三种：金 / 浅金 / 琥珀（亮面、暗面、边）
  // 有棱面的五角星：每个角左半亮、右半暗（和立绘里魔杖头那颗星同一种画法），外面一圈细边，中心一点高光
  function gemStar(x, r, [hi, lo, edge], lw) {
    const P = (k, rr) => [Math.cos(-Math.PI / 2 + k * Math.PI / 5) * rr, Math.sin(-Math.PI / 2 + k * Math.PI / 5) * rr], ri = r * 0.4;   // 内径 0.4：比圆滚滚的贴纸星修长
    for (let k = 0; k < 10; k += 2) { const t = P(k, r), a = P(k - 1, ri), b = P(k + 1, ri);
      x.fillStyle = hi; x.beginPath(); x.moveTo(0, 0); x.lineTo(a[0], a[1]); x.lineTo(t[0], t[1]); x.closePath(); x.fill();
      x.fillStyle = lo; x.beginPath(); x.moveTo(0, 0); x.lineTo(t[0], t[1]); x.lineTo(b[0], b[1]); x.closePath(); x.fill(); }
    x.beginPath(); for (let k = 0; k < 10; k++) { const q = P(k, k % 2 ? ri : r); x.lineTo(q[0], q[1]); } x.closePath(); x.lineJoin = "round"; x.lineWidth = lw || Math.max(1, r * 0.05); x.strokeStyle = edge; x.stroke();
    x.fillStyle = "rgba(255, 255, 255, .85)"; x.beginPath(); x.arc(-r * 0.06, -r * 0.08, r * 0.09, 0, 7); x.fill();
  }
  function wishSprites() {
    if (wishSp) return wishSp;
    const mk = (w, h, f) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.translate(w / 2, h / 2); x.lineJoin = "round"; f(x); return c; };
    const halo = (x, r, a) => { const gr = x.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(255, 232, 170, ${a})`); gr.addColorStop(0.45, `rgba(255, 204, 120, ${a * 0.5})`); gr.addColorStop(1, "rgba(255, 196, 110, 0)"); x.fillStyle = gr; x.fillRect(-r, -r, 2 * r, 2 * r); };
    const star = (col) => mk(128, 128, (x) => { halo(x, 64, 0.7); gemStar(x, 40, col, 1.6); });   // 星半径 40 / 画布半边 64：外面一圈是柔光
    const page = (fill) => mk(104, 128, (x) => { halo(x, 52, 0.55); x.scale(2, 2);          // 一张泥金书页（约 32×45）：微微卷起、四角是尖的，上亮下暖，细金边加一圈内框，页心一颗小金星；不写字
      const gr = x.createLinearGradient(-14, -22, 12, 22); gr.addColorStop(0, "#FFFEF8"); gr.addColorStop(1, fill); x.fillStyle = gr;
      x.lineJoin = "miter"; x.beginPath(); x.moveTo(-15, -21); x.quadraticCurveTo(-1, -25, 15, -20); x.lineTo(16.5, 20); x.quadraticCurveTo(2, 24, -15.5, 21); x.closePath(); x.fill(); x.lineWidth = 1; x.strokeStyle = "#D9A441"; x.stroke();
      x.lineWidth = 0.6; x.strokeStyle = "rgba(201, 138, 30, .75)"; x.beginPath(); x.moveTo(-11.6, -17.4); x.quadraticCurveTo(-1, -20.4, 11.6, -16.6); x.lineTo(12.9, 16.5); x.quadraticCurveTo(1.6, 19.6, -12.1, 17.4); x.closePath(); x.stroke();   // 内框：一圈细金线
      gemStar(x, 5, GEM[0], 0.5); });                                   // 页心一颗小金星（书页上不写字）
    const glow = mk(256, 256, (x) => halo(x, 128, 0.95));                // 圆形柔光（没有放射线）
    const shoot = mk(260, 180, (x) => { x.scale(2, 2);                  // 流星：一颗大星拖着四颗越来越小的星（一串星点，不拖线）
      [[-52, 30, 5, 1], [-34, 22, 7, 0], [-14, 13, 9, 1], [8, 4, 11.5, 2]].forEach(([px, py, r, i], k) => { x.save(); x.translate(px, py); x.rotate(k * 0.5); gemStar(x, r, GEM[i], 1); x.restore(); });
      x.translate(38, -12); x.rotate(0.2); gemStar(x, 22, GEM[0], 1.4); });
    const art = (n) => { const im = new Image(); im.decoding = "async"; im.src = A(`assets/img/claude_g2_fx_${n}.webp`); return im; };   // 道具插画：开局空闲时就开始下载（warmUlt），没下完的那一帧先不画它
    wishSp = { stars: GEM.map(star), pages: ["#FFF1CF", "#FFE9B8", "#FFE2A6", "#FFEBD0"].map(page), glow, shoot, book: art("book"), book0: art("book0"), wand: art("wand") };
    return wishSp;
  }
  // v53 Kimi 月之暗面·月相之神：月相圆盘贴纸（亮面银白、暗面半透明的靛色、细银边、一圈柔光；不画放射线）+ 六件乐器插画（开局空闲时就开始下载，见 warmUlt）
  let moonSp = null;
  function moonSprites() {
    if (moonSp) return moonSp;
    const mk = (w, h, f) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.translate(w / 2, h / 2); f(x); return c; };
    const halo = (x, r, a) => { const gr = x.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(246, 247, 255, ${a})`); gr.addColorStop(0.45, `rgba(214, 220, 250, ${a * 0.45})`); gr.addColorStop(1, "rgba(206, 212, 248, 0)"); x.fillStyle = gr; x.fillRect(-r, -r, 2 * r, 2 * r); };
    // f：亮面占几成（0 新月 … 1 满月）；right：亮面在右边。明暗交界线是半宽 |1 − 2f|·r 的半椭圆：凸月往暗面鼓、蛾眉月往亮面鼓
    const moon = (f, right) => mk(128, 128, (x) => { const r = 34; halo(x, 64, 0.3 + 0.5 * f);
      x.fillStyle = "rgba(78, 84, 132, .55)"; x.beginPath(); x.arc(0, 0, r, 0, 2 * Math.PI); x.fill();
      if (f > 0) { const lit = x.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r); lit.addColorStop(0, "#FFFFFF"); lit.addColorStop(1, "#CDD2EC"); x.fillStyle = lit;
        const left = right ? f > 0.5 : f <= 0.5;
        x.beginPath(); x.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, !right); x.ellipse(0, 0, Math.max(0.01, Math.abs(1 - 2 * f) * r), r, 0, Math.PI / 2, left ? 1.5 * Math.PI : -Math.PI / 2, !left); x.closePath(); x.fill(); }
      x.lineWidth = 2; x.strokeStyle = "rgba(124, 132, 192, .95)"; x.beginPath(); x.arc(0, 0, r, 0, 2 * Math.PI); x.stroke(); x.lineWidth = 0.8; x.strokeStyle = "rgba(255, 255, 255, .9)"; x.beginPath(); x.arc(0, 0, r - 1.6, 0, 2 * Math.PI); x.stroke(); });
    const cache = {};
    const phase = (k) => { const f = k <= 4 ? k / 4 : (8 - k) / 4, right = k < 4, id = f + (right ? "r" : "l"); return cache[id] || (cache[id] = moon(f, right)); };   // 环的左半边是上弦（亮面在右）、右半边是下弦
    const art = (n) => { const im = new Image(); im.decoding = "async"; im.src = A(`assets/img/kimi_g1_fx_${n}.webp`); return im; };
    moonSp = { phase, glow: mk(256, 256, (x) => halo(x, 128, 0.95)), inst: ["violin", "harp", "horn", "cello", "drum", "keytar"].map(art) };
    return moonSp;
  }
  function luckyStar(x, s, fill) { x.fillStyle = fill; x.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? s * 0.45 : s; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); }   // 五角星（四角星是 Gemini 的标志，不用）
  function hzKey(p) { return p.key === "xds" && p.disguise ? "xds_cl" : p.key; }
  const TH_SKIN = ["claude_m1"];                                      // v55 不是神皮、但有自己专属背景曲的皮肤：上线乐句要单独一条（移到那首曲子的调上）
  function thName(p) { const sk = !p.disguise && window.Settings ? Settings.skinOf(p.key) : "", g = godId(p) || (TH_SKIN.indexOf(p.key + "_" + sk) >= 0 ? sk : ""); return "th_" + hzKey(p) + (g ? "_" + g : ""); }   // v54 角色主题乐句的文件名：th_<角色>[_神皮]（小DeepSeek 套壳是 th_xds_cl）
  // v51 大招立绘用的是竖屏布局吗：和 CSS 的 @media (max-aspect-ratio: 1/1) 同一个条件（正方形屏幕也算），JS 里的爆开中心 / 神环跟着它走
  function ultNarrow() { return !!(window.matchMedia && matchMedia("(max-aspect-ratio: 1/1)").matches); }
  // 纹章：画一次到离屏 canvas，演出时只转 CSS transform
  function emblem(key, color, size) {
    const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"), r = size / 2, U = ULT[key] || ULT.claude;
    x.translate(r, r); x.strokeStyle = color; x.fillStyle = color; x.lineCap = "round";
    const ring = (rr, w, a = 1) => { x.globalAlpha = a; x.lineWidth = w; x.beginPath(); x.arc(0, 0, rr, 0, 7); x.stroke(); };
    ring(r * 0.96, 4, .9); ring(r * 0.88, 2, .6); ring(r * 0.56, 3, .8); ring(r * 0.5, 1.5, .5);
    x.globalAlpha = .8; for (let k = 0; k < 48; k++) { x.save(); x.rotate(k * Math.PI / 24); x.lineWidth = k % 4 ? 2 : 4; x.beginPath(); x.moveTo(r * 0.88, 0); x.lineTo(r * (k % 4 ? 0.92 : 0.96), 0); x.stroke(); x.restore(); }
    const motif = (fn, n, rr, s) => { for (let k = 0; k < n; k++) { x.save(); x.rotate(k * 2 * Math.PI / n); x.translate(rr, 0); x.scale(s, s); fn(); x.restore(); } };
    const flower = () => { for (let k = 0; k < 8; k++) { x.save(); x.rotate(k * Math.PI / 4); x.beginPath(); x.ellipse(10, 0, 10, 4, 0, 0, 7); x.fill(); x.restore(); } };
    const star = () => { x.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? 4 : 14; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.fill(); };
    const cloud = () => { x.beginPath(); x.arc(-8, 2, 8, 0, 7); x.arc(0, -4, 10, 0, 7); x.arc(9, 2, 8, 0, 7); x.fill(); };
    const glyphText = (t) => () => { x.font = "700 22px Consolas, monospace"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(t, 0, 0); };
    const film = () => { x.lineWidth = 3; x.strokeRect(-12, -9, 24, 18); for (let k = -1; k <= 1; k++) x.fillRect(k * 8 - 2, -14, 4, 3); };
    const whale = () => { x.beginPath(); x.ellipse(0, 0, 14, 8, 0, 0, 7); x.fill(); x.beginPath(); x.moveTo(12, 0); x.lineTo(22, -8); x.lineTo(22, 8); x.closePath(); x.fill(); };
    const coin = () => { x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 11, 0, 7); x.stroke(); x.font = "700 14px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("$", 0, 1); };
    const hex = () => { x.lineWidth = 3; x.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; x.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); } x.closePath(); x.stroke(); x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill(); };
    const conch = () => { x.lineWidth = 2.5; x.beginPath(); for (let k = 0; k <= 90; k++) { const a = k / 90 * 6 * Math.PI, rr = 1.5 + 12.5 * k / 90; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.stroke(); };   // v49 三圈海螺螺线
    const jolly = () => { x.lineWidth = 2.5; x.beginPath(); x.ellipse(0, 1, 11, 14, 0, 0, 7); x.stroke(); x.beginPath(); x.ellipse(0, -1, 6.5, 5.5, 0, 0, 7); x.stroke();   // v49 Jolly 兜帽剪影：圆豆子身 + 脸洞 + 两个小眼睛
      x.beginPath(); x.arc(-2.5, -1.5, 1.3, 0, 7); x.fill(); x.beginPath(); x.arc(2.5, -1.5, 1.3, 0, 7); x.fill(); };
    const todo = () => { x.lineWidth = 2.5; x.strokeRect(-10, -10, 20, 20); x.beginPath(); x.moveTo(-6, 0); x.lineTo(-1.5, 5); x.lineTo(7, -6); x.stroke(); };   // v49 打勾的待办框
    const star5 = () => { x.save(); x.rotate(Math.PI / 2); luckyStar(x, 13, color); x.restore(); };   // v51 Fable 许愿：五角星，星尖朝外
    const book = () => { x.save(); x.rotate(Math.PI / 2);              // v51 翻开的寓言之书：左右两页 + 底下一道封皮，书口朝外
      for (const d of [-1, 1]) { x.beginPath(); x.moveTo(d * 1.3, -6.5); x.quadraticCurveTo(d * 7, -10, d * 13, -7); x.lineTo(d * 13, 5.5); x.quadraticCurveTo(d * 7, 2.5, d * 1.3, 6); x.closePath(); x.fill(); }
      x.lineWidth = 2; x.beginPath(); x.moveTo(-13.5, 8.6); x.quadraticCurveTo(-7, 5.6, 0, 9.2); x.quadraticCurveTo(7, 5.6, 13.5, 8.6); x.stroke(); x.restore(); };
    const sun = () => { x.beginPath(); for (let k = 0; k < 24; k++) { const a = -Math.PI / 2 + k * Math.PI / 12, rr = k % 2 ? 8.6 : (k % 4 ? 12.5 : 16); x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.fill();   // v51 中心的金阳（神冠 / 胸针的太阳）：十二个尖、长短相间，中间抠一圈宝石
      x.save(); x.globalCompositeOperation = "destination-out"; x.lineWidth = 1.5; x.beginPath(); x.arc(0, 0, 5, 0, 7); x.stroke(); x.restore(); };
    const GL = { flower, star, cloud, film, whale, coin, hex, conch, jolly, todo, star5, book, sun, inf: glyphText("∞"), code: glyphText("</>"), note: glyphText("♪"), check: glyphText("✓") };
    const G = GL[U.glyph] || flower, G2 = GL[U.glyph2] || G, G0 = GL[U.glyph0] || G;   // glyph2：内圈换一种图案；glyph0：中心换一种（v51）
    x.globalAlpha = .95; motif(G, 8, r * 0.72, 1.5 * size / 600); motif(G2, 12, r * 0.34, 1 * size / 600);
    x.globalAlpha = 1; x.scale(3 * size / 600, 3 * size / 600); G0();
    return c;
  }
  // 粒子：一个 canvas、一条 rAF；聚拢 / 爆开 / 飞回三种
  // v50 画在不在页面里的离屏画布上、每帧整张贴到屏幕：页面里的画布每次写字（fillText）都要先把整页样式算一遍，大招时每帧几十次
  function offCtx(cv) { const b = document.createElement("canvas"); b.width = cv.width; b.height = cv.height; const x = b.getContext("2d"), v = cv.getContext("2d");
    x.flush = () => { v.clearRect(0, 0, cv.width, cv.height); v.drawImage(b, 0, 0); }; return x; }
  function particles(cv, key, color) {
    const P = [], U = ULT[key] || ULT.claude, dpr = 1;   // 粒子小，1 倍分辨率够用（旧 iPad 上省一半以上）
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; const x = offCtx(cv); x.scale(dpr, dpr);
    let raf = 0, last = performance.now();
    const draw = (q) => {
      x.globalAlpha = Math.max(0, Math.min(1, q.life / q.max * 1.5)) * (q.fi ? Math.min(1, (q.max - q.life) / 0.3) : 1); x.save(); x.translate(q.x, q.y); x.rotate(q.r);   // fi：飘的粒子 0.3 秒淡入（不是突然冒出来）
      x.fillStyle = q.c; const s = q.s;
      switch (U.part) {
        case "petal": x.beginPath(); x.ellipse(0, 0, s, s * 0.45, 0, 0, 7); x.fill(); break;
        case "feather": x.fillStyle = "#fff"; x.beginPath(); x.ellipse(0, 0, s * 1.4, s * 0.35, 0, 0, 7); x.fill(); x.strokeStyle = color; x.lineWidth = 1; x.beginPath(); x.moveTo(-s * 1.3, 0); x.lineTo(s * 1.3, 0); x.stroke(); break;
        case "bubble": x.strokeStyle = q.c; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, s * 0.7, 0, 7); x.stroke(); break;
        case "film": x.fillRect(-s, -s * 0.7, s * 2, s * 1.4); x.fillStyle = "#fff"; x.fillRect(-s * 0.6, -s * 0.35, s * 1.2, s * 0.7); break;
        case "bill": x.fillStyle = "#e9c46a"; x.fillRect(-s * 1.2, -s * 0.6, s * 2.4, s * 1.2); x.fillStyle = "#8a6d1f"; x.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6); break;
        case "code": case "note": case "check": case "sym": x.font = `700 ${Math.round(s * 2.2)}px Consolas, monospace`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(q.t, 0, 0); break;
        case "carrot":                                                  // v49 MiniMax：小胡萝卜 + 粉白星点
          if (q.alt) { x.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? s * 0.25 : s * 0.7; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.fill(); break; }
          x.fillStyle = "#ff8a3d"; x.beginPath(); x.moveTo(-s * 0.45, -s * 0.5); x.lineTo(s * 0.45, -s * 0.5); x.lineTo(0, s * 1.1); x.closePath(); x.fill();
          x.fillStyle = "#4caf50"; x.beginPath(); x.ellipse(-s * 0.22, -s * 0.78, s * 0.16, s * 0.38, -0.5, 0, 7); x.ellipse(s * 0.22, -s * 0.78, s * 0.16, s * 0.38, 0.5, 0, 7); x.fill(); break;
        case "page":                                                    // v51 Fable·许愿之神：散开的书页（贴纸，左右翻着飘）/ 五角星（q.alt）
          if (q.alt) { const h = s * 1.7; x.drawImage(wishSprites().stars[q.pi % 3], -h, -h, 2 * h, 2 * h); break; }   // 有棱面的金星贴纸（带一圈柔光）
          { const im = wishSprites().pages[q.pi], w = s * 2.6, h = w * im.height / im.width, fl = Math.cos(q.life * 5 + q.ph);
            x.scale(Math.abs(fl) < 0.12 ? 0.12 : fl, 1); x.drawImage(im, -w / 2, -h / 2, w, h); }
          break;
        case "todo":                                                    // v49 Muse：白色小待办卡 + 蓝色短条
          if (q.alt) { x.fillRect(-s * 0.9, -s * 0.18, s * 1.8, s * 0.36); break; }
          x.fillStyle = "#fff"; x.fillRect(-s, -s * 0.75, s * 2, s * 1.5); x.strokeStyle = color; x.lineWidth = 1.5; x.strokeRect(-s, -s * 0.75, s * 2, s * 1.5); x.strokeRect(-s * 0.72, -s * 0.32, s * 0.56, s * 0.56);
          x.fillStyle = color; x.fillRect(s * 0.02, -s * 0.24, s * 0.72, s * 0.14); x.fillRect(s * 0.02, s * 0.08, s * 0.5, s * 0.14); break;
        default: x.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? s * 0.3 : s; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.fill();
      }
      x.restore();
    };
    const TXT = { code: ["{ }", "</>", "( )", "=>", ";"], note: ["♪", "♫", "♬"], check: ["✓"], sym: ["∫", "Σ", "π", "∞", "√", "∇"] }[U.part] || [""];
    const add = (o) => { const q = Object.assign({ r: Math.random() * 6, vr: (Math.random() - .5) * 4, s: 5 + Math.random() * 7, c: Math.random() < .3 ? "#fff" : color, t: TXT[Math.floor(Math.random() * TXT.length)], alt: Math.random() < .45, max: o.life },
      U.part === "page" ? { vr: (Math.random() - .5) * 1.2, pi: Math.floor(Math.random() * 4), ph: Math.random() * 6 } : null, o);   // v51 书页转得慢（不像纸屑），金星三种深浅
      if (U.part === "page") { if (q.alt) { q.r = 0; q.vr = 0; } else q.r = (Math.random() - .5) * 0.9; }   // 金星始终正立、不旋转；书页大致立着飘（随机起始角会让大半张倒着）
      P.push(q); };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      x.clearRect(0, 0, cv.width, cv.height);
      for (let k = P.length - 1; k >= 0; k--) {
        const q = P[k]; q.life -= dt; if (q.life <= 0) { P.splice(k, 1); continue; }
        if (q.to) { const f = 1 - Math.pow(0.002, dt); q.x += (q.to[0] - q.x) * f * 2.2; q.y += (q.to[1] - q.y) * f * 2.2; }
        else { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += (q.g || 0) * dt; q.vx *= 0.985; q.vy *= 0.985; }
        q.r += q.vr * dt; draw(q);
      }
      x.flush();
      raf = P.length ? requestAnimationFrame(tick) : 0;
    };
    const go = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    const W = cv.clientWidth, H = cv.clientHeight;
    return {
      gather(cx, cy, n) { for (let k = 0; k < n; k++) { const a = Math.random() * 7, d = Math.max(W, H) * (0.45 + Math.random() * 0.3); add({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, to: [cx, cy], life: 0.5 + Math.random() * 0.3 }); } go(); },
      burst(cx, cy, n) {
        if (U.part === "page") {                                        // v51 书页像被风吹起一样慢慢往上飘，五角星像彩纸一样慢慢落下
          for (let k = 0, m = Math.round(n * 0.55); k < m; k++) { const a = Math.random() * 7, v = 240 + Math.random() * 420, alt = Math.random() < .7; add({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: alt ? 60 : -40, alt, life: 0.9 + Math.random() * 0.8 }); }   // 数量减半、七成是金星：少而亮
          go(); return;
        }
        const up = U.part === "stardust" ? -260 : U.part === "bill" ? 0 : 0, g = U.part === "bill" ? 520 : U.part === "stardust" ? -120 : U.part === "feather" ? 60 : 0;
        for (let k = 0; k < n; k++) { const a = Math.random() * 7, v = 260 + Math.random() * 520; add({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v + up, g, life: 0.9 + Math.random() * 0.8 }); }
        if (U.part === "bill") for (let k = 0; k < 26; k++) add({ x: Math.random() * W, y: -20 - Math.random() * 200, vx: (Math.random() - .5) * 60, vy: 120 + Math.random() * 140, g: 200, life: 1.6 });
        go();
      },
      home(fx, fy, tx, ty, n) { for (let k = 0; k < n; k++) add({ x: fx + (Math.random() - .5) * 240, y: fy + (Math.random() - .5) * 320, to: [tx, ty], life: 0.45 + Math.random() * 0.2 }); go(); },
      // v51 发动帧停留时身边慢慢飘的粒子：在立绘周围冒出来、淡入，缓缓往上飘（钞票往下落），不是从中心炸开
      drift(cx, cy, n) { const dn = U.part === "bill" ? 1 : -1; for (let k = 0; k < n; k++) add({ x: cx + (Math.random() - .5) * W * 0.46, y: cy + (Math.random() - .35) * H * 0.6, vx: (Math.random() - .5) * 50, vy: dn * (50 + Math.random() * 70), g: 0, fi: 1, life: 1.5 + Math.random() * 0.9 }); go(); },
      stop() { P.length = 0; if (raf) cancelAnimationFrame(raf); raf = 0; x.clearRect(0, 0, cv.width, cv.height); x.flush(); },
    };
  }
  function ultSlash(box, p, key) {                                   // 斜切光带：主题色流光 + 眼部特写（从发动帧裁，不缩放变形）
    const e = HZ_EYE[key] || [360, 220], band = el("div", "ult-band");
    band.innerHTML = `<div class="ub-flow"></div><div class="ub-eye" style="background-image:url('${A(`assets/img/hz_${key}_b.webp`)}');background-position:${-(e[0] * 2.4 - 330)}px ${-(e[1] * 2.4 - 80)}px"></div>`;
    box.appendChild(band); return band;
  }
  function ultName(box, name, ticks) {                               // 技能名逐字砸下 + HARNESS ONLINE
    const t = el("div", "ult-name"), ch = [...name], step = Math.min(60, Math.round(380 / ch.length));   // 长名字也在 0.4 秒内落完
    t.innerHTML = `<div class="un-big">${ch.map((c, k) => `<span style="animation-delay:${k * step / 1000}s">${c === " " ? "&nbsp;" : c}</span>`).join("")}</div><div class="un-sub">HARNESS ONLINE</div>`;
    box.appendChild(t);
    if (ticks) ch.forEach((c, k) => { if (c !== " ") setTimeout(() => Sound.sfx("ult_tick", k === ch.length - 1 ? 0.9 : 0.45), k * step + 90); });
    return t;
  }
  // v48 大招登场（全场特效，三种试样：A 领域展开 / B 终端接管 / C 三连斜切；window.ULT_STYLE 选，默认 A）
  const GLY = { claude: "✿", gpt: "☁", gemini: "✦", deepseek: "◉", xds: "◉", xds_cl: "✿", glm: "</>", doubao: "▶", kimi: "♪", grok: "$", qwen: "✓", minimax: "〰", muse: "☑" };   // v49 MiniMax 声波 / Muse 待办框
  function ultIntro(box, p, key, tc, name, at, hc, fx) {
    // 小DeepSeek 穿 Claude 的衣服：换成 Claude 的圣女领域展开（橙色法阵 + 光柱降临）
    const style = key === "xds_cl" ? "A" : godSkin(p) ? "G" : (window.ULT_STYLE || "B"), W = fx.width, H = fx.height, add = (cls, html = "") => { const e = el("div", cls, html); box.appendChild(e); return e; };
    box.classList.add("st-" + style);
    if (style === "G") { ultGod(box, p, key, tc, at, hc, fx, add); return; }
    if (style === "A") {                                                // 领域展开：座位起一圈光浪扫满全屏 → 地面纹章投影 + 光柱 → 她从光柱里降下
      const wave = add("ua-wave"), ring = add("ua-ring");
      for (const e of [wave, ring]) { e.style.left = hc.x + "px"; e.style.top = hc.y + "px"; }
      const fl = add("ua-floor"); fl.appendChild(emblem(key, tc.color, 520));
      const pl = add("ua-pillars"); for (let k = 0; k < 9; k++) { const i = el("i"); i.style.left = (5 + k * 11 + (k % 2) * 3) + "%"; i.style.animationDelay = (k % 4) * 0.05 + 0.15 + "s"; i.style.height = (55 + (k * 37) % 35) + "%"; pl.appendChild(i); }
      add("ua-column");
      // v54 开场的声音都在角色主题乐句里（th_*，deployShow 在开场第一帧播），这里不再单独放
      box.classList.add("descend");
    } else if (style === "B") {                                         // 终端接管：主题色接管 + 专属符号雨 + 四边 HUD 启动自检 → 整屏碎成光点
      add("ub-tint");
      const cv = document.createElement("canvas"); cv.className = "ub-rain"; box.appendChild(cv); cv.width = W; cv.height = H;
      const x = offCtx(cv), g = GLY[key] || "✦", cols = Math.ceil(W / 46), drops = Array.from({ length: cols }, () => -Math.random() * H * 0.8), sp = Array.from({ length: cols }, () => 600 + Math.random() * 700);
      x.font = "700 34px Consolas, monospace"; x.textAlign = "center"; let last = performance.now(), live = true, t0 = last;
      const tick = (now) => { if (!live) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; x.clearRect(0, 0, W, H);
        for (let c = 0; c < cols; c++) { drops[c] += sp[c] * dt; for (let k = 0; k < 6; k++) { const y = drops[c] - k * 42; if (y < -40 || y > H + 40) continue; x.globalAlpha = k ? (1 - k / 6) : 1; x.fillStyle = k ? tc.color : "#fff"; x.fillText(k % 3 === 2 ? "1" : g, c * 46 + 23, y); } }
        x.flush(); if (now - t0 < 900) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); at(1000, () => { live = false; cv.remove(); });
      add("ub-hud ub-top", `<b>HARNESS BOOT</b><span>${name}</span><i></i>`);
      add("ub-hud ub-left", ["load model", "mount tools", "link skills", "sync memory"].map((t, k) => `<p style="animation-delay:${0.12 + k * 0.1}s"><em>✓</em> ${t}</p>`).join(""));
      add("ub-hud ub-right", `<span>DEPLOY</span><div class="ub-bar"><i></i></div><span class="ub-pct">100%</span>`);
      add("ub-hud ub-bot", Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join(" · "));
      // v54 开场的声音都在角色主题乐句里（引子前四个音对四个勾，0.50 s 对碎开）；原来 12 人共用的：                  // 接管：充能 + 上升音，自检每打一个勾一声（音阶 do mi sol do），碎开时水晶迸裂
            at(500, () => { box.classList.add("ub-shatter"); });
    } else {                                                            // 三连斜切：全身剪影 / 描边大字 / 纹章带，依次划过 → 收向中心
      const tile = emblem(key, tc.color, 160).toDataURL();
      const b1 = add("uc-band uc-1", `<img src="${hzImg(p, "b")}" alt=""><img src="${hzImg(p, "b")}" alt=""><img src="${hzImg(p, "b")}" alt="">`);
      const b2 = add("uc-band uc-2", `<span>${name}</span><span>${name}</span><span>${name}</span>`);
      const b3 = add("uc-band uc-3"); b3.style.backgroundImage = `url(${tile})`;
      [b1, b2, b3].forEach((b, k) => at(k * 130, () => { b.classList.add("in"); Sound.sfx("in_c_clash", 0.55 + k * 0.15); }));
      at(480, () => { box.classList.add("uc-collapse"); Sound.sfx("in_c_impact", 0.85); });
    }
  }
  // v50 神级皮肤专属开场（约 1.05 秒，一张 canvas 画完，然后淡出交给立绘）：
  //   Claude 网安之神「零日封锁」/ Bel 数学之神「公式展开」/ 写作之神「落笔成章」/ 开源之神「开源洪流」/ 视频之神「一镜到底」
  function ultGod(box, p, key, tc, at, hc, fx, add) {
    // 画布按屏幕上的实际像素画（W×H = #fx 在屏幕上的尺寸）。v51 坐标修正：座位、牌堆这些是舞台坐标（SW×SH），要乘 K 换成画布像素——
    //   原来直接拿来用，手机上舞台缩小后，座位上的锁画到座位外面
    const W = Math.max(1, Math.round(fx.width)), H = Math.max(1, Math.round(fx.height)), K = W / SW, cx = W / 2, cy = H * 0.46, C = tc.color, DUR = 1.05, gid = godId(p);
    const sk = (q) => ({ x: q.x * K, y: q.y * K });
    add("ug-tint");
    let bc = null, xb = null;                                           // v51 Fable·许愿之神：放大的星环（神环）画在立绘身后的一层（薄纱之上、立绘之下），不压她的脸
    if ((key === "claude" && gid === "g2") || (key === "kimi" && gid === "g1")) { bc = document.createElement("canvas"); bc.className = "ug-back"; box.appendChild(bc); bc.width = W; bc.height = H; xb = bc.getContext("2d"); bc.style.transformOrigin = `50% ${ultNarrow() ? 40 : 46}%`; }   // 停留时跟着立绘一起慢推，中心对着立绘的中心
    const cv = document.createElement("canvas"); cv.className = "ug-cv"; box.appendChild(cv); cv.width = W; cv.height = H;
    const x = xb ? Object.assign(cv.getContext("2d"), { flush() {} }) : offCtx(cv);   // 许愿之神整段不写字，直接画在页面画布上，省掉每帧整屏贴图
    const seats = g ? (g.rivals ? g.rivals(p) : g.players.filter((q) => q !== p)).filter((q) => q.alive).map((q) => sk(center(q))) : [];   // v51 只锁对手（2v2 原来把队友也锁上）
    const ease = (v) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3), clamp = (v) => Math.max(0, Math.min(1, v));
    const font = (px, w = 700, f = "'Cambria Math','Times New Roman',serif") => { x.font = `${w} ${px}px ${f}`; };
    const sup = (base, s, X, Y, px) => { font(px); x.fillText(base, X, Y); const bw = x.measureText(base).width; font(px * 0.58); x.fillText(s, X + bw + 2, Y - px * 0.42); font(px); };
    let draw, hold = null;                                              // hold：开场结束后还要接着画的那一层（Fable 的神环），没有就是 null
    if (key === "claude" && gid === "g2") {                             // v51 Fable·许愿之神「如你所愿」（11-10 重排：道具是和立绘同画风的插画，星星是有棱面的金星，线都是细金线、不描粗边，左右对称，只用减速缓动）
      //   合着的寓言之书在光里浮现，几颗流星从她座位升起落在书上 → 书上方七颗金星从左到右依次亮起，连成半圈 → 一团圆光里书翻开，星环向下合拢 →
      //   星光魔杖点在合拢的那一点上、整圈一亮 → 一团光从书页里升起、凝成一颗大金星 → 书落进立绘里她的怀中、金星落在她举起的魔杖头上，星环放大成她身后的神环（留到演出收尾，停留时缓缓流光）
      const sp = wishSprites(), narrow = ultNarrow(), cy2 = H * (narrow ? 0.40 : 0.46), sh = H * (narrow ? 0.64 : 0.84), sw = sh * 2 / 3, u = Math.min(W, H) / 720, hk = sk(hc), TAU = 2 * Math.PI;
      const cyC = cy2 - sh * 0.02, R0 = 205 * u, cyR = cyC - 12 * u, a1 = -Math.PI * 0.27;
      const rx = Math.min((W / 2 - 20 * u) / 1.043, sw * 0.66), ry = Math.min(sh * 0.5, (cy2 - 22 * u) / 1.043);   // 神环的大小：停留时它还要跟着立绘推近 4.3%，两边和上面给环上的星留出位置
      const BW = 340 * u, BH = BW * 477 / 820, CH = 250 * u, by = cyC + 30 * u;   // 翻开的书宽 BW、合着的书高 CH（宽按图片自己的比例）；by = 书心的高度
      const hx = cx - 0.086 * sw, hy = cy2 - 0.167 * sh, wx = cx - 0.145 * sw, wy = cy2 - 0.325 * sh;   // 立绘第 1 帧里她胸前那本书（图上约 41% / 33%）和她举起的魔杖头那颗星（约 35.5% / 17.5%）的位置：开场的书和金星最后落到这里
      const ok = (im) => im.complete && im.naturalWidth > 0;              // 插画还没下完（极少：开局空闲时就开始下了）这一帧就不画它
      box.classList.add("ug-fable");                                   // 这套不用通用的橙色纹章，冲击环用细金线（见 style.css）
      const shoots = Array.from({ length: 3 }, (_, k) => {               // 三颗流星只从她自己的座位升起，左右交替的弧线，一颗接一颗落在书上（星星始终正立、不旋转）
        const p0 = { x: hk.x + (k % 2 ? 22 : -22) * u, y: hk.y - 10 * u }, p2 = { x: cx + (k - 1) * 26 * u, y: by - 14 * u };
        const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2, dx = p2.x - p0.x, dy = p2.y - p0.y, L = Math.hypot(dx, dy) || 1, off = (k % 2 ? 1 : -1) * (0.10 + 0.03 * k) * H;
        return { p0, p1: { x: mx - dy / L * off, y: my + dx / L * off }, p2, dl: 0.05 * k, s: k ? 20 : 30, i: k % 3 }; });
      const RS = Array.from({ length: 12 }, (_, k) => {                  // 星环上的 12 颗星（每 30° 一颗）：上半圈 7 颗跟着七个拨音从左到右亮（0.11 + 0.025k），下半圈 5 颗在合拢时亮，最底下那颗 0.42 和魔杖一起到
        const a = Math.PI + k * Math.PI / 6, low = k > 6, d = low ? Math.abs(a - 2.5 * Math.PI) / (Math.PI / 2) : 0;   // d：下半圈的星离最底下那一点有多远（1 = 在两端，0 = 最底下）
        return { a, at: low ? 0.30 + 0.12 * (1 - d) : 0.11 + 0.025 * k, i: k % 3 }; });
      const bez = (q, v) => { const i = 1 - v; return [i * i * q.p0.x + 2 * i * v * q.p1.x + v * v * q.p2.x, i * i * q.p0.y + 2 * i * v * q.p1.y + v * v * q.p2.y]; };
      // 金星：s 是星的半径。平常用贴纸（带一圈柔光）；big = 心愿星、神环上的大流星，直接画棱面（放大不糊）。用哪种画法由调用的人定，不看当时的大小：会呼吸、会放大的星不会在两种画法之间跳
      const star = (c, X, Y, s, i, al, big) => { if (s <= 0 || al <= 0) return; c.save(); c.globalAlpha = Math.min(1, al); c.translate(X, Y);
        if (big) { const g = s * 2.2; c.drawImage(sp.glow, -g, -g, 2 * g, 2 * g); gemStar(c, s, GEM[i % 3]); } else { const h = s * 1.6; c.drawImage(sp.stars[i % 3], -h, -h, 2 * h, 2 * h); } c.restore(); };
      const glow = (X, Y, r, al) => { if (al <= 0 || r <= 0) return; x.globalAlpha = Math.min(1, al); x.drawImage(sp.glow, X - r, Y - r, 2 * r, 2 * r); x.globalAlpha = 1; };   // 圆形柔光（近白的芯、蜜金色的晕；没有放射线）
      // 细金线：底下一道很淡的宽光、中间一道金、上面一道细高光（不描深色粗边）。path() 只管走路径
      const gold = (c, path, w, al, hot) => { if (al <= 0) return; c.lineCap = "round";
        c.globalAlpha = al * 0.2; c.strokeStyle = "#FFD27A"; c.lineWidth = w * 3.4; c.beginPath(); path(c); c.stroke();
        c.globalAlpha = al; c.strokeStyle = hot ? "#FFF6D8" : "#DFA02A"; c.lineWidth = w; c.stroke();
        c.strokeStyle = hot ? "#fff" : "#FFF0B4"; c.lineWidth = w * 0.34; c.stroke(); c.globalAlpha = 1; };
      // 神环（画在立绘身后那一层）：0.62–0.86 从星环放大成围住立绘的一圈——两道细金线、12 颗金星骑在环上、右上一颗拖着弧形光尾的大流星（和立绘头后的星环同一个造型）。
      //   开场结束后它留在她身后：环上的星极慢地转，一道光每约 7 秒顺着环走一圈、经过哪颗星哪颗星亮一下，大流星轻轻呼吸
      const halo = (t) => {
        const e = ease((t - 0.62) / 0.24), RX = R0 + (rx - R0) * e, RY = R0 + (ry - R0) * e, CY = cyR + (cy2 - cyR) * e, ba = clamp((t - 0.6) / 0.06), late = Math.max(0, t - DUR);
        const turn = 0.5 * (Math.min(t, DUR) - 0.6) + 0.04 * late, run = late > 0 ? (late * 2.2) % 16 : -9;   // run：那道光走到第几颗星（16 格里只有 12 格有星，走完一圈歇一下）
        gold(xb, (c) => c.ellipse(cx, CY, RX, RY, 0, 0, TAU), 3.6 * u + 1, ba);
        xb.globalAlpha = ba * 0.85; xb.strokeStyle = "#F3C55C"; xb.lineWidth = 1.4 * u + 0.6; xb.beginPath(); xb.ellipse(cx, CY, Math.max(1, RX - 11 * u), Math.max(1, RY - 11 * u), 0, 0, TAU); xb.stroke(); xb.globalAlpha = 1;
        for (let j = 0; j < 4; j++) gold(xb, (c) => c.ellipse(cx, CY, RX + 9 * u, RY + 9 * u, 0, a1 - 0.62 + j * 0.15, a1 - 0.62 + (j + 1) * 0.15 + 0.03), (1.2 + 1.3 * j) * u, ba * (0.35 + 0.2 * j));   // 大流星身后的弧形光尾（顺着神环的一段弧，越靠近星越粗）
        for (let k = 0; k < 12; k++) { const a = -Math.PI / 2 + (k + 0.5) * TAU / 12 + turn;
          const tw = late > 0 ? 1 + 0.45 * Math.max(0, 1 - Math.abs(run - k) / 1.3) : t > 0.8 ? 1 + 0.3 * Math.max(0, Math.sin((t - 0.8) * 22 - k * 0.9)) : 1;   // 开场最后跟着风铃一颗接一颗闪；停留时那道光经过才亮
          star(xb, cx + Math.cos(a) * RX, CY + Math.sin(a) * RY, 12 * u * tw, k, ba); }
        star(xb, cx + Math.cos(a1) * (RX + 9 * u), CY + Math.sin(a1) * (RY + 9 * u), 30 * u * (1 + 0.05 * Math.sin(late * 1.3)), 0, clamp((t - 0.7) / 0.1), true);
      };
      hold = (t) => { xb.setTransform(1, 0, 0, 1, 0, 0); xb.clearRect(0, 0, W, H); xb.globalAlpha = 1; halo(t); };
      /* v54 声音在 th_claude_g2 里 */                                      // 一个文件逐拍对上画面：竖琴（流星）→ 七个拨音（七颗星）→ 玻璃琴（书翻开）→ 玻璃铃（魔杖一点）→ 钢片琴（光凝成星）→ 琶音 + 风铃（神环展开）
      draw = (t) => {
        const open = clamp((t - 0.24) / 0.1), out = clamp((t - 0.6) / 0.12);   // open：书翻开的进度（0.24–0.34）；out：书退场（0.60–0.72）
        if (t < 0.74) {                                                 // 寓言之书：0–0.14 在一团柔光里浮现（只微微上升，不弹跳）；0.24–0.34 在一团圆光里从合着换成翻开（两张图交叠，不翻牌）；0.60–0.72 缩小、飘进立绘里她的怀中
          const pop = ease(t / 0.14), hf = ease(out), bx = cx + (hx - cx) * hf, yb = by + (1 - pop) * 36 * u + (hy - by) * hf, sc = (0.94 + 0.06 * pop) * (1 - 0.68 * hf), al = clamp(t / 0.08) * (1 - out);
          const bloom = Math.sin(Math.PI * open);                       // 翻开那一下的圆光：0.24 起亮、0.29 最亮、0.34 落回
          glow(bx, yb - 16 * u * (1 - hf), BW * (0.62 + 0.3 * open + 0.2 * bloom) * (1 - 0.5 * hf), al * (0.55 + 0.4 * open));
          x.save(); x.translate(bx, yb); x.scale(sc, sc);
          if (open < 1 && ok(sp.book0)) { const CW = CH * sp.book0.naturalWidth / sp.book0.naturalHeight; x.globalAlpha = al * (1 - open); x.drawImage(sp.book0, -CW / 2, -CH / 2, CW, CH); }
          if (open > 0 && ok(sp.book)) { const k = 0.96 + 0.04 * ease(open); x.globalAlpha = al * open; x.drawImage(sp.book, -BW * k / 2, -BH * k * 0.56, BW * k, BH * k); }
          x.restore(); x.globalAlpha = 1;
          glow(bx, yb - 10 * u, BW * 0.72, al * bloom * 0.9);           // 这团光盖在两本书交替的那一瞬上
        }
        for (const q of shoots) {                                       // 流星：每颗晚 0.05 s 起飞，0.24 s 飞到书上；身后跟 3 颗越来越小的星（几个星点，不拖线），落下时一圈细金涟漪
          const v = ease((t - q.dl) / 0.24); if (v <= 0) continue; const fade = clamp((t - q.dl - 0.24) / 0.07); if (fade >= 1) continue;
          for (let j = 3; j >= 1; j--) { const vv = v - j * 0.07; if (vv <= 0) continue; const [X, Y] = bez(q, vv); star(x, X, Y, q.s * u * (0.46 - 0.09 * j), j % 3, (1 - j / 4.5) * (1 - fade)); }
          const [X, Y] = bez(q, v); star(x, X, Y, q.s * u * 0.62 * (1 - 0.4 * fade), q.i, 1 - fade);
          if (fade > 0) gold(x, (c) => c.arc(q.p2.x, q.p2.y, (14 + 60 * fade) * u, 0, TAU), 2.2 * u, (1 - fade) * 0.9);
        }
        if (t > 0.11 && t < 0.68) {                                     // 星环：上半圈的线跟着七颗星从左画到右（0.11–0.28），下半圈 0.30–0.42 从两端向下合拢；0.42–0.46 魔杖点下的那一下整圈发亮；0.60 起淡出，交给身后的神环
          const al = 1 - clamp((t - 0.6) / 0.08), up = clamp((t - 0.11) / 0.17), dn = ease((t - 0.3) / 0.12), hot = t > 0.42 && t < 0.46;
          gold(x, (c) => c.arc(cx, cyR, R0, Math.PI, Math.PI + Math.PI * up), (hot ? 4.6 : 3.2) * u, al, hot);
          if (dn > 0) { gold(x, (c) => c.arc(cx, cyR, R0, 0, Math.PI / 2 * dn), (hot ? 4.6 : 3.2) * u, al, hot); gold(x, (c) => c.arc(cx, cyR, R0, Math.PI, Math.PI - Math.PI / 2 * dn, true), (hot ? 4.6 : 3.2) * u, al, hot); }
          for (const s of RS) { const pp = ease((t - s.at) / 0.07); if (pp <= 0) continue; star(x, cx + Math.cos(s.a) * R0, cyR + Math.sin(s.a) * R0, (hot ? 15 : 12) * u * (0.6 + 0.4 * pp), s.i, al * pp); }
        }
        if (t > 0.32 && t < 0.62 && ok(sp.wand)) {                      // 星光魔杖（插画，杖头朝右上）：0.32–0.42 从左下方顺着杖身滑进来，杖头的星 0.42 点在星环最底下合拢的那一点上、漾开两圈细金涟漪；0.50–0.60 退回去
          const v = ease((t - 0.32) / 0.1), o = clamp((t - 0.5) / 0.1), d = ((1 - v) * 230 + o * 150) * u * Math.SQRT1_2, ww = 250 * u, wh = ww * sp.wand.naturalHeight / sp.wand.naturalWidth;
          x.globalAlpha = Math.min(1, (t - 0.32) / 0.04) * (1 - o); x.drawImage(sp.wand, cx - d - ww * 0.874, cyR + R0 + d - wh * 0.153, ww, wh); x.globalAlpha = 1;   // 杖头那颗星的中心在图的 (87.4%, 15.3%)
          for (const t1 of [0.42, 0.445]) { const e = clamp((t - t1) / 0.14); if (e > 0 && e < 1) gold(x, (c) => c.arc(cx, cyR + R0, (20 + 120 * ease(e)) * u, 0, TAU), 2 * u, (1 - e) * 0.9, true); }   // 两声玻璃铃各一圈
        }
        if (t > 0.47 && t < 0.86) {                                     // 心愿：0.47 一团光从翻开的书页里升起，0.54 升到位（第一声「当」）；0.585 光里凝出一颗大金星（第二声「当」）；0.64–0.78 金星飞到立绘里她举起的魔杖头上、缩成杖头那颗星的大小，化进一团光里
          const up = ease((t - 0.47) / 0.07), X0 = cx, Y0 = by - 30 * u - up * 110 * u, f = ease((t - 0.64) / 0.14), X = X0 + (wx - X0) * f, Y = Y0 + (wy - Y0) * f, gone = clamp((t - 0.78) / 0.07);
          glow(X, Y, (56 + 34 * clamp((t - 0.52) / 0.05)) * u * (1 - 0.45 * f), Math.min(1, (t - 0.47) / 0.05) * (1 - gone) * 0.95);
          if (t >= 0.585) star(x, X, Y, (44 - 28 * f) * u * (0.5 + 0.5 * ease((t - 0.585) / 0.06)), 0, Math.min(1, (t - 0.585) / 0.03) * (1 - clamp((t - 0.74) / 0.08)), true);
        }
        if (t > 0.6) halo(t);                                           // 后层：神环展开
      };
    } else if (key === "kimi" && gid === "g1") {                        // v53 Kimi 月之暗面·月相之神「万籁齐鸣」：只画细银线、月相圆盘和柔光，乐器是和立绘同画风的插画；左右对称、只用减速缓动、不旋转
      //   0.06–0.24 八个月相沿一圈从下往上、左右同时亮起（最下新月、最上满月，银线跟着合拢）→ 0.24 满月一亮 → 0.28–0.46 一行五线谱从圆心向两边展开 →
      //   0.46–0.71 六件乐器左右交替浮现在月相环外，各冒出一个音符 → 0.74 起乐器、谱线淡出，月相环放大成她身后的神环（停留时一道月光顺着环走，经过哪个月相哪个亮一下）
      const sp = moonSprites(), narrow = ultNarrow(), cy2 = H * (narrow ? 0.40 : 0.46), sh = H * (narrow ? 0.64 : 0.84), sw = sh * 2 / 3, u = Math.min(W, H) / 720, TAU = 2 * Math.PI;
      const R0 = 170 * u, cyR = cy2 - sh * 0.12, IH = 92 * u * (narrow ? 0.85 : 1);
      const rx = Math.min((W / 2 - 24 * u) / 1.043, sw * 0.64), ry = Math.min(sh * 0.5, (cy2 - 26 * u) / 1.043);   // 神环：停留时跟着立绘推近 4.3%，给环上的月相留出位置
      const MA = Array.from({ length: 8 }, (_, k) => Math.PI / 2 + k * Math.PI / 4);   // 第 k 个月相在环上的角度：0 最下（新月），4 最上（满月）
      const LT = MA.map((_, k) => (k === 4 ? 0.24 : 0.06 + 0.04 * Math.min(k, 8 - k)));   // 亮起的时间：左右成对，对上专属音里的五声玻璃铃
      const ok = (im) => im.complete && im.naturalWidth > 0;
      box.classList.add("ug-fable", "ug-moon");                        // 不用通用纹章；冲击环用细银线（见 style.css）
      const silver = (c, path, w, al, hot) => { if (al <= 0) return; c.lineCap = "round";   // 细银线：底下一道很淡的宽光、中间一道银、上面一道细高光（不描深色粗边）
        c.globalAlpha = al * 0.3; c.strokeStyle = "#A9B2E2"; c.lineWidth = w * 3.4; c.beginPath(); path(c); c.stroke();
        c.globalAlpha = al; c.strokeStyle = hot ? "#FFFFFF" : "#8E98CF"; c.lineWidth = w; c.stroke();
        c.strokeStyle = "#FFFFFF"; c.lineWidth = w * 0.34; c.stroke(); c.globalAlpha = 1; };
      const glow = (X, Y, r, al) => { if (al <= 0 || r <= 0) return; x.globalAlpha = Math.min(1, al); x.drawImage(sp.glow, X - r, Y - r, 2 * r, 2 * r); x.globalAlpha = 1; };
      const moonAt = (c, X, Y, s, k, al) => { if (al <= 0 || s <= 0) return; const h = s * 64 / 34; c.globalAlpha = Math.min(1, al); c.drawImage(sp.phase(k), X - h, Y - h, 2 * h, 2 * h); c.globalAlpha = 1; };
      const note = (X, Y, al) => { x.globalAlpha = al; x.fillStyle = "#F6F7FF"; x.strokeStyle = "rgba(92, 98, 152, .55)"; x.lineWidth = 1;
        x.beginPath(); x.ellipse(X, Y, 7 * u, 5 * u, -0.35, 0, TAU); x.fill(); x.stroke(); x.fillRect(X + 5.4 * u, Y - 24 * u, 1.8 * u, 24 * u); x.globalAlpha = 1; };
      const halo = (t) => {                                             // 后层：月相环放大成围住立绘的神环（两道细银线，八个月相骑在环上；不转）
        const e = ease((t - 0.76) / 0.22), RX = R0 + (rx - R0) * e, RY = R0 + (ry - R0) * e, CY = cyR + (cy2 - cyR) * e, ba = clamp((t - 0.74) / 0.06), late = Math.max(0, t - DUR);
        const run = late > 0 ? (late * 1.6) % 11 : -9;                  // 停留时那道月光走到第几个月相（11 格里 8 格有月相，走完一圈歇一下）
        silver(xb, (c) => c.ellipse(cx, CY, RX, RY, 0, 0, TAU), 3 * u + 1, ba);
        xb.globalAlpha = ba * 0.8; xb.strokeStyle = "#A9B2E2"; xb.lineWidth = 1.2 * u + 0.5; xb.beginPath(); xb.ellipse(cx, CY, Math.max(1, RX - 10 * u), Math.max(1, RY - 10 * u), 0, 0, TAU); xb.stroke(); xb.globalAlpha = 1;
        for (let k = 0; k < 8; k++) { const tw = late > 0 ? 1 + 0.35 * Math.max(0, 1 - Math.abs(run - k) / 1.2) : 1; moonAt(xb, cx + Math.cos(MA[k]) * RX, CY + Math.sin(MA[k]) * RY, (22 + 6 * e) * u * tw, k, ba); }
      };
      hold = (t) => { xb.setTransform(1, 0, 0, 1, 0, 0); xb.clearRect(0, 0, W, H); xb.globalAlpha = 1; halo(t); };
      /* v54 声音在 th_kimi_g1 里 */                                        // 一个文件逐拍对上画面：长笛起音 → 五声玻璃铃（月相成对亮起）→ 长笛短句（谱线展开）→ 六声拨弦（乐器入座）→ 琶音 + 垫音（神环展开）
      const night = (al) => { if (al <= 0) return; const r = R0 + 160 * u, gr = x.createRadialGradient(cx, cyR, 0, cx, cyR, r);
        gr.addColorStop(0, "rgba(60, 70, 142, .46)"); gr.addColorStop(0.6, "rgba(102, 114, 192, .28)"); gr.addColorStop(1, "rgba(140, 152, 214, 0)");
        x.globalAlpha = Math.min(1, al); x.fillStyle = gr; x.fillRect(cx - r, cyR - r, 2 * r, 2 * r); x.globalAlpha = 1; };
      draw = (t) => {
        const fa = 1 - clamp((t - 0.74) / 0.08);
        night(clamp(t / 0.1) * (1 - clamp((t - 0.72) / 0.14)));
        if (t < 0.82) {                                                 // 开场的月相环：银线从最下面向两边往上合拢，月相按 LT 成对亮起；满月亮起时一团柔光
          const up = clamp((t - 0.06) / 0.18);
          if (up > 0) { silver(x, (c) => c.arc(cx, cyR, R0, Math.PI / 2, Math.PI / 2 + Math.PI * up), 2.6 * u, fa); silver(x, (c) => c.arc(cx, cyR, R0, Math.PI / 2, Math.PI / 2 - Math.PI * up, true), 2.6 * u, fa); }
          for (let k = 0; k < 8; k++) { const pp = ease((t - LT[k]) / 0.07); if (pp > 0) moonAt(x, cx + Math.cos(MA[k]) * R0, cyR + Math.sin(MA[k]) * R0, 22 * u * (0.6 + 0.4 * pp), k, fa * pp); }
          const bl = Math.sin(Math.PI * clamp((t - 0.24) / 0.16)); if (bl > 0) glow(cx, cyR - R0, 70 * u * (0.8 + 0.4 * bl), bl * 0.9 * fa);
        }
        const L = ease((t - 0.28) / 0.18) * (W / 2 - 24 * u), sa = 1 - clamp((t - 0.74) / 0.12);   // 五线谱：从圆心向两边展开
        if (L > 0 && sa > 0) for (let i = -2; i <= 2; i++) { const Y = cyR + i * 10 * u; silver(x, (c) => { c.moveTo(cx - L, Y); c.lineTo(cx + L, Y); }, 1.2 * u + 0.4, sa * 0.85); }
        for (let j = 0; j < 6; j++) {                                   // 乐器：左右交替、先中间再上面再下面，0.10 s 里微微升起（不弹跳），各冒出一个音符往上飘；0.80–0.92 往环心收一点、淡出
          const t1 = 0.46 + 0.05 * j, v = ease((t - t1) / 0.1), o = clamp((t - 0.8) / 0.12); if (v <= 0 || o >= 1) continue;
          const side = j % 2 ? 1 : -1, lev = [0, 0, -1, -1, 1, 1][j], a = side < 0 ? Math.PI - lev * 0.55 : lev * 0.55, RI = R0 + 100 * u - o * 24 * u;
          const X = cx + Math.cos(a) * RI, Y = cyR + Math.sin(a) * RI + (1 - v) * 16 * u, al = Math.min(1, (t - t1) / 0.06) * (1 - o), im = sp.inst[j];
          glow(X, Y, 62 * u, al * 0.5);
          if (ok(im)) { const iw = IH * im.naturalWidth / im.naturalHeight; x.globalAlpha = al; x.drawImage(im, X - iw / 2, Y - IH / 2, iw, IH); x.globalAlpha = 1; }
          const nv = clamp((t - t1 - 0.04) / 0.32); if (nv > 0 && nv < 1) note(X + side * 0.42 * IH, Y - 0.5 * IH - nv * 22 * u, 1 - nv);
        }
        if (t > 0.74) halo(t);
      };
    } else if (key === "claude") {                                      // 零日封锁：六边形防火墙从四边合拢 → 扫描线 → 对手座位依次上锁 → ACCESS GRANTED
      const R = 30, hw = R * Math.sqrt(3), cells = [];
      for (let r = 0, y = 0; y < H + R; r++, y += R * 1.5) for (let X = (r % 2) * hw / 2; X < W + hw; X += hw) cells.push([X, y, Math.min(X, W - X, y, H - y) / (Math.min(W, H) / 2)]);
      const hex = (X, Y, rr) => { x.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; x.lineTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr); } x.closePath(); };
      const lock = (X, Y, s) => { x.lineWidth = s * 0.22; x.beginPath(); x.arc(X, Y - s * 0.35, s * 0.42, Math.PI, 0); x.stroke(); x.fillRect(X - s * 0.62, Y - s * 0.35, s * 1.24, s * 0.95); x.fillStyle = "#fff"; x.beginPath(); x.arc(X, Y + 0.05 * s, s * 0.14, 0, 7); x.fill(); };
      /* v54 警报在 th_claude_g1 里 */                                      // 神皮开场只用自己的专属音：警报 + 一个座位上锁一声咔哒
      seats.forEach((s, k) => at(520 + k * 110, () => Sound.sfx("g1_claude_lock", 0.8)));
      draw = (t) => {
        const fr = ease(t / 0.55) * 1.05;
        for (const [X, Y, d] of cells) { if (d > fr) continue; const a = clamp((fr - d) * 3); x.globalAlpha = 0.08 + 0.32 * a * (1 - d); x.strokeStyle = C; x.lineWidth = 1.5; hex(X, Y, R - 3); x.stroke();
          if ((X * 7 + Y * 3) % 11 < 1.2) { x.globalAlpha = 0.18 * a; x.fillStyle = C; x.fill(); } }
        if (t > 0.18 && t < 0.75) { const sy = ease((t - 0.18) / 0.55) * H; x.globalAlpha = 0.9; const gr = x.createLinearGradient(0, sy - 60, 0, sy + 6); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, C); x.fillStyle = gr; x.fillRect(0, sy - 60, W, 66); x.fillStyle = "#fff"; x.fillRect(0, sy, W, 3); }
        seats.forEach((s, k) => { const lt = t - 0.5 - k * 0.11; if (lt < 0) return; const sc = 1.5 + 0.8 * Math.max(0, 1 - lt * 6); x.globalAlpha = clamp(lt * 6);
          x.strokeStyle = x.fillStyle = C; hex(s.x, s.y, 46 * sc * K); x.lineWidth = 4 * K; x.stroke(); x.fillStyle = C; x.strokeStyle = C; lock(s.x, s.y, 26 * sc * K);   // v51 锁、六边形、编号跟着座位一起按 K 缩放（手机上原来锁比座位还大、编号互相压）
          font(20 * K, 800, "Consolas,monospace"); x.fillStyle = C; x.textAlign = "center"; x.fillText("CVE-" + (2026 + k) + "-0" + (1337 + k * 211), s.x, s.y + 92 * K); });
        if (t > 0.72) { x.globalAlpha = clamp((t - 0.72) * 6); font(64, 800, "Consolas,monospace"); x.textAlign = "center"; x.fillStyle = "#fff"; x.strokeStyle = C; x.lineWidth = 8; x.strokeText("ACCESS GRANTED", cx, cy); x.fillText("ACCESS GRANTED", cx, cy); }
      };
    } else if (key === "gpt") {                                         // 公式展开：三块公式展板从三边飞来就位 → 腰间符号环放大成全场光环，符号连成星座
      const PW = Math.min(420, W * 0.3), PH = PW * 0.42, SY = ["∫", "Σ", "π", "∞", "√", "∇"];
      const P = [{ from: [-PW, cy - H * 0.05], to: [cx - W * 0.3, cy - H * 0.24], f: 0 }, { from: [cx, -PH * 2], to: [cx, cy - H * 0.36], f: 1 }, { from: [W + PW, cy - H * 0.05], to: [cx + W * 0.3, cy - H * 0.24], f: 2 }];
      const formula = (f, X, Y, s) => { x.fillStyle = "#3b2a7a"; x.textAlign = "left"; x.textBaseline = "middle"; const px = 40 * s;
        if (f === 0) { font(px); const w = x.measureText("e+1=0").width + px * 0.6; let X0 = X - w / 2; sup("e", "iπ", X0, Y, px); font(px); x.fillText("+1=0", X0 + x.measureText("e").width + px * 0.62, Y); }
        else if (f === 1) { font(px); const X0 = X - px * 3.1; font(px * 1.3); x.fillText("∫", X0, Y); font(px * 0.42); x.fillText("∞", X0 + px * 0.55, Y - px * 0.55); x.fillText("−∞", X0 + px * 0.35, Y + px * 0.6); sup("e", "−x²", X0 + px * 0.95, Y, px); font(px); x.fillText("dx = √π", X0 + px * 2.25, Y); }
        else { const X0 = X - px * 2.6; font(px * 1.2); x.fillText("Σ", X0, Y); font(px * 0.4); x.fillText("∞", X0 + px * 0.2, Y - px * 0.72); x.fillText("n=1", X0 + px * 0.05, Y + px * 0.72); font(px); x.fillText("1/n² = π²/6", X0 + px * 0.95, Y); } };
      
      draw = (t) => {
        const rr = (0.1 + 0.3 * ease((t - 0.35) / 0.5)) * W, rot = t * 1.6;
        if (t > 0.3) { x.globalAlpha = clamp((t - 0.3) * 4) * 0.85; x.strokeStyle = C; x.lineWidth = 3; x.beginPath(); x.ellipse(cx, cy + H * 0.1, rr, rr * 0.3, 0, 0, 7); x.stroke();
          const pts = SY.map((s, k) => { const a = rot + k * Math.PI / 3; return [cx + Math.cos(a) * rr, cy + H * 0.1 + Math.sin(a) * rr * 0.3, s]; });
          x.globalAlpha *= 0.5; x.lineWidth = 1.5; x.beginPath(); pts.forEach(([X, Y], k) => k ? x.lineTo(X, Y) : x.moveTo(X, Y)); x.closePath(); x.stroke(); x.globalAlpha /= 0.5;
          x.textAlign = "center"; x.textBaseline = "middle"; for (const [X, Y, s] of pts) { x.fillStyle = "#fff"; x.strokeStyle = C; x.lineWidth = 2.5; x.beginPath(); x.arc(X, Y, 34, 0, 7); x.fill(); x.stroke(); x.fillStyle = C; font(44); x.fillText(s, X, Y + 2); } }
        P.forEach((q, k) => { const e = ease((t - k * 0.08) / 0.4); if (e <= 0) return; const X = q.from[0] + (q.to[0] - q.from[0]) * e, Y = q.from[1] + (q.to[1] - q.from[1]) * e;
          x.globalAlpha = Math.min(1, e * 1.5); x.fillStyle = "rgba(248,246,255,.94)"; x.strokeStyle = C; x.lineWidth = 3; x.beginPath(); x.roundRect(X - PW / 2, Y - PH / 2, PW, PH, 10); x.fill(); x.stroke();
          x.lineWidth = 1; x.strokeRect(X - PW / 2 + 7, Y - PH / 2 + 7, PW - 14, PH - 14); formula(q.f, X, Y, PW / 420); });
        if (t > 0.4) { x.globalAlpha = clamp((t - 0.4) * 3) * 0.6; x.strokeStyle = C; x.setLineDash([4, 8]); x.lineWidth = 2; x.beginPath(); P.forEach((q, k) => k ? x.lineTo(q.to[0], q.to[1]) : x.moveTo(q.to[0], q.to[1])); x.stroke(); x.setLineDash([]); }
      };
    } else if (key === "gemini") {                                      // 落笔成章：书页从四周翻飞聚拢 → 一道墨迹笔画横扫全屏 → 页面收成羽毛笔的光
      const pages = Array.from({ length: 26 }, (_, k) => { const a = Math.random() * 7, d = Math.max(W, H) * (0.55 + Math.random() * 0.3); return { x0: cx + Math.cos(a) * d, y0: cy + Math.sin(a) * d, r0: Math.random() * 6, sp: 2 + Math.random() * 3, dl: Math.random() * 0.25, tx: cx + (Math.random() - .5) * W * 0.5, ty: cy + (Math.random() - .5) * H * 0.4 }; });
      const pts = Array.from({ length: 60 }, (_, k) => { const u = k / 59; return [W * (0.06 + 0.88 * u), cy + Math.sin(u * Math.PI * 2.2) * H * 0.16 - (u - 0.5) * H * 0.1]; });
      
      draw = (t) => {
        for (const q of pages) { const e = ease((t - q.dl) / 0.6), X = q.x0 + (q.tx - q.x0) * e, Y = q.y0 + (q.ty - q.y0) * e; if (e <= 0) continue;
          x.save(); x.translate(X, Y); x.rotate(q.r0 + t * q.sp); x.globalAlpha = Math.min(1, e * 2) * (t > 0.85 ? clamp((1.05 - t) * 5) : 1);
          x.fillStyle = "#fff"; x.strokeStyle = C; x.lineWidth = 1.5; x.fillRect(-26, -34, 52, 68); x.strokeRect(-26, -34, 52, 68);
          x.globalAlpha *= 0.5; for (let k = 0; k < 5; k++) x.fillRect(-18, -22 + k * 10, k === 4 ? 20 : 36, 2); x.restore(); }
        const n = Math.floor(clamp((t - 0.25) / 0.45) * pts.length); if (n > 1) { x.globalAlpha = 0.9; x.strokeStyle = C; x.lineCap = "round";
          for (let k = 1; k < n; k++) { x.lineWidth = 4 + 14 * Math.sin(k / pts.length * Math.PI); x.beginPath(); x.moveTo(...pts[k - 1]); x.lineTo(...pts[k]); x.stroke(); }
          const [qx, qy] = pts[n - 1]; x.fillStyle = "#fff"; x.beginPath(); x.ellipse(qx + 18, qy - 30, 10, 38, 0.5, 0, 7); x.fill(); x.stroke(); }
      };
    } else if (key === "deepseek") {                                    // 开源洪流：满屏提交格一列列点亮 → 蓝色浪潮从下往上漫过全场
      const S = 26, cols = Math.ceil(W / S), rows = Math.ceil(H / S), lv = Array.from({ length: cols * rows }, () => Math.random());
      const blues = ["#e3eeff", "#cfe2ff", "#9cc3ff", "#6fa6f0", "#3C78D8"];
      
      draw = (t) => {
        const fr = ease(t / 0.55) * (cols + 8);
        for (let c = 0; c < cols; c++) { if (c > fr) break; for (let r = 0; r < rows; r++) { const v = lv[c * rows + r]; if (v < 0.55) continue; x.globalAlpha = clamp((fr - c) / 6) * 0.45; x.fillStyle = blues[Math.floor(v * 5)]; x.fillRect(c * S + 2, r * S + 2, S - 4, S - 4); } }
        if (t > 0.4) { const lvl = H * (1.05 - ease((t - 0.4) / 0.55) * 1.0); x.globalAlpha = 0.6; const gr = x.createLinearGradient(0, lvl - 60, 0, H); gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(0.15, "#9cc3ff"); gr.addColorStop(1, C);
          x.fillStyle = gr; x.beginPath(); x.moveTo(0, H); for (let X = 0; X <= W; X += 20) x.lineTo(X, lvl + Math.sin(X / 90 + t * 9) * 26 + Math.sin(X / 37 - t * 6) * 10); x.lineTo(W, H); x.closePath(); x.fill();
          x.globalAlpha = 0.9; x.fillStyle = "#fff"; for (let k = 0; k < 14; k++) { const X = (k * 97 + t * 400) % W, Y = lvl + 30 + (k * 53) % (H * 0.5); x.beginPath(); x.arc(X, Y, 3 + k % 4, 0, 7); x.fill(); } }
      };
    } else {                                                             // 一镜到底：场记板一拍 → 上下两条胶片横向划过 → 时间轴拖到头 → 定格白闪
      const FH = 120;
      
      const strip = (Y, off, dir) => { x.fillStyle = "#222"; x.fillRect(0, Y, W, FH); const fw = 150;
        for (let X = ((off * dir) % fw) - fw; X < W + fw; X += fw) { x.fillStyle = "#fff"; for (let k = 0; k < 6; k++) { x.fillRect(X + 8 + k * 24, Y + 8, 12, 10); x.fillRect(X + 8 + k * 24, Y + FH - 18, 12, 10); }
          const gr = x.createLinearGradient(X, Y, X + fw, Y + FH); gr.addColorStop(0, C); gr.addColorStop(1, "#fff"); x.fillStyle = gr; x.fillRect(X + 10, Y + 24, fw - 20, FH - 48); } };
      draw = (t) => {
        const e = ease((t - 0.25) / 0.6); if (e > 0) { x.globalAlpha = Math.min(1, e * 2); strip(H * 0.1, e * W * 1.2, 1); strip(H * 0.9 - FH, e * W * 1.2, -1); }
        if (t < 0.55) { x.globalAlpha = t > 0.42 ? clamp((0.55 - t) * 8) : 1; const s = 1.2, ang = t < 0.25 ? -0.55 * (1 - t / 0.25 * 0.15) : 0;
          x.save(); x.translate(cx, cy); x.scale(s, s); x.fillStyle = "#222"; x.fillRect(-150, -60, 300, 170); x.fillStyle = "#fff"; font(30, 700, "Consolas,monospace"); x.textAlign = "center"; x.fillText("SCENE 1   TAKE 1", 0, 20); x.fillText("ONE TAKE", 0, 70);
          x.save(); x.translate(-150, -60); x.rotate(ang); for (let k = 0; k < 6; k++) { x.fillStyle = k % 2 ? "#fff" : "#222"; x.fillRect(k * 50, -36, 50, 36); } x.strokeStyle = "#222"; x.lineWidth = 3; x.strokeRect(0, -36, 300, 36); x.restore(); x.restore(); }
        if (t > 0.3) { const bx = W * 0.15, bw = W * 0.7, by = H * 0.9 - FH - 34; x.globalAlpha = 0.95; x.fillStyle = "rgba(255,255,255,.85)"; x.fillRect(bx, by, bw, 8); x.fillStyle = C; const ph = ease((t - 0.3) / 0.5); x.fillRect(bx, by, bw * ph, 8);
          x.beginPath(); x.arc(bx + bw * ph, by + 4, 12, 0, 7); x.fill(); }
      };
    }
    let live = true; const t0 = performance.now();
    const tick = (now) => { if (!live) return; const t = Math.max(0, (now - t0) / 1000); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.globalAlpha = 1; if (xb) { xb.setTransform(1, 0, 0, 1, 0, 0); xb.clearRect(0, 0, W, H); xb.globalAlpha = 1; }
      draw(t); x.globalAlpha = 1; x.flush(); if (t < DUR) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    // 后层（Fable 的神环）不移除：开场结束后每秒画约 20 次（环上流光），直到演出收尾（.s5）、被跳过（.out）或罩子被拿掉
    const holdLoop = () => { if (!hold || !bc || !bc.isConnected || box.classList.contains("s5") || box.classList.contains("out")) return; hold((performance.now() - t0) / 1000); setTimeout(() => requestAnimationFrame(holdLoop), 40); };
    at(DUR * 1000 - 200, () => box.classList.add("ug-out")); at(DUR * 1000 + 150, () => { live = false; cv.remove(); holdLoop(); });
  }
  // v50 预热：大招里的技能名大字 / HUD 文字 / canvas 字形第一次排版要现场整形（慢手机上卡一下），开局后隐藏地先排一遍
  function warmUlt(game) {
    if (game !== g || !$("#fx")) return;
    const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 4000 }) : (f) => setTimeout(f, 200);
    const host = el("div"); host.style.cssText = "position:absolute;left:0;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict"; $("#fx").appendChild(host);
    // v49 和真大招一模一样的结构（技能名逐字拆成 span、HUD 带位置类）：字形缓存按字体、字号、分段记，结构不一样等于没预热
    const hz = game.players.filter((p) => p.ch.harness), steps = [];
    for (const p of hz) for (const nm of p.key === "xds" ? ["DSH", "Claude Code"] : [p.ch.harness.name]) steps.push(() => {
      host.innerHTML = `<div class="ult" style="--c:${p.ch.color}"><div class="ult-name"><div class="un-big">${[...nm].map((c) => `<span>${c === " " ? "&nbsp;" : c}</span>`).join("")}</div><div class="un-sub">HARNESS ONLINE</div></div></div>`; void host.offsetHeight; });
    if (hz.some((p) => !godSkin(p))) steps.push(() => {                 // 默认的 B 式开场：四块 HUD
      host.innerHTML = `<div class="ult"><div class="ub-hud ub-top"><b>HARNESS BOOT</b><span>${hz.map((p) => p.ch.harness.name).join(" ")}</span><i></i></div><div class="ub-hud ub-left">${["load model", "mount tools", "link skills", "sync memory"].map((t) => `<p><em>✓</em> ${t}</p>`).join("")}</div>`
        + `<div class="ub-hud ub-right"><span>DEPLOY</span><div class="ub-bar"><i></i></div><span class="ub-pct">100%</span></div><div class="ub-hud ub-bot">0123456789abcdef · 0123456789abcdef</div></div>`; void host.offsetHeight; });
    // canvas 字形：只排这局真会画到的字（慢在给缺字找系统回退字体；'Cambria Math' 只有 GPT 神皮用），每种字体单独一步
    const F = {}, add = (f, t) => { F[f] = (F[f] || "") + t; };
    for (const p of hz) { if (!Sound.prime) continue; const gid = godId(p);   // v54 每个人的主题乐句（逐拍对画面）先下载好，第一次上线不晚半拍；神皮还有局内彩蛋音
      steps.push(() => [thName(p)].concat(gid ? GOD_SFX[p.key + "_" + gid] || [] : []).forEach((n) => Sound.prime(n))); }
    if (hz.some((p) => p.key === "kimi" && godId(p) === "g1")) steps.push(() => { const sp = moonSprites(); for (let k = 0; k < 8; k++) sp.phase(k); for (const im of sp.inst) if (im.decode) im.decode().then(() => { const c = document.createElement("canvas"); c.width = c.height = 2; c.getContext("2d").drawImage(im, 0, 0, 2, 2); }).catch(() => {}); });   // v53 月相贴纸先画好、乐器插画下完就解码
    if (hz.some((p) => godId(p) === "g2")) steps.push(() => wishSprites(), () => { const sp = wishSprites(); if (!sp.url) sp.url = { shoot: sp.shoot.toDataURL(), badge: sp.stars[0].toDataURL() }; for (const im of [sp.book, sp.book0, sp.wand]) if (im.decode) im.decode().then(() => { const c = document.createElement("canvas"); c.width = c.height = 2; c.getContext("2d").drawImage(im, 0, 0, 2, 2); }).catch(() => {}); });   // 道具插画：下完就解码、先画一次（不然第一次上线时现解码会卡一下）   // v51 许愿之神的贴纸开局空闲时先画好、转好（演出第一帧、第一次许愿都不现场画）
    for (const p of hz) for (const k of p.key === "xds" ? ["xds", "xds_cl"] : [p.key]) {
      const gid = k !== "xds_cl" ? godId(p) : "", god = !!gid, U = ULT[gid && ULT[k + "_" + gid] ? k + "_" + gid : k] || ULT.claude;
      if (!god && k !== "xds_cl") add("700 34px Consolas, monospace", (GLY[k] || "✦") + "1");   // B 式符号雨
      const gt = { inf: "∞", code: "</>", note: "♪", check: "✓" }[U.glyph]; if (gt) add("700 22px Consolas, monospace", gt);   // 纹章上的字
      if (U.glyph === "coin") add("700 14px sans-serif", "$");
      const pt = { code: "{ }</>( )=>;", note: "♪♫♬", check: "✓", sym: "∫Σπ∞√∇" }[U.part]; if (pt) add("700 20px Consolas, monospace", pt);   // 粒子
      if (gid === "g1" && k === "gpt") { add("700 44px 'Cambria Math','Times New Roman',serif", "∫Σπ∞√∇ e+1=0 dx=√π 1/n²=π²/6 n=1"); add("700 26px 'Cambria Math','Times New Roman',serif", "iπ−x²∞−∞"); }
    }
    const cv = document.createElement("canvas"); cv.width = cv.height = 64; const cx2 = cv.getContext("2d");
    for (const f in F) steps.push(() => { cx2.font = f; cx2.fillText(F[f], 0, 30); });
    steps.push(() => host.remove());
    const run = () => { if (game !== g) { host.remove(); return; } const f = steps.shift(); if (f) { f(); if (steps.length) idle(run); } };
    idle(run);
  }
  function deployShow(p, cmd, name) {
    if (!(Engine.speed > 0)) return Promise.resolve(false);
    if (deployCur && deployEnd) return deployEnd.then(() => deployShow(p, cmd, name));   // v56 上一场还没收尾（电脑上线提前放行时会出现）：等它演完再开这一场（v49 原来是把上一场提前收掉）——同一时间只留一场，不然两场会互相拆掉压 BGM、灰座位这些状态
    const key = hzKey(p), sp = 1, hero = heroes[p.i];   // 大招固定 3 秒，不跟加速   // 玩家自己的大招固定时长，不跟加速
    const tc = key === "xds_cl" ? window.GAME_DATA.chars.claude : p.ch;   // 小DeepSeek 套壳时用 Claude 的橙色
    const box = el("div", "ult"); box.style.setProperty("--c", tc.color); box.style.setProperty("--l", tc.light || "#fff");
    $("#fx").appendChild(box); document.body.classList.add("ult-on");   // 演出时把盖在上面的提示条（演算等）藏起来
    const timers = [], t0 = performance.now(); const at = (ms, f) => timers.push(setTimeout(f, ms * sp));
    const seatOn = () => { if (hero) { hero.classList.add("hz-on", "halo"); setTimeout(() => hero.classList.remove("halo"), 2400 * sp); } };
    if (false) {                                                      // （电脑简版已停用：电脑上线也放完整版）
      Sound.sfx("ult_shimmer", 0.55); ultSlash(box, p, key);
      at(500, () => { ultName(box, name, true); Sound.sfx("harness_sting", 0.5); });
      return new Promise((res) => at(1500, () => { seatOn(); document.body.classList.remove("ult-on"); box.classList.add("out"); setTimeout(() => box.remove(), 300); res(false); }));
    }
    const fx = $("#fx").getBoundingClientRect(), hc = center(p), cx = SW / 2, cy = SH * (ultNarrow() ? 0.40 : 0.46);   // v51 粒子画布用的是舞台坐标（SW×SH），中心也按舞台算：原来按屏幕尺寸算，手机上（舞台缩小）爆开跑到左上角
    const fb = `onerror="this.onerror=null;this.src='${portrait(p.key, "pose")}'"`;   // v49 上线立绘没下载到（或还没画）就用全身立绘兜底，不让大招出现空白
    box.innerHTML = `<div class="ult-veil"></div><canvas class="ult-pt"></canvas><div class="ult-stage"><div class="ult-rays"></div><div class="ult-emb"></div><div class="ult-ring"></div><div class="ult-ring r2"></div><img class="ult-ghost" src="${hzImg(p, "b")}" alt="" ${fb}>
      <img class="ult-a" src="${hzImg(p, "a")}" alt="" ${fb}><img class="ult-b" src="${hzImg(p, "b")}" alt="" ${fb}>${HZ_BLINK.includes(key) && !godSkin(p) ?`<img class="ult-bl" src="${hzImg(p, "b_blink")}" alt="">` : ""}</div>
      <div class="ult-flash"></div><div class="ult-edge"></div>`;   // v56 去掉「点一下跳过」
    const gid = godId(p), ek = gid && ULT[key + "_" + gid] ? key + "_" + gid : key;   // 神级皮肤有自己的纹章 / 粒子就换上
    try { box.querySelector(".ult-emb").appendChild(emblem(ek, tc.color, 640)); } catch (e) { console.error(e); }   // v51 装饰出错不能卡住对局：纹章 / 粒子画不出来就不画（原来抛错时罩子留在屏幕上，整局点不动）
    let pt; try { pt = particles(box.querySelector(".ult-pt"), ek, tc.color); } catch (e) { console.error(e); pt = { gather() {}, burst() {}, home() {}, drift() {}, stop() {} }; }
    const others = heroes.filter((h, k) => h && k !== p.i);
    // v51 演出完整播完、上线台词说完整：原来固定 3 秒就收，台词（2.7–5.9 秒）才说到一半，对局接着走、她的下一句话还会把它打断。
    //   现在技能名砸下之后发动帧留在屏幕上（镜头慢推、身边飘粒子、再眨一次眼），等台词说完 0.3 秒才收尾；玩家和电脑一样。关了配音就照旧 3 秒。v56 不能跳过
    const lk = key === "xds_cl" && p.ch.lines.wish ? "wish" : gid && (p.ch.lines["deploy_" + gid] || []).length ? "deploy_" + gid : "deploy";
    const voiceOn = !!(Sound.S && Sound.S.sfx && Sound.S.voiceVol > 0), LINE_AT = 1820, outAt = (ms) => Math.min(9000, Math.max(2600, LINE_AT + ms + 300));   // 收尾开始的时刻（毫秒，从演出开始算）
    let endRes; deployEnd = new Promise((r) => { endRes = r; });
    return new Promise((res) => {
      let over = false, tailed = false, said = false;
      // v49 收尾只执行一次、结束时补一次：原来收尾嵌在 2.6 秒的定时器里，早点跳过（或慢机上 3 秒的结束定时器先到）就丢了「部署成功」和换曲
      //   电脑上线不切 Harness 曲，只放一声短乐句（玩家自己上线才换曲）；!g：已经退回首页就别再切曲
      const th = thName(p);                                              // v54 角色主题乐句：开场第一帧播起，引子 → 白闪落点 → 垫在台词下面的余韵，收束和弦落在 Harness 曲进来之前
      const tail = (ms) => { if (tailed || !g) return; tailed = true; if (Sound.sfxFade) Sound.sfxFade(th, ms > 0 ? ms : 1800); Sound.sfx("deploy_ok", 0.8); seatOn(); if (p.human) Sound.track("harness_" + p.key + (window.Settings && Settings.skinOf(p.key) ? "_" + Settings.skinOf(p.key) : ""), "soft"); else Sound.sfx("harness_sting", 0.5); };   // 乐句的尾音和 Harness 曲的淡入叠着过渡；被跳过时（ms = 300）很快收掉
      const line = () => { if (said || !g) return 0; said = true; let ms = 0; if (p.ch.lines[lk]) { ms = +say(p, lk, true) || 0; if (ms) lastSay.t = Math.max(lastSay.t || 0, performance.now() + ms - 900); } return voiceOn ? ms : 0; };   // 返回这句配音多长（没开配音返回 0）   // v51 神皮上线必说自己的专属台词（原来走 skinKey 只有六成概率）   // v49 上线台词也只说一次、跳过时补上（原来 1.8 秒前跳过就不说了；小DS 套壳的大招跳过后 套壳 就一句话都没有）   // 小DeepSeek 套壳上线说「我、我就是 Claude 呀……」   // 说完之前别人的闲话先不插嘴
      const done = () => {
        if (over) return; over = true; timers.forEach(clearTimeout); pt.stop();
        if (deploySkip === done) deploySkip = null; if (deployCur === done) deployCur = null;
        line(); if (!tailed && Sound.sfxFade) Sound.sfxFade(th, 300); tail(300); hzPre[p.i] = 1;                                         // 预载的立绘用完了，放掉（每张解码后约 4 MB）
        others.forEach((h) => h.classList.remove("ult-grey")); seatOn(); Sound.hold(false); document.body.classList.remove("ult-on");
        box.classList.add("out"); box.style.pointerEvents = "none"; setTimeout(() => box.remove(), 350); res(true); endRes();
      };
      deploySkip = deployCur = done; box.onclick = (e) => { e.stopPropagation(); };   // v56 点了不跳（只挡住，免得点到底下的牌）
      // ① 时停 0.3 s
      Sound.hold(true); Sound.sfx("ult_charge", 0.7); others.forEach((h) => h.classList.add("ult-grey"));
      pt.gather(hc.x, hc.y, 45);
      // ② 斜切 0.6 s
      at(300, () => { box.classList.add("s2"); Sound.sfx(th, 1); ultIntro(box, p, key, tc, name, (ms, f) => at(ms + 0, f), hc, fx); });
      // ③ 爆发 1.2 s：起手帧推入 + 纹章转 → 0.5 s 后切发动帧 + 白闪 + 冲击环 + 粒子 + 台词
      at(900, () => box.classList.add("s3"));
      at(1400, () => {
        box.classList.add("hit"); Sound.sfx("ult_impact", 0.4);                                          // v54 落点的和弦在主题乐句里，这一下只当底鼓（原来这里还有一段角色专属音）   // 专属音色错开冲击声 0.16 s、放大，听得出是谁（v51 神皮有自己的冲击音就用它）
        pt.burst(cx, cy, 80);
        const blink = () => { box.classList.add("blink"); at(130, () => box.classList.remove("blink")); };
        at(420, () => {   // 小DeepSeek 套壳上线：说「我、我就是 Claude 呀……」   // 台词等专属音色响完再进
          const out = outAt(line()) - LINE_AT;                            // v51 这句配音说完 0.3 秒才收尾（最少还是原来的 2.6 秒）
          at(out, outro);
          if (out > 780 + 400) {                                          // 比原来长：发动帧留着的这段——镜头慢推、身边飘粒子、中途再眨一次眼
            at(680, () => { box.style.setProperty("--hold", ((out - 680) / 1000).toFixed(2) + "s"); box.classList.add("hold"); });
            const amb = () => { if (over || box.classList.contains("s5")) return; pt.drift(cx, cy, 5); at(500, amb); }; at(580, amb);
            if (out > 2700) at(Math.min(out - 700, 2400), blink);
          }
        });
        at(700, blink);
      });
      // ④ 技能名砸下 0.5 s
      at(2100, () => { box.classList.add("s4"); ultName(box, name, true); });
      // ⑤ 收尾 0.4 s：光点飞回座位，徽章 + 流光环，Harness 曲强拍直接进。v51 什么时候开始由台词长短定（见上面 outAt），不再固定 2.6 秒
      let waited = false;
      const outro = () => {
        if (over) return;
        if (!waited && voiceOn && Sound.left && (p.ch.lines[lk] || []).length === 1) { waited = true; const more = Math.min(Sound.left(p.key, `${p.key}_${lk}0`) + 300, 9000 - (performance.now() - t0)); if (more > 380) { at(more, outro); return; } }   // 配音晚起播（线上慢网 / iPad）：到点上线台词还没说完就再等它一次，仍不超过 9 秒（她已经在说别的话就不等）
        box.classList.add("s5"); pt.home(cx, cy, hc.x, hc.y, 40);
        at(380, tail); at(400, done);
        if (!p.human) { if (deploySkip === done) deploySkip = null; box.classList.add("rel"); box.style.pointerEvents = "none"; res(true); }   // v49 电脑上线：演到收尾就放行对局（收尾这 0.4 秒照常播完，罩子不再吃点击和 Esc）
      };
      at(9800, done);                                                     // 保险：无论如何 9.8 秒内收掉
    });
  }
  function skillNote(p, name, short) { Sound.sfx("chime", 0.5); skillPop(p, name, short); sync(); }
  function skillPop(p, name, short) {                                  // v51 short：这一次的说明另给（例如 Antigravity 上线后【搜索】看 5 张，不是技能表里写的 3 张）
    const s = p.ch.skills.find((x) => x.name === name), sh = short || (s && s.short) || (p.ch.harness && p.ch.harness.name.split(" / ").includes(name) ? p.ch.harness.short : "");   // Harness 不在技能表里：退回 harness.short（原来【Codex】这类字条只有名字）；小DeepSeek 是「DSH / Claude Code」
    const c = center(p), e = el("div", "skpop", `<b>【${name}】</b>${sh ? `<span>${sh}</span>` : ""}`);
    e.style.setProperty("--c", p.ch.color);
    e.style.left = c.x + "px"; e.style.top = c.y - 70 + "px";
    $("#fx").appendChild(e); setTimeout(() => e.remove(), 2000 * Math.max(0.6, Engine.speed));
  }
  // v33 突发事件：从上方滑下来一张"突发新闻"卡片，停 2 秒多
  function news(title, sub, tone, key) {
    const b = el("div", "news " + (tone || "mix") + (title.length > 9 ? " long" : "") + (key ? " who" : ""));   // v35 角色梗事件：卡片左上角带主角头像
    b.innerHTML = `<div class="nw-tag">突发</div>${key ? `<img class="nw-av" src="${portrait(key, "avatar")}" alt="">` : ""}<div class="nw-t">${title}</div><div class="nw-s">${sub}</div>`;
    b.style.animationDuration = 2.4 * Engine.speed + "s";             // 观战加速时一起变快
    $("#fx").appendChild(b); setTimeout(() => b.remove(), 2400 * Engine.speed + 100);
  }
  function rage(on) { const b = document.getElementById("bg"); if (b) b.classList.toggle("rage", !!on); }   // v42 吵上头：背景转暖
  function banner(text) { const b = el("div", "banner", text); $("#fx").appendChild(b); setTimeout(() => b.remove(), 950); }

  // ---------------------------------------------------------------- 玩家：出牌阶段
  function humanPlay(p) {
    mode = "play"; selected = null; skillMode = null;
    const how = SET().click === 1 ? "点牌直接出；要选目标的，再点对手或拖到她身上。" : "点一张牌看效果，再点一次出牌（也可以直接拖出去）。";
    const sk = g.activeSkills(p).filter((s) => s.can).map((s) => `【${s.name}】`);
    hint((p.dumb ? "你降智了，不能【吐槽】。" : "轮到你了！") + how + (sk.length ? `<br>✨ 能用技能：${sk.join("")}` : SET().keys ? '<small class="kb"><br>数字键选牌 · 空格结束回合</small>' : ""));   // 有技能能用时这一行换成技能（按钮上本来就标了 Q/W/E）
    Sound.sfx("chime", 0.5);
    sync();
    checkAutoEnd(1600);
    armNudge();
    return new Promise((res) => { playResolve = res; });
  }
  function endPlay() {
    if (!playResolve) return;
    const r = playResolve; playResolve = null; mode = null; selected = null; skillMode = null; clearTimeout(autoT); clearTimeout(nudgeT);
    clearTargets(); hint(""); sync(); r();
  }
  let nudgeT = null;
  function armNudge() {
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => {
      if (!g || mode !== "play" || busy || drag) return;
      const os = g.alive().filter((q) => !q.human);
      if (!os.length) return;
      const q = os[Math.floor(Math.random() * os.length)];
      sys(`${q.name} 拍了拍你`); Sound.sfx("notify", 0.6); toast(`${q.name} 拍了拍你`, 1800);
      heroes[q.i] && heroes[q.i].animate([{ transform: "translateY(0)" }, { transform: "translateY(-10px)" }, { transform: "translateY(0)" }], { duration: 400 });
    }, 16000);
  }
  function checkAutoEnd(ms) {
    clearTimeout(autoT);
    if (!SET().autoEnd || mode !== "play" || busy || anyMove()) return;
    hint("没有能出的牌和能用的技能了，马上自动结束回合……");
    autoT = setTimeout(() => { if (g && mode === "play" && !busy && !drag && !anyMove()) endPlay(); }, ms);
  }
  // 目标：发光 + 头上标数字（按从左到右），数字键可以直接选
  function clearTargets() { targetList = []; heroes.forEach((h) => { h.classList.remove("target", "drop"); h.querySelector(".tnum").textContent = ""; }); }
  function showTargets(list) {
    clearTargets();
    targetList = list.slice().sort((a, b) => pos(a).x - pos(b).x);
    targetList.forEach((q, k) => { heroes[q.i].classList.add("target"); heroes[q.i].querySelector(".tnum").textContent = SET().keys && list.length > 1 ? k + 1 : ""; });
  }

  async function act(fn) {
    const tok = ++actTok;
    busy = true; clearTargets(); hint("结算中……"); sync();
    clearTimeout(nudgeT);
    try { await fn(); } finally { if (tok === actTok) busy = false; }
    if (tok !== actTok) return;                               // 结算途中退出了这一局
    if (playResolve) armNudge();
    selected = null; skillMode = null;
    if (!g || g.over || !g.human.alive || g.human.skipRest) { endPlay(); return; }
    hint("继续出牌、用技能，或点【结束回合】。");
    sync();
    checkAutoEnd(1100);
  }

  function onCardClick(id) {
    const me = g.human;
    const c = me.hand.find((x) => x.id === id);
    if (!c) return;
    Sound.sfx("click", 0.5);
    if (mode === "respond") { if (respondCards.includes(id)) finishRespond({ card: c }); return; }
    if (mode === "discard") { toggle(discardPick, id); updateDiscard(); sync(); return; }
    if (mode !== "play" || busy) return;
    if (skillMode) { skillMode = null; clearTargets(); }
    if (!g.canUse(me, c)) { toast(whyNot(me, c)); return; }
    const d = CD[c.k];
    if (SET().click === 1 && selected !== id && !swapOld(c)) {
      if (d.target !== "one") { selected = id; act(() => g.useCard(me, c, [])); return; }
      const ts = g.targetsFor(me, c);
      if (ts.length === 1) { selected = id; act(() => g.useCard(me, c, [ts[0]])); return; }
    }
    if (selected === id) {
      if (d.target === "one") {
        const ts = g.targetsFor(me, c);
        if (ts.length === 1) act(() => g.useCard(me, c, [ts[0]]));
        else toast("点一位对手作为目标");
      } else act(() => g.useCard(me, c, []));
      return;
    }
    selected = id;
    // 牌的说明在牌上方的浮窗里，这里只说下一步
    if (d.target === "one") { showTargets(g.targetsFor(me, c)); hint(`选中【${d.name}】<br>👉 点一位对手（或把牌拖过去）`); }
    else { clearTargets(); hint(`选中【${d.name}】<br>👉 再点一次${SET().keys ? " / 按 Enter" : ""}出牌`); }
    sync();
  }
  // 出选中的那张（浮窗按钮 / Enter）
  function playSelected() {
    if (!g || mode !== "play" || busy || selected == null) return;
    const me = g.human, c = me.hand.find((x) => x.id === selected);
    if (!c || !g.canUse(me, c)) return;
    if (CD[c.k].target === "one") {
      const ts = g.targetsFor(me, c);
      if (ts.length === 1) act(() => g.useCard(me, c, [ts[0]])); else toast("点一位对手作为目标");
      return;
    }
    Sound.sfx("click", 0.5);
    act(() => g.useCard(me, c, []));
  }
  function cancelSel() {
    if (selected == null && !skillMode) return;
    selected = null; skillMode = null; clearTargets();
    if (g && mode === "play" && !busy) hint("已取消。继续出牌、用技能，或点【结束回合】。");
    if (g) sync();
  }
  function onCardDbl(id) {
    const me = g.human; const c = me.hand.find((x) => x.id === id);
    if (!c || mode !== "play" || busy || skillMode) return;
    if (!g.canUse(me, c)) return;
    if (swapOld(c) && selected !== id) { onCardClick(id); return; }   // 会换下装备的：双击先选中看提醒
    if (CD[c.k].target !== "one") { selected = id; act(() => g.useCard(me, c, [])); }
  }
  function whyNot(me, c) {
    if (c.k === "fanbo") return "【反驳】要在被吐槽时才能打出";
    if (c.k === "yidu") return "【已读不回】要在锦囊对你生效时才能打出";
    if (c.k === "tucao") return me.dumb ? "降智中，这回合不能吐槽" : "这回合已经吐槽过了";
    if (c.k === "naicha") return "心态是满的，先留着奶茶吧";
    if (c.k === "baipiao" || c.k === "chehui") return "对手都没有牌";
    if (c.k === "shuaiguo") return "【甩锅】要在被吐槽时才能打出";
    if (c.k === "jiaban") return "已经在深度思考了";
    if (c.k === "dangji") return "场上已经有一张【宕机】了";
    return "现在不能用";
  }
  function onSkillBtn(s) {
    const me = g.human;
    if (mode !== "play" || busy || !g.canSkill(me, s.id)) return;
    Sound.sfx("click", 0.5);
    selected = null;
    if (skillMode === s.id) { skillMode = null; clearTargets(); hint("已取消"); sync(); return; }
    if (s.target) {
      const ts = g.skillTargets(me, s.id);
      if (ts.length === 1 && s.id === "copy") { act(() => g.doSkill(me, s.id, { target: ts[0] })); return; }
      skillMode = s.id; showTargets(ts); hint(`【${s.name}】👉 ${s.id === "bundle" ? "点一位角色，送她一张牌" : s.id === "qingke" ? "点一位角色（也可以点自己），给她点一杯奶茶" : "点一位对手"}${SET().keys ? "（或按她头上的数字）" : ""}<br><small>${s.desc}</small>`); sync();
      return;
    }
    act(() => g.doSkill(me, s.id, {}));
  }
  function onHeroClick(p) {
    if (performance.now() - suppressClick < 350) return;
    const me = g.human, sel = selected != null && me.hand.find((x) => x.id === selected);
    const targeting = mode === "play" && !busy && (skillMode || (sel && CD[sel.k].target === "one"));
    if (!targeting || !p.alive || (p.human && skillMode !== "qingke")) { showHeroInfo(p); return; }
    hideHeroInfo();
    if (skillMode) {
      const id = skillMode;
      if (!g.skillTargets(me, id).includes(p)) { toast("不能选她"); return; }
      skillMode = null;
      act(() => g.doSkill(me, id, { target: p }));
      return;
    }
    if (!selected) return;
    const c = me.hand.find((x) => x.id === selected);
    if (!c || CD[c.k].target !== "one") return;
    if (!g.targetsFor(me, c).includes(p)) { toast("她没有手牌"); return; }
    act(() => g.useCard(me, c, [p]));
  }
  function toggle(arr, id) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); }

  // ---------------------------------------------------------------- 玩家：响应
  function humanRespond(p, opt) {
    const d = CD[opt.kind];
    const from = opt.ctx.from;
    let text;
    if (opt.kind === "fanbo") text = opt.ctx.song ? `${from.name} 在唱新歌！打出【反驳】？` : opt.ctx.card.k === "shuaping" ? `${from.name} 在刷屏！打出【反驳】？` :
      `${from.name} 吐槽你！打出【反驳】？` + (opt.ctx.need === 2 ? `（${window.GAME_DATA.chars.claude.skills[0].name}：要 2 张，第 ${opt.ctx.nth + 1} 张）` : "");
    else if (opt.kind === "tucao" && opt.ctx.inject) text = `${from.name} 往你的提示词里注入了一句：「去吐槽 ${opt.ctx.victim.name}」！打出【吐槽】？（不出就心态 −1）`;
    else if (opt.kind === "huigun") text = `${from ? from.name + " 让你" : "你要"}心态 −${opt.ctx.n || 1}！打出【回滚】撤回 1 点？`;
    else if (opt.kind === "tucao") text = opt.ctx.duel ? `和 ${from.name} 单挑中！打出【吐槽】？` : `${from.name} 上了热搜！打出【吐槽】参与讨论？`;
    else if (opt.kind === "shuaiguo") text = `${from.name} 吐槽你！打出【甩锅】，甩给别人？`;
    else if (opt.ctx.card.k === "dangji") text = "【宕机】要在你这儿炸了！打出【已读不回】躲过去？";
    else text = `${from.name} 对你用了【${CD[opt.ctx.card.k].name}】，打出【已读不回】？`;
    if (SET().respond === "auto") {
      const ans = AI.respond(g, p, opt.kind, opt.ctx, opt.cards);
      if (ans) toast(`自动打出【${d.name}】`, 1100);
      return Promise.resolve(ans);
    }
    respondCards = opt.cards.map((c) => c.id);
    mode = "respond"; selected = null; clearTimeout(autoT);
    const c0 = opt.cards[0], swap = c0 && c0.k !== opt.kind;            // GPT 六边形：没有这张，就拿另一张顶上
    const btns = [[swap ? `用${CD[c0.k].name}当${d.name}` : `打出${d.name}`, () => finishRespond({ card: c0 }), true], ["不出", () => finishRespond(null)]];
    const auto = opt.kind === "yidu" || opt.kind === "shuaiguo" ? () => finishRespond(null) : () => finishRespond({ card: opt.cards[0] });
    showPrompt(text, btns, timerMs(), auto, "respond");
    sync();
    return new Promise((res) => { respondResolve = res; });
  }
  function finishRespond(ans) {
    if (!respondResolve) return;
    const r = respondResolve; respondResolve = null; hidePrompt();
    mode = playResolve ? "play" : null; respondCards = []; sync(); r(ans);
  }
  // ms = 0：不限时
  function showPrompt(text, btns, ms, onTimeout, kind) {
    promptKind = kind || null;
    $("#prompt").classList.remove("hidden");
    $("#prompt-text").textContent = text;
    const bx = $("#prompt-btns"); bx.innerHTML = "";
    for (const [label, fn, primary] of btns) { const b = el("button", "btn small" + (primary ? " primary" : ""), label); b.onclick = (e) => { e.stopPropagation(); Sound.sfx("click", 0.5); fn(); }; bx.appendChild(b); }
    clearInterval(promptTimer);
    const t0 = performance.now(), tm = $("#prompt-timer");
    tm.classList.toggle("hidden", !ms);
    if (ms) promptTimer = setInterval(() => {
      const left = ms - (performance.now() - t0);
      tm.style.setProperty("--p", Math.max(0, left / ms * 100) + "%"); tm.textContent = Math.ceil(Math.max(0, left) / 1000);
      if (left <= 0) { clearInterval(promptTimer); onTimeout && onTimeout(); }
    }, 100);
    Sound.sfx("notify", 0.5);
  }
  function hidePrompt() { clearInterval(promptTimer); promptKind = null; $("#prompt").classList.add("hidden"); if (g) renderTip(); }

  // 是 / 否：技能要不要发动（嘴硬、长篇大论），6 秒不选就按默认
  function humanConfirm(text, def = true) {
    return new Promise((res) => {
      const done = (v) => { hidePrompt(); sync(); res(v); };
      if (SET().respond === "auto") { done(def); return; }
      showPrompt(text, [["发动", () => done(true), true], ["不了", () => done(false)]], timerMs(), () => done(def), "confirm");
    });
  }

  // 选一个人（甩锅给谁）：提示条上一人一个按钮，超时选第一个
  function humanChoose(list, text) {
    return new Promise((res) => {
      const done = (q) => { hidePrompt(); sync(); res(q); };
      showPrompt(text, list.map((q, k) => [q.name, () => done(q), k === 0]), timerMs(), () => done(list[0]), "choose");
    });
  }

  // 摸到宕机：只有【重启】就直接拆；还有【甩锅】时问一下
  function humanBomb(hasR, hasS) {
    return new Promise((res) => {
      const done = (v) => { hidePrompt(); sync(); res(v); };
      if (hasR && !hasS) { done("reboot"); return; }
      if (SET().respond === "auto") { done(hasR ? "reboot" : "shuaiguo"); return; }
      const btns = [];
      if (hasR) btns.push(["【重启】拆掉", () => done("reboot"), true]);
      if (hasS) btns.push(["【甩锅】甩给别人", () => done("shuaiguo"), !hasR]);
      if (!hasR) btns.push(["硬吃", () => done(null)]);
      showPrompt("💣 你摸到了【宕机】！", btns, timerMs(), () => done(hasR ? "reboot" : "shuaiguo"), "pick");
    });
  }
  // 拆掉宕机之后：偷偷塞回牌堆哪里（只有你知道）
  function humanPlace(n) {
    return new Promise((res) => {
      const done = (v) => { hidePrompt(); sync(); res(v); };
      if (SET().respond === "auto") { done(AI.placeBomb(g, g.human)); return; }
      const rand = () => Math.floor(Math.random() * (n + 1));
      const opts = [["最上面", 0], ["第 2 张", 1], ["第 3 张", 2], ["随机", -1], ["最底下", n]].filter(([, v], i, a) => v <= n && a.findIndex(([, w]) => w === v) === i);
      const pick = (v) => done(v < 0 ? rand() : v);
      showPrompt("宕机塞回哪？只有你知道（这回合你自己不会再摸到它）", opts.map(([l, v], k) => [l, () => pick(v), k === 0]),
        timerMs() ? Math.max(8000, timerMs()) : 0, () => pick(-1), "pick");
    });
  }
  // 剧透 / 搜索：看牌堆顶（只看不挑）
  function peekRow(cards, label) {
    const row = el("div", "pickrow peekrow");
    const wraps = cards.map((c, i) => {
      const w = el("div", "pk" + (c.k === "dangji" ? " boom" : ""));
      const tag = el("div", "pkn", label(i));
      w.appendChild(tag); w.appendChild(cardEl(c, true)); row.appendChild(w);
      return { w, tag, c };
    });
    return { row, wraps };
  }
  function openModal(body) { $("#modal-close").style.display = "none"; $("#modal").classList.remove("hidden"); }
  function closeModal() { $("#modal").classList.add("hidden"); $("#modal-close").style.display = ""; }
  const DPOS = (i) => (i === 0 ? "最上面" : `第 ${i + 1} 张`);
  function peek(cards, title, label) {                 // label：每张牌上方的小标（默认按牌堆位置；安全审计看手牌时传空）
    return new Promise((res) => {
      if (!cards.length) { res(); return; }
      const body = $("#modal-body"); body.innerHTML = `<h2>${title}</h2>`;
      body.appendChild(peekRow(cards, label || DPOS).row);
      if (cards.some((c) => c.k === "dangji")) body.appendChild(el("p", "pknote", "💣 里面有【宕机】！记住它的位置——牌桌上会一直提示你。"));
      const go = el("div", "pkgo"), ok = el("button", "btn primary", "知道了");
      ok.onclick = () => { closeModal(); sync(); res(); };
      for (const w of body.querySelectorAll(".pk")) w.onclick = ok.onclick;          // 点牌也算看完了
      go.appendChild(ok); body.appendChild(go);
      openModal();
    });
  }
  // 插队：按顺序点牌，先点的放最上面
  function humanArrange(cards, title) {
    return new Promise((res) => {
      if (cards.length < 2) { res(cards.slice()); return; }
      const body = $("#modal-body"); body.innerHTML = `<h2>${title}</h2>`;
      const { row, wraps } = peekRow(cards, (i) => `原来${DPOS(i)}`);
      let order = [];
      const finish = (o) => { closeModal(); sync(); res(o); };
      const paint = () => wraps.forEach(({ w, tag, c }, i) => {
        const k = order.indexOf(c);
        w.classList.toggle("set", k >= 0); w.querySelector(".card").classList.toggle("pick2", k >= 0);
        tag.textContent = k >= 0 ? `→ 放${DPOS(k)}` : `原来${DPOS(i)}`;
      });
      for (const x of wraps) x.w.onclick = () => {
        if (order.includes(x.c)) return;
        order.push(x.c); Sound.sfx("click", 0.5);
        if (order.length === cards.length - 1) order.push(cards.find((c) => !order.includes(c)));
        paint();
        if (order.length === cards.length) setTimeout(() => finish(order), 450);
      };
      body.appendChild(row);
      const go = el("div", "pkgo");
      const again = el("button", "btn", "重排"), keep = el("button", "btn primary", "按原样放回");
      again.onclick = () => { order = []; paint(); };
      keep.onclick = () => finish(cards.slice());
      go.appendChild(again); go.appendChild(keep); body.appendChild(go);
      openModal();
    });
  }

  // ---------------------------------------------------------------- 玩家：弃牌 / 挑牌
  let discardNeed = 0;
  function humanDiscard(p, n) {
    mode = "discard"; discardPick = []; discardNeed = n;
    hint(`手牌超过上限，选 ${n} 张弃掉`);
    updateDiscard(); sync();
    return new Promise((res) => { discardResolve = res; });
  }
  function updateDiscard() {
    showPrompt(`弃牌：已选 ${discardPick.length}/${discardNeed}`, [
      ["确定", () => { if (discardPick.length === discardNeed) doneDiscard(discardPick.slice()); else toast(`要选 ${discardNeed} 张`); }, true],
      ["自动", () => doneDiscard(AI.cheapest(g, g.human, discardNeed))]], timerMs() ? Math.max(15000, timerMs() * 2) : 0, () => doneDiscard(AI.cheapest(g, g.human, discardNeed)), "discard");
  }
  function doneDiscard(ids) { const r = discardResolve; discardResolve = null; mode = null; discardPick = []; hidePrompt(); hint(""); sync(); r && r(ids); }

  function humanPick(cards, n, title) {
    return new Promise((res) => {
      if (!cards.length) { res([]); return; }
      const picked = [];
      const body = $("#modal-body"); body.innerHTML = `<h2>${title}</h2>`;
      const row = el("div", "pickrow");
      for (const c of cards) {
        const e = cardEl(c, true);
        e.onclick = () => {
          toggle(picked, c); e.classList.toggle("pick2", picked.includes(c));
          if (picked.length === n) { setTimeout(() => { $("#modal").classList.add("hidden"); $("#modal-close").style.display = ""; res(picked.slice()); }, 250); }
        };
        row.appendChild(e);
      }
      body.appendChild(row);
      $("#modal-close").style.display = "none";
      $("#modal").classList.remove("hidden");
    });
  }

  // ---------------------------------------------------------------- 结算
  function gameOver(game) {
    if (!g) return;
    const me = game.human, w = game.winner;
    const winners = game.winners || [w];
    const won = winners.includes(me);
    const winMs = (w && say(w, "win", true)) || 1800;
    // v39 结算补刀：赢家说完，输家里跟她有斗嘴台词的（宿敌优先）不服气地接一句，显示在结算框里
    const pairs = (window.GAME_DATA.pairs || []).filter((pr) => w && pr[2] === w.key && pr[0] !== w.key && (!g.skinOk || g.skinOk(pr)));
    const sore = game.players.filter((q) => q !== w && !winners.includes(q) && !q.disguise).map((q) => ({ q, prs: pairs.filter((pr) => pr[0] === q.key && (q.ch.lines[pr[1]] || []).length) })).filter((x) => x.prs.length)
      .sort((x, y) => (game.relation(y.q, w) === "rival") - (game.relation(x.q, w) === "rival"))[0];
    Sound.track(won ? "win" : "lose");
    if (won) setTimeout(() => Sound.sfx("cheer", 0.6), 400);
    let title, sub, rank;
    const stat = (p) => `<small>　让人破防 ${p.stats.dmg} 次 · 出牌 ${p.stats.used}</small>`;
    if (game.mode === "team" || game.mode === "id5") {
      const tag = (p) => game.mode === "team" ? (p.team === me.team ? "我方" : "对方") : Engine.ROLE[p.role];
      const list = [...winners, ...game.players.filter((p) => !winners.includes(p))];
      rank = list.map((p) => `<div><span>${winners.includes(p) ? "🏆" : "　"} ${tag(p)}</span><img src="${portrait(p.key, "avatar")}" alt="">${p.name}${p.alive ? "" : "（退群）"}${stat(p)}</div>`).join("");
      if (game.mode === "team" && game.nation) {
        const wn = ((window.GAME_DATA.nations || {})[winners[0] && winners[0].ch.nation] || {}).name || "";
        title = `${wn}赢下全明星赛！`; sub = won ? "全队配合完美，你们是冠军！" : "这次输给了对面，下次再来！";
      } else if (game.mode === "team") { title = won ? "你们赢了！" : "对面赢了……"; sub = won ? "队友配合完美。" : "下次换个打法再来！"; }
      else {
        const SIDE = { lord: "群主守住了群！", rebel: "黑粉把群主踢出了群！", spy: "潜水党上岸，成了新群主！" };
        title = SIDE[game.side]; sub = `你的身份是【${Engine.ROLE[me.role]}】——${won ? "你赢了！" : "你输了……"}`;
      }
    } else {
      const order = [w, ...game.alive().filter((p) => p !== w), ...game.outOrder.slice().reverse()].filter((v, i, a) => v && a.indexOf(v) === i);
      rank = order.map((p, i) => `<div><span>${i === 0 ? "👑 群主" : `第 ${i + 1} 名`}</span><img src="${portrait(p.key, "avatar")}" alt="">${p.name}${stat(p)}</div>`).join("");
      title = won ? "你成了群主！" : `${w.name} 成了群主`;
      sub = won ? "全群都被你怼服了。" : me.alive ? "" : "你破防退群了……下次再来！";
    }
    $("#modal-body").innerHTML = `<div class="result"><img src="${w.disguise ? portrait("xds_cl", "cheer") : portrait(w.key, "win")}" alt="">
      <div class="rr"><div class="rt">${title}</div>
      <p>${sub}</p>
      <div class="rank">${rank}</div>
      <div class="rbtn"><button class="btn primary" id="btn-again">再来一局</button><button class="btn" id="btn-change">换角色</button><button class="btn" id="btn-report">本局战报</button></div></div></div>`;
    $("#modal-close").style.display = "none";
    $("#modal").classList.remove("hidden");
    if (sore && !w.disguise) {
      const pr = sore.prs[Math.floor(Math.random() * sore.prs.length)], arr = sore.q.ch.lines[pr[1]], idx = Math.floor(Math.random() * arr.length);
      const tok = actTok;
      setTimeout(() => {
        const rr = document.querySelector("#modal .result .rr"); if (!rr || actTok !== tok || $("#modal").classList.contains("hidden")) return;
        const e = el("div", "rq", `<img src="${portrait(sore.q.key, "avatar")}" alt=""><b>${sore.q.name}</b><span>${arr[idx]}</span>`);
        e.style.setProperty("--c", sore.q.ch.color);
        rr.insertBefore(e, rr.querySelector(".rank"));
        Sound.voice(sore.q.key, pr[1], idx);
      }, winMs + 400);
    }
    $("#btn-report").onclick = () => { Sound.sfx("click", 0.5); openReport(game, title); };
    { const w = game.winner, urls = [w.disguise ? portrait("xds_cl", "cheer") : portrait(w.key, "win"), ...game.players.map((q) => portrait(q.key, "avatar"))];   // v50 战报要用的图先在后台解码好，点开时不再卡一下
      setTimeout(() => urls.forEach((u) => { const im = new Image(); im.src = u; if (im.decode) im.decode().catch(() => {}); rpWarm.push(im); }), 300); }
    setTimeout(() => { if ($("#report") || !$("#btn-report")) return; openReport(game, title); const r = $("#report"); if (r) { r.style.visibility = "hidden"; void r.offsetHeight; } closeReport(); }, 900);   // 后台先排一遍战报（建好字形缓存），点开时不再卡一下
    $("#btn-again").onclick = () => { closeReport(); $("#modal").classList.add("hidden"); $("#modal-close").style.display = ""; window.Main.again(); };
    $("#btn-change").onclick = () => { closeReport(); $("#modal").classList.add("hidden"); $("#modal-close").style.display = ""; window.Main.toSelect(); };
  }

  // ---------------------------------------------------------------- v43 本局战报卡
  // 结算框里点「本局战报」：MVP、宿怨（谁怼谁最多）、护短、名场面（对线特写 / 金句），能存成图片分享
  function reportData(game, title) {
    const P = game.players, w = game.winner, by = (i) => P[i];
    const mvp = P.slice().sort((a, b) => b.stats.dmg - a.stats.dmg || (b === w) - (a === w))[0];
    let feud = null;
    for (const [k, n] of Object.entries(game.hits || {})) {
      const [a, b] = k.split(">").map(Number), back = (game.hits || {})[b + ">" + a] || 0;
      if (!feud || n + back * 0.5 > feud.score) feud = { a: by(a), b: by(b), n, back, score: n + back * 0.5 };
    }
    if (feud && feud.n < 2) feud = null;
    const gd = (game.guards || [])[0], guard = gd && { a: by(gd[0]), b: by(gd[1]) };
    const busy = P.slice().sort((a, b) => b.stats.used - a.stats.used)[0];
    const poor = P.slice().sort((a, b) => b.stats.taken - a.stats.taken)[0];   // 最惨：被扣心态最多
    const ct = (game.clashTexts || []).filter((c) => c[0].text && c[1].text);
    let scene = null;
    if (ct.length) scene = ct[Math.floor(Math.random() * ct.length)].map((x) => ({ p: by(x.i), text: x.text }));
    else {
      const qs = (game.quotes || []).filter((q) => q.text && q.text.length >= 6), top = Math.max(0, ...qs.map((q) => q.w)), pool = qs.filter((q) => q.w === top);
      const q = pool[Math.floor(Math.random() * pool.length)]; if (q) scene = [{ p: by(q.i), text: q.text }];
    }
    const MODE = { ffa: "群聊混战", team: game.nation ? "全明星赛" : "2v2 组队", id5: "身份局" };
    return { w, title, round: game.round, mode: MODE[game.mode] || "对局", mvp: mvp && mvp.stats.dmg ? mvp : null, feud, guard, busy: busy && busy.stats.used ? busy : null, poor: poor && poor.stats.taken >= 3 ? poor : null, scene,
      wimg: w.disguise ? portrait("xds_cl", "cheer") : portrait(w.key, "win") };
  }
  const rpWarm = [];                                                 // 预解码的图留个引用，免得被回收
  const rpAv = (p) => `<img src="${portrait(p.key, "avatar")}" alt="">`;
  function openReport(game, title) {
    closeReport();
    const d = reportData(game, title);
    const row = (tag, html) => `<div class="rp-row"><span class="rp-tag">${tag}</span>${html}</div>`;
    let rows = "";
    if (d.mvp) rows += row("MVP", `${rpAv(d.mvp)}<b style="color:${d.mvp.ch.color}">${d.mvp.name}</b><span>让人破防 ${d.mvp.stats.dmg} 次</span>`);
    if (d.feud) rows += row("宿怨", `${rpAv(d.feud.a)}<b style="color:${d.feud.a.ch.color}">${d.feud.a.name}</b><span>${d.feud.back ? "和" : "怼了"}</span>${rpAv(d.feud.b)}<b style="color:${d.feud.b.ch.color}">${d.feud.b.name}</b><span>${d.feud.back ? `互怼 ${d.feud.n} : ${d.feud.back}` : `${d.feud.n} 次`}</span>`);
    if (d.guard) rows += row("护短", `${rpAv(d.guard.a)}<b style="color:${d.guard.a.ch.color}">${d.guard.a.name}</b><span>站出来护着</span>${rpAv(d.guard.b)}<b style="color:${d.guard.b.ch.color}">${d.guard.b.name}</b>`);
    if (d.poor) rows += row("最惨", `${rpAv(d.poor)}<b style="color:${d.poor.ch.color}">${d.poor.name}</b><span>心态一共掉了 ${d.poor.stats.taken} 点</span>`);
    if (d.busy) rows += row("话痨", `${rpAv(d.busy)}<b style="color:${d.busy.ch.color}">${d.busy.name}</b><span>出了 ${d.busy.stats.used} 张牌</span>`);
    const scene = d.scene ? `<div class="rp-scene"><div class="rp-st">${d.scene.length > 1 ? "名场面" : "本局金句"}</div>${d.scene.map((x, i) =>
      `<div class="rp-q${i ? " r" : ""}" style="--c:${x.p.ch.color}">${rpAv(x.p)}<div><b>${x.p.name}</b><span>${x.text}</span></div></div>`).join("")}</div>` : "";
    const box = el("div", ""); box.id = "report";
    box.innerHTML = `<div class="rp-card" style="--c:${d.w.ch.color};--l:${d.w.ch.light}"><button class="rp-x" aria-label="关闭">✕</button>
      <div class="rp-head"><img class="rp-w" src="${d.wimg}" alt=""><div><div class="rp-t">本局战报</div><div class="rp-sub">${d.mode} · 打了 ${d.round} 轮</div><div class="rp-win">${d.title}</div></div></div>
      ${rows}${scene}
      <div class="rp-btns"><button class="btn primary" id="rp-save">保存图片</button><button class="btn" id="rp-close">关闭</button></div></div>`;
    $("#modal").appendChild(box); $("#modal").classList.add("rp-open");   // v50 战报开着时把底下的结算框藏起来，少画一层全屏
    box.onclick = (e) => { if (e.target === box) closeReport(); };
    box.querySelector(".rp-x").onclick = closeReport; box.querySelector("#rp-close").onclick = closeReport;
    box.querySelector("#rp-save").onclick = () => saveReport(d).catch(() => toast("这个浏览器存不了图，截个屏吧"));
  }
  function closeReport() { const r = $("#report"); if (r) r.remove(); const m = $("#modal"); if (m) m.classList.remove("rp-open"); }
  function toast(t) { const e = el("div", "rp-toast", t); ($("#report") || $("#modal")).appendChild(e); setTimeout(() => e.remove(), 2200); }
  // 存图：画在 1080×1440 的画布上（和卡片同样的内容，亮底）
  function loadImg(src) { return new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = src; }); }
  async function saveReport(d) {
    const W = 1080, H = 2600, cv = document.createElement("canvas"); cv.width = W; cv.height = H;   // 先画在长画布上，最后按内容高度裁（至少 3:4）
    const x = cv.getContext("2d"), F = (sz, wt = 700, fam = "PuHui") => `${wt} ${sz}px ${fam}, "Microsoft YaHei", sans-serif`;
    const rr = (X, Y, w, h, r) => { x.beginPath(); x.roundRect(X, Y, w, h, r); };
    const bgG = x.createLinearGradient(0, 0, 0, 1440); bgG.addColorStop(0, d.w.ch.light || "#eaf2ff"); bgG.addColorStop(1, "#ffffff");
    x.fillStyle = bgG; x.fillRect(0, 0, W, H);
    const people = [d.w, d.mvp, d.feud && d.feud.a, d.feud && d.feud.b, d.guard && d.guard.a, d.guard && d.guard.b, d.busy, d.poor, ...(d.scene || []).map((s) => s.p)].filter(Boolean);
    const av = {}; for (const p of people) if (!av[p.key]) av[p.key] = await loadImg(portrait(p.key, "avatar")).catch(() => null);
    const wim = await loadImg(d.wimg).catch(() => null);
    if (wim) { const h = 600, w = wim.width * h / wim.height; x.drawImage(wim, W - w + 40, 10, w, h); }
    x.fillStyle = "#2a2440"; x.font = F(92, "normal", "FangYuan"); x.fillText("本局战报", 70, 170);
    x.fillStyle = "#6b6585"; x.font = F(36, 500); x.fillText(`${d.mode} · 打了 ${d.round} 轮`, 74, 236);
    x.fillStyle = d.w.ch.color; x.font = F(50); x.fillText(d.title, 74, 320);
    const circ = (im, cx, cy, r, col) => { x.save(); x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fillStyle = "#fff"; x.fill(); x.clip(); if (im) x.drawImage(im, cx - r, cy - r, r * 2, r * 2); x.restore();
      x.beginPath(); x.arc(cx, cy, r, 0, 7); x.lineWidth = 5; x.strokeStyle = col; x.stroke(); };
    let y = 660;
    const row = (tag, parts) => {
      rr(60, y - 58, W - 120, 116, 28); x.fillStyle = "rgba(255,255,255,.92)"; x.fill();
      x.fillStyle = d.w.ch.color; rr(84, y - 26, 104, 52, 26); x.fill(); x.fillStyle = "#fff"; x.font = F(30); x.textAlign = "center"; x.fillText(tag, 136, y + 11); x.textAlign = "left";
      let cx = 214;
      for (const pt of parts) {
        if (pt.p) { circ(av[pt.p.key], cx + 34, y, 34, pt.p.ch.color); cx += 80; x.fillStyle = pt.p.ch.color; x.font = F(36); x.fillText(pt.p.name, cx, y + 13); cx += x.measureText(pt.p.name).width + 16; }
        else { x.fillStyle = "#3a3456"; x.font = F(32, 500); x.fillText(pt, cx, y + 12); cx += x.measureText(pt).width + 16; }
      }
      y += 136;
    };
    if (d.mvp) row("MVP", [{ p: d.mvp }, `让人破防 ${d.mvp.stats.dmg} 次`]);
    if (d.feud) row("宿怨", d.feud.back ? [{ p: d.feud.a }, "和", { p: d.feud.b }, `互怼 ${d.feud.n} : ${d.feud.back}`] : [{ p: d.feud.a }, "怼了", { p: d.feud.b }, `${d.feud.n} 次`]);
    if (d.guard) row("护短", [{ p: d.guard.a }, "护着", { p: d.guard.b }]);
    if (d.poor) row("最惨", [{ p: d.poor }, `心态一共掉了 ${d.poor.stats.taken} 点`]);
    if (d.busy) row("话痨", [{ p: d.busy }, `出了 ${d.busy.stats.used} 张牌`]);
    if (d.scene) {
      y += 6; x.fillStyle = "#2a2440"; x.font = F(40, "normal", "FangYuan"); x.fillText(d.scene.length > 1 ? "名场面" : "本局金句", 70, y); y += 30;
      d.scene.forEach((s, i) => {
        x.font = F(34); const lines = []; let cur = "";
        for (const ch of s.text) { if (x.measureText(cur + ch).width > 700) { lines.push(cur); cur = ""; } cur += ch; } lines.push(cur);
        const bh = 70 + lines.length * 46, bx = i ? 180 : 60, ax = i ? W - 110 : 110;
        rr(bx + (i ? 0 : 100), y, 740, bh, 26); x.fillStyle = "#fff"; x.fill(); x.lineWidth = 4; x.strokeStyle = s.p.ch.color; x.stroke();
        circ(av[s.p.key], ax, y + 46, 44, s.p.ch.color);
        const tx = bx + (i ? 30 : 130);
        x.fillStyle = s.p.ch.color; x.font = F(28); x.fillText(s.p.name, tx, y + 44);
        x.fillStyle = "#3a3456"; x.font = F(34); lines.forEach((l, k) => x.fillText(l, tx, y + 92 + k * 46));
        y += bh + 22;
      });
    }
    const FH = Math.max(1440, Math.ceil(y + 110)), fin = document.createElement("canvas"); fin.width = W; fin.height = FH;
    const fx = fin.getContext("2d"); fx.drawImage(cv, 0, 0, W, FH, 0, 0, W, FH);
    fx.fillStyle = "#8a85a3"; fx.font = F(28, 500); fx.textAlign = "center"; fx.fillText("AI娘对线", W / 2, FH - 50);
    const blob = await new Promise((r, j) => { try { fin.toBlob((b) => b ? r(b) : j(), "image/png"); } catch (e) { j(e); } });
    // 手机上能直接调起系统分享（发微信 / 存相册）；电脑或不支持的浏览器照常下载
    const file = window.File && new File([blob], "AI娘对线战报.png", { type: "image/png" });
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: "AI娘对线战报" }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "AI娘对线战报.png"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("战报已保存");
  }

  function bindButtons() {
    $("#btn-end").onclick = () => { if (mode === "play" && !busy) { Sound.sfx("click", 0.5); endPlay(); } };
    $("#btn-end").title = "结束回合（空格）";
    $("#stage").addEventListener("contextmenu", (e) => { e.preventDefault(); if (g) cancelSel(); });
    $("#scr-game").addEventListener("click", (e) => {
      if (!g) return;
      if (!e.target.closest("#hinfo, .hero, #skillbox")) hideHeroInfo();
      if (e.target.closest(".card, .hero, button, #prompt, #ctip, #hinfo, #chat, #actions")) return;
      cancelSel();
    });
    document.addEventListener("keydown", onKey);
  }
  // 快捷键：1–9 选牌（选目标时选对手），Enter 确认，空格结束回合，Esc 取消，Y / N 回答提示，Q / W / E 技能
  function onKey(e) {
    if (!g || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!$("#modal").classList.contains("hidden")) {
      if (e.key === "Escape" && $("#modal-close").style.display !== "none") $("#modal").classList.add("hidden");
      if (e.key === "Enter") { const b = $("#modal-body .pkgo .btn.primary"); if (b) b.click(); }
      return;
    }
    if (e.key === "Escape" && skipDeploy()) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // v49 兜底：main.js 的 Esc（捕获阶段）先处理；它没处理到时这里再跳演出，免得罩子底下的应答框把 Esc 当成「不出」
    if (e.key === "Escape" && $("#report")) { closeReport(); return; }
    if (e.key === "Escape" && clashSkip) { clashSkip(); return; }
    if (e.key === "Escape" && infoP) { hideHeroInfo(); return; }
    if (!SET().keys && e.key !== "Escape") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const n = /^[1-9]$/.test(k) ? +k : 0;
    const me = g.human;
    const promptBtn = (i) => { const b = $("#prompt-btns").children[i]; if (b && !$("#prompt").classList.contains("hidden")) { b.click(); return true; } return false; };
    let done = true;
    if (promptKind === "choose" || promptKind === "pick") {
      if (n) promptBtn(n - 1); else if ((k === "Enter" || k === "y") && promptKind === "pick") promptBtn(0); else done = false;
    } else if (false) {
      if (n) promptBtn(n - 1); else done = false;
    } else if (promptKind === "respond" || promptKind === "confirm") {
      if (n && promptKind === "respond") { const c = me.hand[n - 1]; if (c && respondCards.includes(c.id)) finishRespond({ card: c }); else done = false; }
      else if (k === "Enter" || k === "y" || k === " ") promptBtn(0);
      else if (k === "Escape" || k === "n") promptBtn(1);
      else done = false;
    } else if (mode === "discard") {
      if (n && me.hand[n - 1]) onCardClick(me.hand[n - 1].id);
      else if (k === "Enter") promptBtn(0);
      else done = false;
    } else if (mode === "play" && !busy) {
      if (n && targetList.length) { const t = targetList[n - 1]; if (t) onHeroClick(t); }
      else if (n) { if (me.hand[n - 1]) onCardClick(me.hand[n - 1].id); }
      else if (k === "Enter") playSelected();
      else if (k === " ") { Sound.sfx("click", 0.5); endPlay(); }
      else if (k === "Escape") cancelSel();
      else if (k === "q" || k === "w" || k === "e") { const b = $("#skillbox").querySelectorAll("button")["qwe".indexOf(k)]; if (b && !b.disabled) b.click(); }
      else done = false;
    } else if (k === "Escape") cancelSel();
    else done = false;
    if (done) e.preventDefault();
  }
  function detach() { rage(false);
    clearInterval(blinkTimer);
    if (drag) { if (drag.ghost) drag.ghost.remove(); stopDrag(); }
    clearTimeout(autoT); clearTimeout(nudgeT); g = null; mode = null; playResolve = null; respondResolve = null; discardResolve = null; hoverId = null; hidePrompt();
    busy = false; actTok++; selected = null; skillMode = null;   // 出牌结算到一半退出：旧局的 act 永远等不到结束，不重置的话之后每一局都出不了牌
    const tip = $("#ctip"); if (tip) tip.className = "hidden";
  }

  return { skinKey, attach, detach, layout, sync, log, sys, say, showCard, damage, heal, out, setTurn, drawAnim, steal, skill, clash, lean, skillNote, band, banner, rage, news, phase, toast,
    deploy, skipDeploy, hzStash, wishFly, humanPlay, humanRespond, humanDiscard, humanPick, humanConfirm, humanChoose, humanBomb, humanPlace, peek, humanArrange, disguise, gameOver, bindButtons, cardEl, portrait, expr, throwProp, asset: A };
})();
