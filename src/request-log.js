// OAuth codes, webhook verification tokens and health searches can occur in
// query parameters. Operational logs need the path, never those values.
function requestLogPath(req) {
  return String(req?.originalUrl || req?.url || '').split(/[?#]/, 1)[0];
}

module.exports = { requestLogPath };
