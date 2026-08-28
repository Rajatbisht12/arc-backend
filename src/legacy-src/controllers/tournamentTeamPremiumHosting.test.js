const assert = require('node:assert/strict');

const PremiumMembership = require('../models/PremiumMembership');
const Scrim = require('../models/Scrim');
const Tournament = require('../models/Tournament');
const User = require('../models/User');
const tournamentController = require('./tournamentController');

const originals = {
  premiumFindOne: PremiumMembership.findOne,
  scrimCountDocuments: Scrim.countDocuments,
  tournamentFind: Tournament.find,
  userFindById: User.findById,
  userFindOne: User.findOne
};

const queryReturning = (value) => ({
  select() { return this; },
  lean: async () => value
});

const invokeHostingLimits = async () => {
  let responseBody;
  let responseStatus = 200;
  const res = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(payload) {
      responseBody = payload;
      return this;
    }
  };
  await tournamentController.getHostingLimits({
    user: { _id: '507f1f77bcf86cd799439011' }
  }, res);
  return { responseBody, responseStatus };
};

async function run() {
  try {
    let activeTournamentQueries = 0;
    User.findOne = () => queryReturning({ isVerifiedHost: false, userType: 'team' });
    User.findById = () => queryReturning({
      userType: 'team',
      isPremium: false,
      membership: { tier: 'free', validUntil: null }
    });
    PremiumMembership.findOne = () => queryReturning({
      planKey: 'team_pro',
      billingPeriod: 'monthly',
      membershipStatus: 'active',
      subscriptionStatus: 'active',
      expiresAt: new Date(Date.now() + 86_400_000)
    });
    Tournament.find = () => {
      activeTournamentQueries += 1;
      return queryReturning([]);
    };
    Scrim.countDocuments = async () => 0;

    const premium = await invokeHostingLimits();
    assert.equal(premium.responseStatus, 200);
    assert.deepStrictEqual(premium.responseBody.data.tournament, {
      allowed: true,
      isVerified: false,
      isPremiumTeam: true,
      unlimited: false,
      used: 0,
      limit: 1,
      period: 'active_tournament',
      activeTournamentId: null,
      activeTournamentName: null,
      nextAllowedAt: null
    });
    assert.equal(activeTournamentQueries, 1, 'Team Premium must retain the standard active-tournament cap');
    assert.equal(premium.responseBody.data.scrim.limit, 5, 'Team Premium must retain standard scrim limits');

    PremiumMembership.findOne = () => queryReturning(null);
    const free = await invokeHostingLimits();
    assert.equal(free.responseBody.data.tournament.isPremiumTeam, false);
    assert.equal(free.responseBody.data.tournament.unlimited, false);
    assert.equal(free.responseBody.data.tournament.limit, 1);
    assert.equal(free.responseBody.data.tournament.period, 'active_tournament');
    assert.equal(activeTournamentQueries, 2, 'Free Team accounts must retain the active-tournament limit');
  } finally {
    PremiumMembership.findOne = originals.premiumFindOne;
    Scrim.countDocuments = originals.scrimCountDocuments;
    Tournament.find = originals.tournamentFind;
    User.findById = originals.userFindById;
    User.findOne = originals.userFindOne;
  }
}

run()
  .then(() => console.log('Retired Team Premium tournament hosting entitlement tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
