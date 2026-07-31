// providers.js — every match source normalizes into the same shape:
// { id, team1, team2, matchTime (ISO), competition, followed }

import {
  SPORTSDB_KEY,
  FOLLOWED_TEAMS,
  FOLLOWED_LEAGUES,
  FOLLOWED_TEAM_NAMES,
  WORLD_CUP_ENABLED,
} from './config.js';

const SPORTSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}`;

function decodeHTMLEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// "Beşiktaş" and "Besiktas" must compare equal.
function normalizeName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .trim();
}

const FOLLOWED_KEYS = new Set(FOLLOWED_TEAM_NAMES.map(normalizeName));

function isFollowedTeam(name) {
  const key = normalizeName(name);
  for (const followed of FOLLOWED_KEYS) {
    if (key === followed || key.includes(followed)) return true;
  }
  return false;
}

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

// TheSportsDB returns strTimestamp as UTC without a zone marker.
function sportsDbTime(event) {
  if (event.strTimestamp) return new Date(`${event.strTimestamp.replace(' ', 'T')}Z`);
  if (event.dateEvent) return new Date(`${event.dateEvent}T${event.strTime || '00:00:00'}Z`);
  return null;
}

function normalizeSportsDbEvent(event) {
  const matchTime = sportsDbTime(event);
  if (!matchTime || isNaN(matchTime)) return null;

  const team1 = event.strHomeTeam || '';
  const team2 = event.strAwayTeam || '';

  return {
    id: `sdb_${event.idEvent}`,
    team1,
    team2,
    matchTime: matchTime.toISOString(),
    competition: event.strLeague || 'Football',
    followed: isFollowedTeam(team1) || isFollowedTeam(team2),
  };
}

async function fetchTeamMatches(team) {
  const data = await getJSON(`${SPORTSDB_BASE}/eventsnext.php?id=${team.id}`);
  return (data.events || []).map(normalizeSportsDbEvent).filter(Boolean);
}

async function fetchLeagueMatches(league) {
  const data = await getJSON(`${SPORTSDB_BASE}/eventsnextleague.php?id=${league.id}`);
  return (data.events || []).map(normalizeSportsDbEvent).filter(Boolean);
}

// Original source: static HTML always renders kickoff times in UTC-7 (PDT)
// server-side before client hydration, so parse them strictly as -0700.
async function fetchWorldCupMatches() {
  const response = await fetch('https://www.worldcupmatchtime.com/');
  if (!response.ok) throw new Error(`worldcupmatchtime -> HTTP ${response.status}`);
  const html = await response.text();

  const regex = /<a href="\/en\/match\/[^"]+"[^>]*>.*?<span[^>]*>([^<]+)<!-- --> <span[^>]*>vs<\/span> <!-- -->([^<]+)<\/span><span[^>]*>([^·]+) · <!-- -->([^<]+)<!-- --> · ([^<]+)<\/span><\/a>/g;

  const matches = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    const team1 = decodeHTMLEntities(m[1].trim());
    const team2 = decodeHTMLEntities(m[2].trim());
    const matchTime = new Date(`${m[3].trim()} 2026 ${m[4].trim()} -0700`);
    if (isNaN(matchTime)) continue;

    matches.push({
      id: `wc_${normalizeName(team1)}_${normalizeName(team2)}_${matchTime.getTime()}`,
      team1,
      team2,
      matchTime: matchTime.toISOString(),
      competition: 'FIFA World Cup',
      followed: isFollowedTeam(team1) || isFollowedTeam(team2),
    });
  }
  return matches;
}

// Runs every source independently — one dead source never blanks the others.
export async function fetchAllMatches() {
  const jobs = [
    ...FOLLOWED_TEAMS.map(team => ({ label: team.name, run: () => fetchTeamMatches(team) })),
    ...FOLLOWED_LEAGUES.map(league => ({ label: league.name, run: () => fetchLeagueMatches(league) })),
  ];

  if (WORLD_CUP_ENABLED) {
    jobs.push({ label: 'World Cup', run: fetchWorldCupMatches });
  }

  const results = await Promise.allSettled(jobs.map(job => job.run()));

  const byId = new Map();
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`Source failed: ${jobs[i].label}`, result.reason);
      return;
    }
    for (const match of result.value) {
      // Same fixture can arrive from a team feed and a league feed; keep the
      // one flagged as followed so the popup highlights it.
      const existing = byId.get(match.id);
      if (!existing || (match.followed && !existing.followed)) byId.set(match.id, match);
    }
  });

  return [...byId.values()].sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime));
}
