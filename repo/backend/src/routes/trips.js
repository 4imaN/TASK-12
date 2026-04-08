const Router = require('koa-router');
const db = require('../database/connection');
const { optionalAuth } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { normalize, findMatchingStations } = require('../utils/fuzzyMatch');

const router = new Router({ prefix: '/api/trips' });

/**
 * GET /api/trips/search
 * Search published schedules with filters, fuzzy station matching, and nearby date suggestions.
 * No auth required.
 */
router.get('/search', optionalAuth(), async (ctx) => {
  const {
    origin,
    destination,
    date,
    seatClass,
    sort = 'departure',
    order = 'asc'
  } = ctx.query;

  // Validate required params
  if (!origin) {
    throw createError(400, 'VALIDATION_ERROR', 'Origin station is required.');
  }
  if (!destination) {
    throw createError(400, 'VALIDATION_ERROR', 'Destination station is required.');
  }

  // Parse date if provided
  let searchDateStr = null;
  let searchDate = null;
  if (date) {
    const dateParts = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dateParts) {
      throw createError(400, 'VALIDATION_ERROR', 'Date must be in MM/DD/YYYY format.');
    }
    const yyyy = parseInt(dateParts[3], 10);
    const mm = parseInt(dateParts[1], 10);
    const dd = parseInt(dateParts[2], 10);
    // Validate date components without timezone-sensitive Date parsing
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2000 || yyyy > 2100) {
      throw createError(400, 'VALIDATION_ERROR', 'Invalid date.');
    }
    searchDateStr = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    // Use UTC to avoid timezone shift
    searchDate = new Date(Date.UTC(yyyy, mm - 1, dd));
  }

  // Resolve origin and destination via fuzzy match against stations + aliases
  const originStation = await resolveStation(origin);
  const destStation = await resolveStation(destination);

  if (!originStation) {
    throw createError(400, 'VALIDATION_ERROR', `Could not find station matching "${origin}".`);
  }
  if (!destStation) {
    throw createError(400, 'VALIDATION_ERROR', `Could not find station matching "${destination}".`);
  }
  if (originStation.id === destStation.id) {
    throw createError(400, 'VALIDATION_ERROR', 'Origin and destination must be different stations.');
  }

  // Track search in search_tracking
  await trackSearch(originStation.name, destStation.name, searchDateStr, seatClass || null);

  // Find published schedule_versions where the route includes both origin and destination
  // in correct stop_sequence order, with date match on departure_at
  let query = db('schedule_versions as sv')
    .join('schedules as s', 'sv.schedule_id', 's.id')
    .join('schedule_stops as origin_stop', function () {
      this.on('origin_stop.version_id', '=', 'sv.id')
        .andOn('origin_stop.station_id', '=', db.raw('?', [originStation.id]));
    })
    .join('schedule_stops as dest_stop', function () {
      this.on('dest_stop.version_id', '=', 'sv.id')
        .andOn('dest_stop.station_id', '=', db.raw('?', [destStation.id]));
    })
    .where('sv.status', 'published')
    .whereRaw('origin_stop.stop_sequence < dest_stop.stop_sequence');

  // Filter by date: match departure_at date portion
  if (searchDateStr) {
    query = query.whereRaw('DATE(origin_stop.departure_at) = ?', [searchDateStr]);
  }

  query = query.select(
    'sv.id as version_id',
    'sv.schedule_id',
    'sv.version_number',
    'sv.trainset_id',
    's.route_name',
    's.station_id as schedule_station_id',
    'origin_stop.departure_at as origin_departure',
    'origin_stop.station_id as origin_station_id',
    'origin_stop.stop_sequence as origin_seq',
    'origin_stop.platform as origin_platform',
    'dest_stop.arrival_at as dest_arrival',
    'dest_stop.station_id as dest_station_id',
    'dest_stop.stop_sequence as dest_seq',
    'dest_stop.platform as dest_platform'
  );

  const results = await query;

  // Enrich results with seat class info
  const enriched = [];
  for (const trip of results) {
    // Get seat classes for this version
    const seatClasses = await db('seat_classes')
      .where('version_id', trip.version_id);

    // If filtering by seat class, skip trips that don't have it
    if (seatClass) {
      const normalizedFilter = seatClass.toLowerCase().trim();
      const hasClass = seatClasses.some(
        sc => sc.class_code.toLowerCase() === normalizedFilter ||
              sc.class_name.toLowerCase() === normalizedFilter ||
              sc.class_name.toLowerCase().startsWith(normalizedFilter)
      );
      if (!hasClass) continue;
    }

    // Count intermediate stops
    const stopCount = await db('schedule_stops')
      .where('version_id', trip.version_id)
      .where('stop_sequence', '>', trip.origin_seq)
      .where('stop_sequence', '<', trip.dest_seq)
      .count('id as count')
      .first();

    // Calculate duration from first stop departure to last stop arrival
    let durationMinutes = null;
    if (trip.origin_departure && trip.dest_arrival) {
      const depTime = new Date(trip.origin_departure);
      const arrTime = new Date(trip.dest_arrival);
      durationMinutes = Math.round((arrTime - depTime) / 60000);
      if (durationMinutes < 0) durationMinutes = null;
    }

    // Get trainset info if available
    let trainsetCode = null;
    if (trip.trainset_id) {
      const trainset = await db('trainsets').where('id', trip.trainset_id).first();
      if (trainset) trainsetCode = trainset.code;
    }

    enriched.push({
      scheduleId: trip.schedule_id,
      versionId: trip.version_id,
      routeName: trip.route_name,
      trainsetCode,
      origin: {
        stationId: originStation.id,
        stationName: originStation.name,
        departureAt: trip.origin_departure,
        platform: trip.origin_platform
      },
      destination: {
        stationId: destStation.id,
        stationName: destStation.name,
        arrivalAt: trip.dest_arrival,
        platform: trip.dest_platform
      },
      durationMinutes,
      intermediateStops: stopCount ? parseInt(stopCount.count, 10) : 0,
      seatClasses: seatClasses
        .filter(sc => sc.is_available)
        .map(sc => ({
          classCode: sc.class_code,
          className: sc.class_name,
          capacity: sc.capacity,
          fare: parseFloat(sc.fare),
          isAvailable: !!sc.is_available
        }))
    });
  }

  // Sort results
  enriched.sort((a, b) => {
    let cmp = 0;
    if (sort === 'departure') {
      const aT = new Date(a.origin.departureAt || 0).getTime();
      const bT = new Date(b.origin.departureAt || 0).getTime();
      cmp = aT - bT;
    } else if (sort === 'duration') {
      cmp = (a.durationMinutes || 0) - (b.durationMinutes || 0);
    } else if (sort === 'price') {
      const aMin = a.seatClasses.length ? Math.min(...a.seatClasses.map(sc => sc.fare)) : Infinity;
      const bMin = b.seatClasses.length ? Math.min(...b.seatClasses.map(sc => sc.fare)) : Infinity;
      cmp = aMin - bMin;
    }
    return order === 'desc' ? -cmp : cmp;
  });

  // If no results and date was provided, suggest +/- 3 nearby dates
  let nearbySuggestions = [];
  if (enriched.length === 0 && searchDate) {
    nearbySuggestions = await findNearbyDates(originStation.id, destStation.id, searchDate);
  }

  ctx.body = {
    success: true,
    data: {
      results: enriched,
      nearbySuggestions
    }
  };
});

/**
 * GET /api/trips/hot-searches
 * Return top 10 most searched routes in the last 7 days from search_tracking.
 */
router.get('/hot-searches', async (ctx) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const hotSearches = await db('search_tracking')
    .where('last_searched_at', '>=', sevenDaysAgo)
    .orderBy('search_count', 'desc')
    .limit(10)
    .select('id', 'origin', 'destination', 'search_date', 'seat_class', 'search_count', 'last_searched_at');

  ctx.body = {
    success: true,
    data: {
      results: hotSearches.map(hs => ({
        origin: hs.origin,
        destination: hs.destination,
        searchDate: hs.search_date,
        seatClass: hs.seat_class,
        searchCount: hs.search_count,
        lastSearchedAt: hs.last_searched_at
      }))
    }
  };
});

/**
 * Resolve a station input (ID, code, or fuzzy name match) using stations + aliases.
 */
async function resolveStation(input) {
  // Try by numeric ID
  if (/^\d+$/.test(input)) {
    const station = await db('stations').where('id', parseInt(input, 10)).first();
    if (station) return station;
  }

  // Try by station code (exact, case-insensitive)
  const byCode = await db('stations')
    .where(db.raw('UPPER(code)'), input.toUpperCase())
    .first();
  if (byCode) return byCode;

  // Fuzzy match against stations + aliases
  const allStations = await db('stations').select('id', 'code', 'name');
  const aliases = await db('station_aliases').select('station_id', 'alias');
  const aliasMap = {};
  for (const a of aliases) {
    if (!aliasMap[a.station_id]) aliasMap[a.station_id] = [];
    aliasMap[a.station_id].push(a);
  }
  const stationsWithAliases = allStations.map(s => ({
    ...s,
    aliases: aliasMap[s.id] || []
  }));

  const matches = findMatchingStations(input, stationsWithAliases);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Track a search in the search_tracking table.
 * Upserts: increments search_count if origin/destination/date/class combo exists.
 */
async function trackSearch(origin, destination, searchDate, seatClass) {
  try {
    // Check for existing row
    let query = db('search_tracking')
      .where('origin', origin)
      .where('destination', destination);

    if (searchDate) {
      query = query.where('search_date', searchDate);
    } else {
      query = query.whereNull('search_date');
    }

    if (seatClass) {
      query = query.where('seat_class', seatClass);
    } else {
      query = query.whereNull('seat_class');
    }

    const existing = await query.first();
    const now = new Date();

    if (existing) {
      await db('search_tracking')
        .where('id', existing.id)
        .update({
          search_count: existing.search_count + 1,
          last_searched_at: now
        });
    } else {
      await db('search_tracking').insert({
        origin,
        destination,
        search_date: searchDate || null,
        seat_class: seatClass || null,
        search_count: 1,
        last_searched_at: now
      });
    }
  } catch (err) {
    // Non-critical -- don't fail the search if tracking fails
    console.error('[SEARCH_TRACKING] Failed to track search:', err.message);
  }
}

/**
 * Find nearby dates (+/- 3 days) that have matching published trips.
 */
async function findNearbyDates(originId, destId, searchDate) {
  const suggestions = [];

  for (let offset = -3; offset <= 3; offset++) {
    if (offset === 0) continue;
    const checkDate = new Date(searchDate);
    checkDate.setDate(checkDate.getDate() + offset);
    const checkDateStr = checkDate.toISOString().split('T')[0];

    const count = await db('schedule_versions as sv')
      .join('schedule_stops as origin_stop', function () {
        this.on('origin_stop.version_id', '=', 'sv.id')
          .andOn('origin_stop.station_id', '=', db.raw('?', [originId]));
      })
      .join('schedule_stops as dest_stop', function () {
        this.on('dest_stop.version_id', '=', 'sv.id')
          .andOn('dest_stop.station_id', '=', db.raw('?', [destId]));
      })
      .where('sv.status', 'published')
      .whereRaw('origin_stop.stop_sequence < dest_stop.stop_sequence')
      .whereRaw('DATE(origin_stop.departure_at) = ?', [checkDateStr])
      .count('sv.id as count')
      .first();

    const tripCount = count ? parseInt(count.count, 10) : 0;
    if (tripCount > 0) {
      const mm = String(checkDate.getMonth() + 1).padStart(2, '0');
      const dd = String(checkDate.getDate()).padStart(2, '0');
      const yyyy = checkDate.getFullYear();
      suggestions.push({ date: `${mm}/${dd}/${yyyy}`, tripCount });
    }
  }

  return suggestions.slice(0, 3);
}

module.exports = router;
