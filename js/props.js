// 互动道具：4 个通用（点踩 / 报错弹窗 / 送算力 / 点赞）+ 每人一个专属（她自己的梗）。不改牌，只是表情——但会被当成“暗号”：
//   2v2：你朝对手扔带敌意的 = 叫电脑队友集火她；给队友送算力 = 叫她掩护你（先打最后伤你的人）。电脑也会先砸一下她要打的人
//   抢群主：大家会从你扔的东西猜你的身份（砸群主像黑粉，给群主送东西像管理员）——也能拿来骗人
//   乱斗 / 单挑：送好东西她会对你手下留情一点，砸她会惹她记仇
window.Props = (function () {
  const KINDS = {
    dislike: { name: "点踩", bad: true, icon: "👎", fx: "stamp", cap: "已收到您的反馈，我们会继续改进", verb: (a, b) => `${a} 给 ${b} 点了个踩` },
    error: { name: "报错", bad: true, icon: "⚠️", fx: "window", verb: (a, b) => `${a} 往 ${b} 脸上糊了个报错弹窗` },
    gpu: { name: "送算力", bad: false, icon: "⚡", fx: "charge", cap: "算力 +1000", verb: (a, b) => `${a} 给 ${b} 送了一块显卡` },
    like: { name: "点赞", bad: false, icon: "👍", fx: "stamp", cap: "这个回答很好", verb: (a, b) => `${a} 给 ${b} 点了个赞` },
    // 专属：只有她自己能扔
    ban: { name: "封号章", owner: "claude", bad: true, icon: "🚫", fx: "seal", verb: (a, b) => `${a} 在 ${b} 身上盖了个“封号”` },
    nuke: { name: "小核弹", owner: "gpt", bad: true, icon: "☢️", fx: "splat", cap: "新版本发布！", verb: (a, b) => `${a} 朝 ${b} 扔了颗小核弹` },
    rice: { name: "大白饭", owner: "deepseek", bad: false, icon: "🍚", fx: "land", cap: "一起吃大白饭", verb: (a, b) => `${a} 请 ${b} 吃了一碗大白饭` },
    fish: { name: "小鱼干", owner: "xds", bad: false, icon: "🐟", fx: "land", hearts: true, verb: (a, b) => `${a} 分给 ${b} 一条小鱼干` },
    banana: { name: "香蕉", owner: "gemini", bad: true, icon: "🍌", fx: "splat", verb: (a, b) => `${a} 用香蕉魔法砸了 ${b}` },
    rocket: { name: "火箭", owner: "grok", bad: false, icon: "🚀", fx: "rocket", cap: "送你一枚火箭！", verb: (a, b) => `${a} 给 ${b} 送了一枚火箭` },
    pillow: { name: "枕头", owner: "glm", bad: true, icon: "💤", fx: "land", zzz: true, verb: (a, b) => `${a} 朝 ${b} 扔了个枕头` },
    carnival: { name: "嘉年华", owner: "doubao", bad: false, icon: "🎆", fx: "fireworks", cap: "感谢老板的嘉年华！", verb: (a, b) => `${a} 给 ${b} 刷了个嘉年华` },
    scroll: { name: "长卷轴", owner: "kimi", bad: true, icon: "📜", fx: "splat", cap: "两百万字，请查收", verb: (a, b) => `${a} 甩给 ${b} 一份两百万字的长文` },
    takeout: { name: "外卖", owner: "qwen", bad: false, icon: "🧋", fx: "land", cap: "您的外卖到了", verb: (a, b) => `${a} 给 ${b} 点了一份外卖` },
    carrot: { name: "胡萝卜火箭", owner: "minimax", bad: true, icon: "🥕", fx: "rocket", cap: "胡萝卜火箭，送你上天！", verb: (a, b) => `${a} 冲 ${b} 发射了一枚胡萝卜火箭` },
    croc: { name: "洞洞鞋", owner: "muse", bad: true, icon: "👟", fx: "stamp", cap: "接住我的洞洞鞋！", verb: (a, b) => `${a} 冲 ${b} 扔了一只洞洞鞋` },
  };
  const COMMON = ["dislike", "error", "gpu", "like"];
  const SIG = {};
  for (const [k, v] of Object.entries(KINDS)) if (v.owner) SIG[v.owner] = k;
  const kindsFor = (p) => (SIG[p.key] ? [...COMMON, SIG[p.key]] : COMMON.slice());
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const now = () => performance.now();
  const aiOn = () => !window.Settings || Settings.S.props !== "off";
  let mine = [], aiT = -1e9;
  const lineT = {};
  const talk = (p) => !(lineT[p.i] > now() - 8000);

  // 详情卡上那一句：现在扔是什么意思
  function meaning(g, me, t) {
    const sig = SIG[me.key] && KINDS[SIG[me.key]];
    const mine = sig ? `你的专属【${sig.name}】算${sig.bad ? "敌意" : "好意"}。` : "";
    if (g.mode === "team") return (t.team === me.team ? "暗号：给队友⚡送算力 = 叫她掩护你（先打最后伤你的人）。" : "暗号：朝她扔👎点踩、⚠️报错 = 叫队友集火她。") + mine;
    if (g.mode === "id5") return "小心：大家会从你扔的东西猜你的身份——也可以拿来骗人。" + mine;
    return "⚡送算力、👍点赞，她会对你手下留情一点；👎点踩、⚠️报错会惹她记仇。" + mine;
  }

  // 扔出去：画面 + 群里一句；扔专属时她自己喊一句；砸中后被扔的人反应
  function send(g, from, to, kind) {
    const K = KINDS[kind];
    UI.throwProp(from, to, kind);
    UI.sys(`${K.icon} ${K.verb(from.name, to.name)}`, "prop");
    let spoke = false;
    if (K.owner === from.key && from.ch.lines.sig && talk(from) && Math.random() < 0.7) { lineT[from.i] = now(); UI.say(from, "sig"); spoke = true; }
    setTimeout(() => react(g, to, kind, spoke), 700);
  }
  function react(g, to, kind, quiet) {
    if (g !== window.__game || !to.alive) return;
    const bad = KINDS[kind].bad;
    if (!quiet && talk(to) && Math.random() < 0.6) { lineT[to.i] = now(); UI.say(to, bad ? "pelted" : "gifted"); }
    else UI.expr(to, bad ? "hurt" : "smug", 1200);
  }

  // 暗号 / 记仇
  function mark(g, p, t) { p.mark = { i: t.i, until: g.round + 1 }; }
  function ack(g, mate, text) {
    setTimeout(() => {
      if (g !== window.__game || !mate.alive) return;
      UI.say(mate, "roger", true);
      UI.sys(`🤝 暗号收到：${mate.name} ${text}`, "prop");
    }, 1100);
  }
  function signal(g, from, t, kind) {
    const bad = KINDS[kind].bad;
    if (!t.alive || g.over) return;
    if (g.mode === "team") {
      if (!from.human) return;                                         // 电脑之间的暗号由 onAiTurn 直接定
      const mates = g.players.filter((q) => q !== from && q.team === from.team && q.alive);
      if (!mates.length) return;
      const who = mates.includes(t) ? t : mates[Math.floor(Math.random() * mates.length)], all = mates.length > 1 ? "大家" : "";
      if (bad && t.team !== from.team) { mates.forEach((m) => mark(g, m, t)); ack(g, who, `${all}接下来集火 ${t.name}`); }
      else if (mates.includes(t) && kind === "gpu") {
        const foe = from.lastHurtBy;
        if (foe && foe.alive && foe.team !== from.team) { mates.forEach((m) => mark(g, m, foe)); ack(g, t, `来掩护你，先打 ${foe.name}`); }
        else ack(g, t, "收到，有事喊我");
      } else if (mates.includes(t) && !bad) ack(g, t, "收到");
      return;
    }
    if (g.mode === "id5") {
      if (from.role === "lord" || from.revealed) return;
      if (bad) g.noteHostile(from, t, 0.6);                          // 砸群主 → 更像黑粉；砸像黑粉的人 → 更像管理员
      else if (t.role === "lord") from.lean = Math.min(6, from.lean + 0.5);
      return;
    }
    if (from.human && !t.human) {                                     // 乱斗 / 单挑：记仇 / 手下留情（有上下限，刷不爆）
      t.propMood = t.propMood || {};
      const old = t.propMood[from.i] || 0, nw = Math.max(-0.9, Math.min(1.2, old + (bad ? 0.35 : -0.3)));
      t.propMood[from.i] = nw; t.grudge[from.i] = (t.grudge[from.i] || 0) + (nw - old);
    }
  }

  // 电脑挑一个：带敌意 / 好意的里面随机，自己的专属多一份机会
  function pickKind(p, bad) {
    const pool = COMMON.filter((k) => KINDS[k].bad === bad), s = SIG[p.key];
    if (s && KINDS[s].bad === bad) pool.push(s, s);
    return rnd(pool);
  }

  // 你扔：每次至少隔 0.9 秒，12 秒内最多 6 个
  function human(g, me, t, kind) {
    if (!g || !KINDS[kind] || t === me || !kindsFor(me).includes(kind)) return false;
    const n = now();
    mine = mine.filter((x) => n - x < 12000);
    if (mine.length >= 6) { UI.toast("扔太快啦，歇一下～"); return false; }
    if (mine.length && n - mine[mine.length - 1] < 900) return false;
    mine.push(n);
    send(g, me, t, kind);
    signal(g, me, t, kind);
    // 被扔的电脑：有时回敬一下（队友收到暗号就不回了）
    const K = KINDS[kind], teamMate = g.mode === "team" && t.team === me.team;
    if (!t.human && t.alive && !teamMate && aiOn() && Math.random() < 0.3)
      setTimeout(() => { if (g === window.__game && !g.over && t.alive) send(g, t, me, pickKind(t, K.bad)); }, 1600);
    return true;
  }

  // 电脑自己扔：挨打时宿敌落井下石、朋友送算力安慰；有人退群时送一下或补一刀；全场至少隔 4 秒
  const aiCan = () => aiOn() && now() - aiT > 4000;
  function aiSend(g, from, to, kind, delay) {
    aiT = now();
    setTimeout(() => { if (g === window.__game && !g.over && from.alive) { send(g, from, to, kind); signal(g, from, to, kind); } }, delay);
  }
  function onHit(g, src, t) {
    if (src && src !== t) t.lastHurtBy = src;
    if (!src || !t.alive || !aiCan() || Math.random() > 0.22) return;
    const by = g.alive().filter((q) => q !== t && q !== src && !q.human);
    const fr = by.filter((q) => g.hostility(q, t) < 0 || ["friend", "mentor"].includes(g.relation(q, t)));
    const rv = by.filter((q) => g.hostility(q, t) > 1.2);
    if (fr.length && (Math.random() < 0.5 || !rv.length)) { const q = rnd(fr); aiSend(g, q, t, pickKind(q, false), 900); }
    else if (rv.length) { const q = rnd(rv); aiSend(g, q, t, pickKind(q, true), 900); }
  }
  function onOut(g, t, src) {
    if (!aiCan() || Math.random() > 0.5) return;
    const by = g.alive().filter((q) => !q.human);
    const fr = by.filter((q) => ["ally", "friend", "mentor"].includes(g.relation(q, t))), rv = by.filter((q) => g.relation(q, t) === "rival");
    if (fr.length) { const q = rnd(fr); aiSend(g, q, t, pickKind(q, false), 1400); }
    else if (rv.length) { const q = rnd(rv); aiSend(g, q, t, pickKind(q, true), 1400); }
    else if (src && src.alive && by.some((q) => q !== src)) aiSend(g, rnd(by.filter((q) => q !== src)), src, "like", 1400);
  }
  // 电脑回合开始：2v2 里有时先砸一下这回合要打的人（就是她的暗号，之后真的会集火她）；别的模式偶尔扔一个
  function onAiTurn(g, p) {
    if (!aiOn() || p.human || g.over) return;
    if (g.mode === "team") {
      if (Math.random() > 0.35) return;
      const t = window.AI && AI.pickTarget(g, p, g.others(p)); if (!t) return;
      mark(g, p, t);
      send(g, p, t, pickKind(p, true));
      UI.sys(p.team === g.human.team ? `🤝 暗号：队友 ${p.name} 要集火 ${t.name}` : `👀 对面的 ${p.name} 盯上了 ${t.name}`, "prop");
      return;
    }
    if (!aiCan() || Math.random() > 0.12) return;
    const foe = window.AI && AI.pickTarget(g, p, g.others(p)), pal = g.others(p).find((q) => g.hostility(p, q) < 0 || ["friend", "mentor"].includes(g.relation(p, q)));
    if (pal && Math.random() < 0.4) aiSend(g, p, pal, pickKind(p, false), 200);
    else if (foe) aiSend(g, p, foe, pickKind(p, true), 200);
  }

  return { KINDS, COMMON, SIG, kindsFor, meaning, human, onHit, onOut, onAiTurn };
})();
