# Condensation Monitor: GitHub + Netlify setup

The page is static HTML on Netlify. A small Netlify Function saves every reading, location and
technician name to a JSON file in your GitHub repo, so the whole team sees the same data.
The GitHub token stays on Netlify's server and is never sent to the browser.

## What is in this folder
- `public/index.html`: the dashboard
- `netlify/functions/api.js`: reads and writes the data file on GitHub
- `netlify.toml`: Netlify settings

## Step 1. GitHub
1. Create a new **private** repository, for example `condensation-monitor`.
2. Upload everything in this folder (`public`, `netlify`, `netlify.toml`, `README.md`) to the `main` branch.
3. Create a second branch named **`data`** (branch dropdown, type `data`, Create branch).
   Readings are saved on this branch so each reading does not trigger a new Netlify deploy.
4. Create a token: GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate.
   - Repository access: **Only select repositories** > your repository
   - Permissions > Repository permissions > **Contents: Read and write**
   - Copy the token (starts with `github_pat_`).

## Step 2. Netlify
1. Netlify > Add new site > Import an existing project > GitHub > pick the repository.
2. Netlify reads `netlify.toml`, so leave the build settings as they are and click Deploy.
3. Site configuration > Environment variables > add:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | the token from Step 1 |
| `GITHUB_REPO` | `your-github-username/condensation-monitor` |
| `GITHUB_BRANCH` | `data` |
| `TEAM_PIN` | a PIN or password you choose, shared with your team |

4. Deploys > Trigger deploy > Deploy site (so the function picks up the variables).
5. Site configuration > Build & deploy > Branches and deploy contexts: make sure branch deploys are
   off (production branch only), so saving data never rebuilds the site.

## Step 3. First use
1. Open your Netlify address. Enter the team PIN when asked (each device remembers it).
2. Add your locations (Add location) and technician names (Technicians card). They are stored in GitHub and shared.
3. Add readings: choose location, shift and technician, enter temperature and RH (surface is optional).

## Good to know
- Data file: `data/db.json` on the `data` branch. It is created automatically on the first save.
- The file is kept under about 900 KB by dropping the oldest readings. They stay in the git history.
  Use **Export CSV** regularly to keep a full record.
- Anyone with the PIN can add readings. Do not share the PIN or the GitHub token outside the team.
- Changing the PIN: edit `TEAM_PIN` in Netlify and redeploy. Devices will ask for the new PIN.
- Wrong readings are not editable in the page. Edit `data/db.json` on the `data` branch in GitHub.
