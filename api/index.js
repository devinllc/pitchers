// Vercel serverless entrypoint that reuses the Express app
// Exports the Express app so Vercel can handle requests via @vercel/node runtime
const app = require('../server');

module.exports = app;
