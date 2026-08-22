const axios = require('axios');

const CLASH_ROYALE_API_BASE_URL = 'https://api.clashroyale.com/v1';
const REQUEST_TIMEOUT_MS = 12000;

const normalizeApiToken = (value) => String(value || '')
  .trim()
  .replace(/^Bearer\s+/i, '')
  .trim();

const normalizePlayerTag = (value) => {
  if (typeof value !== 'string') return null;
  const cleanTag = value.trim().replace(/\s+/g, '').replace(/^#+/, '').toUpperCase();
  if (!/^[A-Z0-9]{3,15}$/.test(cleanTag)) return null;
  return `#${cleanTag}`;
};

class ClashRoyaleAPI {
  constructor({ httpClient = axios, env = process.env } = {}) {
    this.baseURL = CLASH_ROYALE_API_BASE_URL;
    this.httpClient = httpClient;
    this.env = env;
  }

  getApiToken() {
    // TOKEN is the canonical name; KEY remains supported for existing deployments.
    return normalizeApiToken(
      this.env.CLASH_ROYALE_API_TOKEN || this.env.CLASH_ROYALE_API_KEY
    );
  }

  getHeaders() {
    const token = this.getApiToken();
    if (!token) return null;
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    };
  }

  normalizePlayerTag(value) {
    return normalizePlayerTag(value);
  }

  mapRequestError(error, notFoundMessage, fallbackMessage) {
    const upstreamStatus = Number(error?.response?.status || 0);

    if (upstreamStatus === 404) {
      return {
        success: false,
        error: notFoundMessage,
        code: 'PLAYER_NOT_FOUND',
        statusCode: 404
      };
    }

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return {
        success: false,
        error: 'Clash Royale sync is temporarily unavailable because the game API rejected the server credentials.',
        code: 'CLASH_ROYALE_AUTH_FAILED',
        statusCode: 503
      };
    }

    if (upstreamStatus === 429) {
      return {
        success: false,
        error: 'Clash Royale is receiving too many requests. Please try again shortly.',
        code: 'CLASH_ROYALE_RATE_LIMITED',
        statusCode: 429
      };
    }

    return {
      success: false,
      error: fallbackMessage,
      code: error?.code === 'ECONNABORTED'
        ? 'CLASH_ROYALE_TIMEOUT'
        : 'CLASH_ROYALE_UPSTREAM_ERROR',
      statusCode: 502
    };
  }

  async request(path, {
    notFoundMessage = 'Clash Royale resource not found.',
    fallbackMessage = 'Failed to fetch Clash Royale data. Please try again.'
  } = {}) {
    const headers = this.getHeaders();
    if (!headers) {
      return {
        success: false,
        error: 'Clash Royale sync is temporarily unavailable.',
        code: 'CLASH_ROYALE_NOT_CONFIGURED',
        statusCode: 503
      };
    }

    try {
      const response = await this.httpClient.get(`${this.baseURL}${path}`, {
        headers,
        timeout: REQUEST_TIMEOUT_MS
      });
      return { success: true, data: response.data };
    } catch (error) {
      // Never log request headers because they contain the server-side API token.
      console.error('Clash Royale API request failed', {
        path,
        upstreamStatus: error?.response?.status,
        upstreamReason: error?.response?.data?.reason || error?.response?.data?.message,
        errorCode: error?.code
      });
      return this.mapRequestError(error, notFoundMessage, fallbackMessage);
    }
  }

  /** Fetch player information by player tag. */
  async getPlayer(playerTag) {
    const normalizedTag = normalizePlayerTag(playerTag);
    if (!normalizedTag) {
      return {
        success: false,
        error: 'Invalid player tag. Enter the tag shown in Clash Royale, for example #ABC123DEF.',
        code: 'INVALID_PLAYER_TAG',
        statusCode: 400
      };
    }

    // Supercell expects the leading # to be URL encoded in the path.
    const encodedTag = encodeURIComponent(normalizedTag);
    return this.request(`/players/${encodedTag}`, {
      notFoundMessage: 'Player not found. Please check your Clash Royale player tag.',
      fallbackMessage: 'Failed to fetch player data from Clash Royale. Please try again.'
    });
  }

  /** Get player's role in clan by fetching clan data. */
  async getPlayerClanRole(clanTag, playerTag) {
    try {
      if (!clanTag || clanTag === 'No Clan') return '';
      const clanResponse = await this.getClan(clanTag);
      if (!clanResponse.success) return '';
      const member = clanResponse.data?.memberList?.find((item) => item.tag === playerTag);
      return member?.role || '';
    } catch (error) {
      console.error('Error resolving Clash Royale clan role', { errorCode: error?.code });
      return '';
    }
  }

  /** Format official player data for the existing gaming-stats structure. */
  async formatPlayerData(playerData) {
    const {
      tag,
      name,
      expLevel,
      trophies,
      bestTrophies,
      wins,
      losses,
      battleCount,
      threeCrownWins,
      clan,
      arena,
      leagueStatistics,
      currentDeck,
      currentFavouriteCard,
      starPoints,
      expPoints,
      totalExpPoints,
      cards,
      achievements,
      badges
    } = playerData;

    const currentDeckCards = currentDeck?.map((card) => ({
      name: card.name,
      level: card.level,
      maxLevel: card.maxLevel,
      count: card.count,
      rarity: card.rarity,
      elixirCost: card.elixirCost
    })) || [];

    const topCards = cards?.slice(0, 8).map((card) => ({
      name: card.name,
      level: card.level,
      maxLevel: card.maxLevel,
      count: card.count,
      rarity: card.rarity,
      elixirCost: card.elixirCost
    })) || [];

    const winRate = battleCount > 0 ? ((wins / battleCount) * 100).toFixed(1) : 0;
    const currentSeason = leagueStatistics?.currentSeason;
    const bestSeason = leagueStatistics?.bestSeason;
    const clanRole = await this.getPlayerClanRole(clan?.tag, tag);
    const normalizedClanRole = (() => {
      const key = String(clanRole || '').toLowerCase().replace(/[-_\s]/g, '');
      return ({
        member: 'member',
        elder: 'elder',
        coleader: 'coLeader',
        leader: 'leader',
        admin: 'admin',
        administrator: 'admin'
      })[key] || clanRole || '';
    })();

    return {
      playerTag: tag,
      inGameName: name,
      level: expLevel,
      starPoints: starPoints || 0,
      expPoints: expPoints || 0,
      totalExpPoints: totalExpPoints || 0,
      arena: arena?.name || 'Unknown Arena',
      arenaId: arena?.id || 0,
      trophies,
      bestTrophies,
      wins,
      losses,
      battleCount,
      threeCrownWins,
      winRate: parseFloat(winRate),
      clanName: clan?.name || 'No Clan',
      clanTag: clan?.tag || '',
      clanRole: normalizedClanRole,
      clanBadgeId: clan?.badgeId || 0,
      currentSeasonTrophies: currentSeason?.trophies || 0,
      currentSeasonBestTrophies: currentSeason?.bestTrophies || 0,
      bestSeasonTrophies: bestSeason?.trophies || 0,
      bestSeasonId: bestSeason?.id || '',
      currentFavouriteCard: currentFavouriteCard?.name || '',
      currentDeck: currentDeckCards,
      topCards,
      totalCards: cards?.length || 0,
      achievementsCount: achievements?.length || 0,
      badgesCount: badges?.length || 0,
      lastUpdated: new Date().toISOString(),
      apiSource: 'Clash Royale API'
    };
  }

  async getPlayerBattleLog(playerTag) {
    const normalizedTag = normalizePlayerTag(playerTag);
    if (!normalizedTag) return { success: false, error: 'Invalid player tag.', code: 'INVALID_PLAYER_TAG', statusCode: 400 };
    return this.request(`/players/${encodeURIComponent(normalizedTag)}/battlelog`, {
      notFoundMessage: 'Player battle log not found.',
      fallbackMessage: 'Failed to fetch battle log from Clash Royale.'
    });
  }

  async getPlayerUpcomingChests(playerTag) {
    const normalizedTag = normalizePlayerTag(playerTag);
    if (!normalizedTag) return { success: false, error: 'Invalid player tag.', code: 'INVALID_PLAYER_TAG', statusCode: 400 };
    return this.request(`/players/${encodeURIComponent(normalizedTag)}/upcomingchests`, {
      notFoundMessage: 'Upcoming chests not found for this player.',
      fallbackMessage: 'Failed to fetch upcoming chests from Clash Royale.'
    });
  }

  async getClan(clanTag) {
    const normalizedTag = normalizePlayerTag(clanTag);
    if (!normalizedTag) return { success: false, error: 'Invalid clan tag.', code: 'INVALID_CLAN_TAG', statusCode: 400 };
    return this.request(`/clans/${encodeURIComponent(normalizedTag)}`, {
      notFoundMessage: 'Clan not found.',
      fallbackMessage: 'Failed to fetch clan data from Clash Royale.'
    });
  }

  async getCards() {
    return this.request('/cards', {
      notFoundMessage: 'Clash Royale cards not found.',
      fallbackMessage: 'Failed to fetch cards from Clash Royale.'
    });
  }

  async getTournaments(options = {}) {
    const queryParams = new URLSearchParams();
    if (options.name) queryParams.append('name', options.name);
    if (options.limit) queryParams.append('limit', options.limit);
    if (options.after) queryParams.append('after', options.after);
    if (options.before) queryParams.append('before', options.before);
    const query = queryParams.toString();
    return this.request(`/tournaments${query ? `?${query}` : ''}`, {
      notFoundMessage: 'Clash Royale tournaments not found.',
      fallbackMessage: 'Failed to fetch tournaments from Clash Royale.'
    });
  }
}

const clashRoyaleAPI = new ClashRoyaleAPI();

module.exports = clashRoyaleAPI;
module.exports.ClashRoyaleAPI = ClashRoyaleAPI;
module.exports.CLASH_ROYALE_API_BASE_URL = CLASH_ROYALE_API_BASE_URL;
module.exports.normalizeApiToken = normalizeApiToken;
module.exports.normalizePlayerTag = normalizePlayerTag;
