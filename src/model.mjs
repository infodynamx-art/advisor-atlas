import { questions, recommendation, links } from './advisor/content.mjs';
import { guidedQuestions, guidedRecommendation, exampleFor } from './advisor/planning-content.mjs';

export const journeys = [
  { id: 'repeat', title: 'Repeat purchase', description: 'Find the next useful customer task.', icon: 'repeat', tag: 'LIFECYCLE' },
  { id: 'overlap', title: 'Message overlap', description: 'See the whole customer journey.', icon: 'layers', tag: 'LIFECYCLE' },
  { id: 'campaign', title: 'Campaign planning', description: 'Turn an idea into a reviewable plan.', icon: 'mail', tag: 'CAMPAIGNS' },
  { id: 'measurement', title: 'Email results', description: 'Understand what the numbers mean.', icon: 'chart', tag: 'MEASUREMENT' }
];
export const scenarios = [
  { id: 'crowded', journey: 'repeat', name: 'A crowded inbox', line: 'A repeat purchase makes sense. Several messages are already running.', answers: { warning: 'no', repeat: 'known', messages: 'running' } },
  { id: 'care', journey: 'overlap', name: 'Care before another sale', line: 'Customers need product care. A quick reorder is not the goal.', answers: { warning: 'no', repeat: 'no', messages: 'none' } },
  { id: 'offer', journey: 'campaign', name: 'The missing offer terms', line: 'The product is approved. The promotion still has unanswered questions.', answers: { goal: 'offer', facts: 'approved', terms: 'missing', audience: 'reviewed', production: 'checked' } },
  { id: 'click', journey: 'measurement', name: 'After the click', line: 'Delivery and clicks held steady, but fewer customers bought.', answers: { goal: 'compare', basis: 'same', signal: 'orders' } },
  { id: 'credit', journey: 'measurement', name: 'Credit or cause?', line: 'A report credits email for sales. What does that actually establish?', answers: { goal: 'cause', evidence: 'report' } }
];
export function getQuestions(journey, answers = {}) {
  if (journey === 'repeat' || journey === 'overlap') return questions.map(q => journey === 'overlap' && q.id === 'repeat' ? { ...q, intro: 'This is context, not a requirement for reviewing overlap. Useful education or support can matter even when another purchase does not.' } : q);
  return guidedQuestions(journey, answers);
}
export function getResult(journey, answers) {
  return journey === 'repeat' || journey === 'overlap' ? recommendation(answers, journey) : guidedRecommendation(journey, answers);
}
export const fingerprint = result => JSON.stringify(result);
export function cleanAnswers(journey, supplied = {}) {
  const answers = {};
  for (let depth = 0; depth < 8; depth++) {
    const q = getQuestions(journey, answers)[depth];
    if (!q || !q.options.some(([value]) => supplied[q.id] === value)) break;
    answers[q.id] = supplied[q.id];
  }
  return answers;
}
export function setAnswer(journey, current, questionId, value) {
  const valid = cleanAnswers(journey, current);
  const qs = getQuestions(journey, valid);
  const at = qs.findIndex(q => q.id === questionId);
  if (at < 0 || !qs[at].options.some(([v]) => v === value)) throw new Error('Invalid answer');
  // An earlier change invalidates every answer after it, exactly as in the Advisor.
  const prefix = {};
  for (const q of qs.slice(0, at)) {
    if (valid[q.id] === undefined) throw new Error('Answer the earlier question first');
    prefix[q.id] = valid[q.id];
  }
  return { ...prefix, [questionId]: value };
}
export function enumeratePaths(journey) {
  const paths = [];
  function visit(answers) {
    const q = getQuestions(journey, answers)[Object.keys(answers).length];
    if (!q) { paths.push({ answers, result: getResult(journey, answers) }); return; }
    q.options.forEach(([value]) => visit({ ...answers, [q.id]: value }));
  }
  visit({});
  return paths;
}
export function buildGraph(journey) {
  const nodes = [], bySignature = new Map();
  function intern(signature, data) {
    if (bySignature.has(signature)) return bySignature.get(signature);
    const node = { id: `n${nodes.length}`, ...data, rank: 0 };
    nodes.push(node); bySignature.set(signature, node); return node;
  }
  function visit(answers) {
    const q = getQuestions(journey, answers)[Object.keys(answers).length];
    if (!q) {
      const result = getResult(journey, answers);
      return intern('result:' + fingerprint(result), { type: 'result', result, prefix: answers, edges: [] });
    }
    const edges = q.options.map(([value, label]) => ({ value, label, target: visit({ ...answers, [q.id]: value }).id }));
    return intern(JSON.stringify([q, edges]), { type: 'question', question: q, prefix: answers, edges });
  }
  const root = visit({});
  const byId = new Map(nodes.map(n => [n.id, n]));
  function rank(node, depth) {
    if (node.visited && node.rank >= depth) return;
    node.visited = true; node.rank = depth;
    node.edges.forEach(e => rank(byId.get(e.target), depth + 1));
  }
  rank(root, 0);
  const paths = enumeratePaths(journey);
  return { journey, nodes, root: root.id, byId, paths, outcomeCount: nodes.filter(n => n.type === 'result').length };
}
export function trace(graph, supplied) {
  const answers = cleanAnswers(graph.journey, supplied), nodes = [], edges = [];
  let node = graph.byId.get(graph.root);
  while (node) {
    nodes.push(node.id);
    if (node.type === 'result') break;
    const edge = node.edges.find(e => e.value === answers[node.question.id]);
    if (!edge) break;
    edges.push({ source: node.id, ...edge }); node = graph.byId.get(edge.target);
  }
  return { answers, nodes, edges, current: node, complete: node.type === 'result' };
}
export function possibleOutcomes(graph, nodeId) {
  const found = new Set(), visited = new Set();
  function visit(id) { if (visited.has(id)) return; visited.add(id); const n = graph.byId.get(id); if (n.type === 'result') found.add(id); else n.edges.forEach(e => visit(e.target)); }
  visit(nodeId); return [...found];
}
export function reachableNodes(graph, nodeId) {
  const visited = new Set();
  function visit(id) { if (visited.has(id)) return; visited.add(id); graph.byId.get(id).edges.forEach(e => visit(e.target)); }
  visit(nodeId); return visited;
}
export function findPathTo(graph, nodeId, current = {}) {
  // Choose a real route with the longest shared prefix, never fabricate an edge.
  const candidates = graph.paths.filter(p => trace(graph, p.answers).nodes.includes(nodeId));
  const score = answers => { let n = 0; for (const [key, value] of Object.entries(current)) { if (answers[key] !== value) break; n++; } return n; };
  candidates.sort((a, b) => score(b.answers) - score(a.answers));
  const picked = candidates[0];
  if (!picked) return {};
  const answers = {};
  for (const id of trace(graph, picked.answers).nodes) {
    if (id === nodeId) break;
    const n = graph.byId.get(id); if (n.type === 'question') answers[n.question.id] = picked.answers[n.question.id];
  }
  return answers;
}
export function encodeState(journey, answers) {
  return '#' + new URLSearchParams({ journey, ...cleanAnswers(journey, answers) }).toString();
}
export function decodeState(hash) {
  if (hash.length > 1000) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const journey = params.get('journey');
  if (!journeys.some(j => j.id === journey)) return null;
  return { journey, answers: cleanAnswers(journey, Object.fromEntries(params)) };
}
export function exportMarkdown(journey, answers) {
  const valid = cleanAnswers(journey, answers), qs = getQuestions(journey, valid);
  const lines = ['# Advisor Atlas', '', `Journey: ${journeys.find(j => j.id === journey).title}`, '', '## Selected answers', ''];
  for (const q of qs) { const label = q.options.find(([v]) => v === valid[q.id])?.[1]; if (label) lines.push(`- ${q.title} ${label}`); }
  if (qs.every(q => valid[q.id] !== undefined)) {
    const r = getResult(journey, valid); lines.push('', '## Advisor response', '', r.title, '', r.why, '', ...r.steps.map((s, i) => `${i + 1}. ${s}`), '', `Resource: ${links[r.resource]}`);
  } else lines.push('', 'This path is incomplete. No final recommendation has been reached.');
  lines.push('', 'Based on the bundled local Advisor source snapshot. These are selected answers, not verified account findings.', '');
  return lines.join('\n');
}
export function getExample(journey, result) { return exampleFor(journey === 'repeat' || journey === 'overlap' ? 'lifecycle' : journey, result.key); }
export function resourceFor(result) { return links[result.resource]; }

const questionLabels = { warning: 'Sending health', repeat: 'Purchase purpose', messages: 'Existing messages', goal: 'Customer task', facts: 'Facts & destination', terms: 'Offer terms', audience: 'Audience & overlap', production: 'Production checks', basis: 'Reporting basis', signal: 'First changed signal', evidence: 'Evidence of impact' };
export function nodeLabel(node, journey) {
  if (node.type === 'question') return node.question.id === 'goal' && journey === 'measurement' ? 'The decision to make' : questionLabels[node.question.id];
  const r = node.result;
  const map = { warning: 'Review the warning', evidence: journey === 'measurement' ? 'Find the first change' : 'Establish a baseline', purpose: r.title.startsWith('Start') ? 'Choose a useful task' : 'Clarify the purpose', foundation: 'Define one journey', inventory: 'Map every message', overlap: journey === 'campaign' ? 'Review campaign overlap' : 'Review the whole journey', brief: 'Define the campaign’s job', facts: 'Resolve missing facts', terms: 'Clarify the offer terms', audience: 'Clarify the audience', production: 'Check the finished email', 'owner-review': 'Bring checks to the approver', question: 'Name the decision', 'test-review': 'Review the test design', 'causal-evidence': 'Establish the evidence', 'causal-design': 'Plan a fair comparison', reconcile: 'Reconcile definitions', comparison: 'Align the comparison', delivery: 'Investigate delivery', clicks: 'Check links & relevance', orders: 'Check after the click', contribution: 'Check the commercial trade-off' };
  return map[r.key] || r.title;
}
