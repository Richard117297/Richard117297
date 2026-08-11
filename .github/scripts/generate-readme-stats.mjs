import { mkdir, writeFile } from "node:fs/promises";

const username = "Richard117297";
const outputDir = "assets/generated";
const token = process.env.GITHUB_TOKEN;
const cardWidth = 495;
const cardHeight = 230;

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
    let languages;

    try {
      languages = await fetchJson(repo.languages_url);
    } catch (error) {
      console.warn(`Skipping language data for ${repo.full_name}: ${error.message}`);
      continue;
    }

    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) ?? 0) + numberOrZero(bytes));
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
  const number = Number(value);
  return new Intl.NumberFormat("en-US").format(Number.isFinite(number) ? number : 0);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function svgShell(width, height, label, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1b27" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdae" />
      <stop offset="100%" stop-color="#70a5fd" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="10" fill="url(#bg)" />
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="9.5" fill="none" stroke="#2f3549" />
${content}
</svg>
`;
}

function makeStatItem(label, value, x, y, accent = "#38bdae") {
  return `  <circle cx="${x}" cy="${y - 4}" r="4" fill="${accent}" />
  <text x="${x + 14}" y="${y}" fill="#9aa5ce" font-size="12" font-weight="600" font-family="Segoe UI, Arial, sans-serif">${escapeXml(label)}</text>
  <text x="${x + 14}" y="${y + 24}" fill="#c3d1ff" font-size="24" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(value)}</text>`;
}

function buildStatsSvg({ profile, repos, contributions }) {
  const stars = repos.reduce((total, repo) => total + numberOrZero(repo.stargazers_count), 0);
  const forks = repos.reduce((total, repo) => total + numberOrZero(repo.forks_count), 0);
  const currentYear = new Date().getUTCFullYear();
  const yearContributions = contributions.contributionCalendar?.totalContributions;

  const items = [
    ["Stars", formatNumber(stars), 34, 79, "#bf91f3"],
    ["Repos", formatNumber(repos.length), 182, 79, "#70a5fd"],
    ["Followers", formatNumber(profile.followers), 330, 79, "#38bdae"],
    ["Forks", formatNumber(forks), 34, 139, "#ffc777"],
    [`${currentYear} Contributions`, formatNumber(yearContributions), 182, 139, "#ff757f"],
  ];

  const content = [
    `  <text x="30" y="38" fill="#70a5fd" font-size="22" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(username)}'s GitHub Stats</text>`,
    `  <line x1="30" y1="54" x2="465" y2="54" stroke="#2f3549" />`,
    ...items.map(([label, value, x, y, accent]) => makeStatItem(label, value, x, y, accent)),
  ].join("\n");

  return svgShell(cardWidth, cardHeight, "GitHub stats", content);
}

function makeDetailedRow(icon, label, value, y) {
  return `  <text x="36" y="${y}" fill="#bf91f3" font-size="20" text-anchor="middle" font-family="Segoe UI Symbol, Segoe UI, Arial, sans-serif">${escapeXml(icon)}</text>
  <text x="62" y="${y}" fill="#38bdae" font-size="15" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(label)}:</text>
  <text x="298" y="${y}" fill="#38bdae" font-size="15" font-weight="700" text-anchor="end" font-family="Segoe UI, Arial, sans-serif">${escapeXml(value)}</text>`;
}

function buildDetailedStatsSvg({ repos, contributions }) {
  const stars = repos.reduce((total, repo) => total + numberOrZero(repo.stargazers_count), 0);
  const contributedRepos = contributions.commitContributionsByRepository?.length ?? 0;
  const currentYear = new Date().getUTCFullYear();

  const rows = [
    ["☆", "Total Stars Earned", formatNumber(stars), 76],
    ["◷", `${currentYear} Commits`, formatNumber(contributions.totalCommitContributions), 108],
    ["⑂", `${currentYear} Pull Requests`, formatNumber(contributions.totalPullRequestContributions), 140],
    ["!", `${currentYear} Issues`, formatNumber(contributions.totalIssueContributions), 172],
    ["▣", "Contributed Repos", formatNumber(contributedRepos), 204],
  ];

  const content = [
    `  <text x="30" y="38" fill="#70a5fd" font-size="22" font-weight="700" font-family="Segoe UI, Arial, sans-serif">Classic Contribution Stats</text>`,
    `  <line x1="30" y1="54" x2="465" y2="54" stroke="#2f3549" />`,
    ...rows.map(([icon, label, value, y]) => makeDetailedRow(icon, label, value, y)),
    `  <circle cx="398" cy="130" r="48" fill="#38bdae" opacity="0.95" />`,
    `  <circle cx="398" cy="130" r="60" fill="none" stroke="#2f3b5c" stroke-width="12" />`,
    `  <path d="M398 70a60 60 0 0 1 43 18" fill="none" stroke="#70a5fd" stroke-width="8" stroke-linecap="round" />`,
    `  <text x="398" y="139" fill="#1a1b27" font-size="30" font-weight="800" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">GH</text>`,
  ].join("\n");

  return svgShell(cardWidth, cardHeight, "Detailed GitHub stats", content);
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
  const rowStart = 78;
  const rowGap = topLanguages.length > 1
    ? Math.min(32, 130 / (topLanguages.length - 1))
    : 0;

  const rows = topLanguages.map(([language, bytes], index) => {
    const percent = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
    const y = rowStart + index * rowGap;
    const color = languageColor(language, index);
    const width = Math.max(4, Math.round((percent / 100) * 360));

    return `  <circle cx="34" cy="${y - 4}" r="5" fill="${color}" />
  <text x="48" y="${y}" fill="#c3d1ff" font-size="14" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(language)}</text>
  <text x="465" y="${y}" fill="#9aa5ce" font-size="13" text-anchor="end" font-family="Segoe UI, Arial, sans-serif">${percent.toFixed(1)}%</text>
  <rect x="30" y="${y + 10}" width="360" height="7" rx="3.5" fill="#24283b" />
  <rect x="30" y="${y + 10}" width="${width}" height="7" rx="3.5" fill="${color}" />`;
  });

  const emptyState = `  <text x="247.5" y="112" fill="#9aa5ce" font-size="14" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">No language data available</text>`;

  const content = [
    `  <text x="30" y="38" fill="#70a5fd" font-size="22" font-weight="700" font-family="Segoe UI, Arial, sans-serif">Top Languages</text>`,
    `  <line x1="30" y1="54" x2="465" y2="54" stroke="#2f3549" />`,
    rows.length ? rows.join("\n") : emptyState,
  ].join("\n");

  return svgShell(cardWidth, cardHeight, "Top languages", content);
}

const contributionQuery = `
  query ReadmeStats($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        commitContributionsByRepository(maxRepositories: 100) {
          repository {
            name
          }
          contributions {
            totalCount
          }
        }
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
const contributions = contributionData.user?.contributionsCollection;

if (!contributions) {
  throw new Error(`No contribution data returned for ${username}.`);
}

await mkdir(outputDir, { recursive: true });
await writeFile(`${outputDir}/stats.svg`, buildStatsSvg({ profile, repos, contributions }), "utf8");
await writeFile(`${outputDir}/top-langs.svg`, buildTopLanguagesSvg(languageTotals), "utf8");
await writeFile(`${outputDir}/detailed-stats.svg`, buildDetailedStatsSvg({ repos, contributions }), "utf8");

console.log(`Generated ${outputDir}/stats.svg`);
console.log(`Generated ${outputDir}/top-langs.svg`);
console.log(`Generated ${outputDir}/detailed-stats.svg`);
