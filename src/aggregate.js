'use strict';

function add(map, key, fields) {
  let rec = map.get(key);
  if (!rec) map.set(key, (rec = {}));
  for (const k of Object.keys(fields)) rec[k] = (rec[k] || 0) + fields[k];
  return rec;
}

function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function aggregate(sessions) {
  const totals = {
    sessions: sessions.length,
    prompts: 0, assistantTurns: 0, sidechainTurns: 0,
    toolCalls: 0, toolErrors: 0, cost: 0, activeMs: 0,
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  };
  const projects = new Map();
  const days = new Map();
  const models = new Map();
  const tools = new Map();
  const files = new Map();
  const hours = new Array(24).fill(0);

  for (const s of sessions) {
    totals.prompts += s.prompts;
    totals.assistantTurns += s.assistantTurns;
    totals.sidechainTurns += s.sidechainTurns;
    totals.toolCalls += s.toolCalls;
    totals.toolErrors += s.toolErrors;
    totals.cost += s.cost;
    totals.activeMs += s.activeMs;
    totals.input += s.tokens.input;
    totals.output += s.tokens.output;
    totals.cacheRead += s.tokens.cacheRead;
    totals.cacheWrite += s.tokens.cacheWrite;

    const proj = add(projects, s.project, {
      sessions: 1, cost: s.cost, activeMs: s.activeMs,
      prompts: s.prompts, toolCalls: s.toolCalls, edits: 0,
    });
    proj.last = Math.max(proj.last || 0, s.end || 0);
    proj.first = proj.first ? Math.min(proj.first, s.start || Infinity) : (s.start || 0);
    proj.cwd = proj.cwd || s.cwd;

    if (s.start) {
      add(days, dayKey(s.start), { sessions: 1, cost: s.cost, activeMs: s.activeMs, prompts: s.prompts });
      hours[new Date(s.start).getHours()] += 1;
    }
    for (const [m, n] of Object.entries(s.models)) add(models, m, { turns: n });
    for (const [m, c] of Object.entries(s.modelCost || {})) add(models, m, { cost: c });
    for (const [t, n] of Object.entries(s.tools)) add(tools, t, { calls: n });
    for (const [f, rec] of Object.entries(s.files)) {
      const fr = add(files, f, { edits: rec.edits, reads: rec.reads, sessions: 1 });
      fr.project = fr.project || s.project;
      fr.last = Math.max(fr.last || 0, s.end || 0);
      proj.edits += rec.edits;
    }
  }

  const sortDesc = (map, key) =>
    [...map.entries()].map(([k, v]) => ({ name: k, ...v })).sort((a, b) => (b[key] || 0) - (a[key] || 0));

  return {
    totals,
    projects: sortDesc(projects, 'cost'),
    days: [...days.entries()].map(([k, v]) => ({ date: k, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    models: sortDesc(models, 'cost'),
    tools: sortDesc(tools, 'calls'),
    files: sortDesc(files, 'edits').slice(0, 200),
    hours,
    range: {
      from: sessions.reduce((m, s) => Math.min(m, s.start || Infinity), Infinity),
      to: sessions.reduce((m, s) => Math.max(m, s.end || 0), 0),
    },
  };
}

module.exports = { aggregate, dayKey };
