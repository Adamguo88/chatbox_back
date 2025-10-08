// models/ConsultantConfig.js

const mongoose = require("mongoose");

const ConsultantConfigSchema = new mongoose.Schema(
  {
    // 唯一的 ID，作為前端選擇顧問時的鍵值 (e.g., 'jpmorgan_analyst')
    consultantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // 顯示給用戶看的名稱 (e.g., '摩根大通分析師')
    name: {
      type: String,
      required: true,
    },
    // Gemini 模型的 System Instruction，用於設定角色
    systemInstruction: {
      type: String,
      required: true,
    },
    // 意圖檢查的範圍列表
    topicScope: {
      type: [String],
      required: true,
    },
    isActive: {
      // 控制顧問是否在前端顯示
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // 自動新增 createdAt 和 updatedAt 欄位
  }
);

const ConsultantConfig = mongoose.model("ConsultantConfig", ConsultantConfigSchema);

module.exports = ConsultantConfig;
