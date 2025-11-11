const DEFAULT_CLASSNAME = 'Global';

function buildEntry({
  filename,
  classname,
  fn,
  systemSection,
  message,
  level,
  lineNum,
  error,
  dbPhase,
  method,
}) {
  const timestamp = new Date().toISOString();
  return {
    filename,
    timestamp,
    classname,
    function: fn,
    system_section: systemSection,
    line_num: lineNum ?? null,
    error: error ? String(error) : null,
    db_phase: dbPhase ?? 'none',
    method: method ?? 'NONE',
    level,
    message,
  };
}

function emitLog(entry) {
  const line = `[${entry.filename}][${entry.classname}#${entry.function}][${entry.system_section}] ${entry.message}`;
  const payload = buildEntry(entry);
  switch (entry.level) {
    case 'error':
      console.error(JSON.stringify(payload));
      console.error(line);
      break;
    case 'warn':
      console.warn(JSON.stringify(payload));
      console.warn(line);
      break;
    default:
      console.log(JSON.stringify(payload));
      console.log(line);
  }
}

export function createLogger(filename, classname = DEFAULT_CLASSNAME) {
  function log(level, fn, systemSection, message, options = {}) {
    emitLog({
      filename,
      classname,
      fn,
      systemSection,
      message,
      level,
      lineNum: options.lineNum,
      error: options.error,
      dbPhase: options.dbPhase,
      method: options.method,
    });
  }

  return {
    info(fn, systemSection, message, options) {
      log('info', fn, systemSection, message, options);
    },
    warn(fn, systemSection, message, options) {
      log('warn', fn, systemSection, message, options);
    },
    error(fn, systemSection, message, options) {
      log('error', fn, systemSection, message, options);
    },
  };
}
