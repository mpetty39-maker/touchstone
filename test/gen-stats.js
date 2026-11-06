const { generateGame } = require('../puzzle');
const t0 = Date.now();
for (let i = 0; i < 10; i++) {
  const t = Date.now();
  const g = generateGame(1000 + i);
  console.log('seed', 1000 + i, 'ms', Date.now() - t, 'pars', g.levels.map(l => l.par).join(','),
    'lit', g.levels.map(l => l.start.reduce((a, b) => a + b, 0) + '/' + l.start.length).join(' '));
}
console.log('total ms', Date.now() - t0);
