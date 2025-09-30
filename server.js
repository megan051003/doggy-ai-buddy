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

// 🔒 Sanitize sensitive tokens
function sanitizeError(msg) {
  if (!msg) return null;
  return msg.replace(/(key|token|secret|password)[^\s]*/gi, "[REDACTED]");
}

// 📂 Available nodes file
async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    return JSON.parse(data);
  } catch {
    return { error: "Could not retrieve available nodes" };
  }
}

// 🧠 Gemini API
async function queryGemini(promptText, history) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const contents = [...history, { role: "user", parts: [{ text: promptText }] }];

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

// 📊 Workflow summary
app.post("/summarizeWorkflow", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey } = req.body;
    if (!workflowId || !baseUrl || !apiKey) {
      return res.status(400).json({ error: "workflowId, baseUrl, apiKey required" });
    }

    const response = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `API failed: ${text}` });
    }

    const workflow = await response.json();
    const nodes =
      workflow.nodes?.map((n) => `- name: ${n.name}, type: ${n.type}, id: ${n.id}`) || [];

    const summary = `
Workflow: ${workflow.name} (active: ${workflow.active})
Nodes:
${nodes.join("\n")}
    `.trim();

    res.json({ summary, workflow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔍 Node details (for sidebar only)
app.post("/getNodeDetails", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey, nodeName } = req.body;
    if (!workflowId || !baseUrl || !apiKey || !nodeName) {
      return res
        .status(400)
        .json({ error: "workflowId, baseUrl, apiKey, nodeName required" });
    }

    const response = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `API failed: ${text}` });
    }

    const workflow = await response.json();
    const node = workflow.nodes?.find((n) =>
      n.name.toLowerCase().includes(nodeName.toLowerCase())
    );

    if (!node) {
      return res.status(404).json({ error: `Node "${nodeName}" not found` });
    }

    res.json({ node });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🐶 Main chat endpoint
app.post("/ask", async (req, res) => {
  try {
    const { question, context, workflowSummary, executionLogs } = req.body;
    const history = req.body.history || [];

    if (!question) return res.status(400).json({ error: "No question provided" });

    const availableNodes = await getAvailableNodes();

    const prompt = `
You are Doggy AI Buddy 🐶. Be short, precise, and friendly.

RULES:
- If a node’s code/fields are not in the DOM, say: "Open the node so I can sniff inside 🐶".
- Always mention the node name if known.
- Keep answers to 2–4 sentences, no long essays.

WORKFLOW SUMMARY:
${workflowSummary || "No workflow provided."}

EXECUTION LOG:
${executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "None"}

${
  USE_DOM_CONTEXT
    ? `📋 DOM snapshot:\n${JSON.stringify(context, null, 2)}`
    : "📋 DOM snapshot skipped."
}

💬 User question: ${question}
Answer (short, clear, specific):
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

app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
