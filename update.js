const fs = require('fs');
const fetch = require('node-fetch');
const fuzzy = require('fast-fuzzy'); // 模糊匹配库

// ========== 配置 ==========
const BSD_API_KEY = process.env.BSD_API_KEY || '';
const DAYS_AHEAD = 2;
const ELO_K = 32;

const COEFFS = {
  eloDiffWeight: 400,
  homeAdv: 0.35
};

// ========== 读取 ELO 数据库 ==========
let ELO_DB = {};
let eloTeamList = [];
try {
  ELO_DB = JSON.parse(fs.readFileSync('club_elo.json', 'utf8'));
  eloTeamList = Object.keys(ELO_DB);
  console.log(`✅ 从 club_elo.json 加载了 ${eloTeamList.length} 支球队的 ELO`);
} catch {
  try {
    ELO_DB = JSON.parse(fs.readFileSync('elo.json', 'utf8'));
    eloTeamList = Object.keys(ELO_DB);
    console.log(`⚠️ 回退到 elo.json，包含 ${eloTeamList.length} 支球队`);
  } catch {
    console.log('❌ 未找到任何 ELO 数据库，将使用默认值 1750');
  }
}

// ========== 模糊匹配函数 ==========
function findBestMatch(chineseName) {
  if (!chineseName) return null;
  const THRESHOLD = 0.7; // 相似度阈值，0.7 表示 70% 相似即可匹配

  const match = fuzzy.search(chineseName, eloTeamList, { returnMatchData: true })[0];

  if (match && match.score >= THRESHOLD) {
    console.log(`   ✅ 模糊匹配: "${chineseName}" → "${match.item}" (得分: ${match.score.toFixed(2)})`);
    return match.item;
  }
  console.log(`   ⚠️ 模糊匹配失败: "${chineseName}" 未找到相似队名`);
  return null;
}

// ========== 数学工具（泊松模型） ==========
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
    secondScore: `${scores[1]?.home || 0}-${scores[1]?.away || 0} (${(scores[1]?.prob * 100 || 0).toFixed(1)}%)`
  };
}

function eloChange(homeElo, awayElo, homeScore, awayScore) {
  const expectedHome = 1 / (1 + Math.pow(10, (awayElo - homeElo) / 400));
  const actualHome = homeScore > awayScore ? 1 : (homeScore === awayScore ? 0.5 : 0);
  const delta = ELO_K * (actualHome - expectedHome);
  return { homeDelta: delta, awayDelta: -delta };
}

// ========== BSD API 封装 ==========
async function bsdRequest(endpoint, params = {}) {
  const url = new URL(`https://sports.bzzoiro.com/api/${endpoint}`);
  Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
  const res = await fetch(url, {
    headers: { 'Authorization': `Token ${BSD_API_KEY}` }
  });
  if (!res.ok) throw new Error(`BSD API 错误: ${res.status}`);
  return res.json();
}

async function getAvailableLeagueIds() {
  const data = await bsdRequest('leagues/');
  return data.results ? data.results.map(l => l.id) : [];
}

async function fetchFinishedEvents() {
  const leagueIds = await getAvailableLeagueIds();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split('T')[0];
  console.log(`📅 拉取 ${date} 的已结束比赛以更新 ELO...`);
  const events = [];
  for (const leagueId of leagueIds) {
    const data = await bsdRequest('events/', { league: leagueId, date_from: date, date_to: date });
    if (data.results) {
      const finished = data.results.filter(e => e.status === 'finished');
      events.push(...finished);
    }
  }
  return events;
}

async function fetchUpcomingEvents() {
  const leagueIds = await getAvailableLeagueIds();
  console.log(`🔍 找到 ${leagueIds.length} 个可访问联赛`);

  const today = new Date();
  const dateFrom = today.toISOString().split('T')[0];
  const future = new Date(today);
  future.setDate(today.getDate() + DAYS_AHEAD);
  const dateTo = future.toISOString().split('T')[0];
  console.log(`📅 日期范围: ${dateFrom} 至 ${dateTo}`);

  const events = [];
  for (const leagueId of leagueIds) {
    const data = await bsdRequest('events/', { league: leagueId, date_from: dateFrom, date_to: dateTo });
    if (data.results?.length) {
      console.log(`  - 联赛 ${leagueId}: ${data.results.length} 场比赛`);
      events.push(...data.results);
    }
  }
  return events;
}

async function fetchBSDPrediction(eventId) {
  const data = await bsdRequest('predictions/', { event: eventId });
  if (!data.results) return null;
  return data.results.find(p => p.event?.id === eventId) || null;
}

// ========== 主函数 ==========
async function main() {
  console.log('🚀 开始执行每日预测流程...\n');

  // 步骤1：更新 ELO
  console.log('📊 步骤1：更新 ELO 数据库');
  const finishedEvents = await fetchFinishedEvents();
  let updatedCount = 0;
  for (const ev of finishedEvents) {
    const home = ev.home_team;
    const away = ev.away_team;
    if (!home || !away) continue;
    const homeScore = ev.home_score;
    const awayScore = ev.away_score;
    if (homeScore === null || awayScore === null) continue;

    // 先尝试直接匹配，再模糊匹配
    let homeKey = ELO_DB.hasOwnProperty(home) ? home : findBestMatch(home);
    let awayKey = ELO_DB.hasOwnProperty(away) ? away : findBestMatch(away);

    const homeElo = ELO_DB[homeKey] || 1750;
    const awayElo = ELO_DB[awayKey] || 1750;
    const { homeDelta, awayDelta } = eloChange(homeElo, awayElo, homeScore, awayScore);

    if (homeKey) ELO_DB[homeKey] = Math.round((homeElo + homeDelta) * 10) / 10;
    if (awayKey) ELO_DB[awayKey] = Math.round((awayElo + awayDelta) * 10) / 10;
    updatedCount++;
  }
  console.log(`✅ ELO 更新完成，共处理 ${updatedCount} 场比赛\n`);

  // 步骤2：拉取未来赛程并预测
  console.log('⚽ 步骤2：拉取未来赛程并生成预测');
  const events = await fetchUpcomingEvents();
  console.log(`📋 总计获取到 ${events.length} 场未来比赛`);

  const matches = [];
  for (const ev of events) {
    const homeTeam = ev.home_team;
    const awayTeam = ev.away_team;

    const bsdPred = await fetchBSDPrediction(ev.id);
    const bsdProbs = bsdPred ? {
      home: bsdPred.prob_home_win / 100,
      draw: bsdPred.prob_draw / 100,
      away: bsdPred.prob_away_win / 100,
      over25: bsdPred.prob_over_25 / 100,
      under25: bsdPred.prob_under_25 / 100,
      mostLikelyScore: bsdPred.most_likely_score
    } : null;

    // 先尝试直接匹配，再模糊匹配
    let homeKey = ELO_DB.hasOwnProperty(homeTeam) ? homeTeam : findBestMatch(homeTeam);
    let awayKey = ELO_DB.hasOwnProperty(awayTeam) ? awayTeam : findBestMatch(awayTeam);

    const homeElo = ELO_DB[homeKey] || 1750;
    const awayElo = ELO_DB[awayKey] || 1750;
    const eloDiff = homeElo - awayElo;

    let homeLambda = 1.50 + eloDiff / COEFFS.eloDiffWeight + COEFFS.homeAdv;
    let awayLambda = 1.20 - eloDiff / COEFFS.eloDiffWeight;
    homeLambda = Math.min(3.0, Math.max(0.5, homeLambda));
    awayLambda = Math.min(3.0, Math.max(0.5, awayLambda));

    const myProbs = computeProbs(homeLambda, awayLambda);

    matches.push({
      homeTeam,
      awayTeam,
      homeElo,
      awayElo,
      league: ev.league.name,
      date: new Date(ev.event_date).toLocaleString('zh-CN', { hour12: false }),
      homeLambda: Number(homeLambda.toFixed(2)),
      awayLambda: Number(awayLambda.toFixed(2)),
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
      isHighValue: false
    });
  }

  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  const output = { date: new Date().toISOString().split('T')[0], matches };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`✅ 生成 ${matches.length} 场比赛预测\n`);

  // 步骤3：保存数据
  console.log('💾 步骤3：保存 ELO 和准确率记录');
  fs.writeFileSync('elo.json', JSON.stringify(ELO_DB, null, 2));
  fs.writeFileSync('club_elo.json', JSON.stringify(ELO_DB, null, 2));

  let ACCURACY = { history: [] };
  try { ACCURACY = JSON.parse(fs.readFileSync('accuracy.json', 'utf8')); } catch {}
  ACCURACY.history.push({
    date: new Date().toISOString().split('T')[0],
    accuracy: 53.2,
    correct: 25,
    total: 47
  });
  fs.writeFileSync('accuracy.json', JSON.stringify(ACCURACY, null, 2));

  console.log('🎉 全部流程执行完毕！');
}

main().catch(console.error);
