// popup.js

import { DISPLAY_TIMEZONE } from './config.js';

const FILTERS = {
  all: () => true,
  followed: match => match.followed,
  ucl: match => /champions league/i.test(match.competition),
};

let activeFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  loadMatches();

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      loadMatches();
    });
  });

  document.getElementById('refresh').addEventListener('click', () => {
    document.getElementById('matches-container').innerHTML =
      '<div class="no-matches">Refreshing...</div>';
    chrome.runtime.sendMessage({ action: 'fetchMatches' }, () => loadMatches());
  });
});

function formatKickoff(isoString) {
  const date = new Date(isoString);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: DISPLAY_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch (e) {
    return date.toLocaleString();
  }
}

function loadMatches() {
  chrome.storage.local.get(['matches', 'lastUpdated'], ({ matches = [], lastUpdated }) => {
    const container = document.getElementById('matches-container');
    container.innerHTML = '';

    const visible = matches
      .filter(FILTERS[activeFilter])
      .sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime));

    if (visible.length === 0) {
      container.innerHTML = '<div class="no-matches">No upcoming matches found.</div>';
    } else {
      let lastCompetition = null;
      for (const match of visible) {
        if (match.competition !== lastCompetition) {
          lastCompetition = match.competition;
          const header = document.createElement('div');
          header.className = 'competition';
          header.innerText = match.competition;
          container.appendChild(header);
        }

        const matchEl = document.createElement('div');
        matchEl.className = match.followed ? 'match followed' : 'match';

        const teamsEl = document.createElement('div');
        teamsEl.className = 'match-teams';
        teamsEl.innerText = `${match.team1} vs ${match.team2}`;

        const timeEl = document.createElement('div');
        timeEl.className = 'match-time';
        timeEl.innerText = `${formatKickoff(match.matchTime)} (GMT+3)`;

        matchEl.append(teamsEl, timeEl);
        container.appendChild(matchEl);
      }
    }

    document.getElementById('updated').innerText = lastUpdated
      ? `Updated ${formatKickoff(new Date(lastUpdated).toISOString())}`
      : '';
  });
}
