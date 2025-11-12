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
app.post("/ask", async (req, res) => {
  try {
    const { question, workflowSummary, builderState: clientBuilder } = req.body;
    if (!question) return res.status(400).json({ error: "No question provided" });

    // 🔍 Determine Builder Mode
    let builder =
      clientBuilder && clientBuilder.active
        ? clientBuilder
        : (() => {
            const q = (question || "").trim();
            const m = q.match(/^@\s*build\s*(one|all)\b/i);
            if (!m) return { active: false };
            const mode = m[1].toLowerCase() === "one" ? "one" : "all";
            const goal = q.replace(/^@\s*build\s*(one|all)\b/i, "").trim();
            return { active: true, mode, goal, step: mode === "one" ? 1 : 0 };
          })();

    const allNodes = await getAvailableNodes();
    const nodeNames = getNodeNames(allNodes);

    // ===========================================================
    // 🧩 BUILDER MODE
    // ===========================================================
    if (builder.active) {
      logBlock("🐶 Builder Mode", JSON.stringify(builder, null, 2));

      // ===========================================================
      // 🧠 Detect Intent (Continue / Change Logic / New Topic)
      // ===========================================================
      const intentPrompt = `
You are Doggy AI Buddy 🐶.
Given the user's latest message and current workflow goal, classify the intent.

User's message:
"${question}"

Current goal:
"${builder.goal}"

Possible intents:
1️⃣ CONTINUE — the user wants to continue building the next step.
2️⃣ CHANGE_LOGIC — the user is modifying or refining part of the workflow logic (may affect previous or future steps).
3️⃣ NEW_TOPIC — the user has started an unrelated query (exit builder mode).

Return only one of these exact words: CONTINUE, CHANGE_LOGIC, or NEW_TOPIC.
`.trim();

      let userIntent = "CONTINUE";
      try {
        const intentResponse = await queryGemini("gemini-2.5-flash", intentPrompt, []);
        const rawIntent =
          intentResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toUpperCase() || "";
        if (["CONTINUE", "CHANGE_LOGIC", "NEW_TOPIC"].includes(rawIntent)) {
          userIntent = rawIntent;
        }
      } catch (err) {
        console.warn("⚠️ Intent detection failed:", err.message);
      }

      if (userIntent === "NEW_TOPIC") {
        builder = { active: false };
        return res.json({
          answer: "🐾 Looks like we switched topics — builder mode ended.",
          builderState: builder,
        });
      }

      // ===========================================================
      // 🔁 Logic Change Detected — Auto Revision
      // ===========================================================
      if (userIntent === "CHANGE_LOGIC") {
        console.log("🔁 LLM detected workflow logic change — revising sequence dynamically...");
        builder.goal = `${builder.goal} (updated by user: ${question})`;
        builder.reviseLast = true;

        const revisionPrompt = `
You are Doggy AI Buddy 🐶.
The user changed their workflow logic.

Current node sequence: ${builder.geminiPickedNames?.join(" → ") || "None"}
New message: "${question}"

Decide which steps should be revised, replaced, or kept as-is.
Return a JSON object like:
{
  "revise": [indices of steps to regenerate],
  "keep": [indices of steps to keep]
}
`.trim();

        try {
          const revRes = await queryGemini("gemini-2.5-flash", revisionPrompt, []);
          let text = revRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";

          text = text
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .replace(/^[^{]*({[\s\S]*})[^}]*$/m, "$1")
            .trim();

          builder.revisionPlan = JSON.parse(text);
          console.log("🔧 Revision plan:", builder.revisionPlan);
        } catch (err) {
          console.warn("⚠️ Could not get revision plan:", err.message);
          builder.revisionPlan = null;
        }

        // 🐾 Auto-apply first revision immediately
        if (builder.revisionPlan?.revise?.length) {
          const nextReviseIndex = builder.revisionPlan.revise[0];
          builder.currentNodeIndex = nextReviseIndex;
          builder.reviseNow = true;
          return res.json({
            answer: `🐾 Got it! Updating your workflow logic — revising Step ${nextReviseIndex + 1} now 🧠`,
            builderState: builder,
            autoContinue: true,
          });
        }

        return res.json({
          answer: "🐾 Got it! Updating your workflow logic as per your change — revising relevant steps 🧠",
          builderState: builder,
        });
      }

      // ===========================================================
      // 🧭 Continue Normal Step Flow
      // ===========================================================
      const isNext = /\b(next|what.?next|continue|go on|proceed)\b/i.test(question);
      if (builder.mode === "one" && builder.geminiPickedNames && isNext) {
        builder.currentNodeIndex = (builder.currentNodeIndex || 0) + 1;
        if (builder.currentNodeIndex >= builder.geminiPickedNames.length) {
          return res.json({ answer: "🎉 Workflow logic complete! Nothing left to build 🐾" });
        }
      }

      // --- Node selection / allowed ops / prompt building ---
      const pickPrompt = `
You are Doggy AI Buddy 🐶.
User goal: ${builder.goal || question}

Here is the list of available node NAMES:
${nodeNames.join(", ")}

Pick the most relevant 1–3 node names from the list.
If user asked to build ALL, respond "ALL".
If none match, respond "None".
Return only comma-separated names.
`.trim();

      if (!builder.geminiPickedNames) {
        const pickResponse = await queryGemini("gemini-2.5-flash", pickPrompt, []);
        const pickedText =
          pickResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "None";
        const geminiPickedNames = pickedText.split(",").map((s) => s.trim()).filter(Boolean);
        builder.geminiPickedNames = geminiPickedNames;
        builder.currentNodeIndex = 0;
      }

      const currentNodeName = builder.geminiPickedNames[builder.currentNodeIndex];
      let selectedNodes = allNodes.filter(
        (n) => normalize(n.displayName || n.name) === normalize(currentNodeName)
      );
      if (!selectedNodes.length && builder.geminiPickedNames.length) {
        selectedNodes = allNodes.filter((n) =>
          normalize(n.displayName || n.name).includes(normalize(currentNodeName))
        );
      }

      const allowedOps = formatAllowedOps(selectedNodes);
      const allowedOpsSet = collectAllowedOps(selectedNodes);
      const fieldSummary = selectedNodes.map((n) => ({
        name: n.displayName,
        fields: (n.fields || n.properties || []).map((f) => ({
          name: f.displayName,
          type: f.type,
          desc: f.description,
          default: f.default || null,
        })),
      }));

      const builderPrompt =
        builder.mode === "one"
          ? `
You are Doggy AI Buddy 🐶.
Builder step-by-step mode is active.

User goal: ${builder.goal || question}
Current Step: ${builder.currentNodeIndex + 1}
Current Node: ${currentNodeName}

Allowed operations:
${allowedOps}

Field summary for these nodes:
${JSON.stringify(fieldSummary, null, 2)}

Important: Always follow the sequence of Gemini’s selected nodes (${builder.geminiPickedNames.join(
          " → "
        )})
Do not restart or reorder nodes. Only build the current one.

Now generate your response EXACTLY in this format:

Here's your workflow plan 🐶:

───────────────────────────────
🐾 Step ${builder.currentNodeIndex + 1}: <Friendly Node Name>

🏷️ Node Name:
<Exact node name>

🔧 Node Type:
<Node type from available list>

🎯 Action/Operation:
<Exact operation or trigger name>

📝 Fields to Fill:
- <field> → <value or {{mapping}}>

⚙️ Options:
- <option> → <description or value>

🔑 Credentials:
- Type: <OAuth2 / API key / webhook>
- Docs: <valid URL>

🧪 Test Tip:
<Simple test instruction>

───────────────────────────────
`.trim()
          : `
You are Doggy AI Buddy 🐶.
Builder ALL-STEPS mode is active.

User goal: ${builder.goal || question}

Allowed operations:
${allowedOps}

Field summary for these nodes:
${JSON.stringify(fieldSummary, null, 2)}

Follow Gemini’s selected node sequence: ${builder.geminiPickedNames.join(" → ")}.

Generate your response EXACTLY in this friendly visual format — just like the step-by-step mode, but include *all steps* in one message.

Here's your workflow plan 🐶:

───────────────────────────────
🐾 Step {n}: <Friendly Node Name>
🏷️ Node Name:
<Exact node name>
...
───────────────────────────────
`.trim();

      const geminiResponse = await queryGemini("gemini-2.5-flash", builderPrompt, []);
      let answer = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      answer = answer.replace(/\*\*/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").replace(/─{10,}/g, "───────────────────────────────");
      if (!answer || answer.length < 5) answer = "Woof! I couldn’t find a direct match 🐾";

      const { nodeLine, opLine } = extractChosenNodeAndOperation(answer);
      if (opLine && !allowedOpsSet.has(normalize(opLine))) {
        console.warn("⚠️ Operation not found in allowed list!");
        answer += "\n\n⚠️ Note: Doggie ignored invalid operation suggestion.";
      }

      return res.json({
        answer,
        builderMode: builder.mode,
        chosenNodes: selectedNodes.map((n) => n.displayName || n.name),
        chosenOperation: opLine || null,
        builderState: builder,
      });
    }

    // ===========================================================
    // 💬 NORMAL CHAT MODE
    // ===========================================================
    const prompt = `
You are Doggy AI Buddy 🐶.
User: ${question}

Workflow summary:
${workflowSummary || "None"}

Answer concisely, grounded ONLY on available node JSON.
Never hallucinate or invent fields.
`.trim();

    const geminiResponse = await queryGemini("gemini-2.5-flash", prompt, []);
    let answer = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    if (!answer || answer.length < 5)
      answer = "Woof! I didn’t find that, but I’ll guide you based on node data 🐾";

    res.json({ answer, mode: "normal" });
  } catch (err) {
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// ===============================================================
// 🚀 Start Server
// ===============================================================
app.listen(port, () => {
  console.log(`🐶 Doggy AI Buddy backend running (No DOM, Clean Visual Output) at http://localhost:${port}`);
});
