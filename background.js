console.log("Doggy AI Buddy background worker loaded");

// Helper to get API key from chrome.storage
async function getApiKey(service) {
  return new Promise((resolve) => {
    chrome.storage.local.get(service, (result) => {
      resolve(result[service]);
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 🐶 Existing LLM processing
  if (request.type === "PROCESS_WITH_LLM") {
    fetch("http://localhost:4000/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: request.question,
        context: request.snapshot, // raw DOM snapshot JSON
        history: request.history
      })
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        sendResponse(data);
      })
      .catch(error => {
        console.error("Error fetching LLM response:", error);
        sendResponse({ error: "Error: Could not connect to the LLM server." });
      });
    return true; // keep async channel alive
  }

  // 🐕 Day 7: Fetch workflow via n8n API
  if (request.type === "FETCH_WORKFLOW") {
    (async () => {
      try {
        const { workflowId, baseUrl } = request;
        const apiKey = await getApiKey("n8n");

        if (!apiKey) {
          sendResponse({ error: "No API key saved. Please save your n8n API key first." });
          return;
        }

        const res = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
          headers: {
            "X-N8N-API-KEY": apiKey // ✅ Correct header for n8n
          }
        });

        if (!res.ok) {
          const text = await res.text();
          sendResponse({ error: `API request failed: ${res.status} ${text}` });
          return;
        }

        const workflow = await res.json();
        sendResponse({ workflow });
      } catch (err) {
        console.error("FETCH_WORKFLOW error:", err);
        sendResponse({ error: err.message });
      }
    })();
    return true; // keep async channel alive
  }
});
