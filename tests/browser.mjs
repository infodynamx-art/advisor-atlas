import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { journeys, buildGraph, encodeState, fingerprint } from '../src/model.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const baseURL = (process.env.ATLAS_URL || 'http://127.0.0.1:4278').replace(/\/+$/, '');
const origin = new URL(baseURL).origin;
const output = new URL('../qa/', import.meta.url); await fs.mkdir(output, { recursive: true });
const checks = [], requests = [], errors = [];
const check = (name, condition) => { checks.push({ name, pass: !!condition }); assert.ok(condition, name); };
let browser;
try {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), ignoreDefaultArgs: ['--unsafely-disable-devtools-self-xss-warnings'] });
  const context = await browser.newContext({ viewport: { width: 1512, height: 1050 }, deviceScaleFactor: 1 });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(baseURL + '/'); await page.locator('.map-node').first().waitFor();
  await page.locator('#inspector').evaluate(async e => { await Promise.allSettled(e.getAnimations({ subtree: true }).map(a => a.finished)); });
  await page.screenshot({ path: new URL('desktop-path.png', output).pathname, fullPage: true });
  check('Initial scenario is a complete source-backed path', await page.locator('#inspector h2').innerText() === 'Review the combined journey before adding more.' && await page.locator('.map-node').count() === 4);
  await page.getByRole('button', { name: 'All branches', exact: true }).click();
  check('Full repeat map contains the complete canonical DAG', await page.locator('.map-node').count() === 16);
  await page.locator('#inspector').evaluate(async e => { await Promise.allSettled(e.getAnimations({ subtree: true }).map(a => a.finished)); });
  await page.screenshot({ path: new URL('desktop-map.png', output).pathname, fullPage: true });
  await page.getByRole('button', { name: 'Pin this outcome', exact: true }).click();
  check('Pinning retains useful keyboard focus', await page.evaluate(() => document.activeElement === document.querySelector('#inspector h2')));
  await page.getByRole('button', { name: /Question: Is there a current delivery/ }).click();
  await page.getByRole('button', { name: 'Yes, there’s a warning', exact: true }).click();
  check('Earlier answer change clears later answers', await page.locator('.answer-chip').count() === 1);
  await page.getByRole('button', { name: 'We have a clear repeat-purchase use case', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, messages are running', exact: true }).click();
  check('Warning retains source precedence', await page.locator('#inspector h2').innerText() === 'Review the warning before expanding sends.');
  check('Pinned outcome is retained and change is identified', (await page.locator('.comparison-note').innerText()).includes('The advice changed.'));
  await page.getByRole('button', { name: 'Compare responses', exact: true }).click();
  check('Comparison shows exact before and after responses', await page.locator('.compare-grid h3').allTextContents().then(a => a.join('|') === 'Review the combined journey before adding more.|Review the warning before expanding sends.'));
  await page.screenshot({ path: new URL('comparison.png', output).pathname });
  await page.keyboard.press('Escape'); check('Dialog closes with Escape', !(await page.locator('#modal').isVisible()));
  await page.getByRole('button', { name: /Outcome: Define one post-purchase journey/ }).click();
  check('Unselected outcome is a preview', await page.getByRole('button', { name: 'Follow this route', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Follow this route', exact: true }).click();
  check('Preview adoption follows an actual source route', await page.locator('#inspector h2').innerText() === 'Define one post-purchase journey before building it.' && await page.locator('.answer-chip').count() === 3);
  await page.getByRole('button', { name: 'Try a scenario', exact: true }).click();
  await page.getByRole('button', { name: /The missing offer terms/ }).click();
  check('Offer scenario loads all five answers and clears old comparison', await page.locator('.answer-chip').count() === 5 && await page.locator('.comparison-note').count() === 0);
  check('Offer scenario uses source terms response', await page.locator('#inspector h2').innerText() === 'Hold promotional copy until the terms are clear.');
  await page.getByRole('button', { name: 'This path', exact: true }).click();
  await page.getByRole('button', { name: /Question: What job should this campaign do/ }).click();
  await page.getByRole('button', { name: 'Help customers understand or use a product', exact: true }).click();
  check('Changing offer to education removes stale terms and subsequent answers', new URL(await page.url()).hash === '#journey=campaign&goal=education');
  await page.getByRole('button', { name: 'The relevant facts and destination are approved', exact: true }).click();
  check('Education skips the offer-terms question', await page.locator('#inspector h2').innerText() === 'Has the audience and message overlap been reviewed?');
  await page.getByRole('button', { name: 'Audience rules and overlap have been reviewed', exact: true }).click();
  await page.getByRole('button', { name: 'Actual checks are recorded for owner review', exact: true }).click();
  check('Campaign has an owner-review outcome without invented approval', await page.locator('#inspector h2').innerText() === 'Bring the recorded checks to the final approver.');

  // Every distinct source response is also checked through the actual browser URL and renderer.
  let rendered = 0;
  for (const { id } of journeys) {
    const seen = new Set();
    for (const path of buildGraph(id).paths) {
      const sig = fingerprint(path.result); if (seen.has(sig)) continue; seen.add(sig);
      await page.goto(baseURL + '/' + encodeState(id, path.answers));
      await page.waitForFunction(title => document.querySelector('#inspector h2')?.textContent === title, path.result.title);
      const actual = await page.locator('#inspector .next-steps li > span:last-child').allTextContents();
      assert.deepEqual(actual, path.result.steps); assert.equal(await page.locator('#inspector .explanation').innerText(), path.result.why); rendered++;
    }
  }
  check('All 30 topic-scoped response variants render their exact title, reason and steps', rendered === 30);
  await page.goto(baseURL + '/#journey=measurement&goal=compare&basis=same&signal=orders');
  await page.getByRole('button', { name: 'Worked example', exact: true }).click();
  check('Worked example matches the source outcome', (await page.locator('.example-panel').innerText()).includes('advertised size is sold out'));
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-button').click();
  const download = await downloadPromise; const saved = new URL('exported-path.md', output).pathname; await download.saveAs(saved);
  check('Markdown export includes exact response and selected answers', (await fs.readFile(saved, 'utf8')).includes('Check what happens after the click.'));
  await page.getByRole('button', { name: /Question: Are the reporting definitions/ }).click();
  await page.getByRole('button', { name: 'At least one definition or window differs', exact: true }).click();
  check('Reporting basis change clears stale signal and ends the shorter route', new URL(page.url()).hash === '#journey=measurement&goal=compare&basis=different' && await page.locator('#inspector h2').innerText() === 'Make the comparison defensible first.');
  await page.reload(); check('Reload restores the shared path', await page.locator('#inspector h2').innerText() === 'Make the comparison defensible first.');
  await page.goto(baseURL + '/#journey=repeat&warning=%3Cscript%3E&messages=running');
  check('Invalid hash content produces a clean first question', await page.locator('#inspector h2').innerText() === 'Is there a current delivery or complaint warning?' && await page.locator('.answer-chip').count() === 0);
  const beforeZoom = await page.locator('#zoom-value').innerText(); await page.locator('#zoom-in').click();
  check('Zoom changes the graph camera', await page.locator('#zoom-value').innerText() !== beforeZoom);
  await page.locator('#canvas').focus(); const transform = await page.locator('#world').getAttribute('style'); await page.keyboard.press('ArrowRight');
  check('Keyboard panning moves the graph', await page.locator('#world').getAttribute('style') !== transform); await page.keyboard.press('f');
  const canvasBox = await page.locator('#canvas').boundingBox();
  await page.mouse.move(canvasBox.x + 20, canvasBox.y + 120); await page.mouse.down(); await page.mouse.move(canvasBox.x + 50, canvasBox.y + 140); await page.mouse.up();
  await page.locator('.map-node').first().focus(); await page.keyboard.press('Enter');
  check('Keyboard nodes remain usable after pointer panning', await page.evaluate(() => document.activeElement === document.querySelector('#inspector h2')));
  await page.getByRole('button', { name: 'Message overlap', exact: true }).click();
  await page.getByRole('button', { name: 'No known warning', exact: true }).focus(); await page.keyboard.press('Enter');
  check('Keyboard answers move focus to the next question heading', await page.evaluate(() => document.activeElement === document.querySelector('#inspector h2')));
  await page.getByRole('button', { name: 'Another purchase may not be useful yet', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, messages are running', exact: true }).click();
  check('Overlap bypasses repeat-purchase prerequisite', await page.locator('#inspector h2').innerText() === 'Review the combined journey before adding more.');
  await page.getByRole('button', { name: 'Play walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Stop walkthrough', exact: true }).click();
  check('Stopping a walkthrough before the first answer preserves URL parity', new URL(page.url()).hash === '#journey=overlap' && await page.locator('.answer-chip').count() === 0);
  await page.getByRole('button', { name: 'Play walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Campaign planning', exact: true }).click();
  await page.waitForTimeout(1250);
  check('Changing journey cancels an in-flight walkthrough', await page.locator('#map-title').innerText() === 'Campaign planning' && await page.locator('.answer-chip').count() === 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Play walkthrough', exact: true }).click();
  check('Reduced-motion walkthrough loads immediately with no animated dots', await page.locator('#inspector h2').innerText() === 'Hold promotional copy until the terms are clear.' && await page.locator('.flow-dot').count() === 0);
  await page.goto(baseURL + '/'); await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(100);
    check(`${size.width}px layout has no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${size.width}px map stays inside its canvas`, await page.locator('#world').evaluate(e => { const c = document.querySelector('#canvas').getBoundingClientRect(); return [...e.querySelectorAll('.map-node')].every(n => { const r = n.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top && r.bottom <= c.bottom; }); }));
    if (size.width === 390) await page.screenshot({ path: new URL('mobile.png', output).pathname, fullPage: true });
  }
  await page.setViewportSize({ width: 1512, height: 1050 }); await page.screenshot({ path: new URL('desktop-final.png', output).pathname, fullPage: true });
  check('No external requests or operation requests', requests.every(r => r.method === 'GET' && new URL(r.url).origin === origin));
  check('No persistence or console errors', errors.length === 0 && await page.evaluate(() => !localStorage.length && !sessionStorage.length) && (await context.cookies()).length === 0);
  await fs.writeFile(new URL('browser-results.json', output), JSON.stringify({ passed: true, timestamp: new Date().toISOString(), checks, errors, requestCount: requests.length, boundaries: ['Isolated desktop Chrome only', 'Mobile viewports, not physical devices', 'No actual Safari or screen-reader speech test', 'No GitHub publication or live site update'] }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, failed: 0, renderedResponses: rendered, errors }));
} catch (error) {
  await fs.writeFile(new URL(`browser-failure-${Date.now()}.json`, output), JSON.stringify({ timestamp: new Date().toISOString(), checks, errors, error: String(error) }, null, 2)); throw error;
} finally { await browser?.close(); }
