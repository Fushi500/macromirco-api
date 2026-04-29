const { Pool, types } = require('pg');

// Parse NUMERIC/DECIMAL (OID 1700) as float instead of string
// so JSON responses contain actual numbers, not strings like "95.00".
types.setTypeParser(1700, (val) => parseFloat(val));

// Parse BIGINT (OID 20) as int instead of string.
types.setTypeParser(20, (val) => parseInt(val, 10));

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
