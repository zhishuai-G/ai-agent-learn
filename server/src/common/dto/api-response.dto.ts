import { ApiProperty } from '@nestjs/swagger';

/**
 * 统一响应格式
 *
 * 所有接口返回统一结构：
 * {
 *   code: 200,
 *   message: 'success',
 *   data: { ... }
 * }
 */
export class ApiResponse<T> {
  @ApiProperty({ description: '状态码', example: 200 })
  code: number;

  @ApiProperty({ description: '提示信息', example: 'success' })
  message: string;

  @ApiProperty({ description: '响应数据' })
  data: T;

  constructor(data: T, code = 200, message = 'success') {
    this.code = code;
    this.message = message;
    this.data = data;
  }

  static success<T>(data: T, message = 'success'): ApiResponse<T> {
    return new ApiResponse(data, 200, message);
  }

  static error(message: string, code = 500): ApiResponse<null> {
    return new ApiResponse(null, code, message);
  }
}
