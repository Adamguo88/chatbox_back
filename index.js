// --- 載入環境變數 ---
// const dotenv = require("dotenv");
const cors = require("cors");
const express = require("express");
const { GoogleGenAI } = require("@google/genai"); // 引入 Google Gen AI SDK

const mongoose = require("mongoose"); // 引入 Mongoose
const ChatRecord = require("./models/ChatRecord"); // history schema
const ConsultantConfig = require("./models/ConsultantConfigSchema"); // modal schema

// dotenv.config();
const app = express();
const PORT = 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
if (!GEMINI_API_KEY) {
  console.error("錯誤: 請在 .env 檔案中設定 GEMINI_API_KEY");
  process.exit(1); // 停止應用程式
}

if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "preview") {
  // 假設您的 dotenv 程式碼長這樣
  require("dotenv").config();
  // 如果您看到 [dotenv@17.2.2] 的訊息，可能您的程式碼還有其他邏輯，
  // 請確認您的 dotenv 載入部分只在非生產環境中執行。
}

// --- 資料庫連線 ---
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Cloud 連線成功"))
  .catch((err) => {
    console.error("❌ MongoDB 連線失敗:", err);
    // 可選擇在這裡 process.exit(1) 停止應用程式
  });

// -------------------
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
// 定義要使用的模型
const MODEL_NAME = "gemini-2.5-flash"; // 建議使用最新的 gemini-2.5-flash

app.use(cors());
app.use(express.json());

// 根路徑
app.get("/", (req, res) => {
  res.send("Express 伺服器運行中。請使用 /sse/stream 路由來呼叫 Gemini。");
});

const chatSessions = new Map();
async function checkIntent(config, prompt) {
  const intentInstruction = `
        你是一個問題分類系統。
        用戶的問題是關於：「${prompt}」。
        該問題的適用範圍是：${config.topicScope.join(", ")}。
        請嚴格回答一個單字：如果問題相關，回答：YES；如果問題無關，回答：NO。
        不要回答任何其他內容。
    `;

  try {
    const response = await ai.models.generateContent({
      // 使用較快的模型或 INTENT_CHECK_MODEL
      model: MODEL_NAME,
      contents: intentInstruction,
      config: {
        temperature: 0.1,
      },
    });

    // 檢查並處理模型回應
    return response.text.trim().toUpperCase() === "YES";
  } catch (error) {
    // 意圖檢查失敗通常由 API 錯誤引起，預設允許通過，避免服務中斷
    console.error("意圖檢查 API 呼叫失敗，預設允許通過:", error);
    return true;
  }
}

// --- SSE 主路由 ---
app.post("/sse/stream", async (req, res) => {
  const { prompt, sessionId, consultantId } = req.body;

  if (!prompt || !sessionId || !consultantId) {
    return res.status(400).send("錯誤: 缺少 prompt, sessionId 或 consultantId。");
  }

  const config = await ConsultantConfig.findOne({ consultantId }).lean();
  if (!config) {
    return res.status(404).send(`錯誤: 找不到顧問 ID: ${consultantId}`);
  }

  // 2. 執行意圖檢查
  const isRelevant = await checkIntent(config, prompt);

  if (!isRelevant) {
    // 設定 SSE Headers (即使只發送錯誤訊息)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const errorMessage = `對不起，我是${config.name}。您的問題似乎與我的專業領域（${config.topicScope.join("、")}）無關。請針對${
      config.name
    }的服務範圍提問，或切換至其他顧問。`;

    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
    return;
  }

  console.log(`[${config.name}] 收到請求，Prompt: "${prompt.substring(0, 30)}..."`);

  // --- 記憶與 Chat 實例處理 ---
  let chat = chatSessions.get(sessionId);
  let record = await ChatRecord.findOne({ sessionId }); // 查找 MongoDB 紀錄

  if (!record) {
    record = new ChatRecord({ sessionId, consultantId });
  }

  if (!chat || record.consultantId !== consultantId) {
    // 如果 chat 不存在，或用戶切換了顧問 (需要清除舊的記憶)

    // 確保資料庫紀錄與當前顧問同步 (如果用戶切換了顧問)
    record.consultantId = consultantId;

    // 轉換 DB 紀錄為 Gemini 歷史格式
    const geminiHistory = record.history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    }));

    chat = ai.chats.create({
      model: MODEL_NAME,
      systemInstruction: config.systemInstruction,
      history: geminiHistory, // 載入歷史紀錄
    });
    chatSessions.set(sessionId, chat);
  }

  // 記錄使用者輸入到資料庫紀錄中
  record.history.push({ role: "user", text: prompt });

  // --- SSE Headers ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  let modelResponseText = ""; // 用來緩衝模型的完整回答

  try {
    // 📢 執行真正的 AI 串流
    const responseStream = await chat.sendMessageStream({ message: prompt });

    for await (const chunk of responseStream) {
      const content = chunk.text;
      if (content) {
        modelResponseText += content; // 累加模型回覆
        // 即時發送給前端
        res.write(`data: ${JSON.stringify({ type: "text", content: content })}\n\n`);
      }
    }

    // 記錄模型完整回答到資料庫紀錄中
    record.history.push({ role: "model", text: modelResponseText });

    // 儲存更新後的紀錄到 MongoDB Cloud
    record.updatedAt = new Date();
    await record.save();

    // 傳輸完畢後，發送結束標記
    res.write(`data: ${JSON.stringify({ type: "final", message: "串流完成，紀錄已儲存" })}\n\n`);
  } catch (error) {
    console.error(`[${config.name}] 串流處理發生錯誤:`, error);
    const errorMessage = `伺服器處理錯誤：${error.message}`;
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
  } finally {
    res.end(); // 確保連線結束
  }
});
// 透過sessionId查詢歷史聊天紀錄
app.post("/api/history", async (req, res) => {
  // 1. 取得 URL 參數中的 sessionId
  console.log(req.body);
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ message: "錯誤：缺少 sessionId 參數" });
  }

  try {
    // 2. 查詢 MongoDB
    const record = await ChatRecord.findOne({ sessionId })
      // 使用 .lean() 讓 Mongoose 返回簡單的 JavaScript 對象，加快速度
      .lean();

    if (!record) {
      return res.status(444).json({ message: "找不到該 Session 的對話紀錄" });
    }

    // 3. 處理和格式化輸出資料
    const formattedHistory = record.history.map((msg) => ({
      role: msg.role,
      // 將 Mongoose 儲存的訊息內容直接傳遞
      content: msg.text,
      timestamp: msg.timestamp.toISOString(), // 轉換為標準格式
    }));

    // 4. 返回 JSON 格式的結果
    res.status(200).json({
      sessionId: record.sessionId,
      consultantId: record.consultantId,
      history: formattedHistory,
      lastUpdated: record.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("查詢歷史紀錄發生錯誤:", error);
    res.status(500).json({ message: "伺服器內部錯誤", error: error.message });
  }
});
// 查詢所有所有聊天紀錄
app.get("/api/records/all", async (req, res) => {
  // ⚠️ 安全提醒：這個路由將返回大量數據。
  // 在生產環境中，您應該加上認證和分頁 (Pagination) 機制。

  try {
    // 1. 查詢 MongoDB：使用 find({}) 獲取集合中的所有文件
    const allRecords = await ChatRecord.find({})
      // 2. 排序：通常會按最後更新時間倒序排列
      .sort({ updatedAt: -1 })
      // 3. 優化：使用 .lean() 讓 Mongoose 返回簡單的 JS 對象
      .lean();

    // 4. 處理和格式化輸出資料
    const formattedData = allRecords.map((item) => {
      const first = item?.history?.find((item) => item?.role === "user")?.text?.substring(0, 15);
      return { label: first, value: item.sessionId };
    });

    // 5. 返回 JSON 格式的結果
    res.status(200).json({
      totalRecords: allRecords.length,
      records: formattedData,
    });
  } catch (error) {
    console.error("查詢所有歷史紀錄發生錯誤:", error);
    res.status(500).json({ message: "伺服器內部錯誤", error: error.message });
  }
});

// 1. C (Create): 新增顧問
app.post("/api/config", async (req, res) => {
  try {
    const newConfig = new ConsultantConfig(req.body);
    await newConfig.save();
    res.status(201).json(newConfig);
  } catch (error) {
    // 處理重複 ID 的錯誤
    if (error.code === 11000) {
      return res.status(400).json({ message: "錯誤: 該顧問 ID 已存在。", error: error.message });
    }
    res.status(500).json({ message: "新增失敗", error: error.message });
  }
});
// 2. R (Read): 讀取所有顧問配置 (供前端選單使用)
app.get("/api/config", async (req, res) => {
  try {
    // 只取出活躍 (isActive: true) 的顧問，並只選擇必要的欄位
    const configs = await ConsultantConfig.find({}).sort({ updatedAt: -1 }).lean();
    res.status(200).json(configs);
  } catch (error) {
    res.status(500).json({ message: "讀取配置失敗", error: error.message });
  }
});
// 3. U (Update): 修改單個顧問配置
app.put("/api/config/:consultantId", async (req, res) => {
  try {
    const { consultantId } = req.params;
    const updatedConfig = await ConsultantConfig.findOneAndUpdate(
      { consultantId },
      req.body,
      { new: true, runValidators: true } // 返回更新後的文檔，並執行驗證
    ).lean();

    if (!updatedConfig) {
      return res.status(404).json({ message: "找不到該顧問配置" });
    }
    res.status(200).json(updatedConfig);
  } catch (error) {
    res.status(500).json({ message: "更新失敗", error: error.message });
  }
});
// 4. D (Delete): 刪除單個顧問配置
app.delete("/api/config/:consultantId", async (req, res) => {
  try {
    const { consultantId } = req.params;
    const deletedConfig = await ConsultantConfig.findOneAndDelete({ consultantId });

    if (!deletedConfig) {
      return res.status(404).json({ message: "找不到該顧問配置" });
    }
    res.status(200).json({ message: "顧問配置刪除成功", consultantId });
  } catch (error) {
    res.status(500).json({ message: "刪除失敗", error: error.message });
  }
});

module.exports = app;

// 啟動伺服器
// app.listen(PORT, () => {
//   console.log(`伺服器已啟動，正在監聽埠號 ${PORT}`);
// });
