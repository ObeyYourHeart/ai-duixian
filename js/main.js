// 页面流程：标题 → 选人 → 对局 → 结算
window.Main = (function () {
  const D = window.GAME_DATA, CH = D.chars, CD = D.cards;
  const $ = (s) => document.querySelector(s);
  const keys = Object.keys(CH);
  let pickKey = "claude", players = 3, lastOpp = null, game = null, applySpeed = () => {};
  let teamMates = [], teamFoes = [];                    // 全明星组队页挑好的队友 / 对手

  // 舞台跟着屏幕比例走，不留空条：
  // 横屏 16:9 正好 1600x900；16:10、4:3 加高（最多 1200），超宽屏加宽（最多 2133）。
  // 竖屏（高比宽长）换竖排布局：宽 760、高按比例（至少 1300，最多 2000；偏方的屏幕改成加宽）。
  function fit() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    if (!w || !h) return;                       // 窗口还没显示出来（后台标签页、隐藏的框）：等 resize 再算
    const portrait = a < 1;
    let W, H;
    if (portrait) {
      W = 760; H = Math.round(760 / a);
      if (H < 1300) { H = 1300; W = Math.round(1300 * a); }
      H = Math.min(H, 2000);
    } else {
      W = 1600; H = 900;
      if (a < 16 / 9) H = Math.min(1200, Math.round(1600 / a)); else W = Math.min(2133, Math.round(900 * a));
    }
    const st = $("#stage");
    st.classList.toggle("portrait", portrait);
    st.style.width = W + "px"; st.style.height = H + "px";
    st.style.setProperty("--w", W + "px");
    st.style.setProperty("--dx", portrait ? "0px" : (W - 1600) / 2 + "px");
    st.style.setProperty("--dy", (portrait ? H - 1300 : H - 900) + "px");
    st.style.transform = `scale(${Math.min(w / W, h / H)})`;
    st.classList.toggle("tiny", !portrait && Math.min(w / W, h / H) < 0.62);   // 手机横屏：画面缩得很小，弹窗字号放大
    UI.layout(W, H, portrait);
  }
  function show(id) { document.querySelectorAll(".screen").forEach((e) => e.classList.toggle("active", e.id === id)); }

  function title() {
    const par = $("#title-parade"); par.innerHTML = "";
    const order = ["qwen", "kimi", "gemini", "gpt", "claude", "xds", "deepseek", "doubao", "grok", "glm"];
    order.forEach((k, i) => {
      const img = document.createElement("img"); img.src = UI.portrait(k, "base"); img.style.animationDelay = (i * 0.25) + "s";
      img.style.zIndex = Math.round(10 - Math.abs(i - 4.5) * 2); par.appendChild(img);
    });
    show("scr-title");
    Sound.track("menu");
  }

  function select() {
    const grid = $("#sel-grid"); grid.innerHTML = "";
    for (const k of keys) {
      const c = CH[k];
      const d = document.createElement("div"); d.className = "pick" + (k === pickKey ? " on" : "");
      d.style.setProperty("--c", c.color); d.style.setProperty("--l", c.light);
      d.innerHTML = `<img src="${UI.portrait(k, "base")}" alt=""><div class="pbadge"><span>❤${c.hp}</span><span>技能 ${c.skills.length}</span></div><div class="pn${c.name.length > 7 ? " long" : ""}">${c.name}</div>${c.nation ? `<div class="pnat ${c.nation}">${(D.nations || {})[c.nation].name}</div>` : ""}`;
      d.onclick = () => { pickKey = k; Sound.sfx("click", 0.5); select(); Sound.voice(k, "greet", 0); };
      grid.appendChild(d);
    }
    const c = CH[pickKey];
    const det = $("#sel-detail"); det.style.setProperty("--c", c.color); det.style.setProperty("--l", c.light);
    $("#sd-img").src = UI.portrait(pickKey, "smug");
    // 小DeepSeek：点“变身”轮流看伪装造型，最后变回来
    const alt = $("#sd-alt"), FORMS = ["smug", "tea", "cheer", "change", "exposed"];
    let form = -1;
    alt.classList.toggle("hidden", pickKey !== "xds"); alt.textContent = "🎭 变身";
    alt.onclick = (ev) => {
      ev.stopPropagation(); Sound.sfx("click", 0.4);
      form = form + 1 < FORMS.length ? form + 1 : -1;
      $("#sd-img").src = form < 0 ? UI.portrait("xds", "smug") : UI.portrait("xds_cl", FORMS[form]);
      alt.textContent = form < 0 ? "🎭 变身" : form === FORMS.length - 1 ? "🎭 变回来" : `🎭 换一张 ${form + 1}/${FORMS.length}`;
    };
    $("#sd-name").textContent = c.name; $("#sd-name").style.whiteSpace = "nowrap"; $("#sd-name").style.fontSize = c.name.length > 7 ? "36px" : ""; $("#sd-title").textContent = c.title;
    $("#sd-bio").textContent = c.bio || "";
    $("#sd-hp").innerHTML = `心态 <span>${"❤".repeat(c.hp)}</span>`;
    // 人物关系：盟友 / 交好 / 宿敌各是谁（悬停看那句设定）
    const REL = { ally: "盟友", friend: "交好", rival: "宿敌", mentor: "师徒" };
    const rels = (window.GAME_DATA.relations || []).filter(([a, b]) => a === pickKey || b === pickKey)
      .sort((x, y) => ["ally", "mentor", "friend", "rival"].indexOf(x[2]) - ["ally", "mentor", "friend", "rival"].indexOf(y[2]));
    $("#sd-rels").innerHTML = rels.map(([a, b, t, note]) => `<span class="${t}" title="${note}"><b>${REL[t]}</b>${CH[a === pickKey ? b : a].name}</span>`).join("");
    $("#sd-skills").innerHTML = c.skills.map((s) => `<div class="sd-skill"><div class="sd-row"><b>${s.name}</b><em class="${s.type}">${s.type === "active" ? "主动" : "被动"}</em><span class="sd-short">${s.short || ""}</span><i>▾</i></div><p>${s.desc}</p></div>`).join("");
    $("#sd-skills").querySelectorAll(".sd-skill").forEach((e) => { e.onclick = () => { e.classList.toggle("open"); Sound.sfx("click", 0.4); }; });
    $("#sd-bio").classList.remove("open"); $("#sd-bio").onclick = () => $("#sd-bio").classList.toggle("open");
    modeDesc();
    show("scr-select");
  }
  // 模式下面一句话说清楚玩法
  const MODE_DESC = { 2: "单挑：一对一，把她踢出群就赢。", 3: "三人乱斗：你和两个电脑，最后留在群里的人当群主。",
    4: "2v2：座位是 你—对手—对手—队友，把对面两人都踢出群就赢。", 5: "抢群主：5 人随机身份（群主 / 管理员 / 黑粉 / 潜水党），各有各的胜利条件。",
    6: "全明星赛：中国队对阵美国队，3v3。选好你的角色，下一页自己挑队友和对手。" };
  function modeDesc() { const e = $("#mode-desc"); if (e) e.textContent = MODE_DESC[players] || ""; $("#scr-select").classList.toggle("nation-on", players === 6); }   // 全明星赛：角色格上标国家队

  function start(sameOpp) {
    let opp, teams;
    const NAT = (k) => CH[k].nation, shuf = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    if (players === 6) {
      // 全明星赛：你进自己的国家队，队友和对手各从本国随机挑；座位 你—敌—友—敌—敌—友（交替坐先手队赢六成，这样坐五五开）
      // 组队页挑的阵容（不齐就随机补满）
      const mates = teamMates.filter((k) => k !== pickKey && NAT(k) === NAT(pickKey)), foes = teamFoes.filter((k) => NAT(k) && NAT(k) !== NAT(pickKey));
      mates.push(...shuf(keys.filter((k) => k !== pickKey && NAT(k) === NAT(pickKey) && !mates.includes(k))).slice(0, 2 - mates.length));
      foes.push(...shuf(keys.filter((k) => NAT(k) && NAT(k) !== NAT(pickKey) && !foes.includes(k))).slice(0, 3 - foes.length));
      opp = [foes[0], mates[0], foes[1], foes[2], mates[1]];
      teams = [0, 1, 0, 1, 1, 0];
    } else if (sameOpp && lastOpp && lastOpp.length === players - 1 && !lastOpp.includes(pickKey)) opp = lastOpp;
    else {
      const pool = keys.filter((k) => k !== pickKey);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      opp = pool.slice(0, players - 1);
    }
    lastOpp = opp;
    show("scr-game");
    Sound.track("battle");
    UI.detach();
    applySpeed();                                       // 上一局观战加速过，这里恢复
    const mode = { 2: "duel", 3: "ffa", 4: "team", 5: "id5", 6: "team" }[players];
    game = window.__game = new Engine.Game([pickKey, ...opp], UI, { mode, teams, nation: players === 6 });
    UI.attach(game);
    game.run().catch((e) => console.error(e));
  }

  // ---------------------------------------------------------------- 全明星组队：左边你的国家队，右边对手队；点人加入 / 移出，人齐了开赛
  const REL_T = { ally: "盟友", friend: "交好", rival: "宿敌同队", mentor: "师徒" };
  function team() {
    const NA = D.nations || {}, me = CH[pickKey].nation, foeN = me === "cn" ? "us" : "cn";
    if (teamMates.some((k) => CH[k].nation !== me || k === pickKey) || teamFoes.some((k) => CH[k].nation !== foeN)) { teamMates = []; teamFoes = []; }   // 换了国家：阵容作废
    teamMates = teamMates.filter((k) => k !== pickKey);
    const side = (el, nat, list, max, mine) => {
      const roster = keys.filter((k) => CH[k].nation === nat);
      const members = mine ? [pickKey, ...list] : list.slice();
      const slots = [];
      for (let i = 0; i < 3; i++) {
        const k = members[i];
        if (!k) { slots.push(`<div class="tm-slot empty"><span>＋</span><small>点下面的人加入</small></div>`); continue; }
        const c = CH[k], you = mine && i === 0;
        slots.push(`<div class="tm-slot" data-k="${k}" style="--c:${c.color};--l:${c.light}"><img src="${UI.portrait(k, k === "xds" ? "base" : "smug")}" alt="">
          <div class="tm-nm"><b>${c.name}</b><small>${c.title}</small></div>${you ? '<i class="tm-you">你</i>' : '<i class="tm-x" title="移出">✕</i>'}</div>`);
      }
      const rels = (D.relations || []).filter(([a, b]) => members.includes(a) && members.includes(b))
        .map(([a, b, t, note]) => `<span class="${t}" title="${note}"><b>${REL_T[t]}</b>${CH[a].name} × ${CH[b].name}</span>`).join("");
      const tiles = roster.map((k) => {
        const c = CH[k], on = members.includes(k), you = mine && k === pickKey;
        return `<button class="tm-pick${on ? " on" : ""}${you ? " you" : ""}" data-k="${k}" style="--c:${c.color};--l:${c.light}" title="${c.name} · ${c.title}\n${c.skills.map((s) => `【${s.name}】${s.short || ""}`).join("\n")}">
          <img src="${UI.portrait(k, "avatar")}" alt=""><span>${c.name}</span>${you ? "<i>你</i>" : on ? "<i>✓</i>" : ""}</button>`;
      }).join("");
      el.className = "tm-side nat-" + nat;
      el.innerHTML = `<div class="tm-name"><b>${(NA[nat] || {}).name}</b><small>${mine ? "你的队伍" : "对手"} · ${members.length} / 3${nat === "cn" ? " · 阵容大：第一回合每人多摸 1 张" : ""}</small></div>
        <div class="tm-slots">${slots.join("")}</div>
        <div class="tm-rels">${rels || '<span class="none">队里没有特别的关系</span>'}</div>
        <div class="tm-roster">${tiles}</div>`;
      const toggle = (k) => {
        if (mine && k === pickKey) { UI.toast("这是你自己：想换人点「换角色」"); return; }
        const i = list.indexOf(k);
        if (i >= 0) list.splice(i, 1);
        else if (list.length >= max) { UI.toast("队伍满了：先点掉一个"); return; }
        else { list.push(k); Sound.voice(k, "allstar", 0); }
        Sound.sfx("click", 0.45); team();
      };
      el.querySelectorAll(".tm-pick").forEach((b) => { b.onclick = () => toggle(b.dataset.k); });
      el.querySelectorAll(".tm-slot .tm-x").forEach((x) => { x.onclick = (ev) => { ev.stopPropagation(); toggle(x.closest(".tm-slot").dataset.k); }; });
    };
    side($("#tm-mine"), me, teamMates, 2, true);
    side($("#tm-foe"), foeN, teamFoes, 3, false);
    const full = teamMates.length === 2 && teamFoes.length === 3;
    $("#tm-go").disabled = !full;
    $("#tm-go").textContent = full ? "开始比赛" : `还差 ${2 - teamMates.length + 3 - teamFoes.length} 人`;
    show("scr-team");
  }
  function teamRandom() {
    const me = CH[pickKey].nation, shuf = (a) => a.sort(() => Math.random() - 0.5);
    teamMates.push(...shuf(keys.filter((k) => CH[k].nation === me && k !== pickKey && !teamMates.includes(k))).slice(0, 2 - teamMates.length));
    teamFoes.push(...shuf(keys.filter((k) => CH[k].nation && CH[k].nation !== me && !teamFoes.includes(k))).slice(0, 3 - teamFoes.length));
    Sound.sfx("shuffle", 0.5); team();
  }

  // ---------------------------------------------------------------- 玩法说明（整页：左边栏目，右边内容）
  const IMG = (p) => (window.ASSET && window.ASSET[p]) || p;
  const TYPE = { basic: "基本牌", trick: "锦囊牌", equip: "装备牌", bomb: "炸弹" };
  const cardTile = (k) => { const d = CD[k]; return `<div class="ru-card ${d.type}"><img src="${IMG(`assets/img/card_${k}.webp`)}" alt=""><div class="ru-cn">${d.name}</div>
    <div class="ru-cd"><b>${d.short}</b><span>${d.desc}</span><small>${TYPE[d.type]} · ${d.type === "bomb" ? "按人数埋进牌堆" : "×" + d.n}</small></div></div>`; };
  const RULE_TABS = [
    ["quick", "快速上手", () => `<h2>快速上手</h2><p class="ru-lead">${D.world || ""}</p>
      <div class="ru-steps">
        <div><i>1</i><b>选一位 AI娘</b><span>每个人的技能不一样，选人界面点技能能看完整说明。</span></div>
        <div><i>2</i><b>轮流出牌</b><span>回合开始摸 2 张，想出几张出几张；【吐槽】每回合限 1 次（第 3 轮起 2 次）。</span></div>
        <div><i>3</i><b>吐槽 · 反驳 · 奶茶</b><span>吐槽让对手心态 −1；被吐槽时打【反驳】挡掉；【奶茶】回 1 点心态。</span></div>
        <div><i>4</i><b>破防退群</b><span>心态（❤）掉光就退群，最后留在群里的人当群主。</span></div>
        <div><i>5</i><b>小心宕机 💣</b><span>牌堆里埋着【宕机】，摸到心态 −2；有【重启】就拆掉，再偷偷塞回去坑别人。</span></div>
      </div>
      <div class="ru-tip">👆 看不懂技能？对局里<b>点任何一张角色卡</b>（包括你自己），都会弹出她的技能说明、还剩几次和当前状态。</div>
      <h3>最常用的三张牌</h3><div class="ru-cards">${["tucao", "fanbo", "naicha"].map(cardTile).join("")}</div>`],
    ["turn", "回合与胜负", () => `<h2>回合与胜负</h2>
      <div class="ru-flow"><div><b>① 摸牌</b><span>摸 2 张（有的角色多摸）</span></div><div><b>② 出牌</b><span>随便出，吐槽限次数</span></div><div><b>③ 弃牌</b><span>手牌不能超过心态（有的角色上限更高）</span></div></div>
      <ul class="ru-list">
        <li><b>心态（❤）</b>每人 4 点（Kimi 5 点）。被吐槽又没挡住就 −1，掉光就<b>破防退群</b>。</li>
        <li><b>吵上头</b>：第 3 轮起每回合可以吐槽两次，配乐也会变激烈。</li>
        <li><b>奶茶自救</b>：心态掉到 0 时，手里有【奶茶】会自动喝掉。</li>
        <li><b>击退奖励</b>：把别人怼到退群，你摸 2 张。</li>
        <li><b>装备</b>（绿色牌名）用了就放进装备栏一直生效；装备栏只有一格，换新的旧的就弃掉。【白嫖】【撤回】也能拿走或弃掉对方的装备。</li>
        <li><b>胜利</b>：三人乱斗、单挑是最后留在群里的人；2v2、抢群主看阵营（见「游戏模式」）。</li>
      </ul>`],
    ["bomb", "💣 宕机玩法", () => `<h2>💣 宕机玩法</h2>
      <ul class="ru-list">
        <li>开局牌堆里随机埋着【宕机】：单挑 1 张、三人 2 张、2v2 3 张、抢群主 2 张。每人先发 1 张【重启】。</li>
        <li><b>谁摸到谁炸</b>：心态 −2，宕机再被随机塞回牌堆。</li>
        <li>手里有【重启】就自动拆掉，然后<b>你来决定</b>把它偷偷塞回牌堆的哪里——塞最上面，下家一摸就炸。有【甩锅】也能把宕机甩给别人。</li>
        <li>顶栏的 💣 是牌堆里还剩几张宕机，后面是<b>下一张摸到宕机的概率</b>。牌越摸越少，概率越高。</li>
        <li>你看过的牌堆顶会一直显示在牌桌提示条上，直到有人动了牌堆。</li>
      </ul>
      <h3>相关的牌</h3><div class="ru-cards">${["dangji", "chongqi", "jutou", "chadui", "chongsheng", "moyu", "shuaiguo"].filter((k) => CD[k]).map(cardTile).join("")}</div>`],
    ["cards", "卡牌图鉴", () => {
      const total = Object.values(CD).reduce((s, d) => s + d.n, 0);
      const grp = (t) => Object.keys(CD).filter((k) => CD[k].type === t);
      return `<h2>卡牌图鉴 <small>共 ${total} 张，外加按人数埋进去的【宕机】</small></h2>` +
        ["basic", "trick", "equip", "bomb"].map((t) => grp(t).length ? `<h3>${TYPE[t]}</h3><div class="ru-cards">${grp(t).map(cardTile).join("")}</div>` : "").join("");
    }],
    ["chars", "角色与技能", () => `<h2>角色与技能 <small>每人三到五个技能，看设定多少</small></h2>
      <div class="ru-chars">${keys.map((k) => { const c = CH[k]; return `<div class="ru-ch" style="--c:${c.color};--l:${c.light}">
        <div class="ru-ch1"><img src="${UI.portrait(k, "avatar")}" alt=""><div><b>${c.name}</b><small>${c.title}</small><span>${"❤".repeat(c.hp)}</span></div></div>
        <div class="ru-sks">${c.skills.map((s) => `<div class="ru-sk" title="${s.desc}"><b>${s.name}</b><em class="${s.type}">${s.type === "active" ? "主动" : "被动"}</em><span>${s.short || s.desc}</span></div>`).join("")}</div></div>`; }).join("")}</div>
      <h3>人物关系</h3><ul class="ru-list">${(D.relations || []).map(([a, b, t, note]) => `<li><b class="rel ${t}">${{ ally: "盟友", friend: "交好", rival: "宿敌" }[t]}</b>${CH[a].name} × ${CH[b].name}——${note}</li>`).join("")}</ul>
      <p class="ru-note">三人乱斗和单挑里：盟友在场上还有别人时互不吐槽，只剩她俩时「协议到期」；宿敌会优先针对对方；交好的下手轻一点。</p>`],
    ["modes", "游戏模式", () => `<h2>游戏模式</h2><div class="ru-modes">
      <div><b>三人乱斗</b><span>你和两个电脑，最后留在群里的人当群主。</span></div>
      <div><b>单挑</b><span>一对一，把她踢出群就赢。</span></div>
      <div><b>2v2</b><span>座位是 你—对手—对手—队友，把对面两人都踢出群就赢。单体牌和点名技能不能对队友用；先手第一回合多摸 1 张。</span></div>
      <div><b>抢群主（5 人）</b><span>随机身份：<b>群主</b>公开、多 2 点心态、先手，要和暗中的<b>管理员</b>一起踢掉<b>黑粉</b>和<b>潜水党</b>；两个<b>黑粉</b>要把群主踢出群；<b>潜水党</b>先帮群主清掉黑粉，最后单挑踢掉群主自己当群主。除了群主，身份退群后才翻开。踢掉黑粉奖励摸 3 张；群主踢了自己的管理员要弃光手牌。</span></div>
      <div><b>全明星赛（6 人）</b><span><b>中国队</b>（DeepSeek、小DeepSeek、GLM、豆包、Kimi、千问）对阵<b>美国队</b>（Claude、ChatGPT、Gemini、Grok），3v3。你选谁就进她的国家队，再到组队页自己挑两个队友、三个对手（也可以随机补满）；座位 你—敌—友—敌—敌—友，把对面三人都踢出群就赢。中国队阵容大，第一回合每人多摸 1 张。宿敌分到一队也得先一致对外。</span></div></div>`],
    ["props", "👍 互动与暗号", () => {
      const P = window.Props, icon = (k) => `<img src="${UI.asset(`assets/img/prop_${k}.webp`)}" alt="">`;
      return `<h2>👍 互动与暗号</h2>
      <p class="ru-lead">对局里<b>点任何一位角色</b>，详情卡最上面有一排道具：4 个人人都有的，加上<b>你自己的专属道具</b>。随时都能扔，不花牌、不占回合；被扔的人会有反应，电脑之间也会互相扔。</p>
      <div class="ru-props">${P.COMMON.map((k) => `<span>${icon(k)}${P.KINDS[k].name}<small>${P.KINDS[k].bad ? "敌意" : "好意"}</small></span>`).join("")}</div>
      <h3>每个人的专属道具</h3>
      <div class="ru-props sig">${Object.keys(CH).filter((k) => P.SIG[k]).map((k) => { const K = P.KINDS[P.SIG[k]]; return `<span>${icon(P.SIG[k])}<b>${K.name}</b><small>${CH[k].name} · ${K.bad ? "敌意" : "好意"}</small></span>`; }).join("")}</div>
      <h3>它也是暗号</h3><div class="ru-modes">
        <div><b>2v2</b><span>朝对手扔<b>敌意</b>道具（点踩、报错……）= 叫电脑队友<b>集火她</b>（接下来两轮优先打她）；给队友<b>送算力</b> = 叫她<b>掩护你</b>，先打最后伤你的人。电脑也会先砸一下这回合要打的人——看到队友砸谁，就知道她要打谁；对面砸谁，就是盯上谁了。</span></div>
        <div><b>抢群主</b><span>大家会从你扔的东西猜你的身份：朝群主扔敌意的像黑粉，给群主送好意的像管理员。电脑扔的也是线索——当然，你也可以拿来骗人。</span></div>
        <div><b>三人乱斗 · 单挑</b><span>送好意的（送算力、点赞……），她会对你手下留情一点；扔敌意的会惹她记仇，更爱找你吵。（有上限，刷不爆。）</span></div>
      </div>
      <div class="ru-tip">嫌热闹？设置里把「电脑扔道具」关掉，电脑就不主动扔了，你自己照样能扔。</div>`;
    }],
    ["ops", "操作与设置", () => `<h2>操作与设置</h2>
      <h3>出牌</h3><ul class="ru-list"><li>点一张牌看效果，再点一次出牌；也可以直接把牌往上拖出去。要选目标的牌，点对手或把牌拖到她身上。</li>
        <li>主动技能在右下角技能栏（按钮）：现在能用的会发金光、闪星星，提示条也会写“能用技能：【…】”；灰色的就是这回合用不了。被动技能是虚线标签，自动生效，点了能看说明。</li>
        <li>被吐槽时会弹出提示，倒计时结束按默认处理。</li></ul>
      <h3>键盘</h3><div class="ru-keys"><span><kbd>1</kbd>–<kbd>9</kbd> 选牌 / 选目标</span><span><kbd>Enter</kbd> 确认出牌</span><span><kbd>空格</kbd> 结束回合</span>
        <span><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd> 技能</span><span><kbd>Y</kbd> / <kbd>N</kbd> 回答提示</span><span><kbd>Esc</kbd> 取消 / 关掉任何窗口</span></div>
      <h3>设置（右上角 ⚙，首页也有）</h3><ul class="ru-list"><li>音乐 / 音效 / 配音音量；速度四档（工具栏上的速度按钮也能直接换档）；思考时间；点一下就出；被吐槽时问我或自动应对；没牌可出时自动结束回合；键盘快捷键开关。</li></ul>
      <h3>手机</h3><ul class="ru-list"><li>竖着、横着都能玩，画面自动铺满。首页和对局工具栏有【全屏】按钮。</li>
        <li>iPhone 不支持网页全屏：在 Safari 点「分享 → 添加到主屏幕」，从桌面图标打开就是全屏。</li></ul>`],
  ];
  let ruleTab = "quick";
  function rules(tab) {
    ruleTab = tab || ruleTab;
    const nav = $("#ru-nav");
    nav.innerHTML = RULE_TABS.map(([k, n]) => `<button data-tab="${k}" class="${k === ruleTab ? "on" : ""}">${n}</button>`).join("");
    nav.querySelectorAll("button").forEach((b) => { b.onclick = () => { Sound.sfx("click", 0.4); rules(b.dataset.tab); }; });
    $("#ru-main").innerHTML = RULE_TABS.find(([k]) => k === ruleTab)[2]();
    $("#ru-main").scrollTop = 0;
    $("#rules").classList.remove("hidden");
  }
  function closeRules() { $("#rules").classList.add("hidden"); }
  function credits() {
    const sfx = (window.CREDITS || []).map((c) => `<li>“${c.title}” by ${c.creator} — ${c.license.toUpperCase()}</li>`).join("");
    modal(`<h2>素材署名</h2>
      <h3>配乐</h3><ul><li>“Idempotence” by Social Bot 73XT — CC BY 3.0</li><li>其余配乐为免版税音乐</li></ul>
      <h3>音效（CC BY）</h3><ul>${sfx}</ul><p>其余音效为 CC0 公共领域素材。</p>
      <h3>美术与配音</h3><p>角色立绘、插画与配音均为 AI 生成。字体：阿里妈妈方圆体、阿里巴巴普惠体 2.0。</p>`);
  }
  function modal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }

  function boot() {
    fit(); window.addEventListener("resize", fit);
    UI.bindButtons();
    $("#btn-start").onclick = () => { Sound.track("menu"); Sound.music(Sound.S.music); Sound.sfx("click"); select(); };
    $("#btn-rules").onclick = () => { Sound.sfx("click"); rules("quick"); };
    $("#ru-close").onclick = () => { Sound.sfx("click", 0.4); closeRules(); };
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const done = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (!$("#rules").classList.contains("hidden")) { closeRules(); done(); return; }
      const md = $("#modal");
      if (!md.classList.contains("hidden")) {
        if ($("#modal-close").style.display !== "none") md.classList.add("hidden");
        else { const b = $("#modal-body .pkgo .btn.primary"); if (b) b.click(); }   // 剧透 = 知道了；插队 = 按原样放回；必须挑的窗口不处理
        done(); return;
      }
      if ($("#scr-select").classList.contains("active")) { $("#btn-back").click(); done(); return; }
      if ($("#scr-team").classList.contains("active")) { $("#tm-back").click(); done(); return; }
    }, true);
    $("#btn-credits").onclick = () => { Sound.sfx("click"); credits(); };
    $("#btn-go").onclick = () => { Sound.sfx("click"); if (players === 6) team(); else start(false); };   // 全明星赛先去组队页
    $("#tm-back").onclick = () => { Sound.sfx("click"); select(); };
    $("#tm-rand").onclick = teamRandom;
    $("#tm-clear").onclick = () => { teamMates = []; teamFoes = []; Sound.sfx("click", 0.5); team(); };
    $("#tm-go").onclick = () => { if (teamMates.length === 2 && teamFoes.length === 3) { Sound.sfx("click"); start(false); } };
    $("#btn-back").onclick = () => { Sound.sfx("click"); title(); };
    $("#modal-close").onclick = () => $("#modal").classList.add("hidden");
    document.querySelectorAll(".mode").forEach((b) => b.onclick = () => {
      players = +b.dataset.mode; document.querySelectorAll(".mode").forEach((x) => x.classList.toggle("on", x === b)); Sound.sfx("click", 0.5); modeDesc();
    });
    // 速度四档：工具栏点一下换档，设置面板里也能选
    const sp = $("#tb-speed");
    const paintSpeed = () => { Engine.speed = Settings.speed(); sp.textContent = Settings.SPEEDS[Settings.S.speed].name; };
    paintSpeed();
    applySpeed = paintSpeed;
    Settings.on((k) => { if (!k || k === "speed") paintSpeed(); if (game && !game.over) UI.sync(); });
    sp.onclick = () => { Settings.set("speed", (Settings.S.speed + 1) % Settings.SPEEDS.length); Sound.sfx("click", 0.5); UI.toast(`速度：${Settings.SPEEDS[Settings.S.speed].name}`); };
    $("#tb-set").onclick = () => { Sound.sfx("click", 0.5); Settings.open(); };
    // 全屏：首页右上角和对局工具栏都有；iPhone 不支持网页全屏，就教她“添加到主屏幕”
    const paintFull = () => {
      const on = Settings.fsOn();
      $("#btn-full").querySelector("span").textContent = on ? "退出全屏" : "全屏";
      $("#tb-full").classList.toggle("on", on); $("#tb-full").title = on ? "退出全屏" : "全屏";
      const hide = Settings.standalone();          // 已经从主屏幕图标打开（本来就是全屏）
      $("#btn-full").classList.toggle("hidden", hide); $("#tb-full").classList.toggle("hidden", hide);
    };
    $("#btn-full").onclick = () => { Sound.sfx("click", 0.5); Settings.toggleFull(); };
    $("#tb-full").onclick = () => { Sound.sfx("click", 0.5); Settings.toggleFull(); };
    document.addEventListener("fullscreenchange", paintFull); document.addEventListener("webkitfullscreenchange", paintFull);
    paintFull();
    $("#btn-settings").onclick = () => { Sound.sfx("click"); Settings.open(); };
    const mu = $("#tb-music"); mu.classList.toggle("off", !Sound.S.music);
    mu.onclick = () => { const on = Sound.music(!Sound.S.music); mu.classList.toggle("off", !on); };
    const sf = $("#tb-sfx"); sf.classList.toggle("off", !Sound.S.sfx);
    sf.onclick = () => { const on = Sound.toggleSfx(); sf.classList.toggle("off", !on); };
    $("#tb-rules").onclick = rules;
    let quitT = 0;
    $("#tb-quit").onclick = () => {
      if (performance.now() - quitT > 2000) { quitT = performance.now(); UI.toast("再点一次退出这一局"); return; }
      if (game) { game.over = true; game.ui = new Proxy({}, { get: () => () => new Promise(() => {}) }); }
      UI.detach(); title();
    };
    title();
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { again: () => start(true), toSelect: () => select() };
})();
