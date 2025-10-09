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
const USE_DOM_CONTEXT = true;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodesPath = path.join(__dirname, "active_nodes_summary.json");

// ================== HELPERS ==================
function sanitizeError(msg) {
  if (!msg) return null;
  return msg.replace(/(key|token|secret|password)[^\s]*/gi, "[REDACTED]");
}

async function getAvailableNodes() {
  try {
    const data = await fs.readFile(nodesPath, "utf8");
    const parsed = JSON.parse(data);
    // Filter hidden or deprecated
    return parsed.filter((n) => !n.hidden && !n.deprecated);
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

function heuristicPickNodes(question, allNodes) {
  const picks = new Set();
  const q = normalize(question);
  if (/twitter|x\b|tweet/.test(q))
    allNodes.forEach((n) => n.displayName?.toLowerCase().includes("twitter") && picks.add(n.displayName));
  if (/slack/.test(q))
    allNodes.forEach((n) => n.displayName?.toLowerCase().includes("slack") && picks.add(n.displayName));
  if (/telegram/.test(q))
    allNodes.forEach((n) => n.displayName?.toLowerCase().includes("telegram") && picks.add(n.displayName));
  if (/http request|api call|rest|endpoint/.test(q))
    allNodes.forEach((n) => n.displayName?.toLowerCase().includes("http request") && picks.add(n.displayName));
  if (/reddit/.test(q))
    allNodes.forEach((n) => n.displayName?.toLowerCase().includes("reddit") && picks.add(n.displayName));
  return Array.from(picks);
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
    if (Array.isArray(n.actions))
      for (const a of n.actions) {
        if (a.displayName) ops.add(normalize(a.displayName));
        if (a.value) ops.add(normalize(a.value));
      }
    if (Array.isArray(n.triggers))
      for (const t of n.triggers) {
        if (t.displayName) ops.add(normalize(t.displayName));
        if (t.value) ops.add(normalize(t.value));
      }
  }
  return ops;
}

function getReasoningContext(context, selectedNodes, includeDom = true) {
  const domText =
    includeDom && context ? JSON.stringify(context).slice(0, 15000) : "";
  const jsonText = selectedNodes?.length
    ? JSON.stringify(selectedNodes, null, 2).slice(0, 10000)
    : "";

  const combined = `
🐶 Reasoning Context for Gemini
--------------------------------
${includeDom ? `1️⃣ DOM snapshot (truncated):\n${domText || "No DOM"}\n\n` : ""}
2️⃣ Node JSON metadata (truncated):
${jsonText || "No node JSON data"}

Rules for reasoning:
- Use parameters and actions visible in JSON only.
- Never invent or assume extra fields.
--------------------------------
`;
  logBlock("👁️ Context Sent to Gemini", combined);
  return combined;
}

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

// ================== MAIN BRAIN ==================
app.post("/ask", async (req, res) => {
  try {
    const { question, context, workflowSummary, builderState: clientBuilder } = req.body;
    if (!question) return res.status(400).json({ error: "No question provided" });

    // Infer builder mode
    let builder = clientBuilder && clientBuilder.active
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

    // ========== BUILDER MODE ==========
    if (builder.active) {
      logBlock("🐶 Builder Mode", JSON.stringify(builder, null, 2));

      const pickPrompt = `
You are Doggy AI Buddy 🐶.
User goal: ${builder.goal || question}

List of AVAILABLE node names:
${nodeNames.join(", ")}

Pick only relevant nodes from this list.
Never include nodes not in JSON.
Return comma-separated names or "ALL".
`.trim();

      const pickResponse = await queryGemini("gemini-2.5-flash", pickPrompt, []);
      const pickedText = pickResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "None";
      let geminiPickedNames =
        pickedText === "ALL" ? nodeNames : pickedText.split(",").map((s) => s.trim());
      const heuristicPicks = heuristicPickNodes(builder.goal || question, allNodes);

      const selectedNamesSet = new Set([...geminiPickedNames, ...heuristicPicks].map(normalize));
      let selectedNodes = allNodes.filter((n) =>
        selectedNamesSet.has(normalize(n.displayName || n.name))
      );
      if (builder.mode === "one" && selectedNodes.length > 1)
        selectedNodes = [selectedNodes[0]];

      logBlock(
        "Phase A - Node Selection",
        JSON.stringify(
          {
            geminiPickedNames,
            heuristicPicks,
            finalSelectedNodes: selectedNodes.map((n) => n.displayName),
          },
          null,
          2
        )
      );

      const allowedOps = formatAllowedOps(selectedNodes);
      logBlock("Phase B - Allowed Operations", allowedOps);
      const allowedOpsSet = collectAllowedOps(selectedNodes);

      const validationContext = `
Validation Rules (from JSON)
--------------------------------------------
Available node types: ${allNodes.length}
Hidden/internal nodes excluded.
If a node or action isn't in JSON, reject it.
--------------------------------------------
`;

      // ❌ disable DOM here
      const reasoningContext = getReasoningContext(context, selectedNodes, false);

      // 🧠 Differentiate modes
      let builderPrompt;
      if (builder.mode === "one") {
        builderPrompt = `
You are Doggy AI Buddy 🐶.
Builder step-by-step mode is active.

User goal: ${builder.goal || question}
Current Step: ${builder.step}

${reasoningContext}
${validationContext}

Allowed operations:
${allowedOps}

Rules:
- Use only JSON fields.
- Never invent new ones.

Return:
1. 🏷️ Friendly node name:
2. 🔧 Node type:
3. 🎯 Action/Operation:
4. 📝 Fields to fill:
   - <field>: <value or {{mapping}}>
5. ⚙️ Available options:
   - <option>: <values>
6. 🔑 Credentials:
   - Type:
   - Docs:
7. 🧪 Quick test tip:
`;
      } else if (builder.mode === "all") {
        builderPrompt = `
You are Doggy AI Buddy 🐶.
Builder ALL-STEPS mode is active.

User goal: ${builder.goal || question}

${reasoningContext}
${validationContext}

Allowed operations:
${allowedOps}

Rules:
- Build the ENTIRE workflow from start to finish.
- Use ONLY nodes visible in JSON.
- Each node must logically connect to the next.
- Include configuration, mappings, credentials, and test tips.

Return in this format for EACH node:
----------------------------------
- 🏷️ Friendly node name:
- 🔧 Node type:
- 🎯 Action/Operation:
- 📝 Fields to fill:
   - <field>: <value or {{mapping}}>
- ⚙️ Available options:
   - <option>: <values>
- 🔑 Credentials:
   - Type:
   - Docs:
- 🧪 Quick test tip:
----------------------------------
`;
      }

      const geminiResponse = await queryGemini("gemini-2.5-flash", builderPrompt, []);
      let answer = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

      const { nodeLine, opLine } = extractChosenNodeAndOperation(answer);
      console.log("🤖 Gemini chose node:", nodeLine);
      console.log("🎯 Gemini chose operation:", opLine);
      console.log("🔍 Available operations were:", Array.from(allowedOpsSet));

      if (opLine && !allowedOpsSet.has(normalize(opLine))) {
        console.warn("⚠️ Operation not found in allowed list! Possible hallucination.");
        answer += "\n\n⚠️ Note: Doggie ignored invalid operation suggestion.";
      }

      return res.json({
        answer,
        builderMode: builder.mode,
        chosenNodes: selectedNodes.map((n) => n.displayName || n.name),
        chosenOperation: opLine || null,
      });
    }

    // ========== NORMAL CHAT ==========
    const reasoningContext = getReasoningContext(context, [], USE_DOM_CONTEXT);
    const prompt = `
You are Doggy AI Buddy 🐶.
User: ${question}

Workflow summary:
${workflowSummary || "None"}

${reasoningContext}

Answer concisely, grounded ONLY on visible JSON (and DOM if available).
`.trim();

    const geminiResponse = await queryGemini("gemini-2.5-flash", prompt, []);
    let answer = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    if (!answer || answer.length < 5)
      answer =
        "Woof! Based on the visible data, I can’t find that exactly — but I’ll guide you step-by-step using what’s visible 🐾";

    res.json({ answer, mode: "normal" });
  } catch (err) {
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// =================== START SERVER ===================
app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
