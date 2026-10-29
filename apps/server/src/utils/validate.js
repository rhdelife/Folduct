// 웹 앱 domain/limits.ts와 같은 한도
const limits = { projectName: 80, coverColor: 32, sceneTitle: 60, userName: 50, email: 254 };

const text = (value, max) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

module.exports = { limits, text, isObject };
