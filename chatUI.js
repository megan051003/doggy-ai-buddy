export function createChatUI() {
  // 🐶 Mascot
  const mascot = document.createElement("img");
  mascot.id = "doggy-ai-mascot";
  mascot.src = chrome.runtime.getURL("assets/doggie.png");
  mascot.alt = "Doggy AI Buddy";
  mascot.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 150px;
    height: 150px;
    cursor: pointer;
    z-index: 10000;
  `;

  // 🐾 Chat Box
  const chatBox = document.createElement("div");
  chatBox.id = "doggy-chat-box";
  chatBox.style.cssText = `
    position: fixed;
    bottom: 120px;
    right: 20px;
    width: 420px;
    height: 520px;
    background-color: #000;
    display: none;
    flex-direction: column;
    padding: 10px;
    border-radius: 14px;
    box-shadow: -2px 0 8px rgba(0,0,0,0.6);
    z-index: 9999;
    resize: both;
    overflow: auto;
    color: #fff;
  `;

  // 🔥 FULL HTML inside Chat Box
  chatBox.innerHTML = `
    <style>

      /* ===========================================================
         🐶 Chat Window General
      =========================================================== */
      #doggy-chat-box .chat-container-wrapper {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 10px;
        border: 1px solid #333;
        border-radius: 8px;
        background-color: #111;
      }

      #doggy-chat-box .chat-container {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
      }

      #doggy-chat-box .message {
        margin: 6px 0;
        padding: 8px 12px;
        border-radius: 16px;
        max-width: 85%;
        word-wrap: break-word;
        white-space: pre-wrap;
      }

      #doggy-chat-box .user-message {
        background-color: #8B4513;
        color: white;
        align-self: flex-end;
      }

      #doggy-chat-box .ai-message {
        background-color: #333;
        color: #fff;
        align-self: flex-start;
      }

      #drag-handle {
        cursor: grab;
        padding: 6px 0;
        text-align: center;
        color: #fff;
        font-weight: bold;
        background: #111;
        border-radius: 8px;
        margin-bottom: 8px;
      }


      /* ===========================================================
         🐾 Chat Input Area
      =========================================================== */
      #doggy-chat-box .input-container {
        display: flex;
        margin-top: 10px;
      }

      #doggy-chat-box #userQuestion {
        flex-grow: 1;
        padding: 10px;
        border: 1px solid #555;
        border-radius: 20px;
        background-color: #222;
        color: #fff;
        outline: none;
      }

      #doggy-chat-box button {
        margin-left: 8px;
        padding: 10px 16px;
        background-color: #B5743B;
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-weight: bold;
      }


      /* ===========================================================
         ✨ BEAUTIFUL WORKFLOW CARDS (NEW!)
      =========================================================== */

      .workflow-card {
        background: #1C1C1C;
        border: 1px solid rgba(255,255,255,0.1);
        padding: 18px;
        border-radius: 12px;
        margin-top: 12px;
        line-height: 1.5;
        font-size: 14px;
      }

      .workflow-step-title {
        font-size: 22px;
        font-weight: bold;
        color: #B5743B;  /* Doggie Brown */
        margin-bottom: 14px;
      }

      .workflow-section-label {
        font-weight: bold;
        color: #E6D3B3; /* Doggie Beige */
        margin-top: 10px;
        margin-bottom: 6px;
      }

      .workflow-field-box {
        background: #111;
        border: 1px solid rgba(255,255,255,0.1);
        padding: 12px;
        border-radius: 8px;
        margin-top: 6px;
        color: #fff;
      }

      .workflow-field-box ul {
        margin: 0;
        padding-left: 18px;
      }

      .workflow-divider {
        margin: 14px 0;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }

    </style>

    <div id="drag-handle">🐶 Doggy AI Buddy</div>

    <div class="chat-container-wrapper">
      <div id="chatContainer" class="chat-container"></div>
    </div>

    <div class="input-container">
      <input type="text" id="userQuestion" placeholder="Ask Doggy...">
      <button id="askBtn">Ask</button>
    </div>
  `;

  // 🐶 Toggle open/close
  mascot.addEventListener("click", () => {
    chatBox.style.display = chatBox.style.display === "none" ? "flex" : "none";
  });

  document.body.appendChild(mascot);
  document.body.appendChild(chatBox);

  return { mascot, chatBox };
}


/* ===========================================================
   💬 Message Rendering (supports normal & workflow cards)
=========================================================== */

export function displayMessage(chatBox, sender, text) {
  const chatContainer = chatBox.querySelector("#chatContainer");
  const messageDiv = document.createElement("div");

  // 🟤 User or AI bubble?
  messageDiv.classList.add(
    "message",
    sender === "user" ? "user-message" : "ai-message"
  );

  // ✨ Detect workflow card formatting
  if (text.includes("🐾 Step")) {
    messageDiv.innerHTML = renderWorkflowCard(text);
  } else {
    messageDiv.innerText = text;
  }

  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}


/* ===========================================================
   🎨 Workflow Card Renderer
=========================================================== */

function renderWorkflowCard(raw) {
  const lines = raw.split("\n");

  let html = `<div class="workflow-card">`;

  for (let line of lines) {

    if (line.includes("🐾 Step")) {
      html += `<div class="workflow-step-title">${line}</div>`;
      continue;
    }

    if (line.match(/Node Name/i)) {
      html += `<div class="workflow-section-label">Node Name:</div>`;
      continue;
    }

    if (line.match(/Node Type/i)) {
      html += `<div class="workflow-section-label">Node Type:</div>`;
      continue;
    }

    if (line.match(/Action/i)) {
      html += `<div class="workflow-section-label">Action:</div>`;
      continue;
    }

    if (line.match(/Fields to Fill/i)) {
      html += `<div class="workflow-section-label">Fields to Fill:</div>`;
      continue;
    }

    // bullet list
    if (line.trim().startsWith("-")) {
      html += `<div class="workflow-field-box">${line.replace(/^- /, "• ")}</div>`;
      continue;
    }

    // divider
    if (line.includes("──────────")) {
      html += `<div class="workflow-divider"></div>`;
      continue;
    }

    // normal text
    html += `<div>${line}</div>`;
  }

  html += `</div>`;
  return html;
}
