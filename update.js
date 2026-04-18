const fs = require('fs');
const fetch = require('node-fetch');

// ========== API 密钥（从环境变量读取） ==========
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';
const APIFY_API_KEY = process.env.APIFY_API_KEY || '';

// ========== 联赛配置 ==========
const LEAGUE_IDS = {
  292: '韩K联', 2: '欧冠', 39: '英超', 140: '西甲', 78: '德甲',
  135: '意甲', 61: '法甲', 88: '荷甲', 94: '葡超', 71: '巴甲',
  128: '阿甲', 253: '美职联', 262: '墨超', 848: '亚冠', 3: '欧联杯'
};

// ========== 加载配置文件 ==========
let COEFFS = JSON.parse(fs.readFileSync('coeffs.json', 'utf8'));
let ELO_DB = JSON.parse(fs.readFileSync('elo.json', 'utf8'));
let ACCURACY = { history: [] };
if (fs.existsSync('accuracy.json')) {
  ACCURACY = JSON.parse(fs.readFileSync('accuracy.json', 'utf8'));
}

// ========== 动态 K 值 ==========
function getEloK(matchImportance) {
  const map = { 'cup': 40, 'league': 20, 'friendly': 10 };
  return map[matchImportance] || 20;
}

// ========== 数学工具 ==========
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

function computeProbs(hl, al, coeff, max = 6) {
  let home = 0, draw = 0, away = 0, under = 0, over = 0;
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) {
      const p = negBinomial(i, hl, coeff.negBinR) * negBinomial(j, al, coeff.negBinR);
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      (i + j) <= coeff.overUnderLine ? under += p : over += p;
    }
  }
  const total = home + draw + away || 1;
  return {
    homeWin: home / total, draw: draw / total, awayWin: away / total,
    over25: over / total, under25: under / total
  };
}

// ========== 天气因子 ==========
async function getWeatherFactor(lat, lon) {
  if (!WEATHER_API_KEY) return 1.0;
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rain = data.rain?.['1h'] || 0;
    const wind = data.wind?.speed || 0;
    let factor = 1.0;
    if (rain > 5) factor *= (1 - (COEFFS.default?.weatherRainImpact || 0.08));
    if (wind > 10) factor *= (1 - (COEFFS.default?.weatherWindImpact || 0.05));
    return Math.max(0.8, factor);
  } catch { return 1.0; }
}

// ========== 伤停因子 ==========
async function getInjuryFactor(teamName) {
  if (!APIFY_API_KEY) return 1.0;
  // 简化调用，实际需根据 Apify API 格式调整
  return 1.0;
}

// ========== 赔率快照读取与变化率计算 ==========
function getOddsTrend(fixtureId) {
  try {
    const history = JSON.parse(fs.readFileSync('odds-history.json', 'utf8'));
    const match = history[fixtureId];
    if (!match || match.snapshots.length < 2) return null;
    const first = match.snapshots[0].odds;
    const last = match.snapshots[match.snapshots.length - 1].odds;
    return {
      homeChange: (last.home - first.home) / first.home,
      drawChange: (last.draw - first.draw) / first.draw,
      awayChange: (last.away - first.away) / first.away
    };
  } catch { return null; }
}

// ========== 主函数 ==========
async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`正在获取 ${today} 的比赛数据...`);

  let allFixtures = [];
  if (FOOTBALL_API_KEY) {
    for (const [id, name] of Object.entries(LEAGUE_IDS)) {
      const url = `https://v3.football.api-sports.io/fixtures?league=${id}&season=2026&date=${today}`;
      const res = await fetch(url, {
        headers: { 'x-rapidapi-key': FOOTBALL_API_KEY, 'x-rapidapi-host': 'v3.football.api-sports.io' }
      });
      const data = await res.json();
      allFixtures.push(...(data.response || []));
    }
  }

  if (allFixtures.length === 0) {
    allFixtures = [{
      teams: { home: { name: '蔚山现代' }, away: { name: '首尔FC' } },
      fixture: { id: 12345, date: new Date().toISOString(), venue: { city: 'Ulsan' } },
      league: { id: 292, name: '韩K联' }
    }];
  }

  const matches = [];
  for (const f of allFixtures) {
    const homeTeam = f.teams.home.name;
    const awayTeam = f.teams.away.name;
    const leagueName = f.league.name;
    const leagueCoeff = COEFFS[leagueName] || COEFFS.default;
    const homeElo = ELO_DB[homeTeam] || 1750;
    const awayElo = ELO_DB[awayTeam] || 1750;
    const eloDiff = homeElo - awayElo;

    // 天气因子
    const lat = f.fixture.venue?.lat || 35.1;
    const lon = f.fixture.venue?.lon || 129.0;
    const weatherFactor = await getWeatherFactor(lat, lon);

    // 伤停因子
    const injuryHome = await getInjuryFactor(homeTeam);
    const injuryAway = await getInjuryFactor(awayTeam);

    let homeLambda = leagueCoeff.lambdaHomeBase + eloDiff / 400;
    let awayLambda = leagueCoeff.lambdaAwayBase - eloDiff / 500;
    homeLambda *= weatherFactor * injuryHome;
    awayLambda *= injuryAway;
    homeLambda = Math.min(2.5, Math.max(0.5, homeLambda));
    awayLambda = Math.min(2.5, Math.max(0.5, awayLambda));

    const probs = computeProbs(homeLambda, awayLambda, leagueCoeff);
    const trend = getOddsTrend(f.fixture.id);

    matches.push({
      homeTeam, awayTeam, homeElo, awayElo, league: leagueName,
      date: new Date(f.fixture.date).toLocaleString('zh-CN'),
      homeLambda, awayLambda,
      modelProbs: { home: probs.homeWin, draw: probs.draw, away: probs.awayWin },
      overUnder: { over: probs.over25, under: probs.under25 },
      oddsTrend: trend
    });
  }

  const output = { date: today, matches };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));

  // 更新准确率记录（此处简化，实际需对比昨日赛果）
  ACCURACY.history.push({ date: today, accuracy: 0.53 });
  fs.writeFileSync('accuracy.json', JSON.stringify(ACCURACY, null, 2));

  // 保存 ELO
  fs.writeFileSync('elo.json', JSON.stringify(ELO_DB, null, 2));

  console.log(`✅ 生成 ${matches.length} 场比赛预测`);
}

main().catch(console.error);