const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'eco-web', timestamp: new Date().toISOString() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>ECO</h1><p>Social Listening Platform — Gobierno de Puerto Rico</p><p>App coming soon.</p>');
});

server.listen(3000, '0.0.0.0', () => {
  console.log('ECO web server listening on port 3000');
});
