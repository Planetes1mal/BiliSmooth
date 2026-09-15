// Exercise the production path builder with timestamped observations, not a demo curve.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function chart(samples, time = 100000) {
  const source = fs.readFileSync(path.join(__dirname, '../src/ui/control/app.js'), 'utf8');
  const body = source.slice(source.indexOf(' function renderSpeed('), source.indexOf(' function moveGraph('));
  const nodes = new Map();
  class Clock extends Date { static now() { return time; } }
  const context = vm.createContext({ Date: Clock, finite: Number.isFinite, graphKey: '', graphSamples: [], graphLastAt: 0, graphOrigin: 0,
    $: name => { if (!nodes.has(name)) nodes.set(name, { dataset: {}, setAttribute(key, value) { this[key] = value; } }); return nodes.get(name); }, updateGraphMotion() {} });
  vm.runInContext(body, context); context.renderSpeed(samples);
  return { line: nodes.get('speed-line')?.d || '', area: nodes.get('speed-area')?.d || '', origin: context.graphOrigin };
}
test('an isolated real transfer observation remains visible instead of being discarded between unknown intervals', () => {
  const result = chart([{ at: 96000, mbps: null }, { at: 97000, mbps: 16 }, { at: 98000, mbps: null }]);
  assert.ok(result.line, 'a single observed sample needs a visible point');
  assert.equal(result.area, '', 'a single sample cannot imply an observed duration or filled block');
});
test('observed idle zeros keep bursts in one waveform while true missing intervals split it', () => {
  const known = chart([{ at: 96000, mbps: 0 }, { at: 97000, mbps: 8 }, { at: 98000, mbps: 4 }, { at: 99000, mbps: 0 }]);
  assert.equal((known.line.match(/M/g) || []).length, 1);
  const unknown = chart([{ at: 91000, mbps: 4 }, { at: 92000, mbps: 8 }, { at: 93000, mbps: null }, { at: 94000, mbps: 2 }, { at: 95000, mbps: 3 }, { at: 99000, mbps: 4 }, { at: 100000, mbps: 5 }]);
  assert.equal((unknown.line.match(/M/g) || []).length, 3, 'both explicit unknowns and long timestamp gaps remain disconnected');
});
test('current samples reach now, and zero values do not create a positive filled strip', () => {
  const result = chart([{ at: 99000, mbps: 0 }, { at: 100000, mbps: 0 }]);
  assert.equal(result.origin, 55000, 'right edge is now rather than a hidden future sample');
  assert.doesNotMatch(result.area, / 48(?: |$)/, 'filled baseline agrees with the zero line at y=44');
});
