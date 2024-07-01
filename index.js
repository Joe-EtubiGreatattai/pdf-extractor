const express = require("express");
const multer = require("multer");
const pdf = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const dotenv = require("dotenv");
const swaggerSetup = require('./swagger');

dotenv.config();

const app = express();
const port = 3000;


// Configure Gemini API key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Configure OpenAI API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configure multer for file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware for parsing JSON requests
app.use(express.json());

// Endpoint to upload PDF and specify page range
app.post("/", upload.single("document"), handlePDFUpload);

async function handlePDFUpload(req, res) {
  const { startPage, stopPage, bookAuthor, bookSubject, genre, bookTitle } =
    req.body;

  // Check if startPage and stopPage are provided
  if (!startPage || !stopPage) {
    return res.status(400).send("Start page and end page are required.");
  }

  try {
    // Extract text from the uploaded PDF
    const extractedText = await extractTextFromPDF(
      req.file.buffer,
      parseInt(startPage),
      parseInt(stopPage)
    );

    // Generate summary prompt
    const prompt = generateSummaryPrompt(
      bookTitle,
      bookAuthor,
      bookSubject,
      genre,
      startPage,
      stopPage,
      extractedText
    );

    // Generate summary using Gemini API
    const summaryResult = await generateSummaryWithGemini(genAI, prompt);

    if (summaryResult) {
      console.log(`Summary generation successful with Gemini.`);
      res.send({
        message: "Summary generated",
        source: "Gemini",
        summary: summaryResult.summary,
      });
    } else {
      // If Gemini API fails, try OpenAI API
      console.log("Gemini failed, trying OpenAI...");
      const openaiSummaryResult = await generateSummaryWithOpenAI(
        openai,
        prompt
      );

      if (openaiSummaryResult) {
        console.log("Summary generation successful with OpenAI.");
        res.send({
          message: "Summary generated",
          source: "OpenAI",
          summary: openaiSummaryResult.summary.summary,
          tokens: openaiSummaryResult.tokens,
        });
      } else {
        console.error("Error generating summary with both APIs.");
        res.status(500).send("Error generating summary");
      }
    }
  } catch (error) {
    console.error("Error processing request:", error.message);
    res.status(500).send("Error processing request");
  }
}

async function extractTextFromPDF(fileBuffer, startPage, stopPage) {
  const data = await pdf(fileBuffer);
  const totalPages = data.numpages;

  if (startPage < 1 || stopPage > totalPages || startPage > stopPage) {
    throw new Error("Invalid page range");
  }

  const pagesText = data.text.split("\n\n").slice(startPage - 1, stopPage);
  return pagesText.join("\n");
}

function generateSummaryPrompt(
  bookTitle,
  bookAuthor,
  bookSubject,
  genre,
  startPage,
  stopPage,
  extractedText
) {
  return `
    Book Title: ${bookTitle}
    Book Author: ${bookAuthor}
    Book Subject: ${bookSubject}
    Genre: ${genre}
    Start Page: ${startPage}
    End Page: ${stopPage}

    Please summarize the following text and return the summary as a JSON object with a "summary" key (summary should be at least 300 words long and note what is provided is not the full book; you are simply summarizing between a page range. In the summary text, mention the page range, e.g., "from page X to page Y, here is the summary"):
    
    ${extractedText}
  `;
}

async function generateSummaryWithGemini(genAI, prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = await response.text();
    return { summary };
  } catch (err) {
    console.error("Error generating summary with Gemini API:", err.message);
    return null;
  }
}

async function generateSummaryWithOpenAI(openai, prompt) {
  const messages = [{ role: "user", content: prompt }];
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: messages,
    });

    const tokens = completion.usage.total_tokens;
    const completion_text = completion.choices[0].message.content;

    // Extract JSON from the response
    const jsonMatch = completion_text.match(/\{.*?\}/);
    if (!jsonMatch) {
      console.error("No valid JSON found in OpenAI response");
      return null;
    }

    const summary = JSON.parse(jsonMatch[0]);
    return { tokens, summary };
  } catch (err) {
    console.error("Error generating summary with OpenAI:", err.message);
    return null;
  }
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Swagger documentation available at http://localhost:${port}/api-docs`);
});
// Setup Swagger documentation
swaggerSetup.setup(app);

