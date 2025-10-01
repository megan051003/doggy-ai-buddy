import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

const USE_DOM_CONTEXT = true;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodesPath = path.join(__dirname, "active_nodes_summary.json");

// ========== HELPERS ==========

// Load available nodes (summary file)
async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading nodes file:", error);
    return [];
  }
}

// Format nodes so operations/triggers show both displayName + value
function formatNodesForPrompt(nodes) {
  if (!Array.isArray(nodes)) return "None";

  return nodes
    .map((node) => {
      let parts = [`Node: ${node.displayName || node.name}`];

      if (node.triggers?.length) {
        parts.push("  Triggers:");
        node.triggers.forEach((t) => {
          parts.push(
            `   - ${t.displayName || t.action || t.value} (internal: ${t.value})`
          );
        });
      }

      if (node.actions?.length) {
        parts.push("  Actions:");
        node.actions.forEach((a) => {
          parts.push(
            `   - ${a.displayName || a.action || a.name} (internal: ${a.value})`
          );
        });
      }

      return parts.join("\n");
    })
    .join("\n\n");
}

// Query Gemini
async function queryGemini(promptText, history) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const contents = [
    ...history,
    { role: "user", parts: [{ text: promptText }] },
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
  }

  return await response.json();
}

// ========== ROUTES ==========

// 🐶 Main ask route
app.post("/ask", async (req, res) => {
  try {
    const {
      question,
      context,
      workflowSummary,
      executionLogs,
      nodeDetails,
      builderState,
    } = req.body;
    const history = req.body.history || [];

    const availableNodes = await getAvailableNodes();
    const formattedNodes = formatNodesForPrompt(availableNodes);

    let builderBlock = "";
    if (builderState?.active && builderState.mode === "one" && builderState.step > 0) {
      builderBlock = `
DOGGY BUILDER MODE (STEP-BY-STEP)
Goal: ${builderState.goal}
Current Step: ${builderState.step}

Output exactly ONE node for this step:
- Node name (use the node's displayName, and suggest a friendly name for user to give it in workflow)
- Why this node
- Fields (field: value/mapping)
- Credentials needed (state type AND provide link or where to get them if possible, e.g. official docs, service console, or n8n credentials setup)
- Quick test tip
Keep answer under 8 lines.`;
    } else if (builderState?.active && builderState.mode === "all") {
      builderBlock = `
DOGGY BUILDER MODE (ALL STEPS)
Goal: ${builderState.goal}

Output the FULL workflow as numbered steps, each with:
- Node name (displayName + suggested friendly workflow name)
- Why this node
- Fields (field: value/mapping)
- Credentials needed (type + help link if possible)
- Quick test tip
Be concise, one node per block.`;
    }

    const nodeInfo = nodeDetails
      ? `\n📌 Node Details (real JSON):\n${JSON.stringify(nodeDetails, null, 2)}`
      : "";

    const prompt = `
You are Doggy AI Buddy 🐶. Be short, precise, and friendly.

RULES:
- Always use the node's displayName (user-facing).
- When listing operations/triggers, always show: Display Name (internal: value).
- Suggest a clear label the user can give the node in their workflow (like "Sheets Trigger – Row Added").
- Always explain credentials:
  * Mention the type (OAuth2, API Key, etc).
  * Provide a helpful link (official docs, service console, or n8n docs).
  * If no exact link is known, explain where in n8n they add it.
- Never invent operations or triggers not in the node JSON.
- If unsure, say "Open the node in n8n to confirm exact options".

${builderBlock || ""}

WORKFLOW SUMMARY:
${workflowSummary || "No workflow provided."}

EXECUTION LOG:
${executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "None"}

${nodeInfo}

📚 Available Nodes (with actions/triggers):
${formattedNodes}

${
  USE_DOM_CONTEXT
    ? `📋 DOM snapshot:\n${JSON.stringify(context, null, 2)}`
    : "📋 DOM snapshot skipped."
}

💬 User message: ${question}
Answer:
    `;

    const tokenEstimate = prompt.split(/\s+/).length;
    console.log(`🐾 Estimated tokens: ${tokenEstimate}`);

    const geminiResponse = await queryGemini(prompt, history);
    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Doggy has no answer 🐾";

    res.json({ answer, tokenEstimate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== START SERVER ==========
app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
