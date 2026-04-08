const Router = require('koa-router');
const db = require('../database/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { scopeFilter, applyStationScope } = require('../middleware/scopeFilter');
const { createError } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');

const router = new Router({ prefix: '/api/inventory' });

router.use(authenticate(), requireRole('host', 'platform_ops'), scopeFilter());

// ─── ITEMS ───────────────────────────────────────────────────

/**
 * GET /api/inventory/items
 * List inventory items. Station-scoped for hosts via user_station_scopes.
 * Joins inventory_balances to include on_hand.
 */
router.get('/items', async (ctx) => {
  const { page = 1, pageSize = 25, station_id, search, is_active, tracking_mode } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('inventory_items as ii')
    .leftJoin('inventory_balances as ib', function () {
      this.on('ii.id', '=', 'ib.item_id').andOn('ii.station_id', '=', 'ib.station_id');
    })
    .select(
      'ii.id',
      'ii.station_id',
      'ii.sku',
      'ii.name',
      'ii.description',
      'ii.unit',
      'ii.unit_cost',
      'ii.tracking_mode',
      'ii.reorder_point',
      'ii.is_active',
      'ii.created_at',
      'ii.updated_at',
      db.raw('COALESCE(ib.on_hand, 0) as on_hand')
    );

  let countQuery = db('inventory_items as ii');

  // Station scope for hosts
  if (ctx.state.stationScope) {
    query = applyStationScope(query, ctx.state.stationScope, 'ii.station_id');
    countQuery = applyStationScope(countQuery, ctx.state.stationScope, 'ii.station_id');
  }

  if (station_id) {
    query = query.where('ii.station_id', station_id);
    countQuery = countQuery.where('ii.station_id', station_id);
  }

  if (search) {
    const s = `%${search}%`;
    query = query.where(function () {
      this.where('ii.sku', 'like', s)
        .orWhere('ii.name', 'like', s)
        .orWhere('ii.description', 'like', s);
    });
    countQuery = countQuery.where(function () {
      this.where('ii.sku', 'like', s)
        .orWhere('ii.name', 'like', s)
        .orWhere('ii.description', 'like', s);
    });
  }

  if (tracking_mode) {
    query = query.where('ii.tracking_mode', tracking_mode);
    countQuery = countQuery.where('ii.tracking_mode', tracking_mode);
  }

  if (is_active !== undefined) {
    const active = is_active === 'true' || is_active === '1';
    query = query.where('ii.is_active', active);
    countQuery = countQuery.where('ii.is_active', active);
  }

  const totalResult = await countQuery.count('ii.id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const items = await query.orderBy('ii.sku', 'asc').limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: items.map(i => ({
        id: i.id,
        station_id: i.station_id,
        sku: i.sku,
        name: i.name,
        description: i.description,
        unit: i.unit,
        unit_cost: i.unit_cost != null ? parseFloat(i.unit_cost) : null,
        tracking_mode: i.tracking_mode,
        reorder_point: i.reorder_point,
        is_active: !!i.is_active,
        on_hand: i.on_hand,
        created_at: i.created_at,
        updated_at: i.updated_at
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/inventory/items
 * Create a new inventory item. Requires sku, name, station_id.
 */
router.post('/items', async (ctx) => {
  const {
    sku, name, station_id, description, unit, unit_cost,
    tracking_mode, reorder_point, is_active
  } = ctx.request.body || {};

  if (!sku || typeof sku !== 'string' || sku.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'sku is required.');
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'name is required.');
  }
  if (!station_id) {
    throw createError(400, 'VALIDATION_ERROR', 'station_id is required.');
  }

  // Station scope check for hosts
  if (ctx.state.stationScope && !ctx.state.stationScope.includes(parseInt(station_id))) {
    throw createError(403, 'FORBIDDEN', 'You are not assigned to this station.');
  }

  // Validate tracking_mode if provided
  if (tracking_mode && !['none', 'batch', 'serial'].includes(tracking_mode)) {
    throw createError(400, 'VALIDATION_ERROR', 'tracking_mode must be none, batch, or serial.');
  }

  // Check SKU uniqueness (sku is UNIQUE globally)
  const existing = await db('inventory_items').where('sku', sku.trim()).first();
  if (existing) {
    // Write-time DQ: log uniqueness violation before rejecting (dedup)
    const existingDqSku = await db('data_quality_issues')
      .where({ entity_type: 'inventory_items', entity_id: existing.id, check_type: 'uniqueness' })
      .whereIn('status', ['open', 'in_progress'])
      .first();
    if (!existingDqSku) {
      await db('data_quality_issues').insert({
        entity_type: 'inventory_items',
        entity_id: existing.id,
        check_type: 'uniqueness',
        severity: 'high',
        description: `Duplicate SKU "${sku.trim()}" rejected. Existing item id=${existing.id} at station ${existing.station_id}.`,
        status: 'open',
        owner: 'platform_ops',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        created_at: new Date(),
        updated_at: new Date()
      }).catch(() => {}); // best-effort DQ logging
    }
    throw createError(409, 'CONFLICT', 'An item with this SKU already exists.');
  }

  const now = new Date();
  const [itemId] = await db('inventory_items').insert({
    station_id: parseInt(station_id),
    sku: sku.trim(),
    name: name.trim(),
    description: description || null,
    unit: unit || 'each',
    unit_cost: unit_cost != null ? unit_cost : 0,
    tracking_mode: tracking_mode || 'none',
    reorder_point: reorder_point != null ? reorder_point : 20,
    is_active: is_active !== undefined ? is_active : true,
    created_at: now,
    updated_at: now
  });

  // Create initial balance record
  await db('inventory_balances').insert({
    item_id: itemId,
    station_id: parseInt(station_id),
    on_hand: 0,
    updated_at: now
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'inventory.create_item',
    'inventory_items',
    itemId,
    { sku: sku.trim(), name: name.trim(), station_id },
    ctx.ip
  );

  const created = await db('inventory_items').where('id', itemId).first();

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: created.id,
      station_id: created.station_id,
      sku: created.sku,
      name: created.name,
      description: created.description,
      unit: created.unit,
      unit_cost: created.unit_cost != null ? parseFloat(created.unit_cost) : null,
      tracking_mode: created.tracking_mode,
      reorder_point: created.reorder_point,
      is_active: !!created.is_active,
      created_at: created.created_at,
      updated_at: created.updated_at
    }
  };
});

/**
 * PATCH /api/inventory/items/:id
 * Update an inventory item (name, description, unit, unit_cost, reorder_point, tracking_mode, is_active).
 */
router.patch('/items/:id', async (ctx) => {
  const { id } = ctx.params;
  const { name, description, unit, unit_cost, reorder_point, tracking_mode, is_active } = ctx.request.body || {};

  const item = await db('inventory_items').where('id', id).first();
  if (!item) throw createError(404, 'NOT_FOUND', 'Item not found.');

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(item.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You are not assigned to this station.');
  }

  const updates = { updated_at: new Date() };

  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (unit !== undefined) updates.unit = unit;
  if (unit_cost !== undefined) updates.unit_cost = unit_cost;
  if (is_active !== undefined) updates.is_active = is_active;

  if (reorder_point !== undefined) {
    if (reorder_point < 0) throw createError(400, 'VALIDATION_ERROR', 'reorder_point must be >= 0.');
    updates.reorder_point = reorder_point;
  }

  if (tracking_mode !== undefined) {
    if (!['none', 'batch', 'serial'].includes(tracking_mode)) {
      throw createError(400, 'VALIDATION_ERROR', 'tracking_mode must be none, batch, or serial.');
    }
    updates.tracking_mode = tracking_mode;
  }

  await db('inventory_items').where('id', id).update(updates);

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'inventory.update_item',
    'inventory_items',
    parseInt(id),
    updates,
    ctx.ip
  );

  const updated = await db('inventory_items as ii')
    .leftJoin('inventory_balances as ib', function () {
      this.on('ii.id', '=', 'ib.item_id').andOn('ii.station_id', '=', 'ib.station_id');
    })
    .where('ii.id', id)
    .select('ii.*', db.raw('COALESCE(ib.on_hand, 0) as on_hand'))
    .first();

  ctx.body = {
    success: true,
    data: {
      id: updated.id,
      station_id: updated.station_id,
      sku: updated.sku,
      name: updated.name,
      description: updated.description,
      unit: updated.unit,
      unit_cost: updated.unit_cost != null ? parseFloat(updated.unit_cost) : null,
      tracking_mode: updated.tracking_mode,
      reorder_point: updated.reorder_point,
      is_active: !!updated.is_active,
      on_hand: updated.on_hand,
      created_at: updated.created_at,
      updated_at: updated.updated_at
    }
  };
});

/**
 * GET /api/inventory/items/:id
 * Get a single item with its balance.
 */
router.get('/items/:id', async (ctx) => {
  const { id } = ctx.params;

  const item = await db('inventory_items as ii')
    .leftJoin('inventory_balances as ib', function () {
      this.on('ii.id', '=', 'ib.item_id').andOn('ii.station_id', '=', 'ib.station_id');
    })
    .where('ii.id', id)
    .select('ii.*', db.raw('COALESCE(ib.on_hand, 0) as on_hand'), 'ib.last_counted_at')
    .first();

  if (!item) throw createError(404, 'NOT_FOUND', 'Item not found.');

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(item.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You do not have access to this station.');
  }

  ctx.body = {
    success: true,
    data: {
      id: item.id,
      station_id: item.station_id,
      sku: item.sku,
      name: item.name,
      description: item.description,
      unit: item.unit,
      unit_cost: item.unit_cost != null ? parseFloat(item.unit_cost) : null,
      tracking_mode: item.tracking_mode,
      reorder_point: item.reorder_point,
      is_active: !!item.is_active,
      on_hand: item.on_hand,
      last_counted_at: item.last_counted_at || null,
      created_at: item.created_at,
      updated_at: item.updated_at
    }
  };
});

// ─── MOVEMENTS ───────────────────────────────────────────────

/**
 * GET /api/inventory/movements
 * List movements. Filterable by type, item_id, date range. Station-scoped for hosts.
 */
router.get('/movements', async (ctx) => {
  const { page = 1, pageSize = 25, item_id, type, date_from, date_to, station_id } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('inventory_movements as im')
    .join('inventory_items as ii', 'im.item_id', 'ii.id')
    .leftJoin('users as u', 'im.performed_by', 'u.id')
    .select(
      'im.*',
      'ii.sku as item_sku',
      'ii.name as item_name',
      'u.display_name as performed_by_name'
    );

  let countQuery = db('inventory_movements as im')
    .join('inventory_items as ii', 'im.item_id', 'ii.id');

  // Station scope
  if (ctx.state.stationScope) {
    query = query.whereIn('im.station_id', ctx.state.stationScope);
    countQuery = countQuery.whereIn('im.station_id', ctx.state.stationScope);
  }

  if (station_id) {
    query = query.where('im.station_id', station_id);
    countQuery = countQuery.where('im.station_id', station_id);
  }
  if (item_id) {
    query = query.where('im.item_id', item_id);
    countQuery = countQuery.where('im.item_id', item_id);
  }
  if (type) {
    query = query.where('im.movement_type', type);
    countQuery = countQuery.where('im.movement_type', type);
  }
  if (date_from) {
    query = query.where('im.created_at', '>=', date_from);
    countQuery = countQuery.where('im.created_at', '>=', date_from);
  }
  if (date_to) {
    query = query.where('im.created_at', '<=', date_to);
    countQuery = countQuery.where('im.created_at', '<=', date_to);
  }

  const totalResult = await countQuery.count('im.id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const movements = await query.orderBy('im.created_at', 'desc').limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: movements.map(m => ({
        id: m.id,
        item_id: m.item_id,
        item_sku: m.item_sku,
        item_name: m.item_name,
        station_id: m.station_id,
        movement_type: m.movement_type,
        quantity: m.quantity,
        direction: m.direction,
        batch_number: m.batch_number,
        serial_numbers: m.serial_numbers || null,
        reference_number: m.reference_number,
        notes: m.notes,
        performed_by: m.performed_by,
        performed_by_name: m.performed_by_name || null,
        created_at: m.created_at
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/inventory/movements
 * Create a movement. Determines direction from type. Updates inventory_balances.on_hand
 * in a transaction. Blocks if shipping would go below 0 (non-adjustment).
 * Creates serial_records if tracking_mode=serial. Audit log.
 */
router.post('/movements', async (ctx) => {
  const {
    item_id, movement_type, quantity, batch_number,
    serial_numbers, reference_number, notes
  } = ctx.request.body || {};

  const validTypes = ['receiving', 'shipping', 'material_return', 'customer_return', 'adjustment'];
  if (!movement_type || !validTypes.includes(movement_type)) {
    throw createError(400, 'VALIDATION_ERROR', 'movement_type must be one of: receiving, shipping, material_return, customer_return, adjustment.');
  }
  if (!item_id) throw createError(400, 'VALIDATION_ERROR', 'item_id is required.');
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
    throw createError(400, 'VALIDATION_ERROR', 'quantity must be a positive number.');
  }

  const item = await db('inventory_items').where('id', item_id).first();
  if (!item) throw createError(404, 'NOT_FOUND', 'Item not found.');

  // Write-time DQ: freshness check — item must be active
  if (!item.is_active) {
    const existingDqItem = await db('data_quality_issues')
      .where({ entity_type: 'inventory_movements', entity_id: item_id, check_type: 'freshness' })
      .whereIn('status', ['open', 'in_progress'])
      .first();
    if (!existingDqItem) {
      await db('data_quality_issues').insert({
        entity_type: 'inventory_movements',
        entity_id: item_id,
        check_type: 'freshness',
        severity: 'high',
        description: `Movement attempted against inactive item id=${item_id} (SKU: ${item.sku}).`,
        status: 'open',
        owner: 'platform_ops',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        created_at: new Date(),
        updated_at: new Date()
      }).catch(() => {});
    }
    throw createError(409, 'CONFLICT', 'Cannot create movement for an inactive item.');
  }

  // Write-time DQ: freshness check — station must still be active
  const station = await db('stations').where('id', item.station_id).first();
  if (station && !station.is_active) {
    const existingDqStation = await db('data_quality_issues')
      .where({ entity_type: 'inventory_movements', entity_id: item.station_id, check_type: 'freshness' })
      .whereIn('status', ['open', 'in_progress'])
      .first();
    if (!existingDqStation) {
      await db('data_quality_issues').insert({
        entity_type: 'inventory_movements',
        entity_id: item.station_id,
        check_type: 'freshness',
        severity: 'high',
        description: `Movement attempted at inactive station id=${item.station_id} for item id=${item_id}.`,
        status: 'open',
        owner: 'platform_ops',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        created_at: new Date(),
        updated_at: new Date()
      }).catch(() => {});
    }
    throw createError(409, 'CONFLICT', 'Cannot create movement for an item at an inactive station.');
  }

  // Station scope check
  if (ctx.state.stationScope && !ctx.state.stationScope.includes(item.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You are not assigned to this station.');
  }

  // Determine direction from movement_type
  const inboundTypes = ['receiving', 'material_return', 'customer_return'];
  const direction = inboundTypes.includes(movement_type) ? 'in' : 'out';
  // For adjustment, direction can be either but we treat positive quantity as 'in'
  // per spec: shipping = out, all returns/receiving = in. Adjustment is 'out' by default
  // but we allow caller context; the spec says shipping=out, receiving/return=in.

  // Validate tracking mode requirements
  if (item.tracking_mode === 'batch' && !batch_number) {
    throw createError(400, 'VALIDATION_ERROR', 'batch_number is required for batch-tracked items.');
  }
  if (item.tracking_mode === 'serial') {
    if (!serial_numbers || !Array.isArray(serial_numbers) || serial_numbers.length === 0) {
      throw createError(400, 'VALIDATION_ERROR', 'serial_numbers array is required for serial-tracked items.');
    }
    if (serial_numbers.length !== quantity) {
      throw createError(400, 'VALIDATION_ERROR', `serial_numbers count (${serial_numbers.length}) must equal quantity (${quantity}).`);
    }
  }

  // Get current balance
  let balance = await db('inventory_balances')
    .where('item_id', item_id)
    .where('station_id', item.station_id)
    .first();
  const currentOnHand = balance ? balance.on_hand : 0;

  // Calculate delta
  const delta = direction === 'in' ? quantity : -quantity;
  const newOnHand = currentOnHand + delta;

  // Block if shipping would go below 0 for non-adjustment types
  if (movement_type !== 'adjustment' && newOnHand < 0) {
    throw createError(409, 'INSUFFICIENT_STOCK',
      `Insufficient stock. Current on_hand: ${currentOnHand}, requested outbound: ${quantity}.`);
  }

  const now = new Date();
  let movementId;

  await db.transaction(async (trx) => {
    // Insert movement
    [movementId] = await trx('inventory_movements').insert({
      item_id,
      station_id: item.station_id,
      movement_type,
      quantity,
      direction,
      batch_number: batch_number || null,
      reference_number: reference_number || null,
      notes: notes || null,
      performed_by: ctx.state.user.id,
      created_at: now
    });

    // Update or create balance
    if (balance) {
      await trx('inventory_balances')
        .where('item_id', item_id)
        .where('station_id', item.station_id)
        .update({ on_hand: newOnHand, updated_at: now });
    } else {
      await trx('inventory_balances').insert({
        item_id,
        station_id: item.station_id,
        on_hand: newOnHand,
        updated_at: now
      });
    }

    // Create serial_records if tracking_mode=serial
    if (item.tracking_mode === 'serial' && serial_numbers && serial_numbers.length > 0) {
      const serialInserts = serial_numbers.map(sn => ({
        movement_id: movementId,
        item_id,
        serial_number: sn,
        status: direction === 'in' ? 'in_stock' : 'shipped'
      }));
      await trx('serial_records').insert(serialInserts);
    }
  });

  // Audit log
  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    `inventory.movement.${movement_type}`,
    'inventory_movements',
    movementId,
    {
      item_id,
      movement_type,
      quantity,
      direction,
      balance_before: currentOnHand,
      balance_after: newOnHand
    },
    ctx.ip
  );

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: movementId,
      item_id: parseInt(item_id),
      station_id: item.station_id,
      movement_type,
      quantity,
      direction,
      batch_number: batch_number || null,
      reference_number: reference_number || null,
      notes: notes || null,
      performed_by: ctx.state.user.id,
      balance_before: currentOnHand,
      balance_after: newOnHand,
      created_at: now
    }
  };
});

/**
 * GET /api/inventory/movements/:id
 * Get a single movement detail.
 */
router.get('/movements/:id', async (ctx) => {
  const { id } = ctx.params;

  const movement = await db('inventory_movements as im')
    .join('inventory_items as ii', 'im.item_id', 'ii.id')
    .where('im.id', id)
    .select('im.*', 'ii.sku as item_sku', 'ii.name as item_name', 'ii.tracking_mode')
    .first();

  if (!movement) throw createError(404, 'NOT_FOUND', 'Movement not found.');

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(movement.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You do not have access to this station.');
  }

  // Fetch serial records if serial-tracked
  let serialRecords = [];
  if (movement.tracking_mode === 'serial') {
    serialRecords = await db('serial_records')
      .where('movement_id', id)
      .select('id', 'serial_number', 'status');
  }

  ctx.body = {
    success: true,
    data: {
      id: movement.id,
      item_id: movement.item_id,
      item_sku: movement.item_sku,
      item_name: movement.item_name,
      station_id: movement.station_id,
      movement_type: movement.movement_type,
      quantity: movement.quantity,
      direction: movement.direction,
      batch_number: movement.batch_number,
      reference_number: movement.reference_number,
      notes: movement.notes,
      performed_by: movement.performed_by,
      serial_records: serialRecords,
      created_at: movement.created_at
    }
  };
});

// ─── STOCK COUNTS ────────────────────────────────────────────

/**
 * GET /api/inventory/stock-counts
 * List stock counts. Station-scoped.
 */
router.get('/stock-counts', async (ctx) => {
  const { page = 1, pageSize = 25, status, station_id } = ctx.query;
  const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let query = db('stock_counts as sc').select('sc.*');
  let countQuery = db('stock_counts as sc');

  // Station scope
  if (ctx.state.stationScope) {
    query = query.whereIn('sc.station_id', ctx.state.stationScope);
    countQuery = countQuery.whereIn('sc.station_id', ctx.state.stationScope);
  }
  if (station_id) {
    query = query.where('sc.station_id', station_id);
    countQuery = countQuery.where('sc.station_id', station_id);
  }
  if (status) {
    query = query.where('sc.status', status);
    countQuery = countQuery.where('sc.status', status);
  }

  const totalResult = await countQuery.count('sc.id as count').first();
  const total = totalResult ? totalResult.count : 0;

  const counts = await query.orderBy('sc.started_at', 'desc').limit(limit).offset(offset);

  ctx.body = {
    success: true,
    data: {
      results: counts.map(c => ({
        id: c.id,
        station_id: c.station_id,
        status: c.status,
        counted_by: c.counted_by,
        finalized_by: c.finalized_by,
        started_at: c.started_at,
        finalized_at: c.finalized_at,
        notes: c.notes
      })),
      total,
      page: parseInt(page, 10) || 1,
      pageSize: limit
    }
  };
});

/**
 * POST /api/inventory/stock-counts
 * Create a new stock count for the user's station.
 */
router.post('/stock-counts', async (ctx) => {
  const { station_id, notes } = ctx.request.body || {};

  if (!station_id) throw createError(400, 'VALIDATION_ERROR', 'station_id is required.');

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(parseInt(station_id))) {
    throw createError(403, 'FORBIDDEN', 'You are not assigned to this station.');
  }

  // Check no open/in_progress count already exists for this station
  const existing = await db('stock_counts')
    .where('station_id', station_id)
    .whereIn('status', ['open', 'in_progress'])
    .first();
  if (existing) {
    throw createError(409, 'CONFLICT', 'An open or in-progress stock count already exists for this station.');
  }

  const now = new Date();
  const [countId] = await db('stock_counts').insert({
    station_id: parseInt(station_id),
    status: 'open',
    counted_by: ctx.state.user.id,
    started_at: now,
    notes: notes || null
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'inventory.create_stock_count',
    'stock_counts',
    countId,
    { station_id, status: 'open' },
    ctx.ip
  );

  ctx.status = 201;
  ctx.body = {
    success: true,
    data: {
      id: countId,
      station_id: parseInt(station_id),
      status: 'open',
      counted_by: ctx.state.user.id,
      started_at: now,
      notes: notes || null,
      lines: []
    }
  };
});

/**
 * GET /api/inventory/stock-counts/:id
 * Get a stock count with its lines.
 */
router.get('/stock-counts/:id', async (ctx) => {
  const { id } = ctx.params;

  const stockCount = await db('stock_counts').where('id', id).first();
  if (!stockCount) throw createError(404, 'NOT_FOUND', 'Stock count not found.');

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(stockCount.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You do not have access to this station.');
  }

  const lines = await db('stock_count_lines as scl')
    .join('inventory_items as ii', 'scl.item_id', 'ii.id')
    .where('scl.stock_count_id', id)
    .select(
      'scl.id',
      'scl.item_id',
      'ii.sku as item_sku',
      'ii.name as item_name',
      'scl.book_quantity',
      'scl.counted_quantity',
      'scl.variance_quantity',
      'scl.variance_cost',
      'scl.batch_number',
      'scl.serial_numbers'
    );

  ctx.body = {
    success: true,
    data: {
      id: stockCount.id,
      station_id: stockCount.station_id,
      status: stockCount.status,
      counted_by: stockCount.counted_by,
      finalized_by: stockCount.finalized_by,
      started_at: stockCount.started_at,
      finalized_at: stockCount.finalized_at,
      notes: stockCount.notes,
      lines: lines.map(l => ({
        id: l.id,
        item_id: l.item_id,
        item_sku: l.item_sku,
        item_name: l.item_name,
        book_quantity: l.book_quantity,
        counted_quantity: l.counted_quantity,
        variance_quantity: l.variance_quantity,
        variance_cost: l.variance_cost != null ? parseFloat(l.variance_cost) : null,
        batch_number: l.batch_number,
        serial_numbers: l.serial_numbers ? (typeof l.serial_numbers === 'string' ? JSON.parse(l.serial_numbers) : l.serial_numbers) : null
      }))
    }
  };
});

/**
 * PATCH /api/inventory/stock-counts/:id
 * Update count: add/update lines.
 * Accepts { lines: [{ item_id, counted_quantity, batch_number, serial_numbers }] }
 */
router.patch('/stock-counts/:id', async (ctx) => {
  const { id } = ctx.params;
  const { lines } = ctx.request.body || {};

  const stockCount = await db('stock_counts').where('id', id).first();
  if (!stockCount) throw createError(404, 'NOT_FOUND', 'Stock count not found.');

  if (['finalized', 'cancelled'].includes(stockCount.status)) {
    throw createError(409, 'CONFLICT', 'Stock count is already finalized or cancelled.');
  }

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(stockCount.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You do not have access to this station.');
  }

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    throw createError(400, 'VALIDATION_ERROR', 'lines array is required and must not be empty.');
  }

  // Wrap the entire status update + line upsert in a transaction
  await db.transaction(async (trx) => {
    // Move to in_progress if currently open
    if (stockCount.status === 'open') {
      await trx('stock_counts').where('id', id).update({ status: 'in_progress' });
    }

    for (const line of lines) {
      if (!line.item_id) continue;

      const item = await trx('inventory_items').where('id', line.item_id).first();
      if (!item) {
        throw createError(400, 'VALIDATION_ERROR', `Item ${line.item_id} not found.`);
      }
      if (item.station_id !== stockCount.station_id) {
        throw createError(403, 'FORBIDDEN', `Item ${line.item_id} does not belong to this stock count's station.`);
      }

      // Get system (book) balance
      const balance = await trx('inventory_balances')
        .where('item_id', line.item_id)
        .where('station_id', stockCount.station_id)
        .first();
      const bookQuantity = balance ? balance.on_hand : 0;
      const countedQuantity = line.counted_quantity != null ? line.counted_quantity : 0;
      const varianceCost = (countedQuantity - bookQuantity) * (item.unit_cost ? parseFloat(item.unit_cost) : 0);

      // Upsert line
      const existingLine = await trx('stock_count_lines')
        .where('stock_count_id', id)
        .where('item_id', line.item_id)
        .first();

      if (existingLine) {
        await trx('stock_count_lines')
          .where('id', existingLine.id)
          .update({
            book_quantity: bookQuantity,
            counted_quantity: countedQuantity,
            variance_cost: varianceCost,
            batch_number: line.batch_number || existingLine.batch_number,
            serial_numbers: line.serial_numbers ? JSON.stringify(line.serial_numbers) : existingLine.serial_numbers
          });
      } else {
        await trx('stock_count_lines').insert({
          stock_count_id: parseInt(id),
          item_id: line.item_id,
          book_quantity: bookQuantity,
          counted_quantity: countedQuantity,
          variance_cost: varianceCost,
          batch_number: line.batch_number || null,
          serial_numbers: line.serial_numbers ? JSON.stringify(line.serial_numbers) : null
        });
      }
    }
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'inventory.update_stock_count',
    'stock_counts',
    parseInt(id),
    { lines_updated: lines.length },
    ctx.ip
  );

  // Return updated count with lines
  const updatedLines = await db('stock_count_lines as scl')
    .join('inventory_items as ii', 'scl.item_id', 'ii.id')
    .where('scl.stock_count_id', id)
    .select(
      'scl.id', 'scl.item_id', 'ii.sku as item_sku', 'ii.name as item_name',
      'scl.book_quantity', 'scl.counted_quantity', 'scl.variance_quantity',
      'scl.variance_cost', 'scl.batch_number', 'scl.serial_numbers'
    );

  ctx.body = {
    success: true,
    data: {
      id: parseInt(id),
      station_id: stockCount.station_id,
      status: stockCount.status === 'open' ? 'in_progress' : stockCount.status,
      lines: updatedLines.map(l => ({
        id: l.id,
        item_id: l.item_id,
        item_sku: l.item_sku,
        item_name: l.item_name,
        book_quantity: l.book_quantity,
        counted_quantity: l.counted_quantity,
        variance_quantity: l.variance_quantity,
        variance_cost: l.variance_cost != null ? parseFloat(l.variance_cost) : null,
        batch_number: l.batch_number,
        serial_numbers: l.serial_numbers ? (typeof l.serial_numbers === 'string' ? JSON.parse(l.serial_numbers) : l.serial_numbers) : null
      }))
    }
  };
});

/**
 * POST /api/inventory/stock-counts/:id/finalize
 * Finalize: create adjustment movements for variances, update balances,
 * set finalized_at/finalized_by. Flag variance alerts (>2% qty or >$50 cost).
 */
router.post('/stock-counts/:id/finalize', async (ctx) => {
  const { id } = ctx.params;

  const stockCount = await db('stock_counts').where('id', id).first();
  if (!stockCount) throw createError(404, 'NOT_FOUND', 'Stock count not found.');

  if (['finalized', 'cancelled'].includes(stockCount.status)) {
    throw createError(409, 'CONFLICT', 'Stock count is already finalized or cancelled.');
  }

  if (ctx.state.stationScope && !ctx.state.stationScope.includes(stockCount.station_id)) {
    throw createError(403, 'FORBIDDEN', 'You do not have access to this station.');
  }

  const lines = await db('stock_count_lines').where('stock_count_id', id);
  const now = new Date();
  const adjustments = [];
  const varianceAlerts = [];

  await db.transaction(async (trx) => {
    for (const line of lines) {
      // variance_quantity is GENERATED as (counted_quantity - book_quantity)
      const variance = line.counted_quantity - line.book_quantity;
      if (variance === 0) continue;

      const item = await trx('inventory_items').where('id', line.item_id).first();
      if (!item || item.station_id !== stockCount.station_id) {
        continue; // Skip items that don't belong to this station (should not happen if PATCH was correct)
      }
      const direction = variance > 0 ? 'in' : 'out';

      // Create adjustment movement for the variance
      const [movementId] = await trx('inventory_movements').insert({
        item_id: line.item_id,
        station_id: stockCount.station_id,
        movement_type: 'adjustment',
        quantity: Math.abs(variance),
        direction,
        reference_number: `SC-${id}`,
        notes: `Stock count adjustment. Book: ${line.book_quantity}, Counted: ${line.counted_quantity}.`,
        performed_by: ctx.state.user.id,
        created_at: now
      });

      // Update balance to match counted quantity
      await trx('inventory_balances')
        .where('item_id', line.item_id)
        .where('station_id', stockCount.station_id)
        .update({
          on_hand: line.counted_quantity,
          last_counted_at: now,
          updated_at: now
        });

      adjustments.push({
        movement_id: movementId,
        item_id: line.item_id,
        variance,
        balance_before: line.book_quantity,
        balance_after: line.counted_quantity
      });

      // Flag variance alerts: >2% qty or >$50 cost
      if (line.book_quantity > 0) {
        const variancePct = Math.abs(variance) / line.book_quantity * 100;
        const varianceCostAbs = Math.abs(variance) * (item && item.unit_cost ? parseFloat(item.unit_cost) : 0);
        if (variancePct > 2 || varianceCostAbs > 50) {
          varianceAlerts.push({
            item_id: line.item_id,
            sku: item ? item.sku : null,
            variance,
            variance_pct: variancePct,
            variance_cost: varianceCostAbs
          });
        }
      }
    }

    // Finalize the stock count
    await trx('stock_counts').where('id', id).update({
      status: 'finalized',
      finalized_by: ctx.state.user.id,
      finalized_at: now
    });
  });

  await logAudit(
    ctx.state.user.id,
    ctx.state.user.username,
    'inventory.finalize_stock_count',
    'stock_counts',
    parseInt(id),
    {
      status: 'finalized',
      adjustment_count: adjustments.length,
      variance_alerts: varianceAlerts.length
    },
    ctx.ip
  );

  ctx.body = {
    success: true,
    data: {
      id: parseInt(id),
      status: 'finalized',
      finalized_at: now,
      finalized_by: ctx.state.user.id,
      adjustments,
      variance_alerts: varianceAlerts,
      total_variances: adjustments.length
    }
  };
});

// ─── ALERTS ──────────────────────────────────────────────────

/**
 * GET /api/inventory/alerts
 * Return combined low-stock alerts (on_hand < reorder_point) and any recent variance alerts.
 */
router.get('/alerts', async (ctx) => {
  const { station_id } = ctx.query;

  // Low-stock alerts: items where on_hand < reorder_point
  let lowStockQuery = db('inventory_items as ii')
    .join('inventory_balances as ib', function () {
      this.on('ii.id', '=', 'ib.item_id').andOn('ii.station_id', '=', 'ib.station_id');
    })
    .where('ii.is_active', true)
    .whereRaw('ib.on_hand < ii.reorder_point')
    .select(
      'ii.id as item_id',
      'ii.sku',
      'ii.name',
      'ii.station_id',
      'ii.reorder_point',
      'ib.on_hand'
    );

  if (ctx.state.stationScope) {
    lowStockQuery = lowStockQuery.whereIn('ii.station_id', ctx.state.stationScope);
  }
  if (station_id) {
    lowStockQuery = lowStockQuery.where('ii.station_id', station_id);
  }

  const lowStockItems = await lowStockQuery;

  // Recent variance alerts: stock count lines with significant variances from last 30 days
  let varianceQuery = db('stock_count_lines as scl')
    .join('stock_counts as sc', 'scl.stock_count_id', 'sc.id')
    .join('inventory_items as ii', 'scl.item_id', 'ii.id')
    .where('sc.status', 'finalized')
    .where('sc.finalized_at', '>=', db.raw("DATE_SUB(NOW(), INTERVAL 30 DAY)"))
    .whereRaw('scl.book_quantity > 0')
    .whereRaw('(ABS(scl.counted_quantity - scl.book_quantity) / scl.book_quantity * 100 > 2 OR ABS(scl.variance_cost) > 50)')
    .select(
      'scl.item_id',
      'ii.sku',
      'ii.name',
      'sc.station_id',
      'scl.book_quantity',
      'scl.counted_quantity',
      'scl.variance_quantity',
      'scl.variance_cost',
      'sc.finalized_at'
    );

  if (ctx.state.stationScope) {
    varianceQuery = varianceQuery.whereIn('sc.station_id', ctx.state.stationScope);
  }
  if (station_id) {
    varianceQuery = varianceQuery.where('sc.station_id', station_id);
  }

  const varianceAlerts = await varianceQuery.orderBy('sc.finalized_at', 'desc').limit(50);

  ctx.body = {
    success: true,
    data: {
      low_stock: lowStockItems.map(i => ({
        type: 'low_stock',
        item_id: i.item_id,
        sku: i.sku,
        name: i.name,
        station_id: i.station_id,
        on_hand: i.on_hand,
        reorder_point: i.reorder_point
      })),
      variance_alerts: varianceAlerts.map(v => ({
        type: 'variance',
        item_id: v.item_id,
        sku: v.sku,
        name: v.name,
        station_id: v.station_id,
        book_quantity: v.book_quantity,
        counted_quantity: v.counted_quantity,
        variance_quantity: v.variance_quantity,
        variance_cost: v.variance_cost != null ? parseFloat(v.variance_cost) : null,
        finalized_at: v.finalized_at
      }))
    }
  };
});

module.exports = router;
