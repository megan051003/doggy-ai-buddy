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

  const { mascot, chatBox } = createChatUI();

  const chatContainer = chatBox.querySelector("#chatContainer");
  const input = chatBox.querySelector("#userQuestion");
  const askBtn = chatBox.querySelector("#askBtn");
  const dragHandle = chatBox.querySelector("#drag-handle");

  makeDraggable(chatBox, dragHandle);

  const conversationHistory = [];
  let builderState = { active: false, mode: null, goal: "", step: 0, lastWorkflowId: null };

  function getWorkflowContextFromUrl() {
    const url = new URL(window.location.href);
    const parts = url.pathname.split("/");
    const workflowId = parts.includes("workflow") ? parts.pop() : null;
    const baseUrl = `${url.protocol}//${url.host}`;
    return { workflowId, baseUrl };
  }

  async function fetchWorkflowSummary(workflowId, baseUrl) {
    const apiKey = await new Promise((resolve) => {
      chrome.storage.local.get("n8n", (result) => resolve(result["n8n"]));
    });

    if (!workflowId || !apiKey) return null;

    try {
      const res = await fetch("http://localhost:4000/summarizeWorkflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, baseUrl, apiKey }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.summary || null;
    } catch (err) {
      console.error("❌ Failed to fetch workflow summary:", err);
      return null;
    }
  }

  async function fetchNodeDetails(workflowId, baseUrl, apiKey, nodeName) {
    try {
      const res = await fetch("http://localhost:4000/getNodeDetails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, baseUrl, apiKey, nodeName }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.node || null;
    } catch (err) {
      console.error("❌ Failed to fetch node details:", err);
      return null;
    }
  }

  // ===============================================================
  // 🐾 Send Message to Doggy Backend (via background.js)
  // ===============================================================
  async function sendToDoggy(
    question,
    snapshot,
    workflowId,
    baseUrl,
    apiKey,
    workflowSummary,
    nodeDetails
  ) {
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
          builderState, // 🧠 pass local builder state
        },
        (llmResponse) => {
          chatContainer.removeChild(chatContainer.lastChild);

          if (chrome.runtime.lastError) {
            console.error("❌ SendMessage failed:", chrome.runtime.lastError.message);
            displayMessage(chatBox, "ai", "Doggy got disconnected 🐾 (please reload extension).");
            return resolve(null);
          }

          if (llmResponse?.answer && llmResponse.answer.trim()) {
            conversationHistory.push({
              role: "model",
              parts: [{ text: llmResponse.answer }],
            });
            displayMessage(chatBox, "ai", llmResponse.answer);

            // 🧠 Update builder state from backend if returned
            if (llmResponse.builderState) {
              builderState = llmResponse.builderState;
              console.log("🐾 Updated builder state in content.js:", builderState);
            }

            resolve(llmResponse.answer);
          } else {
            displayMessage(chatBox, "ai", llmResponse?.error || "Doggy didn’t know what to say 🐾");
            resolve(null);
          }
        }
      );
    });
  }

  // ===============================================================
  // 🧠 Chat Input Handler
  // ===============================================================
  askBtn.addEventListener("click", async () => {
    const raw = input.value;
    const question = raw.trim();
    if (!question) return;

    displayMessage(chatBox, "user", question);
    input.value = "";
    conversationHistory.push({ role: "user", parts: [{ text: question }] });
    displayMessage(chatBox, "ai", "Thinking...");

    const snapshot = getDOMSnapshot();
    const { workflowId, baseUrl } = getWorkflowContextFromUrl();
    const apiKey = await new Promise((resolve) => {
      chrome.storage.local.get("n8n", (result) => resolve(result["n8n"]));
    });
    const workflowSummary = await fetchWorkflowSummary(workflowId, baseUrl);

    // 🐶 Auto-reset builder if workflow changed
    if (builderState.active && workflowId !== builderState.lastWorkflowId) {
      builderState = { active: false, mode: null, goal: "", step: 0, lastWorkflowId: workflowId };
      displayMessage(chatBox, "ai", "🐾 Builder reset (new workflow detected).");
    }
    builderState.lastWorkflowId = workflowId;

    let nodeDetails = null;
    const nodeMatch = question.match(/(?:^|\s)node\s+(.+)/i);
    if (nodeMatch) {
      const nodeName = nodeMatch[1].trim();
      nodeDetails = await fetchNodeDetails(workflowId, baseUrl, apiKey, nodeName);
    }

    // ===============================================================
    // 🏗️ Builder Mode Controls
    // ===============================================================
    const qLower = question.toLowerCase();

    // 🐾 @buildone
    if (qLower.startsWith("@buildone")) {
      builderState = {
        active: true,
        mode: "one",
        goal: question.replace(/@buildone/i, "").trim(),
        step: 1,
        lastWorkflowId: workflowId,
      };
      await sendToDoggy(
        question, // send full question, not "Builder: step 1"
        snapshot,
        workflowId,
        baseUrl,
        apiKey,
        workflowSummary,
        nodeDetails
      );
      return;
    }

    // 🐾 @buildall
    if (qLower.startsWith("@buildall")) {
      builderState = {
        active: true,
        mode: "all",
        goal: question.replace(/@buildall/i, "").trim(),
        step: 0,
        lastWorkflowId: workflowId,
      };
      await sendToDoggy(
        question,
        snapshot,
        workflowId,
        baseUrl,
        apiKey,
        workflowSummary,
        nodeDetails
      );
      return;
    }

    // 🐾 Next step
    if (builderState.active && builderState.mode === "one" && /^(next|continue|go on)$/i.test(qLower)) {
      await sendToDoggy(
        "next", // explicitly tell backend to move to next node
        snapshot,
        workflowId,
        baseUrl,
        apiKey,
        workflowSummary,
        nodeDetails
      );
      return;
    }

    // 🐾 Stop building
    if (qLower === "stop") {
      builderState = { active: false, mode: null, goal: "", step: 0, lastWorkflowId: workflowId };
      displayMessage(chatBox, "ai", "🐾 Builder stopped and reset.");
      console.log("🐶 Builder stopped and reset");
      return;
    }

    // 🧠 Normal chat mode
    await sendToDoggy(
      question,
      snapshot,
      workflowId,
      baseUrl,
      apiKey,
      workflowSummary,
      nodeDetails
    );
  });

  // ===============================================================
  // 🪟 DOM Event Setup
  // ===============================================================
  window.addEventListener("load", () => {
    initializeInputListeners(document.querySelectorAll("input, textarea"));
  });
})();
