import { cookies } from "next/headers";

export const APP_SESSION_COOKIE = "app_session";
export const PLATFORM_SESSION_COOKIE = "platform_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function setAppSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(APP_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearAppSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(APP_SESSION_COOKIE);
}

export async function setPlatformSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(PLATFORM_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearPlatformSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(PLATFORM_SESSION_COOKIE);
}
