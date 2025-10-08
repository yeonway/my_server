// config/secrets.js
require('dotenv').config();

const { JWT_SECRET } = process.env;

if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable. Set a strong secret before starting the server.');
}

module.exports = {
  JWT_SECRET
};
