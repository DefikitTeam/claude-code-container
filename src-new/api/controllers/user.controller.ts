import type { Context } from 'hono';
import {
  RegisterUserUseCase,
  type RegisterUserResult,
} from '../../core/use-cases/user/register-user.use-case';
import {
  GetUserUseCase,
  type GetUserResult,
} from '../../core/use-cases/user/get-user.use-case';
import {
  UpdateUserUseCase,
  type UpdateUserResult,
} from '../../core/use-cases/user/update-user.use-case';
import {
  DeleteUserUseCase,
  type DeleteUserResult,
} from '../../core/use-cases/user/delete-user.use-case';
import {
  parseRegisterUserDto,
  type RegisterUserRequestBody,
} from '../dto/register-user.dto';
import {
  parseUpdateUserDto,
  type UpdateUserRequestBody,
} from '../dto/update-user.dto';
import { createdResponse, successResponse } from '../responses/success.response';

export class UserController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly getUserUseCase: GetUserUseCase,
    private readonly updateUserUseCase: UpdateUserUseCase,
    private readonly deleteUserUseCase: DeleteUserUseCase,
  ) {}

  async register(c: Context): Promise<Response> {
    const body = await this.parseJson<RegisterUserRequestBody>(c);

    const dto = parseRegisterUserDto(body, {
      defaultUserId: this.safeGet(c, 'userId'),
      defaultInstallationId: this.safeGet(c, 'installationId'),
    });

    const result = await this.registerUserUseCase.execute(dto);
    return createdResponse<RegisterUserResult>(c, result);
  }

  async getUser(c: Context): Promise<Response> {
    const userId = c.req.param('userId');
    const result = await this.getUserUseCase.execute({ userId });
    return successResponse<GetUserResult>(c, result);
  }

  async updateUser(c: Context): Promise<Response> {
    const userId = c.req.param('userId');
    const body = await this.parseJson<UpdateUserRequestBody>(c);
    const dto = parseUpdateUserDto(userId, body);

    const result = await this.updateUserUseCase.execute(dto);
    return successResponse<UpdateUserResult>(c, result);
  }

  async deleteUser(c: Context): Promise<Response> {
    const userId = c.req.param('userId');
    const result = await this.deleteUserUseCase.execute({ userId });
    return successResponse<DeleteUserResult>(c, result);
  }

  private async parseJson<T>(c: Context): Promise<T> {
    try {
      return (await c.req.json()) as T;
    } catch (error) {
      throw error;
    }
  }

  private safeGet<T>(c: Context, key: string): T | undefined {
    try {
      return c.get(key) as T | undefined;
    } catch {
      return undefined;
    }
  }
}
