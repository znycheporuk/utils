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
 * Parse version string into numeric parts
 * @param {string} version - Version string (e.g., "9", "8.2", "7.5.9", "v1.2.3")
 * @returns {Array} - Array of numeric parts
 */
function parseVersion(version) {
  // Remove 'v' prefix if present
  const cleanVersion = version.replace(/^v/, "");

  // Split and convert to numbers
  return cleanVersion.split(".").map((part) => {
    const num = parseInt(part.replace(/[^\d]/g, ""), 10);
    return isNaN(num) ? 0 : num;
  });
}

/**
 * Check if a version matches a pattern (handles shorthands)
 * @param {string} version - Full version to check (e.g., "8.2.5")
 * @param {string} pattern - Pattern to match against (e.g., "8", "8.2", "8.2.5")
 * @param {string} type - "min" or "max" for different matching behavior
 * @returns {boolean} - Whether the version matches the pattern
 */
function versionMatches(version, pattern, type) {
  const versionParts = parseVersion(version);
  const patternParts = parseVersion(pattern);

  // For minimum version: version should be >= pattern
  // For maximum version: version should be <= pattern

  // Compare only the parts that exist in the pattern
  for (let i = 0; i < patternParts.length; i++) {
    const vPart = versionParts[i] || 0;
    const pPart = patternParts[i];

    if (vPart < pPart) {
      return type === "max"; // For max, smaller is ok
    }
    if (vPart > pPart) {
      return type === "min"; // For min, larger is ok
    }
    // If equal, continue to next part
  }

  // If all compared parts are equal, it's a match
  // For shorthand patterns like "8" matching "8.x.x", this is inclusive
  return true;
}

/**
 * Filter releases by version range
 * @param {Array} releases - Array of release objects
 * @param {string|null} minVersion - Minimum version (inclusive, supports shorthands)
 * @param {string|null} maxVersion - Maximum version (inclusive, supports shorthands)
 * @returns {Array} - Filtered releases
 */
function filterReleasesByVersion(releases, minVersion, maxVersion) {
  if (!minVersion && !maxVersion) {
    return releases;
  }

  return releases.filter((release) => {
    const version = release.tag_name;

    // Check minimum version (inclusive)
    if (minVersion && !versionMatches(version, minVersion, "min")) {
      return false;
    }

    // Check maximum version (inclusive)
    if (maxVersion && !versionMatches(version, maxVersion, "max")) {
      return false;
    }

    return true;
  });
}

/**
 * Save releases as a single minimal changelog markdown file
 * @param {Array} releases - Array of release objects
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string|null} minVersion - Minimum version filter
 * @param {string|null} maxVersion - Maximum version filter
 */
async function saveReleasesAsMarkdown(
  releases,
  owner,
  repo,
  minVersion,
  maxVersion,
) {
  const filename = `${repo}-changelog.md`;
  const filepath = path.join(process.cwd(), filename);

  // Filter releases by version range
  const filteredReleases = filterReleasesByVersion(
    releases,
    minVersion,
    maxVersion,
  );

  // Create changelog content
  let changelogContent = `# ${repo} Changelog\n\n`;

  if (minVersion || maxVersion) {
    changelogContent += `Version range: ${minVersion || "any"} to ${maxVersion || "latest"}\n`;
    changelogContent += `Showing ${filteredReleases.length} of ${releases.length} releases\n\n`;
  }

  // Sort releases by published date (newest first)
  filteredReleases.sort(
    (a, b) => new Date(b.published_at) - new Date(a.published_at),
  );

  for (let i = 0; i < filteredReleases.length; i++) {
    const release = filteredReleases[i];

    changelogContent += `## ${release.name || release.tag_name}\n\n`;

    if (release.body) {
      const cleanedBody = cleanReleaseBody(release.body);
      if (cleanedBody.trim()) {
        changelogContent += `${cleanedBody}\n\n`;
      }
    }

    // Add separator between releases (except for the last one)
    if (i < filteredReleases.length - 1) {
      changelogContent += `---\n\n`;
    }
  }

  // Save changelog file
  fs.writeFileSync(filepath, changelogContent, "utf8");
  console.log(`Saved changelog: ${filepath}`);
}

/**
 * Parse command line arguments
 * @param {Array} args - Command line arguments
 * @returns {Object} - Parsed arguments
 */
function parseArgs(args) {
  const result = {
    url: null,
    minVersion: null,
    maxVersion: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--min-version" && i + 1 < args.length) {
      result.minVersion = args[i + 1];
      i++; // Skip next argument as it's the value
    } else if (arg === "--max-version" && i + 1 < args.length) {
      result.maxVersion = args[i + 1];
      i++; // Skip next argument as it's the value
    } else if (
      !result.url &&
      (arg.startsWith("http://") || arg.startsWith("https://"))
    ) {
      result.url = arg;
    }
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: download-release-notes [options] <github-repo-url>");
    console.error("");
    console.error("Options:");
    console.error(
      "  --min-version <version>  Minimum version to include (optional)",
    );
    console.error(
      "  --max-version <version>  Maximum version to include (optional)",
    );
    console.error("");
    console.error("Examples:");
    console.error("  download-release-notes https://github.com/samchon/typia");
    console.error(
      "  download-release-notes --min-version 8.2 https://github.com/samchon/typia",
    );
    console.error(
      "  download-release-notes --max-version 9 https://github.com/samchon/typia",
    );
    console.error(
      "  download-release-notes --min-version 8.2 --max-version 9 https://github.com/samchon/typia",
    );
    console.error(
      "  download-release-notes --min-version v5.0.0 --max-version v6.0.0 https://github.com/samchon/typia",
    );
    process.exit(1);
  }

  const { url: repoUrl, minVersion, maxVersion } = parseArgs(args);

  if (!repoUrl) {
    console.error("Error: No GitHub repository URL provided");
    process.exit(1);
  }

  try {
    // Parse GitHub URL
    const { owner, repo } = parseGitHubUrl(repoUrl);
    console.log(`Repository: ${owner}/${repo}`);

    if (minVersion) {
      console.log(`Minimum version: ${minVersion}`);
    }
    if (maxVersion) {
      console.log(`Maximum version: ${maxVersion}`);
    }

    // Fetch all releases
    const releases = await fetchAllReleases(owner, repo);

    if (releases.length === 0) {
      console.log("No releases found for this repository.");
      return;
    }

    // Save as markdown file
    await saveReleasesAsMarkdown(releases, owner, repo, minVersion, maxVersion);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
