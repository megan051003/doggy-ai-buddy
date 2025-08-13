console.log("Doggy AI Buddy content script loaded");
alert("Content script loaded!");


// Function to capture all visible DOM elements on page
function getDOMSnapshot() {
  const allElements = Array.from(document.querySelectorAll("body *"));
  const relevantElements = allElements.filter(el =>
    (el.innerText && el.innerText.trim().length > 0) || el.getAttribute("data-test-id")
  );

  const snapshot = relevantElements.map(el => ({
    tagName: el.tagName,
    text: el.innerText ? el.innerText.trim() : '',
    dataTestId: el.getAttribute("data-test-id"),
    className: el.className
  }));

  return snapshot;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "ASK_HELP") {
    const snapshot = getDOMSnapshot();
    sendResponse({ snapshot }); // immediately respond
    return true; // keep channel open
  }
});

