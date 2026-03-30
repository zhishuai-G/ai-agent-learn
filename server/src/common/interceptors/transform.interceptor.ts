import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { ApiResponse } from '../dto/api-response.dto';

export const SKIP_TRANSFORM_KEY = 'skipTransform';

/**
 * 标记装饰器：跳过统一响应包装
 * 用于 SSE 流式接口等不需要包装的场景
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);

/**
 * 统一响应拦截器
 *
 * 自动将 Controller 返回值包装为 { code, message, data } 格式
 * 使用 @SkipTransform() 装饰器的接口会跳过包装
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const skip = this.reflector.get<boolean>(
      SKIP_TRANSFORM_KEY,
      context.getHandler(),
    );
    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(map((data) => ApiResponse.success(data)));
  }
}
