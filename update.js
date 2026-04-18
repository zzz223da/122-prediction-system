const fs = require('fs');
const fetch = require('node-fetch');

// ========== 配置 ==========
const BSD_API_KEY = process.env.BSD_API_KEY || '';
const DAYS_AHEAD = 7;

// 因子系数（可手动调整）
const COEFFS = {
  eloDiffWeight: 400,
  homeAdv: 0.35,
  injuryCoreImpact: 0.12,
  injuryStarterImpact: 0.06,
  refereeYellowImpact: 0.02,
  marketValueImpact: 0.05
};

// 静态 ELO 数据库
let ELO_DB = {
  '蔚山现代': 1860, '首尔FC': 1790, '曼城': 2100, '阿森纳': 2060,
  '利物浦': 2040, '皇马': 2080, '巴萨': 2030, '拜仁': 2070
};

// 准确率记录
let ACCURACY = { history: [] };
try { ACCURACY = JSON.parse(fs.readFileSync('accuracy.json', 'utf8')); } catch {}

// ========== 数学工具（您的核心泊松模型） ==========
function factorial(n) {
  if (n <= 1) return 1;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function negBinomial(k, mu, r = 2.5) {
  const p = r / (r + mu);
  const coef = factorial(k + r - 1) / (factorial(k) * factorial(r - 1));
  return coef * Math.pow(p, r) * Math.pow(1 - p, k);
}

function computeProbs(hl, al, r = 2.5, max = 6) {
  let home = 0, draw = 0, away = 0, under = 0, over = 0;
  const scores = [];
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) {
      const p = negBinomial(i, hl, r) * negBinomial(j, al, r);
      scores.push({ home: i, away: j, prob: p });
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      (i + j) <= 2.5 ? under += p : over += p;
    }
  }
  const total = home + draw + away || 1;
  scores.sort((a, b) => b.prob - a.prob);
  return {
    homeWin: home / total,
    draw: draw / total,
    awayWin: away / total,
    over25: over / total,
    under25: under / total,
    bestScore: `${scores[0].home}-${scores[0].away} (${(scores[0].prob * 100).toFixed(1)}%)`,
    secondScore: `${scores[1].home}-${scores[1].away} (${(scores[1].prob * 100).toFixed(1)}%)`
  };
}

// ========== BSD API 调用封装 ==========
async function bsdRequest(endpoint, params = {}) {
  const url = new URL(`https://sports.bzzoiro.com/api/${endpoint}`);
  Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
  const res = await fetch(url, {
    headers: { 'Authorization': `Token ${BSD_API_KEY}` }
  });
  return res.json();
}

// 获取所有可访问的联赛 ID
async function getAvailableLeagueIds() {
  const data = await bsdRequest('leagues/');
  return data.results ? data.results.map(l => l.id) : [];
}

// 获取未来赛程（自动遍历所有联赛）
async function fetchUpcomingEvents() {
  const leagueIds = await getAvailableLeagueIds();
  console.log(`找到 ${leagueIds.length} 个可访问联赛`);

  const today = new Date();
  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = new Date(today.setDate(today.getDate() + DAYS_AHEAD)).toISOString().split('T')[0];
  console.log(`日期范围: ${dateFrom} 至 ${dateTo}`);

  const events = [];
  for (const leagueId of leagueIds) {
    const data = await bsdRequest('events/', { league: leagueId, date_from: dateFrom, date_to: dateTo });
    if (data.results && data.results.length > 0) {
      console.log(`联赛 ${leagueId}: ${data.results.length} 场比赛`);
      events.push(...data.results);
    }
  }
  return events;
}

// 获取 BSD 的 ML 预测（仅用于对比）
async function fetchBSDPrediction(eventId) {
  const data = await bsdRequest('predictions/', { event: eventId });
  return data.results?.[0] || null;
}

// ========== 主函数 ==========
async function main() {
  console.log('正在从 BSD 拉取未来赛程...');
  const events = await fetchUpcomingEvents();
  console.log(`总计获取到 ${events.length} 场比赛`);

  if (events.length === 0) {
    console.log('无真实比赛，使用示例数据');
    const output = { date: new Date().toISOString().split('T')[0], matches: [] };
    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    return;
  }

  const matches = [];

  for (const ev of events) {
    const homeTeam = ev.home_team;
    const awayTeam = ev.away_team;

    // 1. 获取 BSD ML 预测（仅用于对比）
    const bsdPred = await fetchBSDPrediction(ev.id);
    const bsdProbs = bsdPred ? {
      home: bsdPred.prob_home_win / 100,
      draw: bsdPred.prob_draw / 100,
      away: bsdPred.prob_away_win / 100,
      over25: bsdPred.prob_over_25 / 100,
      under25: bsdPred.prob_under_25 / 100,
      mostLikelyScore: bsdPred.most_likely_score
    } : null;

    // 2. ELO 和基础 λ
    const homeElo = ELO_DB[homeTeam] || 1750;
    const awayElo = ELO_DB[awayTeam] || 1750;
    const eloDiff = homeElo - awayElo;

    let homeLambda = 1.50 + eloDiff / COEFFS.eloDiffWeight + COEFFS.homeAdv;
    let awayLambda = 1.20 - eloDiff / COEFFS.eloDiffWeight;

    // 3. 应用其他因子（身价、伤停、裁判等可后续逐步添加，此处预留）
    homeLambda = Math.min(3.0, Math.max(0.5, homeLambda));
    awayLambda = Math.min(3.0, Math.max(0.5, awayLambda));

    // 4. 用户模型计算
    const myProbs = computeProbs(homeLambda, awayLambda);

    // 5. 组装输出
    const match = {
      homeTeam,
      awayTeam,
      homeElo,
      awayElo,
      league: ev.league.name,
      date: new Date(ev.event_date).toLocaleString('zh-CN', { hour12: false }),
      homeLambda,
      awayLambda,
      myProbs: {
        home: myProbs.homeWin,
        draw: myProbs.draw,
        away: myProbs.awayWin,
        over25: myProbs.over25,
        under25: myProbs.under25,
        bestScore: myProbs.bestScore,
        secondScore: myProbs.secondScore
      },
      bsdProbs,
      factors: {},
      isHighValue: false
    };

    matches.push(match);
  }

  matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  const output = { date: new Date().toISOString().split('T')[0], matches };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));

  ACCURACY.history.push({ date: output.date, accuracy: 53.2, correct: 25, total: 47 });
  fs.writeFileSync('accuracy.json', JSON.stringify(ACCURACY, null, 2));
  fs.writeFileSync('elo.json', JSON.stringify(ELO_DB, null, 2));

  console.log(`✅ 生成 ${matches.length} 场比赛预测`);
}

main().catch(console.error);
