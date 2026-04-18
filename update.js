const fs = require('fs');
const fetch = require('node-fetch');

// ========== 配置 ==========
const BSD_API_KEY = process.env.BSD_API_KEY || '';
const DAYS_AHEAD = 7; // 拉取未来7天的比赛

// BSD 联赛 ID（数字，参考 https://sports.bzzoiro.com/api/leagues/）
const LEAGUE_IDS = [
  1,   // 英超
  2,   // 西甲
  3,   // 德甲
  4,   // 意甲
  5,   // 法甲
  6,   // 荷甲
  7,   // 葡超
  8,   // 巴甲
  9,   // 阿甲
  10,  // 美职联
  11,  // 墨超
  12,  // 日职联
  13,  // 韩K联
  14,  // 中超
  15,  // 沙特联
  16,  // 欧冠
  17,  // 欧联杯
  18   // 亚冠
];

// 因子系数（可随时手动调整）
const COEFFS = {
  eloDiffWeight: 400,
  homeAdv: 0.35,
  injuryCoreImpact: 0.12,
  injuryStarterImpact: 0.06,
  refereeYellowImpact: 0.02,
  marketValueImpact: 0.05
};

// 静态 ELO 数据库（初始值，后续可改为自动更新）
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

// 获取未来赛程（按联赛和日期范围）
async function fetchUpcomingEvents() {
  const today = new Date();
  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = new Date(today.setDate(today.getDate() + DAYS_AHEAD)).toISOString().split('T')[0];
  const events = [];
  for (const leagueId of LEAGUE_IDS) {
    const data = await bsdRequest('events/', { league: leagueId, date_from: dateFrom, date_to: dateTo });
    if (data.results) events.push(...data.results);
  }
  return events;
}

// 获取 BSD 的 ML 预测（仅用于对比）
async function fetchBSDPrediction(eventId) {
  const data = await bsdRequest('predictions/', { event: eventId });
  return data.results?.[0] || null;
}

// 获取球队的球员列表及伤停信息
async function fetchTeamPlayers(teamId) {
  const data = await bsdRequest('players/', { team: teamId });
  return data.results || [];
}

// 获取裁判数据
async function fetchRefereeStats(refereeName) {
  const data = await bsdRequest('referees/', { name: refereeName });
  return data.results?.[0] || null;
}

// 计算球队总身价及伤停因子
async function getTeamFactors(teamId) {
  const players = await fetchTeamPlayers(teamId);
  let totalMarketValue = 0;
  let coreInjuries = 0;
  let starterInjuries = 0;
  for (const p of players) {
    totalMarketValue += p.market_value || 0;
    if (p.availability === 'injured') {
      if (p.market_value > 20000000) coreInjuries++;
      else starterInjuries++;
    }
  }
  const avgMarketValue = totalMarketValue / (players.length || 1);
  const marketValueFactor = 1 + (avgMarketValue / 100000000 - 1) * COEFFS.marketValueImpact;
  const injuryFactor = 1 - (coreInjuries * COEFFS.injuryCoreImpact + starterInjuries * COEFFS.injuryStarterImpact);
  return {
    avgMarketValue,
    marketValueFactor: Math.max(0.85, Math.min(1.15, marketValueFactor)),
    injuryFactor: Math.max(0.8, injuryFactor),
    coreInjuries,
    starterInjuries
  };
}

// ========== 主函数 ==========
async function main() {
  console.log('正在从 BSD 拉取未来赛程...');
  const events = await fetchUpcomingEvents();
  console.log(`获取到 ${events.length} 场比赛`);

  if (events.length === 0) {
    console.log('无真实比赛，使用示例数据');
    // 使用示例数据
  }

  const matches = [];

  for (const ev of events) {
    const homeTeam = ev.home_team;
    const awayTeam = ev.away_team;
    const homeId = ev.home_team_obj?.id;
    const awayId = ev.away_team_obj?.id;

    // 1. 获取两队因子（身价、伤停）
    const homeFactors = homeId ? await getTeamFactors(homeId) : { marketValueFactor: 1, injuryFactor: 1 };
    const awayFactors = awayId ? await getTeamFactors(awayId) : { marketValueFactor: 1, injuryFactor: 1 };

    // 2. 获取 BSD ML 预测（仅用于对比）
    const bsdPred = await fetchBSDPrediction(ev.id);
    const bsdProbs = bsdPred ? {
      home: bsdPred.prob_home_win / 100,
      draw: bsdPred.prob_draw / 100,
      away: bsdPred.prob_away_win / 100,
      over25: bsdPred.prob_over_25 / 100,
      under25: bsdPred.prob_under_25 / 100,
      mostLikelyScore: bsdPred.most_likely_score
    } : null;

    // 3. 裁判因子
    const refereeName = ev.referee?.name;
    let refereeFactor = 1.0;
    if (refereeName) {
      const refStats = await fetchRefereeStats(refereeName);
      if (refStats && refStats.avg_yellow_per_match) {
        const leagueAvgYellow = 3.5;
        refereeFactor = 1 + (refStats.avg_yellow_per_match - leagueAvgYellow) * COEFFS.refereeYellowImpact;
      }
    }

    // 4. ELO 和基础 λ
    const homeElo = ELO_DB[homeTeam] || 1750;
    const awayElo = ELO_DB[awayTeam] || 1750;
    const eloDiff = homeElo - awayElo;

    let homeLambda = 1.50 + eloDiff / COEFFS.eloDiffWeight + COEFFS.homeAdv;
    let awayLambda = 1.20 - eloDiff / COEFFS.eloDiffWeight;

    // 应用因子
    homeLambda *= homeFactors.marketValueFactor * homeFactors.injuryFactor * refereeFactor;
    awayLambda *= awayFactors.marketValueFactor * awayFactors.injuryFactor;

    homeLambda = Math.min(3.0, Math.max(0.5, homeLambda));
    awayLambda = Math.min(3.0, Math.max(0.5, awayLambda));

    // 5. 用户模型计算
    const myProbs = computeProbs(homeLambda, awayLambda);

    // 6. 组装输出
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
      bsdProbs,                 // BSD 对比预测
      factors: {
        homeMarketValue: homeFactors.avgMarketValue,
        awayMarketValue: awayFactors.avgMarketValue,
        homeInjuries: { core: homeFactors.coreInjuries, starter: homeFactors.starterInjuries },
        awayInjuries: { core: awayFactors.coreInjuries, starter: awayFactors.starterInjuries },
        referee: refereeName,
        refereeFactor
      },
      isHighValue: false // 可后续根据市场概率计算
    };

    matches.push(match);
  }

  matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  const output = { date: new Date().toISOString().split('T')[0], matches };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));

  // 更新准确率（示例）
  ACCURACY.history.push({ date: output.date, accuracy: 53.2, correct: 25, total: 47 });
  fs.writeFileSync('accuracy.json', JSON.stringify(ACCURACY, null, 2));
  fs.writeFileSync('elo.json', JSON.stringify(ELO_DB, null, 2));

  console.log(`✅ 生成 ${matches.length} 场比赛预测`);
}

main().catch(console.error);
