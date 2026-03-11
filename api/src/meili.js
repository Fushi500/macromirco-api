const { MeiliSearch } = require('meilisearch');

const meili = new MeiliSearch({
  host: process.env.MEILI_URL,
  apiKey: process.env.MEILI_KEY,
});

const foodsIndex = meili.index('foods');

module.exports = { meili, foodsIndex };
