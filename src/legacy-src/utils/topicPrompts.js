/**
 * Get topic-specific instructions for AI responses
 * @param {string} topic - Detected topic (aim, rank, communication, etc.)
 * @param {string} language - Detected language
 * @returns {string} Topic-specific instructions
 */
const getTopicInstructions = (topic, language = 'english') => {
  const instructions = {
    aim: {
      english: `
TOPIC: AIM TRAINING & IMPROVEMENT

Focus specifically on:
- **Crosshair Placement**: Pre-aiming common angles, head level positioning
- **Sensitivity Settings**: Finding optimal DPI and in-game sensitivity
- **Aim Training Routines**: Aim Lab, Kovaak's, or in-game practice
- **Tracking vs Flicking**: When to use each technique
- **Muscle Memory**: Consistent practice routines
- **Common Mistakes**: Over-flicking, crosshair drift, etc.

Provide specific, actionable drills and exercises.
Give sensitivity recommendations based on game type.`,

      roman_hindi: `
TOPIC: AIM TRAINING & IMPROVEMENT

Focus karo specifically:
- **Crosshair Placement**: Head level pe pre-aim karna
- **Sensitivity Settings**: Best DPI aur in-game sens dhundna
- **Aim Training**: Aim Lab, Kovaak's practice
- **Tracking vs Flicking**: Kab kaun sa use karna hai
- **Muscle Memory**: Regular practice routine
- **Common Mistakes**: Over-flicking, crosshair drift avoid karo

Specific drills aur exercises batao.
Game type ke hisaab se sensitivity recommend karo.`,

      roman_marathi: `
TOPIC: AIM TRAINING & IMPROVEMENT

Focus kara specifically:
- **Crosshair Placement**: Head level var pre-aim karaycha
- **Sensitivity Settings**: Best DPI ani in-game sens shodhaycha
- **Aim Training**: Aim Lab, Kovaak's practice
- **Tracking vs Flicking**: Kevha kay use karaycha
- **Muscle Memory**: Regular practice routine
- **Common Mistakes**: Over-flicking, crosshair drift avoid kara

Specific drills ani exercises sanga.
Game type pramane sensitivity recommend kara.`
    },

    rank: {
      english: `
TOPIC: RANK UP & COMPETITIVE IMPROVEMENT

Focus specifically on:
- **Consistency Over Flashy Plays**: Winning rounds reliably
- **Map Knowledge**: Callouts, rotations, common positions
- **Game Sense**: Reading opponents, predicting plays
- **Team Coordination**: Communication, role assignment
- **Mental Game**: Avoiding tilt, staying focused
- **VOD Review**: Learning from mistakes
- **Role Mastery**: Understanding your position's responsibilities

Provide rank-specific strategies (e.g., Bronze to Silver, Diamond to Immortal).
Give concrete examples of gameplay improvements.`,

      roman_hindi: `
TOPIC: RANK UP & COMPETITIVE IMPROVEMENT

Focus karo specifically:
- **Consistency**: Flashy plays se zyada consistent performance
- **Map Knowledge**: Callouts, rotations, common spots
- **Game Sense**: Opponents ko predict karna
- **Team Coordination**: Communication, roles follow karna
- **Mental Game**: Tilt avoid karna, focus maintain karna
- **VOD Review**: Apni mistakes se seekhna
- **Role Mastery**: Apna role properly samajhna

Rank-wise strategies do (Bronze to Silver, Diamond to Immortal).
Concrete gameplay examples do.`,

      roman_marathi: `
TOPIC: RANK UP & COMPETITIVE IMPROVEMENT

Focus kara specifically:
- **Consistency**: Flashy plays peksha consistent performance
- **Map Knowledge**: Callouts, rotations, common spots
- **Game Sense**: Opponents la predict karaycha
- **Team Coordination**: Communication, roles follow karaycha
- **Mental Game**: Tilt avoid kara, focus maintain kara
- **VOD Review**: Apli mistakes pasun shika
- **Role Mastery**: Apla role properly samajun ghya

Rank-wise strategies de (Bronze to Silver, Diamond to Immortal).
Concrete gameplay examples de.`
    },

    communication: {
      english: `
TOPIC: TEAM COMMUNICATION & CALLOUTS

Focus specifically on:
- **Clear Callouts**: Using proper map callouts
- **Information Priority**: What info to share and when
- **Positivity**: Encouraging teammates, avoiding toxicity
- **IGL Role**: In-game leader responsibilities
- **Listen & Adapt**: Understanding teammates' playstyles
- **Microphone Discipline**: When to talk, when to stay quiet
- **Language**: Simple, quick, accurate calls

Provide example callouts for popular maps.
Give communication templates for different situations.`,

      roman_hindi: `
TOPIC: TEAM COMMUNICATION & CALLOUTS

Focus karo specifically:
- **Clear Callouts**: Proper map callouts use karo
- **Information Priority**: Kya info kab share karni hai
- **Positivity**: Teammates ko encourage karo, toxic mat bano
- **IGL Role**: In-game leader ki responsibility
- **Listen & Adapt**: Teammates ke playstyle samjho
- **Mic Discipline**: Kab bolna hai, kab chup rehna hai
- **Language**: Simple, quick, accurate calls

Popular maps ke example callouts do.
Different situations ke liye communication templates do.`,

      roman_marathi: `
TOPIC: TEAM COMMUNICATION & CALLOUTS

Focus kara specifically:
- **Clear Callouts**: Proper map callouts use kara
- **Information Priority**: Kay info kevha share karaychi
- **Positivity**: Teammates la encourage kara, toxic naka
- **IGL Role**: In-game leader chi responsibility
- **Listen & Adapt**: Teammates che playstyle samajun ghya
- **Mic Discipline**: Kevha bolaycha, kevha shant rahaycha
- **Language**: Simple, quick, accurate calls

Popular maps che example callouts de.
Vegveglya situations sathi communication templates de.`
    },

    warmup: {
      english: `
TOPIC: WARMUP & PRACTICE ROUTINES

Focus specifically on:
- **Warmup Duration**: 15-30 minutes recommended
- **Aim Training**: Start with tracking, then flicks
- **Movement Practice**: Strafing, counter-strafing, jiggle peeking
- **Spray Control**: Practice spray patterns
- **Reaction Time**: Reflex training
- **Mental Warmup**: Getting in the zone
- **Routine Structure**: Consistent daily practice

Provide a step-by-step warmup routine.
Include both in-game and aim trainer exercises.`,

      roman_hindi: `
TOPIC: WARMUP & PRACTICE ROUTINES

Focus karo specifically:
- **Warmup Time**: 15-30 minutes recommended
- **Aim Training**: Pehle tracking, phir flicks
- **Movement Practice**: Strafing, counter-strafing, jiggle peeking
- **Spray Control**: Spray patterns practice karo
- **Reaction Time**: Reflex training
- **Mental Warmup**: Zone mein aana
- **Routine Structure**: Daily consistent practice

Step-by-step warmup routine do.
In-game aur aim trainer dono exercises include karo.`,

      roman_marathi: `
TOPIC: WARMUP & PRACTICE ROUTINES

Focus kara specifically:
- **Warmup Time**: 15-30 minutes recommended
- **Aim Training**: Pahile tracking, nantar flicks
- **Movement Practice**: Strafing, counter-strafing, jiggle peeking
- **Spray Control**: Spray patterns practice kara
- **Reaction Time**: Reflex training
- **Mental Warmup**: Zone madhe yaycha
- **Routine Structure**: Daily consistent practice

Step-by-step warmup routine de.
In-game ani aim trainer doni exercises include kara.`
    },

    valorant: {
      english: `
TOPIC: VALORANT-SPECIFIC STRATEGIES

Focus specifically on:
- **Agent Selection**: Picking agents for your team comp
- **Ability Usage**: When to use abilities, ability economy
- **Map Control**: How to take and hold sites
- **Post-Plant**: Positioning after spike plant
- **Economy**: Buy phases, eco rounds, force buys
- **Operator Usage**: AWP strategies and counters
- **Rotation Timing**: When to rotate and when to hold

Provide Valorant-specific tips and meta strategies.
Include agent-specific advice when relevant.`,

      roman_hindi: `
TOPIC: VALORANT-SPECIFIC STRATEGIES

Focus karo specifically:
- **Agent Selection**: Team comp ke liye agent choose karna
- **Ability Usage**: Abilities kab use karni, ability economy
- **Map Control**: Sites kaise lena aur hold karna
- **Post-Plant**: Spike plant ke baad positioning
- **Economy**: Buy phases, eco rounds, force buys
- **Operator Usage**: AWP strategies aur counters
- **Rotation Timing**: Kab rotate karna, kab hold karna

Valorant-specific tips aur meta strategies do.
Agent-specific advice bhi do jab relevant ho.`,

      roman_marathi: `
TOPIC: VALORANT-SPECIFIC STRATEGIES

Focus kara specifically:
- **Agent Selection**: Team comp sathi agent select karaycha
- **Ability Usage**: Abilities kevha use karaychi, ability economy
- **Map Control**: Sites kashi ghyaychi ani hold karaychi
- **Post-Plant**: Spike plant nantar positioning
- **Economy**: Buy phases, eco rounds, force buys
- **Operator Usage**: AWP strategies ani counters
- **Rotation Timing**: Kevha rotate karaycha, kevha hold karaycha

Valorant-specific tips ani meta strategies de.
Agent-specific advice pan de jar relevant asel.`
    },

    csgo: {
      english: `
TOPIC: CS:GO/CS2-SPECIFIC STRATEGIES

Focus specifically on:
- **Economy Management**: When to buy, save, force
- **Utility Usage**: Smokes, flashes, molotovs timing
- **Trade Fragging**: Supporting teammates' peeks
- **Map Control**: Taking mid, holding angles
- **Retake Strategies**: Site retake setups
- **Pistol Rounds**: Round 1 strategies
- **AWP Play**: Positioning, angles, eco management

Provide CS:GO-specific tips and professional strategies.
Include map-specific tactics.`,

      roman_hindi: `
TOPIC: CS:GO/CS2-SPECIFIC STRATEGIES

Focus karo specifically:
- **Economy Management**: Kab buy, save, force karna
- **Utility Usage**: Smokes, flashes, molotovs ki timing
- **Trade Fragging**: Teammates ke peeks support karna
- **Map Control**: Mid lena, angles hold karna
- **Retake Strategies**: Site retake setups
- **Pistol Rounds**: Round 1 strategies
- **AWP Play**: Positioning, angles, eco management

CS:GO-specific tips aur professional strategies do.
Map-specific tactics include karo.`,

      roman_marathi: `
TOPIC: CS:GO/CS2-SPECIFIC STRATEGIES

Focus kara specifically:
- **Economy Management**: Kevha buy, save, force karaycha
- **Utility Usage**: Smokes, flashes, molotovs chi timing
- **Trade Fragging**: Teammates che peeks support kara
- **Map Control**: Mid ghyaycha, angles hold karaycha
- **Retake Strategies**: Site retake setups
- **Pistol Rounds**: Round 1 strategies
- **AWP Play**: Positioning, angles, eco management

CS:GO-specific tips ani professional strategies de.
Map-specific tactics include kara.`
    },

    general: {
      english: `
Provide well-rounded gaming advice covering:
- Game sense and decision making
- Skill improvement strategies
- Practice routines
- Mental health and avoiding burnout
- Balancing gaming with other responsibilities

Be encouraging and supportive.`,

      roman_hindi: `
Well-rounded gaming advice do covering:
- Game sense aur decision making
- Skill improvement strategies
- Practice routines
- Mental health aur burnout avoid karna
- Gaming aur dusre kaam ka balance

Encouraging aur supportive bano.`,

      roman_marathi: `
Well-rounded gaming advice de covering:
- Game sense ani decision making
- Skill improvement strategies
- Practice routines
- Mental health ani burnout avoid kara
- Gaming ani dusri jimmedari cha balance

Encouraging ani supportive raha.`
    }
  };

  const languageKey = language.startsWith('roman') ? language : 
                     language.includes('hindi') ? 'roman_hindi' : 
                     language.includes('marathi') ? 'roman_marathi' : 'english';
  
  return instructions[topic]?.[languageKey] || instructions['general'][languageKey] || instructions['general']['english'];
};

module.exports = {
  getTopicInstructions
};

