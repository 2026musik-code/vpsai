export type GeminiResponse = {
    text: string;
    command?: string;
}

function resolveModel(modelInput: string): string {
    // Map requested "future" models to current working models to avoid 404s
    // unless we know they exist.
    // As of now, 2.5 and 3.0 are not public API endpoints.
    // We will map them to the best available current model.
    if (modelInput.includes('gemini-2.5') || modelInput.includes('gemini-3.0')) {
        // Fallback to 1.5 Pro for "advanced" requests
        return 'gemini-1.5-pro';
    }
    return modelInput || 'gemini-1.5-flash';
}

export async function getGeminiResponse(apiKey: string, model: string, userPrompt: string, currentPath: string): Promise<GeminiResponse> {

    const apiModel = resolveModel(model);

    // API URL
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
            throw new Error(`Gemini API Error (${apiModel}): ${response.status} - ${errText}`);
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
