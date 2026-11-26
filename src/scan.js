'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { costOf } = require('./pricing');

const MAX_TURN_CHARS = 8000;     // keep the page small; long turns are truncated
const ACTIVE_GAP_MS = 5 * 60e3;  // gaps longer than this are "away", not work

// Regex literals for a single backslash, kept in one place for legibility.
const BACKSLASH = /\x5c/g;

function projectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** `d--WorkSpace-ReelReads-reelreads` -> `d:/WorkSpace/ReelReads/reelreads` */
function decodeProjectDir(name) {
  const m = /^([a-zA-Z])--(.*)$/.exec(name);
  if (!m) return name.replace(/-/g, '/');
  return `${m[1].toLowerCase()}:/${m[2].replace(/-/g, '/')}`;
}

function shortProject(cwd, dirName) {
  const p = (cwd || decodeProjectDir(dirName)).replace(BACKSLASH, '/').replace(/\/+$/, '');
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

/** Strip harness-injected noise so a prompt reads like what the user typed. */
function cleanPrompt(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim();
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function hasToolResult(content) {
  return Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
}

function truncate(s) {
  return s.length > MAX_TURN_CHARS ? s.slice(0, MAX_TURN_CHARS) + '\n\u2026[truncated]' : s;
}

function newSession(id, dirName, file) {
  return {
    id,
    file,
    dir: dirName,
    project: shortProject(null, dirName),
    cwd: null,
    branch: null,
    title: null,
    version: null,
    start: null,
    end: null,
    activeMs: 0,
    prompts: 0,
    assistantTurns: 0,
    sidechainTurns: 0,
    toolCalls: 0,
    toolErrors: 0,
    cost: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    models: Object.create(null),
    modelCost: Object.create(null),
    tools: Object.create(null),
    files: Object.create(null),
    turns: [],
  };
}

function bump(obj, key, by) {
  if (!key) return;
  obj[key] = (obj[key] || 0) + (by === undefined ? 1 : by);
}

function noteFile(session, p, kind) {
  if (typeof p !== 'string' || !p) return;
  const norm = p.replace(BACKSLASH, '/');
  const rec = session.files[norm] || (session.files[norm] = { edits: 0, reads: 0 });
  if (kind === 'read') rec.reads++;
  else rec.edits++;
}

async function scanFile(file, dirName) {
  const sessions = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const fallbackId = path.basename(file, '.jsonl');
  let lastTs = null;

  for await (const line of rl) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    const id = o.sessionId || fallbackId;
    let s = sessions.get(id);
    if (!s) sessions.set(id, (s = newSession(id, dirName, file)));

    if (o.type === 'ai-title' && o.aiTitle) { s.title = o.aiTitle; continue; }
    if (o.cwd && !s.cwd) { s.cwd = o.cwd; s.project = shortProject(o.cwd, dirName); }
    if (o.gitBranch && !s.branch) s.branch = o.gitBranch;
    if (o.version) s.version = o.version;

    if (o.timestamp) {
      const t = Date.parse(o.timestamp);
      if (!Number.isNaN(t)) {
        if (s.start === null || t < s.start) s.start = t;
        if (s.end === null || t > s.end) s.end = t;
        if (lastTs !== null && t > lastTs && t - lastTs < ACTIVE_GAP_MS) s.activeMs += t - lastTs;
        lastTs = t;
      }
    }

    const msg = o.message;
    if (!msg || typeof msg !== 'object') continue;
    const side = !!o.isSidechain;
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;

    if (o.type === 'user') {
      if (hasToolResult(msg.content)) {
        for (const b of msg.content) {
          if (b && b.type === 'tool_result' && b.is_error) s.toolErrors++;
        }
        continue;
      }
      if (o.isMeta) continue;
      const text = cleanPrompt(textOf(msg.content));
      if (!text) continue;
      if (side) s.sidechainTurns++; else s.prompts++;
      s.turns.push({ r: side ? 'task' : 'user', t: ts, x: truncate(text) });
      continue;
    }

    if (o.type !== 'assistant') continue;

    const model = msg.model;
    const usage = msg.usage;
    if (side) s.sidechainTurns++; else s.assistantTurns++;
    if (model) bump(s.models, model);

    if (usage) {
      const cc = usage.cache_creation || {};
      s.tokens.input += usage.input_tokens || 0;
      s.tokens.output += usage.output_tokens || 0;
      s.tokens.cacheRead += usage.cache_read_input_tokens || 0;
      s.tokens.cacheWrite +=
        (cc.ephemeral_5m_input_tokens || 0) + (cc.ephemeral_1h_input_tokens || 0) ||
        (usage.cache_creation_input_tokens || 0);
      const c = costOf(usage, model, ts, usage.speed);
      s.cost += c;
      if (c) bump(s.modelCost, model, c);
    }

    const text = textOf(msg.content);
    if (text.trim()) s.turns.push({ r: side ? 'sub' : 'asst', t: ts, x: truncate(text.trim()) });

    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b || b.type !== 'tool_use') continue;
        s.toolCalls++;
        bump(s.tools, b.name);
        const inp = b.input || {};
        if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') {
          noteFile(s, inp.file_path || inp.notebook_path, 'edit');
        } else if (b.name === 'Read') {
          noteFile(s, inp.file_path, 'read');
        }
      }
    }
  }

  return [...sessions.values()];
}

async function scanAll(root = projectsRoot(), onProgress) {
  if (!fs.existsSync(root)) throw new Error(`No transcripts found at ${root}`);
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  const out = [];
  let done = 0;
  const total = dirs.reduce(
    (n, d) => n + fs.readdirSync(path.join(root, d.name)).filter((f) => f.endsWith('.jsonl')).length,
    0
  );

  for (const d of dirs) {
    const dirPath = path.join(root, d.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        out.push(...(await scanFile(path.join(dirPath, f), d.name)));
      } catch (err) {
        process.stderr.write(`  ! skipped ${f}: ${err.message}\n`);
      }
      if (onProgress) onProgress(++done, total);
    }
  }

  // Drop empty shells left behind by aborted sessions.
  return out
    .filter((s) => s.turns.length > 0 || s.toolCalls > 0)
    .sort((a, b) => (b.start || 0) - (a.start || 0));
}

module.exports = { scanAll, scanFile, projectsRoot, decodeProjectDir };
