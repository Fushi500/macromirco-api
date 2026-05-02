const { query, getClient } = require('../db');

// ─── Nutrition math helpers (moved from Flutter) ─────────────────────────────

function calculateBmr(weightKg, heightCm, age, gender) {
  if (gender === 'male') {
    return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  }
  return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
}

function activityMultiplier(level) {
  const map = {
    'sedentary': 1.2,
    'lightly sedentary': 1.3,
    'lightly active': 1.375,
    'moderately light': 1.465,
    'moderately active': 1.55,
    'active': 1.65,
    'very active': 1.725,
    'extremely active': 1.9,
  };
  return map[level?.toLowerCase()] || 1.2;
}

function goalRateKgPerWeek(rate) {
  if (rate === 'slow') return 0.25;
  if (rate === 'fast') return 0.75;
  return 0.5; // moderate default
}

function calculateTdee(bmr, activityLevel) {
  return bmr * activityMultiplier(activityLevel);
}

function calculateTargetCalories(tdee, goal, goalRateKcal) {
  const goalNum = parseInt(goal, 10);
  if (goalNum === 3) return tdee; // maintain
  if (goalNum === 1) return tdee + goalRateKcal; // gain
  return tdee - goalRateKcal; // lose
}

// ─── Measured TDEE estimator ─────────────────────────────────────────────────

async function estimateMeasuredTdee(userId, profile, windowDays = 14) {
  const minWeightEntries = 5;
  const minCoverageDays = 7;
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const [weightRes, foodRes] = await Promise.all([
    query(
      `SELECT date, weight FROM weight_logs
       WHERE user_id = $1 AND date >= $2 ORDER BY date`,
      [userId, cutoffStr]
    ),
    query(
      `SELECT date, SUM(calories) as calories FROM daily_foods
       WHERE user_id = $1 AND date >= $2 GROUP BY date HAVING SUM(calories) > 300`,
      [userId, cutoffStr]
    ),
  ]);

  const weights = weightRes.rows;
  const foodDays = foodRes.rows;

  if (weights.length < 2) {
    return { confidence: 'low', reason: 'insufficient_weight_data', windowDays, coverageDays: 0 };
  }
  if (foodDays.length === 0) {
    return { confidence: 'low', reason: 'insufficient_food_data', windowDays, coverageDays: 0 };
  }

  // EMA weight trend (alpha = 0.1)
  let ema = parseFloat(weights[0].weight);
  for (let i = 1; i < weights.length; i++) {
    ema = 0.1 * parseFloat(weights[i].weight) + 0.9 * ema;
  }

  const startEma = _emaUpTo(weights, Math.floor(weights.length / 2));
  const trendChange = ema - startEma;

  const avgIntake = foodDays.reduce((s, d) => s + parseFloat(d.calories), 0) / foodDays.length;
  const kcalFromWeightChange = trendChange * 7700;
  const rawTdee = avgIntake - (kcalFromWeightChange / windowDays);

  // Coverage: days with both weight and food log
  const weightDates = new Set(weights.map(w => w.date));
  const foodDates = new Set(foodDays.map(f => f.date));
  let coverageDays = 0;
  for (const d of weightDates) {
    if (foodDates.has(d)) coverageDays++;
  }

  const bmr = calculateBmr(
    profile.weight > 0 ? parseFloat(profile.weight) : 70,
    profile.height > 0 ? parseFloat(profile.height) : 170,
    profile.age > 0 ? parseInt(profile.age) : 30,
    profile.gender
  );
  const minTdee = bmr * 1.1;
  const maxTdee = bmr * 2.2;
  const clamped = Math.max(minTdee, Math.min(maxTdee, rawTdee));
  const wasClamped = rawTdee < minTdee || rawTdee > maxTdee;

  // Critical: require a minimum % of window days to actually have food logs.
  // Days with no food entries must NOT be treated as "0 calorie days".
  const loggedDayRatio = foodDates.size / windowDays;
  const maxFoodGapDays = _maxGapDays(Array.from(foodDates).sort());

  let confidence = 'high';
  let reason = null;

  if (weights.length < minWeightEntries || coverageDays < minCoverageDays) {
    confidence = 'low';
    reason = coverageDays < minCoverageDays ? 'insufficient_coverage' : 'insufficient_weight_entries';
  } else if (loggedDayRatio < 0.4 || maxFoodGapDays > 3) {
    // User didn't log food on enough days or had a long gap.
    // Don't treat missing days as "0 calories" — block instead.
    confidence = 'low';
    reason = loggedDayRatio < 0.4 ? 'insufficient_logged_days' : 'long_logging_gap';
  } else if (loggedDayRatio < 0.6 || coverageDays < 11 || wasClamped) {
    confidence = 'medium';
    if (wasClamped) reason = 'estimate_clamped';
    else if (loggedDayRatio < 0.6) reason = 'low_logged_day_ratio';
  }

  return {
    value: clamped,
    confidence,
    reason,
    windowDays,
    coverageDays,
    avgIntake,
    trendWeightChangeKg: trendChange,
  };
}

// Returns the largest gap (in days) between consecutive logged dates.
function _maxGapDays(sortedDates) {
  if (sortedDates.length < 2) return 0;
  let maxGap = 0;
  for (let i = 1; i < sortedDates.length; i++) {
    const d1 = new Date(sortedDates[i - 1]);
    const d2 = new Date(sortedDates[i]);
    const gap = (d2 - d1) / (1000 * 60 * 60 * 24);
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

function _emaUpTo(weights, count) {
  if (count <= 0 || weights.length === 0) return parseFloat(weights[0].weight);
  let ema = parseFloat(weights[0].weight);
  const end = Math.min(count, weights.length);
  for (let i = 1; i < end; i++) {
    ema = 0.1 * parseFloat(weights[i].weight) + 0.9 * ema;
  }
  return ema;
}

// ─── Adaptive target suggestion ──────────────────────────────────────────────

async function computeTargetSuggestion(userId, profile, measured) {
  const current = parseFloat(profile.target_calories) > 0
    ? parseFloat(profile.target_calories)
    : parseFloat(profile.tdee) || 0;

  if (!measured.value || measured.confidence === 'low') {
    return {
      currentTarget: current,
      suggestedTarget: current,
      deltaKcal: 0,
      isDue: false,
      reason: 'Not enough quality data yet — keep logging.',
      blocked: true,
    };
  }

  const rateKgPerWeek = goalRateKgPerWeek(profile.goal_rate);
  const dailyKcal = (rateKgPerWeek * 7700) / 7;
  const goalNum = parseInt(profile.goal, 10);

  let suggested;
  let reason;
  if (goalNum === 2) {
    suggested = measured.value - dailyKcal;
    reason = `Based on your measured TDEE of ${Math.round(measured.value)} kcal, a deficit of ${Math.round(dailyKcal)} kcal/day targets ${rateKgPerWeek} kg/week loss.`;
  } else if (goalNum === 1) {
    suggested = measured.value + dailyKcal;
    reason = `Based on your measured TDEE of ${Math.round(measured.value)} kcal, a surplus of ${Math.round(dailyKcal)} kcal/day targets ${rateKgPerWeek} kg/week gain.`;
  } else {
    suggested = measured.value;
    reason = `Your measured TDEE is ${Math.round(measured.value)} kcal — set to maintenance.`;
  }

  // Guardrail: BMR floor
  const bmr = calculateBmr(
    profile.weight > 0 ? parseFloat(profile.weight) : 70,
    profile.height > 0 ? parseFloat(profile.height) : 170,
    profile.age > 0 ? parseInt(profile.age) : 30,
    profile.gender
  );
  const floor = bmr * 1.1;
  if (suggested < floor) {
    suggested = floor;
    reason = `Adjustment stopped at safety floor (BMR × 1.1). ${reason}`;
  }

  // Guardrail: max ±150 kcal/week delta
  const maxDelta = 150;
  const delta = suggested - current;
  if (Math.abs(delta) > maxDelta) {
    suggested = current + (delta > 0 ? maxDelta : -maxDelta);
    reason += ` (Capped at ±${maxDelta} kcal this week.)`;
  }

  // Guardrail: consecutive decrease within 14 days for weight loss
  if (goalNum === 2) {
    const historyRes = await query(
      `SELECT new_target, applied_at FROM adaptive_target_history
       WHERE user_id = $1 ORDER BY applied_at DESC LIMIT 1`,
      [userId]
    );
    if (historyRes.rows.length > 0) {
      const last = historyRes.rows[0];
      const daysSince = Math.floor((new Date() - new Date(last.applied_at)) / (1000 * 60 * 60 * 24));
      if (daysSince <= 14 && parseFloat(last.new_target) < parseFloat(last.old_target) && suggested < current) {
        suggested = current;
        reason = `Holding steady this week — you adjusted ${daysSince} days ago. Let the new target play out.`;
      }
    }
  }

  // Check if review is due (last review >= 7 days ago)
  const lastReviewRes = await query(
    `SELECT applied_at FROM adaptive_target_history
     WHERE user_id = $1 ORDER BY applied_at DESC LIMIT 1`,
    [userId]
  );
  let isDue = true;
  if (lastReviewRes.rows.length > 0) {
    const daysSince = Math.floor((new Date() - new Date(lastReviewRes.rows[0].applied_at)) / (1000 * 60 * 60 * 24));
    isDue = daysSince >= 7;
  }

  return {
    currentTarget: current,
    suggestedTarget: suggested,
    deltaKcal: suggested - current,
    isDue,
    reason,
    blocked: false,
  };
}

async function profileRoutes(fastify) {

  // GET /profile — get own profile
  fastify.get('/profile', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    return result.rows[0];
  });

  // GET /profile/targets — authoritative BMR, TDEE, measured TDEE, suggestion
  fastify.get('/profile/targets', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const profileRes = await query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );
    if (profileRes.rows.length === 0) {
      return { bmr: 0, tdee: 0, target_calories: 0, measured_tdee: null, suggestion: null };
    }

    const p = profileRes.rows[0];
    const weightKg = parseFloat(p.weight) > 0 ? parseFloat(p.weight) : 70;
    const heightCm = parseFloat(p.height) > 0 ? parseFloat(p.height) : 170;
    const age = parseInt(p.age) > 0 ? parseInt(p.age) : 30;
    const bmr = calculateBmr(weightKg, heightCm, age, p.gender);
    const tdee = calculateTdee(bmr, p.activity_level);
    const goalRate = goalRateKgPerWeek(p.goal_rate);
    const goalRateKcal = (goalRate * 7700) / 7;
    const baseTarget = calculateTargetCalories(tdee, p.goal, goalRateKcal);

    const measured = await estimateMeasuredTdee(request.userId, p, 14);
    const suggestion = await computeTargetSuggestion(request.userId, p, measured);

    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      base_target: Math.round(baseTarget),
      target_calories: parseFloat(p.target_calories) > 0 ? parseFloat(p.target_calories) : Math.round(baseTarget),
      measured_tdee: measured.value ? Math.round(measured.value) : null,
      measured_confidence: measured.confidence,
      measured_reason: measured.reason,
      measured_coverage_days: measured.coverageDays,
      suggestion,
    };
  });

  // POST /profile/targets/apply — apply adaptive target, store history server-side
  fastify.post('/profile/targets/apply', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['new_target'],
        properties: {
          new_target: { type: 'number' },
          measured_tdee: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { new_target, measured_tdee, reason } = request.body;

    const profileRes = await query(
      'SELECT target_calories, tdee FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );
    const oldTarget = parseFloat(profileRes.rows[0]?.target_calories) > 0
      ? parseFloat(profileRes.rows[0].target_calories)
      : parseFloat(profileRes.rows[0]?.tdee) || 0;

    // Update profile
    await query(
      'UPDATE user_profiles SET target_calories = $1 WHERE user_id = $2',
      [new_target, request.userId]
    );

    // Record history
    await query(
      `INSERT INTO adaptive_target_history (user_id, old_target, new_target, measured_tdee, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [request.userId, oldTarget, new_target, measured_tdee || null, reason || null]
    );

    return { applied: true, old_target: oldTarget, new_target };
  });

  // GET /profile/daily-targets?date=YYYY-MM-DD
  fastify.get('/profile/daily-targets', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request) => {
    const dateStr = request.query.date || new Date().toISOString().split('T')[0];
    const profileRes = await query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );
    if (profileRes.rows.length === 0) {
      return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    }

    const p = profileRes.rows[0];
    const weightKg = parseFloat(p.weight) > 0 ? parseFloat(p.weight) : 70;
    const heightCm = parseFloat(p.height) > 0 ? parseFloat(p.height) : 170;
    const age = parseInt(p.age) > 0 ? parseInt(p.age) : 30;
    const bmr = calculateBmr(weightKg, heightCm, age, p.gender);
    const tdee = calculateTdee(bmr, p.activity_level);
    const goalRate = goalRateKgPerWeek(p.goal_rate);
    const goalRateKcal = (goalRate * 7700) / 7;
    let calories = calculateTargetCalories(tdee, p.goal, goalRateKcal);

    // Default macros: 30% protein, 35% carbs, 35% fat
    let protein = (calories * 0.30) / 4;
    let carbs = (calories * 0.35) / 4;
    let fat = (calories * 0.35) / 9;

    // Apply training split for the weekday
    const date = new Date(dateStr);
    const weekday = date.getDay() === 0 ? 7 : date.getDay(); // 1=Mon ... 7=Sun
    const splitRes = await query(
      `SELECT calorie_delta, carb_delta_g, fat_delta_g, protein_delta_g
       FROM training_split WHERE user_id = $1 AND weekday = $2`,
      [request.userId, weekday]
    );

    if (splitRes.rows.length > 0) {
      const s = splitRes.rows[0];
      calories += parseInt(s.calorie_delta);
      protein += parseFloat(s.protein_delta_g);
      carbs += parseFloat(s.carb_delta_g);
      fat += parseFloat(s.fat_delta_g);
    }

    return {
      date: dateStr,
      weekday,
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
    };
  });

  // POST /profile — create or update profile
  fastify.post('/profile', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 200 },
          age: { type: 'integer', minimum: 1, maximum: 150 },
          gender: { type: 'string', enum: ['male', 'female', 'other'] },
          weight: { type: 'number', minimum: 0 },
          height: { type: 'number', minimum: 0 },
          weight_unit: { type: 'string', enum: ['kg', 'lbs'] },
          unit_system: { type: 'string', enum: ['metric', 'imperial'] },
          activity_level: { type: 'string', maxLength: 50 },
          goal: { type: 'string', maxLength: 100 },
          goal_rate: { type: 'string', maxLength: 50 },
          tdee: { type: 'number' },
          target_calories: { type: 'number' },
          water_goal_ml: { type: 'integer', minimum: 0 },
          nutrient_prefs: {
            type: 'object',
            properties: {
              visible_nutrients: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['visible_nutrients'],
          },
        },
      },
    },
  }, async (request, reply) => {
    const fields = request.body;

    if (fields.user_id !== undefined) {
      return reply.code(400).send({ error: 'user_id must not be sent in request body' });
    }

    const setClauses = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${paramCount}`);
      values.push(key === 'nutrient_prefs' ? JSON.stringify(value) : value);
      paramCount++;
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    values.push(request.userId);
    const result = await query(
      `UPDATE user_profiles SET ${setClauses.join(', ')} WHERE user_id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0];
  });

  // DELETE /account — delete all user app data (no auth.users cleanup)
  fastify.delete('/account', {
    preHandler: [fastify.requireAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.userId;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Delete in dependency order to avoid FK violations
      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM recipes WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM workout_plan_exercises WHERE plan_id IN (SELECT id FROM workout_plans WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM workout_plans WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM food_collection_items WHERE collection_id IN (SELECT id FROM food_collections WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM food_collections WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM daily_foods WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM workout_logs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM weight_logs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM water_logs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM custom_foods WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM custom_exercises WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM measurements WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM training_split WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM daily_health_sync WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM food_recognition_feedback WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM adaptive_target_history WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM fasts WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);

      await client.query('COMMIT');
      reply.code(204).send();
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /user/meal-periods
  fastify.get('/user/meal-periods', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'SELECT meal_periods FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return { meal_periods: result.rows[0].meal_periods };
  });

  // PUT /user/meal-periods
  fastify.put('/user/meal-periods', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['meal_periods'],
        properties: {
          meal_periods: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: { type: 'string', maxLength: 50 },
                name: { type: 'string', maxLength: 100 },
                start: { type: ['string', 'null'], maxLength: 10 },
                end: { type: ['string', 'null'], maxLength: 10 },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { meal_periods } = request.body;
    const result = await query(
      'UPDATE user_profiles SET meal_periods = $1 WHERE user_id = $2 RETURNING meal_periods',
      [JSON.stringify(meal_periods), request.userId]
    );
    return { meal_periods: result.rows[0].meal_periods };
  });
  // GET /profile/training-split
  fastify.get('/profile/training-split', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `SELECT weekday, label, calorie_delta, carb_delta_g, fat_delta_g, protein_delta_g
       FROM training_split
       WHERE user_id = $1
       ORDER BY weekday`,
      [request.userId]
    );
    return result.rows.map(r => ({
      weekday: r.weekday,
      label: r.label,
      calorie_delta: r.calorie_delta,
      carb_delta_g: parseFloat(r.carb_delta_g),
      fat_delta_g: parseFloat(r.fat_delta_g),
      protein_delta_g: parseFloat(r.protein_delta_g),
    }));
  });

  // PUT /profile/training-split
  fastify.put('/profile/training-split', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['split'],
        properties: {
          split: {
            type: 'array',
            items: {
              type: 'object',
              required: ['weekday', 'label', 'calorie_delta', 'carb_delta_g', 'fat_delta_g', 'protein_delta_g'],
              properties: {
                weekday: { type: 'integer', minimum: 1, maximum: 7 },
                label: { type: 'string', minLength: 1, maxLength: 100 },
                calorie_delta: { type: 'integer' },
                carb_delta_g: { type: 'number' },
                fat_delta_g: { type: 'number' },
                protein_delta_g: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { split } = request.body;

    // Delete existing rows, then insert new ones in a transaction
    await query('DELETE FROM training_split WHERE user_id = $1', [request.userId]);

    if (split.length > 0) {
      const valuePlaceholders = split.map((_, i) => {
        const base = i * 7;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      }).join(',');
      const values = split.flatMap(d => [
        request.userId, d.weekday, d.label,
        d.calorie_delta, d.carb_delta_g, d.fat_delta_g, d.protein_delta_g,
      ]);
      await query(
        `INSERT INTO training_split (user_id, weekday, label, calorie_delta, carb_delta_g, fat_delta_g, protein_delta_g)
         VALUES ${valuePlaceholders}`,
        values
      );
    }

    return { saved: true };
  });
}

module.exports = profileRoutes;
