// BGMI Standard Points System (BGIS/BMPS format)
const BGMI_PLACEMENT_POINTS = {
  1: 10,   // WWCD (Winner Winner Chicken Dinner)
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1,
  // 9-25: 0 points
};

/**
 * Calculate BGMI points based on placement and kills
 * @param {Number} placement - Final placement (1-25)
 * @param {Number} kills - Total kills (0-50)
 * @returns {Object} { placementPoints, killPoints, totalPoints }
 */
const calculateBGMIPoints = (placement, kills) => {
  // Get placement points (0 for placements 9-25)
  const placementPoints = BGMI_PLACEMENT_POINTS[placement] || 0;
  
  // Kill points: 1 kill = 1 point
  const killPoints = (kills || 0) * 1;
  
  // Total points
  const totalPoints = placementPoints + killPoints;
  
  return {
    placementPoints,
    killPoints,
    totalPoints
  };
};

/**
 * Get placement points for a given placement
 * @param {Number} placement - Final placement (1-25)
 * @returns {Number} Placement points
 */
const getPlacementPoints = (placement) => {
  return BGMI_PLACEMENT_POINTS[placement] || 0;
};

module.exports = {
  calculateBGMIPoints,
  getPlacementPoints,
  BGMI_PLACEMENT_POINTS
};
