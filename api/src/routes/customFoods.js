const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { query } = require('../db');

const UPLOAD_DIR = '/app/static/uploads/custom-foods';
const UPLOAD_URL_PREFIX = 'https://api.macromirco.com/images/uploads/custom-foods';

async function customFoodRoutes(fastify) {

  // GET /custom-foods — list user's own custom foods
  fastify.get('/custom-foods', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200 },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, page, limit } = request.query;
    const offset = (page - 1) * limit;

    let result;
    if (q && q.trim()) {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_foods
         WHERE user_id = $1 AND product_name ILIKE $2
         ORDER BY product_name
         LIMIT $3 OFFSET $4`,
        [request.userId, `%${q.trim()}%`, limit, offset]
      );
    } else {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_foods
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [request.userId, limit, offset]
      );
    }

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;
    const foods = result.rows.map(r => { delete r.total; return r; });
    return { page, limit, total, foods };
  });

  // GET /custom-foods/public — search all public custom foods from all users
  fastify.get('/public-foods', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200 },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, page, limit } = request.query;
    const offset = (page - 1) * limit;

    let result;
    if (q && q.trim()) {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_foods
         WHERE is_public = true AND product_name ILIKE $1
         ORDER BY product_name
         LIMIT $2 OFFSET $3`,
        [`%${q.trim()}%`, limit, offset]
      );
    } else {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_foods
         WHERE is_public = true
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;
    const foods = result.rows.map(r => { delete r.total; return r; });
    return { page, limit, total, foods };
  });

  // GET /custom-foods/:id
  fastify.get('/custom-foods/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    // Can see own foods or any public food
    const result = await query(
      'SELECT * FROM custom_foods WHERE id = $1 AND (user_id = $2 OR is_public = true)',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return result.rows[0];
  });

  // POST /custom-foods — create a custom food
  fastify.post('/custom-foods', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['product_name'],
        properties: {
          barcode: { type: 'string', maxLength: 50 },
          product_name: { type: 'string', minLength: 1, maxLength: 500 },
          brands: { type: 'string', maxLength: 200 },
          serving_size: { type: 'string', maxLength: 200 },
          calories: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
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
          image_url: { type: 'string', maxLength: 1000 },
          is_public: { type: 'boolean' },
          food_category: { type: 'string', maxLength: 20 },
          serving_count: { type: 'integer' },
          serving_unit: { type: 'string', maxLength: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const f = request.body;
    const result = await query(
      `INSERT INTO custom_foods (
        user_id, barcode, product_name, brands, serving_size,
        calories, protein, fat, carbs, fiber, sugar, saturated_fat,
        sodium, cholesterol, potassium, calcium, iron, vitamin_a, vitamin_c,
        image_url, is_public, food_category, serving_count, serving_unit
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *`,
      [
        request.userId, f.barcode || null, f.product_name, f.brands || '',
        f.serving_size || '', f.calories || 0, f.protein || 0, f.fat || 0,
        f.carbs || 0, f.fiber || 0, f.sugar || 0, f.saturated_fat || 0,
        f.sodium || 0, f.cholesterol || 0, f.potassium || 0, f.calcium || 0,
        f.iron || 0, f.vitamin_a || 0, f.vitamin_c || 0, f.image_url || '',
        f.is_public || false, f.food_category || 'food', f.serving_count || 1,
        f.serving_unit || 'g',
      ]
    );
    reply.code(201);
    return result.rows[0];
  });

  // PUT /custom-foods/:id — update own custom food
  fastify.put('/custom-foods/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          barcode: { type: 'string', maxLength: 50 },
          product_name: { type: 'string', minLength: 1, maxLength: 500 },
          brands: { type: 'string', maxLength: 200 },
          serving_size: { type: 'string', maxLength: 200 },
          calories: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
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
          image_url: { type: 'string', maxLength: 1000 },
          is_public: { type: 'boolean' },
          food_category: { type: 'string', maxLength: 20 },
          serving_count: { type: 'integer' },
          serving_unit: { type: 'string', maxLength: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const check = await query(
      'SELECT id FROM custom_foods WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const fields = request.body;
    const setClauses = [];
    const values = [];
    let p = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${p++}`);
      values.push(value);
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    values.push(request.params.id);
    const result = await query(
      `UPDATE custom_foods SET ${setClauses.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    return result.rows[0];
  });

  // POST /custom-foods/:id/photo — upload food photo
  fastify.post('/custom-foods/:id/photo', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    // Verify ownership
    const check = await query(
      'SELECT id, image_url FROM custom_foods WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    // Derive extension from mimetype or filename
    const mimeExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const ext = mimeExt[data.mimetype] || path.extname(data.filename).slice(1) || 'jpg';
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Delete old photo if it was one we uploaded
    const oldUrl = check.rows[0].image_url || '';
    if (oldUrl.includes('/uploads/custom-foods/')) {
      const oldFile = path.join(UPLOAD_DIR, path.basename(oldUrl));
      fs.unlink(oldFile, () => {}); // fire and forget
    }

    // Save file to disk
    await pipeline(data.file, fs.createWriteStream(filepath));

    const imageUrl = `${UPLOAD_URL_PREFIX}/${filename}`;
    await query(
      'UPDATE custom_foods SET image_url = $1 WHERE id = $2',
      [imageUrl, request.params.id]
    );

    return { image_url: imageUrl };
  });

  // DELETE /custom-foods/:id — only own foods
  fastify.delete('/custom-foods/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'DELETE FROM custom_foods WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { deleted: true };
  });
}

module.exports = customFoodRoutes;
