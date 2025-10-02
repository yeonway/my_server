const fs = require('fs');
const path = require('path');

function sanitize(name='unknown') {
  return name.replace(/[^a-zA-Z0-9_\-가-힣]/g,'_');
}

function userLog(username, level='info', message='') {
  const u = sanitize(username);
  const baseDir = path.join(__dirname, '..', 'logs', 'users', u);
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  const date = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const file = path.join(baseDir, `app-${date}.log`);
  const line = `${new Date().toISOString()} ${level}: ${message}\n`;
  fs.appendFile(file, line, ()=>{});
}

module.exports = { userLog };