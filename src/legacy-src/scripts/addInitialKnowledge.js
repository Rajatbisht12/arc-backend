const mongoose = require('mongoose');
const GamingKnowledge = require('../models/GamingKnowledge');
require('dotenv').config();

// Connect to database
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Initial BGMI knowledge entries
const initialKnowledge = [
  {
    question: "BGMI mein aim kaise improve karu?",
    answer: "BGMI mein aim improve karne ke liye pehle sensitivity set karo. Har player ka apna comfortable sensitivity hota hai - apne controls aur layout ke hisaab se sensitivity adjust karo. Jab sensitivity pe hath baith jaye, tab aim improvement pe focus karo. Training Ground mein different types ki training karo: close range fights, mid range sprays, long range sniping. Regular practice se aim automatically improve hoga.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["aim", "improve", "bgmi", "sensitivity", "training"],
    tags: ["beginner", "aim", "training"],
    skillLevel: "beginner",
    priority: 10,
    source: "manual"
  },
  {
    question: "BGMI sensitivity kaise set karein?",
    answer: "BGMI mein sensitivity individual player ke controls aur layout ke hisaab se set karni chahiye. Pehle default sensitivity se start karo, phir training ground mein test karo. Agar recoil control nahi ho raha to sensitivity kam karo. Agar aim slow lag raha hai to sensitivity badhao. Important: Ek baar comfortable sensitivity mil jaye to uspe stick raho, baar baar change mat karo. Jab sensitivity pe hath baith jaye tab hi aim improvement pe focus karo.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["sensitivity", "settings", "bgmi", "controls", "layout"],
    tags: ["beginner", "settings", "sensitivity"],
    skillLevel: "beginner",
    priority: 10,
    source: "manual"
  },
  {
    question: "BGMI Training Ground mein kya practice karein?",
    answer: "Training Ground mein different types ki training karo: 1) Close Range - Fast movement ke saath close range fights practice karo, 2) Mid Range - Spray control aur recoil management practice karo, 3) Long Range - Sniping aur long distance shots practice karo, 4) Moving Targets - Moving targets pe aim practice karo. Regular training se aim, recoil control, aur movement improve hota hai.",
    topic: "warmup",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["training", "ground", "practice", "bgmi", "warmup"],
    tags: ["beginner", "training", "practice"],
    skillLevel: "beginner",
    priority: 9,
    source: "manual"
  },
  {
    question: "How to improve aim in BGMI?",
    answer: "To improve aim in BGMI, first set your sensitivity according to your controls and layout. Each player has their own comfortable sensitivity. Once you get comfortable with your sensitivity, focus on aim improvement. Practice in Training Ground with different types of training: close range fights, mid range sprays, long range sniping. Regular practice will automatically improve your aim.",
    topic: "aim",
    game: "bgmi",
    language: "english",
    keywords: ["aim", "improve", "bgmi", "sensitivity", "training"],
    tags: ["beginner", "aim", "training"],
    skillLevel: "beginner",
    priority: 10,
    source: "manual"
  },
  {
    question: "How to set sensitivity in BGMI?",
    answer: "In BGMI, sensitivity should be set according to individual player's controls and layout. Start with default sensitivity, then test in training ground. If recoil control is difficult, reduce sensitivity. If aim feels slow, increase sensitivity. Important: Once you find comfortable sensitivity, stick with it, don't change frequently. Only focus on aim improvement once you're comfortable with your sensitivity.",
    topic: "aim",
    game: "bgmi",
    language: "english",
    keywords: ["sensitivity", "settings", "bgmi", "controls", "layout"],
    tags: ["beginner", "settings", "sensitivity"],
    skillLevel: "beginner",
    priority: 10,
    source: "manual"
  },
  {
    question: "What to practice in BGMI Training Ground?",
    answer: "In Training Ground, practice different types of training: 1) Close Range - Practice close range fights with fast movement, 2) Mid Range - Practice spray control and recoil management, 3) Long Range - Practice sniping and long distance shots, 4) Moving Targets - Practice aim on moving targets. Regular training improves aim, recoil control, and movement.",
    topic: "warmup",
    game: "bgmi",
    language: "english",
    keywords: ["training", "ground", "practice", "bgmi", "warmup"],
    tags: ["beginner", "training", "practice"],
    skillLevel: "beginner",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI mein recoil control kaise karein?",
    answer: "BGMI mein recoil control mein grip aur layout ka bada role hota hai. Agar aap full gyroscope sensitivity se khel rahe ho to aapki grip strong honi chahiye. Fire button ka placement bhi matter karta hai kyunki us jagah pressure dene se mobile tilt hota hai us direction mein. To aapko fire button placement ko dhyan mein rakhte hue sensitivity ko control karte hue recoil control karna padega. Strong grip aur proper button placement se recoil control better hota hai.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["recoil", "control", "grip", "layout", "gyroscope", "fire button", "bgmi"],
    tags: ["intermediate", "recoil", "controls"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "How to control recoil in BGMI?",
    answer: "In BGMI, grip and layout play a big role in recoil control. If you're playing with full gyroscope sensitivity, your grip needs to be strong. Fire button placement also matters because applying pressure there causes the mobile to tilt in that direction. So you need to control recoil while managing sensitivity, keeping fire button placement in mind. Strong grip and proper button placement improve recoil control.",
    topic: "aim",
    game: "bgmi",
    language: "english",
    keywords: ["recoil", "control", "grip", "layout", "gyroscope", "fire button", "bgmi"],
    tags: ["intermediate", "recoil", "controls"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI mein close range fights kaise jeetein?",
    answer: "Close range fight jeetne ke liye cover ka istemal sahi se karna zaruri hai. Jo player cover ka istemal karke crosshair ko enemy ko sahi se trace karega wahi close range fight jeetega. Enemy ko galti karne do, enemy ko uska cover chodne do. Agar tumhare pass cover nahi hai aur enemy ke pass cover hai to aapko prefire pe rely karna hoga. Aapka prefire aur crosshair placement on point hona chahiye - enemy cover se bahar nikalte hi use prefire pad jayega.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["close range", "fights", "cover", "prefire", "crosshair", "bgmi", "combat"],
    tags: ["intermediate", "combat", "strategy"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "How to win close range fights in BGMI?",
    answer: "To win close range fights, proper use of cover is essential. The player who uses cover effectively and traces the enemy with crosshair will win the close range fight. Let the enemy make mistakes, let the enemy leave their cover. If you don't have cover but enemy has cover, you need to rely on prefire. Your prefire and crosshair placement should be on point - as soon as enemy comes out of cover, prefire them.",
    topic: "rank",
    game: "bgmi",
    language: "english",
    keywords: ["close range", "fights", "cover", "prefire", "crosshair", "bgmi", "combat"],
    tags: ["intermediate", "combat", "strategy"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI mein long range sniping kaise improve karein?",
    answer: "Long range sniping improve karne ke liye pehle bullet drop aur bullet travel time ko samajho. Different snipers ka different bullet velocity hota hai - AWM fastest hai, M24 medium, aur Kar98 slow. Enemy ki movement predict karo aur uske aage aim karo. High ground pe position lo kyunki upar se niche target karna easy hota hai. Scope sensitivity ko adjust karo - zyada high nahi honi chahiye. Practice karo training ground mein moving targets pe. Patience rakho - perfect shot ka wait karo, jaldi mein mat shoot karo.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["sniping", "long range", "bullet drop", "scope", "awm", "m24", "kar98", "bgmi"],
    tags: ["intermediate", "sniping", "aim"],
    skillLevel: "intermediate",
    priority: 8,
    source: "manual"
  },
  {
    question: "How to improve long range sniping in BGMI?",
    answer: "To improve long range sniping, first understand bullet drop and bullet travel time. Different snipers have different bullet velocity - AWM is fastest, M24 is medium, and Kar98 is slow. Predict enemy movement and aim ahead of them. Take high ground position because shooting down is easier. Adjust scope sensitivity - it shouldn't be too high. Practice on moving targets in training ground. Be patient - wait for perfect shot, don't shoot in hurry.",
    topic: "aim",
    game: "bgmi",
    language: "english",
    keywords: ["sniping", "long range", "bullet drop", "scope", "awm", "m24", "kar98", "bgmi"],
    tags: ["intermediate", "sniping", "aim"],
    skillLevel: "intermediate",
    priority: 8,
    source: "manual"
  },
  {
    question: "BGMI mein movement kaise improve karein?",
    answer: "Movement improve karne ke liye joystick layout ko sahi se samajho. BGMI mein 3 alag joystick layouts available hain: 1) Floating Joystick - Left side pe kisi bhi jagah tap karne se joystick operate hoti hai, ye flexible hai aur kisi bhi position se movement control kar sakte ho. 2) Fixed Joystick - Precisely joystick pe hi tap karke drag karna padta hai, ye precise control deta hai. 3) Custom Layout - Apne hisaab se joystick position customize kar sakte ho. Jo layout comfortable ho uspe stick karo. Movement smooth aur responsive honi chahiye - jaldi jaldi direction change karne mein problem nahi honi chahiye. Training ground mein different movements practice karo - strafing, peeking, jiggle movement.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["movement", "joystick", "layout", "floating", "fixed", "controls", "bgmi"],
    tags: ["beginner", "movement", "controls"],
    skillLevel: "beginner",
    priority: 8,
    source: "manual"
  },
  {
    question: "How to improve movement in BGMI?",
    answer: "To improve movement, understand joystick layout properly. BGMI has 3 different joystick layouts: 1) Floating Joystick - Tapping anywhere on left side activates joystick, it's flexible and allows movement control from any position. 2) Fixed Joystick - Need to tap and drag precisely on joystick, gives precise control. 3) Custom Layout - Can customize joystick position according to preference. Stick with the layout that feels comfortable. Movement should be smooth and responsive - quick direction changes shouldn't be problematic. Practice different movements in training ground - strafing, peeking, jiggle movement.",
    topic: "rank",
    game: "bgmi",
    language: "english",
    keywords: ["movement", "joystick", "layout", "floating", "fixed", "controls", "bgmi"],
    tags: ["beginner", "movement", "controls"],
    skillLevel: "beginner",
    priority: 8,
    source: "manual"
  },
  {
    question: "BGMI mein joystick layout kaunsa best hai?",
    answer: "Joystick layout individual preference pe depend karta hai. Floating joystick beginners ke liye better hai kyunki left side pe kisi bhi jagah tap karne se operate hoti hai - flexible aur easy to use. Fixed joystick advanced players ke liye better hai kyunki precise control deta hai - exactly joystick pe tap karke drag karna padta hai. Custom layout sabse best hai agar aap apne controls aur grip ke hisaab se joystick position adjust karte ho. Important: Jo layout comfortable ho uspe stick karo, baar baar change mat karo. Layout change karne se muscle memory reset hoti hai.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["joystick", "layout", "floating", "fixed", "custom", "controls", "bgmi"],
    tags: ["beginner", "settings", "controls"],
    skillLevel: "beginner",
    priority: 7,
    source: "manual"
  },
  {
    question: "Which joystick layout is best in BGMI?",
    answer: "Joystick layout depends on individual preference. Floating joystick is better for beginners because tapping anywhere on left side activates it - flexible and easy to use. Fixed joystick is better for advanced players because it gives precise control - need to tap and drag exactly on joystick. Custom layout is best if you adjust joystick position according to your controls and grip. Important: Stick with the layout that feels comfortable, don't change frequently. Changing layout resets muscle memory.",
    topic: "aim",
    game: "bgmi",
    language: "english",
    keywords: ["joystick", "layout", "floating", "fixed", "custom", "controls", "bgmi"],
    tags: ["beginner", "settings", "controls"],
    skillLevel: "beginner",
    priority: 7,
    source: "manual"
  },
  {
    question: "BGMI mein rank kaise badhau?",
    answer: "Rank badhane ke liye finishes aur top 3 ana zaruri hai jisse zyada points milte hain. Solo rank push: Apna gun combination sahi rakho (AR + Sniper ya AR + DMR), vehicle sath rakho zone rotation ke liye, safe rotations karo, aur finishes pe focus karo. Duo rank push: Teammate ke saath coordination rakho, coverfire aur support dena zaruri hai, communication important hai. Squad rank push: High tier pe acchi squad hona zaruri hai kyunki coverfire aur support bahut important hai - ye ek team game hai. Squad mein roles assign karo (IGL, fragger, support), team coordination aur strategy follow karo. Important: Survival aur finishes dono pe focus karo - top 3 finish + kills = maximum points.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["rank", "push", "solo", "duo", "squad", "finishes", "top 3", "points", "bgmi"],
    tags: ["intermediate", "rank", "strategy"],
    skillLevel: "intermediate",
    priority: 10,
    source: "manual"
  },
  {
    question: "How to rank up in BGMI?",
    answer: "To rank up, finishes and top 3 placement are essential for maximum points. Solo rank push: Keep proper gun combination (AR + Sniper or AR + DMR), keep vehicle for zone rotation, make safe rotations, and focus on finishes. Duo rank push: Maintain coordination with teammate, coverfire and support are essential, communication is important. Squad rank push: Good squad is necessary at high tier because coverfire and support are very important - this is a team game. Assign roles in squad (IGL, fragger, support), follow team coordination and strategy. Important: Focus on both survival and finishes - top 3 finish + kills = maximum points.",
    topic: "rank",
    game: "bgmi",
    language: "english",
    keywords: ["rank", "push", "solo", "duo", "squad", "finishes", "top 3", "points", "bgmi"],
    tags: ["intermediate", "rank", "strategy"],
    skillLevel: "intermediate",
    priority: 10,
    source: "manual"
  },
  {
    question: "BGMI solo rank push kaise karein?",
    answer: "Solo rank push ke liye pehle apna gun combination sahi rakho - AR + Sniper ya AR + DMR best hai. Vehicle sath rakho zone rotation ke liye kyunki solo mein safe rotation bahut important hai. Finishes pe focus karo kyunki kills se zyada points milte hain. Top 3 finish zaruri hai maximum points ke liye. Safe drop location choose karo, early fights avoid karo, aur zone timing pe dhyan do. Vehicle se quick rotations karo aur cover use karo smartly.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["solo", "rank", "push", "gun combination", "vehicle", "zone rotation", "bgmi"],
    tags: ["intermediate", "solo", "rank"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI squad rank push kaise karein?",
    answer: "Squad rank push ke liye high tier pe acchi squad hona zaruri hai. Coverfire aur support bahut important hai kyunki ye ek team game hai. Squad mein roles assign karo - IGL (In-Game Leader) strategy decide karega, fragger entry kills lega, support coverfire dega. Team coordination aur communication zaruri hai. Finishes aur top 3 finish dono pe focus karo maximum points ke liye. Squad fights mein positioning aur timing important hai - ek saath push karo, isolated enemies ko target karo.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["squad", "rank", "push", "team", "coverfire", "support", "coordination", "bgmi"],
    tags: ["advanced", "squad", "rank"],
    skillLevel: "advanced",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI mein gyroscope sensitivity kaise set karein?",
    answer: "BGMI mein gyroscope 2 types ka hota hai - Gyro Camera aur Gyro ADS. Agar tum full gyro use karte ho (scope in ke baad aur without scope dono mein gyro) to dono sensitivity tumhare comfortable rehne ke liye set karna zaruri hai - Gyro Camera sensitivity (without scope) aur Gyro ADS sensitivity (scope in ke baad). Ye tumhe khud se karna padega kyunki har player ka comfortable sensitivity different hota hai. Agar tum sirf scope in gyro use karte ho to Gyro ADS sensitivity important rahegi. Training ground mein test karo - pehle default se start karo, phir gradually adjust karo jab tak comfortable na lage. Important: Ek baar comfortable sensitivity mil jaye to uspe stick karo.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["gyroscope", "sensitivity", "gyro camera", "gyro ads", "scope", "settings", "bgmi"],
    tags: ["intermediate", "settings", "gyroscope"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "How to set gyroscope sensitivity in BGMI?",
    answer: "In BGMI, gyroscope has 2 types - Gyro Camera and Gyro ADS. If you use full gyro (gyro with scope in and without scope both) then you need to set both sensitivities for your comfort - Gyro Camera sensitivity (without scope) and Gyro ADS sensitivity (with scope in). You need to do this yourself because each player's comfortable sensitivity is different. If you only use scope in gyro then Gyro ADS sensitivity will be important. Test in training ground - start with default, then gradually adjust until it feels comfortable. Important: Once you find comfortable sensitivity, stick with it.",
    topic: "aim",
    game: "bgmi",
    language: "english",
    keywords: ["gyroscope", "sensitivity", "gyro camera", "gyro ads", "scope", "settings", "bgmi"],
    tags: ["intermediate", "settings", "gyroscope"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI mein full gyro kaise use karein?",
    answer: "Full gyro matlab scope in ke baad aur without scope dono mein gyroscope use karna. Full gyro use karne ke liye dono sensitivity set karni zaruri hai - Gyro Camera sensitivity (normal aim ke liye) aur Gyro ADS sensitivity (scope in ke baad). Pehle Gyro Camera sensitivity set karo - without scope comfortable aim aana chahiye. Phir Gyro ADS sensitivity set karo - scope in ke baad recoil control aur tracking smooth honi chahiye. Training ground mein dono test karo aur gradually adjust karo. Full gyro advanced technique hai - pehle basic gyro pe hath baithao, phir full gyro try karo.",
    topic: "aim",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["full gyro", "gyro camera", "gyro ads", "sensitivity", "scope", "bgmi"],
    tags: ["advanced", "gyroscope", "settings"],
    skillLevel: "advanced",
    priority: 8,
    source: "manual"
  },
  {
    question: "BGMI mein best drop location kaunsi hai?",
    answer: "Drop location tumhare playstyle pe depend karti hai. Aggressive players ke liye hot drops (Pochinok, School, Military Base) better hain kyunki early fights aur loot milta hai. Passive players ke liye safe drops (small compounds, edge locations) better hain survival ke liye. Drop select karne ke baad important: 1) Uske aas paas ka vehicle spawn area ka knowledge rakho - zone rotation ke liye vehicle zaruri hai, 2) Compounds ka acche se knowledge rakho - kahan se enemies aa sakte hain, kahan cover hai, 3) Crossfire bithana - multiple angles se enemies ko target karo, 4) Drop clash strategy - agar drop clash hota hai to pehle loot karo, phir enemy ko clear karo, ya alternatively safe rotation karo. I can help you select your drop based on your playstyle - batao aap aggressive khelte ho ya passive? Baad mein BGMI tools ki help le sakte ho - rotation coach, interactive map wagera drop selection aur rotation planning ke liye.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["drop location", "playstyle", "vehicle spawn", "compounds", "crossfire", "clash", "bgmi"],
    tags: ["intermediate", "strategy", "drop"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "Which is the best drop location in BGMI?",
    answer: "Drop location depends on your playstyle. For aggressive players, hot drops (Pochinok, School, Military Base) are better because you get early fights and loot. For passive players, safe drops (small compounds, edge locations) are better for survival. After selecting drop, important: 1) Know vehicle spawn areas nearby - vehicle is essential for zone rotation, 2) Know compounds well - where enemies can come from, where cover is, 3) Set up crossfire - target enemies from multiple angles, 4) Drop clash strategy - if drop clash happens, loot first then clear enemy, or alternatively make safe rotation. I can help you select your drop based on your playstyle - tell me do you play aggressive or passive? Later you can use BGMI tools - rotation coach, interactive map etc. for drop selection and rotation planning.",
    topic: "rank",
    game: "bgmi",
    language: "english",
    keywords: ["drop location", "playstyle", "vehicle spawn", "compounds", "crossfire", "clash", "bgmi"],
    tags: ["intermediate", "strategy", "drop"],
    skillLevel: "intermediate",
    priority: 9,
    source: "manual"
  },
  {
    question: "BGMI mein drop clash kaise handle karein?",
    answer: "Drop clash handle karne ke liye pehle quick loot karo - weapon aur basic attachments zaruri hain. Agar enemy pehle weapon le leta hai to safe rotation karo, direct fight avoid karo. Agar tumhare pass weapon hai to enemy ko clear karo - positioning aur timing important hai. Crossfire bithao - multiple angles se attack karo. Compounds ka knowledge use karo - kahan cover hai, kahan enemies aa sakte hain. Vehicle spawn area ka knowledge rakho - agar clash tough hai to quick rotation karo. Important: Early game mein unnecessary fights avoid karo - survival priority hai rank push ke liye.",
    topic: "rank",
    game: "bgmi",
    language: "roman_hindi",
    keywords: ["drop clash", "loot", "rotation", "crossfire", "compounds", "bgmi"],
    tags: ["intermediate", "combat", "strategy"],
    skillLevel: "intermediate",
    priority: 8,
    source: "manual"
  }
];

// Add knowledge function
const addKnowledge = async () => {
  try {
    if (!process.argv.includes('--apply')) throw new Error('Refusing to seed the knowledge base without --apply');
    await connectDB();
    
    console.log('📝 Adding initial BGMI knowledge...');
    
    let added = 0;
    let skipped = 0;
    
    for (const knowledge of initialKnowledge) {
      // Check if already exists
      const existing = await GamingKnowledge.findOne({
        question: { $regex: new RegExp(knowledge.question, 'i') },
        language: knowledge.language,
        game: knowledge.game
      });
      
      if (existing) {
        console.log(`⏭️  Skipped (already exists): ${knowledge.question.substring(0, 50)}...`);
        skipped++;
        continue;
      }
      
      await GamingKnowledge.create(knowledge);
      console.log(`✅ Added: ${knowledge.question.substring(0, 50)}...`);
      added++;
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Added: ${added}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📝 Total: ${initialKnowledge.length}`);
    
    // Get stats
    const total = await GamingKnowledge.countDocuments({ isActive: true });
    console.log(`\n📚 Total knowledge in database: ${total}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error adding knowledge:', error);
    process.exit(1);
  }
};

// Run the script
addKnowledge();

