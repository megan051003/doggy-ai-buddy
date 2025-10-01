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

// 📂 Load available nodes from JSON
async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading nodes file:", error);
    return [];
  }
}

// 🧠 Call Gemini API
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

// 🔎 Summarize Workflow
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

// 🔍 Get Node Details
app.post("/getNodeDetails", async (req, res) => {
  try {
    const { workflowId, baseUrl, apiKey, nodeName } = req.body;
    if (!workflowId || !baseUrl || !apiKey || !nodeName) {
      return res.status(400).json({ error: "workflowId, baseUrl, apiKey, nodeName required" });
    }

    const response = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `API failed: ${text}` });
    }

    const workflow = await response.json();

    const node = workflow.nodes?.find(n =>
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

// 🐶 Main Chat Endpoint
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

    // 🐾 DEBUG: Log available nodes
    console.log("=== 🐶 DEBUG: Available Nodes from active_nodes_summary.json ===");
    availableNodes.forEach(n => {
      console.log(`Node: ${n.displayName}`);
      if (n.triggers?.length) {
        console.log("  Triggers:");
        n.triggers.forEach(t => console.log(`    - ${t.displayName} (${t.value})`));
      }
      if (n.actions?.length) {
        console.log("  Actions:");
        n.actions.forEach(a => console.log(`    - ${a.displayName} (${a.value})`));
      }
    });
    console.log("===============================================================");

    // 🐾 DEBUG: Print user question
    console.log("=== 🐶 DEBUG: User Question ===");
    console.log(question);
    console.log("================================");

    // 🐾 DEBUG: Node details
    if (nodeDetails) {
      console.log("=== 🐶 DEBUG: Node Details ===");
      console.log(JSON.stringify(nodeDetails, null, 2));
      console.log("================================");
    }

    let builderBlock = "";
    if (builderState?.active && builderState.mode === "one" && builderState.step > 0) {
      builderBlock = `
DOGGY BUILDER MODE (STEP-BY-STEP)
Goal: ${builderState.goal}
Current Step: ${builderState.step}

Output exactly ONE node for this step:
- Node name
- Why this node
- Fields (field: value/mapping)
- Credentials needed + where to get them
- Quick test tip
Keep under 8 lines.`;
    } else if (builderState?.active && builderState.mode === "all") {
      builderBlock = `
DOGGY BUILDER MODE (ALL STEPS)
Goal: ${builderState.goal}

Output full workflow as numbered nodes with:
- Node name
- Why
- Fields (field: value/mapping)
- Credentials needed
- Quick test tip
`;
    }

    const nodeInfo = nodeDetails
      ? `\n📌 Node Details (real JSON):\n${JSON.stringify(nodeDetails, null, 2)}`
      : "";

    const prompt = `
You are Doggy AI Buddy 🐶. Be short, precise, and friendly.

RULES:
- ONLY use trigger/action names that exist in availableNodes (listed below).
- Do not invent new operation names.
- If unsure, say: "Doggy doesn’t see that operation 🐾".
- Mention the exact 'value' from JSON alongside the display name.

${builderBlock}

WORKFLOW SUMMARY:
${workflowSummary || "No workflow provided."}

EXECUTION LOG:
${executionLogs?.[0] ? JSON.stringify(executionLogs[0], null, 2) : "None"}

${nodeInfo}

=== AVAILABLE NODES ===
${JSON.stringify(availableNodes, null, 2)}

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
    console.error("❌ Server Error in /ask:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
