'use strict';

// ============================================================
//  STATE
// ============================================================
const STORAGE_KEY = 'ipl_arena_v1';

let state = {
  user: {
    name: 'Cricket Fan',
    team: null,
    coins: 500,
    points: 0,
    correctPredictions: 0,
    totalPredictions: 0,
  },
  predictions: {},   // matchId -> { winner, topBatter, topBowler, locked, result }
  chatMessages: {},  // matchId -> [{ text, user, mine, time }]
};

// ============================================================
//  MATCH SCHEDULE (generated relative to today)
// ============================================================
let MATCHES = [];

function buildMatches() {
  const today = new Date();
  MATCHES = MATCH_TEMPLATE.map((m, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + m.daysFromNow);
    const dateStr = d.toISOString().slice(0, 10);
    const isPast   = m.daysFromNow < 0;
    const isLive   = !!m.isLive;
    const status   = isPast ? 'completed' : isLive ? 'live' : 'upcoming';
    const result   = isPast ? COMPLETED_RESULTS[i] || COMPLETED_RESULTS[0] : null;

    return {
      id: `m${i + 1}`,
      t1: m.t1, t2: m.t2,
      venue: m.venue,
      date: dateStr,
      time: m.time,
      status,
      isLive,
      result,
      daysFromNow: m.daysFromNow,
    };
  });
}

// ============================================================
//  PERSISTENCE
// ============================================================
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      state.user         = { ...state.user, ...p.user };
      state.predictions  = p.predictions  || {};
      state.chatMessages = p.chatMessages || {};
    }
  } catch (e) { console.error(e); }
}

// ============================================================
//  UTILITIES
// ============================================================
function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(iso) {
  const [y,m,d] = iso.split('-');
  return new Date(+y,+m-1,+d).toLocaleDateString('en-IN',{ day:'numeric', month:'short' });
}
function todayIso() { return new Date().toISOString().slice(0,10); }

// ============================================================
//  NAVIGATION
// ============================================================
let activeView = 'home';
let prevMatchesView = 'home';
let currentMatchRoomId = null;

function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if (view === 'home')        renderHome();
  if (view === 'matches')     renderMatchesList('upcoming');
  if (view === 'leaderboard') renderLeaderboard();
  if (view === 'chat')        renderChat();
  if (view === 'analytics')   renderAnalytics();
}

// ============================================================
//  ONBOARDING
// ============================================================
function renderOnboarding() {
  const grid = document.getElementById('team-picker');
  grid.innerHTML = Object.entries(TEAMS).map(([key, t]) => `
    <button class="team-pick-btn" data-team="${key}" style="border-color: ${t.color}33">
      <span class="t-emoji">${t.emoji}</span>
      <span class="t-short" style="color:${t.color}">${t.short}</span>
      <span class="t-name">${t.name.split(' ').slice(-1)[0]}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.team-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.user.team = btn.dataset.team;
      save();
      document.getElementById('onboarding').style.display = 'none';
      updateTopbarTeam();
      renderHome();
    });
  });
}

// ============================================================
//  TOPBAR UPDATES
// ============================================================
function updateTopbar() {
  document.getElementById('coin-count').textContent   = state.user.coins.toLocaleString('en-IN');
  document.getElementById('points-count').textContent = state.user.points.toLocaleString('en-IN');
  document.getElementById('h-coins').textContent      = state.user.coins.toLocaleString('en-IN');
  document.getElementById('h-points').textContent     = state.user.points.toLocaleString('en-IN');

  const totalP = state.user.totalPredictions;
  const acc    = totalP > 0 ? Math.round((state.user.correctPredictions / totalP) * 100) : 0;
  document.getElementById('h-accuracy').textContent = acc + '%';

  // Rank (based on points among mock users + user)
  const allPts = MOCK_USERS.map(u => u.points).concat([state.user.points]).sort((a,b) => b-a);
  const rank   = allPts.indexOf(state.user.points) + 1;
  document.getElementById('h-rank').textContent = '#' + rank;
  updateTopbarTeam();
}

function updateTopbarTeam() {
  const teamEl = document.getElementById('topbar-team');
  if (state.user.team && TEAMS[state.user.team]) {
    const t = TEAMS[state.user.team];
    teamEl.style.display = '';
    teamEl.innerHTML = `${t.emoji} <span style="color:${t.color}">${t.short}</span>`;
  }
}

// ============================================================
//  RENDER HOME
// ============================================================
function renderHome() {
  updateTopbar();

  // Live banner
  const liveBanner = document.getElementById('live-banner');
  const liveMatch  = MATCHES.find(m => m.isLive);
  if (liveMatch) {
    liveBanner.style.display = '';
    document.getElementById('live-teams-text').textContent =
      `${TEAMS[liveMatch.t1].emoji} ${liveMatch.t1} vs ${liveMatch.t2} ${TEAMS[liveMatch.t2].emoji}`;
    if (liveMatch.apiScore?.length) {
      document.getElementById('live-score-text').textContent =
        liveMatch.apiScore.map(s => `${s.inning.split(' ')[0]} ${s.r}/${s.w} (${s.o} ov)`).join('  |  ');
    } else {
      document.getElementById('live-score-text').textContent =
        `${LIVE_STATE.score} (${LIVE_STATE.overs} ov)`;
    }
    document.getElementById('btn-watch-live').onclick = () => openMatchRoom(liveMatch.id);
  } else {
    liveBanner.style.display = 'none';
  }

  // Upcoming match cards (next 4)
  const upcoming = MATCHES.filter(m => m.status === 'upcoming' || m.isLive).slice(0, 4);
  const container = document.getElementById('home-match-cards');
  container.innerHTML = upcoming.map(m => matchCardHTML(m)).join('');
  container.querySelectorAll('.match-card').forEach(el => {
    el.addEventListener('click', () => openMatchRoom(el.dataset.matchId));
  });

  // My predictions
  renderMyPredictions();
}

function matchScoreBlock(m) {
  if (m.isLive && m.apiScore?.length) {
    const rows = m.apiScore.map(s => {
      const code = findTeamCode(s.inning) || s.inning.split(' ')[0];
      return `<div style="display:flex;justify-content:space-between;padding:2px 0">
        <span style="color:var(--muted);font-size:0.75rem">${escH(code)}</span>
        <span style="font-weight:700;font-size:0.9rem">${s.r}/${s.w}</span>
        <span style="color:var(--muted);font-size:0.75rem">(${s.o} ov)</span>
      </div>`;
    }).join('');
    const chase = m.apiStatus ? `<div style="margin-top:5px;font-size:0.75rem;color:var(--gold);font-weight:600">${escH(m.apiStatus)}</div>` : '';
    return `<div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:6px 10px;margin:6px 0">${rows}${chase}</div>`;
  }
  if (m.status === 'completed' && m.result) {
    return `<div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:6px 10px;margin:6px 0;font-size:0.78rem">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">${escH(m.t1)}</span><span style="font-weight:600">${escH(m.result.score1)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">${escH(m.t2)}</span><span style="font-weight:600">${escH(m.result.score2)}</span></div>
      <div style="margin-top:4px;color:var(--gold);font-size:0.72rem;font-weight:600">🏆 ${escH(m.result.winner)} won · MOM: ${escH(m.result.mom)} ${escH(m.result.momscore)}</div>
    </div>`;
  }
  return '';
}

function matchCardHTML(m) {
  const t1 = TEAMS[m.t1], t2 = TEAMS[m.t2];
  const pred  = state.predictions[m.id];
  const isLive = m.isLive;
  return `
    <div class="match-card ${isLive ? 'live-card':''}" data-match-id="${m.id}">
      <div class="match-status">${isLive ? '<span class="live-tag">🔴 LIVE</span>' : fmtDate(m.date) + ' · ' + m.time}</div>
      <div class="match-teams">
        <div class="match-team">
          <span class="match-team-emoji">${t1.emoji}</span>
          <div class="match-team-name" style="color:${t1.color}">${m.t1}</div>
        </div>
        <div class="match-vs">VS</div>
        <div class="match-team">
          <span class="match-team-emoji">${t2.emoji}</span>
          <div class="match-team-name" style="color:${t2.color}">${m.t2}</div>
        </div>
      </div>
      ${matchScoreBlock(m)}
      <div class="match-meta">📍 ${m.venue.split(',')[0]}</div>
      ${pred?.locked
        ? `<div class="already-predicted">✅ Predicted: ${pred.winner}</div>`
        : `<button class="btn-predict">🎯 Predict & Win 130 pts</button>`
      }
    </div>`;
}

function renderMyPredictions() {
  const list = document.getElementById('my-predictions-list');
  const preds = Object.entries(state.predictions);
  if (preds.length === 0) {
    list.innerHTML = '<div class="empty-msg">No predictions yet. Pick a match and start predicting! 🏏</div>';
    return;
  }
  list.innerHTML = preds.map(([mid, p]) => {
    const m = MATCHES.find(x => x.id === mid);
    if (!m) return '';
    let statusClass = 'pending', statusText = '⏳ Pending';
    if (m.status === 'completed' && m.result) {
      const won = p.winner === m.result.winner;
      if (won) { statusClass = 'won'; statusText = '✅ Won'; }
      else     { statusClass = 'lost'; statusText = '❌ Lost'; }
    }
    return `
      <div class="prediction-item">
        <div class="pred-match">${m.t1} vs ${m.t2}</div>
        <div class="pred-picks">🏆 ${escH(p.winner)} · 🏏 ${escH(p.topBatter||'—')} · 🎳 ${escH(p.topBowler||'—')}</div>
        <div class="pred-status ${statusClass}">${statusText}</div>
        ${p.pointsEarned ? `<div class="pred-pts">+${p.pointsEarned} pts</div>` : ''}
      </div>`;
  }).join('');
}

// ============================================================
//  RENDER MATCHES LIST
// ============================================================
function renderMatchesList(tab) {
  document.querySelectorAll('#matches-tabs .pill').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === tab);
  });

  let filtered = tab === 'upcoming'  ? MATCHES.filter(m => m.status === 'upcoming')
               : tab === 'live'      ? MATCHES.filter(m => m.status === 'live')
               : MATCHES.filter(m => m.status === 'completed');

  const container = document.getElementById('matches-list');
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-msg">No ${tab} matches.</div>`;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const t1 = TEAMS[m.t1], t2 = TEAMS[m.t2];
    const statusLabel = m.isLive ? 'live' : m.status;
    const pred = state.predictions[m.id];
    return `
      <div class="match-list-item" data-match-id="${m.id}">
        <div class="mli-date">${fmtDate(m.date)}<br>${m.time}</div>
        <div class="mli-teams">
          <div class="mli-team">${t1.emoji} <span style="color:${t1.color}">${m.t1}</span></div>
          <div class="mli-vs">VS</div>
          <div class="mli-team"><span style="color:${t2.color}">${m.t2}</span> ${t2.emoji}</div>
        </div>
        <div class="mli-venue">📍 ${m.venue}</div>
        ${matchScoreBlock(m)}
        <span class="mli-status ${statusLabel}">${statusLabel.toUpperCase()}</span>
        ${m.status !== 'completed'
          ? `<button class="mli-predict-btn">${pred?.locked ? '✅ Predicted' : '🎯 Predict'}</button>`
          : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('.match-list-item').forEach(el => {
    el.addEventListener('click', () => { prevMatchesView = 'matches'; openMatchRoom(el.dataset.matchId); });
  });
}

// ============================================================
//  MATCH ROOM
// ============================================================
function openMatchRoom(matchId) {
  const m = MATCHES.find(x => x.id === matchId);
  if (!m) return;
  prevMatchesView = activeView;
  currentMatchRoomId = matchId;
  setViewDirect('matchroom');
  renderMatchRoom(m);
}

function setViewDirect(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
}

function renderMatchRoom(m) {
  const t1 = TEAMS[m.t1], t2 = TEAMS[m.t2];
  const prob  = predictWinProbability(m.t1, m.t2, m.venue);
  const factors = getKeyFactors(m.t1, m.t2, m.venue);
  const performers = getPredictedPerformers(m.t1, m.t2);
  const pred  = state.predictions[m.id] || {};
  const allBatsmen = [...(PLAYERS[m.t1]?.batsmen||[]), ...(PLAYERS[m.t2]?.batsmen||[])];
  const allBowlers = [...(PLAYERS[m.t1]?.bowlers||[]), ...(PLAYERS[m.t2]?.bowlers||[])];

  const batOptions = allBatsmen.map(p => `<option value="${escH(p)}">${escH(p)}</option>`).join('');
  const bowOptions = allBowlers.map(p => `<option value="${escH(p)}">${escH(p)}</option>`).join('');

  const isLocked = !!pred.locked;
  const isPast   = m.status === 'completed';

  document.getElementById('matchroom-content').innerHTML = `
    <!-- Header -->
    <div class="matchroom-header">
      ${m.isLive ? '<div class="mr-status-live">🔴 LIVE NOW</div>' : ''}
      <div class="mr-teams-row">
        <div class="mr-team">
          <div class="mr-emoji">${t1.emoji}</div>
          <div class="mr-name" style="color:${t1.color}">${t1.name}</div>
        </div>
        <div class="mr-vs">VS</div>
        <div class="mr-team">
          <div class="mr-emoji">${t2.emoji}</div>
          <div class="mr-name" style="color:${t2.color}">${t2.name}</div>
        </div>
      </div>
      <div class="mr-meta">📍 ${m.venue} &nbsp;·&nbsp; 📅 ${fmtDate(m.date)} ${m.time}</div>
      ${m.result ? `<div style="margin-top:10px;font-size:0.85rem;color:var(--gold)">🏆 ${m.result.winner} won · MOM: ${m.result.mom} ${m.result.momscore}</div>` : ''}
    </div>

    <div class="matchroom-grid">

      <!-- AI PREDICTOR PANEL -->
      <div class="predictor-panel">
        <h3>🤖 AI Win Probability</h3>

        <div class="prob-row">
          <div class="prob-team-name">${escH(m.t1)}</div>
          <div class="prob-bar-wrap">
            <div class="prob-bar-fill t1" style="width:${prob.t1}%">${prob.t1}%</div>
          </div>
          <div class="prob-team-name right">${escH(m.t2)}</div>
        </div>
        <div class="prob-row" style="margin-top:-10px;margin-bottom:20px">
          <div class="prob-team-name" style="text-align:center;width:80px;font-size:0.72rem;color:var(--muted)"></div>
          <div class="prob-bar-wrap">
            <div class="prob-bar-fill t2" style="width:${prob.t2}%;float:right">${prob.t2}%</div>
          </div>
          <div class="prob-team-name" style="width:80px"></div>
        </div>

        <h3 style="margin-bottom:10px">📋 Key Factors</h3>
        <div class="factors-grid">
          ${factors.map(f => `
            <div class="factor-item">
              <div class="factor-label">${f.icon} ${escH(f.label)}</div>
              <div class="factor-value">${escH(f.value)}</div>
            </div>`).join('')}
        </div>

        <div class="performers-box">
          <h4>🌟 AI Predicted Performers</h4>
          <div class="perf-row">
            <span class="perf-label">Top Batter</span>
            <span class="perf-name">🏏 ${escH(performers.topBatter)}</span>
          </div>
          <div class="perf-row">
            <span class="perf-label">Top Bowler</span>
            <span class="perf-name">🎳 ${escH(performers.topBowler)}</span>
          </div>
          <div class="perf-row">
            <span class="perf-label">Dark Horse</span>
            <span class="perf-name">⚡ ${escH(performers.darkHorse)}</span>
          </div>
        </div>
      </div>

      <!-- PREDICTION PANEL -->
      <div class="prediction-panel" id="pred-panel-${m.id}">
        <h3>🎯 Your Prediction</h3>

        ${isPast && !isLocked ? `<div class="prediction-locked-msg">⏰ Match completed — predictions closed</div>` : ''}

        ${isLocked ? `
          <div class="prediction-locked-msg">
            ✅ Prediction Locked!<br>
            <span style="font-size:0.8rem;color:var(--muted);font-weight:400">
              Winner: ${escH(pred.winner)} · Batter: ${escH(pred.topBatter||'—')} · Bowler: ${escH(pred.topBowler||'—')}
            </span>
          </div>
        ` : !isPast ? `
          <div class="pred-section">
            <div class="pred-label">Pick Match Winner</div>
            <div class="team-options">
              <button class="opt-btn ${pred.winner===m.t1?'selected':''}" id="pick-t1-${m.id}" data-team="${m.t1}">
                ${t1.emoji} ${m.t1}
              </button>
              <button class="opt-btn ${pred.winner===m.t2?'selected':''}" id="pick-t2-${m.id}" data-team="${m.t2}">
                ${t2.emoji} ${m.t2}
              </button>
            </div>
          </div>

          <div class="pred-section">
            <div class="pred-label">Top Batter 🏏</div>
            <select class="input-field player-select" id="pick-batter-${m.id}">
              <option value="">— Select Player —</option>
              ${batOptions}
            </select>
          </div>

          <div class="pred-section">
            <div class="pred-label">Top Bowler 🎳</div>
            <select class="input-field player-select" id="pick-bowler-${m.id}">
              <option value="">— Select Player —</option>
              ${bowOptions}
            </select>
          </div>

          <div class="points-preview">
            Potential: <strong>130 pts</strong> + 🪙 50 coins if all correct!
          </div>

          <button class="btn-lock-prediction" id="btn-lock-${m.id}">
            🔒 Lock My Prediction
          </button>
        ` : ''}
      </div>

      <!-- LIVE SCORECARD (only when live) -->
      ${m.isLive ? `
        <div class="live-scorecard">
          <h3>🔴 LIVE SCORECARD</h3>
          ${m.apiScore?.length ? `
            ${m.apiScore.map((s, i) => `
              <div style="margin-bottom:${i === 0 ? '12px' : '4px'}">
                <div style="font-size:0.72rem;color:var(--muted);margin-bottom:2px">${escH(s.inning)}</div>
                <span class="score-main">${s.r}/${s.w}</span>
                <span class="score-overs">(${s.o} overs)</span>
              </div>`).join('')}
            <div style="margin-top:12px;padding:10px;background:rgba(255,200,0,0.08);border-radius:8px;font-size:0.9rem;font-weight:600;color:var(--gold)">
              ${escH(m.apiStatus || '')}
            </div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
              <button id="btn-refresh-score" style="font-size:0.78rem;padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer">↻ Refresh</button>
              <span style="font-size:0.7rem;color:var(--muted)">Auto-refreshes every 60s</span>
            </div>
          ` : `
            <div>
              <span class="score-main">${LIVE_STATE.batting} ${LIVE_STATE.score}</span>
              <span class="score-overs">(${LIVE_STATE.overs} overs)</span>
            </div>
            <table class="batsmen-table">
              <tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr>
              ${LIVE_STATE.batsmen.map(b => `
                <tr>
                  <td>${escH(b.name)} ${b === LIVE_STATE.batsmen[0] ? '🏏' : ''}</td>
                  <td><strong>${b.runs}</strong></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td>
                </tr>`).join('')}
            </table>
            <div style="margin-top:10px;font-size:0.78rem;color:var(--muted)">
              Bowling: ${escH(LIVE_STATE.bowler.name)} ${LIVE_STATE.bowler.overs}-${LIVE_STATE.bowler.wickets}-${LIVE_STATE.bowler.runs}
            </div>
            <div style="margin-top:8px;font-size:0.75rem;color:var(--muted)">Recent: </div>
            <div class="recent-balls">
              ${LIVE_STATE.recentBalls.map(b => `
                <div class="ball ${b==='6'?'six':b==='4'?'four':b==='W'?'wicket':''}">${b}</div>
              `).join('')}
            </div>
            <div style="margin-top:8px;font-size:0.78rem;color:var(--muted)">Projected Total: <strong style="color:var(--gold)">${LIVE_STATE.projectedScore}</strong></div>
          `}
        </div>
      ` : ''}

    </div>`;

  // Bind winner pick buttons
  document.querySelectorAll(`[id^="pick-t1-${m.id}"], [id^="pick-t2-${m.id}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.predictions[m.id]) state.predictions[m.id] = {};
      state.predictions[m.id].winner = btn.dataset.team;
      document.querySelectorAll(`[id^="pick-t1-${m.id}"], [id^="pick-t2-${m.id}"]`).forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Pre-fill selects if predictions exist
  if (pred.topBatter) { const el = document.getElementById(`pick-batter-${m.id}`); if(el) el.value = pred.topBatter; }
  if (pred.topBowler) { const el = document.getElementById(`pick-bowler-${m.id}`); if(el) el.value = pred.topBowler; }

  // Lock button
  const lockBtn = document.getElementById(`btn-lock-${m.id}`);
  if (lockBtn) {
    lockBtn.addEventListener('click', () => lockPrediction(m));
  }

  // Manual refresh button (live scorecard)
  const refreshBtn = document.getElementById('btn-refresh-score');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = '↻ Refreshing…';
      refreshBtn.disabled = true;
      fetchAndUpdateLiveMatches().finally(() => {
        refreshBtn.textContent = '↻ Refresh';
        refreshBtn.disabled = false;
      });
    });
  }
}

function lockPrediction(m) {
  const pred = state.predictions[m.id] || {};
  const winner   = pred.winner || (document.querySelector(`[id^="pick-t1-${m.id}"].selected`)?.dataset.team);
  const topBatter = document.getElementById(`pick-batter-${m.id}`)?.value;
  const topBowler = document.getElementById(`pick-bowler-${m.id}`)?.value;

  if (!winner) {
    showResult('⚠️', 'Pick a Winner!', 'Please select which team will win.', 0);
    return;
  }

  state.predictions[m.id] = { winner, topBatter, topBowler, locked: true, lockedAt: new Date().toISOString() };
  state.user.totalPredictions++;
  state.user.coins += 10; // coins for participating
  save();
  updateTopbar();

  showResult('🎉', 'Prediction Locked!', `You picked ${winner} to win! 🏏 Good luck!`, 10);
  setTimeout(() => renderMatchRoom(m), 100);
}

// Simulate result evaluation for completed matches
function evaluatePredictions() {
  MATCHES.filter(m => m.status === 'completed' && m.result).forEach(m => {
    const pred = state.predictions[m.id];
    if (!pred || pred.evaluated) return;
    let pts = 0;
    let correct = 0;
    if (pred.winner === m.result.winner) { pts += POINTS.correctWinner; correct++; }
    if (pred.topBatter && m.result.mom && pred.topBatter === m.result.mom) { pts += POINTS.correctTopBatter; correct++; }
    if (correct === 2) pts += POINTS.perfectCombo;

    if (pts > 0) {
      state.user.points += pts;
      state.user.coins  += pts;
      state.user.correctPredictions += correct;
      pred.pointsEarned = pts;
    }
    pred.evaluated = true;
  });
  save();
}

// ============================================================
//  LEADERBOARD
// ============================================================
function renderLeaderboard() {
  updateTopbar();
  const allPts = MOCK_USERS.map(u => u.points).concat([state.user.points]).sort((a,b) => b-a);
  const userRank = allPts.indexOf(state.user.points) + 1;
  const acc = state.user.totalPredictions > 0
    ? Math.round((state.user.correctPredictions / state.user.totalPredictions) * 100) : 0;

  const t = state.user.team ? TEAMS[state.user.team] : null;
  document.getElementById('your-rank-card').innerHTML = `
    <div class="rank-num">#${userRank}</div>
    <div class="your-rank-info">
      <div class="your-rank-name">${escH(state.user.name)}</div>
      <div class="your-rank-team">${t ? escH(t.emoji) + ' ' + escH(t.name) : '—'}</div>
    </div>
    <div class="your-rank-stats">
      <div class="yr-stat"><strong>${state.user.points}</strong> Points</div>
      <div class="yr-stat"><strong>${state.user.coins}</strong> Coins</div>
      <div class="yr-stat"><strong>${acc}%</strong> Accuracy</div>
      <div class="yr-stat"><strong>${state.user.totalPredictions}</strong> Predictions</div>
    </div>`;

  // Build combined list
  const allUsers = [
    ...MOCK_USERS,
    { name: state.user.name, team: state.user.team, points: state.user.points, coins: state.user.coins, accuracy: acc, avatar:'😎', isMe: true }
  ].sort((a,b) => b.points - a.points);

  document.getElementById('leaderboard-list').innerHTML = allUsers.slice(0, 12).map((u, i) => {
    const rank = i + 1;
    const rankClass = rank===1?'top1':rank===2?'top2':rank===3?'top3':'';
    const rankEmoji = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank;
    const team = TEAMS[u.team];
    return `
      <div class="lb-item ${u.isMe ? 'you' : ''}">
        <div class="lb-rank ${rankClass}">${rankEmoji}</div>
        <div class="lb-avatar">${u.avatar || '👤'}</div>
        <div style="flex:1">
          <div class="lb-name">${escH(u.name)} ${u.isMe ? '👈 You' : ''}</div>
          <div class="lb-team">${team ? team.emoji + ' ' + team.short : '—'}</div>
        </div>
        <div>
          <div class="lb-pts">${u.points.toLocaleString('en-IN')} pts</div>
          <div class="lb-acc">${u.accuracy}% accuracy</div>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
//  CHAT
// ============================================================
const TRASH_TALK = [
  '🔥 My team is unstoppable!',
  '😂 Enjoy the loss!',
  '💪 Bring it on!',
  '🏆 Trophy is OURS!',
  '🤣 Better luck next season',
  '🎉 EASY WIN!',
];

function renderChat() {
  // Populate match selector
  const sel = document.getElementById('chat-match-select');
  sel.innerHTML = MATCHES.map(m => `<option value="${m.id}">${m.t1} vs ${m.t2} (${fmtDate(m.date)})</option>`).join('');

  // Trash talk buttons
  const trashRow = document.getElementById('trash-talk-row');
  trashRow.innerHTML = TRASH_TALK.map(t => `<button class="trash-btn" data-msg="${escH(t)}">${t}</button>`).join('');
  trashRow.querySelectorAll('.trash-btn').forEach(btn => {
    btn.addEventListener('click', () => sendChatMessage(btn.dataset.msg));
  });

  sel.addEventListener('change', renderChatMessages);
  renderChatMessages();
}

function renderChatMessages() {
  const matchId  = document.getElementById('chat-match-select').value;
  const messages = state.chatMessages[matchId] || generateSeedMessages(matchId);
  const container = document.getElementById('chat-messages');
  container.innerHTML = messages.map(msg => `
    <div class="chat-msg ${msg.mine ? 'mine' : 'other'}">
      ${!msg.mine ? `<div class="chat-msg-user">${escH(msg.user)}</div>` : ''}
      ${escH(msg.text)}
      <div class="chat-msg-time">${msg.time}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function generateSeedMessages(matchId) {
  const m = MATCHES.find(x => x.id === matchId);
  if (!m) return [];
  const users = MOCK_USERS.slice(0, 4);
  const msgs = [
    { user: users[0].name, text: `Can't wait for this match! ${TEAMS[m.t1].emoji} all the way!`, mine: false, time: '2:30 PM' },
    { user: users[1].name, text: `${TEAMS[m.t2].short} is going to crush it today 💪`, mine: false, time: '2:31 PM' },
    { user: users[2].name, text: `${TEAMS[m.t1].short} batting lineup is 🔥 this season`, mine: false, time: '2:33 PM' },
    { user: users[3].name, text: `Who's predicting a 200+ score today? 📊`, mine: false, time: '2:34 PM' },
  ];
  state.chatMessages[matchId] = msgs;
  return msgs;
}

function sendChatMessage(text) {
  text = text || document.getElementById('chat-input').value.trim();
  if (!text) return;
  const matchId = document.getElementById('chat-match-select').value;
  if (!state.chatMessages[matchId]) state.chatMessages[matchId] = generateSeedMessages(matchId);
  const now = new Date();
  state.chatMessages[matchId].push({
    user: state.user.name, text,
    mine: true,
    time: now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
  });
  document.getElementById('chat-input').value = '';
  save();
  renderChatMessages();
}

// ============================================================
//  ANALYTICS
// ============================================================
let chartInstances = {};
function destroyChart(k) { if (chartInstances[k]) { chartInstances[k].destroy(); chartInstances[k]=null; } }

function renderAnalytics() {
  // Populate selects
  const teamOpts = Object.keys(TEAMS).map(k => `<option value="${k}">${TEAMS[k].emoji} ${TEAMS[k].name}</option>`).join('');
  document.getElementById('compare-t1').innerHTML = teamOpts;
  document.getElementById('compare-t2').innerHTML = teamOpts;
  document.getElementById('compare-t2').value = 'MI';

  // Team win rate chart
  destroyChart('winrates');
  const ctx1 = document.getElementById('chart-winrates');
  if (ctx1) {
    const labels = Object.keys(TEAMS);
    const data   = labels.map(k => {
      const t = TEAMS[k];
      return Math.round((t.recentWins / 5) * 100);
    });
    chartInstances['winrates'] = new Chart(ctx1, {
      type:'bar',
      data:{ labels, datasets:[{ label:'Recent Win %', data, backgroundColor: labels.map(k => TEAMS[k].color + 'cc'), borderRadius:6 }] },
      options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{
        x:{ ticks:{ color:'#7880a8' }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ ticks:{ color:'#7880a8', callback: v => v+'%' }, grid:{ color:'rgba(255,255,255,0.04)' }, max:100 }
      }}
    });
  }

  // Titles chart
  destroyChart('titles');
  const ctx2 = document.getElementById('chart-titles');
  if (ctx2) {
    const labels = Object.keys(TEAMS).filter(k => TEAMS[k].titles > 0);
    chartInstances['titles'] = new Chart(ctx2, {
      type:'doughnut',
      data:{ labels, datasets:[{ data:labels.map(k=>TEAMS[k].titles), backgroundColor:labels.map(k=>TEAMS[k].color), borderWidth:2, borderColor:'#151a2e' }] },
      options:{ responsive:true, cutout:'60%', plugins:{ legend:{ position:'bottom', labels:{ color:'#7880a8', font:{size:10}, padding:8 } } } }
    });
  }

  // Strength chart
  destroyChart('strength');
  const ctx3 = document.getElementById('chart-strength');
  if (ctx3) {
    const labels = Object.keys(TEAMS);
    chartInstances['strength'] = new Chart(ctx3, {
      type:'bar', indexAxis:'y',
      data:{ labels, datasets:[{ label:'Strength Rating', data:labels.map(k=>TEAMS[k].strength), backgroundColor:labels.map(k=>TEAMS[k].color+'cc'), borderRadius:4 }] },
      options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{
        x:{ ticks:{ color:'#7880a8' }, grid:{ color:'rgba(255,255,255,0.04)' }, min:70, max:100 },
        y:{ ticks:{ color:'#7880a8' }, grid:{ color:'rgba(255,255,255,0.04)' } }
      }}
    });
  }
}

function compareTeams() {
  const t1k = document.getElementById('compare-t1').value;
  const t2k = document.getElementById('compare-t2').value;
  if (t1k === t2k) return;
  const t1 = TEAMS[t1k], t2 = TEAMS[t2k];
  const h2h = H2H[`${t1k}_${t2k}`] || { t1: 5, t2: 5 };
  const prob = predictWinProbability(t1k, t2k, t1.ground);

  const stats = [
    { label:'IPL Titles',         v1: t1.titles,         v2: t2.titles,         higher:'v1' },
    { label:'AI Win Probability', v1: prob.t1+'%',        v2: prob.t2+'%',        higher:'v1', numV1:prob.t1, numV2:prob.t2 },
    { label:'Strength Rating',    v1: t1.strength,       v2: t2.strength,       higher:'v1' },
    { label:'H2H Wins',           v1: h2h.t1,            v2: h2h.t2,            higher:'v1' },
    { label:'Recent Form (5)',    v1: t1.recentWins+'W', v2: t2.recentWins+'W', higher:'v1', numV1:t1.recentWins, numV2:t2.recentWins },
  ];

  document.getElementById('compare-result').innerHTML = stats.map(s => {
    const n1 = s.numV1 !== undefined ? s.numV1 : (typeof s.v1 === 'number' ? s.v1 : 0);
    const n2 = s.numV2 !== undefined ? s.numV2 : (typeof s.v2 === 'number' ? s.v2 : 0);
    const c1 = n1 >= n2 ? 'winner' : 'loser';
    const c2 = n2 >= n1 ? 'winner' : 'loser';
    return `
      <div class="compare-stat">
        <div class="compare-stat-label">${escH(s.label)}</div>
        <div class="compare-stat-values">
          <span class="${c1}">${t1.emoji} ${escH(String(s.v1))}</span>
          <span style="color:var(--dim);font-size:0.7rem">VS</span>
          <span class="${c2}">${escH(String(s.v2))} ${t2.emoji}</span>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
//  RESULT MODAL
// ============================================================
function showResult(emoji, title, msg, coins) {
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-msg').textContent   = msg;
  const coinsEl = document.getElementById('coins-earned');
  if (coins > 0) {
    coinsEl.style.display = '';
    document.getElementById('coins-earned-val').textContent = coins;
  } else {
    coinsEl.style.display = 'none';
  }
  document.getElementById('modal-result').showModal();
}

// ============================================================
//  PROFILE MODAL
// ============================================================
function openProfile() {
  const t = state.user.team ? TEAMS[state.user.team] : null;
  const acc = state.user.totalPredictions > 0
    ? Math.round((state.user.correctPredictions / state.user.totalPredictions) * 100) : 0;

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar">😎</div>
      <div class="profile-name-display">${escH(state.user.name)}</div>
      <div class="profile-team-display">${t ? escH(t.emoji) + ' ' + escH(t.name) : 'No team selected'}</div>
      <div class="profile-stats-row">
        <div class="ps"><strong>${state.user.points}</strong> Points</div>
        <div class="ps"><strong>${state.user.coins}</strong> Coins</div>
        <div class="ps"><strong>${acc}%</strong> Accuracy</div>
        <div class="ps"><strong>${state.user.totalPredictions}</strong> Predictions</div>
      </div>
    </div>`;

  document.getElementById('profile-name').value = state.user.name;
  const teamSel = document.getElementById('profile-team');
  teamSel.innerHTML = Object.keys(TEAMS).map(k => `<option value="${k}">${TEAMS[k].emoji} ${TEAMS[k].name}</option>`).join('');
  if (state.user.team) teamSel.value = state.user.team;

  document.getElementById('modal-profile').showModal();
}

// ============================================================
//  LIVE DATA API  (cricketdata.org)
// ============================================================
const API_KEY_STORAGE = 'ipl_arena_apikey';
const API_BASE = 'https://api.cricapi.com/v1';

const IPL_TEAM_NAMES = [
  'chennai super kings','mumbai indians','royal challengers bengaluru',
  'royal challengers bangalore','kolkata knight riders','sunrisers hyderabad',
  'punjab kings','rajasthan royals','delhi capitals','gujarat titans',
  'lucknow super giants',
];

function getApiKey() {
  // localStorage (runtime override) takes priority over config.js
  return localStorage.getItem(API_KEY_STORAGE) ||
         (typeof CONFIG !== 'undefined' && CONFIG.CRICKETDATA_API_KEY) || '';
}

function saveApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

// ── API response cache ────────────────────────────────────────
const API_CACHE_KEY = 'ipl_arena_api_cache';

function saveApiCache(matches, info) {
  localStorage.setItem(API_CACHE_KEY, JSON.stringify({
    matches,
    info,
    savedAt: Date.now(),
  }));
}

function loadApiCache() {
  try {
    const raw = localStorage.getItem(API_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function fmtCacheAge(savedAt) {
  const mins = Math.round((Date.now() - savedAt) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  return hrs + 'h ' + (mins % 60) + 'm ago';
}

function updateApiStatusBar(status, info) {
  const bar     = document.getElementById('api-status-bar');
  const text    = document.getElementById('api-status-text');
  const hitsEl  = document.getElementById('api-hits');
  const setupBtn = document.getElementById('btn-open-apikey');

  bar.className = 'api-status-bar ' + status;

  if (status === 'setup') {
    text.innerHTML = '⚡ Connect live cricket data — <strong>Add API Key</strong>';
    setupBtn.style.display = '';
    hitsEl.style.display = 'none';
  } else if (status === 'loading') {
    text.innerHTML = '⏳ Fetching live match data…';
    setupBtn.style.display = 'none';
    hitsEl.style.display = 'none';
  } else if (status === 'ok') {
    text.innerHTML = '🟢 Live data connected';
    setupBtn.style.display = 'none';
    hitsEl.style.display = '';
    if (info) hitsEl.textContent = `${info.hitsUsed ?? '?'}/${info.hitsLimit ?? 100} calls today`;
  } else if (status === 'quota') {
    const cache = loadApiCache();
    const ageStr = cache ? ` · last data: ${fmtCacheAge(cache.savedAt)}` : '';
    text.innerHTML = `🟡 Daily limit reached — showing cached scores${escH(ageStr)}`;
    setupBtn.style.display = 'none';
    hitsEl.style.display = '';
    if (info) hitsEl.textContent = `${info.hitsToday ?? info.hitsUsed ?? '?'}/${info.hitsLimit ?? 100} calls`;
  } else if (status === 'error') {
    text.innerHTML = '🔴 API error — <strong>Check your key</strong>';
    setupBtn.style.display = '';
    hitsEl.style.display = 'none';
  }
}

function isIPLMatch(match) {
  const name = (match.name || '').toLowerCase();
  if (name.includes('ipl') || name.includes('indian premier league')) return true;
  // Use whole-name matching (min 8 chars) to avoid "India" matching "Mumbai Indians"
  const teams = (match.teams || []).map(t => t.toLowerCase());
  return teams.some(apiTeam =>
    apiTeam.length >= 8 &&
    IPL_TEAM_NAMES.some(ipl => apiTeam === ipl || ipl.startsWith(apiTeam.slice(0, 9)) || apiTeam.startsWith(ipl.slice(0, 9)))
  );
}

async function testAndSaveApiKey(key) {
  const msgEl = document.getElementById('apikey-test-msg');
  const btn   = document.getElementById('btn-apikey-test');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  msgEl.style.color = '#aaa';
  msgEl.textContent = 'Connecting to cricketdata.org…';

  try {
    const res  = await fetch(`${API_BASE}/currentMatches?apikey=${encodeURIComponent(key)}&offset=0`);
    const data = await res.json();

    if (data.status === 'success' || Array.isArray(data.data)) {
      saveApiKey(key);
      const used  = data.info?.hitsUsed  ?? '?';
      const limit = data.info?.hitsLimit ?? 100;
      msgEl.style.color   = '#22c55e';
      msgEl.textContent   = `✅ Connected! Calls today: ${used}/${limit}`;
      setTimeout(() => {
        document.getElementById('modal-apikey').close();
        updateApiStatusBar('ok', data.info);
        fetchAndUpdateLiveMatches();
      }, 1200);
    } else {
      throw new Error(data.status || 'Unexpected response');
    }
  } catch (e) {
    msgEl.style.color = '#ef4444';
    msgEl.textContent = `❌ ${e.message || 'Connection failed — check your key.'}`;
    updateApiStatusBar('error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Test & Save 🚀';
  }
}

async function fetchAndUpdateLiveMatches() {
  const key = getApiKey();
  if (!key) return;
  updateApiStatusBar('loading');
  try {
    const res  = await fetch(`${API_BASE}/currentMatches?apikey=${encodeURIComponent(key)}&offset=0`);
    const data = await res.json();
    const info = data.info || {};

    // Quota exceeded: hitsToday > hitsLimit
    const hitsToday = info.hitsToday ?? info.hitsUsed ?? 0;
    const hitsLimit = info.hitsLimit ?? 100;
    if (hitsToday >= hitsLimit) {
      updateApiStatusBar('quota', info);
      // Restore last cached data so scores are still visible
      const cache = loadApiCache();
      if (cache?.matches?.length) applyLiveMatchData(cache.matches);
      return;
    }

    // API returned failure with no data — valid key, just no live matches right now
    if (!Array.isArray(data.data)) {
      updateApiStatusBar('ok', info);
      return;
    }

    const iplMatches = data.data.filter(isIPLMatch);
    updateApiStatusBar('ok', info);

    // Save successful response to cache
    if (iplMatches.length > 0) {
      saveApiCache(iplMatches, info);
      applyLiveMatchData(iplMatches);
    }

    // Auto-refresh every 60s while a live match is in progress
    const hasLive = iplMatches.some(m => m.matchStarted && !m.matchEnded);
    if (hasLive) setTimeout(fetchAndUpdateLiveMatches, 60000);
  } catch (e) {
    updateApiStatusBar('error');
    console.error('cricketdata.org API error:', e);
  }
}

function findTeamCode(fullName) {
  const lower = (fullName || '').toLowerCase();
  return Object.keys(TEAMS).find(k =>
    TEAMS[k].name.toLowerCase() === lower ||
    lower.includes(TEAMS[k].name.toLowerCase().slice(0, 8)) ||
    TEAMS[k].name.toLowerCase().includes(lower.slice(0, 8))
  );
}

function applyLiveMatchData(apiMatches) {
  // Remove previously-added dynamic matches so stale ones don't linger
  MATCHES = MATCHES.filter(m => !m.id?.startsWith('api_'));

  // Reset any static match that was previously marked live by the API
  MATCHES.forEach(m => {
    if (m._apiMarkedLive) { m.isLive = false; m.status = 'upcoming'; m._apiMarkedLive = false; }
  });

  let updated = false;

  apiMatches.forEach(apiM => {
    // Use the API's own flags as the ground truth for liveness
    const isActuallyLive = apiM.matchStarted === true && apiM.matchEnded === false;

    const apiTeamNames  = apiM.teams || [];
    const apiTeamsLower = apiTeamNames.map(t => t.toLowerCase());

    // Try to find a corresponding match in the static schedule
    const match = MATCHES.find(m => {
      const t1 = (TEAMS[m.t1]?.name || '').toLowerCase();
      const t2 = (TEAMS[m.t2]?.name || '').toLowerCase();
      return apiTeamsLower.some(at => t1.includes(at.slice(0, 8)) || at.includes(t1.slice(0, 8))) &&
             apiTeamsLower.some(at => t2.includes(at.slice(0, 8)) || at.includes(t2.slice(0, 8)));
    });

    if (match) {
      // Found in static schedule — sync live status from API
      if (isActuallyLive) {
        match.isLive       = true;
        match.status       = 'live';
        match.apiScore     = apiM.score;
        match.apiStatus    = apiM.status;
        match._apiMarkedLive = true;
        updated = true;
      }
      return;
    }

    // Not in static schedule — only add dynamically if actually live right now
    if (!isActuallyLive) return;

    const t1Code = findTeamCode(apiTeamNames[0]);
    const t2Code = findTeamCode(apiTeamNames[1]);
    if (!t1Code || !t2Code) return;

    MATCHES.unshift({
      id:        `api_${apiM.id}`,
      t1:        t1Code,
      t2:        t2Code,
      venue:     apiM.venue || 'TBD',
      date:      apiM.date  || new Date().toISOString().slice(0, 10),
      time:      '19:30',
      status:    'live',
      isLive:    true,
      apiScore:  apiM.score,
      apiStatus: apiM.status,
    });
    updated = true;
  });

  if (updated) {
    if (activeView === 'home')    renderHome();
    if (activeView === 'matches') renderMatchesList('live');
    if (activeView === 'matchroom' && currentMatchRoomId) {
      const openMatch = MATCHES.find(m => m.id === currentMatchRoomId);
      if (openMatch?.isLive) renderMatchRoom(openMatch);
    }
  }
}

// ============================================================
//  EVENT BINDING
// ============================================================
function bindEvents() {
  // Top nav + bottom nav (mobile)
  document.querySelectorAll('.nav-btn[data-view], .bottom-nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Back button in match room
  document.getElementById('btn-back-matches').addEventListener('click', () => setView(prevMatchesView === 'matchroom' ? 'matches' : (prevMatchesView || 'home')));

  // Matches tabs
  document.getElementById('matches-tabs').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (pill?.dataset.tab) renderMatchesList(pill.dataset.tab);
  });

  // Leaderboard tabs
  document.getElementById('lb-tab-global')?.addEventListener('click', () => renderLeaderboard());

  // Chat send
  document.getElementById('btn-send-chat').addEventListener('click', () => sendChatMessage());
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

  // Analytics compare
  document.getElementById('btn-compare').addEventListener('click', compareTeams);

  // Profile
  document.getElementById('btn-profile').addEventListener('click', openProfile);
  document.getElementById('btn-profile-close').addEventListener('click', () => document.getElementById('modal-profile').close());
  document.getElementById('btn-profile-cancel').addEventListener('click', () => document.getElementById('modal-profile').close());
  document.getElementById('btn-profile-save').addEventListener('click', () => {
    state.user.name = document.getElementById('profile-name').value.trim() || 'Cricket Fan';
    state.user.team = document.getElementById('profile-team').value;
    save();
    document.getElementById('modal-profile').close();
    updateTopbar();
    updateTopbarTeam();
  });

  // Result modal ok
  document.getElementById('btn-result-ok').addEventListener('click', () => document.getElementById('modal-result').close());

  // API Key modal
  document.getElementById('btn-open-apikey')?.addEventListener('click', () => {
    const existing = getApiKey();
    document.getElementById('apikey-input').value  = existing;
    document.getElementById('apikey-test-msg').textContent = '';
    document.getElementById('modal-apikey').showModal();
  });
  document.getElementById('btn-apikey-close')?.addEventListener('click',  () => document.getElementById('modal-apikey').close());
  document.getElementById('btn-apikey-cancel')?.addEventListener('click', () => document.getElementById('modal-apikey').close());
  document.getElementById('btn-apikey-test')?.addEventListener('click', () => {
    const key = document.getElementById('apikey-input').value.trim();
    if (!key) {
      document.getElementById('apikey-test-msg').style.color = '#f59e0b';
      document.getElementById('apikey-test-msg').textContent = '⚠️ Please enter your API key first.';
      return;
    }
    testAndSaveApiKey(key);
  });

  // Close modals on backdrop
  ['modal-profile','modal-result','modal-apikey'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => { if (e.target.id === id) document.getElementById(id).close(); });
  });

  // Live banner
  document.getElementById('btn-watch-live')?.addEventListener('click', () => {
    const liveMatch = MATCHES.find(m => m.isLive);
    if (liveMatch) openMatchRoom(liveMatch.id);
  });
}

// ============================================================
//  INIT
// ============================================================
function init() {
  load();
  buildMatches();
  evaluatePredictions();

  if (!state.user.team) {
    renderOnboarding();
    document.getElementById('onboarding').style.display = 'flex';
  } else {
    document.getElementById('onboarding').style.display = 'none';
  }

  bindEvents();
  setView('home');

  // Auto-fetch live data if an API key is already configured
  const savedKey = getApiKey();
  if (savedKey) {
    fetchAndUpdateLiveMatches();
  }
}

document.addEventListener('DOMContentLoaded', init);
