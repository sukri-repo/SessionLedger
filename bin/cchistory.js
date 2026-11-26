#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scanAll, projectsRoot } = require('../src/scan');
const { aggregate } = require('../src/aggregate');
const { render } = require('../src/render');
const { serve } = require('../src/serve');

function parseArgs(argv) {
  const args = { out: path.join(process.cwd(), 'dist', 'index.html'), root: projectsRoot(), stats: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') args.out = path.resolve(argv[++i]);
    else if (a === '--root') args.root = path.resolve(argv[++i]);
    else if (a === '--json') args.json = path.resolve(argv[++i]);
    else if (a === '--stats' || a === '-s') args.stats = true;
    else if (a === '--serve') args.serve = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project' || a === '-p') args.project = argv[++i];
  }
  return args;
}

const HELP = `
cchistory — browse and cost-account your local Claude Code sessions

  cchistory                    build dist/index.html from ~/.claude/projects
  cchistory --serve            serve it locally with a working Refresh button
  cchistory --stats            print a summary to the terminal instead
  cchistory -o report.html     write the page somewhere else
  cchistory --json data.json   also dump the parsed sessions as JSON
  cchistory --root <dir>       read transcripts from a different location
  cchistory -p <project>       limit to one project (matches the folder name)
  cchistory --port <n>         port for --serve (default 4300)

The page is self-contained: open it directly, or publish it as an Artifact.
Nothing is uploaded and no transcript is modified.
`;

function bar(frac, width) {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return '█'.repeat(n) + '░'.repeat(width - n);
}

const money = (n) => '$' + n.toFixed(2);
const hours = (ms) => (ms / 3.6e6).toFixed(1) + 'h';

function printStats(agg) {
  const t = agg.totals;
  const from = new Date(agg.range.from).toISOString().slice(0, 10);
  const to = new Date(agg.range.to).toISOString().slice(0, 10);

  console.log(`\n  ${from} → ${to}   ${t.sessions} sessions across ${agg.projects.length} projects\n`);
  console.log(`  spend        ${money(t.cost)}`);
  console.log(`  active time  ${hours(t.activeMs)}`);
  console.log(`  prompts      ${t.prompts}`);
  console.log(`  tool calls   ${t.toolCalls}  (${t.toolErrors} errors, ${((t.toolErrors / t.toolCalls) * 100).toFixed(1)}%)`);
  const totalIn = t.cacheRead + t.input + t.cacheWrite;
  console.log(`  cache hits   ${((t.cacheRead / totalIn) * 100).toFixed(1)}% of input tokens\n`);

  const top = agg.projects.slice(0, 10);
  const max = top.length ? top[0].cost : 1;
  console.log('  PROJECT              SPEND     ACTIVE   SESS  EDITS');
  for (const p of top) {
    console.log(
      `  ${p.name.slice(0, 20).padEnd(20)} ${money(p.cost).padStart(8)} ${hours(p.activeMs).padStart(8)} ` +
      `${String(p.sessions).padStart(5)} ${String(p.edits).padStart(6)}  ${bar(p.cost / max, 12)}`
    );
  }

  console.log('\n  MODEL                 TURNS      SPEND');
  for (const m of agg.models) {
    console.log(`  ${m.name.padEnd(20)} ${String(m.turns).padStart(7)} ${money(m.cost || 0).padStart(10)}`);
  }

  console.log('\n  MOST-EDITED FILES');
  for (const f of agg.files.slice(0, 8)) {
    console.log(`  ${String(f.edits).padStart(4)} edits  ${f.name.length > 62 ? '…' + f.name.slice(-61) : f.name}`);
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  if (args.serve) {
    const { url } = await serve({ root: args.root, port: args.port || 4300 });
    console.log(`\n  Session Ledger is live at ${url}`);
    console.log(`  Reading ${args.root}`);
    console.log('  Hit Refresh in the page to rescan. Ctrl+C to stop.\n');
    return;
  }

  process.stderr.write(`Reading transcripts from ${args.root}\n`);
  let last = 0;
  let sessions = await scanAll(args.root, (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct >= last + 10) { last = pct; process.stderr.write(`  ${pct}%\r`); }
  });
  process.stderr.write('        \r');

  if (args.project) {
    const want = args.project.toLowerCase();
    sessions = sessions.filter((s) => s.project.toLowerCase() === want);
    if (!sessions.length) {
      console.error(`No sessions found for project "${args.project}".`);
      process.exitCode = 1;
      return;
    }
  }

  if (!sessions.length) {
    console.error('No sessions found. Is this the right --root?');
    process.exitCode = 1;
    return;
  }

  const agg = aggregate(sessions);

  if (args.json) {
    fs.mkdirSync(path.dirname(args.json), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify({ sessions, aggregate: agg }, null, 2));
    process.stderr.write(`Wrote ${args.json}\n`);
  }

  if (args.stats) { printStats(agg); return; }

  const html = render(sessions, { root: args.root });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, html);

  const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
  console.log(`\n  ${args.out}`);
  console.log(`  ${sessions.length} sessions · ${agg.projects.length} projects · ${money(agg.totals.cost)} · ${mb} MB\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
