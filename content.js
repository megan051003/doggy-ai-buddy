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

  // Handle "Ask" button
  askBtn.addEventListener("click", () => {
    const question = input.value;
    if (!question.trim()) return;

    displayMessage(container, "user", question);
    input.value = "";
    conversationHistory.push({ role: "user", parts: [{ text: question }] });
    displayMessage(container, "ai", "Thinking...");

    const snapshot = getDOMSnapshot();

    chrome.runtime.sendMessage(
      { type: "PROCESS_WITH_LLM", question, snapshot, history: conversationHistory },
      (llmResponse) => {
        chatContainer.removeChild(chatContainer.lastChild); // remove "Thinking..."
        if (llmResponse?.answer && llmResponse.answer.trim()) {
          conversationHistory.push({ role: "model", parts: [{ text: llmResponse.answer }] });
          displayMessage(container, "ai", llmResponse.answer);
        } else {
          displayMessage(container, "ai", llmResponse.error || "Doggy didn’t know what to say 🐾");
        }
      }
    );
  });

  // Input listeners for DOM snapshot
  window.addEventListener("load", () => {
    initializeInputListeners(document.querySelectorAll("input, textarea"));
  });
})();
