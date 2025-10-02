const mongoose = require("mongoose");

const chatroomSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    type: { type: String, enum: ['group', 'dm'], default: 'group' },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dmKey: { type: String, unique: true, sparse: true },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

chatroomSchema.index({ type: 1, dmKey: 1 }, { unique: true, sparse: true });
chatroomSchema.index({ participants: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Chatroom", chatroomSchema);
