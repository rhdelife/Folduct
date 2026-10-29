const { randomUUID } = require('crypto');

// 웹 앱과 같이 UUID 문자열 id를 씁니다. 응답에서는 _id 대신 id로 내보냅니다.
const idField = { type: String, default: () => randomUUID() };

function schemaOptions(hidden = []) {
  return {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        for (const key of hidden) delete ret[key];
        return ret;
      },
    },
  };
}

module.exports = { idField, schemaOptions };
