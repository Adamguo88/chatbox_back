// server.js

// --- 載入環境變數 ---
const dotenv = require("dotenv");
dotenv.config();

// 引入 Express 模組
const express = require("express");
// 引入 Google Gen AI SDK
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = 3000;

// 從 .env 取得 API 金鑰，並初始化 Gemini 客戶端
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("錯誤: 請在 .env 檔案中設定 GEMINI_API_KEY");
  process.exit(1); // 停止應用程式
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
// 定義要使用的模型
const MODEL_NAME = "gemini-2.5-flash"; // 建議使用最新的 gemini-2.5-flash

// ------------------------------------
// Middleware (中介軟體) 設定
// ------------------------------------
// 啟用內建的 express.json() 中介軟體，用於解析傳入的 JSON 格式請求 body
app.use(express.json());

// ------------------------------------
// 路由 (Routes) 設定
// ------------------------------------

// 根路徑
app.get("/", (req, res) => {
  res.send("Express 伺服器運行中。請使用 /api/generate 路由來呼叫 Gemini。");
});

// *** 新增的 Gemini API 路由 ***
app.post("/api/generate", async (req, res) => {
  // 檢查請求 body 中是否有 prompt 欄位
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: '請求主體中缺少 "prompt" 參數。' });
  }

  try {
    // 呼叫 Gemini API 產生內容
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt, // 使用用戶傳入的 prompt
    });

    // 取得模型的回應文字
    const generatedText = response.text;

    // 將結果回傳給客戶端
    res.json({
      model: MODEL_NAME,
      prompt: prompt,
      generatedText: generatedText,
    });
  } catch (error) {
    console.error("Gemini API 呼叫失敗:", error);
    // 回傳 500 錯誤給客戶端
    res.status(500).json({
      error: "與 Gemini API 通訊時發生錯誤。",
      details: error.message,
    });
  }
});

// ------------------------------------
// 啟動伺服器
// ------------------------------------

app.listen(PORT, () => {
  console.log(`伺服器已啟動，正在監聽埠號 ${PORT}`);
  console.log(`請在瀏覽器中開啟: http://localhost:${PORT}`);
});
