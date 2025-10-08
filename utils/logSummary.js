const fs = require('fs/promises');
const path = require('path');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB per file

async function readTail(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (stats.size === 0) return '';
    const start = Math.max(0, stats.size - maxBytes);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf-8');
  } finally {
    await handle.close();
  }
}

function parseLogLine(line) {
  if (!line) return null;
  const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\w+):\s*(.*)$/);
  if (!match) return null;
  const [, timestampStr, levelRaw, messageRaw] = match;
  const timestamp = new Date(timestampStr);
  if (Number.isNaN(timestamp.getTime())) return null;
  const level = levelRaw.toLowerCase();
  return { timestamp, level, message: messageRaw };
}

async function analyzeLogs({ logDir, hours = 24, maxBytesPerFile = DEFAULT_MAX_BYTES } = {}) {
  const summary = { total: 0, info: 0, warn: 0, error: 0, latestError: null };
  const result = {
    hours,
    summary,
    files: [],
    totalBytes: 0,
    largestFile: null
  };

  if (!logDir) return result;

  let entries;
  try {
    entries = await fs.readdir(logDir, { withFileTypes: true });
  } catch (err) {
    return result;
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .reverse(); // recent files first assuming rotate naming

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  let latestErrorTs = 0;

  for (const fileName of files) {
    const filePath = path.join(logDir, fileName);
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      continue;
    }

    const fileInfo = { name: fileName, bytes: stats.size, scanned: false };
    result.files.push(fileInfo);
    result.totalBytes += stats.size;
    if (!result.largestFile || stats.size > result.largestFile.bytes) {
      result.largestFile = { name: fileName, bytes: stats.size };
    }

    if (!fileName.endsWith('.log')) continue;

    let content = '';
    try {
      content = await readTail(filePath, maxBytesPerFile);
    } catch (err) {
      continue;
    }

    fileInfo.scanned = true;
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;
      const parsed = parseLogLine(line.trim());
      if (!parsed) continue;
      const tsMs = parsed.timestamp.getTime();
      if (Number.isNaN(tsMs) || tsMs < cutoff) continue;
      summary.total += 1;
      if (parsed.level === 'info') summary.info += 1;
      else if (parsed.level === 'warn' || parsed.level === 'warning') summary.warn += 1;
      else if (parsed.level === 'error') summary.error += 1;
      if (parsed.level === 'error' && tsMs >= latestErrorTs) {
        let message = parsed.message || '';
        const metaIdx = message.indexOf(' {');
        if (metaIdx !== -1) message = message.slice(0, metaIdx).trim();
        summary.latestError = {
          timestamp: new Date(tsMs).toISOString(),
          message,
          file: fileName
        };
        latestErrorTs = tsMs;
      }
    }
  }

  return result;
}

module.exports = {
  analyzeLogs,
};
