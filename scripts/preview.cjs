const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = { '/assets/icon/bgm-on.svg': 'assets/icon/bgm-on.svg', '/assets/icon/bgm-off.svg': 'assets/icon/bgm-off.svg', '/': 'index.html', '/index.html': 'index.html', '/styles/style.css': 'styles/style.css', '/src/game/rules.js': 'src/game/rules.js', '/src/game/replay.js': 'src/game/replay.js', '/src/ui/game.js': 'src/ui/game.js', '/assets/icon/time-inversion-forward.svg': 'assets/icon/time-inversion-forward.svg', '/assets/icon/time-inversion-reverse.svg': 'assets/icon/time-inversion-reverse.svg', '/assets/icon/pocket-watch-frame.svg': 'assets/icon/pocket-watch-frame.svg', '/assets/icon/pocket-watch-hand.svg': 'assets/icon/pocket-watch-hand.svg', '/assets/icon/replay.svg': 'assets/icon/replay.svg', '/assets/icon/pause.svg': 'assets/icon/pause.svg', '/assets/icon/reset.svg': 'assets/icon/reset.svg', '/assets/icon/undo.svg': 'assets/icon/undo.svg' };
for (const file of ['src/ai/client.js', 'src/ai/worker.js', 'src/ai/network.js', 'src/ai/search.js', 'assets/ai/model.js', 'assets/ai/pro-model.js']) files['/' + file] = file;
for (const file of ['assets/sounds/put.mp3', 'assets/sounds/switch.mp3', 'assets/sounds/pass.mp3', 'assets/sounds/put-reverse.wav', 'assets/sounds/time-reversal.wav']) files['/' + file] = file;
for (const name of ['komorebi_orgel', 'tsukikage_orgel']) {
  for (const suffix of ['', '_150x_reverse', '_150x', '_200x_reverse', '_200x'])
    files[`/assets/sounds/${name}${suffix}.mp3`] = `assets/sounds/${name}${suffix}.mp3`;
}
files['/hosting-check.html'] = 'tests/hosting.html';
http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname.replace(/^\/time-inversi(?=\/)/, '');
  const file = files[route];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' })[path.extname(file)]);
  res.end(fs.readFileSync(path.join(root, file)));
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
