const fs = require('fs');
const fetch = require('node-fetch');

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

async function snapshot() {
  const today = new Date().toISOString().split('T')[0];
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const history = fs.existsSync('odds-history.json') ? JSON.parse(fs.readFileSync('odds-history.json', 'utf8')) : {};

  for (const m of data.matches) {
    const url = `https://api.odds-api.io/v4/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h`;
    const res = await fetch(url);
    const oddsData = await res.json();
    // 解析并存储赔率快照
    if (!history[m.fixtureId]) history[m.fixtureId] = { snapshots: [] };
    history[m.fixtureId].snapshots.push({
      time: new Date().toISOString(),
      odds: oddsData
    });
  }
  fs.writeFileSync('odds-history.json', JSON.stringify(history, null, 2));
}

snapshot().catch(console.error);