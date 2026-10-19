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
    5: [{ x: 36, y: 568 }, { x: 940, y: 80 }, { x: 720, y: 80 }, { x: 500, y: 80 }, { x: 280, y: 80 }] };
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
    if (!PORTRAIT) return 1;
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
      HAND_W = W - 32; HAND_X = 16; HAND_Y = H - 220 * HS; PROMPT_Y = HAND_Y - 78;
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
      HAND_W = 900; HAND_X = 270 + DX; HAND_Y = 668 + DY; PROMPT_Y = 590 + DY; TABLE_X = 260 + DX; TABLE_Y = 390 + DY / 2;
      PILE = { x: 710 + DX, y: 480 + DY / 2 }; DECK = { x: 420 + DX, y: 480 + DY / 2 };
    }
    if (!g) return;
    for (const p of g.players) placeHero(p);
    renderHand();
  }
  function center(p) { const q = pos(p), s = seatScale(p); return { x: q.x + HERO_W * s / 2, y: q.y + (HERO_H / 2 - 20) * s }; }
  function portrait(key, e) { return A(`assets/img/${key}_${e}.webp`); }

  // ---------------------------------------------------------------- 牌面
  function cardEl(c, big) {
    const d = CD[c.k];
    const e = el("div", `card ${d.type}${big ? " big" : ""}${d.name.length > 3 ? " long" : ""}`);
    e.innerHTML = `<div class="cn">${d.name}</div><img src="${A(`assets/img/card_${c.k}.webp`)}" alt="" draggable="false"><div class="ct">${{ basic: "基本", trick: "锦囊", equip: "装备" }[d.type]}</div><div class="cd">${d.short}</div>`;
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
    for (const p of g.players) {
      const h = el("div", "hero");
      h.style.setProperty("--c", p.ch.color); h.style.setProperty("--l", p.ch.light);
      const tags = p.ch.skills.map((s) => `<span title="${s.desc}">${s.name}</span>`).join("");
      h.innerHTML = `<div class="por"><img src="${portrait(p.key, "base")}" alt=""></div><div class="flash"></div><div class="hp"></div>
        <div class="cnt"><i></i><span>0</span></div><div class="status"></div><div class="stags">${tags}</div>
        <div class="plate"><b>${p.name}</b><small>${p.ch.title}</small></div>${p.human ? '<div class="you">你</div>' : ""}<div class="side"></div><div class="tnum"></div>`;
      // 点技能名看说明；但她正被当作目标时，点哪里都算选她
      h.querySelectorAll(".stags span").forEach((sp, k) => sp.addEventListener("click", (ev) => {
        if (h.classList.contains("target")) return;
        ev.stopPropagation(); toast(`【${p.ch.skills[k].name}】${p.ch.skills[k].desc}`, 3600);
      }));
      h.addEventListener("click", () => onHeroClick(p));
      seats.appendChild(h);
      heroes[p.i] = h;
    }
    hoverId = null; drag = null; dropPt = null; dropId = null; clearTimeout(autoT);
    let tip = $("#ctip");
    if (!tip) { tip = el("div"); tip.id = "ctip"; $("#scr-game").appendChild(tip); }
    tip.className = "hidden";
    relayout();
    const me = g.human;
    const GOAL = { lord: "守住群：把黑粉和潜水党都踢出群", loyal: "暗中帮群主，踢掉黑粉和潜水党", rebel: "把群主踢出群", spy: "先潜水，最后单挑踢掉群主，自己当新群主" };
    const goal = g.mode === "team" ? `你和 <b>${g.players.find((q) => q !== me && q.team === me.team).name}</b> 一队。`
      : g.mode === "id5" ? `你的身份是 <b>${Engine.ROLE[me.role]}</b>：${GOAL[me.role]}。` : "";
    hint(`${goal}你是 <b>${me.name}</b>：${me.ch.skills.map((s) => `【${s.name}】${s.desc}`).join(" ")}`);
    sync();
  }

  // 阵营 / 身份牌：2v2 标队友和对手；抢群主只亮群主、自己和退群的人，其他人是“？”
  function sideLabel(p) {
    if (g.mode === "team") return p.human ? null : p.team === g.human.team ? { text: "队友", cls: "ally" } : { text: "对手", cls: "foe" };
    if (g.mode === "id5") {
      if (p.role === "lord" || p.human || p.revealed) return { text: Engine.ROLE[p.role], cls: "role-" + p.role };
      return { text: "？", cls: "unknown" };
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
      if (g.bomb && g.bomb.holder === p) st += '<span class="bomb">💣 宕机预警</span>';
      if (p.equip) st += `<span class="eq">${EQ_ICON[p.equip.k] || "🧰"} ${CD[p.equip.k].name}</span>`;
      h.querySelector(".status").innerHTML = st;
      const sd = h.querySelector(".side"), lab = sideLabel(p);
      sd.className = "side" + (lab ? " " + lab.cls : ""); sd.textContent = lab ? lab.text : "";
    }
    $("#deck").textContent = g.deck.length;
    $("#round").textContent = g.round;
    renderHand();
    renderSkills();
  }

  function renderHand() {
    const me = g.human, box = $("#hand");
    const n = me.hand.length;
    const existing = {};
    for (const e of [...box.children]) existing[e.dataset.id] = e;
    const hw = HAND_W / HS;
    const step = n > 1 ? Math.min(CARD_W + 10, (hw - CARD_W) / (n - 1)) : 0;
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
    let ki = 0;
    for (const s of g.activeSkills(me)) {
      const left = s.left != null ? `（${s.left}）` : "";
      const b = el("button", "btn small" + (skillMode === s.id ? " primary" : ""), `${s.name}${left}` + (SET().keys && ki < 3 ? `<kbd>${"QWE"[ki]}</kbd>` : ""));
      ki++;
      b.title = s.desc;
      b.disabled = !(mode === "play" && !busy && s.can);
      b.onclick = (ev) => { ev.stopPropagation(); onSkillBtn(s); };
      box.appendChild(b);
    }
    if (!box.children.length) box.appendChild(el("div", "passive", me.ch.skills.map((s) => `【${s.name}】`).join(" ") + "（被动，自动生效）"));
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
    m.innerHTML = `<img src="${portrait(p.key, "avatar")}" alt=""><div class="mb"><div class="mw">${p.name}</div><div class="mt">${html}</div></div>`;
    $("#chat-list").appendChild(m); trimChat();
    Sound.sfx("plop", 0.35);
  }
  function sys(text, cls) { const m = el("div", "sys" + (cls ? " " + cls : ""), text); $("#chat-list").appendChild(m); trimChat(); }

  // ---------------------------------------------------------------- 表情与说话
  function expr(p, e, ms) {
    const img = heroes[p.i] && heroes[p.i].querySelector(".por img");
    if (!img) return;
    img.src = portrait(p.key, e);
    heroes[p.i].querySelector(".por").animate([{ transform: "translateX(-50%) scale(1.06)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 220, easing: "ease-out" });
    clearTimeout(exprTimers[p.i]);
    if (ms && p.alive) exprTimers[p.i] = setTimeout(() => { if (p.alive && g) img.src = portrait(p.key, "base"); }, ms);
  }
  const HURT_KEYS = ["hurt", "out", "stolen", "fury", "halluc"], SMUG_KEYS = ["attack", "win", "ban", "reset", "buy", "steal", "steal_claude", "fans", "recall",
    "polish", "zuiying", "beg", "beg_gpt", "beg_claude", "claw", "dad", "maint", "long", "busy", "fed", "think", "sis", "search", "know", "sorry", "bundle", "sale"];
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
    if (HURT_KEYS.includes(key)) expr(p, "hurt", key === "out" ? 0 : 1600);
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
    c.innerHTML = `<img src="${portrait(p.key, "smug")}" alt=""><div class="ct2">${p.name} 发动技能</div><div class="ct1">${name}</div>`;
    $("#fx").appendChild(c); setTimeout(() => c.remove(), 1300 * Engine.speed + 100);
  }
  function skillNote(p, name) { Sound.sfx("chime", 0.5); floatText(p, `【${name}】`, "heal"); sync(); }
  function banner(text) { const b = el("div", "banner", text); $("#fx").appendChild(b); setTimeout(() => b.remove(), 950); }

  // ---------------------------------------------------------------- 玩家：出牌阶段
  function humanPlay(p) {
    mode = "play"; selected = null; skillMode = null;
    const how = SET().click === 1 ? "点牌直接出，要选目标的再点对手，或把牌拖到她身上。" : "点两下出牌，或把牌拖出去；要选目标的拖到对手身上。";
    hint((p.dumb ? "你降智了，不能【吐槽】。" : "轮到你了！") + how + (SET().keys ? '<small class="kb"><br>数字键选牌 · 空格结束回合</small>' : ""));
    Sound.sfx("chime", 0.5);
    sync();
    checkAutoEnd(1600);
    return new Promise((res) => { playResolve = res; });
  }
  function endPlay() {
    if (!playResolve) return;
    const r = playResolve; playResolve = null; mode = null; selected = null; skillMode = null; clearTimeout(autoT);
    clearTargets(); hint(""); sync(); r();
  }
  function checkAutoEnd(ms) {
    clearTimeout(autoT);
    if (!SET().autoEnd || mode !== "play" || busy || anyMove()) return;
    hint("没有能出的牌、也没有能用的技能了，马上自动结束回合……");
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
    try { await fn(); } finally { busy = false; }
    selected = null; skillMode = null;
    if (!g || g.over || !g.human.alive) { endPlay(); return; }
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
      skillMode = s.id; showTargets(ts); hint(`【${s.name}】👉 ${s.id === "bundle" ? "点一位角色，送她一张牌" : "点一位对手"}${SET().keys ? "（或按她头上的数字）" : ""}<br><small>${s.desc}</small>`); sync();
      return;
    }
    act(() => g.doSkill(me, s.id, {}));
  }
  function onHeroClick(p) {
    if (performance.now() - suppressClick < 350) return;
    if (mode !== "play" || busy || p.human || !p.alive) return;
    const me = g.human;
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
    const btns = [[`打出${d.name}`, () => finishRespond({ card: opt.cards[0] }), true], ["不出", () => finishRespond(null)]];
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
      if (game.mode === "team") { title = won ? "你们赢了！" : "对面赢了……"; sub = won ? "队友配合完美。" : "下次换个打法再来！"; }
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
    $("#modal-body").innerHTML = `<div class="result"><img src="${portrait(w.key, "smug")}" alt="">
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
      if (!g || e.target.closest(".card, .hero, button, #prompt, #ctip, #chat, #actions")) return;
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
      return;
    }
    if (!SET().keys && e.key !== "Escape") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const n = /^[1-9]$/.test(k) ? +k : 0;
    const me = g.human;
    const promptBtn = (i) => { const b = $("#prompt-btns").children[i]; if (b && !$("#prompt").classList.contains("hidden")) { b.click(); return true; } return false; };
    let done = true;
    if (promptKind === "choose") {
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
    humanPlay, humanRespond, humanDiscard, humanPick, humanConfirm, humanChoose, gameOver, bindButtons, cardEl, portrait, expr };
})();
