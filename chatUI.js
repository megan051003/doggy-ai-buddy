export function createChatUI() {
  const container = document.createElement("div");
  container.id = "doggy-ai-container";
  container.innerHTML = `
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
        box-shadow: -2px 0 5px rgba(0,0,0,0.5);
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
    <div id="drag-handle">🐶 Doggy AI Buddy</div>
    <div class="chat-container-wrapper">
      <div id="chatContainer" class="chat-container"></div>
    </div>
    <div class="input-container">
      <input type="text" id="userQuestion" placeholder="Ask about the workflow...">
      <button id="askBtn">Ask</button>
    </div>
  `;
  document.body.appendChild(container);
  return container;
}

export function displayMessage(container, sender, text) {
  const chatContainer = container.querySelector("#chatContainer");
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", sender === "user" ? "user-message" : "ai-message");
  messageDiv.innerText = text;
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
