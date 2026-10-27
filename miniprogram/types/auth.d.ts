/** 登录响应中存储的基础用户信息（含角色，用于路由鉴权）。 */
export interface UserSession {
  id: string | number;
  accountType: 'CUSTOMER' | 'AREA_ADMIN' | 'STAFF' | 'SUPER_ADMIN' | 'PLATFORM_OWNER';
  username?: string;
  telephone?: string;
  avatarUrl?: string;
  isMember?: boolean;
  registrationSource?: 'WECHAT' | 'ADMIN_CREATED' | 'BOOTSTRAP';
}

/** 后端 UserProfileVO（GET /api/miniapp/user/me 返回）。 */
export interface UserProfileVO {
  id: number;
  openid: string;
  nickname?: string;
  avatarUrl?: string;
  mobile?: string;
  isMember?: boolean;
  /** 后端暂未返回；补上后前端可在刷新资料时同步角色，无需重新登录。 */
  accountType?: UserSession['accountType'];
  accountStatus?: string;
  registrationSource?: UserSession['registrationSource'];
}
