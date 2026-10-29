module.exports = function errorHandler(err, req, res, next) {
  // err.status: body-parser(잘못된 JSON 400, 너무 큰 본문 413), 11000: unique 인덱스 충돌
  const status = err.statusCode || err.status || (err.code === 11000 ? 409 : 500);
  const payload = { error: { message: status === 500 ? 'Internal Server Error' : err.message } };
  if (status === 500) console.error(err);
  if (process.env.NODE_ENV !== 'production' && err.stack) payload.error.stack = err.stack;
  res.status(status).json(payload);
};
