/**
 * Structured JSON logger for RailOps backend.
 *
 * Outputs one JSON object per line with: timestamp, level, component, message,
 * and optional detail fields. This format is parseable by log aggregators and
 * provides operationally useful metadata for an offline LAN deployment.
 */

function emit(level, component, message, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message
  };
  if (extra !== undefined && extra !== null) {
    if (typeof extra === 'object' && !Array.isArray(extra)) {
      Object.assign(entry, extra);
    } else {
      entry.detail = extra;
    }
  }
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  info:  (component, message, extra) => emit('info',  component, message, extra),
  warn:  (component, message, extra) => emit('warn',  component, message, extra),
  error: (component, message, extra) => emit('error', component, message, extra),
  debug: (component, message, extra) => emit('debug', component, message, extra)
};
