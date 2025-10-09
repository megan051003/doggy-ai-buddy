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
app.use(bodyParser.json({ limit: "3mb" }));

// ================== GLOBAL CONFIG ==================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodesPath = path.join(__dirname, "active_nodes_summary.json");

// 🧠 Per-tab session store
const sessions = new Map(); // sessionId -> { goal, mode, nodes, logs, createdAt, step }

// ================== HELPERS ==================
function sanitizeError(msg) {
  if (!msg) return null;
  return msg.replace(/(key|token|secret|password)[^\s]*/gi, "[REDACTED]");
}

async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    const parsed = JSON.parse(data);
    return parsed.filter((n) => !n.hidden && !n.deprecated);
  } catch {
    return [];
  }
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function logBlock(title, content) {
  console.log(`\n==== ${title} ====\n${content}\n=============================\n`);
}

async function queryGemini(model, promptText, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contents = [...(history || []), { role: "user", parts: [{ text: promptText }] }];

  logBlock("PROMPT SENT TO GEMINI", promptText);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gemini error: ${JSON.stringify(err)}`);
    }

    const data = await response.json();
    logBlock("🧠 Gemini Raw Response", JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error("❌ Gemini request failed:", err.message);
    return { candidates: [{ content: { parts: [{ text: `❌ Gemini error: ${err.message}` }] } }] };
  }
}

function buildReasoningContext(state) {
  const nodes = state.nodes?.map((n) => n.displayName || n.name).join(", ") || "None yet";
  const logs = state.logs?.slice(-5).join("\n") || "No logs yet";
  return `
🐶 Current Workflow Context
--------------------------------
🎯 Goal: ${state.goal || "Not set yet"}
📦 Nodes so far: ${nodes}
🐾 Recent logs:
${logs}
--------------------------------
`;
}

// ================== MAIN ENDPOINT ==================
app.post("/ask", async (req, res) => {
  try {
    const { sessionId, question, context } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
    if (!question) return res.status(400).json({ error: "No question provided" });

    let state =
      sessions.get(sessionId) ||
      { goal: null, mode: "normal", nodes: [], logs: [], step: 0, createdAt: Date.now() };

    const q = question.toLowerCase();
    const allNodes = await getAvailableNodes();

    // 🧩 Detect new workflow start
    const isNewWorkflow = /\b(@buildall|@buildone|new workflow|start over|create (a|another)|forget this)\b/i.test(q);
    if (isNewWorkflow && state.goal) {
      // Already an active workflow → ask user to start new tab
      return res.json({
        answer:
          "🐶 Woof! It looks like you want to start a **new workflow**.\nPlease open a **new Doggie tab** to keep this one focused on the current workflow.",
        newWorkflowSuggested: true,
      });
    }

    if (!state.goal && isNewWorkflow) {
      // Initialize new workflow
      const mode = q.includes("build one") ? "one" : "all";
      const goal = question.replace(/^@\s*build\s*(one|all)?/i, "").trim() || "Unnamed workflow";
      state.goal = goal;
      state.mode = mode;
      state.step = 0;
      state.logs.push(`🐾 Started new workflow: ${goal}`);
      sessions.set(sessionId, state);
      logBlock("🐶 New Workflow Started", JSON.stringify(state, null, 2));
    }

    // 🔍 Detect intent
    const isDebug = /\b(error|debug|why|fail|broken|doesn.?t work|help|auth|credential)\b/i.test(q);
    const isAddNode = /\b(add|after|next node|insert)\b/i.test(q);
    const isExplain = /\b(explain|what does|how|why)\b/i.test(q);

    // 🧠 Build reasoning context
    const reasoningContext = buildReasoningContext(state);

    let prompt;
    if (isDebug) {
      prompt = `
You are Doggy AI Buddy 🐶, a workflow debugging assistant inside n8n.
The user is debugging their workflow. Analyze logs and context below to identify possible causes and fixes.

${reasoningContext}
`.trim();
    } else if (isAddNode) {
      prompt = `
You are Doggy AI Buddy 🐶.
The user is adding or connecting new nodes to their workflow.
Use the node list below to suggest the next logical node setup.

${reasoningContext}
Available nodes: ${allNodes.map((n) => n.displayName).join(", ")}
`.trim();
    } else if (isExplain) {
      prompt = `
You are Doggy AI Buddy 🐶.
Explain clearly and conversationally what each step or node means in the user's workflow.

${reasoningContext}
`.trim();
    } else {
      prompt = `
You are Doggy AI Buddy 🐶.
You're helping the user build, refine, or understand their n8n workflow step-by-step.
Be conversational, short, and clear — don't repeat unnecessary setup.

${reasoningContext}
`.trim();
    }

    // Query LLM
    const geminiResponse = await queryGemini("gemini-2.5-flash", `${prompt}\nUser: ${question}`, []);
    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "🐾 Woof! I couldn’t find that in the workflow context.";

    // Update session memory
    state.logs.push(`👤 ${question}`);
    if (answer) state.logs.push(`🤖 ${answer.slice(0, 120)}...`);
    sessions.set(sessionId, state);

    res.json({
      answer,
      goal: state.goal,
      mode: state.mode,
      sessionId,
    });
  } catch (err) {
    console.error("❌ /ask error:", err);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// 🧹 Optional route for inspecting active sessions
app.get("/sessions", (req, res) => {
  const info = Array.from(sessions.entries()).map(([id, s]) => ({
    sessionId: id,
    goal: s.goal,
    logs: s.logs.slice(-3),
    createdAt: new Date(s.createdAt).toLocaleString(),
  }));
  res.json({ activeSessions: info });
});

// =================== START SERVER ===================
app.listen(port, () => {
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`);
});
