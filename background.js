console.log("Doggy AI Buddy background worker loaded");

// 🧠 Persist builderState in memory (for @buildone continuity)
let builderState = null;

async function getApiKey(service) {
  return new Promise((resolve) => {
    chrome.storage.local.get(service, (result) => resolve(result[service]));
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 🐶 PROCESS WITH LLM
  if (request.type === "PROCESS_WITH_LLM") {
    (async () => {
      try {
        const apiKey = await getApiKey("n8n");
        let workflowSummary = null;
        let executionLogs = null;

        const { debugMode } = await new Promise((resolve) =>
          chrome.storage.local.get("debugMode", resolve)
        );

        // ✅ Reset builder state if starting new workflow
        if (/^@\s*build/i.test(request.question)) {
          builderState = null;
          console.log("🐾 New builder session started");
        }

        // ✅ Fetch workflow summary
        if (request.workflowId && request.baseUrl && apiKey) {
          try {
            const summaryRes = await fetch("http://localhost:4000/summarizeWorkflow", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workflowId: request.workflowId,
                baseUrl: request.baseUrl,
                apiKey,
              }),
            });
            if (summaryRes.ok) {
              const { summary } = await summaryRes.json();
              workflowSummary = summary;
            }
          } catch (err) {
            console.error("❌ Summarize workflow failed:", err);
          }

          // ✅ Fetch execution logs if debug mode ON
          if (debugMode) {
            try {
              const logsRes = await fetch("http://localhost:4000/getExecutionLogs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  workflowId: request.workflowId,
                  baseUrl: request.baseUrl,
                  apiKey,
                }),
              });
              if (logsRes.ok) {
                const { logs } = await logsRes.json();
                executionLogs = logs;
              }
            } catch (err) {
              console.error("❌ Execution logs fetch failed:", err);
            }
          }
        }

        // ✅ Call /ask with stored builderState
        const askRes = await fetch("http://localhost:4000/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: request.question,
            context: request.snapshot,
            history: request.history,
            workflowSummary,
            executionLogs,
            nodeDetails: request.nodeDetails || null,
            builderState, // 🧠 persist state across calls
          }),
        });

        const data = await askRes.json();

        // 🧩 Save updated builder state for continuity
        if (data.builderState) {
          builderState = data.builderState;
          console.log("🐶 Builder state updated:", builderState);
        }

        sendResponse(data);
      } catch (error) {
        console.error("Error fetching LLM response:", error);
        sendResponse({ error: "Error: Could not connect to the LLM server." });
      }
    })();
    return true; // 👈 Keeps the message port open
  }

  // 🐕 FETCH WORKFLOW
  if (request.type === "FETCH_WORKFLOW") {
    (async () => {
      try {
        const { workflowId, baseUrl } = request;
        const apiKey = await getApiKey("n8n");
        if (!apiKey) {
          sendResponse({ error: "No API key saved" });
          return;
        }
        const res = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
          headers: { "X-N8N-API-KEY": apiKey },
        });
        if (!res.ok) {
          sendResponse({ error: `API request failed: ${res.status}` });
          return;
        }
        const workflow = await res.json();
        sendResponse({ workflow });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // 🐾 FETCH LOGS
  if (request.type === "FETCH_LOGS") {
    (async () => {
      try {
        const { workflowId, baseUrl } = request;
        const apiKey = await getApiKey("n8n");
        const res = await fetch("http://localhost:4000/getExecutionLogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, baseUrl, apiKey }),
        });
        const { logs } = await res.json();
        sendResponse({ logs });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // 🐾 FETCH NODE DETAILS
  if (request.type === "FETCH_NODE_DETAILS") {
    (async () => {
      try {
        const { workflowId, baseUrl, nodeName } = request;
        const apiKey = await getApiKey("n8n");
        const res = await fetch("http://localhost:4000/getNodeDetails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, baseUrl, apiKey, nodeName }),
        });
        const data = await res.json();
        sendResponse(data);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});

