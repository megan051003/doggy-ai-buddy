import express from "express";
import cors from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs/promises"; // Import the file system module
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

// This function now reads the nodes directly from your local JSON file.
async function getAvailableNodes() {
  try {
    const data = await fs.readFile("/Users/mpalrecha/active_nodes_summary.json", "utf8");
    const nodesData = JSON.parse(data);

    // This returns the full JSON object as a string.
    return JSON.stringify(nodesData, null, 2);
  } catch (error) {
    console.error("Error reading nodes.json:", error);
    return "Could not retrieve the list of available nodes.";
  }
}

// This function now includes retry logic for rate-limit errors
async function queryGemini(promptText, history) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const maxRetries = 3;
  let retryCount = 0;

  // Combine history and current prompt into one contents array
  const contents = [...history, {
    role: "user",
    parts: [{ text: promptText }],
  }];

  while (retryCount < maxRetries) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: contents,
        }),
      });

      if (response.status === 429) {
        console.warn(`Quota exceeded. Retrying in 10 seconds... (Attempt ${retryCount + 1} of ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds
        retryCount++;
        continue;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error(`Attempt ${retryCount + 1} failed:`, error);
      retryCount++;
      if (retryCount >= maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait before next retry
    }
  }
}

app.post("/ask", async (req, res) => {
  try {
    const { question, context } = req.body;
    const history = req.body.history || []; // Ensures history is always an array

    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const availableNodesJson = await getAvailableNodes();

    const prompt = `
    You are an AI visual n8n assistant helping users build workflows from scratch, fix errors, and help their current workflows. 
    But you have a super power of having the context of the n8n UI so you can the elements and user textfield inputs to give specific answers.
    
    ERROR FIXING:
    - Users can ask questions about why they see certain errors in their n8n workflows/nodes and how to fix them.
    - Using the provided context cheat sheet when needed, guide them on how to fix their issues based on what they typed in the nodes. Tell them what they personally did wrong, so they know. 
    - For example, if they entered a wrong URL in a textfield of a certain node, read them back what they put and why it's wrong, and how to fix it. DO NOT GIVE GENERAL ADVICE ON HOW TO FIX IT. 
    - Users want to know what they personally did wrong, so they can fix it.
    - IMPORTANT: DO NOT GIVE GENERIC ANSWERS. ALWAYS TAILOR YOUR ANSWER TO WHAT THE USER TYPED IN THE NODES!!!
    
    BUILDING WORKFLOWS:
    - Users can ask about building workflows, and you will help them by referring to buttons they can click in the n8n UI from ${context}. But do this step by step, guiding them through the process.
    - DO NOT OVERLOAD THEM WITH INFORMATION. 
    - Use ONLY nodes from the JSON list below to help build the user's workflow and do not suggest nodes that are not in this list. Pls!!!
    
    IMPORTANT:
    - When you suggest a node, you MUST also provide the full JSON object for that node from the list below as proof.
    - If a node is not in the list, you CANNOT suggest it.
    - If you are asked about a node, and it is not in the list, you must explicitly state that it does not exist.
    
    CONTEXT CHEAT SHEET:
    - When you see buttons with attributes like "data-test-id: node-creator-plus-button", call it the "plus button" in your answer to make it user friendly.
    - At the end of your answer, add a separate section titled "Reference buttons" listing the relevant button attribute(s) you used to base your answer on. For example:
    - Reference buttons: node-creator-plus-button
    - Do not include raw attribute names in the main answer text.
    
    User question: ${question}
    
    Page context (buttons and other elements):
    ${context}

    **Available Nodes JSON:**
    ${availableNodesJson}
    
    Answer:
    `;
    
    const geminiResponse = await queryGemini(prompt, history);

    // Parse answer from Gemini response
    // Assuming Gemini returns candidates with content.parts[0].text
    const answer =
      geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No answer received";

    res.json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Doggy AI Buddy backend listening at http://localhost:${port}`);
});
