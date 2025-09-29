# GitHub Release Notes Downloader

A simple Node.js script that downloads all release notes from a GitHub repository and saves them as a clean markdown changelog file.

## Features

- Downloads all releases from any public GitHub repository
- Handles pagination automatically to fetch all releases
- Creates a single consolidated changelog file per repository
- Saves files with format `{REPO_NAME}-changelog.md`
- Minimal, clean format without metadata clutter
- Automatically removes "New Contributors" sections and "Full Changelog" links
- Sorts releases by publication date (newest first)

## Usage

```bash
node download-release-notes.js <github-repo-url>
```

### Examples

```bash
# Download release notes from typia repository
node download-release-notes.js https://github.com/samchon/typia

# Download release notes from nestia repository
node download-release-notes.js https://github.com/samchon/nestia

# The script accepts various GitHub URL formats
node download-release-notes.js https://github.com/owner/repo
node download-release-notes.js https://github.com/owner/repo/releases
```

## Output

The script creates a single markdown file in your current working directory:

```
typia-changelog.md     # All typia releases in one file
nestia-changelog.md    # All nestia releases in one file
```

### Example Output Format

```markdown
# typia Changelog

## Version 5.5.5

### Bug Fixes
- Fixed issue with type validation
- Improved performance for large objects

### New Features
- Added support for new TypeScript features

---

## Version 5.5.4

### Changes
- Updated dependencies
- Fixed documentation typos

---

...
```

## Requirements

- Node.js (built-in modules only - no external dependencies)
- Internet connection to access GitHub API
- Public GitHub repository (no authentication required)

## Rate Limits

The script is designed to be respectful of GitHub's API rate limits:

- Uses a 100ms delay between requests
- Fetches 100 releases per page (maximum allowed)
- Includes proper User-Agent headers
- Handles API errors gracefully

For unauthenticated requests, GitHub allows 60 requests per hour per IP address.

## Making it Globally Available

To use the script from anywhere on your system:

1. Make it executable:
   ```bash
   chmod +x download-release-notes.js
   ```

2. Add a symbolic link to your PATH:
   ```bash
   ln -s /full/path/to/utils/download-release-notes.js /usr/local/bin/download-release-notes
   ```

3. Then you can run it from anywhere:
   ```bash
   download-release-notes https://github.com/samchon/typia
   # Creates: typia-changelog.md
   ```

## License

This script is provided as-is for educational and utility purposes.