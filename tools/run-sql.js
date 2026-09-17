// Runs a .sql file against the Supabase database, or a query given inline.
//   node tools/run-sql.js supabase/schema.sql
//   node tools/run-sql.js -q "select count(*) from public.conversations"
//
// Needs SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN in .env (a Supabase
// personal access token, from Account → Access Tokens). These are for admin work
// from your machine only — the app never uses them, so keep them out of Vercel.

const fs = require('fs');
const path = require('path');

// Load the project's .env whatever directory this is run from.
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!ref || !token) die('Add SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN to .env first.');

const args = process.argv.slice(2);
if (!args.length) die('Usage: node tools/run-sql.js <file.sql>   |   node tools/run-sql.js -q "select 1"');

let query;
let label;
if (args[0] === '-q') {
  query = args.slice(1).join(' ');
  label = 'inline query';
  if (!query.trim()) die('Nothing to run after -q.');
} else {
  // Accept a path relative to where you are, or to the project root.
  let file = path.resolve(process.cwd(), args[0]);
  if (!fs.existsSync(file)) file = path.resolve(ROOT, args[0]);
  if (!fs.existsSync(file)) die(`File not found: ${args[0]}`);
  query = fs.readFileSync(file, 'utf8');
  label = path.relative(process.cwd(), file);
}

(async () => {
  console.log(`\n  Running ${label} on project ${ref}…`);
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    die(`Could not reach Supabase: ${e.message}`);
  }

  const body = await res.text();
  if (!res.ok) {
    let message = body;
    try {
      message = JSON.parse(body).message || body;
    } catch {}
    die(`Supabase refused the query (HTTP ${res.status}):\n  ${message}`);
  }

  let rows;
  try {
    rows = JSON.parse(body);
  } catch {
    rows = null;
  }

  if (Array.isArray(rows) && rows.length) {
    console.table(rows);
    console.log(`  ${rows.length} row${rows.length > 1 ? 's' : ''}.\n`);
  } else {
    console.log('  Done — no rows returned.\n');
  }
})();
