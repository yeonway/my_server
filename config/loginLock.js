// config/loginLock.js
const MAX_FAIL = 5;
const LOCK_MINUTES = 10;

const store = new Map(); 
// 구조: username -> { fails:number, lockedUntil:timestamp }

function isLocked(username) {
  const rec = store.get(username);
  if (!rec) return false;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true;
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) {
    store.delete(username);
    return false;
  }
  return false;
}

function registerFail(username) {
  const now = Date.now();
  let rec = store.get(username) || { fails:0, lockedUntil:0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAIL) {
    rec.lockedUntil = now + LOCK_MINUTES * 60 * 1000;
  }
  store.set(username, rec);
  return rec;
}

function clearRecord(username) {
  store.delete(username);
}

function getStatus(username) {
  const rec = store.get(username);
  if (!rec) return { fails:0, locked:false, remainMs:0 };
  const locked = isLocked(username);
  return {
    fails: rec.fails,
    locked,
    remainMs: locked ? (rec.lockedUntil - Date.now()) : 0
  };
}

module.exports = { isLocked, registerFail, clearRecord, getStatus, MAX_FAIL, LOCK_MINUTES };