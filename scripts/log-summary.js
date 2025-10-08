#!/usr/bin/env node
const path = require('path');
const os = require('os');
const { analyzeLogs } = require('../utils/logSummary');

const MB = 1024 * 1024;

(async () => {
  try {
    const hoursArg = parseInt(process.argv[2], 10);
    const hours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 24;
    const logDir = path.join(__dirname, '..', 'logs');

    const analysis = await analyzeLogs({ logDir, hours });
    const summary = analysis.summary;
    const scannedCount = analysis.files.filter((file) => file.scanned).length;
    const totalMB = analysis.totalBytes / MB;
    const largest = analysis.largestFile
      ? analysis.largestFile.name + ' (' + (analysis.largestFile.bytes / MB).toFixed(2) + ' MB)'
      : 'N/A';

    console.log('Log directory : ' + logDir);
    console.log('Time window   : last ' + analysis.hours + ' hour(s)');
    console.log('Files scanned : ' + scannedCount + '/' + analysis.files.length);
    console.log('Entries       : total=' + summary.total + ' info=' + summary.info + ' warn=' + summary.warn + ' error=' + summary.error);
    if (summary.latestError) {
      const errorTime = new Date(summary.latestError.timestamp).toLocaleString();
      console.log('Latest error  : ' + errorTime + ' [' + summary.latestError.file + '] ' + summary.latestError.message);
    } else {
      console.log('Latest error  : none within the selected window');
    }
    console.log('Log size      : ' + totalMB.toFixed(2) + ' MB (largest ' + largest + ')');
    const loadAvg = os.loadavg().map((value) => value.toFixed(2)).join(', ');
    console.log('Load average  : ' + loadAvg);
    console.log(
      'Memory usage  : total ' + (os.totalmem() / MB).toFixed(2) + ' MB, free ' + (os.freemem() / MB).toFixed(2) + ' MB'
    );
  } catch (error) {
    console.error('Failed to analyze logs:', error.message || error);
    process.exitCode = 1;
  }
})();
