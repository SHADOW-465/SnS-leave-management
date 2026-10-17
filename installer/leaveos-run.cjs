/**
 * Process entry for the Windows service. Sets the office defaults, then starts the server.
 * The data folder stays in %PROGRAMDATA%\SimonAndSons\LeaveOS unless LEAVEOS_DATA_DIR is set.
 */
const path = require('node:path');

process.env.LEAVEOS_ENV ||= 'production';
process.env.LEAVEOS_BIND_ALL ||= 'true';
process.env.LEAVEOS_PORT ||= '8443';
process.env.LEAVEOS_WEB_DIST = path.join(__dirname, 'web');

// The server bundle is ESM (top-level await). Dynamic import works from this CJS runner.
// WinSW starts it as node.exe with this file as the argument.
import('./server.mjs').catch((error) => {
  console.error(error);
  process.exit(1);
});
