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

// 🐶 Toggle: include DOM snapshot in prompt?
const USE_DOM_CONTEXT = true;

// Resolve relative path to nodes JSON
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodesPath = path.join(__dirname, "active_nodes_summary.json");

// ✅ Sanitize sensitive tokens/keys from error messages
function sanitizeError(msg) {
  if (!msg) return null;
  return msg.replace(/(key|token|secret|password)[^\s]*/gi, "[REDACTED]");
}

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

// ✅ Summarize Workflow (with Broken Reference Detection)
app.post("/summarizeWorkflow", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey } = req.body;
    if (!workflowId || !baseUrl || !apiKey) {
      return res
        .status(400)
        .json({ error: "workflowId, baseUrl, and apiKey are required" });
    }

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

    // Collect nodes
    const nodes =
      workflow.nodes?.map(
        (n) => `- name: ${n.name}, type: ${n.type}, id: ${n.id}`
      ) || [];

    // Collect connections
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

    // ✅ Broken reference detection
    const nodeNames = new Set(workflow.nodes?.map((n) => n.name));
    let brokenRefs = [];
    if (workflow.connections) {
      for (const [src, targetGroups] of Object.entries(workflow.connections)) {
        if (targetGroups?.main) {
          for (const group of targetGroups.main) {
            for (const t of group) {
              if (!nodeNames.has(t.node)) {
                brokenRefs.push(`${src} → ${t.node} (missing)`);
              }
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

Broken References:
${brokenRefs.length ? brokenRefs.join("\n") : "None 🎉"}
    `.trim();

    res.json({ summary, workflow });
  } catch (error) {
    console.error("Error summarizing workflow:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get ONLY the latest execution log
app.post("/getExecutionLogs", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey } = req.body;
    if (!workflowId || !baseUrl || !apiKey) {
      return res
        .status(400)
        .json({ error: "workflowId, baseUrl, and apiKey are required" });
    }

    const url = `${baseUrl}/api/v1/executions?workflowId=${workflowId}&status=error&limit=1&includeData=true`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-N8N-API-KEY": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      return res
        .status(response.status)
        .json({ error: `Logs request failed: ${text}` });
    }

    const data = await response.json();
    const latestExec = data.data?.[0];

    const logs = latestExec
      ? [
          {
            id: latestExec.id,
            status: latestExec.status,
            startedAt: latestExec.startedAt,
            stoppedAt: latestExec.stoppedAt,
            error: sanitizeError(
              latestExec.error?.message ||
                latestExec.data?.resultData?.error?.message ||
                null
            ),
            node: latestExec.data?.resultData?.error?.node || null,
          },
        ]
      : [];

    res.json({ logs });
  } catch (error) {
    console.error("Error fetching execution logs:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Main /ask endpoint
app.post("/ask", async (req, res) => {
  try {
    const { question, context, workflowSummary, executionLogs } = req.body;
    const history = req.body.history || [];

    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const availableNodes = await getAvailableNodes();

    const prompt = `
You are Doggy AI Buddy 🐶, an assistant that helps users debug and build n8n workflows.

ERROR FIXING:
- Always combine DOM error hints with the *latest* execution log for full context.
- Check workflow summary for broken references (nodes missing in connections).
- Always point out what the user personally entered incorrectly.

WORKFLOW SUMMARY (from JSON):
${workflowSummary || "No workflow context provided."}

LATEST EXECUTION LOG:
${executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "No recent execution log available."}

${
  USE_DOM_CONTEXT
    ? `📋 Page context (DOM snapshot):
${JSON.stringify(context, null, 2)}`
    : "📋 DOM snapshot skipped."
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
