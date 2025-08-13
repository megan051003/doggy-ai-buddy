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
    You are an AI assistant helping users with n8n workflows.
    
    When you see buttons with attributes like "data-test-id: node-creator-plus-button", call it the "plus button" in your answer.
    
    Answer clearly and helpfully using simple button names like "plus button," "execute workflow button," etc.
    
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

