// 互动道具：番茄 / 鸡蛋 / 咖啡 / 鲜花 / 点赞。不改牌，只是表情——但会被当成“暗号”：
//   2v2：你砸对手 = 叫电脑队友集火她；给队友送咖啡 = 叫她掩护你（先打最后伤你的人）。电脑也会先砸一下她要打的人
//   抢群主：大家会从你扔的东西猜你的身份（砸群主像黑粉，给群主送东西像管理员）——也能拿来骗人
//   乱斗 / 单挑：送咖啡她会对你手下留情一点，砸番茄会惹她记仇
window.Props = (function () {
  const KINDS = {
    tomato: { name: "番茄", bad: true, icon: "🍅", verb: (a, b) => `${a} 朝 ${b} 扔了个番茄` },
    egg: { name: "鸡蛋", bad: true, icon: "🥚", verb: (a, b) => `${a} 朝 ${b} 砸了个鸡蛋` },
    coffee: { name: "咖啡", bad: false, icon: "☕", verb: (a, b) => `${a} 给 ${b} 送了一杯咖啡` },
    flower: { name: "鲜花", bad: false, icon: "💐", verb: (a, b) => `${a} 给 ${b} 送了一束花` },
    like: { name: "点赞", bad: false, icon: "👍", verb: (a, b) => `${a} 给 ${b} 点了个赞` },
  };
  const ORDER = ["tomato", "egg", "coffee", "flower", "like"];
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const now = () => performance.now();
  const aiOn = () => !window.Settings || Settings.S.props !== "off";
  let mine = [], aiT = -1e9;
  const lineT = {};

  // 道具这一句提示：选人卡上写清楚现在扔它是什么意思
  function meaning(g, me, t) {
    if (g.mode === "team") return t.team === me.team ? "暗号：给队友送☕ = 叫她掩护你（先打最后伤你的人）" : "暗号：砸她🍅🥚 = 叫队友集火她";
    if (g.mode === "id5") return "小心：大家会从你扔的东西猜你的身份——也可以拿来骗人";
    return "送☕💐👍 她会对你手下留情一点；砸🍅🥚 会惹她记仇";
  }

  // 扔出去：画面 + 群里一句 + 砸中后的反应
  function send(g, from, to, kind) {
    const K = KINDS[kind];
    UI.throwProp(from, to, kind);
    UI.sys(`${K.icon} ${K.verb(from.name, to.name)}`, "prop");
    setTimeout(() => react(g, from, to, kind), 700);
  }
  function react(g, from, to, kind) {
    if (g !== window.__game || !to.alive) return;
    const bad = KINDS[kind].bad, t = now();
    if (!(lineT[to.i] > t - 8000) && Math.random() < 0.6) { lineT[to.i] = t; UI.say(to, bad ? "pelted" : "gifted"); }
    else UI.expr(to, bad ? "hurt" : "smug", 1200);
  }

  // 暗号 / 记仇：谁扔的、扔给谁、什么模式
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
      const mate = g.players.find((q) => q !== from && q.team === from.team && q.alive);
      if (!mate) return;
      if (bad && t.team !== from.team) { mark(g, mate, t); ack(g, mate, `接下来集火 ${t.name}`); }
      else if (t === mate && kind === "coffee") {
        const foe = from.lastHurtBy;
        if (foe && foe.alive && foe.team !== from.team) { mark(g, mate, foe); ack(g, mate, `来掩护你，先打 ${foe.name}`); }
        else ack(g, mate, "收到，有事喊我");
      } else if (t === mate) ack(g, mate, "收到");
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

  // 你扔：每次至少隔 0.9 秒，12 秒内最多 6 个
  function human(g, me, t, kind) {
    if (!g || !KINDS[kind] || t === me) return false;
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
      setTimeout(() => { if (g === window.__game && !g.over && t.alive) send(g, t, me, K.bad ? rnd(["tomato", "egg"]) : rnd(["like", "flower"])); }, 1600);
    return true;
  }

  // 电脑自己扔：挨打时宿敌幸灾乐祸、朋友送咖啡安慰；有人退群时献花或补个番茄；全场至少隔 4 秒
  const aiCan = () => aiOn() && now() - aiT > 4000;
  function aiSend(g, from, to, kind, delay) {
    aiT = now();
    setTimeout(() => { if (g === window.__game && !g.over && from.alive) { send(g, from, to, kind); signal(g, from, to, kind); } }, delay);
  }
  function onHit(g, src, t) {
    if (src && src !== t) t.lastHurtBy = src;
    if (!src || !t.alive || !aiCan() || Math.random() > 0.22) return;
    const by = g.alive().filter((q) => q !== t && q !== src && !q.human);
    const fr = by.filter((q) => g.hostility(q, t) < 0 || g.relation(q, t) === "friend");
    const rv = by.filter((q) => g.hostility(q, t) > 1.2);
    if (fr.length && (Math.random() < 0.5 || !rv.length)) aiSend(g, rnd(fr), t, rnd(["coffee", "coffee", "flower"]), 900);
    else if (rv.length) aiSend(g, rnd(rv), t, rnd(["tomato", "egg"]), 900);
  }
  function onOut(g, t, src) {
    if (!aiCan() || Math.random() > 0.5) return;
    const by = g.alive().filter((q) => !q.human);
    const fr = by.filter((q) => g.relation(q, t) === "ally" || g.relation(q, t) === "friend"), rv = by.filter((q) => g.relation(q, t) === "rival");
    if (fr.length) aiSend(g, rnd(fr), t, "flower", 1400);
    else if (rv.length) aiSend(g, rnd(rv), t, "tomato", 1400);
    else if (src && src.alive && by.some((q) => q !== src)) aiSend(g, rnd(by.filter((q) => q !== src)), src, "like", 1400);
  }
  // 电脑回合开始：2v2 里有时先砸一下这回合要打的人（就是她的暗号，之后真的会集火她）；别的模式偶尔扔一个
  function onAiTurn(g, p) {
    if (!aiOn() || p.human || g.over) return;
    if (g.mode === "team") {
      if (Math.random() > 0.35) return;
      const t = window.AI && AI.pickTarget(g, p, g.others(p)); if (!t) return;
      mark(g, p, t);
      send(g, p, t, rnd(["tomato", "egg"]));
      const mates = p.team === g.human.team;
      UI.sys(mates ? `🤝 暗号：队友 ${p.name} 要集火 ${t.name}` : `👀 对面的 ${p.name} 盯上了 ${t.name}`, "prop");
      return;
    }
    if (!aiCan() || Math.random() > 0.12) return;
    const foe = window.AI && AI.pickTarget(g, p, g.others(p)), pal = g.others(p).find((q) => g.hostility(p, q) < 0 || g.relation(p, q) === "friend");
    if (pal && Math.random() < 0.4) aiSend(g, p, pal, rnd(["coffee", "flower", "like"]), 200);
    else if (foe) aiSend(g, p, foe, rnd(["tomato", "egg"]), 200);
  }

  return { KINDS, ORDER, meaning, human, onHit, onOut, onAiTurn };
})();
