import { mkdir, writeFile } from "node:fs/promises";

const username = "Richard117297";
const outputDir = "assets/generated";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("GITHUB_TOKEN is required to generate README stats.");
}

const headers = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${token}`,
  "User-Agent": "readme-stats-generator",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${url}\n${body}`);
  }

  return response.json();
}

async function fetchGraphql(query, variables) {
  const data = await fetchJson("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (data.errors?.length) {
    throw new Error(`GitHub GraphQL request failed: ${JSON.stringify(data.errors, null, 2)}`);
  }

  return data.data;
}

async function fetchAllOwnedRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const batch = await fetchJson(
      `https://api.github.com/users/${username}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );

    repos.push(...batch);

    if (batch.length < 100) {
      break;
    }

    page += 1;
  }

  return repos.filter((repo) => !repo.fork && !repo.archived);
}

async function fetchLanguageTotals(repos) {
  const totals = new Map();

  for (const repo of repos) {
    const languages = await fetchJson(repo.languages_url);

    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) ?? 0) + bytes);
    }
  }

  return totals;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function svgShell(width, height, label, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1b27" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="12" fill="url(#bg)" />
${content}
</svg>
`;
}

function makeStatItem(label, value, x, y) {
  return `  <text x="${x}" y="${y}" fill="#70a5fd" font-size="12" font-weight="600" font-family="Segoe UI, Arial, sans-serif">${escapeXml(label)}</text>
  <text x="${x}" y="${y + 20}" fill="#c3d1ff" font-size="18" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(value)}</text>`;
}

function buildStatsSvg({ profile, repos, contributions }) {
  const stars = repos.reduce((total, repo) => total + repo.stargazers_count, 0);
  const forks = repos.reduce((total, repo) => total + repo.forks_count, 0);
  const currentYear = new Date().getUTCFullYear();

  const items = [
    ["Total Stars", formatNumber(stars), 30, 72],
    ["Public Repos", formatNumber(repos.length), 260, 72],
    ["Followers", formatNumber(profile.followers), 30, 122],
    ["Forks", formatNumber(forks), 260, 122],
    [`${currentYear} Contributions`, formatNumber(contributions.totalContributions), 30, 164],
  ];

  const content = [
    `  <text x="30" y="38" fill="#70a5fd" font-size="20" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(username)}'s GitHub Stats</text>`,
    ...items.map(([label, value, x, y]) => makeStatItem(label, value, x, y)),
  ].join("\n");

  return svgShell(495, 195, "GitHub stats", content);
}

function languageColor(language, fallbackIndex) {
  const known = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    Java: "#b07219",
    HTML: "#e34c26",
    CSS: "#563d7c",
    "C#": "#178600",
    Shell: "#89e051",
    PHP: "#4F5D95",
    Kotlin: "#A97BFF",
  };

  const fallback = ["#70a5fd", "#bf91f3", "#38bdae", "#ff757f", "#ffc777", "#7dcfff"];
  return known[language] ?? fallback[fallbackIndex % fallback.length];
}

function buildTopLanguagesSvg(languageTotals) {
  const totalBytes = [...languageTotals.values()].reduce((total, bytes) => total + bytes, 0);
  const topLanguages = [...languageTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const rows = topLanguages.map(([language, bytes], index) => {
    const percent = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
    const y = 72 + index * 22;
    const color = languageColor(language, index);
    const width = Math.max(3, Math.round((percent / 100) * 260));

    return `  <text x="30" y="${y}" fill="#c3d1ff" font-size="13" font-weight="600" font-family="Segoe UI, Arial, sans-serif">${escapeXml(language)}</text>
  <text x="420" y="${y}" fill="#9aa5ce" font-size="12" text-anchor="end" font-family="Segoe UI, Arial, sans-serif">${percent.toFixed(1)}%</text>
  <rect x="155" y="${y - 10}" width="260" height="8" rx="4" fill="#24283b" />
  <rect x="155" y="${y - 10}" width="${width}" height="8" rx="4" fill="${color}" />`;
  });

  const emptyState = `  <text x="247.5" y="112" fill="#9aa5ce" font-size="14" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">No language data available</text>`;

  const content = [
    `  <text x="30" y="38" fill="#70a5fd" font-size="20" font-weight="700" font-family="Segoe UI, Arial, sans-serif">Top Languages</text>`,
    rows.length ? rows.join("\n") : emptyState,
  ].join("\n");

  return svgShell(495, 195, "Top languages", content);
}

const contributionQuery = `
  query ReadmeStats($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

const now = new Date();
const currentYear = now.getUTCFullYear();
const from = `${currentYear}-01-01T00:00:00Z`;
const to = now.toISOString();

console.log(`Generating README stats for ${username}`);
console.log(`Contribution range: ${from} to ${to}`);

const [profile, repos, contributionData] = await Promise.all([
  fetchJson(`https://api.github.com/users/${username}`),
  fetchAllOwnedRepos(),
  fetchGraphql(contributionQuery, { login: username, from, to }),
]);

const languageTotals = await fetchLanguageTotals(repos);
const contributions = contributionData.user.contributionsCollection.contributionCalendar;

await mkdir(outputDir, { recursive: true });
await writeFile(`${outputDir}/stats.svg`, buildStatsSvg({ profile, repos, contributions }), "utf8");
await writeFile(`${outputDir}/top-langs.svg`, buildTopLanguagesSvg(languageTotals), "utf8");

console.log(`Generated ${outputDir}/stats.svg`);
console.log(`Generated ${outputDir}/top-langs.svg`);
