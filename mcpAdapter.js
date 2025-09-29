// mcpAdapter.js
// MCP Adapter for Doggy AI Buddy

export async function listNodes() {
  return [
    {
      name: "Webhook",
      type: "trigger",
      description: "Starts a workflow when an HTTP request is received",
      properties: ["path", "method"]
    },
    {
      name: "Google Sheets",
      type: "action",
      description: "Read and write data in Google Sheets",
      properties: ["spreadsheetId", "range", "auth"]
    },
    {
      name: "Slack",
      type: "action",
      description: "Send a message to Slack",
      properties: ["channel", "text", "auth"]
    }
  ];
}

export async function getWorkflow(apiKey, workflowId, baseUrl = "http://localhost:5678") {
  if (!apiKey) throw new Error("No n8n API key provided");
  if (!workflowId) throw new Error("No workflow ID provided");

  const url = `${baseUrl}/rest/workflows/${workflowId}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch workflow: ${response.status} - ${text}`);
  }

  return response.json();
}
