// config.js — everything you'd want to tweak lives here.

export const ALARM_LEAD_MINUTES = 5;      // how early the popup fires
export const REFRESH_PERIOD_MINUTES = 60; // how often the schedule is re-fetched
export const KEEP_MATCH_FOR_HOURS = 2;    // a match stays listed this long after kickoff
export const DISPLAY_TIMEZONE = 'Europe/Istanbul'; // GMT+3

// TheSportsDB public test key. Swap for a paid key if you hit rate limits.
export const SPORTSDB_KEY = '3';

// Teams we follow. Every competition they enter is picked up automatically
// (Süper Lig, Türkiye Kupası, Champions League, Europa League, friendlies).
export const FOLLOWED_TEAMS = [
  { id: '133794', name: 'Beşiktaş' },
  { id: '133807', name: 'Fenerbahçe' },
  { id: '133804', name: 'Galatasaray' },
  { id: '133796', name: 'Trabzonspor' },
];

// Whole competitions we follow, no matter who is playing.
export const FOLLOWED_LEAGUES = [
  { id: '4480', name: 'UEFA Champions League' },
];

// The original worldcupmatchtime.com scraper. Set false to drop it.
export const WORLD_CUP_ENABLED = true;

export const FOLLOWED_TEAM_NAMES = FOLLOWED_TEAMS.map(t => t.name);
