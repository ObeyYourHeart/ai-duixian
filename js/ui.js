// 界面：座位/手牌/群聊/动画/玩家输入。坐标都是舞台坐标（layout() 更新）：
// 横屏基准 1600x900，舞台变宽 / 变高时中间的东西右移 DX、底部的东西下移 DY；
// 竖屏基准 760x1300：对手在上、桌面、群聊、自己 + 按钮、手牌在最下，多出来的高度分给桌面和群聊（DY = 高 - 1300）。
window.UI = (function () {
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
  const EQ_ICON = { xianka: "🎮", fanghuoqiang: "🛡", chongdianbao: "🔋" };
  const HEART = '<svg class="heart%c" viewBox="0 0 24 22"><path d="M12 20.5C5 15 1.5 11.6 1.5 7.2 1.5 4 4 1.5 7.1 1.5c2 0 3.8 1 4.9 2.6C13.1 2.5 14.9 1.5 16.9 1.5 20 1.5 22.5 4 22.5 7.2c0 4.4-3.5 7.8-10.5 13.3z"/></svg>';

  let g = null, heroes = [], exprTimers = {}, lastSay = {};
  let mode = null, selected = null, skillMode = null, busy = false;
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
  function layout(W, H, portrait) { SW = W; SH = H; PORTRAIT = !!portrait; relayout(); }
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
  function portrait(key, e) { return A(`assets/img/${key}_${e}.webp`); }
  const pkey = (p) => (p.disguise ? "xds_cl" : p.key);              // 变身的小DeepSeek 换伪装立绘

  // ---------------------------------------------------------------- 牌面
  function cardEl(c, big) {
    const d = CD[c.k];
    const e = el("div", `card ${d.type}${big ? " big" : ""}${d.name.length > 3 ? " long" : ""}`);
    e.innerHTML = `<div class="cn">${d.name}</div><img src="${A(`assets/img/card_${c.k}.webp`)}" alt="" draggable="false"><div class="ct">${{ basic: "基本", trick: "锦囊", equip: "装备", bomb: "炸弹" }[d.type]}</div><div class="cd">${d.short}</div>`;
    e.dataset.id = c.id;
    e.title = d.desc;
    return e;
  }

  // ---------------------------------------------------------------- 装配
  function attach(game) {
    g = game; heroes = [];
    const seats = $("#seats"); seats.innerHTML = "";
    $("#pile").innerHTML = ""; $("#chat-list").innerHTML = ""; $("#fx").innerHTML = "";
    $("#chat-n").textContent = g.players.length;
    $("#chat-name").textContent = g.nation ? "AI 全明星赛" : "AI娘 相亲相爱一家人";
    for (const p of g.players) {
      const h = el("div", "hero");
      h.style.setProperty("--c", p.ch.color); h.style.setProperty("--l", p.ch.light);
      const tags = p.ch.skills.map((s) => `<span class="${s.type}" title="${s.short || s.desc}">${s.name}</span>`).join("");
      h.innerHTML = `<div class="por"><img src="${portrait(p.key, "base")}" alt=""></div><div class="flash"></div><div class="hp"></div>
        <div class="cnt"><i></i><span>0</span></div><div class="status"></div><div class="stags${p.ch.skills.length > 3 ? " many" : ""}">${tags}</div>
        <div class="plate"><b>${p.name}</b><small>${p.ch.title}</small></div>${p.human ? '<div class="you">你</div>' : ""}<div class="side"></div><div class="tnum"></div>`;
      // 点技能名直接打开详情卡；但她正被当作目标时，点哪里都算选她
      h.querySelectorAll(".stags span").forEach((sp, k) => sp.addEventListener("click", (ev) => {
        if (h.classList.contains("target")) return;
        ev.stopPropagation(); showHeroInfo(p, p.ch.skills[k].id);
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
    const GOAL = { lord: "守住群：把黑粉和潜水党都踢出群", loyal: "暗中帮群主，踢掉黑粉和潜水党", rebel: "把群主踢出群", spy: "先潜水，最后单挑踢掉群主，自己当新群主" };
    const NA = window.GAME_DATA.nations || {}, mates = g.players.filter((q) => q !== me && q.team === me.team).map((q) => q.name).join("、");
    const goal = g.mode === "team" && g.nation ? `全明星赛：你在 <b>${(NA[me.ch.nation] || {}).name}</b>，队友 <b>${mates}</b>。`
      : g.mode === "team" ? `你和 <b>${mates}</b> 一队。`
      : g.mode === "id5" ? `你的身份是 <b>${Engine.ROLE[me.role]}</b>：${GOAL[me.role]}。` : "";
    hint(`${goal}你是 <b>${me.name}</b>。<small>点任何一张角色卡，都能看她的技能和状态。</small>`);
    sync();
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

  function sync() {
    if (!g) return;
    for (const p of g.players) {
      const h = heroes[p.i];
      let hp = "";
      for (let k = 0; k < p.maxHp; k++) hp += HEART.replace("%c", k < p.hp ? "" : " empty");
      h.querySelector(".hp").innerHTML = hp;
      h.querySelector(".cnt span").textContent = p.hand.length;
      h.classList.toggle("out", !p.alive);
      if (!p.alive && !h.querySelector(".stamp")) h.appendChild(el("div", "stamp", "退群"));
      let st = "";
      if (p.banned) st += '<span class="ban">🚫 封号中</span>';
      if (p.muted) st += '<span>🔇 禁言中</span>';
      if (p.dumb) st += '<span class="dumb">❓ 降智中</span>';
      if (p.offline) st += '<span>📵 断网中</span>';
      if (p.boost) st += '<span class="boost">🔥 加班中</span>';
      if (p.napping) st += '<span>😴 补觉中</span>';
      if (p.disguise) st += '<span class="boost">🎭 冒充 Claude</span>';
      if (g.bomb && g.bomb.holder === p) st += '<span class="bomb">💣 宕机预警</span>';
      if (p.equip) st += `<span class="eq">${EQ_ICON[p.equip.k] || "🧰"} ${CD[p.equip.k].name}</span>`;
      h.querySelector(".status").innerHTML = st;
      const sd = h.querySelector(".side"), lab = sideLabel(p);
      sd.className = "side" + (lab ? " " + lab.cls : ""); sd.textContent = lab ? lab.text : "";
    }
    $("#deck").textContent = g.deck.length;
    $("#round").textContent = g.round;
    // 炸弹猫：牌堆里还剩几张宕机、下一张是宕机的概率；你看过的牌堆顶
    const bl = g.bombsLeft();
    $("#bombs").textContent = bl;
    $("#risk").textContent = g.deck.length ? ` ${PORTRAIT ? "" : "下张 "}${Math.round(bl / g.deck.length * 100)}%` : "";   // 竖屏顶栏窄，只写百分比
    const kn = g.human.alive ? g.known(g.human, 5) : [];
    let last = kn.length; while (last > 0 && !kn[last - 1]) last--;
    const kb = $("#known"), math = g.human.alive && g.hasSkill(g.human, "math") ? g.bombSpots() : null;   // ChatGPT 演算：宕机在第几张
    kb.classList.toggle("hidden", !last && !(math && math.length));
    if (math && math.length) kb.innerHTML = '<span class="kt">🧮 演算</span>' + `<span class="kc boom">宕机在第 ${math.join("、")} 张</span>` +
      kn.slice(0, last).map((c, i) => c && c.k !== "dangji" ? `<span class="kc">${i + 1}. ${CD[c.k].name}</span>` : "").join("");
    else if (last) kb.innerHTML = '<span class="kt">👁 你看过的牌堆顶</span>' + kn.slice(0, last).map((c, i) => `<span class="kc${c && c.k === "dangji" ? " boom" : c ? "" : " unk"}">${i + 1}. ${c ? CD[c.k].name : "？"}</span>`).join("");
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
      if (!e) {
        e = cardEl(c); e.removeAttribute("title"); bindHandCard(e, c.id);
        e.appendChild(el("div", "kn"));
        box.appendChild(e); e.style.left = hw + "px"; e.style.top = "8px";
      }
      keep.add(String(c.id));
      const x = xs[i];
      e.dataset.x = x;
      e.style.zIndex = i === focus ? 30 : i + 1;
      requestAnimationFrame(() => { e.style.left = x + "px"; e.style.top = "8px"; });
      e.querySelector(".kn").textContent = i < 9 ? i + 1 : "";
      const usable = mode === "play" && !busy && !skillMode && g.canUse(me, c);
      const respond = mode === "respond" && respondCards.includes(c.id);
      e.classList.toggle("can", !!(usable || respond || mode === "discard"));
      e.classList.toggle("dim", mode === "play" && !busy && !skillMode && !g.canUse(me, c));
      e.classList.toggle("sel", selected === c.id);
      e.classList.toggle("hov", hoverId === c.id);
      e.classList.toggle("pick2", discardPick.includes(c.id));
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
    if (s.id === "fact" && p.used && p.used.fact) out.push("这轮核实过");
    if (s.id === "fans" && p.used && p.used.fans) out.push("这轮刷过礼物");
    if (s.id === "disguise" && p.disguise) out.push("伪装中");
    if (s.id === "nap" && p.napping) out.push("睡着了");
    if (s.id === "math" && p.human && g.bombSpots) { const sp = g.bombSpots(); if (sp.length) out.push(`宕机在第 ${sp.join("、")} 张`); }
    return out;
  }
  function heroStatus(p) {
    const st = [];
    if (p.banned) st.push("🚫 封号中"); if (p.muted) st.push("🔇 禁言中"); if (p.dumb) st.push("❓ 降智中");
    if (p.napping) st.push("😴 补觉中"); if (p.disguise) st.push("🎭 正在冒充 Claude");
    if (p.offline) st.push("📵 断网中"); if (p.boost) st.push("🔥 加班中");
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
    box.style.setProperty("--c", p.ch.color); box.style.setProperty("--l", p.ch.light);
    box.innerHTML = `<div class="hi-head"><img src="${portrait(p.key, "avatar")}" alt=""><div class="hi-nm"><b>${p.name}</b><small>${p.ch.title}</small></div><button class="hi-x" title="关闭">✕</button></div>
      <div class="hi-stat"><span>❤ 心态 ${Math.max(0, p.hp)} / ${p.maxHp}</span><span>🂠 手牌 ${p.hand.length}（上限 ${g.handLimit(p)}）</span>${p.equip ? `<span>🧰 ${CD[p.equip.k].name}</span>` : ""}${side ? `<span>${side}</span>` : ""}${p.alive ? "" : "<span>已退群</span>"}</div>
      ${st.length ? `<div class="hi-st">${st.join(" · ")}</div>` : ""}
      ${rel ? `<div class="hi-rel ${rel}"><b>${REL_NAME[rel]}</b>${relRow}</div>` : ""}
      ${p !== me && window.Props ? `<div class="hi-props"><div class="hp-row">${Props.kindsFor(me).map((k) => `<button class="hp-b${Props.KINDS[k].owner ? " sig" : ""}" data-k="${k}" title="${Props.KINDS[k].name}${Props.KINDS[k].owner ? "（你的专属）" : ""}"><img src="${A(`assets/img/prop_${k}.webp`)}" alt=""><span>${Props.KINDS[k].name}</span></button>`).join("")}</div>
        <div class="hp-note">${Props.meaning(g, me, p)}</div></div>` : ""}
      <div class="hi-skills">${p.ch.skills.map((s) => {
        const ss = skillState(p, s);
        return `<div class="hi-sk${s.id === infoFocus ? " focus" : ""}"><div class="hi-sk1"><b>${s.name}</b><em class="${s.type}">${s.type === "active" ? "主动" : "被动"}</em>${ss.map((x) => `<i>${x}</i>`).join("")}</div>
          <div class="hi-short">${s.short || ""}</div><div class="hi-desc">${s.desc}</div></div>`;
      }).join("")}</div>`;
    box.className = "";
    box.querySelector(".hi-x").onclick = (ev) => { ev.stopPropagation(); hideHeroInfo(); };
    box.querySelectorAll(".hp-b").forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); if (Props.human(g, me, p, b.dataset.k)) hideHeroInfo(); }; });
    // 放在角色旁边：右边放得下就放右边，不然放左边；上下不出屏
    const q = pos(p), sc = seatScale(p), w = box.offsetWidth, h = box.offsetHeight;
    let x = q.x + HERO_W * sc + 14;
    if (x + w > SW - 12) x = q.x - w - 14;
    if (x < 12) x = Math.max(12, Math.min(SW - w - 12, q.x + HERO_W * sc / 2 - w / 2));
    const y = Math.max(12, Math.min(SH - h - 12, q.y));
    box.style.left = x + "px"; box.style.top = y + "px";
    const f = box.querySelector(".hi-sk.focus"); if (f) f.scrollIntoView({ block: "nearest" });
  }
  function hideHeroInfo() { infoP = null; const b = $("#hinfo"); if (b) b.className = "hidden"; }

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
    tip.innerHTML = html;
    tip.className = "";
    const go = tip.querySelector("#tip-go");
    if (go) go.onclick = (ev) => { ev.stopPropagation(); playSelected(); };
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const cx = HAND_X + ((+ce.dataset.x || 0) + CARD_W / 2) * HS;
    const top = $("#prompt").classList.contains("hidden") ? HAND_Y + (8 - 34) * HS - 12 - h : PROMPT_Y - 12 - h;
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
  function renderSkills() {
    const box = $("#skillbox"); if (!box || !g) return;
    const me = g.human;
    box.innerHTML = "";
    const readyIds = [];
    let ki = 0;
    for (const s of g.activeSkills(me)) {
      const left = s.left != null ? `（${s.left}）` : "";
      const ready = mode === "play" && !busy && s.can;
      const b = el("button", "btn small" + (skillMode === s.id ? " primary" : ready ? " sk-ready" : ""), `${s.name}${left}` + (SET().keys && ki < 3 ? `<kbd>${"QWE"[ki]}</kbd>` : ""));
      ki++;
      b.title = `【${s.name}】${s.short || ""}——${s.desc}` + (ready ? "（现在能用）" : "");
      b.disabled = !ready;
      b.style.setProperty("--ph", -(performance.now() % 2400) + "ms");   // 每次重画按钮，发光动画接着上一帧，不会一跳一跳
      readyIds.push(ready ? s.id : null);
      b.onclick = (ev) => { ev.stopPropagation(); onSkillBtn(s); };
      box.appendChild(b);
    }
    for (const s of me.ch.skills.filter((x) => x.type !== "active")) {
      const ss = skillState(me, s);
      const ch = el("span", "pchip" + ((s.id === "saint" && me.saintUsed) || (s.id === "dumb" && me.dumb) ? " off" : ""), `${s.name}${ss.length ? `<small>${ss[0]}</small>` : ""}`);
      ch.title = `【${s.name}】${s.short || s.desc}（被动，自动生效）`;
      ch.onclick = (ev) => { ev.stopPropagation(); showHeroInfo(me, s.id); };
      box.appendChild(ch);
    }
    const tags = heroes[me.i] && heroes[me.i].querySelectorAll(".stags span");
    if (tags) me.ch.skills.forEach((s, k) => tags[k] && tags[k].classList.toggle("sk-ready", readyIds.includes(s.id)));
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
  function expr(p, e, ms) {
    const img = heroes[p.i] && heroes[p.i].querySelector(".por img");
    if (!img) return;
    if (p.disguise && e === "smug") e = ["smug", "tea", "cheer"][Math.floor(Math.random() * 3)];
    img.src = portrait(pkey(p), e);
    heroes[p.i].querySelector(".por").animate([{ transform: "translateX(-50%) scale(1.06)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 220, easing: "ease-out" });
    clearTimeout(exprTimers[p.i]);
    if (ms && p.alive) exprTimers[p.i] = setTimeout(() => { if (p.alive && g) img.src = portrait(pkey(p), "base"); }, ms);
  }
  const HURT_KEYS = ["hurt", "hajimi", "out", "stolen", "fury", "halluc", "low", "mourn"], SMUG_KEYS = ["attack", "win", "ban", "reset", "buy", "steal", "steal_claude", "fans", "recall",
    "polish", "zuiying", "beg", "beg_gpt", "beg_claude", "claw", "dad", "maint", "long", "busy", "fed", "think", "sis", "search", "know", "sorry", "bundle", "sale",
    "ko", "def", "qingke", "qingke_self", "pact_end"];
  function say(p, key, important) {
    if (!g) return;
    const arr = p.ch.lines[key];
    if (!arr || !arr.length) return;
    const now = performance.now();
    if (!important && now - (lastSay.t || 0) < 900) return;
    lastSay.t = now;
    const idx = Math.floor(Math.random() * arr.length);
    const text = arr[idx];
    Sound.voice(p.key, key, idx);
    const q = pos(p);
    const old = document.querySelector(`.bubble[data-p="${p.i}"]`); if (old) old.parentElement.remove();
    const wrap = el("div"); wrap.style.position = "absolute"; wrap.style.zIndex = 40;
    const b = el("div", "bubble " + (p.human ? "up" : "down"), text);
    b.dataset.p = p.i; b.style.setProperty("--c", p.ch.color); b.style.position = "relative";
    wrap.appendChild(b);
    if (p.human) { wrap.style.left = q.x + 20 + "px"; wrap.style.top = q.y - 14 + "px"; wrap.style.transform = "translateY(-100%)"; }
    else { wrap.style.left = Math.max(8, Math.min(q.x + 6, SW - 330)) + "px"; wrap.style.top = q.y + HERO_H * seatScale(p) + 14 + "px"; }
    $("#fx").appendChild(wrap);
    if (key === "exposed") expr(p, "exposed", 1800);
    else if (HURT_KEYS.includes(key)) expr(p, "hurt", key === "out" ? 0 : 1600);
    else if (SMUG_KEYS.includes(key)) expr(p, "smug", 1400);
    setTimeout(() => wrap.remove(), Math.max(1800, text.length * 170));
    return (window.VOICES || {})[`${p.key}_${key}${idx}`] || 0;   // 配音时长（毫秒），没有配音返回 0
  }

  // ---------------------------------------------------------------- 动画
  function flyEl(e, from, to, ms, scale0 = 0.6, scale1 = 1) {
    e.style.position = "absolute"; e.style.left = "0px"; e.style.top = "0px"; e.style.margin = "0";
    $("#fx").appendChild(e);
    const w = e.offsetWidth || CARD_W, h = e.offsetHeight || CARD_H;
    const anim = e.animate([
      { transform: `translate(${from.x - w / 2}px, ${from.y - h / 2}px) scale(${scale0})`, opacity: 0.6 },
      { transform: `translate(${to.x - w / 2}px, ${to.y - h / 2}px) scale(${scale1})`, opacity: 1 }],
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
    for (const t of targets) arrow(center(p), center(t));
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
    rice: ["plop", 0.5], fish: ["pop_small", 0.5], banana: ["slap2", 0.5], rocket: ["whoosh_cartoon", 0.5], pillow: ["boing", 0.45], carnival: ["yay", 0.35], scroll: ["paper", 0.6], takeout: ["notify", 0.45] };
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
  function damage(p, n) {
    const h = heroes[p.i];
    h.classList.remove("shake"); void h.offsetWidth; h.classList.add("shake");
    h.querySelector(".flash").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500 });
    floatText(p, `破防 -${n}`);
    sparks(p, "#ff4f70", 14);
    Sound.sfx("punch", 0.9); setTimeout(() => Sound.sfx("crack", 0.45), 90);
    sync();
  }
  function heal(p, n) { floatText(p, `+${n}`, "heal"); sparks(p, "#4fd18b", 10); Sound.sfx("sparkle", 0.6); sync(); }
  function out(p) { expr(p, "hurt"); heroes[p.i].animate([{ transform: "rotate(0)" }, { transform: "rotate(-4deg) translateY(6px)" }], { duration: 500, fill: "forwards" }); sync(); }
  function setTurn(p) { heroes.forEach((h, i) => h.classList.toggle("turn", i === p.i)); }
  function drawAnim(p, n) {
    Sound.sfx("draw", 0.6);
    for (let k = 0; k < Math.min(n, 4); k++) {
      setTimeout(() => { if (!g) return; const b = el("div", "cardback"); flyEl(b, DECK, center(p), 300, 0.7, 0.5).then((e) => e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" }).finished.then(() => e.remove())); }, k * 70);
    }
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
    c.innerHTML = `<img src="${p.disguise ? portrait("xds_cl", sk && sk.id === "disguise" ? "change" : "smug") : portrait(p.key, "smug")}" alt=""><div class="ct2">${p.name} 发动技能</div><div class="ct1">${name}</div>${sk && sk.short ? `<div class="ct3">${sk.short}</div>` : ""}`;
    $("#fx").appendChild(c); setTimeout(() => c.remove(), 1300 * Engine.speed + 100);
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
    h.querySelector(".plate small").textContent = on ? "（其实是小DeepSeek）" : p.ch.title;
    if (on) sparks(p, "#f0a050", 18);
    sync();
  }
  function skillNote(p, name) { Sound.sfx("chime", 0.5); skillPop(p, name); sync(); }
  function skillPop(p, name) {
    const s = p.ch.skills.find((x) => x.name === name);
    const c = center(p), e = el("div", "skpop", `<b>【${name}】</b>${s && s.short ? `<span>${s.short}</span>` : ""}`);
    e.style.setProperty("--c", p.ch.color);
    e.style.left = c.x + "px"; e.style.top = c.y - 70 + "px";
    $("#fx").appendChild(e); setTimeout(() => e.remove(), 2000 * Math.max(0.6, Engine.speed));
  }
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
    busy = true; clearTargets(); hint("结算中……"); sync();
    clearTimeout(nudgeT);
    try { await fn(); } finally { busy = false; }
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
    if (SET().click === 1 && selected !== id) {
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
    if (CD[c.k].target !== "one") { selected = id; act(() => g.useCard(me, c, [])); }
  }
  function whyNot(me, c) {
    if (c.k === "fanbo") return "【反驳】要在被吐槽时才能打出";
    if (c.k === "yidu") return "【已读不回】要在锦囊对你生效时才能打出";
    if (c.k === "tucao") return me.dumb ? "降智中，这回合不能吐槽" : "这回合已经吐槽过了";
    if (c.k === "naicha") return "心态是满的，先留着奶茶吧";
    if (c.k === "baipiao" || c.k === "chehui") return "对手都没有牌";
    if (c.k === "shuaiguo") return "【甩锅】要在被吐槽时才能打出";
    if (c.k === "jiaban") return "已经在加班了";
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
    if (opt.kind === "fanbo") text = opt.ctx.card.k === "shuaping" ? `${from.name} 在刷屏！打出【反驳】？` :
      `${from.name} 吐槽你！打出【反驳】？` + (opt.ctx.need === 2 ? `（${window.GAME_DATA.chars.claude.skills[0].name}：要 2 张，第 ${opt.ctx.nth + 1} 张）` : "");
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
      showPrompt("宕机塞回哪？只有你知道", opts.map(([l, v], k) => [l, () => pick(v), k === 0]),
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
  function peek(cards, title) {
    return new Promise((res) => {
      if (!cards.length) { res(); return; }
      const body = $("#modal-body"); body.innerHTML = `<h2>${title}</h2>`;
      body.appendChild(peekRow(cards, DPOS).row);
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
    if (w) say(w, "win", true);
    Sound.sfx(won ? "fanfare" : "sadtrumpet", 0.8);
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
    $("#modal-body").innerHTML = `<div class="result"><img src="${w.disguise ? portrait("xds_cl", "cheer") : portrait(w.key, "smug")}" alt="">
      <div class="rr"><div class="rt">${title}</div>
      <p>${sub}</p>
      <div class="rank">${rank}</div>
      <div class="rbtn"><button class="btn primary" id="btn-again">再来一局</button><button class="btn" id="btn-change">换角色</button></div></div></div>`;
    $("#modal-close").style.display = "none";
    $("#modal").classList.remove("hidden");
    $("#btn-again").onclick = () => { $("#modal").classList.add("hidden"); $("#modal-close").style.display = ""; window.Main.again(); };
    $("#btn-change").onclick = () => { $("#modal").classList.add("hidden"); $("#modal-close").style.display = ""; window.Main.toSelect(); };
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
  function detach() {
    if (drag) { if (drag.ghost) drag.ghost.remove(); stopDrag(); }
    clearTimeout(autoT); g = null; mode = null; playResolve = null; respondResolve = null; discardResolve = null; hoverId = null; hidePrompt();
    const tip = $("#ctip"); if (tip) tip.className = "hidden";
  }

  return { attach, detach, layout, sync, log, sys, say, showCard, damage, heal, out, setTurn, drawAnim, steal, skill, skillNote, banner, phase, toast,
    humanPlay, humanRespond, humanDiscard, humanPick, humanConfirm, humanChoose, humanBomb, humanPlace, peek, humanArrange, disguise, gameOver, bindButtons, cardEl, portrait, expr, throwProp, asset: A };
})();
