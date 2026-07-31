// background.js — fetches every source, stores one match list, schedules alarms.

import { fetchAllMatches } from './providers.js';
import {
  ALARM_LEAD_MINUTES,
  REFRESH_PERIOD_MINUTES,
  KEEP_MATCH_FOR_HOURS,
} from './config.js';

const REFRESH_ALARM = 'fetch_matches';
const MATCH_ALARM_PREFIX = 'match_alarm_';
const STORAGE_KEY = 'matches';

async function refreshMatches() {
  try {
    const matches = await fetchAllMatches();
    if (matches.length === 0) {
      console.warn('No matches parsed from any source; keeping previous schedule.');
      return;
    }
    await scheduleAlarms(matches);
  } catch (error) {
    console.error('Error refreshing matches:', error);
  }
}

async function scheduleAlarms(matches) {
  const now = Date.now();

  // Drop only the per-match alarms; the periodic refresh alarm must survive.
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing
      .filter(a => a.name.startsWith(MATCH_ALARM_PREFIX))
      .map(a => chrome.alarms.clear(a.name))
  );

  const upcoming = matches.filter(match => {
    const kickoff = new Date(match.matchTime).getTime();
    return kickoff + KEEP_MATCH_FOR_HOURS * 60 * 60 * 1000 >= now;
  });

  for (const match of upcoming) {
    const alarmTime = new Date(match.matchTime).getTime() - ALARM_LEAD_MINUTES * 60 * 1000;
    if (alarmTime > now) {
      chrome.alarms.create(`${MATCH_ALARM_PREFIX}${match.id}`, { when: alarmTime });
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: upcoming, lastUpdated: now });
}

async function handleMatchAlarm(alarmName) {
  const matchId = alarmName.slice(MATCH_ALARM_PREFIX.length);
  const { [STORAGE_KEY]: matches = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const match = matches.find(m => m.id === matchId);

  // Skip if the alarm fired late and kickoff already passed.
  if (match && new Date(match.matchTime).getTime() > Date.now()) {
    showPopup(match);
  }
}

function showPopup(match) {
  const params = new URLSearchParams({
    t1: match.team1,
    t2: match.team2,
    time: match.matchTime,
    comp: match.competition || '',
  });

  const width = 500;
  const height = 360;

  chrome.system.display.getInfo(displays => {
    const primary = displays.find(d => d.isPrimary) || displays[0];
    const left = Math.round(primary.workArea.left + (primary.workArea.width - width) / 2);
    const top = Math.round(primary.workArea.top + (primary.workArea.height - height) / 2);

    chrome.windows.create({
      url: chrome.runtime.getURL(`alarm.html?${params}`),
      type: 'popup',
      focused: true,
      width,
      height,
      left,
      top,
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  refreshMatches();
});

chrome.runtime.onStartup.addListener(refreshMatches);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) {
    refreshMatches();
  } else if (alarm.name.startsWith(MATCH_ALARM_PREFIX)) {
    handleMatchAlarm(alarm.name);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchMatches') {
    refreshMatches().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async reply
  }
});
