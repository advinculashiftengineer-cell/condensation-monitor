// Condensation Monitor API: stores all data in one JSON file in a GitHub repo.
// The GitHub token stays on the server (Netlify environment variable), never in the browser.

const GH = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO;                    // "owner/repo"
const BRANCH = process.env.GITHUB_BRANCH || "data";      // keep data off the deployed branch
const PATH = process.env.DATA_PATH || "data/db.json";
const PIN = process.env.TEAM_PIN || "";
const MAX_BYTES = 900000;                                // GitHub contents API limit is ~1 MB
const SHIFTS = ["First", "Second", "Third"];

const HDR = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "condensation-monitor",
};

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function load() {
  const r = await fetch(`${GH}/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`, { headers: HDR });
  if (r.status === 404) return { db: { locs: [], data: {}, techs: [] }, sha: null };
  if (!r.ok) throw new HttpError(502, "GitHub read failed (" + r.status + ")");
  const j = await r.json();
  const db = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
  db.locs = db.locs || []; db.data = db.data || {}; db.techs = db.techs || [];
  return { db, sha: j.sha };
}

function save(db, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(db)).toString("base64"),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  return fetch(`${GH}/repos/${REPO}/contents/${PATH}`, {
    method: "PUT",
    headers: { ...HDR, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Read, change, write. Retries if someone else saved at the same moment.
async function mutate(fn, message) {
  for (let i = 0; i < 4; i++) {
    const { db, sha } = await load();
    fn(db);
    trim(db);
    const r = await save(db, sha, message);
    if (r.ok) return db;
    if (r.status !== 409 && r.status !== 422) throw new HttpError(502, "GitHub write failed (" + r.status + ")");
  }
  throw new HttpError(409, "Too many people saving at once. Please try again.");
}

// Keep the file under the size limit by dropping the oldest readings (they stay in git history).
function trim(db) {
  while (JSON.stringify(db).length > MAX_BYTES) {
    let oldest = null;
    for (const id in db.data) {
      const a = db.data[id];
      if (a.length && (oldest === null || a[0].t < db.data[oldest][0].t)) oldest = id;
    }
    if (oldest === null) break;
    db.data[oldest].shift();
  }
}

const clean = (v, max = 60) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function validReading(x) {
  const t = num(x && x.t), T = num(x && x.T), RH = num(x && x.RH);
  const S = x && x.S == null ? null : num(x && x.S);
  if (t === null || T === null || RH === null) throw new HttpError(400, "Invalid reading");
  if (T < -20 || T > 60) throw new HttpError(400, "Temperature out of range");
  if (RH < 1 || RH > 100) throw new HttpError(400, "RH must be 1 to 100");
  if (x.S != null && (S === null || S < -40 || S > 100)) throw new HttpError(400, "Surface temperature out of range");
  if (!SHIFTS.includes(x.sh)) throw new HttpError(400, "Invalid shift");
  const by = clean(x.by);
  if (!by) throw new HttpError(400, "Technician required");
  return { t, T, RH, S, by, sh: x.sh };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const out = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });
  try {
    if (!TOKEN || !REPO) return out(500, { error: "Server not configured: set GITHUB_TOKEN and GITHUB_REPO in Netlify." });
    if (PIN && (event.headers["x-team-pin"] || "") !== PIN) return out(401, { error: "Wrong or missing PIN" });

    if (event.httpMethod === "GET") return out(200, (await load()).db);
    if (event.httpMethod !== "POST") return out(405, { error: "Method not allowed" });

    const b = JSON.parse(event.body || "{}");
    let db;

    if (b.action === "addReading") {
      const rd = validReading(b.reading);
      db = await mutate((d) => {
        if (!d.locs.some((l) => l.id === b.locId)) throw new HttpError(400, "Unknown location");
        (d.data[b.locId] = d.data[b.locId] || []).push(rd);
        d.data[b.locId].sort((p, q) => p.t - q.t);
      }, "Reading: " + rd.by + " (" + rd.sh + ")");
    } else if (b.action === "addLoc") {
      const name = clean(b.name);
      if (!name) throw new HttpError(400, "Name required");
      db = await mutate((d) => {
        if (d.locs.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
        const id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        d.locs.push({ id, name });
        d.data[id] = [];
      }, "Add location: " + name);
    } else if (b.action === "addTech") {
      const name = clean(b.name);
      if (!name) throw new HttpError(400, "Name required");
      db = await mutate((d) => {
        if (!d.techs.includes(name)) d.techs.push(name);
      }, "Add technician: " + name);
    } else if (b.action === "delTech") {
      const name = clean(b.name);
      db = await mutate((d) => { d.techs = d.techs.filter((n) => n !== name); }, "Remove technician: " + name);
    } else {
      throw new HttpError(400, "Unknown action");
    }
    return out(200, db);
  } catch (e) {
    return out(e.status || 500, { error: e.message });
  }
};
