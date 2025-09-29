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
  // 🐶 LLM processing with workflow summary + logs + webhook health
  if (request.type === "PROCESS_WITH_LLM") {
    (async () => {
      try {
        const apiKey = await getApiKey("n8n");
        let workflowSummary = null;
        let executionLogs = null;
        let webhookHealth = null;

        // Load debug toggle state
        const { debugMode } = await new Promise((resolve) =>
          chrome.storage.local.get("debugMode", resolve)
        );

        if (request.workflowId && request.baseUrl && apiKey) {
          // ✅ Fetch workflow summary
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
            }
          } catch (err) {
            console.error("❌ Summarize workflow failed:", err);
          }

          // 🐾 Fetch logs only if Debug Mode is ON
          if (debugMode) {
            try {
              const logsRes = await fetch("http://localhost:4000/getExecutionLogs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  workflowId: request.workflowId,
                  baseUrl: request.baseUrl,
                  apiKey
                })
              });

              if (logsRes.ok) {
                const { logs } = await logsRes.json();
                executionLogs = logs;
                console.log("✅ Execution logs fetched and attached.");
              } else {
                console.warn("⚠️ Could not fetch execution logs:", logsRes.status);
              }
            } catch (err) {
              console.error("❌ Execution logs fetch failed:", err);
            }
          } else {
            console.log("⚡ Debug Mode OFF — skipping execution logs.");
          }

          // 🐾 Webhook health check
          try {
            const wfRes = await fetch(`${request.baseUrl}/api/v1/workflows/${request.workflowId}`, {
              headers: { "X-N8N-API-KEY": apiKey }
            });

            if (wfRes.ok) {
              const workflowJson = await wfRes.json();
              const webhookNodes = workflowJson.nodes?.filter(
                (n) => n.type === "n8n-nodes-base.webhook"
              );

              webhookHealth = [];

              for (const node of webhookNodes) {
                const webhookUrl = node.parameters?.path
                  ? `${request.baseUrl}/webhook/${node.parameters.path}`
                  : null;

                if (webhookUrl) {
                  console.log("🐾 Checking webhook:", webhookUrl);

                  const healthRes = await fetch("http://localhost:4000/checkWebhook", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: webhookUrl })
                  });

                  if (healthRes.ok) {
                    const result = await healthRes.json();
                    webhookHealth.push({
                      node: node.name,
                      url: webhookUrl,
                      ...result
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.error("❌ Webhook health check failed:", err);
          }
        }

        // ✅ Call /ask with everything
        const askRes = await fetch("http://localhost:4000/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: request.question,
            context: request.snapshot,
            history: request.history,
            workflowSummary,
            executionLogs,
            webhookHealth
          })
        });

        const data = await askRes.json();
        sendResponse(data);
      } catch (error) {
        console.error("Error fetching LLM response:", error);
        sendResponse({ error: "Error: Could not connect to the LLM server." });
      }
    })();
    return true;
  }

  // 🐕 Manual workflow fetch for sidepanel test
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
          headers: { "X-N8N-API-KEY": apiKey }
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
    return true;
  }

  // 🐾 Manual logs fetch for sidepanel test
  if (request.type === "FETCH_LOGS") {
    (async () => {
      try {
        const { workflowId, baseUrl } = request;
        const apiKey = await getApiKey("n8n");

        if (!apiKey) {
          sendResponse({ error: "No API key saved. Please save your n8n API key first." });
          return;
        }

        const res = await fetch("http://localhost:4000/getExecutionLogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, baseUrl, apiKey })
        });

        if (!res.ok) {
          const text = await res.text();
          sendResponse({ error: `Logs request failed: ${res.status} ${text}` });
          return;
        }

        const { logs } = await res.json();
        sendResponse({ logs });
      } catch (err) {
        console.error("FETCH_LOGS error:", err);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // 🐾 Manual webhook check for sidepanel test
  if (request.type === "CHECK_WEBHOOK") {
    (async () => {
      try {
        const res = await fetch("http://localhost:4000/checkWebhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: request.url,
            headers: request.headers || {}
          })
        });

        if (!res.ok) {
          const text = await res.text();
          sendResponse({ error: `Webhook check failed: ${res.status} ${text}` });
          return;
        }

        const data = await res.json();
        sendResponse(data);
      } catch (err) {
        console.error("CHECK_WEBHOOK error:", err);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});
