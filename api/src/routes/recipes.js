const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { query, getClient } = require('../db');

const UPLOAD_DIR = '/app/static/uploads/recipes';
const UPLOAD_URL_PREFIX = 'https://api.macromirco.com/images/uploads/recipes';

// Helper: compute full totals from ingredients array
function computeRecipeTotals(ingredients) {
  const totals = {
    calories: 0, protein: 0, carbs: 0, fat: 0,
    fiber: 0, sugar: 0, saturated_fat: 0, sodium: 0,
    cholesterol: 0, potassium: 0, calcium: 0, iron: 0,
    vitamin_a: 0, vitamin_c: 0,
  };
  for (const ing of ingredients) {
    totals.calories += ing.calories || 0;
    totals.protein += ing.protein || 0;
    totals.carbs += ing.carbs || 0;
    totals.fat += ing.fat || 0;
    totals.fiber += ing.fiber || 0;
    totals.sugar += ing.sugar || 0;
    totals.saturated_fat += ing.saturated_fat || 0;
    totals.sodium += ing.sodium || 0;
    totals.cholesterol += ing.cholesterol || 0;
    totals.potassium += ing.potassium || 0;
    totals.calcium += ing.calcium || 0;
    totals.iron += ing.iron || 0;
    totals.vitamin_a += ing.vitamin_a || 0;
    totals.vitamin_c += ing.vitamin_c || 0;
  }
  return totals;
}

async function recipeRoutes(fastify) {

  // GET /recipes — list user's recipes (supports ?q= & ?limit=)
  fastify.get('/recipes', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, limit } = request.query;
    let result;
    if (q && q.trim()) {
      result = await query(
        `SELECT id, user_id, name, description, steps,
                prep_time_minutes, cook_time_minutes, servings,
                serving_quantity, serving_size,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c,
                image_url, is_public,
                created_at, updated_at
         FROM recipes
         WHERE user_id = $1 AND name ILIKE $2
         ORDER BY updated_at DESC
         LIMIT $3`,
        [request.userId, `%${q.trim()}%`, limit]
      );
    } else {
      result = await query(
        `SELECT id, user_id, name, description, steps,
                prep_time_minutes, cook_time_minutes, servings,
                serving_quantity, serving_size,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c,
                image_url, is_public,
                created_at, updated_at
         FROM recipes
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [request.userId, limit]
      );
    }
    return { recipes: result.rows };
  });

  // GET /recipes/:id — get recipe with ingredients
  fastify.get('/recipes/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const recipeResult = await query(
      `SELECT * FROM recipes WHERE id = $1 AND user_id = $2`,
      [request.params.id, request.userId]
    );
    if (recipeResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Recipe not found' });
    }

    const ingredientsResult = await query(
      `SELECT id, food_source, food_source_id, food_name, quantity_g,
              calories, protein, carbs, fat, fiber, sugar,
              saturated_fat, sodium, cholesterol, potassium,
              calcium, iron, vitamin_a, vitamin_c, created_at
       FROM recipe_ingredients
       WHERE recipe_id = $1
       ORDER BY created_at`,
      [request.params.id]
    );

    const recipe = recipeResult.rows[0];
    recipe.ingredients = ingredientsResult.rows;
    return recipe;
  });

  // POST /recipes — create recipe with ingredients
  fastify.post('/recipes', {
    preHandler: [fastify.ensureProfile],
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'ingredients'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          description: { type: 'string', maxLength: 2000 },
          steps: { type: 'string', maxLength: 10000 },
          prep_time_minutes: { type: 'integer', minimum: 0 },
          cook_time_minutes: { type: 'integer', minimum: 0 },
          servings: { type: 'integer', minimum: 1 },
          cooking_adjustment_pct: { type: 'number', default: 100 },
          ingredients: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['food_source', 'food_source_id', 'food_name', 'quantity_g'],
              properties: {
                food_source: { type: 'string', maxLength: 50 },
                food_source_id: { type: 'string', maxLength: 500 },
                food_name: { type: 'string', maxLength: 500 },
                quantity_g: { type: 'number', minimum: 0 },
                calories: { type: 'number' },
                protein: { type: 'number' },
                carbs: { type: 'number' },
                fat: { type: 'number' },
                fiber: { type: 'number' },
                sugar: { type: 'number' },
                saturated_fat: { type: 'number' },
                sodium: { type: 'number' },
                cholesterol: { type: 'number' },
                potassium: { type: 'number' },
                calcium: { type: 'number' },
                iron: { type: 'number' },
                vitamin_a: { type: 'number' },
                vitamin_c: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body;
    const ingredients = b.ingredients || [];

    const totalGrams = ingredients.reduce((sum, ing) => sum + (ing.quantity_g || 0), 0);
    const servingQuantity = totalGrams;
    const servingSize = `1 serving (${totalGrams}g)`;
    const totals = computeRecipeTotals(ingredients);
    const adj = (b.cooking_adjustment_pct || 100) / 100.0;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const recipeResult = await client.query(
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
          request.userId, b.name, b.description || '', b.steps || '',
          b.prep_time_minutes || 0, b.cook_time_minutes || 0, b.servings || 1,
          servingQuantity, servingSize,
          totals.calories * adj, totals.protein * adj, totals.carbs * adj, totals.fat * adj,
          totals.fiber * adj, totals.sugar * adj, totals.saturated_fat * adj,
          totals.sodium * adj, totals.cholesterol * adj, totals.potassium * adj,
          totals.calcium * adj, totals.iron * adj, totals.vitamin_a * adj, totals.vitamin_c * adj,
          b.cooking_adjustment_pct || 100,
        ]
      );
      const recipe = recipeResult.rows[0];

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

      await client.query('COMMIT');

      const ingredientsRes = await query(
        `SELECT id, food_source, food_source_id, food_name, quantity_g,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c, created_at
         FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY created_at`,
        [recipe.id]
      );
      recipe.ingredients = ingredientsRes.rows;

      reply.code(201);
      return recipe;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PUT /recipes/:id — update recipe and replace ingredients
  fastify.put('/recipes/:id', {
    preHandler: [fastify.requireAuth],
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'ingredients'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          description: { type: 'string', maxLength: 2000 },
          steps: { type: 'string', maxLength: 10000 },
          prep_time_minutes: { type: 'integer', minimum: 0 },
          cook_time_minutes: { type: 'integer', minimum: 0 },
          servings: { type: 'integer', minimum: 1 },
          cooking_adjustment_pct: { type: 'number', default: 100 },
          ingredients: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['food_source', 'food_source_id', 'food_name', 'quantity_g'],
              properties: {
                food_source: { type: 'string', maxLength: 50 },
                food_source_id: { type: 'string', maxLength: 500 },
                food_name: { type: 'string', maxLength: 500 },
                quantity_g: { type: 'number', minimum: 0 },
                calories: { type: 'number' },
                protein: { type: 'number' },
                carbs: { type: 'number' },
                fat: { type: 'number' },
                fiber: { type: 'number' },
                sugar: { type: 'number' },
                saturated_fat: { type: 'number' },
                sodium: { type: 'number' },
                cholesterol: { type: 'number' },
                potassium: { type: 'number' },
                calcium: { type: 'number' },
                iron: { type: 'number' },
                vitamin_a: { type: 'number' },
                vitamin_c: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body;
    const ingredients = b.ingredients || [];

    // Verify ownership
    const check = await query(
      'SELECT id FROM recipes WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Recipe not found' });
    }

    const totalGrams = ingredients.reduce((sum, ing) => sum + (ing.quantity_g || 0), 0);
    const servingQuantity = totalGrams;
    const servingSize = `1 serving (${totalGrams}g)`;
    const totals = computeRecipeTotals(ingredients);
    const adj = (b.cooking_adjustment_pct || 100) / 100.0;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const recipeResult = await client.query(
        `UPDATE recipes SET
          name = $1, description = $2, steps = $3,
          prep_time_minutes = $4, cook_time_minutes = $5, servings = $6,
          serving_quantity = $7, serving_size = $8,
          calories = $9, protein = $10, carbs = $11, fat = $12,
          fiber = $13, sugar = $14, saturated_fat = $15, sodium = $16,
          cholesterol = $17, potassium = $18, calcium = $19, iron = $20,
          vitamin_a = $21, vitamin_c = $22,
          cooking_adjustment_pct = $23,
          updated_at = now()
         WHERE id = $24 AND user_id = $25
         RETURNING *`,
        [
          b.name, b.description || '', b.steps || '',
          b.prep_time_minutes || 0, b.cook_time_minutes || 0, b.servings || 1,
          servingQuantity, servingSize,
          totals.calories * adj, totals.protein * adj, totals.carbs * adj, totals.fat * adj,
          totals.fiber * adj, totals.sugar * adj, totals.saturated_fat * adj,
          totals.sodium * adj, totals.cholesterol * adj, totals.potassium * adj,
          totals.calcium * adj, totals.iron * adj, totals.vitamin_a * adj, totals.vitamin_c * adj,
          b.cooking_adjustment_pct || 100,
          request.params.id, request.userId,
        ]
      );
      const recipe = recipeResult.rows[0];

      // Replace ingredients
      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [request.params.id]);

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

      await client.query('COMMIT');

      const ingredientsRes = await query(
        `SELECT id, food_source, food_source_id, food_name, quantity_g,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c, created_at
         FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY created_at`,
        [recipe.id]
      );
      recipe.ingredients = ingredientsRes.rows;

      return recipe;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /public-recipes — search community recipes
  fastify.get('/public-recipes', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, limit } = request.query;
    let result;
    if (q && q.trim()) {
      result = await query(
        `SELECT id, user_id, name, description, steps,
                prep_time_minutes, cook_time_minutes, servings,
                serving_quantity, serving_size,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c,
                image_url, is_public,
                created_at, updated_at
         FROM recipes
         WHERE is_public = true AND name ILIKE $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [`%${q.trim()}%`, limit]
      );
    } else {
      result = await query(
        `SELECT id, user_id, name, description, steps,
                prep_time_minutes, cook_time_minutes, servings,
                serving_quantity, serving_size,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c,
                image_url, is_public,
                created_at, updated_at
         FROM recipes
         WHERE is_public = true
         ORDER BY updated_at DESC
         LIMIT $1`,
        [limit]
      );
    }
    return { recipes: result.rows };
  });

  // POST /recipes/:id/fork — copy a public recipe to current user
  fastify.post('/recipes/:id/fork', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const source = await query(
      `SELECT * FROM recipes WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
      [request.params.id, request.userId]
    );
    if (source.rows.length === 0) {
      return reply.code(404).send({ error: 'Recipe not found' });
    }

    const original = source.rows[0];
    const ingredientsRes = await query(
      `SELECT food_source, food_source_id, food_name, quantity_g,
              calories, protein, carbs, fat, fiber, sugar,
              saturated_fat, sodium, cholesterol, potassium,
              calcium, iron, vitamin_a, vitamin_c
       FROM recipe_ingredients WHERE recipe_id = $1`,
      [request.params.id]
    );

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const newRecipeRes = await client.query(
        `INSERT INTO recipes (
          user_id, name, description, steps, prep_time_minutes,
          cook_time_minutes, servings, serving_quantity, serving_size,
          calories, protein, carbs, fat, fiber, sugar,
          saturated_fat, sodium, cholesterol, potassium,
          calcium, iron, vitamin_a, vitamin_c,
          cooking_adjustment_pct
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
        RETURNING *`,
        [
          request.userId, original.name + ' (forked)', original.description || '', original.steps || '',
          original.prep_time_minutes || 0, original.cook_time_minutes || 0, original.servings || 1,
          original.serving_quantity, original.serving_size,
          original.calories || 0, original.protein || 0, original.carbs || 0, original.fat || 0,
          original.fiber || 0, original.sugar || 0, original.saturated_fat || 0,
          original.sodium || 0, original.cholesterol || 0, original.potassium || 0,
          original.calcium || 0, original.iron || 0, original.vitamin_a || 0, original.vitamin_c || 0,
          original.cooking_adjustment_pct || 100,
        ]
      );
      const newRecipe = newRecipeRes.rows[0];

      for (const ing of ingredientsRes.rows) {
        await client.query(
          `INSERT INTO recipe_ingredients (
            recipe_id, food_source, food_source_id, food_name,
            quantity_g, calories, protein, carbs, fat, fiber, sugar,
            saturated_fat, sodium, cholesterol, potassium,
            calcium, iron, vitamin_a, vitamin_c
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            newRecipe.id, ing.food_source, ing.food_source_id, ing.food_name,
            ing.quantity_g, ing.calories || 0, ing.protein || 0,
            ing.carbs || 0, ing.fat || 0, ing.fiber || 0, ing.sugar || 0,
            ing.saturated_fat || 0, ing.sodium || 0, ing.cholesterol || 0,
            ing.potassium || 0, ing.calcium || 0, ing.iron || 0,
            ing.vitamin_a || 0, ing.vitamin_c || 0,
          ]
        );
      }

      await client.query('COMMIT');

      const newIngredientsRes = await query(
        `SELECT id, food_source, food_source_id, food_name, quantity_g,
                calories, protein, carbs, fat, fiber, sugar,
                saturated_fat, sodium, cholesterol, potassium,
                calcium, iron, vitamin_a, vitamin_c, created_at
         FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY created_at`,
        [newRecipe.id]
      );
      newRecipe.ingredients = newIngredientsRes.rows;

      reply.code(201);
      return newRecipe;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /recipes/:id/photo — upload recipe photo
  fastify.post('/recipes/:id/photo', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const check = await query(
      'SELECT id, image_url FROM recipes WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    // Strict image validation
    if (!data.mimetype || !data.mimetype.startsWith('image/')) {
      return reply.code(400).send({ error: 'Invalid file type. Only images are allowed.' });
    }

    const mimeExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const ext = mimeExt[data.mimetype] || path.extname(data.filename).slice(1) || 'jpg';
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    const oldUrl = check.rows[0].image_url || '';
    if (oldUrl.includes('/uploads/recipes/')) {
      const oldFile = path.join(UPLOAD_DIR, path.basename(oldUrl));
      fs.unlink(oldFile, () => {});
    }

    await pipeline(data.file, fs.createWriteStream(filepath));

    const imageUrl = `${UPLOAD_URL_PREFIX}/${filename}`;
    await query(
      'UPDATE recipes SET image_url = $1 WHERE id = $2',
      [imageUrl, request.params.id]
    );

    return { image_url: imageUrl };
  });

  // DELETE /recipes/:id
  fastify.delete('/recipes/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'DELETE FROM recipes WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Recipe not found' });
    }
    return { deleted: true };
  });
}

module.exports = recipeRoutes;
