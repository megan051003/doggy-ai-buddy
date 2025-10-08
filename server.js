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

// --- heuristic for obvious services
function heuristicPickNodes(question, allNodes) {
  const picks = new Set();
  const wantTwitter = /\b(?:twitter|x\b|tweets?|timeline|retweet|tweet\.com)\b/i.test(question);
  const wantSlack = /\bslack\b/i.test(question);
  const wantTelegram = /\btelegram\b/i.test(question);
  const wantHttp = /\bhttp request|api call|rest|endpoint\b/i.test(question);

  allNodes.forEach((n) => {
    const dn = normalize(n.displayName || n.name);
    if (wantTwitter && dn.includes("twitter")) picks.add(dn);
    if (wantSlack && dn.includes("slack")) picks.add(dn);
    if (wantTelegram && dn.includes("telegram")) picks.add(dn);
    if (wantHttp && dn.includes("http request")) picks.add(dn);
  });
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

// 🧠 combine DOM + JSON context
function getReasoningContext(context, selectedNodes) {
  const domText = context ? JSON.stringify(context).slice(0, 15000) : "";
  const jsonText = selectedNodes?.length
    ? JSON.stringify(selectedNodes, null, 2).slice(0, 10000)
    : "";

  const combined = `
🐶 Reasoning Context for Gemini
--------------------------------
1️⃣ DOM snapshot (truncated to 15KB):
${domText || "No DOM context provided."}

2️⃣ Node JSON metadata (truncated to 10KB):
${jsonText || "No node JSON metadata provided."}

Rules for reasoning:
- Only use parameters, fields, or options visible in DOM or JSON.
- Never invent new ones.
- If a field like "oldest" is requested but doesn’t exist, use the closest valid alternative.
- Don’t ask the user to check manually; reason directly using these facts.
--------------------------------
`;
  logBlock("👁️ Context Sent to Gemini", combined);
  return combined;
}

// ================== LLM HELPER ==================
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

    // 🧠 Infer builder mode
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

    // =================== BUILDER MODE ===================
    if (builder.active) {
      logBlock("🐶 Builder Mode", JSON.stringify(builder, null, 2));

      // --- Phase A: Node Name Selection ---
      const pickPrompt = `
You are Doggy AI Buddy 🐶.
User goal: ${builder.goal || question}

Here is the list of available node NAMES:
${nodeNames.join(", ")}

Pick the most relevant 1–3 node names from the list.
If user asked to build ALL, respond "ALL".
If none match, respond "HTTP Request" if available, otherwise "None".
Return only comma-separated names.
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

      // --- Phase B: Allowed Operations ---
      const allowedOps = formatAllowedOps(selectedNodes);
      logBlock("Phase B - Allowed Operations", allowedOps);
      const allowedOpsSet = collectAllowedOps(selectedNodes);

      // 🧩 Field summary
      const fieldSummary = selectedNodes.map((n) => ({
        name: n.displayName,
        fields:
          n.properties?.map((f) => ({
            name: f.displayName,
            type: f.type,
            desc: f.description,
          })) || [],
      }));

      const reasoningContext = getReasoningContext(context, selectedNodes);

      // 🧠 Improved builder prompt (detailed per-node instructions)
      const builderPrompt =
        builder.mode === "one"
          ? `
You are Doggy AI Buddy 🐶.
Builder step-by-step mode is active.

User goal: ${builder.goal || question}
Current Step: ${builder.step}

${reasoningContext}

Allowed operations:
${allowedOps}

Field summary for these nodes:
${JSON.stringify(fieldSummary, null, 2)}

Now:
- Pick ONE node for this step.
- Describe it fully using visible fields and actions.
- Never say "add X node" generically — show exact setup.

Return in this format:
1. 🏷️ Friendly node name:
2. 🔧 Node type:
3. 🎯 Action/Operation: (must match from above)
4. 📝 Fields to fill:
   - <field>: <value or {{mapping}}>
5. ⚙️ Available options (from JSON):
   - <option>: <values or description>
6. 🔑 Credentials needed:
   - Type: <OAuth2 / API Key / Bearer ...>
   - Docs: <link>
7. 🧪 Quick test tip:
`.trim()
          : `
You are Doggy AI Buddy 🐶.
Builder ALL-STEPS mode is active.

User goal: ${builder.goal || question}

${reasoningContext}

Allowed operations:
${allowedOps}

Field summary for these nodes:
${JSON.stringify(fieldSummary, null, 2)}

Your job:
- Plan EVERY node needed to achieve the goal.
- Use real actions and fields from JSON only.
- Include configuration details and mappings.
- Never invent missing fields — choose closest valid alternative.

Return in this format for each node:
- 🏷️ Friendly node name:
- 🔧 Node type:
- 🎯 Action/Operation:
- 📝 Fields to fill:
   - <field>: <value or {{mapping}}>
- ⚙️ Available options (from JSON):
   - <option>: <values or description>
- 🔑 Credentials:
   - Type:
   - Docs:
- 🧪 Quick test tip:
`.trim();

      const geminiResponse = await queryGemini("gemini-2.5-flash", builderPrompt, []);
      let answer = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

      if (!answer || answer.length < 5)
        answer = "Woof! I checked your DOM and JSON — couldn’t find a direct match 🐾";

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

    // =================== NORMAL CHAT ===================
    const reasoningContext = getReasoningContext(context, []);
    const prompt = `
You are Doggy AI Buddy 🐶.
User: ${question}

Workflow summary:
${workflowSummary || "None"}

${reasoningContext}

Answer concisely, grounded ONLY on DOM and JSON above.
Never say you don't know; always reason based on visible or known data.
`.trim();

    const geminiResponse = await queryGemini("gemini-2.5-flash", prompt, []);
    let answer = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    if (!answer || answer.length < 5)
      answer =
        "Woof! Based on the visible DOM, I can’t find that exactly — but I’ll guide you step-by-step using what’s on screen 🐾";

    res.json({ answer, mode: "normal" });
  } catch (err) {
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// =================== START SERVER ===================
app.listen(port, () =>
  console.log(`🐶 Doggy AI Buddy backend running at http://localhost:${port}`)
);
