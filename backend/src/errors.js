/** Ошибка прикладного уровня: превращается в HTTP-ответ {error:{code,message,details}}. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const E = {
  badRequest: (code, message, details) => new AppError(400, code, message, details),
  unauthorized: (code = 'UNAUTHORIZED', message = 'Требуется авторизация') => new AppError(401, code, message),
  forbidden: (code, message, details) => new AppError(403, code, message, details),
  notFound: (code, message) => new AppError(404, code, message),
  conflict: (code, message, details) => new AppError(409, code, message, details),
  tooMany: (code, message, details) => new AppError(429, code, message, details),
};
