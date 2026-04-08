const { validateSeatClass, validateMovement } = require('../backend/src/utils/validators');

describe('validateSeatClass', () => {
  test('valid seat class passes', () => {
    const result = validateSeatClass({ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 50 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('minimum valid values pass', () => {
    const result = validateSeatClass({ class_code: 'A', class_name: 'A', capacity: 1, fare: 1.00 });
    expect(result.valid).toBe(true);
  });

  test('maximum valid values pass', () => {
    const result = validateSeatClass({ class_code: 'MAX', class_name: 'Maximum', capacity: 500, fare: 999.00 });
    expect(result.valid).toBe(true);
  });

  test('capacity below 1 fails', () => {
    const result = validateSeatClass({ class_code: 'ECO', class_name: 'Economy', capacity: 0, fare: 50 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('capacity') || e.includes('Capacity'))).toBe(true);
  });

  test('capacity above 500 fails', () => {
    const result = validateSeatClass({ class_code: 'ECO', class_name: 'Economy', capacity: 501, fare: 50 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('capacity') || e.includes('Capacity'))).toBe(true);
  });

  test('fare below $1 fails', () => {
    const result = validateSeatClass({ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 0.50 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('fare') || e.includes('Fare'))).toBe(true);
  });

  test('fare above $999 fails', () => {
    const result = validateSeatClass({ class_code: 'ECO', class_name: 'Economy', capacity: 100, fare: 1000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('fare') || e.includes('Fare'))).toBe(true);
  });

  test('missing class_code fails', () => {
    const result = validateSeatClass({ class_name: 'Economy', capacity: 100, fare: 50 });
    expect(result.valid).toBe(false);
  });

  test('missing class_name fails', () => {
    const result = validateSeatClass({ class_code: 'ECO', capacity: 100, fare: 50 });
    expect(result.valid).toBe(false);
  });
});

describe('validateMovement', () => {
  test('valid receiving movement passes', () => {
    const result = validateMovement({
      item_id: 1, station_id: 1, movement_type: 'receiving', quantity: 10
    });
    expect(result.valid).toBe(true);
  });

  test('valid shipping movement passes', () => {
    const result = validateMovement({
      item_id: 1, station_id: 1, movement_type: 'shipping', quantity: 5
    });
    expect(result.valid).toBe(true);
  });

  test('negative quantity fails', () => {
    const result = validateMovement({
      item_id: 1, station_id: 1, movement_type: 'receiving', quantity: -5
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('quantity') || e.includes('Quantity'))).toBe(true);
  });

  test('zero quantity fails', () => {
    const result = validateMovement({
      item_id: 1, station_id: 1, movement_type: 'receiving', quantity: 0
    });
    expect(result.valid).toBe(false);
  });

  test('missing item_id fails', () => {
    const result = validateMovement({
      station_id: 1, movement_type: 'receiving', quantity: 10
    });
    expect(result.valid).toBe(false);
  });

  test('missing movement_type fails', () => {
    const result = validateMovement({
      item_id: 1, station_id: 1, quantity: 10
    });
    expect(result.valid).toBe(false);
  });

  test('invalid movement_type fails', () => {
    const result = validateMovement({
      item_id: 1, station_id: 1, movement_type: 'invalid', quantity: 10
    });
    expect(result.valid).toBe(false);
  });
});
