const { createError } = require('./errorHandler');

/**
 * Row-level scope enforcement middleware.
 *
 * For Host role: restricts data to assigned station_id(s).
 * For Platform Ops: no filter (cross-site visibility).
 * For Guest: no station-scoped data is accessible.
 *
 * Attaches ctx.state.stationScope with the relevant station IDs,
 * or null if no filtering is needed (platform_ops).
 */
function scopeFilter() {
  return async (ctx, next) => {
    const user = ctx.state.user;

    if (!user) {
      // Guest/unauthenticated - no station scope
      ctx.state.stationScope = null;
      await next();
      return;
    }

    if (user.role === 'platform_ops') {
      // Cross-site visibility, no filtering
      ctx.state.stationScope = null;
    } else if (user.role === 'host') {
      // Filter by assigned stations
      const stationIds = user.assignedStationIds || [];
      if (stationIds.length === 0) {
        throw createError(403, 'FORBIDDEN', 'You have no station assignments. Contact an administrator.');
      }
      ctx.state.stationScope = stationIds;
    } else {
      ctx.state.stationScope = null;
    }

    await next();
  };
}

/**
 * Apply station scope filter to a knex query builder.
 * @param {Object} query - Knex query builder
 * @param {Array|null} stationScope - Array of station IDs or null for no filter
 * @param {string} column - Column name to filter on (default: 'station_id')
 * @returns {Object} - Modified query builder
 */
function applyStationScope(query, stationScope, column = 'station_id') {
  if (stationScope && stationScope.length > 0) {
    return query.whereIn(column, stationScope);
  }
  return query;
}

module.exports = { scopeFilter, applyStationScope };
