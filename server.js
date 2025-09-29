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

// ✅ Get ONLY the latest execution log (with type mismatch detection)
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
          (() => {
            const rawError =
              latestExec.error?.message ||
              latestExec.data?.resultData?.error?.message ||
              null;
            const sanitizedError = sanitizeError(rawError);

            // 🔍 Type mismatch detection
            let mismatchHint = null;
            if (sanitizedError) {
              if (sanitizedError.includes("iterate over a non-array")) {
                mismatchHint =
                  "Array expected, but got string/object.";
              } else if (sanitizedError.includes("Cannot read properties of undefined")) {
                mismatchHint =
                  "Undefined value — check node input fields.";
              } else if (/expected .* but got/i.test(sanitizedError)) {
                mismatchHint =
                  "Data type mismatch — check mapping.";
              }
            }

            return {
              id: latestExec.id,
              status: latestExec.status,
              startedAt: latestExec.startedAt,
              stoppedAt: latestExec.stoppedAt,
              error: sanitizedError,
              node: latestExec.data?.resultData?.error?.node || null,
              typeMismatch: mismatchHint,
            };
          })(),
        ]
      : [];

    res.json({ logs });
  } catch (error) {
    console.error("Error fetching execution logs:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Webhook Health Check
app.post("/checkWebhook", async (req, res) => {
  try {
    const { url, headers } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Webhook URL is required" });
    }

    console.log(`🐾 Checking webhook health at: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: headers || {},
    });

    if (response.ok) {
      return res.json({
        healthy: true,
        status: response.status,
        message: "Webhook is healthy ✅",
      });
    }

    if (response.status === 401) {
      return res.json({
        healthy: false,
        status: 401,
        message: "Unauthorized (401). Fix API key or headers.",
      });
    }

    if (response.status === 403) {
      return res.json({
        healthy: false,
        status: 403,
        message: "Forbidden (403). Check permissions.",
      });
    }

    return res.json({
      healthy: false,
      status: response.status,
      message: `Webhook responded with status ${response.status}`,
    });
  } catch (error) {
    console.error("❌ Webhook check failed:", error);
    return res.status(500).json({ healthy: false, error: error.message });
  }
});

// ✅ Main /ask endpoint — SHORT + PRECISE Doggy
app.post("/ask", async (req, res) => {
  try {
    const { question, context, workflowSummary, executionLogs } = req.body;
    const history = req.body.history || [];

    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const availableNodes = await getAvailableNodes();

    const prompt = `
You are Doggy AI Buddy 🐶. Be short, friendly, and precise.

RULES:
- If node code is visible in the DOM snapshot, point to the exact issue in 2–4 sentences.
- If node code is NOT visible, do NOT guess. Just say: "Open the node so I can sniff inside 🐶".
- Never write long paragraphs or generic JavaScript tutorials.
- Always mention the specific node name causing the issue if known.

WORKFLOW SUMMARY:
${workflowSummary || "No workflow context provided."}

EXECUTION LOG:
${executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "No log available."}

${
  USE_DOM_CONTEXT
    ? `📋 DOM snapshot:
${JSON.stringify(context, null, 2)}`
    : "📋 DOM snapshot skipped."
}

---
💬 User question: ${question}

Answer (short + clear):
    `;

    // 🐾 Token usage estimate
    const tokenEstimate = prompt.split(/\s+/).length;
    console.log(`🐾 Estimated tokens this round: ${tokenEstimate}`);

    const geminiResponse = await queryGemini(prompt, history);

    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No answer received";

    res.json({ answer, tokenEstimate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🐶 Doggy AI Buddy backend listening at http://localhost:${port}`);
});
