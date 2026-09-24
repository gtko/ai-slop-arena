import { track } from './telemetry.js';
import { settings } from './settings.js';

// "Having fun?" on the result screen: five faces, then an optional comment. Answers go to the PostHog
// survey below (type "api": the game draws it, PostHog only collects). Asked after a few matches,
// then at most every 30 days once answered, 10 days after "not now".

const SURVEY_ID = '01a0d5ab-5ed2-0000-fde9-5042e702dce4';
const Q_RATING = '1c910b09-680a-4e22-a63d-207b852cf469';
const Q_COMMENT = '6246fb48-2dd7-407d-a95c-930299d22190';
const STORE = 'iaslop-survey';
const DAY = 86400000;
const FIRST_AFTER = 3;   // matches finished before the first question
const AGAIN_AFTER = 30;  // days, after an answer
const SNOOZE = 10;       // days, after "not now"

const $ = s => document.querySelector(s);
let state = { matches: 0, next: 0 };
try { state = { ...state, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignore */ } };
let rating = 0, context = {};

function hide() { $('#survey').classList.add('hidden'); }
function later(days) { state.next = Date.now() + days * DAY; save(); }

function send(comment) {
  track('survey sent', {
    $survey_id: SURVEY_ID,
    $survey_questions: [{ id: Q_RATING, question: 'Are you having fun?' }, { id: Q_COMMENT, question: 'What would make the game better?' }],
    [`$survey_response_${Q_RATING}`]: String(rating),
    [`$survey_response_${Q_COMMENT}`]: comment,
    ...context,
  });
  later(AGAIN_AFTER);
  $('#svStep1').classList.add('hidden');
  $('#svStep2').classList.add('hidden');
  $('#svThanks').classList.remove('hidden');
  setTimeout(hide, 1800);
}

// Called with every finished match (result screen). ctx: map, brawler, mode, rank, won.
export function maybeAskSurvey(ctx) {
  hide();
  state.matches++;
  save();
  if (!settings.analytics || state.matches < FIRST_AFTER || Date.now() < state.next) return;
  context = ctx;
  rating = 0;
  $('#svText').value = '';
  $('#svStep1').classList.remove('hidden');
  $('#svStep2').classList.add('hidden');
  $('#svThanks').classList.add('hidden');
  $('#survey').classList.remove('hidden');
  later(SNOOZE); // closing the result screen without answering counts as "not now"
  track('survey shown', { $survey_id: SURVEY_ID });
}

export function installSurvey() {
  const faces = $('#svFaces');
  ['😖', '🙁', '😐', '🙂', '😍'].forEach((face, i) => {
    const b = document.createElement('button');
    b.textContent = face;
    b.title = `${i + 1}/5`;
    b.addEventListener('click', () => {
      rating = i + 1;
      $('#svStep1').classList.add('hidden');
      $('#svStep2').classList.remove('hidden');
      $('#svText').focus();
    });
    faces.appendChild(b);
  });
  $('#svSend').addEventListener('click', () => send($('#svText').value.trim().slice(0, 500)));
  $('#svSkip').addEventListener('click', () => send(''));
  $('#svLater').addEventListener('click', () => { track('survey dismissed', { $survey_id: SURVEY_ID }); later(SNOOZE); hide(); });
  // typing a comment must not move the brawler or trigger shortcuts
  $('#svText').addEventListener('keydown', e => e.stopPropagation());
}
