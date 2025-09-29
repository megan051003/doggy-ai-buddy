console.log("Doggy AI Buddy content script loaded");

(async () => {
  // Dynamically import helper modules
  const { createChatUI, displayMessage } = await import(chrome.runtime.getURL("src/chatUI.js"));
  const { initializeInputListeners, getDOMSnapshot } = await import(chrome.runtime.getURL("src/domWatcher.js"));
  const { makeDraggable } = await import(chrome.runtime.getURL("src/dragHandler.js"));

  // --- Setup UI ---
  const container = createChatUI();
  const chatContainer = container.querySelector("#chatContainer");
  const input = container.querySelector("#userQuestion");
  const askBtn = container.querySelector("#askBtn");
  const dragHandle = container.querySelector("#drag-handle");

  makeDraggable(container, dragHandle);

  // Conversation state
  const conversationHistory = [];

  // Utility: extract workflowId and baseUrl from current URL
  function getWorkflowContextFromUrl() {
    const url = new URL(window.location.href);
    // Example: https://xxxx.ngrok-free.app/workflow/aGxhjg8UlFPqqBKV
    const parts = url.pathname.split("/");
    const workflowId = parts.includes("workflow") ? parts.pop() : null;
    const baseUrl = `${url.protocol}//${url.host}`;
    return { workflowId, baseUrl };
  }

  // Helper: fetch workflow summary from backend
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

  // Handle "Ask" button
  askBtn.addEventListener("click", async () => {
    const question = input.value;
    if (!question.trim()) return;

    displayMessage(container, "user", question);
    input.value = "";
    conversationHistory.push({ role: "user", parts: [{ text: question }] });
    displayMessage(container, "ai", "Thinking...");

    const snapshot = getDOMSnapshot();
    const { workflowId, baseUrl } = getWorkflowContextFromUrl();

    // 🔑 fetch JSON workflow summary
    const workflowSummary = await fetchWorkflowSummary(workflowId, baseUrl);

    try {
      chrome.runtime.sendMessage(
        {
          type: "PROCESS_WITH_LLM",
          question,
          snapshot,
          history: conversationHistory,
          workflowId,
          baseUrl,
          workflowSummary, // ✅ included here
        },
        (llmResponse) => {
          if (chrome.runtime.lastError) {
            console.error("❌ SendMessage failed:", chrome.runtime.lastError.message);
            chatContainer.removeChild(chatContainer.lastChild);
            displayMessage(container, "ai", "Doggy got disconnected 🐾 (please reload extension).");
            return;
          }

          chatContainer.removeChild(chatContainer.lastChild);
          if (llmResponse?.answer && llmResponse.answer.trim()) {
            conversationHistory.push({ role: "model", parts: [{ text: llmResponse.answer }] });
            displayMessage(container, "ai", llmResponse.answer);
          } else {
            displayMessage(container, "ai", llmResponse.error || "Doggy didn’t know what to say 🐾");
          }
        }
      );
    } catch (err) {
      console.error("❌ Exception sending message:", err);
      chatContainer.removeChild(chatContainer.lastChild);
      displayMessage(container, "ai", "Doggy had a hiccup 🐶 (please reload extension).");
    }
  });

  // Input listeners for DOM snapshot
  window.addEventListener("load", () => {
    initializeInputListeners(document.querySelectorAll("input, textarea"));
  });
})();
