'use strict';

// ============================================================
//  TEAMS
// ============================================================
const TEAMS = {
  CSK:  { name:'Chennai Super Kings',         short:'CSK',  color:'#F9CD1C', text:'#1a1a2e', emoji:'🦁', captain:'Ruturaj Gaikwad',  ground:'MA Chidambaram, Chennai',          titles:5, strength:87, recentWins:3 },
  MI:   { name:'Mumbai Indians',              short:'MI',   color:'#0078BC', text:'#ffffff', emoji:'💙', captain:'Hardik Pandya',     ground:'Wankhede, Mumbai',                 titles:5, strength:85, recentWins:2 },
  RCB:  { name:'Royal Challengers Bengaluru', short:'RCB',  color:'#EC1C24', text:'#ffffff', emoji:'🔴', captain:'Faf du Plessis',    ground:'M Chinnaswamy, Bengaluru',         titles:0, strength:82, recentWins:3 },
  KKR:  { name:'Kolkata Knight Riders',       short:'KKR',  color:'#3A225D', text:'#FFD700', emoji:'⚔️', captain:'Shreyas Iyer',      ground:'Eden Gardens, Kolkata',            titles:3, strength:84, recentWins:4 },
  SRH:  { name:'Sunrisers Hyderabad',         short:'SRH',  color:'#FF822A', text:'#ffffff', emoji:'☀️', captain:'Pat Cummins',       ground:'Rajiv Gandhi Intl, Hyderabad',     titles:1, strength:83, recentWins:3 },
  PBKS: { name:'Punjab Kings',                short:'PBKS', color:'#ED1B24', text:'#ffffff', emoji:'🦅', captain:'Shikhar Dhawan',    ground:'IS Bindra, Mohali',                titles:0, strength:76, recentWins:2 },
  RR:   { name:'Rajasthan Royals',            short:'RR',   color:'#2D4CC8', text:'#ffffff', emoji:'👑', captain:'Sanju Samson',      ground:'SMS Stadium, Jaipur',              titles:2, strength:80, recentWins:2 },
  DC:   { name:'Delhi Capitals',              short:'DC',   color:'#0478BC', text:'#ffffff', emoji:'⚡', captain:'Rishabh Pant',      ground:'Arun Jaitley, Delhi',              titles:0, strength:79, recentWins:1 },
  GT:   { name:'Gujarat Titans',              short:'GT',   color:'#1B2133', text:'#7FB3D3', emoji:'🔱', captain:'Shubman Gill',      ground:'Narendra Modi, Ahmedabad',         titles:2, strength:82, recentWins:3 },
  LSG:  { name:'Lucknow Super Giants',        short:'LSG',  color:'#A72056', text:'#ffffff', emoji:'🦁', captain:'KL Rahul',          ground:'BRSABV Ekana, Lucknow',            titles:0, strength:78, recentWins:2 },
};

// ============================================================
//  PLAYERS  — batsmen & bowlers per team (IPL 2025 squads)
// ============================================================
const PLAYERS = {
  CSK:  { batsmen:['Ruturaj Gaikwad','Devon Conway','Shivam Dube','MS Dhoni','Rachin Ravindra'],   bowlers:['Deepak Chahar','Ravindra Jadeja','Matheesha Pathirana','Tushar Deshpande','Noor Ahmad'] },
  MI:   { batsmen:['Rohit Sharma','Suryakumar Yadav','Hardik Pandya','Tilak Varma','Naman Dhir'],  bowlers:['Jasprit Bumrah','Trent Boult','Gerald Coetzee','Nuwan Thushara','Piyush Chawla'] },
  RCB:  { batsmen:['Virat Kohli','Faf du Plessis','Glenn Maxwell','Rajat Patidar','Dinesh Karthik'],bowlers:['Mohammed Siraj','Josh Hazlewood','Karn Sharma','Yash Dayal','Akash Deep'] },
  KKR:  { batsmen:['Shreyas Iyer','Phil Salt','Rinku Singh','Sunil Narine','Andre Russell'],        bowlers:['Varun Chakravarthy','Mitchell Starc','Harshit Rana','Suyash Sharma','Anrich Nortje'] },
  SRH:  { batsmen:['Travis Head','Abhishek Sharma','Heinrich Klaasen','Aiden Markram','Pat Cummins'],bowlers:['Bhuvneshwar Kumar','T Natarajan','Shahbaz Ahmed','Mayank Markande','Fazalhaq Farooqi'] },
  PBKS: { batsmen:['Shikhar Dhawan','Jonny Bairstow','Liam Livingstone','Sam Curran','Jitesh Sharma'],bowlers:['Kagiso Rabada','Arshdeep Singh','Harshal Patel','Nathan Ellis','Rahul Chahar'] },
  RR:   { batsmen:['Yashasvi Jaiswal','Jos Buttler','Sanju Samson','Shimron Hetmyer','Rovman Powell'],bowlers:['Yuzvendra Chahal','Trent Boult','Sandeep Sharma','Adam Zampa','Kuldeep Sen'] },
  DC:   { batsmen:['David Warner','Jake Fraser-McGurk','Rishabh Pant','Axar Patel','Mitchell Marsh'],bowlers:['Anrich Nortje','Mukesh Kumar','Khaleel Ahmed','Kuldeep Yadav','Ishant Sharma'] },
  GT:   { batsmen:['Shubman Gill','David Miller','Wriddhiman Saha','Vijay Shankar','B Sai Sudharsan'],bowlers:['Rashid Khan','Mohammed Shami','Mohit Sharma','Noor Ahmad','Azmatullah Omarzai'] },
  LSG:  { batsmen:['KL Rahul','Quinton de Kock','Nicholas Pooran','Deepak Hooda','Marcus Stoinis'],   bowlers:['Mark Wood','Ravi Bishnoi','Krunal Pandya','Mohsin Khan','Naveen-ul-Haq'] },
};

// ============================================================
//  HEAD-TO-HEAD RECORDS  (team1_team2 → wins for each)
// ============================================================
const H2H = {
  'CSK_MI':  { t1:22, t2:20 }, 'MI_CSK':  { t1:20, t2:22 },
  'CSK_RCB': { t1:21, t2:11 }, 'RCB_CSK': { t1:11, t2:21 },
  'CSK_KKR': { t1:19, t2:14 }, 'KKR_CSK': { t1:14, t2:19 },
  'MI_RCB':  { t1:19, t2:17 }, 'RCB_MI':  { t1:17, t2:19 },
  'MI_KKR':  { t1:18, t2:16 }, 'KKR_MI':  { t1:16, t2:18 },
  'SRH_CSK': { t1:11, t2:14 }, 'CSK_SRH': { t1:14, t2:11 },
  'SRH_MI':  { t1:10, t2:13 }, 'MI_SRH':  { t1:13, t2:10 },
  'RR_CSK':  { t1:12, t2:14 }, 'CSK_RR':  { t1:14, t2:12 },
  'RR_MI':   { t1:14, t2:12 }, 'MI_RR':   { t1:12, t2:14 },
  'KKR_RCB': { t1:20, t2:14 }, 'RCB_KKR': { t1:14, t2:20 },
  'GT_CSK':  { t1:3,  t2:3  }, 'CSK_GT':  { t1:3,  t2:3  },
  'GT_MI':   { t1:2,  t2:3  }, 'MI_GT':   { t1:3,  t2:2  },
  'LSG_CSK': { t1:4,  t2:4  }, 'CSK_LSG': { t1:4,  t2:4  },
  'LSG_MI':  { t1:3,  t2:4  }, 'MI_LSG':  { t1:4,  t2:3  },
  'DC_CSK':  { t1:12, t2:14 }, 'CSK_DC':  { t1:14, t2:12 },
  'PBKS_MI': { t1:11, t2:12 }, 'MI_PBKS': { t1:12, t2:11 },
};

// ============================================================
//  VENUES
// ============================================================
const VENUES = {
  'MA Chidambaram, Chennai':          { city:'Chennai',   pitchType:'Spin-friendly',  avgScore:170, homeTeam:'CSK' },
  'Wankhede, Mumbai':                 { city:'Mumbai',    pitchType:'Batting-friendly',avgScore:185, homeTeam:'MI' },
  'M Chinnaswamy, Bengaluru':         { city:'Bengaluru', pitchType:'High-scoring',   avgScore:190, homeTeam:'RCB' },
  'Eden Gardens, Kolkata':            { city:'Kolkata',   pitchType:'Balanced',       avgScore:175, homeTeam:'KKR' },
  'Rajiv Gandhi Intl, Hyderabad':     { city:'Hyderabad', pitchType:'Batting-friendly',avgScore:182, homeTeam:'SRH' },
  'IS Bindra, Mohali':                { city:'Mohali',    pitchType:'Batting-friendly',avgScore:178, homeTeam:'PBKS' },
  'SMS Stadium, Jaipur':              { city:'Jaipur',    pitchType:'Balanced',       avgScore:172, homeTeam:'RR' },
  'Arun Jaitley, Delhi':              { city:'Delhi',     pitchType:'Batting-friendly',avgScore:180, homeTeam:'DC' },
  'Narendra Modi, Ahmedabad':         { city:'Ahmedabad', pitchType:'Low & slow',     avgScore:168, homeTeam:'GT' },
  'BRSABV Ekana, Lucknow':            { city:'Lucknow',   pitchType:'Batting-friendly',avgScore:176, homeTeam:'LSG' },
};

// ============================================================
//  MATCH SCHEDULE  (generated relative to today in app.js)
// ============================================================
const MATCH_TEMPLATE = [
  { t1:'CSK',  t2:'MI',   venue:'Wankhede, Mumbai',                 time:'19:30', daysFromNow:-3 },
  { t1:'RCB',  t2:'KKR',  venue:'M Chinnaswamy, Bengaluru',         time:'15:30', daysFromNow:-2 },
  { t1:'SRH',  t2:'GT',   venue:'Rajiv Gandhi Intl, Hyderabad',     time:'19:30', daysFromNow:-1 },
  { t1:'RR',   t2:'DC',   venue:'SMS Stadium, Jaipur',              time:'19:30', daysFromNow: 0 },
  { t1:'MI',   t2:'KKR',  venue:'Wankhede, Mumbai',                 time:'19:30', daysFromNow: 1 },
  { t1:'CSK',  t2:'RCB',  venue:'MA Chidambaram, Chennai',          time:'19:30', daysFromNow: 2 },
  { t1:'PBKS', t2:'LSG',  venue:'IS Bindra, Mohali',                time:'19:30', daysFromNow: 3 },
  { t1:'GT',   t2:'RR',   venue:'Narendra Modi, Ahmedabad',         time:'15:30', daysFromNow: 4 },
  { t1:'SRH',  t2:'DC',   venue:'Rajiv Gandhi Intl, Hyderabad',     time:'19:30', daysFromNow: 5 },
  { t1:'MI',   t2:'CSK',  venue:'Wankhede, Mumbai',                 time:'19:30', daysFromNow: 6 },
  { t1:'KKR',  t2:'RCB',  venue:'Eden Gardens, Kolkata',            time:'19:30', daysFromNow: 7 },
  { t1:'LSG',  t2:'SRH',  venue:'BRSABV Ekana, Lucknow',           time:'15:30', daysFromNow: 8 },
];

// Completed match results (for daysFromNow < 0)
const COMPLETED_RESULTS = [
  { winner:'MI',  score1:'182/6 (20)',  score2:'176/8 (20)',  mom:'Rohit Sharma',       momscore:'68(42)' },
  { winner:'KKR', score1:'198/4 (20)',  score2:'183/7 (20)',  mom:'Andre Russell',      momscore:'54(22) & 3/28' },
  { winner:'SRH', score1:'201/5 (20)',  score2:'188/6 (20)',  mom:'Travis Head',        momscore:'92(47)' },
];

// Live match state
const LIVE_STATE = {
  innings:1, batting:'RR', bowling:'DC',
  score:'148/4', overs:'17.2',
  target: null,
  lastWicket:'Sanju Samson c Pant b Nortje 67(44)',
  recentBalls:['1','4','W','2','1','6'],
  batsmen:[
    { name:'Shimron Hetmyer', runs:38, balls:18, fours:3, sixes:3 },
    { name:'Rovman Powell',   runs:12, balls:8,  fours:1, sixes:1 },
  ],
  bowler:{ name:'Anrich Nortje', overs:'3.2', wickets:2, runs:28 },
  projectedScore: 188,
};

// ============================================================
//  SIMULATED LEADERBOARD USERS
// ============================================================
const MOCK_USERS = [
  { name:'Ravi Kumar',     team:'CSK',  points:840, coins:1200, accuracy:73, avatar:'👨' },
  { name:'Priya Sharma',   team:'MI',   points:795, coins:950,  accuracy:68, avatar:'👩' },
  { name:'Arjun Nair',     team:'RCB',  points:760, coins:880,  accuracy:65, avatar:'🧑' },
  { name:'Sneha Patel',    team:'KKR',  points:720, coins:1050, accuracy:63, avatar:'👩' },
  { name:'Vikram Singh',   team:'SRH',  points:695, coins:820,  accuracy:60, avatar:'👨' },
  { name:'Ananya Reddy',   team:'GT',   points:670, coins:780,  accuracy:59, avatar:'👩' },
  { name:'Kartik Menon',   team:'RR',   points:640, coins:700,  accuracy:57, avatar:'🧑' },
  { name:'Divya Iyer',     team:'DC',   points:610, coins:650,  accuracy:55, avatar:'👩' },
  { name:'Siddharth Rao',  team:'PBKS', points:580, coins:600,  accuracy:52, avatar:'👨' },
  { name:'Meera Joshi',    team:'LSG',  points:545, coins:560,  accuracy:50, avatar:'👩' },
];

// ============================================================
//  POINTS SYSTEM
// ============================================================
const POINTS = {
  correctWinner:    50,
  correctTopBatter: 30,
  correctTopBowler: 30,
  perfectCombo:     50, // bonus for all 3 correct
};

// ============================================================
//  WEATHER CONDITIONS
// ============================================================
const WEATHER_OPTIONS = ['Clear & Hot ☀️','Partly Cloudy ⛅','Humid 🌧️','Overcast 🌥️','Evening Dew 🌙'];

// ============================================================
//  AI PREDICTION ENGINE
// ============================================================
function predictWinProbability(t1, t2, venue) {
  const team1 = TEAMS[t1];
  const team2 = TEAMS[t2];
  if (!team1 || !team2) return { t1: 50, t2: 50 };

  let s1 = team1.strength;
  let s2 = team2.strength;

  // Home advantage
  const v = VENUES[venue];
  if (v) {
    if (v.homeTeam === t1) s1 += 6;
    if (v.homeTeam === t2) s2 += 6;
  }

  // H2H
  const key = `${t1}_${t2}`;
  const h2h = H2H[key];
  if (h2h) {
    const total = h2h.t1 + h2h.t2;
    if (total > 0) {
      s1 += ((h2h.t1 / total) - 0.5) * 15;
      s2 += ((h2h.t2 / total) - 0.5) * 15;
    }
  }

  // Recent form
  s1 += team1.recentWins * 1.5;
  s2 += team2.recentWins * 1.5;

  // Randomise slightly for realism
  s1 += (Math.random() * 4 - 2);
  s2 += (Math.random() * 4 - 2);

  const total = s1 + s2;
  const p1 = Math.min(Math.max(Math.round((s1 / total) * 100), 20), 80);
  return { t1: p1, t2: 100 - p1 };
}

function getKeyFactors(t1, t2, venue) {
  const v = VENUES[venue] || {};
  const h2h = H2H[`${t1}_${t2}`] || { t1: 5, t2: 5 };
  const t1H2H = h2h.t1, t2H2H = h2h.t2;
  const weather = WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)];

  return [
    { label:'Pitch',          value: v.pitchType || 'Balanced',                          icon:'🏏' },
    { label:'Avg Score Here', value: (v.avgScore || 175) + ' runs',                       icon:'📊' },
    { label:'Head-to-Head',   value: `${t1} ${t1H2H} — ${t2H2H} ${t2}`,                  icon:'⚔️' },
    { label:'Weather',        value: weather,                                              icon:'🌤️' },
    { label:`${t1} Form`,     value: `Won ${TEAMS[t1]?.recentWins || 2}/5 recent`,         icon:'📈' },
    { label:`${t2} Form`,     value: `Won ${TEAMS[t2]?.recentWins || 2}/5 recent`,         icon:'📈' },
  ];
}

function getPredictedPerformers(t1, t2) {
  const t1Players = PLAYERS[t1] || { batsmen:[], bowlers:[] };
  const t2Players = PLAYERS[t2] || { batsmen:[], bowlers:[] };
  const allBatsmen = [...t1Players.batsmen, ...t2Players.batsmen];
  const allBowlers = [...t1Players.bowlers, ...t2Players.bowlers];
  return {
    topBatter: allBatsmen[Math.floor(Math.random() * Math.min(4, allBatsmen.length))],
    topBowler: allBowlers[Math.floor(Math.random() * Math.min(4, allBowlers.length))],
    darkHorse: allBatsmen[Math.floor(Math.random() * allBatsmen.length)],
  };
}
