document.getElementById('captureBtn').addEventListener('click', () => {
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      alert('Screenshot failed: ' + chrome.runtime.lastError.message);
      return;
    }
    document.getElementById('imgPreview').src = dataUrl;
  });
});

async function askDoggyAI(question, context) {
  const response = await fetch("http://localhost:4000/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context }),
  });
  const data = await response.json();
  return data.answer || "No answer received";
}

document.getElementById('askBtn').addEventListener('click', async () => {
  const question = document.getElementById('userQuestion').value;

  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    // Send message to content script
    chrome.tabs.sendMessage(tab.id, { type: "ASK_HELP" }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message failed:', chrome.runtime.lastError.message);
        document.getElementById('answer').innerText = "Content script not loaded. Refresh n8n page.";
        return;
      }

      const snapshot = response?.snapshot || [];
      const contextText = snapshot.map(el => {
        const name = el.dataTestId || el.text || el.tagName;
        return name;
      }).join("\n");

      const answer = await askDoggyAI(question, contextText);
      document.getElementById('answer').innerText = answer;
    });
  });
});

