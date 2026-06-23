const axios = require('axios');

class ClashOfClansAPI {
  constructor() {
    this.baseURL = 'https://api.clashofclans.com/v1';
    this.apiKey = process.env.CLASH_OF_CLANS_API_KEY;
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
      console.error('Clash of Clans API Error:', error.response?.data || error.message);
      
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
      townHallLevel,
      townHallWeaponLevel,
      expLevel,
      trophies,
      bestTrophies,
      warStars,
      attackWins,
      defenseWins,
      builderHallLevel,
      builderBaseTrophies,
      bestBuilderBaseTrophies,
      clan,
      league,
      achievements,
      troops,
      heroes,
      spells
    } = playerData;

    // Get hero levels
    const heroLevels = heroes?.reduce((acc, hero) => {
      acc[hero.name] = hero.level;
      return acc;
    }, {}) || {};

    // Get troop levels (most used troops)
    const troopLevels = troops?.slice(0, 5).reduce((acc, troop) => {
      acc[troop.name] = troop.level;
      return acc;
    }, {}) || {};

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
      townhallLevel: `TH${townHallLevel}`,
      idLevel: expLevel,
      
      // Stats
      trophies: trophies,
      bestTrophies: bestTrophies,
      warStars: warStars,
      attackWins: attackWins,
      defenseWins: defenseWins,
      
      // Builder Base
      builderHallLevel: builderHallLevel,
      builderBaseTrophies: builderBaseTrophies,
      bestBuilderBaseTrophies: bestBuilderBaseTrophies,
      
      // Clan info
      clanName: clan?.name || 'No Clan',
      clanTag: clan?.tag || '',
      clanRole: normalizeClanRole(clanRole),
      
      // League info
      leagueName: league?.name || 'Unranked',
      leagueId: league?.id || 0,
      
      // Hero levels
      ...heroLevels,
      
      // Troop levels (top 5)
      ...troopLevels,
      
      // Additional stats
      totalAttacks: attackWins + defenseWins,
      winRate: attackWins > 0 ? ((attackWins / (attackWins + defenseWins)) * 100).toFixed(1) : 0,
      
      // Meta data
      lastUpdated: new Date().toISOString(),
      apiSource: 'Clash of Clans API'
    };
  }

  /**
   * Get player's current war status
   * @param {string} playerTag - Player tag
   * @returns {Object} War status data
   */
  async getPlayerWarStatus(playerTag) {
    try {
      const cleanTag = playerTag.replace('#', '');
      const encodedTag = encodeURIComponent(`#${cleanTag}`);
      
      const response = await axios.get(
        `${this.baseURL}/players/${encodedTag}/currentwar`,
        { headers: this.headers }
      );
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Clash of Clans War API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch war status',
        code: 'WAR_API_ERROR'
      };
    }
  }

  /**
   * Get player's clan information
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
      console.error('Clash of Clans Clan API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch clan data',
        code: 'CLAN_API_ERROR'
      };
    }
  }
}

module.exports = new ClashOfClansAPI();
