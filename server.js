// server.js (新增 SSE 路由)

// ... (省略 require 和 express 初始化的部分)
const express = require("express");
const app = express();
const PORT = 3000;
// ... (省略 Gemini API 相關的程式碼)

// ------------------------------------
// SSE (Server-Sent Events) 路由
// ------------------------------------

// 用來追蹤所有連接的客戶端 (在生產環境中需要更強健的結構)
const clients = [];

app.get("/", (req, res) => {
  res.send("Express 伺服器運行中。請使用 /api/generate 路由來呼叫 Gemini。");
});

app.get("/sse/stream", (req, res) => {
  // 1. 設定 HTTP Headers
  // 告訴客戶端這是一個事件流 (Event Stream)
  res.setHeader("Content-Type", "text/event-stream");
  // 避免快取，確保資料即時性
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // 允許跨來源請求 (在開發環境中很重要)
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 2. 發送初始連線訊息
  // 格式: data: [內容]\n\n
  const initialMessage = `data: Connection established. Server is ready.\n\n`;
  res.write(initialMessage);

  // 3. 儲存客戶端物件
  const clientId = Date.now();
  clients.push({ id: clientId, res });

  console.log(`新的 SSE 客戶端連線: ${clientId}`);

  // 4. 定時發送即時資料 (模擬 AI 輸出)
  let counter = 0;
  const intervalId = setInterval(() => {
    const data = {
      message: `這是來自後端的即時訊息 #${counter++}`,
      timestamp: new Date().toLocaleTimeString(),
    };
    // SSE 格式: data: [JSON.stringify(data)]\n\n
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }, 2000); // 每 2 秒發送一次

  // 5. 處理客戶端斷開連線
  req.on("close", () => {
    console.log(`SSE 客戶端連線斷開: ${clientId}`);
    // 清除定時器並從列表中移除客戶端
    clearInterval(intervalId);
    const index = clients.findIndex((client) => client.id === clientId);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

// ------------------------------------
// 啟動伺服器 (保持原樣)
app.listen(PORT, () => {
  console.log(`伺服器已啟動，正在監聽埠號 ${PORT}`);
  console.log(`請在瀏覽器中開啟: http://localhost:${PORT}`);
});
