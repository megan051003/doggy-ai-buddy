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
  // 🐶 Day 8: LLM processing with workflow summary
  if (request.type === "PROCESS_WITH_LLM") {
    (async () => {
      try {
        const apiKey = await getApiKey("n8n");
        let workflowSummary = null;

        // If workflowId & baseUrl are known, summarize first
        if (request.workflowId && request.baseUrl && apiKey) {
          try {
            const summaryRes = await fetch("http://localhost:4000/summarizeWorkflow", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workflowId: request.workflowId,
                baseUrl: request.baseUrl,
                apiKey
              })
            });

            if (summaryRes.ok) {
              const { summary } = await summaryRes.json();
              workflowSummary = summary;
              console.log("✅ Workflow summary fetched and attached.");
            } else {
              console.warn("⚠️ Could not summarize workflow:", summaryRes.status);
            }
          } catch (err) {
            console.error("❌ Summarize workflow failed:", err);
          }
        } else {
          console.log("⚠️ No workflowId/baseUrl/API key — skipping summary.");
        }

        // Now call /ask with question, context, history, and summary
        const askRes = await fetch("http://localhost:4000/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: request.question,
            context: request.snapshot,
            history: request.history,
            workflowSummary
          })
        });

        if (!askRes.ok) {
          throw new Error(`Network response was not ok: ${askRes.statusText}`);
        }

        const data = await askRes.json();
        sendResponse(data);
      } catch (error) {
        console.error("Error fetching LLM response:", error);
        sendResponse({ error: "Error: Could not connect to the LLM server." });
      }
    })();
    return true; // keep async channel alive
  }

  // 🐕 Day 7: Fetch workflow via n8n API (manual fetch)
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
