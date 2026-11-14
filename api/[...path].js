// Vercel function: every /api/** request. The application is compiled to dist/ by `npm run build`.
module.exports = require('../dist/serverless').default;
