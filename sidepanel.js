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

// 🐾 Debug Mode toggle
const debugToggle = document.getElementById("debugToggle");

// Load saved value
chrome.storage.local.get("debugMode", (data) => {
  debugToggle.checked = data.debugMode || false;
});

// Save when toggled
debugToggle.addEventListener("change", () => {
  chrome.storage.local.set({ debugMode: debugToggle.checked });
  console.log("🐾 Debug Mode set to:", debugToggle.checked);
});

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

// 🐾 Fetch execution logs test
document.getElementById("fetch-logs-btn").addEventListener("click", () => {
  chrome.storage.local.get("debugMode", (data) => {
    const result = document.getElementById("logsResult");

    if (!data.debugMode) {
      result.textContent = "⚡ Debug Mode is OFF — logs won’t be fetched.";
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "FETCH_LOGS",
        workflowId: "aGxhjg8UlFPqqBKV", // Replace with real ID
        baseUrl: "https://correct-walrus-happily.ngrok-free.app"
      },
      (response) => {
        if (chrome.runtime.lastError) {
          result.textContent =
            "❌ Runtime Error: " + chrome.runtime.lastError.message;
        } else if (response.error) {
          result.textContent = "❌ API Error: " + response.error;
        } else {
          result.textContent =
            "✅ Execution Logs:\n" + JSON.stringify(response.logs, null, 2);
        }
      }
    );
  });
});
