#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

/**
 * Parse GitHub repository URL to extract owner and repo name
 * @param {string} url - GitHub repository URL
 * @returns {Object} - { owner, repo }
 */
function parseGitHubUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split("/").filter((part) => part);

    if (pathParts.length < 2) {
      throw new Error("Invalid GitHub URL format");
    }

    return {
      owner: pathParts[0],
      repo: pathParts[1],
    };
  } catch {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
}

/**
 * Make HTTPS request to GitHub API
 * @param {string} url - API endpoint URL
 * @returns {Promise<Object>} - Parsed JSON response
 */
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "GitHub-Release-Notes-Downloader/1.0",
        Accept: "application/vnd.github.v3+json",
      },
    };

    const req = https.get(url, options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `GitHub API responded with status ${res.statusCode}: ${data}`,
              ),
            );
            return;
          }

          const parsed = JSON.parse(data);
          resolve({
            data: parsed,
            headers: res.headers,
          });
        } catch (error) {
          reject(new Error(`Failed to parse JSON response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

/**
 * Fetch all releases from GitHub repository with pagination
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Array>} - Array of all releases
 */
async function fetchAllReleases(owner, repo) {
  const releases = [];
  let page = 1;
  const perPage = 100; // Maximum allowed by GitHub API

  console.log(`Fetching releases for ${owner}/${repo}...`);

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?page=${page}&per_page=${perPage}`;

    try {
      console.log(`Fetching page ${page}...`);
      const response = await makeRequest(url);
      const pageReleases = response.data;

      if (!Array.isArray(pageReleases) || pageReleases.length === 0) {
        break;
      }

      releases.push(...pageReleases);

      // If we got fewer releases than requested, we've reached the end
      if (pageReleases.length < perPage) {
        break;
      }

      page++;

      // Add a small delay to be respectful to GitHub's API
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      throw new Error(
        `Failed to fetch releases on page ${page}: ${error.message}`,
      );
    }
  }

  console.log(`Found ${releases.length} releases`);
  return releases;
}

/**
 * Clean release body by removing "New Contributors" section and "Full Changelog" links
 * @param {string} body - Release body content
 * @returns {string} - Cleaned release body
 */
function cleanReleaseBody(body) {
  if (!body) return "";

  const lines = body.split("\n");
  const cleanedLines = [];
  let skipSection = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip "New Contributors" section
    if (
      trimmedLine.startsWith("## New Contributors") ||
      trimmedLine.startsWith("### New Contributors") ||
      trimmedLine.startsWith("**New Contributors**")
    ) {
      skipSection = true;
      continue;
    }

    // Skip "Full Changelog" links
    if (
      trimmedLine.startsWith("**Full Changelog**:") ||
      trimmedLine.startsWith("Full Changelog:")
    ) {
      continue;
    }

    // Reset skip section if we hit another section (but not New Contributors)
    if (
      skipSection &&
      (trimmedLine.startsWith("##") || trimmedLine.startsWith("###")) &&
      !trimmedLine.includes("New Contributors")
    ) {
      skipSection = false;
    }

    // If we're not skipping, keep the line
    if (!skipSection) {
      cleanedLines.push(line);
    }
  }

  return cleanedLines.join("\n").trim();
}

/**
 * Save releases as a single minimal changelog markdown file
 * @param {Array} releases - Array of release objects
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 */
async function saveReleasesAsMarkdown(releases, repo) {
  const filename = `${repo}-changelog.md`;
  const filepath = path.join(process.cwd(), filename);

  // Create changelog content
  let changelogContent = `# ${repo} Changelog\n\n`;

  // Sort releases by published date (newest first)
  releases.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  for (let i = 0; i < releases.length; i++) {
    const release = releases[i];

    changelogContent += `## ${release.name || release.tag_name}\n\n`;

    if (release.body) {
      const cleanedBody = cleanReleaseBody(release.body);
      if (cleanedBody.trim()) {
        changelogContent += `${cleanedBody}\n\n`;
      }
    }

    // Add separator between releases (except for the last one)
    if (i < releases.length - 1) {
      changelogContent += `---\n\n`;
    }
  }

  // Save changelog file
  fs.writeFileSync(filepath, changelogContent, "utf8");
  console.log(`Saved changelog: ${filepath}`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: download-release-notes <github-repo-url>");
    console.error("");
    console.error("Example:");
    console.error("  download-release-notes https://github.com/samchon/typia");
    process.exit(1);
  }

  const repoUrl = args[0];

  try {
    // Parse GitHub URL
    const { owner, repo } = parseGitHubUrl(repoUrl);
    console.log(`Repository: ${owner}/${repo}`);

    // Fetch all releases
    const releases = await fetchAllReleases(owner, repo);

    if (releases.length === 0) {
      console.log("No releases found for this repository.");
      return;
    }

    // Save as markdown file
    await saveReleasesAsMarkdown(releases, repo);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
