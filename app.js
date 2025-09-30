// --- 載入環境變數 ---
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const express = require("express");
// 引入 Google Gen AI SDK
const { GoogleGenAI } = require("@google/genai");
const consultantConfig = require("./consultantConfig"); // 引入顧問設定檔

const app = express();
const PORT = 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("錯誤: 請在 .env 檔案中設定 GEMINI_API_KEY");
  process.exit(1); // 停止應用程式
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
// 定義要使用的模型
const MODEL_NAME = "gemini-2.5-flash"; // 建議使用最新的 gemini-2.5-flash
const chatSessions = new Map();

app.use(cors());
app.use(express.json());

// 根路徑
app.get("/", (req, res) => {
  res.send("Express 伺服器運行中。請使用 /sse/stream 路由來呼叫 Gemini。");
});

async function checkIntent(config, prompt) {
  // 建立一個簡短、專注的 System Instruction 給意圖檢查模型
  const intentInstruction = `
        你是一個問題分類系統。
        用戶的問題是關於：「${prompt}」。
        該問題的適用範圍是：${config.topicScope.join(", ")}。

        請嚴格回答一個單字：
        - 如果問題與適用範圍「相關」，請回答：YES
        - 如果問題與適用範圍「無關」，請回答：NO
        不要回答任何其他內容。
    `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: intentInstruction,
      config: {
        temperature: 0.1, // 降低溫度以獲得更確定的答案
      },
    });
    // 檢查模型回應是否為 YES
    return response.text.trim().toUpperCase() === "YES";
  } catch (error) {
    console.error("意圖檢查失敗，預設允許通過:", error);
    return true; // 意圖檢查失敗時，可選擇預設允許或拒絕
  }
}

app.post("/sse/stream", async (req, res) => {
  const { prompt, sessionId, consultantId } = req.body; // 新增 consultantId

  if (!prompt || !sessionId || !consultantId) {
    return res.status(400).send("錯誤: 缺少 prompt, sessionId 或 consultantId。");
  }

  // 1. 取得選擇的顧問配置
  const config = consultantConfig[consultantId];
  if (!config) {
    return res.status(404).send(`錯誤: 找不到顧問 ID: ${consultantId}`);
  }

  // 2. 執行意圖檢查 (關鍵步驟)
  const isRelevant = await checkIntent(config, prompt);

  if (!isRelevant) {
    // 如果問題不相關，則返回錯誤訊息 (SSE 格式)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const errorMessage = `
            對不起，我是${config.name}。您的問題似乎與我的專業領域（${config.topicScope.join("、")}）無關。
            請針對${config.name}的服務範圍提問，或切換至其他顧問。
        `;

    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
    return;
  }
  console.log(`[${config.name}] 收到請求，Prompt: "${prompt.substring(0, 30)}..."`);

  // 3. 獲取或建立聊天會話 (包含 System Instruction 和 JSON 模板)
  let chat = chatSessions.get(sessionId);

  if (!chat) {
    // 建立新的 Chat 實例，設定角色指令，並要求 Markdown 輸出
    chat = ai.chats.create({
      model: MODEL_NAME,
      systemInstruction: config.systemInstruction, // 設定角色 // 📢 移除 responseMimeType 和 responseSchema！ // 讓模型使用標準的文字輸出
    });
    chatSessions.set(sessionId, chat);
  }

  // 4. 設定 SSE Headers 和執行串流邏輯 (沿用您上一個範例的邏輯)
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // 📢 使用真正的串流方法：chat.sendMessageStream
    const responseStream = await chat.sendMessageStream({ message: prompt }); // 移除所有 JSON 解析和模擬 setTimeout 的邏輯
    for await (const chunk of responseStream) {
      const content = chunk.text;
      if (content) {
        // 即時將模型輸出的內容片段發送給前端
        // type: 'text' 的 content 現在就是 Markdown 文字片段
        res.write(`data: ${JSON.stringify({ type: "text", content: content })}\n\n`);
      }
    } // 傳輸完畢後，發送一個結束標記

    res.write(`data: ${JSON.stringify({ type: "final", message: "串流完成" })}\n\n`);
  } catch (error) {
    console.error(`[${config.name}] 串流錯誤:`, error); // 將錯誤訊息以 SSE 格式傳遞給前端
    const errorMessage = `伺服器處理錯誤：${error.message}`;
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
  } finally {
    res.end(); // 確保連線結束
  }
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`伺服器已啟動，正在監聽埠號 ${PORT}`);
});
