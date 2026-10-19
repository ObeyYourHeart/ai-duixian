// 电脑 AI娘：优先摸牌、回血、用技能占便宜，再削弱手牌多的人、收割心态低的人。
// 组队 / 身份局里只打对手：g.hostility(p, q) > 0 才算敌人（身份局靠"谁在打主公"猜身份）。
window.AI = (function () {
  const r = Math.random;

  function value(g, p, c) {
    switch (c.k) {
      case "naicha": return p.hp < p.maxHp ? 9 : 6.5;
      case "fanbo": return p.hp <= 2 ? 9 : 7.5;
      case "tucao": return g.has(p, "tucao").length > 1 ? 4 : 6.5;
      case "hongbao": return 7.5;
      case "yidu": return 6;
      case "jinyan": return 6;
      case "baipiao": return 6;
      case "resou": case "shuaping": return 6;
      case "chehui": return 5;
      case "dantiao": return 5;
      case "tuanjian": return 3;
      case "jiaban": return g.has(p, "tucao").length ? 5 : 3.5;
      case "pindan": return 5.5;
      case "shuaiguo": return 7;
      case "duanwang": return 6;
      case "dangji": return 2.5;
      case "jietu": return g.has(p, "tucao").length ? 5 : 3.5;
      case "xianka": case "fanghuoqiang": return p.equip ? 4 : 6.5;
      case "chongdianbao": return p.equip ? 3.5 : 5.5;
    }
    return 5;
  }
  function cheapest(g, p, n, exclude = []) {
    return p.hand.filter((c) => !exclude.includes(c.id)).sort((a, b) => value(g, p, a) - value(g, p, b)).slice(0, n).map((c) => c.id);
  }
  // 只留对手（乱斗 / 单挑里人人都是对手）
  function foes(g, p, list) { return g && g.foesOf ? g.foesOf(p, list) : list; }
  const hostile = (g, p, q) => (g && g.hostility ? Math.max(0, g.hostility(p, q)) : 0);
  // 选目标：残血好收割，同一回合不反复集火同一个人，带点随机；身份局里越像敌人越优先
  function threat(g, p, q) {
    let s = q.hand.length * 0.35 + (q.hp <= 1 ? 3 : 0) + (q.hp <= 2 ? 0.8 : 0) + r() * 2.6;
    s -= ((p.hits && p.hits[q.i]) || 0) * 2.2;
    s += ((p.grudge && p.grudge[q.i]) || 0) * 1.5;
    if (g.round <= 1 && q.human) s -= 1.5;
    return s + hostile(g, p, q) * 1.2;
  }
  function pickTarget(g, p, list) {
    const L = foes(g, p, list);
    return L.slice().sort((a, b) => threat(g, p, b) - threat(g, p, a))[0];
  }
  function richest(list, p) {
    const g = p && p.game;
    const L = foes(g, p, list);
    const score = (q) => q.hand.length - ((p && p.hits && p.hits[q.i]) || 0) * 2 + r() + hostile(g, p, q);
    return L.slice().sort((a, b) => score(b) - score(a))[0];
  }
  // 威胁最大（手牌多 / 心态低）的对手
  function biggest(g, p, list) {
    const L = foes(g, p, list);
    return L.slice().sort((x, y) => (y.hand.length + (3 - y.hp) + hostile(g, p, y)) - (x.hand.length + (3 - x.hp) + hostile(g, p, x)))[0];
  }

  // 千问送牌：有队友送队友（挑心态最低的），没有就送手牌最少、威胁最小的人
  function giftTarget(g, p) {
    const os = g.skillTargets ? g.skillTargets(p, "bundle") : g.others(p);
    const allies = os.filter((q) => g.hostility && g.hostility(p, q) < 0);
    if (allies.length) return allies.slice().sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)[0];
    return os.slice().sort((a, b) => a.hand.length + a.hp * 0.5 + hostile(g, p, a) - (b.hand.length + b.hp * 0.5 + hostile(g, p, b)) + (r() - 0.5))[0];
  }
  function giftCard(g, p, t, cards) {
    const ally = g.hostility && g.hostility(p, t) < 0;
    const s = cards.slice().sort((a, b) => value(g, t, a) - value(g, t, b));
    return ally ? s[s.length - 1] : s[0];
  }
  // 装备打分：要不要换上这件
  function equipScore(g, p, c) {
    if (!c) return 0;
    if (c.k === "xianka") return 2 + g.has(p, "tucao").length * 0.6;
    if (c.k === "fanghuoqiang") return 2.6 + (p.hp <= 2 ? 1 : 0);
    if (c.k === "chongdianbao") return 1.6 + (p.hand.length > p.hp ? 1 : 0);
    return 0;
  }
  function treatTarget(g, p) {
    const ts = g.skillTargets(p, "qingke");
    const allies = ts.filter((q) => q !== p && g.hostility && g.hostility(p, q) < 0).sort((a, b) => a.hp - b.hp);
    if (ts.includes(p) && (p.hp <= 2 || !allies.length)) return p;
    return allies[0] || (ts.includes(p) ? p : null);
  }
  function choose(g, p) {
    const H = (k) => p.hand.filter((c) => c.k === k);
    const others = g.others(p);
    if (!others.length) return null;
    const enemies = foes(g, p, others);
    const use = (c, targets = []) => ({ card: c, targets });
    // 0. 白拿的技能先用
    if (g.canSkill(p, "beg")) {                                   // 小 DeepSeek 蹭饭：先找最宠她的
      const ts = g.skillTargets(p, "beg"), fond = foes(g, p, ts).filter((q) => q.key === "gpt" || q.key === "claude");
      const t = fond.length ? richest(fond, p) : richest(ts, p);
      if (t) return { skill: "beg", target: t };
    }
    if (g.canSkill(p, "polish")) return { skill: "polish" };
    if (g.canSkill(p, "search")) return { skill: "search" };
    if (g.canSkill(p, "qingke")) { const t = treatTarget(g, p); if (t && (t !== p || p.hp <= p.maxHp - 1)) return { skill: "qingke", target: t }; }
    if (g.canSkill(p, "bundle")) { if (Engine.T.bundleRandom) return { skill: "bundle" }; const t = giftTarget(g, p); if (t) return { skill: "bundle", target: t }; }
    if (g.canSkill(p, "halluc") && (Engine.T.hallucCost ? p.hand.length >= 2 : true) && p.hp >= 2) return { skill: "halluc" };
    if (g.canSkill(p, "recall")) return { skill: "recall" };
    if (g.canSkill(p, "steal")) { const t = richest(g.skillTargets(p, "steal"), p); if (t) return { skill: "steal", target: t }; }
    if (g.canSkill(p, "buy")) {
      const ts = g.skillTargets(p, "buy").filter((q) => q.hand.length >= 2);
      const t = richest(ts, p);
      if (t && p.hand.length >= (Engine.T.buyCost ? 2 : 0)) return { skill: "buy", target: t };
    }
    if (g.canSkill(p, "reset") && (p.hand.length <= 1 || (p.hp <= 1 && p.hand.length <= 2))) return { skill: "reset" };
    // 1. 摸牌
    if (H("hongbao").length) return use(H("hongbao")[0]);
    // 1b. 装备：没装备就穿上，有更好的就换
    const eqs = p.hand.filter((c) => Engine.CD[c.k].type === "equip").sort((a, b) => equipScore(g, p, b) - equipScore(g, p, a));
    if (eqs.length && equipScore(g, p, eqs[0]) > equipScore(g, p, p.equip) + 0.3) return use(eqs[0]);
    // 2. 回血
    if (p.hp < p.maxHp && H("naicha").length) return use(H("naicha")[0]);
    if (p.hp < p.maxHp && H("tuanjian").length) return use(H("tuanjian")[0]);
    if (!enemies.length) return null;                             // 身份局开局还看不出谁是敌人：先不动手
    // 3. 风控封号：盯着手牌多或快赢的人
    if (g.canSkill(p, "ban")) {
      const t = biggest(g, p, g.skillTargets(p, "ban"));
      if (t && (t.hand.length >= 4 || g.round >= 3 || r() < 0.3)) return { skill: "ban", target: t };
    }
    // 3b. 维护日：同样盯着威胁大的人
    if (g.canSkill(p, "maint") && g.round >= 2) {
      const t = biggest(g, p, g.skillTargets(p, "maint"));
      if (t && (t.hand.length >= 3 || r() < 0.4)) return { skill: "maint", target: t };
    }
    // 4. 控场
    if (H("jinyan").length) {
      const t = richest(enemies.filter((q) => !q.banned && !q.muted), p) || richest(enemies, p);
      if (t) return use(H("jinyan")[0], [t]);
    }
    const rich = enemies.filter((q) => q.hand.length > 0);
    if (rich.length && H("baipiao").length) return use(H("baipiao")[0], [richest(rich, p)]);
    if (rich.length && H("chehui").length) return use(H("chehui")[0], [richest(rich, p)]);
    if (H("duanwang").length) {
      const t = richest(enemies.filter((q) => !q.offline && !q.banned), p);
      if (t) return use(H("duanwang")[0], [t]);
    }
    if (H("dangji").length && !g.bomb && p.hp >= 2) return use(H("dangji")[0]);
    // 5. 群伤：会打到所有人，组队时对手不比自己人少才用
    const aoeOk = enemies.length * 2 >= others.length;
    if (aoeOk && H("resou").length) return use(H("resou")[0]);
    if (aoeOk && H("shuaping").length) return use(H("shuaping")[0]);
    // 6. 单挑：自己吐槽多 或 对方手牌少
    if (H("dantiao").length) {
      const t = enemies.slice().sort((x, y) => (x.hand.length + (p.hits[x.i] || 0) * 2) - (y.hand.length + (p.hits[y.i] || 0) * 2))[0];
      if (t && (H("tucao").length >= 2 || t.hand.length <= 1 || (t.hp <= 1 && H("tucao").length >= 1))) return use(H("dantiao")[0], [t]);
    }
    // 6a. 截图 + 加班：准备好再吐槽
    const canT = H("tucao").length && p.tucao < g.limitTucao(p);
    if (canT && H("jietu").length && !p.evidence) {
      const t = pickTarget(g, p, enemies.filter((q) => q.hand.length > 0)) || pickTarget(g, p, enemies);
      if (t) return use(H("jietu")[0], [t]);
    }
    if (canT && H("jiaban").length && !p.boost) return use(H("jiaban")[0]);
    if (H("pindan").length && p.hand.length <= 4) return use(H("pindan")[0]);
    // 6b. 千问·狂欢：手里吐槽够多才开（第 3 轮起本来就能吐槽两次，要 3 张）
    if (g.canSkill(p, "sale") && !p.sale && H("tucao").length >= (g.round >= Engine.T.rageRound ? 3 : 2) && p.tucao === 0) return { skill: "sale" };
    // 7. 吐槽
    if (H("tucao").length && p.tucao < g.limitTucao(p)) {
      const ev = p.evidence && p.evidence.alive && g.rivals(p).includes(p.evidence) ? p.evidence : null;   // 截过图的那个先打
      const t = ev || pickTarget(g, p, others); if (t) return use(H("tucao")[0], [t]);
    }
    if (g.canSkill(p, "reset") && g.round >= 4 && p.hand.length <= 2) return { skill: "reset" };
    return null;
  }

  function respond(g, p, kind, ctx, cards) {
    if (kind === "fanbo" || kind === "tucao") return cards.length ? { card: cards[0] } : null;
    if (kind === "shuaiguo") {                                   // 甩锅：没反驳、或者快破防了，就甩给一个对手
      const outs = foes(g, p, ctx.outs || []);
      return outs.length && (!g.has(p, "fanbo").length || p.hp <= 1 || cards.length >= 2) ? { card: cards[0] } : null;
    }
    if (kind === "yidu") {
      const k = ctx.card.k;
      const many = cards.length >= 2;
      const want = k === "jinyan" || (k === "dantiao" && g.has(p, "tucao").length < 1) ||
        (k === "resou" && !g.has(p, "tucao").length) || (k === "shuaping" && !g.has(p, "fanbo").length) ||
        ((k === "baipiao" || k === "chehui") && (many || p.hand.length <= 2)) || (p.hp <= 1 && k !== "tuanjian") ||
        k === "dangji" || (k === "jietu" && g.has(p, "fanbo").length > 0) || (k === "duanwang" && (many || p.hand.length <= 2));
      return want ? { card: cards[0] } : null;
    }
    return null;
  }

  function discard(g, p, n) { return cheapest(g, p, n); }
  // 从一组牌里挑最有价值的（搜索 / 挥金 / 过目都用它）
  function pick(g, p, cards, n) { return cards.slice().sort((a, b) => value(g, p, b) - value(g, p, a)).slice(0, n); }

  // 豆包：吐槽被挡后要不要弃牌接着说；GPT：没反驳时要不要弃一张硬顶
  function wantLong(g, p, t) { return p.hand.length >= 2 || t.hp <= 1; }
  function wantZuiying(g, t, p) { return t.hp <= 2 || t.hand.length >= 4; }
  return { choose, respond, discard, pick, cheapest, pickTarget, richest, value, wantLong, wantZuiying, giftTarget, giftCard, treatTarget };
})();
