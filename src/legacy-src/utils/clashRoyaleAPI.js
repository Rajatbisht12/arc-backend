const axios = require('axios');

class ClashRoyaleAPI {
  constructor() {
    this.baseURL = 'https://api.clashroyale.com/v1';
    this.apiKey = process.env.CLASH_ROYALE_API_KEY;
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch player information by player tag
   * @param {string} playerTag - Player tag (e.g., #ABC123DEF)
   * @returns {Object} Player data
   */
  async getPlayer(playerTag) {
    try {
      // Remove # if present and URL encode
      const cleanTag = playerTag.replace('#', '');
      const encodedTag = encodeURIComponent(`#${cleanTag}`);
      
      const response = await axios.get(
        `${this.baseURL}/players/${encodedTag}`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash Royale API Error:', error.response?.data || error.message);
      
      if (error.response?.status === 404) {
        return {
          success: false,
          error: 'Player not found. Please check your player tag.',
          code: 'PLAYER_NOT_FOUND'
        };
      } else if (error.response?.status === 403) {
        return {
          success: false,
          error: 'API access denied. Please check your API key.',
          code: 'API_ACCESS_DENIED'
        };
      } else if (error.response?.status === 429) {
        return {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED'
        };
      } else {
        return {
          success: false,
          error: 'Failed to fetch player data. Please try again.',
          code: 'API_ERROR'
        };
      }
    }
  }

  /**
   * Get player's role in clan by fetching clan data
   * @param {string} clanTag - Clan tag
   * @param {string} playerTag - Player tag
   * @returns {string} Player's role in clan
   */
  async getPlayerClanRole(clanTag, playerTag) {
    try {
      if (!clanTag || clanTag === 'No Clan') return '';
      
      const clanResponse = await this.getClan(clanTag);
      if (!clanResponse.success) return '';
      
      const clan = clanResponse.data;
      const member = clan.memberList?.find(m => m.tag === playerTag);
      return member?.role || '';
    } catch (error) {
      console.error('Error fetching clan role:', error);
      return '';
    }
  }

  /**
   * Format player data for our gaming stats structure
   * @param {Object} playerData - Raw player data from API
   * @returns {Object} Formatted player data
   */
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

    // Get current deck cards
    const currentDeckCards = currentDeck?.map(card => ({
      name: card.name,
      level: card.level,
      maxLevel: card.maxLevel,
      count: card.count,
      rarity: card.rarity,
      elixirCost: card.elixirCost
    })) || [];

    // Get top cards by level (most used cards)
    const topCards = cards?.slice(0, 8).map(card => ({
      name: card.name,
      level: card.level,
      maxLevel: card.maxLevel,
      count: card.count,
      rarity: card.rarity,
      elixirCost: card.elixirCost
    })) || [];

    // Calculate win rate
    const winRate = battleCount > 0 ? ((wins / battleCount) * 100).toFixed(1) : 0;

    // Get league info
    const currentSeason = leagueStatistics?.currentSeason;
    const bestSeason = leagueStatistics?.bestSeason;

    // Get player's role in clan by fetching clan data
    const clanRole = await this.getPlayerClanRole(clan?.tag, tag);

    // Normalize clan role to match our form options
    const normalizeClanRole = (role) => {
      if (!role) return '';
      const roleMap = {
        'member': 'member',
        'elder': 'elder', 
        'coLeader': 'coLeader',
        'co-leader': 'coLeader',
        'co_leader': 'coLeader',
        'leader': 'leader',
        'admin': 'admin',
        'administrator': 'admin'
      };
      return roleMap[role.toLowerCase()] || role;
    };

    return {
      // Basic info
      playerTag: tag,
      inGameName: name,
      level: expLevel,
      starPoints: starPoints || 0,
      expPoints: expPoints || 0,
      totalExpPoints: totalExpPoints || 0,
      
      // Arena and League
      arena: arena?.name || 'Unknown Arena',
      arenaId: arena?.id || 0,
      
      // Trophies
      trophies: trophies,
      bestTrophies: bestTrophies,
      
      // Battle stats
      wins: wins,
      losses: losses,
      battleCount: battleCount,
      threeCrownWins: threeCrownWins,
      winRate: parseFloat(winRate),
      
      // Clan info
      clanName: clan?.name || 'No Clan',
      clanTag: clan?.tag || '',
      clanRole: normalizeClanRole(clanRole),
      clanBadgeId: clan?.badgeId || 0,
      
      // League statistics
      currentSeasonTrophies: currentSeason?.trophies || 0,
      currentSeasonBestTrophies: currentSeason?.bestTrophies || 0,
      bestSeasonTrophies: bestSeason?.trophies || 0,
      bestSeasonId: bestSeason?.id || '',
      
      // Cards
      currentFavouriteCard: currentFavouriteCard?.name || '',
      currentDeck: currentDeckCards,
      topCards: topCards,
      
      // Additional stats
      totalCards: cards?.length || 0,
      achievementsCount: achievements?.length || 0,
      badgesCount: badges?.length || 0,
      
      // Meta data
      lastUpdated: new Date().toISOString(),
      apiSource: 'Clash Royale API'
    };
  }

  /**
   * Get player's battle log
   * @param {string} playerTag - Player tag
   * @returns {Object} Battle log data
   */
  async getPlayerBattleLog(playerTag) {
    try {
      const cleanTag = playerTag.replace('#', '');
      const encodedTag = encodeURIComponent(`#${cleanTag}`);
      
      const response = await axios.get(
        `${this.baseURL}/players/${encodedTag}/battlelog`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash Royale Battle Log API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch battle log',
        code: 'BATTLE_LOG_API_ERROR'
      };
    }
  }

  /**
   * Get player's upcoming chests
   * @param {string} playerTag - Player tag
   * @returns {Object} Upcoming chests data
   */
  async getPlayerUpcomingChests(playerTag) {
    try {
      const cleanTag = playerTag.replace('#', '');
      const encodedTag = encodeURIComponent(`#${cleanTag}`);
      
      const response = await axios.get(
        `${this.baseURL}/players/${encodedTag}/upcomingchests`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash Royale Upcoming Chests API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch upcoming chests',
        code: 'UPCOMING_CHESTS_API_ERROR'
      };
    }
  }

  /**
   * Get clan information
   * @param {string} clanTag - Clan tag
   * @returns {Object} Clan data
   */
  async getClan(clanTag) {
    try {
      const cleanTag = clanTag.replace('#', '');
      const encodedTag = encodeURIComponent(`#${cleanTag}`);
      
      const response = await axios.get(
        `${this.baseURL}/clans/${encodedTag}`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash Royale Clan API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch clan data',
        code: 'CLAN_API_ERROR'
      };
    }
  }

  /**
   * Get cards information
   * @returns {Object} Cards data
   */
  async getCards() {
    try {
      const response = await axios.get(
        `${this.baseURL}/cards`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash Royale Cards API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch cards data',
        code: 'CARDS_API_ERROR'
      };
    }
  }

  /**
   * Get tournaments information
   * @param {Object} options - Query options
   * @returns {Object} Tournaments data
   */
  async getTournaments(options = {}) {
    try {
      const queryParams = new URLSearchParams();
      if (options.name) queryParams.append('name', options.name);
      if (options.limit) queryParams.append('limit', options.limit);
      if (options.after) queryParams.append('after', options.after);
      if (options.before) queryParams.append('before', options.before);
      
      const response = await axios.get(
        `${this.baseURL}/tournaments?${queryParams.toString()}`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash Royale Tournaments API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch tournaments data',
        code: 'TOURNAMENTS_API_ERROR'
      };
    }
  }
}

module.exports = new ClashRoyaleAPI();
