const { maskPhone } = require('../backend/src/utils/masks');

describe('maskPhone', () => {
  test('platform_ops sees full phone number', () => {
    expect(maskPhone('555-123-4567', 'platform_ops')).toBe('555-123-4567');
  });

  test('host sees only last 4 digits', () => {
    expect(maskPhone('555-123-4567', 'host')).toBe('****4567');
  });

  test('guest sees only last 4 digits', () => {
    expect(maskPhone('5551234567', 'guest')).toBe('****4567');
  });

  test('null phone returns ****', () => {
    expect(maskPhone(null, 'host')).toBe('****');
  });

  test('undefined phone returns ****', () => {
    expect(maskPhone(undefined, 'host')).toBe('****');
  });

  test('empty string returns ****', () => {
    expect(maskPhone('', 'host')).toBe('****');
  });

  test('short phone (less than 4 chars) returns ****', () => {
    expect(maskPhone('12', 'host')).toBe('****');
  });

  test('exactly 4 char phone masks properly', () => {
    expect(maskPhone('1234', 'host')).toBe('****1234');
  });
});
