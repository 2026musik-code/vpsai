export type GeminiResponse = {
    text: string;
    command?: string;
}

export async function getGeminiResponse(apiKey: string, model: string, userPrompt: string, currentPath: string): Promise<GeminiResponse> {

    // Map UI model names to actual API models if needed, or pass through
    // The UI sends "gemini-1.5-flash", "gemini-1.5-pro", etc.
    const apiModel = model || 'gemini-1.5-flash';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;

    const systemPrompt = `
    You are an AI assistant managing a Linux VPS. The user is currently at path: ${currentPath}.
    Your goal is to help the user manage the server, write code, and execute commands.

    INSTRUCTIONS:
    1. If the user asks to perform an action on the server (install, list, delete, edit), generate the appropriate Bash command.
    2. Return the response in strict JSON format.
    3. JSON Format:
       {
         "text": "Explanation of what you are doing or answer to question",
         "command": "The exact bash command to run (optional)"
       }
    4. If the user just wants to chat, return "command": null.
    5. Handle "Auto Install AI Environment" request by running: "./setup_vps.sh" (assume it exists or curl it first if needed).

    User Query: ${userPrompt}
    `;

    const body = {
        contents: [{
            parts: [{ text: systemPrompt }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
        }

        const data: any = await response.json();

        if (!data.candidates || data.candidates.length === 0) {
            return { text: "No response from AI." };
        }

        const rawText = data.candidates[0].content.parts[0].text;

        // Clean markdown code blocks if present (Gemini loves ```json)
        const jsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            const parsed = JSON.parse(jsonText);
            return parsed;
        } catch (e) {
            // Fallback if AI didn't return JSON
            return { text: rawText };
        }

    } catch (e: any) {
        return { text: `Error connecting to AI: ${e.message}` };
    }
}
