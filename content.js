console.log("Doggy AI Buddy background worker loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PROCESS_WITH_LLM") {
    // Send a message to your server.js
    fetch('http://localhost:4000/ask', { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        question: request.question,
        context: JSON.stringify(request.snapshot)
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
      console.error('Error fetching LLM response:', error);
      sendResponse({ error: "Error: Could not connect to the LLM server." });
    });
    return true; // Keep the message channel open for the async fetch call
  }
});
~/Desktop/doggy-ai-buddy/src> cd content.js 
cd: not a directory: content.js
~/Desktop/doggy-ai-buddy/src> cat content.js 
console.log("Doggy AI Buddy content script loaded");

const userInputState = {};

function initializeInputListeners(elements) {
  elements.forEach(el => {
    if (!el.dataset.listenerAdded) {
      const key = el.id || el.name || el.dataset.testId || `input-${Math.random().toString(36).substring(7)}`;

      el.addEventListener('input', (event) => {
        userInputState[key] = event.target.value;
        console.log(`Input change detected for ${key}:`, event.target.value);
      });
      el.addEventListener('change', (event) => {
        userInputState[key] = event.target.value;
        console.log(`Change event detected for ${key}:`, event.target.value);
      });
      
      userInputState[key] = el.value;
      el.dataset.listenerAdded = true;
    }
  });
}

const observer = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { 
          const inputElements = node.querySelectorAll("input, textarea");
          if (inputElements.length > 0) {
            initializeInputListeners(inputElements);
          }
        }
      });
    }
  });
});

function getDOMSnapshot() {
  const allElements = Array.from(document.querySelectorAll("body *"));
  const relevantElements = allElements.filter(el =>
    (el.innerText && el.innerText.trim().length > 0) || 
    el.getAttribute("data-test-id") || 
    el.tagName === "INPUT" || 
    el.tagName === "TEXTAREA"
  );

  const snapshot = relevantElements.map(el => {
    const elementData = {
      tagName: el.tagName,
      text: el.innerText ? el.innerText.trim() : '',
      dataTestId: el.getAttribute("data-test-id"),
      className: el.className
    };

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const key = el.id || el.name || el.dataset.testId || '';
      if (userInputState[key] !== undefined) {
          elementData.value = userInputState[key];
      } else {
          elementData.value = el.value;
      }
      if (el.type === "checkbox" || el.type === "radio") {
        elementData.checked = el.checked;
      }
    }
    return elementData;
  });
  return snapshot;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "ASK_HELP") {
    const snapshot = getDOMSnapshot();
    sendResponse({ snapshot });
    return true;
  }
});

window.addEventListener('load', () => {
  observer.observe(document.body, { childList: true, subtree: true });
  initializeInputListeners(document.querySelectorAll("input, textarea"));
});
