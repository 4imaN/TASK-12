const knex = require('knex');

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD === '' ? '' : (process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME || 'railops',
    timezone: '+00:00'
  },
  pool: { min: 2, max: 10 }
});

module.exports = db;
