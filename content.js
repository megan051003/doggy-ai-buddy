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
  let builderState = { active: false, mode: null, goal: "", step: 0 }; // Builder state

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

  async function sendToDoggy(question, snapshot, workflowId, baseUrl, apiKey, workflowSummary, nodeDetails) {
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
          builderState, // include builder state
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
            resolve(llmResponse.answer);
          } else {
            displayMessage(chatBox, "ai", llmResponse?.error || "Doggy didn’t know what to say 🐾");
            resolve(null);
          }
        }
      );
    });
  }

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

    let nodeDetails = null;
    const nodeMatch = question.match(/(?:^|\s)node\s+(.+)/i);
    if (nodeMatch) {
      const nodeName = nodeMatch[1].trim();
      nodeDetails = await fetchNodeDetails(workflowId, baseUrl, apiKey, nodeName);
    }

    // Builder Mode Commands
    if (question.startsWith("@BuildOne")) {
      builderState = { active: true, mode: "one", goal: question.replace("@BuildOne", "").trim(), step: 1 };
      await sendToDoggy(`Builder: step 1`, snapshot, workflowId, baseUrl, apiKey, workflowSummary, nodeDetails);
      return;
    }

    if (question.startsWith("@BuildAll")) {
      builderState = { active: true, mode: "all", goal: question.replace("@BuildAll", "").trim(), step: 0 };
      await sendToDoggy(`Builder: all`, snapshot, workflowId, baseUrl, apiKey, workflowSummary, nodeDetails);
      return;
    }

    if (builderState.active && builderState.mode === "one" && question.toLowerCase() === "next") {
      builderState.step += 1;
      await sendToDoggy(`Builder: step ${builderState.step}`, snapshot, workflowId, baseUrl, apiKey, workflowSummary, nodeDetails);
      return;
    }

    if (question.toLowerCase() === "stop") {
      builderState = { active: false, mode: null, goal: "", step: 0 };
      displayMessage(chatBox, "ai", "Builder stopped 🐾");
      return;
    }

    await sendToDoggy(question, snapshot, workflowId, baseUrl, apiKey, workflowSummary, nodeDetails);
  });

  window.addEventListener("load", () => {
    initializeInputListeners(document.querySelectorAll("input, textarea"));
  });
})();
