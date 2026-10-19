// 《AI娘对线》规则引擎：回合流程、卡牌结算、角色技能。UI 和 AI 通过 game.ui / window.AI 接入。
window.Engine = (function () {
  const D = window.GAME_DATA, CH = D.chars, CD = D.cards;
  const E = { speed: 1 };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * E.speed));
  const rnd = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const BIGS = ["gpt", "claude"];
  // 技能数值表（平衡都在这里调；sim.js 可以用 TUNE 覆盖）
  const T = Object.assign({
    hand: { kimi: 2, xds: 1, gpt: 2, gemini: 2, qwen: 1 },                    // 手牌上限加成
    extraDraw: {},                                        // 每回合多摸
    searchLook: 5, knowLook: 5,                           // Gemini 搜索：看几张；博闻：翻几张找反驳
    sorryDraw: 3,                                         // 豆包 嘻嘻抱歉：做错事摸几张
    grokStart: 1, grokFloor: 2,                           // 千金：开局多拿；回合开始补到几张
    thinkLook: 4, thinkKeep: 3, thinkQuick: 3, quickAt: -1, // 大 DeepSeek 深思
    polishDraw: 2,                                        // Claude 润色：弃 1 摸几张
    zuiyingCost: 1,                                       // GPT 嘴硬：弃几张硬顶
    busyRate: 0.12,                                       // 小 DeepSeek 服务器繁忙
    begBonus: 0, begFondBest: true,                                        // 小 DeepSeek 蹭饭：从 GPT/Claude 那里额外摸
    halluc: [0.55, 0.35, 0.05, 0.05], hallucCost: 0,      // 豆包 幻觉：摸 2 / 随机对手 −1 / 全体摸 1 / 自己 −1；要弃几张
    buyN: 1, buyCost: 0,                                  // Grok 挥金
    stealAll: false, stealN: 1, stealClaude: 2,           // GLM 借鉴
    fansN: 1, fansLow: 2, fans: { doubao: [2, 2] },       // 豆包 应援：[摸, 只剩 1 点心态时摸]
    longCost: 1,                                          // 豆包 长篇大论
    recallKinds: ["tucao", "fanbo", "naicha"],            // Kimi 过目
    teamFirstDraw: 3,                                     // 2v2：先手第一回合摸几张
    rageRound: 3,                                         // 从第几轮起每回合能吐槽两次
    bombRate: 0.15, bombDmg: 2, firewallRate: 0.3, powerbank: 2,
    qingkeCost: 1, qingkeDraw: 1,                         // 千问·请客：弃几张、送给别人时摸几张
    banterRate: 0.35, chatterRate: 0.22,                  // 每轮开头随机斗嘴的概率；有人破防时路人在群里起哄的概率   // 宕机：每次检查爆的概率、伤害；防火墙拦截率；充电宝手牌上限
    bundleLook: 3, bundleKeep: 2, bundleRival: false,     // 千问·全家桶：亮出几张、自己留几张、送牌是否只能送对手
    bundleRandom: true,                                   // 千问·全家桶：剩下那张随机送人（不用选目标）
    saleDraw: 1, saleExtra: 1, saleChop: false,           // 千问·狂欢：开的时候摸几张；吐槽多几次（null = 不限）；回合结束是否弃光手牌（剁手）
  }, window.TUNE || {});
  // 抢群主的四种身份（内部 id 沿用 lord/loyal/rebel/spy）
  // 人物关系：ally 盟友 / friend 交好 / rival 宿敌（data.js 的 relations）
  const REL = {};
  for (const [a, b, t] of (window.GAME_DATA.relations || [])) { REL[a + "|" + b] = t; REL[b + "|" + a] = t; }
  const CHATTER = ["哈哈哈哈哈", "🍿 吃瓜中", "前排围观", "+1", "好家伙", "截图了截图了", "这波可以"];
  const ROLE = { lord: "群主", loyal: "管理员", rebel: "黑粉", spy: "潜水党" };
  const ROLE_LEAN = { lord: 10, loyal: 5, rebel: -5, spy: 0 };
  const SN = (key, id) => { const s = CH[key].skills.find((x) => x.id === id); return s ? s.name : id; };

  function buildDeck() {
    const deck = []; let id = 1;
    for (const k in CD) for (let i = 0; i < CD[k].n; i++) deck.push({ id: id++, k });
    return shuffle(deck);
  }

  class Game {
    constructor(keys, ui, opts = {}) {
      this.ui = ui;
      // 模式：ffa 三人乱斗 / duel 单挑 / team 2v2 / id5 五人「抢群主」
      this.mode = opts.mode || (keys.length === 2 ? "duel" : "ffa");
      this.players = keys.map((key, i) => ({
        i, key, ch: CH[key], name: CH[key].name, hp: CH[key].hp, maxHp: CH[key].hp, hand: [], alive: true,
        human: i === 0, muted: false, banned: false, dumb: false, tucao: 0, used: {}, uses: {}, hits: {},
        equip: null, boost: false, offline: false, evidence: null, grudge: {}, saidLow: false,
        stats: { dmg: 0, taken: 0, used: 0 },
      }));
      for (const p of this.players) for (const s of p.ch.skills) if (s.uses) p.uses[s.id] = keys.length === 2 && s.uses2p != null ? s.uses2p : s.uses;
      for (const p of this.players) { p.game = this; p.lean = 0; }
      if (this.mode === "team") { const T2 = opts.teams || [0, 1, 1, 0]; for (const p of this.players) p.team = T2[p.i]; }   // 默认座位：你-敌-敌-友
      if (this.mode === "id5") {
        const roles = opts.roles || shuffle(["lord", "loyal", "rebel", "rebel", "spy"]);
        this.players.forEach((p, i) => { p.role = roles[i]; });
        const lord = this.players.find((p) => p.role === "lord");
        lord.hp++; lord.maxHp++; lord.lean = 10;                  // 群主多 1 点心态，身份公开
      }
      this.deck = buildDeck(); this.discard = []; this.bomb = null;     // bomb：场上的【宕机】{ holder, card }
      this.startIdx = this.mode === "id5" ? this.players.find((p) => p.role === "lord").i : 0;
      this.cur = this.startIdx; this.round = 1; this.over = false; this.outOrder = [];
    }
    // ---------------------------------------------------------------- 敌友
    // p 眼里 q 有多像敌人：> 0 才会对她出手。身份局里靠 lean（越正越像主公这边）猜
    hostility(p, q) {
      if (p === q || !q.alive) return -99;
      if (this.mode === "team") return p.team === q.team ? -99 : 1;
      if (this.mode !== "id5") {
        // 乱斗 / 单挑：盟友在还有别人时不互相出手；宿敌优先，交好的下手轻一点
        const r = this.relation(p, q);
        if (r === "ally") return this.alive().some((x) => x !== p && x !== q && this.relation(p, x) !== "ally") ? -1 : 1;
        return (r === "rival" ? 1.6 : r === "friend" ? 0.5 : 1) + (p.grudge[q.i] || 0);
      }
      const lean = (r) => r.role === "lord" ? 10 : r.revealed ? ROLE_LEAN[r.role] : r.lean;
      if (p.role === "lord" || p.role === "loyal") return q.role === "lord" ? -99 : -lean(q);
      if (p.role === "rebel") return q.role === "lord" ? 3 : lean(q) > 0.5 ? lean(q) * 0.6 : -1;
      // 潜水党：先帮群主清黑粉，黑粉没了再打管理员，最后单挑群主
      const left = this.alive().filter((r) => r !== p);
      if (q.role === "lord") return left.length === 1 ? 3 : -99;
      return this.alive().some((r) => r.role === "rebel") ? -lean(q) : 1.5;
    }
    foesOf(p, list) { return list.filter((q) => this.hostility(p, q) > 0); }
    relation(p, q) { return p && q ? REL[p.key + "|" + q.key] || null : null; }
    // 关系网里的人：盟友在前，交好在后
    friendsOf(t) { return this.players.filter((q) => q !== t && (this.relation(q, t) === "ally" || this.relation(q, t) === "friend")).sort((a, b) => (this.relation(b, t) === "ally") - (this.relation(a, t) === "ally")); }
    // 抢群主：谁对群主这边下手，就更像黑粉；打黑粉的更像管理员
    noteHostile(a, b, w) {
      if (this.mode !== "id5" || !a || !b || a === b || a.role === "lord" || a.revealed) return;
      const lb = b.role === "lord" ? 10 : b.revealed ? ROLE_LEAN[b.role] : b.lean;
      if (lb > 0.3) a.lean -= w * (b.role === "lord" ? 2 : 1);
      else if (lb < -0.3) a.lean += w;
      a.lean = Math.max(-6, Math.min(6, a.lean));
    }
    get human() { return this.players[0]; }
    alive() { return this.players.filter((p) => p.alive); }
    others(p) { return this.players.filter((q) => q.alive && q !== p); }
    has(p, k) { return p.hand.filter((c) => c.k === k); }
    hasSkill(p, id) { return p.ch.skills.some((s) => s.id === id); }
    limitTucao(p) { const base = 1 + (this.round >= T.rageRound ? 1 : 0) + (p.equip && p.equip.k === "xianka" ? 1 : 0); return p.dumb ? 0 : p.sale ? (T.saleExtra == null ? 99 : base + T.saleExtra) : base; }
    handLimit(p) { return Math.max(0, p.hp) + (T.hand[p.key] || 0) + (p.equip && p.equip.k === "chongdianbao" ? T.powerbank : 0); }
    // 一个人的“牌”（手牌 + 装备），白嫖 / 撤回从里面随机挑
    cardsOf(t) { return t.equip ? [...t.hand, t.equip] : t.hand.slice(); }
    takeAny(t, c) { if (c === t.equip) t.equip = null; else this.takeFromHand(t, c); }
    doubaoHere() { return this.players.some((q) => q.key === "doubao" && q.alive); }

    // ---------------------------------------------------------------- 牌堆
    drawCards(p, n) {
      const got = [];
      for (let i = 0; i < n; i++) {
        if (!this.deck.length) {
          if (!this.discard.length) break;
          this.deck = shuffle(this.discard); this.discard = [];
          this.ui.sys("牌堆用完，弃牌洗回牌堆");
        }
        got.push(this.deck.pop());
      }
      p.hand.push(...got);
      return got;
    }
    async draw(p, n, quiet) {
      const got = this.drawCards(p, n);
      if (got.length) { this.ui.drawAnim(p, got.length); if (!quiet) this.ui.sys(`${p.name} 摸了 ${got.length} 张牌`); }
      this.ui.sync();
      await wait(260);
      return got;
    }
    takeFromHand(p, card) {
      const i = p.hand.findIndex((c) => c.id === card.id);
      if (i >= 0) p.hand.splice(i, 1);
      return card;
    }
    toDiscard(card) { this.discard.push(card); }

    // ---------------------------------------------------------------- 主循环
    async run() {
      for (const p of this.players) this.drawCards(p, 4 + (p.key === "grok" ? T.grokStart : 0));
      this.ui.sync();
      this.ui.sys("群聊已创建，开始对线！", "good");
      if (this.mode === "ffa" || this.mode === "duel") {                // 乱斗里先说清楚谁和谁是盟友
        const has = (k) => this.players.some((q) => q.key === k);
        for (const [a, b, t, note] of (window.GAME_DATA.relations || [])) if (t === "ally" && has(a) && has(b)) this.ui.sys(`🤝 ${note}`, "good");
      }
      // 开场台词一句接一句，等配音说完再轮到下一个（招呼最多等 2.2 秒、斗嘴 3 秒，免得拖慢开局）
      const talk = async (p, key, cap = 2200) => {
        const ms = +this.ui.say(p, key, true) || 0;
        await wait(700);
        const extra = Math.min(ms, cap) + 150 - 700 * E.speed;
        if (E.speed > 0 && extra > 0) await new Promise((r) => setTimeout(r, extra));
      };
      if (this.mode === "team") {
        const me = this.players[0], mate = this.players.find((p) => p !== me && p.team === me.team), foe = this.players.filter((p) => p.team !== me.team);
        this.ui.sys(`2v2：你和 ${mate.name} 一队，打败 ${foe.map((p) => p.name).join(" 和 ")}！`, "good");
      }
      if (this.mode === "id5") {
        const lord = this.players.find((p) => p.role === "lord");
        this.ui.sys(`抢群主：群主是 ${lord.name}${lord.human ? "（就是你）" : ""}。你的身份是【${ROLE[this.players[0].role]}】`, "good");
      }
      for (const p of this.players) await talk(p, "greet", this.players.length >= 4 ? 1500 : 2200);
      const by = (k) => this.players.find((q) => q.key === k);
      this.banterUsed = new Set();
      const pairs = shuffle((window.GAME_DATA.pairs || []).filter(([a, , b]) => by(a) && by(b))).slice(0, this.players.length >= 4 ? 1 : 2);   // 人多时只斗一组，开场别拖太久
      for (const [a, ka, b, kb] of pairs) { this.banterUsed.add(a + ka); await talk(by(a), ka, 3000); await talk(by(b), kb, 3000); }
      this.talk = talk;
      this.cur = this.startIdx;
      while (!this.over) {
        const p = this.players[this.cur];
        if (p.alive) await this.turn(p);
        if (this.over) break;
        const next = this.nextAlive(this.cur), n = this.players.length;
        const d = (x) => (x - this.startIdx + n) % n;                 // 从先手（群主）开始数，转完一圈才算一轮
        if (d(next) <= d(this.cur)) {
          this.round++;
          if (Math.random() < T.banterRate) await this.banter();
          if (this.round === T.rageRound) {
            this.ui.banner("吵上头了！"); Sound.sfx("drumroll", 0.6); if (Sound.track) Sound.track("rage");
            this.ui.sys(`第 ${T.rageRound} 轮：大家吵上头了，从现在起每回合可以【吐槽】两次！`, "bad");
            await wait(1100);
          }
        }
        this.cur = next;
      }
    }
    // 中途斗嘴：挑一组还都在群里、这局没说过的
    async banter() {
      const by = (k) => this.players.find((q) => q.key === k && q.alive);
      const ok = (window.GAME_DATA.pairs || []).filter(([a, ka, b]) => by(a) && by(b) && !this.banterUsed.has(a + ka));
      if (!ok.length || !this.talk) return;
      const [a, ka, b, kb] = ok[rnd(ok.length)];
      this.banterUsed.add(a + ka);
      await this.talk(by(a), ka, 2600); await this.talk(by(b), kb, 2600);
    }
    nextAlive(i) {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (this.players[j].alive) return j; }
      return i;
    }

    async turn(p) {
      p.tucao = 0; p.used = {}; p.hits = {}; p.dumb = false; p.sale = false; p.boost = false; p.evidence = null;
      this.ui.setTurn(p); this.ui.sync();
      this.ui.phase(`${p.name} 的回合`);
      await wait(300);
      if (this.bomb && this.bomb.holder === p) { await this.bombCheck(p); if (this.over || !p.alive) return; }
      if (p.banned) {                                       // Claude 的封号：整回合跳过
        p.banned = false; this.ui.sync();
        this.ui.sys(`${p.name} 的账号被封，这回合跳过`, "bad"); this.ui.say(p, "hurt", true);
        await wait(1000);
        return;
      }
      if (p.key === "grok" && p.hand.length < T.grokFloor) {          // Grok 千金：爸爸送的
        this.ui.skillNote(p, SN("grok", "rich")); this.ui.say(p, "dad", true);
        await this.draw(p, T.grokFloor - p.hand.length, true);
        this.ui.log(p, `【${SN("grok", "rich")}】爸爸又送来了一点`);
      }
      // 摸牌（断网了就不摸）
      const cut = p.offline;
      if (cut) {
        p.offline = false; this.ui.sync();
        this.ui.sys(`${p.name} 断网了，这回合摸不到牌`, "bad"); this.ui.say(p, "hurt"); await wait(700);
      } else if (p.key === "deepseek") await this.deepThink(p);
      else {
        const first = this.mode === "team" && this.round === 1 && p.i === this.startIdx;   // 2v2 先手第一回合多摸 1 张（你-敌-敌-友 座位下两队五五开）
        await this.draw(p, (first ? T.teamFirstDraw : 2) + (T.extraDraw[p.key] || 0), true);
      }
      if (!cut) this.ui.sys(`${p.name} 摸牌`);
      if (this.over) return;
      // 出牌
      if (p.muted) {
        p.muted = false; this.ui.sync();
        this.ui.sys(`${p.name} 被禁言了，跳过出牌`, "bad"); this.ui.say(p, "hurt");
        await wait(900);
      } else if (p.human) {
        this.ui.phase(p.dumb ? "你降智了：这回合不能吐槽" : "你的出牌阶段");
        await this.ui.humanPlay(p);
      } else {
        await this.aiPlay(p);
      }
      if (this.over || !p.alive) return;
      if (p.sale && T.saleChop && p.hand.length) {          // 千问·狂欢之后剁手：弃光手牌
        const n = p.hand.length;
        for (const c of p.hand.splice(0)) this.toDiscard(c);
        this.ui.log(p, `【${SN("qwen", "sale")}】买买买之后——剁手，弃光了 ${n} 张手牌`); this.ui.sync(); await wait(500);
      }
      // 弃牌
      const lim = this.handLimit(p);
      if (p.hand.length > lim) {
        const n = p.hand.length - lim;
        const ids = p.human ? await this.ui.humanDiscard(p, n) : AI.discard(this, p, n);
        for (const id of ids) { const c = p.hand.find((x) => x.id === id); if (c) { this.takeFromHand(p, c); this.toDiscard(c); } }
        this.ui.sys(`${p.name} 弃了 ${ids.length} 张牌`);
        this.ui.sync(); await wait(250);
      }
      p.dumb = false; p.grudge = {};
      this.ui.sync();
      await wait(200);
    }

    async deepThink(p) {
      const top = [], quick = p.hand.length <= T.quickAt, n = quick ? T.thinkQuick : T.thinkKeep;   // 简单任务快速：手牌少时多留 1 张
      for (let i = 0; i < T.thinkLook; i++) { if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; } if (this.deck.length) top.push(this.deck.pop()); }
      this.ui.skillNote(p, SN("deepseek", "think"));
      if (Math.random() < 0.35) this.ui.say(p, "think");
      let keep;
      if (p.human) keep = await this.ui.humanPick(top, Math.min(n, top.length), `${SN("deepseek", "think")}：牌堆顶 ${top.length} 张，留下 ${n} 张`);
      else keep = AI.pick(this, p, top, Math.min(n, top.length));
      for (const c of top) { if (keep.includes(c)) p.hand.push(c); else this.deck.unshift(c); }
      this.ui.drawAnim(p, keep.length); this.ui.sync();
      await wait(300);
    }

    async aiPlay(p) {
      await wait(450);
      for (let guard = 0; guard < 24 && !this.over && p.alive; guard++) {
        const act = AI.choose(this, p);
        if (!act) break;
        if (act.skill) await this.doSkill(p, act.skill, act);
        else await this.useCard(p, act.card, act.targets);
        await wait(460);
      }
    }

    // ---------------------------------------------------------------- 能不能用
    // 能被点名的人：2v2 里不能对自己队友出手（单体牌和技能都是坑人的）
    rivals(p) { return this.mode === "team" ? this.others(p).filter((q) => q.team !== p.team) : this.others(p); }
    canUse(p, c) {
      const d = CD[c.k];
      if (d.target === "response") return false;
      if (c.k === "tucao") return p.tucao < this.limitTucao(p) && this.rivals(p).length > 0;
      if (c.k === "naicha") return p.hp < p.maxHp;
      if (c.k === "baipiao" || c.k === "chehui") return this.rivals(p).some((q) => q.hand.length > 0 || q.equip);
      if (c.k === "jiaban") return !p.boost;
      if (c.k === "dangji") return !this.bomb;
      if (c.k === "pindan") return this.deck.length + this.discard.length > 0;
      if (d.target === "one") return this.rivals(p).length > 0;
      return true;
    }
    targetsFor(p, c) {
      if (c.k === "baipiao" || c.k === "chehui") return this.rivals(p).filter((q) => q.hand.length > 0 || q.equip);
      return this.rivals(p);
    }

    // ---------------------------------------------------------------- 出牌
    async useCard(p, card, targets = []) {
      if (!p.hand.find((c) => c.id === card.id)) return;
      const d = CD[card.k];
      this.takeFromHand(p, card);
      p.stats.used++;
      for (const t of targets) { p.hits[t.i] = (p.hits[t.i] || 0) + 1; this.noteHostile(p, t, 0.5); }
      if (card.k === "tucao") p.tucao++;
      this.ui.sync();
      const tnames = targets.map((t) => t.name).join("、");
      if (d.target === "one") this.ui.log(p, `对 ${tnames} 使用了<b>【${d.name}】</b>`);
      else this.ui.log(p, `使用了<b>【${d.name}】</b>`);
      if (card.k === "tucao") {
        const t = targets[0], special = t && p.ch.lines[t.key] && this.relation(p, t) === "rival" && Math.random() < 0.5;
        this.ui.say(p, special ? t.key : "attack");
      }
      else if (card.k === "naicha" || card.k === "tuanjian") this.ui.say(p, "heal");
      else if (Math.random() < 0.4) this.ui.say(p, "trick");
      await this.ui.showCard(p, card, targets);
      if (d.type !== "equip" && card.k !== "dangji") this.toDiscard(card);
      await this.resolve(p, card, targets);
      this.ui.sync();
      this.checkOver();
    }

    async resolve(p, card, targets) {
      switch (card.k) {
        case "tucao": {
          const boost = p.boost; p.boost = false;                 // 加班只管下一张吐槽
          for (const t of targets) { if (this.over) break; if (t.alive) await this.tucao(p, t, boost); }
          break;
        }
        case "naicha": p.hp = Math.min(p.maxHp, p.hp + 1); this.ui.heal(p, 1); Sound.sfx("slurp"); await wait(450); break;
        case "hongbao": Sound.sfx("coin"); await this.draw(p, 2); break;
        case "baipiao": {
          const t = targets[0]; if (!t || !t.alive || !this.cardsOf(t).length) break;
          if (await this.protect(t, p, card)) break;
          const pool = this.cardsOf(t), c = pool[rnd(pool.length)], eq = c === t.equip;
          this.takeAny(t, c); p.hand.push(c);
          this.ui.steal(t, p, c); Sound.sfx("paper");
          this.ui.sys(eq ? `${p.name} 白嫖了 ${t.name} 的装备【${CD[c.k].name}】` : `${p.name} 白嫖了 ${t.name} 的一张牌`); await wait(450); break;
        }
        case "chehui": {
          const t = targets[0]; if (!t || !t.alive || !this.cardsOf(t).length) break;
          if (await this.protect(t, p, card)) break;
          const pool = this.cardsOf(t), c = pool[rnd(pool.length)]; this.takeAny(t, c); this.toDiscard(c);
          Sound.sfx("whoosh_little"); this.ui.sys(`${t.name} 的【${CD[c.k].name}】被撤回了`); this.ui.sync(); await wait(450); break;
        }
        case "dantiao": {
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          Sound.sfx("boing");
          let a = t, b = p;
          for (let k = 0; k < 30 && !this.over; k++) {
            const ok = await this.ask(a, "tucao", { from: b, card, duel: true });
            if (!ok) { await this.damage(b, a, 1); break; }
            [a, b] = [b, a];
          }
          break;
        }
        case "resou": case "shuaping": {
          const need = card.k === "resou" ? "tucao" : "fanbo";
          Sound.sfx(card.k === "resou" ? "whoosh_cartoon" : "notify");
          let j = p.i;
          for (let k = 0; k < this.players.length - 1 && !this.over; k++) {
            j = (j + 1) % this.players.length;
            const t = this.players[j];
            if (!t.alive || t === p) continue;
            if (await this.protect(t, p, card)) continue;
            const ok = await this.ask(t, need, { from: p, card });
            if (!ok) await this.damage(p, t, 1);
          }
          break;
        }
        case "tuanjian":
          Sound.sfx("cheer", 0.6);
          for (const q of this.alive()) if (q.hp < q.maxHp) { q.hp++; this.ui.heal(q, 1); }
          this.ui.sys("团建！所有人心态 +1", "good"); await wait(600); break;
        case "jinyan": {
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          t.muted = true; Sound.sfx("stamp"); this.ui.sys(`${t.name} 被禁言了（跳过下个出牌阶段）`, "bad"); this.ui.sync(); await wait(450); break;
        }
        case "jiaban":
          p.boost = true; Sound.sfx("ding2", 0.6);
          this.ui.sys(`${p.name} 开始加班：下一张【吐槽】打中心态多扣 1 点`); this.ui.sync(); await wait(400); break;
        case "pindan": {
          // 拼单：亮出“每人一张”，从出牌的人开始轮流挑
          const pool = [];
          for (let i = 0; i < this.alive().length; i++) { if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; } if (this.deck.length) pool.push(this.deck.pop()); }
          Sound.sfx("mixdeck", 0.6); this.ui.sys(`${p.name} 发起拼单：亮出 ${pool.length} 张，大家依次挑一张`, "good"); await wait(500);
          for (let k = 0; k < this.players.length && pool.length && !this.over; k++) {
            const q = this.players[(p.i + k) % this.players.length];
            if (!q.alive) continue;
            const pick = q.human ? (await this.ui.humanPick(pool.slice(), 1, `拼单：还剩 ${pool.length} 张，挑 1 张`))[0] : AI.pick(this, q, pool, 1)[0];
            if (!pick) continue;
            pool.splice(pool.indexOf(pick), 1); q.hand.push(pick); this.ui.drawAnim(q, 1);
            this.ui.log(q, `拼单拿走了【${CD[pick.k].name}】`); this.ui.sync(); await wait(300);
          }
          for (const c of pool) this.toDiscard(c);
          break;
        }
        case "duanwang": {
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          t.offline = true; Sound.sfx("glitch_vhs", 0.6); this.ui.sys(`${t.name} 断网了（跳过下个摸牌阶段）`, "bad"); this.ui.sync(); await wait(450); break;
        }
        case "dangji":
          this.bomb = { holder: p, card }; Sound.sfx("tick", 0.7);
          this.ui.sys(`${p.name} 的服务器开始冒烟……【宕机】每回合开始检查一次，没炸就往下传`, "bad"); this.ui.sync(); await wait(500); break;
        case "jietu": {
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          p.evidence = t; Sound.sfx("pop_small", 0.7);
          this.ui.sys(`${p.name} 截图留证：这回合 ${t.name} 挡不了她的【吐槽】`); this.ui.sync(); await wait(400); break;
        }
        case "xianka": case "fanghuoqiang": case "chongdianbao": {
          if (p.equip) { this.toDiscard(p.equip); this.ui.sys(`${p.name} 换下了【${CD[p.equip.k].name}】`); }
          p.equip = card; Sound.sfx("ding", 0.6);
          this.ui.sys(`${p.name} 装备了【${CD[card.k].name}】`, "good"); this.ui.sync(); await wait(400); break;
        }
      }
    }

    // 锦囊生效前：目标可以打【已读不回】
    async protect(t, from, card) {
      if (!this.has(t, "yidu").length) return false;
      const ok = await this.ask(t, "yidu", { from, card });
      if (ok) { this.ui.sys(`${t.name}：已读不回。【${CD[card.k].name}】对她无效`); await wait(300); }
      return ok;
    }

    // 【宕机】轮到持有人时检查：炸了掉 2 点心态（可以用【已读不回】躲过，躲过就往下传）
    async bombCheck(p) {
      const card = this.bomb.card;
      Sound.sfx("tick", 0.5); await wait(400);
      if (Math.random() < T.bombRate && !(await this.protect(p, p, card))) {
        this.bomb = null; this.toDiscard(card);
        Sound.sfx("bomb", 0.8); this.ui.banner("宕机了！");
        this.ui.sys(`${p.name} 的服务器宕机了！心态 −${T.bombDmg}`, "bad"); await wait(600);
        await this.damage(null, p, T.bombDmg);
        return;
      }
      const nx = this.players[this.nextAlive(p.i)];
      this.bomb.holder = nx;
      this.ui.sys(`【宕机】这次没炸，传给了 ${nx.name}`); this.ui.sync(); await wait(400);
    }
    // 防火墙：被吐槽又没挡住时，按概率拦下
    async firewall(t, p) {
      if (!t.equip || t.equip.k !== "fanghuoqiang" || !t.alive) return false;
      const ok = Math.random() < T.firewallRate;
      this.ui.log(t, ok ? "【防火墙】拦截成功！这次吐槽没进来" : "【防火墙】没拦住……");
      if (ok) { Sound.sfx("stamp_thick", 0.6); this.ui.skillNote(t, "防火墙"); }
      await wait(ok ? 600 : 300);
      return ok;
    }

    async tucao(p, t, boost = false, depth = 0) {
      // 小 DeepSeek：服务器繁忙
      if (t.key === "xds" && Math.random() < T.busyRate) {
        this.ui.skillNote(t, SN("xds", "busy")); this.ui.say(t, "busy", true); Sound.sfx("boing", 0.5);
        this.ui.sys(`${t.name}：当前服务器繁忙，这次吐槽无效`); await wait(800);
        await this.sorry(p); return;
      }
      const caught = p.evidence === t;                           // 截图：挡不了、也甩不了
      // 甩锅：转给别人（不能甩回给吐槽你的人；2v2 只能甩给对手）
      if (!caught && depth < 4 && this.has(t, "shuaiguo").length) {
        const outs = this.rivals(t).filter((q) => q !== p);
        if (outs.length && await this.ask(t, "shuaiguo", { from: p, card: { k: "tucao" }, outs })) {
          const u = t.human ? await this.ui.humanChoose(outs, `【甩锅】甩给谁？`) : (AI.pickTarget(this, t, outs) || outs[0]);
          this.noteHostile(t, u, 0.5); Sound.sfx("whoosh_cartoon", 0.6);
          this.ui.sys(`${t.name} 甩锅！这次吐槽转给了 ${u.name}`, "bad"); await wait(450);
          return this.tucao(p, u, boost, depth + 1);
        }
      }
      let more = this.hasSkill(p, "long") ? 1 : 0;                   // 长篇大论（目前没人有）
      for (;;) {
        let ok = caught ? false : await this.ask(t, "fanbo", { from: p, card: { k: "tucao" } });
        if (caught && this.has(t, "fanbo").length) this.ui.log(t, "有截图……【反驳】不了");
        if (!ok) ok = await this.know(t, p);
        if (!ok) ok = await this.zuiying(t, p);
        if (!ok) ok = await this.firewall(t, p);
        if (!ok) {
          await this.damage(p, t, 1 + (boost ? 1 : 0));
          if (this.hasSkill(p, "claw") && p.alive) await this.claw(p, t);
          return;
        }
        await this.sorry(p);
        if (!more || this.over || !p.alive || !t.alive || !p.hand.length) return;
        more--;
        const go = p.human ? await this.ui.humanConfirm(`被挡住了。【${SN("doubao", "long")}】弃 ${T.longCost} 张牌接着再说一次？`) : AI.wantLong(this, p, t);
        if (!go) return;
        const c = p.human ? (await this.ui.humanPick(p.hand.slice(), 1, `${SN("doubao", "long")}：选一张牌弃掉`))[0] : p.hand.find((x) => x.id === AI.cheapest(this, p, 1)[0]);
        if (!c || !p.hand.includes(c)) return;
        this.takeFromHand(p, c); this.toDiscard(c); this.ui.sync();
        this.ui.skillNote(p, SN("doubao", "long")); this.ui.say(p, "long", true);
        this.ui.log(p, `【${SN("doubao", "long")}】还没说完，接着吐槽 ${t.name}`); await wait(600);
      }
    }
    // Gemini 博闻：没有反驳时翻牌堆顶几张，有反驳就拿来挡
    async know(t, p) {
      if (!this.hasSkill(t, "know") || !t.alive) return false;
      const top = [];
      for (let i = 0; i < T.knowLook; i++) { if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; } if (this.deck.length) top.push(this.deck.pop()); }
      const hit = top.find((c) => c.k === "fanbo");
      for (let i = top.length - 1; i >= 0; i--) if (top[i] !== hit) this.deck.push(top[i]);
      this.ui.skillNote(t, SN("gemini", "know"));
      if (!hit) { this.ui.log(t, `【${SN("gemini", "know")}】翻了 ${top.length} 张，这题没查到`); await wait(400); return false; }
      this.toDiscard(hit); this.ui.say(t, "know", true);
      this.ui.log(t, `【${SN("gemini", "know")}】这个我知道！翻出一张【反驳】挡住了`); await this.ui.showCard(t, hit, []);
      return true;
    }
    // 豆包 嘻嘻抱歉：做错事假装道歉，摸牌
    async sorry(p) {
      if (!this.hasSkill(p, "sorry") || !p.alive || this.over) return;
      this.ui.skillNote(p, SN("doubao", "sorry")); this.ui.say(p, "sorry", true);
      await this.draw(p, T.sorryDraw, true);
    }
    // GPT 嘴硬：没有反驳时弃牌硬顶
    async zuiying(t, p) {
      if (t.key !== "gpt" || !t.alive || t.used.zuiying || t.hand.length < T.zuiyingCost) return false;
      const go = t.human ? await this.ui.humanConfirm(`没有【反驳】……【${SN("gpt", "zuiying")}】弃 ${T.zuiyingCost} 张牌硬顶回去？`) : AI.wantZuiying(this, t, p);
      if (!go) return false;
      const picks = t.human ? await this.ui.humanPick(t.hand.slice(), T.zuiyingCost, `${SN("gpt", "zuiying")}：选 ${T.zuiyingCost} 张牌弃掉`)
        : AI.cheapest(this, t, T.zuiyingCost).map((id) => t.hand.find((x) => x.id === id));
      if (!picks || picks.length < T.zuiyingCost) return false;
      for (const c of picks) if (c && t.hand.includes(c)) { this.takeFromHand(t, c); this.toDiscard(c); }
      t.used.zuiying = true; this.ui.sync();
      this.ui.skillNote(t, SN("gpt", "zuiying")); this.ui.say(t, "zuiying", true);
      this.ui.log(t, `【${SN("gpt", "zuiying")}】弃了 ${T.zuiyingCost} 张牌，硬顶了回去`); await wait(600);
      return true;
    }
    // Gemini 猫爪：吐槽打中后扫掉一张
    async claw(p, t) {
      if (!t.alive || !t.hand.length) return;
      const c = t.hand[rnd(t.hand.length)]; this.takeFromHand(t, c); this.toDiscard(c);
      this.ui.skillNote(p, SN("gemini", "claw")); if (Math.random() < 0.5) this.ui.say(p, "claw");
      this.ui.sys(`${t.name} 的【${CD[c.k].name}】被猫爪扫掉了`); this.ui.sync(); await wait(400);
    }

    // 询问响应：kind = fanbo / tucao / yidu。返回是否打出
    async ask(p, kind, ctx) {
      if (!p.alive) return false;
      const cards = this.has(p, kind);
      if (!cards.length) {
        if (p.human && kind !== "yidu") { this.ui.toast(`没有【${CD[kind].name}】`); await wait(350); }
        return false;
      }
      let ans;
      if (p.human) ans = await this.ui.humanRespond(p, { kind, ctx, cards });
      else { await wait(360); ans = AI.respond(this, p, kind, ctx, cards); }
      if (!ans || !ans.card) return false;
      const card = p.hand.find((c) => c.id === ans.card.id);
      if (!card) return false;
      this.takeFromHand(p, card); this.toDiscard(card);
      this.ui.sync();
      this.ui.log(p, `打出<b>【${CD[kind].name}】</b>`);
      if (kind === "fanbo") this.ui.say(p, "dodge");
      if (kind === "tucao" && Math.random() < 0.6) this.ui.say(p, "attack");
      await this.ui.showCard(p, card, []);
      return true;
    }

    async damage(src, t, n) {
      if (!t.alive) return;
      this.noteHostile(src, t, 1);
      t.hp -= n; t.stats.taken += n; if (src) src.stats.dmg += n;
      this.ui.damage(t, n);
      if (t.hp === 1 && !t.saidLow && t.ch.lines.low) { t.saidLow = true; this.ui.say(t, "low", true); }
      else this.ui.say(t, "hurt", true);
      // 盟友护短：出声 + 记仇（她下个回合优先打出手的人）
      if (src && src !== t) for (const q of this.alive()) {
        if (q === t || q === src || this.relation(q, t) !== "ally" || this.relation(q, src) === "ally") continue;
        q.grudge[src.i] = (q.grudge[src.i] || 0) + 1.2;
        if (q.ch.lines.def && Math.random() < 0.6) setTimeout(() => this.ui.say(q, "def"), 900 * E.speed);
      }
      // 群里路人起哄（不配音，只发消息）
      const crowd = this.alive().filter((q) => q !== t && q !== src && !q.human);
      if (crowd.length && Math.random() < T.chatterRate) {
        const q = crowd[rnd(crowd.length)];
        const pool = src ? [...CHATTER, `这波我站 ${src.name}`, `${t.name} 稳住啊`] : ["服务器冒烟了哈哈哈", "宕机现场直播"];
        setTimeout(() => { if (!this.over) this.ui.log(q, pool[rnd(pool.length)]); }, 700 * E.speed);
      }
      this.ui.sys(`${t.name} 破防了！心态 -${n}`, "bad");
      await wait(650);
      if (t.hp <= 0) await this.dying(t, src);
      if (this.over || !t.alive) return;
      // 豆包：应援
      if (this.hasSkill(t, "fans")) {
        this.ui.skillNote(t, SN("doubao", "fans")); this.ui.say(t, "fans");
        const F = T.fans.doubao || [T.fansN, T.fansLow];
        await this.draw(t, t.hp <= 1 ? F[1] : F[0], true);
      }
      // 大 DeepSeek：气死本鱼——打她的人也得出反驳，不然一起破防
      if (t.key === "deepseek" && src && src !== t && src.alive && !this.over) {
        this.ui.skillNote(t, SN("deepseek", "fury")); this.ui.say(t, "fury", true);
        this.ui.log(t, `【${SN("deepseek", "fury")}】${src.name} 也别想好过`); await wait(500);
        const ok = await this.ask(src, "fanbo", { from: t, card: { k: "tucao" } });
        if (!ok) await this.damage(t, src, 1);
      }
    }

    async dying(t, src) {
      while (t.hp <= 0) {
        const tea = this.has(t, "naicha")[0];
        if (!tea) break;
        this.takeFromHand(t, tea); this.toDiscard(tea); t.hp++;
        this.ui.log(t, "心态崩了……赶紧喝了一杯<b>【奶茶】</b>");
        this.ui.heal(t, 1); Sound.sfx("slurp"); this.ui.say(t, "heal", true);
        await this.ui.showCard(t, tea, []);
      }
      if (t.hp > 0) { this.ui.sync(); return; }
      await this.eliminate(t, src);
    }

    async eliminate(t, src) {
      t.alive = false; t.hp = 0;
      for (const c of t.hand) this.toDiscard(c);
      t.hand = [];
      if (t.equip) { this.toDiscard(t.equip); t.equip = null; }
      if (this.bomb && this.bomb.holder === t) { this.toDiscard(this.bomb.card); this.bomb = null; }
      this.outOrder.push(t);
      this.ui.say(t, "out", true);
      this.ui.out(t);
      Sound.sfx("sadtrombone", 0.7);
      this.ui.sys(`${t.name} 破防退群了`, "bad");
      this.ui.sync();
      await wait(1100);
      if (src && src !== t && src.alive && src.ch.lines.ko && Math.random() < 0.7) { this.ui.say(src, "ko", true); await wait(900); }
      const mourner = this.friendsOf(t).find((q) => q.alive && q !== src && q.ch.lines.mourn && (this.relation(q, t) === "ally" || Math.random() < 0.5));
      if (mourner) { this.ui.say(mourner, "mourn", true); await wait(900); }
      // 乱斗里只剩一对盟友：协议到期，最后对决
      const left = this.alive();
      if ((this.mode === "ffa" || this.mode === "duel") && left.length === 2 && this.relation(left[0], left[1]) === "ally" && this.talk) {
        this.ui.banner("协议到期！"); this.ui.sys(`只剩 ${left[0].name} 和 ${left[1].name} 了——合作到此为止，最后的对决！`, "bad");
        const [a, b] = left[0].ch.lines.pact_end && !left[0].human ? left : [left[1], left[0]];
        if (a.ch.lines.pact_end) await this.talk(a, "pact_end", 3000);
        if (b.ch.lines.pact_end) await this.talk(b, "pact_end", 3000);
      }
      if (this.checkOver()) return;
      if (this.mode === "id5") { t.revealed = true; this.ui.sys(`${t.name} 的身份是【${ROLE[t.role]}】`, t.role === "rebel" ? "good" : "bad"); this.ui.sync(); }
      if (this.checkOver()) return;
      if (t.human && (this.mode === "team" || this.mode === "id5")) { this.ui.sys("你退群了，加速观战到结束……", "bad"); E.speed = Math.min(E.speed, 0.3); }
      if (!src || !src.alive || src === t) return;
      if (this.mode === "id5") {
        if (t.role === "rebel") { this.ui.sys(`${src.name} 踢出了一个黑粉：奖励摸 3 张`); await this.draw(src, 3, true); }
        else if (t.role === "loyal" && src.role === "lord") {
          this.ui.sys(`${src.name} 把自己的管理员踢了，弃光手牌！`, "bad");
          for (const c of src.hand) this.toDiscard(c);
          src.hand = []; this.ui.sync();
        }
        return;
      }
      this.ui.sys(`${src.name} 击退奖励：摸 2 张`); await this.draw(src, 2, true);
    }

    // 按模式判断有没有分出胜负：返回 { winners, side } 或 null
    result() {
      const alive = this.alive();
      if (this.mode === "team") {
        const teams = new Set(alive.map((p) => p.team));
        if (teams.size > 1) return null;
        const side = alive.length ? alive[0].team : 0;
        return { winners: this.players.filter((p) => p.team === side), side };
      }
      if (this.mode === "id5") {
        const lord = this.players.find((p) => p.role === "lord");
        if (!lord.alive) {
          if (alive.length === 1 && alive[0].role === "spy") return { winners: alive, side: "spy" };
          return { winners: this.players.filter((p) => p.role === "rebel"), side: "rebel" };
        }
        if (!alive.some((p) => p.role === "rebel" || p.role === "spy")) return { winners: this.players.filter((p) => p.role === "lord" || p.role === "loyal"), side: "lord" };
        return null;
      }
      if (this.human.alive && alive.length > 1) return null;
      const w = alive.length === 1 ? alive[0] : alive.sort((a, b) => b.hp - a.hp)[0];
      return { winners: [w], side: w && w.key };
    }
    checkOver() {
      if (this.over) return true;
      const res = this.result();
      if (!res) return false;
      this.over = true;
      this.winners = res.winners; this.side = res.side;
      this.winner = res.winners.find((p) => p.alive) || res.winners[0];
      if (this.mode === "id5") for (const p of this.players) p.revealed = true;
      setTimeout(() => this.ui.gameOver(this), 900);
      return true;
    }

    // ---------------------------------------------------------------- 主动技能
    // 返回 { id, name, desc, can, target: null | "opp" | "bigs" }
    activeSkills(p) {
      return p.ch.skills.filter((s) => s.type === "active").map((s) => ({ ...s, can: this.canSkill(p, s.id), left: p.uses[s.id], target: this.skillTarget(s.id, p) }));
    }
    skillTarget(id, p) {
      if (id === "ban" || id === "buy" || id === "beg" || id === "maint" || (id === "steal" && !T.stealAll)) return "opp";
      if (id === "qingke") return "self";                        // 千问请客：可以选自己
      if (id === "bundle") return T.bundleRandom ? null : "any";   // 千问送牌：队友、对手都能选（随机送时不用选）
      return null;
    }
    skillTargets(p, id) {
      if (id === "ban") return this.rivals(p).filter((q) => !q.banned);
      if (id === "maint") return this.rivals(p).filter((q) => !q.muted);
      if (id === "steal" || id === "buy" || id === "beg") return this.rivals(p).filter((q) => q.hand.length > 0);
      if (id === "bundle") return T.bundleRival ? this.rivals(p) : this.others(p);
      if (id === "qingke") return this.alive().filter((q) => q.hp < q.maxHp);
      return [];
    }
    canSkill(p, id) {
      if (!p.alive || p.used[id] || !this.hasSkill(p, id)) return false;
      if (id === "ban" || id === "maint") return (p.uses[id] || 0) > 0 && this.skillTargets(p, id).length > 0;
      if (id === "reset") return (p.uses.reset || 0) > 0;
      if (id === "steal" || id === "beg") return this.skillTargets(p, id).length > 0;
      if (id === "buy") return p.hand.length >= T.buyCost && this.skillTargets(p, id).length > 0;
      if (id === "polish") return p.hand.length > 0;
      if (id === "search") return this.deck.length + this.discard.length > 0;
      if (id === "bundle") return this.deck.length + this.discard.length > 0 && this.skillTargets(p, "bundle").length > 0;
      if (id === "sale") return (p.uses.sale || 0) > 0;
      if (id === "qingke") return (p.uses.qingke == null || p.uses.qingke > 0) && p.hand.length >= T.qingkeCost && this.skillTargets(p, "qingke").length > 0;
      if (id === "halluc") return p.hand.length >= T.hallucCost;
      if (id === "recall") return (p.uses.recall == null || p.uses.recall > 0) && this.discard.some((c) => T.recallKinds.includes(c.k));
      return false;
    }
    // 自己挑一张弃掉（人选 / 电脑弃最没用的）
    async pickOwn(p, title) {
      const c = p.human ? (await this.ui.humanPick(p.hand.slice(), 1, title))[0] : p.hand.find((x) => x.id === AI.cheapest(this, p, 1)[0]);
      if (c && p.hand.includes(c)) { this.takeFromHand(p, c); this.toDiscard(c); return c; }
      return null;
    }
    async doSkill(p, id, act = {}) {
      if (!this.canSkill(p, id)) return;
      let t = act.target;
      if (t && !this.skillTargets(p, id).includes(t)) t = null;
      if (!t && this.skillTarget(id, p)) t = (id === "bundle" ? AI.giftTarget(this, p) : id === "qingke" ? AI.treatTarget(this, p) : AI.richest(this.skillTargets(p, id), p)) || this.skillTargets(p, id)[0];
      if (this.skillTarget(id, p) && !t) return;
      p.used[id] = true;
      if (p.uses[id] != null) p.uses[id]--;
      if (t && id !== "bundle" && id !== "qingke") { p.hits[t.i] = (p.hits[t.i] || 0) + 1; this.noteHostile(p, t, 0.5); }   // 送牌 / 请客不算出手
      if (id === "ban") {
        t.banned = true;
        this.ui.skill(p, SN("claude", "ban")); this.ui.say(p, "ban", true); Sound.sfx("stamp_thick", 0.9);
        this.ui.log(p, `【${SN("claude", "ban")}】封了 ${t.name} 的号：她的下个回合跳过`);
        await wait(900);
      } else if (id === "polish") {
        const c = await this.pickOwn(p, `${SN("claude", "polish")}：选一张牌弃掉，摸 ${T.polishDraw} 张`);
        this.ui.skillNote(p, SN("claude", "polish")); this.ui.say(p, "polish", true);
        this.ui.log(p, `【${SN("claude", "polish")}】把【${c ? CD[c.k].name : "?"}】润色成了 ${T.polishDraw} 张新牌`);
        await this.draw(p, T.polishDraw, true); await wait(300);
      } else if (id === "reset") {
        this.ui.skill(p, SN("gpt", "reset")); this.ui.say(p, "reset", true); Sound.sfx("fanfare_short", 0.6);
        this.ui.log(p, `【${SN("gpt", "reset")}】额度重置，大家都有份！`);
        await wait(700);
        await this.draw(p, Math.max(0, 5 - p.hand.length), true);
        for (const q of this.others(p)) await this.draw(q, 1, true);
      } else if (id === "beg") {
        this.ui.skill(p, SN("xds", "beg")); this.ui.say(p, t.key === "gpt" ? "beg_gpt" : t.key === "claude" ? "beg_claude" : "beg", true);
        await wait(600);
        const fond = BIGS.includes(t.key);                       // GPT / Claude 最宠她：给好牌
        const c = t.human ? (await this.ui.humanPick(t.hand.slice(), 1, `${p.name} 来蹭饭了：选一张牌给她`))[0]
          : fond && T.begFondBest ? AI.pick(this, p, t.hand, 1)[0] : t.hand.find((x) => x.id === AI.cheapest(this, t, 1)[0]);
        if (c && t.hand.includes(c)) { this.takeFromHand(t, c); p.hand.push(c); this.ui.steal(t, p, c); }
        if (fond) { this.ui.say(t, "fed", true); if (T.begBonus) await this.draw(p, T.begBonus, true); }
        this.ui.log(p, `【${SN("xds", "beg")}】从 ${t.name} 那里蹭到一张牌` + (fond ? `（${t.name} 最宠她）` : ""));
        await wait(500);
      } else if (id === "halluc") {
        if (T.hallucCost) await this.pickOwn(p, `${SN(p.key, "halluc")}：选一张牌弃掉`);
        this.ui.skill(p, SN(p.key, "halluc")); this.ui.say(p, "halluc", true); await wait(700);
        const r = Math.random(), H = T.halluc, nm = `【${SN(p.key, "halluc")}】`;
        if (r < H[0]) { this.ui.log(p, `${nm}好像……真的变出来了！摸 2 张`); await this.draw(p, 2, true); }
        else if (r < H[0] + H[1]) {
          const os = this.rivals(p); const v = os[rnd(os.length)];
          this.ui.log(p, `${nm}说得太像真的，${v.name} 信了：心态 −1`); await this.damage(p, v, 1);
        } else if (r < H[0] + H[1] + H[2]) { this.ui.log(p, `${nm}给大家都发了一张牌`); for (const q of this.alive()) await this.draw(q, 1, true); }
        else { this.ui.log(p, `${nm}翻车了！自己心态 −1`); await this.damage(null, p, 1); await this.sorry(p); }
      } else if (id === "search") {
        const top = [];
        for (let i = 0; i < T.searchLook; i++) { if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; } if (this.deck.length) top.push(this.deck.pop()); }
        this.ui.skillNote(p, SN("gemini", "search")); this.ui.say(p, "search", true);
        const pick = p.human ? (await this.ui.humanPick(top, 1, `${SN("gemini", "search")}：牌堆顶 ${top.length} 张，挑 1 张拿走`))[0] : AI.pick(this, p, top, 1)[0];
        for (let i = top.length - 1; i >= 0; i--) { if (top[i] === pick) p.hand.push(top[i]); else this.deck.push(top[i]); }
        if (pick) this.ui.drawAnim(p, 1);
        this.ui.log(p, `【${SN("gemini", "search")}】搜了一下，找到了想要的牌`);
        await wait(400);
      } else if (id === "buy") {
        for (let k = 0; k < T.buyCost; k++) { const pay = p.hand.find((x) => x.id === AI.cheapest(this, p, 1)[0]); if (pay) { this.takeFromHand(p, pay); this.toDiscard(pay); } }
        this.ui.skill(p, SN("grok", "buy")); this.ui.say(p, "buy", true); Sound.sfx("coin", 0.8);
        await wait(500);
        const bn = Math.min(T.buyN, t.hand.length);
        const picks = p.human ? await this.ui.humanPick(t.hand.slice(), bn, `${t.name} 的手牌：挑 ${bn} 张买走`) : AI.pick(this, p, t.hand, bn);
        for (const c of picks) if (t.hand.includes(c)) { this.takeFromHand(t, c); p.hand.push(c); this.ui.steal(t, p, c); }
        this.ui.log(p, `【${SN("grok", "buy")}】买走了 ${t.name} 的${picks.map((c) => `【${CD[c.k].name}】`).join("")}`);
        await wait(500);
      } else if (id === "steal") {
        const vic = T.stealAll ? this.others(p).filter((q) => q.hand.length > 0) : [t];
        const hasClaude = vic.some((q) => q.key === "claude");
        this.ui.skill(p, SN("glm", "steal")); this.ui.say(p, hasClaude ? "steal_claude" : "steal", true);
        await wait(500);
        let got = 0;
        for (const q of vic) {
          const n = q.key === "claude" ? T.stealClaude : T.stealN;
          for (let k = 0; k < n && q.hand.length; k++) { const c = q.hand[rnd(q.hand.length)]; this.takeFromHand(q, c); p.hand.push(c); this.ui.steal(q, p, c); got++; }
          if (q.key === "claude") this.ui.say(q, "stolen", true);
        }
        this.ui.log(p, `【${SN("glm", "steal")}】从 ${vic.map((q) => q.name).join("、")} 那里借鉴了 ${got} 张牌`);
        await wait(600);
      } else if (id === "maint") {
        t.muted = true;
        this.ui.skill(p, SN("glm", "maint")); this.ui.say(p, "maint", true); Sound.sfx("stamp", 0.8);
        this.ui.log(p, `【${SN("glm", "maint")}】宣布今天是 ${t.name} 的维护日：她下个出牌阶段不能出牌`);
        await wait(800);
      } else if (id === "bundle") {
        // 千问·全家桶：亮出牌堆顶 3 张，自己留几张，送 t 1 张，其余弃掉
        if (!t) { const os = this.skillTargets(p, "bundle"); t = os[rnd(os.length)]; }
        const top = [];
        for (let i = 0; i < T.bundleLook; i++) { if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; } if (this.deck.length) top.push(this.deck.pop()); }
        this.ui.skill(p, SN("qwen", "bundle")); this.ui.say(p, "bundle", true);
        await wait(500);
        const kn = Math.min(T.bundleKeep, top.length);
        const keep = p.human ? await this.ui.humanPick(top, kn, `${SN("qwen", "bundle")}：亮出 ${top.length} 张，挑 ${kn} 张自己留下`) : AI.pick(this, p, top, kn);
        const rest = top.filter((c) => !keep.includes(c));
        const gift = !rest.length || !t.alive ? null : p.human ? (await this.ui.humanPick(rest, 1, `${SN("qwen", "bundle")}：挑 1 张送给 ${t.name}`))[0] : AI.giftCard(this, p, t, rest);
        if (keep.length) { p.hand.push(...keep); this.ui.drawAnim(p, keep.length); }
        if (gift) { t.hand.push(gift); this.ui.drawAnim(t, 1); }
        for (const c of rest) if (c !== gift) this.toDiscard(c);
        this.ui.log(p, `【${SN("qwen", "bundle")}】自己留了 ${keep.length} 张，送给 ${t.name} 一张【${gift ? CD[gift.k].name : "?"}】`);
        await wait(400);
      } else if (id === "qingke") {
        // 千问·请客：弃牌点外卖，送的人心态 +1；送给别人自己再摸
        const c = await this.pickOwn(p, `${SN("qwen", "qingke")}：选 ${T.qingkeCost} 张牌弃掉，给 ${t === p ? "自己" : t.name} 点一杯奶茶`);
        if (!c) return;
        this.ui.skill(p, SN("qwen", "qingke")); this.ui.say(p, t === p ? "qingke_self" : "qingke", true); Sound.sfx("slurp", 0.7);
        await wait(500);
        t.hp = Math.min(t.maxHp, t.hp + 1); this.ui.heal(t, 1);
        this.ui.log(p, `【${SN("qwen", "qingke")}】给 ${t === p ? "自己" : t.name} 点了一杯奶茶外卖，心态 +1`);
        if (t !== p && T.qingkeDraw) await this.draw(p, T.qingkeDraw, true);
        await wait(300);
      } else if (id === "sale") {
        p.sale = true;
        this.ui.skill(p, SN("qwen", "sale")); this.ui.say(p, "sale", true); Sound.sfx("fanfare_short", 0.6);
        this.ui.log(p, `【${SN("qwen", "sale")}】双十一到！这回合【吐槽】不限次数` + (T.saleDraw ? `，先囤 ${T.saleDraw} 张` : ""));
        await wait(800);
        if (T.saleDraw) await this.draw(p, T.saleDraw, true);
      } else if (id === "recall") {
        const pool = [];
        for (let k = this.discard.length - 1; k >= 0 && pool.length < 6; k--) { const c = this.discard[k]; if (T.recallKinds.includes(c.k)) pool.push(c); }
        this.ui.skillNote(p, SN("kimi", "recall")); this.ui.say(p, "recall", true);
        const pick = p.human ? (await this.ui.humanPick(pool, 1, `${SN("kimi", "recall")}：从弃牌堆捡回一张`))[0] : AI.pick(this, p, pool, 1)[0];
        if (pick) { this.discard.splice(this.discard.indexOf(pick), 1); p.hand.push(pick); this.ui.drawAnim(p, 1); }
        this.ui.log(p, `【${SN("kimi", "recall")}】从弃牌堆捡回了【${pick ? CD[pick.k].name : "?"}】`);
        await wait(400);
      }
      this.ui.sync();
      this.checkOver();
    }
  }

  E.Game = Game; E.wait = wait; E.CD = CD; E.CH = CH; E.T = T; E.ROLE = ROLE;
  return E;
})();
