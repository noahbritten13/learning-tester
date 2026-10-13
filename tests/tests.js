// Automated tests for the parts that decide marks, schedules and sync.
// Open tests/index.html in a browser (served from a local web server).

import { checkAnswer, checkMeaning, splitMeanings, meaningKey } from '../js/match.js';
import { cardHints, cardErrors } from '../js/rules.js';
import { parseImport } from '../js/importer.js';
import {
  makeScheduler, replayCard, computeStates, buildQueue, Session, promptIndex, previewRatings, Rating, State, DEFAULT_SETTINGS,
  schedKey, parseKey, reviewKey, keysOf,
} from '../js/scheduler.js';
import { newCard, cleanCard, mergeInto, toFiles, fromFiles, isManagedPath, entryToMarkdown, markdownToEntry, tombstone, themeTree, themeAndChildren, themeLabel, themePaths, inThemes, themeLanguage } from '../js/model.js';
import { runSync, diffFiles, GitHubClient } from '../js/sync.js';
import { gitBlobSha, utf8ToBase64, base64ToUtf8, dayStart, interleave } from '../js/util.js';

const results = [];
let group = '';
const tests = [];
const describe = (name, fn) => { tests.push({ group: name }); fn(); };
const test = (name, fn) => tests.push({ name, fn });

// JSON with object keys sorted, so key order doesn't matter.
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
function eq(actual, expected, msg = '') {
  const a = canon(actual), e = canon(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}
function ok(cond, msg = 'expected true') {
  if (!cond) throw new Error(msg);
}

// ---------- Answer marking ----------
describe('Marking typed answers', () => {
  test('ignores capitals and surrounding spaces', () => {
    eq(checkAnswer('  ÁRBOL ', ['árbol']).result, 'correct');
  });
  test('accepts missing accents but reports them', () => {
    const r = checkAnswer('arbol', ['árbol']);
    eq(r.result, 'accent');
    eq(r.expected, 'árbol');
  });
  test('strict accents marks missing accents wrong', () => {
    eq(checkAnswer('arbol', ['árbol'], { strictAccents: true }).result, 'wrong');
  });
  test('any accepted translation counts', () => {
    eq(checkAnswer('pretty', ['beautiful', 'pretty']).result, 'correct');
  });
  test('wrong answers and blanks', () => {
    eq(checkAnswer('casa', ['árbol']).result, 'wrong');
    eq(checkAnswer('   ', ['árbol']).result, 'blank');
  });
  test('trailing punctuation and inner spaces', () => {
    eq(checkAnswer('el  árbol.', ['el árbol']).result, 'correct');
  });
});

// ---------- Card-writing hints ----------
describe('Card-writing hints', () => {
  const hints = c => cardHints({ type: 'concept', prompts: ['What is it?'], answer: 'A thing', ...c });
  test('a good card has no hints', () => eq(hints({}), []));
  test('yes/no questions', () => ok(hints({ prompts: ['Is an API a protocol?'] }).some(h => h.includes('yes/no'))));
  test('choice questions', () => ok(hints({ prompts: ['Is REST stateless or stateful?'] }).some(h => h.includes('choices'))));
  test('choices at the end of a question', () => ok(hints({ prompts: ['Which is faster, TCP or UDP?'] }).some(h => h.includes('choices'))));
  test('list answers', () => ok(hints({ answer: 'GET, POST, PUT and DELETE' }).some(h => h.includes('list'))));
  test('short list with "or"', () => ok(hints({ answer: 'stocks, bonds or cash' }).some(h => h.includes('list'))));
  test('bulleted list answers', () => ok(hints({ answer: '- one\n- two' }).some(h => h.includes('list'))));
  test('long answers', () => ok(hints({ answer: 'word '.repeat(30) }).some(h => h.includes('long'))));
  test('a normal sentence is not a list', () => eq(hints({ answer: 'Rules that let one program, when asked, share data.' }), []));
  test('errors for missing question or answer', () => {
    eq(cardErrors({ prompts: [''], answer: 'x' }).length, 1);
    eq(cardErrors({ prompts: ['q'], answer: '' }).length, 1);
    eq(cardErrors({ prompts: ['q'], answer: 'a' }).length, 0);
  });
});

// ---------- Import ----------
describe('Importing', () => {
  test('simple text with alternative wordings', () => {
    const r = parseImport('Q: What is an API?\nQ: What does an API let programs do?\nA: Request data or actions.\n\nQ: Spanish for tree?\nA: árbol\nType: exact');
    eq(r.format, 'text');
    eq(r.cards.length, 2);
    eq(r.cards[0].prompts.length, 2);
    eq(r.cards[0].author, 'me');
    eq(r.cards[1].type, 'exact');
  });
  test('multi-line answers and bold labels', () => {
    const r = parseImport('**Q:** Why?\n**A:** Because\nof this.\nSource: Book, ch. 2\nUnverified: yes');
    eq(r.cards[0].answer, 'Because\nof this.');
    eq(r.cards[0].source, 'Book, ch. 2');
    eq(r.cards[0].unverified, true);
  });
  test('a new Q after an answer starts a new card even without a blank line', () => {
    const r = parseImport('Q: one\nA: 1\nQ: two\nA: 2');
    eq(r.cards.map(c => c.answer), ['1', '2']);
  });
  test('JSON from Claude inside a code fence, with prose around it', () => {
    const json = { format: 'learning-tester/v1', theme: 'Software', entry: { title: 'APIs', summary: 'Mine', sources: ['Book'] },
      cards: [{ prompts: ['What is an API?'], answer: 'Rules', author: 'me' }, { prompt: 'Why use one?', answer: 'Reuse', author: 'claude' }] };
    const r = parseImport('Here you go:\n```json\n' + JSON.stringify(json, null, 2) + '\n```\nEnjoy!');
    eq(r.format, 'json');
    eq(r.themeName, 'Software');
    eq(r.entry.title, 'APIs');
    eq(r.cards.map(c => c.author), ['me', 'claude']);
    eq(r.cards[1].prompts, ['Why use one?']);
  });
  test('a bare JSON array of cards', () => {
    const r = parseImport('[{"q":"a?","a":"b"}]');
    eq(r.cards.length, 1);
  });
  test('broken JSON gives a clear error', () => {
    ok(parseImport('{"cards": [ {"prompts": ["x"], ').error);
  });
  test('nothing usable gives an error', () => {
    ok(parseImport('just some notes').error);
  });
});

// ---------- Scheduling ----------
const T0 = new Date('2026-10-01T09:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000).toISOString();
const card = (id, extra = {}) => cleanCard({ id, theme: 't1', prompts: ['q'], answer: 'a', created: T0.toISOString(), updated: T0.toISOString(), ...extra });
const rev = (cardId, min, rating, extra = {}) => ({ id: `r-${cardId}-${min}-${rating}`, card: cardId, ts: at(min), rating, kind: 'review', ms: 1000, prompt: 0, device: 'd1', ...extra });

describe('Scheduling (FSRS)', () => {
  const f = makeScheduler(DEFAULT_SETTINGS);
  test('replaying gives the same schedule every time, in any input order', () => {
    const reviews = [rev('c1', 0, 3), rev('c1', 10, 3), rev('c1', 60 * 24 * 3, 3), rev('c1', 60 * 24 * 12, 2)];
    const a = replayCard(card('c1'), reviews, f).state;
    const b = replayCard(card('c1'), reviews.slice().reverse(), f).state;
    eq(a, b);
    eq(a.state, State.Review);
  });
  test('learning steps: Again brings a new card back in about a minute', () => {
    const st = replayCard(card('c1'), [rev('c1', 0, Rating.Again)], f).state;
    eq(new Date(st.due) - new Date(at(0)), 60000);
  });
  test('a right related-word follow-up does not change the schedule', () => {
    const base = [rev('c1', 0, 3), rev('c1', 10, 3)];
    const a = replayCard(card('c1'), base, f).state;
    const b = replayCard(card('c1'), [...base, rev('c1', 60, 3, { kind: 'followup' })], f).state;
    eq(a, b);
  });
  test('a wrong related-word follow-up counts as a real Again', () => {
    const base = [rev('c1', 0, 3), rev('c1', 10, 3)];
    const a = replayCard(card('c1'), [...base, rev('c1', 60, 1)], f).state;
    const b = replayCard(card('c1'), [...base, rev('c1', 60, 1, { kind: 'followup' })], f).state;
    eq(a, b);
    eq(b.lapses, 1);
  });
  test('rating previews are ordered Again < Hard < Good < Easy for a review card', () => {
    const st = replayCard(card('c1'), [rev('c1', 0, 3), rev('c1', 10, 3)], f).state;
    const p = previewRatings(st, f, new Date(st.due));
    ok(p[1] < p[2] && p[2] < p[3] && p[3] < p[4], JSON.stringify(p));
  });
  test('wordings rotate', () => {
    const c = card('c1', { prompts: ['a', 'b', 'c'] });
    eq([0, 1, 2, 3].map(n => promptIndex(c, n)), [0, 1, 2, 0]);
  });
});

describe('Building a review session', () => {
  const f = makeScheduler(DEFAULT_SETTINGS);
  const now = new Date('2026-10-20T10:00:00');
  const mk = (n, theme = 't1', extra = {}) => Array.from({ length: n }, (_, i) => card(`${theme}-${i}`, { theme, created: new Date(T0.getTime() + i * 1000).toISOString(), ...extra }));
  test('respects the new-cards-per-day limit', () => {
    const cards = mk(30);
    const states = computeStates(cards, new Map(), f, now);
    const q = buildQueue({ cards, states, settings: { ...DEFAULT_SETTINGS, newPerDay: 20 }, now });
    eq(q.counts.new, 20);
  });
  test('new cards already started today count towards the limit', () => {
    const cards = mk(30);
    const today = dayStart(now).getTime() + 3600000;
    const reviews = new Map(cards.slice(0, 5).map(c => [c.id, [{ id: 'r' + c.id, card: c.id, ts: new Date(today).toISOString(), rating: 3, kind: 'review' }]]));
    const states = computeStates(cards, reviews, f, now);
    const q = buildQueue({ cards, states, settings: { ...DEFAULT_SETTINGS, newPerDay: 20 }, now });
    eq(q.counts.new, 15);
  });
  test('archived and deleted cards are never shown', () => {
    const cards = [...mk(2), card('arch', { status: 'archived' }), { id: 'gone', deleted: true, updated: T0.toISOString() }];
    const states = computeStates(cards.filter(c => !c.deleted), new Map(), f, now);
    const q = buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now });
    eq(q.ids.includes('arch') || q.ids.includes('gone'), false);
    eq(q.ids.length, 2);
  });
  test('theme filter', () => {
    const cards = [...mk(3, 't1'), ...mk(4, 't2')];
    const states = computeStates(cards, new Map(), f, now);
    eq(buildQueue({ cards, states, settings: DEFAULT_SETTINGS, themeIds: ['t2'], now }).ids.length, 4);
    eq(buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now }).ids.length, 7);
  });
  test('due reviews are included; not-yet-due ones are not', () => {
    const cards = [card('due'), card('later')];
    const reviews = new Map([
      ['due', [rev('due', 0, 3), rev('due', 10, 3)]],               // due a few days after T0
      ['later', [rev('later', 0, 3), rev('later', 10, 4)]],
    ]);
    const states = computeStates(cards, reviews, f, now);
    const soon = new Date(states.get('due').state.due);
    const q = buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now: soon });
    ok(q.ids.includes('due'));
  });
  test('max reviews per day', () => {
    const cards = mk(10);
    const reviews = new Map(cards.map(c => [c.id, [rev(c.id, 0, 3), rev(c.id, 10, 3)]]));
    const states = computeStates(cards, reviews, f, now);
    const q = buildQueue({ cards, states, settings: { ...DEFAULT_SETTINGS, maxReviewsPerDay: 4 }, now });
    eq(q.counts.review, 4);
  });
  test('session: an Again card comes back after the others, within the day', () => {
    const s = new Session(['a', 'b'], { now: new Date('2026-10-20T10:00:00') });
    eq(s.next(new Date('2026-10-20T10:00:00')), 'a');
    s.answered('a', { state: State.Learning, due: new Date('2026-10-20T10:01:00') });
    eq(s.next(new Date('2026-10-20T10:00:10')), 'b');
    s.answered('b', { state: State.Review, due: new Date('2026-10-25T10:00:00') });
    eq(s.next(new Date('2026-10-20T10:00:20')), 'a', 'learn-ahead shows it early when nothing else is left');
    eq(s.remaining, 1);
  });
  test('a card failed a moment ago counts as due but waits its turn', () => {
    const cards = [card('c1')];
    const reviews = new Map([['c1', [rev('c1', 0, Rating.Again)]]]);
    const states = computeStates(cards, reviews, f, new Date(at(0)));
    const q = buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now: new Date(at(0.5)) });
    eq(q.counts.learning, 1);
    eq(q.ids, []);
    eq(q.later.map(x => x.id), ['c1']);
  });
  test('session: graduated cards leave the session', () => {
    const s = new Session(['a']);
    s.answered('a', { state: State.Review, due: new Date(Date.now() + 86400000 * 3) });
    eq(s.next(), null);
  });
  test('new cards are spread among reviews', () => {
    const order = interleave(['r1', 'r2', 'r3', 'r4'], ['n1', 'n2']);
    eq(order.join(','), 'r1,r2,n1,r3,r4,n2');
    eq(interleave(['r1'], []).join(','), 'r1');
    eq(interleave([], ['n1', 'n2']).join(','), 'n1,n2');
  });
});

// ---------- Files and merging ----------
function makeData() {
  return { themes: new Map(), cards: new Map(), entries: new Map(), reviews: new Map(), settings: { ...DEFAULT_SETTINGS, updated: '2026-10-01T00:00:00.000Z' } };
}

describe('Files and merging', () => {
  test('entries survive a round trip through Markdown', () => {
    const e = { id: 'e_1', title: 'What are "APIs"?', theme: 't1', added: '2026-10-08', created: 'x', updated: 'y',
      sources: ['Head First APIs, ch. 1', 'https://claude.ai/share/abc'], builds_on: ['e_0'], related: [],
      summary: 'Line one.\n\nLine two: with a colon.', questions: ['What is an API?'] };
    eq(markdownToEntry(entryToMarkdown(e, 'Software & coding')), e);
  });
  test('everything survives toFiles → fromFiles', () => {
    const d = makeData();
    d.themes.set('t1', { id: 't1', name: 'Software & coding', created: 'a', updated: 'a' });
    d.themes.set('t2', { id: 't2', name: 'Learning Spanish', created: 'b', updated: 'b' });
    const c1 = newCard({ theme: 't1', prompts: ['Q1', 'Q1b'], answer: 'A1', unverified: true }, { id: 'c1', now: 'n1' });
    const c2 = newCard({ theme: 't2', prompts: ['árbol?'], answer: 'tree', type: 'exact', accept: ['wood'] }, { id: 'c2', now: 'n2' });
    d.cards.set('c1', c1).set('c2', c2).set('c3', { id: 'c3', deleted: true, created: 'n0', updated: 'n3' });
    d.entries.set('e1', { id: 'e1', title: 'APIs', theme: 't1', added: '2026-10-08', created: 'n', updated: 'n', sources: [], builds_on: [], related: [], summary: 'S', questions: [] });
    d.reviews.set('r1', rev('c1', 0, 3)).set('r2', rev('c2', 5, 1, { device: 'd2' }));
    const files = toFiles(d);
    ok(files.has('cards/software-and-coding.json') && files.has('cards/learning-spanish.json') && files.has('cards/_deleted.json'), [...files.keys()].join(', '));
    ok(files.has('library/software-and-coding/apis.md'));
    ok(files.has('reviews/d1/2026-10.jsonl') && files.has('reviews/d2/2026-10.jsonl'));
    for (const p of files.keys()) ok(isManagedPath(p), `${p} should be managed`);
    const back = fromFiles(files);
    eq(back.errors, []);
    eq(back.cards.sort((a, b) => (a.id < b.id ? -1 : 1)), [c1, c2, { id: 'c3', deleted: true, created: 'n0', updated: 'n3' }]);
    eq(back.reviews.length, 2);
    eq(back.entries[0].title, 'APIs');
    eq(back.settings.retention, 0.9);
  });
  test('the newer edit wins, in both directions', () => {
    const local = new Map([['c1', card('c1', { answer: 'old', updated: '2026-10-01T10:00:00Z' })]]);
    mergeInto(local, [card('c1', { answer: 'new', updated: '2026-10-01T11:00:00Z' })]);
    eq(local.get('c1').answer, 'new');
    mergeInto(local, [card('c1', { answer: 'older', updated: '2026-10-01T09:00:00Z' })]);
    eq(local.get('c1').answer, 'new');
  });
  test('a permanent deletion beats an older edit, so the card does not come back', () => {
    const c = card('c1', { updated: '2026-10-01T10:00:00Z' });
    const local = new Map([['c1', c]]);
    mergeInto(local, [tombstone(c, '2026-10-01T12:00:00Z')]);
    eq(local.get('c1').deleted, true);
  });
  test('unmanaged files are left alone', () => {
    ok(!isManagedPath('README.md'));
    ok(!isManagedPath('coach/INSTRUCTIONS.md'));
    ok(!isManagedPath('notes/mine.md'));
  });
  test('diffFiles only writes changes and removes stale managed files', () => {
    const remote = new Map([['a.json', { text: 'x' }], ['cards/old.json', { text: 'y' }], ['README.md', { text: 'r' }]]);
    const desired = new Map([['a.json', 'x'], ['cards/new.json', 'z']]);
    const ch = diffFiles(desired, remote, isManagedPath);
    eq([...ch], [['cards/new.json', 'z'], ['cards/old.json', null]]);
  });
});

// ---------- Sync against a pretend GitHub ----------
function fakeGitHub() {
  const blobs = new Map();   // sha -> text
  const trees = new Map();   // id -> Map(path -> sha)
  const commits = new Map(); // sha -> { tree, parents }
  let head = null;
  let n = 0;
  const gh = { pushes: 0, beforePatch: null };
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => null } });

  async function commitFiles(map, parent) {
    const treeId = `tree${++n}`;
    trees.set(treeId, map);
    const sha = `commit${++n}`;
    commits.set(sha, { tree: treeId, parents: parent ? [parent] : [] });
    return sha;
  }
  gh.files = () => {
    const out = new Map();
    if (!head) return out;
    for (const [p, sha] of trees.get(commits.get(head).tree)) out.set(p, blobs.get(sha));
    return out;
  };
  gh.writeDirect = async (path, text) => {   // another device pushing
    const map = new Map(head ? trees.get(commits.get(head).tree) : []);
    const sha = await gitBlobSha(text);
    blobs.set(sha, text);
    map.set(path, sha);
    head = await commitFiles(map, head);
  };
  gh.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, '');
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET' && path === '') return reply(200, { default_branch: 'main' });
    if (method === 'GET' && path === '/git/ref/heads/main') return head ? reply(200, { object: { sha: head } }) : reply(409, { message: 'Git Repository is empty.' });
    let m;
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(.+)$/))) return reply(200, { tree: { sha: commits.get(m[1]).tree } });
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/([^?]+)/))) {
      return reply(200, { truncated: false, tree: [...trees.get(m[1])].map(([p, sha]) => ({ path: p, type: 'blob', sha })) });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/(.+)$/))) return reply(200, { content: utf8ToBase64(blobs.get(m[1])), encoding: 'base64' });
    if (method === 'POST' && path === '/git/trees') {
      const map = new Map(trees.get(body.base_tree));
      for (const t of body.tree) {
        if (t.sha === null) map.delete(t.path);
        else {
          const sha = await gitBlobSha(t.content);
          blobs.set(sha, t.content);
          map.set(t.path, sha);
        }
      }
      const id = `tree${++n}`;
      trees.set(id, map);
      return reply(201, { sha: id });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = `commit${++n}`;
      commits.set(sha, { tree: body.tree, parents: body.parents });
      return reply(201, { sha });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (gh.beforePatch) { const fn = gh.beforePatch; gh.beforePatch = null; await fn(); }
      if (commits.get(body.sha).parents[0] !== head) return reply(422, { message: 'Update is not a fast forward' });
      head = body.sha;
      gh.pushes++;
      return reply(200, {});
    }
    if (method === 'PUT' && path === '/contents/README.md') {
      await gh.writeDirect('README.md', base64ToUtf8(body.content));
      return reply(201, {});
    }
    return reply(404, { message: `Fake GitHub: no route for ${method} ${path}` });
  };
  return gh;
}

// A pretend device: its own data plus the same merge/desired logic the app uses.
function device(gh) {
  const data = makeData();
  const cache = new Map();
  const client = new GitHubClient({ owner: 'me', repo: 'data', token: 't', fetchImpl: gh.fetch });
  const sync = () => runSync(client, {
    cache,
    wanted: p => isManagedPath(p) || p === 'README.md',
    isManaged: isManagedPath,
    merge: async texts => {
      const parsed = fromFiles(texts);
      mergeInto(data.themes, parsed.themes);
      mergeInto(data.cards, parsed.cards);
      mergeInto(data.entries, parsed.entries);
      for (const r of parsed.reviews) if (!data.reviews.has(r.id)) data.reviews.set(r.id, r);
      if (parsed.settings && parsed.settings.updated > data.settings.updated) data.settings = parsed.settings;
    },
    desired: remote => {
      const files = toFiles(data);
      if (!remote.get('README.md')?.text.includes('marker')) files.set('README.md', 'marker readme');
      return files;
    },
    initialReadme: 'hello',
  });
  return { data, sync };
}

describe('Sync with GitHub (simulated)', () => {
  test('sets up an empty repository and pushes the first data', async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    a.data.themes.set('t1', { id: 't1', name: 'Software', created: 'a', updated: 'a' });
    a.data.cards.set('c1', card('c1'));
    await a.sync();
    ok(gh.files().has('cards/software.json'));
    ok(gh.files().get('README.md').includes('marker'));
  });
  test('two devices reviewing offline end up with both sets of reviews', async () => {
    const gh = fakeGitHub();
    const phone = device(gh), mac = device(gh);
    phone.data.themes.set('t1', { id: 't1', name: 'Software', created: 'a', updated: 'a' });
    phone.data.cards.set('c1', card('c1'));
    await phone.sync();
    await mac.sync();
    eq(mac.data.cards.has('c1'), true);
    phone.data.reviews.set('p1', rev('c1', 0, 3, { id: 'p1', device: 'phone' }));
    mac.data.reviews.set('m1', rev('c1', 5, 1, { id: 'm1', device: 'mac' }));
    await phone.sync();
    await mac.sync();
    await phone.sync();
    eq([...phone.data.reviews.keys()].sort(), ['m1', 'p1']);
    eq([...mac.data.reviews.keys()].sort(), ['m1', 'p1']);
    ok(gh.files().has('reviews/phone/2026-10.jsonl') && gh.files().has('reviews/mac/2026-10.jsonl'));
  });
  test('if another device pushes mid-sync, it retries and keeps both changes', async () => {
    const gh = fakeGitHub();
    const phone = device(gh), mac = device(gh);
    phone.data.themes.set('t1', { id: 't1', name: 'Software', created: 'a', updated: 'a' });
    await phone.sync();
    await mac.sync();
    phone.data.cards.set('c1', card('c1', { theme: 't1', answer: 'from phone' }));
    mac.data.cards.set('c2', card('c2', { theme: 't1', answer: 'from mac' }));
    gh.beforePatch = () => mac.sync(); // the Mac sneaks in while the phone is mid-push
    await phone.sync();
    await mac.sync();
    const remote = JSON.parse(gh.files().get('cards/software.json')).cards.map(c => c.id).sort();
    eq(remote, ['c1', 'c2']);
    eq([...mac.data.cards.keys()].sort(), ['c1', 'c2']);
  });
  test('an edit on one device reaches the other; a stale device does not undo it', async () => {
    const gh = fakeGitHub();
    const phone = device(gh), mac = device(gh);
    phone.data.themes.set('t1', { id: 't1', name: 'Software', created: 'a', updated: 'a' });
    phone.data.cards.set('c1', card('c1', { answer: 'v1', updated: '2026-10-01T10:00:00Z' }));
    await phone.sync();
    await mac.sync();
    mac.data.cards.set('c1', { ...mac.data.cards.get('c1'), answer: 'v2', updated: '2026-10-02T10:00:00Z' });
    await mac.sync();
    await phone.sync(); // phone still had v1 locally
    eq(phone.data.cards.get('c1').answer, 'v2');
    eq(JSON.parse(gh.files().get('cards/software.json')).cards[0].answer, 'v2');
  });
  test('renaming a theme moves its file and removes the old one', async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    a.data.themes.set('t1', { id: 't1', name: 'Software', created: 'a', updated: 'a' });
    a.data.cards.set('c1', card('c1'));
    await a.sync();
    a.data.themes.set('t1', { id: 't1', name: 'Coding', created: 'a', updated: 'b' });
    await a.sync();
    ok(gh.files().has('cards/coding.json') && !gh.files().has('cards/software.json'), [...gh.files().keys()].join(', '));
  });
  test('files the app does not manage are never touched', async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    await a.sync();
    await gh.writeDirect('notes/my-notes.md', 'mine');
    await a.sync();
    eq(gh.files().get('notes/my-notes.md'), 'mine');
  });
  test('a second sync with no changes makes no commit', async () => {
    const gh = fakeGitHub();
    const a = device(gh);
    a.data.cards.set('c1', card('c1'));
    await a.sync();
    const pushes = gh.pushes;
    const res = await a.sync();
    eq(res.pushed, 0);
    eq(gh.pushes, pushes);
  });
});

describe('Sub-themes', () => {
  const themes = () => new Map([
    ['es', { id: 'es', name: 'Spanish', created: 'a', updated: 'a' }],
    ['verbs', { id: 'verbs', name: 'Verbs', parent: 'es', created: 'b', updated: 'b' }],
    ['words', { id: 'words', name: '1000 beginner words', parent: 'es', created: 'c', updated: 'c' }],
    ['sw', { id: 'sw', name: 'Software & coding', created: 'd', updated: 'd' }],
    ['old', { id: 'old', name: 'Old', parent: 'es', deleted: true, created: 'e', updated: 'e' }],
  ]);
  test('tree: themes with their sub-themes, sorted by name', () => {
    eq(themeTree(themes()).map(n => [n.theme.name, n.children.map(c => c.name)]),
      [['Software & coding', []], ['Spanish', ['1000 beginner words', 'Verbs']]]);
  });
  test('a theme covers its sub-themes; a sub-theme covers only itself', () => {
    eq(themeAndChildren(themes(), 'es').sort(), ['es', 'verbs', 'words']);
    eq(themeAndChildren(themes(), 'verbs'), ['verbs']);
  });
  test('labels', () => {
    eq(themeLabel(themes(), 'verbs'), 'Spanish › Verbs');
    eq(themeLabel(themes(), 'es'), 'Spanish');
  });
  test('a sub-theme whose theme was deleted becomes a top-level theme', () => {
    const t = themes();
    t.set('es', { ...t.get('es'), deleted: true });
    eq(themeTree(t).map(n => n.theme.name), ['1000 beginner words', 'Software & coding', 'Verbs']);
  });
  test('files go in sub-folders and come back intact', () => {
    const d = makeData();
    d.themes = themes();
    const c1 = newCard({ theme: 'verbs', prompts: ['to eat?'], answer: 'comer', type: 'exact' }, { id: 'c1', now: 'n1' });
    const c2 = newCard({ theme: 'es', prompts: ['hello?'], answer: 'hola' }, { id: 'c2', now: 'n2' });
    d.cards.set('c1', c1).set('c2', c2);
    d.entries.set('e1', { id: 'e1', title: 'Regular -er verbs', theme: 'verbs', added: 'x', created: 'n', updated: 'n', sources: [], builds_on: [], related: [], summary: 'S', questions: [] });
    const files = toFiles(d);
    ok(files.has('cards/spanish/verbs.json') && files.has('cards/spanish.json'), [...files.keys()].join(', '));
    ok(files.has('library/spanish/verbs/regular-er-verbs.md'));
    eq(JSON.parse(files.get('cards/spanish/verbs.json')).theme_name, 'Spanish › Verbs');
    for (const p of files.keys()) ok(isManagedPath(p), `${p} should be managed`);
    const back = fromFiles(files);
    eq(back.errors, []);
    eq(back.cards.sort((a, b) => (a.id < b.id ? -1 : 1)), [c1, c2]);
    eq(back.themes.find(t => t.id === 'verbs').parent, 'es');
    eq(back.entries[0].theme, 'verbs');
  });
  test('importing names a sub-theme (JSON field, "A / B", or a Subtheme: line)', () => {
    eq(parseImport('{"theme":"Spanish","subtheme":"Verbs","cards":[{"q":"a","a":"b"}]}').subthemeName, 'Verbs');
    const r = parseImport('{"theme":"Spanish / 1000 beginner words","cards":[{"q":"a","a":"b"}]}');
    eq([r.themeName, r.subthemeName], ['Spanish', '1000 beginner words']);
    const t = parseImport('Theme: Spanish\nSubtheme: Verbs\n\nQ: to eat?\nA: comer');
    eq([t.themeName, t.subthemeName, t.cards.length], ['Spanish', 'Verbs', 1]);
    eq(parseImport('Theme: Spanish > Verbs\nQ: a\nA: b').subthemeName, 'Verbs');
    eq(parseImport('{"theme":"AI/ML","cards":[{"q":"a","a":"b"}]}').themeName, 'AI/ML');
  });
});

describe('Language words', () => {
  const meanings = a => splitMeanings(a);
  test('meanings split at commas, but not inside brackets', () => {
    eq(meanings('to take, to select, to get (understand, grasp)'), ['to take', 'to select', 'to get (understand, grasp)']);
    eq(meanings('to win; to earn (payment)'), ['to win', 'to earn (payment)']);
  });
  test('any one meaning counts, with or without "to" and the bracketed clarifier', () => {
    const m = meanings('to pass, to happen');
    eq(checkMeaning('to happen', m).result, 'correct');
    eq(checkMeaning('pass', m).result, 'correct');
    eq(checkMeaning('To Pass ', m).result, 'correct');
    const be = meanings('to be (temporary)');
    eq(checkMeaning('to be', be).result, 'correct');
    eq(checkMeaning('to be temporary', be).result, 'correct');
    eq(checkMeaning('to be (temporary)', be).result, 'correct');
  });
  test('typing several meanings is right if each one is', () => {
    const m = meanings('to pass, to happen');
    eq(checkMeaning('to pass, to happen', m).result, 'correct');
    eq(checkMeaning('to pass or to happen', m).result, 'correct');
    eq(checkMeaning('to pass, to eat', m).result, 'wrong');
  });
  test('wrong and blank answers', () => {
    eq(checkMeaning('to eat', meanings('to drink')).result, 'wrong');
    eq(checkMeaning('', meanings('to drink')).result, 'blank');
  });
  test('extra accepted answers count', () => {
    eq(checkMeaning('to conceal', [...meanings('to hide'), 'to conceal']).result, 'correct');
  });
  test('shared meanings: clarifiers keep ser and estar apart; tirar and echar match', () => {
    ok(meaningKey('to be (temporary)') !== meaningKey('to be (permanent)'));
    eq(meaningKey('to throw'), meaningKey('To throw'));
    eq(meaningKey('throw'), meaningKey('to throw'));
  });
  test('schedule keys for the two directions', () => {
    eq(schedKey('c1', 'fwd'), 'c1');
    eq(parseKey(schedKey('c1', 'rev')), { id: 'c1', dir: 'rev' });
    eq(reviewKey({ card: 'c1', dir: 'rev' }), schedKey('c1', 'rev'));
    eq(reviewKey({ card: 'c1' }), 'c1');
    eq(keysOf({ id: 'c1', type: 'word' }).length, 2);
    eq(keysOf({ id: 'c1', type: 'concept' }).length, 1);
  });
  test('word cards keep their fields through files', () => {
    const c = newCard({ theme: 't1', type: 'word', prompts: ['tener'], answer: 'to have', note: 'e→ie', related: ['c9'], also_in: ['t2', 't1'] }, { id: 'c1', now: 'n' });
    eq([c.type, c.note, c.related, c.also_in], ['word', 'e→ie', ['c9'], ['t2']]);
    const d = makeData();
    d.cards.set('c1', c);
    eq(fromFiles(toFiles(d)).cards.find(x => x.id === 'c1'), c);
  });
  test('a copy stripped by an older app version never beats the full copy', () => {
    const full = cleanCard({ id: 'c1', theme: 't1', type: 'word', prompts: ['tener'], answer: 'to have', note: 'e→ie', updated: 'u1', created: 'c' });
    const stripped = { id: 'c1', theme: 't1', type: 'concept', prompts: ['tener'], answer: 'to have', updated: 'u1', created: 'c' };
    const a = new Map([['c1', full]]);
    mergeInto(a, [stripped]);
    eq(a.get('c1').type, 'word');
    const b = new Map([['c1', stripped]]);
    mergeInto(b, [full]);
    eq(b.get('c1').note, 'e→ie');
  });
  test('cards made before this version get empty new fields', () => {
    const old = cleanCard({ id: 'c1', theme: 't1', type: 'concept', prompts: ['q'], answer: 'a' });
    eq([old.also_in, old.note, old.opposites, old.related], [[], '', [], []]);
  });
  test('a theme\'s language comes from its top theme', () => {
    const t = new Map([['es', { id: 'es', name: 'Spanish', language: 'Spanish' }], ['v', { id: 'v', name: 'Verbs', parent: 'es' }]]);
    eq(themeLanguage(t, 'v'), 'Spanish');
    eq(themeLanguage(t, 'missing'), '');
  });
});

describe('Reviewing words both ways', () => {
  const f = makeScheduler(DEFAULT_SETTINGS);
  const now = new Date('2026-10-20T10:00:00');
  const words = n => Array.from({ length: n }, (_, i) => card(`w${i}`, { type: 'word', prompts: [`w${i}`], answer: `m${i}`, created: new Date(T0.getTime() + i * 1000).toISOString() }));
  test('each direction has its own schedule; old reviews count as word → meaning', () => {
    const cards = words(1);
    const byKey = new Map([['w0', [rev('w0', 0, 3), rev('w0', 10, 3)]]]);
    const states = computeStates(cards, byKey, f, now);
    eq(states.get('w0').state.state, State.Review);
    eq(states.get(schedKey('w0', 'rev')).state.state, State.New);
  });
  test('one direction only', () => {
    const cards = words(3);
    const states = computeStates(cards, new Map(), f, now);
    eq(buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now, dirOf: () => 'fwd' }).ids.sort(), ['w0', 'w1', 'w2']);
    eq(buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now, dirOf: () => 'rev' }).ids.map(k => parseKey(k).dir), ['rev', 'rev', 'rev']);
  });
  test('mixed: never both directions of a word in one session', () => {
    const cards = words(10);
    const states = computeStates(cards, new Map(), f, now);
    const q = buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now, dirOf: () => 'mixed' });
    eq(q.ids.length, 10);
    eq(new Set(q.ids.map(k => parseKey(k).id)).size, 10);
  });
  test('mixed: once a word was asked one way today, the other way waits until tomorrow', () => {
    const cards = words(1);
    const today = new Date(dayStart(now).getTime() + 3600000).toISOString();
    const byKey = new Map([['w0', [{ id: 'r1', card: 'w0', ts: today, rating: 3, kind: 'review' }]]]);
    // Word → meaning was asked an hour into today; meaning → word is still new.
    const states = computeStates(cards, byKey, f, now);
    const q = buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now, dirOf: () => 'mixed' });
    ok(!q.ids.includes(schedKey('w0', 'rev')), q.ids.join(','));
    // Choosing English → Spanish explicitly still shows it.
    ok(buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now, dirOf: () => 'rev' }).ids.includes(schedKey('w0', 'rev')));
  });
  test('mixed: a direction already due beats a new one', () => {
    const cards = words(1);
    const byKey = new Map([['w0', [rev('w0', 0, 3), rev('w0', 10, 3)]]]);
    const states = computeStates(cards, byKey, f, now);
    const due = new Date(new Date(states.get('w0').state.due).getTime() + 1000);
    const q = buildQueue({ cards, states, settings: DEFAULT_SETTINGS, now: due, dirOf: () => 'mixed' });
    eq(q.ids, ['w0']);
  });
  test('a wrong linked-word check brings that word back later in the session', () => {
    const s = new Session(['a'], { now: new Date('2026-10-20T10:00:00') });
    s.relearn('b@r', { state: State.Relearning, due: new Date('2026-10-20T10:10:00') });
    eq(s.later.map(x => x.id), ['b@r']);
    s.relearn('a', { state: State.Relearning, due: new Date('2026-10-20T10:10:00') });
    eq(s.later.length, 1, 'already queued, so left alone');
  });
});

describe('Cards in several sub-themes', () => {
  const f = makeScheduler(DEFAULT_SETTINGS);
  const now = new Date('2026-10-20T10:00:00');
  test('a card counts in its main and extra sub-themes, once', () => {
    const c = card('c1', { theme: 'verbs', also_in: ['irregular'] });
    ok(inThemes(c, ['irregular']) && inThemes(c, ['verbs']) && !inThemes(c, ['food']));
    const states = computeStates([c], new Map(), f, now);
    eq(buildQueue({ cards: [c], states, settings: DEFAULT_SETTINGS, themeIds: ['irregular'], now }).ids, ['c1']);
    eq(buildQueue({ cards: [c], states, settings: DEFAULT_SETTINGS, themeIds: ['verbs', 'irregular'], now }).ids, ['c1']);
  });
  test('the file is chosen by the main sub-theme only', () => {
    const d = makeData();
    d.themes = new Map([
      ['es', { id: 'es', name: 'Spanish', created: 'a', updated: 'a' }],
      ['verbs', { id: 'verbs', name: 'Verbs', parent: 'es', created: 'b', updated: 'b' }],
      ['irr', { id: 'irr', name: 'Irregular', parent: 'es', created: 'c', updated: 'c' }],
    ]);
    d.cards.set('c1', card('c1', { theme: 'verbs', also_in: ['irr'] }));
    const files = toFiles(d);
    ok(files.has('cards/spanish/verbs.json') && !files.has('cards/spanish/irregular.json'), [...files.keys()].join(', '));
  });
});

describe('Importing words', () => {
  test('word lines with notes and links', () => {
    const r = parseImport('Theme: Spanish / Verbs, Irregular\nesconder = to hide; opposite: encontrar, mostrar\ntener = to have; note: e→ie, irregular 1st person: tengo; related: tener que');
    eq([r.themeName, r.subthemeName, r.extraSubs], ['Spanish', 'Verbs', ['Irregular']]);
    eq(r.cards.length, 2);
    eq([r.cards[0].type, r.cards[0].prompts, r.cards[0].answer], ['word', ['esconder'], 'to hide']);
    eq(r.cards[0].linkNames.opposite, ['encontrar', 'mostrar']);
    eq(r.cards[1].note, 'e→ie, irregular 1st person: tengo');
    eq(r.cards[1].linkNames.related, ['tener que']);
  });
  test('a meaning with commas and brackets stays whole', () => {
    const r = parseImport('coger = to take, to get (understand); note: g→j');
    eq([r.cards[0].answer, r.cards[0].note], ['to take, to get (understand)', 'g→j']);
  });
  test('JSON word cards and a list of sub-themes', () => {
    const r = parseImport('{"theme":"Spanish","subtheme":["Verbs","Irregular"],"cards":[{"type":"word","word":"ir","meaning":"to go","note":"irregular","opposites":["venir"]}]}');
    eq([r.subthemeName, r.extraSubs], ['Verbs', ['Irregular']]);
    eq([r.cards[0].type, r.cards[0].prompts, r.cards[0].answer, r.cards[0].note, r.cards[0].linkNames.opposite], ['word', ['ir'], 'to go', 'irregular', ['venir']]);
  });
  test('Q/A cards are unaffected by "=" inside an answer', () => {
    const r = parseImport('Q: What is 2+2?\nA: 2 + 2 = 4');
    eq([r.cards.length, r.cards[0].type, r.cards[0].answer], [1, 'concept', '2 + 2 = 4']);
  });
  test('word card hints and errors', () => {
    eq(cardHints({ type: 'word', prompts: ['llevar'], answer: 'to take, to carry, to wear' }), []);
    eq(cardErrors({ type: 'word', prompts: [''], answer: 'x' }).length, 1);
  });
});

describe('Helpers', () => {
  test('git blob SHA matches git itself', async () => {
    eq(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    eq(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  });
  test('base64 round trip with accents and emoji', () => {
    const s = 'árbol ñ 🌳 “quotes”';
    eq(base64ToUtf8(utf8ToBase64(s)), s);
  });
  test('the learning day starts at 4am', () => {
    eq(dayStart(new Date('2026-10-09T02:30:00')).getDate(), 8);
    eq(dayStart(new Date('2026-10-09T05:00:00')).getDate(), 9);
  });
});

// ---------- Runner ----------
(async () => {
  const out = document.getElementById('out');
  let pass = 0, fail = 0;
  for (const t of tests) {
    if (t.group) {
      out.insertAdjacentHTML('beforeend', `<h2>${t.group}</h2>`);
      continue;
    }
    try {
      await t.fn();
      pass++;
      out.insertAdjacentHTML('beforeend', `<div class="pass">✓ ${t.name}</div>`);
    } catch (e) {
      fail++;
      out.insertAdjacentHTML('beforeend', `<div class="fail">✗ ${t.name}</div><div class="err">${String(e.stack ?? e.message).replace(/</g, '&lt;')}</div>`);
    }
  }
  const summary = document.getElementById('summary');
  summary.textContent = fail ? `${fail} failed, ${pass} passed` : `All ${pass} tests passed`;
  summary.className = fail ? 'fail' : 'pass';
  window.testResults = { pass, fail };
})();
