export function createChatUI() {
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
    </style>
    <div id="drag-handle">🐶 Doggy AI Buddy</div>
    <div class="chat-container-wrapper">
      <div id="chatContainer" class="chat-container"></div>
    </div>
    <div class="input-container">
      <input type="text" id="userQuestion" placeholder="Ask about the workflow...">
      <button id="askBtn">Ask</button>
    </div>
  `;

  // Toggle chat on mascot click
  mascot.addEventListener("click", () => {
    chatBox.style.display = chatBox.style.display === "none" ? "flex" : "none";
  });

  document.body.appendChild(mascot);
  document.body.appendChild(chatBox);

  // ✅ Return both
  return { mascot, chatBox };
}

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
