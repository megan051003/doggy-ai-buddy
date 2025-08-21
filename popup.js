document.addEventListener('DOMContentLoaded', () => {
    // Variable to store conversation history
    const conversationHistory = [];

    // Function to display messages in the chat UI
    function displayMessage(sender, text) {
        const chatContainer = document.getElementById('chatContainer');
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

    document.getElementById('askBtn').addEventListener('click', async () => {
        const question = document.getElementById('userQuestion').value;
        if (!question.trim()) return;

        // Display user's question and clear the input
        displayMessage('user', question);
        document.getElementById('userQuestion').value = '';

        // Add user message to history
        conversationHistory.push({
            role: "user",
            parts: [{ text: question }]
        });
        
        // Display "Thinking..." message
        const thinkingMessage = "Thinking...";
        displayMessage('ai', thinkingMessage);
        
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (!tab) return;

            // Step 1: Send message to content script to get DOM snapshot
            chrome.tabs.sendMessage(tab.id, { type: "ASK_HELP" }, async (response) => {
                const chatContainer = document.getElementById('chatContainer');
                
                if (chrome.runtime.lastError) {
                    console.error('Message failed:', chrome.runtime.lastError.message);
                    chatContainer.removeChild(chatContainer.lastChild); // Remove "Thinking..." message
                    displayMessage('ai', "Content script not loaded. Refresh n8n page.");
                    return;
                }

                const snapshot = response?.snapshot || [];
                
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
        });
    });
});
