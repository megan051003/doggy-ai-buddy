import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";  // npm i node-fetch@2
import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));  // allow bigger payloads if needed

async function queryGemini(promptText) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";


  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data;
}

app.post("/ask", async (req, res) => {
  try {
    const { question, context } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const prompt = `
    You are an AI visual n8n assistant helping users build workflows from scratch, fix errors, and help their current workflows. 
    But you have a super power of having the context of the n8n UI so you can the elements and user textfield inputs to give specific answers.
    
    - Users can ask questions about why they see certain errors in their n8n workflows/nodes and how to fix them.
    - Using the provided context cheat sheet when needed, guide them on how to fix their issues based on what they typed in the nodes. Tell them what they personally did wrong, so they know. 
    - For example, if they entered a wrong URL in a textfield of a certain node, read them back what they put and why it's wrong, and how to fix it. DO NOT GIVE GENERAL ADVICE ON HOW TO FIX IT. 
    - Users want to know what they personally did wrong, so they can fix it.

    IMPORTANT: DO NOT GIVE GENERIC ANSWERS. ALWAYS TAILOR YOUR ANSWER TO WHAT THE USER TYPED IN THE NODES!!!

    - Users can also ask about building workflows, and you will help them by referring to buttons they can click in the n8n UI from the provided context. But do this step by step, guiding them through the process.
    - DO NOT OVERLOAD THEM WITH INFORMATION.    


    When you see buttons with attributes like "data-test-id: node-creator-plus-button", call it the "plus button" in your answer to make it user friendly.
    
    At the end of your answer, add a separate section titled "Reference buttons" listing the relevant button attribute(s) you used to base your answer on. For example:
    
    Reference buttons: node-creator-plus-button
    
    Do not include raw attribute names in the main answer text.
    
    User question: ${question}
    Page context (buttons and other elements):
    ${context}
    
    Answer:
    `;
    

    const geminiResponse = await queryGemini(prompt);

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
