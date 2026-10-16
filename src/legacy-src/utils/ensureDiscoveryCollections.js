const ContentExposure = require('../models/ContentExposure');
const RecommendationDelivery = require('../models/RecommendationDelivery');
const RecommendationState = require('../models/RecommendationState');

// Missing lookup collections behave differently on DocumentDB. Materialize
// both before serving feeds; indexes are installed by the explicit migration.
async function ensureDiscoveryCollections() {
  for (const model of [ContentExposure, RecommendationDelivery, RecommendationState]) {
    try { await model.createCollection(); }
    catch (error) { if (error?.code !== 48 && error?.codeName !== 'NamespaceExists') throw error; }
  }
}
module.exports = { ensureDiscoveryCollections };
