/**
 * Global error handler middleware.
 * Catches all errors and returns structured JSON responses.
 */
function errorHandler() {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.expose !== false && err.message ? err.message : 'An unexpected error occurred.';

      ctx.status = status;
      ctx.body = {
        success: false,
        error: {
          code,
          message,
          ...(err.details ? { details: err.details } : {})
        }
      };

      // Log 5xx errors to console
      if (status >= 500) {
        console.error(`[ERROR] ${status} ${code}: ${err.message}`);
        if (err.stack) console.error(err.stack);
      }
    }
  };
}

/**
 * Create an application error with structured fields.
 */
function createError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.expose = true;
  if (details) err.details = details;
  return err;
}

module.exports = { errorHandler, createError };
