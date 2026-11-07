import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../catalogue/dto';
import { ParseObjectIdPipe } from '../catalogue/object-id.pipe';
import { emptyBodySchema } from '../orders/dto';
import { Role } from '../users/role';
import { NotificationsService } from './notifications.service';

/** The signed-in customer's own notifications; nothing here can name another account. */
@Roles(Role.CUSTOMER)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Body(new ZodPipe(emptyBodySchema)) _b: object, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @Param('id', new ParseObjectIdPipe()) id: string,
    @Body(new ZodPipe(emptyBodySchema)) _b: object,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.markRead(id.toLowerCase(), user);
  }
}
