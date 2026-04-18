const fs = require('fs');
const fetch = require('node-fetch');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const DAYS_AHEAD = 5;

const LEAGUE_IDS = [292,98,307,39,140,78,135,61,88,94,71,128,253,262,2,3,848,4,1,5,13,11];
const LEAGUE_NAMES = {
  292:'韩K联',98:'日职联',307:'中超',39:'英超',140:'西甲',78:'德甲',135:'意甲',61:'法甲',88:'荷甲',94:'葡超',
  71:'巴甲',128:'阿甲',253:'美职联',262:'墨超',2:'欧冠',3:'欧联杯',848:'亚冠',4:'欧洲杯',1:'世界杯',5:'欧国联',
  13:'解放者杯',11:'南俱杯'
};

let ELO_DB = { '蔚山现代':1860, '首尔FC':1790, '曼城':2100, '阿森纳':2060, '利物浦':2040, '皇马':2080, '巴萨':2030, '拜仁':2070 };

function factorial(n){ if(n<=1)return 1; let f=1; for(let i=2;i<=n;i++)f*=i; return f; }
function negBinomial(k,mu,r=2.5){ const p=r/(r+mu); const coef=factorial(k+r-1)/(factorial(k)*factorial(r-1)); return coef*Math.pow(p,r)*Math.pow(1-p,k); }
function computeProbs(hl,al,max=6){
  let home=0,draw=0,away=0,under=0,over=0; const scores=[];
  for(let i=0;i<=max;i++) for(let j=0;j<=max;j++){
    const p=negBinomial(i,hl)*negBinomial(j,al);
    scores.push({home:i,away:j,prob:p});
    if(i>j)home+=p; else if(i===j)draw+=p; else away+=p;
    (i+j)<=2.5?under+=p:over+=p;
  }
  const total=home+draw+away||1; scores.sort((a,b)=>b.prob-a.prob);
  return { homeWin:home/total, draw:draw/total, awayWin:away/total, over25:over/total, under25:under/total, bestScore:`${scores[0].home}-${scores[0].away} (${(scores[0].prob*100).toFixed(1)}%)` };
}

async function fetchFixtures(leagueId, season, date){
  const url=`https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&date=${date}`;
  const res=await fetch(url,{headers:{'x-rapidapi-key':FOOTBALL_API_KEY,'x-rapidapi-host':'v3.football.api-sports.io'}});
  const data=await res.json();
  return data.response||[];
}

async function main(){
  const allMatches=[];
  const today=new Date();
  const dates=[];
  for(let i=0;i<DAYS_AHEAD;i++){
    const d=new Date(today); d.setDate(today.getDate()+i);
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    dates.push(`${y}-${m}-${day}`);
  }
  console.log(`拉取未来${DAYS_AHEAD}天: ${dates.join(',')}`);

  for(const leagueId of LEAGUE_IDS){
    const currentYear=new Date().getFullYear();
    const seasonsToTry=[currentYear, currentYear-1, currentYear+1];
    let fixtures=[];
    for(const season of seasonsToTry){
      for(const date of dates){
        const res=await fetchFixtures(leagueId, season, date);
        fixtures.push(...res);
      }
      if(fixtures.length>0) break;
    }
    const upcoming=fixtures.filter(f=>!['FT','AET','PEN','CANC','ABD'].includes(f.fixture.status?.short));
    console.log(`联赛 ${leagueId} (${LEAGUE_NAMES[leagueId]||'未知'}): ${upcoming.length} 场未开始`);
    allMatches.push(...upcoming);
  }

  console.log(`总计未开始比赛: ${allMatches.length}`);

  if(allMatches.length===0){
    console.log('无真实比赛，使用示例数据');
    allMatches.push({ teams:{home:{name:'蔚山现代'},away:{name:'首尔FC'}}, fixture:{date:new Date().toISOString()}, league:{id:292,name:'韩K联'} });
  }

  const matches=[];
  for(const f of allMatches){
    const ht=f.teams.home.name, at=f.teams.away.name;
    const leagueName=LEAGUE_NAMES[f.league.id]||f.league.name;
    const homeElo=ELO_DB[ht]||1750, awayElo=ELO_DB[at]||1750;
    const eloDiff=homeElo-awayElo;
    let hl=1.50+eloDiff/400, al=1.20-eloDiff/500;
    hl=Math.min(2.5,Math.max(0.5,hl)); al=Math.min(2.5,Math.max(0.5,al));
    const probs=computeProbs(hl,al);
    const matchDate=new Date(f.fixture.date); matchDate.setHours(matchDate.getHours()+8);
    matches.push({
      homeTeam:ht, awayTeam:at, homeElo, awayElo, league:leagueName,
      date:matchDate.toLocaleString('zh-CN',{hour12:false}), homeLambda:hl, awayLambda:al,
      finalProbs:{ home:probs.homeWin, draw:probs.draw, away:probs.awayWin },
      overUnder:{ over:probs.over25, under:probs.under25 }, bestScore:probs.bestScore, isHighValue:false
    });
  }
  matches.sort((a,b)=>new Date(a.date)-new Date(b.date));
  fs.writeFileSync('data.json',JSON.stringify({date:new Date().toISOString().split('T')[0], matches},null,2));
  console.log(`生成 ${matches.length} 场预测`);
}
main().catch(console.error);
