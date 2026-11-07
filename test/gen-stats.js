const { generateGame } = require('../puzzle');
const t0 = Date.now(); let worst = 0;
for (let i = 0; i < 200; i++) {
  const t = Date.now(); const g = generateGame(1000 + i); worst = Math.max(worst, Date.now() - t);
  if (i < 6) console.log('seed', 1000 + i, 'ms', Date.now() - t, 'grids', g.levels.map(l => l.n).join(','), 'pars', g.levels.map(l => l.par).join(','),
    'lit', g.levels.map(l => l.start.reduce((a, b) => a + b, 0) + '/' + l.start.length).join(' '));
}
console.log('200 games generated, avg ms', ((Date.now() - t0) / 200).toFixed(1), 'worst ms', worst);
