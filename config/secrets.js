// config/secrets.js
require('dotenv').config();
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'e-3!0OE3icN,TYmG'
};