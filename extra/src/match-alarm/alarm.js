// alarm.js

import { DISPLAY_TIMEZONE, ALARM_LEAD_MINUTES } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const team1 = params.get('t1') || 'Unknown Team';
  const team2 = params.get('t2') || 'Unknown Team';
  const competition = params.get('comp');
  const timeStr = params.get('time');

  document.getElementById('heading').innerText =
    `⚽ Match Starting in ${ALARM_LEAD_MINUTES} Mins!`;
  document.getElementById('teams').innerText = `${team1} vs ${team2}`;
  document.getElementById('competition').innerText = competition || '';

  if (timeStr) {
    const date = new Date(timeStr);
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: DISPLAY_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date);
      document.getElementById('time').innerText = `Kickoff: ${formatted} (GMT+3)`;
    } catch (e) {
      document.getElementById('time').innerText = `Kickoff: ${date.toLocaleString()} (Local)`;
    }
  }

  setTimeout(() => window.close(), 30000);

  document.getElementById('closeBtn').addEventListener('click', () => window.close());
});
