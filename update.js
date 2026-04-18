const fs = require('fs');
const fetch = require('node-fetch');

// ========== API 密钥 ==========
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';

// ========== 配置 ==========
const DAYS_AHEAD = 3;                    // 拉取未来几天的比赛
const LEAGUE_IDS = [
  // 亚洲
  292,  // 韩K联
  98,   // 日职联
  89,   // J2联赛
  307,  // 中超
  308,  // 沙特联
  // 欧洲五大
  39,   // 英超
  140,  // 西甲
  78,   // 德甲
  135,  // 意甲
  61,   // 法甲
  // 欧洲其他
  88,   // 荷甲
  94,   // 葡超
  144,  // 比甲
  203,  // 土超
  179,  // 苏超
  106,  // 俄超
  // 美洲
  71,   // 巴甲
  128,  // 阿甲
  262,  // 墨超
  253,  // 美职联
  // 杯赛
  2,    // 欧冠
  3,    // 欧联杯
  848,  // 亚冠
  531,  // 欧超杯
  4,    // 欧洲杯
  1,    // 世界杯
  5,    // 欧国联
  13,   // 解放者杯
  11,   // 南俱杯
  6,    // 非洲杯
  10,   // 亚洲杯
  9,    // 美洲杯
  15    // 世俱杯
];

// 联赛名称映射（用于展示）
const LEAGUE_NAMES = {
  292:'韩K联', 98:'日职联', 89:'J2联赛', 307:'中超', 308:'沙特联',
  39:'英超', 140:'西甲', 78:'德甲', 135:'意甲', 61:'法甲',
  88:'荷甲', 94:'葡超', 144:'比甲', 203:'土超', 179:'苏超', 106:'俄超',
  71:'巴甲', 128:'阿甲', 262:'墨超', 253:'美职联',
  2:'欧冠', 3:'欧联杯', 848:'亚冠', 531:'欧超杯', 4:'欧洲杯',
  1:'世界杯', 5:'欧国联', 13:'解放者杯', 11:'南俱杯', 6:'非洲杯',
  10:'亚洲杯', 9:'美洲杯', 15:'世俱杯'
};

// 静态 ELO 数据库
let ELO_DB = {
  '蔚山现代': 1860, '首尔FC': 1790, '曼城': 2100, '阿森纳': 2060,
  '利物浦': 2040, '皇马': 2080, '巴萨': 2030, '拜仁': 2070
};

// ========== 工具函数 ==========
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

function computeProbs(hl, al, max = 6) {
  let home = 0, draw = 0, away = 0, under = 0, over = 0;
  const scores = [];
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) {
      const p = negBinomial(i, hl) * negBinomial(j, al);
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
    bestScore: `${scores[0].home}-${scores[0].away} (${(scores[0].prob * 100).toFixed(1)}%)`
  };
}

// ========== API 调用 ==========
async function fetchFixtures(leagueId, date) {
  const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2025&date=${date}`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key': FOOTBALL_API_KEY,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      }
    });
    const data = await res.json();
    return data.response || [];
  } catch {
    return [];
  }
}

// ========== 主函数 ==========
async function main() {
  const allMatches = [];
  const today = new Date();

  // 生成未来几天的日期列表（YYYY-MM-DD 格式，基于北京时间）
  const dates = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }

  console.log(`正在拉取未来 ${DAYS_AHEAD} 天的比赛：${dates.join(', ')}`);

  for (const date of dates) {
    for (const leagueId of LEAGUE_IDS) {
      const fixtures = await fetchFixtures(leagueId, date);
      // 过滤：只保留未开始的比赛（状态不是 FT, AET, PEN）
      const upcoming = fixtures.filter(f => {
        const status = f.fixture.status?.short;
        return !['FT', 'AET', 'PEN', 'CANC', 'ABD'].includes(status);
      });
      allMatches.push(...upcoming);
    }
  }

  console.log(`共拉取到 ${allMatches.length} 场未开始的比赛`);

  // 如果没有任何比赛，使用示例数据
  if (allMatches.length === 0) {
    console.log('未找到即将开始的比赛，使用示例数据');
    allMatches.push({
      teams: { home: { name: '蔚山现代' }, away: { name: '首尔FC' } },
      fixture: { id: 12345, date: new Date().toISOString() },
      league: { id: 292, name: '韩K联' }
    });
  }

  const matches = [];
  for (const f of allMatches) {
    const ht = f.teams.home.name;
    const at = f.teams.away.name;
    const leagueName = LEAGUE_NAMES[f.league.id] || f.league.name;
    const homeElo = ELO_DB[ht] || 1750;
    const awayElo = ELO_DB[at] || 1750;
    const eloDiff = homeElo - awayElo;

    let hl = 1.50 + eloDiff / 400;
    let al = 1.20 - eloDiff / 500;
    hl = Math.min(2.5, Math.max(0.5, hl));
    al = Math.min(2.5, Math.max(0.5, al));

    const probs = computeProbs(hl, al);

    // 转换为北京时间显示
    const matchDate = new Date(f.fixture.date);
    const beijingTime = new Date(matchDate.getTime() + 8 * 60 * 60 * 1000);

    matches.push({
      homeTeam: ht,
      awayTeam: at,
      homeElo: homeElo,
      awayElo: awayElo,
      league: leagueName,
      date: beijingTime.toLocaleString('zh-CN', { hour12: false }),
      homeLambda: hl,
      awayLambda: al,
      finalProbs: {
        home: probs.homeWin,
        draw: probs.draw,
        away: probs.awayWin
      },
      overUnder: {
        over: probs.over25,
        under: probs.under25
      },
      bestScore: probs.bestScore,
      isHighValue: false
    });
  }

  // 按开赛时间排序
  matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  const output = {
    date: new Date().toISOString().split('T')[0],
    matches
  };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`✅ 生成 ${matches.length} 场比赛预测`);
}

main().catch(console.error);
