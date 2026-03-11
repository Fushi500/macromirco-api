const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,              // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err.message);
});

pool.on('connect', () => {
  console.log('New PostgreSQL connection established');
});

// Helper for single queries
const query = (text, params) => pool.query(text, params);

// Helper for transactions
const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
