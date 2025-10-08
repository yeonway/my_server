const mongoose = require('mongoose');

const { Schema } = mongoose;

const pollOptionSchema = new Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },
    votesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const pollVoterSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    selectedOptionIndexes: {
      type: [Number],
      default: [],
    },
    votedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const pollSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    options: {
      type: [pollOptionSchema],
      validate: {
        validator(options) {
          return Array.isArray(options) && options.length >= 2;
        },
        message: '옵션은 최소 2개 이상이어야 합니다.',
      },
      required: true,
    },
    multiple: {
      type: Boolean,
      default: false,
    },
    anonymous: {
      type: Boolean,
      default: true,
    },
    deadline: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    voters: {
      type: [pollVoterSchema],
      default: [],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

pollSchema.index({ deadline: 1, isClosed: 1, isDeleted: 1 });
pollSchema.index({ title: 'text', description: 'text' });

pollSchema.methods.totalVotes = function totalVotes() {
  return this.options.reduce((sum, option) => sum + (option.votesCount || 0), 0);
};

pollSchema.methods.hasUserVoted = function hasUserVoted(userId) {
  if (!userId) return false;
  return this.voters.some((entry) => entry.user && entry.user.toString() === userId.toString());
};

module.exports = mongoose.model('Poll', pollSchema);
