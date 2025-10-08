const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true },
    user: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true },
    messageType: { type: String, enum: ['text', 'image', 'system'], default: 'text' },
    attachments: [{
      url: String,
      type: String,
      name: String,
    }],
    time: { type: Date, default: Date.now },
    editedAt: { type: Date, default: null },
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastEditedByName: { type: String, default: null },
    editHistory: {
      type: [
        {
          previousMessage: { type: String, required: true },
          newMessage: { type: String, required: true },
          editedAt: { type: Date, default: Date.now },
          editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          editorName: { type: String },
        }
      ],
      default: [],
    }
  },
  { timestamps: true }
);

messageSchema.index({ room: 1, time: -1 });
messageSchema.index({ message: 'text' });

module.exports = mongoose.model("Message", messageSchema);
