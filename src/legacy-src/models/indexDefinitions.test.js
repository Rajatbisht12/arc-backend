const assert = require('assert');

const models = [
  require('./CreatorDailyActivity'),
  require('./CreatorEligibilityHistory'),
  require('./EarningsSnapshot')
];

for (const model of models) {
  const keys = model.schema.indexes().map(([definition]) => JSON.stringify(definition));
  assert.strictEqual(
    new Set(keys).size,
    keys.length,
    `${model.modelName} must not declare duplicate MongoDB indexes`
  );
}

console.log('MongoDB index definition contracts passed');
