/**
 * Validate a schedule version for publishing.
 * Returns { valid: boolean, errors: string[], checks: Array<{name, passed, message}> }
 */
function validateScheduleForPublish(version, stops, seatClasses, trainset, allPublishedVersions) {
  const checks = [];

  // 1. At least one stop
  const hasStops = stops.length >= 1;
  checks.push({
    name: 'minimum_stops',
    passed: hasStops,
    message: hasStops ? `Schedule has ${stops.length} stop(s).` : 'At least one stop is required.'
  });

  // 2. Valid time sequence (departure_at strictly increasing)
  let timeValid = true;
  let timeMessage = 'All timing sequences are valid.';
  const sorted = [...stops].sort((a, b) => a.stop_sequence - b.stop_sequence);
  for (let i = 0; i < sorted.length; i++) {
    const stop = sorted[i];
    if (stop.arrival_at && stop.departure_at) {
      if (new Date(stop.departure_at) < new Date(stop.arrival_at)) {
        timeValid = false;
        timeMessage = `Stop ${stop.stop_sequence}: departure is before arrival.`;
        break;
      }
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      const prevDep = new Date(prev.departure_at);
      const currArr = stop.arrival_at ? new Date(stop.arrival_at) : new Date(stop.departure_at);
      if (currArr <= prevDep) {
        timeValid = false;
        timeMessage = `Stop ${stop.stop_sequence}: time is not after previous stop's departure.`;
        break;
      }
    }
  }
  checks.push({ name: 'time_sequence', passed: timeValid, message: timeMessage });

  // 3. At least one seat class
  const hasSeatClass = seatClasses.length >= 1;
  checks.push({
    name: 'at_least_one_seat_class',
    passed: hasSeatClass,
    message: hasSeatClass ? `${seatClasses.length} seat class(es) defined.` : 'At least one seat class is required.'
  });

  // 4. Seat class capacity (1-500) and fare ($1-$999)
  let scValid = true;
  let scMessage = 'All seat class values are within range.';
  for (const sc of seatClasses) {
    if (sc.capacity < 1 || sc.capacity > 500) {
      scValid = false;
      scMessage = `Seat class "${sc.class_code || sc.class_name}": capacity ${sc.capacity} is outside range 1-500.`;
      break;
    }
    if (sc.fare < 1 || sc.fare > 999) {
      scValid = false;
      scMessage = `Seat class "${sc.class_code || sc.class_name}": fare $${sc.fare} is outside range $1-$999.`;
      break;
    }
  }
  checks.push({ name: 'seat_class_values', passed: scValid, message: scMessage });

  // 5. Trainset overlap check
  if (allPublishedVersions && trainset && sorted.length >= 1) {
    const firstDep = new Date(sorted[0].departure_at);
    const lastArr = sorted.length >= 2
      ? new Date(sorted[sorted.length - 1].arrival_at || sorted[sorted.length - 1].departure_at)
      : firstDep; // Single stop: point-in-time occupancy

    const overlapping = allPublishedVersions.filter(v => {
      if (v.trainset_id !== trainset.id) return false;
      // Exclude all versions of the same schedule — replacement activations are valid
      if (v.schedule_id === version.schedule_id) return false;
      if (!v.first_departure || !v.last_arrival) return false;
      const vStart = new Date(v.first_departure);
      const vEnd = new Date(v.last_arrival);
      return firstDep < vEnd && lastArr > vStart;
    });

    const noOverlap = overlapping.length === 0;
    checks.push({
      name: 'no_trainset_overlap',
      passed: noOverlap,
      message: noOverlap ? 'No trainset overlap.' : `${overlapping.length} overlapping schedule(s) on this trainset.`
    });
  }

  const valid = checks.every(c => c.passed);
  const errors = checks.filter(c => !c.passed).map(c => c.message);
  return { valid, errors, checks };
}

/**
 * Validate an inventory movement.
 * Returns { valid: boolean, errors: string[] }
 */
function validateMovement(data) {
  const errors = [];
  const validTypes = ['receiving', 'shipping', 'material_return', 'customer_return', 'adjustment'];

  if (!data.item_id) {
    errors.push('Item ID is required.');
  }
  if (!data.movement_type || !validTypes.includes(data.movement_type)) {
    errors.push(`Invalid or missing movement type. Valid: ${validTypes.join(', ')}.`);
  }
  if (!data.quantity || !Number.isInteger(data.quantity) || data.quantity < 1) {
    errors.push('Quantity must be a positive integer.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a seat class.
 * Returns { valid: boolean, errors: string[] }
 */
function validateSeatClass(data) {
  const errors = [];

  if (!data.class_code) {
    errors.push('Class code is required.');
  }
  if (!data.class_name) {
    errors.push('Class name is required.');
  }
  if (data.capacity === undefined || data.capacity === null || !Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 500) {
    errors.push('Capacity must be an integer between 1 and 500.');
  }
  if (data.fare === undefined || data.fare === null || data.fare < 1 || data.fare > 999) {
    errors.push('Fare must be between $1.00 and $999.00.');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateScheduleForPublish, validateMovement, validateSeatClass };
