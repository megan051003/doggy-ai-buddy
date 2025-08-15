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
~/Desktop/doggy-ai-buddy/src> cat popup.html 
<!DOCTYPE html>
<html>
  <head>
    <style>
      body {
        min-width: 350px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        background-color: #2c2f33;
        color: #ffffff;
        margin: 0;
        display: flex;
        flex-direction: column;
        height: 500px; /* Set a fixed height for the entire popup */
      }
      #chat-container {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        overflow-y: auto;
        padding: 10px;
        gap: 10px;
      }
      .message {
        padding: 8px 12px;
        border-radius: 18px;
        max-width: 80%;
      }
      .user-message {
        align-self: flex-end;
        background-color: #7B3F00; /* Chocolate brown */
      }
      .ai-message {
        align-self: flex-start;
        background-color: #4f545c;
      }
      #input-container {
        display: flex;
        padding: 10px;
        background-color: #23272a;
        border-top: 1px solid #4f545c;
      }
      #userQuestion {
        flex-grow: 1;
        padding: 8px;
        border: none;
        background-color: #40444b;
        color: #ffffff;
        border-radius: 4px;
      }
      #askBtn {
        background-color: #7B3F00;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        margin-left: 8px;
      }
      #askBtn:hover {
        background-color: #6a3400;
      }
    </style>
  </head>
  <body>
    <div id="chat-container"></div>
    <div id="input-container">
      <input id="userQuestion" placeholder="Ask a question..." />
      <button id="askBtn">Ask</button>
    </div>
    <script src="popup.js"></script>
  </body>
</html>
~/Desktop/doggy-ai-buddy/src> cat popup.js 
// src/popup.js

const chatContainer = document.getElementById('chat-container');
const userQuestionInput = document.getElementById('userQuestion');
const askBtn = document.getElementById('askBtn');

// Function to add a message to the chat history
function addMessage(text, sender) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  if (sender === 'user') {
    messageElement.classList.add('user-message');
  } else {
    messageElement.classList.add('ai-message');
  }
  messageElement.innerText = text;
  chatContainer.appendChild(messageElement);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Handle sending a question to the AI
askBtn.addEventListener('click', async () => {
  const question = userQuestionInput.value.trim();
  if (!question) {
    return;
  }

  // Display user's question and clear input
  addMessage(question, 'user');
  userQuestionInput.value = '';

  // Display a "thinking" message
  const thinkingMessage = document.createElement('div');
  thinkingMessage.innerText = 'Doggy AI is thinking...';
  thinkingMessage.classList.add('message', 'ai-message');
  chatContainer.appendChild(thinkingMessage);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) {
      thinkingMessage.innerText = "Error: No active tab found.";
      return;
    }

    // Step 1: Send message to content script to get DOM snapshot
    chrome.tabs.sendMessage(tab.id, { type: "ASK_HELP" }, (response) => {
      if (chrome.runtime.lastError) {
        thinkingMessage.innerText = "Content script not loaded. Refresh n8n page.";
        return;
      }
      
      const snapshot = response?.snapshot || [];

      // Step 2: Send the DOM snapshot and question to the background script
      chrome.runtime.sendMessage({ type: "PROCESS_WITH_LLM", question: question, snapshot: snapshot }, (llmResponse) => {
        if (llmResponse && llmResponse.answer) {
          // Step 3: Replace thinking message with the LLM's answer
          thinkingMessage.innerText = llmResponse.answer;
        } else {
          thinkingMessage.innerText = llmResponse.error || "No answer received.";
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    });
  });
});

// Allow sending question with the Enter key
userQuestionInput.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    askBtn.click();
  }
});
