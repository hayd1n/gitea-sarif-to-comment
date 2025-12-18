import { existsSync, readFileSync } from "fs";

// Helper function to handle API requests
async function fetchApi(url, token, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `API request failed [${method} ${url}]: ${response.status} ${errText}`
    );
  }

  // PATCH and POST return JSON, but we might not need it for all cases
  // GET returns list
  if (response.status !== 204) {
    return await response.json();
  }
  return null;
}

async function run() {
  try {
    // Get Inputs
    const sarifFile = process.env.INPUT_SARIF_FILE;
    const githubToken = process.env.INPUT_TOKEN;
    const commentTitle = process.env.INPUT_TITLE;
    const resultsLimit = parseInt(process.env.INPUT_RESULTS_LIMIT || "50", 10);
    // Convert string 'true'/'false' to boolean, default to true
    const updateExisting = process.env.INPUT_UPDATE_EXISTING === "true";

    const apiUrl = process.env.GITHUB_API_URL;
    const repository = process.env.GITHUB_REPOSITORY; // owner/repo
    const eventPath = process.env.GITHUB_EVENT_PATH;

    // Basic Validation
    if (!existsSync(sarifFile)) {
      console.log(`SARIF file not found: ${sarifFile}`);
      return;
    }

    if (!githubToken) {
      console.warn("⚠️ INPUT_TOKEN is not set. API calls will likely fail.");
    }

    // Get PR Number
    const eventData = JSON.parse(readFileSync(eventPath, "utf8"));
    const prNumber =
      eventData.number ||
      (eventData.pull_request && eventData.pull_request.number);

    if (!prNumber) {
      console.log("Not a Pull Request event, skipping comment.");
      return;
    }

    // Parse SARIF & Build Content
    const sarifData = JSON.parse(readFileSync(sarifFile, "utf8"));
    const runs = sarifData.runs || [];
    let results = [];

    for (const run of runs) {
      if (run.results) {
        results = results.concat(run.results);
      }
    }

    // Identify our comment by a hidden HTML comment or unique title structure
    const signature = `<!-- hayd1n/gitea-sarif-to-comment -->`;

    let body = `${signature}\n### ${commentTitle}\n\n`;

    if (results.length === 0) {
      body += "✅ **No vulnerabilities found.** Great job!";
    } else {
      body += `Found **${results.length}** issues.\n\n`;
      body += "| Severity | Message | File | Line |\n";
      body += "| :--- | :--- | :--- | :--- |\n";

      for (const res of results.slice(0, resultsLimit)) {
        const ruleId = res.ruleId;
        const message = res.message.text.replace(/\n/g, " ");
        const location = res.locations?.[0]?.physicalLocation;
        const file = location?.artifactLocation?.uri || "unknown";
        const line = location?.region?.startLine || "?";

        let severity = "⚠️ Warning";
        if (res.level === "error") severity = "🔴 Error";
        if (res.level === "note") severity = "ℹ️ Note";

        body += `| ${severity} | **${ruleId}**: ${message} | \`${file}\` | ${line} |\n`;
      }

      if (results.length > resultsLimit) {
        body += `\n... and ${
          results.length - resultsLimit
        } more issues. Download the artifact to see all.\n`;
      }

      body +=
        "\n<details><summary>🔍 Click to view raw report summary</summary>\n\n";
      body += "```json\n";
      body += JSON.stringify(results.slice(0, 3), null, 2);
      body += "\n...\n```\n</details>";
    }

    // Append timestamp to show it was updated
    body += `\n\n_Generated at: ${new Date().toISOString()}_`;

    // Find Existing Comment (if enabled)
    let previousCommentId = null;

    if (updateExisting) {
      console.log("🔍 Checking for existing comments...");
      const commentsUrl = `${apiUrl}/repos/${repository}/issues/${prNumber}/comments`;
      const comments = await fetchApi(commentsUrl, githubToken);

      // Find the bot's comment.
      // We look for the hidden signature from old versions
      const found = comments.find((c) => c.body.includes(signature));

      if (found) {
        previousCommentId = found.id;
        console.log(`✅ Found existing comment ID: ${previousCommentId}`);
      } else {
        console.log("ℹ️ No existing comment found.");
      }
    }

    // Post or Update Comment
    if (previousCommentId) {
      // UPDATE (PATCH)
      const updateUrl = `${apiUrl}/repos/${repository}/issues/comments/${previousCommentId}`;
      console.log(`📝 Updating comment: ${updateUrl}`);

      await fetchApi(updateUrl, githubToken, "PATCH", { body: body });
      console.log("✅ Comment updated successfully!");
    } else {
      // CREATE (POST)
      const createUrl = `${apiUrl}/repos/${repository}/issues/${prNumber}/comments`;
      console.log(`🚀 Posting new comment: ${createUrl}`);

      await fetchApi(createUrl, githubToken, "POST", { body: body });
      console.log("✅ New comment posted successfully!");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

run();
