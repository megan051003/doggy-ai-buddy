console.log("Doggy AI Buddy content script loaded");

if (
  window.location.href.includes("ngrok-free.app") &&
  window.location.href.includes("/workflow/")
) {
  console.log("Doggy AI Buddy active on n8n!");

  const clickableSelectors = [
    "[data-test-id]",
    "button",
    "a",
    "[role='button']",
  ];
  const selector = clickableSelectors.join(",");

  function getDOMSnapshot() {
    const elements = Array.from(document.querySelectorAll(selector));
    
    console.log(`Snapshot taken. Found ${elements.length} matching elements.`);

    const relevantElements = elements.filter(el => 
      (el.innerText && el.innerText.trim().length > 0) || el.getAttribute("data-test-id")
    );
    
    const snapshot = {
      count: relevantElements.length,
      elements: relevantElements.map(el => ({
        tagName: el.tagName,
        text: el.innerText ? el.innerText.trim() : '',
        dataTestId: el.getAttribute("data-test-id"),
        className: el.className,
      })),
    };
    
    console.log("DOM Snapshot:", snapshot);
    return snapshot;
  }

  const observer = new MutationObserver((mutationsList, observer) => {
    getDOMSnapshot();
  });

  function activateBuddy() {
    getDOMSnapshot();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
  
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", activateBuddy);
  } else {
    activateBuddy();
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ASK_HELP") {
      const snapshot = getDOMSnapshot();
      const buttons = snapshot.elements.map(el => el.text).filter(Boolean);
      const responseText = buttons.length
        ? "I see these buttons on this page:\n- " + buttons.join("\n- ")
        : "I couldn't find any actionable buttons on this page.";

      sendResponse({ text: responseText });
      return true; // Keep message channel open for async response
    }
  });

} else {
  console.log("Doggy AI Buddy inactive on this page.");
}
