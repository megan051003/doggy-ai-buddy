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
    return [];
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

// 🎯 Filter only relevant nodes from question
function filterRelevantNodes(question, nodes) {
  if (!question || !Array.isArray(nodes)) return [];
  const q = question.toLowerCase();

  return nodes.filter((node) => {
    const name = node.displayName?.toLowerCase() || "";
    const internal = node.name?.toLowerCase() || "";
    return q.includes(name) || q.includes(internal);
  });
}

// 🐶 Main chat endpoint
app.post("/ask", async (req, res) => {
  try {
    const { question, context, workflowSummary, executionLogs } = req.body;
    const history = req.body.history || [];

    if (!question) return res.status(400).json({ error: "No question provided" });

    const allNodes = await getAvailableNodes();
    const relevantNodes = filterRelevantNodes(question, allNodes);

    const formattedNodes = relevantNodes
      .map((n) => {
        let parts = [`Node: ${n.displayName || n.name}`];
        if (n.triggers?.length) {
          parts.push("  Triggers:");
          n.triggers.forEach((t) =>
            parts.push(`   - ${t.displayName || t.value} (internal: ${t.value})`)
          );
        }
        if (n.actions?.length) {
          parts.push("  Actions:");
          n.actions.forEach((a) =>
            parts.push(`   - ${a.displayName || a.value} (internal: ${a.value})`)
          );
        }
        return parts.join("\n");
      })
      .join("\n\n") || "None";

    const prompt = `
You are Doggy AI Buddy 🐶. Be short, precise, and friendly.

RULES:
- Only use triggers/actions that exist in the provided JSON.
- If the user mentions a node, check if it's in the "Available Nodes" list.
- If missing, say: "Open the node in n8n to confirm options."
- Never invent operations.

WORKFLOW SUMMARY:
${workflowSummary || "No workflow provided."}

EXECUTION LOG:
${executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "None"}

📚 Relevant Available Nodes:
${formattedNodes}

${
  USE_DOM_CONTEXT
    ? `📋 DOM snapshot:\n${JSON.stringify(context, null, 2)}`
    : "📋 DOM snapshot skipped."
}

💬 User question: ${question}
Answer:
    `;

    const tokenEstimate = prompt.split(/\s+/).length;
    console.log(`🐾 Estimated tokens: ${tokenEstimate}`);

    const geminiResponse = await queryGemini(prompt, history);

    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Doggy has no answer 🐾";

    res.json({ answer, tokenEstimate, relevantNodesCount: relevantNodes.length });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
