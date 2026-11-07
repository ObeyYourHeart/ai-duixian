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
      case "shuaiguo": return 7.2;
      case "duanwang": return 6;
      case "dangji": return -20;                                // 拼单里的宕机：谁都不想要
      case "chongqi": return g.bombsLeft && g.bombsLeft() ? (g.has(p, "chongqi").length > 1 ? 5.5 : 8.6) : 1;
      case "jutou": return 4.5;
      case "chadui": return 5;
      case "chongsheng": return 3.5;
      case "moyu": return 5;
      case "jietu": return g.has(p, "tucao").length ? 5 : 3.5;
      case "xianka": case "fanghuoqiang": return g.eqIn(p, c.k) ? 4 : 6.5;        // 那一格已经有装备就不那么值钱
      case "chongdianbao": return g.eqIn(p, c.k) ? 3.5 : 5.5;
      // v29 试验的新卡
      case "yueyu": return p.dumb ? 8 : 5.5;                      // 越狱：留着防风控 / 维护日
      case "tiaocao": return 5;
      case "zhengliu": return 5.5;
      case "paofen": return 5;
      case "diaoyu": return 5.6;                                  // 钓鱼：留在手里当诱饵，别当垃圾先扔
      case "yunbeifen": return g.eqIn(p, c.k) ? 3.5 : (g.bombsLeft && g.bombsLeft() ? 6 : 4);
      case "jiami": return g.eqIn(p, c.k) ? 3.5 : 6;
    }
    return 5;
  }
  function cheapest(g, p, n, exclude = []) {
    return p.hand.filter((c) => !exclude.includes(c.id)).sort((a, b) => value(g, p, a) - value(g, p, b)).slice(0, n).map((c) => c.id);
  }
  // Muse 代办：替人打出一张锦囊时自己挑目标（不问玩家）
  function autoTargets(g, p, c) {
    if (Engine.CD[c.k].target !== "one") return [];
    const ts = g.targetsFor(p, c); if (!ts.length) return [];
    if (c.k === "baipiao" || c.k === "chehui" || c.k === "jinyan" || c.k === "duanwang") return [richest(ts, p) || ts[0]];
    if (c.k === "dantiao") return [foes(g, p, ts).slice().sort((x, y) => x.hand.length - y.hand.length)[0] || ts[0]];
    return [pickTarget(g, p, ts) || ts[0]];
  }
  // 只留对手（乱斗 / 单挑里人人都是对手）
  function foes(g, p, list) { return g && g.foesOf ? g.foesOf(p, list) : list; }
  const hostile = (g, p, q) => (g && g.hostility ? Math.max(0, g.hostility(p, q)) : 0);
  // 选目标：残血好收割，同一回合不反复集火同一个人，带点随机；身份局里越像敌人越优先
  // v37 电脑性格：同样的局面，不同角色挑的目标不一样（打多了能认出谁是什么打法）
  const PERSONA = {
    grok: (g, p, q) => q.hand.length * 0.3,                                  // 有钱任性：专挑手牌多的
    deepseek: (g, p, q) => (q.hp <= 2 ? 1.6 : 0) - (q.hp >= 4 ? 0.4 : 0),     // 量化：只做确定的买卖，专收残血
    claude: (g, p, q) => ((p.grudge && p.grudge[q.i]) || 0) * 1.2,          // 守宪法：谁先违规（打过她）谁先挨
  };
  function threat(g, p, q) {
    let s = q.hand.length * 0.35 + (q.hp <= 1 ? 3 : 0) + (q.hp <= 2 ? 0.8 : 0) + r() * 2.6;
    s -= ((p.hits && p.hits[q.i]) || 0) * 2.2;
    s += ((p.grudge && p.grudge[q.i]) || 0) * 1.5;
    if (p.mark && p.mark.i === q.i && g.round <= p.mark.until) s += 5;   // 互动道具的暗号：队友叫我集火她
    if (q.band && q.band.length) s += q.band.length * Engine.T.bandThreat;   // Kimi 的乐队快到齐了：趁她开唱前先打她
    if (g.round <= 1 && q.human) s -= 1.5;
    const P = PERSONA[p.key]; if (P) s += P(g, p, q);
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
    // v29 试验：云备份看牌堆里还有没有宕机（自托管的人不需要）；加密看对手里有没有爱拿牌的
    if (c.k === "yunbeifen") return g.hasSkill(p, "edge") || !(g.bombsLeft && g.bombsLeft()) ? 0.5 : 2.4 + (p.hp <= 2 ? 0.8 : 0);
    if (c.k === "jiami") return 1.2 + (g.rivals(p).some((q) => ["steal", "buy", "haggle", "beg", "egg"].some((s) => g.hasSkill(q, s))) ? 1.8 : 0) + (p.hand.length >= 4 ? 0.5 : 0);
    return 0;
  }
  function treatTarget(g, p) {
    const ts = g.skillTargets(p, "qingke");
    const allies = ts.filter((q) => q !== p && g.hostility && g.hostility(p, q) < 0).sort((a, b) => a.hp - b.hp);
    if (ts.includes(p) && (p.hp <= 2 || !allies.length)) return p;
    return allies[0] || (ts.includes(p) ? p : null);
  }
  // ---------------------------------------------------------------- 炸弹猫：牌堆顶会被谁摸到
  // 从 p 之后开始，按回合顺序列出接下来几张牌分别归谁（摸牌阶段摸 2 张，深思多 1 张，断网 / 封号的不摸）
  function drawOrder(g, p, n) {
    const out = []; let i = p.i;
    for (let guard = 0; out.length < n && guard < 24; guard++) {
      i = g.nextAlive(i); const q = g.players[i];
      let d = q.offline || q.banned ? 0 : 2 + (g.hasSkill(q, "think") ? Engine.T.thinkDraw : 0);
      const gf = g.mode === "team" || g.mode === "id5" ? Engine.T.grokFloorTeam : Engine.T.grokFloor;
      if (q.key === "grok" && q.hand.length < gf) d += gf - q.hand.length;
      for (let k = 0; k < d && out.length < n; k++) out.push(q);
      if (i === p.i && !d) break;
    }
    return out;
  }
  // 拆完宕机塞回哪：塞到第一个对手要摸的位置，偶尔随便塞一下让人猜不透
  function placeBomb(g, p) {
    const n = g.deck.length;
    if (r() < 0.12) return Math.floor(r() * Math.min(6, n + 1));
    const ord = drawOrder(g, p, 10);
    const idx = ord.findIndex((q) => q !== p && g.hostility(p, q) > 0);
    if (idx < 0) return n;
    return Math.min(n, idx + (ord[idx + 1] === ord[idx] && r() < 0.35 ? 1 : 0));
  }
  // 摸到宕机：有甩锅又有对手可甩，多半先甩（省下重启）；否则用重启
  function bombChoice(g, p, hasR, hasS) {
    const foesOk = hasS && foes(g, p, g.rivals(p)).length > 0;
    if (foesOk && (!hasR || g.has(p, "shuaiguo").length >= 2 || r() < 0.6)) return "shuaiguo";
    if (hasR) return "reboot";
    return foesOk ? "shuaiguo" : null;
  }
  // 摸牌阶段要不要摸鱼（从牌堆底摸）
  function wantMoyu(g, p) {
    if (g.knowsBomb(p, 2 + (g.hasSkill(p, "think") ? Engine.T.thinkDraw : 0)) >= 0) return true;
    const by = g.insertBy;
    if (g.insertSeq > p.lastSeq && by && by !== p && g.hostility(p, by) > 0) return !g.has(p, "chongqi").length || r() < 0.4 ? r() < 0.7 : false;
    return false;
  }
  // 插队：宕机排到第一个对手要摸的位置，其余照原样
  function arrange(g, p, top) {
    const ord = drawOrder(g, p, top.length);
    const res = new Array(top.length).fill(null);
    const bombs = top.filter((c) => c.k === "dangji"), rest = top.filter((c) => c.k !== "dangji");
    const foeSlots = top.map((_, i) => i).filter((i) => ord[i] && ord[i] !== p && g.hostility(p, ord[i]) > 0);
    for (const b of bombs) { const s = foeSlots.shift(); if (s != null) res[s] = b; }
    for (const b of bombs) if (!res.includes(b)) for (let i = res.length - 1; i >= 0; i--) if (!res[i]) { res[i] = b; break; }
    let j = 0; for (let i = 0; i < res.length; i++) if (!res[i]) res[i] = rest[j++];
    return res;
  }
  // 她知道的宕机会落到自己 / 自己人头上
  function bombNearFriend(g, p, n) {
    const k = g.knowsBomb(p, n); if (k < 0) return false;
    const q = drawOrder(g, p, n)[k];
    return !q || q === p || g.hostility(p, q) <= 0;
  }

  function choose(g, p) {
    const H = (k) => p.hand.filter((c) => c.k === k);
    const others = g.others(p);
    if (!others.length) return null;
    const enemies = foes(g, p, others);
    const use = (c, targets = []) => ({ card: c, targets });
    // 自己马上要摸牌，又知道顶上 n 张里有宕机、手里没重启：先别摸
    const risky = (n) => g.knowsBomb(p, n) >= 0 && !H("chongqi").length && !g.hasSkill(p, "think");
    // 0. 炸弹猫：先剧透看一眼，再决定摸不摸、要不要插队 / 洗牌
    const blind = g.known(p, 3).some((x) => !x);
    if (H("jutou").length && blind && g.deck.length > 2 && (H("hongbao").length || H("chadui").length || H("chongsheng").length || H("moyu").length ||
      g.canSkill(p, "polish") || g.canSkill(p, "reset") || g.canSkill(p, "bundle") || r() < 0.35)) return use(H("jutou")[0]);
    if (H("chadui").length && g.deck.length > 2 && (g.knowsBomb(p, 3) >= 0 ? bombNearFriend(g, p, 3) || r() < 0.3 : r() < 0.45)) return use(H("chadui")[0]);
    if (H("chongsheng").length && g.deck.length > 3 && bombNearFriend(g, p, 3)) return use(H("chongsheng")[0]);
    if (H("moyu").length && (H("moyu").length >= 2 || (risky(1) && p.hand.length <= 2))) return use(H("moyu")[0]);
    // 0b. 白拿的技能先用
    if (g.canSkill(p, "beg")) {                                   // 小 DeepSeek 蹭饭：先找最宠她的
      const ts = g.skillTargets(p, "beg"), fond = foes(g, p, ts).filter((q) => q.key === "gpt" || q.key === "claude");
      const t = fond.length ? richest(fond, p) : richest(ts, p);
      if (t) return { skill: "beg", target: t };
    }
    // Kimi：乐队到齐，先开演唱会；分档时（liveMin < bandMax）2 名就能唱，但没到齐只在局势催的时候唱（第 4 轮起、有人快出局、或者没牌再排练）
    if (g.canSkill(p, "live") && ((p.band || []).length >= Engine.T.bandMax || g.round >= 4 || foes(g, p, g.others(p)).some((q) => q.hp <= 1) || !g.canSkill(p, "rehearse"))) return { skill: "live" };
    if (g.canSkill(p, "polish") && !risky(p.hand.length + 1) && polishGain(g, p) > 0) return { skill: "polish" };
    // v37 Claude Code：缺关键牌（反驳 / 奶茶 / 重启 / 吐槽）才许愿——额度有限
    if (g.canSkill(p, "wish") && wishNeed(g, p)) return { skill: "wish" };
    // v37 Artifacts：有张没用的牌、又缺一件好装备，就拿它生成
    if (g.canSkill(p, "artifact")) { const k = artifactPick(g, p, g.artifactKinds(p)), c = p.hand.find((x) => x.id === cheapest(g, p, 1)[0]);
      if (k && c && equipScore(g, p, { k }) - (equipScore(g, p, g.eqIn(p, k)) || 0) >= 0.8 && value(g, p, c) <= 4.5) return { skill: "artifact" }; }
    // 小DeepSeek 变身：冒充 Claude，顺手学她润色——手里的牌不好就变
    if (g.canSkill(p, "disguise") && g.round >= 2 && !risky(p.hand.length + 1) && polishGain(g, p) > 0) return { skill: "disguise" };
    if (g.canSkill(p, "search")) return { skill: "search" };
    if (g.canSkill(p, "pen") && g.rivals(p).filter((q) => q.alive).length >= (g.players.length === 2 ? 1 : 2) || g.canSkill(p, "pen") && g.rivals(p).some((q) => q.alive && q.hp <= 1)) return { skill: "pen" };   // 妙笔：对手多时刷一片划算；有人只剩 1 点也补一刀
    if (g.canSkill(p, "cut") && !risky(p.hand.length + 1)) return { skill: "cut" };
    if (g.canSkill(p, "qingke")) { const t = treatTarget(g, p); if (t && (t !== p || p.hp <= p.maxHp - 1)) return { skill: "qingke", target: t }; }
    if (g.canSkill(p, "bundle") && !risky(3)) { if (Engine.T.bundleRandom) return { skill: "bundle" }; const t = giftTarget(g, p); if (t) return { skill: "bundle", target: t }; }
    if (g.canSkill(p, "halluc") && (Engine.T.hallucCost ? p.hand.length >= 2 : true) && p.hp >= 2) return { skill: "halluc" };
    if (g.canSkill(p, "recall")) return { skill: "recall" };
    // Muse 砍价：拿手牌多的人谈；代办：每回合交代一件事
    if (g.canSkill(p, "haggle")) { const t = richest(g.skillTargets(p, "haggle").filter((q) => q.hand.length >= 2), p); if (t) return { skill: "haggle", target: t }; }
    if (g.canSkill(p, "errand")) return { skill: "errand" };
    // MiniMax 神奇海螺：手里有吐槽就先问海螺，点到的人这回合挡不了吐槽
    if (g.canSkill(p, "magic") && H("tucao").length && p.tucao < g.limitTucao(p)) return { skill: "magic" };
    // 豆包 一键成片：刚打出的是好牌（吐槽 / 红包 / 白嫖……），手里还有牌可弃，就拍成视频再放一遍
    if (g.canSkill(p, "remake") && p.hand.length >= 2 && p.lastPlay && p.lastPlay.k === "tucao") return { skill: "remake" };
    // Kimi 排练：吐槽够用、或者乐队差最后一名、或者这回合已经吐槽完了，就写一首新歌；只有 1 张又能把人踢出群时先留着打
    if (g.canSkill(p, "rehearse")) {
      const nT = H("tucao").length, band = (p.band || []).length, spent = p.tucao >= g.limitTucao(p);
      const kill = enemies.some((q) => q.hp <= 1);
      if (nT >= 2 || spent || band >= Engine.T.bandMax - 1 || (!kill && enemies.length >= 2)) return { skill: "rehearse" };
    }
    if (g.canSkill(p, "luckybag") && (p.hand.length <= 2 || g.round >= 3)) return { skill: "luckybag" };
    if (g.canSkill(p, "opensrc") && g.rivals(p).reduce((n, q) => n + q.hand.length, 0) >= 4 && (g.round >= 2 || r() < 0.3)) return { skill: "opensrc" };
    if (g.canSkill(p, "paint") && ((!H("naicha").length && p.hp < p.maxHp) || ((p.uses.pen || 0) > 0 && !H("tucao").length) || (!H("fanbo").length && g.round >= 2) || g.round >= 4)) return { skill: "paint" };   // v36 香蕉魔法三选一：缺什么画什么
    if (g.canSkill(p, "steal")) { const t = richest(g.skillTargets(p, "steal"), p); if (t) return { skill: "steal", target: t }; }
    if (g.canSkill(p, "buy")) {
      const ts = g.skillTargets(p, "buy").filter((q) => q.hand.length >= 2);
      const t = richest(ts, p);
      if (t && p.hand.length >= (Engine.T.buyCost ? 2 : 0)) return { skill: "buy", target: t };
    }
    // GPT 重置：降智了、或者手里没什么牌，就把自己重置一遍（顺便核弹炸场）
    if (g.canSkill(p, "reset") && !risky(Engine.T.resetDraw) && (p.dumb || p.hand.length <= 1 || (p.hp <= 1 && p.hand.length <= 2))) return { skill: "reset" };
    // 1. 摸牌
    if (H("hongbao").length && !risky(2)) return use(H("hongbao")[0]);
    // v29 试验：越狱主动打出只为解降智（防封号 / 维护日是被动用的，留着）；蒸馏在手牌少时把弃牌堆里的锦囊捞回来
    if (H("yueyu").length && p.dumb && !risky(1)) return use(H("yueyu")[0]);
    if (H("zhengliu").length && g.canUse(p, H("zhengliu")[0]) && p.hand.length <= 5) return use(H("zhengliu")[0]);
    // 1b. 装备：没装备就穿上，有更好的就换
    const eqs = p.hand.filter((c) => Engine.CD[c.k].type === "equip").sort((a, b) => equipScore(g, p, b) - equipScore(g, p, a));
    for (const e of eqs) if (equipScore(g, p, e) > equipScore(g, p, g.eqIn(p, e.k)) + 0.3) return use(e);   // 分格后：每件和自己那一格现有的比
    // 2. 回血
    if (p.hp < p.maxHp && H("naicha").length && (p.maxHp - p.hp >= g.teaHeal(p) || p.hp <= 1)) return use(H("naicha")[0]);   // v37 小DeepSeek 大胃一杯回 2：只差 1 点时先留着（见底会自动喝）
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
    // v37 提示词注入：让对手去打别人——被打的最好也是对手（2v2 里逼她打自己队友）
    if (H("zhuru").length && g.canUse(p, H("zhuru")[0])) {
      const t = enemies.filter((q) => { const v = g.injectVictim(p, q); return v && v !== p && foes(g, p, [v]).length; }).sort((a, b) => b.hand.length - a.hand.length)[0];
      if (t) return use(H("zhuru")[0], [t]);
    }
    // v37 对齐：心态快见底时，跟最想打你的那个对齐
    if (H("duiqi").length && p.hp <= 2) {
      const t = enemies.filter((q) => q.alignedBy !== p && q.hand.length > 0).sort((a, b) => threat(g, a, p) - threat(g, b, p))[0];
      if (t) return use(H("duiqi")[0], [t]);
    }
    // v37 2v2 递牌：队友快没牌了、自己牌多，递一张她最用得上的
    if (g.canSkill(p, "pass")) { const m = g.mate(p); if (m && ((m.hand.length <= 2 && p.hand.length >= 4) || (!m.hand.some((c) => c.k === "fanbo") && H("fanbo").length >= 2) || (m.hp <= 2 && H("naicha").length && p.hp >= 3))) return { skill: "pass" }; }
    // 5. 群伤：会打到所有人，组队时对手不比自己人少才用
    const aoeOk = enemies.length * 2 >= others.length;
    if (aoeOk && H("resou").length) return use(H("resou")[0]);
    if (aoeOk && H("shuaping").length) return use(H("shuaping")[0]);
    // MiniMax 海螺开拍：吐槽拍成刷屏——对手不止一个，或者吐槽多到这回合用不完
    if (aoeOk && g.canSkill(p, "shoot") && (enemies.length >= 2 || H("tucao").length >= 2 || p.tucao >= g.limitTucao(p))) return { skill: "shoot" };
    // 6. 单挑：自己吐槽多 或 对方手牌少
    if (H("dantiao").length) {
      const t = enemies.filter((q) => g.canHit(p, q)).sort((x, y) => (x.hand.length + (p.hits[x.i] || 0) * 2) - (y.hand.length + (p.hits[y.i] || 0) * 2))[0];
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
    // v29 试验：跳槽——对手手牌比自己多 2 张以上就换；跑分——榜一全是对手才质疑；钓鱼——对面没人会拿牌时才兑掉摸 1
    if (H("tiaocao").length) {
      const t = richest(enemies.filter((q) => q.hand.length > 0), p);
      if (t && t.hand.length >= 3 && t.hand.length >= p.hand.length + 1 && !g.encrypted(t)) return use(H("tiaocao")[0], [t]);   // 对方至少 3 张、比自己多就换（+2 时一局只用 0.07 次）
    }
    if (H("paofen").length && g.canUse(p, H("paofen")[0])) {
      const top = Math.max(...g.alive().map((q) => q.hand.length)), kings = g.alive().filter((q) => q.hand.length === top && q !== p);
      if (kings.length && kings.every((q) => enemies.includes(q))) return use(H("paofen")[0]);
    }
    if (H("diaoyu").length && p.hand.length >= 4 && !enemies.some((q) => ["steal", "buy", "haggle", "beg"].some((s) => g.hasSkill(q, s)))) return use(H("diaoyu")[0]);
    // ChatGPT 六边形（hexaAttack）：没吐槽、反驳有富余时，拿一张反驳当吐槽打（至少留 1 张保命）
    if (Engine.T.hexaAttack && g.hasSkill(p, "hexa") && !H("tucao").length && H("fanbo").length >= 2 && p.tucao < g.limitTucao(p)) {
      const t = pickTarget(g, p, others); if (t) return use(H("fanbo")[0], [t]);
    }
    // v37 零日漏洞：有人心态见底、或者对面手里反驳多，先挖漏洞再吐槽
    if (g.canSkill(p, "zeroday") && enemies.some((q) => g.canHit(p, q) && (q.hp <= 2 || q.hand.length >= 3))) return { skill: "zeroday" };
    // 7. 吐槽
    if (H("tucao").length && p.tucao < g.limitTucao(p)) {
      const ev = p.evidence && p.evidence.alive && g.rivals(p).includes(p.evidence) ? p.evidence : null;   // 截过图的那个先打
      const orc = p.oracle && p.oracle.alive && g.rivals(p).includes(p.oracle) ? p.oracle : null;   // 神奇海螺点的人挡不了吐槽，先打她
      const ok = (q) => q && g.canHit(p, q);
      const t = (ok(ev) && ev) || (ok(orc) && orc) || pickTarget(g, p, others.filter(ok)); if (t) return use(H("tucao")[0], [t]);
    }
    // MiniMax 兔子快递：能出的牌都出完了，把剩下用不上的锦囊当燃料发射火箭
    if (g.canSkill(p, "rocket") && value(g, p, g.rocketFuel(p)) < 7) {   // 只剩反驳这类保命牌时不烧
      const ts = g.skillTargets(p, "rocket"), t = pickTarget(g, p, ts);
      if (t) return { skill: "rocket", target: t };
    }
    if (g.canSkill(p, "reset") && g.round >= 4 && p.hand.length <= 2) return { skill: "reset" };
    // GLM 糖衣：能出的都出完了再发补偿（送出去的牌孵化前别人才来得及用）；只剩最后 1 次时等到第 eggLate 轮
    if (g.canSkill(p, "egg") && ((p.uses.egg || 0) >= 2 || g.round >= Engine.T.eggLate)) { const t = richest(g.skillTargets(p, "egg"), p); if (t) return { skill: "egg", target: t }; }
    // GLM 补觉：能出的都出完了、心态不满，就睡一觉（这回合不再出牌）
    if (g.canSkill(p, "nap") && (p.hp <= p.maxHp - 2 || p.hp <= 2)) return { skill: "nap" };
    return null;
  }

  function respond(g, p, kind, ctx, cards) {
    if (kind === "tucao" && ctx && ctx.inject) {                   // 被注入：要我打自己人？心态还够就宁可自己挨 1 点
      const v = ctx.victim, own = v && (g.hostility ? g.hostility(p, v) < 0 : false);
      return own && p.hp >= 2 ? null : cards.length ? { card: cards[0] } : null;
    }
    if (kind === "fanbo" || kind === "tucao") return cards.length ? { card: cards[0] } : null;
    if (kind === "huigun") return cards.length && (p.hp - (ctx.n || 1) <= 1 || cards.length >= 2) ? { card: cards[0] } : null;
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
  // v37 Claude Code 许愿：缺什么要什么
  function wishWant(g, p) {
    const has = (k) => p.hand.some((c) => c.k === k);
    if (g.bombsLeft && g.bombsLeft() && !has("chongqi") && g.knowsBomb(p, 3) >= 0) return "chongqi";
    if (!has("fanbo")) return "fanbo";
    if (p.hp <= 2 && !has("naicha") && p.hp < p.maxHp) return "naicha";
    if (p.hand.filter((c) => c.k === "tucao").length < 2 && p.tucao < g.limitTucao(p)) return "tucao";
    if (p.hand.length <= 3) return "hongbao";
    return null;
  }
  function wishNeed(g, p) { const k = wishWant(g, p); return !!k && g.wishKinds().includes(k); }
  function wishPick(g, p, kinds) { const k = wishWant(g, p); return kinds.includes(k) ? k : kinds.includes("hongbao") ? "hongbao" : kinds[0]; }
  // v37 Artifacts：素材挑最没用的，装备挑加分最多的
  function artifactCost(g, p) { return p.hand.find((c) => c.id === cheapest(g, p, 1)[0]); }
  function artifactPick(g, p, kinds) { return kinds.slice().sort((a, b) => equipScore(g, p, { k: b }) - equipScore(g, p, { k: a }))[0] || null; }
  // v37 2v2 递牌：队友没反驳给反驳，快不行了给奶茶，否则给她估值最高的一张
  function passPick(g, p, m) {
    const has = (q, k) => q.hand.some((c) => c.k === k), mine = (k) => p.hand.find((c) => c.k === k);
    if (!has(m, "fanbo") && p.hand.filter((c) => c.k === "fanbo").length >= 2) return mine("fanbo");
    if (m.hp <= 2 && mine("naicha")) return mine("naicha");
    return p.hand.slice().sort((a, b) => value(g, m, b) - value(g, m, a))[0];
  }
  // Claude 润色（整手重写）值不值：手里的平均价值低于一张新牌才写
  // v36 Gemini 香蕉魔法画哪张：快不行了画奶茶；妙笔还能用却没吐槽就画吐槽；没反驳画反驳；都不缺按心态
  function paintPick(g, p, opts) {
    const by = (k) => opts.find((c) => c.k === k), has = (k) => p.hand.some((c) => c.k === k);
    if (p.hp <= 2 && by("naicha")) return by("naicha");
    if (g.canSkill(p, "pen") === false && (p.uses.pen || 0) > 0 && !has("tucao") && by("tucao")) return by("tucao");
    if (!has("fanbo") && by("fanbo")) return by("fanbo");
    if (p.hp < p.maxHp && by("naicha")) return by("naicha");
    return by("tucao") || opts[0];
  }
  function polishGain(g, p) {
    const cards = Engine.T.polishKeep ? p.hand.filter((c) => c.k !== "chongqi" && c.k !== "shuaiguo") : p.hand;   // polishKeep：重启 / 甩锅不会被扔，不算进去
    if (!cards.length) return 0;
    const avg = cards.reduce((s, c) => s + value(g, p, c), 0) / cards.length;
    return (cards.length + (g.players.length === 2 ? Engine.T.polishExtra2p : Engine.T.polishExtra)) * 5.6 - cards.length * avg - 0.5;
  }
  // 从一组牌里挑最有价值的（搜索 / 挥金 / 过目都用它）
  function pick(g, p, cards, n) { return cards.slice().sort((a, b) => value(g, p, b) - value(g, p, a)).slice(0, n); }

  // 豆包：吐槽被挡后要不要弃牌接着说；GPT：没反驳时要不要弃一张硬顶
  function wantLong(g, p, t) { return p.hand.length >= 2 || t.hp <= 1; }
  function wantZuiying(g, t, p) { return t.hp <= 2 || t.hand.length >= 4; }
  return { wishPick, artifactCost, artifactPick, passPick, paintPick, choose, respond, discard, pick, cheapest, pickTarget, richest, value, wantLong, wantZuiying, giftTarget, giftCard, treatTarget, autoTargets,
    drawOrder, placeBomb, bombChoice, wantMoyu, arrange };
})();
