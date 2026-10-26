import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { journeys, getQuestions, getResult, buildGraph, trace, findPathTo, setAnswer, cleanAnswers, possibleOutcomes, encodeState, decodeState, exportMarkdown } from '../src/model.mjs';

const expected = { repeat: [27, 7, 16], overlap: [27, 5, 12], campaign: [109, 7, 20], measurement: [14, 11, 16] };
for (const { id } of journeys) {
  const graph = buildGraph(id);
  test(`${id}: all source paths reach the exact source response through the graph`, () => {
    const [paths, outcomes, nodes] = expected[id];
    assert.equal(graph.paths.length, paths); assert.equal(graph.outcomeCount, outcomes); assert.equal(graph.nodes.length, nodes);
    for (const p of graph.paths) {
      const route = trace(graph, p.answers); assert.equal(route.complete, true);
      assert.deepEqual(route.current.result, getResult(id, p.answers));
      assert.equal(route.edges.length, getQuestions(id, p.answers).length);
      for (const e of route.edges) assert.ok(graph.byId.get(e.source).rank < graph.byId.get(e.target).rank);
    }
  });
  test(`${id}: every graph node has a real navigable route`, () => {
    for (const node of graph.nodes) {
      const prefix = findPathTo(graph, node.id, graph.paths.at(-1).answers);
      assert.equal(trace(graph, prefix).current.id, node.id);
      assert.ok(possibleOutcomes(graph, node.id).length > 0);
    }
  });
  test(`${id}: share links round-trip every complete path`, () => {
    for (const p of graph.paths) assert.deepEqual(decodeState(encodeState(id, p.answers)), { journey: id, answers: p.answers });
  });
}
test('Repeated keys retain different response text and intent', () => {
  const no = { warning: 'no', repeat: 'no', messages: 'running' }, unknown = { ...no, repeat: 'unknown' };
  assert.equal(getResult('repeat', no).key, 'purpose'); assert.equal(getResult('overlap', no).key, 'overlap');
  assert.notEqual(getResult('repeat', no).title, getResult('repeat', unknown).title);
  const foundation = { warning: 'no', repeat: 'known', messages: 'none' };
  assert.equal(getResult('repeat', foundation).key, getResult('overlap', foundation).key);
  assert.notEqual(getResult('repeat', foundation).why, getResult('overlap', foundation).why);
});
test('No early exits are invented when the result is already determined', () => {
  const graph = buildGraph('repeat');
  const warned = graph.paths.filter(p => p.answers.warning === 'yes'); assert.equal(warned.length, 9);
  for (const p of warned) { assert.equal(trace(graph, p.answers).edges.length, 3); assert.equal(p.result.key, 'warning'); }
  const campaign = buildGraph('campaign');
  const incompleteFacts = campaign.paths.filter(p => p.answers.goal === 'offer' && p.answers.facts === 'gaps');
  for (const p of incompleteFacts) { assert.equal(trace(campaign, p.answers).edges.length, 5); assert.equal(p.result.key, 'facts'); }
});
test('Campaign precedence and variable-length paths remain faithful', () => {
  const a = { goal: 'offer', facts: 'gaps', terms: 'missing', audience: 'overlap', production: 'checked' };
  assert.equal(getResult('campaign', a).key, 'facts'); assert.equal(getResult('campaign', { ...a, facts: 'approved' }).key, 'terms');
  const education = { goal: 'education', facts: 'approved', audience: 'reviewed', production: 'checked' };
  assert.equal(getResult('campaign', education).key, 'owner-review'); assert.equal(getQuestions('campaign', education).length, 4);
  assert.deepEqual(setAnswer('campaign', a, 'goal', 'education'), { goal: 'education' });
  const unknown = setAnswer('campaign', a, 'goal', 'unknown');
  assert.deepEqual(unknown, { goal: 'unknown' }); assert.equal(trace(buildGraph('campaign'), unknown).complete, true);
});
test('Earlier changes and reselections clear every downstream value', () => {
  const a = { goal: 'compare', basis: 'same', signal: 'clicks' };
  assert.deepEqual(setAnswer('measurement', a, 'basis', 'different'), { goal: 'compare', basis: 'different' });
  assert.deepEqual(setAnswer('measurement', a, 'goal', 'cause'), { goal: 'cause' });
  assert.deepEqual(setAnswer('measurement', a, 'basis', 'same'), { goal: 'compare', basis: 'same' });
  assert.throws(() => setAnswer('repeat', {}, 'messages', 'running'));
});
test('Disagree asks the reporting-basis question for all answers', () => {
  const responses = ['same', 'different', 'unknown'].map(basis => getResult('measurement', { goal: 'disagree', basis }));
  assert.deepEqual(responses[0], responses[1]); assert.deepEqual(responses[1], responses[2]);
  assert.equal(getQuestions('measurement', { goal: 'disagree' })[1].id, 'basis');
});
test('Untrusted URL values cannot inject content or skipped answers', () => {
  assert.equal(decodeState('#journey=not-a-journey'), null);
  assert.deepEqual(decodeState('#journey=repeat&warning=%3Cscript%3E&messages=running'), { journey: 'repeat', answers: {} });
  assert.deepEqual(cleanAnswers('campaign', { goal: 'education', facts: 'approved', terms: 'missing', audience: 'reviewed', production: 'checked', extra: 'secret' }), { goal: 'education', facts: 'approved', audience: 'reviewed', production: 'checked' });
  assert.equal(decodeState('#' + 'a'.repeat(1001)), null);
});
test('Exports distinguish incomplete paths from final source responses', () => {
  const incomplete = exportMarkdown('repeat', { warning: 'no' }); assert.match(incomplete, /path is incomplete/); assert.doesNotMatch(incomplete, /## Advisor response/);
  const complete = exportMarkdown('measurement', { goal: 'compare', basis: 'same', signal: 'orders' });
  assert.match(complete, /Check what happens after the click\./); assert.match(complete, /## Advisor response/);
});
test('Both bundled source modules match their captured SHA-256 hashes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../source-manifest.json', import.meta.url)));
  for (const [name, pin] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(`../src/advisor/${name}`, import.meta.url));
    assert.equal(bytes.length, pin.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  }
});
