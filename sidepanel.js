import { setApiKey, getApiKey } from "./storage.js";

// 🦴 Save button → store API key
document.getElementById("saveKey").addEventListener("click", async () => {
  const keyInput = document.getElementById("n8nKey");
  const key = keyInput.value.trim();
  if (!key) return;

  await setApiKey("n8n", key);
  keyInput.value = "";
  alert("🐶 Doggy got his leash! API key saved.");
});

// 🔑 Prefill if key already exists
(async () => {
  const existing = await getApiKey("n8n");
  if (existing) {
    document.getElementById("n8nKey").value = existing;
  }
})();

// 🐕 Fetch workflow test
document.getElementById("fetch-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    {
      type: "FETCH_WORKFLOW",
      workflowId: "aGxhjg8UlFPqqBKV", // Replace with real ID
      baseUrl: "https://correct-walrus-happily.ngrok-free.app"
    },
    (response) => {
      const result = document.getElementById("result");

      if (chrome.runtime.lastError) {
        result.textContent = "❌ Runtime Error: " + chrome.runtime.lastError.message;
      } else if (response.error) {
        result.textContent = "❌ API Error: " + response.error;
      } else {
        result.textContent =
          "✅ Got workflow:\n" + JSON.stringify(response.workflow, null, 2);
      }
    }
  );
});
