const fs = require('fs');

async function backtest() {
  // 读取历史数据，搜索最优系数（此处为示例）
  const bestCoeffs = { lambdaHomeBase: 1.55, lambdaAwayBase: 1.18 };

  let coeffs = JSON.parse(fs.readFileSync('coeffs.json', 'utf8'));
  coeffs.default = { ...coeffs.default, ...bestCoeffs };
  fs.writeFileSync('coeffs.json', JSON.stringify(coeffs, null, 2));

  const history = JSON.parse(fs.readFileSync('backtest-history.json', 'utf8') || '[]');
  history.push({ date: new Date().toISOString(), coeffs: bestCoeffs });
  fs.writeFileSync('backtest-history.json', JSON.stringify(history, null, 2));
  console.log('回测完成，系数已更新');
}

backtest().catch(console.error);
