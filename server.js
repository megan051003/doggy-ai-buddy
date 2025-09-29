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
app.use(bodyParser.json({ limit: "2mb" })); // allow bigger context payloads

// 🐶 Toggle: include DOM snapshot in prompt?
const USE_DOM_CONTEXT = true;

// Resolve relative path to nodes JSON
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodesPath = path.join(__dirname, "active_nodes_summary.json");

// ✅ Reads local JSON cleanly
async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading nodes file:", error);
    return { error: "Could not retrieve available nodes" };
  }
}

// ✅ Gemini call with retry logic
async function queryGemini(promptText, history) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const maxRetries = 3;
  let retryCount = 0;

  const contents = [
    ...history,
    { role: "user", parts: [{ text: promptText }] },
  ];

  while (retryCount < maxRetries) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({ contents }),
      });

      if (response.status === 429) {
        console.warn(
          `Quota exceeded. Retrying in 10s... (Attempt ${retryCount + 1} of ${maxRetries})`
        );
        await new Promise((r) => setTimeout(r, 10000));
        retryCount++;
        continue;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Attempt ${retryCount + 1} failed:`, error);
      retryCount++;
      if (retryCount >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

// ✅ Summarize Workflow (Day 8)
app.post("/summarizeWorkflow", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey } = req.body;

    if (!workflowId || !baseUrl || !apiKey) {
      return res
        .status(400)
        .json({ error: "workflowId, baseUrl, and apiKey are required" });
    }

    // Fetch workflow JSON from n8n
    const response = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      return res
        .status(response.status)
        .json({ error: `API request failed: ${text}` });
    }

    const workflow = await response.json();

    // Build a compact summary
    const nodes =
      workflow.nodes?.map(
        (n) => `- name: ${n.name}, type: ${n.type}, id: ${n.id}`
      ) || [];

    // ✅ safer connections mapping
    let connections = [];
    if (workflow.connections) {
      for (const [src, targetGroups] of Object.entries(workflow.connections)) {
        if (targetGroups?.main) {
          for (const group of targetGroups.main) {
            for (const t of group) {
              connections.push(`${src} → ${t.node}`);
            }
          }
        }
      }
    }

    const summary = `
Workflow: ${workflow.name} (active: ${workflow.active})
Nodes:
${nodes.join("\n")}

Connections:
${connections.length ? connections.join("\n") : "No connections"}
    `.trim();

    res.json({ summary, workflow });
  } catch (error) {
    console.error("Error summarizing workflow:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Main /ask endpoint
app.post("/ask", async (req, res) => {
  try {
    const { question, context, workflowSummary } = req.body;
    const history = req.body.history || [];

    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const availableNodes = await getAvailableNodes();

    // Build prompt dynamically
    const prompt = `
You are Doggy AI Buddy 🐶, an assistant that helps users debug and build n8n workflows.

ERROR FIXING:
- Always point out what the user personally entered incorrectly (based on context snapshot).
- Do not give generic advice.
- Use the provided node JSON list; never suggest nodes that aren't in the list.

WORKFLOW BUILDING:
- Guide step by step.
- Use UI context (buttons, fields) to reference where to click.
- When suggesting a node, include the full JSON definition from the availableNodes list.

WORKFLOW SUMMARY (from JSON):
${workflowSummary || "No workflow context provided."}

${
  USE_DOM_CONTEXT
    ? `📋 Page context (DOM snapshot):
${JSON.stringify(context, null, 2)}`
    : "📋 DOM snapshot: skipped in this mode."
}

---

💬 User question: ${question}

🧩 Available nodes:
${JSON.stringify(availableNodes, null, 2)}

Answer:
    `;

    const geminiResponse = await queryGemini(prompt, history);

    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No answer received";

    res.json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🐶 Doggy AI Buddy backend listening at http://localhost:${port}`);
});
