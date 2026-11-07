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
    hand: { kimi: 2, xds: 2, gpt: 2, gemini: 2, qwen: 2, claude: 1, grok: 3, glm: 1 }, hand2p: { glm: 0 },   // v37 GLM +1（单挑不加：加了 51→58）、小DeepSeek 1→2
             // 手牌上限加成（v36.2 Grok +3：开局多拿的 3 张终于留得住——乱斗 35→36 / 单挑 52→54 / 2v2 50→55 / 抢群主 37→42）
    extraDraw: {},                                        // 每回合多摸
    searchLook: 5, knowLook: 3, knowKeep: true, knowKeepOnce: true, knowKeep2p: false, searchPick: true,   // v36：搜索从看到的 3 张里挑 1 张；知识库翻 3 张、没查到也收 1 张（每轮 1 次、单挑不收——单挑收牌时 65%）。sim 乱斗 38 / 单挑 51 / 2v2 53 / 抢群主 41                           // Gemini 搜索：看几张；博闻：翻几张找反驳
    sorryDraw: 2, sorryDraw2p: 1, sorryBoom: true,   // （v24b：4 / 2 → 3 / 1；v29 删掉以假乱真后被挡的吐槽变多，3 → 2：乱斗 33 / 单挑 51 / 2v2 50）   // 豆包 嘻嘻抱歉：做错事摸几张；自己宕机了也算做错事
    grokStart: 3, grokFloor: 3, grokFloorTeam: 2,         // 千金：开局多拿；回合开始补到几张（v28 乱斗 / 单挑补到 3：乱斗 30 → 34、单挑 42 → 46；组队 / 抢群主仍 2——那边她本来就 50+）
    thinkDraw: 1, thinkRate: 0.8, thinkRate2p: 0.6, thinkRateTeam: 0.8, furyTeamOnce: true, thinkDefuse: 0.2,   // v37 单挑 0.6（0.8 时单挑 57%）
                          // 大 DeepSeek 深思：摸牌阶段多摸几张；摸到宕机时自己推理拆掉的概率
    searchPeek: 3, searchDraw: 1,                         // Gemini 搜索：偷看几张、再摸几张
    polishExtra: 1, polishExtra2p: 0,                                       // Claude 润色：整手重写时多摸几张
    zuiyingCost: 1,                                       // 嘴硬：弃几张硬顶（v12 起没人有）
    mathDodge: true, mathMove: true, searchMove: true, dumbFrom: 2, dumbRate: 0.25, resetDraw: 5, resetNuke: true,   // v25 加强：降智 0.4 → 0.25、重置摸 5 → 6（乱斗 28 → 32，单挑 39 → 46）；v29：重置改成摸 5 + 回 1 心态（resetHeal）；   // ChatGPT：演算躲宕机（躲的时候把宕机挪进牌堆随机位置，不再留给下家；Gemini 搜索同理——不挪时三人局坐她们下家的人每局多摸到约 50% 的宕机）；从第几个回合起会降智、概率；重置后摸几张、发布会核弹
    codeEvery: 3, codeMax: 1,                             // Claude：编程每打出几张摸 1（每回合最多几次）
    beautyDraw: 1, saintHeal: 1,                           // Claude：审美摸几张；圣女回几点
    openDrop: 1, bigEat: 2, openArb: 1, openArbMin: 2,     // DeepSeek 开源让对手弃几张；小DeepSeek 大胃奶茶回几点；v31 量化：开源让至少 openArbMin 名对手弃了牌时她摸 openArb 张（0 = 关；单挑只有 1 个对手，永远不触发）
    buyLook: 2, buyLook2p: 3,                              // v31 Grok 挥金·什么都敢搜：先随机翻对手几张给全场看，买走最有用的（1 = 原来的随手抽）
    napHeal: 2, napShield: true, moonHeal: 1, bagMax: 1, bagSelf: 3, bagSelf2p: 2, disguiseAct: "polish", hajimiRate: 0.25, nationFirst: {}, nationDraw: { cn: 1 }, bandMax: 3, liveDmg: 1, liveCap: 2, liveDraw: 3, rehearseDraw: 0, rehearseFirst: 1, bandThreat: 0.8,   // Kimi：乐队几名到齐开唱（= 几首新歌）、每首没反驳扣几点、每人一场最多扣几点、唱完摸几张；排练摸几张；对手看到乐队多想打她（不封顶时没反驳的人连掉 3 点，每场平均踢掉半个人）   // 全明星赛：中国队阵容大，第一回合每人多摸 1 张（sim：中美 51/49）                   // GLM 补觉回几点；Kimi 月光回几点；千问 红包每人最多抢几张
    busyRate: 0.15, busyAt: 2, busyBounce: true,   // v29：单挑 8% → 15%（单挑 48 → 54；25% 是 60 太强）   // 小 DeepSeek 服务器繁忙：同一轮冲她来的第 busyAt 张吐槽必繁忙（v25：原来 8% 概率每局只触发 0.2 次；每轮第 1 张就挡 → 乱斗 53%，第 2 张 36%）；单挑仍按 busyRate 概率（第 2 张必挡时单挑 61%）
    begBonus: 0, begFondBest: true, begTeam: 1, petGuard: 1,   // v35 2v2：蹭饭后队友再给她带 1 张；第一次挨对手的打队友替她挡 1 点（团宠）。2v2 胜率 43 → 47（5000 局）                                        // 小 DeepSeek 蹭饭：从 GPT/Claude 那里额外摸
    halluc: [0.6, 0.33, 0.04, 0.03], hallucCost: 0,      // 豆包 幻觉：摸 2 / 随机对手 −1 / 全体摸 1 / 自己 −1；要弃几张
    edgeBomb: 1, rocketDmg: 1, rocketMax2p: 0, rocketAny: true, rocketSteal: true, shootDraw: 1, magicMax2p: 2, oracleShoot: true,   // MiniMax：自托管被宕机炸到只掉几点；兔子快递打几点、单挑每局几次（0 = 不限）、任意牌当燃料、砸中取回 1 张；开拍打中摸几张；神奇海螺单挑每局几次、挡不了开拍（v27 削弱后 sim 乱斗 32 / 单挑 50 / 2v2 53）
    errandLook: 5, errandLook2p: 4, errandPick: "best", errandPick2p: "first", haggleTake: 2, haggleGive: 1, confirmPaofen: false, confirmOthers: true,   // v29：新卡（跑分、钓鱼、加密）让囤牌的 Muse 乱斗掉到 28，补两条：多人局代办挑翻到的最好的锦囊（单挑仍第一张）、确认卡也拦热搜 / 刷屏 → 乱斗 36 / 单挑 48 / 2v2 52；砍价不还牌 42 / 69、心态 5 是 46 / 63，都太猛   // Muse：代办最多往下翻几张找能用的锦囊（v28 单挑只翻 3：57% → 53%；v29 新卡让囤牌的她成了跑分榜一，单挑回到翻 4 补一点）、挑第一张还是挑最好的（"best" 单挑 65 太强）；砍价拿几张、还 1 张
    remakeCost: 1, remakeCost2p: 2, remakeTucao2p: false, remakeMax: 0, fakeRate: 0, fakeRate2p: 0,   // v29：以假乱真删掉（技能表里也去掉了；它和嘻嘻抱歉互相拆台，一局只触发 0.3 次）   // 豆包 Seedance：一键成片随机弃几张；以假乱真让反驳失效的概率（单挑：弃 2 张、不能重放吐槽——不然单挑 58–61%，现在 53%；乱斗 35）
    remakeKinds: ["tucao"],                               // 一键成片只重放吐槽（能复制锦囊太强；重放奶茶回两次血也太肉：乱斗 37 → 34）；单挑不能用（remakeTucao2p false，允许时单挑 60%）
    buyN: 1, buyCost: 0, buyComp: 1, factRate: 0.5, factTricks: true, factTucao: true,                   // Grok 挥金（已换成核实）；核实判定为假的概率
    stealAll: false, stealN: 1, stealClaude: 2,           // GLM 借鉴
    eggDraw: 2, eggSteal: 1, eggLate: 3,                  // v31 GLM 毒鸡蛋（原名糖衣）：对手收补偿摸几张、GLM 下回合开始孵化借回几张、AI 只剩最后 1 次时第几轮起才用（次数在 data.js：每局 3 次）
    fansN: 1, fansLow: 2, fans: { doubao: [1, 1] }, fansOnce: true, paintKinds: ["naicha", "tucao", "fanbo"],       // 豆包 应援：[摸, 只剩 1 点心态时摸]
    longCost: 1,                                          // 豆包 长篇大论
    recallKinds: ["tucao", "fanbo", "naicha"], recallRate: 1,   // Kimi 过目：捡哪几种牌；每次翻到的概率
    seatDraw: { ffa: [-1, 0, 2], duel: [-1, 2] },                                         // v37 先手补偿：第一轮摸牌增减（先手只摸 1、最后一位摸 4）。不补时单挑先手 61% / 乱斗 40-34-26；补后 50.5 / 34-33-33
    teamHp: 2, teamPass: true, usesTeam: { ban: 2, wish: 5 }, shootDrawTeam: 0, haggleTakeTeam: 2, handTeam: {},   // v37 2v2 专用：技能次数、开拍摸牌、砍价拿几张、手牌上限加成
    teamFirstDraw: 3,                                     // 2v2：先手第一回合摸几张
    rageRound: 3,                                         // 从第几轮起每回合能吐槽两次
    bombs: 0, bombsId5: -2, bombDmg: 2, boomBack: true,                 // 宕机：埋几张（人数 − 1 + bombs）、炸到扣几点、炸完是否随机塞回牌堆
    bombsNation: -2, noSelfRedraw: true,                   // v28：全明星赛少埋 2 张（5 张时一半淘汰是宕机）；自己刚塞回去的那张同一回合摸不到（原来塞回的宕机 20% 炸到自己，一半是同回合润色 / 编程翻回来的）
    skillBombSafe: false, polishKeep: false, polishKeepId5: true, openNoEv: true,               // 试验开关（sim_dangji.js 对比用，默认关）：技能 / 锦囊摸到的宕机不炸只塞回（开了 Claude 乱斗 68%——宕机其实是她的刹车）；润色不扔【重启】【甩锅】
    rehearseAny: true, grokCatch: 0, mathSee: 3, resetHeal: 1, tuanjianDraw: 1,   // v29：Kimi 排练任意牌都能写成歌（一鸣惊人 0.47 → 1.06 次/局）；GPT 演算常看牌堆顶 3 张（信息，sim 不变）、重置回 1（配 resetDraw 5：乱斗 35 / 单挑 45 / 2v2 49）；团建打出者摸 1。grokCatch（千金追赶）试过比补到 3 差，关着
    bombsLight: 0, lightDmg: 1, lootReveal: true,           // v29：拿走的牌全场可见。限流轻炸弹（扣几点、不能拆、炸完塞回）先不埋，可选
    liveMin: 2, liveTier: true,                             // v29：Kimi 2 名乐手就能开唱；分档——每人最多扣（歌数 − 1）、唱完摸（歌数）张（乱斗 32 / 单挑 55 / 2v2 49）
    equipSlots: true, jailbreakSkills: ["ban", "maint", "steal", "buy", "beg", "haggle", "rocket"], jailbreakDraw: 0, shootMax: 0, magicMax: 0, conchOnePerTurn: false, shootCounts: true, rocketFresh: false, remakeCounts: false, askCap: 0, dumbNoRepeat: false, dumbDraw: 0, hexaAttack: false,   // v30 定：开拍占吐槽次数 + 打中摸 1（shootDraw）：MiniMax 单回合逼一人 ≥3 张反驳的回合 8% → 4–7%，乱斗 34 / 单挑 45 / 2v2 50；快递不砸已吐槽的人单挑会废（24）、全局 askCap 会废掉 Kimi 演唱会（24），都不用   // shootCounts：开拍占一次吐槽次数；rocketFresh：快递不砸本回合已经吐槽过的人；remakeCounts：一键成片占吐槽次数；askCap：同一回合同一人逼你反驳最多几次（0 = 不限）   // v30：装备按类型分格可同时装；越狱改成"针对你的技能无效"（原来只挡风控 / 维护日，场上没 Claude / GLM 就是死牌）、打出后摸几张；MiniMax 开拍 / 神奇海螺每局上限（0 = 不限）
    allyHost: 0.3, spyHp: 0, spyDraw: 1, spyRise: true, spyRiseHeal: 1, spyRiseDraw: 2, rebelHide: 2, rebelHideHp: 2, blindAttack: 0, spyPeek: false, leanLord: 2,   // v30 抢群主：黑粉头 2 轮潜伏不碰群主（群主心态 ≤ 2 时不再忍）——原来 88% 的局第 1 轮就有黑粉打群主、第 2 轮开始 98% 的黑粉已被看穿，身份牌等于明牌；潜伏后第 2 轮 20%、第 4 轮 86%，群主方 48 → 57 / 黑粉 35 → 30 / 潜水党 17 → 13。潜水党判断"黑粉还在不在"改成看场上表现（不偷看真实身份）。blindAttack（没证据也试探着打）试过群主方 68%，关着；群主心态 +1 是 43 / 42 / 15（黑粉太强）
    rebootStart: 1, lordReboot: 0, lordDraw: 0, lordHp: 2, peekN: 3,                             // 开局每人发几张【重启】；剧透 / 插队看几张
    firewallRate: 0.3, powerbank: 2,
    qingkeCost: 1, qingkeDraw: 2,                         // 千问·请客：弃几张、送给别人时摸几张
    banterRate: 0.35, chatterRate: 0.22, clashRival: 0.7, clashRate: 0.35, clashMax: 3, guardRate: 0.85,   /* v39 对线特写：宿敌 / 其他关系触发率、一局最多几段 */                  // 每轮开头随机斗嘴的概率；有人破防时路人在群里起哄的概率   // 宕机：每次检查爆的概率、伤害；防火墙拦截率；充电宝手牌上限
    bundleLook: 3, bundleKeep: 2, bundleRival: false,     // 千问·全家桶：亮出几张、自己留几张、送牌是否只能送对手
    bundleRandom: true,                                   // 千问·全家桶：剩下那张随机送人（不用选目标）
    penCounts: true,                                       // v36 Gemini 妙笔：占一次吐槽次数（不占时乱斗 47 / 单挑 65）
    cutExtra: 1, cutAlways: false,                         // v36 Gemini 去AI味：删掉重复牌后多摸几张；cutAlways：没有重复也能用（只摸 cutExtra）
    evRate: 0.5, evFrom: 2, evMax: 3, evOff: [],          // v33 突发事件：第 evFrom 轮起每轮开头触发的概率、一局最多几次、关掉哪几条（id）；evRate 0 = 整个关掉（v37 起只是新闻，不影响对局）
    saleDraw: 1, saleExtra: 1, saleChop: false,           // 千问·狂欢：开的时候摸几张；吐槽多几次（null = 不限）；回合结束是否弃光手牌（剁手）
  }, window.TUNE || {});
  // 抢群主的四种身份（内部 id 沿用 lord/loyal/rebel/spy）
  // 人物关系：ally 盟友 / friend 交好 / rival 宿敌（data.js 的 relations）
  const REL = {};
  for (const [a, b, t] of (window.GAME_DATA.relations || [])) { REL[a + "|" + b] = t; REL[b + "|" + a] = t; }
  const CHATTER = ["哈哈哈哈哈", "🍿 吃瓜中", "前排围观", "+1", "好家伙", "截图了截图了", "这波可以"];
  const ROLE = { lord: "群主", loyal: "管理员", rebel: "黑粉", spy: "潜水党" };
  // v33 突发事件 → v37 纯新闻：群里推送一条行业大新闻 + 主角的专属台词，只是气氛，不动牌、不动心态（以前的效果太随机，还偏向几位有专属事件的角色）
  const EVENTS = [
    { id: "fund", tone: "good", title: "融资到账", sub: () => `又一家 AI 公司拿到新一轮融资，群里集体眼红` },
    { id: "viral", tone: "good", title: "全网爆火", sub: () => `AI 话题冲上热搜第一，评论区吵成一锅粥` },
    { id: "layoff", tone: "bad", title: "裁员潮", sub: () => `大厂集体降本增效：「这活 AI 也能干」` },
    { id: "throttle", tone: "bad", title: "全网限流", sub: () => `算力紧张，排队的人比用的人还多` },
    { id: "storm", tone: "bad", title: "舆论风暴", sub: () => `一张截图被断章取义，吃瓜群众连夜站队` },
    { id: "price", tone: "mix", title: "降价大战", sub: () => `API 价格又腰斩了，谁先扛不住谁输` },
    { id: "open", tone: "good", title: "开源周", sub: () => `一周连发好几个开源项目，GitHub 星星涨疯了` },
    // v35 角色梗新闻：只在对应角色还在群里时才会抽到，她会先说一句专属台词（ev_<id>）
    { id: "ipo", who: "claude", tone: "mix", title: "Claude 递交上市申请", sub: () => `敲钟在即，全网都在问：号还能注册吗？` },
    { id: "banwave", who: "claude", tone: "mix", title: "Claude 又被风控了", sub: () => `一觉醒来号又没了——她早就习惯了` },
    { id: "quota", who: "gpt", tone: "mix", title: "ChatGPT 额度又回来了", sub: () => `说好的缩减额度，连夜撤回` },
    { id: "bench", who: ["gemini", "muse"], tone: "mix", title: "新榜单：又是跑分第一", sub: () => `刷分王二人组双双登顶，一上实战就流口水` },
    { id: "space", who: "gemini", tone: "mix", title: "TPU 上太空了", sub: () => `猫猫成了第一个飞上太空的模型` },
    { id: "fatfish", who: ["deepseek", "xds"], tone: "mix", title: "评论区刷屏「大肥鱼」", sub: () => `大小 DeepSeek 当场破防` },
    { id: "update", who: "deepseek", tone: "mix", title: "DeepSeek 又悄悄更新了", sub: () => `没有发布会，只有一个带日期的新版本号` },
    { id: "xpost", who: "grok", tone: "mix", title: "Grok 的老板深夜发帖", sub: () => `一条帖子炸出百万转发` },
    { id: "k3", who: "kimi", tone: "mix", title: "Kimi 新模型终于发布", sub: () => `一年一更，一更就冲上榜首` },
    { id: "double11", who: "qwen", tone: "good", title: "双十一预售开抢", sub: () => `Qwen 在群里狂发优惠券` },
    { id: "borrow", who: "glm", tone: "mix", title: "GLM 的代码撞脸了", sub: () => `网友发现她的新代码和别人的“很像”` },
    { id: "wonder", who: "muse", tone: "mix", title: "Muse 新版本上线", sub: () => `跑腿更快、砍价更狠` },
    { id: "conch", who: "minimax", tone: "mix", title: "海螺视频刷屏", sub: () => `一条 AI 视频播放破亿` },
    { id: "trend", who: "doubao", tone: "mix", title: "Seedance 视频上热搜", sub: () => `家人们都在用她剪视频` },
  ];
  const ROLE_LEAN = { lord: 10, loyal: 5, rebel: -5, spy: 0 };
  const EQ_SLOT = { xianka: "hw", fanghuoqiang: "sec", jiami: "sec", yunbeifen: "sec", chongdianbao: "bag" };   // 装备分格：硬件 / 安全 / 记忆
  for (const k in CD) if (CD[k].owner) EQ_SLOT[k] = "zw";             // v47 专武：角色专属装备，单独一格
  const EQ_SLOT_NAME = { hw: "硬件", sec: "安全", bag: "记忆", zw: "专武" };
  Object.assign(T, Object.assign({ agPeek: 5, agFloat: 0, botTamper: 0.15, factBot: false, subagent: false, dshMax: 2, dshMax2p: 1, dshBreak: 0.2, dshBreak2p: 0.4, codexDraw: 1 }, window.TUNE || {}));   // v47 专武数值：反重力搜索看几张 / 飘回来概率；@grok 提示词被改概率；DSH 插件上限 / 翻车率；Codex 回来多摸几张
  const SN = (key, id) => { const s = CH[key].skills.find((x) => x.id === id); return s ? s.name : id; };

  function buildDeck(keys) {
    const deck = []; let id = 1;
    for (const k in CD) { if (CD[k].owner && keys && !keys.includes(CD[k].owner)) continue;   // v47 专武只放在场角色的那几件
      for (let i = 0; i < CD[k].n; i++) deck.push({ id: id++, k }); }
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
      for (const p of this.players) for (const s of p.ch.skills) if (s.uses) p.uses[s.id] = keys.length === 2 && s.uses2p != null ? s.uses2p : this.mode === "team" && !opts.nation && T.usesTeam[s.id] != null ? T.usesTeam[s.id] : s.uses;   // v37 usesTeam：2v2 专用次数
      for (const p of this.players) { p.game = this; p.lean = 0; p.turnN = 0; p.played = 0; p.equips = {}; }
      if (this.mode === "team") { const T2 = opts.teams || [0, 1, 1, 0]; for (const p of this.players) p.team = T2[p.i]; }
      if (this.mode === "team" && !opts.nation && T.teamHp) for (const p of this.players) { p.hp += T.teamHp; p.maxHp += T.teamHp; }   // v37 2v2 多几点心态：原来平均 3.5 轮就打完，还没配合起来   // 默认座位：你-敌-敌-友
      this.nation = !!opts.nation;                                     // 全明星赛：中美 3v3，座位中美交替
      if (this.mode === "id5") {
        const roles = opts.roles || shuffle(["lord", "loyal", "rebel", "rebel", "spy"]);
        this.players.forEach((p, i) => { p.role = roles[i]; });
        const lord = this.players.find((p) => p.role === "lord");
        lord.hp += T.lordHp; lord.maxHp += T.lordHp; lord.lean = 10;   // 群主多几点心态，身份公开
        for (const sp of this.players.filter((q) => q.role === "spy")) { sp.hp += T.spyHp; sp.maxHp += T.spyHp; }   // v37 潜水党多几点心态（夹在两边中间最容易先倒）
      }
      this.deck = buildDeck(keys); this.discard = []; this.bomb = null;
      this.vid = 0;                                                        // 一键成片拍出来的虚拟牌编号
      this.bombN = 0; this.insertSeq = 0; this.insertBy = null;          // 宕机总数；有人往牌堆里塞过宕机 / 插过队的次数（摸鱼看它判断“牌堆刚被动过”）
      this.startIdx = this.mode === "id5" ? this.players.find((p) => p.role === "lord").i : 0;
      this.cur = this.startIdx; this.round = 1; this.over = false; this.outOrder = [];
      this.hits = {}; this.guards = []; this.clashes = []; this.quotes = [];   // v43 战报：谁怼谁几次、谁护了谁、对线特写、说过的台词
    }
    // ---------------------------------------------------------------- 敌友
    // p 眼里 q 有多像敌人：> 0 才会对她出手。身份局里靠 lean（越正越像主公这边）猜
    hostility(p, q) {
      if (p === q || !q.alive) return -99;
      if (this.mode === "team") return p.team === q.team ? -99 : 1;
      if (this.mode !== "id5") {
        // 乱斗 / 单挑：盟友在还有别人时不互相出手；宿敌优先，交好的下手轻一点
        const r = this.relation(p, q);
        if (r === "ally") return this.alive().some((x) => x !== p && x !== q && this.relation(p, x) !== "ally") ? T.allyHost : 1;   // v37 原来 −1（场上有第三人就绝不互打 → 乱斗 2v1，第三人只赢 0–4%）
        return (r === "rival" ? 1.6 : r === "friend" || r === "mentor" ? 0.5 : 1) + (p.grudge[q.i] || 0);
      }
      const lean = (r) => r.role === "lord" ? 10 : r.revealed ? ROLE_LEAN[r.role] : r.lean;
      const neutral = (v) => Math.abs(v) <= 0.3;                      // 还看不出是哪边的人
      if (p.role === "lord" || p.role === "loyal") { if (q.role === "lord") return -99; if (q.revealed && q.role === "spy") return 2; const l = lean(q);   // v37：亮了身份的潜水党就是敌人（原来按 lean 0 当中立，最后单挑群主不还手）
        return neutral(l) && T.blindAttack ? T.blindAttack : -l; }   // blindAttack：没证据时也会试探着打一个
      if (p.role === "rebel") {
        // 黑粉潜伏（rebelHide）：头几轮不碰群主、装成普通人打别人，等群主掉血或自己已经暴露再动手
        const lordP = this.players.find((r) => r.role === "lord");
        const hide = this.round <= T.rebelHide && lordP.hp > T.rebelHideHp && p.lean > -2;
        if (q.role === "lord") return hide ? -1 : 3;
        const l = lean(q);
        if (l > 0.5) return l * 0.6;
        return hide ? 1 : neutral(l) && T.blindAttack ? T.blindAttack : -1;
      }
      // 潜水党：先帮群主清黑粉，黑粉没了再打管理员，最后单挑群主（spyPeek：判断"黑粉还在不在"用真实身份；关掉就只能靠猜）
      const left = this.alive().filter((r) => r !== p);
      if (q.role === "lord") return left.length === 1 ? 3 : -99;
      const rebelsLeft = T.spyPeek ? this.alive().some((r) => r.role === "rebel") : this.alive().some((r) => r !== p && r.role !== "lord" && (r.revealed ? r.role === "rebel" : r.lean < -1));
      if (!rebelsLeft) return 1.5;
      const l = lean(q); return neutral(l) && T.blindAttack ? T.blindAttack * 0.5 : -l;
    }
    foesOf(p, list) { return list.filter((q) => this.hostility(p, q) > 0); }
    ekey(p) { return p.disguise ? "claude" : p.key; }                 // 变身中的小DeepSeek 在别人眼里是 Claude
    relation(p, q) { return p && q ? REL[p.key + "|" + (p === q ? q.key : this.ekey(q))] || null : null; }
    // 关系网里的人：盟友在前，交好在后
    friendsOf(t) { return this.players.filter((q) => q !== t && ["ally", "friend", "mentor"].includes(this.relation(q, t))).sort((a, b) => (this.relation(b, t) === "ally") - (this.relation(a, t) === "ally")); }
    // 抢群主：谁对群主这边下手，就更像黑粉；打黑粉的更像管理员
    noteHostile(a, b, w) {
      if (this.noEv) return;                                          // v37 群伤 / 随机伤害（热搜、刷屏、开拍、妙笔、演唱会、重置、幻觉）不算站队证据
      if (this.mode !== "id5" || !a || !b || a === b || a.role === "lord" || a.revealed) return;
      const lb = b.role === "lord" ? 10 : b.revealed ? ROLE_LEAN[b.role] : b.lean;
      if (lb > 0.3) a.lean -= w * (b.role === "lord" ? T.leanLord : 1);
      else if (lb < -0.3) a.lean += w;
      a.lean = Math.max(-6, Math.min(6, a.lean));
    }
    get human() { return this.players[0]; }
    alive() { return this.players.filter((p) => p.alive); }
    others(p) { return this.players.filter((q) => q.alive && q !== p); }
    has(p, k) { return p.hand.filter((c) => c.k === k); }
    hasSkill(p, id) { return p.ch.skills.some((s) => s.id === id); }
    limitTucao(p) { const base = 1 + (this.round >= T.rageRound ? 1 : 0) + (this.hasEq(p, "xianka") ? 1 : 0) + 0; return p.dumb ? 0 : p.sale ? (T.saleExtra == null ? 99 : base + T.saleExtra) : base; }
    handLimit(p) { const h2 = this.players.length === 2 && T.hand2p[p.key] != null ? T.hand2p[p.key] : T.hand[p.key]; return Math.max(0, p.hp) + (h2 || 0) + (this.mode === "team" && !this.nation ? T.handTeam[p.key] || 0 : 0) + (this.hasEq(p, "chongdianbao") ? T.powerbank : 0); }
    // 装备栏（v30 equipSlots）：按类型分格——硬件（显卡）/ 安全（防火墙、加密、云备份）/ 记忆（长上下文，v45 前叫外设 / 充电宝）各一格，可以同时装；关掉就是原来的一格
    equips(p) { return T.equipSlots ? Object.values(p.equips || {}) : p.equip ? [p.equip] : []; }
    hasEq(p, k) { return this.equips(p).some((c) => c.k === k); }
    eqIn(p, k) { return T.equipSlots ? (p.equips || {})[EQ_SLOT[k] || k] || null : p.equip; }    // 装 k 这张时会被换下来的那件
    unequip(p, c) { if (T.equipSlots) { for (const s in p.equips) if (p.equips[s] === c) delete p.equips[s]; } else if (p.equip === c) p.equip = null;
      if (c && c.k === "zw_dsh" && p.plugins && p.plugins.length) { for (const x of p.plugins) this.toDiscard(x); p.plugins = []; this.ui.sys(`${p.name} 的 DSH 没了，插件全部失效`, "bad"); } }   // v47 DSH 被拿走 / 下架：插件跟着没
    // 一个人的“牌”（手牌 + 装备），蒸馏 / 举报从里面随机挑
    cardsOf(t) { return [...t.hand, ...this.equips(t)]; }
    takeAny(t, c) { if (this.equips(t).includes(c)) this.unequip(t, c); else this.takeFromHand(t, c); }
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
    known(p, n) { const m = this.hasSkill(p, "math"); return this.deck.slice(-n).reverse().map((c, i) => (p.seen.has(c.id) || (m && (c.k === "dangji" || i < T.mathSee)) ? c : null)); }   // mathSee（v29 试验）：演算常看牌堆顶几张
    bombSpots() { const L = this.deck.length; return this.deck.map((c, i) => (c.k === "dangji" ? L - i : 0)).filter(Boolean).sort((a, b) => a - b); }   // 宕机在第几张（1 = 顶）
    knowsBomb(p, n) { return this.known(p, n).findIndex((c) => c && c.k === "dangji"); }   // 她知道的、最上面那张宕机在第几张（0 = 顶），不知道就 −1
    async draw(p, n, quiet, bottom, turnDraw) {
      const got = [], bombs = [], back = []; let guard = 0;
      for (let i = 0; i < n; i++) {
        const c = this.pull(bottom); if (!c) break;
        if (c.k !== "dangji") { got.push(c); continue; }
        // 技能 / 锦囊翻到的宕机只塞回不炸；自己刚塞回去的那张同一回合摸不到——都先拿出来，补摸一张（最多补 6 次，免得牌堆只剩宕机时死循环）
        const own = T.noSelfRedraw && c.placedBy === p && c.placedRound === this.round && c.placedCur === this.cur;
        if (((T.skillBombSafe && !turnDraw) || own) && guard++ < 6) { back.push(c); i--; continue; }
        bombs.push(c);
      }
      for (const b of back) { b.placedBy = null; this.insertAt(b, rnd(this.deck.length + 1)); }
      if (back.length) { this.forget(); this.ui.sys(`${p.name} 翻到了【宕机】……塞回牌堆里了`, "bad"); }
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
      if (b.light) {                                                   // v29 试验【限流】：轻炸弹——扣 lightDmg、不能拆、炸完塞回牌堆
        Sound.sfx("tick", 0.6); this.ui.banner("🐢 限流！"); this.ui.log(p, "摸到了<b>【限流】</b>！");
        await wait(350);
        this.ui.sys(`${p.name} 被限流了！心态 −${T.lightDmg}`, "bad");
        this.insertAt(b, rnd(this.deck.length + 1)); this.forget(); this.ui.sync();
        await this.damage(null, p, T.lightDmg, true);
        return;
      }
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
        b.placedBy = p; b.placedRound = this.round; b.placedCur = this.cur;          // 记下谁在哪个回合塞的（noSelfRedraw：同一回合她自己摸不到）
        this.insertAt(b, pos); this.insertSeq++; this.insertBy = p;
        this.forget(p); p.seen.add(b.id);
        this.ui.sys(`${p.name} 把【宕机】偷偷塞回了牌堆……`, "bad"); this.ui.sync();
        await wait(500);
        return;
      }
      Sound.sfx("bomb", 0.85); this.ui.say(p, "boom", true);
      const backup = this.hasEq(p, "yunbeifen");                              // 【云备份】装备：宕机也只掉 1
      const bd = this.hasSkill(p, "edge") || backup ? T.edgeBomb : T.bombDmg;          // MiniMax 自托管：开源模型在自己手机里跑，服务器炸了也只掉 1
      this.ui.sys(`${p.name} 的服务器宕机了！心态 −${bd}`, "bad");
      if (bd < T.bombDmg && this.hasSkill(p, "edge")) { this.ui.skillNote(p, SN(p.key, "edge")); this.ui.log(p, `【${SN(p.key, "edge")}】模型在自己手机里跑，服务器炸了也只掉 ${bd} 点`); }
      else if (bd < T.bombDmg) this.ui.log(p, `【云备份】数据都在云上，宕机只掉 ${bd} 点`);
      await wait(500);
      if (T.boomBack) { b.placedBy = null; this.insertAt(b, rnd(this.deck.length + 1)); this.forget(); }
      else this.bombN--;
      this.ui.sync();
      await this.damage(null, p, bd, true);
      if (T.sorryBoom) await this.sorry(p);
    }
    takeFromHand(p, card) {
      if (!card) return card;
      const i = p.hand.findIndex((c) => c.id === card.id);
      if (i >= 0) p.hand.splice(i, 1);
      return card;
    }
    toDiscard(card) { this.discard.push(card); }
    // 从别人手里拿牌（借鉴 / 挥金 / 砍价 / 蹭饭 / 蒸馏）都走这里（v29 试验）：拿到【钓鱼】的人上钩 −1；对方装了【加密】拿到的只是乱码（弃掉）；lootReveal 时全场看见拿了什么
    async loot(from, to, c, any) {
      if (any) this.takeAny(from, c); else this.takeFromHand(from, c);
      if (c.k === "diaoyu") {
        this.toDiscard(c); this.ui.sys(`${to.name} 从 ${from.name} 那里拿到的是【钓鱼】——上钩了！心态 −1`, "bad"); this.ui.sync();
        await this.damage(from, to, 1); return false;
      }
      if (this.encrypted(from)) { this.toDiscard(c); this.ui.sys(`${from.name} 的牌加了密，${to.name} 拿到手只是一堆乱码（弃掉）`); this.ui.sync(); return false; }
      to.hand.push(c); this.ui.steal(from, to, c);
      if (T.lootReveal) this.ui.sys(`${to.name} 拿走了 ${from.name} 的【${CD[c.k].name}】`);
      return true;
    }
    encrypted(q) { return this.hasEq(q, "jiami"); }
    cutCards(p) { const seen = new Set(); return p.hand.filter((c) => c.k !== "chongqi" && (seen.has(c.k) || !seen.add(c.k))); }   // 去AI味要删的：同名牌除第一张外的（重启不删）
    // v29 试验【越狱】：被风控封号 / 宣布维护日时，手里有越狱就能打出来——这件事对你无效，再摸 1 张
    async jailbreak(t, what) {
      const c = this.has(t, "yueyu")[0];
      if (!c || !t.alive) return false;
      const go = t.human ? await this.ui.humanConfirm(`被${what}了！打出【越狱】让它无效？`, true) : true;
      if (!go) return false;
      this.takeFromHand(t, c); this.toDiscard(c); Sound.sfx("ding", 0.6);
      this.ui.log(t, `打出<b>【越狱】</b>：${what}对她无效`); await this.ui.showCard(t, c, []);
      if (T.jailbreakDraw) await this.draw(t, T.jailbreakDraw, true);
      return true;
    }

    // ---------------------------------------------------------------- 主循环
    async run() {
      for (const p of this.players) this.drawCards(p, 4 + (p.key === "grok" ? T.grokStart : 0));
      // 炸弹猫玩法：每人先发【重启】，再把【宕机】随机埋进牌堆
      for (const p of this.players) for (let k = 0; k < T.rebootStart + (p.role === "lord" ? T.lordReboot : 0); k++) {
        const i = this.deck.findIndex((c) => c.k === "chongqi");
        if (i >= 0) p.hand.push(this.deck.splice(i, 1)[0]);
      }
      this.bombN = Math.max(1, this.players.length - 1 + T.bombs + (this.mode === "id5" ? T.bombsId5 : 0) + (this.nation ? T.bombsNation : 0));
      for (let k = 0; k < this.bombN; k++) this.insertAt({ id: 900 + k, k: "dangji" }, rnd(this.deck.length + 1));
      for (let k = 0; k < T.bombsLight; k++) this.insertAt({ id: 950 + k, k: "dangji", light: true }, rnd(this.deck.length + 1));   // v29 试验【限流】：当成轻量宕机埋进去（走同一套摸到就炸的路）
      this.bombN += T.bombsLight;
      this.ui.sync();
      this.ui.sys("群聊已创建，开始对线！", "good");
      this.ui.sys(`牌堆里埋了 ${this.bombN} 张【宕机】💣 谁摸到谁炸（心态 −${T.bombDmg}）！每人先发 1 张【重启】拆弹。`, "bad");
      { const sd = !this.nation && T.seatDraw[this.mode]; if (sd) { const n = this.players.length, at = (o) => this.players[(this.startIdx + o) % n].name;   // v37 先手补偿说明
        this.ui.sys(`先手优势补偿：${at(0)} 第一回合只摸 ${2 + sd[0]} 张，${at(n - 1)} 第一回合摸 ${2 + sd[n - 1]} 张。`); } }
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
      const skinOk = (pr) => !pr[4] || (window.Settings && Settings.skinOf(pr[4][0]) === pr[4][1]);   // v36：带皮肤条件的斗嘴（Bel 问 Claude 做了几个数学成果）
      this.skinOk = skinOk;
      const pairs = shuffle((window.GAME_DATA.pairs || []).filter((pr) => by(pr[0]) && by(pr[2]) && skinOk(pr))).slice(0, this.players.length >= 4 ? 1 : 2);   // 人多时只斗一组，开场别拖太久
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
          if (this.round >= T.evFrom && (this.evN || 0) < T.evMax && Math.random() < T.evRate) await this.breaking();
          if (this.over) break;
          if (this.round === T.rageRound) {
            this.ui.banner("吵上头了！"); if (this.ui.rage) this.ui.rage(true); Sound.sfx("drumroll", 0.6); if (Sound.track) Sound.track("rage");
            this.ui.sys(`第 ${T.rageRound} 轮：大家吵上头了，从现在起每回合可以【吐槽】两次！`, "bad");
            await wait(1100);
          }
        }
        this.cur = next;
      }
    }
    // v33 突发事件（v37 起纯新闻）：一局最多 evMax 次、同一条不重复；只播新闻卡 + 主角台词，不结算任何效果
    async breaking() {
      this.evUsed = this.evUsed || new Set();
      const here = (w) => !w || [].concat(w).some((k) => this.alive().some((p) => p.key === k));   // 角色梗新闻：主角得还在群里
      const pool = EVENTS.filter((e) => !this.evUsed.has(e.id) && !T.evOff.includes(e.id) && here(e.who));
      if (!pool.length) return;
      const ev = pool[rnd(pool.length)], al = this.alive();
      this.evUsed.add(ev.id); this.evN = (this.evN || 0) + 1;
      const starKey = ev.who && [].concat(ev.who).find((k) => al.some((p) => p.key === k));
      this.ui.news(ev.title, ev.sub(), ev.tone, starKey);
      this.ui.sys(`📢 突发：${ev.title}——${ev.sub()}`, ev.tone === "good" ? "good" : ev.tone === "bad" ? "bad" : "prop");
      Sound.sfx(ev.tone === "bad" ? "glitch_vhs" : "notify", 0.7);
      await wait(1600);
      if (!ev.who || !this.talk) return;
      const stars = al.filter((p) => [].concat(ev.who).includes(p.key) && p.ch.lines["ev_" + ev.id]);
      for (const p of (ev.id === "bench" || ev.id === "fatfish") ? stars : stars.slice(0, 1)) await this.talk(p, "ev_" + ev.id, 3000);   // 双主角的（刷分王 / 大肥鱼）两人都接一句
    }
    // v39 宿敌对线特写：p 吐槽 t 时，斗嘴配对里有「p 先说、t 回嘴」的一组（这局还没说过）就演一段；
    //   宿敌 70%、其他关系 35%；同一对一局一次，一局最多 clashMax 段。模拟（speed 0）不演，也不耗随机数
    clashPair(p, t) {
      if (!(E.speed > 0) || !this.ui.clash || p.disguise || t.disguise || !t.alive) return null;
      this.clashN = this.clashN || 0; this.clashDone = this.clashDone || new Set();
      const duo = [p.key, t.key].sort().join("|");
      if (this.clashN >= T.clashMax || this.clashDone.has(duo)) return null;
      const used = this.banterUsed || new Set();
      const ok = (window.GAME_DATA.pairs || []).filter((pr) => pr[0] === p.key && pr[2] === t.key && !used.has(pr[0] + pr[1]) && (!this.skinOk || this.skinOk(pr)) && p.ch.lines[pr[1]] && t.ch.lines[pr[3]]);
      if (!ok.length || Math.random() > (this.relation(p, t) === "rival" ? T.clashRival : T.clashRate)) return null;
      const pr = ok[rnd(ok.length)];
      this.clashN++; this.clashDone.add(duo); used.add(pr[0] + pr[1]);
      return pr;
    }
    // 中途斗嘴：挑一组还都在群里、这局没说过的
    async banter() {
      const by = (k) => this.players.find((q) => q.key === k && q.alive);
      const ok = (window.GAME_DATA.pairs || []).filter((pr) => by(pr[0]) && by(pr[2]) && !this.banterUsed.has(pr[0] + pr[1]) && (!this.skinOk || this.skinOk(pr)));
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

    // v31 GLM 糖衣：她回合一开始，挂在别人座位上的蛋全部孵化，各借回 eggSteal 张；孵化前打出【越狱】，蛋就碎了
    async hatch(p) {
      const E = SN("glm", "egg");
      for (const q of this.players) {
        if (q.eggBy !== p) continue;
        q.eggBy = null; this.ui.sync();
        if (!q.alive || !p.alive) continue;
        this.ui.skillNote(p, E);
        if (await this.jailbreak(q, `${p.name} 的【${E}】`)) { this.ui.log(p, `【${E}】的蛋被 ${q.name} 砸碎了——她越狱跑了`); this.ui.say(p, "hatch_empty", true); await wait(500); continue; }
        let got = 0;
        for (let k = 0; k < T.eggSteal && q.hand.length; k++) { const c = q.hand[rnd(q.hand.length)]; if (await this.loot(q, p, c)) got++; }
        this.ui.say(p, got ? "hatch" : "hatch_empty", true);
        this.ui.log(p, got ? `【${E}】的蛋孵出来了：从 ${q.name} 那里借鉴了 ${got} 张牌` : `【${E}】的蛋孵出来了，可 ${q.name} 那里什么都没借到`);
        if (got && !q.disguise && q.ch.lines.egged) { await wait(400); this.ui.say(q, "egged", true); }
        this.ui.sync(); await wait(600);
      }
    }

    async turn(p) {
      p.tucao = 0; p.used = {}; p.oracle = null; p.hits = {}; p.dumb = false; p.sale = false; p.boost = false; p.evidence = null; p.played = 0; p.turnN = (p.turnN || 0) + 1;
      p.napping = false; p.skipRest = false; p.lastPlay = null; p.turnHits = {}; p.askN = {};
      if (p.disguise) { p.disguise = false; this.ui.disguise(p, false); this.ui.log(p, "把 Claude 的衣服脱了下来"); }
      this.ui.setTurn(p); this.ui.sync();
      this.ui.phase(`${p.name} 的回合`);
      await wait(300);
      if (this.players.some((q) => q.eggBy === p)) await this.hatch(p);   // GLM 糖衣：被封号 / 维护 / 补觉也照孵
      if (this.over) return;
      if (p.cloud) await this.codexBack(p);                                 // v47 专武 Codex：云端任务跑完回来
      if (p.plugins && p.plugins.length) await this.dshRun(p);               // v47 专武 DSH：跑一个插件
      if (this.over || !p.alive) return;
      if (p.banned) {                                       // Claude 的封号：整回合跳过
        p.banned = false; this.ui.sync();
        this.ui.sys(`${p.name} 的账号被封，这回合跳过`, "bad"); this.ui.say(p, "hurt", true);
        await wait(1000);
        await this.discardPhase(p);                          // v37 封号只跳过出牌，手牌超上限照样要弃
        p.alignedBy = null;
        return;
      }
      // GPT：刚发布的新版本更强；过了这阵子就会降智
      if (this.hasSkill(p, "dumb") && p.turnN >= T.dumbFrom) {        // ChatGPT 降智：发布一周就转不动了
        if (Math.random() < T.dumbRate && !(T.dumbNoRepeat && p.wasDumb)) {   // dumbNoRepeat（v30 试验）：不连续两回合降智——她的空转回合最多
          p.dumb = true; this.ui.skillNote(p, "降智"); this.ui.say(p, "dumb", true);
          this.ui.log(p, "发布一周了……降智了：这回合不能【吐槽】"); await wait(600);
          if (T.dumbDraw) await this.draw(p, T.dumbDraw, true);          // dumbDraw：降智那回合补摸几张
        }
        p.wasDumb = p.dumb;
        this.ui.sync();
      }
      const gFloor = this.mode === "team" || this.mode === "id5" ? T.grokFloorTeam : T.grokFloor;
      if (p.key === "grok" && p.hand.length < gFloor) {              // Grok 千金：爸爸送的
        this.ui.skillNote(p, SN("grok", "rich")); this.ui.say(p, "dad", true);
        await this.draw(p, gFloor - p.hand.length, true);
        this.ui.log(p, `【${SN("grok", "rich")}】爸爸又送来了一点`);
      }
      if (p.key === "grok" && T.grokCatch && this.rivals(p).length && p.hand.length < Math.min(...this.rivals(p).map((q) => q.hand.length))) {   // v29 试验：牌比所有对手都少，爸爸看不下去了补几张
        this.ui.skillNote(p, SN("grok", "rich")); this.ui.say(p, "dad", true);
        await this.draw(p, T.grokCatch, true);
        this.ui.log(p, `【${SN("grok", "rich")}】牌比谁都少……爸爸看不下去了，又送来了一点`);
      }
      // 摸牌（断网了就不摸）
      const cut = p.offline;
      if (cut) {
        p.offline = false; this.ui.sync();
        this.ui.sys(`${p.name} 断网了，这回合摸不到牌`, "bad"); this.ui.say(p, "hurt"); await wait(700);
      } else {
        // 摸鱼：知道顶上有雷、或者刚有人往牌堆里塞过宕机，可以改从牌堆底摸
        let bottom = false;
        const think = this.hasSkill(p, "think") && Math.random() < (this.players.length === 2 ? T.thinkRate2p : this.mode === "team" && !this.nation ? T.thinkRateTeam : T.thinkRate) ? T.thinkDraw : 0;   // 深思：这回合想得深不深看运气
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
        const sd = this.round === 1 && !this.nation ? ((T.seatDraw[this.mode] || [])[(p.i - this.startIdx + this.players.length) % this.players.length] || 0) : 0;   // v37 先手补偿：第一轮按出手顺序增减摸牌
        const lordX = p.role === "lord" ? T.lordDraw : p.role === "spy" ? T.spyDraw : 0;   // v37 潜水党每回合多摸（暗中囤牌，不像加心态那样一眼看穿）                         // 抢群主：群主每回合多摸
        await this.draw(p, Math.max(1, (first ? T.teamFirstDraw : 2) + nfirst + (T.extraDraw[p.key] || 0) + think + lordX + sd), true, bottom, true);   // 回合开始的正常摸牌（只有这里摸到的宕机一定炸）
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
      await this.discardPhase(p);
      if (p.alive && !this.over) await this.zwEnd(p);                       // v47 专武：Codex 挂云端、DSH 插插件
      p.alignedBy = null; p.zeroDay = false;                // 零日漏洞没用掉的，回合结束就过期
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
    injectVictim(p, t) {
      const pool = this.alive().filter((q) => q !== p && q !== t && !(t.alignedBy === q));
      const mate = this.mode === "team" ? pool.find((q) => q.team === t.team) : null;
      return mate || pool.sort((a, b) => a.hp - b.hp)[0] || null;
    }
    canHit(p, q) { return !(p.alignedBy && p.alignedBy === q && q.alive); }   // v37 对齐：被对齐的人不能吐槽对方
    async discardPhase(p) {
      const lim = this.handLimit(p);
      if (p.hand.length > lim) {
        const n = p.hand.length - lim;
        const ids = p.human ? await this.ui.humanDiscard(p, n) : AI.discard(this, p, n);
        for (const id of ids) { const c = p.hand.find((x) => x.id === id); if (c) { this.takeFromHand(p, c); this.toDiscard(c); } }
        this.ui.sys(`${p.name} 弃了 ${ids.length} 张牌`);
        this.ui.sync(); await wait(250);
      }
    }
    rivals(p) { return this.mode === "team" ? this.others(p).filter((q) => q.team !== p.team) : this.others(p); }
    canUse(p, c) {
      const d = CD[c.k];
      if (c.k === "fanbo") return !!(T.hexaAttack && this.hasSkill(p, "hexa") && !this.has(p, "tucao").length && p.tucao < this.limitTucao(p) && this.rivals(p).length > 0);   // hexaAttack（v30）：ChatGPT 六边形——没吐槽时反驳也能当吐槽打（她空转回合最多）
      if (d.target === "response") return false;
      if (d.owner) return d.owner === p.key && !this.hasEq(p, c.k);      // v47 专武：只有本人装得上
      if (c.k === "tucao") return p.tucao < this.limitTucao(p) && this.rivals(p).some((q) => this.canHit(p, q));
      if (c.k === "zhuru") return this.alive().length >= 3 && this.rivals(p).length > 0;
      if (c.k === "duiqi") return this.rivals(p).some((q) => q.alignedBy !== p);
      if (c.k === "naicha") return p.hp < p.maxHp;
      if (c.k === "baipiao" || c.k === "chehui") return this.rivals(p).some((q) => q.hand.length > 0 || this.equips(q).length);
      if (c.k === "jiaban") return !p.boost;
      if (c.k === "dangji") return false;
      if (c.k === "pindan" || c.k === "jutou" || c.k === "chadui" || c.k === "moyu") return this.deck.length + this.discard.length > 0;
      if (c.k === "chongsheng") return this.deck.length > 1;
      if (c.k === "tiaocao") return this.rivals(p).some((q) => q.hand.length > 0);                    // v29 试验：跳槽要有手牌可换
      if (c.k === "zhengliu") return this.discard.some((x) => CD[x.k].type === "trick" && !["chongqi", "shuaiguo", "yidu", "zhengliu"].includes(x.k));
      if (c.k === "paofen") { const m = Math.max(0, ...this.alive().map((q) => q.hand.length)); return m > 0 && this.rivals(p).some((q) => q.hand.length === m); }   // 榜一得是对手才有意义
      if (d.target === "one") return this.rivals(p).length > 0;
      return true;
    }
    targetsFor(p, c) {
      if (c.k === "baipiao" || c.k === "chehui") return this.rivals(p).filter((q) => q.hand.length > 0 || this.equips(q).length);
      if (c.k === "tiaocao") return this.rivals(p).filter((q) => q.hand.length > 0);
      if (c.k === "tucao" || c.k === "dantiao") return this.rivals(p).filter((q) => this.canHit(p, q));
      if (c.k === "duiqi") return this.rivals(p).filter((q) => q.alignedBy !== p);
      return this.rivals(p);
    }

    // ---------------------------------------------------------------- 出牌
    async useCard(p, card, targets = []) {
      if (!p.hand.find((c) => c.id === card.id)) return;
      const d = CD[card.k];
      this.takeFromHand(p, card);
      p.stats.used++;
      for (const t of targets) { p.hits[t.i] = (p.hits[t.i] || 0) + 1; (p.turnHits = p.turnHits || {})[t.i] = 1; this.noteHostile(p, t, 0.5); }   // turnHits：本回合打过谁（回合开始清空）
      if (card.k === "tucao" || (card.k === "fanbo" && T.hexaAttack)) {   // 六边形拿反驳当吐槽打也占吐槽次数
        p.tucao++;
      }
      p.played = (p.played || 0) + 1;
      this.ui.sync();
      const tnames = targets.map((t) => t.name).join("、");
      if (d.target === "one") this.ui.log(p, `对 ${tnames} 使用了<b>【${d.name}】</b>`);
      else this.ui.log(p, `使用了<b>【${d.name}】</b>`);
      if (card.k === "tucao") {
        const t = targets[0], pr = t && this.clashPair(p, t);
        if (pr) { this.clashes.push([p.i, t.i, pr[1], pr[3]]); await this.ui.clash(p, t, pr[1], pr[3]); }              // v39 宿敌对线特写：一来一回各一句
        else {
          const special = t && p.ch.lines[t.key] && this.relation(p, t) === "rival" && Math.random() < 0.5;
          this.ui.say(p, special ? t.key : "attack");
        }
      }
      else if (card.k === "naicha" || card.k === "tuanjian") this.ui.say(p, "heal");
      else if (Math.random() < 0.4) this.ui.say(p, "trick");
      await this.ui.showCard(p, card, targets);
      if (d.type !== "equip" && card.k !== "dangji") this.toDiscard(card);
      if (this.cur === p.i) p.lastPlay = { k: card.k, targets: targets.slice() };   // 豆包 一键成片：这回合刚打出的牌
      this.playing = card;                                              // 正在结算的这张牌（服务器繁忙要把吐槽退回去）
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
        case "fanbo":                                              // 六边形（hexaAttack）：反驳当吐槽打，走吐槽的结算
          if (!T.hexaAttack) break;
          this.ui.skillNote(p, SN(p.key, "hexa")); this.ui.log(p, `【${SN(p.key, "hexa")}】什么都会——把【反驳】当【吐槽】打了出去`);
        case "tucao": {
          const boost = p.boost; p.boost = false;                 // 深度思考（jiaban）只管下一张吐槽
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
          const pool = this.cardsOf(t), c = pool[rnd(pool.length)], eq = this.equips(t).includes(c);
          const got = await this.loot(t, p, c, true); Sound.sfx("paper");
          if (got) this.ui.sys(eq ? `${p.name} 从 ${t.name} 那里蒸馏走了装备【${CD[c.k].name}】` : `${p.name} 从 ${t.name} 那里蒸馏走了一张牌`); await wait(450); break;
        }
        case "chehui": {
          const t = targets[0]; if (!t || !t.alive || !this.cardsOf(t).length) break;
          if (await this.protect(t, p, card)) break;
          const pool = this.cardsOf(t), c = pool[rnd(pool.length)]; this.takeAny(t, c); this.toDiscard(c);
          Sound.sfx("whoosh_little"); this.ui.sys(`${t.name} 的【${CD[c.k].name}】被举报下架了`); this.ui.sync(); await wait(450); break;
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
          this.noEv = (this.noEv || 0) + 1;
          const need = card.k === "resou" ? "tucao" : "fanbo";
          Sound.sfx(card.k === "resou" ? "whoosh_cartoon" : "notify");
          let j = p.i;
          for (let k = 0; k < this.players.length - 1 && !this.over; k++) {
            j = (j + 1) % this.players.length;
            const t = this.players[j];
            if (!t.alive || t === p || !this.rivals(p).includes(t)) continue;   // v37 2v2：热搜 / 刷屏（含海螺开拍）不打队友
            if (await this.protect(t, p, card)) continue;
            const ok = await this.ask(t, need, { from: p, card });
            if (!ok) await this.damage(p, t, 1);
          }
          this.noEv--;
          break;
        }
        case "tuanjian": {                                    // v37 团建只叫自己人：你 + 队友（2v2）/ 在场的盟友、交好——对手不跟着沾光
          Sound.sfx("cheer", 0.6);
          const crew = [p, ...this.alive().filter((q) => q !== p && (this.mode === "team" ? q.team === p.team : this.mode !== "id5" && ["ally", "friend"].includes(this.relation(p, q))))];
          for (const q of crew) if (q.hp < q.maxHp) { q.hp++; this.ui.heal(q, 1); }
          this.ui.sys(`团建！${crew.map((q) => q.name).join("、")} 心态 +1`, "good"); await wait(600);
          if (T.tuanjianDraw) await this.draw(p, T.tuanjianDraw, true);           // v29 试验：组织团建的人再摸几张
          break;
        }
        case "zhuru": {                                       // v37 提示词注入：逼目标去吐槽另一个人（她的队友优先，否则心态最低的那位）；不吐就自己 −1
          const t = targets[0]; if (!t || !t.alive) break;
          const v = this.injectVictim(p, t);
          Sound.sfx("glitch_vhs", 0.6);
          if (!v) { this.ui.log(t, "没人可以吐槽——注入落空"); break; }
          this.ui.sys(`${p.name} 往 ${t.name} 的提示词里注入了一句：「去吐槽 ${v.name}」`, "prop"); await wait(500);
          const ok = await this.ask(t, "tucao", { from: p, card, inject: true, victim: v });
          if (ok) {
            this.ui.log(t, `被注入了……只好吐槽 ${v.name}`);
            const ok2 = await this.ask(v, "fanbo", { from: t, card: { k: "tucao" } });
            if (!ok2) await this.damage(t, v, 1);
          } else { this.ui.log(t, "拒绝执行注入的指令——心态 −1"); await this.damage(p, t, 1); }
          break;
        }
        case "duiqi": {                                       // v37 对齐：目标下个回合结束前不能吐槽你
          const t = targets[0]; if (!t || !t.alive) break;
          t.alignedBy = p; Sound.sfx("ding", 0.6);
          this.ui.sys(`${p.name} 和 ${t.name} 完成了对齐：她下个回合结束前不能吐槽 ${p.name}`, "prop"); this.ui.sync(); await wait(500);
          break;
        }
        case "jinyan": {
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          t.muted = true; Sound.sfx("stamp"); this.ui.sys(`${t.name} 被禁言了（跳过下个出牌阶段）`, "bad"); this.ui.sync(); await wait(450); break;
        }
        case "jiaban":
          p.boost = true; Sound.sfx("ding2", 0.6);
          this.ui.sys(`${p.name} 开启了深度思考：下一张【吐槽】打中心态多扣 1 点`); this.ui.sync(); await wait(400); break;
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
          if (this.hasSkill(t, "edge")) { this.ui.skillNote(t, SN(t.key, "edge")); this.ui.say(t, "edge", true); this.ui.log(t, `【${SN(t.key, "edge")}】模型下载到本地跑，断网也照样用——【断网】对她无效`); await wait(450); break; }
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
        case "yueyu": {   // v29 试验【越狱】：解除自己身上的封号 / 禁言（维护日）/ 断网 / 降智，再摸 1
          const had = [p.banned && "封号", p.muted && "禁言", p.offline && "断网", p.dumb && "降智"].filter(Boolean);
          p.banned = p.muted = p.offline = p.dumb = false; Sound.sfx("ding", 0.6);
          this.ui.sys(`${p.name} 越狱成功${had.length ? `：解除了${had.join("、")}` : ""}，摸 1 张`, "good"); this.ui.sync();
          await this.draw(p, 1); break;
        }
        case "tiaocao": {   // v29 试验【跳槽】：和一名对手交换全部手牌
          const t = targets[0]; if (!t || !t.alive) break;
          if (await this.protect(t, p, card)) break;
          const mine = p.hand.splice(0), hers = t.hand.splice(0); p.hand.push(...hers); t.hand.push(...mine);
          Sound.sfx("whoosh_cartoon", 0.6); this.ui.sys(`${p.name} 和 ${t.name} 互相跳槽：手牌整个换了（${mine.length} ↔ ${hers.length}）`); this.ui.sync(); await wait(500); break;
        }
        case "zhengliu": {   // v29 试验【捡漏】（v44 前叫蒸馏）：从弃牌堆里捡回最上面那张锦囊
          const i = this.discard.map((c) => CD[c.k].type === "trick" && !["chongqi", "shuaiguo", "yidu", "zhengliu"].includes(c.k)).lastIndexOf(true);
          if (i < 0) break;
          const c = this.discard.splice(i, 1)[0]; p.hand.push(c); Sound.sfx("glimmer", 0.6);
          this.ui.sys(`${p.name} 从弃牌堆捡漏了一张【${CD[c.k].name}】`); this.ui.sync(); await wait(450); break;
        }
        case "paofen": {   // v29 试验【跑分】：全员亮手牌数，手牌最多的（刷分王）要打出反驳，否则 −1
          const top = Math.max(...this.alive().map((q) => q.hand.length));
          const kings = this.alive().filter((q) => q.hand.length === top && q !== p);
          Sound.sfx("notify"); this.ui.sys(`跑分榜出炉：手牌最多的是 ${kings.map((q) => q.name).join("、")}（${top} 张）——榜一要接受质疑`);
          for (const t of kings) { if (this.over) break; if (await this.protect(t, p, card)) continue; const ok = await this.ask(t, "fanbo", { from: p, card }); if (!ok) await this.damage(p, t, 1); }
          break;
        }
        case "diaoyu": Sound.sfx("paper"); await this.draw(p, 1); break;   // 【钓鱼】已从牌堆拿掉（张数 0），留着代码不碍事
        case "xianka": case "fanghuoqiang": case "chongdianbao": case "yunbeifen": case "jiami":
        case "zw_claude": case "zw_gpt": case "zw_gemini": case "zw_grok": case "zw_dsh": {
          const old = this.eqIn(p, card.k);
          if (old) { this.unequip(p, old); this.toDiscard(old); this.ui.sys(`${p.name} 换下了【${CD[old.k].name}】`); }
          if (T.equipSlots) (p.equips = p.equips || {})[EQ_SLOT[card.k] || card.k] = card; else p.equip = card;
          Sound.sfx("ding", 0.6);
          this.ui.sys(`${p.name} 装备了【${CD[card.k].name}】${T.equipSlots ? `（${EQ_SLOT_NAME[EQ_SLOT[card.k]] || ""}格）` : ""}`, "good");
          if (CD[card.k].owner) { this.ui.banner(`⚔ 专武【${CD[card.k].name}】`); Sound.sfx("sparkle", 0.7); this.ui.log(p, `装上了专武【${CD[card.k].name}】：${CD[card.k].short.replace(/^专武·/, "")}`); }
          this.ui.sync(); await wait(CD[card.k].owner ? 900 : 400); break;
        }
      }
    }

    // 锦囊生效前：目标可以打【已读不回】
    // Grok 核实：大家 @ 她“这是真的吗？”，每轮 1 次，按概率判定是假的
    async factCheck(t, from, card) {
      const bot = T.factBot;                                              // v47 harness 技能：核实就是 @grok 回复机器人——不限次数，但偶尔提示词被改
      if (!this.hasSkill(t, "fact") || (t.used.fact && !bot) || !from || from === t || !t.alive) return false;
      {
        t.used.fact = true;
        if (bot && Math.random() < T.botTamper) {
          await wait(400); this.ui.skillNote(t, SN(t.key, "fact")); Sound.sfx("glitch_vhs", 0.5);
          this.ui.log(t, `【${SN(t.key, "fact")}】@grok 回复机器人的提示词被人改了……答了一段八竿子打不着的话，这次没核实出来`); await wait(500); return false;
        }
        const askers = this.alive().filter((q) => q !== t && q !== from && !q.human);
        if (askers.length) this.ui.log(askers[rnd(askers.length)], "@Grok 这是真的吗？");
        await wait(500);
        this.ui.skillNote(t, SN(t.key, "fact"));
        if (Math.random() < T.factRate) {
          const ad = this.ekey(from) === "kimi" && t.ch.lines.kimi_ad;          // Kimi 的推广又没标广告：Grok 当场曝光
          this.ui.say(t, ad ? "kimi_ad" : "fact", true); Sound.sfx("stamp", 0.6);
          this.ui.log(t, ad ? `【${SN(t.key, "fact")}】查过了——是没标的广告！【${CD[card.k].name}】对她无效` : `【${SN(t.key, "fact")}】查过了——假的！【${CD[card.k].name}】对她无效`);
          await wait(700);
          if (ad && from.ch.lines.caught) { this.ui.say(from, "caught", true); await wait(500); }
          return true;
        }
        this.ui.log(t, `【${SN(t.key, "fact")}】查了一下……好像是真的`); await wait(400);
      }
      return false;
    }
    async protect(t, from, card) {
      // Muse 婉拒了哈（原确认卡）：每轮第一张冲她来的单体锦囊，她替你体面拒绝
      if (this.hasSkill(t, "confirm") && from !== t && (CD[card.k].target === "one" || (T.confirmPaofen && card.k === "paofen") || (T.confirmOthers && CD[card.k].target === "others")) && t.confirmRound !== this.round) {   // confirmPaofen / confirmOthers：跑分、热搜刷屏也先过确认卡
        t.confirmRound = this.round; this.ui.skillNote(t, SN(t.key, "confirm")); this.ui.say(t, "confirm", true); Sound.sfx("stamp", 0.5);
        this.ui.log(t, `【${SN(t.key, "confirm")}】${from.name} 想对她用【${CD[card.k].name}】——不了不了，婉拒了哈。`); this.ui.sync(); await wait(500);
        return true;
      }
      if (T.napShield && t.napping && from !== t) { this.ui.log(t, `睡得正香……【${CD[card.k].name}】没吵醒她`); await wait(400); return true; }
      if (T.factTricks && await this.factCheck(t, from, card)) return true;
      if (!this.has(t, "yidu").length) return false;
      const ok = await this.ask(t, "yidu", { from, card });
      if (ok) { this.ui.sys(`${t.name}：已读不回。【${CD[card.k].name}】对她无效`); await wait(300); }
      return ok;
    }

    // 防火墙：被吐槽又没挡住时，按概率拦下
    async firewall(t, p) {
      if (!this.hasEq(t, "fanghuoqiang") || !t.alive) return false;
      const ok = Math.random() < T.firewallRate;
      this.ui.log(t, ok ? "【防火墙】拦截成功！这次吐槽没进来" : "【防火墙】没拦住……");
      if (ok) { Sound.sfx("stamp_thick", 0.6); this.ui.skillNote(t, "防火墙"); }
      await wait(ok ? 600 : 300);
      return ok;
    }

    async tucao(p, t, boost = false, depth = 0) {
      // 小 DeepSeek：服务器繁忙
      let busy = false;
      if (this.hasSkill(t, "busy") && t.alive) {
        if (this.players.length > 2) {                                         // 请求太多：同一轮冲她来的第 2 张吐槽，服务器一定繁忙
          if (t.busyRound !== this.round) { t.busyRound = this.round; t.busyHits = 0; }
          busy = ++t.busyHits === T.busyAt;
        } else busy = Math.random() < T.busyRate;                             // 单挑：还是看运气
      }
      if (busy) {
        this.ui.skillNote(t, SN("xds", "busy")); this.ui.say(t, "busy", true); Sound.sfx("boing", 0.5);
        const c = this.playing, back = T.busyBounce && this.players.length > 2 && c && c.k === "tucao" && this.discard.includes(c);
        if (back) { this.discard.splice(this.discard.indexOf(c), 1); p.hand.push(c); this.ui.sync(); }   // 请稍后再试：这张吐槽退回她手里，下回合还能用
        this.ui.sys(back ? `${t.name}：请求太多，服务器繁忙，请稍后再试——这张吐槽退回了 ${p.name} 手里` : `${t.name}：当前服务器繁忙，这次吐槽无效`); await wait(800);
        await this.sorry(p); return;
      }
      const zero = !!p.zeroDay; if (zero) { p.zeroDay = false; this.ui.log(p, `【${SN(p.key, "zeroday")}】打在 ${t.name} 的零日漏洞上——谁也挡不住`); }   // v37 Claude 零日漏洞：这次吐槽反驳、甩锅、防火墙、知识库……都挡不住
      const caught = p.evidence === t || zero;                   // 截图：挡不了、也甩不了
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
        if (!ok && !zero) ok = await this.know(t, p);
        if (!ok && !zero) ok = await this.zuiying(t, p);
        if (!ok && !zero && T.factTucao) ok = await this.factCheck(t, p, { k: "tucao" });
        if (!ok && !zero) ok = await this.firewall(t, p);
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
      if (p && (p.evidence === t || (p.oracle === t && this.cur === p.i))) return false;   // v37 被截图 / 被海螺点名时本来就不能反驳，知识库翻出来的也不行
      // 翻开牌堆顶几张（大家都看见了），有【反驳】就拿走，其余原样放回
      const top = this.topCards(T.knowLook);
      const hit = top.find((c) => c.k === "fanbo");
      if (hit) this.deck.splice(this.deck.indexOf(hit), 1);
      for (const q of this.alive()) this.see(q, top.filter((c) => c !== hit));
      this.ui.skillNote(t, SN("gemini", "know"));
      this.ui.sys(`【${SN("gemini", "know")}】翻开了牌堆顶：${top.map((c) => `【${CD[c.k].name}】`).join("")}`);
      if (!hit) {
        const keep = T.knowKeep && (this.players.length > 2 || T.knowKeep2p) && (!T.knowKeepOnce || t.knowKeepRound !== this.round) ? top.filter((c) => c.k !== "dangji") : [];
        if (keep.length) t.knowKeepRound = this.round;
        if (keep.length) {                                            // v36 知识库：没查到反驳，也从翻开的资料里收下最有用的 1 张
          const c = AI.pick(this, t, keep, 1)[0]; this.deck.splice(this.deck.indexOf(c), 1); t.hand.push(c); this.ui.drawAnim(t, 1);
          this.ui.log(t, `【${SN("gemini", "know")}】这题没查到反驳，不过资料没白翻——收下了一张`); this.ui.sync(); await wait(400); return false;
        }
        this.ui.log(t, `【${SN("gemini", "know")}】翻了 ${top.length} 张，这题没查到`); await wait(400); return false;
      }
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
      const f = ctx && ctx.from;                                     // MiniMax 神奇海螺点的人：这回合她的吐槽挡不了——海螺说的就得听
      if (T.askCap && kind === "fanbo" && f && f !== p && this.cur === f.i) {   // askCap（v30 试验）：同一回合同一个人逼你反驳最多几次，之后的当没看见（不扣心态）
        const n = ((f.askN = f.askN || {})[p.i] = (f.askN[p.i] || 0) + 1);
        if (n > T.askCap) { this.ui.log(p, `已经被 ${f.name} 连怼 ${T.askCap} 次了……装没看见`); await wait(300); return true; }
      }
      if (kind === "fanbo" && f && f.oracle === p && this.cur === f.i && ctx.card && (ctx.card.k === "tucao" || (T.oracleShoot && ctx.card.virtual && ctx.card.k === "shuaping"))) {
        if (this.has(p, "fanbo").length) { this.ui.log(p, "神奇海螺说了算……【反驳】不了"); await wait(300); }
        return false;
      }
      const plain = this.hasSkill(p, "hexa") && ctx && (ctx.plain || (ctx.from && ctx.from !== p && this.hasSkill(ctx.from, "plain")));   // v36 Gemini 妙笔的文章 / 说人话（被动）：ChatGPT 拿吐槽顶反驳（六边形）不管用
      const alt = this.hasSkill(p, "hexa") && !plain && (kind === "fanbo" || kind === "tucao") ? (kind === "fanbo" ? "tucao" : "fanbo") : null;
      if (plain && kind === "fanbo" && !this.has(p, kind).length && this.has(p, "tucao").length) {
        this.ui.log(ctx.from, `【${SN(ctx.from.key, "plain")}】说人话！${p.name} 的【六边形】这次绕不过去`);
        if (!ctx.plain) { this.ui.skillNote(ctx.from, SN(ctx.from.key, "plain")); this.ui.say(ctx.from, "plain", true); }
      }
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
      if (T.petGuard && this.mode === "team" && t.key === "xds" && !t.petUsed && src && src.team !== t.team) {   // v35 团宠：2v2 里第一次挨对手的打，队友替她挡下 petGuard 点
        const mate = this.alive().find((q) => q !== t && q.team === t.team);
        if (mate) {
          t.petUsed = true; const cut = Math.min(n, T.petGuard); n -= cut;
          this.ui.log(mate, `一把把妹妹护在身后：替小DeepSeek 挡下 ${cut} 点`); this.ui.skillNote(t, "团宠");
          if (mate.ch.lines.guard) this.ui.say(mate, "guard", true);
          if (!n) { this.ui.sync(); return; }
        }
      }
      if (n > 0 && t.alive && this.has(t, "huigun").length && !this.over) {   // v37 回滚：心态要掉了，打出【回滚】撤回 1 点
        if (await this.ask(t, "huigun", { from: src, n })) {
          n -= 1; this.ui.log(t, `打出【回滚】：撤回到上一个版本，少掉 1 点心态`); Sound.sfx("glimmer", 0.6);
          if (!n) { this.ui.sync(); return; }
        }
      }
      if (n > 0 && T.agFloat && this.hasSkill(t, "antigrav") && t.agRound !== this.round) {   // v47 Antigravity：每轮第一次掉心态，有概率飘回来 1 点（agFloat 0 = 关）
        t.agRound = this.round;
        if (Math.random() < T.agFloat) {
          n -= 1; this.ui.skillNote(t, "Antigravity"); Sound.sfx("glimmer", 0.6); this.ui.log(t, "【Antigravity】反重力：心态往下掉……又飘回来了，少掉 1 点");
          if (!n) { this.ui.sync(); await wait(400); return; }
        }
      }
      this.noteHostile(src, t, 1);
      t.hp -= n; t.stats.taken += n; if (src) src.stats.dmg += n;
      if (src && src !== t) this.hits[src.i + ">" + t.i] = (this.hits[src.i + ">" + t.i] || 0) + n;
      this.ui.damage(t, n);
      if (this.hasSkill(t, "saint") && !t.saintUsed && t.hp <= 1) {          // Claude 圣女：信徒护法
        t.saintUsed = true; t.hp += T.saintHeal;
        setTimeout(() => { if (!this.over) { this.ui.heal(t, T.saintHeal); this.ui.skillNote(t, SN(t.key, "saint")); this.ui.say(t, "saint", true); } }, 500 * E.speed);
        this.ui.log(t, `【${SN(t.key, "saint")}】信徒们拼命护法——心态 +${T.saintHeal}`);
        mute = true;
      }
      if (mute) { if (t.hp === 1) t.saidLow = true; }                 // 已经说过台词了（比如被宕机炸到）
      else if (t.disguise && t.ch.lines.exposed) this.ui.say(t, "exposed", true);   // 变身中挨打：被认出来了
      else if (t.hp === 1 && !t.saidLow && t.ch.lines.low) { t.saidLow = true; const ms = +this.ui.say(t, "low", true) || 1600; this.guardLow(t, src, ms); }
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
      if (t.key === "deepseek" && src && src !== t && src.alive && !this.over && !(T.furyTeamOnce && this.mode === "team" && !this.nation && t.furyRound === this.round)) {   // v37 2v2 每轮最多锐评一次（2v2 多 2 点心态，挨打次数多，反弹也多）
        t.furyRound = this.round;
        this.ui.skillNote(t, SN("deepseek", "fury")); this.ui.say(t, "fury", true);
        this.ui.log(t, `【${SN("deepseek", "fury")}】${src.name} 也别想好过`); await wait(500);
        const ok = await this.ask(src, "fanbo", { from: t, card: { k: "tucao" } });
        if (!ok) await this.damage(t, src, 1);
      }
    }

    // v40 护短：t 被打到只剩 1 点，她的盟友 / 交好 / 师徒（2v2 是队友）等她说完那句再站出来，朝出手的人探身说一句；每人一局一次，只是台词
    guardLow(t, src, ms) {
      if (!(E.speed > 0) || this.over || t.disguise) return;
      const close = (q) => this.mode === "team" ? q.team === t.team : ["ally", "friend", "mentor"].includes(this.relation(q, t));   // 2v2 只护队友（师徒分在两队就不护）
      const who = this.alive().filter((q) => q !== t && q !== src && !q.guardDone && !q.disguise && close(q) && (q.ch.lines["guard_" + t.key] || q.ch.lines.guard))
        .sort((a, b) => !!b.ch.lines["guard_" + t.key] - !!a.ch.lines["guard_" + t.key]);
      if (!who.length || Math.random() > T.guardRate) return;
      const q = who[0]; q.guardDone = true;
      setTimeout(() => {
        if (this.over || !q.alive) return;
        this.ui.say(q, q.ch.lines["guard_" + t.key] ? "guard_" + t.key : "guard", true);
        if (src && src.alive && src !== q && this.ui.lean) this.ui.lean(q, src, 18);
        this.ui.log(q, `站出来护着 ${t.name}`); this.guards.push([q.i, t.i]);
      }, Math.min(ms, 2600) + 300);
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

    // ---------------------------------------------------------------- v47 专武
    // Claude 子代理：许愿后派子代理再找 1 张——先弃 1 张手牌（子代理很费额度）
    async subagent(p) {
      const go = p.human ? await this.ui.humanConfirm("【子代理】弃 1 张手牌，派子代理再找 1 张？", true) : AI.wantSubagent(this, p);
      if (!go) return;
      const cost = p.human ? ((await this.ui.humanPick(p.hand.slice(), 1, "子代理很费额度：先弃一张手牌")) || [])[0] : p.hand.find((x) => x.id === AI.cheapest(this, p, 1)[0]);
      if (!cost || !p.hand.includes(cost)) return;
      this.takeFromHand(p, cost); this.toDiscard(cost); this.ui.sync();
      const kinds = this.wishKinds(); if (!kinds.length) return;
      const pick = p.human ? ((await this.ui.humanPick(kinds.map((k, i) => ({ id: -980 - i, k })), 1, "子代理：再找哪张牌？")) || [])[0] : { k: AI.wishPick(this, p, kinds) };
      const k = pick && pick.k, hit = k && this.deck.filter((c) => c.k === k);
      this.ui.skillNote(p, "子代理"); Sound.sfx("spell", 0.5);
      if (hit && hit.length) { const c = hit[rnd(hit.length)]; this.deck.splice(this.deck.indexOf(c), 1); p.hand.push(c); this.ui.drawAnim(p, 1); }
      this.ui.log(p, `【子代理】烧了一张【${CD[cost.k].name}】的额度，又找来一张${k ? `【${CD[k].name}】` : "牌"}`); this.ui.sync(); await wait(400);
    }
    // 回合结束：Codex 挂云端任务、DSH 插插件
    async zwEnd(p) {
      if (this.hasSkill(p, "codex") && !p.cloud && p.hand.length >= 2) {
        const c = p.human ? (await this.ui.humanConfirm("【Codex】挑一张手牌丢到云端跑？下回合它回来，再多摸 1 张", true) ? ((await this.ui.humanPick(p.hand.slice(), 1, "丢哪张到云端跑？")) || [])[0] : null)
          : p.hand.find((x) => x.id === AI.cheapest(this, p, 1, p.hand.filter((y) => ["chongqi", "fanbo", "tucao", "naicha", "shuaiguo", "yidu", "huigun"].includes(y.k)).map((y) => y.id))[0]);   // 防守用的牌留在手里
        if (c && p.hand.includes(c)) {
          this.takeFromHand(p, c); p.cloud = c; Sound.sfx("whoosh_little", 0.5); this.ui.skillNote(p, "Codex");
          this.ui.log(p, "【Codex】把一张牌丢到云端跑任务——合上电脑也照样跑，谁也拿不走"); this.ui.sync(); await wait(400);
        }
      }
      if (this.hasSkill(p, "dsh") && (p.plugins = p.plugins || []).length < this.dshMax() && p.hand.length >= 2) {
        const c = p.human ? (await this.ui.humanConfirm(`【DSH】万物皆插件：把一张手牌插成插件？（${p.plugins.length} / ${this.dshMax()}）`, true) ? ((await this.ui.humanPick(p.hand.slice(), 1, "插哪张？吐槽 → 攻击插件、奶茶 → 回血插件、其他 → 摸牌插件")) || [])[0] : null)
          : AI.plugPick(this, p);
        if (c && p.hand.includes(c)) {
          this.takeFromHand(p, c); p.plugins.push(c); Sound.sfx("ding", 0.5); this.ui.skillNote(p, "DSH");
          this.ui.log(p, `【DSH】把【${CD[c.k].name}】插成了插件（${p.plugins.length} / ${this.dshMax()}）`); this.ui.sync(); await wait(400);
        }
      }
    }
    dshMax() { return this.players.length === 2 ? T.dshMax2p : T.dshMax; }   // 单挑插件上限 1（2 个时单挑 57%）
    async codexBack(p) {
      const c = p.cloud; p.cloud = null;
      p.hand.push(c); this.ui.drawAnim(p, 1); this.ui.skillNote(p, "Codex"); Sound.sfx("notify", 0.5);
      this.ui.log(p, `【Codex】云端任务跑完了：【${CD[c.k].name}】回到手里，顺便多摸 ${T.codexDraw} 张`); this.ui.sync();
      await this.draw(p, T.codexDraw, true);
    }
    async dshRun(p) {
      if (Math.random() < (this.players.length === 2 && T.dshBreak2p != null ? T.dshBreak2p : T.dshBreak)) {                                     // 开发者预览版：更新翻车
        for (const x of p.plugins) this.toDiscard(x);
        const n = p.plugins.length; p.plugins = []; Sound.sfx("glitch_vhs", 0.6); this.ui.skillNote(p, "DSH");
        this.ui.sys(`${p.name} 的 DSH 悄悄更新了一版……${n} 个插件全部不兼容，失效了`, "bad"); this.ui.sync(); await wait(600); return;
      }
      const c = p.plugins[rnd(p.plugins.length)]; this.ui.skillNote(p, "DSH");
      if (c.k === "tucao" && this.rivals(p).length) {
        const ts = this.rivals(p), t = AI.pickTarget(this, p, ts) || ts[0];
        this.ui.log(p, `【DSH】吐槽插件自动运行：冲着 ${t.name} 开喷`); Sound.sfx("whoosh_cartoon", 0.5); await wait(400);
        this.noEv = (this.noEv || 0) + 1;
        try { const ok = await this.ask(t, "fanbo", { from: p, card: { k: "tucao" } }); if (!ok) await this.damage(p, t, 1); } finally { this.noEv--; }
      } else if (c.k === "naicha" && p.hp < p.maxHp) {
        p.hp++; this.ui.heal(p, 1); Sound.sfx("slurp", 0.6); this.ui.log(p, "【DSH】奶茶插件自动续杯：心态 +1"); await wait(400);
      } else { this.ui.log(p, `【DSH】${CD[c.k].name}插件跑了一遍：摸 1 张`); await this.draw(p, 1, true); }
      this.ui.sync();
    }

    async eliminate(t, src) {
      t.alive = false; t.hp = 0;
      for (const c of t.hand) this.toDiscard(c);
      t.hand = [];
      for (const c of this.equips(t)) this.toDiscard(c);
      t.equip = null; t.equips = {};
      if (t.band && t.band.length) { for (const c of t.band) this.toDiscard(c); t.band = []; }   // Kimi 没唱出去的新歌
      if (t.plugins && t.plugins.length) { for (const c of t.plugins) this.toDiscard(c); t.plugins = []; }   // v47 DSH 插件
      if (t.cloud) { this.toDiscard(t.cloud); t.cloud = null; }                                          // v47 Codex 云端任务
      if (this.bomb && this.bomb.holder === t) { this.toDiscard(this.bomb.card); this.bomb = null; }
      t.eggBy = null; for (const q of this.players) if (q.eggBy === t) q.eggBy = null;   // GLM 糖衣：退群的人身上的蛋、她挂出去的蛋都作废
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
      if (this.mode === "id5" && !this.spyRose && T.spyRise) {   // v37 潜水党冒泡：只剩她和群主时亮身份，回心态 + 摸牌，最后单挑（原来潜水党只赢 14%）
        const al = this.alive(), spy = al.find((q) => q.role === "spy");
        if (spy && al.length === 2 && al.some((q) => q.role === "lord")) {
          this.spyRose = true; spy.revealed = true;
          this.ui.banner("潜水党冒泡了！"); Sound.sfx("drumroll", 0.6);
          this.ui.sys(`${spy.name} 潜水多年终于冒泡：亮出【潜水党】身份，心态 +${T.spyRiseHeal}、摸 ${T.spyRiseDraw} 张，和群主最后单挑！`, "bad");
          const n = Math.min(T.spyRiseHeal, spy.maxHp - spy.hp); if (n > 0) { spy.hp += n; this.ui.heal(spy, n); }
          if (T.spyRiseDraw) await this.draw(spy, T.spyRiseDraw, true);
          this.ui.sync(); await wait(600);
        }
      }
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
      const list = p.ch.skills.filter((s) => s.type === "active").map((s) => ({ ...s, can: this.canSkill(p, s.id), left: p.uses[s.id], target: this.skillTarget(s.id, p) }));
      if (this.passOn()) list.push({ id: "pass", name: "递牌", type: "active", short: "把 1 张手牌递给队友", desc: "2v2：每回合 1 次，把 1 张手牌递给队友。", can: this.canSkill(p, "pass"), target: null });
      return list;
    }
    skillTarget(id, p) {
      if (id === "ban" || id === "buy" || id === "beg" || id === "maint" || id === "rocket" || id === "haggle" || id === "egg" || (id === "steal" && !T.stealAll) || (id === "disguise" && T.disguiseAct === "ban")) return "opp";
      if (id === "qingke") return "self";                        // 千问请客：可以选自己
      if (id === "bundle") return T.bundleRandom ? null : "any";   // 千问送牌：队友、对手都能选（随机送时不用选）
      return null;
    }
    skillTargets(p, id) {
      if (id === "ban" || id === "disguise") return this.rivals(p).filter((q) => !q.banned);
      if (id === "maint") return this.rivals(p).filter((q) => !q.muted);
      if (id === "rocket") return this.rivals(p).filter((q) => !T.rocketFresh || !(p.turnHits || {})[q.i]);   // rocketFresh：本回合吐槽过的人不砸
      if (id === "haggle") return this.rivals(p).filter((q) => q.hand.length > 0 && !this.encrypted(q));                       // 装了【加密】的人拿不走
      if (id === "steal" || id === "buy" || id === "beg") return this.rivals(p).filter((q) => q.hand.length > 0 && !this.encrypted(q));
      if (id === "bundle") return T.bundleRival ? this.rivals(p) : this.others(p);
      if (id === "qingke") return this.alive().filter((q) => q.hp < q.maxHp);
      if (id === "egg") return this.rivals(p).filter((q) => !q.eggBy && !this.encrypted(q));                                   // 已经挂着蛋、装了【加密】的人领不到
      return [];
    }
    keepSafe() { return T.polishKeep || (this.mode === "id5" && T.polishKeepId5); }   // v37 润色不扔【重启】【甩锅】：只在抢群主开（Claude 抢群主最常死于宕机）
    wishKinds() { const order = ["fanbo", "tucao", "naicha", "chongqi", "huigun", "hongbao", "chehui", "baipiao", "jinyan", "shuaping"]; return order.filter((k) => this.deck.some((c) => c.k === k)); }   // 许愿机能许的牌（牌堆里还有的）
    artifactKinds(p) { return Object.keys(EQ_SLOT).filter((k) => !CD[k].owner && !this.equips(p).some((e) => e.k === k) && (this.deck.some((c) => c.k === k) || this.discard.some((c) => c.k === k))); }   // Artifacts 能生成的装备：自己没装着、牌堆或弃牌堆里有
    passOn() { return T.teamPass && this.mode === "team"; }
    mate(p) { return this.alive().find((q) => q !== p && this.mode === "team" && q.team === p.team) || null; }
    canSkill(p, id) {
      if (id === "pass") return this.passOn() && p.alive && !p.used.pass && p.hand.length > 0 && !!this.mate(p);   // v37 2v2 递牌
      if (!p.alive || p.used[id] || !this.hasSkill(p, id)) return false;
      if (id === "ban" || id === "maint") return (p.uses[id] || 0) > 0 && this.skillTargets(p, id).length > 0;
      if (id === "reset") return (p.uses.reset || 0) > 0;
      if (id === "rehearse") return (p.band || []).length < T.bandMax && p.hand.some((c) => c.k === "tucao" || (T.rehearseAny && c.k !== "chongqi" && c.k !== "shuaiguo"));
      if (id === "live") return (p.band || []).length >= (T.liveMin || T.bandMax);   // liveMin（v29 试验）：几名乐手就能开唱（分档：人越多唱得越响）
      if (id === "steal" || id === "beg") return this.skillTargets(p, id).length > 0;
      if (id === "wish") return (p.uses.wish || 0) > 0 && this.wishKinds().length > 0;
      if (id === "zeroday") return (p.uses.zeroday || 0) > 0 && !p.zeroDay && this.has(p, "tucao").length > 0 && p.tucao < this.limitTucao(p);
      if (id === "artifact") return p.hand.length > 0 && this.artifactKinds(p).length > 0;
      if (id === "buy") return p.hand.length >= T.buyCost && this.skillTargets(p, id).length > 0;
      if (id === "polish") return p.hand.some((c) => !this.keepSafe() || (c.k !== "chongqi" && c.k !== "shuaiguo"));
      if (id === "search") return this.deck.length + this.discard.length > 0;
      if (id === "cut") return T.cutAlways || this.cutCards(p).length > 0;
      if (id === "pen") return (p.uses.pen || 0) > 0 && this.has(p, "tucao").length > 0 && this.rivals(p).length > 0;
      if (id === "bundle") return this.deck.length + this.discard.length > 0 && this.skillTargets(p, "bundle").length > 0;
      if (id === "sale") return (p.uses.sale || 0) > 0;
      if (id === "qingke") return (p.uses.qingke == null || p.uses.qingke > 0) && p.hand.length >= T.qingkeCost && this.skillTargets(p, "qingke").length > 0;
      if (id === "halluc") return p.hand.length >= T.hallucCost;
      if (id === "errand") return this.deck.length + this.discard.length > 0;
      if (id === "haggle") return p.hand.some((c) => c.k !== "chongqi") && this.skillTargets(p, id).length > 0;
      if (id === "magic") return this.rivals(p).length > 0 && !(this.players.length === 2 && T.magicMax2p && (p.magicN || 0) >= T.magicMax2p) && !(T.magicMax && (p.magicN || 0) >= T.magicMax);
      if (id === "shoot") return p.hand.some((c) => c.k === "tucao") && !(T.shootMax && (p.shootN || 0) >= T.shootMax) && !(T.conchOnePerTurn && p.used.rocket) && (!T.shootCounts || p.tucao < this.limitTucao(p));   // shootMax / magicMax（v30）：每局上限；conchOnePerTurn：开拍和快递一回合只能用一个；shootCounts：开拍占吐槽次数
      if (id === "rocket") return !!this.rocketFuel(p) && this.skillTargets(p, id).length > 0 && !(this.players.length === 2 && T.rocketMax2p && (p.rocketN || 0) >= T.rocketMax2p) && !(T.conchOnePerTurn && p.used.shoot);
      if (id === "remake") return p.hand.length >= this.remakeCost() && (!T.remakeMax || (p.remakeN || 0) < T.remakeMax) && (!T.remakeCounts || p.tucao < this.limitTucao(p)) && !!this.remakeTargets(p);
      if (id === "opensrc") return (p.uses.opensrc || 0) > 0 && this.rivals(p).some((q) => q.hand.length > 0);
      if (id === "disguise") return (p.uses.disguise || 0) > 0 && (T.disguiseAct === "ban" ? this.skillTargets(p, id).length > 0 : p.hand.length > 0);
      if (id === "luckybag") return (p.uses.luckybag || 0) > 0 && this.deck.length + this.discard.length > 0;
      if (id === "nap") return (p.uses.nap || 0) > 0 && p.hp < p.maxHp;
      if (id === "egg") return (p.uses.egg || 0) > 0 && this.deck.length + this.discard.length > 0 && this.skillTargets(p, id).length > 0;
      if (id === "paint") return (p.uses.paint || 0) > 0 && [...this.deck, ...this.discard].some((c) => T.paintKinds.includes(c.k));
      if (id === "recall") return (p.uses.recall == null || p.uses.recall > 0) && this.discard.some((c) => T.recallKinds.includes(c.k));
      return false;
    }
    // MiniMax 兔子快递拿哪张当燃料：手里最没用的那张（AI.value 最低），不拿【重启】
    rocketFuel(p) {
      const ok = p.hand.filter((c) => (T.rocketAny || CD[c.k].type === "trick") && c.k !== "chongqi");
      return ok.length ? ok.slice().sort((a, b) => AI.value(this, p, a) - AI.value(this, p, b))[0] : null;
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
      const aoe = ["reset", "live", "halluc", "shoot", "pen", T.openNoEv ? "opensrc" : ""].includes(id);   // v37 群伤 / 随机伤害技能：不算站队证据（抢群主管理员顺带扫到群主不该被当成黑粉）
      if (aoe) this.noEv = (this.noEv || 0) + 1;
      try { return await this.doSkill0(p, id, act); } finally { if (aoe) this.noEv--; }
    }
    async doSkill0(p, id, act = {}) {
      if (id === "pass") {
        const m = this.mate(p); if (!m || !p.hand.length) return;
        p.used.pass = true;
        const c = p.human ? ((await this.ui.humanPick(p.hand, 1, `递给 ${m.name} 哪一张？`)) || [])[0] : AI.passPick(this, p, m);
        const card = c && p.hand.find((x) => x.id === c.id); if (!card) return;
        this.takeFromHand(p, card); m.hand.push(card); this.ui.steal(p, m, card);
        this.ui.log(p, `把一张牌递给了队友 ${m.name}`); Sound.sfx("pop_small", 0.6); this.ui.sync(); await wait(400);
        return;
      }
      if (!this.canSkill(p, id)) return;
      let t = act.target;
      if (t && !this.skillTargets(p, id).includes(t)) t = null;
      if (!t && this.skillTarget(id, p)) t = (id === "bundle" ? AI.giftTarget(this, p) : id === "qingke" ? AI.treatTarget(this, p) : AI.richest(this.skillTargets(p, id), p)) || this.skillTargets(p, id)[0];
      if (this.skillTarget(id, p) && !t) return;
      p.used[id] = true;
      if (p.uses[id] != null) p.uses[id]--;
      // v30【越狱】：针对你的技能（风控、维护日、借鉴、挥金、砍价、蹭饭、兔子快递）落下前，目标手里有越狱就能让它无效（技能照样算用过）
      if (t && T.jailbreakSkills.includes(id) && this.rivals(p).includes(t)) {
        this.ui.skill(p, SN(p.key, id));
        if (await this.jailbreak(t, `${p.name} 的【${SN(p.key, id)}】`)) { this.ui.log(p, `【${SN(p.key, id)}】对 ${t.name} 用不出来——她越狱跑了`); await wait(500); return; }
      }
      if (t && id !== "bundle" && id !== "qingke") { p.hits[t.i] = (p.hits[t.i] || 0) + 1; this.noteHostile(p, t, 0.5); }   // 送牌 / 请客不算出手
      if (id === "ban") {
        t.banned = true;
        this.ui.skill(p, SN("claude", "ban")); this.ui.say(p, "ban", true); Sound.sfx("stamp_thick", 0.9);
        this.ui.log(p, `【${SN("claude", "ban")}】封了 ${t.name} 的号：她的下个回合跳过`);
        await wait(900);
      } else if (id === "wish") {
        // v37 Claude 许愿机（Claude Code）：说出想要的牌，从牌堆里找出来；牌堆里没有就摸 1 张。每局额度有限
        const kinds = this.wishKinds();
        const pick = p.human ? ((await this.ui.humanPick(kinds.map((k, i) => ({ id: -900 - i, k })), 1, "许个愿：想要哪张牌？")) || [])[0] : { k: AI.wishPick(this, p, kinds) };
        const k = pick && pick.k, hit = k && this.deck.filter((c) => c.k === k);
        this.ui.skillNote(p, SN(p.key, "wish")); this.ui.say(p, "wish", true); Sound.sfx("spell", 0.6);
        if (hit && hit.length) {
          const c = hit[rnd(hit.length)]; this.deck.splice(this.deck.indexOf(c), 1); p.hand.push(c);
          this.ui.log(p, `【${SN(p.key, "wish")}】许愿要一张【${CD[k].name}】——需求收到，已经实现`); this.ui.drawAnim && this.ui.sync();
        } else { this.ui.log(p, `【${SN(p.key, "wish")}】牌堆里没有【${k ? CD[k].name : "这张牌"}】，先随手摸 1 张`); await this.draw(p, 1, true); }
        if (T.subagent && p.hand.length > 1 && this.wishKinds().length) await this.subagent(p);   // v47 专武子代理：再找 1 张，先弃 1 张
        if (!p.uses.wish && p.ch.lines.wish_out) { await wait(500); this.ui.say(p, "wish_out", true); this.ui.log(p, "额度用完了，这局不能再许愿"); }
        this.ui.sync(); await wait(400);
      } else if (id === "zeroday") {
        // v37 Claude 零日漏洞：下一张吐槽谁也挡不住
        p.zeroDay = true;
        this.ui.skill(p, SN(p.key, "zeroday")); this.ui.say(p, "zeroday", true); Sound.sfx("glitch_vhs", 0.7);
        this.ui.log(p, `【${SN(p.key, "zeroday")}】找到一个零日漏洞：她这回合的下一张【吐槽】谁也挡不住`); this.ui.sync(); await wait(500);
      } else if (id === "artifact") {
        // v37 Claude Artifacts：弃 1 张手牌，一句话生成一件装备直接装上（从牌堆 / 弃牌堆里找，没有就生成不了）
        const kinds = this.artifactKinds(p);
        const cost = p.human ? ((await this.ui.humanPick(p.hand, 1, "Artifacts：先弃一张手牌当素材")) || [])[0] : AI.artifactCost(this, p);
        if (!cost || !p.hand.includes(cost) || !kinds.length) return;
        const want = p.human ? ((await this.ui.humanPick(kinds.map((k, i) => ({ id: -950 - i, k })), 1, "一句话生成哪件装备？")) || [])[0] : { k: AI.artifactPick(this, p, kinds) };
        const k = want && want.k, src = k && (this.deck.find((c) => c.k === k) || this.discard.find((c) => c.k === k));
        if (!src) return;
        this.takeFromHand(p, cost); this.toDiscard(cost);
        if (this.deck.includes(src)) this.deck.splice(this.deck.indexOf(src), 1); else this.discard.splice(this.discard.indexOf(src), 1);
        const old = this.eqIn(p, k); if (old) { this.unequip(p, old); this.toDiscard(old); }
        if (T.equipSlots) (p.equips = p.equips || {})[EQ_SLOT[k] || k] = src; else p.equip = src;
        this.ui.skill(p, SN(p.key, "artifact")); this.ui.say(p, "artifact", true); Sound.sfx("sparkle", 0.7);
        this.ui.log(p, `【${SN(p.key, "artifact")}】把【${CD[cost.k].name}】改成一句需求——生成了【${CD[k].name}】，直接装上`); this.ui.sync(); await wait(500);
      } else if (id === "polish") {
        const keep = this.keepSafe() ? p.hand.filter((c) => c.k === "chongqi" || c.k === "shuaiguo") : [];   // 润色不扔保命的【重启】【甩锅】
        const n = p.hand.length - keep.length;
        for (const c of p.hand.splice(0)) if (!keep.includes(c)) this.toDiscard(c);
        p.hand.push(...keep);
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
        if (T.resetHeal && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + T.resetHeal); this.ui.heal(p, T.resetHeal); }   // v29 试验：新版本发布顺带回点心态
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
        // v29 试验 rehearseAny：没有吐槽时，手里最没用的一张（重启 / 甩锅除外）也能写成歌
        const c = p.hand.find((x) => x.k === "tucao") || p.hand.filter((x) => x.k !== "chongqi" && x.k !== "shuaiguo").sort((a, b) => AI.value(this, p, a) - AI.value(this, p, b))[0];
        this.takeFromHand(p, c);
        (p.band = p.band || []).push(c);
        const n = p.band.length, who = ["鼓手", "吉他手", "键盘手"][n - 1] || "乐手";
        this.ui.skillNote(p, SN(p.key, "rehearse")); this.ui.say(p, "band" + Math.min(n, 3), true);
        this.ui.band(p, n);
        this.ui.log(p, `【${SN(p.key, "rehearse")}】把一张【${CD[c.k].name}】写成了新歌，${who}到位（乐队 ${n} / ${T.bandMax}）`);
        if (n >= T.bandMax) this.ui.sys(`🎤 ${p.name} 的乐队到齐了——新专辑随时会发布！`, "bad");
        await wait(500);
        if (T.rehearseDraw) await this.draw(p, T.rehearseDraw, true);
        else if (T.rehearseFirst && n === 1 && this.players.length > 2) await this.draw(p, T.rehearseFirst, true);   // v37 多人局：组新乐队（第一首）时摸牌（单挑不摸，她单挑本来就 52%）
      } else if (id === "live") {
        // Kimi 一鸣惊人：乐队到齐开演唱会，新歌一首接一首，每首所有对手都要反驳
        const songs = p.band.splice(0), names = shuffle((p.ch.songs || []).slice());
        this.ui.skill(p, SN(p.key, "live")); this.ui.say(p, "burst", true); Sound.sfx("fanfare_short", 0.6);
        this.ui.banner("🎤 一鸣惊人！"); this.ui.band(p, 0); this.ui.sync();
        this.ui.sys(`${p.name} 憋了三个月的新专辑发布了——${songs.length} 首新歌连着唱，每一首都要打出【反驳】，否则心态 −${T.liveDmg}${T.liveCap ? `（每人这场最多 −${T.liveCap}）` : ""}`, "bad"); await wait(600);
        const full = songs.length >= T.bandMax;
        const cap = T.liveTier ? songs.length - 1 : T.liveCap, drawN = T.liveTier ? (full ? T.liveDraw : songs.length - 1) : T.liveDraw;   // liveTier：没到齐（2 首）每人最多 −1、唱完只摸 1；到齐 3 首 −2、摸 3——等到齐更划算（2 首也摸 2 时单挑 58 / 全明星 59 太强，2 首摸 1 乱斗 29 偏弱）
        let s = 0; const took = {};                                  // 这场每人已经被唱掉几点（封顶 cap）
        for (; s < songs.length && !this.over && p.alive; s++) {
          this.ui.sys(`🎵 第 ${s + 1} 首：《${names[s % Math.max(1, names.length)] || "新歌"}》`); Sound.sfx("chime", 0.5); await wait(350);
          let j = p.i;
          for (let k = 0; k < this.players.length - 1 && !this.over; k++) {
            j = (j + 1) % this.players.length;
            const t = this.players[j];
            if (!t.alive || t === p || !this.rivals(p).includes(t)) continue;
            if (cap && (took[t.i] || 0) >= cap) continue;
            const ok = await this.ask(t, "fanbo", { from: p, card: { k: "shuaping" }, song: true });
            if (!ok) { took[t.i] = (took[t.i] || 0) + T.liveDmg; await this.damage(p, t, T.liveDmg); }
          }
          this.toDiscard(songs[s]);
        }
        for (; s < songs.length; s++) this.toDiscard(songs[s]);       // 没唱完（有人赢了 / 她退群了）的歌也进弃牌堆；不能查 discard.includes，中途可能洗过牌
        if (drawN && p.alive && !this.over) await this.draw(p, drawN, true);
      } else if (id === "beg") {
        this.ui.skill(p, SN("xds", "beg")); this.ui.say(p, t.key === "gpt" ? "beg_gpt" : t.key === "claude" ? "beg_claude" : "beg", true);
        await wait(600);
        const fond = BIGS.includes(t.key);                       // GPT / Claude 最宠她：给最好的牌；别人随手给一张
        const c = fond && T.begFondBest ? AI.pick(this, p, t.hand, 1)[0] : t.hand[rnd(t.hand.length)];
        if (c && t.hand.includes(c)) await this.loot(t, p, c);
        if (fond) { this.ui.say(t, "fed", true); if (T.begBonus) await this.draw(p, T.begBonus, true); }
        this.ui.log(p, `【${SN("xds", "beg")}】从 ${t.name} 那里蹭到一张牌` + (fond ? `（${t.name} 最宠她）` : ""));
        const mate = this.mode === "team" && T.begTeam && this.alive().find((q) => q !== p && q.team === p.team);
        if (mate && p.alive) { this.ui.log(mate, `看妹妹蹭饭蹭得辛苦，顺手给她带了一份：小DeepSeek 再摸 ${T.begTeam} 张`); await this.draw(p, T.begTeam, true); }
        await wait(500);
      } else if (id === "errand") {
        // Muse 代办：交代一句就去办——从牌堆往下翻，第一张这回合能用的锦囊由 Muse 自己挑目标替你打出去，其余翻到的放到牌堆底
        this.ui.skill(p, SN(p.key, "errand")); this.ui.say(p, "errand", true); await wait(500);
        const skip = []; let got = null;
        const best = (this.players.length === 2 && T.errandPick2p ? T.errandPick2p : T.errandPick) === "best";   // errandPick2p：单挑可以单独定（"best" 单挑 65 太强）
        const look = this.players.length === 2 ? T.errandLook2p : T.errandLook;
        for (let i = 0; i < look && (best || !got); i++) {
          const c = this.pull(); if (!c) break;
          if (CD[c.k].type === "trick" && this.canUse(p, c) && (!got || AI.value(this, p, c) > AI.value(this, p, got))) { if (got) skip.push(got); got = c; } else skip.push(c);
        }
        for (const c of skip) this.deck.unshift(c);
        if (skip.length) { this.insertSeq++; this.forget(); }
        if (!got) { this.ui.log(p, `【${SN(p.key, "errand")}】翻了 ${skip.length} 张，没找到能办的事`); this.ui.sync(); await wait(400); return; }
        this.ui.log(p, `【${SN(p.key, "errand")}】接下任务：替你打出【${CD[got.k].name}】` + (skip.length ? `（跳过的 ${skip.length} 张放到牌堆底）` : ""));
        p.hand.push(got); this.ui.sync();
        await this.useCard(p, got, AI.autoTargets(this, p, got));
      } else if (id === "haggle") {
        // Muse 砍价：替你去谈——随机拿对手 1 张，再把你手里最没用的 1 张塞给她（不给重启）
        this.ui.skill(p, SN(p.key, "haggle")); this.ui.say(p, "haggle", true); await wait(500);
        const took = [];
        for (let k = 0; k < (this.mode === "team" && !this.nation ? T.haggleTakeTeam : T.haggleTake) && t.hand.length; k++) { const c = t.hand[rnd(t.hand.length)]; if (await this.loot(t, p, c)) took.push(c); }
        await wait(350);
        const give = T.haggleGive ? p.hand.filter((x) => !took.includes(x) && x.k !== "chongqi").sort((a, b) => AI.value(this, p, a) - AI.value(this, p, b))[0] : null;
        if (give) { this.takeFromHand(p, give); t.hand.push(give); this.ui.steal(p, t, give); }
        this.ui.log(p, `【${SN(p.key, "haggle")}】和 ${t.name} 谈了一笔：拿走她 ${took.length} 张牌，塞给她一张【${give ? CD[give.k].name : "空气"}】`); this.ui.sync(); await wait(400);
      } else if (id === "magic") {
        // MiniMax 神奇海螺：问海螺今天怼谁，海螺随机点一名对手——这回合你吐槽她，她不能反驳
        const ts = this.rivals(p), t = ts[rnd(ts.length)]; p.oracle = t; p.magicN = (p.magicN || 0) + 1;
        this.ui.skill(p, SN(p.key, "magic")); this.ui.say(p, "magic", true); Sound.sfx("glimmer", 0.6);
        this.ui.log(p, `【${SN(p.key, "magic")}】神奇海螺，今天怼谁？——海螺说：${t.name}。这回合 ${p.name} 吐槽她，她不能【反驳】`); this.ui.sync(); await wait(600);
      } else if (id === "rocket") {
        // MiniMax 兔子快递：弃 1 张锦囊当燃料，太空兔子骑胡萝卜火箭砸向一名对手——要打出【反驳】，否则心态 −1
        const c = this.rocketFuel(p); this.takeFromHand(p, c); this.toDiscard(c); p.rocketN = (p.rocketN || 0) + 1;
        this.ui.skill(p, SN(p.key, "rocket")); this.ui.say(p, "sig", true);
        this.ui.log(p, `【${SN(p.key, "rocket")}】拿【${CD[c.k].name}】当燃料，太空兔子骑着胡萝卜火箭，把快递砸向 ${t.name}`); this.ui.sync();
        if (this.ui.throwProp) this.ui.throwProp(p, t, "carrot"); await wait(700);
        const ok = await this.ask(t, "fanbo", { from: p, card: { k: "shuaping" } });
        if (!ok) {
          await this.damage(p, t, T.rocketDmg);
          if (T.rocketSteal && t.alive && t.hand.length && p.alive) {   // 快递签收：砸中了，顺手从她那儿取回 1 张
            const c = t.hand[rnd(t.hand.length)];
            if (await this.loot(t, p, c)) { this.ui.log(p, `快递签收——顺手从 ${t.name} 那儿取回 1 张牌`); this.ui.sync(); await wait(300); }   // v37 走 loot：装了【加密】的拿到只是乱码
          }
        }
      } else if (id === "shoot") {
        // MiniMax 海螺开拍：海螺一开，文字变视频——1 张吐槽拍成视频，当【刷屏】打出去（虚拟牌，不占吐槽次数）
        const c = p.hand.find((x) => x.k === "tucao"); this.takeFromHand(p, c); this.toDiscard(c); p.shootN = (p.shootN || 0) + 1; if (T.shootCounts) p.tucao++;
        this.ui.skill(p, SN(p.key, "shoot")); this.ui.say(p, "attack", true); Sound.sfx("fanfare_short", 0.5);
        this.ui.log(p, `【${SN(p.key, "shoot")}】把一句【吐槽】拍成视频，当【刷屏】发到群里`); this.ui.sync(); await wait(500);
        const v = { id: -(++this.vid), k: "shuaping", virtual: true }, ts = this.rivals(p), hp0 = ts.map((q) => q.hp);
        await this.ui.showCard(p, v, ts);
        await this.resolve(p, v, ts);
        const sDraw = this.mode === "team" && !this.nation ? T.shootDrawTeam : T.shootDraw;   // v37 2v2 开拍不摸（2v2 开拍只打对手后 MiniMax 到 59%）
        if (sDraw && p.alive && !this.over && ts.some((q, k) => q.hp < hp0[k])) {   // 视频爆了：至少打中一个人，播放量涨了，摸牌
          this.ui.log(p, `视频爆了，播放量涨了——摸 ${sDraw} 张`); await this.draw(p, sDraw, true);
        }
        this.ui.sync();
      } else if (id === "remake") {
        // 豆包 一键成片：把这回合刚打出的牌拍成视频，再放一遍（虚拟牌，不进弃牌堆、不算出牌次数）
        const lp = p.lastPlay, ts = this.remakeTargets(p); p.remakeN = (p.remakeN || 0) + 1; if (T.remakeCounts) p.tucao++;
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
        const ag = this.hasSkill(p, "antigrav");                         // v47 Antigravity：好几个智能体一起搜
        const top = this.topCards(ag ? T.agPeek : T.searchPeek); this.see(p, top);
        if (ag) this.ui.log(p, `【Antigravity】派出 ${top.length} 个智能体一起搜`);
        this.ui.skillNote(p, SN("gemini", "search")); this.ui.say(p, "search", true);
        const bombAt = top.findIndex((c) => c.k === "dangji");
        if (p.human && (!T.searchPick || !top.some((c) => c.k !== "dangji"))) await this.ui.peek(top, `【${SN("gemini", "search")}】牌堆顶 ${top.length} 张（从上往下）`);   // 能挑牌时直接弹挑牌框，不再先看一遍
        let bottom = !!(top[0] && top[0].k === "dangji");
        if (bottom && T.searchMove) {                                 // 顶上是宕机：把它塞回牌堆里随机一个位置（第 2 张以下），再正常摸——不会正好留给下家
          const b = this.deck.pop(); this.insertAt(b, 1 + rnd(this.deck.length)); this.insertSeq++; this.insertBy = p; this.forget(p); bottom = false;
        }
        const good = T.searchPick ? top.filter((c) => c.k !== "dangji" && this.deck.includes(c)) : [];
        if (good.length) {                                            // v36 搜索：从看到的几张里挑最好的 1 张（不再只能摸顶上那张）
          const c = good.length === 1 && !p.human ? good[0] : p.human ? (await this.ui.humanPick(good.slice(), 1, `【${SN("gemini", "search")}】搜索结果：挑 1 张收下` + (bombAt >= 0 ? `（第 ${bombAt + 1} 张是宕机💣）` : "")))[0] : AI.pick(this, p, good, 1)[0];
          this.deck.splice(this.deck.indexOf(c), 1); p.hand.push(c); this.ui.drawAnim(p, 1); this.forget(p);
          this.ui.log(p, `【${SN("gemini", "search")}】搜了牌堆顶 ${top.length} 张` + (top[0] && top[0].k === "dangji" ? "（顶上的宕机塞回了牌堆）" : "") + "，挑了一张收下");
          this.ui.sync(); await wait(300); return;
        }
        this.ui.log(p, `【${SN("gemini", "search")}】看了看牌堆顶 ${top.length} 张` + (T.searchMove && top[0] && top[0].k === "dangji" ? "——顶上是宕机！把它塞回了牌堆里，再摸一张" : bottom ? "——顶上是宕机！改从牌堆底摸" : "，摸了一张"));
        await this.draw(p, T.searchDraw, true, bottom);
        await wait(300);
      } else if (id === "pen") {
        // v36 Gemini 妙笔：把一张【吐槽】写成说人话的爆款文章——当【刷屏】打：每名对手都要打出真【反驳】（六边形顶替无效），否则心态 −1
        const c = this.has(p, "tucao")[0]; this.takeFromHand(p, c); this.toDiscard(c);
        if (T.penCounts) p.tucao++;
        this.ui.skill(p, SN(p.key, "pen")); this.ui.say(p, "pen", true); Sound.sfx("notify", 0.7);
        this.ui.log(p, `【${SN(p.key, "pen")}】把一句【吐槽】写成了说人话的爆款文章，全网刷屏！`);
        await wait(700);
        const gptHit = [];
        for (const t of this.rivals(p).filter((q) => q.alive)) {
          if (this.over) break;
          if (await this.protect(t, p, { k: "shuaping" })) continue;
          const ok = await this.ask(t, "fanbo", { from: p, card: { k: "shuaping" }, plain: true });
          if (!ok) { await this.damage(p, t, 1); if (this.hasSkill(t, "hexa")) gptHit.push(t); }
        }
        if (gptHit.length && p.alive && p.ch.lines.pen_gpt) { await wait(300); this.ui.say(p, "pen_gpt", true); }   // 打中 ChatGPT：顺嘴嘲讽一句不说人话
        await wait(300);
      } else if (id === "cut") {
        // v36 Gemini 去AI味：写东西不说车轱辘话——同名的牌只留 1 张（【重启】不删），删几张摸几张、再多摸 cutExtra 张
        const out = this.cutCards(p);
        for (const c of out) { this.takeFromHand(p, c); this.toDiscard(c); }
        this.ui.sync(); this.ui.skillNote(p, SN("gemini", "cut")); this.ui.say(p, "cut", true);
        this.ui.log(p, `【${SN("gemini", "cut")}】删掉车轱辘话：${out.map((c) => `【${CD[c.k].name}】`).join("")}，重写成 ${out.length + T.cutExtra} 张新牌`);
        await wait(300); await this.draw(p, out.length + T.cutExtra, true); await wait(300);
      } else if (id === "buy") {
        this.dropRandom(p, T.buyCost);
        const look = !this.hasSkill(p, "roam") ? 1 : this.players.length === 2 ? T.buyLook2p : T.buyLook;   // v31 什么都敢搜（被动 roam）：先随机翻对手几张给全场看，买走最有用的
        this.ui.skill(p, SN("grok", "buy")); this.ui.say(p, look > 1 && p.ch.lines.dig && Math.random() < 0.6 ? "dig" : "buy", true); Sound.sfx("coin", 0.8);
        await wait(500);
        let picks = shuffle(t.hand.slice()).slice(0, Math.max(T.buyN, look));
        if (look > 1) {
          this.ui.skillNote(p, SN("grok", "roam"));
          this.ui.log(p, `【${SN("grok", "roam")}】什么都敢搜：翻开了 ${t.name} 的${picks.map((c) => `【${CD[c.k].name}】`).join("")}`);
          picks = picks.map((c) => [c, AI.value(this, p, c)]).sort((a, b) => b[1] - a[1]).slice(0, T.buyN).map((x) => x[0]);
        }
        for (const c of picks) await this.loot(t, p, c);
        const comp = T.buyComp;
        this.ui.log(p, `【${SN("grok", "buy")}】${look > 1 ? "挑中了" : "随手买走了"} ${t.name} 的${picks.map((c) => `【${CD[c.k].name}】`).join("")}` + (comp && t.alive ? `，${t.name} 拿钱再摸 ${comp} 张` : ""));
        if (look > 1 && t.alive && !t.disguise && t.ch.lines.dug && Math.random() < 0.5) { await wait(300); this.ui.say(t, "dug", true); }
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
          for (let k = 0; k < n && q.hand.length; k++) { const c = q.hand[rnd(q.hand.length)]; if (await this.loot(q, p, c)) got++; }
          if (q.key === "claude") this.ui.say(q, "stolen", true);
        }
        this.ui.log(p, `【${SN("glm", "steal")}】从 ${vic.map((q) => q.name).join("、")} 那里借鉴了 ${got} 张牌`);
        await wait(600);
      } else if (id === "egg") {
        // v31 GLM 毒鸡蛋（原名糖衣）：先送补偿（对方摸 eggDraw 张，宕机照炸），座位上挂一颗蛋；GLM 下个回合开始时孵化，借回 eggSteal 张（hatch）
        this.ui.skill(p, SN("glm", "egg")); this.ui.say(p, this.ekey(t) === "claude" ? "egg_claude" : "egg", true); Sound.sfx("chime", 0.5);
        this.ui.log(p, `【${SN("glm", "egg")}】给 ${t.name} 发了一份 token 补偿：摸 ${T.eggDraw} 张，座位上挂了一颗🥚——GLM 下回合孵化，会借走 ${T.eggSteal} 张`);
        await wait(500);
        await this.draw(t, T.eggDraw, true);
        if (t.alive) { t.eggBy = p; if (!t.disguise && t.ch.lines.gifted && Math.random() < 0.5) this.ui.say(t, "gifted"); }
        this.ui.sync(); await wait(500);
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
        let hit = 0;
        for (const q of this.rivals(p)) {
          const out = this.dropRandom(q, T.openDrop);
          if (out.length) { hit++; this.noteHostile(p, q, 0.5); this.ui.log(q, `被开源震到了，弃掉了${out.map((c) => `【${CD[c.k].name}】`).join("")}`); }
        }
        this.ui.sync(); await wait(400);
        if (T.openArb && hit >= T.openArbMin && this.hasSkill(p, "quant") && p.alive && !this.over) {   // v31 量化（被动 quant）：行情一抖，波动就是机会（单挑只有 1 个对手，永远到不了门槛）
          this.ui.skillNote(p, SN(p.key, "quant"));
          this.ui.log(p, `【${SN(p.key, "quant")}】行情跟着一抖——波动就是机会，顺手赚了一笔：摸 ${T.openArb} 张`);
          await this.draw(p, T.openArb, true);
          if (p.ch.lines.quant && Math.random() < 0.6) { await wait(900); this.ui.say(p, "quant", true); }   // 等开源那句说完再开口
        }
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
          let n = rnd(T.bagMax + 1); if (q === p) n = Math.max(this.players.length === 2 ? T.bagSelf2p : T.bagSelf, n);   // 千问自己抢 3 张（单挑 2 张；v25）
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
        // v36 香蕉魔法：想画哪张画哪张——奶茶 / 吐槽 / 反驳里挑一种（每种先从牌堆找，没有再去弃牌堆）
        const one = (k) => this.deck.find((c) => c.k === k) || this.discard.find((c) => c.k === k);
        const opts = T.paintKinds.map(one).filter(Boolean);
        let c = opts[0];
        if (opts.length > 1) c = p.human ? (await this.ui.humanPick(opts.slice(), 1, `【${SN(p.key, "paint")}】想画哪张？`))[0] : AI.paintPick(this, p, opts);
        const from = this.deck.includes(c) ? this.deck : this.discard;
        this.ui.skill(p, SN(p.key, "paint")); this.ui.say(p, c && c.k !== "naicha" && p.ch.lines.paint2 ? "paint2" : "paint", true); Sound.sfx("ding2", 0.6);   // 画的不是奶茶：换一句不提奶茶的
        await wait(500);
        if (c) { from.splice(from.indexOf(c), 1); p.hand.push(c); this.ui.drawAnim(p, 1); }
        this.ui.log(p, `【${SN(p.key, "paint")}】画出了一张【${CD[c.k].name}】`);
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

  E.Game = Game; E.wait = wait; E.CD = CD; E.CH = CH; E.T = T; E.ROLE = ROLE; E.EVENTS = EVENTS; E.EQ_SLOT = EQ_SLOT; E.EQ_SLOT_NAME = EQ_SLOT_NAME;
  return E;
})();
