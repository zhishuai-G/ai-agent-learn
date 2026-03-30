import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiResponse } from '../dto/api-response.dto';

/**
 * 统一响应拦截器
 *
 * 自动将 Controller 返回值包装为 { code, message, data } 格式
 * 注意：SSE 流式接口不经过此拦截器（返回 Observable<MessageEvent>）
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    // SSE 流式接口不包装
    const response = context.switchToHttp().getResponse();
    if (response.getHeader?.('Content-Type')?.includes('text/event-stream')) {
      return next.handle();
    }

    return next.handle().pipe(map((data) => ApiResponse.success(data)));
  }
}
