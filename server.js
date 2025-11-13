/*******************************************************************************
 * Doggy AI Buddy 🐶 Backend Server
 * Clean Visual Output + No DOM + No Hardcoding
 *******************************************************************************/

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ===============================================================
// 🧠 App Setup
// ===============================================================
const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: "3mb" }));

// ===============================================================
// 🌍 Global Config
// ===============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodesPath = path.join(__dirname, "active_nodes_summary.json");

// ===============================================================
// 🧠 NEW: Builder Sessions Memory
// ===============================================================
const builderSessions = {}; // { userId: { mode, goal, step, nodes: [] } }

// ===============================================================
// ⚙️ Helper Functions
// ===============================================================
function sanitizeError(msg) {
  if (!msg) return null;
  return msg.replace(/(key|token|secret|password)[^\s]*/gi, "[REDACTED]");
}

async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function getNodeNames(nodes) {
  return nodes.map((n) => n.displayName || n.name).filter(Boolean);
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function logBlock(title, content) {
  console.log(`\n==== ${title} ====\n${content}\n=============================\n`);
}

function formatAllowedOps(nodes) {
  if (!nodes?.length) return "None";
  return nodes
    .map((n) => {
      const name = n.displayName || n.name;
      const pieces = [`Node: ${name}`];
      if (Array.isArray(n.triggers) && n.triggers.length) {
        pieces.push("  Triggers:");
        for (const t of n.triggers)
          pieces.push(`   - ${t.displayName || t.action || t.value} (internal: ${t.value})`);
      }
      if (Array.isArray(n.actions) && n.actions.length) {
        pieces.push("  Actions:");
        for (const a of n.actions)
          pieces.push(`   - ${a.displayName || a.action || a.name} (internal: ${a.value})`);
      }
      return pieces.join("\n");
    })
    .join("\n\n");
}

function extractChosenNodeAndOperation(answer) {
  if (!answer) return { nodeLine: null, opLine: null };
  const nodeMatch = answer.match(/^\s*2\.\s*🔧\s*Node type:\s*(.+)$/im);
  const opMatch = answer.match(/^\s*3\.\s*🎯\s*Action\/Operation:\s*(.+)$/im);
  return {
    nodeLine: nodeMatch ? nodeMatch[1].trim() : null,
    opLine: opMatch ? opMatch[1].trim() : null,
  };
}

function collectAllowedOps(selectedNodes) {
  const ops = new Set();
  for (const n of selectedNodes) {
    if (Array.isArray(n.actions)) {
      for (const a of n.actions) {
        if (a.displayName) ops.add(normalize(a.displayName));
        if (a.value) ops.add(normalize(a.value));
      }
    }
    if (Array.isArray(n.triggers)) {
      for (const t of n.triggers) {
        if (t.displayName) ops.add(normalize(t.displayName));
        if (t.value) ops.add(normalize(t.value));
      }
    }
  }
  return ops;
}

// ===============================================================
// 🧠 Gemini Helper
// ===============================================================
async function queryGemini(model, promptText, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contents = [...(history || []), { role: "user", parts: [{ text: promptText }] }];

  logBlock("PROMPT SENT TO GEMINI", promptText);

  for (let attempt = 1; attempt <= 3; attempt++) {
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
        throw new Error(`Gemini API error (attempt ${attempt}): ${JSON.stringify(err)}`);
      }

      const data = await response.json();
      logBlock("🧠 Gemini Raw Response", JSON.stringify(data, null, 2));
      return data;
    } catch (err) {
      console.warn(`⚠️ Gemini request failed (attempt ${attempt}):`, err.message);
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// ===============================================================
// 🐾 MAIN ROUTE: /ask
// ===============================================================
// ===============================================================
// 🐾 MAIN ROUTE: /ask (UPDATED — STABLE BUILDER + LOGIC CHANGE)
// ===============================================================
app.post("/ask", async (req, res) => {
  try {
    const {
      question,
      workflowSummary,
      nodeDetails,
      builderState: clientBuilder,
      history
    } = req.body;

    if (!question)
      return res.status(400).json({ error: "No question provided" });

    const allNodes = await getAvailableNodes();
    const nodeNames = getNodeNames(allNodes);
    const qLower = question.toLowerCase();

    // ===============================================================
    // 🔍 Reconstruct builder from client
    // ===============================================================
    let builder = clientBuilder?.active
      ? { ...clientBuilder }
      : (() => {
          const match = question.match(/^@\s*build\s*(one|all)\b/i);
          if (!match) return { active: false };

          const mode = match[1].toLowerCase() === "one" ? "one" : "all";
          const goal = question.replace(/^@\s*build\s*(one|all)\b/i, "").trim();

          return {
            active: true,
            mode,
            goal,
            step: mode === "one" ? 1 : 0,
            currentNodeIndex: 0,
            geminiPickedNames: null
          };
        })();

    const isBuilder = builder.active;

    // ===============================================================
    // 🛑 If user typed @stop or changed topic
    // ===============================================================
    if (qLower === "stop") {
      builder = { active: false };
      return res.json({
        answer: "🐾 Builder stopped.",
        builderState: builder
      });
    }

    // User changed topic during builder
    if (
      isBuilder &&
      !qLower.includes("next") &&
      !qLower.includes("@build") &&
      !qLower.includes("instead") &&
      !question.toLowerCase().includes("change") &&
      !question.toLowerCase().includes("modify") &&
      !question.toLowerCase().includes("use") &&
      !builder.goal.toLowerCase().includes(question.toLowerCase())
    ) {
      // If the question is totally unrelated → exit builder
      const unrelated = `
You are an intent classifier.
Message: "${question}"
Goal: "${builder.goal}"

Say ONLY "OTHER" if the message is unrelated.
Say ONLY "RELATED" if it is still about the same workflow.
`;

      let decision = "RELATED";
      try {
        const intentRes = await queryGemini("gemini-2.5-flash", unrelated, []);
        const raw =
          intentRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (raw.toUpperCase() === "OTHER") decision = "OTHER";
      } catch {}

      if (decision === "OTHER") {
        builder = { active: false };
        return res.json({
          answer: "🐾 Switching topics — builder turned off.",
          builderState: builder
        });
      }
    }

    // ===============================================================
    // 🧠 Builder Intent Classification (Continue / Change Logic)
    // ===============================================================
    let userIntent = "CONTINUE";

    if (isBuilder) {
      const intentPrompt = `
Classify the user's intent.

Message: "${question}"
Workflow Goal: "${builder.goal}"

Return ONLY one word:
CONTINUE — user wants next step
CHANGE_LOGIC — user modifies the workflow logic
`.trim();

      try {
        const out = await queryGemini("gemini-2.5-flash", intentPrompt, []);
        const raw =
          out?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toUpperCase() ||
          "";
        if (["CONTINUE", "CHANGE_LOGIC"].includes(raw)) {
          userIntent = raw;
        }
      } catch {}
    }

    // ===============================================================
    // 🔁 LOGIC CHANGE: mid-build changes (e.g., Discord → Telegram)
    // ===============================================================
    if (isBuilder && userIntent === "CHANGE_LOGIC") {
      builder.goal = `${builder.goal} (logic changed: ${question})`;

      const revisionPrompt = `
The user changed the workflow logic.

Original node sequence:
${builder.geminiPickedNames?.join(" → ") || "None"}

User message:
"${question}"

Return ONLY JSON:
{
  "revise": [indices],
  "keep": [indices]
}
`.trim();

      let plan = { revise: [], keep: [] };

      try {
        const revRes = await queryGemini("gemini-2.5-flash", revisionPrompt, []);
        let txt =
          revRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
        txt = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
        plan = JSON.parse(txt);
      } catch {}

      builder.revisionPlan = plan;

      if (plan.revise?.length) {
        const idx = plan.revise[0];
        builder.currentNodeIndex = idx;
        builder.reviseNow = true;

        return res.json({
          answer: `🐾 Updating workflow logic — revising Step ${idx + 1} 🧠`,
          builderState: builder,
          autoContinue: true
        });
      }

      return res.json({
        answer: "🐾 Workflow logic updated.",
        builderState: builder
      });
    }

    // ===============================================================
    // 🧭 Continue NEXT step
    // ===============================================================
    const wantsNext = /\b(next|continue|go on|proceed)\b/i.test(question);

    if (isBuilder && builder.mode === "one" && wantsNext && !builder.reviseNow) {
      builder.currentNodeIndex = (builder.currentNodeIndex || 0) + 1;

      // finished all steps
      if (
        builder.geminiPickedNames &&
        builder.currentNodeIndex >= builder.geminiPickedNames.length
      ) {
        builder.active = false;
        return res.json({
          answer: "🎉 All steps completed!",
          builderState: builder
        });
      }
    }

    // ===============================================================
    // 🧩 PICK NODES (One time only)
    // ===============================================================
    if (isBuilder && !builder.geminiPickedNames) {
      const pickPrompt = `
User goal: ${builder.goal}

Available node names:
${nodeNames.join(", ")}

Pick the node sequence.
Return ONLY comma-separated node names.
`.trim();

      const pickRes = await queryGemini("gemini-2.5-flash", pickPrompt, []);
      const picked =
        pickRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      builder.geminiPickedNames = picked
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      builder.currentNodeIndex = 0;
    }

    // ===============================================================
    // 🏗️ BUILD THE CURRENT STEP
    // ===============================================================
    if (isBuilder) {
      const currentNode = builder.geminiPickedNames[builder.currentNodeIndex];

      // Select definitions for node
      let selected = allNodes.filter(
        (n) => normalize(n.displayName || n.name) === normalize(currentNode)
      );
      if (!selected.length) {
        selected = allNodes.filter((n) =>
          normalize(n.displayName || n.name).includes(normalize(currentNode))
        );
      }

      const allowedOps = formatAllowedOps(selected);
      const fields = selected.map((n) => ({
        name: n.displayName,
        fields: (n.fields || []).map((f) => ({
          name: f.displayName,
          type: f.type,
          desc: f.description
        }))
      }));

      const builderPrompt = `
You are Doggy AI Buddy 🐶.
Build step ${builder.currentNodeIndex + 1} for goal: ${builder.goal}

Node: ${currentNode}

Allowed operations:
${allowedOps}

Node fields:
${JSON.stringify(fields, null, 2)}

Generate EXACT format:

Here's your workflow plan 🐶:
───────────────────────────────
🐾 Step X: <Friendly Node>

🏷️ Node Name:
<exact>

🔧 Node Type:
<exact>

🎯 Action/Operation:
<exact>

📝 Fields to Fill:
- field → value

───────────────────────────────
`.trim();

      const stepRes = await queryGemini("gemini-2.5-flash", builderPrompt, history);
      let answer =
        stepRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

      answer = answer
        .replace(/\*\*/g, "")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n");

      builder.reviseNow = false;

      return res.json({
        answer,
        builderState: builder
      });
    }

    // ===============================================================
    // 💬 NORMAL CHAT MODE
    // ===============================================================
    const prompt = `
You are Doggy AI Buddy 🐶.
User: ${question}

Workflow summary:
${workflowSummary || "None"}

Be factual and concise.
`.trim();

    const resp = await queryGemini("gemini-2.5-flash", prompt, history);
    let answer =
      resp?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Woof! I’m not sure.";

    return res.json({
      answer,
      builderState: builder
    });

  } catch (err) {
    return res.status(500).json({
      error: sanitizeError(err.message)
    });
  }
});


// ===============================================================
// 🚀 Start Server
// ===============================================================
app.listen(port, () => {
  console.log(`🐶 Doggy AI Buddy backend running (No DOM, Clean Visual Output) at http://localhost:${port}`);
});
