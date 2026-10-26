import { journeys, scenarios, buildGraph, trace, getQuestions, setAnswer, possibleOutcomes, reachableNodes, findPathTo, nodeLabel, decodeState, encodeState, exportMarkdown, getExample, resourceFor, fingerprint } from './model.mjs';

const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const icons = {
  repeat: '<path d="M4 8h12l-3-3M20 16H8l3 3M4 8v5M20 16v-5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  chart: '<path d="M4 3v17h17M8 15l4-5 4 3 5-7"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  up: '<path d="M6 18 18 6M7 6h11v11"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  stop: '<path d="M7 6v12M16 6v12"/>',
  fit: '<path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6"/>',
  link: '<path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 7c0 7-12 3-12 8"/>',
  pin: '<path d="m15 3 6 6-3 1-4 4-1 4-3-3-6 6 6-6-3-3 4-1 4-4 1-3Z"/>',
  compare: '<path d="M4 5h6v14H4zM14 5h6v14h-6zM12 2v20"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>'
};
function icon(name) { const i = svgEl('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' }); i.innerHTML = icons[name] || icons.branch; return i; }
function button(label, className, action, symbol) { const b = el('button', className); b.type = 'button'; if (symbol) b.append(icon(symbol)); b.append(document.createTextNode(label)); b.addEventListener('click', action); return b; }
function setButton(id, label, symbol) { $(id).replaceChildren(icon(symbol), document.createTextNode(label)); }
setButton('scenario-button', 'Try a scenario', 'spark'); setButton('share-button', 'Share path', 'link'); $('fit-button').append(icon('fit'));

const graphs = new Map(journeys.map(j => [j.id, buildGraph(j.id)]));
const initial = decodeState(location.hash);
let journey = initial?.journey || 'repeat';
let answers = initial?.answers || { ...scenarios[0].answers };
let graph = graphs.get(journey), route = trace(graph, answers);
let selected = route.current.id, pinned = null, pathOnly = true, camera = { x: 0, y: 0, scale: 1 };
let positions = new Map(), bounds = { width: 600, height: 340 }, playToken = 0, playing = false, toastTimer, activeScenario = initial ? null : 'crowded';
let showExample = false, pan = null, moved = false, modalReturnFocus;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function announce(message) { $('announcement').textContent = message; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200); }
function stopPlay() { playToken++; playing = false; updatePlayButton(); }
function updatePlayButton() { setButton('play-button', playing ? 'Stop walkthrough' : 'Play walkthrough', playing ? 'stop' : 'play'); }
function updateHash() { history.replaceState(null, '', encodeState(journey, answers)); }
function focusInspector() { const heading = $('inspector').querySelector('h2'); heading?.focus({ preventScroll: true }); if (matchMedia('(max-width:740px)').matches) $('inspector').scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'start' }); }
function changeJourney(id, nextAnswers = {}, scenario = null) {
  stopPlay(); const hadPin = !!pinned;
  journey = id; graph = graphs.get(id); answers = nextAnswers; pinned = null; activeScenario = scenario; showExample = false;
  route = trace(graph, answers); selected = route.current.id; updateHash(); render(true); focusInspector();
  if (hadPin) toast('Pinned comparison cleared for the new scenario.');
}
function choose(questionId, value) {
  stopPlay(); answers = setAnswer(journey, answers, questionId, value); activeScenario = null; showExample = false;
  route = trace(graph, answers); selected = route.current.id; updateHash(); render(true); focusInspector();
  announce(route.complete ? `Outcome: ${route.current.result.title}` : `${route.current.question.title} ${possibleOutcomes(graph, route.current.id).length} possible outcomes remain.`);
}
function inspect(id) {
  stopPlay(); selected = id; showExample = false; render(false); focusInspector();
}
function adopt(id) {
  stopPlay(); answers = findPathTo(graph, id, answers); activeScenario = null; route = trace(graph, answers); selected = id; showExample = false;
  updateHash(); render(true); focusInspector(); announce('Loaded a real route to this node.');
}
function reset() {
  stopPlay(); answers = {}; activeScenario = null; showExample = false; route = trace(graph, answers); selected = route.current.id; updateHash(); render(true); focusInspector(); announce('Path cleared. Choose your first answer.');
}
function renderNav() {
  $('journey-nav').replaceChildren(...journeys.map(j => {
    const b = button('', 'journey-button', () => changeJourney(j.id), j.icon);
    b.setAttribute('aria-current', String(j.id === journey)); b.setAttribute('aria-label', j.title);
    b.append(el('span', '', j.title), el('span', 'nav-number', String(graphs.get(j.id).paths.length).padStart(2, '0'))); return b;
  }));
}
function layout() {
  const shown = pathOnly ? route.nodes.map(id => graph.byId.get(id)) : graph.nodes;
  positions = new Map();
  if (pathOnly) {
    const cols = route.nodes.length > 4 && $('canvas').clientWidth > 580 ? 3 : Math.min(2, shown.length);
    const rows = Math.ceil(shown.length / cols), width = 230, height = 108;
    bounds = { width: cols * 282 - 52 + 40, height: rows * 166 - 58 + 40 };
    shown.forEach((node, i) => {
      const row = Math.floor(i / cols), col = row % 2 === 0 ? i % cols : cols - 1 - i % cols;
      positions.set(node.id, { x: 20 + col * 282, y: 20 + row * 166, width, height });
    });
  } else {
    const maxRank = Math.max(...graph.nodes.map(n => n.rank));
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    graph.nodes.forEach(n => layers[n.type === 'result' ? maxRank : n.rank].push(n));
    const terminalOrder = new Map(layers[maxRank].map((n, i) => [n.id, i]));
    const average = n => { const results = possibleOutcomes(graph, n.id); return results.reduce((s, id) => s + terminalOrder.get(id), 0) / results.length; };
    for (const layer of layers) layer.sort((a, b) => average(a) - average(b));
    const maxCount = Math.max(...layers.map(l => l.length));
    bounds = { width: maxRank * 232 + 210, height: maxCount * 88 + 12 };
    layers.forEach((layer, rank) => layer.forEach((node, i) => positions.set(node.id, { x: 20 + rank * 232, y: (bounds.height - layer.length * 88) / 2 + i * 88 + 10, width: 170, height: 68 })));
  }
  return shown;
}
function edgeCurve(from, to) {
  const a = positions.get(from), b = positions.get(to); if (!a || !b) return '';
  if (pathOnly && Math.abs(a.y - b.y) > 30) {
    const x = a.x + a.width / 2, y = a.y + a.height, tx = b.x + b.width / 2;
    return `M${x},${y} C${x},${y + 36} ${tx},${b.y - 36} ${tx},${b.y}`;
  }
  const right = b.x > a.x, x = right ? a.x + a.width : a.x, y = a.y + a.height / 2, tx = right ? b.x : b.x + b.width, ty = b.y + b.height / 2;
  const dx = Math.abs(tx - x) * .52;
  return `M${x},${y} C${x + (right ? dx : -dx)},${y} ${tx - (right ? dx : -dx)},${ty} ${tx},${ty}`;
}
function keyForEdge(source, value) { return `${source}:${value}`; }
const shortAnswers = {
  warning: { yes: 'A warning is present', no: 'No known warning', unknown: 'Sending health unknown' },
  repeat: { known: 'A clear repeat-purchase need', no: 'Another purchase can wait', unknown: 'Repeat need not established' },
  messages: { running: 'Messages are already running', none: 'No journey in place yet', unknown: 'Message inventory unknown' },
  goal: { education: 'Education', offer: 'An offer or launch', unknown: 'Still defining the task', compare: 'Compare performance', disagree: 'Reconcile reports', cause: 'Understand added impact' },
  facts: { approved: 'Facts & destination approved', gaps: 'Some facts are missing', unknown: 'Facts not yet verified' },
  terms: { approved: 'Offer terms approved', missing: 'Offer terms incomplete', unknown: 'Approval is unknown' },
  audience: { reviewed: 'Audience reviewed', overlap: 'Possible message overlap', unknown: 'Audience rules unclear' },
  production: { checked: 'Checks recorded', pending: 'Production checks pending', unknown: 'Test status unknown' },
  basis: { same: 'Reporting basis matches', different: 'Definitions or windows differ', unknown: 'Reporting basis unknown' },
  signal: { delivery: 'Delivery fell', clicks: 'Clicks fell', orders: 'Fewer purchases after clicks', contribution: 'Contribution fell', unknown: 'First change not identified' },
  evidence: { report: 'Platform attribution', test: 'A controlled comparison', unknown: 'Evidence is unclear' }
};
function answerLabel(q, value) { return shortAnswers[q.id]?.[value] || q.options.find(([v]) => v === value)?.[1] || ''; }

function renderMap(refit) {
  const shown = layout(), edgeLayer = $('edges'), nodeLayer = $('nodes');
  $('world').classList.toggle('focus-map', pathOnly);
  edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
  edgeLayer.setAttribute('width', bounds.width); edgeLayer.setAttribute('height', bounds.height);
  const activeEdges = new Set(route.edges.map(e => keyForEdge(e.source, e.value)));
  const pinnedTrace = pinned ? trace(graph, pinned.answers) : null;
  const pinEdges = new Set(pinnedTrace?.edges.map(e => keyForEdge(e.source, e.value)) || []);
  const future = reachableNodes(graph, route.current.id), pathNodes = new Set(route.nodes);
  const renderedEdges = new Set();
  // Paths with several answer labels but identical endpoints share one visible line.
  const orderedEdges = graph.nodes.flatMap(n => n.edges.map(e => ({ source: n.id, ...e }))).sort((a, b) => Number(activeEdges.has(keyForEdge(a.source, a.value))) - Number(activeEdges.has(keyForEdge(b.source, b.value))));
  for (const edge of orderedEdges) {
    const d = edgeCurve(edge.source, edge.target); if (!d) continue;
    const active = activeEdges.has(keyForEdge(edge.source, edge.value));
    if (pathOnly && !active) continue;
    const reference = pinEdges.has(keyForEdge(edge.source, edge.value));
    const shared = edge.source + '-' + edge.target + '-' + active + '-' + reference;
    if (renderedEdges.has(shared)) continue; renderedEdges.add(shared);
    const line = svgEl('path', { d, class: `edge${active ? ' active' : !future.has(edge.source) ? ' dimmed' : ''}` });
    const title = svgEl('title'); title.textContent = edge.label; line.append(title); edgeLayer.append(line);
    if (reference && !active) edgeLayer.append(svgEl('path', { d, class: 'edge reference' }));
    if (active && !reduceMotion.matches) {
      const dot = svgEl('circle', { r: pathOnly ? 3 : 2.3, class: 'flow-dot' });
      dot.append(svgEl('animateMotion', { dur: '2.1s', repeatCount: '2', path: d, fill: 'remove' }));
      // Disappear after the finite path animation instead of animating indefinitely.
      dot.append(svgEl('animate', { attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;.04;.94;1', dur: '4.2s', fill: 'freeze' })); edgeLayer.append(dot);
    }
  }
  for (const node of shown) {
    const p = positions.get(node.id), onPath = pathNodes.has(node.id), current = route.current.id === node.id;
    const b = button('', `map-node ${node.type}${onPath ? ' on-path' : !future.has(node.id) ? ' dimmed' : ''}${current ? ' current' : ''}${selected === node.id ? ' selected' : ''}${pinnedTrace?.nodes.includes(node.id) ? ' pinned' : ''}`, () => inspect(node.id));
    b.dataset.nodeId = node.id; b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
    b.setAttribute('aria-label', `${node.type === 'result' ? 'Outcome' : 'Question'}: ${node.type === 'result' ? node.result.title : node.question.title}${onPath ? '. On your path.' : '. Preview another branch.'}`);
    b.setAttribute('aria-pressed', String(selected === node.id));
    const meta = el('span', 'node-meta'); meta.append(el('i'), document.createTextNode(node.type === 'result' ? 'RECOMMENDATION' : `${pathOnly ? String(route.nodes.indexOf(node.id) + 1).padStart(2, '0') : '◇'}  DECISION`));
    b.append(meta, el('span', 'node-label', nodeLabel(node, journey)));
    if (pathOnly && node.type === 'question') {
      const value = answers[node.question.id];
      b.append(el('span', 'node-answer', value ? answerLabel(node.question, value) : 'Choose an answer →'));
    }
    if (pathOnly && node.type === 'result') b.append(el('span', 'node-answer', 'Read the Advisor’s response →'));
    b.title = node.type === 'result' ? node.result.title : node.question.title;
    nodeLayer.append(b);
  }
  $('view-all').setAttribute('aria-pressed', String(!pathOnly)); $('view-path').setAttribute('aria-pressed', String(pathOnly));
  $('pinned-legend').hidden = !pinned;
  if (refit) fit(); else transform();
}
function fit() {
  const c = $('canvas'), usableWidth = c.clientWidth - 44, usableHeight = c.clientHeight - 135;
  const scale = Math.min(pathOnly ? 1.12 : 1, usableWidth / bounds.width, usableHeight / bounds.height);
  camera = { scale, x: (c.clientWidth - bounds.width * scale) / 2, y: 72 + (usableHeight - bounds.height * scale) / 2 }; transform();
}
function transform() { $('world').style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`; $('zoom-value').value = Math.round(camera.scale * 100) + '%'; }
function zoom(factor, at) {
  const c = $('canvas'), cx = at?.x ?? c.clientWidth / 2, cy = at?.y ?? c.clientHeight / 2;
  const scale = Math.max(.18, Math.min(2, camera.scale * factor)), ratio = scale / camera.scale;
  camera.x = cx - (cx - camera.x) * ratio; camera.y = cy - (cy - camera.y) * ratio; camera.scale = scale; transform();
}
function renderTrail() {
  const trail = $('breadcrumbs'); trail.replaceChildren();
  for (const edge of route.edges) {
    const n = graph.byId.get(edge.source);
    if (trail.children.length) trail.append(el('span', 'trail-arrow', '›'));
    const b = button('', 'answer-chip', () => inspect(n.id)); b.title = edge.label;
    b.append(el('span', '', String(route.edges.indexOf(edge) + 1).padStart(2, '0')), document.createTextNode(answerLabel(n.question, edge.value))); trail.append(b);
  }
  if (!trail.children.length) trail.append(el('span', 'trail-empty', 'Your first answer starts the path.'));
}
function renderSteps(steps, container) {
  const list = el('ol', 'next-steps');
  steps.forEach((text, i) => { const li = el('li'); li.append(el('span', 'step-number', String(i + 1).padStart(2, '0')), el('span', '', text)); list.append(li); }); container.append(list);
}
function renderPin(container) {
  if (!pinned) return;
  const note = el('div', 'comparison-note');
  const reference = trace(graph, pinned.answers).current.result;
  const complete = route.complete;
  const same = complete && fingerprint(reference) === fingerprint(route.current.result);
  note.append(el('strong', '', complete ? same ? 'Same advice. Different path?' : 'The advice changed.' : 'An outcome is pinned for comparison.'), el('p', '', `Pinned: ${reference.title}`));
  if (complete) note.append(button('Compare responses', 'text-link', openComparison, 'compare'));
  note.append(button('Unpin', 'text-link', () => { pinned = null; render(false); focusInspector(); })); container.append(note);
}
function renderInspector() {
  const panel = $('inspector'); panel.replaceChildren();
  const node = graph.byId.get(selected) || route.current, onPath = route.nodes.includes(node.id), preview = !onPath;
  const top = el('div', 'inspector-top'), eyebrow = el('span', 'inspector-eyebrow'); eyebrow.append(el('i'), document.createTextNode(preview ? 'BRANCH PREVIEW' : node.type === 'result' ? 'THE ADVISOR’S RESPONSE' : 'EXPLORE THIS DECISION'));
  top.append(eyebrow, el('span', 'inspector-count', node.type === 'result' ? 'OUTCOME' : `${Object.keys(answers).length} ANSWERED`)); panel.append(top);
  const content = el('div', 'response-content');
  const symbol = el('div', 'result-symbol'); symbol.append(icon(node.type === 'result' ? 'spark' : 'branch')); content.append(symbol);
  const heading = el('h2', '', node.type === 'result' ? node.result.title : node.question.title); heading.tabIndex = -1; content.append(heading);
  content.append(el('p', 'explanation', node.type === 'result' ? node.result.why : node.question.intro));
  if (preview) {
    const hint = el('p', 'choice-hint', 'You’re previewing another branch. Load its route to explore the answers that lead here.');
    content.append(hint, button('Follow this route', 'primary-button preview-route', () => adopt(node.id), 'branch'));
  }
  if (node.type === 'question') {
    if (!preview) {
      const options = el('div', 'answer-options');
      for (const [value, label] of node.question.options) {
        const b = button(label, 'answer-option', () => choose(node.question.id, value)); b.dataset.value = value; b.setAttribute('aria-pressed', String(answers[node.question.id] === value)); b.append(icon('arrow')); options.append(b);
      }
      content.append(options);
      if (answers[node.question.id]) content.append(el('p', 'choice-hint', 'Selecting an answer here clears the choices after it, so you can explore a fresh route.'));
    }
    const count = possibleOutcomes(graph, node.id).length;
    const meter = el('div', 'outcome-progress'), line = el('div', 'progress-line'), fill = el('span'); fill.style.width = (1 - (count - 1) / graph.outcomeCount) * 100 + '%'; line.append(fill);
    meter.append(line, el('p', '', `${count} ${count === 1 ? 'possible response' : 'possible responses'} from this point`)); content.append(meter);
    const rule = el('div', 'response-rule'); rule.append(icon('branch'), document.createTextNode('Answers follow the original decision rules')); content.append(rule);
  } else {
    content.append(el('div', 'small-section-label', 'WHAT TO DO NEXT'));
    renderSteps(node.result.steps, content);
    const actions = el('div', 'inspector-actions');
    if (!preview) actions.append(button(pinned ? 'Replace pinned outcome' : 'Pin this outcome', 'secondary-button', () => { pinned = { answers: { ...answers } }; render(false); focusInspector(); toast('Outcome pinned. Select an earlier decision to try another path.'); }, 'pin'));
    actions.append(button(showExample ? 'Hide example' : 'Worked example', 'secondary-button', () => { showExample = !showExample; renderInspector(); focusInspector(); }, 'book')); content.append(actions);
    if (showExample) {
      const example = getExample(journey, node.result), box = el('section', 'example-panel');
      box.append(el('div', 'modal-eyebrow', 'FICTIONAL EXAMPLE'), el('h3', '', example.title), el('p', '', example.text));
      const list = el('ol'); example.steps.forEach(s => list.append(el('li', '', s))); box.append(list); content.append(box);
    }
    const resource = el('a', 'resource-link', 'Open the related Dynamx guide'); resource.href = resourceFor(node.result); resource.target = '_blank'; resource.rel = 'noopener noreferrer'; resource.append(icon('up')); content.append(resource);
    content.append(el('p', 'note', 'Based on selected answers. This explorer hasn’t inspected an account or verified that the work is complete.'));
  }
  renderPin(content);
  content.append(el('div', 'source-inline', `SOURCE / ${journey === 'repeat' || journey === 'overlap' ? 'content.mjs' : 'planning-content.mjs'}`));
  panel.append(content);
}
function render(refit = false) {
  route = trace(graph, answers); const meta = journeys.find(j => j.id === journey);
  renderNav(); $('map-title').textContent = meta.title; $('map-count').textContent = `${graph.paths.length} paths`;
  $('canvas-kicker').textContent = activeScenario ? 'SCENARIO / ' + scenarios.find(s => s.id === activeScenario).name.toUpperCase() : meta.tag + ' / ' + (pathOnly ? 'YOUR PATH' : 'THE COMPLETE MAP');
  $('canvas-caption').textContent = pathOnly ? 'Select any decision to try a different answer.' : 'Select a node to inspect its question or response.';
  $('graph-summary').textContent = `${graph.paths.length} possible paths · ${graph.outcomeCount} distinct responses`;
  renderMap(refit); renderTrail(); renderInspector(); updatePlayButton();
}
function openModal(title, eyebrow) {
  stopPlay(); modalReturnFocus = document.activeElement;
  const body = $('modal-content'); body.replaceChildren(el('div', 'modal-eyebrow', eyebrow));
  const heading = el('h2', '', title); heading.id = 'modal-title'; body.append(heading); $('modal').showModal(); return body;
}
function closeModal() { $('modal').close(); modalReturnFocus?.focus({ preventScroll: true }); }
function openScenarios() {
  const body = openModal('Start with a situation.', 'FIVE WAYS INTO THE MAP');
  body.append(el('p', 'modal-description', 'Choose a fictional scenario, then change one answer to see where the advice goes.'));
  const list = el('div', 'scenario-list');
  for (const scenario of scenarios) {
    const meta = journeys.find(j => j.id === scenario.journey);
    const b = button('', 'scenario-card', () => { closeModal(); changeJourney(scenario.journey, { ...scenario.answers }, scenario.id); announce(`Loaded ${scenario.name}.`); });
    b.append(icon(meta.icon), el('strong', '', scenario.name), el('p', '', scenario.line), el('small', '', meta.title)); list.append(b);
  }
  body.append(list);
}
function openAbout() {
  const body = openModal('A map you can inspect.', 'INSIDE ADVISOR ATLAS');
  const text = el('div', 'about-copy');
  text.append(el('p', '', 'This is an interactive view of the Dynamx Advisor’s four guided journeys. The recommendations come directly from an exact snapshot of its content modules.'));
  const stats = el('div', 'about-stats');
  for (const [value, label] of [['177', 'complete answer paths'], ['26', 'unique responses across all journeys'], ['0', 'model calls or API keys']]) { const tile = el('div'); tile.append(el('strong', '', value), el('span', '', label)); stats.append(tile); }
  text.append(stats);
  text.append(el('p', '', 'All branches shows the complete decision graph. Identical future branches are combined. A question may appear more than once because earlier answers change what happens next. Labels on the map are shortened for readability; the question and response panel preserves the source text.'));
  text.append(el('p', '', 'This path follows your selected answers. Click an earlier decision to try another answer. As in the Advisor, changing an answer clears all later choices. Pin a completed outcome to compare it with the next one.'));
  text.append(el('p', '', 'Choices live in this page and in the URL fragment, which the browser does not send to the host in ordinary page requests. Share path copies those predefined choices. There is no account connection, analytics or persistent browser storage. External guides open separately.'));
  text.append(el('p', '', 'The source snapshot was captured on 25 October 2026. This explorer demonstrates that local snapshot; it does not verify the current public website or inspect real accounts. Keyboard: Tab through decisions and answers. Focus the canvas and use arrow keys to pan, + / − to zoom, or F to fit.'));
  body.append(text);
}
function openComparison() {
  if (!pinned || !route.complete) return;
  const before = trace(graph, pinned.answers).current.result, after = route.current.result;
  const body = openModal(fingerprint(before) === fingerprint(after) ? 'The advice stayed the same.' : 'One path. Then another.', 'COMPARE THE ADVISOR’S RESPONSES');
  body.append(el('p', 'modal-description', 'Both responses are shown exactly as the source returns them. Some choices lead to the same advice.'));
  const grid = el('div', 'compare-grid');
  for (const [label, chosen, result] of [['PINNED PATH', pinned.answers, before], ['CURRENT PATH', answers, after]]) {
    const section = el('section'); section.append(el('div', 'compare-label', label));
    const list = el('ol', 'compare-answers'); getQuestions(journey, chosen).forEach(q => list.append(el('li', '', q.options.find(([v]) => v === chosen[q.id])[1]))); section.append(list);
    section.append(el('h3', '', result.title), el('p', '', result.why)); const steps = el('ol'); result.steps.forEach(s => steps.append(el('li', '', s))); section.append(steps); grid.append(section);
  }
  body.append(grid);
}
async function share() {
  stopPlay(); const url = new URL(location.href); url.hash = encodeState(journey, answers);
  try { await navigator.clipboard.writeText(url.href); toast(['localhost', '127.0.0.1'].includes(location.hostname) ? 'Path link copied. This local preview opens on this Mac.' : 'Path link copied.'); }
  catch { const body = openModal('Copy this path.', 'A LINK TO YOUR CHOICES'); body.append(el('p', 'modal-description', 'Copy this URL to reopen the same path. A localhost link opens on this Mac; hosted links can be shared with other people.')); const input = el('input', 'copy-fallback'); input.readOnly = true; input.value = url.href; input.setAttribute('aria-label', 'Path URL'); body.append(input); input.focus(); input.select(); }
}
function exportPath() {
  stopPlay(); const blob = new Blob([exportMarkdown(journey, answers)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = `advisor-atlas-${journey}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Path exported as Markdown.');
}
async function play() {
  if (playing) { stopPlay(); return; }
  const scenario = scenarios.find(s => s.id === activeScenario) || scenarios.find(s => s.journey === journey);
  const target = { ...scenario.answers }; stopPlay(); const token = playToken;
  if (reduceMotion.matches) { answers = target; activeScenario = scenario.id; route = trace(graph, answers); selected = route.current.id; updateHash(); render(true); announce('Walkthrough loaded. Motion is reduced.'); return; }
  playing = true; answers = {}; activeScenario = scenario.id; route = trace(graph, answers); selected = route.current.id; updateHash(); render(true);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  await pause(800);
  for (const [key, value] of Object.entries(target)) {
    if (token !== playToken) return;
    answers = setAnswer(journey, answers, key, value); route = trace(graph, answers); selected = route.current.id; updateHash(); render(true); await pause(1050);
  }
  if (token === playToken) { playing = false; updatePlayButton(); announce('Walkthrough complete. Try changing an earlier decision.'); }
}

$('view-all').addEventListener('click', () => { stopPlay(); pathOnly = false; render(true); });
$('view-path').addEventListener('click', () => { stopPlay(); pathOnly = true; selected = route.current.id; render(true); });
$('reset-button').addEventListener('click', reset); $('scenario-button').addEventListener('click', openScenarios); $('about-button').addEventListener('click', openAbout);
$('share-button').addEventListener('click', share); $('export-button').addEventListener('click', exportPath); $('play-button').addEventListener('click', play);
$('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2)); $('fit-button').addEventListener('click', fit);
$('modal').querySelector('.modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) { const r = $('modal').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(); } });
$('modal').addEventListener('close', () => modalReturnFocus?.isConnected && modalReturnFocus.focus({ preventScroll: true }));
$('canvas').addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = $('canvas').getBoundingClientRect(); zoom(Math.exp(-e.deltaY * .005), { x: e.clientX - r.left, y: e.clientY - r.top });
}, { passive: false });
$('canvas').addEventListener('pointerdown', e => {
  moved = false; if (e.target.closest('button') || e.button !== 0) return;
  pan = { x: e.clientX, y: e.clientY, startX: camera.x, startY: camera.y }; $('canvas').setPointerCapture(e.pointerId); $('canvas').classList.add('dragging');
});
$('canvas').addEventListener('pointermove', e => { if (!pan) return; const dx = e.clientX - pan.x, dy = e.clientY - pan.y; if (Math.hypot(dx, dy) > 4) moved = true; camera.x = pan.startX + dx; camera.y = pan.startY + dy; transform(); });
function releasePan() { pan = null; $('canvas').classList.remove('dragging'); }
$('canvas').addEventListener('pointerup', releasePan); $('canvas').addEventListener('pointercancel', releasePan); $('canvas').addEventListener('lostpointercapture', releasePan);
$('canvas').addEventListener('keydown', e => {
  if (e.target !== $('canvas')) return;
  const deltas = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
  if (deltas[e.key]) { e.preventDefault(); camera.x += deltas[e.key][0]; camera.y += deltas[e.key][1]; transform(); }
  else if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); zoom(e.key === '-' ? 1 / 1.2 : 1.2); }
  else if (e.key.toLowerCase() === 'f') { e.preventDefault(); fit(); }
});
addEventListener('hashchange', () => { const value = decodeState(location.hash); if (value) changeJourney(value.journey, value.answers); });
let resizeFrame;
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => renderMap(true)); }).observe($('canvas'));
reduceMotion.addEventListener('change', () => { stopPlay(); render(false); });
render(true);
