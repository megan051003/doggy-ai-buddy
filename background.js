console.log("Doggy AI Buddy background worker loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PROCESS_WITH_LLM") {
    fetch("http://localhost:4000/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: request.question,
        context: request.snapshot,  // <-- send the raw JSON array, no stringify here
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
    return true; // Keep async channel alive
  }
});
