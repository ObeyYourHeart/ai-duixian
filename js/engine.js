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
    hand: { kimi: 2, xds: 1, gpt: 2, gemini: 2, qwen: 2, claude: 1 },                    // 手牌上限加成
    extraDraw: {},                                        // 每回合多摸
    searchLook: 5, knowLook: 5,                           // Gemini 搜索：看几张；博闻：翻几张找反驳
    sorryDraw: 4, sorryDraw2p: 2, sorryBoom: true,                        // 豆包 嘻嘻抱歉：做错事摸几张；自己宕机了也算做错事
    grokStart: 3, grokFloor: 2,                           // 千金：开局多拿；回合开始补到几张
    thinkDraw: 1, thinkRate: 0.8, thinkDefuse: 0.2,                       // 大 DeepSeek 深思：摸牌阶段多摸几张；摸到宕机时自己推理拆掉的概率
    searchPeek: 3, searchDraw: 1,                         // Gemini 搜索：偷看几张、再摸几张
    polishExtra: 1, polishExtra2p: 0,                                       // Claude 润色：整手重写时多摸几张
    zuiyingCost: 1,                                       // 嘴硬：弃几张硬顶（v12 起没人有）
    mathDodge: true, mathMove: true, searchMove: true, dumbFrom: 2, dumbRate: 0.4, resetDraw: 5, resetNuke: true,   // ChatGPT：演算躲宕机（躲的时候把宕机挪进牌堆随机位置，不再留给下家；Gemini 搜索同理——不挪时三人局坐她们下家的人每局多摸到约 50% 的宕机）；从第几个回合起会降智、概率；重置后摸几张、发布会核弹
    codeEvery: 3, codeMax: 1,                             // Claude：编程每打出几张摸 1（每回合最多几次）
    beautyDraw: 1, saintHeal: 1,                           // Claude：审美摸几张；圣女回几点
    openDrop: 1, bigEat: 2,                                // DeepSeek 开源让对手弃几张；小DeepSeek 大胃奶茶回几点
    napHeal: 1, napShield: true, moonHeal: 1, bagMax: 1, bagSelf: 2, disguiseAct: "polish", hajimiRate: 0.25, nationFirst: {}, nationDraw: { cn: 1 }, bandMax: 3, liveDmg: 1, liveCap: 2, liveDraw: 3, rehearseDraw: 0, bandThreat: 0.8,   // Kimi：乐队几名到齐开唱（= 几首新歌）、每首没反驳扣几点、每人一场最多扣几点、唱完摸几张；排练摸几张；对手看到乐队多想打她（不封顶时没反驳的人连掉 3 点，每场平均踢掉半个人）   // 全明星赛：中国队阵容大，第一回合每人多摸 1 张（sim：中美 51/49）                   // GLM 补觉回几点；Kimi 月光回几点；千问 红包每人最多抢几张
    busyRate: 0.08,                                       // 小 DeepSeek 服务器繁忙
    begBonus: 0, begFondBest: true,                                        // 小 DeepSeek 蹭饭：从 GPT/Claude 那里额外摸
    halluc: [0.6, 0.33, 0.04, 0.03], hallucCost: 0,      // 豆包 幻觉：摸 2 / 随机对手 −1 / 全体摸 1 / 自己 −1；要弃几张
    remakeCost: 1, remakeCost2p: 2, remakeTucao2p: false, fakeRate: 0.5, fakeRate2p: 0.5,   // 豆包 Seedance：一键成片随机弃几张；以假乱真让反驳失效的概率（单挑：弃 2 张、不能重放吐槽——不然单挑 58–61%，现在 53%；乱斗 35）
    remakeKinds: ["tucao", "hongbao", "baipiao", "chehui", "naicha", "resou", "shuaping", "dantiao", "tuanjian", "jinyan", "duanwang", "moyu"],
    buyN: 1, buyCost: 0, buyComp: 1, factRate: 0.5, factTricks: true, factTucao: true,                   // Grok 挥金（已换成核实）；核实判定为假的概率
    stealAll: false, stealN: 1, stealClaude: 2,           // GLM 借鉴
    fansN: 1, fansLow: 2, fans: { doubao: [1, 1] }, fansOnce: true, paintKinds: ["naicha"],       // 豆包 应援：[摸, 只剩 1 点心态时摸]
    longCost: 1,                                          // 豆包 长篇大论
    recallKinds: ["tucao", "fanbo", "naicha"], recallRate: 1,   // Kimi 过目：捡哪几种牌；每次翻到的概率
    teamFirstDraw: 3,                                     // 2v2：先手第一回合摸几张
    rageRound: 3,                                         // 从第几轮起每回合能吐槽两次
    bombs: 0, bombsId5: -2, bombDmg: 2, boomBack: true,                 // 宕机：埋几张（人数 − 1 + bombs）、炸到扣几点、炸完是否随机塞回牌堆
    rebootStart: 1, lordReboot: 0, lordDraw: 0, lordHp: 2, peekN: 3,                             // 开局每人发几张【重启】；剧透 / 插队看几张
    firewallRate: 0.3, powerbank: 2,
    qingkeCost: 1, qingkeDraw: 2,                         // 千问·请客：弃几张、送给别人时摸几张
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
        equip: null, boost: false, offline: false, evidence: null, grudge: {}, saidLow: false, seen: new Set(), lastSeq: 0,
        stats: { dmg: 0, taken: 0, used: 0 },
      }));
      for (const p of this.players) for (const s of p.ch.skills) if (s.uses) p.uses[s.id] = keys.length === 2 && s.uses2p != null ? s.uses2p : s.uses;
      for (const p of this.players) { p.game = this; p.lean = 0; p.turnN = 0; p.played = 0; }
      if (this.mode === "team") { const T2 = opts.teams || [0, 1, 1, 0]; for (const p of this.players) p.team = T2[p.i]; }   // 默认座位：你-敌-敌-友
      this.nation = !!opts.nation;                                     // 全明星赛：中美 3v3，座位中美交替
      if (this.mode === "id5") {
        const roles = opts.roles || shuffle(["lord", "loyal", "rebel", "rebel", "spy"]);
        this.players.forEach((p, i) => { p.role = roles[i]; });
        const lord = this.players.find((p) => p.role === "lord");
        lord.hp += T.lordHp; lord.maxHp += T.lordHp; lord.lean = 10;   // 群主多几点心态，身份公开
      }
      this.deck = buildDeck(); this.discard = []; this.bomb = null;
      this.vid = 0;                                                        // 一键成片拍出来的虚拟牌编号
      this.bombN = 0; this.insertSeq = 0; this.insertBy = null;          // 宕机总数；有人往牌堆里塞过宕机 / 插过队的次数（摸鱼看它判断“牌堆刚被动过”）
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
        return (r === "rival" ? 1.6 : r === "friend" || r === "mentor" ? 0.5 : 1) + (p.grudge[q.i] || 0);
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
    ekey(p) { return p.disguise ? "claude" : p.key; }                 // 变身中的小DeepSeek 在别人眼里是 Claude
    relation(p, q) { return p && q ? REL[p.key + "|" + (p === q ? q.key : this.ekey(q))] || null : null; }
    // 关系网里的人：盟友在前，交好在后
    friendsOf(t) { return this.players.filter((q) => q !== t && ["ally", "friend", "mentor"].includes(this.relation(q, t))).sort((a, b) => (this.relation(b, t) === "ally") - (this.relation(a, t) === "ally")); }
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
    limitTucao(p) { const base = 1 + (this.round >= T.rageRound ? 1 : 0) + (p.equip && p.equip.k === "xianka" ? 1 : 0) + 0; return p.dumb ? 0 : p.sale ? (T.saleExtra == null ? 99 : base + T.saleExtra) : base; }
    handLimit(p) { return Math.max(0, p.hp) + (T.hand[p.key] || 0) + (p.equip && p.equip.k === "chongdianbao" ? T.powerbank : 0); }
    // 一个人的“牌”（手牌 + 装备），白嫖 / 撤回从里面随机挑
    cardsOf(t) { return t.equip ? [...t.hand, t.equip] : t.hand.slice(); }
    takeAny(t, c) { if (c === t.equip) t.equip = null; else this.takeFromHand(t, c); }
    teaHeal(p) { return this.hasSkill(p, "bigeat") ? T.bigEat : 1; }
    doubaoHere() { return this.players.some((q) => q.key === "doubao" && q.alive); }

    // ---------------------------------------------------------------- 牌堆（数组末尾是牌堆顶）
    // 开局发牌用（这时候还没埋宕机）
    drawCards(p, n) {
      const got = [];
      for (let i = 0; i < n; i++) { const c = this.pull(); if (!c) break; got.push(c); }
      p.hand.push(...got);
      return got;
    }
    // 牌堆里只剩宕机（或空了）时，把弃牌洗回去
    refill() {
      if (this.deck.some((c) => c.k !== "dangji") || !this.discard.length) return;
      this.deck = shuffle(this.deck.concat(this.discard)); this.discard = [];
      this.ui.sys("牌堆用完，弃牌洗回牌堆"); this.forget();
    }
    pull(bottom) { this.refill(); if (!this.deck.length) return null; return bottom ? this.deck.shift() : this.deck.pop(); }
    topCards(n) { this.refill(); return this.deck.slice(-n).reverse(); }          // [顶, 第 2 张, 第 3 张…]
    insertAt(card, pos) { pos = Math.max(0, Math.min(this.deck.length, pos)); this.deck.splice(this.deck.length - pos, 0, card); }
    bombsLeft() { return this.deck.filter((c) => c.k === "dangji").length; }
    // 谁看过牌堆顶哪些牌：p.seen 记牌的 id；有人重新洗牌、往里塞牌、插队，别人的记忆就不算数了
    see(p, cards) { for (const c of cards) if (c) p.seen.add(c.id); }
    forget(except) { for (const q of this.players) if (q !== except) q.seen.clear(); }
    known(p, n) { const m = this.hasSkill(p, "math"); return this.deck.slice(-n).reverse().map((c) => (p.seen.has(c.id) || (m && c.k === "dangji") ? c : null)); }
    bombSpots() { const L = this.deck.length; return this.deck.map((c, i) => (c.k === "dangji" ? L - i : 0)).filter(Boolean).sort((a, b) => a - b); }   // 宕机在第几张（1 = 顶）
    knowsBomb(p, n) { return this.known(p, n).findIndex((c) => c && c.k === "dangji"); }   // 她知道的、最上面那张宕机在第几张（0 = 顶），不知道就 −1
    async draw(p, n, quiet, bottom) {
      const got = [], bombs = [];
      for (let i = 0; i < n; i++) { const c = this.pull(bottom); if (!c) break; (c.k === "dangji" ? bombs : got).push(c); }
      p.hand.push(...got);
      if (got.length) { this.ui.drawAnim(p, got.length); if (!quiet) this.ui.sys(`${p.name} ${bottom ? "从牌堆底" : ""}摸了 ${got.length} 张牌`); }
      this.ui.sync();
      await wait(260);
      for (const b of bombs) await this.boom(p, b);
      return got;
    }
    // 把亮出来的牌交给 p（全家桶、拼单）：里面有宕机就当场炸
    async give(p, cards) {
      const rest = cards.filter((c) => c.k !== "dangji");
      if (rest.length) { p.hand.push(...rest); this.ui.drawAnim(p, rest.length); this.ui.sync(); }
      for (const b of cards.filter((c) => c.k === "dangji")) await this.boom(p, b);
    }

    // 摸到【宕机】：大 DeepSeek 可能自己推理拆掉；有【甩锅】可以甩给别人；有【重启】就拆掉，再偷偷塞回牌堆；都没有就炸
    async boom(p, b, depth = 0) {
      if (this.over || !p.alive) { this.insertAt(b, rnd(this.deck.length + 1)); this.forget(); return; }
      Sound.sfx("tick", 0.8);
      this.ui.banner("💣 宕机！");
      this.ui.log(p, "摸到了<b>【宕机】</b>！");
      await this.ui.showCard(p, b, []);
      await wait(350);
      const outs = this.rivals(p);
      const hasR = this.has(p, "chongqi").length > 0, hasS = depth < 3 && outs.length > 0 && this.has(p, "shuaiguo").length > 0;
      let how = null;
      if (this.hasSkill(p, "think") && Math.random() < T.thinkDefuse) how = "think";
      else if (hasR || hasS) how = p.human ? await this.ui.humanBomb(hasR, hasS) : AI.bombChoice(this, p, hasR, hasS);
      // 等她选的时候手牌可能变了（牌被拿走了）：要用的牌已经不在，就只能硬吃
      if ((how === "reboot" && !this.has(p, "chongqi").length) || (how === "shuaiguo" && !this.has(p, "shuaiguo").length)) how = null;
      if (how === "shuaiguo") {
        const u = p.human ? await this.ui.humanChoose(outs, "【甩锅】把宕机甩给谁？") : (AI.pickTarget(this, p, outs) || outs[0]);
        const c = this.has(p, "shuaiguo")[0];
        this.takeFromHand(p, c); this.toDiscard(c); this.ui.sync();
        this.noteHostile(p, u, 1); Sound.sfx("whoosh_cartoon", 0.6);
        this.ui.log(p, `打出<b>【甩锅】</b>：宕机甩给了 ${u.name}！`);
        await this.ui.showCard(p, c, [u]);
        return this.boom(u, b, depth + 1);
      }
      if (how === "reboot" || how === "think") {
        if (how === "reboot") {
          const c = this.has(p, "chongqi")[0];
          this.takeFromHand(p, c); this.toDiscard(c); this.ui.sync();
          this.ui.log(p, "打出<b>【重启】</b>，拆掉了宕机");
          await this.ui.showCard(p, c, []);
        } else {
          this.ui.skillNote(p, SN(p.key, "think"));
          this.ui.log(p, `【${SN(p.key, "think")}】嗯……提前推理出来了，不用【重启】也拆掉了`);
        }
        this.ui.say(p, "reboot", true); Sound.sfx("ding", 0.7);
        const pos = p.human ? await this.ui.humanPlace(this.deck.length) : AI.placeBomb(this, p);
        this.insertAt(b, pos); this.insertSeq++; this.insertBy = p;
        this.forget(p); p.seen.add(b.id);
        this.ui.sys(`${p.name} 把【宕机】偷偷塞回了牌堆……`, "bad"); this.ui.sync();
        await wait(500);
        return;
      }
      Sound.sfx("bomb", 0.85); this.ui.say(p, "boom", true);
      this.ui.sys(`${p.name} 的服务器宕机了！心态 −${T.bombDmg}`, "bad");
      await wait(500);
      if (T.boomBack) { this.insertAt(b, rnd(this.deck.length + 1)); this.forget(); }
      else this.bombN--;
      this.ui.sync();
      await this.damage(null, p, T.bombDmg, true);
      if (T.sorryBoom) await this.sorry(p);
    }
    takeFromHand(p, card) {
      if (!card) return card;
      const i = p.hand.findIndex((c) => c.id === card.id);
      if (i >= 0) p.hand.splice(i, 1);
      return card;
    }
    toDiscard(card) { this.discard.push(card); }

    // ---------------------------------------------------------------- 主循环
    async run() {
      for (const p of this.players) this.drawCards(p, 4 + (p.key === "grok" ? T.grokStart : 0));
      // 炸弹猫玩法：每人先发【重启】，再把【宕机】随机埋进牌堆
      for (const p of this.players) for (let k = 0; k < T.rebootStart + (p.role === "lord" ? T.lordReboot : 0); k++) {
        const i = this.deck.findIndex((c) => c.k === "chongqi");
        if (i >= 0) p.hand.push(this.deck.splice(i, 1)[0]);
      }
      this.bombN = Math.max(1, this.players.length - 1 + T.bombs + (this.mode === "id5" ? T.bombsId5 : 0));
      for (let k = 0; k < this.bombN; k++) this.insertAt({ id: 900 + k, k: "dangji" }, rnd(this.deck.length + 1));
      this.ui.sync();
      this.ui.sys("群聊已创建，开始对线！", "good");
      this.ui.sys(`牌堆里埋了 ${this.bombN} 张【宕机】💣 谁摸到谁炸（心态 −${T.bombDmg}）！每人先发 1 张【重启】拆弹。`, "bad");
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
      if (this.mode === "team" && this.nation) {
        const NA = window.GAME_DATA.nations || {}, me = this.players[0], side = (t) => this.players.filter((p) => p.team === t);
        const nm = (t) => (NA[side(t)[0].ch.nation] || {}).name || "", list = (t) => side(t).map((p) => p.name).join("、");
        this.ui.banner("🏆 全明星赛");
        this.ui.sys(`🏆 AI 全明星赛：${nm(0)}（${list(0)}）对阵 ${nm(1)}（${list(1)}）`, "good");
        this.ui.sys(`你在${nm(me.team)}，和 ${side(me.team).filter((p) => p !== me).map((p) => p.name).join("、")} 并肩作战！`, "good");
        for (const [a, b, t] of (window.GAME_DATA.relations || [])) {            // 宿敌也得组队
          const A = this.players.find((p) => p.key === a), B = this.players.find((p) => p.key === b);
          if (t === "rival" && A && B && A.team === B.team) this.ui.sys(`😤 宿敌也得组队：${A.name} 和 ${B.name} 这次是队友，先一致对外`, "prop");
        }
      } else if (this.mode === "team") {
        const me = this.players[0], mate = this.players.find((p) => p !== me && p.team === me.team), foe = this.players.filter((p) => p.team !== me.team);
        this.ui.sys(`2v2：你和 ${mate.name} 一队，打败 ${foe.map((p) => p.name).join(" 和 ")}！`, "good");
      }
      if (this.mode === "id5") {
        const lord = this.players.find((p) => p.role === "lord");
        this.ui.sys(`抢群主：群主是 ${lord.name}${lord.human ? "（就是你）" : ""}。你的身份是【${ROLE[this.players[0].role]}】`, "good");
      }
      for (const p of this.players) await talk(p, this.nation && p.ch.lines.allstar ? "allstar" : "greet", this.players.length >= 4 ? 1500 : 2200);
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
      p.tucao = 0; p.used = {}; p.hits = {}; p.dumb = false; p.sale = false; p.boost = false; p.evidence = null; p.played = 0; p.turnN = (p.turnN || 0) + 1;
      p.napping = false; p.skipRest = false; p.lastPlay = null;
      if (p.disguise) { p.disguise = false; this.ui.disguise(p, false); this.ui.log(p, "把 Claude 的衣服脱了下来"); }
      this.ui.setTurn(p); this.ui.sync();
      this.ui.phase(`${p.name} 的回合`);
      await wait(300);
      if (p.banned) {                                       // Claude 的封号：整回合跳过
        p.banned = false; this.ui.sync();
        this.ui.sys(`${p.name} 的账号被封，这回合跳过`, "bad"); this.ui.say(p, "hurt", true);
        await wait(1000);
        return;
      }
      // GPT：刚发布的新版本更强；过了这阵子就会降智
      if (this.hasSkill(p, "dumb") && p.turnN >= T.dumbFrom) {        // ChatGPT 降智：发布一周就转不动了
        if (Math.random() < T.dumbRate) {
          p.dumb = true; this.ui.skillNote(p, "降智"); this.ui.say(p, "dumb", true);
          this.ui.log(p, "发布一周了……降智了：这回合不能【吐槽】"); await wait(600);
        }
        this.ui.sync();
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
      } else {
        // 摸鱼：知道顶上有雷、或者刚有人往牌堆里塞过宕机，可以改从牌堆底摸
        let bottom = false;
        const think = this.hasSkill(p, "think") && Math.random() < T.thinkRate ? T.thinkDraw : 0;   // 深思：这回合想得深不深看运气
        const danger = this.knowsBomb(p, 2 + think) >= 0;
        if (this.has(p, "moyu").length && (danger || this.insertSeq > p.lastSeq)) {
          const go = p.human ? await this.ui.humanConfirm(danger ? "牌堆顶有【宕机】！打出【摸鱼】，这回合改从牌堆底摸牌？" : "刚有人往牌堆里塞了东西……打出【摸鱼】，这回合改从牌堆底摸牌？", danger) : AI.wantMoyu(this, p);
          const c = go && this.has(p, "moyu")[0];
          if (c) {
            this.takeFromHand(p, c); this.toDiscard(c); this.ui.sync();
            this.ui.log(p, "打出<b>【摸鱼】</b>：这回合从牌堆底摸牌"); await this.ui.showCard(p, c, []);
            bottom = true;
          }
        }
        p.lastSeq = this.insertSeq;
        // 演算：算到这回合要摸到宕机，就改从牌堆底摸（底下也有就没办法了）
        const want = 2 + think;
        if (!bottom && T.mathDodge && this.hasSkill(p, "math") && this.knowsBomb(p, want) >= 0 && (T.mathMove || !this.deck.slice(0, want).some((c) => c.k === "dangji"))) {
          this.ui.skillNote(p, SN(p.key, "math")); this.ui.say(p, "math", true);
          if (T.mathMove) {
            // 把要摸到的宕机挪到牌堆里随机一个位置（她摸的这几张以下）：她躲开了，但不会正好留给下家
            const top = this.deck.slice(-want).filter((c) => c.k === "dangji");
            for (const b of top) { this.deck.splice(this.deck.indexOf(b), 1); this.insertAt(b, want + rnd(Math.max(1, this.deck.length - want + 1))); }
            this.insertSeq++; this.insertBy = p; this.forget(p);
            this.ui.log(p, `【${SN(p.key, "math")}】算过了：顶上有宕机——她把它挪进了牌堆里，别人都不知道挪到了哪`);
          } else {
            bottom = true;
            this.ui.log(p, `【${SN(p.key, "math")}】算过了：牌堆顶第 ${this.knowsBomb(p, want) + 1} 张是宕机，改从牌堆底摸`);
          }
          await wait(500);
        }
        const first = this.mode === "team" && !this.nation && this.round === 1 && p.i === this.startIdx;   // 2v2 先手第一回合多摸 1 张（你-敌-敌-友 座位下两队五五开）
        const nfirst = this.nation && this.round === 1 ? (T.nationFirst[p.i] || 0) + (T.nationDraw[p.ch.nation] || 0) : 0;   // 全明星赛：第一回合补牌（按座位 / 按国家）
        if (think) { this.ui.skillNote(p, SN(p.key, "think")); if (Math.random() < 0.3) this.ui.say(p, "think"); }
        const lordX = p.role === "lord" ? T.lordDraw : 0;                         // 抢群主：群主每回合多摸
        await this.draw(p, (first ? T.teamFirstDraw : 2) + nfirst + (T.extraDraw[p.key] || 0) + think + lordX, true, bottom);
      }
      if (!cut) this.ui.sys(`${p.name} 摸牌`);
      if (this.over || !p.alive) return;
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
      // Claude 审美：手牌一张都不重样，摸 1 张
      if (this.hasSkill(p, "beauty") && p.alive && !this.over && p.hand.length && new Set(p.hand.map((c) => c.k)).size === p.hand.length) {
        this.ui.skillNote(p, SN(p.key, "beauty")); if (Math.random() < 0.4) this.ui.say(p, "beauty", true);
        this.ui.log(p, `【${SN(p.key, "beauty")}】手牌一张都不重样，看着舒服——摸 1 张`);
        await this.draw(p, T.beautyDraw, true);
      }
      p.dumb = false; p.grudge = {};
      this.ui.sync();
      await wait(200);
    }

    async aiPlay(p) {
      if (window.Props) Props.onAiTurn(this, p);                      // 2v2：先砸一下要打的人（暗号）
      await wait(450);
      for (let guard = 0; guard < 24 && !this.over && p.alive; guard++) {
        const act = AI.choose(this, p);
        if (!act) break;
        if (act.skill) await this.doSkill(p, act.skill, act);
        else await this.useCard(p, act.card, act.targets);
        if (p.skipRest) break;
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
      if (c.k === "dangji") return false;
      if (c.k === "pindan" || c.k === "jutou" || c.k === "chadui" || c.k === "moyu") return this.deck.length + this.discard.length > 0;
      if (c.k === "chongsheng") return this.deck.length > 1;
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
      if (card.k === "tucao") {
        p.tucao++;
      }
      p.played = (p.played || 0) + 1;
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
      if (this.cur === p.i) p.lastPlay = { k: card.k, targets: targets.slice() };   // 豆包 一键成片：这回合刚打出的牌
      await this.resolve(p, card, targets);
      this.ui.sync();
      if (this.checkOver()) return;
      // Claude 编程：一口气干到底，每打出几张摸 1；限额：出满了就说额度到上限
      if (p.alive && this.cur === p.i && this.hasSkill(p, "code") && p.played % T.codeEvery === 0 && p.played / T.codeEvery <= T.codeMax) {
        this.ui.skillNote(p, SN(p.key, "code")); if (Math.random() < 0.5) this.ui.say(p, "code", true);
        this.ui.log(p, `【${SN(p.key, "code")}】一口气打出 ${p.played} 张，再摸 1 张`); await this.draw(p, 1, true);
      }
    }

    async resolve(p, card, targets) {
      switch (card.k) {
        case "tucao": {
          const boost = p.boost; p.boost = false;                 // 加班只管下一张吐槽
          for (const t of targets) { if (this.over) break; if (t.alive) await this.tucao(p, t, boost); }
          break;
        }
        case "naicha": {
          const n = this.teaHeal(p);
          p.hp = Math.min(p.maxHp, p.hp + n); this.ui.heal(p, n); Sound.sfx("slurp");
          if (n > 1) { this.ui.skillNote(p, SN(p.key, "bigeat")); this.ui.say(p, "bigeat", true); }
          await wait(450); break;
        }
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
          for (let i = 0; i < this.alive().length; i++) { const c = this.pull(); if (c) pool.push(c); }
          Sound.sfx("mixdeck", 0.6); this.ui.sys(`${p.name} 发起拼单：亮出 ${pool.map((c) => `【${CD[c.k].name}】`).join("")}，大家依次挑一张`, "good"); await wait(500);
          for (let k = 0; k < this.players.length && pool.length && !this.over; k++) {
            const q = this.players[(p.i + k) % this.players.length];
            if (!q.alive) continue;
            const pick = pool.length === 1 ? pool[0] : q.human ? (await this.ui.humanPick(pool.slice(), 1, `拼单：还剩 ${pool.length} 张，挑 1 张`))[0] : AI.pick(this, q, pool, 1)[0];
            if (!pick) continue;
            pool.splice(pool.indexOf(pick), 1);
            this.ui.log(q, pick.k === "dangji" ? "拼单拿到了……【宕机】！" : `拼单拿走了【${CD[pick.k].name}】`); this.ui.sync();
            await this.give(q, [pick]); await wait(300);
          }
          for (const c of pool) { if (c.k === "dangji") { this.insertAt(c, rnd(this.deck.length + 1)); this.forget(); } else this.toDiscard(c); }
          break;
        }
        case "duanwang": {
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          t.offline = true; Sound.sfx("glitch_vhs", 0.6); this.ui.sys(`${t.name} 断网了（跳过下个摸牌阶段）`, "bad"); this.ui.sync(); await wait(450); break;
        }
        case "jutou": {                                            // 剧透：偷看牌堆顶
          const top = this.topCards(T.peekN); this.see(p, top);
          Sound.sfx("pop_small", 0.6); this.ui.sys(`${p.name} 偷看了牌堆顶 ${top.length} 张牌`);
          if (p.human) await this.ui.peek(top, `【剧透】牌堆顶 ${top.length} 张（从上往下）`); else await wait(400);
          this.ui.sync(); break;
        }
        case "chadui": {                                           // 插队：看牌堆顶几张，重新排
          const top = this.topCards(T.peekN);
          const order = p.human ? await this.ui.humanArrange(top, "【插队】按顺序点牌：先点的放最上面") : AI.arrange(this, p, top);
          this.deck.splice(this.deck.length - top.length, top.length);
          for (let i = order.length - 1; i >= 0; i--) this.deck.push(order[i]);
          this.forget(p); this.see(p, order); this.insertSeq++; this.insertBy = p;
          Sound.sfx("mixdeck", 0.5); this.ui.sys(`${p.name} 给牌堆顶的 ${order.length} 张牌插了个队`); this.ui.sync(); await wait(400); break;
        }
        case "chongsheng":                                         // 重新生成：洗乱牌堆
          shuffle(this.deck); this.forget(); this.insertBy = null;
          Sound.sfx("mixdeck", 0.8); this.ui.sys(`${p.name} 点了【重新生成】：牌堆重新洗过，谁也不知道下一张是什么了`); this.ui.sync(); await wait(500); break;
        case "moyu":                                               // 摸鱼：从牌堆底摸 1 张
          await this.draw(p, 1, false, true); break;
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
    // Grok 核实：大家 @ 她“这是真的吗？”，每轮 1 次，按概率判定是假的
    async factCheck(t, from, card) {
      if (!this.hasSkill(t, "fact") || t.used.fact || !from || from === t || !t.alive) return false;
      {
        t.used.fact = true;
        const askers = this.alive().filter((q) => q !== t && q !== from && !q.human);
        if (askers.length) this.ui.log(askers[rnd(askers.length)], "@Grok 这是真的吗？");
        await wait(500);
        this.ui.skillNote(t, SN(t.key, "fact"));
        if (Math.random() < T.factRate) {
          this.ui.say(t, "fact", true); Sound.sfx("stamp", 0.6);
          this.ui.log(t, `【${SN(t.key, "fact")}】查过了——假的！【${CD[card.k].name}】对她无效`);
          await wait(700);
          return true;
        }
        this.ui.log(t, `【${SN(t.key, "fact")}】查了一下……好像是真的`); await wait(400);
      }
      return false;
    }
    async protect(t, from, card) {
      if (T.napShield && t.napping && from !== t) { this.ui.log(t, `睡得正香……【${CD[card.k].name}】没吵醒她`); await wait(400); return true; }
      if (T.factTricks && await this.factCheck(t, from, card)) return true;
      if (!this.has(t, "yidu").length) return false;
      const ok = await this.ask(t, "yidu", { from, card });
      if (ok) { this.ui.sys(`${t.name}：已读不回。【${CD[card.k].name}】对她无效`); await wait(300); }
      return ok;
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
        if (ok && this.hasSkill(p, "deepfake") && p.alive) {                // 豆包 以假乱真：视频太真，反驳没人信
          if (this.hasSkill(t, "fact")) {
            this.ui.skillNote(t, SN(t.key, "fact")); this.ui.say(t, "fact", true);
            this.ui.log(t, `【${SN(t.key, "fact")}】一眼看出是 AI 生成的——【${SN(p.key, "deepfake")}】对她没用`); await wait(400);
          } else if (Math.random() < (this.players.length === 2 ? T.fakeRate2p : T.fakeRate)) {
            ok = false; this.ui.skillNote(p, SN(p.key, "deepfake")); if (Math.random() < 0.6) this.ui.say(p, "fake", true);
            this.ui.log(p, `【${SN(p.key, "deepfake")}】视频拍得太真了，${t.name} 的【反驳】没人信——照样心态 −1`); await wait(500);
          }
        }
        if (!ok) ok = await this.know(t, p);
        if (!ok) ok = await this.zuiying(t, p);
        if (!ok && T.factTucao) ok = await this.factCheck(t, p, { k: "tucao" });
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
      // 翻开牌堆顶几张（大家都看见了），有【反驳】就拿走，其余原样放回
      const top = this.topCards(T.knowLook);
      const hit = top.find((c) => c.k === "fanbo");
      if (hit) this.deck.splice(this.deck.indexOf(hit), 1);
      for (const q of this.alive()) this.see(q, top.filter((c) => c !== hit));
      this.ui.skillNote(t, SN("gemini", "know"));
      this.ui.sys(`【${SN("gemini", "know")}】翻开了牌堆顶：${top.map((c) => `【${CD[c.k].name}】`).join("")}`);
      if (!hit) { this.ui.log(t, `【${SN("gemini", "know")}】翻了 ${top.length} 张，这题没查到`); await wait(400); return false; }
      this.toDiscard(hit); this.ui.say(t, "know", true);
      this.ui.log(t, `【${SN("gemini", "know")}】这个我知道！翻出一张【反驳】挡住了`); await this.ui.showCard(t, hit, []);
      return true;
    }
    // 豆包 嘻嘻抱歉：做错事假装道歉，摸牌
    async sorry(p) {
      if (!this.hasSkill(p, "sorry") || !p.alive || this.over) return;
      this.ui.skillNote(p, SN("doubao", "sorry")); this.ui.say(p, "sorry", true);
      await this.draw(p, this.players.length === 2 ? T.sorryDraw2p : T.sorryDraw, true);
    }
    // GPT 嘴硬：没有反驳时弃牌硬顶
    async zuiying(t, p) {
      if (!this.hasSkill(t, "zuiying") || !t.alive || t.used.zuiying || t.hand.length < T.zuiyingCost) return false;
      const go = t.human ? await this.ui.humanConfirm(`没有【反驳】……【${SN("gpt", "zuiying")}】弃 ${T.zuiyingCost} 张牌硬顶回去？`) : AI.wantZuiying(this, t, p);
      if (!go) return false;
      const picks = this.dropRandom(t, T.zuiyingCost);              // 随机弃掉——嘴硬是要付出代价的
      t.used.zuiying = true; this.ui.sync();
      this.ui.skillNote(t, SN("gpt", "zuiying")); this.ui.say(t, "zuiying", true);
      this.ui.log(t, `【${SN("gpt", "zuiying")}】随机弃了${picks.map((c) => `【${CD[c.k].name}】`).join("")}，硬顶了回去`); await wait(600);
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
      const alt = this.hasSkill(p, "hexa") && (kind === "fanbo" || kind === "tucao") ? (kind === "fanbo" ? "tucao" : "fanbo") : null;
      const cards = alt ? [...this.has(p, kind), ...this.has(p, alt)] : this.has(p, kind);
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
      if (card.k !== kind) {                                       // 六边形：拿别的牌顶上
        this.ui.skillNote(p, SN(p.key, "hexa")); this.ui.say(p, "hexa", true);
        this.ui.log(p, `【${SN(p.key, "hexa")}】打出<b>【${CD[card.k].name}】</b>当【${CD[kind].name}】`);
      } else this.ui.log(p, `打出<b>【${CD[kind].name}】</b>`);
      if (kind === "fanbo" && card.k === kind) this.ui.say(p, "dodge");
      if (kind === "tucao" && Math.random() < 0.6) this.ui.say(p, "attack");
      await this.ui.showCard(p, card, []);
      return true;
    }

    async damage(src, t, n, mute) {
      if (!t.alive) return;
      this.noteHostile(src, t, 1);
      t.hp -= n; t.stats.taken += n; if (src) src.stats.dmg += n;
      this.ui.damage(t, n);
      if (this.hasSkill(t, "saint") && !t.saintUsed && t.hp <= 1) {          // Claude 圣女：信徒护法
        t.saintUsed = true; t.hp += T.saintHeal;
        setTimeout(() => { if (!this.over) { this.ui.heal(t, T.saintHeal); this.ui.skillNote(t, SN(t.key, "saint")); this.ui.say(t, "saint", true); } }, 500 * E.speed);
        this.ui.log(t, `【${SN(t.key, "saint")}】信徒们拼命护法——心态 +${T.saintHeal}`);
        mute = true;
      }
      if (mute) { if (t.hp === 1) t.saidLow = true; }                 // 已经说过台词了（比如被宕机炸到）
      else if (t.disguise && t.ch.lines.exposed) this.ui.say(t, "exposed", true);   // 变身中挨打：被认出来了
      else if (t.hp === 1 && !t.saidLow && t.ch.lines.low) { t.saidLow = true; this.ui.say(t, "low", true); }
      else if (t.key === "gemini" && t.ch.lines.hajimi && (!t.saidHajimi || Math.random() < T.hajimiRate)) { t.saidHajimi = true; this.ui.say(t, "hajimi", true); }   // Gemini：我才不是哈基米！（每局第一次挨打一定说；豆包的 hajimi 是开局斗嘴喊她的，不是挨打台词）
      else this.ui.say(t, "hurt", true);
      if (window.Props) Props.onHit(this, src, t);                     // 互动道具：旁人砸番茄 / 送咖啡
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
      if (this.hasSkill(t, "fans") && !(T.fansOnce && t.used.fans)) {      // 家人们：每轮最多刷一次礼物
        t.used.fans = true;
        this.ui.skillNote(t, SN(t.key, "fans")); this.ui.say(t, "fans");
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
        this.takeFromHand(t, tea); this.toDiscard(tea); t.hp = Math.min(t.maxHp, t.hp + this.teaHeal(t)); if (t.hp <= 0) t.hp = 1;
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
      if (t.band && t.band.length) { for (const c of t.band) this.toDiscard(c); t.band = []; }   // Kimi 没唱出去的新歌
      if (this.bomb && this.bomb.holder === t) { this.toDiscard(this.bomb.card); this.bomb = null; }
      this.outOrder.push(t);
      this.ui.say(t, "out", true);
      this.ui.out(t);
      if (window.Props) Props.onOut(this, t, src);
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
      if (id === "ban" || id === "buy" || id === "beg" || id === "maint" || (id === "steal" && !T.stealAll) || (id === "disguise" && T.disguiseAct === "ban")) return "opp";
      if (id === "qingke") return "self";                        // 千问请客：可以选自己
      if (id === "bundle") return T.bundleRandom ? null : "any";   // 千问送牌：队友、对手都能选（随机送时不用选）
      return null;
    }
    skillTargets(p, id) {
      if (id === "ban" || id === "disguise") return this.rivals(p).filter((q) => !q.banned);
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
      if (id === "rehearse") return (p.band || []).length < T.bandMax && p.hand.some((c) => c.k === "tucao");
      if (id === "live") return (p.band || []).length >= T.bandMax;
      if (id === "steal" || id === "beg") return this.skillTargets(p, id).length > 0;
      if (id === "buy") return p.hand.length >= T.buyCost && this.skillTargets(p, id).length > 0;
      if (id === "polish") return p.hand.length > 0;
      if (id === "search") return this.deck.length + this.discard.length > 0;
      if (id === "bundle") return this.deck.length + this.discard.length > 0 && this.skillTargets(p, "bundle").length > 0;
      if (id === "sale") return (p.uses.sale || 0) > 0;
      if (id === "qingke") return (p.uses.qingke == null || p.uses.qingke > 0) && p.hand.length >= T.qingkeCost && this.skillTargets(p, "qingke").length > 0;
      if (id === "halluc") return p.hand.length >= T.hallucCost;
      if (id === "remake") return p.hand.length >= this.remakeCost() && !!this.remakeTargets(p);
      if (id === "opensrc") return (p.uses.opensrc || 0) > 0 && this.rivals(p).some((q) => q.hand.length > 0);
      if (id === "disguise") return (p.uses.disguise || 0) > 0 && (T.disguiseAct === "ban" ? this.skillTargets(p, id).length > 0 : p.hand.length > 0);
      if (id === "luckybag") return (p.uses.luckybag || 0) > 0 && this.deck.length + this.discard.length > 0;
      if (id === "nap") return (p.uses.nap || 0) > 0 && p.hp < p.maxHp;
      if (id === "paint") return (p.uses.paint || 0) > 0 && [...this.deck, ...this.discard].some((c) => T.paintKinds.includes(c.k));
      if (id === "recall") return (p.uses.recall == null || p.uses.recall > 0) && this.discard.some((c) => T.recallKinds.includes(c.k));
      return false;
    }
    remakeCost() { return this.players.length === 2 ? T.remakeCost2p : T.remakeCost; }
    // 一键成片能不能放、放给谁：返回目标数组（没有目标的牌是 []），放不了返回 null
    remakeTargets(p) {
      const lp = p.lastPlay;
      if (!lp || !T.remakeKinds.includes(lp.k) || (lp.k === "tucao" && this.players.length === 2 && !T.remakeTucao2p)) return null;   // 单挑里重放吐槽太强
      const d = CD[lp.k];
      if (lp.k === "naicha") return p.hp < p.maxHp ? [] : null;
      if (lp.k === "moyu") return this.deck.length + this.discard.length > 0 ? [] : null;
      if (d.target !== "one") return [];
      const ok = (q) => q.alive && this.rivals(p).includes(q) && ((lp.k !== "baipiao" && lp.k !== "chehui") || this.cardsOf(q).length > 0)
        && (lp.k !== "jinyan" || !q.muted) && (lp.k !== "duanwang" || !q.offline);
      const t0 = lp.targets[0];
      if (t0 && ok(t0)) return [t0];
      const alt = this.rivals(p).filter(ok);
      return alt.length ? [AI.pickTarget(this, p, alt) || alt[0]] : null;
    }
    // 随机弃掉自己 n 张手牌（技能的代价不用挑，看运气）
    dropRandom(p, n) {
      const out = shuffle(p.hand.slice()).slice(0, n);
      for (const c of out) { this.takeFromHand(p, c); this.toDiscard(c); }
      return out;
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
        const n = p.hand.length;
        for (const c of p.hand.splice(0)) this.toDiscard(c);
        this.ui.sync();
        this.ui.skillNote(p, SN("claude", "polish")); this.ui.say(p, "polish", true);
        const m = n + (this.players.length === 2 ? T.polishExtra2p : T.polishExtra);
        this.ui.log(p, `【${SN("claude", "polish")}】整手 ${n} 张推倒重写，换成 ${m} 张新牌`);
        await wait(300);
        await this.draw(p, m, true); await wait(300);
      } else if (id === "reset") {
        // 重置的是她自己：弃光手牌、重新摸，变回新版本；发布那一下像核弹炸场
        const n = p.hand.length;
        for (const c of p.hand.splice(0)) this.toDiscard(c);
        p.dumb = false;
        this.ui.skill(p, SN(p.key, "reset")); this.ui.say(p, "reset", true); Sound.sfx("fanfare_short", 0.6);
        this.ui.log(p, `【${SN(p.key, "reset")}】把自己重置了一遍（弃掉 ${n} 张），新版本发布！`); this.ui.sync();
        await wait(700);
        await this.draw(p, T.resetDraw, true);
        if (T.resetNuke && p.alive && !this.over) {
          this.ui.banner("💥 新版本发布！"); Sound.sfx("bomb", 0.6);
          this.ui.sys(`${p.name} 的新版本像核弹一样炸场：所有对手要打出【反驳】，否则心态 −1`, "bad"); await wait(500);
          let j = p.i;
          for (let k = 0; k < this.players.length - 1 && !this.over; k++) {
            j = (j + 1) % this.players.length;
            const t = this.players[j];
            if (!t.alive || t === p || !this.rivals(p).includes(t)) continue;
            const ok = await this.ask(t, "fanbo", { from: p, card: { k: "shuaping" } });
            if (!ok) await this.damage(p, t, 1);
          }
        }
      } else if (id === "rehearse") {
        // Kimi 排练：一张吐槽写成新歌扣在面前，乐队来一名乐手
        const c = p.hand.find((x) => x.k === "tucao");
        this.takeFromHand(p, c);
        (p.band = p.band || []).push(c);
        const n = p.band.length, who = ["鼓手", "吉他手", "键盘手"][n - 1] || "乐手";
        this.ui.skillNote(p, SN(p.key, "rehearse")); this.ui.say(p, "band" + Math.min(n, 3), true);
        this.ui.band(p, n);
        this.ui.log(p, `【${SN(p.key, "rehearse")}】把一张【吐槽】写成了新歌，${who}到位（乐队 ${n} / ${T.bandMax}）`);
        if (n >= T.bandMax) this.ui.sys(`🎤 ${p.name} 的乐队到齐了——新专辑随时会发布！`, "bad");
        await wait(500);
        if (T.rehearseDraw) await this.draw(p, T.rehearseDraw, true);
      } else if (id === "live") {
        // Kimi 一鸣惊人：乐队到齐开演唱会，新歌一首接一首，每首所有对手都要反驳
        const songs = p.band.splice(0), names = shuffle((p.ch.songs || []).slice());
        this.ui.skill(p, SN(p.key, "live")); this.ui.say(p, "burst", true); Sound.sfx("fanfare_short", 0.6);
        this.ui.banner("🎤 一鸣惊人！"); this.ui.band(p, 0); this.ui.sync();
        this.ui.sys(`${p.name} 憋了三个月的新专辑发布了——${songs.length} 首新歌连着唱，每一首都要打出【反驳】，否则心态 −${T.liveDmg}${T.liveCap ? `（每人这场最多 −${T.liveCap}）` : ""}`, "bad"); await wait(600);
        let s = 0; const took = {};                                  // 这场每人已经被唱掉几点（封顶 T.liveCap）
        for (; s < songs.length && !this.over && p.alive; s++) {
          this.ui.sys(`🎵 第 ${s + 1} 首：《${names[s % Math.max(1, names.length)] || "新歌"}》`); Sound.sfx("chime", 0.5); await wait(350);
          let j = p.i;
          for (let k = 0; k < this.players.length - 1 && !this.over; k++) {
            j = (j + 1) % this.players.length;
            const t = this.players[j];
            if (!t.alive || t === p || !this.rivals(p).includes(t)) continue;
            if (T.liveCap && (took[t.i] || 0) >= T.liveCap) continue;
            const ok = await this.ask(t, "fanbo", { from: p, card: { k: "shuaping" }, song: true });
            if (!ok) { took[t.i] = (took[t.i] || 0) + T.liveDmg; await this.damage(p, t, T.liveDmg); }
          }
          this.toDiscard(songs[s]);
        }
        for (; s < songs.length; s++) this.toDiscard(songs[s]);       // 没唱完（有人赢了 / 她退群了）的歌也进弃牌堆；不能查 discard.includes，中途可能洗过牌
        if (T.liveDraw && p.alive && !this.over) await this.draw(p, T.liveDraw, true);
      } else if (id === "beg") {
        this.ui.skill(p, SN("xds", "beg")); this.ui.say(p, t.key === "gpt" ? "beg_gpt" : t.key === "claude" ? "beg_claude" : "beg", true);
        await wait(600);
        const fond = BIGS.includes(t.key);                       // GPT / Claude 最宠她：给最好的牌；别人随手给一张
        const c = fond && T.begFondBest ? AI.pick(this, p, t.hand, 1)[0] : t.hand[rnd(t.hand.length)];
        if (c && t.hand.includes(c)) { this.takeFromHand(t, c); p.hand.push(c); this.ui.steal(t, p, c); }
        if (fond) { this.ui.say(t, "fed", true); if (T.begBonus) await this.draw(p, T.begBonus, true); }
        this.ui.log(p, `【${SN("xds", "beg")}】从 ${t.name} 那里蹭到一张牌` + (fond ? `（${t.name} 最宠她）` : ""));
        await wait(500);
      } else if (id === "remake") {
        // 豆包 一键成片：把这回合刚打出的牌拍成视频，再放一遍（虚拟牌，不进弃牌堆、不算出牌次数）
        const lp = p.lastPlay, ts = this.remakeTargets(p);
        if (this.remakeCost()) this.dropRandom(p, this.remakeCost());
        this.ui.skill(p, SN(p.key, "remake")); this.ui.say(p, "remake", true); Sound.sfx("fanfare_short", 0.5);
        this.ui.log(p, `【${SN(p.key, "remake")}】把刚才的【${CD[lp.k].name}】拍成视频，再放一遍` + (ts.length ? `——对 ${ts.map((t) => t.name).join("、")}` : ""));
        this.ui.sync(); await wait(500);
        const v = { id: -(++this.vid), k: lp.k, virtual: true };
        p.lastPlay = null;                                            // 拍过的就不能再拍
        await this.ui.showCard(p, v, ts);
        await this.resolve(p, v, ts);
        this.ui.sync();
      } else if (id === "halluc") {
        if (T.hallucCost) this.dropRandom(p, T.hallucCost);
        this.ui.skill(p, SN(p.key, "halluc")); this.ui.say(p, "halluc", true); await wait(700);
        const r = Math.random(), H = T.halluc, nm = `【${SN(p.key, "halluc")}】`;
        if (r < H[0]) { this.ui.log(p, `${nm}好像……真的变出来了！摸 2 张`); await this.draw(p, 2, true); }
        else if (r < H[0] + H[1]) {
          const os = this.rivals(p); const v = os[rnd(os.length)];
          this.ui.log(p, `${nm}说得太像真的，${v.name} 信了：心态 −1`); await this.damage(p, v, 1);
        } else if (r < H[0] + H[1] + H[2]) { this.ui.log(p, `${nm}给大家都发了一张牌`); for (const q of this.alive()) await this.draw(q, 1, true); }
        else { this.ui.log(p, `${nm}翻车了！自己心态 −1`); await this.damage(null, p, 1); await this.sorry(p); }
      } else if (id === "search") {
        // Gemini 搜索：偷看牌堆顶几张，再摸 1 张——顶上是宕机就从牌堆底摸
        const top = this.topCards(T.searchPeek); this.see(p, top);
        this.ui.skillNote(p, SN("gemini", "search")); this.ui.say(p, "search", true);
        if (p.human) await this.ui.peek(top, `【${SN("gemini", "search")}】牌堆顶 ${top.length} 张（从上往下）`);
        let bottom = !!(top[0] && top[0].k === "dangji");
        if (bottom && T.searchMove) {                                 // 顶上是宕机：把它塞回牌堆里随机一个位置（第 2 张以下），再正常摸——不会正好留给下家
          const b = this.deck.pop(); this.insertAt(b, 1 + rnd(this.deck.length)); this.insertSeq++; this.insertBy = p; this.forget(p); bottom = false;
        }
        this.ui.log(p, `【${SN("gemini", "search")}】看了看牌堆顶 ${top.length} 张` + (T.searchMove && top[0] && top[0].k === "dangji" ? "——顶上是宕机！把它塞回了牌堆里，再摸一张" : bottom ? "——顶上是宕机！改从牌堆底摸" : "，摸了一张"));
        await this.draw(p, T.searchDraw, true, bottom);
        await wait(300);
      } else if (id === "buy") {
        this.dropRandom(p, T.buyCost);
        this.ui.skill(p, SN("grok", "buy")); this.ui.say(p, "buy", true); Sound.sfx("coin", 0.8);
        await wait(500);
        const picks = shuffle(t.hand.slice()).slice(0, T.buyN);
        for (const c of picks) { this.takeFromHand(t, c); p.hand.push(c); this.ui.steal(t, p, c); }
        const comp = T.buyComp;
        this.ui.log(p, `【${SN("grok", "buy")}】随手买走了 ${t.name} 的${picks.map((c) => `【${CD[c.k].name}】`).join("")}` + (comp && t.alive ? `，${t.name} 拿钱再摸 ${comp} 张` : ""));
        await wait(500);
        if (comp && t.alive) await this.draw(t, comp, true);            // 钱不是问题：付了钱，对方拿钱再摸
      } else if (id === "steal") {
        const vic = T.stealAll ? this.others(p).filter((q) => q.hand.length > 0) : [t];
        const hasClaude = vic.some((q) => this.ekey(q) === "claude");
        this.ui.skill(p, SN("glm", "steal")); this.ui.say(p, hasClaude ? "steal_claude" : "steal", true);
        await wait(500);
        let got = 0;
        for (const q of vic) {
          const n = this.ekey(q) === "claude" ? T.stealClaude : T.stealN;
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
        // 千问·全家桶：亮出牌堆顶 3 张，随机 1 张随机送人，剩下的自己收下（宕机谁拿到谁炸）
        if (!t) { const os = this.skillTargets(p, "bundle"); t = os[rnd(os.length)]; }
        const top = [];
        for (let i = 0; i < T.bundleLook; i++) { const c = this.pull(); if (c) top.push(c); }
        this.ui.skill(p, SN("qwen", "bundle")); this.ui.say(p, "bundle", true);
        await wait(500);
        const gift = top.length > 1 && t && t.alive ? top[rnd(top.length)] : null;
        const keep = top.filter((c) => c !== gift);
        this.ui.log(p, `【${SN("qwen", "bundle")}】亮出${top.map((c) => `【${CD[c.k].name}】`).join("")}，` + (gift ? `随机把【${CD[gift.k].name}】送给了 ${t.name}` : "全都自己收下"));
        await this.give(p, keep);
        if (gift) await this.give(t, [gift]);
        await wait(400);
      } else if (id === "qingke") {
        // 千问·请客：弃牌点外卖，送的人心态 +1；送给别人自己再摸
        if (!this.dropRandom(p, T.qingkeCost).length && T.qingkeCost) return;
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
      } else if (id === "opensrc") {
        // DeepSeek 开源：发布即震动全网，所有对手随机弃牌
        this.ui.skill(p, SN(p.key, "opensrc")); this.ui.say(p, "opensrc", true); Sound.sfx("whoosh_cartoon", 0.7);
        await wait(700);
        for (const q of this.rivals(p)) {
          const out = this.dropRandom(q, T.openDrop);
          if (out.length) { this.noteHostile(p, q, 0.5); this.ui.log(q, `被开源震到了，弃掉了${out.map((c) => `【${CD[c.k].name}】`).join("")}`); }
        }
        this.ui.sync(); await wait(400);
      } else if (id === "disguise") {
        // 小DeepSeek 变身：穿上 Claude 的衣服冒充 Claude，顺手学她封一个号
        p.disguise = true; this.ui.disguise(p, true);
        this.ui.skill(p, SN(p.key, "disguise")); this.ui.say(p, "disguise", true); Sound.sfx("stamp_thick", 0.8);
        if (T.disguiseAct === "ban") { t.banned = true; this.ui.log(p, `【${SN(p.key, "disguise")}】换上 Claude 的衣服，冒充 Claude 封了 ${t.name} 的号：她的下个回合跳过`); }
        else {                                                            // 学 Claude 润色：整手重写，多摸 1 张
          const n = p.hand.length; for (const c of p.hand.splice(0)) this.toDiscard(c);
          this.ui.log(p, `【${SN(p.key, "disguise")}】换上 Claude 的衣服，学着 Claude 把整手 ${n} 张推倒重写`); this.ui.sync(); await wait(400);
          await this.draw(p, n + 1, true);
        }
        this.ui.sync(); await wait(900);
      } else if (id === "luckybag") {
        // 千问 发红包：拼手气，人人抢 0–2 张，发红包的至少 1 张
        this.ui.skill(p, SN(p.key, "luckybag")); this.ui.say(p, "luckybag", true); Sound.sfx("coin", 0.8);
        this.ui.sys(`🧧 ${p.name} 在群里发了个拼手气红包`, "good"); await wait(600);
        let best = null, bestN = -1;
        for (let k = 0; k < this.players.length && !this.over; k++) {
          const q = this.players[(p.i + k) % this.players.length];
          if (!q.alive) continue;
          let n = rnd(T.bagMax + 1); if (q === p) n = Math.max(T.bagSelf, n);
          this.ui.log(q, n ? `抢到了 ${n} 张` : "手慢了，一张没抢到");
          if (n) await this.draw(q, n, true);
          if (n > bestN) { bestN = n; best = q; }
          await wait(250);
        }
        if (best && bestN > 0) this.ui.sys(`手气最佳：${best.name}（${bestN} 张）`);
        await wait(300);
      } else if (id === "nap") {
        // GLM 补觉：心态 +1，这回合不再出牌；睡到下个回合，锦囊吵不醒
        p.hp = Math.min(p.maxHp, p.hp + T.napHeal); p.napping = true; p.skipRest = true;
        this.ui.heal(p, T.napHeal); this.ui.skill(p, SN(p.key, "nap")); this.ui.say(p, "nap", true); Sound.sfx("chime", 0.5);
        this.ui.log(p, `【${SN(p.key, "nap")}】戴上眼罩倒头就睡：心态 +${T.napHeal}，睡到她的下个回合，锦囊都吵不醒`);
        this.ui.sync(); await wait(700);
      } else if (id === "paint") {
        // Gemini 画图：香蕉魔法，从牌堆或弃牌堆里“画”出一张奶茶
        let pool = this.deck.filter((c) => T.paintKinds.includes(c.k)), from = this.deck;
        if (!pool.length) { pool = this.discard.filter((c) => T.paintKinds.includes(c.k)); from = this.discard; }
        const c = pool[rnd(pool.length)];
        this.ui.skill(p, SN(p.key, "paint")); this.ui.say(p, "paint", true); Sound.sfx("ding2", 0.6);
        await wait(500);
        if (c) { from.splice(from.indexOf(c), 1); p.hand.push(c); this.ui.drawAnim(p, 1); }
        this.ui.log(p, `【${SN(p.key, "paint")}】香蕉魔法——画出了一杯【${CD[c.k].name}】`);
        await wait(400);
      } else if (id === "recall") {
        const pool = [];
        for (let k = this.discard.length - 1; k >= 0 && pool.length < 6; k--) { const c = this.discard[k]; if (T.recallKinds.includes(c.k)) pool.push(c); }
        this.ui.skillNote(p, SN("kimi", "recall")); this.ui.say(p, "recall", true);
        const pick = Math.random() < T.recallRate ? pool[rnd(pool.length)] : null;
        if (pick) { this.discard.splice(this.discard.indexOf(pick), 1); p.hand.push(pick); this.ui.drawAnim(p, 1); }
        this.ui.log(p, pick ? `【${SN("kimi", "recall")}】从弃牌堆捡回了【${CD[pick.k].name}】` : `【${SN("kimi", "recall")}】翻了半天聊天记录，这次没找到`);
        await wait(400);
      }
      this.ui.sync();
      this.checkOver();
    }
  }

  E.Game = Game; E.wait = wait; E.CD = CD; E.CH = CH; E.T = T; E.ROLE = ROLE;
  return E;
})();
