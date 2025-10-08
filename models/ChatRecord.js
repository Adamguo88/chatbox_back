// models/ChatRecord.js

const mongoose = require("mongoose");

// 單一訊息的子 Schema
const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "model"], required: true }, // 誰發的訊息
  text: { type: String, required: true }, // 訊息內容
  timestamp: { type: Date, default: Date.now }, // 紀錄時間
});

// 對話紀錄的 Schema
const ChatRecordSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true, unique: true }, // 對話 ID (唯一索引)
  consultantId: { type: String, required: true }, // 哪位顧問
  history: [MessageSchema], // 儲存所有的對話訊息
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const ChatRecord = mongoose.model("ChatRecord", ChatRecordSchema);

module.exports = ChatRecord;
