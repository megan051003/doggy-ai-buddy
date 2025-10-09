export function createChatUI() {
  // 🧠 Create or restore per-tab session
  let sessionId = localStorage.getItem("doggieSessionId");
  if (!sessionId) {
    sessionId = "sess_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("doggieSessionId", sessionId);
  }

  let workflowName = localStorage.getItem("doggieWorkflowName") || "New Workflow";

  // 🐶 Mascot button
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

  // 🐾 Chat container
  const chatBox = document.createElement("div");
  chatBox.id = "doggy-chat-box";
  chatBox.style.cssText = `
    position: fixed;
    bottom: 120px;
    right: 20px;
    width: 420px;
    height: 520px;
    background-color: #000;
    z-index: 9999;
    display: none;
    flex-direction: column;
    padding: 10px;
    box-shadow: -2px 0 8px rgba(0,0,0,0.6);
    color: #fff;
    border-radius: 14px;
    box-sizing: border-box;
    resize: both;
    overflow: auto;
    cursor: move; /* shows draggable cursor */
  `;

  chatBox.innerHTML = `
    <style>
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
        margin: 5px 0;
        padding: 8px 12px;
        border-radius: 18px;
        max-width: 80%;
        word-wrap: break-word;
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
        cursor: text; /* allow typing */
      }
      #doggy-chat-box button {
        margin-left: 5px;
        padding: 10px 15px;
        background-color: #8B4513;
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
      }
      #doggy-header {
        font-weight: bold;
        margin-bottom: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #newTabBtn {
        background: #444;
        border-radius: 8px;
        font-size: 12px;
        padding: 4px 8px;
        margin-left: 8px;
      }
    </style>

    <div id="doggy-header">
      <div>🐶 Working on: <span id="workflowName">${workflowName}</span></div>
      <button id="newTabBtn">New Workflow Tab 🧩</button>
    </div>

    <div class="chat-container-wrapper">
      <div id="chatContainer" class="chat-container"></div>
    </div>
    <div class="input-container">
      <input type="text" id="userQuestion" placeholder="Ask about the workflow...">
      <button id="askBtn">Ask</button>
    </div>
  `;

  // 🐾 Toggle chat
  mascot.addEventListener("click", () => {
    chatBox.style.display = chatBox.style.display === "none" ? "flex" : "none";
  });

  document.body.appendChild(mascot);
  document.body.appendChild(chatBox);

  // 🧲 Make entire chat box draggable
  makeDraggable(chatBox);

  // === Chat logic ===
  const askBtn = chatBox.querySelector("#askBtn");
  const input = chatBox.querySelector("#userQuestion");
  const chatContainer = chatBox.querySelector("#chatContainer");
  const newTabBtn = chatBox.querySelector("#newTabBtn");
  const workflowSpan = chatBox.querySelector("#workflowName");

  askBtn.addEventListener("click", async () => {
    const question = input.value.trim();
    if (!question) return;

    displayMessage(chatBox, "user", question);
    input.value = "";

    if (question.startsWith("@build") && !workflowName.includes("→")) {
      workflowName = question.replace("@build", "").trim().slice(0, 40);
      workflowSpan.textContent = workflowName;
      localStorage.setItem("doggieWorkflowName", workflowName);
    }

    try {
      const res = await fetch("http://localhost:4000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          sessionId,
          builderState: { active: question.startsWith("@build") },
        }),
      });

      const data = await res.json();
      displayMessage(chatBox, "ai", data.answer || "🐾 No answer received.");
    } catch (err) {
      displayMessage(chatBox, "ai", "❌ Error: " + err.message);
    }
  });

  newTabBtn.addEventListener("click", () => {
    localStorage.removeItem("doggieWorkflowName");
    const newSession = "sess_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("doggieSessionId", newSession);
    window.location.reload();
  });

  return { mascot, chatBox };
}

// 🧲 Utility for draggable chat box
function makeDraggable(el) {
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  el.addEventListener("mousedown", (e) => {
    // Skip dragging inside input or button
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON" || e.target.tagName === "TEXTAREA") return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    el.style.transition = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${startLeft + dx}px`;
    el.style.top = `${startTop + dy}px`;
    el.style.bottom = "auto";
    el.style.right = "auto";
    el.style.position = "fixed";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      el.style.transition = "all 0.2s ease";
    }
  });
}

// 💬 Append message to chat
export function displayMessage(chatBox, sender, text) {
  const chatContainer = chatBox.querySelector("#chatContainer");
  const messageDiv = document.createElement("div");
  messageDiv.classList.add(
    "message",
    sender === "user" ? "user-message" : "ai-message"
  );
  messageDiv.innerText = text;
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
