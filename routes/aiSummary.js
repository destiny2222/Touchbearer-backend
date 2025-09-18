const express = require('express');
const router = express.Router();

// Gemini SDK
const { GoogleGenAI } = require('@google/genai');

// Ensure API key exists
const apiKey = process.env.GEMINI_API_KEY;

// Initialize client lazily to avoid constructing without key in certain envs
function getGenAiClient() {
    if (!apiKey) {
        const error = new Error('GEMINI_API_KEY is not set');
        error.status = 500;
        throw error;
    }
    return new GoogleGenAI({ apiKey });
}


// POST /api/ai/summary
router.post('/summary', async (req, res) => {
    try {
        const { data, options } = req.body || {};

        if (data === undefined) {
            return res.status(400).json({
                error: 'Missing required body field: data',
            });
        }

        const ai = getGenAiClient();
        const prompt = `You are a senior data analyst. Review the dataset below and give clear, actionable insights. Identify key trends and suggest strategies to improve school revenue and performance. Keep your response under 100 words. If the dataset is empty, simply say "Dataset is empty" without returning the data itself.\n\n${data}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // SDK returns object with .text getter for combined text output
        const text = response && response.text ? response.text : '';

        if (!text) {
            return res.status(502).json({ error: 'Empty response from AI' });
        }

        // Try to structure result lightly: extract sections if user wants MD
        return res.json({
            summary: text,
            model: 'gemini-2.5-flash',
        });
    } catch (err) {
        const status = err && err.status ? err.status : 500;
        return res.status(status).json({
            error: err && err.message ? err.message : 'Unexpected error',
        });
    }
});

module.exports = router;


