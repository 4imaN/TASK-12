/**
 * Database seed script.
 * Run with: node src/database/seed.js
 */
const bcrypt = require('bcrypt');
const db = require('./connection');

const BCRYPT_COST = 12;

async function seed() {
  console.log('[SEED] Starting database seed...');

  try {
    const existing = await db('users').count('id as count').first();
    if (existing.count > 0) {
      console.log('[SEED] Database already has data. Skipping seed.');
      process.exit(0);
    }

    const adminHash = await bcrypt.hash('admin123', BCRYPT_COST);
    const hostHash = await bcrypt.hash('host123', BCRYPT_COST);

    await db('users').insert([
      { username: 'admin', password_hash: adminHash, display_name: 'Platform Administrator', role: 'platform_ops', is_active: true, max_sessions: 2 },
      { username: 'host1', password_hash: hostHash, display_name: 'Station Host 1', role: 'host', is_active: true, max_sessions: 2 }
    ]);
    console.log('[SEED] Users created');

    // Bootstrap: trust initial devices so seeded users can log in
    await db('trusted_devices').insert([
      { user_id: 1, device_fingerprint: 'BOOTSTRAP_INITIAL_DEVICE' },
      { user_id: 2, device_fingerprint: 'TEST_DEVICE_host1' }
    ]);

    // Admin gets max_sessions: 2 like everyone else, but gets explicit exception
    await db('session_exceptions').insert([
      { user_id: 1, granted_by: 1, max_sessions: 100, reason: 'Initial platform administrator bootstrap' },
      { user_id: 2, granted_by: 1, max_sessions: 100, reason: 'Initial host bootstrap' }
    ]);

    await db('stations').insert([
      { code: 'NYC', name: 'New York Penn Station', name_normalized: 'new york penn station', region: 'Northeast' },
      { code: 'BOS', name: 'Boston South Station', name_normalized: 'boston south station', region: 'Northeast' },
      { code: 'WAS', name: 'Washington Union Station', name_normalized: 'washington union station', region: 'Mid-Atlantic' },
      { code: 'CHI', name: 'Chicago Union Station', name_normalized: 'chicago union station', region: 'Midwest' },
      { code: 'PHL', name: 'Philadelphia 30th St Station', name_normalized: 'philadelphia 30th st station', region: 'Mid-Atlantic' },
      { code: 'BAL', name: 'Baltimore Penn Station', name_normalized: 'baltimore penn station', region: 'Mid-Atlantic' }
    ]);

    await db('station_aliases').insert([
      { station_id: 1, alias: 'Penn Station', alias_normalized: 'penn station' },
      { station_id: 1, alias: 'New York', alias_normalized: 'new york' },
      { station_id: 1, alias: 'NYP', alias_normalized: 'nyp' },
      { station_id: 2, alias: 'South Station', alias_normalized: 'south station' },
      { station_id: 2, alias: 'Boston', alias_normalized: 'boston' },
      { station_id: 2, alias: 'BOS', alias_normalized: 'bos' },
      { station_id: 3, alias: 'Union Station DC', alias_normalized: 'union station dc' },
      { station_id: 3, alias: 'Washington DC', alias_normalized: 'washington dc' },
      { station_id: 3, alias: 'DC', alias_normalized: 'dc' },
      { station_id: 4, alias: 'Chicago', alias_normalized: 'chicago' },
      { station_id: 4, alias: 'CHI', alias_normalized: 'chi' },
      { station_id: 5, alias: 'Philadelphia', alias_normalized: 'philadelphia' },
      { station_id: 5, alias: 'Philly', alias_normalized: 'philly' },
      { station_id: 6, alias: 'Baltimore', alias_normalized: 'baltimore' },
      { station_id: 6, alias: 'BAL', alias_normalized: 'bal' }
    ]);

    await db('user_station_scopes').insert([
      { user_id: 2, station_id: 1 },
      { user_id: 2, station_id: 2 }
    ]);

    await db('trainsets').insert([
      { code: 'ACELA-2100', name: 'Acela Express 2100', total_capacity: 304 },
      { code: 'NER-4400', name: 'Northeast Regional 4400', total_capacity: 520 }
    ]);

    // Published schedule
    const [scheduleId] = await db('schedules').insert({
      station_id: 1, route_name: 'Northeast Corridor Express', trainset_id: 1, created_by: 1
    });
    const [versionId] = await db('schedule_versions').insert({
      schedule_id: scheduleId, version_number: 1, status: 'published',
      trainset_id: 1, effective_at: new Date(), published_at: new Date(), created_by: 1
    });
    await db('schedules').where('id', scheduleId).update({ active_version_id: versionId });
    await db('schedule_stops').insert([
      { version_id: versionId, station_id: 1, stop_sequence: 1, departure_at: '2026-04-10 08:00:00' },
      { version_id: versionId, station_id: 5, stop_sequence: 2, arrival_at: '2026-04-10 09:15:00', departure_at: '2026-04-10 09:20:00' },
      { version_id: versionId, station_id: 3, stop_sequence: 3, arrival_at: '2026-04-10 11:30:00', departure_at: '2026-04-10 11:30:00' }
    ]);
    await db('seat_classes').insert([
      { version_id: versionId, class_code: 'ECO', class_name: 'Economy', capacity: 200, fare: 49.00, is_available: true },
      { version_id: versionId, class_code: 'BIZ', class_name: 'Business', capacity: 80, fare: 129.00, is_available: true },
      { version_id: versionId, class_code: 'FIR', class_name: 'First Class', capacity: 24, fare: 299.00, is_available: true }
    ]);

    // Inventory
    await db('inventory_items').insert([
      { station_id: 1, sku: 'WATER-500ML', name: 'Water Bottle 500ml', unit: 'bottle', unit_cost: 0.50, tracking_mode: 'none', reorder_point: 50 },
      { station_id: 1, sku: 'SNACK-MIX', name: 'Trail Mix Pack', unit: 'pack', unit_cost: 2.00, tracking_mode: 'batch', reorder_point: 30 },
      { station_id: 1, sku: 'RADIO-HH', name: 'Handheld Radio', unit: 'unit', unit_cost: 150.00, tracking_mode: 'serial', reorder_point: 5 },
      { station_id: 2, sku: 'MEDKIT-STD', name: 'Standard Medical Kit', unit: 'kit', unit_cost: 75.00, tracking_mode: 'serial', reorder_point: 3 },
      { station_id: 1, sku: 'BLANKET-ECO', name: 'Economy Blanket', unit: 'piece', unit_cost: 8.00, tracking_mode: 'none', reorder_point: 20 }
    ]);
    await db('inventory_balances').insert([
      { item_id: 1, station_id: 1, on_hand: 100 },
      { item_id: 2, station_id: 1, on_hand: 45 },
      { item_id: 3, station_id: 1, on_hand: 8 },
      { item_id: 4, station_id: 2, on_hand: 4 },
      { item_id: 5, station_id: 1, on_hand: 15 }
    ]);

    console.log('[SEED] Seed completed successfully!');
    console.log('[SEED] Accounts: admin/admin123 (Platform Ops), host1/host123 (Host)');
  } catch (err) {
    console.error('[SEED] Error:', err.message);
    process.exit(1);
  }
  process.exit(0);
}

seed();
