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

// ---- START: New Code for Draggable UI & Styling ----

// Inject the UI into the host page
const uiContainer = document.createElement('div');
uiContainer.id = 'doggy-ai-container';
uiContainer.innerHTML = `
<style>
    #doggy-ai-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        height: 450px;
        background-color: #000;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        padding: 10px;
        box-shadow: -2px 0 5px rgba(0, 0, 0, 0.5);
        color: #fff;
        border-radius: 12px;
        box-sizing: border-box;
    }

    #drag-handle {
        cursor: grab;
        padding: 8px;
        background-color: #333;
        border-radius: 10px 10px 0 0;
        text-align: center;
        user-select: none;
        font-weight: bold;
    }

    .chat-container-wrapper {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 10px;
        border: 1px solid #333;
        border-radius: 8px;
        background-color: #111;
        color: #fff;
    }

    .chat-container {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
    }

    .message {
        margin: 5px 0;
        padding: 8px 12px;
        border-radius: 18px;
        max-width: 80%;
        word-wrap: break-word;
    }

    .user-message {
        background-color: #8B4513;
        color: white;
        align-self: flex-end;
    }

    .ai-message {
        background-color: #333;
        color: #fff;
        align-self: flex-start;
    }

    .input-container {
        display: flex;
        margin-top: 10px;
    }

    #userQuestion {
        flex-grow: 1;
        padding: 10px;
        border: 1px solid #555;
        border-radius: 20px;
        background-color: #222;
        color: #fff;
    }

    button {
        margin-left: 5px;
        padding: 10px 15px;
        background-color: #8B4513; 
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
    }
</style>
<div id="drag-handle">Doggy AI Buddy</div>
<div class="chat-container-wrapper">
    <div id="chatContainer" class="chat-container">
    </div>
</div>

<div class="input-container">
    <input type="text" id="userQuestion" placeholder="Ask about the workflow...">
    <button id="askBtn">Ask</button>
</div>
`;

document.body.appendChild(uiContainer);

// Get a reference to the injected elements
const dragHandle = uiContainer.querySelector('#drag-handle');
const chatContainer = uiContainer.querySelector('#chatContainer');
const userQuestionInput = uiContainer.querySelector('#userQuestion');
const askBtn = uiContainer.querySelector('#askBtn');

// Variables for drag-and-drop
let isDragging = false;
let initialMouseX, initialMouseY;
let initialBoxX, initialBoxY;

// Function to handle the start of dragging
function dragStart(e) {
    e.preventDefault();
    isDragging = true;
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;

    const containerRect = uiContainer.getBoundingClientRect();
    initialBoxX = containerRect.left;
    initialBoxY = containerRect.top;

    uiContainer.style.removeProperty('bottom');
    uiContainer.style.removeProperty('right');
    uiContainer.style.left = `${initialBoxX}px`;
    uiContainer.style.top = `${initialBoxY}px`;

    uiContainer.style.cursor = 'grabbing';
    uiContainer.style.transition = 'none';
}

// Function to handle the drag movement
function dragging(e) {
    if (!isDragging) return;
    const deltaX = e.clientX - initialMouseX;
    const deltaY = e.clientY - initialMouseY;

    const newLeft = initialBoxX + deltaX;
    const newTop = initialBoxY + deltaY;

    uiContainer.style.left = `${newLeft}px`;
    uiContainer.style.top = `${newTop}px`;
}

// Function to handle the end of dragging
function dragEnd() {
    isDragging = false;
    uiContainer.style.cursor = 'grab';
    uiContainer.style.transition = 'all 0.3s ease';
}

// Add event listeners for dragging
dragHandle.addEventListener('mousedown', dragStart);
document.addEventListener('mousemove', dragging);
document.addEventListener('mouseup', dragEnd);

// Rest of your logic
// Variable to store conversation history
const conversationHistory = [];

// Function to display messages in the chat UI
function displayMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    if (sender === 'user') {
        messageDiv.classList.add('user-message');
    } else {
        messageDiv.classList.add('ai-message');
    }
    messageDiv.innerText = text;
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Event listener for the "Ask" button
askBtn.addEventListener('click', async () => {
    const question = userQuestionInput.value;
    if (!question.trim()) return;

    // Display user's question and clear the input
    displayMessage('user', question);
    userQuestionInput.value = '';

    // Add user message to history
    conversationHistory.push({
        role: "user",
        parts: [{ text: question }]
    });
    
    // Display "Thinking..." message
    const thinkingMessage = "Thinking...";
    displayMessage('ai', thinkingMessage);

    // Step 1: Get the DOM snapshot by directly calling the function
    const snapshot = getDOMSnapshot();
    
    // Step 2: Send the DOM snapshot, question, and history to the background script
    chrome.runtime.sendMessage({
        type: "PROCESS_WITH_LLM",
        question: question,
        snapshot: snapshot,
        history: conversationHistory
    }, (llmResponse) => {
        chatContainer.removeChild(chatContainer.lastChild); // Remove "Thinking..." message
        
        if (llmResponse && llmResponse.answer) {
            // Add AI message to history and display it
            conversationHistory.push({
                role: "model",
                parts: [{ text: llmResponse.answer }]
            });
            displayMessage('ai', llmResponse.answer);
        } else {
            displayMessage('ai', llmResponse.error || "No answer received.");
        }
    });
});

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
