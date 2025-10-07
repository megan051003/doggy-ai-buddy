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

// 📂 Load available nodes JSON
async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 📂 Just the display names (lightweight)
function getNodeNames(nodes) {
  return nodes.map((n) => n.displayName || n.name);
}

// 🧠 Query Gemini
async function queryGemini(model, promptText, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contents = [...history, { role: "user", parts: [{ text: promptText }] }];

  console.log("==== PROMPT SENT TO GEMINI ====\n", promptText, "\n=============================");

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

// 🧭 Router: decides what info to include
function routeQuestion(question) {
  const q = question.toLowerCase();
  let needs = {
    need_nodes_names: false,
    need_nodes_json: false,
    need_logs: false,
    need_dom: false,
    builder_mode: "none",
  };

  if (q.includes("error") || q.includes("fix") || q.includes("debug")) {
    needs.need_logs = true;
  }

  if (q.includes("@buildone")) {
    needs.builder_mode = "one";
    needs.need_nodes_names = true;
    needs.need_nodes_json = true;
  }

  if (q.includes("@buildall")) {
    needs.builder_mode = "all";
    needs.need_nodes_names = true;
    needs.need_nodes_json = true;
  }

  if (q.includes("node") || q.includes("operation") || q.includes("trigger")) {
    needs.need_nodes_names = true;
    needs.need_nodes_json = true;
  }

  if (q.includes("dom") || q.includes("field") || q.includes("form")) {
    needs.need_dom = true;
  }

  return needs;
}

// ========== ROUTES ==========

// 📊 Workflow summary
app.post("/summarizeWorkflow", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey } = req.body;
    if (!workflowId || !baseUrl || !apiKey) {
      return res
        .status(400)
        .json({ error: "workflowId, baseUrl, apiKey required" });
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
      workflow.nodes?.map(
        (n) => `- name: ${n.name}, type: ${n.type}, id: ${n.id}`
      ) || [];

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

// 🔍 Node details
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
    const { question, context, workflowSummary, executionLogs, builderState } =
      req.body;
    const history = req.body.history || [];

    if (!question) return res.status(400).json({ error: "No question provided" });

    // Decide context needs
    const needs = routeQuestion(question);
    console.log("🧭 Router decision:", needs);

    // Load nodes
    const allNodes = await getAvailableNodes();
    const nodeNames = getNodeNames(allNodes);

    // If Builder Mode is active
    if (needs.builder_mode !== "none" || builderState?.active) {
      console.log("🐾 Builder mode engaged:", needs.builder_mode || builderState.mode);

      const relevantNodesText = allNodes
        .map((n) => {
          let actions = n.actions?.map(
            (a) => `- ${a.displayName || a.value} (internal: ${a.value})`
          );
          return `Node: ${n.displayName}\nActions:\n${actions?.join("\n") || "None"}`;
        })
        .join("\n\n");

      const builderPrompt =
        needs.builder_mode === "one" || builderState?.mode === "one"
          ? `
You are Doggy AI Buddy 🐶.
Builder step-by-step mode is active.

User goal: ${builderState?.goal || question}
Current Step: ${builderState?.step || 1}

Use ONLY the operations from this JSON list:
${relevantNodesText}

Return output in this strict format:

1. 🏷️ Friendly node name: ...
2. 🔧 Node type: ...
3. 🎯 Action/Operation: (must match from JSON above)
4. 📝 Fields to fill:
   - field: value/mapping
5. 🔑 Credentials needed:
   - Type: ...
   - Docs: ...
6. 🧪 Quick test tip: ...
`
          : `
You are Doggy AI Buddy 🐶.
Builder ALL-STEPS mode is active.

User goal: ${builderState?.goal || question}

Use ONLY the operations from this JSON list:
${relevantNodesText}

Return each step in this strict format:

Step X:
1. 🏷️ Friendly node name
2. 🔧 Node type
3. 🎯 Action/Operation (must match JSON)
4. 📝 Fields to fill
5. 🔑 Credentials needed (type + docs)
6. 🧪 Quick test tip
`;

      const geminiResponse = await queryGemini(
        "gemini-2.5-flash",
        builderPrompt,
        history
      );

      const answer =
        geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
        "Doggy has no answer 🐾";

      return res.json({
        answer,
        tokenEstimate: builderPrompt.split(/\s+/).length,
        builderMode: needs.builder_mode,
      });
    }

    // Otherwise: normal Q&A (debugging/help mode)
    const prompt = `
You are Doggy AI Buddy 🐶.

User: ${question}

Workflow summary:
${workflowSummary || "None"}

${
  needs.need_logs
    ? `Execution logs:\n${
        executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "None"
      }`
    : ""
}

${needs.need_nodes_names ? `Available node names:\n${nodeNames.join(", ")}` : ""}

${needs.need_nodes_json ? `Available nodes JSON:\n${JSON.stringify(allNodes, null, 2)}` : ""}

${needs.need_dom && USE_DOM_CONTEXT ? `DOM snapshot:\n${JSON.stringify(context, null, 2)}` : ""}

Answer concisely, based only on provided info.
    `;

    const tokenEstimate = prompt.split(/\s+/).length;
    console.log(`🐾 Estimated tokens: ${tokenEstimate}`);

    const geminiResponse = await queryGemini("gemini-2.5-flash", prompt, history);

    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Doggy has no answer 🐾";

    res.json({
      answer,
      tokenEstimate,
      routerDecision: needs,
    });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
