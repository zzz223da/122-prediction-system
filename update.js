const fs = require('fs');
const fetch = require('node-fetch');

const BSD_API_KEY = process.env.BSD_API_KEY || '';

async function bsdRequest(endpoint, params = {}) {
  const url = new URL(`https://sports.bzzoiro.com/api/${endpoint}`);
  Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
  const res = await fetch(url, { headers: { 'Authorization': `Token ${BSD_API_KEY}` } });
  return res.json();
}

async function main() {
  console.log('=== 步骤1: 获取可访问的联赛列表 ===');
  const leaguesData = await bsdRequest('leagues/');
  if (leaguesData.results) {
    console.log(`找到 ${leaguesData.results.length} 个联赛：`);
    leaguesData.results.slice(0, 10).forEach(l => {
      console.log(`  ID: ${l.id}, 名称: ${l.name}, 国家: ${l.country}`);
    });
  } else {
    console.log('无法获取联赛列表，请检查 API 密钥');
    return;
  }

  console.log('\n=== 步骤2: 尝试拉取未来14天的比赛 ===');
  const today = new Date();
  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = new Date(today.setDate(today.getDate() + 14)).toISOString().split('T')[0];
  console.log(`日期范围: ${dateFrom} 至 ${dateTo}`);

  // 使用第一个联赛 ID 测试
  const testLeagueId = leaguesData.results[0]?.id;
  if (!testLeagueId) {
    console.log('没有可用的联赛 ID');
    return;
  }

  const eventsData = await bsdRequest('events/', {
    league: testLeagueId,
    date_from: dateFrom,
    date_to: dateTo
  });

  if (eventsData.results) {
    console.log(`联赛 ${testLeagueId} 未来14天有 ${eventsData.results.length} 场比赛`);
  } else {
    console.log('未返回比赛数据，响应：', JSON.stringify(eventsData).substring(0, 200));
  }

  // 生成一个空的 data.json 避免网站空白
  const output = { date: dateFrom, matches: [] };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
}

main().catch(console.error);
