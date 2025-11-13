console.log("Doggy AI Buddy content script loaded");

(async () => {
  const { createChatUI, displayMessage } = await import(
    chrome.runtime.getURL("src/chatUI.js")
  );
  const { initializeInputListeners, getDOMSnapshot } = await import(
    chrome.runtime.getURL("src/domWatcher.js")
  );
  const { makeDraggable } = await import(
    chrome.runtime.getURL("src/dragHandler.js")
  );

  const { chatBox } = createChatUI();
  const chatContainer = chatBox.querySelector("#chatContainer");
  const input = chatBox.querySelector("#userQuestion");
  const askBtn = chatBox.querySelector("#askBtn");
  const dragHandle = chatBox.querySelector("#drag-handle");

  makeDraggable(chatBox, dragHandle);

  const conversationHistory = [];
  let builderState = { active: false, mode: null, goal: "", step: 0, lastWorkflowId: null };

  // ===============================================================
  // 🧠 Basic Helpers
  // ===============================================================
  function getWorkflowContextFromUrl() {
    const url = new URL(window.location.href);
    const parts = url.pathname.split("/");
    const workflowId = parts.includes("workflow") ? parts.pop() : null;
    const baseUrl = `${url.protocol}//${url.host}`;
    return { workflowId, baseUrl };
  }

  async function fetchApiKey() {
    return await new Promise((resolve) => {
      chrome.storage.local.get("n8n", (result) => resolve(result["n8n"]));
    });
  }

  async function fetchWorkflowSummary(workflowId, baseUrl) {
    const apiKey = await fetchApiKey();
    if (!workflowId || !apiKey) return "";

    try {
      const res = await fetch("http://localhost:4000/summarizeWorkflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, baseUrl, apiKey }),
      });
      if (!res.ok) return "";
      const data = await res.json();
      return data.summary || "";
    } catch {
      return "";
    }
  }

  async function fetchNodeDetails(workflowId, baseUrl, nodeName) {
    const apiKey = await fetchApiKey();
    if (!workflowId || !apiKey || !nodeName) return null;

    try {
      const res = await fetch("http://localhost:4000/getNodeDetails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, baseUrl, apiKey, nodeName }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.node || null;
    } catch {
      return null;
    }
  }

  // ===============================================================
  // ⭐ sendToDoggy: Always sends fresh workflowSummary + snapshot
  // ===============================================================
  async function sendToDoggy(question, nodeDetails = null) {
    const snapshot = getDOMSnapshot();
    const { workflowId, baseUrl } = getWorkflowContextFromUrl();
    const apiKey = await fetchApiKey();

    // ALWAYS REFRESH WORKFLOW SUMMARY (fixes your bug)
    const workflowSummary = await fetchWorkflowSummary(workflowId, baseUrl);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "PROCESS_WITH_LLM",
          question,
          snapshot,
          history: conversationHistory,
          workflowId,
          baseUrl,
          apiKey,
          workflowSummary,
          nodeDetails,
          builderState
        },
        async (llmResponse) => {
          chatContainer.removeChild(chatContainer.lastChild);

          if (chrome.runtime.lastError) {
            displayMessage(chatBox, "ai", "Doggy got disconnected 🐾. Reload extension.");
            return resolve(null);
          }

          // Show LLM response
          displayMessage(chatBox, "ai", llmResponse?.answer || "Doggy is confused 🐾");

          // Update history
          conversationHistory.push({
            role: "model",
            parts: [{ text: llmResponse.answer }],
          });

          // Update builder state
          if (llmResponse.builderState) {
            builderState = llmResponse.builderState;
            console.log("🐾 Updated builder state:", builderState);
          }

          // Auto-continue (revision fix)
          if (llmResponse.autoContinue && builderState.active) {
            console.log("🐶 Auto-continuing...");
            await sendToDoggy("next");
          }

          resolve(llmResponse.answer);
        }
      );
    });
  }

  // ===============================================================
  // 🧠 MAIN CHAT HANDLER
  // ===============================================================
  askBtn.addEventListener("click", async () => {
    const question = input.value.trim();
    if (!question) return;

    displayMessage(chatBox, "user", question);
    input.value = "";

    conversationHistory.push({ role: "user", parts: [{ text: question }] });
    displayMessage(chatBox, "ai", "Thinking...");

    const { workflowId } = getWorkflowContextFromUrl();

    // Auto-reset builder if workflow changed
    if (builderState.active && workflowId !== builderState.lastWorkflowId) {
      builderState = { active: false, mode: null, goal: "", step: 0, lastWorkflowId: workflowId };
      displayMessage(chatBox, "ai", "🐾 Builder reset (new workflow detected).");
    }

    builderState.lastWorkflowId = workflowId;

    // ===============================================================
    // 🏗️ Builder Entry Commands
    // ===============================================================
    const qLower = question.toLowerCase();

    if (qLower.startsWith("@buildone")) {
      builderState = {
        active: true,
        mode: "one",
        goal: question.replace(/@buildone/i, "").trim(),
        step: 1,
        lastWorkflowId: workflowId,
      };
      return await sendToDoggy(question);
    }

    if (qLower.startsWith("@buildall")) {
      builderState = {
        active: true,
        mode: "all",
        goal: question.replace(/@buildall/i, "").trim(),
        step: 0,
        lastWorkflowId: workflowId,
      };
      return await sendToDoggy(question);
    }

    // ===============================================================
    // 🐾 Builder "next"
    // ===============================================================
    if (builderState.active && builderState.mode === "one" && /^(next|continue|go on)$/i.test(qLower)) {
      return await sendToDoggy("next");
    }

    // Stop command
    if (qLower === "stop") {
      builderState = { active: false, mode: null, goal: "", step: 0, lastWorkflowId: workflowId };
      displayMessage(chatBox, "ai", "🐾 Builder stopped.");
      return;
    }

    // ===============================================================
    // ⭐ Mid-conversation logic change? → Fetch node details
    // ===============================================================
    let autoNodeDetails = null;

    if (builderState.active) {
      // Try to detect what node this question refers to (implicit)
      const knownNodes = ["google", "sheet", "openai", "discord", "telegram"];
      const detected = knownNodes.find((name) => question.toLowerCase().includes(name));
      if (detected) {
        autoNodeDetails = await fetchNodeDetails(workflowId, baseUrl, detected);
      }
    }

    // ===============================================================
    // 💬 Normal chat OR builder refinement
    // ===============================================================
    await sendToDoggy(question, autoNodeDetails);
  });

  window.addEventListener("load", () => {
    initializeInputListeners(document.querySelectorAll("input, textarea"));
  });
})();
