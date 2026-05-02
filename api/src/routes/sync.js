const { query, getClient } = require('../db');

// ─── Batch Sync Endpoint ─────────────────────────────────────────────────────
// Replaces the per-item sync loop in the Flutter SyncCoordinator with a single
// atomic (best-effort) batch operation.

async function syncRoutes(fastify) {

  // POST /sync/batch
  // Body: {
  //   operations: [
  //     { table: 'food_entries', operation: 'create|update|delete', local_id: number, payload: object }
  //   ]
  // }
  fastify.post('/sync/batch', {
    preHandler: [fastify.ensureProfile],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['operations'],
        properties: {
          operations: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              required: ['table', 'operation', 'payload'],
              properties: {
                table: { type: 'string', enum: [
                  'food_entries', 'workout_entries', 'weight_entries',
                  'water_entries', 'favorites', 'custom_foods',
                  'workout_plans', 'collections', 'collection_items',
                  'fasts', 'recipes',
                ]},
                operation: { type: 'string', enum: ['create', 'update', 'delete'] },
                local_id: { type: 'integer' },
                payload: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { operations } = request.body;
    const results = [];
    const client = await getClient();

    try {
      await client.query('BEGIN');

      for (const op of operations) {
        try {
          const res = await _processOperation(client, request.userId, op);
          results.push({ ...res, local_id: op.local_id, success: true });
        } catch (err) {
          results.push({ local_id: op.local_id, success: false, error: err.message });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      return reply.code(500).send({ error: 'Batch sync failed', details: err.message });
    } finally {
      client.release();
    }

    const allSuccess = results.every(r => r.success);
    reply.code(allSuccess ? 200 : 207); // 207 Multi-Status for partial success
    return { results };
  });
}

async function _processOperation(client, userId, op) {
  const { table, operation, payload } = op;

  switch (table) {
    case 'food_entries':
      return await _syncFoodEntry(client, userId, operation, payload);
    case 'workout_entries':
      return await _syncWorkoutEntry(client, userId, operation, payload);
    case 'weight_entries':
      return await _syncWeightEntry(client, userId, operation, payload);
    case 'water_entries':
      return await _syncWaterEntry(client, userId, operation, payload);
    case 'favorites':
      return await _syncFavorite(client, userId, operation, payload);
    case 'custom_foods':
      return await _syncCustomFood(client, userId, operation, payload);
    case 'workout_plans':
      return await _syncWorkoutPlan(client, userId, operation, payload);
    case 'collections':
      return await _syncCollection(client, userId, operation, payload);
    case 'collection_items':
      return await _syncCollectionItem(client, userId, operation, payload);
    case 'fasts':
      return await _syncFast(client, userId, operation, payload);
    case 'recipes':
      return await _syncRecipe(client, userId, operation, payload);
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}

// ─── Per-table sync helpers ──────────────────────────────────────────────────

async function _syncFoodEntry(client, userId, operation, payload) {
  if (operation === 'create') {
    const res = await client.query(
      `INSERT INTO daily_foods (
        user_id, date, food_name, calories, carbs, fats, protein,
        fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
        calcium, iron, vitamin_a, vitamin_c, serving_size, quantity_multiplier,
        meal_type, entry_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *`,
      [
        userId, payload.date, payload.food_name, payload.calories || 0, payload.carbs || 0,
        payload.fats || 0, payload.protein || 0, payload.fiber || 0, payload.sugar || 0,
        payload.saturated_fat || 0, payload.sodium || 0, payload.cholesterol || 0,
        payload.potassium || 0, payload.calcium || 0, payload.iron || 0,
        payload.vitamin_a || 0, payload.vitamin_c || 0, payload.serving_size || '',
        payload.quantity_multiplier ?? 1.0, payload.meal_type || 'other', payload.entry_type || 'food',
      ]
    );
    return { server_id: res.rows[0].id, table: 'food_entries' };
  }

  if (operation === 'update') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for update');
    const res = await client.query(
      `UPDATE daily_foods SET
        food_name = $1, calories = $2, carbs = $3, fats = $4, protein = $5,
        fiber = $6, sugar = $7, saturated_fat = $8, sodium = $9,
        cholesterol = $10, potassium = $11, calcium = $12, iron = $13,
        vitamin_a = $14, vitamin_c = $15, serving_size = $16,
        quantity_multiplier = $17, meal_type = $18, entry_type = $19
      WHERE id = $20 AND user_id = $21
      RETURNING *`,
      [
        payload.food_name, payload.calories || 0, payload.carbs || 0,
        payload.fats || 0, payload.protein || 0, payload.fiber || 0,
        payload.sugar || 0, payload.saturated_fat || 0, payload.sodium || 0,
        payload.cholesterol || 0, payload.potassium || 0, payload.calcium || 0,
        payload.iron || 0, payload.vitamin_a || 0, payload.vitamin_c || 0,
        payload.serving_size || '', payload.quantity_multiplier ?? 1.0,
        payload.meal_type || 'other', payload.entry_type || 'food',
        serverId, userId,
      ]
    );
    if (res.rows.length === 0) throw new Error('Food entry not found');
    return { server_id: serverId, table: 'food_entries' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query(
      'DELETE FROM daily_foods WHERE id = $1 AND user_id = $2',
      [serverId, userId]
    );
    return { server_id: serverId, deleted: true, table: 'food_entries' };
  }
}

async function _syncWorkoutEntry(client, userId, operation, payload) {
  if (operation === 'create') {
    const res = await client.query(
      `INSERT INTO workout_logs (
        user_id, date, exercise_slug, exercise_name, category,
        primary_muscles, sets, reps, duration_minutes, notes,
        estimated_calories, intensity_level, weight_kg, client_session_id,
        zone_breakdown_sec
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (user_id, client_session_id) DO NOTHING
      RETURNING *`,
      [
        userId, payload.date, payload.exercise_slug, payload.exercise_name,
        payload.category, payload.primary_muscles || [], payload.sets || 0,
        payload.reps || 0, payload.duration_minutes || 0, payload.notes || '',
        payload.estimated_calories ?? null, payload.intensity_level ?? null,
        payload.weight_kg ?? null, payload.client_session_id || null,
        payload.zone_breakdown_sec ? JSON.stringify(payload.zone_breakdown_sec) : null,
      ]
    );
    return { server_id: res.rows[0]?.id, table: 'workout_entries' };
  }

  if (operation === 'update') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for update');
    const res = await client.query(
      `UPDATE workout_logs SET
        exercise_slug = $1, exercise_name = $2, category = $3,
        primary_muscles = $4, sets = $5, reps = $6, duration_minutes = $7,
        notes = $8, estimated_calories = $9, intensity_level = $10,
        weight_kg = $11, zone_breakdown_sec = $12
      WHERE id = $13 AND user_id = $14
      RETURNING *`,
      [
        payload.exercise_slug, payload.exercise_name, payload.category,
        payload.primary_muscles || [], payload.sets || 0, payload.reps || 0,
        payload.duration_minutes || 0, payload.notes || '',
        payload.estimated_calories ?? null, payload.intensity_level ?? null,
        payload.weight_kg ?? null,
        payload.zone_breakdown_sec ? JSON.stringify(payload.zone_breakdown_sec) : null,
        serverId, userId,
      ]
    );
    if (res.rows.length === 0) throw new Error('Workout entry not found');
    return { server_id: serverId, table: 'workout_entries' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query(
      'DELETE FROM workout_logs WHERE id = $1 AND user_id = $2',
      [serverId, userId]
    );
    return { server_id: serverId, deleted: true, table: 'workout_entries' };
  }
}

async function _syncWeightEntry(client, userId, operation, payload) {
  if (operation === 'create') {
    const res = await client.query(
      `INSERT INTO weight_logs (user_id, date, weight, unit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, date)
       DO UPDATE SET weight = $3, unit = $4
       RETURNING *`,
      [userId, payload.date, payload.weight, payload.unit || 'kg']
    );
    return { server_id: res.rows[0].id, table: 'weight_entries' };
  }

  if (operation === 'delete') {
    await client.query(
      'DELETE FROM weight_logs WHERE user_id = $1 AND date = $2',
      [userId, payload.date]
    );
    return { date: payload.date, deleted: true, table: 'weight_entries' };
  }
}

async function _syncWaterEntry(client, userId, operation, payload) {
  if (operation === 'create' || operation === 'update') {
    const res = await client.query(
      `INSERT INTO water_logs (user_id, date, amount_ml)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date)
       DO UPDATE SET amount_ml = water_logs.amount_ml + $3
       RETURNING *`,
      [userId, payload.date, payload.amount_ml || 0]
    );
    return { server_id: res.rows[0].id, table: 'water_entries' };
  }

  if (operation === 'delete') {
    await client.query(
      'DELETE FROM water_logs WHERE user_id = $1 AND date = $2',
      [userId, payload.date]
    );
    return { date: payload.date, deleted: true, table: 'water_entries' };
  }
}

async function _syncFavorite(client, userId, operation, payload) {
  if (operation === 'create') {
    // Find or create Favorites collection
    let favRes = await client.query(
      `SELECT id FROM food_collections
       WHERE user_id = $1 AND name = 'Favorites' AND is_system = TRUE`,
      [userId]
    );
    let favId;
    if (favRes.rows.length === 0) {
      const insertRes = await client.query(
        `INSERT INTO food_collections (user_id, name, icon, is_system, position)
         VALUES ($1, 'Favorites', 'heart', TRUE, 0)
         RETURNING id`,
        [userId]
      );
      favId = insertRes.rows[0].id;
    } else {
      favId = favRes.rows[0].id;
    }

    const posRes = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM food_collection_items WHERE collection_id = $1',
      [favId]
    );
    const position = posRes.rows[0].next_pos;

    const res = await client.query(
      `INSERT INTO food_collection_items (
        collection_id, user_id, food_source, food_source_id, food_name,
        brands, image_url, calories, protein, carbs, fat,
        nutriments, serving_quantity, serving_size, ingredients_text, position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (collection_id, food_source, food_source_id) DO NOTHING
      RETURNING *`,
      [
        favId, userId, payload.food_source, payload.food_source_id, payload.food_name,
        payload.brands || null, payload.image_url || null,
        payload.calories || 0, payload.protein || 0, payload.carbs || 0, payload.fat || 0,
        payload.nutriments ? JSON.stringify(payload.nutriments) : null,
        payload.serving_quantity || null, payload.serving_size || null,
        payload.ingredients_text || null, position,
      ]
    );
    return { server_id: res.rows[0]?.id, table: 'favorites' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query(
      `DELETE FROM food_collection_items ci
       USING food_collections c
       WHERE ci.id = $1 AND ci.collection_id = c.id
         AND c.user_id = $2 AND c.name = 'Favorites' AND c.is_system = TRUE`,
      [serverId, userId]
    );
    return { server_id: serverId, deleted: true, table: 'favorites' };
  }
}

async function _syncCustomFood(client, userId, operation, payload) {
  if (operation === 'create') {
    const res = await client.query(
      `INSERT INTO custom_foods (
        user_id, barcode, product_name, brands, serving_size,
        calories, protein, fat, carbs, fiber, sugar, saturated_fat,
        sodium, cholesterol, potassium, calcium, iron, vitamin_a, vitamin_c,
        image_url, is_public, food_category, serving_count, serving_unit
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *`,
      [
        userId, payload.barcode || null, payload.product_name, payload.brands || '',
        payload.serving_size || '', payload.calories || 0, payload.protein || 0,
        payload.fat || 0, payload.carbs || 0, payload.fiber || 0, payload.sugar || 0,
        payload.saturated_fat || 0, payload.sodium || 0, payload.cholesterol || 0,
        payload.potassium || 0, payload.calcium || 0, payload.iron || 0,
        payload.vitamin_a || 0, payload.vitamin_c || 0, payload.image_url || '',
        payload.is_public || false, payload.food_category || 'food',
        payload.serving_count || 1, payload.serving_unit || 'g',
      ]
    );
    return { server_id: res.rows[0].id, table: 'custom_foods' };
  }

  if (operation === 'update') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for update');
    const setClauses = [];
    const values = [];
    let p = 1;
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'server_id') continue;
      setClauses.push(`${key} = $${p++}`);
      values.push(value);
    }
    if (setClauses.length === 0) throw new Error('No fields to update');
    values.push(serverId, userId);
    const res = await client.query(
      `UPDATE custom_foods SET ${setClauses.join(', ')} WHERE id = $${p} AND user_id = $${p + 1} RETURNING *`,
      values
    );
    if (res.rows.length === 0) throw new Error('Custom food not found');
    return { server_id: serverId, table: 'custom_foods' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query(
      'DELETE FROM custom_foods WHERE id = $1 AND user_id = $2',
      [serverId, userId]
    );
    return { server_id: serverId, deleted: true, table: 'custom_foods' };
  }
}

async function _syncWorkoutPlan(client, userId, operation, payload) {
  if (operation === 'create') {
    const planRes = await client.query(
      'INSERT INTO workout_plans (user_id, name, description, scheduled_days) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, payload.name, payload.description || '', payload.scheduled_days || []]
    );
    const plan = planRes.rows[0];

    if (payload.exercises && payload.exercises.length > 0) {
      for (let i = 0; i < payload.exercises.length; i++) {
        const e = payload.exercises[i];
        await client.query(
          `INSERT INTO workout_plan_exercises (
            plan_id, exercise_slug, exercise_name, category,
            primary_muscles, sets, reps, duration_minutes,
            rest_seconds, notes, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            plan.id, e.exercise_slug, e.exercise_name, e.category,
            e.primary_muscles || [], e.sets || 0, e.reps || 0,
            e.duration_minutes || 0, e.rest_seconds || 0,
            e.notes || '', e.sort_order ?? i,
          ]
        );
      }
    }
    return { server_id: plan.id, table: 'workout_plans' };
  }

  if (operation === 'update') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for update');
    await client.query(
      'UPDATE workout_plans SET name = $1, description = $2, scheduled_days = $3 WHERE id = $4 AND user_id = $5',
      [payload.name, payload.description || '', payload.scheduled_days || [], serverId, userId]
    );

    if (payload.exercises) {
      await client.query('DELETE FROM workout_plan_exercises WHERE plan_id = $1', [serverId]);
      for (let i = 0; i < payload.exercises.length; i++) {
        const e = payload.exercises[i];
        await client.query(
          `INSERT INTO workout_plan_exercises (
            plan_id, exercise_slug, exercise_name, category,
            primary_muscles, sets, reps, duration_minutes,
            rest_seconds, notes, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            serverId, e.exercise_slug, e.exercise_name, e.category,
            e.primary_muscles || [], e.sets || 0, e.reps || 0,
            e.duration_minutes || 0, e.rest_seconds || 0,
            e.notes || '', e.sort_order ?? i,
          ]
        );
      }
    }
    return { server_id: serverId, table: 'workout_plans' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query('DELETE FROM workout_plan_exercises WHERE plan_id = $1', [serverId]);
    await client.query('DELETE FROM workout_plans WHERE id = $1 AND user_id = $2', [serverId, userId]);
    return { server_id: serverId, deleted: true, table: 'workout_plans' };
  }
}

async function _syncCollection(client, userId, operation, payload) {
  if (operation === 'create') {
    const posRes = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM food_collections WHERE user_id = $1',
      [userId]
    );
    const position = posRes.rows[0].next_pos;

    const res = await client.query(
      `INSERT INTO food_collections (user_id, name, icon, position)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, payload.name, payload.icon || null, position]
    );
    return { server_id: res.rows[0].id, table: 'collections' };
  }

  if (operation === 'update') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for update');
    await client.query(
      'UPDATE food_collections SET name = $1, icon = $2 WHERE id = $3 AND user_id = $4',
      [payload.name, payload.icon, serverId, userId]
    );
    return { server_id: serverId, table: 'collections' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query('DELETE FROM food_collection_items WHERE collection_id = $1', [serverId]);
    await client.query('DELETE FROM food_collections WHERE id = $1 AND user_id = $2', [serverId, userId]);
    return { server_id: serverId, deleted: true, table: 'collections' };
  }
}

async function _syncCollectionItem(client, userId, operation, payload) {
  if (operation === 'create') {
    const collectionId = payload.collection_id;
    if (!collectionId) throw new Error('collection_id required');

    const posRes = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM food_collection_items WHERE collection_id = $1',
      [collectionId]
    );
    const position = posRes.rows[0].next_pos;

    const res = await client.query(
      `INSERT INTO food_collection_items (
        collection_id, user_id, food_source, food_source_id, food_name,
        brands, image_url, calories, protein, carbs, fat,
        nutriments, serving_quantity, serving_size, ingredients_text, position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        collectionId, userId, payload.food_source, payload.food_source_id, payload.food_name,
        payload.brands || null, payload.image_url || null,
        payload.calories || 0, payload.protein || 0, payload.carbs || 0, payload.fat || 0,
        payload.nutriments ? JSON.stringify(payload.nutriments) : null,
        payload.serving_quantity || null, payload.serving_size || null,
        payload.ingredients_text || null, position,
      ]
    );
    return { server_id: res.rows[0].id, table: 'collection_items' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query(
      'DELETE FROM food_collection_items WHERE id = $1 AND user_id = $2',
      [serverId, userId]
    );
    return { server_id: serverId, deleted: true, table: 'collection_items' };
  }
}

async function _syncFast(client, userId, operation, payload) {
  if (operation === 'create') {
    const res = await client.query(
      `INSERT INTO fasts (user_id, started_at, planned_duration_hours)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, payload.started_at, payload.planned_duration_hours]
    );
    return { server_id: res.rows[0].id, table: 'fasts' };
  }

  if (operation === 'update') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for update');

    let goalMet = payload.goal_met;
    if (payload.ended_at !== undefined && goalMet === undefined) {
      const existingRes = await client.query(
        'SELECT started_at, planned_duration_hours FROM fasts WHERE id = $1 AND user_id = $2',
        [serverId, userId]
      );
      if (existingRes.rows.length > 0) {
        const fast = existingRes.rows[0];
        const started = new Date(fast.started_at);
        const ended = new Date(payload.ended_at);
        const elapsedMinutes = (ended - started) / (1000 * 60);
        goalMet = elapsedMinutes >= parseInt(fast.planned_duration_hours) * 60;
      }
    }

    const updates = [];
    const values = [];
    let p = 1;
    if (payload.ended_at !== undefined) { updates.push(`ended_at = $${p++}`); values.push(payload.ended_at); }
    if (goalMet !== undefined) { updates.push(`goal_met = $${p++}`); values.push(goalMet); }
    if (updates.length === 0) throw new Error('No fields to update');
    values.push(serverId, userId);
    await client.query(
      `UPDATE fasts SET ${updates.join(', ')} WHERE id = $${p} AND user_id = $${p + 1}`,
      values
    );
    return { server_id: serverId, table: 'fasts' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query('DELETE FROM fasts WHERE id = $1 AND user_id = $2', [serverId, userId]);
    return { server_id: serverId, deleted: true, table: 'fasts' };
  }
}

async function _syncRecipe(client, userId, operation, payload) {
  if (operation === 'create') {
    const ingredients = payload.ingredients || [];
    const totalGrams = ingredients.reduce((s, i) => s + (i.quantity_g || 0), 0);
    const adj = (payload.cooking_adjustment_pct || 100) / 100.0;

    const totals = ingredients.reduce((acc, ing) => ({
      calories: acc.calories + (ing.calories || 0),
      protein: acc.protein + (ing.protein || 0),
      carbs: acc.carbs + (ing.carbs || 0),
      fat: acc.fat + (ing.fat || 0),
      fiber: acc.fiber + (ing.fiber || 0),
      sugar: acc.sugar + (ing.sugar || 0),
      saturated_fat: acc.saturated_fat + (ing.saturated_fat || 0),
      sodium: acc.sodium + (ing.sodium || 0),
      cholesterol: acc.cholesterol + (ing.cholesterol || 0),
      potassium: acc.potassium + (ing.potassium || 0),
      calcium: acc.calcium + (ing.calcium || 0),
      iron: acc.iron + (ing.iron || 0),
      vitamin_a: acc.vitamin_a + (ing.vitamin_a || 0),
      vitamin_c: acc.vitamin_c + (ing.vitamin_c || 0),
    }), { calories:0, protein:0, carbs:0, fat:0, fiber:0, sugar:0, saturated_fat:0, sodium:0, cholesterol:0, potassium:0, calcium:0, iron:0, vitamin_a:0, vitamin_c:0 });

    const recipeRes = await client.query(
      `INSERT INTO recipes (
        user_id, name, description, steps, prep_time_minutes,
        cook_time_minutes, servings, serving_quantity, serving_size,
        calories, protein, carbs, fat, fiber, sugar,
        saturated_fat, sodium, cholesterol, potassium,
        calcium, iron, vitamin_a, vitamin_c,
        cooking_adjustment_pct
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *`,
      [
        userId, payload.name, payload.description || '', payload.steps || '',
        payload.prep_time_minutes || 0, payload.cook_time_minutes || 0,
        payload.servings || 1, totalGrams, `1 serving (${totalGrams}g)`,
        totals.calories * adj, totals.protein * adj, totals.carbs * adj, totals.fat * adj,
        totals.fiber * adj, totals.sugar * adj, totals.saturated_fat * adj,
        totals.sodium * adj, totals.cholesterol * adj, totals.potassium * adj,
        totals.calcium * adj, totals.iron * adj, totals.vitamin_a * adj, totals.vitamin_c * adj,
        payload.cooking_adjustment_pct || 100,
      ]
    );
    const recipe = recipeRes.rows[0];

    for (const ing of ingredients) {
      await client.query(
        `INSERT INTO recipe_ingredients (
          recipe_id, food_source, food_source_id, food_name,
          quantity_g, calories, protein, carbs, fat, fiber, sugar,
          saturated_fat, sodium, cholesterol, potassium,
          calcium, iron, vitamin_a, vitamin_c
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          recipe.id, ing.food_source, ing.food_source_id, ing.food_name,
          ing.quantity_g, ing.calories || 0, ing.protein || 0,
          ing.carbs || 0, ing.fat || 0, ing.fiber || 0, ing.sugar || 0,
          ing.saturated_fat || 0, ing.sodium || 0, ing.cholesterol || 0,
          ing.potassium || 0, ing.calcium || 0, ing.iron || 0,
          ing.vitamin_a || 0, ing.vitamin_c || 0,
        ]
      );
    }
    return { server_id: recipe.id, table: 'recipes' };
  }

  if (operation === 'delete') {
    const serverId = payload.server_id;
    if (!serverId) throw new Error('server_id required for delete');
    await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [serverId]);
    await client.query('DELETE FROM recipes WHERE id = $1 AND user_id = $2', [serverId, userId]);
    return { server_id: serverId, deleted: true, table: 'recipes' };
  }
}

module.exports = syncRoutes;
