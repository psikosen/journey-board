import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { EventFusion } from '../extension/lib/eventFusion.js';
import { ScribeLLM } from '../extension/lib/scribe.js';
import { PrefixTreeMiner } from '../extension/lib/processMiner.js';
import { buildMarkdown, buildYaml, buildBpmn } from '../extension/lib/sopBuilder.js';
import {
  CorpusBuilder,
  kmeans,
  buildEntityActionGraph,
  scoreAutomation,
} from '../extension/lib/domainDiscovery.js';
import { ZipExporter } from '../extension/lib/exporter.js';

test('EventFusion aggregates events and drives Scribe output', () => {
  const fusion = new EventFusion({ windowMs: 1000 });
  const now = Date.now();
  fusion.ingest({ type: 'click', t: now, selector: '#login', text: 'Login' });
  fusion.ingest({ type: 'click', t: now + 400, selector: '#login', text: 'Login' });
  const fused = fusion.fuse(now + 1000);
  assert.equal(fused.length, 1);
  const scribe = new ScribeLLM({ chunkSize: 10 });
  scribe.addEvents(fused);
  const summary = scribe.summarize(now + 1000);
  assert.match(summary, /Login/);
});

test('PrefixTreeMiner extracts frequent paths and generates SOP artifacts', () => {
  const miner = new PrefixTreeMiner({ minSupport: 2, minLength: 2 });
  miner.ingest(['start', 'click:login', 'route:dashboard'], 1200);
  miner.ingest(['start', 'click:login', 'route:dashboard'], 900);
  miner.ingest(['start', 'input:search', 'route:results'], 800);
  const processes = miner.extractProcesses();
  assert.ok(processes.length >= 1);
  const primary = processes[0];
  const definition = {
    id: 'process-test',
    name: 'Login Flow',
    steps: primary.steps.map((step, index) => ({
      title: step,
      description: `Step ${index + 1}`,
    })),
  };
  const markdown = buildMarkdown(definition);
  const yaml = buildYaml(definition);
  const bpmn = buildBpmn(definition);
  assert.match(markdown, /Login Flow/);
  assert.match(yaml, /Login Flow/);
  assert.match(bpmn, /Login Flow/);
});

test('Domain discovery computes clusters and automation scores', () => {
  const corpus = new CorpusBuilder();
  corpus.addDocument('a', 'User clicks login and waits for dashboard to load');
  corpus.addDocument('b', 'Dashboard shows analytics widgets and quick links');
  corpus.addDocument('c', 'Search for customer account and open detail view');
  const matrix = corpus.tfidf();
  const vectors = Array.from(matrix.entries()).map(([id, weights]) => ({ id, weights }));
  const assignments = kmeans(vectors, 2, 4);
  assert.ok(assignments.length >= 2);
  const graph = buildEntityActionGraph([
    { type: 'ocr', text: 'Acme Corp Dashboard' },
    { type: 'ocr', text: 'Customer Search Results' },
  ]);
  const processes = [
    { steps: ['click login', 'route dashboard'], support: 2, averageDuration: 1100 },
    { steps: ['input search', 'route detail'], support: 1, averageDuration: 800 },
  ];
  const scores = scoreAutomation(processes, graph);
  assert.equal(scores.length, processes.length);
  const ordered = [...scores].sort((a, b) => b.score - a.score);
  assert.ok(ordered[0].score >= ordered[ordered.length - 1].score);
  assert.ok(ordered.every((entry) => typeof entry.id === 'string' && Number.isFinite(entry.score)));
});

test('ZipExporter produces manifest and packaged assets', async () => {
  const exporter = new ZipExporter();
  exporter.addFile('notes.txt', 'Summary');
  exporter.addFile('data.json', { ok: true });
  const archive = await exporter.finalize({ type: 'nodebuffer' });
  const zip = await JSZip.loadAsync(archive);
  const manifest = await zip.file('manifest.txt').async('string');
  assert.match(manifest, /notes.txt/);
  assert.match(manifest, /data.json/);
});
