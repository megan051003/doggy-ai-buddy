document.getElementById('captureBtn').addEventListener('click', () => {
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      alert('Screenshot failed: ' + chrome.runtime.lastError.message);
      return;
    }
    document.getElementById('imgPreview').src = dataUrl;
  });
});

document.getElementById('askBtn').addEventListener('click', async () => {
  const question = document.getElementById('userQuestion').value;
  document.getElementById('answer').innerText = "Thinking...";

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    // Step 1: Send message to content script to get DOM snapshot
    chrome.tabs.sendMessage(tab.id, { type: "ASK_HELP" }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message failed:', chrome.runtime.lastError.message);
        document.getElementById('answer').innerText = "Content script not loaded. Refresh n8n page.";
        return;
      }

      const snapshot = response?.snapshot || [];
      
      // Step 2: Send the DOM snapshot and question to the background script
      chrome.runtime.sendMessage({ type: "PROCESS_WITH_LLM", question: question, snapshot: snapshot }, (llmResponse) => {
        if (llmResponse && llmResponse.answer) {
          // Step 3: Display the LLM's response
          document.getElementById('answer').innerText = llmResponse.answer;
        } else {
          document.getElementById('answer').innerText = llmResponse.error || "No answer received.";
        }
      });
    });
  });
});
