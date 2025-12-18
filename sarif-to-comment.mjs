import { existsSync, readFileSync } from "fs";

async function run() {
  try {
    // Get environment variables and input parameters
    const sarifFile = process.env.INPUT_SARIF_FILE || "scan_results.sarif";
    const githubToken = process.env.INPUT_TOKEN;
    const commentTitle = process.env.INPUT_TITLE || "🛡️ Security Scan Results";
    const resultsLimit = parseInt(process.env.INPUT_RESULTS_LIMIT || "50", 10);

    const apiUrl = process.env.GITHUB_API_URL;
    const repository = process.env.GITHUB_REPOSITORY; // owner/repo
    const eventPath = process.env.GITHUB_EVENT_PATH;

    if (!existsSync(sarifFile)) {
      console.log(`SARIF file not found: ${sarifFile}`);
      return;
    }

    // Read and parse Event Payload to get PR Number
    const eventData = JSON.parse(readFileSync(eventPath, "utf8"));
    // In Gitea/GitHub, pull_request event payload has a number field
    const prNumber =
      eventData.number ||
      (eventData.pull_request && eventData.pull_request.number);

    if (!prNumber) {
      console.log("Not a Pull Request event, skipping comment.");
      return;
    }

    // Read and parse SARIF file
    const sarifData = JSON.parse(readFileSync(sarifFile, "utf8"));
    const runs = sarifData.runs || [];
    let results = [];

    // Collect all results
    for (const run of runs) {
      if (run.results) {
        results = results.concat(run.results);
      }
    }

    // Build Markdown report
    let body = `### ${commentTitle}\n\n`;

    if (results.length === 0) {
      body += "✅ **No vulnerabilities found.** Great job!";
    } else {
      body += `Found **${results.length}** issues.\n\n`;
      body += "| Severity | Message | File | Line |\n";
      body += "| :--- | :--- | :--- | :--- |\n";

      for (const res of results.slice(0, resultsLimit)) {
        // Limit display to first maxResults to avoid overly long comments
        const ruleId = res.ruleId;
        const message = res.message.text.replace(/\n/g, " "); // Remove newlines to avoid breaking table
        // Try to get file location
        const location = res.locations?.[0]?.physicalLocation;
        const file = location?.artifactLocation?.uri || "unknown";
        const line = location?.region?.startLine || "?";

        // Try to determine severity (some tools put it in properties, some in rules)
        // Simple check here, default to Warning if not found
        let severity = "⚠️ Warning";
        if (res.level === "error") severity = "🔴 Error";
        if (res.level === "note") severity = "ℹ️ Note";

        body += `| ${severity} | **${ruleId}**: ${message} | \`${file}\` | ${line} |\n`;
      }

      if (results.length > 50) {
        body += `\n... and ${
          results.length - 50
        } more issues. Download the artifact to see all.\n`;
      }

      body +=
        "\n<details><summary>🔍 Click to view raw report summary</summary>\n\n";
      body += "```json\n";
      // Only include a bit of raw data
      body += JSON.stringify(results.slice(0, 3), null, 2);
      body += "\n...\n```\n</details>";
    }

    // Send API request to Gitea
    // API: POST /repos/{owner}/{repo}/issues/{index}/comments
    const endpoint = `${apiUrl}/repos/${repository}/issues/${prNumber}/comments`;

    console.log(`Posting comment to: ${endpoint}`);
    console.log(`Token: ${githubToken ? "****" : "Not Provided"}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `token ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ body: body }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to post comment: ${response.status} ${errText}`);
    }

    console.log("✅ Comment posted successfully!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

run();
