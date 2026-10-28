/**
 * IBM App ID Configuration
 * This file contains the configuration for IBM App ID authentication
 */

export interface AppIdConfig {
  tenantId: string;
  clientId: string;
  secret: string;
  oAuthServerUrl: string;
  redirectUri: string;
  discoveryEndpoint: string;
}

export function getAppIdConfig(): AppIdConfig {
  const tenantId = process.env.APPID_TENANT_ID;
  const clientId = process.env.APPID_CLIENT_ID;
  const secret = process.env.APPID_SECRET;
  const oAuthServerUrl = process.env.APPID_OAUTH_SERVER_URL;
  const region = process.env.APPID_REGION || 'eu-gb';
  
  if (!tenantId || !clientId || !secret || !oAuthServerUrl) {
    throw new Error('Missing required App ID environment variables');
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  
  return {
    tenantId,
    clientId,
    secret,
    oAuthServerUrl,
    redirectUri: `${baseUrl}/api/auth/callback/appid`,
    discoveryEndpoint: `${oAuthServerUrl}/oidc/v4/${tenantId}/.well-known/openid-configuration`,
  };
}

export const appIdConfig = getAppIdConfig();


